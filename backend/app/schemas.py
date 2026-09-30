"""Request bodies (input validation). Responses are built by services/serializers.py so that
each role only ever receives the fields it is allowed to see."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

import re

from pydantic import BaseModel, Field, field_validator

from .security import password_problem

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def _email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 255 or not EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


def _password(v: str) -> str:
    problem = password_problem(v)
    if problem:
        raise ValueError(problem)
    return v


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=128)

    _pw = field_validator("new_password")(lambda cls, v: _password(v))


class RegisterIn(BaseModel):
    """Public self-signup. There is deliberately NO role field: signup can only ever create a Citizen."""
    name: str = Field(min_length=2, max_length=120)
    email: str
    password: str = Field(max_length=128)
    district: str | None = Field(default=None, max_length=80)

    _e = field_validator("email")(lambda cls, v: _email(v))
    _pw = field_validator("password")(lambda cls, v: _password(v))

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = re.sub(r"\s+", " ", v).strip()
        if len(v) < 2:
            raise ValueError("Enter your full name.")
        return v


class UserCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str
    role: Literal["Citizen", "Implementing Agency", "Officer", "Head Officer", "Admin", "MP"]
    agency_id: int | None = None
    department: str | None = Field(default=None, max_length=120)
    district: str | None = Field(default=None, max_length=80)
    constituency: str | None = Field(default=None, max_length=80)
    is_inspector: bool = False
    password: str | None = Field(default=None, max_length=128)   # blank -> a one-time password is generated

    _e = field_validator("email")(lambda cls, v: _email(v))


class UserUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    role: Literal["Citizen", "Implementing Agency", "Officer", "Head Officer", "Admin", "MP"] | None = None
    agency_id: int | None = None
    department: str | None = Field(default=None, max_length=120)
    district: str | None = Field(default=None, max_length=80)
    constituency: str | None = Field(default=None, max_length=80)
    is_inspector: bool | None = None
    status: Literal["Active", "Disabled"] | None = None
    reason: str | None = Field(default=None, max_length=300)


class PasswordResetIn(BaseModel):
    new_password: str | None = Field(default=None, max_length=128)  # blank -> generated


class ForgotPasswordIn(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)


class MPProjectCreateIn(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    category: str = Field(min_length=2, max_length=60)
    type: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=3000)
    location: str = Field(min_length=2, max_length=200)
    district: str = Field(min_length=2, max_length=80)
    constituency: str = Field(min_length=2, max_length=80)
    sanctioned_amount: float = Field(gt=0)
    approved_budget: float | None = Field(default=None, gt=0)
    released_amount: float = Field(default=0, ge=0)
    expected_expenditure: float | None = Field(default=None, ge=0)
    current_expenditure: float | None = Field(default=0, ge=0)
    start_date: date
    deadline: date
    expected_days: int | None = Field(default=None, gt=0)
    agency_id: int
    officer_id: int
    supporting_doc_ids: list[int] = Field(default_factory=list)


class ProjectReassignIn(BaseModel):
    agency_id: int | None = None
    officer_id: int | None = None
    reason: str = Field(min_length=5, max_length=2000)


class ExtractionEditIn(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    payments: list[dict[str, Any]] | None = None
    reason: str | None = Field(default=None, max_length=500)


class ExtractionVerifyIn(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    payments: list[dict[str, Any]] | None = None
    acknowledge_warnings: bool = False
    analyze: bool = True
    publish_to_citizens: bool = True
    reason: str | None = Field(default=None, max_length=500)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)
    media: list[dict[str, Any]] | None = Field(default_factory=list)


class ReviewModerateIn(BaseModel):
    decision: Literal["Approve", "Reject"]
    note: str | None = Field(default=None, max_length=1000)


class ProgressReportIn(BaseModel):
    progress: float = Field(ge=0, le=100)
    expenditure: float = Field(ge=0)
    period_label: str | None = Field(default=None, max_length=80)
    reporting_week: str | None = Field(default=None, max_length=50)
    planned_progress: float | None = Field(default=None, ge=0, le=100)
    progress_change: float | None = Field(default=0.0, ge=0, le=100)
    delay_days: int | None = Field(default=0, ge=0)
    reason_for_delay: str | None = Field(default=None, max_length=3000)
    milestones_completed: list[str] | None = Field(default_factory=list)
    issues: str | None = Field(default=None, max_length=3000)
    corrective_action: str | None = Field(default=None, max_length=3000)
    next_week_plan: str | None = Field(default=None, max_length=3000)
    evidence: list[dict[str, Any]] | None = Field(default_factory=list)
    delay_explanation: str | None = Field(default=None, max_length=3000)
    notes: str | None = Field(default=None, max_length=3000)


class WeeklyReportIn(BaseModel):
    reporting_week: str = Field(min_length=1, max_length=50)
    planned_progress: float = Field(ge=0, le=100)
    progress: float = Field(ge=0, le=100)
    progress_change: float | None = Field(default=0.0, ge=0, le=100)
    expenditure: float = Field(ge=0)
    delay_days: int | None = Field(default=0, ge=0)
    reason_for_delay: str | None = Field(default=None, max_length=3000)
    milestones_completed: list[str] | None = Field(default_factory=list)
    issues: str | None = Field(default=None, max_length=3000)
    corrective_action: str | None = Field(default=None, max_length=3000)
    next_week_plan: str | None = Field(default=None, max_length=3000)
    evidence: list[dict[str, Any]] | None = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=3000)


class WarningCreateIn(BaseModel):
    warning_type: Literal[
        "Weekly Report Missing", "Progress Update Required", "Evidence Required",
        "Clarification Required", "Other Action Required"
    ]
    severity: Literal["Reminder", "Warning", "Urgent"] = "Warning"
    message: str = Field(min_length=5, max_length=3000)


class AgencyRequestIn(BaseModel):
    request_type: Literal["Extension", "Budget Change"]
    requested_deadline: date | None = None
    requested_amount: float | None = Field(default=None, gt=0)
    justification: str = Field(min_length=10, max_length=3000)


class RequestDecisionIn(BaseModel):
    decision: Literal["Approve", "Reject"]
    note: str = Field(min_length=3, max_length=2000)


class ClarificationIn(BaseModel):
    project_id: int
    question: str = Field(min_length=10, max_length=3000)
    due_date: date | None = None


class ClarificationRespondIn(BaseModel):
    response: str = Field(min_length=3, max_length=3000)


class ComplaintUpdateIn(BaseModel):
    action: Literal["screen", "respond", "resolve", "feedback", "appeal", "decide_appeal", "close", "investigate"]
    # screen
    verdict: Literal["verified", "rejected"] | None = None
    serious: bool | None = None
    note: str | None = Field(default=None, max_length=3000)
    # respond / resolve / appeal / feedback
    text: str | None = Field(default=None, max_length=4000)
    satisfied: bool | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    # decide_appeal
    outcome: Literal["uphold", "reject"] | None = None


class InspectionCreateIn(BaseModel):
    project_id: int
    reason: str = Field(min_length=10, max_length=3000)
    priority: Literal["Low", "Medium", "High", "Urgent"] = "Medium"


class InspectionUpdateIn(BaseModel):
    action: Literal["assign", "schedule", "complete", "submit_report", "action_pending", "record_action", "close"]
    inspector_id: int | None = None
    due_date: date | None = None
    scheduled_date: date | None = None
    priority: Literal["Low", "Medium", "High", "Urgent"] | None = None
    findings: str | None = Field(default=None, max_length=5000)
    recommendation: str | None = Field(default=None, max_length=3000)
    outcome: Literal["Satisfactory", "Minor Deficiencies", "Major Deficiencies", "Irregularities Found"] | None = None
    note: str | None = Field(default=None, max_length=3000)
    action_required: str | None = Field(default=None, max_length=3000)
    responsible_party: str | None = Field(default=None, max_length=120)
    action_taken: str | None = Field(default=None, max_length=3000)
    action_date: date | None = None
    closure_reason: str | None = Field(default=None, max_length=3000)
    progress_observed: float | None = Field(default=None, ge=0, le=100)
    issues: str | None = Field(default=None, max_length=3000)


OFFICER_DECISIONS = ["Clear for Routine Monitoring", "Request Clarification", "Request Inspection",
                     "Escalate to Head Officer", "Keep Under Review"]
HEAD_ACTIONS = ["Acknowledge", "Request Evidence", "Reopen", "Assign Inspection", "Add Supervisory Note",
                "Escalate Further", "Close Review"]


class DecisionIn(BaseModel):
    project_id: int
    decision: str
    reason: str = Field(min_length=10, max_length=4000)
    evidence_reviewed: list[str] = Field(default_factory=list)
    follow_up_date: date | None = None
    action: str | None = Field(default=None, max_length=2000)   # follow-up action
    # decision-specific extras
    priority: Literal["Low", "Medium", "High", "Urgent"] = "Medium"
    question: str | None = Field(default=None, max_length=3000)  # clarification question
    inspector_id: int | None = None
    due_date: date | None = None

    @field_validator("decision")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in OFFICER_DECISIONS + HEAD_ACTIONS:
            raise ValueError("Unknown decision")
        return v
