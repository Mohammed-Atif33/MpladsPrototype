"""Append-only, hash-chained audit trail.

* Every important event calls log_audit() inside the same DB transaction as the change.
* UPDATE / DELETE / TRUNCATE on audit_logs are rejected by a database trigger,
  so the audit trail is immutable from the application interface.
* Each row stores sha256(prev_hash + canonical record) -> tampering is detectable.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import AuditLog, User

IMMUTABLE_SQL = """
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
DROP TRIGGER IF EXISTS trg_audit_logs_truncate ON audit_logs;
CREATE TRIGGER trg_audit_logs_truncate BEFORE TRUNCATE ON audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
"""

_LOCK_KEY = 7_400_101


def install_immutability(conn) -> None:
    conn.exec_driver_sql(IMMUTABLE_SQL)


def _norm(value: Any) -> Any:
    """JSON round-trip so that what we hash is exactly what JSONB stores."""
    if value is None:
        return None
    return json.loads(json.dumps(value, default=str))


def _hash(prev_hash: str | None, rec: dict) -> str:
    payload = json.dumps(rec, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(((prev_hash or "GENESIS") + payload).encode("utf-8")).hexdigest()


def _record_dict(a: AuditLog) -> dict:
    ts = a.timestamp.astimezone(timezone.utc).isoformat()
    return {
        "user_id": a.user_id, "role": a.role, "action": a.action, "entity_type": a.entity_type,
        "entity_id": a.entity_id, "project_id": a.project_id, "previous_value": a.previous_value,
        "new_value": a.new_value, "reason": a.reason, "timestamp": ts,
    }


def log_audit(
    db: Session,
    user: User | None,
    action: str,
    entity_type: str | None = None,
    entity_id: Any = None,
    *,
    project_id: int | None = None,
    previous: Any = None,
    new: Any = None,
    reason: str | None = None,
    ip: str | None = None,
    role: str | None = None,
) -> AuditLog:
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK_KEY})
    last = db.execute(select(AuditLog.record_hash).order_by(AuditLog.audit_id.desc()).limit(1)).scalar()
    entry = AuditLog(
        user_id=user.user_id if user else None,
        user_name=user.name if user else None,
        role=role or (user.role if user else None),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        project_id=project_id,
        previous_value=_norm(previous),
        new_value=_norm(new),
        reason=reason,
        timestamp=datetime.now(timezone.utc),
        ip_address=ip,
        prev_hash=last,
    )
    entry.record_hash = _hash(last, _record_dict(entry))
    db.add(entry)
    db.flush()
    return entry


def verify_chain(db: Session) -> dict:
    rows = db.execute(select(AuditLog).order_by(AuditLog.audit_id)).scalars().all()
    prev = None
    for r in rows:
        if r.prev_hash != prev or r.record_hash != _hash(prev, _record_dict(r)):
            return {"valid": False, "checked": len(rows), "first_invalid_audit_id": r.audit_id}
        prev = r.record_hash
    return {"valid": True, "checked": len(rows), "first_invalid_audit_id": None}
