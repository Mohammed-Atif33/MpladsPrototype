"""Officer decisions, Head Officer supervisory actions and scheduled supervisory checks.
Every action: (1) updates state, (2) creates a Decision row, (3) raises notifications, (4) writes an audit record."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..models import (Clarification, Complaint, Decision, Inspection, Notification,
                      OfficerWarning, ProgressReport, Project, RiskAnalysis, User)
from ..schemas import HEAD_ACTIONS, OFFICER_DECISIONS, DecisionIn
from . import notify
from .audit import log_audit
from .stats import latest_risk_map

EVIDENCE_OPTIONS = ["Risk factors", "Historical comparison", "Source documents", "Extracted data",
                    "Agency history", "Citizen feedback / complaints", "Inspection reports", "Agency explanation"]

OPEN_CASE_STATUSES = ("Officer Review Required", "Under Review", "Escalated to Head Officer", "Supervisory Review",
                      "Evidence Requested", "Reopened", "Escalated Further", "Clarification Requested", "Inspection Requested")


def _fail(msg: str, code: int = 422):
    raise HTTPException(code, msg)


def apply_decision(db: Session, user: User, project: Project, body: DecisionIn, ip: str | None = None) -> Decision:
    is_head = user.role == P.HEAD
    allowed = HEAD_ACTIONS if is_head else OFFICER_DECISIONS
    if body.decision not in allowed:
        raise HTTPException(403, "This decision type is not available for your role.")
    if body.decision in OFFICER_DECISIONS and user.role != P.OFFICER:
        raise HTTPException(403, "Only Officers can record this decision.")
    if body.decision in HEAD_ACTIONS and user.role != P.HEAD:
        raise HTTPException(403, "Only the Head Officer can perform this action.")

    latest = latest_risk_map(db, [project.project_id]).get(project.project_id)
    if not latest:
        _fail("This project has not been analysed yet. Run the risk analysis before recording a decision.", 409)
    if not body.evidence_reviewed and body.decision != "Add Supervisory Note":
        _fail("Select the evidence you reviewed before recording a decision.")
    if not is_head and not (body.follow_up_date or (body.action and body.action.strip())):
        _fail("Provide a follow-up date or follow-up action.")

    prev_status, prev_level = project.status, project.case_level
    d = body.decision
    code = project.project_code
    level = latest.risk_level
    msg_ref = f"{code} ({project.name})"
    extra_new: dict = {}

    # ------------------------------------------------ officer decisions
    if d == "Clear for Routine Monitoring":
        project.status, project.case_level = "Cleared - Routine Monitoring", 0
        if level in ("High", "Critical"):
            notify.notify(db, notify.head_officers(db), "High-risk project cleared",
                          f"High-risk project cleared after investigation: {msg_ref} ({level}, {latest.risk_score:.0f}/100) "
                          f"cleared by {user.name}. Reason: {body.reason[:140]}",
                          "review", project_id=project.project_id, entity_type="Decision")
    elif d == "Request Clarification":
        if not project.agency_id:
            _fail("Project has no implementing agency to send the clarification to.")
        q = (body.question or body.reason).strip()
        c = Clarification(project_id=project.project_id, agency_id=project.agency_id, requested_by=user.user_id,
                          question=q, due_date=body.due_date or date.today() + timedelta(days=7))
        db.add(c)
        db.flush()
        project.status = "Clarification Requested"
        extra_new["clarification_id"] = c.clarification_id
        notify.notify(db, notify.project_agency_users(db, project), "Agency clarification",
                      f"Clarification requested for {msg_ref}: {q[:200]}", "action", project_id=project.project_id,
                      entity_type="Clarification", entity_id=c.clarification_id)
        log_audit(db, user, "Clarification Requested", "Clarification", c.clarification_id, project_id=project.project_id,
                  new={"question": q, "due_date": c.due_date}, reason=body.reason, ip=ip)
    elif d == "Request Inspection":
        insp = Inspection(project_id=project.project_id, requested_by=user.user_id, reason=body.reason,
                          priority=body.priority, status="Requested")
        db.add(insp)
        db.flush()
        project.status = "Inspection Requested"
        extra_new["inspection_id"] = insp.inspection_id
        notify.notify(db, notify.head_officers(db), "Inspection requested",
                      f"Inspection requested by {user.name} for {msg_ref} (priority {body.priority}). Assignment required.",
                      "action", project_id=project.project_id, entity_type="Inspection", entity_id=insp.inspection_id)
        log_audit(db, user, "Inspection Requested", "Inspection", insp.inspection_id, project_id=project.project_id,
                  new={"priority": body.priority, "status": "Requested"}, reason=body.reason, ip=ip)
    elif d == "Escalate to Head Officer":
        project.status, project.case_level = "Escalated to Head Officer", max(project.case_level or 0, 2)
        notify.notify(db, notify.head_officers(db), "Escalation",
                      f"Case escalated by {user.name}: {msg_ref} - {level} risk ({latest.risk_score:.0f}/100). "
                      f"Reason: {body.reason[:160]}", "critical" if level in ("High", "Critical") else "action",
                      project_id=project.project_id, entity_type="Decision")
    elif d == "Keep Under Review":
        project.status = "Under Review"

    # ------------------------------------------------ head officer actions
    elif d == "Acknowledge":
        project.status, project.case_level = "Supervisory Review", max(project.case_level or 0, 2)
        notify.notify(db, notify.officers(db), "Supervisory review",
                      f"Head Officer acknowledged {msg_ref} and has taken it under supervisory review.", "info",
                      project_id=project.project_id, entity_type="Decision")
    elif d == "Request Evidence":
        project.status = "Evidence Requested"
        notify.notify(db, notify.officers(db), "Supervisory review",
                      f"Head Officer requested additional evidence for {msg_ref}: {body.reason[:160]}", "action",
                      project_id=project.project_id, entity_type="Decision")
        notify.notify(db, notify.project_agency_users(db, project), "Agency clarification",
                      f"Additional evidence has been requested for {msg_ref}. Please upload supporting documents "
                      f"and respond to any open clarification.", "action", project_id=project.project_id)
    elif d == "Reopen":
        project.status, project.case_level = "Reopened", max(project.case_level or 0, 2)
        notify.notify(db, notify.officers(db), "Supervisory review",
                      f"Head Officer reopened {msg_ref}: {body.reason[:160]}", "action",
                      project_id=project.project_id, entity_type="Decision")
    elif d == "Assign Inspection":
        if not body.inspector_id:
            _fail("Select an inspector for the inspection.")
        inspector = db.get(User, body.inspector_id)
        if not inspector or not inspector.is_inspector or inspector.status != "Active":
            _fail("Selected inspector is not available.")
        insp = Inspection(project_id=project.project_id, requested_by=user.user_id, assigned_to=inspector.user_id,
                          assigned_by=user.user_id, reason=body.reason, priority=body.priority, status="Assigned",
                          due_date=body.due_date or date.today() + timedelta(days=14))
        db.add(insp)
        db.flush()
        project.status = "Inspection Requested"
        extra_new["inspection_id"] = insp.inspection_id
        notify.notify(db, [inspector.user_id], "Inspection requested",
                      f"You have been assigned an inspection of {msg_ref} (priority {body.priority}, due {insp.due_date}).",
                      "action", project_id=project.project_id, entity_type="Inspection", entity_id=insp.inspection_id)
        notify.notify(db, notify.officers(db), "Inspection requested",
                      f"Head Officer assigned an inspection for {msg_ref} to {inspector.name}.", "info",
                      project_id=project.project_id, entity_type="Inspection", entity_id=insp.inspection_id)
        log_audit(db, user, "Inspection Assigned", "Inspection", insp.inspection_id, project_id=project.project_id,
                  new={"assigned_to": inspector.name, "priority": body.priority, "due_date": insp.due_date}, reason=body.reason, ip=ip)
    elif d == "Add Supervisory Note":
        pass  # note only (stored as decision reason; never exposed outside Officer/Head Officer)
    elif d == "Escalate Further":
        project.status, project.case_level = "Escalated Further", 3
        notify.notify(db, notify.head_officers(db), "Escalation",
                      f"Case escalated further: {msg_ref} - {level} risk. {body.reason[:160]}", "critical",
                      project_id=project.project_id, entity_type="Decision")
    elif d == "Close Review":
        project.status, project.case_level = "Closed", 0
        notify.notify(db, notify.officers(db), "Decision completed",
                      f"Head Officer closed the review of {msg_ref}.", "info", project_id=project.project_id, entity_type="Decision")

    dec = Decision(project_id=project.project_id, user_id=user.user_id, role=user.role, decision=d, reason=body.reason,
                   evidence_reviewed=body.evidence_reviewed, follow_up_date=body.follow_up_date, action=body.action,
                   risk_id=latest.risk_id, previous_status=prev_status, new_status=project.status)
    db.add(dec)
    db.flush()

    # confirmation to the decision maker + last officer decision maker (for head officer actions)
    if is_head:
        last_officer = db.scalar(select(Decision.user_id).where(
            Decision.project_id == project.project_id, Decision.role == P.OFFICER).order_by(Decision.decision_id.desc()).limit(1))
        if last_officer:
            notify.notify(db, [last_officer], "Decision completed",
                          f"Head Officer action '{d}' recorded on {msg_ref}.", "info", project_id=project.project_id,
                          entity_type="Decision", entity_id=dec.decision_id)
    else:
        notify.notify(db, [user.user_id], "Decision completed",
                      f"Your decision '{d}' on {msg_ref} was recorded.", "info", project_id=project.project_id,
                      entity_type="Decision", entity_id=dec.decision_id)

    log_audit(db, user, "Escalation" if d in ("Escalate to Head Officer", "Escalate Further")
              else ("Head Officer Action" if is_head else "Decision"),
              "Project", code, project_id=project.project_id,
              previous={"status": prev_status, "case_level": prev_level},
              new={"decision": d, "status": project.status, "case_level": project.case_level, "decision_id": dec.decision_id,
                   "evidence_reviewed": body.evidence_reviewed, "follow_up_date": body.follow_up_date,
                   "follow_up_action": body.action, **extra_new},
              reason=body.reason, ip=ip)
    if prev_status != project.status:
        log_audit(db, user, "Status Change", "Project", code, project_id=project.project_id,
                  previous={"status": prev_status}, new={"status": project.status}, reason=f"Decision: {d}", ip=ip)
    return dec


# ---------------------------------------------------------------- scheduled / simulated checks
def run_supervisory_checks(db: Session, as_of: date, actor: User | None = None) -> dict:
    """Idempotent time-based checks (dedupe keys prevent duplicate notifications):
    overdue inspections, unresolved cases, overdue follow-ups, pending complaints, repeated agency risk patterns."""
    res = {"as_of": as_of.isoformat(), "overdue_inspections": 0, "unresolved_cases": 0, "overdue_followups": 0,
           "stale_complaints": 0, "repeated_patterns": 0, "notifications_created": 0}
    heads, officers = notify.head_officers(db), notify.officers(db)

    # 1. overdue inspections
    open_states = ("Requested", "Assigned", "Scheduled", "Completed")
    for insp in db.execute(select(Inspection).where(Inspection.status.in_(open_states), Inspection.due_date.is_not(None),
                                                    Inspection.due_date < as_of)).scalars():
        proj = db.get(Project, insp.project_id)
        n = notify.notify(db, heads + officers + ([insp.assigned_to] if insp.assigned_to else []), "Inspection overdue",
                          f"Inspection #{insp.inspection_id} for {proj.project_code} is overdue (due {insp.due_date}, status {insp.status}).",
                          "critical", project_id=insp.project_id, entity_type="Inspection", entity_id=insp.inspection_id,
                          dedupe_key=f"insp-overdue-{insp.inspection_id}")
        if n:
            res["overdue_inspections"] += 1
            res["notifications_created"] += n
            log_audit(db, actor, "Inspection Overdue", "Inspection", insp.inspection_id, project_id=insp.project_id,
                      new={"due_date": insp.due_date, "status": insp.status, "as_of": as_of}, reason="Scheduled supervisory check",
                      role=actor.role if actor else "System")

    # 2. unresolved cases: open for > 14 days since last decision/analysis
    for proj in db.execute(select(Project).where(Project.status.in_(OPEN_CASE_STATUSES), Project.is_historical.is_(False))).scalars():
        last_dec = db.scalar(select(func.max(Decision.created_at)).where(Decision.project_id == proj.project_id))
        last_risk = db.scalar(select(func.max(RiskAnalysis.timestamp)).where(RiskAnalysis.project_id == proj.project_id))
        last = max([t for t in (last_dec, last_risk) if t], default=None)
        if last and (as_of - last.date()).days > 14:
            n = notify.notify(db, heads, "Case unresolved",
                              f"Case remains unresolved: {proj.project_code} ({proj.status}) - no activity for {(as_of - last.date()).days} days.",
                              "review", project_id=proj.project_id, dedupe_key=f"unresolved-{proj.project_id}")
            if n:
                res["unresolved_cases"] += 1
                res["notifications_created"] += n

    # 3. overdue follow-ups on cases kept under review
    for dec in db.execute(select(Decision).where(Decision.follow_up_date.is_not(None), Decision.follow_up_date < as_of,
                                                 Decision.role == P.OFFICER)).scalars():
        proj = db.get(Project, dec.project_id)
        if proj.status == "Under Review":
            n = notify.notify(db, [dec.user_id], "Follow-up due",
                              f"Follow-up date {dec.follow_up_date} has passed for {proj.project_code}: {dec.action or dec.decision}",
                              "action", project_id=proj.project_id, dedupe_key=f"followup-{dec.decision_id}")
            if n:
                res["overdue_followups"] += 1
                res["notifications_created"] += n

    # 4. complaints waiting for screening > 7 days
    for c in db.execute(select(Complaint).where(Complaint.status == "Submitted")).scalars():
        if (as_of - c.created_at.date()).days > 7:
            n = notify.notify(db, officers, "Citizen complaint",
                              f"Complaint {c.tracking_id} has been waiting for screening for {(as_of - c.created_at.date()).days} days.",
                              "action", project_id=c.project_id, entity_type="Complaint", entity_id=c.complaint_id,
                              dedupe_key=f"complaint-stale-{c.complaint_id}")
            if n:
                res["stale_complaints"] += 1
                res["notifications_created"] += n

    # 5. repeated risk patterns per agency
    lr = latest_risk_map(db)
    by_agency: dict[int, int] = {}
    for pid, r in lr.items():
        if r.risk_level in ("High", "Critical"):
            proj = db.get(Project, pid)
            if proj and proj.agency_id:
                by_agency[proj.agency_id] = by_agency.get(proj.agency_id, 0) + 1
    from ..models import Agency
    for aid, cnt in by_agency.items():
        if cnt >= 3:
            ag = db.get(Agency, aid)
            n = notify.notify(db, heads, "Repeated risk pattern",
                              f"Repeated risk pattern: {ag.name} has {cnt} projects currently rated High/Critical.",
                              "review", dedupe_key=f"repeat-agency-{aid}-{cnt}")
            if n:
                res["repeated_patterns"] += 1
                res["notifications_created"] += n

    # 6. missing weekly reports for active projects (> 7 days)
    active_projects = db.execute(
        select(Project).where(
            Project.verification_status == "Verified",
            Project.is_historical.is_(False),
            Project.completion_date.is_(None),
            Project.progress < 100,
        )
    ).scalars().all()
    for proj in active_projects:
        latest_report_date = db.scalar(
            select(func.max(ProgressReport.report_date)).where(ProgressReport.project_id == proj.project_id)
        )
        ref_date = latest_report_date or proj.start_date or (as_of - timedelta(days=8))
        days_since = (as_of - ref_date).days
        if days_since > 7:
            dedupe = f"missing-report-{proj.project_id}-{(as_of - timedelta(days=days_since % 7)).isoformat()}"
            is_escalated = days_since > 14
            sev = "Urgent" if is_escalated else "Warning"
            msg = (f"Weekly progress report is missing for {proj.project_code} ({proj.name}). "
                   f"No update received for {days_since} days.")
            recipients = notify.project_agency_users(db, proj) + officers + notify.project_mp_users(db, proj)
            if is_escalated:
                recipients += heads
            n = notify.notify(db, recipients, "Weekly report missing", msg,
                              "critical" if is_escalated else "action",
                              project_id=proj.project_id, entity_type="Project", entity_id=proj.project_id,
                              dedupe_key=dedupe)
            if n:
                res["missing_weekly_reports"] = res.get("missing_weekly_reports", 0) + 1
                res["notifications_created"] += n
                warn = OfficerWarning(
                    project_id=proj.project_id, agency_id=proj.agency_id, issued_by=None,
                    warning_type="Weekly Report Missing", severity=sev, message=msg, status="Active",
                )
                db.add(warn)
                db.flush()
                log_audit(db, actor, "Warning Issued", "OfficerWarning", warn.warning_id, project_id=proj.project_id,
                          new={"warning_type": "Weekly Report Missing", "severity": sev, "days_overdue": days_since},
                          reason="Automated missing weekly report check", role=actor.role if actor else "System")

    log_audit(db, actor, "Supervisory Checks", "System", "scheduled-checks", new=res,
              reason="Time-based supervisory checks", role=actor.role if actor else "System")
    return res
