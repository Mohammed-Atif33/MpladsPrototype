from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require
from ..models import Notification, User
from ..services import serializers as S

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(status: str | None = None, limit: int = 100, user: User = Depends(require("notification:view")),
                       db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.recipient_id == user.user_id).order_by(Notification.created_at.desc()).limit(min(limit, 300))
    if status:
        stmt = stmt.where(Notification.status == status)
    rows = db.execute(stmt).scalars().all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.recipient_id == user.user_id, Notification.status == "Unread")) or 0
    return {"items": [S.notification(n) for n in rows], "unread": unread}


@router.get("/unread-count")
def unread_count(user: User = Depends(require("notification:view")), db: Session = Depends(get_db)):
    unread = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.recipient_id == user.user_id, Notification.status == "Unread")) or 0
    return {"unread": unread}


@router.put("/read-all")
def read_all(user: User = Depends(require("notification:view")), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.recipient_id == user.user_id, Notification.status == "Unread")
               .values(status="Read", read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"unread": 0}


@router.put("/{notification_id}/read")
def mark_read(notification_id: int, user: User = Depends(require("notification:view")), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if not n or n.recipient_id != user.user_id:   # users can only touch their own notifications
        raise HTTPException(404, "Notification not found.")
    if n.status != "Read":
        n.status, n.read_at = "Read", datetime.now(timezone.utc)
        db.commit()
    return S.notification(n)
