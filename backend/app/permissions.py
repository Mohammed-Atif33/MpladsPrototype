"""Role -> permission map. Seeded into the roles_permissions table; the API
reads permissions from the DATABASE (never from the client) on every request.

Least privilege: a role only gets what the specification lists for it.
"""

CITIZEN = "Citizen"
AGENCY = "Implementing Agency"
OFFICER = "Officer"
HEAD = "Head Officer"
ADMIN = "Admin"
MP = "MP"

ROLES = [CITIZEN, AGENCY, OFFICER, HEAD, ADMIN, MP]

# permission -> description
PERMISSION_DESCRIPTIONS = {
    "project:view_public": "View public projects and public financial information",
    "project:view_assigned": "View projects assigned to own agency",
    "project:view_all": "View every project with internal information",
    "project:upload_pdf": "Upload project PDF and run extraction",
    "project:verify": "Correct extracted data and verify/store a project",
    "project:run_analysis": "Run historical comparison and risk analysis",
    "project:view_risk": "View risk score, factors and historical comparison",
    "project:create_mp": "Create new project manually as MP",
    "project:assign_mp": "Assign or reassign agency/officer to project",
    "project:update_progress": "Update progress/expenditure and submit progress reports",
    "document:upload": "Upload evidence photos/documents",
    "document:view_internal": "View internal/source documents",
    "review:submit": "Submit citizen review",
    "review:moderate": "Moderate citizen reviews and review media",
    "complaint:submit": "Submit, track, give feedback on and appeal own complaints",
    "complaint:respond": "Respond to complaints on own agency projects",
    "complaint:review": "Screen, assign and resolve complaints",
    "complaint:view": "View citizen complaints across projects",
    "complaint:appeal_decide": "Decide citizen appeals",
    "request:submit": "Request extension / budget change",
    "request:review": "Approve or reject agency requests",
    "request:view": "View agency extension and budget requests",
    "warning:issue": "Issue officer warnings to implementing agencies",
    "clarification:request": "Request clarification from an agency",
    "clarification:respond": "Respond to officer clarification",
    "inspection:request": "Request an inspection",
    "inspection:assign": "Assign an inspection to an inspector",
    "inspection:conduct": "Schedule, complete and report on assigned inspections",
    "inspection:view": "View inspections",
    "decision:record": "Record officer decisions (clear/clarify/inspect/escalate/keep)",
    "decision:supervise": "Head Officer supervisory actions",
    "decision:view": "View decisions",
    "notification:view": "View own notifications",
    "audit:view": "View audit trail",
    "audit:summary": "View audit summaries and verify audit chain",
    "system:run_checks": "Run scheduled supervisory checks",
    "agency:manage": "Manage implementing agencies (Admin)",
    "user:admin": "Administer users",
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    CITIZEN: [
        "project:view_public", "review:submit", "complaint:submit", "notification:view",
    ],
    AGENCY: [
        "project:view_assigned", "project:update_progress", "document:upload",
        "complaint:respond", "request:submit", "clarification:respond", "notification:view",
    ],
    OFFICER: [
        "project:view_all", "project:upload_pdf", "project:verify", "project:run_analysis",
        "project:view_risk", "document:upload", "document:view_internal",
        "complaint:review", "complaint:view", "request:review", "request:view", "clarification:request", "warning:issue",
        "review:moderate", "inspection:request", "inspection:conduct", "inspection:view",
        "decision:record", "decision:view", "notification:view", "audit:view",
    ],
    HEAD: [
        "project:view_all", "project:run_analysis", "project:view_risk",
        "document:view_internal", "complaint:review", "complaint:view", "complaint:appeal_decide",
        "review:moderate", "inspection:assign", "inspection:conduct", "inspection:view",
        "decision:supervise", "decision:view", "notification:view", "request:view",
        "audit:view", "audit:summary", "system:run_checks", "clarification:request",
    ],
    ADMIN: ["user:admin", "agency:manage", "review:moderate", "audit:view", "audit:summary", "notification:view"],
    MP: [
        "project:create_mp", "project:assign_mp", "project:view_all", "project:view_risk",
        "document:upload", "document:view_internal", "inspection:view", "decision:view",
        "complaint:view", "request:view", "notification:view", "audit:view",
    ],
}

# Statuses used across the app
PROJECT_STATUSES = [
    "Verified - Analysis Pending",
    "Officer Review Required",
    "Under Review",
    "Clarification Requested",
    "Inspection Requested",
    "Cleared - Routine Monitoring",
    "Escalated to Head Officer",
    "Escalated Further",
    "Supervisory Review",
    "Evidence Requested",
    "Reopened",
    "Closed",
]
