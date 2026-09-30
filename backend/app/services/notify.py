"""In-app notifications. Priority colours: info=blue, review=yellow, action=orange, critical=red."""
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..models import Notification, Project, User
from .audit import log_audit

PRIORITIES = {"info", "review", "action", "critical"}


def notify(
    db: Session,
    recipient_ids: Iterable[int],
    ntype: str,
    message: str,
    priority: str = "info",
    *,
    project_id: int | None = None,
    entity_type: str | None = None,
    entity_id=None,
    dedupe_key: str | None = None,
) -> int:
    assert priority in PRIORITIES
    created = 0
    for rid in set(recipient_ids):
        if dedupe_key:
            exists = db.execute(
                select(Notification.notification_id).where(
                    Notification.recipient_id == rid, Notification.dedupe_key == dedupe_key
                ).limit(1)
            ).first()
            if exists:
                continue
        db.add(Notification(
            recipient_id=rid, type=ntype, message=message, priority=priority,
            project_id=project_id, entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None, dedupe_key=dedupe_key,
        ))
        created += 1
    db.flush()
    if created:  # "Notification" is an audited event (system-generated)
        log_audit(db, None, "Notification", "Notification", ntype, project_id=project_id,
                  new={"type": ntype, "priority": priority, "recipients": created, "message": message[:200]},
                  reason="System-generated in-app notification", role="System")
    return created


def users_with_role(db: Session, role: str) -> list[int]:
    return [u for (u,) in db.execute(select(User.user_id).where(User.role == role, User.status == "Active"))]


def officers(db: Session) -> list[int]:
    return users_with_role(db, P.OFFICER)


def head_officers(db: Session) -> list[int]:
    return users_with_role(db, P.HEAD)


def mp_users(db: Session) -> list[int]:
    return users_with_role(db, P.MP)


def project_mp_users(db: Session, project: Project) -> list[int]:
    if project.mp_id:
        u = db.get(User, project.mp_id)
        if u and u.status == "Active":
            return [u.user_id]
    return mp_users(db)


def project_officer_users(db: Session, project: Project) -> list[int]:
    if project.officer_id:
        u = db.get(User, project.officer_id)
        if u and u.status == "Active":
            return [u.user_id]
    return officers(db)


def agency_users(db: Session, agency_id: int | None) -> list[int]:
    if not agency_id:
        return []
    return [u for (u,) in db.execute(
        select(User.user_id).where(User.role == P.AGENCY, User.agency_id == agency_id, User.status == "Active"))]


def project_agency_users(db: Session, project: Project) -> list[int]:
    return agency_users(db, project.agency_id)
