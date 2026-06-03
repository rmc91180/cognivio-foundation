from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt
import server as legacy
from fastapi import HTTPException, Request, Response


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


DELETED_APPROVAL_STATUSES = {"deleted", "hard_deleted", "account_deleted", "approval_deleted"}
REUSABLE_APPROVAL_STATUSES = DELETED_APPROVAL_STATUSES | {"rejected", "denied"}
LOGIN_ALLOWED_APPROVAL_STATUSES = {"approved", "active"}


def _structured_detail(message: str, reason_code: str, **extra: Any) -> Dict[str, Any]:
    return {
        "message": message,
        "reason_code": reason_code,
        **{key: value for key, value in extra.items() if value is not None},
    }


def _raise_auth_error(status_code: int, message: str, reason_code: str, **extra: Any) -> None:
    raise HTTPException(
        status_code=status_code,
        detail=_structured_detail(message, reason_code, **extra),
    )


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_status(value: Any, fallback: str = "") -> str:
    return str(value or fallback or "").strip().lower()


def _is_deleted_or_tombstoned_user(user_doc: Optional[Dict[str, Any]]) -> bool:
    if not user_doc:
        return False
    status = _normalize_status(user_doc.get("approval_status"))
    return (
        status in DELETED_APPROVAL_STATUSES
        or user_doc.get("account_deleted") is True
        or user_doc.get("approval_deleted") is True
        or user_doc.get("deleted_at") is not None
    )


def _blocks_new_access_request(user_doc: Optional[Dict[str, Any]]) -> bool:
    if not user_doc:
        return False
    status = _normalize_status(user_doc.get("approval_status"), "approved")
    if _is_deleted_or_tombstoned_user(user_doc) or status in {"rejected", "denied"}:
        return False
    return status in {"pending", "approved", "active", "revoked"} or user_doc.get("is_active") is False


async def _remove_reusable_user_record(email: str) -> None:
    if not email or not hasattr(legacy, "db") or getattr(legacy.db, "users", None) is None:
        return
    query = {
        "email": email,
        "$or": [
            {"approval_status": {"$in": list(REUSABLE_APPROVAL_STATUSES)}},
            {"account_deleted": True},
            {"approval_deleted": True},
            {"deleted_at": {"$ne": None}},
        ],
    }
    users = legacy.db.users
    try:
        if hasattr(users, "delete_many"):
            await users.delete_many(query)
        elif hasattr(users, "delete_one"):
            await users.delete_one({"email": email})
        elif hasattr(users, "docs"):
            users.docs = [
                doc
                for doc in getattr(users, "docs", [])
                if _normalize_email(doc.get("email")) != email or _blocks_new_access_request(doc)
            ]
    except Exception:
        pass

    escaped_email = re.escape(email)
    regex_query = {
        "email": {"$regex": f"^{escaped_email}$", "$options": "i"},
        "$or": query["$or"],
    }
    try:
        if hasattr(users, "delete_many"):
            await users.delete_many(regex_query)
        elif hasattr(users, "delete_one"):
            await users.delete_one({"email": {"$regex": f"^{escaped_email}$", "$options": "i"}})
    except Exception:
        pass

    # Test-double fallback only: a real Mongo Collection's ``.docs`` attribute is
    # a CHILD collection (iterating/bool() on it raises), so guard on the concrete
    # list type. On real Mongo the case-insensitive purge above (delete_many regex)
    # already did the work; here ``docs`` is not a list, so this is skipped.
    docs = getattr(users, "docs", None)
    if isinstance(docs, list):
        users.docs = [
            doc
            for doc in docs
            if _normalize_email(doc.get("email")) != email or _blocks_new_access_request(doc)
        ]


async def _find_user_by_email_case_insensitive(email: str, projection: Optional[Dict[str, int]] = None) -> Optional[Dict[str, Any]]:
    if not email or not hasattr(legacy, "db") or getattr(legacy.db, "users", None) is None:
        return None

    users = legacy.db.users
    normalized_email = _normalize_email(email)
    exact = await users.find_one({"email": normalized_email}, projection)
    if exact:
        return exact

    escaped_email = re.escape(normalized_email)
    try:
        cursor = users.find({"email": {"$regex": f"^{escaped_email}$", "$options": "i"}}, projection)
        matches = await cursor.to_list(2)
        if matches:
            return matches[0]
    except Exception:
        pass

    # In-memory test doubles expose a real ``.docs`` list. On a real Mongo
    # Collection, attribute access returns a CHILD collection, and bool()/
    # iteration on a Collection raises (NotImplementedError/TypeError) — so guard
    # on the concrete list type, never on truthiness. The real case-insensitive
    # lookup is the ``$regex`` query above; this block is the test-double
    # fallback only.
    docs = getattr(users, "docs", None)
    if isinstance(docs, list):
        for doc in docs:
            if _normalize_email(doc.get("email")) == normalized_email:
                if projection is None:
                    return dict(doc)
                payload = dict(doc)
                include_keys = {key for key, value in projection.items() if value}
                exclude_keys = {key for key, value in projection.items() if not value}
                if include_keys:
                    payload = {key: value for key, value in payload.items() if key in include_keys}
                for key in exclude_keys:
                    payload.pop(key, None)
                return payload

    return None


def _jwt_secret() -> str:
    return getattr(legacy, "JWT_SECRET", None) or os.getenv("JWT_SECRET", "")


def _jwt_algorithm() -> str:
    return getattr(legacy, "JWT_ALGORITHM", None) or os.getenv("JWT_ALGORITHM", "HS256")


def _jwt_expiration_hours() -> int:
    value = getattr(legacy, "JWT_EXPIRATION_HOURS", None) or os.getenv("JWT_EXPIRATION_HOURS", "24")
    try:
        return int(value)
    except Exception:
        return 24


def _session_cookie_name() -> str:
    return getattr(legacy, "SESSION_COOKIE_NAME", None) or os.getenv("SESSION_COOKIE_NAME", "cognivio_session")


def _csrf_cookie_name() -> str:
    return getattr(legacy, "CSRF_COOKIE_NAME", None) or os.getenv("CSRF_COOKIE_NAME", "cognivio_csrf")


def _cookie_secure() -> bool:
    value = getattr(legacy, "COOKIE_SECURE", None)
    if value is not None:
        return bool(value)
    return os.getenv("COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}


def _cookie_samesite() -> str:
    return getattr(legacy, "SESSION_COOKIE_SAMESITE", None) or os.getenv("SESSION_COOKIE_SAMESITE", "lax")


def _cookie_max_age() -> int:
    value = getattr(legacy, "SESSION_COOKIE_MAX_AGE_SECONDS", None) or os.getenv(
        "SESSION_COOKIE_MAX_AGE_SECONDS",
        str(60 * 60 * 24),
    )
    try:
        return int(value)
    except Exception:
        return 60 * 60 * 24


def _extract_request_metadata(request: Optional[Request]) -> Dict[str, Optional[str]]:
    if request is None:
        return {"ip_address": None, "user_agent": None}

    headers = getattr(request, "headers", {}) or {}
    forwarded_for = headers.get("x-forwarded-for") if hasattr(headers, "get") else None

    ip_address = None
    if forwarded_for:
        ip_address = forwarded_for.split(",")[0].strip()
    elif getattr(request, "client", None):
        ip_address = getattr(request.client, "host", None)

    return {
        "ip_address": ip_address,
        "user_agent": headers.get("user-agent") if hasattr(headers, "get") else None,
    }


async def _maybe_log_auth_event(
    event_type: str,
    *,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
    result: str = "success",
    reason: Optional[str] = None,
    request: Optional[Request] = None,
) -> None:
    if not hasattr(legacy, "_log_auth_event"):
        return

    metadata = _extract_request_metadata(request)

    try:
        await legacy._log_auth_event(
            event_type,
            email=email,
            user_id=user_id,
            result=result,
            reason=reason,
            ip_address=metadata.get("ip_address"),
            user_agent=metadata.get("user_agent"),
        )
    except TypeError:
        try:
            await legacy._log_auth_event(
                event_type,
                email=email,
                user_id=user_id,
                result=result,
                reason=reason,
            )
        except Exception:
            pass
    except Exception:
        pass


def hash_password(password: str) -> str:
    if password is None:
        raise ValueError("Password is required")

    password_bytes = str(password).encode("utf-8")
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False

    try:
        return bcrypt.checkpw(str(password).encode("utf-8"), str(password_hash).encode("utf-8"))
    except Exception:
        return False


def create_access_token(
    user_id: str,
    *,
    session_id: Optional[str] = None,
    email: Optional[str] = None,
    role: Optional[str] = None,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + (expires_delta or timedelta(hours=_jwt_expiration_hours()))

    payload: Dict[str, Any] = {
        "sub": user_id,
        "user_id": user_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }

    if session_id:
        payload["session_id"] = session_id
    if email:
        payload["email"] = email
    if role:
        payload["role"] = role
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, _jwt_secret(), algorithm=_jwt_algorithm())


async def create_user_session(
    *,
    user: Dict[str, Any],
    role: Optional[str] = None,
    request: Optional[Request] = None,
    session_id: Optional[str] = None,
) -> str:
    resolved_session_id = session_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    metadata = _extract_request_metadata(request)

    session_doc = {
        "id": resolved_session_id,
        "session_id": resolved_session_id,
        "user_id": user.get("id"),
        "email": user.get("email"),
        "role": role or user.get("role"),
        "tenant_role": user.get("tenant_role"),
        "created_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=_cookie_max_age())).isoformat(),
        "ip_address": metadata.get("ip_address"),
        "user_agent": metadata.get("user_agent"),
        "revoked_at": None,
    }

    if hasattr(legacy, "db") and getattr(legacy.db, "user_sessions", None) is not None:
        await legacy.db.user_sessions.update_one(
            {"id": resolved_session_id},
            {"$set": session_doc},
            upsert=True,
        )

    return resolved_session_id


def build_csrf_token(session_id: str) -> str:
    secret = _jwt_secret() or "cognivio-local-dev"
    nonce = secrets.token_urlsafe(16)
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{session_id}:{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{nonce}.{digest}"


def csrf_is_valid(request: Request, csrf_token: Optional[str] = None) -> bool:
    if request is None:
        return False

    cookies = getattr(request, "cookies", {}) or {}
    headers = getattr(request, "headers", {}) or {}

    cookie_token = cookies.get(_csrf_cookie_name()) if hasattr(cookies, "get") else None
    provided = (
        csrf_token
        or (headers.get("x-csrf-token") if hasattr(headers, "get") else None)
        or (headers.get("x-cognivio-csrf") if hasattr(headers, "get") else None)
    )

    if not cookie_token or not provided:
        return False

    return hmac.compare_digest(str(cookie_token), str(provided))


def set_auth_cookies(
    response: Response,
    token: str,
    csrf_token: Optional[str] = None,
    *,
    max_age: Optional[int] = None,
) -> None:
    if response is None:
        return

    resolved_max_age = max_age or _cookie_max_age()
    same_site = _cookie_samesite()
    secure = _cookie_secure()

    response.set_cookie(
        key=_session_cookie_name(),
        value=token,
        httponly=True,
        secure=secure,
        samesite=same_site,
        max_age=resolved_max_age,
        path="/",
    )

    if csrf_token:
        response.set_cookie(
            key=_csrf_cookie_name(),
            value=csrf_token,
            httponly=False,
            secure=secure,
            samesite=same_site,
            max_age=resolved_max_age,
            path="/",
        )


def clear_auth_cookies(response: Response) -> None:
    if response is None:
        return

    response.delete_cookie(key=_session_cookie_name(), path="/")
    response.delete_cookie(key=_csrf_cookie_name(), path="/")

    for name in ("access_token", "token", "session"):
        response.delete_cookie(key=name, path="/")


def extract_bearer_token_from_authorization_header(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None

    parts = str(authorization).strip().split(" ", 1)
    if len(parts) != 2:
        return None

    scheme, token = parts
    if scheme.lower() != "bearer" or not token.strip():
        return None

    return token.strip()


def resolve_auth_token(
    request: Optional[Request] = None,
    authorization: Optional[str] = None,
) -> Optional[str]:
    token = extract_bearer_token_from_authorization_header(authorization)

    if token:
        return token

    if request is None:
        return None

    headers = getattr(request, "headers", {}) or {}
    cookies = getattr(request, "cookies", {}) or {}

    auth_header = headers.get("authorization") if hasattr(headers, "get") else None
    token = extract_bearer_token_from_authorization_header(auth_header)
    if token:
        return token

    if hasattr(cookies, "get"):
        for cookie_name in (_session_cookie_name(), "access_token", "token", "session"):
            cookie_value = cookies.get(cookie_name)
            if cookie_value:
                return cookie_value

    return None


def is_admin_role(role_or_user: Any) -> bool:
    if isinstance(role_or_user, dict):
        role = str(role_or_user.get("role") or "").lower()
        tenant_role = str(role_or_user.get("tenant_role") or "").lower()
    else:
        role = str(role_or_user or "").lower()
        tenant_role = ""

    return role in {"admin", "principal", "super_admin"} or tenant_role in {
        "school_admin",
        "training_admin",
        "super_admin",
    }


def _public_user_doc(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = dict(user_doc)
    cleaned.pop("_id", None)
    cleaned.pop("password", None)
    return cleaned


def _build_user_response(user_doc: Dict[str, Any]) -> Any:
    public_doc = _public_user_doc(user_doc)

    try:
        return legacy.UserResponse(**public_doc)
    except Exception:
        allowed = {
            "id",
            "email",
            "name",
            "created_at",
            "role",
            "approval_status",
            "tenant_status",
            "tenant_role",
            "organization_id",
            "organization_name",
            "school_id",
            "school_name",
        }
        return legacy.UserResponse(**{key: value for key, value in public_doc.items() if key in allowed})


def _resolve_requested_role(user: Any) -> Dict[str, str]:
    requested_role = str(getattr(user, "role", "") or "").strip().lower()
    organization_type = str(getattr(user, "organization_type", "") or "").strip().lower()

    if requested_role in {"administrator", "admin", "principal", "school_admin"}:
        return {"role": "admin", "tenant_role": "school_admin"}

    if requested_role == "training_admin":
        return {"role": "admin", "tenant_role": "training_admin"}

    if requested_role == "teacher":
        return {"role": "teacher", "tenant_role": "teacher"}

    if organization_type == "training" and requested_role in {"training", "training_teacher"}:
        return {"role": "teacher", "tenant_role": "teacher"}

    return {"role": "teacher", "tenant_role": "teacher"}


async def register_user(
    user: Any,
    request: Optional[Request] = None,
    response: Optional[Response] = None,
) -> Any:
    if getattr(legacy, "DEMO_MODE", False):
        raise HTTPException(status_code=403, detail="Registration is disabled for demo mode")

    email = _normalize_email(user.email)
    requested_role = _resolve_requested_role(user)
    if getattr(legacy, "ACCESS_APPROVAL_REQUIRED", True) and not getattr(legacy, "_is_access_auto_approved_email", lambda _email: False)(email):
        return await request_access(user, request)

    existing = await legacy.db.users.find_one({"email": email})
    if _blocks_new_access_request(existing):
        raise HTTPException(status_code=400, detail="Email already registered")
    if existing:
        await _remove_reusable_user_record(email)

    user_id = str(uuid.uuid4())
    now = _now_iso()
    user_doc = {
        "id": user_id,
        "email": email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": now,
        "updated_at": now,
        "role": "admin" if email in getattr(legacy, "ADMIN_EMAILS", set()) else requested_role["role"],
        "tenant_role": "school_admin" if email in getattr(legacy, "ADMIN_EMAILS", set()) else requested_role["tenant_role"],
        "approval_status": "approved",
        "tenant_status": "approved",
        "is_active": True,
    }
    await legacy.db.users.insert_one(user_doc)

    session_id = await create_user_session(user=user_doc, role=user_doc["role"], request=request)
    token = create_access_token(user_id, session_id=session_id, email=user_doc["email"], role=user_doc["role"])
    if response is not None:
        set_auth_cookies(response, token, build_csrf_token(session_id))
    return legacy.TokenResponse(
        token=token,
        user=_build_user_response(user_doc),
    )


async def login_user(user: Any, request: Request, response: Optional[Response] = None) -> Any:
    email = _normalize_email(user.email)
    requested_role = str(getattr(user, "role", "") or "").strip().lower()

    db_user = await _find_user_by_email_case_insensitive(email)
    if (
        not db_user
        or _is_deleted_or_tombstoned_user(db_user)
        or not verify_password(user.password, db_user.get("password", ""))
    ):
        await _maybe_log_auth_event(
            "login_failed",
            email=email,
            result="failure",
            reason="invalid_credentials",
            request=request,
        )
        _raise_auth_error(
            401,
            "Invalid email or password",
            "invalid_credentials",
        )

    approval_status = _normalize_status(db_user.get("approval_status"), "approved")
    is_active = db_user.get("is_active", True)
    if approval_status not in LOGIN_ALLOWED_APPROVAL_STATUSES or is_active is False:
        if approval_status == "pending":
            event_type = "login_blocked_pending"
            reason_code = "account_pending_approval"
            message = "Your access request is pending approval."
        elif approval_status in {"rejected", "denied"}:
            event_type = "login_blocked_rejected"
            reason_code = "account_rejected"
            message = "This access request was not approved. You can submit a new request if your institution details have changed."
        elif approval_status == "revoked" or is_active is False:
            event_type = "login_blocked_revoked"
            reason_code = "account_disabled"
            message = "This account is not active. Contact your Cognivio administrator for help."
        else:
            event_type = "login_failed"
            reason_code = "access_not_approved"
            message = "User access is not approved."
        await _maybe_log_auth_event(
            event_type,
            email=email,
            user_id=db_user.get("id"),
            result="failure",
            reason=reason_code,
            request=request,
        )
        _raise_auth_error(
            403,
            message,
            reason_code,
            status=approval_status,
        )

    resolved_role = legacy._get_user_role(db_user) if hasattr(legacy, "_get_user_role") else db_user.get("role")
    if requested_role and requested_role not in {"", "auto"}:
        if requested_role == "admin" and not is_admin_role(db_user):
            await _maybe_log_auth_event(
                "login_failed",
                email=email,
                user_id=db_user.get("id"),
                result="failure",
                reason="role_not_allowed",
                request=request,
            )
            raise HTTPException(status_code=403, detail="Requested role is not available for this user")

    session_id = await create_user_session(
        user=db_user,
        role=resolved_role,
        request=request,
    )

    if hasattr(legacy, "create_token"):
        token = legacy.create_token(db_user["id"])
    else:
        token = create_access_token(
            db_user["id"],
            session_id=session_id,
            email=db_user.get("email"),
            role=resolved_role,
        )

    if response is not None:
        csrf_token = build_csrf_token(session_id)
        set_auth_cookies(response, token, csrf_token)

    await _maybe_log_auth_event(
        "login_success",
        email=email,
        user_id=db_user.get("id"),
        result="success",
        request=request,
    )

    return legacy.TokenResponse(
        token=token,
        user=_build_user_response(db_user),
    )


async def request_access(user: Any, request: Optional[Request] = None) -> Dict[str, Any]:
    if getattr(legacy, "DEMO_MODE", False):
        raise HTTPException(status_code=403, detail="Access requests are disabled for demo mode")

    email = _normalize_email(getattr(user, "email", ""))
    password = str(getattr(user, "password", "") or "")
    name = str(getattr(user, "name", "") or email).strip()

    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    role_info = _resolve_requested_role(user)
    role = role_info["role"]
    tenant_role = role_info["tenant_role"]

    organization_type = str(getattr(user, "organization_type", "") or "school").strip().lower()
    if organization_type not in {"school", "training"}:
        organization_type = "school"

    organization_name = str(getattr(user, "organization_name", "") or "").strip()
    school_name = str(getattr(user, "school_name", "") or "").strip()
    requested_manager_email = str(getattr(user, "requested_manager_email", "") or "").strip().lower()

    existing = await _find_user_by_email_case_insensitive(email, {"_id": 0})
    if _blocks_new_access_request(existing):
        existing_status = _normalize_status(existing.get("approval_status"))
        if existing_status == "pending":
            await _maybe_log_auth_event(
                "request_access_rejected",
                email=email,
                user_id=existing.get("id"),
                result="failure",
                reason="access_request_already_pending",
                request=request,
            )
            _raise_auth_error(
                409,
                "Your access request is already pending review.",
                "access_request_already_pending",
                status="pending",
            )

        existing_status = existing_status or "approved"
        reason_code = "account_already_exists"
        message = "An approved account already exists for this email. Sign in with that email or reset the password."
        status_code = 409
        if existing_status == "revoked" or existing.get("is_active") is False:
            reason_code = "account_disabled"
            message = "This email is connected to an account that is not active. Contact your Cognivio administrator."
            status_code = 403
        await _maybe_log_auth_event(
            "request_access_rejected",
            email=email,
            user_id=existing.get("id"),
            result="failure",
            reason=reason_code,
            request=request,
        )
        _raise_auth_error(
            status_code,
            message,
            reason_code,
            status=existing_status,
        )
    if existing:
        await _remove_reusable_user_record(email)

    user_id = str(uuid.uuid4())
    now = _now_iso()

    user_doc = {
        "id": user_id,
        "email": email,
        "name": name,
        "password": hash_password(password),
        "created_at": now,
        "updated_at": now,
        "role": role,
        "tenant_role": tenant_role,
        "approval_status": "pending",
        "tenant_status": "pending",
        "is_active": False,
        "organization_type": organization_type,
        "organization_name": organization_name or None,
        "school_name": school_name or None,
        "requested_organization_name": organization_name or None,
        "requested_school_name": school_name or None,
        "requested_manager_email": requested_manager_email or None,
        "manager_email": requested_manager_email or None,
        "approval_requested_at": now,
        "uploads_total": 0,
        "assessments_total": 0,
    }

    try:
        await legacy.db.users.insert_one(user_doc)
    except Exception as exc:
        message = str(exc).lower()
        if "duplicate" in message or "e11000" in message:
            await _maybe_log_auth_event(
                "request_access_rejected",
                email=email,
                result="failure",
                reason="duplicate_email",
                request=request,
            )
            _raise_auth_error(
                409,
                "A request or account already exists for this email.",
                "duplicate_email",
                status="duplicate",
            )
        raise

    email_warnings = []
    for helper_name in ("_send_access_request_notification", "_send_access_request_received_confirmation"):
        helper = getattr(legacy, helper_name, None)
        if not helper:
            continue
        try:
            delivered = bool(helper(user_doc))
            if not delivered:
                email_warnings.append(helper_name)
        except Exception:
            email_warnings.append(helper_name)
            logger = getattr(legacy, "logger", None)
            if logger:
                logger.warning("%s failed after access request creation", helper_name, exc_info=True)

    await _maybe_log_auth_event(
        "request_access_persisted",
        email=email,
        user_id=user_id,
        result="success",
        reason=f"requested_role={tenant_role}",
        request=request,
    )
    if email_warnings:
        await _maybe_log_auth_event(
            "request_access_notification_failed",
            email=email,
            user_id=user_id,
            result="warning",
            reason="notification_delivery_failed",
            request=request,
        )

    return {
        "ok": True,
        "status": "pending",
        "message": "Access request submitted for master-admin review.",
        "user_id": user_id,
        "email": email,
        "approval_status": "pending",
        "tenant_role": tenant_role,
        "organization_type": organization_type,
        "email_warning": bool(email_warnings),
        "notification": {
            "sent": not bool(email_warnings),
            "warning": "notification_delivery_failed" if email_warnings else None,
        },
        "reason_code": "access_request_pending_review",
    }


async def logout_user(response: Optional[Response] = None, request: Optional[Request] = None) -> Dict[str, str]:
    token = resolve_auth_token(request=request) if request else None

    if token and hasattr(legacy, "db") and getattr(legacy.db, "user_sessions", None) is not None:
        try:
            payload = jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algorithm()])
            session_id = payload.get("session_id")
            if session_id:
                await legacy.db.user_sessions.update_one(
                    {"id": session_id},
                    {"$set": {"revoked_at": _now_iso()}},
                )
        except Exception:
            pass

    if response is not None:
        clear_auth_cookies(response)

    return {"status": "ok"}


async def request_password_reset(payload: Any, request: Optional[Request] = None) -> Dict[str, str]:
    email = str(getattr(payload, "email", "") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    user_doc = await legacy.db.users.find_one({"email": email}, {"_id": 0})
    if user_doc and hasattr(legacy, "_send_password_reset_email"):
        legacy._send_password_reset_email(user_doc)

    return {
        "status": "ok",
        "message": "If an account exists for this email, a reset link has been sent.",
    }


async def confirm_password_reset(payload: Any, request: Optional[Request] = None) -> Dict[str, str]:
    token = str(getattr(payload, "token", "") or "").strip()
    new_password = str(
        getattr(payload, "new_password", None)
        or getattr(payload, "password", "")
        or ""
    )

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")

    try:
        decoded = jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algorithm()])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=400, detail="Password reset link has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=400, detail="Invalid password reset token") from exc

    if decoded.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid password reset token")

    user_id = decoded.get("sub") or decoded.get("user_id")
    email = decoded.get("email")
    query = {"id": user_id} if user_id else {"email": email}

    updated_hash = hash_password(new_password)
    await legacy.db.users.update_one(
        query,
        {"$set": {"password": updated_hash, "password_updated_at": _now_iso()}},
    )

    user_doc = await legacy.db.users.find_one(query, {"_id": 0})
    if user_doc and hasattr(legacy, "_send_password_reset_success_email"):
        legacy._send_password_reset_success_email(user_doc)

    return {"status": "ok", "message": "Password updated successfully"}


async def get_current_user_profile(
    current_user: dict,
    request: Optional[Request] = None,
    response: Optional[Response] = None,
) -> Any:
    return _build_user_response(current_user)


__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_user_session",
    "build_csrf_token",
    "set_auth_cookies",
    "clear_auth_cookies",
    "extract_bearer_token_from_authorization_header",
    "resolve_auth_token",
    "csrf_is_valid",
    "is_admin_role",
    "register_user",
    "login_user",
    "request_access",
    "logout_user",
    "request_password_reset",
    "confirm_password_reset",
    "get_current_user_profile",
]
