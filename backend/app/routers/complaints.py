"""Citizen complaint workflow:
Submit -> Tracking ID -> Screening -> Assignment -> Investigation/inspection -> Resolution -> Citizen feedback -> Appeal/Close
"""
from __future__ import annotations

import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm, require
from ..models import Complaint, Document, Project, User
from ..schemas import ComplaintUpdateIn
from ..services import file_storage as FS
from ..services import notify, serializers as S
from ..services.audit import log_audit
from .common import page_params

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

COMPLAINT_CATEGORIES = ["Poor quality of work", "Work delay / stalled", "Financial irregularity",
                        "Safety hazard", "Incomplete work marked complete", "Other"]
SERIOUS_CATEGORIES = {"Financial irregularity", "Safety hazard"}


def _tracking_id(db: Session) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        tid = f"CMP-{date.today().year}-{''.join(secrets.choice(alphabet) for _ in range(5))}"
        if not db.scalar(select(Complaint.complaint_id).where(Complaint.tracking_id == tid)):
            return tid


def _project_for(db: Session, c: Complaint) -> Project | None:
    return db.get(Project, c.project_id) if c.project_id else None


def _view(db: Session, user: User, c: Complaint) -> dict:
    proj = _project_for(db, c)
    if user.role == P.CITIZEN:
        return S.complaint_for_citizen(c, proj)
    if user.role == P.AGENCY:
        return S.complaint_for_agency(c, proj)
    citizen = db.get(User, c.citizen_id)
    return S.complaint_for_officer(c, proj, citizen)


def _accessible(db: Session, user: User, c: Complaint) -> bool:
    if user.role == P.CITIZEN:
        return c.citizen_id == user.user_id
    if user.role == P.AGENCY:
        proj = _project_for(db, c)
        return bool(proj and proj.agency_id == user.agency_id and c.screening_status == "Verified")
    return has_perm(user, "complaint:review") or has_perm(user, "complaint:view")


def _get(db: Session, user: User, complaint_id: int) -> Complaint:
    c = db.get(Complaint, complaint_id)
    if not c or not _accessible(db, user, c):
        raise HTTPException(404, "Complaint not found.")
    return c


@router.post("", status_code=201)
async def submit_complaint(
    request: Request,
    category: str = Form(...), description: str = Form(...), project_id: int | None = Form(None),
    incident_date: date | None = Form(None), location_text: str | None = Form(None), anonymous: bool = Form(False),
    files: list[UploadFile] = File(default_factory=list),
    user: User = Depends(require("complaint:submit")), db: Session = Depends(get_db),
):
    if category not in COMPLAINT_CATEGORIES:
        raise HTTPException(422, "Please choose a valid complaint category.")
    description = description.strip()
    if len(description) < 15 or len(description) > 4000:
        raise HTTPException(422, "Description must be between 15 and 4000 characters.")
    if incident_date and incident_date > date.today():
        raise HTTPException(422, "Incident date cannot be in the future.")
    project = None
    if project_id is not None:
        project = db.get(Project, project_id)
        if not project or not project.is_public or project.verification_status != "Verified":
            raise HTTPException(404, "Project not found.")
    else:
        raise HTTPException(422, "Please select the project this complaint is about.")
    if len(files) > 3:
        raise HTTPException(422, "You can attach at most 3 photos/videos.")

    c = Complaint(tracking_id=_tracking_id(db), project_id=project.project_id, citizen_id=user.user_id, category=category,
                  description=description, incident_date=incident_date,
                  location_text=(location_text or "").strip()[:255] or None, anonymous=anonymous,
                  status="Submitted", serious=category in SERIOUS_CATEGORIES, evidence=[])
    db.add(c)
    db.flush()
    evidence = []
    for up in files:
        if not up.filename:
            continue
        data, mime = await FS.read_upload(up, {*FS.IMAGE_TYPES, *FS.VIDEO_TYPES})
        rel, sha = FS.save_bytes(data, f"complaints/{c.complaint_id}", mime)
        d = Document(project_id=project.project_id, complaint_id=c.complaint_id, document_type="Complaint Evidence",
                     file_name=FS.safe_display_name(up.filename), file_path=rel, content_type=mime, size_bytes=len(data),
                     sha256=sha, version=1, is_public=False, uploaded_by=user.user_id)
        db.add(d)
        db.flush()
        evidence.append({"document_id": d.document_id, "file_name": d.file_name, "content_type": mime})
    c.evidence = evidence
    log_audit(db, user, "Complaint", "Complaint", c.tracking_id, project_id=project.project_id,
              new={"category": category, "anonymous": anonymous, "attachments": len(evidence), "status": "Submitted"},
              reason="Citizen complaint submitted", ip=client_ip(request))
    notify.notify(db, notify.officers(db), "Citizen complaint",
                  f"New citizen complaint {c.tracking_id} on {project.project_code} ({category}) awaiting screening.",
                  "action" if c.serious else "review", project_id=project.project_id, entity_type="Complaint",
                  entity_id=c.complaint_id)
    notify.notify(db, [user.user_id], "Citizen complaint",
                  f"Your complaint has been received. Tracking ID: {c.tracking_id}. It will be screened by an officer.",
                  "info", project_id=project.project_id, entity_type="Complaint", entity_id=c.complaint_id)
    db.commit()
    return _view(db, user, c)


@router.get("/categories")
def categories(user: User = Depends(get_current_user)):
    return COMPLAINT_CATEGORIES


@router.get("")
def list_complaints(
    status: str | None = None, screening_status: str | None = None, project_id: int | None = None,
    serious: bool | None = None, appeal_status: str | None = None, q: str | None = None,
    page: int = 1, page_size: int = 50, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    stmt = select(Complaint)
    if user.role == P.CITIZEN:
        stmt = stmt.where(Complaint.citizen_id == user.user_id)
    elif user.role == P.AGENCY:
        stmt = stmt.join(Project, Project.project_id == Complaint.project_id).where(
            Project.agency_id == user.agency_id, Complaint.screening_status == "Verified")
    elif has_perm(user, "complaint:review") or has_perm(user, "complaint:view"):
        pass
    else:
        raise HTTPException(403, "You do not have permission to perform this action.")
    if status:
        stmt = stmt.where(Complaint.status == status)
    if screening_status and user.role in (P.OFFICER, P.HEAD, P.MP):
        stmt = stmt.where(Complaint.screening_status == screening_status)
    if project_id:
        stmt = stmt.where(Complaint.project_id == project_id)
    if serious is not None and user.role in (P.OFFICER, P.HEAD, P.MP):
        stmt = stmt.where(Complaint.serious.is_(serious))
    if appeal_status and user.role in (P.OFFICER, P.HEAD, P.MP):
        stmt = stmt.where(Complaint.appeal_status == appeal_status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Complaint.tracking_id.ilike(like), Complaint.description.ilike(like),
                              Complaint.category.ilike(like)))
    stmt = stmt.order_by(Complaint.created_at.desc())
    offset, limit = page_params(page, page_size)
    rows = db.execute(stmt.offset(offset).limit(limit)).scalars().all()
    return {"items": [_view(db, user, c) for c in rows], "page": page}


@router.get("/{complaint_id}")
def get_complaint(complaint_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _view(db, user, _get(db, user, complaint_id))


def _set_status(db, user, c: Complaint, new: str, reason: str | None, ip: str | None, **extra):
    prev = c.status
    c.status = new
    c.updated_at = datetime.now(timezone.utc)
    log_audit(db, user, "Status Change", "Complaint", c.tracking_id, project_id=c.project_id,
              previous={"status": prev}, new={"status": new, **extra}, reason=reason, ip=ip)


def _deny():
    raise HTTPException(403, "You do not have permission to perform this action.")


@router.put("/{complaint_id}")
def update_complaint(complaint_id: int, body: ComplaintUpdateIn, request: Request,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    c = _get(db, user, complaint_id)
    ip = client_ip(request)
    proj = _project_for(db, c)
    pcode = proj.project_code if proj else (c.project_code_ref or "project")
    a = body.action
    text = (body.text or "").strip()

    def need(cond: bool, msg: str, code: int = 422):
        if not cond:
            raise HTTPException(code, msg)

    # -------------------------------------------------- officer / head officer
    if a == "screen":
        if not has_perm(user, "complaint:review"):
            _deny()
        need(c.screening_status == "Pending", "This complaint has already been screened.", 409)
        need(body.verdict in ("verified", "rejected"), "Choose whether the complaint is verified or rejected.")
        need(len((body.note or "").strip()) >= 5, "Add a screening note explaining the decision.")
        c.screened_by, c.screened_at, c.screening_note = user.user_id, datetime.now(timezone.utc), body.note.strip()
        if body.serious is not None:
            c.serious = body.serious
        if body.verdict == "verified":
            c.screening_status = "Verified"
            log_audit(db, user, "Complaint", "Complaint", c.tracking_id, project_id=c.project_id,
                      previous={"screening_status": "Pending"}, new={"screening_status": "Verified", "serious": c.serious},
                      reason=body.note.strip(), ip=ip)
            _set_status(db, user, c, "Assigned", "Complaint verified and assigned to the implementing agency", ip)
            if proj:
                notify.notify(db, notify.project_agency_users(db, proj), "Citizen complaint",
                              f"A verified citizen complaint ({c.tracking_id}, {c.category}) has been assigned to you for {pcode}. Please respond.",
                              "action", project_id=proj.project_id, entity_type="Complaint", entity_id=c.complaint_id)
                if c.serious:
                    notify.notify(db, notify.head_officers(db), "Supervisory review",
                                  f"Serious complaint {c.tracking_id} ({c.category}) verified on {pcode}.", "review",
                                  project_id=proj.project_id, entity_type="Complaint", entity_id=c.complaint_id)
            notify.notify(db, [c.citizen_id], "Citizen complaint",
                          f"Your complaint {c.tracking_id} was screened and assigned for action.", "info",
                          project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)
        else:
            c.screening_status = "Rejected"
            log_audit(db, user, "Complaint", "Complaint", c.tracking_id, project_id=c.project_id,
                      previous={"screening_status": "Pending"}, new={"screening_status": "Rejected"},
                      reason=body.note.strip(), ip=ip)
            _set_status(db, user, c, "Rejected", "Complaint could not be verified at screening", ip)
            notify.notify(db, [c.citizen_id], "Citizen complaint",
                          f"Your complaint {c.tracking_id} could not be verified at screening. You may submit an appeal.",
                          "review", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)

    elif a == "investigate":
        if not has_perm(user, "complaint:review"):
            _deny()
        need(c.screening_status == "Verified" and c.status in ("Assigned", "Under Investigation"),
             "Only verified, assigned complaints can be moved to investigation.", 409)
        _set_status(db, user, c, "Under Investigation", body.note, ip)

    elif a == "resolve":
        if not has_perm(user, "complaint:review"):
            _deny()
        need(c.screening_status == "Verified", "Only verified complaints can be resolved.", 409)
        need(c.status in ("Assigned", "Under Investigation"), "This complaint is not open for resolution.", 409)
        need(len(text) >= 10, "Enter the resolution details (at least 10 characters).")
        c.resolution, c.resolved_by, c.resolved_at = text, user.user_id, datetime.now(timezone.utc)
        _set_status(db, user, c, "Resolved", text[:200], ip)
        notify.notify(db, [c.citizen_id], "Citizen complaint",
                      f"Your complaint {c.tracking_id} has been resolved. Please review the resolution and give your feedback.",
                      "action", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)

    elif a == "close":
        if not has_perm(user, "complaint:review"):
            _deny()
        need(c.status in ("Resolved", "Rejected"), "Only resolved or rejected complaints can be closed.", 409)
        need(c.appeal_status != "Pending", "An appeal is pending - it must be decided first.", 409)
        _set_status(db, user, c, "Closed", body.note or "Closed by officer", ip)

    elif a == "decide_appeal":
        if not has_perm(user, "complaint:appeal_decide"):
            _deny()
        need(c.status == "Appealed" and c.appeal_status == "Pending", "There is no pending appeal on this complaint.", 409)
        need(body.outcome in ("uphold", "reject"), "Choose to uphold or reject the appeal.")
        need(len((body.note or "").strip()) >= 5, "Add a note explaining the appeal decision.")
        c.appeal_decision_note = body.note.strip()
        if body.outcome == "uphold":
            c.appeal_status = "Upheld"
            c.screening_status = "Verified"
            log_audit(db, user, "Appeal", "Complaint", c.tracking_id, project_id=c.project_id,
                      previous={"appeal_status": "Pending"}, new={"appeal_status": "Upheld"}, reason=c.appeal_decision_note, ip=ip)
            _set_status(db, user, c, "Under Investigation", "Appeal upheld - complaint reopened", ip)
            notify.notify(db, notify.officers(db), "Citizen complaint",
                          f"Appeal upheld by Head Officer: complaint {c.tracking_id} on {pcode} is reopened for investigation.",
                          "action", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)
            if proj:
                notify.notify(db, notify.project_agency_users(db, proj), "Citizen complaint",
                              f"Complaint {c.tracking_id} on {pcode} was reopened after appeal.", "action", project_id=proj.project_id)
        else:
            c.appeal_status = "Rejected"
            log_audit(db, user, "Appeal", "Complaint", c.tracking_id, project_id=c.project_id,
                      previous={"appeal_status": "Pending"}, new={"appeal_status": "Rejected"}, reason=c.appeal_decision_note, ip=ip)
            _set_status(db, user, c, "Closed", "Appeal rejected", ip)
        notify.notify(db, [c.citizen_id], "Citizen complaint",
                      f"Your appeal on complaint {c.tracking_id} has been {'upheld - the complaint is reopened' if body.outcome == 'uphold' else 'reviewed and closed'}.",
                      "info", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)

    # -------------------------------------------------- implementing agency
    elif a == "respond":
        if not has_perm(user, "complaint:respond"):
            _deny()
        need(c.status in ("Assigned", "Under Investigation"), "This complaint is not open for a response.", 409)
        need(len(text) >= 10, "Enter your response (at least 10 characters).")
        c.response, c.responded_by, c.responded_at = text, user.user_id, datetime.now(timezone.utc)
        log_audit(db, user, "Agency Response", "Complaint", c.tracking_id, project_id=c.project_id,
                  new={"response": text[:300]}, reason="Agency response to citizen complaint", ip=ip)
        if c.status == "Assigned":
            _set_status(db, user, c, "Under Investigation", "Agency responded", ip)
        notify.notify(db, notify.officers(db), "Citizen complaint",
                      f"Agency responded to complaint {c.tracking_id} on {pcode}. Review and resolve.", "action",
                      project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)

    # -------------------------------------------------- citizen
    elif a == "feedback":
        if user.role != P.CITIZEN or not has_perm(user, "complaint:submit"):
            _deny()
        need(c.status == "Resolved", "Feedback can be given once the complaint is resolved.", 409)
        need(c.feedback_satisfied is None, "You have already given feedback.", 409)
        need(body.satisfied is not None, "Please say whether you are satisfied with the resolution.")
        c.feedback_satisfied, c.feedback_rating, c.feedback_comment = body.satisfied, body.rating, text or None
        log_audit(db, user, "Complaint", "Complaint", c.tracking_id, project_id=c.project_id,
                  new={"feedback_satisfied": body.satisfied, "rating": body.rating}, reason="Citizen resolution feedback", ip=ip)
        if body.satisfied:
            _set_status(db, user, c, "Closed", "Citizen satisfied with resolution", ip)
        else:
            notify.notify(db, notify.officers(db), "Citizen complaint",
                          f"Citizen is not satisfied with the resolution of {c.tracking_id} on {pcode}. An appeal may follow.",
                          "review", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)

    elif a == "appeal":
        if user.role != P.CITIZEN or not has_perm(user, "complaint:submit"):
            _deny()
        allowed = (c.status == "Resolved" and c.feedback_satisfied is False) or c.status == "Rejected"
        need(allowed, "An appeal can be filed after an unsatisfactory resolution or a rejected complaint.", 409)
        need(c.appeal_status == "None", "An appeal has already been filed.", 409)
        need(len(text) >= 10, "Explain why you are appealing (at least 10 characters).")
        c.appeal, c.appeal_status = text, "Pending"
        log_audit(db, user, "Appeal", "Complaint", c.tracking_id, project_id=c.project_id,
                  new={"appeal": text[:300]}, reason="Citizen appeal filed", ip=ip)
        _set_status(db, user, c, "Appealed", "Citizen filed an appeal", ip)
        notify.notify(db, notify.head_officers(db), "Supervisory review",
                      f"Appeal requires review: complaint {c.tracking_id} on {pcode}.", "action",
                      project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id)
    else:
        raise HTTPException(422, "Unknown action.")

    db.commit()
    return _view(db, user, c)
