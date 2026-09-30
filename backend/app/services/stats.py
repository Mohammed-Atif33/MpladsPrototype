"""Aggregate statistics helpers (agency history, latest risk per project)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Agency, Complaint, Inspection, Project, RiskAnalysis

ADVERSE_OUTCOMES = ("Major Deficiencies", "Irregularities Found")
INSPECTION_OUTCOMES = ["Satisfactory", "Minor Deficiencies", "Major Deficiencies", "Irregularities Found"]


def latest_risk_map(db: Session, project_ids: list[int] | None = None) -> dict[int, RiskAnalysis]:
    if project_ids is not None and not project_ids:
        return {}
    sub = select(func.max(RiskAnalysis.risk_id)).group_by(RiskAnalysis.project_id)
    if project_ids is not None:
        sub = sub.where(RiskAnalysis.project_id.in_(project_ids))
    rows = db.execute(select(RiskAnalysis).where(RiskAnalysis.risk_id.in_(sub))).scalars().all()
    res = {r.project_id: r for r in rows}
    if project_ids is not None:
        missing = [pid for pid in project_ids if pid not in res]
        if missing:
            fallback = db.execute(
                select(RiskAnalysis)
                .where(RiskAnalysis.project_id.in_(missing))
                .order_by(RiskAnalysis.timestamp.desc(), RiskAnalysis.risk_id.desc())
            ).scalars().all()
            for r in fallback:
                if r.project_id not in res:
                    res[r.project_id] = r
    return res


def compute_agency_stats(db: Session, agency_id: int, exclude_project_id: int | None = None) -> dict:
    agency = db.get(Agency, agency_id)
    q = select(Project).where(Project.agency_id == agency_id, Project.verification_status == "Verified")
    if exclude_project_id:
        q = q.where(Project.project_id != exclude_project_id)
    projects = db.execute(q).scalars().all()
    total = len(projects)
    completed = sum(1 for p in projects if p.completion_date or (p.progress or 0) >= 100)
    delayed = sum(1 for p in projects if (p.delay_days or 0) > 30)
    delays = [p.delay_days for p in projects if p.delay_days is not None]
    avg_delay = round(sum(delays) / len(delays), 1) if delays else 0.0
    ids = [p.project_id for p in projects]
    complaints = db.scalar(select(func.count()).select_from(Complaint).where(Complaint.project_id.in_(ids))) if ids else 0
    inspections = db.scalar(select(func.count()).select_from(Inspection).where(Inspection.project_id.in_(ids))) if ids else 0
    adverse = db.scalar(select(func.count()).select_from(Inspection).where(
        Inspection.project_id.in_(ids), Inspection.outcome.in_(ADVERSE_OUTCOMES))) if ids else 0
    lr = latest_risk_map(db, ids) if ids else {}
    high = sum(1 for r in lr.values() if r.risk_level in ("High", "Critical"))
    ratio = (delayed / total) if total else 0.0
    perf = max(0.0, 100 - 50 * ratio - min(avg_delay, 120) / 4 - 5 * high)
    return {
        "agency_id": agency_id, "name": agency.name if agency else None, "total_projects": total,
        "completed_projects": completed, "delayed_projects": delayed, "average_delay": avg_delay,
        "complaints": int(complaints or 0), "inspections": int(inspections or 0),
        "adverse_inspections": int(adverse or 0), "previous_high_risk_cases": high,
        "historical_performance": round(perf, 1),
    }


def refresh_agency_stats(db: Session, agency_id: int | None) -> None:
    if not agency_id:
        return
    agency = db.get(Agency, agency_id)
    if not agency:
        return
    s = compute_agency_stats(db, agency_id)
    for k in ("total_projects", "completed_projects", "delayed_projects", "average_delay", "complaints",
              "inspections", "previous_high_risk_cases", "historical_performance"):
        setattr(agency, k, s[k])


def compute_delay_days(deadline: date | None, as_of: date | None, completion: date | None) -> int:
    if not deadline:
        return 0
    end = completion or as_of or date.today()
    return max(0, (end - deadline).days)
