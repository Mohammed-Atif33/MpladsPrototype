from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm
from ..models import Decision, Project, User
from ..schemas import DecisionIn, HEAD_ACTIONS, OFFICER_DECISIONS
from ..services import serializers as S
from ..services.workflow import EVIDENCE_OPTIONS, apply_decision
from .common import names, visible_project_or_404

router = APIRouter(prefix="/api/decisions", tags=["decisions"])


@router.get("/options")
def options(user: User = Depends(get_current_user)):
    if not has_perm(user, "decision:view"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    return {"decisions": OFFICER_DECISIONS if user.role == P.OFFICER else HEAD_ACTIONS, "evidence": EVIDENCE_OPTIONS}


@router.get("")
def list_decisions(project_id: int | None = None, limit: int = 200, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    if not has_perm(user, "decision:view"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    stmt = select(Decision).order_by(Decision.decision_id.desc()).limit(min(limit, 500))
    if project_id:
        stmt = stmt.where(Decision.project_id == project_id)
    rows = db.execute(stmt).scalars().all()
    nm = names(db, {r.user_id for r in rows})
    pj = {p.project_id: p for p in db.execute(select(Project).where(Project.project_id.in_({r.project_id for r in rows} or {0}))).scalars()}
    return [S.decision(r, pj.get(r.project_id), nm) for r in rows]


@router.post("", status_code=201)
def create_decision(body: DecisionIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not (has_perm(user, "decision:record") or has_perm(user, "decision:supervise")):
        raise HTTPException(403, "You do not have permission to perform this action.")
    project = visible_project_or_404(db, user, body.project_id)
    dec = apply_decision(db, user, project, body, client_ip(request))
    db.commit()
    nm = names(db, {dec.user_id})
    return {"decision": S.decision(dec, project, nm), "project_status": project.status, "case_level": project.case_level}
