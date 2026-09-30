from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import get_current_user, has_perm, require
from ..models import AuditLog, User
from ..services import serializers as S
from ..services.audit import verify_chain
from .common import page_params

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])

# Officers may not browse other users' login/logout activity (privacy / least privilege).
SESSION_ACTIONS = ("Login", "Logout", "Login Failed", "Password Changed")


def _row(a: AuditLog) -> dict:
    return {"audit_id": a.audit_id, "user": a.user_name, "user_id": a.user_id, "role": a.role, "action": a.action,
            "entity_type": a.entity_type, "entity_id": a.entity_id, "project_id": a.project_id,
            "previous_value": a.previous_value, "new_value": a.new_value, "reason": a.reason,
            "timestamp": S.iso(a.timestamp), "record_hash": (a.record_hash or "")[:12]}


@router.get("")
def list_audit(
    project_id: int | None = None, action: str | None = None, role: str | None = None, user_id: int | None = None,
    entity_type: str | None = None, date_from: date | None = None, date_to: date | None = None,
    page: int = 1, page_size: int = 50, user: User = Depends(require("audit:view")), db: Session = Depends(get_db),
):
    stmt = select(AuditLog)
    if user.role in (P.OFFICER, P.MP):
        stmt = stmt.where(AuditLog.action.not_in(SESSION_ACTIONS))
    if project_id:
        stmt = stmt.where(AuditLog.project_id == project_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if role:
        stmt = stmt.where(AuditLog.role == role)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if date_from:
        stmt = stmt.where(AuditLog.timestamp >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(AuditLog.timestamp < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    offset, limit = page_params(page, page_size)
    rows = db.execute(stmt.order_by(AuditLog.audit_id.desc()).offset(offset).limit(limit)).scalars().all()
    return {"items": [_row(a) for a in rows], "total": total or 0, "page": page, "page_size": limit}


@router.get("/actions")
def audit_actions(user: User = Depends(require("audit:view")), db: Session = Depends(get_db)):
    q = select(AuditLog.action).distinct().order_by(AuditLog.action)
    if user.role == P.OFFICER:
        q = q.where(AuditLog.action.not_in(SESSION_ACTIONS))
    return [a for (a,) in db.execute(q)]


@router.get("/summary")
def audit_summary(user: User = Depends(require("audit:summary")), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=14)
    by_action = db.execute(select(AuditLog.action, func.count()).where(AuditLog.timestamp >= since)
                           .group_by(AuditLog.action).order_by(func.count().desc())).all()
    by_role = db.execute(select(AuditLog.role, func.count()).where(AuditLog.timestamp >= since)
                         .group_by(AuditLog.role)).all()
    day = func.date_trunc("day", AuditLog.timestamp)
    by_day = db.execute(select(day, func.count()).where(AuditLog.timestamp >= since).group_by(day).order_by(day)).all()
    total = db.scalar(select(func.count()).select_from(AuditLog)) or 0
    return {
        "total_records": total, "window_days": 14,
        "by_action": [{"action": a, "count": c} for a, c in by_action],
        "by_role": [{"role": r or "System", "count": c} for r, c in by_role],
        "by_day": [{"day": d.date().isoformat(), "count": c} for d, c in by_day],
        "corrections": next((c for a, c in by_action if a == "Data Correction"), 0),
        "decisions": next((c for a, c in by_action if a == "Decision"), 0),
        "escalations": next((c for a, c in by_action if a == "Escalation"), 0),
    }


@router.get("/verify-chain")
def audit_verify(user: User = Depends(require("audit:summary")), db: Session = Depends(get_db)):
    return verify_chain(db)
