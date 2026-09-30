"""Authentication + RBAC dependencies.

The role is ALWAYS read from PostgreSQL. The JWT only identifies the user; it never carries
a role, so a forged/edited token cannot escalate privileges.
"""
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import RevokedToken, RolePermission, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def _unauth(msg: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, msg, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise _unauth("Please log in to continue.")
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauth("Your session has expired. Please log in again.")
    except jwt.PyJWTError:
        raise _unauth("Invalid authentication token.")
    if db.get(RevokedToken, payload.get("jti")):
        raise _unauth("You have been logged out. Please log in again.")
    user = db.get(User, int(payload["sub"]))
    if not user or user.status != "Active":
        raise _unauth("Account not available.")
    perms = {p for (p,) in db.execute(select(RolePermission.permission).where(RolePermission.role_name == user.role))}
    user._perms = perms  # type: ignore[attr-defined]
    user._jti = payload["jti"]  # type: ignore[attr-defined]
    user._token_exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)  # type: ignore[attr-defined]
    request.state.user = user
    return user


def has_perm(user: User, permission: str) -> bool:
    return permission in getattr(user, "_perms", set())


def require(*permissions: str):
    """Dependency factory: user must hold ALL listed permissions."""

    def dep(user: User = Depends(get_current_user)) -> User:
        missing = [p for p in permissions if not has_perm(user, p)]
        if missing:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action.")
        return user

    return dep


def require_any(*permissions: str):
    def dep(user: User = Depends(get_current_user)) -> User:
        if not any(has_perm(user, p) for p in permissions):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action.")
        return user

    return dep


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
