import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..config import get_settings
from ..database import get_db
from ..deps import client_ip, get_current_user
from ..demo_accounts import LOGIN_HINTS
from ..models import Notification, RevokedToken, RolePermission, User
from ..schemas import ChangePasswordIn, ForgotPasswordIn, LoginIn, RegisterIn
from ..security import DUMMY_HASH, create_access_token, hash_password, verify_password
from ..services.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])

HOME_BY_ROLE = {P.CITIZEN: "/citizen", P.AGENCY: "/agency", P.OFFICER: "/officer", P.HEAD: "/head", P.ADMIN: "/admin", P.MP: "/mp"}


def user_payload(db: Session, user: User) -> dict:
    perms = sorted(p for (p,) in db.execute(select(RolePermission.permission).where(RolePermission.role_name == user.role)))
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.recipient_id == user.user_id, Notification.status == "Unread")) or 0
    return {
        "user_id": user.user_id, "name": user.name, "email": user.email, "role": user.role,
        "agency_id": user.agency_id, "agency_name": user.agency.name if user.agency else None,
        "department": user.department, "district": user.district, "constituency": user.constituency,
        "is_inspector": user.is_inspector, "status": user.status,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "permissions": perms, "home_path": HOME_BY_ROLE.get(user.role, "/"), "unread_notifications": unread,
    }


@router.get("/config")
def public_config():
    s = get_settings()
    return {
        "app_name": "MPLADS Risk Intelligence Platform",
        "show_demo_credentials": s.show_demo_credentials,
        "signup_enabled": s.allow_signup,
        "demo_accounts": [{"email": e, "role": r, "password": s.demo_password} for e, r in LOGIN_HINTS]
        if s.show_demo_credentials else [],
    }


_signup_hits: dict[str, deque] = defaultdict(deque)


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Public citizen self-signup. Always creates a Citizen - the role can never come from the client.
    Officers, Head Officers, Agency users and Admins are created by an administrator only."""
    s = get_settings()
    if not s.allow_signup:
        raise HTTPException(403, "Self-registration is disabled. Please contact the administrator.")
    ip = client_ip(request) or "unknown"
    hits = _signup_hits[ip]
    now_ts = time.time()
    while hits and now_ts - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= s.signup_limit_per_hour:
        raise HTTPException(429, "Too many sign-up attempts from this network. Please try again later.")
    hits.append(now_ts)

    if db.scalar(select(User.user_id).where(func.lower(User.email) == body.email)):
        raise HTTPException(409, "An account with this email already exists. Try logging in instead.")
    now = datetime.now(timezone.utc)
    user = User(name=body.name, email=body.email, password_hash=hash_password(body.password), role=P.CITIZEN,
                district=body.district, status="Active", last_login=now)
    db.add(user)
    db.flush()
    log_audit(db, user, "Account Registered", "User", user.user_id, new={"role": P.CITIZEN, "email": user.email},
              reason="Citizen self-registration", ip=client_ip(request))
    token, jti, exp = create_access_token(user.user_id)
    db.commit()
    return {"access_token": token, "token_type": "bearer", "expires_at": exp.isoformat(), "user": user_payload(db, user)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    s = get_settings()
    ident = body.identifier.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.email) == ident))
    if not user and ident.isdigit():
        user = db.get(User, int(ident))
    now = datetime.now(timezone.utc)
    ip = client_ip(request)

    if user and user.locked_until and user.locked_until > now:
        mins = int((user.locked_until - now).total_seconds() // 60) + 1
        log_audit(db, user, "Login Failed", "User", user.user_id, reason="Account temporarily locked", ip=ip)
        db.commit()
        raise HTTPException(429, f"Too many failed attempts. Try again in {mins} minute(s).")

    ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not ok or user.status != "Active":
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= s.max_failed_logins:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_attempts = 0
        log_audit(db, user, "Login Failed", "User", user.user_id if user else ident,
                  reason="Invalid credentials" if user else "Unknown user", ip=ip, role=user.role if user else None)
        db.commit()
        raise HTTPException(401, "Invalid email/user ID or password.")

    user.failed_attempts, user.locked_until, user.last_login = 0, None, now
    token, jti, exp = create_access_token(user.user_id)
    log_audit(db, user, "Login", "User", user.user_id, reason="Successful login", ip=ip)
    db.commit()
    return {"access_token": token, "token_type": "bearer", "expires_at": exp.isoformat(), "user": user_payload(db, user)}


@router.post("/logout")
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.merge(RevokedToken(jti=user._jti, expires_at=user._token_exp))  # type: ignore[attr-defined]
    log_audit(db, user, "Logout", "User", user.user_id, ip=client_ip(request))
    db.commit()
    return {"message": "Logged out."}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_payload(db, user)


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordIn):
    """Placeholder: no email is sent in the prototype."""
    return {"message": "If an account exists for this ID, password-reset instructions would be sent. "
                       "(Placeholder - password reset is not implemented in the prototype; contact the administrator.)"}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    log_audit(db, user, "Password Changed", "User", user.user_id, ip=client_ip(request))
    db.commit()
    return {"message": "Password updated."}
