"""Administrator user management. Only the Admin role (permission `user:admin`) can reach these endpoints.

Safeguards: an admin cannot disable / demote themselves, the last active admin can never be removed,
accounts are disabled rather than deleted (audit history keeps its meaning), passwords are never returned
except a one-time generated password shown once at creation / reset.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, require
from ..models import Agency, User
from ..schemas import PasswordResetIn, UserCreateIn, UserUpdateIn
from ..security import generate_password, hash_password, password_problem
from ..services import serializers as S
from ..services.audit import log_audit

router = APIRouter(prefix="/api/users", tags=["user-management"])


def _row(u: User) -> dict:
    return {"user_id": u.user_id, "name": u.name, "email": u.email, "role": u.role, "agency_id": u.agency_id,
            "agency": u.agency.name if u.agency else None, "department": u.department, "district": u.district,
            "constituency": u.constituency, "is_inspector": u.is_inspector, "status": u.status,
            "locked": bool(u.locked_until and u.locked_until > datetime.now(timezone.utc)),
            "last_login": S.iso(u.last_login), "created_at": S.iso(u.created_at)}


def _active_admins(db: Session, exclude: int | None = None) -> int:
    q = select(func.count()).select_from(User).where(User.role == P.ADMIN, User.status == "Active")
    if exclude:
        q = q.where(User.user_id != exclude)
    return db.scalar(q) or 0


def _check_role_rules(db: Session, role: str, agency_id: int | None, is_inspector: bool) -> tuple[int | None, bool]:
    """Agency users must belong to an agency; nobody else may. Only Officers can be field inspectors."""
    if role == P.AGENCY:
        if not agency_id or not db.get(Agency, agency_id):
            raise HTTPException(422, "Choose the implementing agency this user belongs to.")
    else:
        agency_id = None
    return agency_id, bool(is_inspector) and role == P.OFFICER


@router.get("")
def list_users(q: str | None = None, role: str | None = None, status: str | None = None,
               user: User = Depends(require("user:admin")), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.role, User.name)
    if role:
        stmt = stmt.where(User.role == role)
    if status:
        stmt = stmt.where(User.status == status)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like)))
    return [_row(u) for u in db.execute(stmt).scalars()]


@router.post("", status_code=201)
def create_user(body: UserCreateIn, request: Request, admin: User = Depends(require("user:admin")),
                db: Session = Depends(get_db)):
    if db.scalar(select(User.user_id).where(func.lower(User.email) == body.email)):
        raise HTTPException(409, "A user with this email already exists.")
    agency_id, inspector = _check_role_rules(db, body.role, body.agency_id, body.is_inspector)
    generated = None
    password = (body.password or "").strip()
    if password:
        problem = password_problem(password)
        if problem:
            raise HTTPException(422, problem)
    else:
        password = generated = generate_password()
    u = User(name=body.name.strip(), email=body.email, password_hash=hash_password(password), role=body.role,
             agency_id=agency_id, department=(body.department or None), district=(body.district or None),
             constituency=(body.constituency or None), is_inspector=inspector, status="Active")
    db.add(u)
    db.flush()
    log_audit(db, admin, "User Created", "User", u.user_id,
              new={"email": u.email, "name": u.name, "role": u.role, "agency_id": agency_id, "is_inspector": inspector,
                   "password": "generated" if generated else "set by administrator"},
              reason="Account created by administrator", ip=client_ip(request))
    db.commit()
    out = _row(u)
    if generated:
        out["temporary_password"] = generated      # shown once - never stored in clear text
    return out


@router.put("/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, request: Request, admin: User = Depends(require("user:admin")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found.")
    fields = body.model_fields_set
    new_role = body.role if "role" in fields and body.role else u.role
    new_status = body.status if "status" in fields and body.status else u.status

    if u.user_id == admin.user_id and (new_role != P.ADMIN or new_status != "Active"):
        raise HTTPException(409, "You cannot disable or demote your own account.")
    if u.role == P.ADMIN and u.status == "Active" and (new_role != P.ADMIN or new_status != "Active") \
            and _active_admins(db, exclude=u.user_id) == 0:
        raise HTTPException(409, "At least one active administrator must remain.")

    agency_id = body.agency_id if "agency_id" in fields else u.agency_id
    inspector = body.is_inspector if "is_inspector" in fields and body.is_inspector is not None else u.is_inspector
    agency_id, inspector = _check_role_rules(db, new_role, agency_id, inspector)

    before = {"name": u.name, "role": u.role, "agency_id": u.agency_id, "department": u.department, "district": u.district,
              "constituency": u.constituency, "is_inspector": u.is_inspector, "status": u.status}
    if "name" in fields and body.name:
        u.name = body.name.strip()
    u.role, u.agency_id, u.is_inspector, u.status = new_role, agency_id, inspector, new_status
    for f in ("department", "district", "constituency"):
        if f in fields:
            setattr(u, f, (getattr(body, f) or None))
    after = {"name": u.name, "role": u.role, "agency_id": u.agency_id, "department": u.department, "district": u.district,
             "constituency": u.constituency, "is_inspector": u.is_inspector, "status": u.status}
    changed = {k: v for k, v in after.items() if v != before[k]}
    if not changed:
        return _row(u)
    if u.status == "Active":
        u.failed_attempts, u.locked_until = 0, None
    action = ("User Disabled" if changed.get("status") == "Disabled" else "User Enabled" if changed.get("status") == "Active"
              else "User Role Changed" if "role" in changed else "User Updated")
    log_audit(db, admin, action, "User", u.user_id, previous={k: before[k] for k in changed}, new=changed,
              reason=body.reason or "Updated by administrator", ip=client_ip(request))
    db.commit()
    return _row(u)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, body: PasswordResetIn, request: Request, admin: User = Depends(require("user:admin")),
                   db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found.")
    password = (body.new_password or "").strip()
    generated = None
    if password:
        problem = password_problem(password)
        if problem:
            raise HTTPException(422, problem)
    else:
        password = generated = generate_password()
    u.password_hash = hash_password(password)
    u.failed_attempts, u.locked_until = 0, None
    log_audit(db, admin, "Password Reset", "User", u.user_id, new={"email": u.email, "password": "generated" if generated else "set by administrator"},
              reason="Password reset by administrator", ip=client_ip(request))
    db.commit()
    return {"user": _row(u), "temporary_password": generated}
