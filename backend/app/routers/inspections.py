"""Inspection module: Requested -> Assigned -> Scheduled -> Completed -> Report Submitted -> Action Pending -> Closed"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, has_perm, require
from ..models import Document, Inspection, Project, User
from ..schemas import InspectionCreateIn, InspectionUpdateIn
from ..services import file_storage as FS
from ..services import notify, serializers as S
from ..services.audit import log_audit
from .common import names, project_or_404

router = APIRouter(prefix="/api/inspections", tags=["inspections"])

OPEN = ("Requested", "Assigned", "Scheduled", "Completed")


def _view(db: Session, i: Inspection) -> dict:
    p = db.get(Project, i.project_id)
    nm = names(db, {i.requested_by, i.assigned_to})
    docs = db.execute(select(Document).where(Document.inspection_id == i.inspection_id)).scalars().all()
    d = S.inspection(i, p, nm)
    d["evidence"] = [S.document(x) for x in docs]
    return d


def _get(db: Session, inspection_id: int) -> Inspection:
    i = db.get(Inspection, inspection_id)
    if not i:
        raise HTTPException(404, "Inspection not found.")
    return i


@router.get("")
def list_inspections(status: str | None = None, project_id: int | None = None, mine: bool = False,
                     user: User = Depends(require("inspection:view")), db: Session = Depends(get_db)):
    stmt = select(Inspection).order_by(Inspection.requested_at.desc())
    if status:
        stmt = stmt.where(Inspection.status == status)
    if project_id:
        stmt = stmt.where(Inspection.project_id == project_id)
    if mine:
        stmt = stmt.where(Inspection.assigned_to == user.user_id)
    return [_view(db, i) for i in db.execute(stmt.limit(300)).scalars()]


@router.get("/{inspection_id}")
def get_inspection(inspection_id: int, user: User = Depends(require("inspection:view")), db: Session = Depends(get_db)):
    return _view(db, _get(db, inspection_id))


@router.post("", status_code=201)
def request_inspection(body: InspectionCreateIn, request: Request, user: User = Depends(require("inspection:request")),
                       db: Session = Depends(get_db)):
    p = project_or_404(db, body.project_id)
    i = Inspection(project_id=p.project_id, requested_by=user.user_id, reason=body.reason.strip(), priority=body.priority,
                   status="Requested")
    db.add(i)
    prev = p.status
    if p.status in ("Officer Review Required", "Under Review", "Verified - Analysis Pending"):
        p.status = "Inspection Requested"
    db.flush()
    log_audit(db, user, "Inspection Requested", "Inspection", i.inspection_id, project_id=p.project_id,
              new={"priority": i.priority, "status": "Requested"}, reason=i.reason[:300], ip=client_ip(request))
    if prev != p.status:
        log_audit(db, user, "Status Change", "Project", p.project_code, project_id=p.project_id,
                  previous={"status": prev}, new={"status": p.status}, reason="Inspection requested", ip=client_ip(request))
    notify.notify(db, notify.head_officers(db), "Inspection requested",
                  f"Inspection requested by {user.name} for {p.project_code} (priority {i.priority}). Assignment required.",
                  "action", project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
    db.commit()
    return _view(db, i)


def _bad(msg: str, code: int = 409):
    raise HTTPException(code, msg)


@router.put("/{inspection_id}")
def update_inspection(inspection_id: int, body: InspectionUpdateIn, request: Request,
                      user: User = Depends(require("inspection:view")), db: Session = Depends(get_db)):
    i = _get(db, inspection_id)
    p = db.get(Project, i.project_id)
    ip = client_ip(request)
    prev = {"status": i.status}
    a = body.action
    is_assignee = i.assigned_to == user.user_id

    if a == "assign":
        if not has_perm(user, "inspection:assign"):
            raise HTTPException(403, "You do not have permission to perform this action.")
        if i.status not in ("Requested", "Assigned"):
            _bad("Only requested inspections can be (re)assigned.")
        inspector = db.get(User, body.inspector_id) if body.inspector_id else None
        if not inspector or not inspector.is_inspector or inspector.status != "Active":
            _bad("Select an available inspector.", 422)
        i.assigned_to, i.assigned_by, i.status = inspector.user_id, user.user_id, "Assigned"
        i.due_date = body.due_date or i.due_date or (date.today() + timedelta(days=14))
        if body.priority:
            i.priority = body.priority
        notify.notify(db, [inspector.user_id], "Inspection requested",
                      f"You have been assigned an inspection for {p.project_code} (priority {i.priority}, due {i.due_date}).",
                      "action", project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
        notify.notify(db, [i.requested_by], "Inspection requested",
                      f"Your inspection request for {p.project_code} was assigned to {inspector.name}.", "info",
                      project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
    elif a == "schedule":
        if not (is_assignee or has_perm(user, "inspection:assign")):
            raise HTTPException(403, "Only the assigned inspector can schedule this inspection.")
        if i.status != "Assigned":
            _bad("Only assigned inspections can be scheduled.")
        if not body.scheduled_date:
            _bad("Choose the inspection date.", 422)
        i.scheduled_date, i.status = body.scheduled_date, "Scheduled"
    elif a == "complete":
        if not is_assignee:
            raise HTTPException(403, "Only the assigned inspector can complete this inspection.")
        if i.status != "Scheduled":
            _bad("Only scheduled inspections can be marked completed.")
        i.status, i.completed_at = "Completed", datetime.now(timezone.utc)
    elif a == "submit_report":
        if not is_assignee:
            raise HTTPException(403, "Only the assigned inspector can submit the report.")
        if i.status != "Completed":
            _bad("Complete the inspection before submitting the report.")
        if not (body.findings and len(body.findings.strip()) >= 10) or not body.outcome or not body.recommendation:
            _bad("Findings, recommendation and outcome are required to submit the report.", 422)
        i.findings = body.findings.strip()
        i.recommendation = body.recommendation.strip()
        i.outcome = body.outcome
        if not i.completed_at:
            i.completed_at = datetime.now(timezone.utc)
        if body.progress_observed is not None:
            i.progress_observed = body.progress_observed
        if body.issues:
            i.issues = body.issues.strip()
        if body.action_required:
            i.action_required = body.action_required.strip()
            i.responsible_party = (body.responsible_party or (p.agency.name if p.agency else None) or "Implementing Agency").strip()
            i.status = "Action Pending"
        else:
            i.status = "Report Submitted"
        adverse = body.outcome in ("Major Deficiencies", "Irregularities Found")
        notify.notify(db, [i.requested_by] + notify.head_officers(db), "Inspection requested",
                      f"Inspection report submitted for {p.project_code}: outcome '{body.outcome}'.",
                      "critical" if adverse else "review", project_id=p.project_id, entity_type="Inspection",
                      entity_id=i.inspection_id)
    elif a == "action_pending":
        if not (has_perm(user, "decision:record") or has_perm(user, "decision:supervise")):
            raise HTTPException(403, "You do not have permission to perform this action.")
        if i.status != "Report Submitted":
            _bad("Only inspections with a submitted report can move to action pending.")
        i.status = "Action Pending"
        if body.action_required:
            i.action_required = body.action_required.strip()
        if body.responsible_party:
            i.responsible_party = body.responsible_party.strip()
        notify.notify(db, notify.project_agency_users(db, p), "Agency clarification",
                      f"Follow-up action is pending on {p.project_code} following the inspection. Await officer instructions.",
                      "action", project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
    elif a == "record_action":
        if not (has_perm(user, "decision:record") or has_perm(user, "decision:supervise") or user.role == P.AGENCY):
            raise HTTPException(403, "You do not have permission to perform this action.")
        if i.status not in ("Action Pending", "Report Submitted"):
            _bad("Only inspections with pending action can record actions taken.")
        if not body.action_taken or not body.action_taken.strip():
            _bad("Action taken description is required.", 422)
        i.action_taken = body.action_taken.strip()
        i.action_date = datetime.now(timezone.utc)
        notify.notify(db, [i.requested_by] + notify.head_officers(db), "Action recorded",
                      f"Action taken recorded for inspection #{i.inspection_id} ({p.project_code}): {i.action_taken[:100]}",
                      "info", project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
    elif a == "close":
        if not (has_perm(user, "decision:record") or has_perm(user, "decision:supervise")):
            raise HTTPException(403, "You do not have permission to perform this action.")
        if i.status not in ("Report Submitted", "Action Pending"):
            _bad("Only inspections with a submitted report can be closed.")
        i.status, i.closed_at = "Closed", datetime.now(timezone.utc)
        if body.closure_reason:
            i.closure_reason = body.closure_reason.strip()
        elif body.note:
            i.closure_reason = body.note.strip()
        if body.action_taken and not i.action_taken:
            i.action_taken = body.action_taken.strip()
            i.action_date = datetime.now(timezone.utc)
        others = db.scalar(select(func.count()).select_from(Inspection).where(
            Inspection.project_id == p.project_id, Inspection.status.in_(OPEN + ("Report Submitted", "Action Pending")),
            Inspection.inspection_id != i.inspection_id))
        if p.status == "Inspection Requested" and not others:
            old = p.status
            p.status = "Officer Review Required"
            log_audit(db, user, "Status Change", "Project", p.project_code, project_id=p.project_id,
                      previous={"status": old}, new={"status": p.status}, reason="Inspection closed", ip=ip)
        notify.notify(db, [i.requested_by], "Decision completed", f"Inspection for {p.project_code} was closed.", "info",
                      project_id=p.project_id, entity_type="Inspection", entity_id=i.inspection_id)
    i.updated_at = datetime.now(timezone.utc)
    log_audit(db, user, "Inspection", "Inspection", i.inspection_id, project_id=p.project_id, previous=prev,
              new={"status": i.status, "action": a, "assigned_to": i.assigned_to, "scheduled_date": i.scheduled_date,
                   "due_date": i.due_date, "outcome": i.outcome, "action_required": i.action_required,
                   "action_taken": i.action_taken, "closure_reason": i.closure_reason},
              reason=body.note or body.recommendation or a, ip=ip)
    db.commit()
    return _view(db, i)


@router.post("/{inspection_id}/evidence", status_code=201)
async def upload_evidence(inspection_id: int, request: Request, file: UploadFile = File(...),
                          description: str = Form(""), is_public: bool = Form(True),
                          visibility: str = Form("PUBLIC"), user: User = Depends(require("inspection:conduct")),
                          db: Session = Depends(get_db)):
    i = _get(db, inspection_id)
    if i.assigned_to != user.user_id:
        raise HTTPException(403, "Only the assigned inspector can attach evidence.")
    if i.status in ("Closed",):
        raise HTTPException(409, "This inspection is closed.")
    data, mime = await FS.read_upload(file, {*FS.IMAGE_TYPES, "application/pdf"})
    if mime == "application/pdf":
        FS.validate_pdf_bytes(data)
    rel, sha = FS.save_bytes(data, f"inspections/{i.inspection_id}", mime)
    doc = Document(project_id=i.project_id, inspection_id=i.inspection_id, document_type="Inspection Evidence",
                   file_name=FS.safe_display_name(file.filename), file_path=rel, content_type=mime, size_bytes=len(data),
                   sha256=sha, version=1, is_public=is_public, visibility=visibility,
                   moderation_status="APPROVED",
                   description=description.strip()[:255] or None, uploaded_by=user.user_id)
    db.add(doc)
    db.flush()
    log_audit(db, user, "Document Upload", "Document", doc.document_id, project_id=i.project_id,
              new={"file_name": doc.file_name, "inspection_id": i.inspection_id}, reason="Inspection evidence", ip=client_ip(request))
    db.commit()
    return S.document(doc)
