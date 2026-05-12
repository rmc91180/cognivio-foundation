from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid

import server as legacy


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class NotificationService:
    """
    Lightweight notification service used by access approval, tenancy, and audit flows.

    This service is intentionally safe in local/test environments:
    - it records notification intent when notification collections exist;
    - it delegates email delivery to existing legacy helpers when available;
    - it never raises if delivery infrastructure is unavailable.
    """

    def __init__(self, db: Any = None) -> None:
        self.db = db or getattr(legacy, "db", None)

    async def create_notification(
        self,
        *,
        user_id: Optional[str] = None,
        email: Optional[str] = None,
        notification_type: str = "general",
        title: str = "",
        message: str = "",
        payload: Optional[Dict[str, Any]] = None,
        status: str = "queued",
    ) -> Dict[str, Any]:
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "email": email,
            "type": notification_type,
            "title": title,
            "message": message,
            "payload": payload or {},
            "status": status,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }

        collection = getattr(self.db, "notifications", None) if self.db else None
        if collection is not None:
            try:
                await collection.insert_one(doc)
            except Exception:
                legacy.logger.warning("Unable to persist notification", exc_info=True)

        return doc

    async def send_access_request_notification(
        self,
        *,
        target_user: Optional[Dict[str, Any]] = None,
        actor: Optional[Dict[str, Any]] = None,
        action: str = "updated",
        reason: Optional[str] = None,
        workspace_name: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        target_user = target_user or kwargs.get("user") or {}
        email = target_user.get("email") or kwargs.get("email")
        user_id = target_user.get("id") or kwargs.get("user_id")

        title = "Access request updated"
        message = f"Your Cognivio access request was {action}."
        if workspace_name:
            message = f"{message} Workspace: {workspace_name}."
        if reason:
            message = f"{message} Note: {reason}"

        notification = await self.create_notification(
            user_id=user_id,
            email=email,
            notification_type="access_request",
            title=title,
            message=message,
            payload={
                "action": action,
                "reason": reason,
                "workspace_name": workspace_name,
                "actor": actor or {},
                **kwargs,
            },
            status="sent",
        )

        return notification

    async def send_access_approved(
        self,
        target_user: Dict[str, Any],
        workspace_name: Optional[str] = None,
        *,
        actor_label: Optional[str] = None,
        reason: Optional[str] = None,
        approval_note: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        resolved_reason = approval_note if approval_note is not None else reason

        if hasattr(legacy, "_send_access_approved_confirmation"):
            try:
                legacy._send_access_approved_confirmation(target_user)
            except TypeError:
                try:
                    legacy._send_access_approved_confirmation(target_user, reason=resolved_reason)
                except TypeError:
                    try:
                        legacy._send_access_approved_confirmation(
                            target_user,
                            workspace_name,
                            resolved_reason,
                        )
                    except Exception:
                        legacy.logger.warning("Access approval email helper failed", exc_info=True)
                except Exception:
                    legacy.logger.warning("Access approval email helper failed", exc_info=True)
            except Exception:
                legacy.logger.warning("Access approval email helper failed", exc_info=True)

        return await self.send_access_request_notification(
            target_user=target_user,
            action="approved",
            reason=resolved_reason,
            workspace_name=workspace_name,
            actor={"label": actor_label},
            **kwargs,
        )

    async def send_access_rejected(
        self,
        target_user: Dict[str, Any],
        workspace_name: Optional[str] = None,
        *,
        actor_label: Optional[str] = None,
        reason: Optional[str] = None,
        rejection_note: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        resolved_reason = rejection_note if rejection_note is not None else reason

        return await self.send_access_request_notification(
            target_user=target_user,
            action="rejected",
            reason=resolved_reason,
            workspace_name=workspace_name,
            actor={"label": actor_label},
            **kwargs,
        )

    async def notify_user(
        self,
        user_id: Optional[str] = None,
        *,
        email: Optional[str] = None,
        title: str = "",
        message: str = "",
        notification_type: str = "general",
        payload: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        return await self.create_notification(
            user_id=user_id,
            email=email,
            notification_type=notification_type,
            title=title,
            message=message,
            payload={**(payload or {}), **kwargs},
            status="sent",
        )


__all__ = ["NotificationService"]