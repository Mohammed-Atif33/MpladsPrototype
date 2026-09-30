"""Glue between the database and the ml/ package: builds inputs, runs the hybrid risk engine,
stores the result, updates project status, raises notifications and writes the audit record."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ml import anomaly as A
from ml import historical as H
from ml import risk_engine as R

from .. import permissions as P
from ..models import (Agency, Complaint, Extraction, Inspection, Payment, Project, ProgressReport, RiskAnalysis, User)
from . import notify
from .audit import log_audit
from .stats import ADVERSE_OUTCOMES, compute_agency_stats


def project_to_dict(p: Project, verified_complaints: int = 0) -> dict:
    dur = (p.deadline - p.start_date).days if p.deadline and p.start_date else None
    return {
        "project_id": p.project_id, "project_code": p.project_code, "name": p.name, "category": p.category,
        "district": p.district, "agency_id": p.agency_id, "sanctioned_amount": float(p.sanctioned_amount or 0),
        "expenditure": float(p.expenditure or 0), "progress": float(p.progress or 0),
        "planned_progress": p.planned_progress, "delay_days": p.delay_days or 0, "duration_days": dur,
        "budget_revisions": p.budget_revisions or 0, "extension_requests": p.extension_requests or 0,
        "verified_complaints": verified_complaints,
    }


def load_history(db: Session, exclude_project_id: int | None = None) -> list[dict]:
    """Every verified project except the one being analysed = the historical database."""
    vc = dict(db.execute(
        select(Complaint.project_id, func.count()).where(
            Complaint.screening_status == "Verified", Complaint.project_id.is_not(None)
        ).group_by(Complaint.project_id)).all())
    q = select(Project).where(Project.verification_status == "Verified")
    if exclude_project_id:
        q = q.where(Project.project_id != exclude_project_id)
    return [project_to_dict(p, vc.get(p.project_id, 0)) for p in db.execute(q).scalars()]


def load_snapshots(db: Session) -> list[dict]:
    rows = db.execute(
        select(ProgressReport.project_id, ProgressReport.progress, ProgressReport.expenditure, Project.sanctioned_amount)
        .join(Project, Project.project_id == ProgressReport.project_id)
    ).all()
    return [{"project_id": r[0], "progress": r[1], "spend_ratio": (float(r[2]) / float(r[3])) if r[3] else None} for r in rows]


def build_comparison(db: Session, project: Project) -> dict:
    vcount = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id == project.project_id, Complaint.screening_status == "Verified")) or 0
    pd_ = project_to_dict(project, vcount)
    hist = H.prepare_history(load_history(db, project.project_id))
    snaps = H.prepare_snapshots(load_snapshots(db))
    agency = compute_agency_stats(db, project.agency_id, project.project_id) if project.agency_id else None
    ag_projects = []
    if project.agency_id:
        ag_projects = [
            {"project_code": c, "delay_days": d} for c, d in db.execute(
                select(Project.project_code, Project.delay_days).where(
                    Project.agency_id == project.agency_id, Project.project_id != project.project_id,
                    Project.verification_status == "Verified").order_by(Project.delay_days.desc()).limit(20))
        ]
    return H.compare(pd_, hist, snaps, agency, ag_projects)


def run_risk_analysis(db: Session, project: Project, user: User | None, notify_users: bool = True) -> RiskAnalysis:
    vcount = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id == project.project_id, Complaint.screening_status == "Verified")) or 0
    ucount = db.scalar(select(func.count()).select_from(Complaint).where(
        Complaint.project_id == project.project_id, Complaint.screening_status == "Pending")) or 0
    pd_ = project_to_dict(project, vcount)

    comparison = build_comparison(db, project)
    hist_rows = load_history(db, project.project_id)
    anomaly = A.score_project(pd_, hist_rows)

    payments = [{"amount": float(x.amount), "paid_on": x.paid_on} for x in
                db.execute(select(Payment).where(Payment.project_id == project.project_id)).scalars()]
    agency_stats = compute_agency_stats(db, project.agency_id, project.project_id) if project.agency_id else None
    adverse = db.scalar(select(func.count()).select_from(Inspection).where(
        Inspection.project_id == project.project_id, Inspection.outcome.in_(ADVERSE_OUTCOMES))) or 0
    adverse += (agency_stats or {}).get("adverse_inspections", 0)
    ext = db.execute(select(Extraction).where(Extraction.project_id == project.project_id)
                     .order_by(Extraction.extraction_id.desc()).limit(1)).scalar()
    dq = (ext.validation or {}).get("data_quality_issues", 0) if ext else 0

    ctx = {"payments": payments, "agency": agency_stats, "verified_complaints": vcount, "unverified_complaints": ucount,
           "adverse_inspections": adverse, "data_quality_issues": dq}
    result = R.analyze(pd_, comparison, anomaly, ctx)

    analysis = RiskAnalysis(
        project_id=project.project_id, risk_score=result["risk_score"], risk_level=result["risk_level"],
        contributing_factors=result["factors"],
        historical_comparison={**comparison, "anomaly": anomaly},
        anomaly_score=result["anomaly_score"], rule_score=result["rule_score"], model_version=result["model_version"],
        input_snapshot={"project": pd_, "context": {k: v for k, v in ctx.items() if k != "payments"},
                        "payment_flags": result["payment_flags"], "recommendation": result["recommendation"]},
        analyzed_by=user.user_id if user else None,
    )
    db.add(analysis)
    db.flush()

    prev_status = project.status
    if project.status in ("Verified - Analysis Pending",) or (
            project.status == "Cleared - Routine Monitoring" and result["risk_level"] in ("High", "Critical")):
        project.status = "Officer Review Required"
    if result["risk_level"] in ("High", "Critical") and (project.case_level or 0) < 1:
        project.case_level = 1

    log_audit(db, user, "Risk Analysis", "Project", project.project_code, project_id=project.project_id,
              previous={"status": prev_status},
              new={"risk_id": analysis.risk_id, "risk_score": result["risk_score"], "risk_level": result["risk_level"],
                   "rule_score": result["rule_score"], "anomaly_score": result["anomaly_score"],
                   "model_version": result["model_version"], "status": project.status},
              reason="Hybrid rule-based + Isolation Forest analysis on verified data")

    if notify_users:
        _notify_analysis(db, project, analysis, result, user, agency_stats)
    return analysis


def _notify_analysis(db: Session, project: Project, analysis: RiskAnalysis, result: dict, user: User | None, agency_stats):
    level, score = result["risk_level"], result["risk_score"]
    officers = [user.user_id] if user and user.role == P.OFFICER else notify.officers(db)
    notify.notify(db, officers, "Analysis completed",
                  f"Risk analysis completed for {project.project_code} ({project.name}): {score:.0f}/100, {level}. "
                  f"{result['recommendation']}", "info" if level in ("Low", "Medium") else "review",
                  project_id=project.project_id, entity_type="RiskAnalysis", entity_id=analysis.risk_id)
    if level in ("High", "Critical"):
        notify.notify(db, notify.officers(db), "High-priority review",
                      f"Priority review recommended: {project.project_code} scored {score:.0f}/100 ({level}). Officer review of the evidence is required.",
                      "critical" if level == "Critical" else "action", project_id=project.project_id,
                      entity_type="RiskAnalysis", entity_id=analysis.risk_id,
                      dedupe_key=f"highprio-{analysis.risk_id}")
        notify.notify(db, notify.head_officers(db), "Supervisory review",
                      f"{level}-risk case requires supervision: {project.project_code} ({project.name}), score {score:.0f}/100.",
                      "critical" if level == "Critical" else "review", project_id=project.project_id,
                      entity_type="RiskAnalysis", entity_id=analysis.risk_id, dedupe_key=f"supervise-{analysis.risk_id}")
        if agency_stats and agency_stats.get("previous_high_risk_cases", 0) >= 3:
            notify.notify(db, notify.head_officers(db), "Repeated risk pattern",
                          f"Repeated risk pattern: {agency_stats['name']} now has another {level}-risk project "
                          f"({project.project_code}) after {agency_stats['previous_high_risk_cases']} earlier high-risk cases.",
                          "review", project_id=project.project_id, dedupe_key=f"repeat-{analysis.risk_id}")
