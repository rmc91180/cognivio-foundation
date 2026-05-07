from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response

import server as legacy


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(str(plain).encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(str(plain).encode(), str(hashed).encode())
    except ValueError:
        return False


def create_access_token(
    user_id: str,
    email: Optional[str] = None,
    roles: Optional[list[str]] = None,
    tenant_role: Optional[str] = None,
    *,
    session_id: Optional[str] = None,
) -> str:
    issued_at = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "exp": issued_at + timedelta(hours=legacy.JWT_EXPIRATION_HOURS),
        "iat": issued_at,
    }
    if email:
        payload["email"] = email
    if roles:
        payload["roles"] = roles
    if tenant_role:
        payload["tenant_role"] = tenant_role
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, legacy.JWT_SECRET, algorithm=legacy.JWT_ALGORITHM)


def verify_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, legacy.JWT_SECRET, algorithms=[legacy.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if not payload.get("user_id"):
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


def normalize_requested_role(role: Optional[str]) -> str:
    normalized = str(role or "").strip().lower()
    if normalized in {"school_admin", "school-admin", "principal", "admin", "administrator"}:
        return "school_admin"
    if normalized in {"training_admin", "training-admin", "teacher_training_admin", "teacher-training-admin"}:
        return "training_admin"
    if normalized == "super_admin":
        return "super_admin"
    return "teacher"


def derive_access_request_tenancy(user: Any) -> tuple[str, dict]:
    user_type = str(getattr(user, "user_type", "") or "").strip().lower()
    institution_type = str(getattr(user, "institution_type", "") or "").strip().lower()
    if user_type or institution_type:
        normalized_user_type = "administrator" if user_type in {"administrator", "admin", "school_admin", "training_admin"} else "teacher"
        normalized_institution = "training" if institution_type in {"training", "teacher_training", "teacher-training"} else "k12"
        desired_role = (
            "training_admin"
            if normalized_user_type == "administrator" and normalized_institution == "training"
            else "school_admin"
            if normalized_user_type == "administrator"
            else "teacher"
        )
        organization_type = "training" if normalized_institution == "training" else "school"
        training_provider_name = legacy._clean_optional_string(getattr(user, "training_provider_name", None))
        school_name = legacy._clean_optional_string(getattr(user, "school_name", None))
        district_or_network = legacy._clean_optional_string(getattr(user, "district_or_network", None))
        program_or_cohort_name = legacy._clean_optional_string(getattr(user, "program_or_cohort_name", None))
        program_or_department = legacy._clean_optional_string(getattr(user, "program_or_department", None))
        linked_admin_email = legacy._clean_optional_string(getattr(user, "linked_admin_email", None))
        if linked_admin_email:
            linked_admin_email = linked_admin_email.lower()

        user.role = desired_role
        user.organization_type = organization_type
        if normalized_institution == "training":
            user.organization_name = training_provider_name or legacy._clean_optional_string(getattr(user, "organization_name", None))
            user.school_name = program_or_cohort_name or program_or_department or legacy._clean_optional_string(getattr(user, "school_name", None))
        else:
            user.organization_name = district_or_network or school_name or legacy._clean_optional_string(getattr(user, "organization_name", None))
            user.school_name = school_name
        user.requested_manager_email = linked_admin_email or legacy._clean_optional_string(getattr(user, "requested_manager_email", None))
        tenancy_fields = legacy._normalize_access_request_tenancy_fields(user, desired_role)
        tenancy_fields.update(
            {
                "user_type": normalized_user_type,
                "institution_type": normalized_institution,
                "org_type": normalized_institution,
                "role_requested": desired_role,
                "training_provider_name": training_provider_name,
                "district_or_network": district_or_network,
                "program_or_cohort_name": program_or_cohort_name,
                "program_or_department": program_or_department,
                "linked_admin_email": linked_admin_email,
            }
        )
        return desired_role, tenancy_fields

    desired_role = normalize_requested_role(getattr(user, "role", None))
    return desired_role, legacy._normalize_access_request_tenancy_fields(user, desired_role)


def legacy_role_for_tenant_role(tenant_role: Optional[str]) -> str:
    normalized = str(tenant_role or "").strip().lower()
    if normalized == "super_admin":
        return "super_admin"
    if normalized in {"school_admin", "training_admin"}:
        return "admin"
    return "teacher"


def format_tenant_role_label(tenant_role: Optional[str]) -> str:
    labels = {
        "teacher": "Teacher",
        "school_admin": "School administrator",
        "training_admin": "Teacher training administrator",
        "super_admin": "Master administrator",
    }
    return labels.get(str(tenant_role or "").strip().lower(), "Teacher")


def get_tenant_role(user_doc: Optional[dict]) -> str:
    email = str((user_doc or {}).get("email") or "").lower()
    if email and email in legacy.SUPER_ADMIN_EMAILS:
        return "super_admin"
    tenant_role = str((user_doc or {}).get("tenant_role") or "").strip().lower()
    if tenant_role in legacy.VALID_TENANT_ROLES:
        return tenant_role
    if email and email in legacy.ADMIN_EMAILS:
        return "school_admin"
    role = str((user_doc or {}).get("role") or "").strip().lower()
    if role == "super_admin":
        return "super_admin"
    if role == "training_admin":
        return "training_admin"
    if role in {"admin", "principal"}:
        return "school_admin"
    return "teacher"


def get_user_role(user_doc: Optional[dict]) -> str:
    return legacy_role_for_tenant_role(get_tenant_role(user_doc))


def get_user_approval_status(user_doc: Optional[dict]) -> str:
    status = str((user_doc or {}).get("approval_status") or "").strip().lower()
    if status in {"pending", "approved", "revoked", "deleted"}:
        return status
    return "approved"


def is_user_access_active(user_doc: Optional[dict]) -> bool:
    if not user_doc:
        return False
    if get_user_approval_status(user_doc) != "approved":
        return False
    return user_doc.get("is_active", True) is not False


def resolve_user_permissions(user_doc: dict) -> dict:
    tenant_role = get_tenant_role(user_doc)
    legacy_role = legacy_role_for_tenant_role(tenant_role)
    return {
        "role": legacy_role,
        "tenant_role": tenant_role,
        "approval_status": get_user_approval_status(user_doc),
        "is_admin": legacy_role in {"admin", "principal", "super_admin"},
        "is_super_admin": tenant_role == "super_admin",
        "can_administer_school": tenant_role == "school_admin",
        "can_administer_training": tenant_role == "training_admin",
    }


def build_user_response_payload(user_doc: dict) -> dict:
    cleaned = {k: v for k, v in (user_doc or {}).items() if k not in {"_id", "password"}}
    permissions = resolve_user_permissions(user_doc)
    cleaned["role"] = permissions["role"]
    cleaned["tenant_role"] = permissions["tenant_role"]
    cleaned["tenant_status"] = permissions["approval_status"]
    cleaned["approval_status"] = permissions["approval_status"]
    return cleaned


def is_access_auto_approved_email(email: str) -> bool:
    return str(email or "").strip().lower() in legacy.ADMIN_EMAILS


def is_admin_role(role: Optional[str]) -> bool:
    return role in {"admin", "principal", "super_admin"}


def requested_role_matches_user(requested_role: Optional[str], user_doc: dict) -> bool:
    return not requested_role or requested_role == get_tenant_role(user_doc)


async def create_user_session(*, user: dict, role: str, request: Optional[Request]) -> str:
    session_id = str(uuid.uuid4())
    request_meta = legacy._extract_request_metadata(request)
    now = datetime.now(timezone.utc).isoformat()
    await legacy.db.user_sessions.insert_one(
        {
            "id": session_id,
            "user_id": user.get("id"),
            "email": user.get("email"),
            "role": role,
            "ip_address": request_meta.get("ip_address"),
            "user_agent": request_meta.get("user_agent"),
            "created_at": now,
            "last_seen_at": now,
            "revoked_at": None,
            "revoked_by": None,
            "revoke_reason": None,
        }
    )
    return session_id


def build_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(response: Response, *, token: str, csrf_token: Optional[str] = None) -> str:
    csrf_value = str(csrf_token or build_csrf_token())
    response.set_cookie(
        key=legacy.SESSION_COOKIE_NAME,
        value=token,
        max_age=legacy.SESSION_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=legacy.COOKIE_SECURE,
        samesite=legacy.SESSION_COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        key=legacy.CSRF_COOKIE_NAME,
        value=csrf_value,
        max_age=legacy.SESSION_COOKIE_MAX_AGE_SECONDS,
        httponly=False,
        secure=legacy.COOKIE_SECURE,
        samesite=legacy.SESSION_COOKIE_SAMESITE,
        path="/",
    )
    return csrf_value


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key=legacy.SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(key=legacy.CSRF_COOKIE_NAME, path="/")


def extract_bearer_token_from_authorization_header(authorization_header: Optional[str]) -> Optional[str]:
    parts = str(authorization_header or "").strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, value = parts
    if scheme.lower() != "bearer":
        return None
    return value.strip() or None


def resolve_auth_token(request: Request, credentials: Optional[Any] = None) -> Optional[str]:
    cookies = getattr(request, "cookies", None) or {}
    headers = getattr(request, "headers", None) or {}
    cookie_token = str(cookies.get(legacy.SESSION_COOKIE_NAME) or "").strip()
    if cookie_token:
        return cookie_token
    credential_value = str(getattr(credentials, "credentials", "") or "").strip() if credentials else ""
    credential_scheme = str(getattr(credentials, "scheme", "bearer") or "bearer").lower() if credentials else ""
    if credential_value and credential_scheme == "bearer":
        return credential_value
    return extract_bearer_token_from_authorization_header(headers.get("Authorization"))


def csrf_is_valid(request: Request) -> bool:
    cookies = getattr(request, "cookies", None) or {}
    headers = getattr(request, "headers", None) or {}
    csrf_cookie = str(cookies.get(legacy.CSRF_COOKIE_NAME) or "").strip()
    csrf_header = str(headers.get("X-CSRF-Token") or "").strip()
    if not csrf_cookie or not csrf_header:
        return False
    return hmac.compare_digest(csrf_cookie, csrf_header)


async def register_user(user: Any, request: Request, response: Optional[Response] = None):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    if legacy.DEMO_MODE:
        raise HTTPException(status_code=403, detail="Registration is disabled for demo mode")
    if legacy.ACCESS_APPROVAL_REQUIRED and not is_access_auto_approved_email(user.email.lower()):
        raise HTTPException(status_code=403, detail="Self-registration is disabled. Request access approval.")
    existing = await legacy.db.users.find_one({"email": user.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    desired_role, tenancy_fields = derive_access_request_tenancy(user)
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "id": user_id,
        "email": user.email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": now,
        "role": legacy_role_for_tenant_role(desired_role),
        "tenant_role": desired_role,
        "tenant_status": "approved",
        "approval_status": "approved",
        "approved_at": now,
        "is_active": True,
        **tenancy_fields,
    }
    await legacy.db.users.insert_one(user_doc)
    enriched_user = await enrich_user_with_workspace_mode(user_doc)
    session_id = await create_user_session(user=enriched_user, role=get_user_role(enriched_user), request=request)
    token = legacy.create_token(user_id, session_id=session_id)
    response_user = legacy.UserResponse(**enriched_user)
    if response is not None:
        set_auth_cookies(response, token=token)
        return legacy.AuthSessionResponse(user=response_user)
    return legacy.TokenResponse(token=token, user=response_user)


async def request_access(user: Any, request: Request):
    if legacy.DEMO_MODE:
        raise HTTPException(status_code=403, detail="Access requests are disabled for demo mode")
    email = user.email.lower()
    request_meta = legacy._extract_request_metadata(request)
    existing = await legacy.db.users.find_one({"email": email})
    now = datetime.now(timezone.utc).isoformat()
    auto_approved = is_access_auto_approved_email(email)
    desired_role, tenancy_fields = derive_access_request_tenancy(user)
    if existing:
        return await _update_existing_access_request(
            existing, user, email, desired_role, tenancy_fields, auto_approved, now, request_meta
        )
    return await _create_access_request(user, email, desired_role, tenancy_fields, auto_approved, now, request_meta)


async def _update_existing_access_request(
    existing: dict,
    user: Any,
    email: str,
    desired_role: str,
    tenancy_fields: dict,
    auto_approved: bool,
    now: str,
    request_meta: dict,
):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    existing_status = get_user_approval_status(existing)
    if existing_status == "approved" and is_user_access_active(existing):
        raise HTTPException(status_code=400, detail="Email already registered")
    if existing_status == "revoked":
        raise HTTPException(status_code=403, detail="Access has been removed for this account")

    update_fields = {"name": user.name, "password": hash_password(user.password), "updated_at": now, **tenancy_fields}
    update_fields.update(_access_status_fields(desired_role, auto_approved, now))
    await legacy.db.users.update_one({"id": existing["id"]}, {"$set": update_fields})
    refreshed = await legacy.db.users.find_one({"id": existing["id"]}, {"_id": 0})
    if auto_approved:
        enriched_user = await enrich_user_with_workspace_mode(refreshed)
        await _log_access_auth_event("approval_granted", email, refreshed.get("id"), desired_role, request_meta, "success", "system:auto_admin_allowlist")
        legacy.logger.info("Auto-approved access request for allowlisted admin email %s", email)
        return _access_response("approved", email, "Access is approved. You can now log in.", enriched_user)

    await _log_access_auth_event("request_access", email, refreshed.get("id"), desired_role, request_meta, "pending")
    legacy._send_access_request_notification(refreshed)
    legacy._send_access_request_received_confirmation(refreshed)
    message = "Access request updated. Approval is still required before login." if existing_status == "pending" else "Access request submitted. Approval is required before login."
    return _access_response("pending", email, message, {"tenant_role": desired_role, **tenancy_fields})


async def _create_access_request(
    user: Any,
    email: str,
    desired_role: str,
    tenancy_fields: dict,
    auto_approved: bool,
    now: str,
    request_meta: dict,
):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": now,
        "role": legacy_role_for_tenant_role(desired_role),
        "tenant_role": desired_role,
        "tenant_status": "approved" if auto_approved else "pending",
        "audio_analysis_enabled": True,
        "approval_status": "approved" if auto_approved else "pending",
        "approval_requested_at": now,
        "approved_at": now if auto_approved else None,
        "approved_by": "system:auto_admin_allowlist" if auto_approved else None,
        "is_active": auto_approved,
        **tenancy_fields,
    }
    await legacy.db.users.insert_one(user_doc)
    if auto_approved:
        enriched_user = await enrich_user_with_workspace_mode(user_doc)
        await _log_access_auth_event("approval_granted", email, user_id, desired_role, request_meta, "success", "system:auto_admin_allowlist")
        legacy.logger.info("Auto-approved access request for allowlisted admin email %s", email)
        return _access_response("approved", email, "Access is approved. You can now log in.", enriched_user)

    await _log_access_auth_event("request_access", email, user_id, desired_role, request_meta, "pending")
    legacy._send_access_request_notification(user_doc)
    legacy._send_access_request_received_confirmation(user_doc)
    return _access_response(
        "pending",
        email,
        "Access request submitted. Approval is required before login.",
        {"tenant_role": desired_role, **tenancy_fields},
    )


def _access_status_fields(desired_role: str, auto_approved: bool, now: str) -> dict:
    if auto_approved:
        return {
            "approval_status": "approved",
            "approved_at": now,
            "approved_by": "system:auto_admin_allowlist",
            "revoked_at": None,
            "revoked_by": None,
            "is_active": True,
            "role": legacy_role_for_tenant_role(desired_role),
            "tenant_role": desired_role,
            "tenant_status": "approved",
        }
    return {
        "approval_status": "pending",
        "approval_requested_at": now,
        "approved_at": None,
        "approved_by": None,
        "revoked_at": None,
        "revoked_by": None,
        "is_active": False,
        "role": legacy_role_for_tenant_role(desired_role),
        "tenant_role": desired_role,
        "tenant_status": "pending",
    }


async def _log_access_auth_event(
    event_type: str,
    email: str,
    user_id: Optional[str],
    role_selected: str,
    request_meta: dict,
    result: str,
    reason: Optional[str] = None,
) -> None:
    await legacy._log_auth_event(
        event_type,
        email=email,
        user_id=user_id,
        role_selected=role_selected,
        result=result,
        reason=reason,
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )


def _access_response(status: str, email: str, message: str, user_doc: dict):
    return legacy.AccessRequestResponse(
        status=status,
        email=email,
        message=message,
        approval_status=get_user_approval_status(user_doc) if status == "approved" else "pending",
        tenant_role=get_tenant_role(user_doc),
        organization_type=user_doc.get("organization_type"),
        organization_name=user_doc.get("organization_name") or user_doc.get("requested_organization_name"),
        school_name=user_doc.get("school_name") or user_doc.get("requested_school_name"),
        institution_type=user_doc.get("institution_type"),
        org_type=user_doc.get("org_type"),
        role_requested=user_doc.get("role_requested"),
        training_provider_name=user_doc.get("training_provider_name"),
        district_or_network=user_doc.get("district_or_network"),
        program_or_cohort_name=user_doc.get("program_or_cohort_name"),
        program_or_department=user_doc.get("program_or_department"),
        linked_admin_email=user_doc.get("linked_admin_email"),
    )


async def login_user(user: Any, request: Request, response: Optional[Response] = None):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    email = str(user.email or "").lower()
    request_meta = legacy._extract_request_metadata(request)
    db_user = await legacy.db.users.find_one({"email": email})
    requested_role = normalize_requested_role(user.role) if user.role else None
    if not db_user or not verify_password(user.password, db_user["password"]):
        await _log_login_failure(email, None, requested_role, "invalid_credentials", request_meta)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    approval_status = get_user_approval_status(db_user)
    if approval_status == "pending":
        await _log_login_failure(email, db_user.get("id"), requested_role, "pending_approval", request_meta)
        raise HTTPException(status_code=403, detail="Account pending approval")
    if approval_status == "revoked" or not is_user_access_active(db_user):
        await _log_login_failure(email, db_user.get("id"), requested_role, "access_removed", request_meta)
        raise HTTPException(status_code=403, detail="Account access removed")

    actual_role = get_user_role(db_user)
    actual_tenant_role = get_tenant_role(db_user)
    if requested_role and actual_tenant_role != "super_admin" and not requested_role_matches_user(requested_role, db_user):
        await _log_login_failure(email, db_user.get("id"), requested_role, "role_mismatch", request_meta)
        raise HTTPException(
            status_code=403,
            detail=f"This account is registered as a {format_tenant_role_label(actual_tenant_role)}. Choose the correct role and try again.",
        )

    now = datetime.now(timezone.utc).isoformat()
    await legacy.db.users.update_one({"id": db_user["id"]}, {"$set": {"last_login_at": now, "last_seen_at": now}})
    db_user.update({"last_login_at": now, "last_seen_at": now, "role": actual_role, "tenant_role": actual_tenant_role})
    db_user.update({"tenant_status": approval_status, "approval_status": approval_status})
    db_user.pop("_id", None)
    db_user.pop("password", None)
    enriched_user = await enrich_user_with_workspace_mode(db_user)
    await legacy._log_auth_event(
        "login_success",
        email=email,
        user_id=db_user.get("id"),
        role_selected=requested_role or actual_role,
        result="success",
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )
    session_id = await create_user_session(user=db_user, role=actual_role, request=request)
    token = legacy.create_token(db_user["id"], session_id=session_id)
    response_user = legacy.UserResponse(**enriched_user)
    if response is not None:
        set_auth_cookies(response, token=token)
        return legacy.AuthSessionResponse(user=response_user)
    return legacy.TokenResponse(token=token, user=response_user)


async def _log_login_failure(
    email: str,
    user_id: Optional[str],
    requested_role: Optional[str],
    reason: str,
    request_meta: dict,
) -> None:
    await legacy._log_auth_event(
        "login_failed",
        email=email,
        user_id=user_id,
        role_selected=requested_role,
        result="failure",
        reason=reason,
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )


async def logout_user(request: Request, response: Response) -> dict:
    token = resolve_auth_token(request)
    now = datetime.now(timezone.utc).isoformat()
    if token:
        try:
            payload = jwt.decode(token, legacy.JWT_SECRET, algorithms=[legacy.JWT_ALGORITHM])
            session_id = payload.get("sid")
            if session_id:
                await legacy.db.user_sessions.update_one(
                    {"id": session_id, "revoked_at": None},
                    {"$set": {"revoked_at": now, "revoke_reason": "logout"}},
                )
        except jwt.PyJWTError:
            pass
    clear_auth_cookies(response)
    return {"status": "ok"}


async def request_password_reset(payload: Any, request: Request) -> dict:
    email = str(payload.email or "").strip().lower()
    request_meta = legacy._extract_request_metadata(request)
    db_user = await legacy.db.users.find_one({"email": email}, {"_id": 0})
    if db_user and get_user_approval_status(db_user) == "approved" and is_user_access_active(db_user):
        legacy._send_password_reset_email(db_user)
        await legacy._log_auth_event(
            "password_reset_requested",
            email=email,
            user_id=db_user.get("id"),
            result="success",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
    else:
        await legacy._log_auth_event(
            "password_reset_requested",
            email=email,
            result="ignored",
            reason="user_not_resettable",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
    return {"status": "ok", "message": "If this email is an approved Cognivio account, a password reset link has been sent."}


async def confirm_password_reset(payload: Any, request: Request) -> dict:
    token_payload = _decode_password_reset_token(payload.token)
    user_id = token_payload.get("sub")
    email = str(token_payload.get("email") or "").strip().lower()
    if not user_id or not email:
        raise HTTPException(status_code=400, detail="This password reset link is invalid")

    db_user = await legacy.db.users.find_one({"id": user_id, "email": email}, {"_id": 0})
    if not db_user or get_user_approval_status(db_user) != "approved" or not is_user_access_active(db_user):
        raise HTTPException(status_code=400, detail="Password reset is unavailable for this account")
    if len(str(payload.password or "")) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")

    now = datetime.now(timezone.utc).isoformat()
    await legacy.db.users.update_one(
        {"id": user_id},
        {"$set": {"password": hash_password(payload.password), "password_reset_at": now, "last_seen_at": now}},
    )
    if hasattr(legacy.db, "user_sessions"):
        await legacy.db.user_sessions.delete_many({"user_id": user_id})
    refreshed_user = await legacy.db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    legacy._send_password_reset_success_email(refreshed_user or {"email": email})
    request_meta = legacy._extract_request_metadata(request)
    await legacy._log_auth_event(
        "password_reset_completed",
        email=email,
        user_id=user_id,
        result="success",
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )
    return {"status": "ok", "message": "Password updated successfully. You can now sign in."}


def _decode_password_reset_token(token: str) -> dict:
    try:
        token_payload = jwt.decode(token, legacy.JWT_SECRET, algorithms=[legacy.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=400, detail="This password reset link has expired") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=400, detail="This password reset link is invalid") from exc
    if token_payload.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="This password reset link is invalid")
    return token_payload


async def get_current_user_profile(current_user: dict, request: Request, response: Response):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    if not str((getattr(request, "cookies", None) or {}).get(legacy.CSRF_COOKIE_NAME) or "").strip():
        response.set_cookie(
            key=legacy.CSRF_COOKIE_NAME,
            value=build_csrf_token(),
            max_age=legacy.SESSION_COOKIE_MAX_AGE_SECONDS,
            httponly=False,
            secure=legacy.COOKIE_SECURE,
            samesite=legacy.SESSION_COOKIE_SAMESITE,
            path="/",
        )
    return legacy.UserResponse(**(await enrich_user_with_workspace_mode(current_user)))
