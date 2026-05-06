from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import server as legacy
from app.services import auth_service


security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    token = auth_service.resolve_auth_token(request, credentials)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = auth_service.verify_access_token(token)
    user = await legacy.db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    session_id = payload.get("sid")
    if session_id:
        session = await legacy.db.user_sessions.find_one({"id": session_id}, {"_id": 0})
        if not session or session.get("revoked_at"):
            raise HTTPException(status_code=401, detail="Session expired")

    approval_status = auth_service.get_user_approval_status(user)
    if approval_status == "pending":
        raise HTTPException(status_code=403, detail="Account pending approval")
    if approval_status == "revoked" or not auth_service.is_user_access_active(user):
        raise HTTPException(status_code=403, detail="Account access removed")

    preview_user = await _resolve_preview_user(request, user, session_id)
    if preview_user:
        return preview_user

    user["role"] = auth_service.get_user_role(user)
    user["approval_status"] = approval_status
    user["is_preview_mode"] = False
    user["preview_source_user_id"] = None
    user["preview_source_email"] = None
    user["preview_source_name"] = None
    user["preview_source_tenant_role"] = None
    if session_id:
        user["session_id"] = session_id
    return user


async def _resolve_preview_user(request: Request, user: dict, session_id: Optional[str]) -> Optional[dict]:
    preview_target_id = str((getattr(request, "headers", None) or {}).get("X-Cognivio-Preview-User") or "").strip()
    if not preview_target_id or auth_service.get_tenant_role(user) != "super_admin":
        return None
    preview_target = await legacy.db.users.find_one({"id": preview_target_id}, {"_id": 0, "password": 0})
    if not preview_target or auth_service.get_user_approval_status(preview_target) != "approved":
        return None
    if not auth_service.is_user_access_active(preview_target):
        return None
    preview_payload = auth_service.build_user_response_payload(preview_target)
    preview_payload["is_preview_mode"] = True
    preview_payload["preview_source_user_id"] = user.get("id")
    preview_payload["preview_source_email"] = user.get("email")
    preview_payload["preview_source_name"] = user.get("name")
    preview_payload["preview_source_tenant_role"] = auth_service.get_tenant_role(user)
    if session_id:
        preview_payload["session_id"] = session_id
    return preview_payload


def require_role(*roles: str):
    allowed = {role for role in roles if role}

    async def _require_role(current_user: dict = Depends(get_current_user)) -> dict:
        tenant_role = auth_service.get_tenant_role(current_user)
        legacy_role = auth_service.get_user_role(current_user)
        if tenant_role not in allowed and legacy_role not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user

    return _require_role


async def require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if auth_service.get_tenant_role(current_user) != "super_admin":
        raise HTTPException(status_code=403, detail="Master administrator access required")
    return current_user


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not auth_service.is_admin_role(auth_service.get_user_role(current_user)):
        raise HTTPException(status_code=403, detail="Administrator access required")
    return current_user
