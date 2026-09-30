"""SQLAlchemy models = the PostgreSQL schema (see database/schema.sql for the export).

Spec tables: users, roles_permissions, agencies, projects, documents, complaints,
risk_analysis, inspections, decisions, notifications, audit_logs.
Additional tables added because the specified workflows need them:
extractions (PDF staging w/ confidence + source page), payments, progress_reports,
reviews, agency_requests (extension / budget change), clarifications, revoked_tokens.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer,
                        Numeric, String, Text, UniqueConstraint)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


TS = DateTime(timezone=True)
MONEY = Numeric(14, 2)


class User(Base):
    __tablename__ = "users"
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(40), index=True)
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    district: Mapped[str | None] = mapped_column(String(80), nullable=True)
    constituency: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_inspector: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="Active")
    last_login: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    agency: Mapped["Agency | None"] = relationship(foreign_keys=[agency_id])


class RolePermission(Base):
    __tablename__ = "roles_permissions"
    __table_args__ = (UniqueConstraint("role_name", "permission"),)
    role_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_name: Mapped[str] = mapped_column(String(40), index=True)
    permission: Mapped[str] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(TS)


class Agency(Base):
    __tablename__ = "agencies"
    agency_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    district: Mapped[str | None] = mapped_column(String(80))
    constituency: Mapped[str | None] = mapped_column(String(80))
    total_projects: Mapped[int] = mapped_column(Integer, default=0)
    completed_projects: Mapped[int] = mapped_column(Integer, default=0)
    delayed_projects: Mapped[int] = mapped_column(Integer, default=0)
    average_delay: Mapped[float] = mapped_column(Float, default=0.0)
    complaints: Mapped[int] = mapped_column(Integer, default=0)
    inspections: Mapped[int] = mapped_column(Integer, default=0)
    previous_high_risk_cases: Mapped[int] = mapped_column(Integer, default=0)
    historical_performance: Mapped[float] = mapped_column(Float, default=70.0)  # 0-100 (higher=better)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (Index("ix_projects_cat_dist", "category", "district"),)
    project_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60), index=True)
    location: Mapped[str | None] = mapped_column(String(200))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    district: Mapped[str | None] = mapped_column(String(80), index=True)
    constituency: Mapped[str | None] = mapped_column(String(80))
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"), index=True)
    mp_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), index=True, nullable=True)
    officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), index=True, nullable=True)
    type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    description: Mapped[str | None] = mapped_column(Text)
    sanction_date: Mapped[date | None] = mapped_column(Date)
    sanctioned_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    approved_budget: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    released_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    expenditure: Mapped[Decimal] = mapped_column(MONEY, default=0)
    remaining_amount: Mapped[Decimal] = mapped_column(MONEY, default=0)
    progress: Mapped[float] = mapped_column(Float, default=0)            # actual %
    planned_progress: Mapped[float | None] = mapped_column(Float)        # expected %
    start_date: Mapped[date | None] = mapped_column(Date)
    deadline: Mapped[date | None] = mapped_column(Date)                  # original deadline
    revised_deadline: Mapped[date | None] = mapped_column(Date)
    completion_date: Mapped[date | None] = mapped_column(Date)
    expected_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    as_of_date: Mapped[date | None] = mapped_column(Date)                # reporting period end
    reporting_period: Mapped[str | None] = mapped_column(String(80))
    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    budget_revisions: Mapped[int] = mapped_column(Integer, default=0)
    extension_requests: Mapped[int] = mapped_column(Integer, default=0)
    milestones: Mapped[list | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(60), default="Verified - Analysis Pending", index=True)
    verification_status: Mapped[str] = mapped_column(String(30), default="Verified")
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    is_historical: Mapped[bool] = mapped_column(Boolean, default=False)
    case_level: Mapped[int] = mapped_column(Integer, default=0)  # 0 none, 1 officer, 2 head officer, 3 further escalation
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    verified_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)

    agency: Mapped["Agency | None"] = relationship(foreign_keys=[agency_id])
    mp: Mapped["User | None"] = relationship(foreign_keys=[mp_id])
    officer: Mapped["User | None"] = relationship(foreign_keys=[officer_id])


class ProjectAssignmentHistory(Base):
    __tablename__ = "project_assignment_history"
    history_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    previous_agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"), nullable=True)
    new_agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"), nullable=True)
    previous_officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    new_officer_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)

    previous_agency: Mapped["Agency | None"] = relationship(foreign_keys=[previous_agency_id])
    new_agency: Mapped["Agency | None"] = relationship(foreign_keys=[new_agency_id])
    previous_officer: Mapped["User | None"] = relationship(foreign_keys=[previous_officer_id])
    new_officer: Mapped["User | None"] = relationship(foreign_keys=[new_officer_id])
    changer: Mapped["User | None"] = relationship(foreign_keys=[changed_by])


class Payment(Base):
    __tablename__ = "payments"
    payment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    paid_on: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    description: Mapped[str | None] = mapped_column(String(255))
    reference: Mapped[str | None] = mapped_column(String(80))


class ProgressReport(Base):
    __tablename__ = "progress_reports"
    report_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"))
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    period_label: Mapped[str | None] = mapped_column(String(80))
    reporting_week: Mapped[str | None] = mapped_column(String(50), nullable=True)
    report_date: Mapped[date] = mapped_column(Date)
    progress: Mapped[float] = mapped_column(Float)
    planned_progress: Mapped[float | None] = mapped_column(Float)
    progress_change: Mapped[float | None] = mapped_column(Float, default=0.0)
    expenditure: Mapped[Decimal] = mapped_column(MONEY)
    delay_days: Mapped[int | None] = mapped_column(Integer, default=0)
    reason_for_delay: Mapped[str | None] = mapped_column(Text, nullable=True)
    milestones_completed: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    issues: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_week_plan: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    delay_explanation: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class OfficerWarning(Base):
    __tablename__ = "officer_warnings"
    warning_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    agency_id: Mapped[int | None] = mapped_column(ForeignKey("agencies.agency_id"), index=True, nullable=True)
    issued_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    warning_type: Mapped[str] = mapped_column(String(60))
    severity: Mapped[str] = mapped_column(String(20), default="Warning")
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="Active")
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)

    project: Mapped["Project"] = relationship(foreign_keys=[project_id])
    agency: Mapped["Agency | None"] = relationship(foreign_keys=[agency_id])
    issuer: Mapped["User | None"] = relationship(foreign_keys=[issued_by])


class Extraction(Base):
    """PDF-extraction staging record. A project row is created only after an
    officer verifies the data ("Do not analyze unverified extracted data")."""
    __tablename__ = "extractions"
    extraction_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.document_id"))
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    status: Mapped[str] = mapped_column(String(30), default="Pending Verification", index=True)
    fields: Mapped[dict] = mapped_column(JSONB)          # key -> {label, group, value, original, confidence, source_page, edited}
    payments: Mapped[list] = mapped_column(JSONB, default=list)
    milestones: Mapped[list] = mapped_column(JSONB, default=list)
    validation: Mapped[dict | None] = mapped_column(JSONB)
    notes: Mapped[dict | None] = mapped_column(JSONB)    # page_count, ocr_used, text_chars, ...
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    verified_at: Mapped[datetime | None] = mapped_column(TS)


class Document(Base):
    __tablename__ = "documents"
    document_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id"), index=True)
    complaint_id: Mapped[int | None] = mapped_column(ForeignKey("complaints.complaint_id"))
    inspection_id: Mapped[int | None] = mapped_column(ForeignKey("inspections.inspection_id"))
    document_type: Mapped[str] = mapped_column(String(50))   # Project Report, Photo, Progress Evidence, Complaint Evidence, ...
    file_name: Mapped[str] = mapped_column(String(255))       # original name (display only)
    file_path: Mapped[str] = mapped_column(String(500))       # server-generated path under UPLOAD_DIR
    content_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    visibility: Mapped[str] = mapped_column(String(20), default="INTERNAL")  # PUBLIC | INTERNAL
    moderation_status: Mapped[str] = mapped_column(String(20), default="APPROVED")  # PENDING | APPROVED | REJECTED
    description: Mapped[str | None] = mapped_column(String(255))
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    uploaded_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("project_id", "citizen_id"),)
    review_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    media: Mapped[list | None] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)  # Pending | Approved | Rejected
    moderated_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    moderated_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    moderation_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class Complaint(Base):
    __tablename__ = "complaints"
    complaint_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tracking_id: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id"), index=True)
    project_code_ref: Mapped[str | None] = mapped_column(String(40), index=True)  # linked to project on ingestion
    citizen_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text)
    incident_date: Mapped[date | None] = mapped_column(Date)
    location_text: Mapped[str | None] = mapped_column(String(255))
    evidence: Mapped[list | None] = mapped_column(JSONB)   # [{document_id, file_name}]
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(30), default="Submitted", index=True)
    serious: Mapped[bool] = mapped_column(Boolean, default=False)
    screening_status: Mapped[str] = mapped_column(String(20), default="Pending")  # Pending | Verified | Rejected
    screened_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    screened_at: Mapped[datetime | None] = mapped_column(TS)
    screening_note: Mapped[str | None] = mapped_column(Text)  # INTERNAL - never sent to citizens/agencies
    response: Mapped[str | None] = mapped_column(Text)        # agency response
    responded_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    responded_at: Mapped[datetime | None] = mapped_column(TS)
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    resolved_at: Mapped[datetime | None] = mapped_column(TS)
    feedback_satisfied: Mapped[bool | None] = mapped_column(Boolean)
    feedback_rating: Mapped[int | None] = mapped_column(Integer)
    feedback_comment: Mapped[str | None] = mapped_column(Text)
    appeal: Mapped[str | None] = mapped_column(Text)
    appeal_status: Mapped[str] = mapped_column(String(20), default="None")  # None | Pending | Upheld | Rejected
    appeal_decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)


class AgencyRequest(Base):
    __tablename__ = "agency_requests"
    request_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    agency_id: Mapped[int] = mapped_column(ForeignKey("agencies.agency_id"))
    request_type: Mapped[str] = mapped_column(String(30))  # Extension | Budget Change
    requested_deadline: Mapped[date | None] = mapped_column(Date)
    requested_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    justification: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="Pending", index=True)
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(TS)


class Clarification(Base):
    __tablename__ = "clarifications"
    clarification_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    agency_id: Mapped[int] = mapped_column(ForeignKey("agencies.agency_id"))
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    question: Mapped[str] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)
    responded_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    status: Mapped[str] = mapped_column(String(20), default="Open", index=True)  # Open | Responded | Closed
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(TS)


class RiskAnalysis(Base):
    __tablename__ = "risk_analysis"
    risk_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    risk_score: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))
    contributing_factors: Mapped[list] = mapped_column(JSONB)
    historical_comparison: Mapped[dict] = mapped_column(JSONB)
    anomaly_score: Mapped[float | None] = mapped_column(Float)
    rule_score: Mapped[float | None] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(60))
    input_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    analyzed_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    timestamp: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)


class Inspection(Base):
    __tablename__ = "inspections"
    inspection_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    reason: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    status: Mapped[str] = mapped_column(String(30), default="Requested", index=True)
    scheduled_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    findings: Mapped[str | None] = mapped_column(Text)
    recommendation: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(String(60))
    evidence: Mapped[list | None] = mapped_column(JSONB)
    action_required: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_party: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action_taken: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_date: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    closure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_observed: Mapped[float | None] = mapped_column(Float, nullable=True)
    issues: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(TS)
    closed_at: Mapped[datetime | None] = mapped_column(TS)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)


class Decision(Base):
    __tablename__ = "decisions"
    decision_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.project_id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    role: Mapped[str] = mapped_column(String(40))
    decision: Mapped[str] = mapped_column(String(60))
    reason: Mapped[str] = mapped_column(Text)
    evidence_reviewed: Mapped[list | None] = mapped_column(JSONB)
    follow_up_date: Mapped[date | None] = mapped_column(Date)
    action: Mapped[str | None] = mapped_column(Text)           # follow-up action
    risk_id: Mapped[int | None] = mapped_column(ForeignKey("risk_analysis.risk_id"))
    previous_status: Mapped[str | None] = mapped_column(String(60))
    new_status: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notif_recipient_status", "recipient_id", "status"),)
    notification_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    type: Mapped[str] = mapped_column(String(50))
    message: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(10), default="info")  # info(blue) review(yellow) action(orange) critical(red)
    status: Mapped[str] = mapped_column(String(10), default="Unread")
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id"))
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    dedupe_key: Mapped[str | None] = mapped_column(String(120), index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(TS)


class AuditLog(Base):
    """Append-only. UPDATE/DELETE are blocked by a database trigger (see services/audit.py),
    and each row carries a hash chained to the previous row (tamper evidence)."""
    __tablename__ = "audit_logs"
    audit_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    user_name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[str | None] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(60))
    project_id: Mapped[int | None] = mapped_column(Integer, index=True)
    previous_value: Mapped[dict | list | str | None] = mapped_column(JSONB)
    new_value: Mapped[dict | list | str | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    record_hash: Mapped[str | None] = mapped_column(String(64))
