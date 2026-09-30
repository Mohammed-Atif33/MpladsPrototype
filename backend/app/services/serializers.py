"""Role-aware serializers. Each audience gets an explicit whitelist of fields:

  * citizen  -> public project info only (no risk data, no internal status, no officer notes)
  * agency   -> own-project operational info (no risk score/level, no escalation state)
  * officer / head officer -> full internal view

Data masking: citizen identities are masked for everyone except the citizen themself; anonymous
complaints never expose identity to anyone else (agencies/officers included).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from ..models import (AgencyRequest, Clarification, Complaint, Decision, Document, Inspection, Notification,
                      OfficerWarning, Payment, Project, ProjectAssignmentHistory, ProgressReport, RiskAnalysis, Review, User)


def f(x: Any) -> float | None:
    if x is None:
        return None
    return float(x) if isinstance(x, (Decimal, int, float)) else x


def iso(x: Any) -> str | None:
    if isinstance(x, (date, datetime)):
        return x.isoformat()
    return x


def mask_name(name: str | None) -> str:
    if not name:
        return "Citizen"
    return " ".join((w[:2] + "*" * max(2, len(w) - 2)) for w in name.split())


def is_completed(p: Project) -> bool:
    return bool(p.completion_date) or (p.progress or 0) >= 100


def public_status(p: Project) -> str:
    if is_completed(p):
        return "Completed"
    return "Delayed" if (p.delay_days or 0) > 0 else "On track"


AGENCY_STATUS_MAP = {
    "Clarification Requested": "Clarification requested",
    "Evidence Requested": "Additional evidence requested",
    "Inspection Requested": "Inspection pending",
}


def agency_status(p: Project) -> str:
    if is_completed(p):
        return "Completed"
    return AGENCY_STATUS_MAP.get(p.status, "Active")


def extract_public_safe_risk_factors(r: RiskAnalysis | None) -> list[str]:
    if not r or not r.contributing_factors:
        return []
    safe: list[str] = []
    for f_item in r.contributing_factors:
        if not isinstance(f_item, dict):
            continue
        key = (f_item.get("key") or "").lower()
        label = f_item.get("label") or ""
        # Strictly exclude internal ML / Isolation Forest parameters and technical details
        if key == "anomaly" or "isolation forest" in label.lower() or "isolation forest" in (f_item.get("detail") or "").lower():
            continue
        # Include contributing factors
        if f_item.get("contributing") or (f_item.get("points") or 0) >= 0.5:
            safe.append(label)
    return safe


# ------------------------------------------------------------------ projects
def project_public(p: Project, rating_avg: float | None = None, rating_count: int = 0, latest_risk: RiskAnalysis | None = None,
                   officer_name_override: str | None = None, agency_name_override: str | None = None) -> dict:
    risk_score = round(float(latest_risk.risk_score), 1) if latest_risk and latest_risk.risk_score is not None else None
    risk_level = latest_risk.risk_level if latest_risk else None
    risk_updated_at = iso(latest_risk.timestamp) if latest_risk else None
    safe_factors = extract_public_safe_risk_factors(latest_risk)

    agency_name = agency_name_override or (p.agency.name if getattr(p, "agency", None) else None)
    officer_name = officer_name_override or (p.officer.name if getattr(p, "officer", None) else None)
    mp_name = p.mp.name if getattr(p, "mp", None) else None

    return {
        "project_id": p.project_id, "project_code": p.project_code, "name": p.name, "project_name": p.name,
        "category": p.category, "type": p.type, "location": p.location, "latitude": p.latitude, "longitude": p.longitude,
        "district": p.district, "constituency": p.constituency, "agency": agency_name, "agency_name": agency_name,
        "agency_id": p.agency_id, "mp_name": mp_name, "project_initiator": mp_name or "Member of Parliament",
        "officer_name": officer_name, "assigned_officer_name": officer_name, "monitoring_officer": officer_name,
        "monitoring_officer_name": officer_name,
        "description": p.description, "sanctioned_amount": f(p.sanctioned_amount),
        "approved_budget": f(p.approved_budget), "released_amount": f(p.released_amount),
        "expenditure": f(p.expenditure), "progress": p.progress, "planned_progress": p.planned_progress,
        "start_date": iso(p.start_date), "deadline": iso(p.deadline), "revised_deadline": iso(p.revised_deadline),
        "completion_date": iso(p.completion_date), "expected_days": p.expected_days, "delay_days": p.delay_days,
        "status": p.status, "public_status": public_status(p), "rating_avg": rating_avg, "rating_count": rating_count,
        "risk_score": risk_score, "risk_level": risk_level, "risk_updated_at": risk_updated_at,
        "public_safe_risk_factors": safe_factors,
    }


def project_agency(p: Project) -> dict:
    d = project_public(p)
    d.pop("status", None)
    d.update({
        "remaining_amount": f(p.remaining_amount),
        "budget_revisions": p.budget_revisions, "extension_requests": p.extension_requests,
        "sanction_date": iso(p.sanction_date), "reporting_period": p.reporting_period,
        "milestones": p.milestones or [], "agency_status": agency_status(p),
    })
    return d


def risk_summary(r: RiskAnalysis | None) -> dict | None:
    if not r:
        return None
    return {"risk_id": r.risk_id, "risk_score": r.risk_score, "risk_level": r.risk_level,
            "anomaly_score": r.anomaly_score, "rule_score": r.rule_score, "timestamp": iso(r.timestamp),
            "model_version": r.model_version}


def project_internal(p: Project, latest: RiskAnalysis | None = None) -> dict:
    d = project_agency(p)
    d.update({
        "mp_id": p.mp_id, "officer_id": p.officer_id,
        "status": p.status, "case_level": p.case_level, "verification_status": p.verification_status,
        "is_public": p.is_public, "is_historical": p.is_historical, "created_at": iso(p.created_at),
        "verified_at": iso(p.verified_at), "agency_id": p.agency_id, "latest_risk": risk_summary(latest),
    })
    return d


def risk_full(r: RiskAnalysis) -> dict:
    from ml import config as C
    snap = r.input_snapshot or {}
    return {**risk_summary(r), "contributing_factors": r.contributing_factors,
            "historical_comparison": r.historical_comparison, "input_snapshot": snap,
            "recommendation": snap.get("recommendation"), "payment_flags": snap.get("payment_flags", []),
            "status": "Officer Review Required" if r.risk_level != "Low" else "Routine Monitoring Suggested",
            "threshold_notice": C.THRESHOLD_NOTICE, "disclaimer": C.DISCLAIMER}


# ------------------------------------------------------------------ other entities
def payment(x: Payment) -> dict:
    return {"payment_id": x.payment_id, "paid_on": iso(x.paid_on), "amount": f(x.amount),
            "description": x.description, "reference": x.reference}


def document(x: Document, name_of: dict | None = None) -> dict:
    return {"document_id": x.document_id, "project_id": x.project_id, "document_type": x.document_type,
            "file_name": x.file_name, "content_type": x.content_type, "size_bytes": x.size_bytes, "version": x.version,
            "is_public": x.is_public, "visibility": getattr(x, "visibility", "INTERNAL"),
            "moderation_status": getattr(x, "moderation_status", "APPROVED"),
            "description": x.description, "uploaded_at": iso(x.uploaded_at),
            "uploaded_by": (name_of or {}).get(x.uploaded_by)}


def progress_report(x: ProgressReport) -> dict:
    return {"report_id": x.report_id, "project_id": x.project_id, "period_label": x.period_label,
            "reporting_week": x.reporting_week, "report_date": iso(x.report_date), "progress": x.progress,
            "planned_progress": x.planned_progress, "progress_change": x.progress_change or 0.0,
            "expenditure": f(x.expenditure), "delay_days": x.delay_days or 0,
            "reason_for_delay": x.reason_for_delay, "milestones_completed": x.milestones_completed or [],
            "issues": x.issues, "corrective_action": x.corrective_action, "next_week_plan": x.next_week_plan,
            "evidence": x.evidence or [], "delay_explanation": x.delay_explanation, "notes": x.notes,
            "created_at": iso(x.created_at)}


def review(x: Review, citizen: User | None = None) -> dict:
    return {"review_id": x.review_id, "project_id": x.project_id, "rating": x.rating, "comment": x.comment,
            "media": x.media or [], "status": getattr(x, "status", "Pending"),
            "moderated_at": iso(getattr(x, "moderated_at", None)),
            "created_at": iso(x.created_at), "author": mask_name(citizen.name if citizen else None)}


def officer_warning(x: OfficerWarning) -> dict:
    return {"warning_id": x.warning_id, "project_id": x.project_id, "agency_id": x.agency_id,
            "project_code": x.project.project_code if getattr(x, "project", None) else None,
            "project_name": x.project.name if getattr(x, "project", None) else None,
            "agency_name": x.agency.name if getattr(x, "agency", None) else None,
            "warning_type": x.warning_type, "severity": x.severity, "message": x.message,
            "status": x.status, "issued_by": x.issuer.name if getattr(x, "issuer", None) else "Automated System",
            "created_at": iso(x.created_at), "resolved_at": iso(x.resolved_at)}


def project_assignment_history(x: ProjectAssignmentHistory) -> dict:
    return {"history_id": x.history_id, "project_id": x.project_id,
            "previous_agency": x.previous_agency.name if getattr(x, "previous_agency", None) else None,
            "new_agency": x.new_agency.name if getattr(x, "new_agency", None) else None,
            "previous_officer": x.previous_officer.name if getattr(x, "previous_officer", None) else None,
            "new_officer": x.new_officer.name if getattr(x, "new_officer", None) else None,
            "changed_by": x.changer.name if getattr(x, "changer", None) else None,
            "reason": x.reason, "created_at": iso(x.created_at)}


def agency_request(x: AgencyRequest, project: Project | None = None, decided_by_name: str | None = None, agency_name: str | None = None) -> dict:
    ag_name = agency_name or (x.agency.name if getattr(x, "agency", None) else None)
    if not ag_name and project and getattr(project, "agency", None):
        ag_name = project.agency.name
    return {
        "request_id": x.request_id, "project_id": x.project_id,
        "project_code": project.project_code if project else None, "project_name": project.name if project else None,
        "agency_name": ag_name, "submitted_by_name": ag_name,
        "request_type": x.request_type, "requested_deadline": iso(x.requested_deadline),
        "requested_amount": f(x.requested_amount), "justification": x.justification,
        "reason": x.justification, "status": x.status,
        "decision_note": x.decision_note, "decision_reason": x.decision_note,
        "decided_by": decided_by_name, "reviewed_by": decided_by_name or "Monitoring Officer",
        "created_at": iso(x.created_at), "submission_date": iso(x.created_at),
        "decided_at": iso(x.decided_at), "decision_date": iso(x.decided_at),
    }


def clarification(x: Clarification, project: Project | None = None, requester: User | None = None) -> dict:
    return {"clarification_id": x.clarification_id, "project_id": x.project_id,
            "project_code": project.project_code if project else None, "project_name": project.name if project else None,
            "question": x.question, "response": x.response, "status": x.status, "due_date": iso(x.due_date),
            "requested_by": requester.name if requester else None, "created_at": iso(x.created_at),
            "responded_at": iso(x.responded_at)}


def inspection(x: Inspection, project: Project | None = None, names: dict | None = None) -> dict:
    n = names or {}
    return {
        "inspection_id": x.inspection_id, "project_id": x.project_id,
        "project_code": project.project_code if project else None, "project_name": project.name if project else None,
        "reason": x.reason, "priority": x.priority, "status": x.status, "scheduled_date": iso(x.scheduled_date),
        "due_date": iso(x.due_date), "findings": x.findings, "recommendation": x.recommendation,
        "outcome": x.outcome, "requested_by": n.get(x.requested_by), "requested_by_id": x.requested_by,
        "assigned_to": n.get(x.assigned_to), "assigned_to_id": x.assigned_to, "requested_at": iso(x.requested_at),
        "completed_at": iso(x.completed_at), "closed_at": iso(x.closed_at),
        "action_required": getattr(x, "action_required", None),
        "responsible_party": getattr(x, "responsible_party", None),
        "action_taken": getattr(x, "action_taken", None),
        "action_date": iso(getattr(x, "action_date", None)),
        "closure_reason": getattr(x, "closure_reason", None),
        "progress_observed": getattr(x, "progress_observed", None),
        "issues": getattr(x, "issues", None),
    }


def inspection_public(x: Inspection, inspector_name: str | None = None, docs: list[Document] | None = None) -> dict:
    docs = docs or []
    # Filter public-safe images: content_type starts with image/ and is_public or visibility == 'PUBLIC', moderation_status != 'REJECTED'
    images = [
        document(d) for d in docs
        if (d.content_type or "").startswith("image/")
        and (d.is_public or getattr(d, "visibility", "INTERNAL") == "PUBLIC")
        and getattr(d, "moderation_status", "APPROVED") != "REJECTED"
    ]
    public_docs = [
        document(d) for d in docs
        if not (d.content_type or "").startswith("image/")
        and (d.is_public or getattr(d, "visibility", "INTERNAL") == "PUBLIC")
        and getattr(d, "moderation_status", "APPROVED") != "REJECTED"
    ]

    has_report = bool(x.findings and x.status in ("Report Submitted", "Action Pending", "Completed", "Closed"))
    display_status = x.status
    insp_date = x.scheduled_date or (x.completed_at.date() if x.completed_at else None)

    return {
        "inspection_id": x.inspection_id,
        "project_id": x.project_id,
        "inspection_date": iso(insp_date),
        "scheduled_date": iso(x.scheduled_date),
        "completed_date": iso(x.completed_at.date() if x.completed_at else None),
        "inspection_status": display_status,
        "status": x.status,
        "inspector_name": inspector_name,
        "inspector": inspector_name,
        "public_summary": x.findings if has_report else None,
        "public_findings": x.findings if has_report else None,
        "public_recommendations": x.recommendation if has_report else None,
        "public_outcome": x.outcome if has_report else None,
        "reason": x.reason,
        "action_required": getattr(x, "action_required", None) if has_report else None,
        "responsible_party": getattr(x, "responsible_party", None) if has_report else None,
        "action_taken": getattr(x, "action_taken", None) if has_report else None,
        "current_action": (getattr(x, "action_taken", None) or ("Action required by " + (getattr(x, "responsible_party", None) or "agency"))) if x.status == "Action Pending" else getattr(x, "action_taken", None),
        "action_date": iso(getattr(x, "action_date", None)) if has_report else None,
        "closure_reason": getattr(x, "closure_reason", None) if x.status == "Closed" else None,
        "closure_date": iso(getattr(x, "closed_at", None)) if x.status == "Closed" else None,
        "progress_observed": getattr(x, "progress_observed", None) if has_report else None,
        "issues": getattr(x, "issues", None) if has_report else None,
        "public_visibility": "PUBLIC",
        "inspection_images": images,
        "images": images,
        "documents": public_docs,
        "has_report": has_report,
    }


def decision(x: Decision, project: Project | None = None, names: dict | None = None) -> dict:
    return {"decision_id": x.decision_id, "project_id": x.project_id,
            "project_code": project.project_code if project else None, "project_name": project.name if project else None,
            "decision": x.decision, "role": x.role, "made_by": (names or {}).get(x.user_id), "reason": x.reason,
            "evidence_reviewed": x.evidence_reviewed or [], "follow_up_date": iso(x.follow_up_date), "action": x.action,
            "previous_status": x.previous_status, "new_status": x.new_status, "created_at": iso(x.created_at)}


def notification(x: Notification) -> dict:
    return {"notification_id": x.notification_id, "type": x.type, "message": x.message, "priority": x.priority,
            "status": x.status, "project_id": x.project_id, "entity_type": x.entity_type, "entity_id": x.entity_id,
            "created_at": iso(x.created_at)}


# ------------------------------------------------------------------ complaints
COMPLAINT_STEPS = ["Submitted", "Tracking ID issued", "Screening", "Assignment", "Investigation / inspection",
                   "Resolution", "Citizen feedback", "Appeal / Closed"]


def complaint_timeline(c: Complaint) -> list[dict]:
    screened = c.screening_status in ("Verified", "Rejected")
    assigned = c.screening_status == "Verified"
    invest = c.status in ("Under Investigation", "Resolved", "Closed", "Appealed") and assigned
    resolved = c.resolved_at is not None
    feedback = c.feedback_satisfied is not None
    end = c.status in ("Closed", "Appealed", "Rejected") or c.appeal_status in ("Upheld", "Rejected")
    done = [True, True, screened, assigned, invest, resolved, feedback, end]
    current = next((i for i, d in enumerate(done) if not d), len(done) - 1)
    if c.status == "Rejected":
        done = [True, True, True, False, False, False, False, True]
        current = 7
    return [{"step": s, "done": done[i], "current": i == current and not end} for i, s in enumerate(COMPLAINT_STEPS)]


def _complaint_base(c: Complaint, project: Project | None) -> dict:
    return {
        "complaint_id": c.complaint_id, "tracking_id": c.tracking_id, "project_id": c.project_id,
        "project_code": project.project_code if project else c.project_code_ref,
        "project_name": project.name if project else None, "category": c.category, "description": c.description,
        "incident_date": iso(c.incident_date), "location_text": c.location_text, "anonymous": c.anonymous,
        "status": c.status, "evidence": c.evidence or [], "created_at": iso(c.created_at),
        "updated_at": iso(c.updated_at),
    }


def complaint_for_citizen(c: Complaint, project: Project | None) -> dict:
    d = _complaint_base(c, project)
    d.update({
        "response": c.response, "resolution": c.resolution, "feedback_satisfied": c.feedback_satisfied,
        "feedback_rating": c.feedback_rating, "feedback_comment": c.feedback_comment, "appeal": c.appeal,
        "appeal_status": c.appeal_status, "appeal_decision_note": c.appeal_decision_note,
        "screening_status": c.screening_status, "timeline": complaint_timeline(c),
    })
    return d


def complaint_for_agency(c: Complaint, project: Project | None) -> dict:
    d = _complaint_base(c, project)
    d.pop("anonymous", None)
    d.update({"response": c.response, "responded_at": iso(c.responded_at), "serious": c.serious})
    return d


def complaint_for_officer(c: Complaint, project: Project | None, citizen: User | None) -> dict:
    d = _complaint_base(c, project)
    d.update({
        "citizen": "Anonymous" if c.anonymous else mask_name(citizen.name if citizen else None),
        "serious": c.serious, "screening_status": c.screening_status, "screening_note": c.screening_note,
        "response": c.response, "responded_at": iso(c.responded_at), "resolution": c.resolution,
        "feedback_satisfied": c.feedback_satisfied, "feedback_rating": c.feedback_rating,
        "feedback_comment": c.feedback_comment, "appeal": c.appeal, "appeal_status": c.appeal_status,
        "appeal_decision_note": c.appeal_decision_note, "timeline": complaint_timeline(c),
    })
    return d
