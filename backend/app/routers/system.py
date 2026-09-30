"""Role-specific dashboards, reference data, scheduled checks, demo helpers."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ml import config as MLC

from .. import permissions as P
from ..config import ROOT_DIR
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm, require
from ..models import (Agency, AgencyRequest, AuditLog, Clarification, Complaint, Extraction, Inspection, Notification,
                      Project, ProgressReport, RiskAnalysis, User)
from ..services import serializers as S
from ..services.reference import CATEGORIES, DISTRICT_CENTROIDS
from ..services.stats import INSPECTION_OUTCOMES, latest_risk_map
from ..services.workflow import OPEN_CASE_STATUSES, run_supervisory_checks
from .complaints import COMPLAINT_CATEGORIES

router = APIRouter(prefix="/api", tags=["system"])
DEMO_DIR = ROOT_DIR / "demo_pdfs"


def _unread(db: Session, user: User) -> int:
    return db.scalar(select(func.count()).select_from(Notification).where(
        Notification.recipient_id == user.user_id, Notification.status == "Unread")) or 0


def _live(stmt=None):
    stmt = stmt if stmt is not None else select(Project)
    return stmt.where(Project.verification_status == "Verified", Project.is_historical.is_(False))


@router.get("/meta")
def meta(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    agencies = [{"agency_id": a.agency_id, "name": a.name} for a in db.execute(select(Agency).order_by(Agency.name)).scalars()]
    officers = [{"user_id": u.user_id, "name": u.name, "department": u.department, "district": u.district}
                for u in db.execute(select(User).where(User.role == P.OFFICER, User.status == "Active").order_by(User.name)).scalars()]
    out = {"categories": CATEGORIES, "districts": list(DISTRICT_CENTROIDS), "agencies": agencies, "officers": officers,
           "complaint_categories": COMPLAINT_CATEGORIES, "public_statuses": ["On track", "Delayed", "Completed"]}
    if user.role in (P.OFFICER, P.HEAD, P.MP):
        out.update({"project_statuses": P.PROJECT_STATUSES, "inspection_outcomes": INSPECTION_OUTCOMES,
                    "risk_levels": [l for _, l in MLC.LEVELS][::-1], "threshold_notice": MLC.THRESHOLD_NOTICE,
                    "disclaimer": MLC.DISCLAIMER})
    return out


@router.get("/users/inspectors")
def inspectors(user: User = Depends(require("inspection:assign")), db: Session = Depends(get_db)):
    rows = db.execute(select(User).where(User.is_inspector.is_(True), User.status == "Active").order_by(User.name)).scalars()
    return [{"user_id": u.user_id, "name": u.name, "department": u.department} for u in rows]


@router.get("/agencies")
def agencies(user: User = Depends(require("project:view_all")), db: Session = Depends(get_db)):
    rows = db.execute(select(Agency).order_by(Agency.name)).scalars()
    return [{"agency_id": a.agency_id, "name": a.name, "district": a.district, "total_projects": a.total_projects,
             "completed_projects": a.completed_projects, "delayed_projects": a.delayed_projects,
             "average_delay": a.average_delay, "complaints": a.complaints, "inspections": a.inspections,
             "previous_high_risk_cases": a.previous_high_risk_cases, "historical_performance": a.historical_performance}
            for a in rows]


# ------------------------------------------------------------------ dashboards
@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == P.CITIZEN:
        return _citizen_dash(db, user)
    if user.role == P.AGENCY:
        return _agency_dash(db, user)
    if user.role == P.OFFICER:
        return _officer_dash(db, user)
    if user.role == P.HEAD:
        return _head_dash(db, user)
    if user.role == P.MP:
        return _mp_dash(db, user)
    if user.role == P.ADMIN:
        return {"role": user.role, "kpis": {"users": db.scalar(select(func.count()).select_from(User)),
                                            "audit_records": db.scalar(select(func.count()).select_from(AuditLog)),
                                            "unread": _unread(db, user)}}
    raise HTTPException(403, "You do not have permission to perform this action.")


def _by(db, col, stmt_where):
    rows = db.execute(select(col, func.count()).where(stmt_where).group_by(col).order_by(func.count().desc())).all()
    return [{"name": n or "Unspecified", "count": c} for n, c in rows]


def _citizen_dash(db: Session, user: User) -> dict:
    pub = and_(Project.verification_status == "Verified", Project.is_public.is_(True))
    completed = or_(Project.completion_date.is_not(None), Project.progress >= 100)
    total = db.scalar(select(func.count()).select_from(Project).where(pub)) or 0
    done = db.scalar(select(func.count()).select_from(Project).where(pub, completed)) or 0
    delayed = db.scalar(select(func.count()).select_from(Project).where(pub, ~completed, Project.delay_days > 0)) or 0
    mine = db.scalar(select(func.count()).select_from(Complaint).where(Complaint.citizen_id == user.user_id)) or 0
    open_ = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.citizen_id == user.user_id, Complaint.status.not_in(("Closed", "Rejected")))) or 0
    return {"role": user.role, "kpis": {"public_projects": total, "completed": done, "delayed": delayed,
                                        "my_complaints": mine, "open_complaints": open_, "unread": _unread(db, user)},
            "by_category": _by(db, Project.category, pub)}


def _agency_dash(db: Session, user: User) -> dict:
    mine = and_(Project.agency_id == user.agency_id, Project.verification_status == "Verified", Project.is_historical.is_(False))
    projects = db.execute(select(Project).where(mine).order_by(Project.name)).scalars().all()
    ids = [p.project_id for p in projects]
    cutoff = date.today() - timedelta(days=30)
    reported = {pid for (pid,) in db.execute(select(ProgressReport.project_id).where(
        ProgressReport.project_id.in_(ids or [0]), ProgressReport.report_date >= cutoff))}
    pending_reports = [p for p in projects if p.project_id not in reported and not S.is_completed(p)]
    delayed = [p for p in projects if not S.is_completed(p) and (p.delay_days or 0) > 0]
    open_c = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id.in_(ids or [0]), Complaint.screening_status == "Verified",
        Complaint.status.in_(("Assigned", "Under Investigation")))) or 0
    clar = db.scalar(select(func.count()).select_from(Clarification).where(
        Clarification.agency_id == user.agency_id, Clarification.status == "Open")) or 0
    reqs = db.scalar(select(func.count()).select_from(AgencyRequest).where(
        AgencyRequest.agency_id == user.agency_id, AgencyRequest.status == "Pending")) or 0
    return {"role": user.role, "agency": user.agency.name if user.agency else None,
            "kpis": {"assigned_projects": len(projects), "pending_reports": len(pending_reports), "delayed_projects": len(delayed),
                     "open_complaints": open_c, "open_clarifications": clar, "pending_requests": reqs, "unread": _unread(db, user)},
            "projects": [{"project_id": p.project_id, "project_code": p.project_code, "name": p.name, "progress": p.progress,
                          "planned_progress": p.planned_progress, "delay_days": p.delay_days,
                          "agency_status": S.agency_status(p), "report_pending": p.project_id not in reported and not S.is_completed(p)}
                         for p in projects],
            "delayed": [{"project_id": p.project_id, "project_code": p.project_code, "name": p.name, "delay_days": p.delay_days} for p in delayed]}


RISK_ORDER = ["Low", "Medium", "High", "Critical"]


def _risk_distribution(lr: dict, live_ids: set[int]) -> list[dict]:
    counts = {k: 0 for k in RISK_ORDER}
    for pid, r in lr.items():
        if pid in live_ids:
            counts[r.risk_level] = counts.get(r.risk_level, 0) + 1
    return [{"level": k, "count": counts[k]} for k in RISK_ORDER]


def _officer_dash(db: Session, user: User) -> dict:
    live = db.execute(_live()).scalars().all()
    live_ids = {p.project_id for p in live}
    lr = latest_risk_map(db, list(live_ids)) if live_ids else {}
    pending_ext = db.scalar(select(func.count()).select_from(Extraction).where(Extraction.status == "Pending Verification")) or 0
    pending_c = db.scalar(select(func.count()).select_from(Complaint).where(Complaint.screening_status == "Pending")) or 0
    pending_i = db.scalar(select(func.count()).select_from(Inspection).where(
        Inspection.status.in_(("Requested", "Assigned", "Scheduled")))) or 0
    pending_req = db.scalar(select(func.count()).select_from(AgencyRequest).where(AgencyRequest.status == "Pending")) or 0
    hist = db.scalar(select(func.count()).select_from(Project).where(Project.is_historical.is_(True))) or 0
    by_status: dict[str, int] = {}
    for p in live:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    cat_risk: dict[str, list[float]] = {}
    for p in live:
        if p.project_id in lr:
            cat_risk.setdefault(p.category, []).append(lr[p.project_id].risk_score)
    recent = db.execute(select(RiskAnalysis).order_by(RiskAnalysis.risk_id.desc()).limit(6)).scalars().all()
    pmap = {p.project_id: p for p in db.execute(select(Project).where(Project.project_id.in_([r.project_id for r in recent] or [0]))).scalars()}
    return {
        "role": user.role,
        "kpis": {
            "total_projects": len(live),
            "under_review": sum(1 for p in live if p.status in OPEN_CASE_STATUSES),
            "high_risk": sum(1 for r in lr.values() if r.risk_level == "High"),
            "critical_risk": sum(1 for r in lr.values() if r.risk_level == "Critical"),
            "pending_verification": pending_ext, "pending_complaints": pending_c, "pending_inspections": pending_i,
            "pending_requests": pending_req, "historical_records": hist, "unread": _unread(db, user),
        },
        "risk_distribution": _risk_distribution(lr, live_ids),
        "by_status": [{"name": k, "count": v} for k, v in sorted(by_status.items(), key=lambda kv: -kv[1])],
        "category_risk": [{"category": k, "avg_score": round(sum(v) / len(v), 1), "projects": len(v)} for k, v in cat_risk.items()],
        "recent_analyses": [{"risk_id": r.risk_id, "project_id": r.project_id, "project_code": pmap[r.project_id].project_code,
                             "project_name": pmap[r.project_id].name, "risk_score": r.risk_score, "risk_level": r.risk_level,
                             "timestamp": S.iso(r.timestamp)} for r in recent if r.project_id in pmap],
        "threshold_notice": MLC.THRESHOLD_NOTICE,
    }


def _head_dash(db: Session, user: User) -> dict:
    live = db.execute(_live()).scalars().all()
    live_ids = {p.project_id for p in live}
    lr = latest_risk_map(db, list(live_ids)) if live_ids else {}
    today = date.today()
    overdue = db.scalar(select(func.count()).select_from(Inspection).where(
        Inspection.status.in_(("Requested", "Assigned", "Scheduled", "Completed")), Inspection.due_date < today)) or 0
    awaiting_assign = db.scalar(select(func.count()).select_from(Inspection).where(Inspection.status == "Requested")) or 0
    appeals = db.scalar(select(func.count()).select_from(Complaint).where(Complaint.appeal_status == "Pending")) or 0
    since7 = datetime.now(timezone.utc) - timedelta(days=7)
    a7 = dict(db.execute(select(AuditLog.action, func.count()).where(AuditLog.timestamp >= since7).group_by(AuditLog.action)).all())
    day = func.date_trunc("day", RiskAnalysis.timestamp)
    trend = db.execute(select(day, RiskAnalysis.risk_level, func.count()).where(
        RiskAnalysis.timestamp >= datetime.now(timezone.utc) - timedelta(days=30)).group_by(day, RiskAnalysis.risk_level).order_by(day)).all()
    trend_map: dict[str, dict] = {}
    for d, lvl, c in trend:
        trend_map.setdefault(d.date().isoformat(), {"day": d.date().isoformat(), **{k: 0 for k in RISK_ORDER}})[lvl] = c
    agency_high: dict[str, int] = {}
    for p in live:
        r = lr.get(p.project_id)
        if r and r.risk_level in ("High", "Critical") and p.agency:
            agency_high[p.agency.name] = agency_high.get(p.agency.name, 0) + 1
    return {
        "role": user.role,
        "kpis": {
            "escalated": sum(1 for p in live if (p.case_level or 0) >= 2),
            "high_risk": sum(1 for r in lr.values() if r.risk_level == "High"),
            "critical_risk": sum(1 for r in lr.values() if r.risk_level == "Critical"),
            "pending_supervision": sum(1 for p in live if p.status in ("Escalated to Head Officer", "Escalated Further")),
            "inspection_issues": overdue + awaiting_assign, "overdue_inspections": overdue,
            "awaiting_assignment": awaiting_assign, "appeals": appeals,
            "reopened": sum(1 for p in live if p.status == "Reopened"), "unread": _unread(db, user),
        },
        "audit_summary": {"total_7d": sum(a7.values()), "decisions": a7.get("Decision", 0), "corrections": a7.get("Data Correction", 0),
                          "escalations": a7.get("Escalation", 0), "head_actions": a7.get("Head Officer Action", 0),
                          "risk_analyses": a7.get("Risk Analysis", 0)},
        "risk_distribution": _risk_distribution(lr, live_ids),
        "risk_trend": list(trend_map.values()),
        "agency_high_risk": [{"agency": k, "count": v} for k, v in sorted(agency_high.items(), key=lambda kv: -kv[1])[:8]],
        "threshold_notice": MLC.THRESHOLD_NOTICE,
    }


def _mp_dash(db: Session, user: User) -> dict:
    live = db.execute(_live()).scalars().all()
    live_ids = {p.project_id for p in live}
    lr = latest_risk_map(db, list(live_ids)) if live_ids else {}

    completed = [p for p in live if S.is_completed(p)]
    delayed = [p for p in live if not S.is_completed(p) and (p.delay_days or 0) > 0]
    active = [p for p in live if not S.is_completed(p)]

    high_critical_pids = {pid for pid, r in lr.items() if r.risk_level in ("High", "Critical")}
    attention = [p for p in live if p.project_id in high_critical_pids or (p.delay_days or 0) > 60]

    pending_req = db.scalar(select(func.count()).select_from(AgencyRequest).where(AgencyRequest.status == "Pending")) or 0
    pending_officer = sum(1 for p in live if p.status in ("Officer Review Required", "Under Review", "Clarification Requested"))
    inspections_count = db.scalar(select(func.count()).select_from(Inspection).where(
        Inspection.status.in_(("Requested", "Assigned", "Scheduled")))) or 0

    by_status: dict[str, int] = {}
    for p in live:
        by_status[p.status] = by_status.get(p.status, 0) + 1

    progress_buckets = {"0-25%": 0, "26-50%": 0, "51-75%": 0, "76-99%": 0, "100%": 0}
    for p in live:
        pr = p.progress or 0
        if pr >= 100:
            progress_buckets["100%"] += 1
        elif pr > 75:
            progress_buckets["76-99%"] += 1
        elif pr > 50:
            progress_buckets["51-75%"] += 1
        elif pr > 25:
            progress_buckets["26-50%"] += 1
        else:
            progress_buckets["0-25%"] += 1

    by_dist: dict[str, int] = {}
    for p in live:
        d = p.district or "Other"
        by_dist[d] = by_dist.get(d, 0) + 1

    by_cat: dict[str, int] = {}
    for p in live:
        c = p.category or "Other"
        by_cat[c] = by_cat.get(c, 0) + 1

    tot_sanctioned = float(sum(p.sanctioned_amount or 0 for p in live))
    tot_expenditure = float(sum(p.expenditure or 0 for p in live))
    tot_released = float(sum(p.released_amount or 0 for p in live))

    recent = db.execute(select(Project).where(Project.verification_status == "Verified", Project.is_historical.is_(False))
                        .order_by(Project.created_at.desc()).limit(8)).scalars().all()

    return {
        "role": user.role,
        "kpis": {
            "total_projects": len(live),
            "active_projects": len(active),
            "completed_projects": len(completed),
            "delayed_projects": len(delayed),
            "requiring_attention": len(attention),
            "pending_agency_requests": pending_req,
            "pending_officer_actions": pending_officer,
            "high_risk_projects": len(high_critical_pids),
            "under_inspection": inspections_count,
            "unread": _unread(db, user),
        },
        "charts": {
            "by_status": [{"name": k, "count": v} for k, v in sorted(by_status.items(), key=lambda kv: -kv[1])],
            "by_progress": [{"bucket": k, "count": v} for k, v in progress_buckets.items()],
            "by_district": [{"district": k, "count": v} for k, v in sorted(by_dist.items(), key=lambda kv: -kv[1])],
            "by_category": [{"category": k, "count": v} for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])],
            "financial": {
                "sanctioned": tot_sanctioned,
                "released": tot_released,
                "expenditure": tot_expenditure,
            },
        },
        "recent_projects": [
            {
                "project_id": p.project_id, "project_code": p.project_code, "name": p.name,
                "category": p.category, "district": p.district, "progress": p.progress,
                "delay_days": p.delay_days, "status": p.status,
                "agency_name": p.agency.name if p.agency else None,
                "risk_level": lr[p.project_id].risk_level if p.project_id in lr else None,
                "risk_score": lr[p.project_id].risk_score if p.project_id in lr else None,
            }
            for p in recent
        ],
        "threshold_notice": MLC.THRESHOLD_NOTICE,
    }


# ------------------------------------------------------------------ scheduled checks (also runs daily in background)
class RunChecksIn(BaseModel):
    as_of: date | None = None


@router.post("/system/run-checks")
def run_checks(body: RunChecksIn, request: Request, user: User = Depends(require("system:run_checks")), db: Session = Depends(get_db)):
    """Runs the time-based supervisory checks. `as_of` lets the demo simulate a later date."""
    result = run_supervisory_checks(db, body.as_of or date.today(), user)
    db.commit()
    return result


# ------------------------------------------------------------------ demo helpers
@router.get("/demo/sample-pdfs")
def sample_pdfs(user: User = Depends(require("project:upload_pdf"))):
    if not DEMO_DIR.exists():
        return []
    return [{"name": p.name, "size_bytes": p.stat().st_size,
             "description": "Clean report - expect mostly High confidence, project scores as a high-risk case" if "PN-001" in p.name
             else "Messy field note - shows Medium/Low/Missing fields, warnings and an invalid value to correct"}
            for p in sorted(DEMO_DIR.glob("*.pdf"))]


@router.get("/demo/sample-pdfs/{name}")
def sample_pdf(name: str, user: User = Depends(require("project:upload_pdf"))):
    path = (DEMO_DIR / name).resolve()
    if DEMO_DIR.resolve() not in path.parents or path.suffix.lower() != ".pdf" or not path.exists():
        raise HTTPException(404, "Sample not found.")
    return FileResponse(path, media_type="application/pdf", filename=path.name)
