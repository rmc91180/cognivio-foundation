"""Foundation seam for the notification inbox + preferences cluster.

These signatures are the stable contract for the in-app notification inbox
(list/read/dismiss + unread-count) and per-user notification preferences —
the live repo can later swap implementations behind them without touching
call sites.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

import server as legacy


class NotificationRecord(BaseModel):
    id: str
    workspace_id: Optional[str] = None
    recipient_user_id: Optional[str] = None
    type: Optional[str] = None
    payload: Dict[str, Any] = {}
    read: bool = False
    teacher_id: Optional[str] = None
    notification_type: Optional[str] = None
    title: Optional[str] = None
    message: Optional[str] = None
    body: Optional[str] = None
    cta_url: Optional[str] = None
    action_url: Optional[str] = None
    channel: str = "email"
    status: str = "queued"
    created_at: str
    read_at: Optional[str] = None
    emailed: bool = False


class NotificationListResponse(BaseModel):
    items: List[NotificationRecord]
    unread_count: int = 0


class NotificationPreferencesPayload(BaseModel):
    email_observation_complete: bool = True
    email_goal_added: bool = True
    email_recognition: bool = True
    email_conference_reminder: bool = True
    email_frequency: str = "immediate"


def sanitize_notification_doc(doc: dict) -> dict:
    clean = {k: v for k, v in (doc or {}).items() if k not in {"_id", "user_id"}}
    notification_type = clean.get("type") or clean.get("notification_type") or "notification"
    clean["type"] = notification_type
    clean["notification_type"] = notification_type
    clean["payload"] = clean.get("payload") or {}
    clean["read"] = bool(clean.get("read") or clean.get("read_at"))
    clean["body"] = clean.get("body") or clean.get("message")
    clean["message"] = clean.get("message") or clean.get("body")
    clean["action_url"] = clean.get("action_url") or clean.get("cta_url")
    clean["cta_url"] = clean.get("cta_url") or clean.get("action_url")
    clean["emailed"] = bool(clean.get("emailed"))
    clean.setdefault("channel", "in_app")
    clean.setdefault("status", "queued")
    return clean


def default_notification_preferences(user_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": user_id,
        "user_id": user_id,
        "email_observation_complete": True,
        "email_goal_added": True,
        "email_recognition": True,
        "email_conference_reminder": True,
        "email_frequency": "immediate",
        "created_at": now,
        "updated_at": None,
    }


async def list_notifications(
    unread_only: Optional[bool] = None,
    limit: int = 20,
    page: int = 1,
    *,
    current_user: dict,
):
    query: Dict[str, Any] = {
        "$or": [
            {"recipient_user_id": current_user["id"]},
            {"user_id": current_user["id"]},
        ]
    }
    if unread_only:
        query["$and"] = [{"$or": [{"read": False}, {"read": {"$exists": False}}]}, {"read_at": None}]
    limit = max(1, min(int(limit or 20), 100))
    skip = max(0, int(page or 1) - 1) * limit
    unread_query: Dict[str, Any] = {
        "$or": [
            {"recipient_user_id": current_user["id"]},
            {"user_id": current_user["id"]},
        ],
        "$and": [{"$or": [{"read": False}, {"read": {"$exists": False}}]}, {"read_at": None}],
    }
    unread_count = await legacy.db.notifications.count_documents(unread_query)
    notifications = await legacy.db.notifications.find(
        query,
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1).skip(skip).to_list(limit)
    return NotificationListResponse(
        items=[NotificationRecord(**sanitize_notification_doc(n)) for n in notifications],
        unread_count=unread_count,
    )


async def get_notification_unread_count(current_user: dict):
    cached = legacy._notification_unread_count_cache.get(current_user["id"])
    now_ts = time.time()
    if cached and now_ts - cached[0] < 30:
        return {"count": cached[1]}
    unread_query: Dict[str, Any] = {
        "$or": [
            {"recipient_user_id": current_user["id"]},
            {"user_id": current_user["id"]},
        ],
        "$and": [{"$or": [{"read": False}, {"read": {"$exists": False}}]}, {"read_at": None}],
    }
    count = await legacy.db.notifications.count_documents(unread_query)
    legacy._notification_unread_count_cache[current_user["id"]] = (now_ts, count)
    return {"count": count}


async def mark_notification_read(
    notification_id: str,
    current_user: dict,
):
    read_at = datetime.now(timezone.utc).isoformat()
    result = await legacy.db.notifications.find_one_and_update(
        {
            "id": notification_id,
            "$or": [
                {"recipient_user_id": current_user["id"]},
                {"user_id": current_user["id"]},
            ],
        },
        {"$set": {"read": True, "read_at": read_at}},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notification not found")
    legacy._notification_unread_count_cache.pop(current_user["id"], None)
    return NotificationRecord(**sanitize_notification_doc(result))


async def mark_all_notifications_read(current_user: dict):
    read_at = datetime.now(timezone.utc).isoformat()
    result = await legacy.db.notifications.update_many(
        {
            "$or": [
                {"recipient_user_id": current_user["id"]},
                {"user_id": current_user["id"]},
            ],
            "$and": [{"$or": [{"read": False}, {"read": {"$exists": False}}]}, {"read_at": None}],
        },
        {"$set": {"read": True, "read_at": read_at}},
    )
    legacy._notification_unread_count_cache.pop(current_user["id"], None)
    return {"updated_count": result.modified_count, "read_at": read_at}


async def mark_all_notifications_read_alias(current_user: dict):
    return await mark_all_notifications_read(current_user=current_user)


async def dismiss_notification(
    notification_id: str,
    current_user: dict,
):
    result = await legacy.db.notifications.delete_one(
        {
            "id": notification_id,
            "$or": [
                {"recipient_user_id": current_user["id"]},
                {"user_id": current_user["id"]},
            ],
        }
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    legacy._notification_unread_count_cache.pop(current_user["id"], None)
    return {"deleted": True}


async def get_notification_preferences(current_user: dict):
    prefs = await legacy.db.notification_preferences.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0},
    )
    return prefs or default_notification_preferences(current_user["id"])


async def update_notification_preferences(
    payload: NotificationPreferencesPayload,
    current_user: dict,
):
    frequency = (payload.email_frequency or "immediate").strip().lower()
    if frequency not in {"immediate", "daily_digest", "off"}:
        raise HTTPException(status_code=400, detail="Unsupported email frequency")
    now = datetime.now(timezone.utc).isoformat()
    update_doc = payload.dict()
    update_doc["email_frequency"] = frequency
    update_doc["updated_at"] = now
    existing = await legacy.db.notification_preferences.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not existing:
        update_doc.update({"id": current_user["id"], "user_id": current_user["id"], "created_at": now})
        await legacy.db.notification_preferences.insert_one(update_doc)
    else:
        await legacy.db.notification_preferences.update_one(
            {"user_id": current_user["id"]},
            {"$set": update_doc},
        )
    return await get_notification_preferences(current_user=current_user)
