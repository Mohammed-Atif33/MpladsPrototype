from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..models import Project, User


def project_or_404(db: Session, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p:
        raise HTTPException(404, "Project not found.")
    return p


def visible_project_or_404(db: Session, user: User, project_id: int) -> Project:
    """Returns the project only if this user is allowed to know it exists (404 otherwise, to avoid leaking IDs)."""
    p = db.get(Project, project_id)
    if not p or p.verification_status != "Verified":
        raise HTTPException(404, "Project not found.")
    if user.role == P.CITIZEN and not p.is_public:
        raise HTTPException(404, "Project not found.")
    if user.role == P.AGENCY and p.agency_id != user.agency_id:
        raise HTTPException(404, "Project not found.")
    if user.role == P.ADMIN:
        raise HTTPException(403, "You do not have permission to perform this action.")
    return p


def own_agency_project_or_404(db: Session, user: User, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p or p.agency_id is None or p.agency_id != user.agency_id:
        raise HTTPException(404, "Project not found.")
    return p


def names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.user_id: u.name for u in db.execute(select(User).where(User.user_id.in_(ids))).scalars()}


def page_params(page: int, page_size: int) -> tuple[int, int]:
    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    return (page - 1) * page_size, page_size
