from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.services.notification_inbox_service import (
    NotificationListResponse,
    NotificationPreferencesPayload,
    NotificationRecord,
    dismiss_notification,
    get_notification_preferences,
    get_notification_unread_count,
    list_notifications,
    mark_all_notifications_read,
    mark_all_notifications_read_alias,
    mark_notification_read,
    update_notification_preferences,
)


router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=NotificationListResponse)
async def list_notifications_route(
    unread_only: Optional[bool] = None,
    limit: int = 20,
    page: int = 1,
    current_user: dict = Depends(get_current_user),
):
    return await list_notifications(unread_only, limit, page, current_user=current_user)


@router.get("/notifications/unread-count")
async def get_notification_unread_count_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_notification_unread_count(current_user)


@router.post("/notifications/{notification_id}/read", response_model=NotificationRecord)
async def mark_notification_read_route(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await mark_notification_read(notification_id, current_user)


@router.post("/notifications/read-all")
async def mark_all_notifications_read_route(
    current_user: dict = Depends(get_current_user),
):
    return await mark_all_notifications_read(current_user)


@router.post("/notifications/mark-all-read")
async def mark_all_notifications_read_alias_route(
    current_user: dict = Depends(get_current_user),
):
    return await mark_all_notifications_read_alias(current_user)


@router.delete("/notifications/{notification_id}")
async def dismiss_notification_route(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await dismiss_notification(notification_id, current_user)


@router.get("/user/notification-preferences")
async def get_notification_preferences_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_notification_preferences(current_user)


@router.patch("/user/notification-preferences")
async def update_notification_preferences_route(
    payload: NotificationPreferencesPayload,
    current_user: dict = Depends(get_current_user),
):
    return await update_notification_preferences(payload, current_user)
