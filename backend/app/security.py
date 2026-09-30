import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import get_settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except ValueError:
        return False


# A pre-computed hash used to keep login timing similar for unknown users.
DUMMY_HASH = hash_password("not-a-real-password")


def create_access_token(user_id: int) -> tuple[str, str, datetime]:
    """Only the user id is placed in the token. Role/permissions are ALWAYS
    read from the database, so a token can never carry a forged role."""
    s = get_settings()
    jti = uuid.uuid4().hex
    exp = datetime.now(timezone.utc) + timedelta(minutes=s.jwt_expire_minutes)
    token = jwt.encode(
        {"sub": str(user_id), "jti": jti, "exp": exp, "iat": datetime.now(timezone.utc)},
        s.jwt_secret,
        algorithm=s.jwt_algorithm,
    )
    return token, jti, exp


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])


PASSWORD_RULE = "Password must be at least 8 characters and include a letter and a number."


def password_problem(pw: str | None) -> str | None:
    """Shared password policy (signup, admin-created accounts, resets, change-password)."""
    if not pw or len(pw) < 8 or len(pw) > 128 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return PASSWORD_RULE
    return None


def generate_password() -> str:
    """Readable one-time password (no look-alike characters) that satisfies the policy."""
    letters, digits = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", "23456789"
    chars = [secrets.choice(letters) for _ in range(7)] + [secrets.choice(digits) for _ in range(3)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)
