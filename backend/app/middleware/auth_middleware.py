from __future__ import annotations

from typing import Optional

import jwt
import server as legacy
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


security = HTTPBearer(auto_error=False)


def _extract_bearer_token(credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    if not credentials:
        return None

    token = getattr(credentials, "credentials", None)
    scheme = getattr(credentials, "scheme", "bearer")

    if not token:
        return None

    if str(scheme).lower() != "bearer":
        return None

    return token


def _extract_cookie_token(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None

    cookie_name = getattr(legacy, "SESSION_COOKIE_NAME", None) or "cognivio_session"
    token = request.cookies.get(cookie_name)
    if token:
        return token

    # Backward-compatible fallback names used by older local/dev flows.
    for fallback_name in ("access_token", "token", "session"):
        token = request.cookies.get(fallback_name)
        if token:
            return token

    return None


async def _find_user_from_payload(payload: dict) -> dict:
    user_id = payload.get("sub") or payload.get("user_id") or payload.get("id")
    email = payload.get("email")

    query = None
    if user_id:
        query = {"id": user_id}
    elif email:
        query = {"email": str(email).lower()}

    if not query:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        )

    user = await legacy.db.users.find_one(query, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if hasattr(legacy, "_is_user_access_active") and not legacy._is_user_access_active(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User access is not active",
        )

    return user


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """
    Resolve the authenticated Cognivio user from a bearer token or session cookie.

    This module intentionally delegates role/status logic to server.py where the
    legacy app keeps the canonical helpers. It exists as a thin middleware bridge
    for newer modular routes.
    """
    token = _extract_bearer_token(credentials) or _extract_cookie_token(request)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    try:
        payload = jwt.decode(
            token,
            legacy.JWT_SECRET,
            algorithms=[legacy.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token expired",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        ) from exc

    user = await _find_user_from_payload(payload)

    headers = getattr(request, "headers", {}) or {}
    preview_user_id = headers.get("X-Cognivio-Preview-User") if hasattr(headers, "get") else None

    if preview_user_id:
        role = str(user.get("role") or "").lower()
        tenant_role = str(user.get("tenant_role") or "").lower()
        email = str(user.get("email") or "").lower()
        super_admins = getattr(legacy, "SUPER_ADMIN_EMAILS", set()) or set()

        if role == "super_admin" or tenant_role == "super_admin" or email in super_admins:
            preview_user = await legacy.db.users.find_one(
                {"id": preview_user_id},
                {"_id": 0, "password": 0},
            )
            if preview_user:
                preview_user["is_preview_mode"] = True
                preview_user["previewed_by"] = user.get("id")
                preview_user["_previewed_by"] = user.get("id")
                preview_user["previewed_by_email"] = user.get("email")
                preview_user["preview_source_email"] = user.get("email")
                preview_user["preview_source_user_id"] = user.get("id")
                return preview_user

    return user


async def get_optional_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    try:
        return await get_current_user(request, credentials)
    except HTTPException:
        return None


def require_admin_user(current_user: dict) -> dict:
    role = legacy._get_user_role(current_user)
    tenant_role = legacy._get_user_tenant_role(current_user) if hasattr(legacy, "_get_user_tenant_role") else role

    if role != "admin" and tenant_role not in {"school_admin", "training_admin", "super_admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    return current_user


def require_super_admin_user(current_user: dict) -> dict:
    tenant_role = legacy._get_user_tenant_role(current_user) if hasattr(legacy, "_get_user_tenant_role") else None
    email = str(current_user.get("email") or "").lower()

    if tenant_role != "super_admin" and email not in getattr(legacy, "SUPER_ADMIN_EMAILS", set()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Master administrator access required",
        )

    return current_user


__all__ = [
    "security",
    "get_current_user",
    "get_optional_current_user",
    "require_admin_user",
    "require_super_admin_user",
]