"""Implementing-agency workflows: progress reports, extension / budget requests, clarifications."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm, require
from ..models import AgencyRequest, Clarification, OfficerWarning, Project, ProgressReport, User
from ..schemas import AgencyRequestIn, ClarificationIn, ClarificationRespondIn, ProgressReportIn, RequestDecisionIn
from ..services import notify, serializers as S
from ..services.audit import log_audit
from ..services.stats import compute_delay_days, refresh_agency_stats
from .common import names, own_agency_project_or_404, project_or_404

router = APIRouter(tags=["agency"])


# ---------------------------------------------------------------- progress reports
@router.post("/api/projects/{project_id}/progress-reports", status_code=201)
def submit_progress_report(project_id: int, body: ProgressReportIn, request: Request,
                           user: User = Depends(require("project:update_progress")), db: Session = Depends(get_db)):
    p = own_agency_project_or_404(db, user, project_id)
    if p.verification_status != "Verified":
        raise HTTPException(409, "Project is not verified yet.")
    if body.progress < (p.progress or 0):
        raise HTTPException(422, f"Progress cannot be lower than the recorded {p.progress:g}%. Contact the officer to correct a wrong entry.")
    if Decimal(str(body.expenditure)) < (p.expenditure or 0):
        raise HTTPException(422, "Expenditure cannot be lower than the amount already recorded.")
    if p.sanctioned_amount and Decimal(str(body.expenditure)) > p.sanctioned_amount:
        raise HTTPException(422, "Expenditure cannot exceed the sanctioned amount. Submit a budget-change request instead.")
    if body.expenditure > float(p.released_amount or 0) and p.released_amount:
        raise HTTPException(422, "Expenditure exceeds the funds released so far. Clarify with the officer before reporting.")
    if (body.progress - (p.progress or 0)) > 0 and (p.delay_days or 0) > 0 and not (body.delay_explanation or body.reason_for_delay or "").strip():
        raise HTTPException(422, "This project is delayed - please include a delay explanation with the report.")

    today = date.today()
    prev = {"progress": p.progress, "expenditure": float(p.expenditure or 0), "delay_days": p.delay_days}
    delta_prog = round(body.progress - (p.progress or 0), 1)
    rep = ProgressReport(
        project_id=p.project_id, agency_id=p.agency_id, submitted_by=user.user_id,
        period_label=body.period_label or f"Week {today.isocalendar()[1]}, {today.year}",
        reporting_week=body.reporting_week or f"Week {today.isocalendar()[1]}",
        report_date=today,
        progress=body.progress, planned_progress=p.planned_progress,
        progress_change=body.progress_change if body.progress_change is not None else delta_prog,
        expenditure=Decimal(str(body.expenditure)),
        delay_days=body.delay_days if body.delay_days is not None else p.delay_days,
        reason_for_delay=body.reason_for_delay or body.delay_explanation,
        milestones_completed=body.milestones_completed or [],
        issues=body.issues, corrective_action=body.corrective_action, next_week_plan=body.next_week_plan,
        evidence=body.evidence or [],
        delay_explanation=body.delay_explanation or body.reason_for_delay,
        notes=body.notes,
    )
    db.add(rep)
    p.progress = body.progress
    p.expenditure = Decimal(str(body.expenditure))
    p.remaining_amount = max(Decimal(0), (p.sanctioned_amount or 0) - p.expenditure)
    if body.progress >= 100 and not p.completion_date:
        p.completion_date = today
    p.delay_days = compute_delay_days(p.deadline, today, p.completion_date) if p.deadline else p.delay_days
    p.as_of_date = today

    # Resolve any active missing-report warnings
    for w in db.execute(select(OfficerWarning).where(
        OfficerWarning.project_id == p.project_id,
        OfficerWarning.warning_type == "Weekly Report Missing",
        OfficerWarning.status == "Active"
    )).scalars():
        w.status = "Resolved"
        w.resolved_at = datetime.now(timezone.utc)

    db.flush()
    log_audit(db, user, "Progress Update", "Project", p.project_code, project_id=p.project_id, previous=prev,
              new={"progress": p.progress, "expenditure": float(p.expenditure), "delay_days": p.delay_days,
                   "reporting_week": rep.reporting_week, "report_id": rep.report_id},
              reason=(body.delay_explanation or body.reason_for_delay or body.notes or "Weekly agency progress report"),
              ip=client_ip(request))
    refresh_agency_stats(db, p.agency_id)
    recipients = notify.officers(db) + notify.project_mp_users(db, p)
    notify.notify(db, recipients, "Weekly progress report",
                  f"{user.name} submitted weekly report ({rep.reporting_week}) for {p.project_code}: {p.progress:g}% complete, "
                  f"expenditure Rs {float(p.expenditure) / 100000:.1f} lakh.", "info", project_id=p.project_id,
                  entity_type="ProgressReport", entity_id=rep.report_id)
    db.commit()
    return S.progress_report(rep)


@router.post("/api/warnings/{warning_id}/acknowledge")
def acknowledge_warning(warning_id: int, request: Request,
                          user: User = Depends(require("project:update_progress")), db: Session = Depends(get_db)):
    w = db.get(OfficerWarning, warning_id)
    if not w or w.agency_id != user.agency_id:
        raise HTTPException(404, "Warning not found.")
    w.status = "Acknowledged"
    log_audit(db, user, "Warning Acknowledged", "OfficerWarning", w.warning_id, project_id=w.project_id,
              new={"status": "Acknowledged"}, ip=client_ip(request))
    db.commit()
    return {"message": "Warning acknowledged."}


@router.get("/api/progress-reports")
def list_all_progress_reports(
    project_id: int | None = None, agency_id: int | None = None, reporting_week: str | None = None,
    page: int = 1, page_size: int = 50,
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role == P.CITIZEN:
        raise HTTPException(403, "You do not have permission to perform this action.")
    stmt = select(ProgressReport, Project).join(Project, Project.project_id == ProgressReport.project_id)
    if user.role == P.AGENCY:
        stmt = stmt.where(Project.agency_id == user.agency_id)
    if project_id:
        stmt = stmt.where(ProgressReport.project_id == project_id)
    if agency_id and user.role in (P.OFFICER, P.HEAD, P.MP):
        stmt = stmt.where(Project.agency_id == agency_id)
    if reporting_week:
        stmt = stmt.where(ProgressReport.reporting_week == reporting_week)
    stmt = stmt.order_by(ProgressReport.report_date.desc(), ProgressReport.report_id.desc())
    offset = (max(1, page) - 1) * page_size
    rows = db.execute(stmt.offset(offset).limit(page_size)).all()
    items = []
    for rep, proj in rows:
        d = S.progress_report(rep)
        d["project_code"] = proj.project_code
        d["project_name"] = proj.name
        d["agency_name"] = proj.agency.name if proj.agency else None
        items.append(d)
    return {"items": items, "page": page}


@router.get("/api/projects/{project_id}/progress-reports")
def list_progress_reports(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == P.AGENCY:
        own_agency_project_or_404(db, user, project_id)
    elif not has_perm(user, "project:view_all"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    rows = db.execute(select(ProgressReport).where(ProgressReport.project_id == project_id)
                      .order_by(ProgressReport.report_date.desc(), ProgressReport.report_id.desc())).scalars().all()
    return [S.progress_report(r) for r in rows]


# ---------------------------------------------------------------- extension / budget requests
@router.post("/api/projects/{project_id}/requests", status_code=201)
def submit_request(project_id: int, body: AgencyRequestIn, request: Request,
                   user: User = Depends(require("request:submit")), db: Session = Depends(get_db)):
    p = own_agency_project_or_404(db, user, project_id)
    if body.request_type == "Extension":
        if not body.requested_deadline:
            raise HTTPException(422, "Enter the new requested deadline.")
        current = p.revised_deadline or p.deadline
        if current and body.requested_deadline <= current:
            raise HTTPException(422, f"Requested deadline must be after the current deadline ({current}).")
    else:
        if not body.requested_amount:
            raise HTTPException(422, "Enter the requested revised amount.")
        if p.sanctioned_amount and Decimal(str(body.requested_amount)) == p.sanctioned_amount:
            raise HTTPException(422, "Requested amount equals the current sanctioned amount.")
    pending = db.scalar(select(func.count()).select_from(AgencyRequest).where(
        AgencyRequest.project_id == p.project_id, AgencyRequest.request_type == body.request_type,
        AgencyRequest.status == "Pending"))
    if pending:
        raise HTTPException(409, f"A {body.request_type.lower()} request for this project is already pending.")
    r = AgencyRequest(project_id=p.project_id, agency_id=p.agency_id, request_type=body.request_type,
                      requested_deadline=body.requested_deadline if body.request_type == "Extension" else None,
                      requested_amount=Decimal(str(body.requested_amount)) if body.request_type == "Budget Change" else None,
                      justification=body.justification.strip(), submitted_by=user.user_id)
    db.add(r)
    if body.request_type == "Extension":
        p.extension_requests = (p.extension_requests or 0) + 1
    db.flush()
    log_audit(db, user, "Agency Request", "AgencyRequest", r.request_id, project_id=p.project_id,
              new={"type": body.request_type, "requested_deadline": r.requested_deadline,
                   "requested_amount": float(r.requested_amount) if r.requested_amount else None,
                   "extension_requests": p.extension_requests}, reason=body.justification[:300], ip=client_ip(request))
    notify.notify(db, notify.officers(db), "Agency clarification",
                  f"{body.request_type} request submitted for {p.project_code} by {user.name}. Review required.",
                  "action", project_id=p.project_id, entity_type="AgencyRequest", entity_id=r.request_id)
    db.commit()
    return S.agency_request(r, p)


@router.get("/api/requests")
def list_requests(status: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(AgencyRequest, Project).join(Project, Project.project_id == AgencyRequest.project_id)
    if user.role == P.AGENCY:
        stmt = stmt.where(AgencyRequest.agency_id == user.agency_id)
    elif not has_perm(user, "request:review") and not has_perm(user, "request:view"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    if status:
        stmt = stmt.where(AgencyRequest.status == status)
    rows = db.execute(stmt.order_by(AgencyRequest.created_at.desc()).limit(200)).all()
    return [S.agency_request(r, p) for r, p in rows]


@router.put("/api/requests/{request_id}")
def decide_request(request_id: int, body: RequestDecisionIn, request: Request,
                   user: User = Depends(require("request:review")), db: Session = Depends(get_db)):
    r = db.get(AgencyRequest, request_id)
    if not r:
        raise HTTPException(404, "Request not found.")
    if r.status != "Pending":
        raise HTTPException(409, "This request has already been decided.")
    p = project_or_404(db, r.project_id)
    prev = {"status": "Pending", "revised_deadline": p.revised_deadline, "sanctioned_amount": float(p.sanctioned_amount or 0),
            "budget_revisions": p.budget_revisions}
    r.status = "Approved" if body.decision == "Approve" else "Rejected"
    r.decided_by, r.decision_note, r.decided_at = user.user_id, body.note.strip(), datetime.now(timezone.utc)
    if r.status == "Approved":
        if r.request_type == "Extension" and r.requested_deadline:
            p.revised_deadline = r.requested_deadline
        elif r.request_type == "Budget Change" and r.requested_amount:
            p.sanctioned_amount = r.requested_amount
            p.remaining_amount = max(Decimal(0), r.requested_amount - (p.expenditure or 0))
            p.budget_revisions = (p.budget_revisions or 0) + 1
    log_audit(db, user, "Agency Request Decision", "AgencyRequest", r.request_id, project_id=p.project_id, previous=prev,
              new={"status": r.status, "revised_deadline": p.revised_deadline, "sanctioned_amount": float(p.sanctioned_amount or 0),
                   "budget_revisions": p.budget_revisions}, reason=r.decision_note, ip=client_ip(request))
    notify.notify(db, notify.agency_users(db, r.agency_id), "Decision completed",
                  f"Your {r.request_type.lower()} request for {p.project_code} was {r.status.lower()}: {r.decision_note[:160]}",
                  "info", project_id=p.project_id, entity_type="AgencyRequest", entity_id=r.request_id)
    db.commit()
    return S.agency_request(r, p)


# ---------------------------------------------------------------- clarifications
@router.get("/api/clarifications")
def list_clarifications(status: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Clarification, Project).join(Project, Project.project_id == Clarification.project_id)
    if user.role == P.AGENCY:
        stmt = stmt.where(Clarification.agency_id == user.agency_id)
    elif not has_perm(user, "clarification:request"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    if status:
        stmt = stmt.where(Clarification.status == status)
    rows = db.execute(stmt.order_by(Clarification.created_at.desc()).limit(200)).all()
    nm = names(db, {c.requested_by for c, _ in rows})
    return [S.clarification(c, p, User(name=nm.get(c.requested_by))) for c, p in rows]


@router.post("/api/clarifications", status_code=201)
def request_clarification(body: ClarificationIn, request: Request, user: User = Depends(require("clarification:request")),
                          db: Session = Depends(get_db)):
    p = project_or_404(db, body.project_id)
    if not p.agency_id:
        raise HTTPException(422, "Project has no implementing agency.")
    c = Clarification(project_id=p.project_id, agency_id=p.agency_id, requested_by=user.user_id,
                      question=body.question.strip(), due_date=body.due_date)
    db.add(c)
    db.flush()
    log_audit(db, user, "Clarification Requested", "Clarification", c.clarification_id, project_id=p.project_id,
              new={"question": c.question[:300], "due_date": c.due_date}, ip=client_ip(request))
    notify.notify(db, notify.project_agency_users(db, p), "Agency clarification",
                  f"Clarification requested for {p.project_code}: {c.question[:200]}", "action",
                  project_id=p.project_id, entity_type="Clarification", entity_id=c.clarification_id)
    db.commit()
    return S.clarification(c, p, user)


@router.put("/api/clarifications/{clarification_id}/respond")
def respond_clarification(clarification_id: int, body: ClarificationRespondIn, request: Request,
                          user: User = Depends(require("clarification:respond")), db: Session = Depends(get_db)):
    c = db.get(Clarification, clarification_id)
    if not c or c.agency_id != user.agency_id:
        raise HTTPException(404, "Clarification not found.")
    if c.status != "Open":
        raise HTTPException(409, "This clarification has already been answered.")
    p = project_or_404(db, c.project_id)
    c.response, c.responded_by, c.status = body.response.strip(), user.user_id, "Responded"
    c.responded_at = datetime.now(timezone.utc)
    prev_status = p.status
    still_open = db.scalar(select(func.count()).select_from(Clarification).where(
        Clarification.project_id == p.project_id, Clarification.status == "Open", Clarification.clarification_id != c.clarification_id))
    if p.status == "Clarification Requested" and not still_open:
        p.status = "Officer Review Required"
    log_audit(db, user, "Agency Response", "Clarification", c.clarification_id, project_id=p.project_id,
              previous={"status": "Open"}, new={"status": "Responded", "response": c.response[:300]},
              reason="Agency response to officer clarification", ip=client_ip(request))
    if prev_status != p.status:
        log_audit(db, user, "Status Change", "Project", p.project_code, project_id=p.project_id,
                  previous={"status": prev_status}, new={"status": p.status}, reason="Agency responded to clarification",
                  ip=client_ip(request))
    notify.notify(db, notify.officers(db), "Agency clarification",
                  f"Agency responded to the clarification on {p.project_code}. Review the response.", "action",
                  project_id=p.project_id, entity_type="Clarification", entity_id=c.clarification_id)
    db.commit()
    return S.clarification(c, p, db.get(User, c.requested_by))
