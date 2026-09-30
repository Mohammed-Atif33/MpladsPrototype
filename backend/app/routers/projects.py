from datetime import datetime, timezone
import secrets
import string
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm, require
from ..models import (Agency, AgencyRequest, Clarification, Complaint, Decision, Document, Inspection,
                      OfficerWarning, Payment, Project, ProjectAssignmentHistory, ProgressReport, Review, RiskAnalysis, User)
from ..schemas import MPProjectCreateIn, ProjectReassignIn, ReviewIn, ReviewModerateIn, WarningCreateIn
from ..services import risk_service, serializers as S
from ..services import notify
from ..services.audit import log_audit
from ..services.stats import compute_agency_stats, latest_risk_map
from .common import names, page_params, visible_project_or_404

router = APIRouter(prefix="/api/projects", tags=["projects"])

DISTRICT_CODES = {
    "Pune": "PN", "Pimpri-Chinchwad": "PC", "Satara": "ST",
    "Kolhapur": "KP", "Nashik": "NS"
}


def generate_random_project_id(db: Session, district: str) -> str:
    dist_code = DISTRICT_CODES.get(district, "PN")
    chars = string.ascii_uppercase + string.digits
    for _ in range(30):
        token = "".join(secrets.choice(chars) for _ in range(6))
        code = f"MPLADS-{dist_code}-{token}"
        if not db.scalar(select(Project.project_id).where(Project.project_code == code)):
            return code
    raise RuntimeError("Unable to generate unique project ID")


def _timeline(p: Project) -> list[dict]:
    items = [("Sanctioned", p.sanction_date), ("Work started", p.start_date), ("Original deadline", p.deadline),
             ("Revised deadline", p.revised_deadline), ("Completed", p.completion_date)]
    return [{"label": l, "date": S.iso(d)} for l, d in items if d]


def _rating_stats(db: Session, ids: list[int]) -> dict[int, tuple[float, int]]:
    if not ids:
        return {}
    rows = db.execute(select(Review.project_id, func.avg(Review.rating), func.count()).where(
        Review.project_id.in_(ids), Review.status == "Approved").group_by(Review.project_id)).all()
    return {r[0]: (round(float(r[1]), 1), r[2]) for r in rows}


@router.get("")
def list_projects(
    q: str | None = None, category: str | None = None, district: str | None = None, agency_id: int | None = None,
    status: str | None = None, risk_level: str | None = None, progress_min: float | None = None,
    progress_max: float | None = None, sort: str = "name", order: str = "asc", scope: str = "live",
    page: int = 1, page_size: int = 20, user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    if user.role == P.CITIZEN and has_perm(user, "project:view_public"):
        pass
    elif user.role == P.AGENCY and has_perm(user, "project:view_assigned"):
        pass
    elif has_perm(user, "project:view_all"):
        pass
    else:
        raise HTTPException(403, "You do not have permission to perform this action.")

    stmt = select(Project).where(Project.verification_status == "Verified")
    if user.role == P.CITIZEN:
        stmt = stmt.where(Project.is_public.is_(True))
    elif user.role == P.AGENCY:
        stmt = stmt.where(Project.agency_id == user.agency_id)
    if scope != "all" and user.role != P.CITIZEN:
        stmt = stmt.where(Project.is_historical.is_(False))

    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Project.name.ilike(like), Project.project_code.ilike(like), Project.location.ilike(like),
                              Project.description.ilike(like)))
    if category:
        stmt = stmt.where(Project.category == category)
    if district:
        stmt = stmt.where(Project.district == district)
    if agency_id and user.role in (P.OFFICER, P.HEAD, P.CITIZEN, P.MP):
        stmt = stmt.where(Project.agency_id == agency_id)
    if progress_min is not None:
        stmt = stmt.where(Project.progress >= progress_min)
    if progress_max is not None:
        stmt = stmt.where(Project.progress <= progress_max)
    completed = or_(Project.completion_date.is_not(None), Project.progress >= 100)
    if status:
        if user.role == P.CITIZEN or status in ("Completed", "Delayed", "On track"):
            if status == "Completed":
                stmt = stmt.where(completed)
            elif status == "Delayed":
                stmt = stmt.where(and_(~completed, Project.delay_days > 0))
            elif status == "On track":
                stmt = stmt.where(and_(~completed, Project.delay_days <= 0))
        elif user.role in (P.OFFICER, P.HEAD, P.MP):
            stmt = stmt.where(Project.status == status)

    internal = user.role in (P.OFFICER, P.HEAD, P.MP)
    can_filter_risk = internal or (user.role == P.CITIZEN and has_perm(user, "project:view_public"))
    if can_filter_risk:
        latest = select(RiskAnalysis.project_id.label("pid"), func.max(RiskAnalysis.risk_id).label("rid")).group_by(
            RiskAnalysis.project_id).subquery()
        stmt = stmt.outerjoin(latest, latest.c.pid == Project.project_id).outerjoin(
            RiskAnalysis, RiskAnalysis.risk_id == latest.c.rid)
        if risk_level:
            stmt = stmt.where(RiskAnalysis.risk_level == risk_level)
    elif risk_level:
        raise HTTPException(403, "You do not have permission to perform this action.")

    sort_cols = {"name": Project.name, "progress": Project.progress, "delay_days": Project.delay_days,
                 "sanctioned_amount": Project.sanctioned_amount, "created_at": Project.created_at,
                 "project_code": Project.project_code}
    if sort == "risk_score" and can_filter_risk:
        col = RiskAnalysis.risk_score
    else:
        col = sort_cols.get(sort, Project.name)
    stmt = stmt.order_by(col.desc().nulls_last() if order == "desc" else col.asc().nulls_last(), Project.project_id)

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    offset, limit = page_params(page, page_size)
    rows = db.execute(stmt.offset(offset).limit(limit)).scalars().all()
    ids = [p.project_id for p in rows]

    if internal:
        lr = latest_risk_map(db, ids)
        items = [S.project_internal(p, lr.get(p.project_id)) for p in rows]
    elif user.role == P.AGENCY:
        items = [S.project_agency(p) for p in rows]
    else:
        lr = latest_risk_map(db, ids)
        rs = _rating_stats(db, ids)
        officer_ids = {p.officer_id for p in rows if p.officer_id}
        agency_ids = {p.agency_id for p in rows if p.agency_id}
        u_names = names(db, officer_ids)
        ag_map = {a.agency_id: a.name for a in db.execute(select(Agency).where(Agency.agency_id.in_(agency_ids))).scalars().all()} if agency_ids else {}
        items = []
        for p in rows:
            off_name = (p.officer.name if getattr(p, "officer", None) else None) or u_names.get(p.officer_id)
            ag_name = (p.agency.name if getattr(p, "agency", None) else None) or ag_map.get(p.agency_id)
            items.append(S.project_public(p, *rs.get(p.project_id, (None, 0)), latest_risk=lr.get(p.project_id),
                                          officer_name_override=off_name, agency_name_override=ag_name))
    return {"items": items, "total": total or 0, "page": page, "page_size": limit}


@router.post("", status_code=201)
def create_project_mp(
    body: MPProjectCreateIn, request: Request,
    user: User = Depends(require("project:create_mp")),
    db: Session = Depends(get_db)
):
    agency = db.get(Agency, body.agency_id)
    if not agency:
        raise HTTPException(404, "Selected implementing agency not found.")
    officer = db.get(User, body.officer_id)
    if not officer or officer.role != P.OFFICER or officer.status != "Active":
        raise HTTPException(404, "Selected monitoring officer not found or not active.")
    if body.deadline < body.start_date:
        raise HTTPException(422, "Expected completion date cannot be earlier than start date.")

    code = generate_random_project_id(db, body.district)
    duration = body.expected_days or max(1, (body.deadline - body.start_date).days)
    sanctioned = Decimal(str(round(body.sanctioned_amount, 2)))
    approved = Decimal(str(round(body.approved_budget, 2))) if body.approved_budget else sanctioned
    released = Decimal(str(round(body.released_amount, 2)))
    expenditure = Decimal(str(round(body.current_expenditure or 0.0, 2)))
    remaining = max(Decimal(0), sanctioned - expenditure)

    project = Project(
        project_code=code,
        name=body.name.strip(),
        category=body.category.strip(),
        type=body.type.strip() if body.type else None,
        description=body.description.strip() if body.description else None,
        location=body.location.strip(),
        district=body.district.strip(),
        constituency=body.constituency.strip(),
        agency_id=body.agency_id,
        officer_id=body.officer_id,
        mp_id=user.user_id,
        sanction_date=body.start_date,
        sanctioned_amount=sanctioned,
        approved_budget=approved,
        released_amount=released,
        expenditure=expenditure,
        remaining_amount=remaining,
        progress=0.0,
        planned_progress=0.0,
        start_date=body.start_date,
        deadline=body.deadline,
        expected_days=duration,
        delay_days=0,
        budget_revisions=0,
        extension_requests=0,
        status="Verified - Analysis Pending",
        verification_status="Verified",
        is_public=True,
        is_historical=False,
        created_by=user.user_id,
        verified_by=user.user_id,
        verified_at=datetime.now(timezone.utc),
    )
    db.add(project)
    db.flush()

    if body.supporting_doc_ids:
        for doc in db.execute(select(Document).where(Document.document_id.in_(body.supporting_doc_ids))).scalars():
            doc.project_id = project.project_id

    assign_hist = ProjectAssignmentHistory(
        project_id=project.project_id,
        previous_agency_id=None,
        new_agency_id=agency.agency_id,
        previous_officer_id=None,
        new_officer_id=officer.user_id,
        changed_by=user.user_id,
        reason="Initial project assignment by MP upon creation",
    )
    db.add(assign_hist)
    db.flush()

    log_audit(db, user, "Project Created", "Project", code, project_id=project.project_id,
              new={"project_code": code, "name": project.name, "agency": agency.name, "officer": officer.name},
              reason="Manual project creation by MP", ip=client_ip(request))

    notify.notify(db, notify.agency_users(db, agency.agency_id), "Project Assigned",
                  f"New project {code} ({project.name}) assigned to your agency by {user.name}.",
                  "action", project_id=project.project_id, entity_type="Project", entity_id=project.project_id)
    notify.notify(db, [officer.user_id], "Project Assigned",
                  f"You have been assigned as monitoring officer for new project {code} ({project.name}) by {user.name}.",
                  "info", project_id=project.project_id, entity_type="Project", entity_id=project.project_id)

    db.commit()
    return S.project_internal(project)


@router.post("/{project_id}/reassign")
def reassign_project(
    project_id: int, body: ProjectReassignIn, request: Request,
    user: User = Depends(require("project:assign_mp")),
    db: Session = Depends(get_db)
):
    p = visible_project_or_404(db, user, project_id)
    prev_agency_id = p.agency_id
    prev_officer_id = p.officer_id
    new_agency = None
    new_officer = None

    if body.agency_id and body.agency_id != prev_agency_id:
        new_agency = db.get(Agency, body.agency_id)
        if not new_agency:
            raise HTTPException(404, "Selected agency not found.")
        p.agency_id = new_agency.agency_id

    if body.officer_id and body.officer_id != prev_officer_id:
        new_officer = db.get(User, body.officer_id)
        if not new_officer or new_officer.role != P.OFFICER or new_officer.status != "Active":
            raise HTTPException(404, "Selected monitoring officer not found or not active.")
        p.officer_id = new_officer.user_id

    if not new_agency and not new_officer:
        raise HTTPException(400, "No changes specified for agency or officer.")

    hist = ProjectAssignmentHistory(
        project_id=p.project_id,
        previous_agency_id=prev_agency_id if new_agency else None,
        new_agency_id=p.agency_id if new_agency else None,
        previous_officer_id=prev_officer_id if new_officer else None,
        new_officer_id=p.officer_id if new_officer else None,
        changed_by=user.user_id,
        reason=body.reason.strip(),
    )
    db.add(hist)
    db.flush()

    log_audit(db, user, "Project Reassigned", "Project", p.project_code, project_id=p.project_id,
              previous={"agency_id": prev_agency_id, "officer_id": prev_officer_id},
              new={"agency_id": p.agency_id, "officer_id": p.officer_id},
              reason=body.reason, ip=client_ip(request))

    if new_agency:
        notify.notify(db, notify.agency_users(db, new_agency.agency_id), "Project Reassigned",
                      f"Project {p.project_code} ({p.name}) reassigned to your agency. Reason: {body.reason}",
                      "action", project_id=p.project_id)
    if new_officer:
        notify.notify(db, [new_officer.user_id], "Project Reassigned",
                      f"You have been assigned as monitoring officer for {p.project_code} ({p.name}). Reason: {body.reason}",
                      "info", project_id=p.project_id)

    db.commit()
    return {"message": "Project assignment updated successfully.", "history": S.project_assignment_history(hist)}


@router.get("/assignments-overview")
def get_all_assignments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not has_perm(user, "project:view_all"):
        raise HTTPException(403, "You do not have permission to perform this action.")
    projects = db.execute(
        select(Project).where(Project.verification_status == "Verified", Project.is_historical.is_(False))
        .order_by(Project.name)
    ).scalars().all()
    recent_history = db.execute(
        select(ProjectAssignmentHistory)
        .order_by(ProjectAssignmentHistory.created_at.desc())
        .limit(50)
    ).scalars().all()

    items = []
    for p in projects:
        items.append({
            "project_id": p.project_id,
            "project_code": p.project_code,
            "name": p.name,
            "category": p.category,
            "district": p.district,
            "agency_id": p.agency_id,
            "agency_name": p.agency.name if p.agency else None,
            "officer_id": p.officer_id,
            "officer_name": p.officer.name if p.officer else None,
            "status": p.status,
            "progress": p.progress,
            "delay_days": p.delay_days,
            "sanctioned_amount": float(p.sanctioned_amount or 0),
        })
    return {
        "projects": items,
        "recent_history": [S.project_assignment_history(h) for h in recent_history],
    }


@router.get("/{project_id}/assignments")
def get_assignments(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    rows = db.execute(
        select(ProjectAssignmentHistory).where(ProjectAssignmentHistory.project_id == p.project_id)
        .order_by(ProjectAssignmentHistory.created_at.desc())
    ).scalars().all()
    return [S.project_assignment_history(h) for h in rows]


@router.post("/{project_id}/warnings", status_code=201)
def issue_warning(
    project_id: int, body: WarningCreateIn, request: Request,
    user: User = Depends(require("warning:issue")),
    db: Session = Depends(get_db)
):
    p = visible_project_or_404(db, user, project_id)
    warn = OfficerWarning(
        project_id=p.project_id,
        agency_id=p.agency_id,
        issued_by=user.user_id,
        warning_type=body.warning_type,
        severity=body.severity,
        message=body.message.strip(),
        status="Active",
    )
    db.add(warn)
    db.flush()

    log_audit(db, user, "Warning Issued", "OfficerWarning", warn.warning_id, project_id=p.project_id,
              new={"type": body.warning_type, "severity": body.severity, "message": body.message},
              reason="Officer issued formal warning", ip=client_ip(request))

    notify.notify(db, notify.project_agency_users(db, p) + notify.project_mp_users(db, p), "Warning Issued",
                  f"Warning issued for {p.project_code} ({body.warning_type}): {body.message[:160]}",
                  "critical" if body.severity == "Urgent" else "action",
                  project_id=p.project_id, entity_type="OfficerWarning", entity_id=warn.warning_id)

    db.commit()
    return S.officer_warning(warn)


@router.get("/{project_id}/warnings")
def list_warnings(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    rows = db.execute(
        select(OfficerWarning).where(OfficerWarning.project_id == p.project_id)
        .order_by(OfficerWarning.created_at.desc())
    ).scalars().all()
    return [S.officer_warning(w) for w in rows]


@router.get("/{project_id}")
def project_detail(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)

    if user.role == P.CITIZEN:
        latest = db.execute(
            select(RiskAnalysis)
            .where(RiskAnalysis.project_id == p.project_id)
            .order_by(RiskAnalysis.timestamp.desc(), RiskAnalysis.risk_id.desc())
        ).scalars().first()
        rs = _rating_stats(db, [p.project_id]).get(p.project_id, (None, 0))

        # Robust officer resolution
        officer_name = None
        if p.officer:
            officer_name = p.officer.name
        elif p.officer_id:
            u = db.get(User, p.officer_id)
            if u:
                officer_name = u.name
        if not officer_name:
            hist = db.execute(
                select(ProjectAssignmentHistory)
                .where(ProjectAssignmentHistory.project_id == p.project_id, ProjectAssignmentHistory.new_officer_id.is_not(None))
                .order_by(ProjectAssignmentHistory.created_at.desc(), ProjectAssignmentHistory.history_id.desc())
            ).scalars().first()
            if hist and hist.new_officer_id:
                u = db.get(User, hist.new_officer_id)
                if u:
                    officer_name = u.name

        # Robust agency resolution
        agency_name = None
        if p.agency:
            agency_name = p.agency.name
        elif p.agency_id:
            a = db.get(Agency, p.agency_id)
            if a:
                agency_name = a.name
        if not agency_name:
            hist = db.execute(
                select(ProjectAssignmentHistory)
                .where(ProjectAssignmentHistory.project_id == p.project_id, ProjectAssignmentHistory.new_agency_id.is_not(None))
                .order_by(ProjectAssignmentHistory.created_at.desc(), ProjectAssignmentHistory.history_id.desc())
            ).scalars().first()
            if hist and hist.new_agency_id:
                a = db.get(Agency, hist.new_agency_id)
                if a:
                    agency_name = a.name

        docs = db.execute(select(Document).where(Document.project_id == p.project_id, Document.is_public.is_(True))
                          .order_by(Document.uploaded_at.desc())).scalars().all()
        approved_reviews = db.execute(
            select(Review).where(Review.project_id == p.project_id, Review.status == "Approved")
            .order_by(Review.created_at.desc())
        ).scalars().all()
        citizens = {u.user_id: u for u in db.execute(select(User).where(User.user_id.in_([r.citizen_id for r in approved_reviews] or [0]))).scalars()}
        reqs = db.execute(select(AgencyRequest).where(AgencyRequest.project_id == p.project_id)
                          .order_by(AgencyRequest.created_at.desc())).scalars().all()
        decider_ids = {r.decided_by for r in reqs if r.decided_by}
        deciders = names(db, decider_ids)
        reports = db.execute(select(ProgressReport).where(ProgressReport.project_id == p.project_id)
                             .order_by(ProgressReport.report_date.desc()).limit(12)).scalars().all()
        decisions = db.execute(select(Decision).where(Decision.project_id == p.project_id)
                               .order_by(Decision.created_at.desc())).scalars().all()
        d_names = names(db, {d.user_id for d in decisions if d.user_id})

        # Fetch public-safe inspections (Scheduled or completed states)
        insp_stmt = select(Inspection).where(
            Inspection.project_id == p.project_id,
            Inspection.status.in_(("Scheduled", "Completed", "Report Submitted", "Action Pending", "Closed"))
        ).order_by(Inspection.completed_at.desc().nullslast(), Inspection.updated_at.desc(), Inspection.inspection_id.desc())
        project_inspections = db.execute(insp_stmt).scalars().all()

        insp_user_ids = {i.assigned_to for i in project_inspections if i.assigned_to}
        insp_names = names(db, insp_user_ids)

        insp_ids = [i.inspection_id for i in project_inspections]
        insp_docs_map: dict[int, list[Document]] = {}
        if insp_ids:
            i_docs = db.execute(
                select(Document).where(
                    Document.inspection_id.in_(insp_ids),
                    or_(Document.is_public.is_(True), Document.visibility == "PUBLIC"),
                    Document.moderation_status != "REJECTED"
                ).order_by(Document.uploaded_at.asc())
            ).scalars().all()
            for doc in i_docs:
                insp_docs_map.setdefault(doc.inspection_id, []).append(doc)

        serialized_inspections = [
            S.inspection_public(i, inspector_name=insp_names.get(i.assigned_to), docs=insp_docs_map.get(i.inspection_id, []))
            for i in project_inspections
        ]

        # Complaints public-safe summary
        c_total = db.scalar(select(func.count()).select_from(Complaint).where(Complaint.project_id == p.project_id)) or 0
        c_resolved = db.scalar(select(func.count()).select_from(Complaint).where(
            Complaint.project_id == p.project_id, Complaint.status.in_(("Resolved", "Closed")))) or 0
        c_investigating = db.scalar(select(func.count()).select_from(Complaint).where(
            Complaint.project_id == p.project_id, Complaint.status.in_(("Assigned", "Under Investigation")))) or 0
        c_pending = db.scalar(select(func.count()).select_from(Complaint).where(
            Complaint.project_id == p.project_id, Complaint.screening_status == "Pending")) or 0
        complaints_summary = {
            "total": c_total,
            "resolved": c_resolved,
            "under_investigation": c_investigating,
            "pending_screening": c_pending,
            "open": max(0, c_total - c_resolved),
        }

        # Weekly report status & warning check
        active_warning = db.execute(select(OfficerWarning).where(
            OfficerWarning.project_id == p.project_id,
            OfficerWarning.status == "Active",
            OfficerWarning.warning_type.in_(("Weekly Report Missing", "Progress Update Required"))
        ).order_by(OfficerWarning.created_at.desc())).scalars().first()
        weekly_report_status = "Weekly report overdue" if active_warning else ("Submitted" if reports else "Pending initial report")

        # Unified public media
        public_media = []
        for d in docs:
            public_media.append({
                "document_id": d.document_id,
                "title": d.description or d.file_name,
                "file_name": d.file_name,
                "content_type": d.content_type,
                "source_type": d.document_type,
                "date": S.iso(d.uploaded_at),
                "is_image": (d.content_type or "").startswith("image/"),
            })
        for i_id, i_doc_list in insp_docs_map.items():
            for idoc in i_doc_list:
                public_media.append({
                    "document_id": idoc.document_id,
                    "title": idoc.description or f"Inspection Evidence #{i_id}",
                    "file_name": idoc.file_name,
                    "content_type": idoc.content_type,
                    "source_type": "Inspection Evidence",
                    "inspection_id": i_id,
                    "date": S.iso(idoc.uploaded_at),
                    "is_image": (idoc.content_type or "").startswith("image/"),
                })

        # Recent public changes (What Changed?)
        recent_changes = []
        for r in reports[:5]:
            recent_changes.append({
                "date": S.iso(r.created_at or r.report_date),
                "type": "Progress Update",
                "title": f"Reported progress updated to {r.progress:.0f}%",
                "detail": f"Expenditure reported: ₹{r.expenditure:,.0f}" if r.expenditure else "Progress report filed",
            })
        for insp in project_inspections:
            insp_dt = insp.completed_at or insp.updated_at
            if insp.status in ("Report Submitted", "Action Pending"):
                recent_changes.append({
                    "date": S.iso(insp_dt),
                    "type": "Inspection",
                    "title": f"Inspection report submitted ({insp.status})",
                    "detail": f"Outcome: {insp.outcome or 'Findings documented'}",
                })
            elif insp.status == "Closed":
                recent_changes.append({
                    "date": S.iso(insp.closed_at or insp_dt),
                    "type": "Inspection",
                    "title": "Inspection closed",
                    "detail": insp.closure_reason or f"Outcome: {insp.outcome or 'Satisfactory'}",
                })
            elif insp.status == "Scheduled":
                recent_changes.append({
                    "date": S.iso(insp.updated_at or insp.requested_at),
                    "type": "Inspection Scheduled",
                    "title": f"Inspection scheduled for {S.iso(insp.scheduled_date)}",
                    "detail": insp.reason[:100] if insp.reason else "Site inspection scheduled",
                })
        all_risks = db.execute(select(RiskAnalysis).where(RiskAnalysis.project_id == p.project_id).order_by(RiskAnalysis.timestamp.desc()).limit(3)).scalars().all()
        for ra in all_risks:
            factors = S.extract_public_safe_risk_factors(ra)
            recent_changes.append({
                "date": S.iso(ra.timestamp),
                "type": "Risk Analysis",
                "title": f"Risk assessment updated: {ra.risk_level} ({ra.risk_score:.0f}/100)",
                "detail": f"Contributing factors: {', '.join(factors[:3]) or 'Standard monitoring indicators'}",
            })
        for ar in reqs[:5]:
            if ar.decided_at:
                recent_changes.append({
                    "date": S.iso(ar.decided_at),
                    "type": "Request Decision",
                    "title": f"{ar.request_type} request {ar.status.lower()}",
                    "detail": ar.decision_note or "Decision recorded by monitoring authority",
                })
            else:
                recent_changes.append({
                    "date": S.iso(ar.created_at),
                    "type": "Agency Request",
                    "title": f"{ar.request_type} request submitted by agency",
                    "detail": ar.justification[:100] if ar.justification else "Pending review",
                })
        for d in decisions[:5]:
            recent_changes.append({
                "date": S.iso(d.created_at),
                "type": "Officer Decision",
                "title": f"Officer recorded decision: {d.decision}",
                "detail": d.reason[:120] if d.reason else "Action logged",
            })
        recent_changes.sort(key=lambda x: x["date"] or "", reverse=True)
        recent_public_changes = recent_changes[:8]

        # Timestamps of last updates
        last_insp_dt = None
        for insp in project_inspections:
            idt = insp.completed_at or insp.updated_at
            if idt and (not last_insp_dt or idt > last_insp_dt):
                last_insp_dt = idt

        last_updated = {
            "project": S.iso(p.verified_at or p.created_at),
            "financial": S.iso(reports[0].report_date if reports else (p.verified_at or p.created_at)),
            "inspection": S.iso(last_insp_dt),
            "risk_analysis": S.iso(latest.timestamp if latest else None),
            "weekly_report": S.iso(reports[0].report_date if reports else None),
            "request_or_decision": S.iso(decisions[0].created_at if decisions else (reqs[0].created_at if reqs else None)),
        }

        serialized_reports = [S.progress_report(r) for r in reports]
        serialized_requests = [S.agency_request(r, p, decided_by_name=deciders.get(r.decided_by)) for r in reqs]
        base_pub = S.project_public(p, *rs, latest_risk=latest, officer_name_override=officer_name, agency_name_override=agency_name)

        return {
            **base_pub,
            "timeline": _timeline(p),
            "documents": [S.document(d) for d in docs],
            "reviews": [S.review(r, citizens.get(r.citizen_id)) for r in approved_reviews],
            "requests": serialized_requests,
            "agency_requests": serialized_requests,
            "decisions": [S.decision(d, p, d_names) for d in decisions],
            "progress_reports": serialized_reports,
            "weekly_reports": serialized_reports,
            "weekly_report_status": weekly_report_status,
            "milestones": p.milestones or [],
            "inspections": serialized_inspections,
            "complaints_summary": complaints_summary,
            "public_media": public_media,
            "recent_public_changes": recent_public_changes,
            "last_updated": last_updated,
        }

    docs = db.execute(select(Document).where(Document.project_id == p.project_id,
                                             Document.inspection_id.is_(None), Document.complaint_id.is_(None))
                      .order_by(Document.uploaded_at.desc())).scalars().all()
    payments = db.execute(select(Payment).where(Payment.project_id == p.project_id).order_by(Payment.paid_on)).scalars().all()
    reports = db.execute(select(ProgressReport).where(ProgressReport.project_id == p.project_id)
                         .order_by(ProgressReport.report_date.desc()).limit(12)).scalars().all()
    nm = names(db, {d.uploaded_by for d in docs})

    if user.role == P.AGENCY:
        reqs = db.execute(select(AgencyRequest).where(AgencyRequest.project_id == p.project_id)
                          .order_by(AgencyRequest.created_at.desc())).scalars().all()
        open_clar = db.scalar(select(func.count()).select_from(Clarification).where(
            Clarification.project_id == p.project_id, Clarification.status == "Open")) or 0
        open_compl = db.scalar(select(func.count()).select_from(Complaint).where(
            Complaint.project_id == p.project_id, Complaint.screening_status == "Verified",
            Complaint.status.in_(("Assigned", "Under Investigation")))) or 0
        warnings = db.execute(select(OfficerWarning).where(OfficerWarning.project_id == p.project_id)
                              .order_by(OfficerWarning.created_at.desc())).scalars().all()
        return {**S.project_agency(p), "timeline": _timeline(p), "documents": [S.document(d, nm) for d in docs],
                "payments": [S.payment(x) for x in payments], "progress_reports": [S.progress_report(r) for r in reports],
                "requests": [S.agency_request(r) for r in reqs], "warnings": [S.officer_warning(w) for w in warnings],
                "open_clarifications": open_clar, "open_complaints": open_compl}

    # MP / Officer / Head Officer: full internal view
    latest = latest_risk_map(db, [p.project_id]).get(p.project_id)
    vc = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id == p.project_id, Complaint.screening_status == "Verified")) or 0
    uc = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id == p.project_id, Complaint.screening_status == "Pending")) or 0
    reqs = db.execute(select(AgencyRequest).where(AgencyRequest.project_id == p.project_id)
                      .order_by(AgencyRequest.created_at.desc())).scalars().all()
    warnings = db.execute(select(OfficerWarning).where(OfficerWarning.project_id == p.project_id)
                          .order_by(OfficerWarning.created_at.desc())).scalars().all()
    assignments = db.execute(select(ProjectAssignmentHistory).where(ProjectAssignmentHistory.project_id == p.project_id)
                             .order_by(ProjectAssignmentHistory.created_at.desc())).scalars().all()
    return {
        **S.project_internal(p, latest), "timeline": _timeline(p),
        "documents": [S.document(d, nm) for d in docs], "payments": [S.payment(x) for x in payments],
        "progress_reports": [S.progress_report(r) for r in reports],
        "requests": [S.agency_request(r) for r in reqs],
        "warnings": [S.officer_warning(w) for w in warnings],
        "assignments": [S.project_assignment_history(a) for a in assignments],
        "complaint_counts": {"verified": vc, "pending": uc},
        "agency_name": p.agency.name if p.agency else None,
        "mp_name": p.mp.name if p.mp else None,
        "officer_name": p.officer.name if p.officer else None,
    }


@router.get("/{project_id}/risk")
def project_risk(project_id: int, user: User = Depends(require("project:view_risk")), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    rows = db.execute(select(RiskAnalysis).where(RiskAnalysis.project_id == p.project_id)
                      .order_by(RiskAnalysis.risk_id.desc())).scalars().all()
    from ml import config as C
    return {"project_id": p.project_id, "project_code": p.project_code, "project_name": p.name, "status": p.status,
            "latest": S.risk_full(rows[0]) if rows else None, "history": [S.risk_summary(r) for r in rows],
            "threshold_notice": C.THRESHOLD_NOTICE, "disclaimer": C.DISCLAIMER,
            "levels": [{"min": lo, "level": lv} for lo, lv in C.LEVELS]}


@router.post("/{project_id}/risk-analysis")
def run_analysis(project_id: int, request: Request, user: User = Depends(require("project:run_analysis")),
                 db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    if p.verification_status != "Verified":
        raise HTTPException(409, "Project data has not been verified. Analysis is only run on verified data.")
    analysis = risk_service.run_risk_analysis(db, p, user)
    db.commit()
    return {"project_status": p.status, "risk": S.risk_full(analysis)}


@router.get("/{project_id}/historical-comparison")
def historical_comparison(project_id: int, user: User = Depends(require("project:view_risk")), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    latest = latest_risk_map(db, [p.project_id]).get(p.project_id)
    if latest:
        return {"source": "stored analysis", "analysed_at": S.iso(latest.timestamp),
                "comparison": latest.historical_comparison}
    return {"source": "computed now", "analysed_at": None, "comparison": risk_service.build_comparison(db, p)}


@router.get("/{project_id}/agency-history")
def agency_history(project_id: int, user: User = Depends(require("project:view_risk")), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    if not p.agency_id:
        return {"agency": None, "projects": []}
    stats = compute_agency_stats(db, p.agency_id)
    others = db.execute(select(Project).where(Project.agency_id == p.agency_id, Project.project_id != p.project_id,
                                              Project.verification_status == "Verified")
                        .order_by(Project.delay_days.desc()).limit(25)).scalars().all()
    lr = latest_risk_map(db, [o.project_id for o in others])
    return {"agency": stats, "projects": [
        {"project_id": o.project_id, "project_code": o.project_code, "name": o.name, "category": o.category,
         "delay_days": o.delay_days, "progress": o.progress, "status": o.status,
         "risk_level": lr[o.project_id].risk_level if o.project_id in lr else None} for o in others]}


@router.get("/{project_id}/feedback")
def citizen_feedback(project_id: int, user: User = Depends(require("complaint:review")), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    reviews = db.execute(select(Review).where(Review.project_id == p.project_id).order_by(Review.created_at.desc())).scalars().all()
    citizens = {u.user_id: u for u in db.execute(select(User).where(User.user_id.in_([r.citizen_id for r in reviews] or [0]))).scalars()}
    complaints = db.execute(select(Complaint).where(or_(Complaint.project_id == p.project_id,
                                                        Complaint.project_code_ref == p.project_code))
                            .order_by(Complaint.created_at.desc())).scalars().all()
    ccit = {u.user_id: u for u in db.execute(select(User).where(User.user_id.in_([c.citizen_id for c in complaints] or [0]))).scalars()}
    return {"reviews": [S.review(r, citizens.get(r.citizen_id)) for r in reviews],
            "complaints": [S.complaint_for_officer(c, p, ccit.get(c.citizen_id)) for c in complaints]}


@router.get("/{project_id}/reviews")
def list_reviews(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    stmt = select(Review).where(Review.project_id == p.project_id)
    if user.role == P.CITIZEN:
        stmt = stmt.where(or_(Review.status == "Approved", Review.citizen_id == user.user_id))
    reviews = db.execute(stmt.order_by(Review.created_at.desc())).scalars().all()
    citizens = {u.user_id: u for u in db.execute(select(User).where(User.user_id.in_([r.citizen_id for r in reviews] or [0]))).scalars()}
    return [S.review(r, citizens.get(r.citizen_id)) for r in reviews]


@router.post("/{project_id}/reviews", status_code=201)
def submit_review(project_id: int, body: ReviewIn, request: Request, user: User = Depends(require("review:submit")),
                  db: Session = Depends(get_db)):
    p = visible_project_or_404(db, user, project_id)
    if db.scalar(select(Review.review_id).where(Review.project_id == p.project_id, Review.citizen_id == user.user_id)):
        raise HTTPException(409, "You have already reviewed this project.")
    r = Review(project_id=p.project_id, citizen_id=user.user_id, rating=body.rating,
               comment=(body.comment or "").strip() or None, media=body.media or [], status="Pending")
    db.add(r)
    db.flush()
    log_audit(db, user, "Review Submitted", "Review", r.review_id, project_id=p.project_id,
              new={"rating": body.rating, "has_media": bool(body.media)}, ip=client_ip(request))
    db.commit()
    return S.review(r, user)


@router.get("/reviews/pending")
def list_pending_reviews(user: User = Depends(require("review:moderate")), db: Session = Depends(get_db)):
    reviews = db.execute(select(Review).where(Review.status == "Pending").order_by(Review.created_at.desc())).scalars().all()
    citizens = {u.user_id: u for u in db.execute(select(User).where(User.user_id.in_([r.citizen_id for r in reviews] or [0]))).scalars()}
    projects = {p.project_id: p for p in db.execute(select(Project).where(Project.project_id.in_([r.project_id for r in reviews] or [0]))).scalars()}
    out = []
    for r in reviews:
        item = S.review(r, citizens.get(r.citizen_id))
        proj = projects.get(r.project_id)
        item["project_code"] = proj.project_code if proj else None
        item["project_name"] = proj.name if proj else None
        out.append(item)
    return out


@router.post("/reviews/{review_id}/moderate")
def moderate_review(review_id: int, body: ReviewModerateIn, request: Request,
                    user: User = Depends(require("review:moderate")), db: Session = Depends(get_db)):
    r = db.get(Review, review_id)
    if not r:
        raise HTTPException(404, "Review not found.")
    r.status = "Approved" if body.decision == "Approve" else "Rejected"
    r.moderated_by = user.user_id
    r.moderated_at = datetime.now(timezone.utc)
    r.moderation_note = body.note
    log_audit(db, user, "Review Moderated", "Review", r.review_id, project_id=r.project_id,
              new={"status": r.status, "decision": body.decision, "note": body.note}, ip=client_ip(request))
    db.commit()
    return {"message": f"Review {r.status.lower()} successfully."}
