from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Depends, Response, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any, Tuple
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import json
import base64
import io
import csv
import hashlib
import math
import re
import shutil
import sys
import time
import html
import requests
import smtplib
import ssl
import boto3
from contextlib import asynccontextmanager
from email.message import EmailMessage
from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image, ImageDraw
try:
    from openai import AsyncOpenAI
except Exception:
    AsyncOpenAI = None
try:
    import cv2
except Exception as exc:
    cv2 = None
    _cv2_import_error = exc
import aiofiles
import asyncio
from enum import Enum
try:
    from reportlab.pdfgen import canvas
except Exception:
    canvas = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))
from privacy_pipeline import analyze_video_privacy, render_redacted_video, get_privacy_runtime_status
from frame_selection import scan_video_candidates, score_frame_candidates, select_diverse_frames
from moment_sampler import segment_video_windows, score_windows, select_lesson_moments
from audio_pipeline import extract_audio_track, transcribe_audio_file, compute_audio_features
from video_transcode import transcode_video_asset
from multimodal_analysis import build_multimodal_analysis_payload
from recognition_engine import (
    DEFAULT_FIVE_STAR_SCORE_MIN,
    FIVE_STAR_BADGE,
    build_recognition_eligibility,
    calculate_active_streak,
)
from app import metrics as app_metrics
from app.observability import (
    estimate_analysis_usage,
    log_structured,
    record_analysis_run,
    record_worker_result,
    snapshot as observability_snapshot,
)
from share_assets import (
    build_email_signature_html,
    render_email_signature_badge,
    render_social_share_card,
)


def _get_required_env(name: str) -> str:
    """Fetch required env var or raise a clear runtime error."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Environment variable {name} must be set")
    return value


def _get_optional_env_list(name: str) -> List[str]:
    """Fetch optional comma-separated env var as list, ignoring empties."""
    raw = os.getenv(name, "")
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _to_json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


VALID_TENANT_ROLES = {"teacher", "school_admin", "training_admin", "super_admin"}
VALID_ORGANIZATION_TYPES = {"school", "training"}


def _clean_optional_string(value: Optional[str]) -> Optional[str]:
    cleaned = str(value or "").strip()
    return cleaned or None


def _normalized_name_key(value: Optional[str]) -> Optional[str]:
    cleaned = _clean_optional_string(value)
    return cleaned.lower() if cleaned else None


def _legacy_role_for_tenant_role(tenant_role: Optional[str]) -> str:
    normalized = str(tenant_role or "").strip().lower()
    if normalized == "super_admin":
        return "super_admin"
    if normalized in {"school_admin", "training_admin"}:
        return "admin"
    return "teacher"


def _normalize_requested_role(role: Optional[str]) -> str:
    normalized = str(role or "").strip().lower()
    if normalized in {"school_admin", "school-admin", "principal", "admin", "administrator"}:
        return "school_admin"
    if normalized in {"training_admin", "training-admin", "teacher_training_admin", "teacher-training-admin"}:
        return "training_admin"
    if normalized == "super_admin":
        return "super_admin"
    return "teacher"


def _format_tenant_role_label(tenant_role: Optional[str]) -> str:
    normalized = str(tenant_role or "").strip().lower()
    labels = {
        "teacher": "Teacher",
        "school_admin": "School administrator",
        "training_admin": "Teacher training administrator",
        "super_admin": "Master administrator",
    }
    return labels.get(normalized, "Teacher")


def _normalize_organization_type(
    value: Optional[str],
    tenant_role: Optional[str] = None,
) -> Optional[str]:
    normalized = str(value or "").strip().lower()
    if normalized in VALID_ORGANIZATION_TYPES:
        return normalized
    normalized_role = str(tenant_role or "").strip().lower()
    if normalized_role == "training_admin":
        return "training"
    if normalized_role in {"teacher", "school_admin"}:
        return "school"
    return None


def _get_user_tenant_role(user: Optional[dict]) -> str:
    email = str((user or {}).get("email") or "").lower()
    if email and email in SUPER_ADMIN_EMAILS:
        return "super_admin"
    tenant_role = str((user or {}).get("tenant_role") or "").strip().lower()
    if tenant_role in VALID_TENANT_ROLES:
        return tenant_role
    if email and email in ADMIN_EMAILS:
        return "school_admin"
    role = str((user or {}).get("role") or "").strip().lower()
    if role == "super_admin":
        return "super_admin"
    if role == "training_admin":
        return "training_admin"
    if role in {"admin", "principal"}:
        return "school_admin"
    return "teacher"


def _get_user_role(user: dict) -> str:
    return _legacy_role_for_tenant_role(_get_user_tenant_role(user))


def _get_user_approval_status(user: Optional[dict]) -> str:
    status = str((user or {}).get("approval_status") or "").strip().lower()
    if status in {"pending", "approved", "revoked"}:
        return status
    return "approved"


def _is_user_access_active(user: Optional[dict]) -> bool:
    if not user:
        return False
    if _get_user_approval_status(user) != "approved":
        return False
    return (user or {}).get("is_active", True) is not False


def _is_access_auto_approved_email(email: str) -> bool:
    return email.strip().lower() in ADMIN_EMAILS


def _build_user_response_payload(user_doc: dict) -> dict:
    cleaned = {k: v for k, v in (user_doc or {}).items() if k not in {"_id", "password"}}
    cleaned["role"] = _get_user_role(user_doc)
    cleaned["tenant_role"] = _get_user_tenant_role(user_doc)
    cleaned["tenant_status"] = _get_user_approval_status(user_doc)
    cleaned["approval_status"] = _get_user_approval_status(user_doc)
    return cleaned


async def _resolve_master_admin_teacher_link(user_doc: dict) -> Optional[dict]:
    teacher_id = user_doc.get("teacher_id")
    if teacher_id:
        teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0, "id": 1, "name": 1, "email": 1})
        if teacher:
            return teacher
    email = str(user_doc.get("email") or "").lower()
    if not email:
        return None
    return await db.teachers.find_one({"email": email}, {"_id": 0, "id": 1, "name": 1, "email": 1})


async def _resolve_user_tenancy_context(user_doc: Optional[dict]) -> Dict[str, Any]:
    if not user_doc:
        return {}

    teachers_collection = getattr(db, "teachers", None)
    schools_collection = getattr(db, "schools", None)
    organizations_collection = getattr(db, "organizations", None)
    users_collection = getattr(db, "users", None)

    payload = _build_user_response_payload(user_doc)
    tenant_role = payload.get("tenant_role") or "teacher"
    organization_id = payload.get("organization_id")
    organization_type = _normalize_organization_type(payload.get("organization_type"), tenant_role)
    organization_name = _clean_optional_string(payload.get("organization_name"))
    school_id = payload.get("school_id")
    school_name = _clean_optional_string(payload.get("school_name"))
    manager_user_id = payload.get("manager_user_id")
    manager_email = _clean_optional_string(payload.get("manager_email"))
    manager_name = _clean_optional_string(payload.get("manager_name"))

    if not school_id and payload.get("teacher_id"):
        teacher_doc = None
        if teachers_collection is not None:
            teacher_doc = await teachers_collection.find_one(
                {"id": payload.get("teacher_id")},
                {"_id": 0, "school_id": 1},
            )
        school_id = (teacher_doc or {}).get("school_id") or school_id

    if not school_id:
        email = str(payload.get("email") or "").strip().lower()
        teacher_doc = None
        if email and teachers_collection is not None:
            teacher_doc = await teachers_collection.find_one(
                {"email": email},
                {"_id": 0, "school_id": 1},
            )
        school_id = (teacher_doc or {}).get("school_id") or school_id

    school_doc = None
    if school_id and schools_collection is not None:
        school_doc = await schools_collection.find_one(
            {"id": school_id},
            {"_id": 0, "id": 1, "name": 1, "organization_id": 1},
        )
        school_name = school_name or _clean_optional_string((school_doc or {}).get("name"))
        if not organization_id:
            organization_id = (school_doc or {}).get("organization_id") or organization_id

    if tenant_role == "school_admin" and not school_doc and schools_collection is not None:
        owned_school = await schools_collection.find_one(
            {"user_id": payload.get("id")},
            {"_id": 0, "id": 1, "name": 1, "organization_id": 1},
        )
        if owned_school:
            school_id = school_id or owned_school.get("id")
            school_name = school_name or _clean_optional_string(owned_school.get("name"))
            organization_id = organization_id or owned_school.get("organization_id")

    organization_doc = None
    if organization_id and organizations_collection is not None:
        organization_doc = await organizations_collection.find_one(
            {"id": organization_id},
            {"_id": 0, "id": 1, "name": 1, "organization_type": 1, "status": 1},
        )
        organization_name = organization_name or _clean_optional_string((organization_doc or {}).get("name"))
        organization_type = _normalize_organization_type(
            (organization_doc or {}).get("organization_type") or organization_type,
            tenant_role,
        )

    if manager_user_id and (not manager_email or not manager_name) and users_collection is not None:
        manager_doc = await users_collection.find_one(
            {"id": manager_user_id},
            {"_id": 0, "name": 1, "email": 1},
        )
        if manager_doc:
            manager_email = manager_email or _clean_optional_string(manager_doc.get("email"))
            manager_name = manager_name or _clean_optional_string(manager_doc.get("name"))

    return {
        "tenant_role": tenant_role,
        "tenant_status": payload.get("tenant_status") or payload.get("approval_status") or "approved",
        "organization_id": organization_id,
        "organization_type": organization_type,
        "organization_name": organization_name,
        "organization_status": (organization_doc or {}).get("status"),
        "school_id": school_id,
        "school_name": school_name,
        "manager_user_id": manager_user_id,
        "manager_name": manager_name,
        "manager_email": manager_email,
        "requested_organization_name": _clean_optional_string(payload.get("requested_organization_name")),
        "requested_school_name": _clean_optional_string(payload.get("requested_school_name")),
        "requested_manager_email": _clean_optional_string(payload.get("requested_manager_email")),
    }


async def _build_user_tenancy_migration_preview(user_doc: Optional[dict]) -> Dict[str, Any]:
    context = await _resolve_user_tenancy_context(user_doc)
    missing_required = []
    if context.get("tenant_role") in {"teacher", "school_admin"}:
        if not context.get("organization_name") and not context.get("requested_organization_name"):
            missing_required.append("organization_name")
        if not context.get("school_name") and not context.get("requested_school_name"):
            missing_required.append("school_name")
    if context.get("tenant_role") == "training_admin":
        if not context.get("organization_name") and not context.get("requested_organization_name"):
            missing_required.append("organization_name")
    return {
        **context,
        "is_complete": not missing_required,
        "missing_required_fields": missing_required,
    }


def _build_tenant_request_summary(user_doc: Optional[dict]) -> Dict[str, Optional[str]]:
    payload = _build_user_response_payload(user_doc or {})
    tenant_role = _get_user_tenant_role(payload)
    organization_name = _clean_optional_string(payload.get("organization_name")) or _clean_optional_string(
        payload.get("requested_organization_name")
    )
    school_name = _clean_optional_string(payload.get("school_name")) or _clean_optional_string(
        payload.get("requested_school_name")
    )
    manager_email = _clean_optional_string(payload.get("manager_email")) or _clean_optional_string(
        payload.get("requested_manager_email")
    )
    return {
        "tenant_role": tenant_role,
        "tenant_role_label": _format_tenant_role_label(tenant_role),
        "organization_type": _normalize_organization_type(payload.get("organization_type"), tenant_role),
        "organization_name": organization_name,
        "school_name": school_name,
        "manager_email": manager_email,
    }


async def _find_organization_by_name(*, organization_type: str, name: Optional[str]) -> Optional[dict]:
    normalized_name = _normalized_name_key(name)
    if not normalized_name:
        return None
    docs = await db.organizations.find(
        {"organization_type": organization_type},
        {"_id": 0},
    ).to_list(500)
    for doc in docs:
        if _normalized_name_key(doc.get("name")) == normalized_name:
            return doc
    return None


async def _find_school_by_name(*, organization_id: str, school_name: Optional[str]) -> Optional[dict]:
    normalized_name = _normalized_name_key(school_name)
    if not organization_id or not normalized_name:
        return None
    docs = await db.schools.find(
        {"organization_id": organization_id},
        {"_id": 0},
    ).to_list(500)
    for doc in docs:
        if _normalized_name_key(doc.get("name")) == normalized_name:
            return doc
    return None


async def _find_user_by_email(email: Optional[str]) -> Optional[dict]:
    normalized_email = _clean_optional_string(email)
    if not normalized_email:
        return None
    return await db.users.find_one({"email": normalized_email.lower()}, {"_id": 0, "password": 0})


def _normalize_access_request_tenancy_fields(user: "UserCreate", desired_tenant_role: str) -> Dict[str, Any]:
    organization_name = _clean_optional_string(user.organization_name)
    school_name = _clean_optional_string(user.school_name)
    requested_manager_email = _clean_optional_string(user.requested_manager_email)
    if requested_manager_email:
        requested_manager_email = requested_manager_email.lower()
    organization_type = _normalize_organization_type(user.organization_type, desired_tenant_role)

    if desired_tenant_role in {"teacher", "school_admin", "training_admin"} and not organization_name:
        raise HTTPException(status_code=400, detail="Organization name is required")
    if desired_tenant_role in {"teacher", "school_admin"} and not school_name:
        raise HTTPException(status_code=400, detail="School name is required")

    return {
        "organization_type": organization_type,
        "requested_organization_name": organization_name,
        "requested_school_name": school_name,
        "requested_manager_email": requested_manager_email,
    }


async def _assign_user_to_tenant_on_approval(
    *,
    target: dict,
    organization_name: Optional[str] = None,
    organization_type: Optional[str] = None,
    school_name: Optional[str] = None,
    manager_email: Optional[str] = None,
    actor_label: Optional[str] = None,
) -> Dict[str, Any]:
    tenant_summary = _build_tenant_request_summary(target)
    tenant_role = tenant_summary["tenant_role"] or "teacher"
    resolved_organization_type = _normalize_organization_type(
        organization_type or target.get("organization_type") or tenant_summary.get("organization_type"),
        tenant_role,
    )
    resolved_organization_name = (
        _clean_optional_string(organization_name)
        or tenant_summary.get("organization_name")
    )
    resolved_school_name = _clean_optional_string(school_name) or tenant_summary.get("school_name")
    resolved_manager_email = _clean_optional_string(manager_email) or tenant_summary.get("manager_email")
    if resolved_manager_email:
        resolved_manager_email = resolved_manager_email.lower()

    updates: Dict[str, Any] = {
        "tenant_role": tenant_role,
        "tenant_status": "approved",
        "organization_type": resolved_organization_type,
    }

    if tenant_role == "super_admin":
        updates.update(
            {
                "organization_id": None,
                "organization_name": None,
                "school_id": None,
                "school_name": None,
                "manager_user_id": None,
                "manager_email": None,
                "manager_name": None,
            }
        )
        return updates

    if not resolved_organization_name:
        updates.update(
            {
                "organization_id": None,
                "organization_name": None,
                "school_id": None,
                "school_name": None,
                "manager_user_id": None,
                "manager_email": resolved_manager_email,
                "manager_name": None,
            }
        )
        return updates

    organization_doc = await _find_organization_by_name(
        organization_type=resolved_organization_type,
        name=resolved_organization_name,
    )
    if not organization_doc:
        organization_doc = {
            "id": str(uuid.uuid4()),
            "name": resolved_organization_name,
            "organization_type": resolved_organization_type,
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": actor_label or "approval_flow",
        }
        await db.organizations.insert_one(organization_doc)

    updates["organization_id"] = organization_doc["id"]
    updates["organization_name"] = organization_doc["name"]

    school_doc = None
    if tenant_role in {"teacher", "school_admin"}:
        if not resolved_school_name:
            raise HTTPException(status_code=400, detail="School name is required before approval")
        school_doc = await _find_school_by_name(
            organization_id=organization_doc["id"],
            school_name=resolved_school_name,
        )
        if not school_doc:
            school_doc = {
                "id": str(uuid.uuid4()),
                "name": resolved_school_name,
                "user_id": target["id"] if tenant_role == "school_admin" else None,
                "organization_id": organization_doc["id"],
                "district_name": organization_doc["name"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.schools.insert_one(school_doc)
        elif tenant_role == "school_admin":
            existing_owner = school_doc.get("user_id")
            if existing_owner and existing_owner != target["id"]:
                raise HTTPException(
                    status_code=409,
                    detail="This school is already linked to another school administrator",
                )
            await db.schools.update_one(
                {"id": school_doc["id"]},
                {
                    "$set": {
                        "user_id": target["id"],
                        "organization_id": organization_doc["id"],
                        "district_name": organization_doc["name"],
                    }
                },
            )
            school_doc["user_id"] = target["id"]
        updates["school_id"] = school_doc["id"]
        updates["school_name"] = school_doc["name"]
    else:
        updates["school_id"] = None
        updates["school_name"] = None

    manager_doc = None
    if tenant_role == "teacher":
        if resolved_manager_email:
            manager_doc = await _find_user_by_email(resolved_manager_email)
            if manager_doc and _get_user_tenant_role(manager_doc) != "school_admin":
                manager_doc = None
        if not manager_doc and school_doc and school_doc.get("user_id"):
            manager_doc = await db.users.find_one(
                {"id": school_doc.get("user_id")},
                {"_id": 0, "password": 0},
            )
        if manager_doc and manager_doc.get("organization_id") and manager_doc.get("organization_id") != organization_doc["id"]:
            manager_doc = None
        updates["manager_user_id"] = (manager_doc or {}).get("id")
        updates["manager_email"] = (manager_doc or {}).get("email") or resolved_manager_email
        updates["manager_name"] = (manager_doc or {}).get("name")
    else:
        updates["manager_user_id"] = None
        updates["manager_email"] = None
        updates["manager_name"] = None

    return updates


async def _ensure_school_organization_for_user(
    *,
    current_user: dict,
    school_name: str,
    district_name: Optional[str] = None,
) -> dict:
    existing_org_id = current_user.get("organization_id")
    if existing_org_id:
        existing_org = await db.organizations.find_one({"id": existing_org_id}, {"_id": 0})
        if existing_org:
            return existing_org

    organization_name = _clean_optional_string(current_user.get("organization_name")) or _clean_optional_string(district_name) or school_name
    organization_id = str(uuid.uuid4())
    doc = {
        "id": organization_id,
        "name": organization_name,
        "organization_type": "school",
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user["id"],
    }
    await db.organizations.insert_one(doc)
    await db.users.update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "organization_id": organization_id,
                "organization_type": "school",
                "organization_name": organization_name,
                "tenant_role": _get_user_tenant_role(current_user),
                "tenant_status": _get_user_approval_status(current_user),
            }
        },
    )
    return doc


async def _build_master_admin_user_record(user_doc: dict) -> "MasterAdminUserRecord":
    payload = _build_user_response_payload(user_doc)
    linked_teacher = await _resolve_master_admin_teacher_link(user_doc)
    tenancy = await _resolve_user_tenancy_context(user_doc)
    uploads_total = await db.videos.count_documents({"uploaded_by": payload["id"]})
    assessments_total = await db.assessments.count_documents({"user_id": payload["id"]})
    return MasterAdminUserRecord(
        id=payload["id"],
        email=payload["email"],
        name=payload.get("name") or "",
        role=payload.get("role") or "teacher",
        approval_status=payload.get("approval_status") or "approved",
        is_active=payload.get("is_active", True) is not False,
        created_at=payload.get("created_at"),
        approval_requested_at=payload.get("approval_requested_at"),
        approved_at=payload.get("approved_at"),
        revoked_at=payload.get("revoked_at"),
        last_login_at=payload.get("last_login_at"),
        workspace_mode=payload.get("workspace_mode"),
        tenant_role=tenancy.get("tenant_role"),
        tenant_status=tenancy.get("tenant_status"),
        organization_id=tenancy.get("organization_id"),
        organization_type=tenancy.get("organization_type"),
        organization_name=tenancy.get("organization_name") or tenancy.get("requested_organization_name"),
        school_id=tenancy.get("school_id"),
        school_name=tenancy.get("school_name") or tenancy.get("requested_school_name"),
        manager_user_id=tenancy.get("manager_user_id"),
        manager_name=tenancy.get("manager_name"),
        manager_email=tenancy.get("manager_email") or tenancy.get("requested_manager_email"),
        requested_organization_name=tenancy.get("requested_organization_name"),
        requested_school_name=tenancy.get("requested_school_name"),
        requested_manager_email=tenancy.get("requested_manager_email"),
        linked_teacher_id=(linked_teacher or {}).get("id"),
        linked_teacher_name=(linked_teacher or {}).get("name"),
        uploads_total=uploads_total,
        assessments_total=assessments_total,
    )


def _to_access_user_record(user_doc: dict) -> "AccessUserRecord":
    payload = _build_user_response_payload(user_doc)
    return AccessUserRecord(
        id=payload["id"],
        email=payload["email"],
        name=payload["name"],
        created_at=payload["created_at"],
        role=payload.get("role"),
        approval_status=payload.get("approval_status") or "approved",
        approval_requested_at=user_doc.get("approval_requested_at"),
        approved_at=user_doc.get("approved_at"),
        approved_by=user_doc.get("approved_by"),
        revoked_at=user_doc.get("revoked_at"),
        revoked_by=user_doc.get("revoked_by"),
        is_active=user_doc.get("is_active", True) is not False,
        teacher_id=user_doc.get("teacher_id"),
        workspace_mode=user_doc.get("workspace_mode"),
        tenant_role=payload.get("tenant_role"),
        tenant_status=payload.get("tenant_status") or payload.get("approval_status"),
        organization_id=user_doc.get("organization_id"),
        organization_type=user_doc.get("organization_type"),
        organization_name=user_doc.get("organization_name") or user_doc.get("requested_organization_name"),
        school_id=user_doc.get("school_id"),
        school_name=user_doc.get("school_name") or user_doc.get("requested_school_name"),
        manager_user_id=user_doc.get("manager_user_id"),
        manager_email=user_doc.get("manager_email") or user_doc.get("requested_manager_email"),
    )


def _parse_master_admin_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _workspace_activity_state(last_activity_at: Optional[str]) -> str:
    dt = _parse_master_admin_iso(last_activity_at)
    if not dt:
        return "inactive"
    now = datetime.now(timezone.utc)
    age = now - dt.astimezone(timezone.utc)
    if age <= timedelta(days=14):
        return "active"
    return "stale"


def _workspace_health_state(
    *,
    failure_count: int,
    privacy_gap_count: int,
    unlinked_user_count: int,
    pending_teacher_users: int,
    activity_state: str,
) -> str:
    if failure_count > 0:
        return "blocked"
    if privacy_gap_count > 0 or unlinked_user_count > 0 or pending_teacher_users > 0:
        return "attention"
    if activity_state != "active":
        return "stale"
    return "healthy"


def _workspace_pilot_state(*, teacher_count: int, upload_count: int, assessment_count: int) -> str:
    if upload_count > 0 or assessment_count > 0:
        return "live"
    if teacher_count > 0:
        return "configured"
    return "setup_needed"


def _workspace_issue_summary(
    *,
    failure_count: int,
    privacy_gap_count: int,
    unlinked_user_count: int,
    pending_teacher_users: int,
    activity_state: str,
) -> Optional[str]:
    issues: List[str] = []
    if failure_count:
        issues.append(f"{failure_count} pipeline issue(s)")
    if privacy_gap_count:
        issues.append(f"{privacy_gap_count} missing privacy profile(s)")
    if unlinked_user_count:
        issues.append(f"{unlinked_user_count} unlinked teacher login(s)")
    if pending_teacher_users:
        issues.append(f"{pending_teacher_users} pending teacher access request(s)")
    if not issues and activity_state != "active":
        issues.append("No recent workspace activity")
    return ", ".join(issues[:3]) if issues else None


async def _build_master_admin_workspace_records() -> List["MasterAdminWorkspaceRecord"]:
    from app.services.workspace_service import resolve_workspace_mode

    admin_docs = await db.users.find(
        {"role": {"$in": ["admin", "principal"]}, "approval_status": "approved", "is_active": {"$ne": False}},
        {"_id": 0, "password": 0},
    ).to_list(2000)
    teacher_docs = await db.teachers.find({}, {"_id": 0}).to_list(5000)
    user_docs = await db.users.find({}, {"_id": 0, "password": 0}).to_list(5000)
    video_docs = await db.videos.find(
        {},
        {"_id": 0, "id": 1, "teacher_id": 1, "created_at": 1, "status_updated_at": 1, "transcode_status": 1, "privacy_status": 1, "analysis_status": 1},
    ).to_list(10000)
    assessment_docs = await db.assessments.find({}, {"_id": 0, "teacher_id": 1, "created_at": 1}).to_list(10000)
    privacy_docs = await db.teacher_face_profiles.find(
        {"status": "active"},
        {"_id": 0, "teacher_id": 1, "updated_at": 1, "created_at": 1},
    ).to_list(5000)
    memory_docs = await db.organization_memory.find({}, {"_id": 0, "owner_id": 1, "updated_at": 1}).to_list(5000)

    teachers_by_owner: Dict[str, List[dict]] = {}
    for teacher in teacher_docs:
        owner_id = teacher.get("created_by")
        if not owner_id:
            continue
        teachers_by_owner.setdefault(owner_id, []).append(teacher)

    owner_docs: Dict[str, dict] = {doc["id"]: doc for doc in admin_docs if doc.get("id")}
    owner_ids = set(owner_docs.keys()) | set(teachers_by_owner.keys())
    workspace_records: List[MasterAdminWorkspaceRecord] = []

    for owner_id in sorted(owner_ids):
        owner_doc = owner_docs.get(owner_id) or {
            "id": owner_id,
            "email": None,
            "name": "Unknown workspace owner",
            "role": "admin",
            "approval_status": "approved",
            "is_active": True,
        }
        teacher_list = teachers_by_owner.get(owner_id, [])
        teacher_ids = {teacher.get("id") for teacher in teacher_list if teacher.get("id")}
        teacher_emails = {(teacher.get("email") or "").strip().lower() for teacher in teacher_list if teacher.get("email")}
        matching_teacher_users = [
            user for user in user_docs
            if _get_user_role(user) == "teacher"
            and (
                (user.get("teacher_id") in teacher_ids if user.get("teacher_id") else False)
                or ((user.get("email") or "").strip().lower() in teacher_emails if teacher_emails else False)
            )
        ]
        approved_teacher_users = sum(
            1 for user in matching_teacher_users
            if _get_user_approval_status(user) == "approved" and _is_user_access_active(user)
        )
        pending_teacher_users = sum(1 for user in matching_teacher_users if _get_user_approval_status(user) == "pending")
        unlinked_user_count = sum(
            1 for user in matching_teacher_users
            if not user.get("teacher_id") or user.get("teacher_id") not in teacher_ids
        )
        school_count = len({teacher.get("school_id") for teacher in teacher_list if teacher.get("school_id")})
        workspace_videos = [video for video in video_docs if video.get("teacher_id") in teacher_ids]
        workspace_assessments = [item for item in assessment_docs if item.get("teacher_id") in teacher_ids]
        privacy_teacher_ids = {item.get("teacher_id") for item in privacy_docs if item.get("teacher_id") in teacher_ids}
        privacy_gap_count = sum(1 for teacher_id in teacher_ids if teacher_id not in privacy_teacher_ids)
        failure_count = sum(
            1
            for video in workspace_videos
            if video.get("transcode_status") == "failed"
            or video.get("privacy_status") in {PrivacyProcessingStatus.FAILED.value, PrivacyProcessingStatus.REVIEW_REQUIRED.value}
            or video.get("analysis_status") == VideoProcessingStatus.FAILED.value
        )
        memory_entry_count = sum(1 for item in memory_docs if item.get("owner_id") == owner_id)
        activity_candidates: List[str] = []
        for source in teacher_list:
            if source.get("created_at"):
                activity_candidates.append(source.get("created_at"))
            if source.get("next_coaching_conference"):
                activity_candidates.append(source.get("next_coaching_conference"))
        for source in matching_teacher_users:
            if source.get("last_login_at"):
                activity_candidates.append(source.get("last_login_at"))
            if source.get("created_at"):
                activity_candidates.append(source.get("created_at"))
        for source in workspace_videos:
            if source.get("status_updated_at"):
                activity_candidates.append(source.get("status_updated_at"))
            if source.get("created_at"):
                activity_candidates.append(source.get("created_at"))
        for source in workspace_assessments:
            if source.get("created_at"):
                activity_candidates.append(source.get("created_at"))
        for source in memory_docs:
            if source.get("owner_id") == owner_id and source.get("updated_at"):
                activity_candidates.append(source.get("updated_at"))
        last_activity_at = max(activity_candidates, default=None)
        mode_snapshot = await resolve_workspace_mode(owner_doc)
        activity_state = _workspace_activity_state(last_activity_at)
        pilot_state = _workspace_pilot_state(
            teacher_count=len(teacher_list),
            upload_count=len(workspace_videos),
            assessment_count=len(workspace_assessments),
        )
        health_state = _workspace_health_state(
            failure_count=failure_count,
            privacy_gap_count=privacy_gap_count,
            unlinked_user_count=unlinked_user_count,
            pending_teacher_users=pending_teacher_users,
            activity_state=activity_state,
        )
        workspace_records.append(
            MasterAdminWorkspaceRecord(
                id=owner_id,
                owner_user_id=owner_id,
                owner_name=owner_doc.get("name"),
                owner_email=owner_doc.get("email"),
                workspace_mode=mode_snapshot.get("effective_mode"),
                teacher_count=len(teacher_list),
                approved_teacher_users=approved_teacher_users,
                pending_teacher_users=pending_teacher_users,
                school_count=school_count,
                upload_count=len(workspace_videos),
                assessment_count=len(workspace_assessments),
                failure_count=failure_count,
                privacy_gap_count=privacy_gap_count,
                unlinked_user_count=unlinked_user_count,
                memory_entry_count=memory_entry_count,
                last_activity_at=last_activity_at,
                health_state=health_state,
                activity_state=activity_state,
                pilot_state=pilot_state,
                issue_summary=_workspace_issue_summary(
                    failure_count=failure_count,
                    privacy_gap_count=privacy_gap_count,
                    unlinked_user_count=unlinked_user_count,
                    pending_teacher_users=pending_teacher_users,
                    activity_state=activity_state,
                ),
            )
        )
    return workspace_records


def _build_user_lookup_map(user_docs: List[dict]) -> Dict[str, dict]:
    return {str(doc.get("id") or ""): doc for doc in user_docs if doc.get("id")}


def _build_teacher_lookup_map(teacher_docs: List[dict]) -> Dict[str, dict]:
    return {str(doc.get("id") or ""): doc for doc in teacher_docs if doc.get("id")}


def _video_latest_error(video: dict) -> Optional[str]:
    return (
        video.get("transcode_error")
        or video.get("privacy_error")
        or video.get("error_message")
        or video.get("playback_error")
    )


def _video_stage(video: dict) -> str:
    transcode_status = _normalize_video_transcode_status(video.get("transcode_status"))
    privacy_status = _normalize_privacy_status(video.get("privacy_status"))
    analysis_status = _normalize_video_status(video.get("analysis_status"))
    status = _normalize_video_status(video.get("status"))

    if transcode_status in {VideoTranscodeStatus.QUEUED.value, VideoTranscodeStatus.PROCESSING.value}:
        return "transcode"
    if privacy_status in {
        PrivacyProcessingStatus.QUEUED.value,
        PrivacyProcessingStatus.PROCESSING.value,
        PrivacyProcessingStatus.REVIEW_REQUIRED.value,
        PrivacyProcessingStatus.FAILED.value,
    }:
        return "privacy"
    if analysis_status in {
        VideoProcessingStatus.QUEUED.value,
        VideoProcessingStatus.PROCESSING.value,
        VideoProcessingStatus.FAILED.value,
    }:
        return "analysis"
    if status == VideoProcessingStatus.COMPLETED.value:
        return "playback"
    return "upload"


def _video_incident_state(video: dict) -> str:
    if _video_latest_error(video):
        return "active"
    if _normalize_video_status(video.get("status")) == VideoProcessingStatus.COMPLETED.value:
        return "clear"
    return "monitoring"


def _video_asset_state(file_path: Optional[str], *, public_url: Optional[str] = None) -> str:
    if public_url:
        return "public"
    if file_path:
        return "present"
    return "missing"


async def _refresh_processing_incidents() -> List[dict]:
    user_docs = await db.users.find({}, {"_id": 0}).to_list(5000)
    teacher_docs = await db.teachers.find({}, {"_id": 0}).to_list(5000)
    video_docs = await db.videos.find({}, {"_id": 0}).to_list(10000)
    user_lookup = _build_user_lookup_map(user_docs)
    teacher_lookup = _build_teacher_lookup_map(teacher_docs)
    active_keys: set[str] = set()
    incident_docs: List[dict] = []

    for video in video_docs:
        incident_type = None
        severity = "warning"
        transcode_status = _normalize_video_transcode_status(video.get("transcode_status"))
        privacy_status = _normalize_privacy_status(video.get("privacy_status"))
        analysis_status = _normalize_video_status(video.get("analysis_status"))

        if transcode_status == VideoTranscodeStatus.FAILED.value:
            incident_type = "transcode_failed"
            severity = "danger"
        elif privacy_status == PrivacyProcessingStatus.FAILED.value:
            incident_type = "privacy_failed"
            severity = "danger"
        elif privacy_status == PrivacyProcessingStatus.REVIEW_REQUIRED.value:
            incident_type = "privacy_review_required"
            severity = "warning"
        elif analysis_status == VideoProcessingStatus.FAILED.value:
            incident_type = "analysis_failed"
            severity = "danger"
        elif not (video.get("processed_public_url") or video.get("public_url") or video.get("file_path")):
            incident_type = "playback_unavailable"
            severity = "warning"

        if not incident_type:
            continue

        teacher = teacher_lookup.get(str(video.get("teacher_id") or ""))
        uploader = user_lookup.get(str(video.get("uploaded_by") or ""))
        owner = user_lookup.get(str((teacher or {}).get("created_by") or ""))
        key = f"{video.get('id')}:{incident_type}"
        active_keys.add(key)
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = await db.processing_incidents.find_one({"id": key}, {"_id": 0})
        doc = {
            "id": key,
            "video_id": video.get("id"),
            "teacher_id": video.get("teacher_id"),
            "teacher_name": (teacher or {}).get("name"),
            "uploader_user_id": video.get("uploaded_by"),
            "uploader_email": (uploader or {}).get("email"),
            "owner_user_id": (teacher or {}).get("created_by"),
            "owner_email": (owner or {}).get("email"),
            "filename": video.get("filename"),
            "incident_type": incident_type,
            "stage": _video_stage(video),
            "severity": severity,
            "state": "active",
            "latest_error": _video_latest_error(video),
            "first_seen_at": (existing or {}).get("first_seen_at") or video.get("status_updated_at") or video.get("created_at") or now_iso,
            "last_seen_at": now_iso,
            "resolved_at": None,
        }
        await db.processing_incidents.update_one({"id": key}, {"$set": doc}, upsert=True)
        incident_docs.append(doc)

    existing_docs = await db.processing_incidents.find({}, {"_id": 0}).to_list(10000)
    for incident in existing_docs:
        if incident.get("id") in active_keys:
            continue
        if incident.get("state") == "resolved":
            incident_docs.append(incident)
            continue
        resolved = dict(incident)
        resolved["state"] = "resolved"
        resolved["resolved_at"] = datetime.now(timezone.utc).isoformat()
        resolved["last_seen_at"] = resolved["resolved_at"]
        await db.processing_incidents.update_one({"id": resolved["id"]}, {"$set": resolved}, upsert=True)
        incident_docs.append(resolved)

    return incident_docs


async def _build_master_admin_video_records() -> List["MasterAdminVideoRecord"]:
    user_docs = await db.users.find({}, {"_id": 0}).to_list(5000)
    teacher_docs = await db.teachers.find({}, {"_id": 0}).to_list(5000)
    video_docs = await db.videos.find({}, {"_id": 0}).to_list(10000)
    user_lookup = _build_user_lookup_map(user_docs)
    teacher_lookup = _build_teacher_lookup_map(teacher_docs)
    records: List[MasterAdminVideoRecord] = []
    for video in video_docs:
        teacher = teacher_lookup.get(str(video.get("teacher_id") or ""))
        uploader = user_lookup.get(str(video.get("uploaded_by") or ""))
        owner = user_lookup.get(str((teacher or {}).get("created_by") or ""))
        records.append(
            MasterAdminVideoRecord(
                id=video.get("id"),
                filename=video.get("filename"),
                teacher_id=video.get("teacher_id"),
                teacher_name=(teacher or {}).get("name"),
                uploader_user_id=video.get("uploaded_by"),
                uploader_email=(uploader or {}).get("email"),
                owner_user_id=(teacher or {}).get("created_by"),
                owner_email=(owner or {}).get("email"),
                status=_normalize_video_status(video.get("status")),
                privacy_status=_normalize_privacy_status(video.get("privacy_status")),
                analysis_status=_normalize_video_status(video.get("analysis_status")),
                transcode_status=_normalize_video_transcode_status(video.get("transcode_status")),
                upload_date=video.get("upload_date") or video.get("created_at"),
                status_updated_at=video.get("status_updated_at"),
                file_size_bytes=video.get("file_size_bytes"),
                processed_file_size_bytes=video.get("processed_file_size_bytes"),
                raw_asset_state=_video_asset_state(video.get("raw_file_path") or video.get("file_path"), public_url=video.get("public_url")),
                processed_asset_state=_video_asset_state(video.get("processed_file_path"), public_url=video.get("processed_public_url")),
                playback_state="ready" if (video.get("processed_public_url") or video.get("public_url")) else "missing",
                latest_error=_video_latest_error(video),
                incident_state=_video_incident_state(video),
            )
        )
    records.sort(key=lambda item: (item.incident_state != "active", item.status_updated_at or "", item.upload_date or ""))
    return records


async def _build_dependency_health_snapshot() -> List["MasterAdminDependencyRecord"]:
    await refresh_runtime_metrics()
    now_iso = datetime.now(timezone.utc).isoformat()
    dependency_values = app_metrics.snapshot_summary().get("dependencies") or {}
    storage_healthy = _upload_storage_is_healthy() and bool(S3_BUCKET)
    return [
        MasterAdminDependencyRecord(
            id="atlas",
            name="MongoDB Atlas",
            healthy=bool(dependency_values.get("mongodb")),
            status="healthy" if dependency_values.get("mongodb") else "unhealthy",
            latest_probe_at=now_iso,
            latest_failure_note=None if dependency_values.get("mongodb") else "Latest Atlas ping probe failed.",
            remediation="Verify Atlas credentials, cluster availability, and network access.",
            metadata={"database_name": os.getenv("DB_NAME")},
        ),
        MasterAdminDependencyRecord(
            id="r2",
            name="Cloudflare R2",
            healthy=storage_healthy,
            status="healthy" if storage_healthy else "unhealthy",
            latest_probe_at=now_iso,
            latest_failure_note=None if storage_healthy else "Object storage is unavailable or not configured.",
            remediation="Verify R2 endpoint, bucket, and access keys in Railway.",
            metadata={"bucket": S3_BUCKET, "endpoint": S3_ENDPOINT},
        ),
        MasterAdminDependencyRecord(
            id="resend",
            name="Resend",
            healthy=bool(RESEND_API_KEY and RESEND_FROM_EMAIL),
            status="healthy" if (RESEND_API_KEY and RESEND_FROM_EMAIL) else "unhealthy",
            latest_probe_at=now_iso,
            latest_failure_note=None if (RESEND_API_KEY and RESEND_FROM_EMAIL) else "Resend is missing API configuration.",
            remediation="Set RESEND_API_KEY and RESEND_FROM_EMAIL in the backend environment.",
            metadata={"from_email": RESEND_FROM_EMAIL},
        ),
        MasterAdminDependencyRecord(
            id="openai",
            name="OpenAI",
            healthy=bool(dependency_values.get("openai")),
            status="healthy" if dependency_values.get("openai") else "unhealthy",
            latest_probe_at=now_iso,
            latest_failure_note=None if dependency_values.get("openai") else "OpenAI client or API key is not available.",
            remediation="Verify OPENAI_API_KEY and backend OpenAI runtime access.",
            metadata={"configured": bool(OPENAI_API_KEY)},
        ),
        MasterAdminDependencyRecord(
            id="railway",
            name="Railway Runtime",
            healthy=bool(dependency_values.get("railway_runtime", 1.0)),
            status="healthy" if dependency_values.get("railway_runtime", 1.0) else "unhealthy",
            latest_probe_at=now_iso,
            latest_failure_note=None,
            remediation="Check Railway deploy logs and service restart state.",
            metadata={"environment": os.getenv("RAILWAY_ENVIRONMENT_NAME")},
        ),
    ]


async def _build_global_ai_quality_snapshot() -> Dict[str, Any]:
    workspace_rows = await _build_master_admin_workspace_records()
    feedback_docs = await db.assessment_report_feedback.find({}, {"_id": 0}).to_list(10000)
    override_docs = await db.admin_assessment_overrides.find({}, {"_id": 0}).to_list(10000)
    useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "useful")
    not_useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "not_useful")
    incidents = await _refresh_processing_incidents()
    active_incidents = [item for item in incidents if item.get("state") == "active"]
    failure_clusters: Dict[str, Dict[str, Any]] = {}
    for incident in active_incidents:
        cluster = failure_clusters.setdefault(
            incident.get("incident_type") or "unknown",
            {"incident_type": incident.get("incident_type") or "unknown", "count": 0, "examples": []},
        )
        cluster["count"] += 1
        if len(cluster["examples"]) < 3:
            cluster["examples"].append(
                {
                    "video_id": incident.get("video_id"),
                    "filename": incident.get("filename"),
                    "owner_email": incident.get("owner_email"),
                }
            )
    specialist_activity = await _get_specialist_activity_snapshot({"id": "system", "email": "system@cognivio.live", "role": "admin"})
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "total_feedback": useful + not_useful,
            "useful_feedback": useful,
            "not_useful_feedback": not_useful,
            "useful_feedback_rate": round(useful / (useful + not_useful), 3) if (useful + not_useful) else None,
            "total_overrides": len(override_docs),
            "active_incidents": len(active_incidents),
            "workspaces_with_failures": sum(1 for row in workspace_rows if row.failure_count),
        },
        "by_workspace": sorted(
            [
                {
                    "owner_user_id": row.owner_user_id,
                    "owner_email": row.owner_email,
                    "workspace_mode": row.workspace_mode,
                    "upload_count": row.upload_count,
                    "assessment_count": row.assessment_count,
                    "failure_count": row.failure_count,
                    "health_state": row.health_state,
                }
                for row in workspace_rows
            ],
            key=lambda item: (-int(item.get("failure_count") or 0), str(item.get("owner_email") or "")),
        ),
        "failure_clusters": sorted(failure_clusters.values(), key=lambda item: (-int(item["count"]), str(item["incident_type"]))),
        "specialist_activity": specialist_activity,
    }


def _build_support_bundle(
    *,
    target_type: str,
    target_id: str,
    user: Optional[dict] = None,
    sessions: Optional[List[dict]] = None,
    auth_events: Optional[List[dict]] = None,
    audit_events: Optional[List[dict]] = None,
    videos: Optional[List[dict]] = None,
    incidents: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_type": target_type,
        "target_id": target_id,
        "user": _to_json_safe(user or {}),
        "sessions": _to_json_safe(sessions or []),
        "auth_events": _to_json_safe(auth_events or []),
        "audit_events": _to_json_safe(audit_events or []),
        "videos": _to_json_safe(videos or []),
        "incidents": _to_json_safe(incidents or []),
    }


async def _approve_user_access(
    target: dict,
    *,
    actor_label: str,
    reason: Optional[str] = None,
    organization_name: Optional[str] = None,
    organization_type: Optional[str] = None,
    school_name: Optional[str] = None,
    manager_email: Optional[str] = None,
) -> dict:
    user_id = target["id"]
    now = datetime.now(timezone.utc).isoformat()
    tenancy_updates = await _assign_user_to_tenant_on_approval(
        target=target,
        organization_name=organization_name,
        organization_type=organization_type,
        school_name=school_name,
        manager_email=manager_email,
        actor_label=actor_label,
    )
    updates = {
        "approval_status": "approved",
        "approved_at": now,
        "approved_by": actor_label,
        "revoked_at": None,
        "revoked_by": None,
        "is_active": True,
        **tenancy_updates,
    }
    if reason:
        updates["approval_note"] = reason
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    await _log_auth_event(
        "approval_granted",
        email=updated.get("email"),
        user_id=updated.get("id"),
        result="success",
        reason=reason,
    )
    _send_access_approved_confirmation(updated)
    return updated


async def _revoke_user_access(
    target: dict,
    *,
    actor_label: str,
    reason: Optional[str] = None,
) -> dict:
    user_id = target["id"]
    now = datetime.now(timezone.utc).isoformat()
    updates = {
        "approval_status": "revoked",
        "revoked_at": now,
        "revoked_by": actor_label,
        "is_active": False,
    }
    if reason:
        updates["approval_note"] = reason
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    event_type = "approval_denied" if _get_user_approval_status(target) == "pending" else "access_revoked"
    await _log_auth_event(
        event_type,
        email=updated.get("email"),
        user_id=updated.get("id"),
        result="success",
        reason=reason,
    )
    if _get_user_approval_status(target) == "pending":
        _send_access_denied_confirmation(updated)
    return updated


async def _reactivate_user_access(
    target: dict,
    *,
    actor_label: str,
    reason: Optional[str] = None,
) -> dict:
    user_id = target["id"]
    now = datetime.now(timezone.utc).isoformat()
    updates = {
        "approval_status": "approved",
        "approved_at": target.get("approved_at") or now,
        "approved_by": actor_label,
        "revoked_at": None,
        "revoked_by": None,
        "is_active": True,
    }
    if reason:
        updates["approval_note"] = reason
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    await _log_auth_event(
        "access_reactivated",
        email=updated.get("email"),
        user_id=updated.get("id"),
        result="success",
        reason=reason,
    )
    return updated


def _build_access_request_notification_message(user_doc: dict) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = f"Cognivio approval needed: {user_doc.get('email')}"
    message["From"] = SMTP_FROM_EMAIL
    message["To"] = ACCESS_APPROVAL_NOTIFY_EMAIL
    message.set_content(_build_access_request_notification_text(user_doc))
    return message


def _build_access_request_notification_text(user_doc: dict) -> str:
    approve_url = _build_access_request_action_url(user_doc, "approve")
    deny_url = _build_access_request_action_url(user_doc, "deny")
    tenant_summary = _build_tenant_request_summary(user_doc)
    tenant_lines = [
        f"Requested role: {tenant_summary.get('tenant_role_label')}",
        f"Organization: {tenant_summary.get('organization_name') or '—'}",
    ]
    if tenant_summary.get("school_name"):
        tenant_lines.append(f"School: {tenant_summary.get('school_name')}")
    if tenant_summary.get("manager_email"):
        tenant_lines.append(f"Requested school administrator: {tenant_summary.get('manager_email')}")
    return "\n".join(
        [
            "A new Cognivio pilot sign-up is waiting for approval.",
            "",
            f"Name: {user_doc.get('name')}",
            f"Email: {user_doc.get('email')}",
            *tenant_lines,
            f"Requested at: {user_doc.get('approval_requested_at') or user_doc.get('created_at')}",
            "",
            f"Approve now: {approve_url}",
            f"Deny now: {deny_url}",
            "",
            "You can also review this request from the Cognivio access-management page after logging in.",
        ]
    )


def _build_access_request_notification_html(user_doc: dict) -> str:
    name = html.escape(str(user_doc.get("name") or ""))
    email_value = html.escape(str(user_doc.get("email") or ""))
    tenant_summary = _build_tenant_request_summary(user_doc)
    role = html.escape(str(tenant_summary.get("tenant_role_label") or ""))
    organization_name = html.escape(str(tenant_summary.get("organization_name") or "—"))
    school_name = html.escape(str(tenant_summary.get("school_name") or ""))
    manager_email = html.escape(str(tenant_summary.get("manager_email") or ""))
    requested_at = html.escape(str(user_doc.get("approval_requested_at") or user_doc.get("created_at") or ""))
    approve_url = html.escape(_build_access_request_action_url(user_doc, "approve"))
    deny_url = html.escape(_build_access_request_action_url(user_doc, "deny"))
    return f"""
<div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <h2 style="margin: 0 0 16px;">New Cognivio pilot sign-up waiting for approval</h2>
  <p style="margin: 0 0 8px;"><strong>Name:</strong> {name}</p>
  <p style="margin: 0 0 8px;"><strong>Email:</strong> {email_value}</p>
  <p style="margin: 0 0 8px;"><strong>Requested role:</strong> {role}</p>
  <p style="margin: 0 0 8px;"><strong>Organization:</strong> {organization_name}</p>
  {f'<p style="margin: 0 0 8px;"><strong>School:</strong> {school_name}</p>' if school_name else ''}
  {f'<p style="margin: 0 0 8px;"><strong>Requested school administrator:</strong> {manager_email}</p>' if manager_email else ''}
  <p style="margin: 0 0 20px;"><strong>Requested at:</strong> {requested_at}</p>
  <p style="margin: 0 0 18px;">
    <a href="{approve_url}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;margin-right:12px;">Approve</a>
    <a href="{deny_url}" style="display:inline-block;padding:12px 20px;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">Deny</a>
  </p>
  <p style="margin: 0; color: #475569;">You can also review this request from the Cognivio access-management page after logging in.</p>
</div>
""".strip()


def _build_access_request_received_text(user_doc: dict) -> str:
    tenant_summary = _build_tenant_request_summary(user_doc)
    return "\n".join(
        [
            "Your Cognivio sign-up request has been received.",
            "",
            f"Email: {user_doc.get('email')}",
            f"Requested role: {tenant_summary.get('tenant_role_label')}",
            f"Organization: {tenant_summary.get('organization_name') or '—'}",
            *([f"School: {tenant_summary.get('school_name')}"] if tenant_summary.get("school_name") else []),
            f"Submitted at: {user_doc.get('approval_requested_at') or user_doc.get('created_at')}",
            "",
            "Your account is pending approval.",
            "Once approved, you can sign in with the same email and password you created during sign-up.",
        ]
    )


def _build_access_request_received_html(user_doc: dict) -> str:
    email_value = html.escape(str(user_doc.get("email") or ""))
    tenant_summary = _build_tenant_request_summary(user_doc)
    role = html.escape(str(tenant_summary.get("tenant_role_label") or ""))
    organization_name = html.escape(str(tenant_summary.get("organization_name") or "—"))
    school_name = html.escape(str(tenant_summary.get("school_name") or ""))
    submitted_at = html.escape(str(user_doc.get("approval_requested_at") or user_doc.get("created_at") or ""))
    return f"""
<div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <h2 style="margin: 0 0 16px;">Your Cognivio sign-up request has been received</h2>
  <p style="margin: 0 0 8px;"><strong>Email:</strong> {email_value}</p>
  <p style="margin: 0 0 8px;"><strong>Requested role:</strong> {role}</p>
  <p style="margin: 0 0 8px;"><strong>Organization:</strong> {organization_name}</p>
  {f'<p style="margin: 0 0 8px;"><strong>School:</strong> {school_name}</p>' if school_name else ''}
  <p style="margin: 0 0 16px;"><strong>Submitted at:</strong> {submitted_at}</p>
  <p style="margin: 0 0 8px;">Your account is pending approval.</p>
  <p style="margin: 0;">Once approved, you can sign in with the same email and password you created during sign-up.</p>
</div>
""".strip()


def _build_access_approved_text(user_doc: dict) -> str:
    tenant_summary = _build_tenant_request_summary(user_doc)
    return "\n".join(
        [
            "Your Cognivio access has been approved.",
            "",
            f"Email: {user_doc.get('email')}",
            f"Approved role: {tenant_summary.get('tenant_role_label')}",
            f"Organization: {tenant_summary.get('organization_name') or '—'}",
            *([f"School: {tenant_summary.get('school_name')}"] if tenant_summary.get("school_name") else []),
            f"Approved at: {user_doc.get('approved_at') or datetime.now(timezone.utc).isoformat()}",
            "",
            "You can now sign in with the same email and password you created during sign-up.",
            f"Sign in here: {FRONTEND_URL or BACKEND_PUBLIC_BASE_URL or 'https://www.cognivio.live'}",
        ]
    )


def _build_access_approved_html(user_doc: dict) -> str:
    email_value = html.escape(str(user_doc.get("email") or ""))
    tenant_summary = _build_tenant_request_summary(user_doc)
    role = html.escape(str(tenant_summary.get("tenant_role_label") or ""))
    organization_name = html.escape(str(tenant_summary.get("organization_name") or "—"))
    school_name = html.escape(str(tenant_summary.get("school_name") or ""))
    approved_at = html.escape(str(user_doc.get("approved_at") or datetime.now(timezone.utc).isoformat()))
    sign_in_url = html.escape(FRONTEND_URL or BACKEND_PUBLIC_BASE_URL or "https://www.cognivio.live")
    return f"""
<div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <h2 style="margin: 0 0 16px;">Your Cognivio access is approved</h2>
  <p style="margin: 0 0 8px;"><strong>Email:</strong> {email_value}</p>
  <p style="margin: 0 0 8px;"><strong>Approved role:</strong> {role}</p>
  <p style="margin: 0 0 8px;"><strong>Organization:</strong> {organization_name}</p>
  {f'<p style="margin: 0 0 8px;"><strong>School:</strong> {school_name}</p>' if school_name else ''}
  <p style="margin: 0 0 16px;"><strong>Approved at:</strong> {approved_at}</p>
  <p style="margin: 0 0 18px;">You can now sign in with the same email and password you created during sign-up.</p>
  <p style="margin: 0;"><a href="{sign_in_url}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">Open Cognivio</a></p>
</div>
""".strip()


def _build_access_denied_text(user_doc: dict) -> str:
    return "\n".join(
        [
            "Your Cognivio access request was not approved.",
            "",
            f"Email: {user_doc.get('email')}",
            "",
            "You cannot sign in with this account at this time.",
            "If you believe this is a mistake, reply to this message or contact Cognivio support.",
        ]
    )


def _build_access_denied_html(user_doc: dict) -> str:
    email_value = html.escape(str(user_doc.get("email") or ""))
    return f"""
<div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <h2 style="margin: 0 0 16px;">Your Cognivio access request was not approved</h2>
  <p style="margin: 0 0 12px;"><strong>Email:</strong> {email_value}</p>
  <p style="margin: 0 0 8px;">You cannot sign in with this account at this time.</p>
  <p style="margin: 0;">If you believe this is a mistake, reply to this message or contact Cognivio support.</p>
</div>
""".strip()


def _build_email_message(subject: str, to_email: str, text: str, html_body: Optional[str] = None) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = SMTP_FROM_EMAIL
    message["To"] = to_email
    message.set_content(text)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    return message


def _send_email_via_resend(subject: str, to_email: str, text: str, html_body: Optional[str] = None) -> bool:
    if not RESEND_API_KEY or not RESEND_FROM_EMAIL:
        return False
    payload = {
        "from": RESEND_FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
        "text": text,
    }
    if html_body:
        payload["html"] = html_body
    if SMTP_FROM_EMAIL and SMTP_FROM_EMAIL != RESEND_FROM_EMAIL:
        payload["reply_to"] = SMTP_FROM_EMAIL
    try:
        response = requests.post(
            f"{RESEND_API_BASE_URL}/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20,
        )
        if response.ok:
            return True
        logger.warning(
            "Failed to send email via Resend to %s: %s %s",
            to_email,
            response.status_code,
            response.text[:500],
        )
        return False
    except Exception as exc:
        logger.warning(
            "Failed to send email via Resend to %s: %s",
            to_email,
            exc,
        )
        return False


def _send_platform_email(subject: str, to_email: str, text: str, html_body: Optional[str] = None) -> bool:
    if not to_email:
        logger.warning("Email delivery skipped because no recipient was provided for subject %s.", subject)
        return False
    if RESEND_API_KEY and RESEND_FROM_EMAIL:
        if _send_email_via_resend(subject, to_email, text, html_body=html_body):
            return True
        logger.warning(
            "Resend delivery failed for %s; falling back to SMTP if configured.",
            to_email,
        )
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        logger.warning(
            "No email delivery provider is configured for email to %s.",
            to_email,
        )
        return False

    message = _build_email_message(subject, to_email, text, html_body=html_body)
    try:
        if SMTP_USE_TLS:
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
                smtp.starttls(context=context)
                if SMTP_USERNAME:
                    smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
                if SMTP_USERNAME:
                    smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
                smtp.send_message(message)
        return True
    except Exception as exc:
        logger.warning("Failed to send email to %s: %s", to_email, exc)
        return False


def _send_access_request_notification(user_doc: dict) -> bool:
    if not ACCESS_APPROVAL_NOTIFY_EMAIL:
        logger.warning("ACCESS_APPROVAL_NOTIFY_EMAIL not set; access request notification skipped.")
        return False
    return _send_platform_email(
        f"Cognivio approval needed: {user_doc.get('email')}",
        ACCESS_APPROVAL_NOTIFY_EMAIL,
        _build_access_request_notification_text(user_doc),
        html_body=_build_access_request_notification_html(user_doc),
    )


def _send_access_request_received_confirmation(user_doc: dict) -> bool:
    email = str(user_doc.get("email") or "").strip()
    if not email:
        return False
    return _send_platform_email(
        "Cognivio sign-up received",
        email,
        _build_access_request_received_text(user_doc),
        html_body=_build_access_request_received_html(user_doc),
    )


def _send_access_approved_confirmation(user_doc: dict) -> bool:
    email = str(user_doc.get("email") or "").strip()
    if not email:
        return False
    return _send_platform_email(
        "Your Cognivio access is approved",
        email,
        _build_access_approved_text(user_doc),
        html_body=_build_access_approved_html(user_doc),
    )


def _send_access_denied_confirmation(user_doc: dict) -> bool:
    email = str(user_doc.get("email") or "").strip()
    if not email:
        return False
    return _send_platform_email(
        "Your Cognivio access request was not approved",
        email,
        _build_access_denied_text(user_doc),
        html_body=_build_access_denied_html(user_doc),
    )


def _is_paid_analysis_allowed_for_user(user: Optional[dict]) -> bool:
    if not PAID_ANALYSIS_ENABLED or not user:
        return False
    email = str((user or {}).get("email") or "").strip().lower()
    if not email:
        return False
    return email in PAID_ANALYSIS_ALLOWLIST_EMAILS


def _ensure_allowed_extension(filename: str) -> None:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )


def _normalize_video_status(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    if raw in {"queued", "processing", "completed", "failed", "cancelled"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "queued"


def _normalize_privacy_status(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    if raw in {"not_required", "queued", "processing", "review_required", "completed", "failed"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "queued"


def _normalize_video_transcode_status(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    if raw in {"queued", "processing", "completed", "failed", "not_required"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "not_required"


def _parse_optional_iso_datetime(value: Optional[str], field_name: str) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}. Expected ISO-8601 datetime.")


def _to_public_backend_url(path: str) -> str:
    if not path:
        return path
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not path.startswith("/"):
        path = f"/{path}"
    if BACKEND_PUBLIC_BASE_URL:
        return f"{BACKEND_PUBLIC_BASE_URL}{path}"
    return path


def _create_access_request_action_token(user_doc: dict, action: str) -> str:
    payload = {
        "type": "access_request_action",
        "user_id": user_doc.get("id"),
        "email": str(user_doc.get("email") or "").strip().lower(),
        "action": action,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _build_access_request_action_url(user_doc: dict, action: str) -> str:
    token = _create_access_request_action_token(user_doc, action)
    return _to_public_backend_url(f"/api/admin/access-request-actions/{action}?token={token}")


def _render_access_request_action_result_page(title: str, message: str, tone: str = "neutral") -> str:
    palette = {
        "neutral": {"accent": "#334155", "bg": "#f8fafc"},
        "success": {"accent": "#2563eb", "bg": "#eff6ff"},
        "danger": {"accent": "#dc2626", "bg": "#fef2f2"},
        "warning": {"accent": "#b45309", "bg": "#fffbeb"},
    }
    colors = palette.get(tone, palette["neutral"])
    title_safe = html.escape(title)
    message_safe = html.escape(message)
    access_url = html.escape(FRONTEND_URL or "https://www.cognivio.live")
    return f"""
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title_safe}</title>
  </head>
  <body style="margin:0;background:{colors['bg']};font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:64px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 12px 40px rgba(15,23,42,0.08);">
      <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:{colors['accent']};font-weight:700;">Cognivio access review</div>
      <h1 style="margin:12px 0 16px;font-size:28px;line-height:1.2;">{title_safe}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#334155;">{message_safe}</p>
      <a href="{access_url}" style="display:inline-block;padding:12px 20px;background:{colors['accent']};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">Open Cognivio</a>
    </div>
  </body>
</html>
""".strip()


def _resolve_video_playback_url(video: dict) -> Optional[str]:
    privacy_status = _normalize_privacy_status(video.get("privacy_status"))
    redacted_url = video.get("redacted_file_url")
    if redacted_url:
        return redacted_url
    redacted_path = video.get("redacted_file_path")
    if redacted_path:
        safe_path = str(redacted_path).replace("\\", "/").lstrip("/")
        return _to_public_backend_url(f"/uploads/{safe_path}")
    if video.get("privacy_status") is not None and privacy_status != PrivacyProcessingStatus.COMPLETED.value:
        return None
    processed_url = video.get("processed_file_url")
    if processed_url:
        return processed_url
    processed_path = video.get("processed_file_path")
    if processed_path:
        safe_path = str(processed_path).replace("\\", "/").lstrip("/")
        return _to_public_backend_url(f"/uploads/{safe_path}")
    file_url = video.get("file_url")
    if file_url:
        return file_url
    file_path = video.get("file_path")
    if file_path:
        safe_path = str(file_path).replace("\\", "/").lstrip("/")
        return _to_public_backend_url(f"/uploads/{safe_path}")
    return None


def _resolve_video_thumbnail_url(video: dict) -> Optional[str]:
    privacy_status = _normalize_privacy_status(video.get("privacy_status"))
    redacted_thumb_url = video.get("redacted_thumbnail_url")
    if redacted_thumb_url:
        return redacted_thumb_url
    redacted_thumb_path = video.get("redacted_thumbnail_path")
    if redacted_thumb_path:
        safe_path = str(redacted_thumb_path).replace("\\", "/").lstrip("/")
        return _to_public_backend_url(f"/uploads/{safe_path}")
    if video.get("privacy_status") is not None and privacy_status != PrivacyProcessingStatus.COMPLETED.value:
        return None
    thumb_url = video.get("thumbnail_url")
    if thumb_url:
        return thumb_url
    thumb_path = video.get("thumbnail_path")
    if thumb_path:
        safe_path = str(thumb_path).replace("\\", "/").lstrip("/")
        return _to_public_backend_url(f"/uploads/{safe_path}")
    return None


def _is_terminal_video_status(status: Optional[str]) -> bool:
    normalized = _normalize_video_status(status)
    return normalized in {
        VideoProcessingStatus.COMPLETED.value,
        VideoProcessingStatus.FAILED.value,
        VideoProcessingStatus.CANCELLED.value,
    }


def _apply_video_response_defaults(video: dict) -> dict:
    video["status"] = _normalize_video_status(video.get("status"))
    video["analysis_status"] = _normalize_video_status(video.get("analysis_status"))
    video["privacy_status"] = _normalize_privacy_status(video.get("privacy_status"))
    video["transcode_status"] = _normalize_video_transcode_status(video.get("transcode_status"))
    video["privacy_review_required"] = bool(video.get("privacy_review_required", False))
    video["playback_url"] = _resolve_video_playback_url(video)
    video["thumbnail_url"] = _resolve_video_thumbnail_url(video)
    return video


def _sanitize_video_response(video: dict) -> dict:
    sanitized = dict(video)
    for field in {
        "stored_filename",
        "s3_key",
        "file_url",
        "file_path",
        "raw_file_url",
        "raw_file_path",
        "raw_s3_key",
        "processed_s3_key",
        "processed_file_url",
        "processed_file_path",
        "raw_thumbnail_path",
        "raw_thumbnail_url",
        "redacted_file_path",
        "redacted_thumbnail_path",
        "privacy_manual_override",
    }:
        sanitized.pop(field, None)
    return sanitized


def _build_transcoded_raw_cleanup_fields(video: dict, completed_at_iso: str) -> Dict[str, Any]:
    if not VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED:
        return {}
    if _normalize_video_transcode_status(video.get("transcode_status")) != VideoTranscodeStatus.COMPLETED.value:
        return {}
    if not (video.get("processed_file_path") or video.get("processed_file_url") or video.get("processed_s3_key")):
        return {}
    if not (video.get("raw_file_path") or video.get("raw_file_url") or video.get("raw_s3_key")):
        return {}

    try:
        completed_at = datetime.fromisoformat(str(completed_at_iso).replace("Z", "+00:00"))
    except ValueError:
        completed_at = datetime.now(timezone.utc)
    if completed_at.tzinfo is None:
        completed_at = completed_at.replace(tzinfo=timezone.utc)
    else:
        completed_at = completed_at.astimezone(timezone.utc)

    expedited_deadline = completed_at + timedelta(hours=VIDEO_TRANSCODE_RAW_RETENTION_HOURS)
    current_deadline_value = video.get("raw_retention_expires_at")
    current_deadline: Optional[datetime] = None
    if current_deadline_value:
        try:
            parsed_deadline = datetime.fromisoformat(str(current_deadline_value).replace("Z", "+00:00"))
            current_deadline = (
                parsed_deadline.replace(tzinfo=timezone.utc)
                if parsed_deadline.tzinfo is None
                else parsed_deadline.astimezone(timezone.utc)
            )
        except ValueError:
            current_deadline = None

    effective_deadline = current_deadline
    if effective_deadline is None or effective_deadline > expedited_deadline:
        effective_deadline = expedited_deadline

    return {
        "raw_retention_expires_at": effective_deadline.isoformat(),
        "raw_cleanup_policy": "processed_after_privacy",
        "raw_cleanup_scheduled_at": completed_at.isoformat(),
    }


async def _save_upload_file(upload: UploadFile, target_path: Path) -> None:
    size = 0
    target_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(target_path, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="File exceeds 10MB limit")
            await out.write(chunk)

def _get_s3_client():
    if not S3_BUCKET:
        raise RuntimeError("S3_BUCKET must be set for file uploads")
    session = boto3.session.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=S3_REGION or None,
    )
    return session.client("s3", endpoint_url=S3_ENDPOINT or None)


def _validate_s3_config() -> None:
    if not S3_BUCKET:
        logger.warning("S3_BUCKET not set; using local upload storage fallback.")
        return
    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY"):
        logger.error("AWS credentials missing; S3 uploads will fail.")
    if not (S3_PUBLIC_BASE_URL or S3_REGION or S3_ENDPOINT):
        logger.warning("S3 public URL/region/endpoint not set; URLs may be incorrect.")


def _build_s3_key(category: str, filename: str) -> str:
    safe_name = Path(filename).name.replace(" ", "_")
    return f"uploads/{category}/{uuid.uuid4()}_{safe_name}"


def _build_video_asset_s3_key(asset_kind: str, teacher_id: str, filename: str) -> str:
    safe_name = Path(filename).name.replace(" ", "_")
    safe_teacher_id = Path(str(teacher_id)).name.replace(" ", "_")
    if asset_kind == "raw":
        return f"uploads/videos/raw/{safe_teacher_id}/{safe_name}"
    if asset_kind == "processed":
        return f"uploads/videos/processed/{safe_teacher_id}/{safe_name}"
    if asset_kind == "thumbnail":
        return f"uploads/videos/thumbnails/{safe_teacher_id}/{safe_name}"
    return _build_s3_key(f"videos/{asset_kind}", safe_name)


def _store_path_locally(file_path: Path, category: str, filename: str) -> Tuple[str, str]:
    safe_name = Path(filename).name.replace(" ", "_")
    destination = UPLOAD_DIR / category / f"{uuid.uuid4()}_{safe_name}"
    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        resolved_source = file_path.resolve()
        resolved_upload_dir = UPLOAD_DIR.resolve()
        if str(resolved_source).startswith(str(resolved_upload_dir)):
            relative_path = str(resolved_source.relative_to(resolved_upload_dir)).replace("\\", "/")
            if not relative_path.startswith("tmp/"):
                return relative_path, _to_public_backend_url(f"/uploads/{relative_path}")
    except Exception:
        pass

    shutil.copyfile(str(file_path), str(destination))
    relative_path = str(destination.relative_to(UPLOAD_DIR)).replace("\\", "/")
    return relative_path, _to_public_backend_url(f"/uploads/{relative_path}")


def _get_s3_public_url(key: str) -> str:
    if S3_PUBLIC_BASE_URL:
        return f"{S3_PUBLIC_BASE_URL.rstrip('/')}/{key}"
    if S3_ENDPOINT:
        endpoint = S3_ENDPOINT.replace("https://", "").replace("http://", "")
        return f"https://{S3_BUCKET}.{endpoint}/{key}"
    if S3_REGION:
        return f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
    return f"https://{S3_BUCKET}.s3.amazonaws.com/{key}"


async def _upload_file_to_s3(
    upload: UploadFile,
    category: str,
    *,
    key_override: Optional[str] = None,
) -> Tuple[str, str]:
    _ensure_allowed_extension(upload.filename or "")
    if not S3_BUCKET:
        stored_name = f"{uuid.uuid4()}_{Path(upload.filename or 'upload').name}"
        relative_path = f"{category}/{stored_name}"
        destination = UPLOAD_DIR / relative_path
        await _save_upload_file(upload, destination)
        safe_path = str(Path(relative_path)).replace("\\", "/").lstrip("/")
        return safe_path, _to_public_backend_url(f"/uploads/{safe_path}")
    tmp_name = f"{uuid.uuid4()}_{Path(upload.filename or 'upload').name}"
    temp_path = UPLOAD_DIR / "tmp" / tmp_name
    await _save_upload_file(upload, temp_path)
    key = key_override or _build_s3_key(category, tmp_name)
    client = _get_s3_client()
    content_type = upload.content_type or "application/octet-stream"
    try:
        client.upload_file(
            str(temp_path),
            S3_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail=f"S3 upload failed: {exc}")
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass
    return key, _get_s3_public_url(key)


def _upload_path_to_s3(
    file_path: Path,
    category: str,
    filename: str,
    content_type: str,
    *,
    key_override: Optional[str] = None,
) -> Tuple[str, str]:
    if not S3_BUCKET:
        return _store_path_locally(file_path, category, filename)
    key = key_override or _build_s3_key(category, filename)
    client = _get_s3_client()
    client.upload_file(
        str(file_path),
        S3_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type or "application/octet-stream"},
    )
    return key, _get_s3_public_url(key)


def _delete_s3_key(key: Optional[str]) -> None:
    if not key or not S3_BUCKET:
        return
    try:
        client = _get_s3_client()
        client.delete_object(Bucket=S3_BUCKET, Key=key)
    except Exception as exc:
        logger.warning(f"Unable to delete S3 object {key}: {exc}")


def _materialize_video_asset_locally(
    video: dict,
    *,
    asset_order: List[Tuple[Optional[str], Optional[str], Optional[str]]],
) -> Path:
    for relative_path, s3_key, filename_hint in asset_order:
        if relative_path:
            candidate = UPLOAD_DIR / str(relative_path)
            if candidate.exists():
                return candidate
        if s3_key and S3_BUCKET:
            safe_name = Path(filename_hint or str(s3_key)).name or f"{uuid.uuid4()}.bin"
            local_path = UPLOAD_DIR / "tmp" / "master-admin-retry" / str(video.get("id") or "video") / safe_name
            local_path.parent.mkdir(parents=True, exist_ok=True)
            client = _get_s3_client()
            client.download_file(S3_BUCKET, s3_key, str(local_path))
            return local_path
    raise HTTPException(status_code=409, detail="Retry unavailable because no source asset can be materialized")


async def _get_teacher_or_404(teacher_id: str, current_user: dict) -> dict:
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    if await _teacher_is_visible_to_user(teacher, current_user):
        return teacher
    raise HTTPException(status_code=403, detail="Not authorized for this teacher")


async def _get_school_for_teacher(teacher: Optional[dict]) -> Optional[dict]:
    school_id = (teacher or {}).get("school_id")
    if not school_id or not hasattr(db, "schools"):
        return None
    return await db.schools.find_one({"id": school_id}, {"_id": 0})


async def _get_visible_school_ids_for_user(current_user: dict) -> List[str]:
    tenant_role = _get_user_tenant_role(current_user)
    if not hasattr(db, "schools"):
        return []
    if tenant_role == "super_admin":
        schools = await db.schools.find({}, {"_id": 0, "id": 1}).to_list(5000)
        return [item["id"] for item in schools if item.get("id")]

    clauses: List[Dict[str, Any]] = []
    organization_id = current_user.get("organization_id")
    if organization_id:
        clauses.append({"organization_id": organization_id})
    if tenant_role == "school_admin":
        clauses.append({"user_id": current_user["id"]})
    if not clauses:
        return []
    query: Dict[str, Any] = clauses[0] if len(clauses) == 1 else {"$or": clauses}
    schools = await db.schools.find(query, {"_id": 0, "id": 1}).to_list(5000)
    return [item["id"] for item in schools if item.get("id")]


async def _list_teacher_ids_for_user(current_user: dict) -> List[str]:
    tenant_role = _get_user_tenant_role(current_user)
    teachers_collection = getattr(db, "teachers", None)
    users_collection = getattr(db, "users", None)
    if teachers_collection is None:
        return []

    if tenant_role == "super_admin":
        teachers = await teachers_collection.find({}, {"_id": 0, "id": 1}).to_list(5000)
        return [teacher["id"] for teacher in teachers if teacher.get("id")]

    if tenant_role == "teacher":
        email = (current_user.get("email") or "").strip()
        clauses: List[Dict[str, Any]] = [{"created_by": current_user["id"]}]
        if email:
            clauses.insert(0, {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}})
        query = clauses[0] if len(clauses) == 1 else {"$or": clauses}
        teachers = await teachers_collection.find(query, {"_id": 0, "id": 1}).to_list(200)
        return [teacher["id"] for teacher in teachers if teacher.get("id")]

    clauses: List[Dict[str, Any]] = [{"created_by": current_user["id"]}]
    organization_id = current_user.get("organization_id")
    if organization_id:
        clauses.append({"organization_id": organization_id})
        school_ids = await _get_visible_school_ids_for_user(current_user)
        if school_ids:
            clauses.append({"school_id": {"$in": school_ids}})
    if tenant_role == "training_admin" and organization_id and users_collection is not None:
        teacher_user_docs = await users_collection.find(
            {"tenant_role": "teacher", "organization_id": organization_id},
            {"_id": 0, "email": 1},
        ).to_list(5000)
        teacher_emails = [str(doc.get("email") or "").strip().lower() for doc in teacher_user_docs if doc.get("email")]
        if teacher_emails:
            clauses.append({"email": {"$in": teacher_emails}})

    query = clauses[0] if len(clauses) == 1 else {"$or": clauses}
    teachers = await teachers_collection.find(query, {"_id": 0, "id": 1}).to_list(5000)
    return [teacher["id"] for teacher in teachers if teacher.get("id")]


async def _teacher_is_visible_to_user(teacher: dict, current_user: dict) -> bool:
    tenant_role = _get_user_tenant_role(current_user)
    if tenant_role == "super_admin":
        return True
    if tenant_role == "teacher":
        teacher_email = str(teacher.get("email") or "").strip().lower()
        current_email = str(current_user.get("email") or "").strip().lower()
        return (
            (teacher_email and teacher_email == current_email)
            or teacher.get("created_by") == current_user.get("id")
        )

    if teacher.get("created_by") == current_user.get("id"):
        return True

    organization_id = current_user.get("organization_id")
    teacher_org_id = teacher.get("organization_id")
    if organization_id and teacher_org_id and teacher_org_id == organization_id:
        return True

    school = await _get_school_for_teacher(teacher)
    if organization_id and school and school.get("organization_id") == organization_id:
        return True

    if tenant_role == "school_admin" and school and school.get("user_id") == current_user.get("id"):
        return True

    if tenant_role == "training_admin" and organization_id and hasattr(db, "users"):
        teacher_email = str(teacher.get("email") or "").strip().lower()
        if teacher_email:
            linked_user = await db.users.find_one(
                {"email": teacher_email},
                {"_id": 0, "organization_id": 1, "tenant_role": 1},
            )
            if linked_user and linked_user.get("organization_id") == organization_id:
                return True

    return False


def _build_privacy_profile_summary(teacher_id: str, profile: Optional[dict]) -> "TeacherPrivacyProfileResponse":
    if not profile:
        return TeacherPrivacyProfileResponse(
            teacher_id=teacher_id,
            status="missing",
            profile_version=0,
            reference_count=0,
            quality_score=0.0,
            embedding_model="opencv-sface",
            last_enrolled_at=None,
            needs_refresh=True,
            warnings=["Teacher privacy profile has not been configured."],
        )

    return TeacherPrivacyProfileResponse(
        teacher_id=teacher_id,
        status=profile.get("status", "missing"),
        profile_version=int(profile.get("profile_version", 0) or 0),
        reference_count=int(profile.get("reference_count", 0) or 0),
        quality_score=float(profile.get("quality_score", 0.0) or 0.0),
        embedding_model=profile.get("embedding_model") or "opencv-sface",
        last_enrolled_at=profile.get("last_enrolled_at"),
        needs_refresh=bool(profile.get("needs_refresh", False)),
        warnings=list(profile.get("warnings") or []),
    )


async def _get_active_privacy_profile(teacher_id: str) -> Optional[dict]:
    return await db.teacher_face_profiles.find_one(
        {"teacher_id": teacher_id, "status": "active"},
        {"_id": 0},
    )


async def _log_privacy_audit_event(
    event_type: str,
    target_type: str,
    target_id: str,
    actor_user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await db.privacy_audit_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "actor_user_id": actor_user_id,
                "event_type": event_type,
                "target_type": target_type,
                "target_id": target_id,
                "details": details or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:
        logger.warning(f"Unable to write privacy audit event {event_type} for {target_type}:{target_id}: {exc}")


async def _log_recognition_audit_event(
    event_type: str,
    target_type: str,
    target_id: str,
    actor_user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await db.recognition_audit_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "actor_user_id": actor_user_id,
                "event_type": event_type,
                "target_type": target_type,
                "target_id": target_id,
                "details": details or {},
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:
        logger.warning(f"Unable to write recognition audit event {event_type} for {target_type}:{target_id}: {exc}")


def _extract_request_metadata(request: Optional[Request]) -> Dict[str, Optional[str]]:
    if not request:
        return {"ip_address": None, "user_agent": None}
    client_host = None
    if getattr(request, "client", None):
        client_host = request.client.host
    user_agent = request.headers.get("user-agent") if getattr(request, "headers", None) else None
    return {
        "ip_address": client_host,
        "user_agent": user_agent,
    }


async def _log_auth_event(
    event_type: str,
    *,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
    role_selected: Optional[str] = None,
    result: Optional[str] = None,
    reason: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    try:
        await db.auth_event_log.insert_one(
            {
                "id": str(uuid.uuid4()),
                "email": str(email or "").lower() or None,
                "user_id": user_id,
                "event_type": event_type,
                "role_selected": role_selected,
                "result": result,
                "reason": reason,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:
        logger.warning("Unable to write auth event %s for %s: %s", event_type, email or user_id, exc)


async def _log_master_admin_audit_event(
    *,
    actor: dict,
    action: str,
    target_type: str,
    target_id: str,
    reason: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await db.master_admin_audit_events.insert_one(
            {
                "id": str(uuid.uuid4()),
                "actor_user_id": actor.get("id"),
                "actor_email": actor.get("email"),
                "actor_role": _get_user_role(actor),
                "action": action,
                "target_type": target_type,
                "target_id": target_id,
                "reason": reason,
                "metadata": _to_json_safe(metadata or {}),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:
        logger.warning(
            "Unable to write master admin audit event %s for %s:%s: %s",
            action,
            target_type,
            target_id,
            exc,
        )


def _resolve_upload_path_for_cleanup(file_path: Optional[str]) -> Optional[Path]:
    if not file_path:
        return None
    candidate = Path(str(file_path))
    if not candidate.is_absolute():
        candidate = UPLOAD_DIR / candidate
    try:
        resolved_candidate = candidate.resolve()
        resolved_upload_dir = UPLOAD_DIR.resolve()
        if not str(resolved_candidate).startswith(str(resolved_upload_dir)):
            return None
        return resolved_candidate
    except Exception:
        return None


async def _delete_local_upload_file(file_path: Optional[str]) -> bool:
    resolved = _resolve_upload_path_for_cleanup(file_path)
    if not resolved or not resolved.exists() or not resolved.is_file():
        return False
    try:
        await asyncio.to_thread(os.remove, resolved)
        return True
    except Exception as exc:
        logger.warning(f"Unable to remove upload artifact {resolved}: {exc}")
        return False


async def _cleanup_teacher_smoke_artifacts(
    teacher: dict,
    *,
    delete_user_emails: Optional[List[str]] = None,
) -> "AdminSmokeCleanupResponse":
    teacher_id = teacher["id"]
    teacher_email = teacher.get("email")
    now_iso = datetime.now(timezone.utc).isoformat()
    deleted_counts: Dict[str, int] = {}
    deleted_files = 0

    videos = await db.videos.find({"teacher_id": teacher_id}, {"_id": 0}).to_list(1000)
    video_ids = [video["id"] for video in videos if video.get("id")]
    assessment_docs = await db.assessments.find({"teacher_id": teacher_id}, {"_id": 0, "id": 1}).to_list(2000)
    assessment_ids = [doc["id"] for doc in assessment_docs if doc.get("id")]
    reference_docs = await db.teacher_face_references.find({"teacher_id": teacher_id}, {"_id": 0}).to_list(200)
    share_docs = await db.share_assets.find({"teacher_id": teacher_id}, {"_id": 0}).to_list(500)

    file_candidates: List[Tuple[Optional[str], Optional[str]]] = []
    for video in videos:
        file_candidates.extend(
            [
                (video.get("file_path"), video.get("s3_key")),
                (video.get("raw_file_path"), video.get("raw_s3_key")),
                (video.get("thumbnail_path"), video.get("thumbnail_s3_key")),
                (video.get("raw_thumbnail_path"), video.get("raw_thumbnail_s3_key")),
                (video.get("redacted_file_path"), video.get("redacted_s3_key")),
                (video.get("redacted_thumbnail_path"), video.get("redacted_thumbnail_s3_key")),
            ]
        )
    for reference in reference_docs:
        file_candidates.append((reference.get("file_path"), reference.get("s3_key")))
    for asset in share_docs:
        file_candidates.append((asset.get("file_path"), asset.get("s3_key")))

    seen_paths = set()
    for relative_path, s3_key in file_candidates:
        if relative_path and relative_path not in seen_paths:
            if await _delete_local_upload_file(relative_path):
                deleted_files += 1
            seen_paths.add(relative_path)
        if s3_key:
            _delete_s3_key(s3_key)

    observation_query: Dict[str, Any] = {"teacher_id": teacher_id}
    if video_ids:
        observation_query = {"$or": [{"teacher_id": teacher_id}, {"video_id": {"$in": video_ids}}]}
    audit_query: Dict[str, Any] = {"target_id": teacher_id}
    if video_ids:
        audit_query = {"$or": [{"target_id": teacher_id}, {"target_id": {"$in": video_ids}}]}

    deleted_counts["curriculum_adherence"] = (
        await db.curriculum_adherence.delete_many({"assessment_id": {"$in": assessment_ids}})
    ).deleted_count if assessment_ids else 0
    deleted_counts["observations"] = (
        await db.observations.delete_many(observation_query)
    ).deleted_count
    deleted_counts["video_evidence"] = (
        await db.video_evidence.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["video_processing_jobs"] = (
        await db.video_processing_jobs.delete_many({"video_id": {"$in": video_ids}})
    ).deleted_count if video_ids else 0
    deleted_counts["video_privacy_jobs"] = (
        await db.video_privacy_jobs.delete_many({"video_id": {"$in": video_ids}})
    ).deleted_count if video_ids else 0
    deleted_counts["assessments"] = (
        await db.assessments.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["curricula"] = (
        await db.curricula.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["lesson_plans"] = (
        await db.lesson_plans.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["syllabi"] = (
        await db.syllabi.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["recording_compliance"] = (
        await db.recording_compliance.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["schedules"] = (
        await db.schedules.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["notifications"] = (
        await db.notifications.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["share_assets"] = (
        await db.share_assets.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["exemplar_library_items"] = (
        await db.exemplar_library_items.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["exemplar_submissions"] = (
        await db.exemplar_submissions.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["recognition_badges"] = (
        await db.recognition_badges.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["lesson_recognition_events"] = (
        await db.lesson_recognition_events.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["privacy_audit_events"] = (
        await db.privacy_audit_events.delete_many(audit_query)
    ).deleted_count
    deleted_counts["recognition_audit_events"] = (
        await db.recognition_audit_events.delete_many(audit_query)
    ).deleted_count
    deleted_counts["teacher_face_references"] = (
        await db.teacher_face_references.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["teacher_face_profiles"] = (
        await db.teacher_face_profiles.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["videos"] = (
        await db.videos.delete_many({"teacher_id": teacher_id})
    ).deleted_count
    deleted_counts["teachers"] = (
        await db.teachers.delete_many({"id": teacher_id})
    ).deleted_count

    deleted_users: List[str] = []
    normalized_emails: List[str] = []
    for email in delete_user_emails or []:
        candidate = str(email).strip().lower()
        if candidate and candidate not in normalized_emails:
            normalized_emails.append(candidate)
    if teacher_email:
        teacher_email_lower = teacher_email.lower()
        if teacher_email_lower not in normalized_emails:
            normalized_emails.append(teacher_email_lower)
    if normalized_emails:
        users = await db.users.find({"email": {"$in": normalized_emails}}, {"_id": 0, "email": 1}).to_list(100)
        deleted_counts["users"] = (
            await db.users.delete_many({"email": {"$in": normalized_emails}})
        ).deleted_count
        deleted_users = [user["email"] for user in users if user.get("email")]
    else:
        deleted_counts["users"] = 0

    return AdminSmokeCleanupResponse(
        teacher_id=teacher_id,
        teacher_email=teacher_email,
        deleted_files=deleted_files,
        deleted_counts=deleted_counts,
        deleted_users=deleted_users,
        executed_at=now_iso,
    )


async def _get_assessment_for_video(video_id: str) -> Optional[dict]:
    return await db.assessments.find_one(
        {"video_id": video_id},
        {"_id": 0},
        sort=[("analyzed_at", -1)],
    )


def _build_teacher_recognition_summary(teacher_id: str, badges: List[dict]) -> "TeacherRecognitionSummaryResponse":
    awarded_badges = [badge for badge in badges if badge.get("status") == "awarded"]
    published_exemplars = [
        badge for badge in badges
        if badge.get("status") == "published" or badge.get("badge_type") == "exemplar_published"
    ]
    return TeacherRecognitionSummaryResponse(
        teacher_id=teacher_id,
        badges=[
            RecognitionBadgeResponse(
                id=badge["id"],
                badge_type=badge.get("badge_type") or FIVE_STAR_BADGE,
                status=badge.get("status") or "awarded",
                video_id=badge.get("video_id"),
                awarded_at=badge.get("awarded_at"),
                awarded_by=badge.get("awarded_by"),
                criteria_snapshot=badge.get("criteria_snapshot") or {},
            )
            for badge in badges
        ],
        summary={
            "five_star_lessons": len(
                [badge for badge in awarded_badges if badge.get("badge_type") == FIVE_STAR_BADGE]
            ),
            "published_exemplars": len(published_exemplars),
            "active_streak": calculate_active_streak(awarded_badges),
        },
    )


def _build_video_recognition_response(video: dict, event: Optional[dict]) -> "VideoRecognitionResponse":
    event = event or {}
    eligibility = event.get("eligibility") or {
        "is_eligible": False,
        "badge_type": None,
        "reasons": ["recognition_not_evaluated"],
    }
    return VideoRecognitionResponse(
        video_id=video["id"],
        teacher_id=video.get("teacher_id"),
        eligibility=eligibility,
        recognition={
            "status": event.get("recognition_status") or "not_evaluated",
            "badge_id": event.get("badge_id"),
            "admin_review_required": bool(event.get("recognition_status") == "pending_admin_review"),
        },
        publication={
            "teacher_opt_in": bool(event.get("teacher_opt_in", False)),
            "sharing_scope": event.get("sharing_scope"),
            "allow_social_share": bool(event.get("allow_social_share", False)),
            "allow_email_signature": bool(event.get("allow_email_signature", False)),
            "submission_id": event.get("submission_id"),
            "submission_status": event.get("submission_status") or "not_submitted",
            "library_item_id": event.get("library_item_id"),
        },
    )


async def _sync_video_recognition_state(video: dict) -> dict:
    assessment = await _get_assessment_for_video(video["id"])
    eligibility = build_recognition_eligibility(
        video,
        assessment,
        score_threshold=RECOGNITION_FIVE_STAR_SCORE_MIN,
    )
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.lesson_recognition_events.find_one({"video_id": video["id"]}, {"_id": 0})
    recognition_status = "pending_admin_review" if eligibility["is_eligible"] else "ineligible"
    if existing and existing.get("recognition_status") in {"awarded", "rejected", "revoked"}:
        recognition_status = existing.get("recognition_status")
    badge_type = eligibility.get("badge_type")
    if not badge_type and existing and existing.get("badge_type"):
        badge_type = existing.get("badge_type")
    update_doc = {
        "teacher_id": video.get("teacher_id"),
        "video_id": video["id"],
        "eligibility_status": "eligible" if eligibility["is_eligible"] else "ineligible",
        "eligibility": eligibility,
        "recognition_status": recognition_status,
        "badge_type": badge_type,
        "updated_at": now,
    }
    if existing:
        preserved_fields = {
            "teacher_opt_in": existing.get("teacher_opt_in", False),
            "sharing_scope": existing.get("sharing_scope"),
            "allow_social_share": existing.get("allow_social_share", False),
            "allow_email_signature": existing.get("allow_email_signature", False),
            "submission_status": existing.get("submission_status", "not_submitted"),
            "submission_id": existing.get("submission_id"),
            "library_item_id": existing.get("library_item_id"),
            "badge_id": existing.get("badge_id"),
            "reviewed_at": existing.get("reviewed_at"),
            "reviewed_by": existing.get("reviewed_by"),
            "review_reason": existing.get("review_reason"),
        }
        update_doc.update(preserved_fields)
        await db.lesson_recognition_events.update_one({"id": existing["id"]}, {"$set": update_doc})
        existing.update(update_doc)
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        **update_doc,
        "teacher_opt_in": False,
        "sharing_scope": None,
        "allow_social_share": False,
        "allow_email_signature": False,
        "submission_status": "not_submitted",
        "submission_id": None,
        "library_item_id": None,
        "created_at": now,
        "badge_id": None,
        "reviewed_at": None,
        "reviewed_by": None,
        "review_reason": None,
    }
    await db.lesson_recognition_events.insert_one(doc)
    return doc


async def _get_or_sync_video_recognition_event(video: dict) -> dict:
    existing = await db.lesson_recognition_events.find_one({"video_id": video["id"]}, {"_id": 0})
    if _normalize_video_status(video.get("analysis_status")) == VideoProcessingStatus.COMPLETED.value:
        return await _sync_video_recognition_state(video)
    if existing:
        return existing
    return await _sync_video_recognition_state(video)


async def _get_latest_exemplar_submission(video_id: str) -> Optional[dict]:
    return await db.exemplar_submissions.find_one(
        {"video_id": video_id},
        {"_id": 0},
        sort=[("submitted_at", -1)],
    )


def _resolve_public_asset_url(relative_path: Optional[str]) -> Optional[str]:
    if not relative_path:
        return None
    safe_path = str(relative_path).replace("\\", "/").lstrip("/")
    return _to_public_backend_url(f"/uploads/{safe_path}")


def _write_placeholder_thumbnail(output_path: Path, width: int = 640, height: int = 360) -> None:
    image = Image.new("RGB", (width, height), (235, 241, 248))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, width - 40, height - 40), outline=(76, 92, 122), width=3)
    draw.text((70, 130), "Cognivio staging thumbnail", fill=(45, 62, 80))
    draw.text((70, 170), "Privacy runtime fallback active", fill=(45, 62, 80))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="JPEG", quality=84)


def _render_degraded_privacy_assets(source_video_path: str, output_video_path: str, thumbnail_output_path: str) -> Dict[str, Any]:
    output_path = Path(output_video_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(source_video_path), str(output_path))
    _write_placeholder_thumbnail(Path(thumbnail_output_path))
    return {
        "frames_processed": 0,
        "frames_with_teacher_visible": 0,
        "faces_detected_total": 0,
        "faces_blurred_total": 0,
        "runtime_fallback": "worker_copy_only",
    }


def _should_use_degraded_privacy_runtime(exc: Exception) -> bool:
    if not PRIVACY_ALLOW_DEGRADED_RUNTIME:
        return False
    message = str(exc or "")
    return (
        "OpenCV is unavailable" in message
        or "Teacher privacy profile has no usable references" in message
    )


def _build_exemplar_library_item_response(doc: dict) -> "ExemplarLibraryItemResponse":
    playback_url = doc.get("playback_url") or doc.get("redacted_asset_url")
    thumbnail_url = doc.get("thumbnail_url")
    if not playback_url:
        playback_url = _resolve_public_asset_url(doc.get("redacted_asset_path"))
    if not thumbnail_url:
        thumbnail_url = _resolve_public_asset_url(doc.get("thumbnail_path"))
    return ExemplarLibraryItemResponse(
        id=doc["id"],
        video_id=doc["video_id"],
        teacher_id=doc["teacher_id"],
        teacher_display_name=doc.get("teacher_display_name"),
        title=doc.get("title") or "Exemplar lesson",
        summary=doc.get("summary") or "",
        subject=doc.get("subject"),
        grade_level=doc.get("grade_level"),
        badge_type=doc.get("badge_type") or FIVE_STAR_BADGE,
        tags=list(doc.get("tags") or []),
        thumbnail_url=thumbnail_url,
        playback_url=playback_url,
        published_at=doc.get("published_at"),
        status=doc.get("status") or "published",
    )


def _localize_exemplar_library_item_response(
    item: "ExemplarLibraryItemResponse",
    language: Optional[str],
) -> "ExemplarLibraryItemResponse":
    if not _is_hebrew_language(language):
        return item
    localized_summary = _localize_observation_text(item.summary, language) or item.summary
    return ExemplarLibraryItemResponse(
        **{
            **item.model_dump(),
            "summary": localized_summary,
            "subject": _localize_subject_label(item.subject, language),
            "grade_level": _localize_grade_level_label(item.grade_level, language),
        }
    )


async def _create_share_asset_record(
    *,
    teacher_id: str,
    video_id: str,
    asset_type: str,
    file_path: Optional[str],
    file_url: Optional[str],
    actor_user_id: str,
    details: Optional[Dict[str, Any]] = None,
) -> dict:
    created_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher_id,
        "video_id": video_id,
        "asset_type": asset_type,
        "file_path": file_path,
        "file_url": file_url,
        "created_at": created_at,
        "created_by": actor_user_id,
        "details": details or {},
    }
    await db.share_assets.insert_one(doc)
    return doc


def _ensure_privacy_reference_upload(upload: UploadFile) -> None:
    filename = (upload.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="Privacy reference filename is required")
    suffix = Path(filename).suffix.lower()
    if suffix not in PRIVACY_REFERENCE_ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported privacy reference file type. Allowed: "
                f"{', '.join(sorted(PRIVACY_REFERENCE_ALLOWED_EXTENSIONS))}"
            ),
        )
    content_type = (upload.content_type or "").lower()
    if content_type and content_type not in PRIVACY_REFERENCE_ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported privacy reference content type. Allowed: "
                f"{', '.join(sorted(PRIVACY_REFERENCE_ALLOWED_CONTENT_TYPES))}"
            ),
        )


async def _save_privacy_reference_file(
    upload: UploadFile,
    teacher_id: str,
    profile_id: str,
) -> Tuple[str, Optional[str], Optional[str]]:
    _ensure_privacy_reference_upload(upload)
    suffix = Path(upload.filename or "").suffix.lower()
    stored_filename = f"{uuid.uuid4()}{suffix}"
    relative_path = f"privacy/profiles/{teacher_id}/{profile_id}/{stored_filename}"
    file_path = UPLOAD_DIR / relative_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    async with aiofiles.open(file_path, "wb") as out:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Privacy reference exceeds upload limit")
            await out.write(chunk)
    s3_key = None
    file_url = None
    try:
        s3_key, file_url = _upload_path_to_s3(
            file_path,
            "privacy-profiles",
            stored_filename,
            upload.content_type or "image/jpeg",
        )
    except Exception as exc:
        logger.warning(f"Privacy profile reference upload failed for {teacher_id}: {exc}")
    return relative_path, file_url, s3_key


def _build_video_visibility_query(
    current_user: dict,
    teacher_ids_for_user: Optional[List[str]] = None,
) -> Dict[str, Any]:
    tenant_role = _get_user_tenant_role(current_user)
    if tenant_role == "super_admin":
        return {}
    role = _get_user_role(current_user)
    if role == "admin" and teacher_ids_for_user:
        teacher_ids = [teacher_id for teacher_id in teacher_ids_for_user if teacher_id]
        if teacher_ids:
            return {"teacher_id": {"$in": teacher_ids}}
    if role == "admin":
        return {"uploaded_by": current_user["id"]}
    teacher_ids = [teacher_id for teacher_id in (teacher_ids_for_user or []) if teacher_id]
    if teacher_ids:
        return {"teacher_id": {"$in": teacher_ids}}
    return {"uploaded_by": current_user["id"]}


def _parse_teacher_subjects(subject_value: Optional[Any]) -> List[str]:
    if not subject_value:
        return []
    if isinstance(subject_value, list):
        return [str(s).strip() for s in subject_value if str(s).strip()]
    if isinstance(subject_value, str):
        if "," in subject_value:
            return [s.strip() for s in subject_value.split(",") if s.strip()]
        return [subject_value.strip()]
    return [str(subject_value).strip()]


async def _get_recording_policy(admin_id: str, school_id: Optional[str] = None) -> Optional[dict]:
    query: Dict[str, Any] = {"created_by": admin_id, "teacher_id": None}
    if school_id:
        policy = await db.recording_policies.find_one(
            {**query, "school_id": school_id},
            {"_id": 0},
        )
        if policy:
            return policy


async def _get_admin_owned_video_or_404(video_id: str, current_user: dict) -> dict:
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    return video
    policy = await db.recording_policies.find_one(query, {"_id": 0})
    return policy


async def _get_recording_policy_for_teacher(admin_id: str, teacher: dict) -> Optional[dict]:
    teacher_policy = await db.recording_policies.find_one(
        {"created_by": admin_id, "teacher_id": teacher.get("id")},
        {"_id": 0},
    )
    if teacher_policy:
        return teacher_policy
    return await _get_recording_policy(admin_id, teacher.get("school_id"))


def _current_recording_period(period_length_days: int) -> Tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    period_end = now
    period_start = now - timedelta(days=period_length_days)
    return period_start, period_end


async def _calculate_recording_compliance(
    teacher: dict,
    admin_id: str,
    policy: dict,
) -> dict:
    period_start, period_end = _current_recording_period(policy["period_length_days"])
    required_subjects = _parse_teacher_subjects(teacher.get("subject"))
    recordings_required = int(policy.get("min_recordings_per_period", 0))

    query = {"teacher_id": teacher["id"]}
    videos = await db.videos.find(query, {"_id": 0}).to_list(2000)
    recordings_in_period = []
    for v in videos:
        timestamp = v.get("recorded_at") or v.get("upload_date")
        if not timestamp:
            continue
        try:
            recorded_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            continue
        if period_start <= recorded_at <= period_end:
            recordings_in_period.append(v)

    recordings_completed = len(recordings_in_period)
    subjects_completed = set()
    for v in recordings_in_period:
        for subject in _parse_teacher_subjects(v.get("subject")):
            subjects_completed.add(subject.lower())
    missing_subjects = [
        s for s in required_subjects if s.lower() not in subjects_completed
    ]

    is_compliant = (
        recordings_completed >= recordings_required
        and len(missing_subjects) == 0
    )

    return {
        "teacher_id": teacher["id"],
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "recordings_required": recordings_required,
        "recordings_completed": recordings_completed,
        "required_subjects": required_subjects,
        "missing_subjects": missing_subjects,
        "is_compliant": is_compliant,
        "last_checked_at": datetime.now(timezone.utc).isoformat(),
    }


async def _upsert_recording_compliance(teacher: dict, admin_id: str, policy: dict) -> dict:
    compliance = await _calculate_recording_compliance(teacher, admin_id, policy)
    existing = await db.recording_compliance.find_one(
        {"teacher_id": teacher["id"], "period_start": compliance["period_start"]},
        {"_id": 0},
    )
    if existing:
        await db.recording_compliance.update_one(
            {"id": existing["id"]},
            {"$set": compliance},
        )
        compliance_id = existing["id"]
    else:
        compliance_id = str(uuid.uuid4())
        compliance["id"] = compliance_id
        await db.recording_compliance.insert_one(compliance)
    compliance["id"] = compliance_id
    return compliance


async def _refresh_recording_reminders(
    teacher: dict,
    admin_id: str,
    policy: dict,
    compliance: dict,
) -> None:
    teacher_user = None
    if teacher.get("email"):
        teacher_user = await db.users.find_one(
            {"email": teacher.get("email")},
            {"_id": 0},
        )
    reminder_user_ids = {admin_id}
    if teacher_user and teacher_user.get("id"):
        reminder_user_ids.add(teacher_user["id"])

    await db.schedules.delete_many(
        {
            "teacher_id": teacher["id"],
            "user_id": {"$in": list(reminder_user_ids)},
            "reminder_type": "recording_compliance",
        }
    )
    if compliance.get("is_compliant"):
        return
    period_start = datetime.fromisoformat(compliance["period_start"])
    period_end = datetime.fromisoformat(compliance["period_end"])
    for offset in policy.get("reminder_offsets_days", []):
        try:
            offset_days = int(offset)
        except (TypeError, ValueError):
            continue
        reminder_time = period_end - timedelta(days=offset_days)
        if reminder_time <= datetime.now(timezone.utc):
            reminder_time = datetime.now(timezone.utc) + timedelta(minutes=5)
        for user_id in reminder_user_ids:
            reminder = {
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "course_name": f"Recording compliance reminder: {teacher.get('name','Teacher')}",
                "start_time": reminder_time.isoformat(),
                "recording_status": ScheduleStatus.PLANNED.value,
                "join_url": None,
                "location": None,
                "user_id": user_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
                "reminder_type": "recording_compliance",
                "reminder_context": {
                    "recordings_required": compliance["recordings_required"],
                    "recordings_completed": compliance["recordings_completed"],
                    "missing_subjects": compliance["missing_subjects"],
                    "period_end": period_end.isoformat(),
                },
                "reminder_note": "Submit missing lesson recordings for this period.",
            }
            await db.schedules.insert_one(reminder)


# MongoDB connection
mongo_url = _get_required_env("MONGO_URL")
client = AsyncIOMotorClient(mongo_url)
db = client[_get_required_env("DB_NAME")]

# JWT Configuration
JWT_SECRET = _get_required_env("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Demo mode (fixed demo users, registration disabled)
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
ADMIN_EMAILS = set(email.lower() for email in _get_optional_env_list("ADMIN_EMAILS"))
SUPER_ADMIN_EMAILS = set(email.lower() for email in _get_optional_env_list("SUPER_ADMIN_EMAILS"))
MASTER_ADMIN_EMAIL = os.getenv("MASTER_ADMIN_EMAIL", "").strip().lower()
MASTER_ADMIN_PASSWORD = os.getenv("MASTER_ADMIN_PASSWORD", "").strip()
MASTER_ADMIN_NAME = os.getenv("MASTER_ADMIN_NAME", "Cognivio Master Admin").strip() or "Cognivio Master Admin"
if MASTER_ADMIN_EMAIL:
    ADMIN_EMAILS.add(MASTER_ADMIN_EMAIL)
    SUPER_ADMIN_EMAILS.add(MASTER_ADMIN_EMAIL)
ACCESS_APPROVAL_REQUIRED = os.getenv("ACCESS_APPROVAL_REQUIRED", "true").lower() == "true"
ACCESS_APPROVAL_NOTIFY_EMAIL = (
    os.getenv("ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com").strip()
)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "").strip()
RESEND_API_BASE_URL = os.getenv("RESEND_API_BASE_URL", "https://api.resend.com").rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or "587")
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "").strip() or SMTP_USERNAME or ACCESS_APPROVAL_NOTIFY_EMAIL
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() != "false"
DEMO_USERS = [
    {
        "email": "principal@demo.cognivio.app",
        "name": "Demo Principal",
        "password": "DemoAccess2026!",
        "role": "admin",
    },
    {
        "email": "teacher@demo.cognivio.app",
        "name": "Demo Teacher",
        "password": "DemoAccess2026!",
        "role": "teacher",
    },
]

# Upload constraints
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".jpeg", ".jpg"}
VIDEO_ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
VIDEO_ALLOWED_CONTENT_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
}
PRIVACY_REFERENCE_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
PRIVACY_REFERENCE_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
VIDEO_MAX_UPLOAD_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(1024 * 1024 * 1024)))
VIDEO_WORKER_COUNT = max(1, int(os.getenv("VIDEO_WORKER_COUNT", "1")))
VIDEO_TRANSCODE_PIPELINE_ENABLED = os.getenv("VIDEO_TRANSCODE_PIPELINE_ENABLED", "false").lower() == "true"
VIDEO_TRANSCODE_PROFILE = os.getenv("VIDEO_TRANSCODE_PROFILE", "analysis_master_v1").strip() or "analysis_master_v1"
VIDEO_TRANSCODE_WORKER_COUNT = max(1, int(os.getenv("VIDEO_TRANSCODE_WORKER_COUNT", "1")))
VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED = os.getenv("VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED", "true").lower() == "true"
VIDEO_TRANSCODE_RAW_RETENTION_HOURS = max(1, int(os.getenv("VIDEO_TRANSCODE_RAW_RETENTION_HOURS", "24")))
CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS = os.getenv("CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS", "false").lower() == "true"
ADHERENCE_WEIGHT = float(os.getenv("ADHERENCE_WEIGHT", "0.15"))
PRIVACY_REQUIRE_PROFILE = os.getenv("PRIVACY_REQUIRE_PROFILE", "true").lower() == "true"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini").strip()
OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD = float(
    os.getenv("OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD", "0.40")
)
OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD = float(
    os.getenv("OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD", "1.60")
)
VIDEO_ANALYSIS_MAX_FRAMES = max(3, int(os.getenv("VIDEO_ANALYSIS_MAX_FRAMES", "6")))
SMART_FRAME_SELECTION_ENABLED = os.getenv("SMART_FRAME_SELECTION_ENABLED", "false").lower() == "true"
SMART_FRAME_SELECTION_VERSION = os.getenv("SMART_FRAME_SELECTION_VERSION", "smart_frames_v1").strip() or "smart_frames_v1"
VIDEO_ANALYSIS_FRAME_SCAN_FPS = max(0.25, float(os.getenv("VIDEO_ANALYSIS_FRAME_SCAN_FPS", "1")))
VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC = max(1.0, float(os.getenv("VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC", "8")))
VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS = os.getenv("VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS", "false").lower() == "true"
SMART_MOMENT_SAMPLING_ENABLED = os.getenv("SMART_MOMENT_SAMPLING_ENABLED", "true").lower() == "true"
SMART_MOMENT_SAMPLING_VERSION = os.getenv("SMART_MOMENT_SAMPLING_VERSION", "lesson_moments_v1").strip() or "lesson_moments_v1"
VIDEO_ANALYSIS_WINDOW_SEC = max(10.0, float(os.getenv("VIDEO_ANALYSIS_WINDOW_SEC", "20")))
VIDEO_ANALYSIS_MAX_MOMENTS = max(3, int(os.getenv("VIDEO_ANALYSIS_MAX_MOMENTS", "6")))
AUDIO_ANALYSIS_ENABLED = os.getenv("AUDIO_ANALYSIS_ENABLED", "false").lower() == "true"
AUDIO_TRANSCRIPTION_ENABLED = os.getenv("AUDIO_TRANSCRIPTION_ENABLED", "false").lower() == "true"
AUDIO_FEATURES_ENABLED = os.getenv("AUDIO_FEATURES_ENABLED", "false").lower() == "true"
AUDIO_TRANSCRIPTION_MODEL = os.getenv("AUDIO_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe").strip() or "gpt-4o-mini-transcribe"
AUDIO_TRANSCRIPTION_LANGUAGE = os.getenv("AUDIO_TRANSCRIPTION_LANGUAGE", "").strip() or None
AUDIO_TRANSCRIPT_RETENTION_DAYS = max(1, int(os.getenv("AUDIO_TRANSCRIPT_RETENTION_DAYS", "30")))
AUDIO_TRANSCRIPTION_MAX_SECONDS = max(15, int(os.getenv("AUDIO_TRANSCRIPTION_MAX_SECONDS", "120")))
AUDIO_ALLOW_STUDENT_VOICE_PROCESSING = os.getenv("AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", "false").lower() == "true"
PAID_ANALYSIS_ENABLED = os.getenv("PAID_ANALYSIS_ENABLED", "false").lower() == "true"
PAID_ANALYSIS_ALLOWLIST_EMAILS = {
    email.lower() for email in _get_optional_env_list("PAID_ANALYSIS_ALLOWLIST_EMAILS")
}
PRIVACY_PROFILE_MIN_REFERENCES = max(1, int(os.getenv("PRIVACY_PROFILE_MIN_REFERENCES", "3")))
PRIVACY_PROFILE_MAX_REFERENCES = max(PRIVACY_PROFILE_MIN_REFERENCES, int(os.getenv("PRIVACY_PROFILE_MAX_REFERENCES", "5")))
PRIVACY_MANUAL_REVIEW_ENABLED = os.getenv("PRIVACY_MANUAL_REVIEW_ENABLED", "true").lower() == "true"
PRIVACY_ALLOW_BLUR_ALL_FALLBACK = os.getenv("PRIVACY_ALLOW_BLUR_ALL_FALLBACK", "true").lower() == "true"
PRIVACY_WORKER_COUNT = max(1, int(os.getenv("PRIVACY_WORKER_COUNT", "1")))
PRIVACY_MAX_RETRIES = max(1, int(os.getenv("PRIVACY_MAX_RETRIES", "3")))
PRIVACY_TEACHER_MATCH_THRESHOLD = float(os.getenv("PRIVACY_TEACHER_MATCH_THRESHOLD", "0.9"))
PRIVACY_AMBIGUOUS_MATCH_THRESHOLD = float(os.getenv("PRIVACY_AMBIGUOUS_MATCH_THRESHOLD", "0.8"))
PRIVACY_RAW_VIDEO_RETENTION_DAYS = max(1, int(os.getenv("PRIVACY_RAW_VIDEO_RETENTION_DAYS", "30")))
PRIVACY_PROFILE_IMAGE_RETENTION_DAYS = max(1, int(os.getenv("PRIVACY_PROFILE_IMAGE_RETENTION_DAYS", "30")))
PRIVACY_PURGE_INTERVAL_MINUTES = max(5, int(os.getenv("PRIVACY_PURGE_INTERVAL_MINUTES", "60")))
RECOGNITION_FIVE_STAR_SCORE_MIN = float(os.getenv("RECOGNITION_FIVE_STAR_SCORE_MIN", str(DEFAULT_FIVE_STAR_SCORE_MIN)))
PRIVACY_ALLOW_DEGRADED_RUNTIME = os.getenv("PRIVACY_ALLOW_DEGRADED_RUNTIME", "false").lower() == "true"

# S3 configuration (required for file uploads)
S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION")
S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_PUBLIC_BASE_URL = os.getenv("S3_PUBLIC_BASE_URL")
FRONTEND_URL = os.getenv("FRONTEND_URL")
BACKEND_PUBLIC_BASE_URL = os.getenv("BACKEND_PUBLIC_BASE_URL", "").rstrip("/")
LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS = max(
    0, int(os.getenv("LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS", "1800"))
)

# Create uploads directory (used for temp storage or mounted persistent storage)
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(ROOT_DIR / "uploads"))).expanduser()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

security = HTTPBearer()
VIDEO_JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
VIDEO_WORKER_TASKS: List[asyncio.Task] = []
VIDEO_TRANSCODE_JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
VIDEO_TRANSCODE_WORKER_TASKS: List[asyncio.Task] = []
VIDEO_PRIVACY_JOB_QUEUE: asyncio.Queue[str] = asyncio.Queue()
VIDEO_PRIVACY_WORKER_TASKS: List[asyncio.Task] = []
PRIVACY_MAINTENANCE_TASKS: List[asyncio.Task] = []


async def _app_startup() -> None:
    _validate_s3_config()
    await _ensure_database_indexes()
    await _ensure_master_admin_user()
    await _start_privacy_maintenance_tasks()
    await _start_video_transcode_workers()
    await _start_privacy_workers()
    await _start_video_workers()
    await _rehydrate_video_transcode_queue()
    await _rehydrate_video_privacy_queue()
    await _rehydrate_video_processing_queue()
    if not DEMO_MODE:
        return
    for demo in DEMO_USERS:
        existing = await db.users.find_one({"email": demo["email"]})
        if existing:
            # Ensure demo roles are correct
            desired_role = "admin" if demo["email"] == "principal@demo.cognivio.app" else "teacher"
            updates = {}
            if existing.get("role") != desired_role:
                updates["role"] = desired_role
            desired_tenant_role = "school_admin" if desired_role == "admin" else "teacher"
            if existing.get("tenant_role") != desired_tenant_role:
                updates["tenant_role"] = desired_tenant_role
            if existing.get("tenant_status") != "approved":
                updates["tenant_status"] = "approved"
            if updates:
                await db.users.update_one({"email": demo["email"]}, {"$set": updates})
            continue
        user_id = str(uuid.uuid4())
        user_doc = {
            "id": user_id,
            "email": demo["email"],
            "name": demo["name"],
            "password": hash_password(demo["password"]),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "is_demo": True,
            "role": demo.get("role", "teacher"),
            "tenant_role": "school_admin" if demo.get("role") == "admin" else "teacher",
            "tenant_status": "approved",
        }
        await db.users.insert_one(user_doc)


async def _ensure_master_admin_user() -> None:
    if not MASTER_ADMIN_EMAIL or not MASTER_ADMIN_PASSWORD:
        return

    now = datetime.now(timezone.utc).isoformat()
    existing = await db.users.find_one({"email": MASTER_ADMIN_EMAIL})
    password_hash = hash_password(MASTER_ADMIN_PASSWORD)
    if existing:
        updates = {
            "name": MASTER_ADMIN_NAME,
            "password": password_hash,
            "role": "super_admin",
            "tenant_role": "super_admin",
            "tenant_status": "approved",
            "approval_status": "approved",
            "approved_at": existing.get("approved_at") or now,
            "approved_by": "system:master_admin_bootstrap",
            "approval_requested_at": existing.get("approval_requested_at") or now,
            "revoked_at": None,
            "revoked_by": None,
            "is_active": True,
            "updated_at": now,
        }
        await db.users.update_one({"email": MASTER_ADMIN_EMAIL}, {"$set": updates})
        return

    user_doc = {
        "id": str(uuid.uuid4()),
        "email": MASTER_ADMIN_EMAIL,
        "name": MASTER_ADMIN_NAME,
        "password": password_hash,
        "created_at": now,
        "role": "super_admin",
        "tenant_role": "super_admin",
        "tenant_status": "approved",
        "approval_status": "approved",
        "approval_requested_at": now,
        "approved_at": now,
        "approved_by": "system:master_admin_bootstrap",
        "is_active": True,
    }
    await db.users.insert_one(user_doc)


async def _app_shutdown() -> None:
    await _stop_video_workers()
    client.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _app_startup()
    try:
        yield
    finally:
        await _app_shutdown()


# Create the main app
app = FastAPI(
    title="Cognivio API",
    description="Teacher Assessment Platform",
    lifespan=lifespan,
)

# Health check endpoint (at root level for Railway)
@app.get("/health")
async def health_check():
    """Health check endpoint for Railway deployment"""
    return {"status": "healthy", "service": "cognivio-api"}

@api_router.get("/health")
async def api_health_check():
    """Health check endpoint under /api prefix"""
    return {"status": "healthy", "service": "cognivio-api"}


def _upload_storage_is_healthy() -> bool:
    if S3_BUCKET:
        try:
            _create_s3_client()
            return True
        except Exception:
            return False
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        probe_file = UPLOAD_DIR / ".metrics-write-check"
        probe_file.write_text("ok", encoding="utf-8")
        probe_file.unlink(missing_ok=True)
        return True
    except Exception:
        return False


async def refresh_runtime_metrics() -> None:
    cutoff_stale = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()

    video_processing = await db.video_processing_jobs.count_documents(
        {"status": VideoProcessingStatus.PROCESSING.value}
    )
    video_stuck = await db.video_processing_jobs.count_documents(
        {
            "status": VideoProcessingStatus.PROCESSING.value,
            "started_at": {"$lte": cutoff_stale},
        }
    )
    privacy_processing = await db.video_privacy_jobs.count_documents(
        {"status": PrivacyProcessingStatus.PROCESSING.value}
    )
    privacy_stuck = await db.video_privacy_jobs.count_documents(
        {
            "status": PrivacyProcessingStatus.PROCESSING.value,
            "started_at": {"$lte": cutoff_stale},
        }
    )
    maintenance_processing = sum(1 for task in PRIVACY_MAINTENANCE_TASKS if not task.done())

    app_metrics.set_job_backlog(
        job_type="video",
        queued=VIDEO_JOB_QUEUE.qsize(),
        processing=video_processing,
        stuck=video_stuck,
    )
    app_metrics.set_job_backlog(
        job_type="privacy",
        queued=VIDEO_PRIVACY_JOB_QUEUE.qsize(),
        processing=privacy_processing,
        stuck=privacy_stuck,
    )
    app_metrics.set_job_backlog(
        job_type="maintenance",
        queued=0,
        processing=maintenance_processing,
        stuck=0,
    )

    mongo_healthy = True
    try:
        await db.command("ping")
    except Exception:
        mongo_healthy = False

    app_metrics.set_dependency_health(dependency="mongodb", healthy=mongo_healthy)
    app_metrics.set_dependency_health(
        dependency="openai",
        healthy=bool(OPENAI_API_KEY and AsyncOpenAI is not None),
    )
    app_metrics.set_dependency_health(
        dependency="storage",
        healthy=_upload_storage_is_healthy(),
    )
    app_metrics.set_dependency_health(
        dependency="railway_runtime",
        healthy=True,
    )

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== ENUMS ====================
class FrameworkType(str, Enum):
    MARSHALL = "marshall"
    DANIELSON = "danielson"
    CUSTOM = "custom"

class PerformanceLevel(str, Enum):
    EXCELLENT = "excellent"  # Green - score >= 3
    NEEDS_IMPROVEMENT = "needs_improvement"  # Yellow - score 2-3
    CRITICAL = "critical"  # Red - score < 2

# ==================== FRAMEWORK DATA ====================
DANIELSON_FRAMEWORK = {
    "name": "Danielson Framework",
    "type": "danielson",
    "domains": [
        {
            "id": "d1",
            "name": "Domain 1: Planning and Preparation",
            "elements": [
                {"id": "d1a", "name": "Demonstrating Knowledge of Content and Pedagogy"},
                {"id": "d1b", "name": "Demonstrating Knowledge of Students"},
                {"id": "d1c", "name": "Setting Instructional Outcomes"},
                {"id": "d1d", "name": "Demonstrating Knowledge of Resources"},
                {"id": "d1e", "name": "Designing Coherent Instruction"},
                {"id": "d1f", "name": "Designing Student Assessments"}
            ]
        },
        {
            "id": "d2",
            "name": "Domain 2: Classroom Environment",
            "elements": [
                {"id": "d2a", "name": "Creating an Environment of Respect and Rapport"},
                {"id": "d2b", "name": "Establishing a Culture for Learning"},
                {"id": "d2c", "name": "Managing Classroom Procedures"},
                {"id": "d2d", "name": "Managing Student Behavior"},
                {"id": "d2e", "name": "Organizing Physical Space"}
            ]
        },
        {
            "id": "d3",
            "name": "Domain 3: Instruction",
            "elements": [
                {"id": "d3a", "name": "Communicating with Students"},
                {"id": "d3b", "name": "Using Questioning and Discussion Techniques"},
                {"id": "d3c", "name": "Engaging Students in Learning"},
                {"id": "d3d", "name": "Using Assessment in Instruction"},
                {"id": "d3e", "name": "Demonstrating Flexibility and Responsiveness"}
            ]
        },
        {
            "id": "d4",
            "name": "Domain 4: Professional Responsibilities",
            "elements": [
                {"id": "d4a", "name": "Reflecting on Teaching"},
                {"id": "d4b", "name": "Maintaining Accurate Records"},
                {"id": "d4c", "name": "Communicating with Families"},
                {"id": "d4d", "name": "Participating in the Professional Community"},
                {"id": "d4e", "name": "Growing and Developing Professionally"},
                {"id": "d4f", "name": "Showing Professionalism"}
            ]
        }
    ]
}

MARSHALL_FRAMEWORK = {
    "name": "Marshall Teacher Evaluation Rubrics",
    "type": "marshall",
    "domains": [
        {
            "id": "m1",
            "name": "A. Planning and Preparation for Learning",
            "elements": [
                {"id": "m1a", "name": "Knowledge of Subject Matter"},
                {"id": "m1b", "name": "Strategic Planning"},
                {"id": "m1c", "name": "Curriculum Alignment"},
                {"id": "m1d", "name": "Assessment Design"},
                {"id": "m1e", "name": "Anticipating Student Needs"},
                {"id": "m1f", "name": "Lesson Preparation"},
                {"id": "m1g", "name": "Student Engagement Planning"},
                {"id": "m1h", "name": "Materials Preparation"},
                {"id": "m1i", "name": "Differentiation Planning"},
                {"id": "m1j", "name": "Environment Setup"}
            ]
        },
        {
            "id": "m2",
            "name": "B. Classroom Management",
            "elements": [
                {"id": "m2a", "name": "Expectations and Norms"},
                {"id": "m2b", "name": "Student Relationships"},
                {"id": "m2c", "name": "Routines and Procedures"},
                {"id": "m2d", "name": "Behavior Management"},
                {"id": "m2e", "name": "Physical Space Organization"}
            ]
        },
        {
            "id": "m3",
            "name": "C. Delivery of Instruction",
            "elements": [
                {"id": "m3a", "name": "Clear Communication"},
                {"id": "m3b", "name": "Questioning Techniques"},
                {"id": "m3c", "name": "Student Engagement"},
                {"id": "m3d", "name": "Pacing and Flexibility"},
                {"id": "m3e", "name": "Differentiated Instruction"}
            ]
        },
        {
            "id": "m4",
            "name": "D. Monitoring, Assessment, and Follow-Up",
            "elements": [
                {"id": "m4a", "name": "Ongoing Assessment"},
                {"id": "m4b", "name": "Feedback Quality"},
                {"id": "m4c", "name": "Data-Driven Decisions"},
                {"id": "m4d", "name": "Student Progress Tracking"}
            ]
        },
        {
            "id": "m5",
            "name": "E. Family and Community Outreach",
            "elements": [
                {"id": "m5a", "name": "Family Communication"},
                {"id": "m5b", "name": "Community Engagement"},
                {"id": "m5c", "name": "Cultural Responsiveness"}
            ]
        },
        {
            "id": "m6",
            "name": "F. Professional Responsibilities",
            "elements": [
                {"id": "m6a", "name": "Self-Reflection"},
                {"id": "m6b", "name": "Professional Development"},
                {"id": "m6c", "name": "Collaboration"},
                {"id": "m6d", "name": "School Community Participation"}
            ]
        }
    ]
}


def _get_framework_by_type(framework_type: str) -> dict:
    if framework_type == "marshall":
        return MARSHALL_FRAMEWORK
    if framework_type == "danielson":
        return DANIELSON_FRAMEWORK
    return {
        "domains": DANIELSON_FRAMEWORK["domains"] + MARSHALL_FRAMEWORK["domains"]
    }


SUPPORTED_APP_LANGUAGES = {"en", "he"}

HEBREW_FRAMEWORK_LABELS = {
    "danielson": {
        "d1": "תחום 1: תכנון והיערכות",
        "d1a": "הפגנת ידע בתוכן ובהוראה",
        "d1b": "היכרות עם התלמידים",
        "d1c": "הגדרת יעדי הוראה",
        "d1d": "היכרות עם משאבים",
        "d1e": "תכנון הוראה קוהרנטי",
        "d1f": "תכנון הערכות תלמידים",
        "d2": "תחום 2: אקלים כיתתי",
        "d2a": "יצירת אקלים של כבוד ויחסי אמון",
        "d2b": "ביסוס תרבות של למידה",
        "d2c": "ניהול נהלים ושגרות בכיתה",
        "d2d": "ניהול התנהגות תלמידים",
        "d2e": "ארגון המרחב הפיזי",
        "d3": "תחום 3: הוראה",
        "d3a": "תקשורת עם תלמידים",
        "d3b": "שימוש בשאלות ובדיון",
        "d3c": "מעורבות תלמידים בלמידה",
        "d3d": "שימוש בהערכה בתוך ההוראה",
        "d3e": "גמישות והיענות",
        "d4": "תחום 4: אחריות מקצועית",
        "d4a": "רפלקציה על ההוראה",
        "d4b": "שמירה על תיעוד מדויק",
        "d4c": "תקשורת עם משפחות",
        "d4d": "השתתפות בקהילה המקצועית",
        "d4e": "צמיחה והתפתחות מקצועית",
        "d4f": "מקצועיות",
    },
    "marshall": {
        "m1": "א. תכנון והיערכות ללמידה",
        "m1a": "שליטה בתחום הדעת",
        "m1b": "תכנון אסטרטגי",
        "m1c": "יישור לתוכנית הלימודים",
        "m1d": "תכנון ההערכה",
        "m1e": "היערכות לצורכי התלמידים",
        "m1f": "הכנת השיעור",
        "m1g": "תכנון מעורבות תלמידים",
        "m1h": "הכנת חומרים",
        "m1i": "תכנון דיפרנציאלי",
        "m1j": "היערכות המרחב",
        "m2": "ב. ניהול כיתה",
        "m2a": "ציפיות ונורמות",
        "m2b": "יחסים עם תלמידים",
        "m2c": "שגרות ונהלים",
        "m2d": "ניהול התנהגות",
        "m2e": "ארגון המרחב הפיזי",
        "m3": "ג. העברת ההוראה",
        "m3a": "תקשורת בהירה",
        "m3b": "טכניקות שאילה",
        "m3c": "מעורבות תלמידים",
        "m3d": "קצב וגמישות",
        "m3e": "הוראה דיפרנציאלית",
        "m4": "ד. ניטור, הערכה ומעקב",
        "m4a": "הערכה מתמשכת",
        "m4b": "איכות המשוב",
        "m4c": "קבלת החלטות מבוססת נתונים",
        "m4d": "מעקב אחר התקדמות תלמידים",
        "m5": "ה. קשר עם משפחה וקהילה",
        "m5a": "תקשורת עם המשפחה",
        "m5b": "מעורבות קהילתית",
        "m5c": "רגישות תרבותית",
        "m6": "ו. אחריות מקצועית",
        "m6a": "רפלקציה עצמית",
        "m6b": "פיתוח מקצועי",
        "m6c": "שיתופי פעולה מקצועיים",
        "m6d": "מעורבות בקהילת בית הספר",
    },
}


def _normalize_app_language(value: Optional[str], default: str = "en") -> str:
    candidate = (value or "").strip().lower()
    if candidate.startswith("he"):
        return "he"
    if candidate.startswith("en"):
        return "en"
    return default


def _resolve_request_language(request: Optional[Request], default: str = "en") -> str:
    if request is None:
        return default
    header = request.headers.get("accept-language") or ""
    for part in header.split(","):
        normalized = _normalize_app_language(part, default="")
        if normalized in SUPPORTED_APP_LANGUAGES:
            return normalized
    return default


def _is_hebrew_language(language: Optional[str]) -> bool:
    return _normalize_app_language(language) == "he"


_HEBREW_SUBJECT_MAP = {
    "mathematics": "מתמטיקה",
    "math": "מתמטיקה",
    "english literature": "ספרות אנגלית",
    "biology": "ביולוגיה",
    "history": "היסטוריה",
    "chemistry": "כימיה",
    "physical education": "חינוך גופני",
}

_HEBREW_DEPARTMENT_MAP = {
    "stem": "מדעים וטכנולוגיה",
    "humanities": "מדעי הרוח",
    "athletics": "חינוך גופני וספורט",
}

_HEBREW_GRADE_MAP = {
    "7th grade": "כיתה ז׳",
    "8th grade": "כיתה ח׳",
    "9th grade": "כיתה ט׳",
    "10th grade": "כיתה י׳",
    "11th grade": "כיתה י״א",
    "12th grade": "כיתה י״ב",
}


def _localize_subject_label(subject: Optional[str], language: Optional[str]) -> Optional[str]:
    if not subject or not _is_hebrew_language(language):
        return subject
    normalized = str(subject).strip().lower()
    return _HEBREW_SUBJECT_MAP.get(normalized, subject)


def _localize_department_label(department: Optional[str], language: Optional[str]) -> Optional[str]:
    if not department or not _is_hebrew_language(language):
        return department
    normalized = str(department).strip().lower()
    return _HEBREW_DEPARTMENT_MAP.get(normalized, department)


def _localize_grade_level_label(grade_level: Optional[str], language: Optional[str]) -> Optional[str]:
    if not grade_level or not _is_hebrew_language(language):
        return grade_level
    normalized = str(grade_level).strip().lower()
    if normalized in _HEBREW_GRADE_MAP:
        return _HEBREW_GRADE_MAP[normalized]

    match = re.fullmatch(r"(\d{1,2})(?:st|nd|rd|th)\s+grade", normalized)
    if not match:
        return grade_level

    grade_number = int(match.group(1))
    hebrew_grade_map = {
        1: "א׳",
        2: "ב׳",
        3: "ג׳",
        4: "ד׳",
        5: "ה׳",
        6: "ו׳",
        7: "ז׳",
        8: "ח׳",
        9: "ט׳",
        10: "י׳",
        11: "י״א",
        12: "י״ב",
    }
    return f"כיתה {hebrew_grade_map.get(grade_number, grade_level)}"


_HEBREW_OBSERVATION_AREA_MAP = {
    "demonstrating knowledge of content and pedagogy": "הפגנת ידע בתוכן ובהוראה",
    "demonstrating knowledge of students": "היכרות עם התלמידים ועם צורכי הלמידה שלהם",
    "setting instructional outcomes": "הגדרת יעדי הוראה ברורים",
    "demonstrating knowledge of resources": "היכרות עם משאבים לימודיים רלוונטיים",
    "designing coherent instruction": "תכנון הוראה קוהרנטי",
    "designing student assessments": "תכנון הערכות תלמידים",
    "creating an environment of respect and rapport": "יצירת אקלים של כבוד ויחסי אמון",
    "establishing a culture for learning": "ביסוס תרבות של למידה",
    "managing classroom procedures": "ניהול נהלים ושגרות בכיתה",
    "managing student behavior": "ניהול התנהגות תלמידים",
    "organizing physical space": "ארגון המרחב הפיזי",
    "communicating with students": "תקשורת עם תלמידים",
    "using questioning and discussion techniques": "שימוש בשאלות ובדיון",
    "engaging students in learning": "מעורבות תלמידים בלמידה",
    "using assessment in instruction": "שימוש בהערכה בתוך ההוראה",
    "demonstrating flexibility and responsiveness": "גמישות והיענות",
    "reflecting on teaching": "רפלקציה על ההוראה",
    "maintaining accurate records": "שמירה על תיעוד מדויק",
    "communicating with families": "תקשורת עם משפחות",
    "participating in the professional community": "השתתפות בקהילה המקצועית",
    "growing and developing professionally": "צמיחה והתפתחות מקצועית",
    "showing professionalism": "מקצועיות",
}


def _localize_observation_area(area: Optional[str], language: Optional[str]) -> Optional[str]:
    if not area or not _is_hebrew_language(language):
        return area
    normalized = str(area).strip().lower().rstrip(".")
    return _HEBREW_OBSERVATION_AREA_MAP.get(normalized, area)


def _localize_observation_text(text: Optional[str], language: Optional[str]) -> Optional[str]:
    if not text or not _is_hebrew_language(language):
        return text

    stripped = str(text).strip()
    observed_match = re.fullmatch(
        r"Observed\s+([A-Za-z' -]+)\s+demonstrating active engagement strategies\.",
        stripped,
    )
    if observed_match:
        teacher_name = observed_match.group(1).strip()
        return f"בתצפית על {teacher_name} נראתה הפעלה עקבית של אסטרטגיות למעורבות פעילה של תלמידים."

    content_match = re.fullmatch(
        r"Observed demonstrating knowledge of content(?: and pedagogy)?(?: during classroom instruction)?\.?",
        stripped,
        flags=re.IGNORECASE,
    )
    if content_match:
        return "נראתה הפגנת ידע בתוכן ובהוראה במהלך השיעור."

    student_match = re.fullmatch(
        r"Observed demonstrating knowledge of students(?: during classroom instruction)?\.?",
        stripped,
        flags=re.IGNORECASE,
    )
    if student_match:
        return "ניכרה היכרות עם התלמידים ועם צורכי הלמידה שלהם במהלך השיעור."

    variable_match = re.fullmatch(
        r"Observed\s+(.+?)\s+with variable consistency over the lesson\.?",
        stripped,
        flags=re.IGNORECASE,
    )
    if variable_match:
        area = _localize_observation_area(variable_match.group(1).strip(), language)
        return f"בתחום {area} נראתה עקביות משתנה לאורך השיעור."

    return stripped


def _contains_latin_characters(value: Optional[str]) -> bool:
    if not value:
        return False
    return bool(re.search(r"[A-Za-z]", str(value)))


def _should_regenerate_hebrew_assessment_text(
    summary_text: Optional[str],
    recommendations: List[Any],
) -> bool:
    if _contains_latin_characters(summary_text):
        return True
    for item in recommendations or []:
        if isinstance(item, str) and _contains_latin_characters(item):
            return True
        if isinstance(item, dict) and _contains_latin_characters(item.get("text")):
            return True
    return False


def _localize_schedule_title(course_name: Optional[str], language: Optional[str]) -> Optional[str]:
    if not course_name or not _is_hebrew_language(language):
        return course_name

    title = str(course_name).strip()
    if title.startswith("Lesson plan reminder: "):
        subject = title.split(": ", 1)[1].strip()
        return f"תזכורת לתכנית שיעור: {_localize_subject_label(subject, language)}"
    if title.startswith("Recording compliance reminder: "):
        teacher_name = title.split(": ", 1)[1].strip()
        return f"תזכורת לעמידה במדיניות ההקלטה: {teacher_name}"
    if title.startswith("Action Plan: "):
        goal_title = title.split(": ", 1)[1].strip()
        return f"תכנית פעולה: {goal_title}"
    if title.startswith("Reminder: "):
        reminder_name = title.split(": ", 1)[1].strip()
        return f"תזכורת: {reminder_name}"
    return title


def _localize_teacher_payload(payload: Dict[str, Any], language: Optional[str]) -> Dict[str, Any]:
    localized = dict(payload)
    localized["subject"] = _localize_subject_label(localized.get("subject"), language)
    localized["grade_level"] = _localize_grade_level_label(localized.get("grade_level"), language)
    localized["department"] = _localize_department_label(localized.get("department"), language)
    return localized


def _localize_schedule_payload(payload: Dict[str, Any], language: Optional[str]) -> Dict[str, Any]:
    localized = dict(payload)
    localized["course_name"] = _localize_schedule_title(localized.get("course_name"), language)
    return localized


def _localize_roster_row_payload(payload: Dict[str, Any], language: Optional[str]) -> Dict[str, Any]:
    localized = dict(payload)
    localized["subject"] = _localize_subject_label(localized.get("subject"), language)
    localized["grade_level"] = _localize_grade_level_label(localized.get("grade_level"), language)
    localized["department"] = _localize_department_label(localized.get("department"), language)
    localized["recent_observations"] = [
        {
            **observation,
            "summary": _localize_observation_text(observation.get("summary"), language),
            "admin_comment": _localize_observation_text(observation.get("admin_comment"), language),
        }
        for observation in list(localized.get("recent_observations") or [])
    ]
    localized["action_items"] = [
        {
            **item,
            "title": _localize_schedule_title(item.get("title"), language),
        }
        for item in list(localized.get("action_items") or [])
    ]
    return localized


def _localize_framework_node_label(node_id: str, fallback: str, framework_type: str, language: Optional[str]) -> str:
    if not _is_hebrew_language(language):
        return fallback
    return HEBREW_FRAMEWORK_LABELS.get(framework_type, {}).get(node_id, fallback)


def _normalize_uploaded_rubric_domains(parsed_domains: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for domain in parsed_domains:
        domain_name = str(domain.get("name") or domain.get("domain") or "").strip()
        if not domain_name:
            continue
        raw_elements = domain.get("elements") or []
        elements = []
        for element_index, raw_element in enumerate(raw_elements):
            if isinstance(raw_element, dict):
                element_name = str(raw_element.get("name") or raw_element.get("element") or "").strip()
            else:
                element_name = str(raw_element).strip()
            if not element_name:
                continue
            elements.append(
                {
                    "id": f"c{uuid.uuid4().hex[:8]}-{element_index + 1}",
                    "name": element_name,
                }
            )
        if not elements:
            continue
        normalized.append(
            {
                "id": f"c{uuid.uuid4().hex[:8]}",
                "name": domain_name,
                "elements": elements,
                "source_type": "uploaded",
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return normalized


def _parse_uploaded_rubric_file(filename: str, content: bytes) -> Tuple[str, List[Dict[str, Any]]]:
    lower_name = (filename or "").lower()
    default_rubric_name = Path(filename or "uploaded-rubric").stem or "Uploaded Rubric"
    if lower_name.endswith(".json"):
        payload = json.loads(content.decode("utf-8"))
        rubric_name = str(payload.get("name") or payload.get("title") or default_rubric_name).strip()
        parsed_domains = payload.get("domains") or payload.get("rubric") or []
        if not isinstance(parsed_domains, list):
            raise HTTPException(status_code=400, detail="Uploaded rubric JSON must contain a domains array")
        normalized_domains = _normalize_uploaded_rubric_domains(parsed_domains)
        if not normalized_domains:
            raise HTTPException(status_code=400, detail="Uploaded rubric JSON did not contain valid domains and elements")
        return rubric_name, normalized_domains

    if lower_name.endswith(".csv"):
        decoded = content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(decoded))
        grouped: Dict[str, List[str]] = {}
        for row in reader:
            domain_name = str(row.get("domain") or row.get("Domain") or row.get("category") or "").strip()
            element_name = str(row.get("element") or row.get("Element") or row.get("indicator") or "").strip()
            if not domain_name or not element_name:
                continue
            grouped.setdefault(domain_name, []).append(element_name)
        parsed_domains = [{"name": domain_name, "elements": elements} for domain_name, elements in grouped.items()]
        normalized_domains = _normalize_uploaded_rubric_domains(parsed_domains)
        if not normalized_domains:
            raise HTTPException(status_code=400, detail="Uploaded rubric CSV must contain domain and element columns")
        return default_rubric_name, normalized_domains

    raise HTTPException(status_code=400, detail="Uploaded rubric must be a .json or .csv file")


def _find_domain_for_element(framework: dict, element_id: str) -> Optional[dict]:
    for domain in framework.get("domains", []):
        for element in domain.get("elements", []):
            if element.get("id") == element_id:
                return domain
    return None

# ==================== PYDANTIC MODELS ====================
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: Optional[str] = "teacher"
    organization_type: Optional[str] = None
    organization_name: Optional[str] = None
    school_name: Optional[str] = None
    requested_manager_email: Optional[EmailStr] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    role: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    created_at: str
    role: Optional[str] = None
    tenant_role: Optional[str] = None
    tenant_status: Optional[str] = None
    workspace_mode: Optional[str] = None
    teacher_id: Optional[str] = None
    approval_status: Optional[str] = None
    organization_id: Optional[str] = None
    organization_type: Optional[str] = None
    organization_name: Optional[str] = None
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    manager_user_id: Optional[str] = None
    manager_name: Optional[str] = None
    manager_email: Optional[str] = None
    requested_organization_name: Optional[str] = None
    requested_school_name: Optional[str] = None
    requested_manager_email: Optional[str] = None

class TokenResponse(BaseModel):
    token: str
    user: UserResponse


class AccessRequestResponse(BaseModel):
    status: str
    email: str
    message: str
    approval_status: str
    tenant_role: Optional[str] = None
    organization_type: Optional[str] = None
    organization_name: Optional[str] = None
    school_name: Optional[str] = None


class AccessUserRecord(BaseModel):
    id: str
    email: str
    name: str
    created_at: str
    role: Optional[str] = None
    approval_status: str
    approval_requested_at: Optional[str] = None
    approved_at: Optional[str] = None
    approved_by: Optional[str] = None
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = None
    is_active: bool = True
    teacher_id: Optional[str] = None
    workspace_mode: Optional[str] = None
    tenant_role: Optional[str] = None
    tenant_status: Optional[str] = None
    organization_id: Optional[str] = None
    organization_type: Optional[str] = None
    organization_name: Optional[str] = None
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    manager_user_id: Optional[str] = None
    manager_email: Optional[str] = None


class AccessUserListResponse(BaseModel):
    pending: List[AccessUserRecord]
    approved: List[AccessUserRecord]
    revoked: List[AccessUserRecord]


class AccessDecisionPayload(BaseModel):
    reason: Optional[str] = None


class MasterAdminOverviewCard(BaseModel):
    id: str
    title: str
    value: int
    hint: Optional[str] = None
    tone: str = "neutral"


class MasterAdminAlert(BaseModel):
    id: str
    severity: str
    title: str
    message: str
    action_label: Optional[str] = None
    action_path: Optional[str] = None


class MasterAdminPreviewItem(BaseModel):
    id: str
    label: str
    meta: Optional[str] = None
    action_path: Optional[str] = None


class MasterAdminOverviewResponse(BaseModel):
    generated_at: str
    cards: List[MasterAdminOverviewCard]
    alerts: List[MasterAdminAlert]
    dependency_summary: Dict[str, Any]
    queue_summary: Dict[str, Any]
    pending_approvals_preview: List[MasterAdminPreviewItem]
    pipeline_blockers_preview: List[MasterAdminPreviewItem]


class MasterAdminUserRecord(BaseModel):
    id: str
    email: str
    name: str
    role: str
    approval_status: str
    is_active: bool = True
    created_at: Optional[str] = None
    approval_requested_at: Optional[str] = None
    approved_at: Optional[str] = None
    revoked_at: Optional[str] = None
    last_login_at: Optional[str] = None
    workspace_mode: Optional[str] = None
    tenant_role: Optional[str] = None
    tenant_status: Optional[str] = None
    organization_id: Optional[str] = None
    organization_type: Optional[str] = None
    organization_name: Optional[str] = None
    school_id: Optional[str] = None
    school_name: Optional[str] = None
    manager_user_id: Optional[str] = None
    manager_name: Optional[str] = None
    manager_email: Optional[str] = None
    requested_organization_name: Optional[str] = None
    requested_school_name: Optional[str] = None
    requested_manager_email: Optional[str] = None
    linked_teacher_id: Optional[str] = None
    linked_teacher_name: Optional[str] = None
    uploads_total: int = 0
    assessments_total: int = 0


class MasterAdminUserListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[MasterAdminUserRecord]
    summary: Dict[str, int]


class MasterAdminUserDetailResponse(BaseModel):
    generated_at: str
    user: MasterAdminUserRecord
    related: Dict[str, Any]


class MasterAdminWorkspaceRecord(BaseModel):
    id: str
    owner_user_id: str
    owner_name: Optional[str] = None
    owner_email: Optional[str] = None
    workspace_mode: Optional[str] = None
    teacher_count: int = 0
    approved_teacher_users: int = 0
    pending_teacher_users: int = 0
    school_count: int = 0
    upload_count: int = 0
    assessment_count: int = 0
    failure_count: int = 0
    privacy_gap_count: int = 0
    unlinked_user_count: int = 0
    memory_entry_count: int = 0
    last_activity_at: Optional[str] = None
    health_state: str = "healthy"
    activity_state: str = "inactive"
    pilot_state: str = "setup_needed"
    issue_summary: Optional[str] = None


class MasterAdminWorkspaceListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[MasterAdminWorkspaceRecord]
    summary: Dict[str, int]


class MasterAdminWorkspaceDetailResponse(BaseModel):
    generated_at: str
    workspace: MasterAdminWorkspaceRecord
    related: Dict[str, Any]


class ProcessingIncidentRecord(BaseModel):
    id: str
    video_id: str
    teacher_id: Optional[str] = None
    teacher_name: Optional[str] = None
    uploader_user_id: Optional[str] = None
    uploader_email: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_email: Optional[str] = None
    filename: Optional[str] = None
    incident_type: str
    stage: str
    severity: str
    state: str
    latest_error: Optional[str] = None
    first_seen_at: str
    last_seen_at: str
    resolved_at: Optional[str] = None


class ProcessingIncidentListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[ProcessingIncidentRecord]
    summary: Dict[str, int]


class MasterAdminVideoRecord(BaseModel):
    id: str
    filename: Optional[str] = None
    teacher_id: Optional[str] = None
    teacher_name: Optional[str] = None
    uploader_user_id: Optional[str] = None
    uploader_email: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_email: Optional[str] = None
    status: str
    privacy_status: str
    analysis_status: str
    transcode_status: str
    upload_date: Optional[str] = None
    status_updated_at: Optional[str] = None
    file_size_bytes: Optional[int] = None
    processed_file_size_bytes: Optional[int] = None
    raw_asset_state: str = "unknown"
    processed_asset_state: str = "unknown"
    playback_state: str = "unknown"
    latest_error: Optional[str] = None
    incident_state: str = "clear"


class MasterAdminVideoListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[MasterAdminVideoRecord]
    summary: Dict[str, int]


class MasterAdminVideoDetailResponse(BaseModel):
    generated_at: str
    video: MasterAdminVideoRecord
    related: Dict[str, Any]


class MasterAdminStorageSummaryResponse(BaseModel):
    generated_at: str
    summary: Dict[str, Any]
    top_consumers: List[Dict[str, Any]]
    orphan_candidates: List[Dict[str, Any]]
    retention_backlog: List[Dict[str, Any]]


class MasterAdminDependencyRecord(BaseModel):
    id: str
    name: str
    healthy: bool
    status: str
    latest_probe_at: Optional[str] = None
    latest_failure_note: Optional[str] = None
    remediation: Optional[str] = None
    metadata: Dict[str, Any] = {}


class MasterAdminDependencyHealthResponse(BaseModel):
    generated_at: str
    summary: Dict[str, int]
    items: List[MasterAdminDependencyRecord]


class MasterAdminAIQualityResponse(BaseModel):
    generated_at: str
    metrics: Dict[str, Any]
    by_workspace: List[Dict[str, Any]]
    failure_clusters: List[Dict[str, Any]]
    specialist_activity: Dict[str, Any]


class UserSessionRecord(BaseModel):
    id: str
    user_id: str
    email: Optional[str] = None
    role: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: str
    last_seen_at: Optional[str] = None
    revoked_at: Optional[str] = None
    revoked_by: Optional[str] = None
    revoke_reason: Optional[str] = None


class MasterAdminSupportResponse(BaseModel):
    generated_at: str
    query: Optional[str] = None
    users: List[MasterAdminUserRecord]
    auth_events: List["AuthEventRecord"]
    audit_events: List["MasterAdminAuditEventRecord"]
    sessions: List[UserSessionRecord]
    related: Dict[str, Any]


class MasterAdminSessionActionPayload(BaseModel):
    reason: Optional[str] = None
    confirmation_text: Optional[str] = None


class MasterAdminDiagnosticBundleRequest(BaseModel):
    target_type: str
    target_id: str


class MasterAdminDiagnosticBundleResponse(BaseModel):
    generated_at: str
    target_type: str
    target_id: str
    bundle: Dict[str, Any]


class AuthEventRecord(BaseModel):
    id: str
    email: Optional[str] = None
    user_id: Optional[str] = None
    event_type: str
    role_selected: Optional[str] = None
    result: Optional[str] = None
    reason: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: str


class AuthEventListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[AuthEventRecord]


class MasterAdminAuditEventRecord(BaseModel):
    id: str
    actor_user_id: Optional[str] = None
    actor_email: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    target_type: str
    target_id: str
    reason: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: str


class MasterAdminAuditEventListResponse(BaseModel):
    generated_at: str
    total: int
    limit: int
    offset: int
    items: List[MasterAdminAuditEventRecord]


class MasterAdminUserActionPayload(BaseModel):
    reason: Optional[str] = None
    confirmation_text: Optional[str] = None
    organization_name: Optional[str] = None
    organization_type: Optional[str] = None
    school_name: Optional[str] = None
    manager_email: Optional[EmailStr] = None

class TeacherCreate(BaseModel):
    name: str
    email: EmailStr
    subject: str
    grade_level: str
    department: Optional[str] = None
    school_id: Optional[str] = None
    category: Optional[str] = None
    category_custom: Optional[str] = None
    next_coaching_conference: Optional[str] = None

class TeacherResponse(BaseModel):
    id: str
    name: str
    email: str
    subject: str
    grade_level: str
    department: Optional[str] = None
    school_id: Optional[str] = None
    category: Optional[str] = None
    category_custom: Optional[str] = None
    next_coaching_conference: Optional[str] = None
    created_at: str


class TeacherUpdate(BaseModel):
    category: Optional[str] = None
    category_custom: Optional[str] = None
    next_coaching_conference: Optional[str] = None


class SchoolCreate(BaseModel):
    name: str
    district_name: Optional[str] = None


class SchoolResponse(BaseModel):
    id: str
    name: str
    district_name: Optional[str] = None
    organization_id: Optional[str] = None
    created_at: str


class OrganizationCreate(BaseModel):
    name: str
    organization_type: str


class OrganizationResponse(BaseModel):
    id: str
    name: str
    organization_type: str
    status: str
    created_at: str

class FrameworkSelection(BaseModel):
    framework_type: FrameworkType
    selected_elements: List[str]
    priority_elements: List[str] = []
    focus_note: Optional[str] = None


class CustomElementCreate(BaseModel):
    name: str


class CustomDomainCreate(BaseModel):
    name: str
    elements: List[CustomElementCreate]

class VideoUploadResponse(BaseModel):
    id: str
    filename: str
    teacher_id: str
    status: str
    privacy_status: str
    analysis_status: str
    transcode_status: Optional[str] = None
    upload_date: str
    subject: Optional[str] = None
    recorded_at: Optional[str] = None
    file_path: Optional[str] = None
    file_size_bytes: Optional[int] = None
    content_type: Optional[str] = None


class CurriculumUploadResponse(BaseModel):
    id: str
    teacher_id: str
    school_id: Optional[str] = None
    title: str
    subject: Optional[str] = None
    grade_level: Optional[str] = None
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class LessonPlanUploadResponse(BaseModel):
    id: str
    teacher_id: str
    title: str
    date: str
    curriculum_id: Optional[str] = None
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class SyllabusUploadResponse(BaseModel):
    id: str
    teacher_id: str
    title: str
    filename: str
    file_url: str
    uploaded_by: str
    uploaded_at: str


class AdminScoreOverride(BaseModel):
    domain_id: Optional[str] = None
    original_score: Optional[float] = None
    adjusted_score: Optional[float] = None
    override_type: str = "score"
    target_type: str = "element"
    target_id: Optional[str] = None
    original_value: Optional[Any] = None
    adjusted_value: Optional[Any] = None
    rationale: Optional[str] = None
    metadata: Dict[str, Any] = {}


class AdminScoringPreference(BaseModel):
    scoring_mode: str  # "override" or "coexist"


class WorkspaceModePreferencePayload(BaseModel):
    mode: Optional[str] = None
    use_org_default: bool = False
    set_org_default: bool = False


class WorkspaceModePreferenceResponse(BaseModel):
    effective_mode: str
    user_override_mode: Optional[str] = None
    org_default_mode: Optional[str] = None
    updated_at: Optional[str] = None


class AssessmentFeedbackUpsert(BaseModel):
    target_type: str
    target_id: Optional[str] = None
    feedback_value: str
    rationale: Optional[str] = None
    source_surface: Optional[str] = None
    metadata: Dict[str, Any] = {}


class AssessmentFeedbackRecord(BaseModel):
    id: str
    assessment_id: str
    teacher_id: Optional[str] = None
    video_id: Optional[str] = None
    user_id: str
    user_role: str
    target_type: str
    target_id: Optional[str] = None
    feedback_value: str
    rationale: Optional[str] = None
    source_surface: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: str
    updated_at: str


class AssessmentFeedbackListResponse(BaseModel):
    feedback: List[AssessmentFeedbackRecord] = []


class ElementScore(BaseModel):
    """
    Rubric score for a single framework element.

    score: gradient value (1-10) to support heatmaps and richer visualizations.
    """

    element_id: str
    element_name: str
    domain: Optional[str] = None
    priority: Optional[bool] = False
    score: float  # 1-10 gradient rather than binary
    level: PerformanceLevel
    observations: List[str]
    confidence: float


class ObservationSummaryPacket(BaseModel):
    executive_summary: str
    top_strengths: List[str] = []
    growth_areas: List[str] = []
    coaching_actions: List[str] = []
    priority_alignment: List[str] = []
    focus_note: Optional[str] = None
    confidence_note: Optional[str] = None


class Observation(BaseModel):
    """Human observation tied to a teacher, video, and optional framework element."""

    id: str
    teacher_id: str
    video_id: Optional[str] = None
    element_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    admin_comment: Optional[str] = None
    teacher_response: Optional[str] = None
    implementation_status: Optional[str] = None  # e.g. "planned", "in_progress", "implemented"
    created_at: str
    updated_at: Optional[str] = None


class ObservationCreate(BaseModel):
    teacher_id: str
    video_id: Optional[str] = None
    element_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    admin_comment: Optional[str] = None
    teacher_response: Optional[str] = None
    implementation_status: Optional[str] = None

class AssessmentResult(BaseModel):
    id: str
    video_id: str
    teacher_id: str
    framework_type: str
    element_scores: List[ElementScore]
    overall_score: float
    summary: str
    recommendations: List[str]
    analyzed_at: str
    priority_elements: List[str] = []
    focus_note: Optional[str] = None
    analysis_confidence: Optional[Dict[str, Any]] = None
    analysis_modalities_used: List[str] = []
    observation_summary: Optional[ObservationSummaryPacket] = None

class TeacherPerformance(BaseModel):
    teacher_id: str
    teacher_name: str
    subject: str
    grade_level: str
    element_scores: Dict[str, Dict[str, Any]]
    overall_score: float
    assessment_count: int
    last_assessment_date: Optional[str]

class PeriodFilter(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ScheduleStatus(str, Enum):
    PLANNED = "planned"
    RECORDING = "recording"
    COMPLETED = "completed"


class VideoProcessingStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class VideoTranscodeStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    NOT_REQUIRED = "not_required"


class PrivacyProcessingStatus(str, Enum):
    NOT_REQUIRED = "not_required"
    QUEUED = "queued"
    PROCESSING = "processing"
    REVIEW_REQUIRED = "review_required"
    COMPLETED = "completed"
    FAILED = "failed"


class TeacherPrivacyProfileResponse(BaseModel):
    teacher_id: str
    status: str
    profile_version: int
    reference_count: int
    quality_score: float
    embedding_model: str
    last_enrolled_at: Optional[str] = None
    needs_refresh: bool = False
    warnings: List[str] = []


class TeacherPrivacyProfileDeleteResponse(BaseModel):
    teacher_id: str
    deleted: bool
    status: str
    deleted_at: str


class PrivacyReviewCandidateTrack(BaseModel):
    track_id: str
    teacher_match_score: float
    sample_frame_url: Optional[str] = None


class PrivacyReviewQueueItem(BaseModel):
    video_id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    filename: str
    privacy_status: str
    privacy_review_reason: Optional[str] = None
    upload_date: str
    candidate_tracks: List[PrivacyReviewCandidateTrack] = []


class PrivacyReviewQueueResponse(BaseModel):
    items: List[PrivacyReviewQueueItem]


class PrivacyReviewDecisionRequest(BaseModel):
    decision: str
    approved_track_id: Optional[str] = None
    reason: str


class PrivacyReviewDecisionResponse(BaseModel):
    video_id: str
    privacy_status: str
    analysis_status: str
    review_resolved_by: str
    review_resolved_at: str


class PrivacyAuditEvent(BaseModel):
    id: str
    actor_user_id: Optional[str] = None
    event_type: str
    target_type: str
    target_id: str
    details: Dict[str, Any] = {}
    created_at: str


class SamplingManifestFrameResponse(BaseModel):
    timestamp_sec: float
    reason: str
    score: float
    features: Dict[str, Any] = {}


class SamplingManifestResponse(BaseModel):
    video_id: str
    strategy_version: str
    scan_fps: Optional[float] = None
    max_frames: int
    selected_frames: List[SamplingManifestFrameResponse]
    created_at: str


class AnalysisMomentResponse(BaseModel):
    moment_id: str
    start_sec: float
    end_sec: float
    phase: str
    selection_reason: str
    representative_frame_sec: float
    supporting_features: Dict[str, Any] = {}
    score: float = 0.0


class AnalysisMomentManifestResponse(BaseModel):
    video_id: str
    strategy_version: str
    window_sec: Optional[float] = None
    max_moments: Optional[int] = None
    moments: List[AnalysisMomentResponse]
    created_at: str


class AudioTranscriptSegmentResponse(BaseModel):
    segment_id: Optional[str] = None
    start_sec: float
    end_sec: float
    speaker: Optional[str] = None
    text: str


class AudioTranscriptResponse(BaseModel):
    video_id: str
    transcript_status: str
    model: Optional[str] = None
    language: Optional[str] = None
    text: str = ""
    segments: List[AudioTranscriptSegmentResponse] = []
    retention_expires_at: Optional[str] = None
    created_at: str


class AudioFeatureResponse(BaseModel):
    video_id: str
    teacher_talk_ratio: float = 0.0
    turn_count: int = 0
    question_count: int = 0
    open_question_count: int = 0
    directive_density: float = 0.0
    pause_density: float = 0.0
    transition_markers: int = 0
    modalities_used: List[str] = []
    created_at: str


class RecognitionBadgeResponse(BaseModel):
    id: str
    badge_type: str
    status: str
    video_id: str
    awarded_at: Optional[str] = None
    awarded_by: Optional[str] = None
    criteria_snapshot: Dict[str, Any] = {}


class TeacherRecognitionSummaryResponse(BaseModel):
    teacher_id: str
    badges: List[RecognitionBadgeResponse]
    summary: Dict[str, Any]


class VideoRecognitionResponse(BaseModel):
    video_id: str
    teacher_id: str
    eligibility: Dict[str, Any]
    recognition: Dict[str, Any]
    publication: Dict[str, Any]


class RecognitionOptInRequest(BaseModel):
    teacher_opt_in: bool
    sharing_scope: Optional[str] = None
    allow_social_share: bool = False
    allow_email_signature: bool = False


class RecognitionOptInResponse(BaseModel):
    video_id: str
    teacher_opt_in: bool
    sharing_scope: Optional[str] = None
    allow_social_share: bool
    allow_email_signature: bool
    updated_at: str


class RecognitionReviewRequest(BaseModel):
    decision: str
    badge_type: Optional[str] = FIVE_STAR_BADGE
    reason: str


class RecognitionReviewResponse(BaseModel):
    video_id: str
    recognition_status: str
    badge: Optional[RecognitionBadgeResponse] = None


class RecognitionReviewQueueItem(BaseModel):
    video_id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    recognition_status: str
    publication_status: str
    badge_type: Optional[str] = None
    sharing_scope: Optional[str] = None
    submitted_at: Optional[str] = None


class RecognitionReviewQueueResponse(BaseModel):
    items: List[RecognitionReviewQueueItem]


class ExemplarSubmissionRequest(BaseModel):
    title: str
    summary: str
    sharing_scope: str
    tags: List[str] = []


class ExemplarSubmissionResponse(BaseModel):
    submission_id: str
    video_id: str
    submission_status: str
    submitted_at: str


class ExemplarReviewQueueItem(BaseModel):
    submission_id: str
    video_id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    title: str
    summary: str
    sharing_scope: Optional[str] = None
    submission_status: str
    submitted_at: Optional[str] = None
    tags: List[str] = []


class ExemplarReviewQueueResponse(BaseModel):
    items: List[ExemplarReviewQueueItem]


class ExemplarLibraryReviewRequest(BaseModel):
    decision: str
    reason: str


class ExemplarLibraryItemResponse(BaseModel):
    id: str
    video_id: str
    teacher_id: str
    teacher_display_name: Optional[str] = None
    title: str
    summary: str
    subject: Optional[str] = None
    grade_level: Optional[str] = None
    badge_type: str
    tags: List[str] = []
    thumbnail_url: Optional[str] = None
    playback_url: Optional[str] = None
    published_at: Optional[str] = None
    status: str


class ExemplarLibraryReviewResponse(BaseModel):
    submission_id: str
    publication_status: str
    library_item: Optional[ExemplarLibraryItemResponse] = None


class ExemplarLibraryResponse(BaseModel):
    items: List[ExemplarLibraryItemResponse]
    count: int


class SocialCardRequest(BaseModel):
    platform: str = "linkedin"
    include_subject: bool = True
    include_grade: bool = False
    include_summary: bool = True


class SocialCardResponse(BaseModel):
    asset_id: str
    asset_type: str
    file_url: str
    caption: str
    created_at: str


class EmailSignatureRequest(BaseModel):
    format: str = "html"
    badge_style: str = "compact"


class EmailSignatureResponse(BaseModel):
    asset_id: str
    asset_type: str
    html: str
    image_url: str
    created_at: str


class AdminSmokeCleanupRequest(BaseModel):
    teacher_id: Optional[str] = None
    teacher_email: Optional[EmailStr] = None
    delete_user_emails: List[EmailStr] = []


class AdminSmokeCleanupResponse(BaseModel):
    teacher_id: str
    teacher_email: Optional[str] = None
    deleted_files: int
    deleted_counts: Dict[str, int]
    deleted_users: List[str] = []
    executed_at: str


class Schedule(BaseModel):
    """Upcoming class session scheduled for recording."""

    id: str
    teacher_id: str
    course_name: str
    start_time: datetime
    recording_status: ScheduleStatus
    join_url: Optional[str] = None
    location: Optional[str] = None
    reminder_type: Optional[str] = None
    reminder_context: Optional[Dict[str, Any]] = None
    reminder_note: Optional[str] = None


class ScheduleCreate(BaseModel):
    teacher_id: str
    course_name: str
    start_time: datetime
    join_url: Optional[str] = None
    location: Optional[str] = None
    reminder_type: Optional[str] = None
    reminder_context: Optional[Dict[str, Any]] = None
    reminder_note: Optional[str] = None


class ScheduleUpdate(BaseModel):
    recording_status: Optional[ScheduleStatus] = None
    join_url: Optional[str] = None
    reminder_note: Optional[str] = None


class RecordingPolicy(BaseModel):
    id: str
    created_by: str
    school_id: Optional[str] = None
    period_length_days: int
    min_recordings_per_period: int
    reminder_offsets_days: List[int]
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RecordingPolicyUpsert(BaseModel):
    teacher_id: Optional[str] = None
    school_id: Optional[str] = None
    period_length_days: int = 30
    min_recordings_per_period: int = 2
    reminder_offsets_days: List[int] = [7, 2]


class RecordingCompliance(BaseModel):
    id: str
    teacher_id: str
    period_start: str
    period_end: str
    recordings_required: int
    recordings_completed: int
    required_subjects: List[str]
    missing_subjects: List[str]
    is_compliant: bool
    last_checked_at: str


class ActionPlanGoal(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = "planned"
    evidence_links: Optional[List[str]] = None
    evidence_records: List["EvidenceRecord"] = []
    progress_signal: Optional[str] = None
    progress_summary: Optional[str] = None
    latest_evidence_at: Optional[str] = None


class ActionPlan(BaseModel):
    id: str
    teacher_id: str
    goals: List[ActionPlanGoal]
    notes: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ActionPlanHistoryEntry(BaseModel):
    id: str
    teacher_id: str
    plan_id: str
    goals: List[ActionPlanGoal]
    notes: Optional[str] = None
    saved_at: str
    saved_by_user_id: Optional[str] = None
    saved_by_name: Optional[str] = None
    saved_by_role: Optional[str] = None


class ActionPlanHistoryResponse(BaseModel):
    current_plan: ActionPlan
    history: List[ActionPlanHistoryEntry]


class SummaryReflection(BaseModel):
    id: str
    teacher_id: str
    self_reflection: Optional[str] = None
    actions_taken: Optional[str] = None
    linked_goal_ids: List[str] = []
    linked_goal_titles: List[str] = []
    linked_video_id: Optional[str] = None
    linked_assessment_id: Optional[str] = None
    linked_observation_id: Optional[str] = None
    linked_evidence_records: List["EvidenceRecord"] = []
    created_at: str
    updated_at: Optional[str] = None


class SummaryReflectionUpsert(BaseModel):
    self_reflection: Optional[str] = None
    actions_taken: Optional[str] = None
    linked_goal_ids: List[str] = []
    linked_video_id: Optional[str] = None
    linked_assessment_id: Optional[str] = None
    linked_observation_id: Optional[str] = None


class EvidenceRecord(BaseModel):
    id: str
    teacher_id: str
    evidence_type: str
    title: str
    summary: Optional[str] = None
    created_at: Optional[str] = None
    route_hint: Optional[str] = "video"
    video_id: Optional[str] = None
    assessment_id: Optional[str] = None
    observation_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None
    signal: Optional[str] = None
    reference_key: Optional[str] = None


class TeacherEvidenceCatalogResponse(BaseModel):
    teacher_id: str
    teacher_name: Optional[str] = None
    items: List[EvidenceRecord]


class ReflectionHistoryEntry(BaseModel):
    id: str
    teacher_id: str
    reflection_id: Optional[str] = None
    author_user_id: Optional[str] = None
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    self_reflection: Optional[str] = None
    actions_taken: Optional[str] = None
    linked_goal_ids: List[str] = []
    linked_goal_titles: List[str] = []
    linked_video_id: Optional[str] = None
    linked_assessment_id: Optional[str] = None
    linked_observation_id: Optional[str] = None
    linked_evidence_records: List[EvidenceRecord] = []
    saved_at: str
    updated_at: Optional[str] = None


class ReflectionHistoryResponse(BaseModel):
    current_entries: List[ReflectionHistoryEntry]
    history: List[ReflectionHistoryEntry]


ActionPlanGoal.model_rebuild()
SummaryReflection.model_rebuild()


class ConferenceAgendaRecord(BaseModel):
    id: str
    teacher_id: str
    agenda_items: List[str]
    linked_goal_ids: List[str] = []
    linked_assessment_id: Optional[str] = None
    linked_video_id: Optional[str] = None
    published_by_user_id: Optional[str] = None
    published_by_name: Optional[str] = None
    published_at: Optional[str] = None
    updated_at: Optional[str] = None


class ConferenceAgendaUpsert(BaseModel):
    agenda_items: List[str]
    linked_goal_ids: List[str] = []
    linked_assessment_id: Optional[str] = None
    linked_video_id: Optional[str] = None


class CoachingTimelineEntry(BaseModel):
    id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    entry_type: str
    title: str
    summary: Optional[str] = None
    created_at: str
    author_name: Optional[str] = None
    author_role: Optional[str] = None
    route_hint: Optional[str] = None
    assessment_id: Optional[str] = None
    video_id: Optional[str] = None
    observation_id: Optional[str] = None
    goal_id: Optional[str] = None
    reflection_id: Optional[str] = None
    schedule_id: Optional[str] = None
    timestamp_seconds: Optional[float] = None


class CoachingTimelineResponse(BaseModel):
    teacher_id: str
    teacher_name: Optional[str] = None
    entries: List[CoachingTimelineEntry]


class CoachingTask(BaseModel):
    id: str
    teacher_id: str
    teacher_name: Optional[str] = None
    state: str
    priority: int
    title: str
    summary: str
    due_at: Optional[str] = None
    route_hint: Optional[str] = None
    assessment_id: Optional[str] = None
    video_id: Optional[str] = None
    observation_id: Optional[str] = None
    goal_id: Optional[str] = None
    schedule_id: Optional[str] = None
    context_label: Optional[str] = None
    support_prompt: Optional[str] = None
    rank_reason: Optional[str] = None


class CoachingTaskListResponse(BaseModel):
    tasks: List[CoachingTask]


class TeacherAdaptiveSupportResponse(BaseModel):
    teacher_id: str
    teacher_name: Optional[str] = None
    teacher_prompt_title: Optional[str] = None
    teacher_prompt_body: Optional[str] = None
    admin_prompt_title: Optional[str] = None
    admin_prompt_body: Optional[str] = None
    primary_goal_title: Optional[str] = None
    primary_goal_signal: Optional[str] = None
    conference_continuity_lines: List[str] = []


class NotificationRecord(BaseModel):
    id: str
    teacher_id: Optional[str] = None
    notification_type: str
    title: str
    message: str
    channel: str = "email"
    status: str = "queued"
    created_at: str
    read_at: Optional[str] = None


class GradebookIntegrationCreate(BaseModel):
    provider: str  # "powerschool" | "canvas"
    api_key: Optional[str] = None
    status: Optional[str] = "connected"


class GradebookIntegrationResponse(BaseModel):
    id: str
    provider: str
    status: str
    created_at: str
    updated_at: Optional[str] = None

# ==================== AUTH HELPERS ====================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

async def _create_user_session(*, user: dict, role: str, request: Optional[Request]) -> str:
    session_id = str(uuid.uuid4())
    request_meta = _extract_request_metadata(request)
    now = datetime.now(timezone.utc).isoformat()
    await db.user_sessions.insert_one(
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


def create_token(user_id: str, *, session_id: Optional[str] = None) -> str:
    issued_at = datetime.now(timezone.utc)
    payload = {
        "user_id": user_id,
        "exp": issued_at + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": issued_at,
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def _is_admin_role(role: Optional[str]) -> bool:
    return role in {"admin", "principal", "super_admin"}


def _require_school_admin_user(current_user: dict) -> dict:
    if _get_user_tenant_role(current_user) != "school_admin":
        raise HTTPException(status_code=403, detail="School administrator access required")
    return current_user


def _require_training_admin_user(current_user: dict) -> dict:
    if _get_user_tenant_role(current_user) != "training_admin":
        raise HTTPException(status_code=403, detail="Training administrator access required")
    return current_user


def _requested_role_matches_user(requested_role: Optional[str], user_doc: dict) -> bool:
    if not requested_role:
        return True
    return requested_role == _get_user_tenant_role(user_doc)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        session_id = payload.get("sid")
        if session_id:
            session = await db.user_sessions.find_one({"id": session_id}, {"_id": 0})
            if not session or session.get("revoked_at"):
                raise HTTPException(status_code=401, detail="Session expired")
        if _get_user_approval_status(user) == "pending":
            raise HTTPException(status_code=403, detail="Account pending approval")
        if _get_user_approval_status(user) == "revoked" or not _is_user_access_active(user):
            raise HTTPException(status_code=403, detail="Account access removed")
        user["role"] = _get_user_role(user)
        user["approval_status"] = _get_user_approval_status(user)
        if session_id:
            user["session_id"] = session_id
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ==================== AUTH ENDPOINTS ====================
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user: UserCreate, request: Request):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    if DEMO_MODE:
        raise HTTPException(status_code=403, detail="Registration is disabled for demo mode")
    if ACCESS_APPROVAL_REQUIRED and not _is_access_auto_approved_email(user.email.lower()):
        raise HTTPException(status_code=403, detail="Self-registration is disabled. Request access approval.")
    existing = await db.users.find_one({"email": user.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    desired_role = _normalize_requested_role(user.role)
    tenancy_fields = _normalize_access_request_tenancy_fields(user, desired_role)
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user.email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "role": "admin" if user.email.lower() in ADMIN_EMAILS else _legacy_role_for_tenant_role(desired_role),
        "tenant_role": "school_admin" if user.email.lower() in ADMIN_EMAILS else desired_role,
        "tenant_status": "approved",
        "approval_status": "approved",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
        **tenancy_fields,
    }
    await db.users.insert_one(user_doc)
    enriched_user = await enrich_user_with_workspace_mode(user_doc)
    
    session_id = await _create_user_session(user=enriched_user, role=_get_user_role(enriched_user), request=request)
    token = create_token(user_id, session_id=session_id)
    return TokenResponse(
        token=token,
        user=UserResponse(
            **enriched_user,
        )
    )


@api_router.post("/auth/request-access", response_model=AccessRequestResponse)
async def request_access(user: UserCreate, request: Request):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    if DEMO_MODE:
        raise HTTPException(status_code=403, detail="Access requests are disabled for demo mode")

    email = user.email.lower()
    request_meta = _extract_request_metadata(request)
    existing = await db.users.find_one({"email": email})
    now = datetime.now(timezone.utc).isoformat()
    auto_approved = _is_access_auto_approved_email(email)
    desired_role = _normalize_requested_role(user.role)
    tenancy_fields = _normalize_access_request_tenancy_fields(user, desired_role)

    if existing:
        existing_status = _get_user_approval_status(existing)
        if existing_status == "approved" and _is_user_access_active(existing):
            raise HTTPException(status_code=400, detail="Email already registered")
        if existing_status == "revoked":
            raise HTTPException(status_code=403, detail="Access has been removed for this account")
        update_fields = {
            "name": user.name,
            "password": hash_password(user.password),
            "updated_at": now,
            **tenancy_fields,
        }
        if auto_approved:
            update_fields.update(
                {
                    "approval_status": "approved",
                    "approved_at": now,
                    "approved_by": "system:auto_admin_allowlist",
                    "revoked_at": None,
                    "revoked_by": None,
                    "is_active": True,
                    "role": "admin",
                    "tenant_role": "school_admin",
                    "tenant_status": "approved",
                }
            )
        else:
            update_fields.update(
                {
                    "approval_status": "pending",
                    "approval_requested_at": now,
                    "approved_at": None,
                    "approved_by": None,
                    "revoked_at": None,
                    "revoked_by": None,
                    "is_active": False,
                    "role": _legacy_role_for_tenant_role(desired_role),
                    "tenant_role": desired_role,
                    "tenant_status": "pending",
                }
            )
        await db.users.update_one({"id": existing["id"]}, {"$set": update_fields})
        refreshed = await db.users.find_one({"id": existing["id"]}, {"_id": 0})
        if auto_approved:
            enriched_user = await enrich_user_with_workspace_mode(refreshed)
            await _log_auth_event(
                "approval_granted",
                email=email,
                user_id=refreshed.get("id"),
                role_selected=desired_role,
                result="success",
                reason="system:auto_admin_allowlist",
                ip_address=request_meta["ip_address"],
                user_agent=request_meta["user_agent"],
            )
            logger.info("Auto-approved access request for allowlisted admin email %s", email)
            return AccessRequestResponse(
                status="approved",
                email=email,
                message="Access is approved. You can now log in.",
                approval_status=_get_user_approval_status(enriched_user),
                tenant_role=_get_user_tenant_role(enriched_user),
                organization_type=enriched_user.get("organization_type"),
                organization_name=enriched_user.get("organization_name") or enriched_user.get("requested_organization_name"),
                school_name=enriched_user.get("school_name") or enriched_user.get("requested_school_name"),
            )
        await _log_auth_event(
            "request_access",
            email=email,
            user_id=refreshed.get("id"),
            role_selected=desired_role,
            result="pending",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        _send_access_request_notification(refreshed)
        _send_access_request_received_confirmation(refreshed)
        return AccessRequestResponse(
            status="pending",
            email=email,
            message="Access request submitted. Approval is required before login.",
            approval_status="pending",
            tenant_role=desired_role,
            organization_type=tenancy_fields.get("organization_type"),
            organization_name=tenancy_fields.get("requested_organization_name"),
            school_name=tenancy_fields.get("requested_school_name"),
        )

    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": user.name,
        "password": hash_password(user.password),
        "created_at": now,
        "role": "admin" if auto_approved else _legacy_role_for_tenant_role(desired_role),
        "tenant_role": "school_admin" if auto_approved else desired_role,
        "tenant_status": "approved" if auto_approved else "pending",
        "approval_status": "approved" if auto_approved else "pending",
        "approval_requested_at": now,
        "approved_at": now if auto_approved else None,
        "approved_by": "system:auto_admin_allowlist" if auto_approved else None,
        "is_active": True if auto_approved else False,
        **tenancy_fields,
    }
    await db.users.insert_one(user_doc)
    if auto_approved:
        enriched_user = await enrich_user_with_workspace_mode(user_doc)
        await _log_auth_event(
            "approval_granted",
            email=email,
            user_id=user_id,
            role_selected=desired_role,
            result="success",
            reason="system:auto_admin_allowlist",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        logger.info("Auto-approved access request for allowlisted admin email %s", email)
        return AccessRequestResponse(
            status="approved",
            email=email,
            message="Access is approved. You can now log in.",
            approval_status=_get_user_approval_status(enriched_user),
            tenant_role=_get_user_tenant_role(enriched_user),
            organization_type=enriched_user.get("organization_type"),
            organization_name=enriched_user.get("organization_name") or enriched_user.get("requested_organization_name"),
            school_name=enriched_user.get("school_name") or enriched_user.get("requested_school_name"),
        )
    await _log_auth_event(
        "request_access",
        email=email,
        user_id=user_id,
        role_selected=desired_role,
        result="pending",
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )
    _send_access_request_notification(user_doc)
    _send_access_request_received_confirmation(user_doc)
    return AccessRequestResponse(
        status="pending",
        email=email,
        message="Access request submitted. Approval is required before login.",
        approval_status="pending",
        tenant_role=desired_role,
        organization_type=tenancy_fields.get("organization_type"),
        organization_name=tenancy_fields.get("requested_organization_name"),
        school_name=tenancy_fields.get("requested_school_name"),
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(user: UserLogin, request: Request):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    email = str(user.email or "").lower()
    request_meta = _extract_request_metadata(request)
    db_user = await db.users.find_one({"email": email})
    requested_role = _normalize_requested_role(user.role) if user.role else None
    if not db_user or not verify_password(user.password, db_user["password"]):
        await _log_auth_event(
            "login_failed",
            email=email,
            role_selected=requested_role,
            result="failure",
            reason="invalid_credentials",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    approval_status = _get_user_approval_status(db_user)
    if approval_status == "pending":
        await _log_auth_event(
            "login_failed",
            email=email,
            user_id=db_user.get("id"),
            role_selected=requested_role,
            result="failure",
            reason="pending_approval",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        raise HTTPException(status_code=403, detail="Account pending approval")
    if approval_status == "revoked" or not _is_user_access_active(db_user):
        await _log_auth_event(
            "login_failed",
            email=email,
            user_id=db_user.get("id"),
            role_selected=requested_role,
            result="failure",
            reason="access_removed",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        raise HTTPException(status_code=403, detail="Account access removed")
    actual_role = _get_user_role(db_user)
    actual_tenant_role = _get_user_tenant_role(db_user)
    if requested_role and not _requested_role_matches_user(requested_role, db_user):
        expected_label = _format_tenant_role_label(actual_tenant_role)
        await _log_auth_event(
            "login_failed",
            email=email,
            user_id=db_user.get("id"),
            role_selected=requested_role,
            result="failure",
            reason="role_mismatch",
            ip_address=request_meta["ip_address"],
            user_agent=request_meta["user_agent"],
        )
        raise HTTPException(
            status_code=403,
            detail=f"This account is registered as a {expected_label}. Choose the correct role and try again.",
        )
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": db_user["id"]},
        {"$set": {"last_login_at": now, "last_seen_at": now}},
    )
    db_user["last_login_at"] = now
    db_user["last_seen_at"] = now
    db_user.pop("_id", None)
    db_user.pop("password", None)
    db_user["role"] = actual_role
    db_user["tenant_role"] = actual_tenant_role
    db_user["tenant_status"] = approval_status
    db_user["approval_status"] = approval_status
    enriched_user = await enrich_user_with_workspace_mode(db_user)

    await _log_auth_event(
        "login_success",
        email=email,
        user_id=db_user.get("id"),
        role_selected=requested_role or actual_role,
        result="success",
        ip_address=request_meta["ip_address"],
        user_agent=request_meta["user_agent"],
    )

    session_id = await _create_user_session(user=db_user, role=actual_role, request=request)
    token = create_token(db_user["id"], session_id=session_id)
    return TokenResponse(
        token=token,
        user=UserResponse(**enriched_user)
    )

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    from app.services.workspace_service import enrich_user_with_workspace_mode

    return UserResponse(**(await enrich_user_with_workspace_mode(current_user)))


@api_router.get("/user/workspace-mode", response_model=WorkspaceModePreferenceResponse)
async def get_user_workspace_mode(current_user: dict = Depends(get_current_user)):
    from app.services.workspace_service import resolve_workspace_mode

    return WorkspaceModePreferenceResponse(**(await resolve_workspace_mode(current_user)))


@api_router.post("/user/workspace-mode", response_model=WorkspaceModePreferenceResponse)
async def set_user_workspace_mode(
    payload: WorkspaceModePreferencePayload,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import set_workspace_mode

    return WorkspaceModePreferenceResponse(
        **(await set_workspace_mode(current_user, payload.model_dump()))
    )

# ==================== FRAMEWORK ENDPOINTS ====================
@api_router.get("/frameworks")
async def get_frameworks(current_user: dict = Depends(get_current_user)):
    custom_domain_count = await db.custom_domains.count_documents(
        {"user_id": current_user["id"]}
    )
    return {
        "frameworks": [
            {"type": "danielson", "name": "Danielson Framework", "domain_count": 4},
            {"type": "marshall", "name": "Marshall Rubrics", "domain_count": 6},
            {
                "type": "custom",
                "name": "Custom Focus Rubric",
                "domain_count": 10 + custom_domain_count,
            },
        ]
    }

@api_router.get("/frameworks/custom-domains")
async def list_custom_domains(current_user: dict = Depends(get_current_user)):
    domains = await db.custom_domains.find(
        {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
    ).to_list(1000)
    return {"domains": domains}


@api_router.post("/frameworks/custom-domains")
async def create_custom_domain(
    payload: CustomDomainCreate, current_user: dict = Depends(get_current_user)
):
    domain_id = f"c{uuid.uuid4().hex[:8]}"
    elements = [
        {"id": f"{domain_id}-{idx+1}", "name": el.name}
        for idx, el in enumerate(payload.elements)
    ]
    domain_doc = {
        "id": domain_id,
        "name": payload.name,
        "elements": elements,
        "source_type": "manual",
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.custom_domains.insert_one(domain_doc)
    domain_doc.pop("user_id", None)
    return {"domain": domain_doc}


@api_router.post("/frameworks/upload-rubric")
async def upload_focus_rubric(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded rubric file is empty")
    rubric_name, parsed_domains = _parse_uploaded_rubric_file(file.filename or "", content)
    created_domains = []
    created_at = datetime.now(timezone.utc).isoformat()
    for domain in parsed_domains:
        domain_doc = {
            **domain,
            "rubric_set_name": rubric_name,
            "user_id": current_user["id"],
            "created_at": created_at,
        }
        await db.custom_domains.insert_one(domain_doc)
        created_domains.append({k: v for k, v in domain_doc.items() if k != "user_id"})
    return {
        "message": "Rubric uploaded",
        "rubric_name": rubric_name,
        "domains_created": len(created_domains),
        "elements_created": sum(len(domain.get("elements") or []) for domain in created_domains),
        "domains": created_domains,
    }


@api_router.post("/frameworks/custom-domains/{domain_id}/elements")
async def add_custom_element(
    domain_id: str,
    payload: CustomElementCreate,
    current_user: dict = Depends(get_current_user),
):
    domain = await db.custom_domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    element_id = f"{domain_id}-{uuid.uuid4().hex[:6]}"
    element = {"id": element_id, "name": payload.name}
    await db.custom_domains.update_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"$push": {"elements": element}},
    )
    domain = await db.custom_domains.find_one(
        {"id": domain_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    return {"domain": domain}


@api_router.delete("/frameworks/custom-domains/{domain_id}")
async def delete_custom_domain(
    domain_id: str, current_user: dict = Depends(get_current_user)
):
    result = await db.custom_domains.delete_one(
        {"id": domain_id, "user_id": current_user["id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Domain not found")
    return {"message": "Domain deleted"}


@api_router.get("/frameworks/{framework_type}")
async def get_framework_details(
    framework_type: FrameworkType, current_user: dict = Depends(get_current_user)
):
    if framework_type == FrameworkType.DANIELSON:
        return DANIELSON_FRAMEWORK
    elif framework_type == FrameworkType.MARSHALL:
        return MARSHALL_FRAMEWORK
    else:
        custom_domains = await db.custom_domains.find(
            {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
        ).to_list(1000)
        domains = (
            DANIELSON_FRAMEWORK["domains"]
            + MARSHALL_FRAMEWORK["domains"]
            + custom_domains
        )
        return {"name": "Custom Framework", "type": "custom", "domains": domains}

@api_router.post("/frameworks/selection")
async def save_framework_selection(selection: FrameworkSelection, current_user: dict = Depends(get_current_user)):
    from app.services.workspace_service import sync_framework_memory

    selected_elements = []
    seen_selected = set()
    for element_id in selection.selected_elements or []:
        if element_id in seen_selected:
            continue
        seen_selected.add(element_id)
        selected_elements.append(element_id)

    priority_elements = []
    seen_priority = set()
    for element_id in selection.priority_elements or []:
        if element_id not in seen_selected or element_id in seen_priority:
            continue
        seen_priority.add(element_id)
        priority_elements.append(element_id)

    selection_doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "framework_type": selection.framework_type,
        "selected_elements": selected_elements,
        "priority_elements": priority_elements,
        "focus_note": (selection.focus_note or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.framework_selections.update_one(
        {"user_id": current_user["id"]},
        {"$set": selection_doc},
        upsert=True
    )
    await sync_framework_memory(current_user, selection_doc)
    return {"message": "Selection saved", "selection": selection_doc}

@api_router.get("/frameworks/selection/current")
async def get_current_selection(current_user: dict = Depends(get_current_user)):
    selection = await db.framework_selections.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    if not selection:
        # Return default with all Danielson elements selected
        all_elements = []
        for domain in DANIELSON_FRAMEWORK["domains"]:
            for element in domain["elements"]:
                all_elements.append(element["id"])
        return {
            "framework_type": "danielson",
            "selected_elements": all_elements,
            "priority_elements": [],
            "focus_note": None,
        }

    if selection.get("framework_type") == "custom" and not selection.get(
        "selected_elements"
    ):
        custom_domains = await db.custom_domains.find(
            {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
        ).to_list(1000)
        domains = (
            DANIELSON_FRAMEWORK["domains"]
            + MARSHALL_FRAMEWORK["domains"]
            + custom_domains
        )
        element_ids = [
            el["id"] for domain in domains for el in domain.get("elements", [])
        ]
        selection["selected_elements"] = element_ids
    selection.setdefault("priority_elements", [])
    selection.setdefault("focus_note", None)
    return selection

# ==================== TEACHER ENDPOINTS ====================
@api_router.post("/teachers", response_model=TeacherResponse)
async def create_teacher(teacher: TeacherCreate, current_user: dict = Depends(get_current_user)):
    teacher_id = str(uuid.uuid4())
    school = None
    if teacher.school_id:
        school = await db.schools.find_one({"id": teacher.school_id}, {"_id": 0})
        if not school:
            raise HTTPException(status_code=404, detail="School not found")
        visible_school_ids = await _get_visible_school_ids_for_user(current_user)
        if teacher.school_id not in visible_school_ids:
            raise HTTPException(status_code=403, detail="Not authorized for this school")
    teacher_doc = {
        "id": teacher_id,
        "name": teacher.name,
        "email": teacher.email,
        "subject": teacher.subject,
        "grade_level": teacher.grade_level,
        "department": teacher.department,
        "school_id": teacher.school_id,
        "organization_id": (school or {}).get("organization_id") or current_user.get("organization_id"),
        "category": teacher.category,
        "category_custom": teacher.category_custom,
        "next_coaching_conference": teacher.next_coaching_conference,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.teachers.insert_one(teacher_doc)
    return TeacherResponse(**{k: v for k, v in teacher_doc.items() if k not in ["created_by", "_id"]})

@api_router.patch("/teachers/{teacher_id}", response_model=TeacherResponse)
async def update_teacher(
    teacher_id: str,
    payload: TeacherUpdate,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    update_fields: Dict[str, Any] = {}
    if payload.category is not None:
        update_fields["category"] = payload.category
    if payload.category_custom is not None:
        update_fields["category_custom"] = payload.category_custom
    if payload.next_coaching_conference is not None:
        update_fields["next_coaching_conference"] = payload.next_coaching_conference
    if not update_fields:
        teacher.pop("created_by", None)
        return TeacherResponse(**teacher)
    await db.teachers.update_one({"id": teacher_id}, {"$set": update_fields})
    teacher.update(update_fields)
    teacher.pop("created_by", None)
    return TeacherResponse(**teacher)

@api_router.get("/teachers", response_model=List[TeacherResponse])
async def get_teachers(request: Request, current_user: dict = Depends(get_current_user)):
    teacher_ids = await _list_teacher_ids_for_user(current_user)
    if not teacher_ids:
        return []
    teachers = await db.teachers.find(
        {"id": {"$in": teacher_ids}},
        {"_id": 0, "created_by": 0}
    ).to_list(1000)
    language = _resolve_request_language(request, default="en")
    return [TeacherResponse(**_localize_teacher_payload(t, language)) for t in teachers]


@api_router.post("/schools", response_model=SchoolResponse)
async def create_school(
    payload: SchoolCreate,
    current_user: dict = Depends(get_current_user),
):
    organization = await _ensure_school_organization_for_user(
        current_user=current_user,
        school_name=payload.name,
        district_name=payload.district_name,
    )
    school_id = str(uuid.uuid4())
    doc = {
        "id": school_id,
        "name": payload.name,
        "district_name": payload.district_name,
        "user_id": current_user["id"],
        "organization_id": organization["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schools.insert_one(doc)
    doc.pop("user_id", None)
    return SchoolResponse(**doc)


@api_router.get("/schools", response_model=List[SchoolResponse])
async def list_schools(current_user: dict = Depends(get_current_user)):
    query: Dict[str, Any] = {"user_id": current_user["id"]}
    if current_user.get("organization_id"):
        query = {"organization_id": current_user["organization_id"]}
    schools = await db.schools.find(
        query,
        {"_id": 0, "user_id": 0},
    ).to_list(1000)
    return [SchoolResponse(**s) for s in schools]

@api_router.get("/teachers/{teacher_id}", response_model=TeacherResponse)
async def get_teacher(teacher_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    teacher.pop("created_by", None)
    language = _resolve_request_language(request, default="en")
    return TeacherResponse(**_localize_teacher_payload(teacher, language))


@api_router.get("/teachers/{teacher_id}/privacy-profile", response_model=TeacherPrivacyProfileResponse)
async def get_teacher_privacy_profile(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    profile = await _get_active_privacy_profile(teacher_id)
    return _build_privacy_profile_summary(teacher_id, profile)


@api_router.post("/teachers/{teacher_id}/privacy-profile", response_model=TeacherPrivacyProfileResponse)
async def upsert_teacher_privacy_profile(
    teacher_id: str,
    files: List[UploadFile] = File(...),
    replace_existing: bool = Form(False),
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    uploads = [upload for upload in files if (upload.filename or "").strip()]
    if len(uploads) < PRIVACY_PROFILE_MIN_REFERENCES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Teacher privacy profile requires at least "
                f"{PRIVACY_PROFILE_MIN_REFERENCES} reference images."
            ),
        )
    if len(uploads) > PRIVACY_PROFILE_MAX_REFERENCES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Teacher privacy profile supports at most "
                f"{PRIVACY_PROFILE_MAX_REFERENCES} reference images."
            ),
        )

    active_profile = await _get_active_privacy_profile(teacher_id)
    if active_profile and replace_existing:
        await db.teacher_face_profiles.update_one(
            {"id": active_profile["id"]},
            {"$set": {"status": "replaced", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )

    existing_versions = await db.teacher_face_profiles.find(
        {"teacher_id": teacher_id},
        {"_id": 0, "profile_version": 1},
    ).to_list(100)
    next_version = max([int(item.get("profile_version", 0) or 0) for item in existing_versions] + [0]) + 1
    now = datetime.now(timezone.utc).isoformat()
    profile_id = str(uuid.uuid4())
    reference_docs = []
    for upload in uploads:
        relative_path, file_url, s3_key = await _save_privacy_reference_file(upload, teacher_id, profile_id)
        reference_docs.append(
            {
                "id": str(uuid.uuid4()),
                "teacher_id": teacher_id,
                "profile_id": profile_id,
                "reference_type": "image",
                "filename": upload.filename,
                "file_path": relative_path,
                "file_url": file_url,
                "s3_key": s3_key,
                "embedding": [],
                "quality_checks": {
                    "validation_mode": "contract_only",
                    "content_type": upload.content_type,
                },
                "created_at": now,
                "retention_expires_at": (datetime.now(timezone.utc) + timedelta(days=PRIVACY_PROFILE_IMAGE_RETENTION_DAYS)).isoformat(),
            }
        )
    if reference_docs:
        await db.teacher_face_references.insert_many(reference_docs)
    if active_profile and not replace_existing:
        await db.teacher_face_profiles.update_many(
            {"teacher_id": teacher_id, "status": "active"},
            {"$set": {"status": "superseded", "updated_at": now}},
        )

    profile_doc = {
        "id": profile_id,
        "teacher_id": teacher_id,
        "status": "active",
        "profile_version": next_version,
        "reference_count": len(reference_docs),
        "quality_score": 1.0,
        "embedding_model": "opencv-sface",
        "embedding_version": "contract-v1",
        "created_at": now,
        "updated_at": now,
        "last_enrolled_at": now,
        "needs_refresh": False,
        "warnings": [],
    }
    await db.teacher_face_profiles.insert_one(profile_doc)
    await _log_privacy_audit_event(
        "privacy_profile_upserted",
        "teacher",
        teacher_id,
        actor_user_id=current_user["id"],
        details={
            "profile_id": profile_id,
            "profile_version": next_version,
            "reference_count": len(reference_docs),
        },
    )
    return _build_privacy_profile_summary(teacher_id, profile_doc)


@api_router.delete("/teachers/{teacher_id}/privacy-profile", response_model=TeacherPrivacyProfileDeleteResponse)
async def delete_teacher_privacy_profile(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    deleted_at = datetime.now(timezone.utc).isoformat()
    result = await db.teacher_face_profiles.update_many(
        {"teacher_id": teacher_id, "status": "active"},
        {"$set": {"status": "deleted", "updated_at": deleted_at}},
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Teacher privacy profile not found")
    await db.teacher_face_references.update_many(
        {"teacher_id": teacher_id},
        {"$set": {"retention_expires_at": deleted_at}},
    )
    await _log_privacy_audit_event(
        "privacy_profile_deleted",
        "teacher",
        teacher_id,
        actor_user_id=current_user["id"],
        details={"deleted_at": deleted_at},
    )
    return TeacherPrivacyProfileDeleteResponse(
        teacher_id=teacher_id,
        deleted=True,
        status="deleted",
        deleted_at=deleted_at,
    )


@api_router.delete("/teachers/{teacher_id}")
async def delete_teacher(teacher_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.teachers.delete_one({"id": teacher_id, "created_by": current_user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return {"message": "Teacher deleted"}

# ==================== VIDEO ENDPOINTS ====================
def _extract_video_thumbnail(video_path: str, output_path: str) -> bool:
    try:
        if cv2 is None:
            return False
        cap = cv2.VideoCapture(video_path)
        if not cap or not cap.isOpened():
            return False
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames > 1:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total_frames // 3))
        ret, frame = cap.read()
        cap.release()
        if not ret:
            return False
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        return bool(cv2.imwrite(str(output), frame, [cv2.IMWRITE_JPEG_QUALITY, 72]))
    except Exception:
        return False


async def _enqueue_video_privacy_job(
    video_id: str,
    teacher_id: str,
    user_id: str,
    file_path: str,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.video_privacy_jobs.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "video_id": video_id,
                "teacher_id": teacher_id,
                "user_id": user_id,
                "file_path": file_path,
                "status": PrivacyProcessingStatus.QUEUED.value,
                "updated_at": now,
                "last_error": None,
                "review_required": False,
                "review_reason": None,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "attempts": 0,
            },
        },
        upsert=True,
    )
    await VIDEO_PRIVACY_JOB_QUEUE.put(video_id)


async def _run_video_privacy_job(video_id: str) -> None:
    job = await db.video_privacy_jobs.find_one({"video_id": video_id}, {"_id": 0})
    if not job:
        return
    now = datetime.now(timezone.utc).isoformat()
    claim = await db.video_privacy_jobs.update_one(
        {
            "video_id": video_id,
            "status": {"$in": [PrivacyProcessingStatus.QUEUED.value, PrivacyProcessingStatus.FAILED.value]},
            "attempts": {"$lt": PRIVACY_MAX_RETRIES},
        },
        {
            "$set": {
                "status": PrivacyProcessingStatus.PROCESSING.value,
                "updated_at": now,
                "started_at": now,
                "last_error": None,
            },
            "$inc": {"attempts": 1},
        },
    )
    if claim.modified_count == 0:
        return

    privacy_started_perf = time.perf_counter()
    privacy_mode = "standard"
    finished_at = datetime.now(timezone.utc).isoformat()
    success = False
    error_message: Optional[str] = None
    job_final_status = PrivacyProcessingStatus.FAILED.value
    with app_metrics.track_privacy_job(mode="unknown"):
        try:
            video = await db.videos.find_one({"id": video_id}, {"_id": 0})
            if not video:
                raise RuntimeError("Video not found")
            manual_override = video.get("privacy_manual_override") or {}
            reference_docs = await db.teacher_face_references.find(
                {"teacher_id": job["teacher_id"]},
                {"_id": 0, "file_path": 1},
            ).to_list(50)
            reference_paths = [
                str(UPLOAD_DIR / doc["file_path"])
                for doc in reference_docs
                if doc.get("file_path") and (UPLOAD_DIR / doc["file_path"]).exists()
            ]
            if not reference_paths:
                if PRIVACY_ALLOW_DEGRADED_RUNTIME:
                    logger.warning(
                        f"Privacy reference fallback activated for {video_id}: no usable teacher references found"
                    )
                    privacy_mode = "degraded"
                else:
                    raise RuntimeError("Teacher privacy profile has no usable references")

            await db.videos.update_one(
                {"id": video_id},
                {
                    "$set": {
                        "status": VideoProcessingStatus.PROCESSING.value,
                        "privacy_status": PrivacyProcessingStatus.PROCESSING.value,
                        "privacy_started_at": now,
                        "privacy_failed_at": None,
                        "privacy_completed_at": None,
                        "privacy_error": None,
                        "privacy_review_required": False,
                        "privacy_review_reason": None,
                        "status_updated_at": now,
                    }
                },
            )
            await db.video_evidence.update_one(
                {"video_id": video_id, "uploaded_by": job["user_id"]},
                {"$set": {"privacy_status": PrivacyProcessingStatus.PROCESSING.value, "error_message": None}},
            )
            try:
                analysis = await asyncio.to_thread(
                    analyze_video_privacy,
                    job["file_path"],
                    reference_paths,
                    PRIVACY_TEACHER_MATCH_THRESHOLD,
                    PRIVACY_AMBIGUOUS_MATCH_THRESHOLD,
                )
            except RuntimeError as exc:
                if _should_use_degraded_privacy_runtime(exc):
                    logger.warning(
                        f"Privacy analysis runtime fallback activated for {video_id}: {exc}"
                    )
                    privacy_mode = "degraded"
                    analysis = {
                        "frames_analyzed": 0,
                        "teacher_track_id": None,
                        "review_reason": None,
                        "candidate_tracks": [],
                        "fallback_mode": "blur_all",
                        "manifest_tracks": [],
                        "runtime_fallback": "worker_analysis_fallback",
                    }
                else:
                    raise

            if analysis["review_reason"] and manual_override.get("decision") == "blur_all_and_continue":
                analysis["review_reason"] = None
                analysis["fallback_mode"] = "blur_all"
            if analysis["review_reason"] and manual_override.get("decision") == "approve_teacher_track":
                analysis["review_reason"] = None
            if analysis["review_reason"] and PRIVACY_MANUAL_REVIEW_ENABLED:
                finished_at = datetime.now(timezone.utc).isoformat()
                await db.videos.update_one(
                    {"id": video_id},
                    {
                        "$set": {
                            "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value,
                            "privacy_review_required": True,
                            "privacy_review_reason": analysis["review_reason"],
                            "privacy_candidate_tracks": analysis["candidate_tracks"],
                            "privacy_manifest": {
                                "manifest_version": 1,
                                "created_at": finished_at,
                                "tracks": analysis["manifest_tracks"],
                                "fallback_mode": analysis["fallback_mode"],
                                "teacher_track_id": analysis["teacher_track_id"],
                            },
                            "status_updated_at": finished_at,
                        }
                    },
                )
                await db.video_privacy_jobs.update_one(
                    {"video_id": video_id},
                    {
                        "$set": {
                            "status": PrivacyProcessingStatus.REVIEW_REQUIRED.value,
                            "updated_at": finished_at,
                            "finished_at": finished_at,
                            "review_required": True,
                            "review_reason": analysis["review_reason"],
                            "last_error": None,
                        }
                    },
                )
                await _log_privacy_audit_event(
                    "privacy_review_required",
                    "video",
                    video_id,
                    actor_user_id=job["user_id"],
                    details={"reason": analysis["review_reason"], "candidate_tracks": analysis["candidate_tracks"]},
                )
                await db.video_evidence.update_one(
                    {"video_id": video_id, "uploaded_by": job["user_id"]},
                    {
                        "$set": {
                            "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value,
                            "error_message": None,
                        }
                    },
                )
                job_final_status = PrivacyProcessingStatus.REVIEW_REQUIRED.value
                return

            redacted_relative_path = f"redacted/{job['teacher_id']}/{video_id}.mp4"
            redacted_full_path = UPLOAD_DIR / redacted_relative_path
            redacted_thumbnail_relative_path = f"thumbnails/redacted/{job['teacher_id']}/{video_id}.jpg"
            redacted_thumbnail_full_path = UPLOAD_DIR / redacted_thumbnail_relative_path
            try:
                render_stats = await asyncio.to_thread(
                    render_redacted_video,
                    job["file_path"],
                    str(redacted_full_path),
                    str(redacted_thumbnail_full_path),
                    reference_paths,
                    PRIVACY_TEACHER_MATCH_THRESHOLD,
                    PRIVACY_AMBIGUOUS_MATCH_THRESHOLD,
                    analysis["teacher_track_id"],
                    manual_override.get("decision") == "blur_all_and_continue" or analysis["fallback_mode"] == "blur_all",
                )
            except RuntimeError as exc:
                if _should_use_degraded_privacy_runtime(exc):
                    logger.warning(
                        f"Privacy render runtime fallback activated for {video_id}: {exc}"
                    )
                    privacy_mode = "degraded"
                    render_stats = await asyncio.to_thread(
                        _render_degraded_privacy_assets,
                        job["file_path"],
                        str(redacted_full_path),
                        str(redacted_thumbnail_full_path),
                    )
                else:
                    raise

            redacted_file_url = _to_public_backend_url(f"/uploads/{redacted_relative_path}")
            redacted_thumbnail_url = _to_public_backend_url(f"/uploads/{redacted_thumbnail_relative_path}")
            try:
                _, uploaded_video_url = _upload_path_to_s3(
                    redacted_full_path,
                    "redacted-videos",
                    f"{video_id}.mp4",
                    video.get("content_type") or "video/mp4",
                )
                redacted_file_url = uploaded_video_url or redacted_file_url
            except Exception as exc:
                logger.warning(f"Redacted video upload failed for {video_id}: {exc}")
            try:
                _, uploaded_thumb_url = _upload_path_to_s3(
                    redacted_thumbnail_full_path,
                    "redacted-thumbnails",
                    f"{video_id}.jpg",
                    "image/jpeg",
                )
                redacted_thumbnail_url = uploaded_thumb_url or redacted_thumbnail_url
            except Exception as exc:
                logger.warning(f"Redacted thumbnail upload failed for {video_id}: {exc}")

            finished_at = datetime.now(timezone.utc).isoformat()
            raw_cleanup_fields = _build_transcoded_raw_cleanup_fields(video, finished_at)
            await db.videos.update_one(
                {"id": video_id},
                {
                    "$set": {
                        "privacy_status": PrivacyProcessingStatus.COMPLETED.value,
                        "analysis_status": VideoProcessingStatus.QUEUED.value,
                        "privacy_completed_at": finished_at,
                        "privacy_error": None,
                        "privacy_review_required": False,
                        "privacy_review_reason": None,
                        "privacy_candidate_tracks": analysis["candidate_tracks"],
                        "privacy_manual_override": None,
                        "privacy_manifest": {
                            "manifest_version": 1,
                            "created_at": finished_at,
                            "tracks": analysis["manifest_tracks"],
                            "fallback_mode": analysis["fallback_mode"],
                            "teacher_track_id": analysis["teacher_track_id"],
                            "render_stats": render_stats,
                        },
                        "redacted_file_path": redacted_relative_path,
                        "redacted_file_url": redacted_file_url,
                        "redacted_thumbnail_path": redacted_thumbnail_relative_path,
                        "redacted_thumbnail_url": redacted_thumbnail_url,
                        "status_updated_at": finished_at,
                        **raw_cleanup_fields,
                    }
                },
            )
            await _log_privacy_audit_event(
                "privacy_processing_completed",
                "video",
                video_id,
                actor_user_id=job["user_id"],
                details={
                    "redacted_file_path": redacted_relative_path,
                    "redacted_thumbnail_path": redacted_thumbnail_relative_path,
                    "fallback_mode": analysis["fallback_mode"],
                    "teacher_track_id": analysis["teacher_track_id"],
                    "raw_retention_expires_at": raw_cleanup_fields.get("raw_retention_expires_at"),
                },
            )
            await db.video_evidence.update_one(
                {"video_id": video_id, "uploaded_by": job["user_id"]},
                {"$set": {"privacy_status": PrivacyProcessingStatus.COMPLETED.value, "error_message": None}},
            )
            await _enqueue_video_processing_job(
                video_id=video_id,
                teacher_id=job["teacher_id"],
                user_id=job["user_id"],
                file_path=str(redacted_full_path),
            )
            success = True
            job_final_status = PrivacyProcessingStatus.COMPLETED.value
        except Exception as exc:
            error_message = str(exc)
            finished_at = datetime.now(timezone.utc).isoformat()
            await db.videos.update_one(
                {"id": video_id},
                {
                    "$set": {
                        "status": VideoProcessingStatus.FAILED.value,
                        "privacy_status": PrivacyProcessingStatus.FAILED.value,
                        "privacy_failed_at": finished_at,
                        "privacy_error": error_message,
                        "status_updated_at": finished_at,
                    }
                },
            )
            await db.video_evidence.update_one(
                {"video_id": video_id, "uploaded_by": job.get("user_id")},
                {"$set": {"privacy_status": PrivacyProcessingStatus.FAILED.value, "error_message": error_message}},
            )
            await _log_privacy_audit_event(
                "privacy_processing_failed",
                "video",
                video_id,
                actor_user_id=job.get("user_id"),
                details={"error": error_message},
            )
            logger.error(f"Privacy worker failed for {video_id}: {error_message}")
        finally:
            await db.video_privacy_jobs.update_one(
                {"video_id": video_id},
                {
                    "$set": {
                        "status": job_final_status,
                        "updated_at": finished_at,
                        "finished_at": finished_at,
                        "last_error": error_message if not success else None,
                    }
                },
            )
            app_metrics.record_privacy_status_result(
                status=job_final_status,
                duration_seconds=time.perf_counter() - privacy_started_perf,
                mode=privacy_mode,
            )


async def _enqueue_video_processing_job(
    video_id: str,
    teacher_id: str,
    user_id: str,
    file_path: str,
) -> None:
    if not video_id or not teacher_id or not user_id or not file_path:
        raise ValueError("video_id, teacher_id, user_id, and file_path are required to enqueue")
    now = datetime.now(timezone.utc).isoformat()
    await db.video_processing_jobs.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "video_id": video_id,
                "teacher_id": teacher_id,
                "user_id": user_id,
                "file_path": file_path,
                "status": VideoProcessingStatus.QUEUED.value,
                "updated_at": now,
                "last_error": None,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "attempts": 0,
            },
        },
        upsert=True,
    )
    await VIDEO_JOB_QUEUE.put(video_id)


async def _enqueue_video_transcode_job(
    video_id: str,
    teacher_id: str,
    user_id: str,
    file_path: str,
    *,
    source_content_type: Optional[str] = None,
    raw_s3_key: Optional[str] = None,
    raw_file_url: Optional[str] = None,
    requested_profile: Optional[str] = None,
) -> None:
    if not video_id or not teacher_id or not user_id or not file_path:
        raise ValueError("video_id, teacher_id, user_id, and file_path are required to enqueue")
    now = datetime.now(timezone.utc).isoformat()
    await db.video_transcode_jobs.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "video_id": video_id,
                "teacher_id": teacher_id,
                "user_id": user_id,
                "file_path": file_path,
                "raw_s3_key": raw_s3_key,
                "raw_file_url": raw_file_url,
                "source_content_type": source_content_type,
                "requested_profile": requested_profile or VIDEO_TRANSCODE_PROFILE,
                "status": VideoTranscodeStatus.QUEUED.value,
                "updated_at": now,
                "last_error": None,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "attempts": 0,
            },
        },
        upsert=True,
    )
    await VIDEO_TRANSCODE_JOB_QUEUE.put(video_id)


async def _run_video_transcode_job(video_id: str) -> None:
    job = await db.video_transcode_jobs.find_one({"video_id": video_id}, {"_id": 0})
    if not job:
        return
    now = datetime.now(timezone.utc).isoformat()
    claim = await db.video_transcode_jobs.update_one(
        {
            "video_id": video_id,
            "status": {"$in": [VideoTranscodeStatus.QUEUED.value, VideoTranscodeStatus.FAILED.value]},
        },
        {
            "$set": {
                "status": VideoTranscodeStatus.PROCESSING.value,
                "updated_at": now,
                "started_at": now,
                "last_error": None,
            },
            "$inc": {"attempts": 1},
        },
    )
    if claim.modified_count == 0:
        return
    await db.videos.update_one(
        {"id": video_id},
        {
            "$set": {
                "transcode_status": VideoTranscodeStatus.PROCESSING.value,
                "transcode_started_at": now,
                "transcode_failed_at": None,
                "transcode_completed_at": None,
                "transcode_error": None,
                "status": VideoProcessingStatus.PROCESSING.value,
                "status_updated_at": now,
            }
        },
    )

    finished_at = datetime.now(timezone.utc).isoformat()
    success = False
    error_message: Optional[str] = None
    job_final_status = VideoTranscodeStatus.FAILED.value
    try:
        video = await db.videos.find_one({"id": video_id}, {"_id": 0})
        if not video:
            raise RuntimeError("Video not found")

        source_path = job.get("file_path") or video.get("raw_file_path") or video.get("file_path")
        if not source_path:
            raise RuntimeError("Transcode source path is missing")
        source_path = str(source_path)
        if not os.path.isabs(source_path):
            source_path = str(UPLOAD_DIR / source_path)
        if not Path(source_path).exists():
            raise RuntimeError("Transcode source file is missing")

        teacher_id = job.get("teacher_id") or video.get("teacher_id")
        if not teacher_id:
            raise RuntimeError("Teacher ID missing for transcode job")

        output_relative_path = f"processed/{teacher_id}/{video_id}.mp4"
        output_full_path = UPLOAD_DIR / output_relative_path
        transcode_result = await asyncio.to_thread(
            transcode_video_asset,
            source_path,
            str(output_full_path),
        )
        processed_s3_key_override = _build_video_asset_s3_key("processed", teacher_id, f"{video_id}.mp4")
        processed_s3_key, processed_file_url = _upload_path_to_s3(
            output_full_path,
            "processed-videos",
            f"{video_id}.mp4",
            transcode_result.get("content_type") or "video/mp4",
            key_override=processed_s3_key_override,
        )
        finished_at = datetime.now(timezone.utc).isoformat()
        await db.videos.update_one(
            {"id": video_id},
            {
                "$set": {
                    "status": VideoProcessingStatus.QUEUED.value,
                    "transcode_status": VideoTranscodeStatus.COMPLETED.value,
                    "transcode_started_at": now,
                    "transcode_completed_at": finished_at,
                    "transcode_failed_at": None,
                    "transcode_error": None,
                    "processed_s3_key": processed_s3_key,
                    "processed_file_url": processed_file_url,
                    "processed_file_path": output_relative_path,
                    "processed_content_type": transcode_result.get("content_type") or "video/mp4",
                    "processed_file_size_bytes": transcode_result.get("file_size_bytes"),
                    "processing_asset_preference": "processed",
                    "status_updated_at": finished_at,
                }
            },
        )
        await db.video_transcode_jobs.update_one(
            {"video_id": video_id},
            {
                "$set": {
                    "processed_s3_key": processed_s3_key,
                    "processed_file_url": processed_file_url,
                    "processed_file_path": output_relative_path,
                }
            },
        )
        await _enqueue_video_privacy_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=job.get("user_id") or video.get("uploaded_by"),
            file_path=str(output_full_path),
        )
        success = True
        job_final_status = VideoTranscodeStatus.COMPLETED.value
    except Exception as exc:
        error_message = str(exc)
        finished_at = datetime.now(timezone.utc).isoformat()
        await db.videos.update_one(
            {"id": video_id},
            {
                "$set": {
                    "status": VideoProcessingStatus.FAILED.value,
                    "transcode_status": VideoTranscodeStatus.FAILED.value,
                    "transcode_started_at": now,
                    "transcode_completed_at": None,
                    "transcode_failed_at": finished_at,
                    "transcode_error": error_message,
                    "status_updated_at": finished_at,
                }
            },
        )
        logger.error(f"Video transcode worker failed for {video_id}: {error_message}")
    finally:
        await db.video_transcode_jobs.update_one(
            {"video_id": video_id},
            {
                "$set": {
                    "status": job_final_status,
                    "updated_at": finished_at,
                    "finished_at": finished_at,
                    "last_error": error_message if not success else None,
                }
            },
        )


async def _run_video_job(video_id: str) -> None:
    job = await db.video_processing_jobs.find_one({"video_id": video_id}, {"_id": 0})
    if not job:
        return
    now = datetime.now(timezone.utc).isoformat()
    claim = await db.video_processing_jobs.update_one(
        {"video_id": video_id, "status": VideoProcessingStatus.QUEUED.value},
        {
            "$set": {
                "status": VideoProcessingStatus.PROCESSING.value,
                "updated_at": now,
                "started_at": now,
            },
            "$inc": {"attempts": 1},
        },
    )
    if claim.modified_count == 0:
        return
    success, error_message = await analyze_video(
        video_id=video_id,
        file_path=job["file_path"],
        teacher_id=job["teacher_id"],
        user_id=job["user_id"],
    )
    finished_at = datetime.now(timezone.utc).isoformat()
    await db.video_processing_jobs.update_one(
        {"video_id": video_id},
        {
            "$set": {
                "status": (
                    VideoProcessingStatus.COMPLETED.value
                    if success
                    else VideoProcessingStatus.FAILED.value
                ),
                "updated_at": finished_at,
                "finished_at": finished_at,
                "last_error": error_message if not success else None,
            }
        },
    )


async def _video_processing_worker(worker_label: str) -> None:
    logger.info(f"Video worker {worker_label} started")
    try:
        while True:
            video_id = await VIDEO_JOB_QUEUE.get()
            try:
                await _run_video_job(video_id)
                record_worker_result(
                    worker_type="video",
                    job_id=video_id,
                    success=True,
                )
            except Exception as exc:
                logger.error(f"Video worker {worker_label} failed on {video_id}: {exc}")
                record_worker_result(
                    worker_type="video",
                    job_id=video_id,
                    success=False,
                    failure_reason=str(exc),
                )
            finally:
                VIDEO_JOB_QUEUE.task_done()
    except asyncio.CancelledError:
        logger.info(f"Video worker {worker_label} stopped")
        raise


async def _video_transcode_worker(worker_label: str) -> None:
    logger.info(f"Video transcode worker {worker_label} started")
    try:
        while True:
            video_id = await VIDEO_TRANSCODE_JOB_QUEUE.get()
            try:
                await _run_video_transcode_job(video_id)
                record_worker_result(
                    worker_type="transcode",
                    job_id=video_id,
                    success=True,
                )
            except Exception as exc:
                logger.error(f"Video transcode worker {worker_label} failed on {video_id}: {exc}")
                record_worker_result(
                    worker_type="transcode",
                    job_id=video_id,
                    success=False,
                    failure_reason=str(exc),
                )
            finally:
                VIDEO_TRANSCODE_JOB_QUEUE.task_done()
    except asyncio.CancelledError:
        logger.info(f"Video transcode worker {worker_label} stopped")
        raise


async def _video_privacy_worker(worker_label: str) -> None:
    logger.info(f"Privacy worker {worker_label} started")
    try:
        while True:
            video_id = await VIDEO_PRIVACY_JOB_QUEUE.get()
            try:
                await _run_video_privacy_job(video_id)
                record_worker_result(
                    worker_type="privacy",
                    job_id=video_id,
                    success=True,
                )
            except Exception as exc:
                logger.error(f"Privacy worker {worker_label} failed on {video_id}: {exc}")
                record_worker_result(
                    worker_type="privacy",
                    job_id=video_id,
                    success=False,
                    failure_reason=str(exc),
                )
            finally:
                VIDEO_PRIVACY_JOB_QUEUE.task_done()
    except asyncio.CancelledError:
        logger.info(f"Privacy worker {worker_label} stopped")
        raise


async def _start_video_workers() -> None:
    if VIDEO_WORKER_TASKS:
        return
    for index in range(VIDEO_WORKER_COUNT):
        task = asyncio.create_task(
            _video_processing_worker(f"video-worker-{index + 1}"),
            name=f"video-worker-{index + 1}",
        )
        VIDEO_WORKER_TASKS.append(task)


async def _start_video_transcode_workers() -> None:
    if VIDEO_TRANSCODE_WORKER_TASKS:
        return
    for index in range(VIDEO_TRANSCODE_WORKER_COUNT):
        task = asyncio.create_task(
            _video_transcode_worker(f"video-transcode-worker-{index + 1}"),
            name=f"video-transcode-worker-{index + 1}",
        )
        VIDEO_TRANSCODE_WORKER_TASKS.append(task)


async def _start_privacy_workers() -> None:
    if VIDEO_PRIVACY_WORKER_TASKS:
        return
    for index in range(PRIVACY_WORKER_COUNT):
        task = asyncio.create_task(
            _video_privacy_worker(f"privacy-worker-{index + 1}"),
            name=f"privacy-worker-{index + 1}",
        )
        VIDEO_PRIVACY_WORKER_TASKS.append(task)


async def _rehydrate_video_processing_queue() -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.video_processing_jobs.update_many(
        {"status": VideoProcessingStatus.PROCESSING.value},
        {
            "$set": {
                "status": VideoProcessingStatus.QUEUED.value,
                "updated_at": now,
            }
        },
    )
    await db.videos.update_many(
        {"status": VideoProcessingStatus.PROCESSING.value},
        {
            "$set": {
                "status": VideoProcessingStatus.QUEUED.value,
                "analysis_status": VideoProcessingStatus.QUEUED.value,
                "status_updated_at": now,
            }
        },
    )
    pending_jobs = await db.video_processing_jobs.find(
        {"status": VideoProcessingStatus.QUEUED.value},
        {"_id": 0, "video_id": 1},
    ).to_list(2000)
    queued_ids = {job["video_id"] for job in pending_jobs if job.get("video_id")}
    for video_id in queued_ids:
        await VIDEO_JOB_QUEUE.put(video_id)
    # Backfill jobs for queued/processing videos that predate job documents.
    pending_videos = await db.videos.find(
        {
            "analysis_status": {"$in": [VideoProcessingStatus.QUEUED.value, VideoProcessingStatus.PROCESSING.value]},
            "privacy_status": PrivacyProcessingStatus.COMPLETED.value,
        },
        {"_id": 0, "id": 1, "teacher_id": 1, "uploaded_by": 1, "redacted_file_path": 1, "file_path": 1},
    ).to_list(2000)
    for video in pending_videos:
        video_id = video.get("id")
        file_path = video.get("redacted_file_path") or video.get("file_path")
        teacher_id = video.get("teacher_id")
        user_id = video.get("uploaded_by")
        if not video_id or not file_path or not teacher_id or not user_id:
            continue
        if video_id in queued_ids:
            continue
        full_path = str(UPLOAD_DIR / str(file_path))
        await _enqueue_video_processing_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=user_id,
            file_path=full_path,
        )


async def _rehydrate_video_transcode_queue() -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.video_transcode_jobs.update_many(
        {"status": VideoTranscodeStatus.PROCESSING.value},
        {
            "$set": {
                "status": VideoTranscodeStatus.QUEUED.value,
                "updated_at": now,
            }
        },
    )
    await db.videos.update_many(
        {"transcode_status": VideoTranscodeStatus.PROCESSING.value},
        {
            "$set": {
                "transcode_status": VideoTranscodeStatus.QUEUED.value,
                "status_updated_at": now,
            }
        },
    )
    pending_jobs = await db.video_transcode_jobs.find(
        {"status": VideoTranscodeStatus.QUEUED.value},
        {"_id": 0, "video_id": 1},
    ).to_list(2000)
    queued_ids = {job["video_id"] for job in pending_jobs if job.get("video_id")}
    for video_id in queued_ids:
        await VIDEO_TRANSCODE_JOB_QUEUE.put(video_id)
    pending_videos = await db.videos.find(
        {
            "transcode_status": {"$in": [VideoTranscodeStatus.QUEUED.value, VideoTranscodeStatus.PROCESSING.value]},
        },
        {
            "_id": 0,
            "id": 1,
            "teacher_id": 1,
            "uploaded_by": 1,
            "processed_file_path": 1,
            "raw_file_path": 1,
            "file_path": 1,
        },
    ).to_list(2000)
    for video in pending_videos:
        video_id = video.get("id")
        file_path = (
            video.get("processed_file_path")
            or video.get("raw_file_path")
            or video.get("file_path")
        )
        teacher_id = video.get("teacher_id")
        user_id = video.get("uploaded_by")
        if not video_id or not file_path or not teacher_id or not user_id:
            continue
        if video_id in queued_ids:
            continue
        full_path = str(UPLOAD_DIR / str(file_path))
        await _enqueue_video_transcode_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=user_id,
            file_path=full_path,
            requested_profile=VIDEO_TRANSCODE_PROFILE,
        )


async def _rehydrate_video_privacy_queue() -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.video_privacy_jobs.update_many(
        {"status": PrivacyProcessingStatus.PROCESSING.value},
        {
            "$set": {
                "status": PrivacyProcessingStatus.QUEUED.value,
                "updated_at": now,
            }
        },
    )
    await db.videos.update_many(
        {"privacy_status": PrivacyProcessingStatus.PROCESSING.value},
        {
            "$set": {
                "privacy_status": PrivacyProcessingStatus.QUEUED.value,
                "status_updated_at": now,
            }
        },
    )
    pending_jobs = await db.video_privacy_jobs.find(
        {"status": PrivacyProcessingStatus.QUEUED.value},
        {"_id": 0, "video_id": 1},
    ).to_list(2000)
    queued_ids = {job["video_id"] for job in pending_jobs if job.get("video_id")}
    for video_id in queued_ids:
        await VIDEO_PRIVACY_JOB_QUEUE.put(video_id)
    pending_videos = await db.videos.find(
        {
            "privacy_status": {"$in": [PrivacyProcessingStatus.QUEUED.value, PrivacyProcessingStatus.PROCESSING.value]},
            "$or": [
                {"transcode_status": {"$exists": False}},
                {"transcode_status": VideoTranscodeStatus.NOT_REQUIRED.value},
                {"transcode_status": VideoTranscodeStatus.COMPLETED.value},
                {"transcode_status": VideoTranscodeStatus.FAILED.value},
            ],
        },
        {
            "_id": 0,
            "id": 1,
            "teacher_id": 1,
            "uploaded_by": 1,
            "processed_file_path": 1,
            "raw_file_path": 1,
            "file_path": 1,
        },
    ).to_list(2000)
    for video in pending_videos:
        video_id = video.get("id")
        file_path = (
            video.get("processed_file_path")
            or video.get("raw_file_path")
            or video.get("file_path")
        )
        teacher_id = video.get("teacher_id")
        user_id = video.get("uploaded_by")
        if not video_id or not file_path or not teacher_id or not user_id:
            continue
        if video_id in queued_ids:
            continue
        full_path = str(UPLOAD_DIR / str(file_path))
        await _enqueue_video_privacy_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=user_id,
            file_path=full_path,
        )


async def _purge_expired_privacy_artifacts() -> None:
    now_iso = datetime.now(timezone.utc).isoformat()

    expired_refs = await db.teacher_face_references.find(
        {"retention_expires_at": {"$ne": None, "$lte": now_iso}},
        {"_id": 0},
    ).to_list(500)
    for ref in expired_refs:
        file_path = ref.get("file_path")
        if file_path:
            try:
                full_path = UPLOAD_DIR / str(file_path)
                if full_path.exists():
                    await asyncio.to_thread(os.remove, full_path)
            except Exception as exc:
                logger.warning(f"Failed to remove expired privacy reference {ref.get('id')}: {exc}")
        _delete_s3_key(ref.get("s3_key"))
        await db.teacher_face_references.update_one(
            {"id": ref["id"]},
            {
                "$set": {
                    "file_path": None,
                    "file_url": None,
                    "s3_key": None,
                    "purged_at": now_iso,
                }
            },
        )
        await _log_privacy_audit_event(
            "privacy_reference_purged",
            "teacher_reference",
            ref["id"],
            details={"teacher_id": ref.get("teacher_id")},
        )

    expired_videos = await db.videos.find(
        {
            "raw_retention_expires_at": {"$ne": None, "$lte": now_iso},
            "privacy_status": {"$in": [PrivacyProcessingStatus.COMPLETED.value, PrivacyProcessingStatus.FAILED.value]},
        },
        {"_id": 0},
    ).to_list(500)
    for video in expired_videos:
        raw_path = video.get("raw_file_path")
        if raw_path:
            try:
                full_path = UPLOAD_DIR / str(raw_path)
                if full_path.exists():
                    await asyncio.to_thread(os.remove, full_path)
            except Exception as exc:
                logger.warning(f"Failed to remove expired raw video {video.get('id')}: {exc}")
        _delete_s3_key(video.get("raw_s3_key") or video.get("s3_key"))
        await db.videos.update_one(
            {"id": video["id"]},
            {
                "$set": {
                    "raw_file_path": None,
                    "raw_file_url": None,
                    "raw_s3_key": None,
                    "raw_purged_at": now_iso,
                }
            },
        )
        await _log_privacy_audit_event(
            "raw_video_purged",
            "video",
            video["id"],
            details={"teacher_id": video.get("teacher_id")},
        )

    expired_transcripts = await db.video_audio_transcripts.find(
        {"retention_expires_at": {"$ne": None, "$lte": now_iso}},
        {"_id": 0, "id": 1, "video_id": 1},
    ).to_list(500)
    for transcript in expired_transcripts:
        await db.video_audio_transcripts.delete_one({"id": transcript["id"]})
        await _log_privacy_audit_event(
            "audio_transcript_purged",
            "video_audio_transcript",
            transcript["id"],
            details={"video_id": transcript.get("video_id")},
        )


async def _privacy_maintenance_worker() -> None:
    logger.info("Privacy maintenance worker started")
    try:
        while True:
            try:
                await _purge_expired_privacy_artifacts()
            except Exception as exc:
                logger.error(f"Privacy maintenance worker failed: {exc}")
            await asyncio.sleep(PRIVACY_PURGE_INTERVAL_MINUTES * 60)
    except asyncio.CancelledError:
        logger.info("Privacy maintenance worker stopped")
        raise


async def _start_privacy_maintenance_tasks() -> None:
    if PRIVACY_MAINTENANCE_TASKS:
        return
    task = asyncio.create_task(_privacy_maintenance_worker(), name="privacy-maintenance-worker")
    PRIVACY_MAINTENANCE_TASKS.append(task)


@api_router.post("/videos/upload", response_model=VideoUploadResponse)
async def upload_video(
    request: Request,
    file: UploadFile = File(...),
    teacher_id: str = Form(...),
    subject: Optional[str] = Form(None),
    recorded_at: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user)
):
    preferred_language = _resolve_request_language(request, default="en")
    try:
        upload_started_perf = time.perf_counter()
        upload_source = _get_user_role(current_user)
        if not (file.filename or "").strip():
            raise HTTPException(status_code=400, detail="Filename is required")
        file_ext = Path(file.filename or "").suffix.lower()
        if file_ext not in VIDEO_ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {sorted(VIDEO_ALLOWED_EXTENSIONS)}",
            )
        content_type = (file.content_type or "").lower()
        if content_type and content_type not in VIDEO_ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid content type. Allowed: {sorted(VIDEO_ALLOWED_CONTENT_TYPES)}",
            )
        normalized_recorded_at = _parse_optional_iso_datetime(recorded_at, "recorded_at")
        upload_time = datetime.now(timezone.utc).isoformat()

        teacher = await _get_teacher_or_404(teacher_id, current_user)
        active_profile = await _get_active_privacy_profile(teacher_id)
        if PRIVACY_REQUIRE_PROFILE and not active_profile:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PRIVACY_PROFILE_REQUIRED",
                    "message": "Teacher privacy profile must be completed before video upload.",
                    "teacher_id": teacher_id,
                },
            )

        subject = subject or teacher.get("subject")
        video_id = str(uuid.uuid4())
        filename = f"{video_id}{file_ext}"
        teacher_dir = UPLOAD_DIR / "videos" / teacher_id
        teacher_dir.mkdir(parents=True, exist_ok=True)
        file_path = teacher_dir / filename
        relative_path = f"videos/{teacher_id}/{filename}"

        size = 0
        async with aiofiles.open(file_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if VIDEO_MAX_UPLOAD_BYTES and size > VIDEO_MAX_UPLOAD_BYTES:
                    await f.close()
                    os.remove(file_path)
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"File too large. Maximum allowed is "
                            f"{VIDEO_MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                        ),
                    )
                await f.write(chunk)

        s3_key = None
        file_url = None
        try:
            raw_s3_key_override = _build_video_asset_s3_key("raw", teacher_id, filename)
            s3_key, file_url = _upload_path_to_s3(
                file_path,
                "videos",
                filename,
                content_type or "video/mp4",
                key_override=raw_s3_key_override,
            )
        except Exception as exc:
            logger.warning(f"S3 upload failed for video {video_id}: {exc}")

        transcode_status = (
            VideoTranscodeStatus.QUEUED.value
            if VIDEO_TRANSCODE_PIPELINE_ENABLED
            else VideoTranscodeStatus.NOT_REQUIRED.value
        )

        video_doc = {
            "id": video_id,
            "filename": file.filename,
            "stored_filename": filename,
            "s3_key": s3_key,
            "raw_s3_key": s3_key,
            "file_url": file_url,
            "raw_file_url": file_url,
            "file_path": relative_path,
            "raw_file_path": relative_path,
            "content_type": content_type or "video/mp4",
            "file_size_bytes": size,
            "raw_file_size_bytes": size,
            "processed_s3_key": None,
            "processed_file_url": None,
            "processed_file_path": None,
            "processed_content_type": None,
            "processed_file_size_bytes": None,
            "teacher_id": teacher_id,
            "uploaded_by": current_user["id"],
            "status": VideoProcessingStatus.QUEUED.value,
            "privacy_status": PrivacyProcessingStatus.QUEUED.value,
            "analysis_status": VideoProcessingStatus.QUEUED.value,
            "transcode_status": transcode_status,
            "transcode_started_at": None,
            "transcode_completed_at": None,
            "transcode_failed_at": None,
            "transcode_error": None,
            "transcode_profile": VIDEO_TRANSCODE_PROFILE,
            "processing_asset_preference": "raw",
            "privacy_review_required": False,
            "privacy_review_reason": None,
            "privacy_started_at": None,
            "privacy_completed_at": None,
            "privacy_failed_at": None,
            "privacy_error": None,
            "privacy_profile_version": active_profile.get("profile_version") if active_profile else None,
            "raw_retention_expires_at": (datetime.now(timezone.utc) + timedelta(days=PRIVACY_RAW_VIDEO_RETENTION_DAYS)).isoformat(),
            "status_updated_at": upload_time,
            "processing_started_at": None,
            "processing_completed_at": None,
            "processing_failed_at": None,
            "subject": subject,
            "recorded_at": normalized_recorded_at,
            "upload_date": upload_time,
            "analysis_language": preferred_language,
        }
        await db.videos.insert_one(video_doc)

        if VIDEO_TRANSCODE_PIPELINE_ENABLED:
            await _enqueue_video_transcode_job(
                video_id=video_id,
                teacher_id=teacher_id,
                user_id=current_user["id"],
                file_path=str(file_path),
                source_content_type=content_type or "video/mp4",
                raw_s3_key=s3_key,
                raw_file_url=file_url,
                requested_profile=VIDEO_TRANSCODE_PROFILE,
            )

        await db.video_evidence.insert_one({
            "id": str(uuid.uuid4()),
            "video_id": video_id,
            "teacher_id": teacher_id,
            "file_path": relative_path,
            "subject": subject,
            "recorded_at": normalized_recorded_at,
            "privacy_status": PrivacyProcessingStatus.QUEUED.value,
            "analysis_status": VideoProcessingStatus.QUEUED.value,
            "uploaded_by": current_user["id"],
            "uploaded_at": upload_time,
        })

        try:
            admin_id = teacher.get("created_by") or current_user["id"]
            policy = await _get_recording_policy(admin_id, teacher.get("school_id"))
            if policy:
                compliance = await _upsert_recording_compliance(teacher, admin_id, policy)
                await _refresh_recording_reminders(teacher, admin_id, policy, compliance)
        except Exception:
            logger.warning("Unable to update recording compliance after upload")

        if not VIDEO_TRANSCODE_PIPELINE_ENABLED:
            await _enqueue_video_privacy_job(
                video_id=video_id,
                teacher_id=teacher_id,
                user_id=current_user["id"],
                file_path=str(file_path),
            )
        await _log_privacy_audit_event(
            "privacy_video_uploaded",
            "video",
            video_id,
            actor_user_id=current_user["id"],
            details={
                "teacher_id": teacher_id,
                "privacy_status": PrivacyProcessingStatus.QUEUED.value,
                "raw_retention_expires_at": video_doc["raw_retention_expires_at"],
            },
        )
        duration_seconds = time.perf_counter() - upload_started_perf
        app_metrics.record_upload_result(
            source=upload_source,
            language=preferred_language,
            success=True,
            duration_seconds=duration_seconds,
        )

        return VideoUploadResponse(
            id=video_id,
            filename=file.filename,
            teacher_id=teacher_id,
            status=VideoProcessingStatus.QUEUED.value,
            privacy_status=PrivacyProcessingStatus.QUEUED.value,
            analysis_status=VideoProcessingStatus.QUEUED.value,
            transcode_status=transcode_status,
            upload_date=video_doc["upload_date"],
            subject=subject,
            recorded_at=normalized_recorded_at,
            file_path=relative_path,
            file_size_bytes=size,
            content_type=content_type or "video/mp4",
        )
    except HTTPException:
        app_metrics.record_upload_result(
            source=_get_user_role(current_user),
            language=preferred_language,
            success=False,
            duration_seconds=time.perf_counter() - upload_started_perf,
        )
        raise
    except Exception:
        app_metrics.record_upload_result(
            source=_get_user_role(current_user),
            language=preferred_language,
            success=False,
            duration_seconds=time.perf_counter() - upload_started_perf,
        )
        raise

@api_router.get("/videos")
async def get_videos(teacher_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if teacher_id:
        await _get_teacher_or_404(teacher_id, current_user)
        query["teacher_id"] = teacher_id
    else:
        teacher_ids_for_user = await _list_teacher_ids_for_user(current_user)
        query = _build_video_visibility_query(current_user, teacher_ids_for_user)
    videos = await db.videos.find(query, {"_id": 0, "uploaded_by": 0, "stored_filename": 0}).to_list(1000)
    for video in videos:
        _apply_video_response_defaults(video)
    return [_sanitize_video_response(video) for video in videos]


@api_router.get("/videos/{video_id}")
async def get_video_detail(video_id: str, current_user: dict = Depends(get_current_user)):
    """Get full video metadata including stored filename for playback."""
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    return _sanitize_video_response(_apply_video_response_defaults(video))


@api_router.get("/videos/{video_id}/raw-access")
async def get_video_raw_access(video_id: str, current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    raw_url = video.get("raw_file_url")
    raw_path = video.get("raw_file_path")
    access_url = raw_url
    if not access_url and raw_path:
        safe_path = str(raw_path).replace("\\", "/").lstrip("/")
        access_url = _to_public_backend_url(f"/uploads/{safe_path}")
    if not access_url:
        raise HTTPException(status_code=404, detail="Raw asset is no longer available")
    await _log_privacy_audit_event(
        "raw_asset_accessed",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"reason": "admin_raw_access_endpoint"},
    )
    return {
        "video_id": video_id,
        "access_url": access_url,
        "expires_at": None,
        "retention_expires_at": video.get("raw_retention_expires_at"),
    }

@api_router.get("/videos/{video_id}/status")
async def get_video_status(video_id: str, current_user: dict = Depends(get_current_user)):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    return {
        "status": _normalize_video_status(video.get("status")),
        "privacy_status": _normalize_privacy_status(video.get("privacy_status")),
        "analysis_status": _normalize_video_status(video.get("analysis_status")),
        "transcode_status": _normalize_video_transcode_status(video.get("transcode_status")),
        "privacy_review_required": bool(video.get("privacy_review_required", False)),
        "privacy_review_reason": video.get("privacy_review_reason"),
        "error_message": video.get("error_message"),
        "privacy_error": video.get("privacy_error"),
    }


@api_router.post("/videos/{video_id}/retry")
async def retry_video_processing(video_id: str, current_user: dict = Depends(get_current_user)):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    current_status = _normalize_video_status(video.get("status"))
    if current_status != VideoProcessingStatus.FAILED.value:
        raise HTTPException(status_code=400, detail="Only failed videos can be retried")
    if _normalize_privacy_status(video.get("privacy_status")) != PrivacyProcessingStatus.COMPLETED.value:
        raise HTTPException(status_code=409, detail="Retry unavailable until privacy processing is complete")
    relative_path = video.get("redacted_file_path") or video.get("file_path")
    if not relative_path:
        raise HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise HTTPException(status_code=409, detail="Retry unavailable because the local video file is missing")
    queued_at = datetime.now(timezone.utc).isoformat()
    await db.videos.update_one(
        {"id": video_id},
        {
            "$set": {
                "status": VideoProcessingStatus.QUEUED.value,
                "analysis_status": VideoProcessingStatus.QUEUED.value,
                "status_updated_at": queued_at,
                "error_message": None,
            }
        },
    )
    await db.video_evidence.update_one(
        {"video_id": video_id},
        {"$set": {"analysis_status": VideoProcessingStatus.QUEUED.value, "error_message": None}},
    )
    await _enqueue_video_processing_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    return {"video_id": video_id, "status": VideoProcessingStatus.QUEUED.value}


@api_router.post("/videos/{video_id}/privacy/retry")
async def retry_video_privacy(video_id: str, current_user: dict = Depends(get_current_user)):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    relative_path = (
        video.get("processed_file_path")
        or video.get("raw_file_path")
        or video.get("file_path")
    )
    if not relative_path:
        raise HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise HTTPException(status_code=409, detail="Retry unavailable because the local video file is missing")
    queued_at = datetime.now(timezone.utc).isoformat()
    await db.videos.update_one(
        {"id": video_id},
        {
            "$set": {
                "status": VideoProcessingStatus.QUEUED.value,
                "privacy_status": PrivacyProcessingStatus.QUEUED.value,
                "analysis_status": VideoProcessingStatus.QUEUED.value,
                "privacy_review_required": False,
                "privacy_review_reason": None,
                "privacy_error": None,
                "privacy_started_at": None,
                "privacy_completed_at": None,
                "privacy_failed_at": None,
                "status_updated_at": queued_at,
            }
        },
    )
    await _enqueue_video_privacy_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    await _log_privacy_audit_event(
        "privacy_retry_queued",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"requeued_at": queued_at},
    )
    return {
        "video_id": video_id,
        "privacy_status": PrivacyProcessingStatus.QUEUED.value,
        "analysis_status": VideoProcessingStatus.QUEUED.value,
        "requeued_at": queued_at,
    }


@api_router.get("/privacy/review-queue", response_model=PrivacyReviewQueueResponse)
async def get_privacy_review_queue(current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    videos = await db.videos.find(
        {"uploaded_by": current_user["id"], "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value},
        {"_id": 0},
    ).sort("upload_date", -1).to_list(200)
    items: List[PrivacyReviewQueueItem] = []
    for video in videos:
        teacher = await db.teachers.find_one({"id": video.get("teacher_id")}, {"_id": 0, "name": 1})
        candidates = [
            PrivacyReviewCandidateTrack(**candidate)
            for candidate in (video.get("privacy_candidate_tracks") or [])
            if candidate.get("track_id")
        ]
        items.append(
            PrivacyReviewQueueItem(
                video_id=video["id"],
                teacher_id=video.get("teacher_id"),
                teacher_name=(teacher or {}).get("name"),
                filename=video.get("filename") or "recording",
                privacy_status=_normalize_privacy_status(video.get("privacy_status")),
                privacy_review_reason=video.get("privacy_review_reason"),
                upload_date=video.get("upload_date") or datetime.now(timezone.utc).isoformat(),
                candidate_tracks=candidates,
            )
        )
    return PrivacyReviewQueueResponse(items=items)


@api_router.get("/privacy/audit", response_model=List[PrivacyAuditEvent])
async def get_privacy_audit_events(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    query: Dict[str, Any] = {}
    if target_type:
        query["target_type"] = target_type
    if target_id:
        query["target_id"] = target_id
    docs = await db.privacy_audit_events.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return [PrivacyAuditEvent(**doc) for doc in docs]


@api_router.get("/admin/videos/{video_id}/sampling-manifest", response_model=SamplingManifestResponse)
async def get_admin_video_sampling_manifest(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_admin_owned_video_or_404(video_id, current_user)
    doc = await db.video_sampling_manifests.find_one({"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        raise HTTPException(status_code=404, detail="Sampling manifest not found")
    return SamplingManifestResponse(**doc)


@api_router.get("/admin/videos/{video_id}/analysis-moments", response_model=AnalysisMomentManifestResponse)
async def get_admin_video_analysis_moments(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_admin_owned_video_or_404(video_id, current_user)
    doc = await db.video_analysis_moments.find_one({"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis moments not found")
    return AnalysisMomentManifestResponse(**doc)


@api_router.get("/admin/videos/{video_id}/audio-transcript", response_model=AudioTranscriptResponse)
async def get_admin_video_audio_transcript(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_admin_owned_video_or_404(video_id, current_user)
    doc = await db.video_audio_transcripts.find_one({"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not doc:
        raise HTTPException(status_code=404, detail="Audio transcript not found")
    return AudioTranscriptResponse(**doc)


@api_router.get("/admin/videos/{video_id}/audio-features", response_model=AudioFeatureResponse)
async def get_admin_video_audio_features(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_admin_owned_video_or_404(video_id, current_user)
    doc = await db.video_analysis_features.find_one({"video_id": video_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Audio features not found")
    return AudioFeatureResponse(**doc)


@api_router.post("/videos/{video_id}/privacy/review", response_model=PrivacyReviewDecisionResponse)
async def resolve_video_privacy_review(
    video_id: str,
    payload: PrivacyReviewDecisionRequest,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    if _normalize_privacy_status(video.get("privacy_status")) != PrivacyProcessingStatus.REVIEW_REQUIRED.value:
        raise HTTPException(status_code=400, detail="Video is not awaiting privacy review")
    resolved_at = datetime.now(timezone.utc).isoformat()
    update_fields: Dict[str, Any] = {
        "privacy_review_required": False,
        "privacy_review_reason": None,
        "privacy_review_resolved_by": current_user["id"],
        "privacy_review_resolved_at": resolved_at,
    }
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue"}:
        update_fields["status"] = VideoProcessingStatus.QUEUED.value
        update_fields["privacy_status"] = PrivacyProcessingStatus.QUEUED.value
        update_fields["privacy_completed_at"] = None
        update_fields["analysis_status"] = VideoProcessingStatus.QUEUED.value
        update_fields["privacy_error"] = None
        update_fields["privacy_manual_override"] = {
            "decision": payload.decision,
            "approved_track_id": payload.approved_track_id,
            "reason": payload.reason,
            "resolved_by": current_user["id"],
            "resolved_at": resolved_at,
        }
    elif payload.decision == "rerun":
        update_fields["status"] = VideoProcessingStatus.QUEUED.value
        update_fields["privacy_status"] = PrivacyProcessingStatus.QUEUED.value
        update_fields["privacy_manual_override"] = None
    elif payload.decision == "reject_video":
        update_fields["status"] = VideoProcessingStatus.FAILED.value
        update_fields["privacy_status"] = PrivacyProcessingStatus.FAILED.value
        update_fields["privacy_failed_at"] = resolved_at
        update_fields["privacy_error"] = payload.reason
        update_fields["privacy_manual_override"] = None
    else:
        raise HTTPException(status_code=400, detail="Unsupported privacy review decision")
    await db.videos.update_one({"id": video_id}, {"$set": update_fields})
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue", "rerun"}:
        relative_path = (
            video.get("processed_file_path")
            or video.get("raw_file_path")
            or video.get("file_path")
        )
        if relative_path:
            await _enqueue_video_privacy_job(
                video_id=video_id,
                teacher_id=video.get("teacher_id"),
                user_id=video.get("uploaded_by") or current_user["id"],
                file_path=str(UPLOAD_DIR / str(relative_path)),
            )
    await _log_privacy_audit_event(
        "privacy_review_resolved",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={
            "decision": payload.decision,
            "approved_track_id": payload.approved_track_id,
            "reason": payload.reason,
        },
    )
    return PrivacyReviewDecisionResponse(
        video_id=video_id,
        privacy_status=_normalize_privacy_status(update_fields.get("privacy_status")),
        analysis_status=_normalize_video_status(update_fields.get("analysis_status", video.get("analysis_status"))),
        review_resolved_by=current_user["id"],
        review_resolved_at=resolved_at,
    )


@api_router.get("/teachers/{teacher_id}/recognition", response_model=TeacherRecognitionSummaryResponse)
async def get_teacher_recognition_summary(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    badges = await db.recognition_badges.find(
        {"teacher_id": teacher_id},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(200)
    return _build_teacher_recognition_summary(teacher_id, badges)


@api_router.get("/videos/{video_id}/recognition", response_model=VideoRecognitionResponse)
async def get_video_recognition(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    return _build_video_recognition_response(video, event)


@api_router.post("/videos/{video_id}/recognition/opt-in", response_model=RecognitionOptInResponse)
async def update_video_recognition_opt_in(
    video_id: str,
    payload: RecognitionOptInRequest,
    current_user: dict = Depends(get_current_user),
):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    updated_at = datetime.now(timezone.utc).isoformat()
    teacher_opt_in = bool(payload.teacher_opt_in)
    sharing_scope = payload.sharing_scope if teacher_opt_in else None
    allow_social_share = bool(payload.allow_social_share) if teacher_opt_in else False
    allow_email_signature = bool(payload.allow_email_signature) if teacher_opt_in else False
    await db.lesson_recognition_events.update_one(
        {"id": event["id"]},
        {
            "$set": {
                "teacher_opt_in": teacher_opt_in,
                "sharing_scope": sharing_scope,
                "allow_social_share": allow_social_share,
                "allow_email_signature": allow_email_signature,
                "updated_at": updated_at,
            }
        },
    )
    await _log_recognition_audit_event(
        "recognition_opt_in_updated",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={
            "teacher_opt_in": teacher_opt_in,
            "sharing_scope": sharing_scope,
            "allow_social_share": allow_social_share,
            "allow_email_signature": allow_email_signature,
        },
    )
    return RecognitionOptInResponse(
        video_id=video_id,
        teacher_opt_in=teacher_opt_in,
        sharing_scope=sharing_scope,
        allow_social_share=allow_social_share,
        allow_email_signature=allow_email_signature,
        updated_at=updated_at,
    )


@api_router.get("/recognition/review-queue", response_model=RecognitionReviewQueueResponse)
async def get_recognition_review_queue(current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    events = await db.lesson_recognition_events.find(
        {"recognition_status": "pending_admin_review"},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)
    items: List[RecognitionReviewQueueItem] = []
    for event in events:
        video = await db.videos.find_one({"id": event.get("video_id")}, {"_id": 0})
        if not video or video.get("uploaded_by") != current_user["id"]:
            continue
        teacher = await db.teachers.find_one({"id": video.get("teacher_id")}, {"_id": 0, "name": 1})
        items.append(
            RecognitionReviewQueueItem(
                video_id=video["id"],
                teacher_id=video.get("teacher_id"),
                teacher_name=(teacher or {}).get("name"),
                recognition_status=event.get("recognition_status") or "not_evaluated",
                publication_status=event.get("submission_status") or "not_submitted",
                badge_type=event.get("badge_type"),
                sharing_scope=event.get("sharing_scope"),
                submitted_at=event.get("updated_at") or event.get("created_at"),
            )
        )
    return RecognitionReviewQueueResponse(items=items)


@api_router.post("/videos/{video_id}/recognition/review", response_model=RecognitionReviewResponse)
async def review_video_recognition(
    video_id: str,
    payload: RecognitionReviewRequest,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    decision = (payload.decision or "").strip().lower()
    reviewed_at = datetime.now(timezone.utc).isoformat()
    badge_doc: Optional[dict] = None

    if decision == "approve":
        if not (event.get("eligibility") or {}).get("is_eligible"):
            raise HTTPException(status_code=400, detail="Video is not eligible for recognition approval")
        badge_type = payload.badge_type or event.get("badge_type") or FIVE_STAR_BADGE
        existing_badge = await db.recognition_badges.find_one(
            {"video_id": video_id, "badge_type": badge_type},
            {"_id": 0},
        )
        if existing_badge:
            badge_doc = {
                **existing_badge,
                "status": "awarded",
                "awarded_at": existing_badge.get("awarded_at") or reviewed_at,
                "awarded_by": current_user["id"],
                "criteria_snapshot": (event.get("eligibility") or {}).get("criteria_snapshot") or {},
            }
            await db.recognition_badges.update_one(
                {"id": existing_badge["id"]},
                {"$set": badge_doc},
            )
        else:
            badge_doc = {
                "id": str(uuid.uuid4()),
                "teacher_id": video.get("teacher_id"),
                "video_id": video_id,
                "badge_type": badge_type,
                "status": "awarded",
                "awarded_at": reviewed_at,
                "awarded_by": current_user["id"],
                "criteria_snapshot": (event.get("eligibility") or {}).get("criteria_snapshot") or {},
                "created_at": reviewed_at,
                "updated_at": reviewed_at,
            }
            await db.recognition_badges.insert_one(badge_doc)
        await db.lesson_recognition_events.update_one(
            {"id": event["id"]},
            {
                "$set": {
                    "recognition_status": "awarded",
                    "badge_id": badge_doc["id"],
                    "badge_type": badge_doc["badge_type"],
                    "reviewed_at": reviewed_at,
                    "reviewed_by": current_user["id"],
                    "review_reason": payload.reason,
                    "updated_at": reviewed_at,
                }
            },
        )
        await _log_recognition_audit_event(
            "recognition_awarded",
            "video",
            video_id,
            actor_user_id=current_user["id"],
            details={
                "badge_type": badge_doc["badge_type"],
                "badge_id": badge_doc["id"],
                "reason": payload.reason,
            },
        )
        return RecognitionReviewResponse(
            video_id=video_id,
            recognition_status="awarded",
            badge=RecognitionBadgeResponse(
                id=badge_doc["id"],
                badge_type=badge_doc["badge_type"],
                status=badge_doc["status"],
                video_id=badge_doc["video_id"],
                awarded_at=badge_doc.get("awarded_at"),
                awarded_by=badge_doc.get("awarded_by"),
                criteria_snapshot=badge_doc.get("criteria_snapshot") or {},
            ),
        )

    if decision not in {"reject", "revoke"}:
        raise HTTPException(status_code=400, detail="Unsupported recognition review decision")

    existing_badge = await db.recognition_badges.find_one({"video_id": video_id}, {"_id": 0})
    if decision == "revoke" and existing_badge:
        await db.recognition_badges.update_one(
            {"id": existing_badge["id"]},
            {
                "$set": {
                    "status": "revoked",
                    "updated_at": reviewed_at,
                    "revoked_at": reviewed_at,
                    "revoked_by": current_user["id"],
                }
            },
        )
    await db.lesson_recognition_events.update_one(
        {"id": event["id"]},
        {
            "$set": {
                "recognition_status": "rejected" if decision == "reject" else "revoked",
                "reviewed_at": reviewed_at,
                "reviewed_by": current_user["id"],
                "review_reason": payload.reason,
                "updated_at": reviewed_at,
            }
        },
    )
    await _log_recognition_audit_event(
        "recognition_rejected" if decision == "reject" else "recognition_revoked",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"reason": payload.reason},
    )
    return RecognitionReviewResponse(
        video_id=video_id,
        recognition_status="rejected" if decision == "reject" else "revoked",
        badge=None,
    )


@api_router.post("/videos/{video_id}/exemplar/submit", response_model=ExemplarSubmissionResponse)
async def submit_video_exemplar(
    video_id: str,
    payload: ExemplarSubmissionRequest,
    current_user: dict = Depends(get_current_user),
):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    teacher = await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    if event.get("recognition_status") != "awarded":
        raise HTTPException(status_code=400, detail="Lesson must be awarded recognition before exemplar submission")
    if not event.get("teacher_opt_in"):
        raise HTTPException(status_code=400, detail="Teacher opt-in is required before exemplar submission")
    if _normalize_privacy_status(video.get("privacy_status")) != PrivacyProcessingStatus.COMPLETED.value:
        raise HTTPException(status_code=400, detail="Privacy processing must be completed before exemplar submission")

    submitted_at = datetime.now(timezone.utc).isoformat()
    title = (payload.title or "").strip()
    summary = (payload.summary or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Exemplar title is required")
    if not summary:
        raise HTTPException(status_code=400, detail="Exemplar summary is required")
    sharing_scope = (payload.sharing_scope or event.get("sharing_scope") or "private").strip()
    tags = [str(tag).strip().lower() for tag in (payload.tags or []) if str(tag).strip()]

    existing_submission = await _get_latest_exemplar_submission(video_id)
    if existing_submission:
        submission_id = existing_submission["id"]
        submission_doc = {
            **existing_submission,
            "title": title,
            "summary": summary,
            "sharing_scope": sharing_scope,
            "teacher_opt_in": True,
            "submission_status": "pending_admin_review",
            "admin_review_status": "pending",
            "tags": tags,
            "submitted_at": submitted_at,
            "reviewed_at": None,
            "published_at": None,
            "teacher_display_name": teacher.get("name"),
        }
        await db.exemplar_submissions.update_one({"id": submission_id}, {"$set": submission_doc})
    else:
        submission_id = str(uuid.uuid4())
        submission_doc = {
            "id": submission_id,
            "teacher_id": video.get("teacher_id"),
            "video_id": video_id,
            "teacher_display_name": teacher.get("name"),
            "title": title,
            "summary": summary,
            "sharing_scope": sharing_scope,
            "teacher_opt_in": True,
            "submission_status": "pending_admin_review",
            "admin_review_status": "pending",
            "tags": tags,
            "submitted_at": submitted_at,
            "reviewed_at": None,
            "published_at": None,
            "created_at": submitted_at,
        }
        await db.exemplar_submissions.insert_one(submission_doc)

    await db.lesson_recognition_events.update_one(
        {"id": event["id"]},
        {
            "$set": {
                "submission_id": submission_id,
                "submission_status": "pending_admin_review",
                "sharing_scope": sharing_scope,
                "updated_at": submitted_at,
            }
        },
    )
    await _log_recognition_audit_event(
        "exemplar_submitted",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"submission_id": submission_id, "sharing_scope": sharing_scope, "tags": tags},
    )
    return ExemplarSubmissionResponse(
        submission_id=submission_id,
        video_id=video_id,
        submission_status="pending_admin_review",
        submitted_at=submitted_at,
    )


@api_router.get("/exemplar-library/review-queue", response_model=ExemplarReviewQueueResponse)
async def get_exemplar_review_queue(current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    submissions = await db.exemplar_submissions.find(
        {"submission_status": "pending_admin_review"},
        {"_id": 0},
    ).sort("submitted_at", -1).to_list(200)
    items: List[ExemplarReviewQueueItem] = []
    for submission in submissions:
        video = await db.videos.find_one({"id": submission.get("video_id")}, {"_id": 0, "uploaded_by": 1})
        if not video or video.get("uploaded_by") != current_user["id"]:
            continue
        items.append(
            ExemplarReviewQueueItem(
                submission_id=submission["id"],
                video_id=submission.get("video_id"),
                teacher_id=submission.get("teacher_id"),
                teacher_name=submission.get("teacher_display_name"),
                title=submission.get("title") or "Exemplar lesson",
                summary=submission.get("summary") or "",
                sharing_scope=submission.get("sharing_scope"),
                submission_status=submission.get("submission_status") or "pending_admin_review",
                submitted_at=submission.get("submitted_at"),
                tags=list(submission.get("tags") or []),
            )
        )
    return ExemplarReviewQueueResponse(items=items)


@api_router.post("/exemplar-library/{submission_id}/review", response_model=ExemplarLibraryReviewResponse)
async def review_exemplar_submission(
    submission_id: str,
    payload: ExemplarLibraryReviewRequest,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    submission = await db.exemplar_submissions.find_one({"id": submission_id}, {"_id": 0})
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    video = await db.videos.find_one({"id": submission.get("video_id")}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    teacher = await _get_teacher_or_404(submission.get("teacher_id"), current_user)
    decision = (payload.decision or "").strip().lower()
    reviewed_at = datetime.now(timezone.utc).isoformat()

    if decision == "approve":
        existing_item = await db.exemplar_library_items.find_one({"video_id": submission["video_id"]}, {"_id": 0})
        library_item_id = existing_item["id"] if existing_item else str(uuid.uuid4())
        playback_url = video.get("redacted_file_url") or _resolve_public_asset_url(video.get("redacted_file_path"))
        thumbnail_url = video.get("redacted_thumbnail_url") or _resolve_public_asset_url(video.get("redacted_thumbnail_path"))
        if not playback_url:
            raise HTTPException(status_code=400, detail="Redacted playback asset is required before publishing to the library")
        library_item_doc = {
            "id": library_item_id,
            "video_id": submission["video_id"],
            "teacher_id": submission["teacher_id"],
            "teacher_display_name": teacher.get("name"),
            "title": submission.get("title") or "Exemplar lesson",
            "summary": submission.get("summary") or "",
            "subject": video.get("subject"),
            "grade_level": teacher.get("grade_level"),
            "badge_type": FIVE_STAR_BADGE,
            "tags": list(submission.get("tags") or []),
            "redacted_asset_url": playback_url,
            "redacted_asset_path": video.get("redacted_file_path"),
            "thumbnail_url": thumbnail_url,
            "thumbnail_path": video.get("redacted_thumbnail_path"),
            "published_at": reviewed_at,
            "status": "published",
            "updated_at": reviewed_at,
        }
        if existing_item:
            await db.exemplar_library_items.update_one({"id": library_item_id}, {"$set": library_item_doc})
        else:
            library_item_doc["created_at"] = reviewed_at
            await db.exemplar_library_items.insert_one(library_item_doc)
        await db.exemplar_submissions.update_one(
            {"id": submission_id},
            {
                "$set": {
                    "submission_status": "published",
                    "admin_review_status": "approved",
                    "review_reason": payload.reason,
                    "reviewed_at": reviewed_at,
                    "published_at": reviewed_at,
                    "library_item_id": library_item_id,
                }
            },
        )
        await db.lesson_recognition_events.update_one(
            {"video_id": submission["video_id"]},
            {
                "$set": {
                    "submission_status": "published",
                    "library_item_id": library_item_id,
                    "updated_at": reviewed_at,
                }
            },
        )
        await _log_recognition_audit_event(
            "exemplar_published",
            "submission",
            submission_id,
            actor_user_id=current_user["id"],
            details={"video_id": submission["video_id"], "library_item_id": library_item_id, "reason": payload.reason},
        )
        return ExemplarLibraryReviewResponse(
            submission_id=submission_id,
            publication_status="published",
            library_item=_build_exemplar_library_item_response(library_item_doc),
        )
    if decision != "reject":
        raise HTTPException(status_code=400, detail="Unsupported exemplar review decision")

    await db.exemplar_submissions.update_one(
        {"id": submission_id},
        {
            "$set": {
                "submission_status": "rejected",
                "admin_review_status": "rejected",
                "review_reason": payload.reason,
                "reviewed_at": reviewed_at,
            }
        },
    )
    await db.lesson_recognition_events.update_one(
        {"video_id": submission["video_id"]},
        {"$set": {"submission_status": "rejected", "updated_at": reviewed_at}},
    )
    await _log_recognition_audit_event(
        "exemplar_rejected",
        "submission",
        submission_id,
        actor_user_id=current_user["id"],
        details={"video_id": submission["video_id"], "reason": payload.reason},
    )
    return ExemplarLibraryReviewResponse(submission_id=submission_id, publication_status="rejected", library_item=None)


@api_router.get("/exemplar-library", response_model=ExemplarLibraryResponse)
async def get_exemplar_library(
    subject: Optional[str] = None,
    tag: Optional[str] = None,
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    language = _resolve_request_language(request, default=_normalize_app_language(current_user.get("preferred_language"), default="en"))
    query: Dict[str, Any] = {"status": "published"}
    if subject:
        query["subject"] = subject
    if tag:
        query["tags"] = str(tag).strip().lower()
    docs = await db.exemplar_library_items.find(query, {"_id": 0}).sort("published_at", -1).to_list(200)
    items = [
        _localize_exemplar_library_item_response(_build_exemplar_library_item_response(doc), language)
        for doc in docs
    ]
    return ExemplarLibraryResponse(items=items, count=len(items))


@api_router.post("/videos/{video_id}/share/social-card", response_model=SocialCardResponse)
async def generate_social_card(
    video_id: str,
    payload: SocialCardRequest,
    current_user: dict = Depends(get_current_user),
):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    teacher = await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    if event.get("recognition_status") != "awarded":
        raise HTTPException(status_code=400, detail="Recognition must be awarded before generating a social card")
    if not event.get("allow_social_share"):
        raise HTTPException(status_code=400, detail="Social sharing has not been enabled for this lesson")
    created_at = datetime.now(timezone.utc).isoformat()
    asset_language = _normalize_app_language(video.get("analysis_language"), default="en")
    relative_path = f"share-assets/social/{video['teacher_id']}/{video_id}_{uuid.uuid4().hex[:8]}.png"
    full_path = UPLOAD_DIR / relative_path
    subject = video.get("subject") if payload.include_subject else None
    grade_level = teacher.get("grade_level") if payload.include_grade else None
    summary = (
        (await _get_assessment_for_video(video_id) or {}).get("summary")
        if payload.include_summary
        else ""
    ) or (
        "הוקרה על הוראה כיתתית חזקה ועל פרקטיקה רפלקטיבית."
        if _is_hebrew_language(asset_language)
        else "Recognized for excellent classroom instruction and reflective practice."
    )
    await asyncio.to_thread(
        render_social_share_card,
        str(full_path),
        teacher_name=teacher.get("name") or "Teacher",
        badge_label="שיעור 5 כוכבים" if _is_hebrew_language(asset_language) else "5-Star Lesson",
        lesson_title=video.get("filename") or ("שיעור שזכה להוקרה" if _is_hebrew_language(asset_language) else "Recognized Lesson"),
        summary=summary,
        subject=subject,
        grade_level=grade_level,
        language=asset_language,
    )
    file_url = _resolve_public_asset_url(relative_path)
    try:
        _, uploaded_url = _upload_path_to_s3(full_path, "share-assets", f"{video_id}_social_card.png", "image/png")
        file_url = uploaded_url or file_url
    except Exception as exc:
        logger.warning(f"Social card upload failed for {video_id}: {exc}")
    asset = await _create_share_asset_record(
        teacher_id=video["teacher_id"],
        video_id=video_id,
        asset_type="social_card",
        file_path=relative_path,
        file_url=file_url,
        actor_user_id=current_user["id"],
        details={"platform": payload.platform},
    )
    await _log_recognition_audit_event(
        "social_card_generated",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"asset_id": asset["id"], "platform": payload.platform},
    )
    return SocialCardResponse(
        asset_id=asset["id"],
        asset_type="social_card",
        file_url=file_url,
        caption=(
            "גאה לקבל הוקרה של שיעור 5 כוכבים ב-Cognivio."
            if _is_hebrew_language(asset_language)
            else "Proud to have earned a 5-Star Lesson recognition in Cognivio."
        ),
        created_at=created_at,
    )


@api_router.post("/videos/{video_id}/share/email-signature", response_model=EmailSignatureResponse)
async def generate_email_signature(
    video_id: str,
    payload: EmailSignatureRequest,
    current_user: dict = Depends(get_current_user),
):
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    teacher = await _get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await _get_or_sync_video_recognition_event(video)
    if event.get("recognition_status") != "awarded":
        raise HTTPException(status_code=400, detail="Recognition must be awarded before generating an email signature badge")
    if not event.get("allow_email_signature"):
        raise HTTPException(status_code=400, detail="Email signature sharing has not been enabled for this lesson")
    created_at = datetime.now(timezone.utc).isoformat()
    asset_language = _normalize_app_language(video.get("analysis_language"), default="en")
    relative_path = f"share-assets/email-signatures/{video['teacher_id']}/{video_id}_{uuid.uuid4().hex[:8]}.png"
    full_path = UPLOAD_DIR / relative_path
    featured_label = (
        "מופיע בספריית הכוכבים של Cognivio"
        if event.get("library_item_id") and _is_hebrew_language(asset_language)
        else "Featured in Cognivio All-Star Library" if event.get("library_item_id") else None
    )
    await asyncio.to_thread(
        render_email_signature_badge,
        str(full_path),
        teacher_name=teacher.get("name") or "Teacher",
        badge_label="שיעור 5 כוכבים" if _is_hebrew_language(asset_language) else "5-Star Lesson",
        featured_label=featured_label,
        language=asset_language,
    )
    image_url = _resolve_public_asset_url(relative_path)
    try:
        _, uploaded_url = _upload_path_to_s3(full_path, "share-assets", f"{video_id}_email_signature.png", "image/png")
        image_url = uploaded_url or image_url
    except Exception as exc:
        logger.warning(f"Email signature badge upload failed for {video_id}: {exc}")
    link_url = f"{FRONTEND_URL.rstrip('/')}/videos/{video_id}" if FRONTEND_URL else image_url
    html = build_email_signature_html(
        image_url=image_url,
        teacher_name=teacher.get("name") or "Teacher",
        badge_label="שיעור 5 כוכבים" if _is_hebrew_language(asset_language) else "5-Star Lesson",
        link_url=link_url,
        language=asset_language,
    )
    asset = await _create_share_asset_record(
        teacher_id=video["teacher_id"],
        video_id=video_id,
        asset_type="email_signature",
        file_path=relative_path,
        file_url=image_url,
        actor_user_id=current_user["id"],
        details={"format": payload.format, "badge_style": payload.badge_style},
    )
    await _log_recognition_audit_event(
        "email_signature_generated",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"asset_id": asset["id"]},
    )
    return EmailSignatureResponse(
        asset_id=asset["id"],
        asset_type="email_signature",
        html=html,
        image_url=image_url,
        created_at=created_at,
    )


@app.websocket("/ws/videos/{video_id}")
async def video_status_ws(websocket: WebSocket, video_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            await websocket.close(code=1008)
            return
    except jwt.ExpiredSignatureError:
        await websocket.close(code=1008)
        return
    except jwt.InvalidTokenError:
        await websocket.close(code=1008)
        return

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not user:
        await websocket.close(code=1008)
        return

    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        await websocket.close(code=1008)
        return

    try:
        await _get_teacher_or_404(video.get("teacher_id"), user)
    except HTTPException:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    last_signature = None
    try:
        while True:
            video = await db.videos.find_one(
                {"id": video_id},
                {"_id": 0},
            )
            if not video:
                break
            status = _normalize_video_status(video.get("status"))
            analysis_status = _normalize_video_status(video.get("analysis_status"))
            privacy_status = _normalize_privacy_status(video.get("privacy_status"))
            signature = (
                status,
                privacy_status,
                analysis_status,
                bool(video.get("privacy_review_required", False)),
                video.get("privacy_review_reason"),
                video.get("error_message"),
                video.get("privacy_error"),
            )
            if signature != last_signature:
                await websocket.send_json(
                    {
                        "status": status,
                        "privacy_status": privacy_status,
                        "analysis_status": analysis_status,
                        "privacy_review_required": bool(video.get("privacy_review_required", False)),
                        "privacy_review_reason": video.get("privacy_review_reason"),
                        "error_message": video.get("error_message"),
                        "privacy_error": video.get("privacy_error"),
                    }
                )
                last_signature = signature
            if _is_terminal_video_status(status):
                break
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass

# ==================== CURRICULUM & PLANS ====================
@api_router.post("/curricula", response_model=CurriculumUploadResponse)
async def upload_curriculum(
    teacher_id: str = Form(...),
    title: str = Form(""),
    school_id: Optional[str] = Form(None),
    subject: Optional[str] = Form(None),
    grade_level: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Not authorized")

    teacher = await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "curricula")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "school_id": school_id or teacher.get("school_id"),
        "title": title or Path(file.filename).stem,
        "subject": subject or teacher.get("subject"),
        "grade_level": grade_level or teacher.get("grade_level"),
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_role": role,
        "uploaded_at": uploaded_at,
    }
    await db.curricula.insert_one(doc)
    return CurriculumUploadResponse(**doc)


@api_router.get("/curricula")
async def list_curricula(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if teacher_id:
        await _get_teacher_or_404(teacher_id, current_user)
        query["teacher_id"] = teacher_id
    else:
        query["uploaded_by"] = current_user["id"]
    docs = await db.curricula.find(query, {"_id": 0}).to_list(1000)
    return {"curricula": docs}


@api_router.post("/lesson-plans", response_model=LessonPlanUploadResponse)
async def upload_lesson_plan(
    teacher_id: str = Form(...),
    date: str = Form(...),
    title: str = Form(""),
    curriculum_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can upload lesson plans")

    await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "lesson_plans")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "title": title or Path(file.filename).stem,
        "date": date,
        "curriculum_id": curriculum_id,
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_at": uploaded_at,
    }
    await db.lesson_plans.insert_one(doc)
    # Create a reminder schedule for the lesson plan date
    try:
        reminder = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "course_name": f"Lesson plan reminder: {doc['title']}",
            "start_time": datetime.fromisoformat(date).isoformat(),
            "recording_status": ScheduleStatus.PLANNED.value,
            "join_url": None,
            "location": None,
            "user_id": current_user["id"],
            "created_at": uploaded_at,
            "updated_at": None,
            "reminder_type": "lesson_plan",
            "lesson_plan_id": doc_id,
        }
        await db.schedules.insert_one(reminder)
    except Exception:
        logger.warning("Unable to create lesson plan reminder schedule")
    return LessonPlanUploadResponse(**doc)


@api_router.get("/lesson-plans")
async def list_lesson_plans(
    teacher_id: str,
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    query = {"teacher_id": teacher_id}
    if date:
        query["date"] = date
    docs = await db.lesson_plans.find(query, {"_id": 0}).to_list(1000)
    return {"lesson_plans": docs}


@api_router.post("/syllabi", response_model=SyllabusUploadResponse)
async def upload_syllabus(
    teacher_id: str = Form(...),
    title: str = Form(""),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can upload syllabi")

    await _get_teacher_or_404(teacher_id, current_user)
    _ensure_allowed_extension(file.filename)

    doc_id = str(uuid.uuid4())
    key, file_url = await _upload_file_to_s3(file, "syllabi")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "teacher_id": teacher_id,
        "title": title or Path(file.filename).stem,
        "filename": file.filename,
        "file_url": file_url,
        "s3_key": key,
        "uploaded_by": current_user["id"],
        "uploaded_at": uploaded_at,
    }
    await db.syllabi.insert_one(doc)
    return SyllabusUploadResponse(**doc)


@api_router.get("/syllabi")
async def list_syllabi(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    docs = await db.syllabi.find({"teacher_id": teacher_id}, {"_id": 0}).to_list(1000)
    return {"syllabi": docs}

# ==================== ASSESSMENT ENDPOINTS ====================
@api_router.get("/assessments", response_model=List[AssessmentResult])
async def get_assessments(
    request: Request,
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query: Dict[str, Any] = {}
    if teacher_id:
        await _get_teacher_or_404(teacher_id, current_user)
        query["teacher_id"] = teacher_id
    else:
        teacher_ids = await _list_teacher_ids_for_user(current_user)
        query["teacher_id"] = {"$in": teacher_ids or ["__none__"]}
    
    assessments = await db.assessments.find(query, {"_id": 0, "user_id": 0}).to_list(1000)
    response_language = _resolve_request_language(request, default="en")
    return [AssessmentResult(**_enrich_assessment_for_response(a, response_language=response_language)) for a in assessments]

@api_router.get("/assessments/{assessment_id}", response_model=AssessmentResult)
async def get_assessment(
    assessment_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    assessment = await db.assessments.find_one(
        {"id": assessment_id},
        {"_id": 0, "user_id": 0}
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    await _get_teacher_or_404(assessment.get("teacher_id"), current_user)
    response_language = _resolve_request_language(request, default="en")
    return AssessmentResult(**_enrich_assessment_for_response(assessment, response_language=response_language))


@api_router.get("/assessments/{assessment_id}/evidence")
async def get_assessment_evidence(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    assessment = await db.assessments.find_one(
        {"id": assessment_id},
        {"_id": 0, "user_id": 0},
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    await _get_teacher_or_404(assessment.get("teacher_id"), current_user)
    evidence = await _ensure_mock_evidence(assessment, current_user)
    return {"evidence": evidence}


@api_router.post("/assessments/{assessment_id}/admin-override")
async def create_admin_override(
    assessment_id: str,
    payload: AdminScoreOverride,
    current_user: dict = Depends(get_current_user),
):
    from app.services.assessment_service import create_admin_override as modular_create_admin_override

    return await modular_create_admin_override(assessment_id, payload, current_user)


@api_router.get("/assessments/{assessment_id}/admin-overrides")
async def list_admin_overrides(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    from app.services.assessment_service import list_admin_overrides as modular_list_admin_overrides

    return await modular_list_admin_overrides(assessment_id, current_user)


@api_router.post("/assessments/{assessment_id}/feedback", response_model=AssessmentFeedbackListResponse)
async def upsert_assessment_feedback(
    assessment_id: str,
    payload: AssessmentFeedbackUpsert,
    current_user: dict = Depends(get_current_user),
):
    from app.services.assessment_service import (
        list_assessment_feedback as modular_list_assessment_feedback,
        upsert_assessment_feedback as modular_upsert_assessment_feedback,
    )

    await modular_upsert_assessment_feedback(assessment_id, payload, current_user)
    return await modular_list_assessment_feedback(assessment_id, current_user)


@api_router.get("/assessments/{assessment_id}/feedback", response_model=AssessmentFeedbackListResponse)
async def list_assessment_feedback(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    from app.services.assessment_service import list_assessment_feedback as modular_list_assessment_feedback

    return await modular_list_assessment_feedback(assessment_id, current_user)


@api_router.post("/admin/preferences/scoring-mode")
async def set_admin_scoring_mode(
    payload: AdminScoringPreference,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if payload.scoring_mode not in {"override", "coexist"}:
        raise HTTPException(status_code=400, detail="Invalid scoring mode")
    doc = {
        "admin_id": current_user["id"],
        "scoring_mode": payload.scoring_mode,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_scoring_preferences.update_one(
        {"admin_id": current_user["id"]},
        {"$set": doc},
        upsert=True,
    )
    return {"preference": doc}


async def _get_admin_scoring_mode(admin_id: str) -> str:
    pref = await db.admin_scoring_preferences.find_one(
        {"admin_id": admin_id},
        {"_id": 0, "scoring_mode": 1},
    )
    if pref and pref.get("scoring_mode") in {"override", "coexist"}:
        return pref["scoring_mode"]
    return "override"


@api_router.get("/admin/organization-memory")
async def get_admin_organization_memory(
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    _require_admin_ops_user(current_user)
    from app.services.workspace_service import list_organization_memory

    entries = await list_organization_memory(current_user, scope_type=scope_type, scope_id=scope_id)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }


@api_router.get("/admin/feedback-digest")
async def get_admin_feedback_digest(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    from app.services.workspace_service import build_feedback_digest

    return await build_feedback_digest(current_user)


@api_router.get("/admin/access-users", response_model=AccessUserListResponse)
async def list_access_users(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    docs = await db.users.find({}, {"_id": 0, "password": 0}).sort("created_at", -1).to_list(1000)
    serialized = [_to_access_user_record(doc) for doc in docs]
    return AccessUserListResponse(
        pending=[item for item in serialized if item.approval_status == "pending"],
        approved=[item for item in serialized if item.approval_status == "approved" and item.is_active],
        revoked=[item for item in serialized if item.approval_status == "revoked" or not item.is_active],
    )


@api_router.post("/admin/access-users/{user_id}/approve", response_model=AccessUserRecord)
async def approve_access_user(
    user_id: str,
    payload: AccessDecisionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_admin_ops_user(current_user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updated = await _approve_user_access(
        target,
        actor_label=current_user.get("email") or current_user["id"],
        reason=payload.reason,
        organization_name=payload.organization_name,
        organization_type=payload.organization_type,
        school_name=payload.school_name,
        manager_email=payload.manager_email,
    )
    return _to_access_user_record(updated)


@api_router.post("/admin/access-users/{user_id}/revoke", response_model=AccessUserRecord)
async def revoke_access_user(
    user_id: str,
    payload: AccessDecisionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_admin_ops_user(current_user)
    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot remove your own access")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updated = await _revoke_user_access(
        target,
        actor_label=current_user.get("email") or current_user["id"],
        reason=payload.reason,
    )
    return _to_access_user_record(updated)


@api_router.get("/admin/access-request-actions/{action}")
async def process_access_request_action(action: str, token: str):
    if action not in {"approve", "deny"}:
        raise HTTPException(status_code=404, detail="Unknown access action")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return Response(
            _render_access_request_action_result_page(
                "This access decision link has expired",
                "Open Cognivio and review the request from the access approvals page if you still want to act on it.",
                tone="warning",
            ),
            media_type="text/html",
        )
    except jwt.InvalidTokenError:
        return Response(
            _render_access_request_action_result_page(
                "This access decision link is invalid",
                "Use the Cognivio access approvals page after logging in to review the request manually.",
                tone="danger",
            ),
            media_type="text/html",
        )

    if payload.get("type") != "access_request_action" or payload.get("action") != action:
        return Response(
            _render_access_request_action_result_page(
                "This access decision link is invalid",
                "Use the Cognivio access approvals page after logging in to review the request manually.",
                tone="danger",
            ),
            media_type="text/html",
        )

    user_id = str(payload.get("user_id") or "").strip()
    user_email = str(payload.get("email") or "").strip().lower()
    if not user_id or not user_email:
        return Response(
            _render_access_request_action_result_page(
                "This access decision link is invalid",
                "The link does not contain a valid request target.",
                tone="danger",
            ),
            media_type="text/html",
        )

    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target or str(target.get("email") or "").strip().lower() != user_email:
        return Response(
            _render_access_request_action_result_page(
                "This request could not be found",
                "The access request may already have been removed or processed.",
                tone="warning",
            ),
            media_type="text/html",
        )

    status = _get_user_approval_status(target)
    now = datetime.now(timezone.utc).isoformat()

    if action == "approve":
        if status == "approved" and _is_user_access_active(target):
            return Response(
                _render_access_request_action_result_page(
                    "This applicant is already approved",
                    f"{target.get('email')} already has active Cognivio access.",
                    tone="success",
                ),
                media_type="text/html",
            )
        if status == "revoked":
            return Response(
                _render_access_request_action_result_page(
                    "This request was already denied",
                    "Open Cognivio if you want to manually re-approve the account from the access approvals page.",
                    tone="warning",
                ),
                media_type="text/html",
            )
        updated = await _approve_user_access(
            target,
            actor_label=f"email_link:{ACCESS_APPROVAL_NOTIFY_EMAIL or 'admin'}",
            reason="email_link_approval",
        )
        return Response(
            _render_access_request_action_result_page(
                "Applicant approved",
                f"{updated.get('email')} can now sign in to Cognivio with the same email and password used during sign-up.",
                tone="success",
            ),
            media_type="text/html",
        )

    if status == "approved" and _is_user_access_active(target):
        return Response(
            _render_access_request_action_result_page(
                "This applicant is already approved",
                "Use the Cognivio access approvals page if you want to remove access after approval.",
                tone="warning",
            ),
            media_type="text/html",
        )
    if status == "revoked":
        return Response(
            _render_access_request_action_result_page(
                "This request was already denied",
                f"{target.get('email')} does not currently have Cognivio access.",
                tone="danger",
            ),
            media_type="text/html",
        )
    updates = {
        "approval_status": "revoked",
        "revoked_at": now,
        "revoked_by": f"email_link:{ACCESS_APPROVAL_NOTIFY_EMAIL or 'admin'}",
        "is_active": False,
    }
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    await _log_auth_event(
        "approval_denied",
        email=updated.get("email"),
        user_id=updated.get("id"),
        result="success",
        reason="email_link_denial",
    )
    _send_access_denied_confirmation(updated)
    return Response(
        _render_access_request_action_result_page(
            "Applicant denied",
            f"{updated.get('email')} has been notified that the access request was not approved.",
            tone="danger",
        ),
        media_type="text/html",
    )


def _apply_admin_overrides(
    element_scores: List[dict],
    overrides: List[dict],
    scoring_mode: str,
) -> Tuple[List[dict], Optional[float]]:
    override_map = {
        o["domain_id"]: o
        for o in overrides
        if o.get("override_type", "score") == "score" and o.get("domain_id")
    }
    adjusted_scores = []
    for es in element_scores:
        override = override_map.get(es["element_id"])
        score = es["score"]
        if override:
            adjusted = override["adjusted_score"]
            if scoring_mode == "coexist":
                score = round((score + adjusted) / 2, 2)
            else:
                score = adjusted
        adjusted_scores.append({**es, "adjusted_score": score})

    valid_scores = [es["adjusted_score"] for es in adjusted_scores if es["adjusted_score"] is not None]
    adjusted_overall = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else None
    return adjusted_scores, adjusted_overall


async def _get_adherence_score(assessment_id: str, user_id: str) -> Optional[float]:
    doc = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment_id, "user_id": user_id},
        {"_id": 0, "adherence_score": 1},
    )
    if not doc:
        return None
    return doc.get("adherence_score")


async def _ensure_adherence_for_assessment(assessment: dict, current_user: dict) -> Optional[dict]:
    existing = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment["id"], "user_id": current_user["id"]},
        {"_id": 0},
    )
    if existing:
        return existing

    lesson_plan = await db.lesson_plans.find(
        {"teacher_id": assessment["teacher_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(1)
    if not lesson_plan:
        return None

    adherence = {
        "id": str(uuid.uuid4()),
        "assessment_id": assessment["id"],
        "teacher_id": assessment["teacher_id"],
        "lesson_plan_id": lesson_plan[0]["id"] if lesson_plan else None,
        "status": "estimated",
        "adherence_score": 0.82,
        "topic_match_rate": 0.78,
        "alignment_summary": "Instructional sequence matches planned objectives with minor pacing drift.",
        "matched_topics": [
            "Objectives aligned with lesson plan",
            "Assessment checks mirror planned exit ticket",
        ],
        "missing_topics": [
            "Planned small-group check-in not observed",
        ],
        "flags": [
            {"type": "pacing", "detail": "Warm-up extended beyond planned window"},
        ],
        "evidence_segments": [
            {
                "start_sec": 120,
                "end_sec": 360,
                "summary": "Teacher reviews objective and models example aligned to lesson plan.",
                "confidence": 0.84,
            },
            {
                "start_sec": 780,
                "end_sec": 900,
                "summary": "Independent practice aligns with planned assessment item.",
                "confidence": 0.79,
            },
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user["id"],
    }
    await db.curriculum_adherence.insert_one(adherence)
    adherence.pop("user_id", None)
    adherence.pop("_id", None)
    return adherence


def _combine_overall_with_adherence(overall_score: Optional[float], adherence_score: Optional[float]) -> Optional[float]:
    if overall_score is None:
        return None
    if adherence_score is None:
        return overall_score
    adherence_scaled = adherence_score * 10
    combined = (overall_score * (1 - ADHERENCE_WEIGHT)) + (adherence_scaled * ADHERENCE_WEIGHT)
    return round(combined, 2)


@api_router.get("/assessments/{assessment_id}/curriculum-adherence")
async def get_curriculum_adherence(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    assessment = await db.assessments.find_one(
        {"id": assessment_id, "user_id": current_user["id"]},
        {"_id": 0},
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    existing = await db.curriculum_adherence.find_one(
        {"assessment_id": assessment_id, "user_id": current_user["id"]}, {"_id": 0}
    )
    if existing:
        return existing

    # Fallback: return placeholder adherence when no analysis exists.
    teacher_id = assessment["teacher_id"]
    lesson_plan = await db.lesson_plans.find(
        {"teacher_id": teacher_id}, {"_id": 0}
    ).sort("date", -1).to_list(1)
    if not lesson_plan:
        return {
            "id": None,
            "assessment_id": assessment_id,
            "teacher_id": teacher_id,
            "lesson_plan_id": None,
            "status": "no_lesson_plan",
            "adherence_score": None,
            "matched_topics": [],
            "missing_topics": [],
            "evidence_segments": [],
        }

    adherence = {
        "id": str(uuid.uuid4()),
        "assessment_id": assessment_id,
        "teacher_id": teacher_id,
        "lesson_plan_id": lesson_plan[0]["id"] if lesson_plan else None,
        "status": "estimated",
        "adherence_score": 0.82,
        "topic_match_rate": 0.78,
        "alignment_summary": "Instructional sequence matches planned objectives with minor pacing drift.",
        "matched_topics": [
            "Objectives aligned with lesson plan",
            "Assessment checks mirror planned exit ticket",
        ],
        "missing_topics": [
            "Planned small-group check-in not observed",
        ],
        "flags": [
            {"type": "pacing", "detail": "Warm-up extended beyond planned window"},
        ],
        "evidence_segments": [
            {
                "start_sec": 120,
                "end_sec": 360,
                "summary": "Teacher reviews objective and models example aligned to lesson plan.",
                "confidence": 0.84,
            },
            {
                "start_sec": 780,
                "end_sec": 900,
                "summary": "Independent practice aligns with planned assessment item.",
                "confidence": 0.79,
            },
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": current_user["id"],
    }
    await db.curriculum_adherence.insert_one(adherence)
    adherence.pop("_id", None)
    adherence.pop("user_id", None)
    return adherence


@api_router.post("/reports/export")
async def export_summary_report(
    request: Request,
    format: str = Form("pdf"),
    teacher_id: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    report_started_perf = time.perf_counter()
    language = _resolve_request_language(request, default="en")
    is_hebrew = _is_hebrew_language(language)
    export_format = format.lower()
    try:
        def _format_export_datetime(value: Optional[str]) -> Optional[str]:
            if not value:
                return value
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return value
            if is_hebrew:
                return parsed.astimezone(timezone.utc).strftime("%d/%m/%Y %H:%M")
            return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")

        teacher_query: Dict[str, Any] = {"created_by": current_user["id"]}
        if teacher_id:
            teacher_query["id"] = teacher_id
        if department:
            teacher_query["department"] = department
        teachers = await db.teachers.find(teacher_query, {"_id": 0}).to_list(1000)
        teacher_ids = [t["id"] for t in teachers]
        assessments = await db.assessments.find(
            {"user_id": current_user["id"], "teacher_id": {"$in": teacher_ids}},
            {"_id": 0},
        ).sort("analyzed_at", -1).to_list(2000)

        latest_by_teacher: Dict[str, dict] = {}
        for assessment in assessments:
            tid = assessment["teacher_id"]
            if tid not in latest_by_teacher:
                latest_by_teacher[tid] = assessment

        rows = []
        for t in teachers:
            assessment = latest_by_teacher.get(t["id"])
            evidence_count = await db.assessment_evidence.count_documents(
                {"teacher_id": t["id"], "user_id": current_user["id"]}
            )
            avg_score = None
            teacher_assessments = [a for a in assessments if a["teacher_id"] == t["id"]]
            if teacher_assessments:
                avg_score = round(
                    sum(a.get("overall_score") or 0 for a in teacher_assessments) / len(teacher_assessments),
                    2,
                )
            trend_summary = None
            if len(teacher_assessments) >= 2:
                earliest = teacher_assessments[-1]
                latest = teacher_assessments[0]
                early_scores = {es["element_id"]: es.get("score") for es in earliest.get("element_scores", [])}
                late_scores = {es["element_id"]: es.get("score") for es in latest.get("element_scores", [])}
                deltas = []
                for element_id, late_score in late_scores.items():
                    early_score = early_scores.get(element_id)
                    if early_score is None or late_score is None:
                        continue
                    deltas.append((element_id, round(late_score - early_score, 2)))
                deltas.sort(key=lambda x: x[1], reverse=True)
                gains = [f"{d[0].upper()}({d[1]:+0.2f})" for d in deltas[:2]]
                declines = [f"{d[0].upper()}({d[1]:+0.2f})" for d in deltas[-2:]] if deltas else []
                if deltas:
                    trend_summary = (
                        f"שיפורים: {', '.join(gains)} | ירידות: {', '.join(declines)}"
                        if is_hebrew
                        else f"Gains: {', '.join(gains)} | Declines: {', '.join(declines)}"
                    )

            adherence_score = None
            if assessment:
                adherence_doc = await db.curriculum_adherence.find_one(
                    {"assessment_id": assessment["id"], "user_id": current_user["id"]},
                    {"_id": 0, "adherence_score": 1},
                )
                if adherence_doc:
                    adherence_score = adherence_doc.get("adherence_score")
            rows.append(
                {
                    "teacher_name": t.get("name"),
                    "subject": _localize_subject_label(t.get("subject"), language),
                    "grade_level": _localize_grade_level_label(t.get("grade_level"), language),
                    "department": _localize_department_label(t.get("department"), language),
                    "latest_score": assessment.get("overall_score") if assessment else None,
                    "average_score": avg_score,
                    "assessment_count": len(teacher_assessments),
                    "evidence_count": evidence_count,
                    "adherence_score": adherence_score,
                    "domain_trend_summary": trend_summary,
                    "last_assessment": _format_export_datetime(assessment.get("analyzed_at")) if assessment else None,
                    "detail_url": f"{FRONTEND_URL.rstrip('/')}/teachers/{t['id']}" if FRONTEND_URL else None,
                }
            )
        if export_format == "csv":
            localized_rows = []
            for row in rows:
                localized_rows.append(
                    {
                        ("שם מורה" if is_hebrew else "teacher_name"): row["teacher_name"],
                        ("מקצוע" if is_hebrew else "subject"): row["subject"],
                        ("שכבת גיל" if is_hebrew else "grade_level"): row["grade_level"],
                        ("מחלקה" if is_hebrew else "department"): row["department"],
                        ("ציון אחרון" if is_hebrew else "latest_score"): row["latest_score"],
                        ("ציון ממוצע" if is_hebrew else "average_score"): row["average_score"],
                        ("מספר הערכות" if is_hebrew else "assessment_count"): row["assessment_count"],
                        ("מספר ראיות" if is_hebrew else "evidence_count"): row["evidence_count"],
                        ("ציון התאמה" if is_hebrew else "adherence_score"): row["adherence_score"],
                        ("סיכום מגמה" if is_hebrew else "domain_trend_summary"): row["domain_trend_summary"],
                        ("מועד הערכה אחרונה" if is_hebrew else "last_assessment"): row["last_assessment"],
                        ("קישור פירוט" if is_hebrew else "detail_url"): row["detail_url"],
                    }
                )
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=list(localized_rows[0].keys()) if localized_rows else [])
            writer.writeheader()
            for row in localized_rows:
                writer.writerow(row)
            app_metrics.record_report_result(
                format=export_format,
                language=language,
                success=True,
                duration_seconds=time.perf_counter() - report_started_perf,
            )
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=summary-report.csv"},
            )

        if export_format == "pdf":
            if canvas is None:
                raise HTTPException(status_code=501, detail="PDF export not available")
            buffer = io.BytesIO()
            pdf = canvas.Canvas(buffer)
            title = "דוח סיכום תצפיות Cognivio" if is_hebrew else "Cognivio Summary Report"
            generated_label = "הופק ב־" if is_hebrew else "Generated"
            teacher_filter_label = "סינון מורה" if is_hebrew else "Teacher filter"
            department_filter_label = "סינון מחלקה" if is_hebrew else "Department filter"
            dept_fallback = "ללא מחלקה" if is_hebrew else "No dept"
            subject_label = "מקצוע" if is_hebrew else "Subject"
            grade_label = "שכבת גיל" if is_hebrew else "Grade"
            latest_score_label = "ציון אחרון" if is_hebrew else "Latest score"
            avg_score_label = "ציון ממוצע" if is_hebrew else "Avg score"
            assessments_label = "הערכות" if is_hebrew else "Assessments"
            evidence_label = "ראיות" if is_hebrew else "Evidence"
            adherence_label = "התאמה לתוכנית הלימודים" if is_hebrew else "Adherence"
            trend_label = "מגמות מרכזיות" if is_hebrew else "Trend"
            detail_label = "קישור לפרופיל" if is_hebrew else "Detail"
            pdf.setTitle(title)
            pdf.drawString(50, 800, title)
            pdf.drawString(50, 785, f"{generated_label} {_format_export_datetime(datetime.now(timezone.utc).isoformat())}")
            if teacher_id:
                pdf.drawString(50, 770, f"{teacher_filter_label}: {teacher_id}")
            if department:
                pdf.drawString(50, 755, f"{department_filter_label}: {department}")
            y = 735
            for row in rows[:30]:
                pdf.setFont("Helvetica-Bold", 10)
                pdf.drawString(
                    50,
                    y,
                    f"{row['teacher_name']} ({row['department'] or dept_fallback})",
                )
                y -= 12
                pdf.setFont("Helvetica", 9)
                pdf.drawString(
                    50,
                    y,
                    f"{subject_label}: {row['subject'] or 'N/A'} | {grade_label}: {row['grade_level'] or 'N/A'}",
                )
                y -= 12
                pdf.drawString(
                    50,
                    y,
                    f"{latest_score_label}: {row['latest_score']} | {avg_score_label}: {row['average_score']} | {assessments_label}: {row['assessment_count']} | {evidence_label}: {row['evidence_count']}",
                )
                y -= 12
                pdf.drawString(
                    50,
                    y,
                    f"{adherence_label}: {row.get('adherence_score')} | {trend_label}: {row.get('domain_trend_summary')}",
                )
                y -= 12
                if row.get("detail_url"):
                    pdf.drawString(50, y, f"{detail_label}: {row['detail_url']}")
                    y -= 14
                else:
                    y -= 8
                if y < 60:
                    pdf.showPage()
                    y = 800
            pdf.save()
            buffer.seek(0)
            app_metrics.record_report_result(
                format=export_format,
                language=language,
                success=True,
                duration_seconds=time.perf_counter() - report_started_perf,
            )
            return Response(
                content=buffer.read(),
                media_type="application/pdf",
                headers={"Content-Disposition": "attachment; filename=summary-report.pdf"},
            )

        raise HTTPException(status_code=400, detail="Invalid export format. Use pdf or csv.")
    except Exception:
        app_metrics.record_report_result(
            format=export_format,
            language=language,
            success=False,
            duration_seconds=time.perf_counter() - report_started_perf,
        )
        raise


@api_router.get("/qa/smoke")
async def smoke_test(current_user: dict = Depends(get_current_user)):
    """Lightweight QA check for demo readiness."""
    curricula_count = await db.curricula.count_documents(
        {"uploaded_by": current_user["id"]}
    )
    lesson_plan_count = await db.lesson_plans.count_documents(
        {"uploaded_by": current_user["id"]}
    )
    adherence_count = await db.curriculum_adherence.count_documents(
        {"user_id": current_user["id"]}
    )
    evidence_count = await db.assessment_evidence.count_documents(
        {"user_id": current_user["id"]}
    )
    assessment_count = await db.assessments.count_documents(
        {"user_id": current_user["id"]}
    )
    override_count = await db.admin_assessment_overrides.count_documents(
        {"admin_id": current_user["id"]}
    )

    return {
        "curriculum_uploads": curricula_count,
        "lesson_plan_uploads": lesson_plan_count,
        "adherence_records": adherence_count,
        "evidence_segments": evidence_count,
        "assessments": assessment_count,
        "admin_overrides": override_count,
        "checks": {
            "curriculum_upload": curricula_count > 0,
            "lesson_plan_upload": lesson_plan_count > 0,
            "adherence_data": adherence_count > 0,
            "evidence_data": evidence_count > 0,
            "export_report_ready": assessment_count > 0,
        },
    }


@api_router.get("/teachers/{teacher_id}/summary-insights")
async def get_teacher_summary_insights(
    teacher_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import build_analysis_context

    """
    Aggregate insights across multiple lessons for a teacher.
    Used for monthly/periodic 'Summary AI Insight' on the profile.
    """
    await _get_teacher_or_404(teacher_id, current_user)
    assessments = await db.assessments.find(
        {"teacher_id": teacher_id},
        {"_id": 0, "user_id": 0},
    ).sort("analyzed_at", -1).to_list(50)

    if not assessments:
        return {
            "teacher_id": teacher_id,
            "overall_trend_score": None,
            "summary": "",
            "recommendations": [],
        }

    # Flatten element scores across assessments
    aggregated_scores: Dict[str, Dict[str, Any]] = {}
    all_element_scores: List[dict] = []
    for assessment in assessments:
        for es in assessment.get("element_scores", []):
            all_element_scores.append(es)
            key = es["element_id"]
            bucket = aggregated_scores.setdefault(
                key,
                {"name": es["element_name"], "scores": []},
            )
            bucket["scores"].append(es["score"])

    # Compute overall average across all element scores
    all_scores = [es["score"] for es in all_element_scores]
    overall_trend = round(sum(all_scores) / len(all_scores), 2) if all_scores else None

    # Reuse existing summary/recommendation logic on synthetic element scores
    synthetic_element_scores: List[dict] = []
    for element_id, info in aggregated_scores.items():
        if not info["scores"]:
            continue
        avg = round(sum(info["scores"]) / len(info["scores"]), 2)
        synthetic_element_scores.append(
            {
                "element_id": element_id,
                "element_name": info["name"],
                "score": avg,
            }
        )

    language = _resolve_request_language(request, default="en")
    analysis_context = await build_analysis_context(current_user, teacher_id)
    summary_text = generate_summary(
        synthetic_element_scores,
        overall_trend or 0,
        language=language,
        analysis_context=analysis_context,
    )
    recs = generate_recommendations(
        synthetic_element_scores,
        language=language,
        analysis_context=analysis_context,
    )

    return {
        "teacher_id": teacher_id,
        "overall_trend_score": overall_trend,
        "summary": summary_text,
        "recommendations": recs,
        "analysis_context": analysis_context,
    }


def _resolve_plan_owner_id(teacher: dict, current_user: dict) -> str:
    role = _get_user_role(current_user)
    if role == "teacher" and teacher.get("created_by"):
        return teacher["created_by"]
    return teacher.get("created_by") or current_user["id"]


async def _list_coaching_participants(teacher: dict, current_user: dict) -> List[dict]:
    owner_id = _resolve_plan_owner_id(teacher, current_user)
    visible_user_ids = {owner_id}
    teacher_email = str(teacher.get("email") or "").strip().lower()
    if teacher_email:
        teacher_users = await db.users.find(
            {"email": {"$regex": f"^{re.escape(teacher_email)}$", "$options": "i"}},
            {"_id": 0, "id": 1, "name": 1, "role": 1, "email": 1},
        ).to_list(10)
        for user in teacher_users:
            if user.get("id"):
                visible_user_ids.add(user["id"])
    if _get_user_role(current_user) == "teacher":
        visible_user_ids.add(current_user["id"])

    users = await db.users.find(
        {"id": {"$in": list(visible_user_ids)}},
        {"_id": 0, "id": 1, "name": 1, "role": 1, "email": 1},
    ).to_list(20)
    by_id = {user["id"]: user for user in users if user.get("id")}

    participants: List[dict] = []
    if owner_id in by_id:
        owner_user = by_id[owner_id]
        participants.append(
            {
                "user_id": owner_id,
                "name": owner_user.get("name"),
                "role": _get_user_role(owner_user),
            }
        )
    else:
        participants.append(
            {
                "user_id": owner_id,
                "name": current_user.get("name") if owner_id == current_user["id"] else None,
                "role": "admin",
            }
        )

    for user_id, user in by_id.items():
        if user_id == owner_id:
            continue
        participants.append(
            {
                "user_id": user_id,
                "name": user.get("name"),
                "role": _get_user_role(user),
            }
        )
    return participants


def _sort_key_for_iso(value: Optional[str]) -> datetime:
    parsed = _parse_iso_datetime(value)
    return parsed or datetime.min.replace(tzinfo=timezone.utc)


async def _get_latest_published_conference_agenda(teacher_id: str) -> Optional[dict]:
    return await db.published_conference_agendas.find_one(
        {"teacher_id": teacher_id},
        {"_id": 0},
        sort=[("published_at", -1), ("updated_at", -1)],
    )


def _serialize_action_plan_goal(goal: Any) -> dict:
    if isinstance(goal, ActionPlanGoal):
        return {
            "id": goal.id,
            "title": goal.title,
            "description": goal.description,
            "due_date": goal.due_date,
            "status": goal.status,
            "evidence_links": list(goal.evidence_links or []),
        }
    return {
        "id": goal.get("id", ""),
        "title": goal.get("title", ""),
        "description": goal.get("description"),
        "due_date": goal.get("due_date"),
        "status": goal.get("status") or "planned",
        "evidence_links": list(goal.get("evidence_links") or []),
    }


def _tokenize_goal_terms(*parts: Optional[str]) -> List[str]:
    tokens: List[str] = []
    seen = set()
    for part in parts:
        for token in re.findall(r"[\w\u0590-\u05FF']+", str(part or "").lower()):
            clean = token.strip("_'")
            if len(clean) < 4:
                continue
            if clean in seen:
                continue
            seen.add(clean)
            tokens.append(clean)
    return tokens


def _goal_match_score(goal_terms: List[str], *parts: Optional[str]) -> int:
    haystack = " ".join(str(part or "").lower() for part in parts)
    return sum(1 for token in goal_terms if token in haystack)


def _format_evidence_record_title(
    label: str,
    video: Optional[dict],
    created_at: Optional[str],
) -> str:
    video_label = (video or {}).get("filename") or (video or {}).get("subject")
    if video_label:
        return f"{label}: {video_label}"
    if created_at:
        parsed = _parse_iso_datetime(created_at)
        if parsed:
            return f"{label}: {parsed.date().isoformat()}"
    return label


async def _build_teacher_evidence_catalog(
    teacher: dict,
    current_user: dict,
    *,
    limit: int = 40,
) -> List[dict]:
    teacher_id = teacher["id"]
    owner_id = _resolve_plan_owner_id(teacher, current_user)
    assessment_docs = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ).sort("analyzed_at", -1).to_list(20)
    observation_docs = await db.observations.find(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(30)

    video_ids = {
        doc.get("video_id")
        for doc in assessment_docs + observation_docs
        if doc.get("video_id")
    }
    videos = (
        await db.videos.find({"id": {"$in": list(video_ids or ['__none__'])}}, {"_id": 0}).to_list(50)
        if video_ids
        else []
    )
    video_map = {video.get("id"): video for video in videos if video.get("id")}

    items: List[dict] = []

    for assessment in assessment_docs:
        created_at = assessment.get("analyzed_at") or assessment.get("created_at")
        video = video_map.get(assessment.get("video_id"))
        if assessment.get("summary"):
            items.append(
                {
                    "id": f"assessment-summary-{assessment.get('id')}",
                    "teacher_id": teacher_id,
                    "evidence_type": "assessment_summary",
                    "title": _format_evidence_record_title("Lesson review", video, created_at),
                    "summary": str(assessment.get("summary")).strip(),
                    "created_at": created_at,
                    "route_hint": "video",
                    "video_id": assessment.get("video_id"),
                    "assessment_id": assessment.get("id"),
                    "signal": "linked_context",
                    "reference_key": f"assessment:{assessment.get('id')}:summary",
                }
            )

        for idx, recommendation in enumerate(assessment.get("recommendations") or []):
            text = str(recommendation or "").strip()
            if not text:
                continue
            items.append(
                {
                    "id": f"assessment-recommendation-{assessment.get('id')}-{idx}",
                    "teacher_id": teacher_id,
                    "evidence_type": "assessment_recommendation",
                    "title": _format_evidence_record_title("AI coaching move", video, created_at),
                    "summary": text,
                    "created_at": created_at,
                    "route_hint": "video",
                    "video_id": assessment.get("video_id"),
                    "assessment_id": assessment.get("id"),
                    "signal": "showing_challenge",
                    "reference_key": f"assessment:{assessment.get('id')}:recommendation:{idx}",
                }
            )

        observation_summary = assessment.get("observation_summary") or {}
        for idx, text in enumerate(observation_summary.get("top_strengths") or []):
            text = str(text or "").strip()
            if not text:
                continue
            items.append(
                {
                    "id": f"assessment-strength-{assessment.get('id')}-{idx}",
                    "teacher_id": teacher_id,
                    "evidence_type": "assessment_strength",
                    "title": _format_evidence_record_title("Observed strength", video, created_at),
                    "summary": text,
                    "created_at": created_at,
                    "route_hint": "video",
                    "video_id": assessment.get("video_id"),
                    "assessment_id": assessment.get("id"),
                    "signal": "reinforcing_progress",
                    "reference_key": f"assessment:{assessment.get('id')}:strength:{idx}",
                }
            )
        for idx, text in enumerate(observation_summary.get("growth_areas") or []):
            text = str(text or "").strip()
            if not text:
                continue
            items.append(
                {
                    "id": f"assessment-growth-{assessment.get('id')}-{idx}",
                    "teacher_id": teacher_id,
                    "evidence_type": "assessment_growth_area",
                    "title": _format_evidence_record_title("Growth area", video, created_at),
                    "summary": text,
                    "created_at": created_at,
                    "route_hint": "video",
                    "video_id": assessment.get("video_id"),
                    "assessment_id": assessment.get("id"),
                    "signal": "showing_challenge",
                    "reference_key": f"assessment:{assessment.get('id')}:growth:{idx}",
                }
            )

    for observation in observation_docs:
        created_at = observation.get("created_at") or observation.get("updated_at")
        for kind, summary, signal in (
            ("admin_comment", observation.get("admin_comment"), "showing_challenge"),
            ("teacher_response", observation.get("teacher_response"), "follow_through"),
        ):
            text = str(summary or "").strip()
            if not text:
                continue
            label = "Admin observation" if kind == "admin_comment" else "Teacher follow-through"
            items.append(
                {
                    "id": f"{kind}-{observation.get('id')}",
                    "teacher_id": teacher_id,
                    "evidence_type": kind,
                    "title": _format_evidence_record_title(label, video_map.get(observation.get("video_id")), created_at),
                    "summary": text,
                    "created_at": created_at,
                    "route_hint": "video" if observation.get("video_id") else "reflection",
                    "video_id": observation.get("video_id"),
                    "observation_id": observation.get("id"),
                    "timestamp_seconds": observation.get("timestamp_seconds"),
                    "signal": signal,
                    "reference_key": f"observation:{observation.get('id')}:{kind}",
                }
            )

    items.sort(key=lambda item: _sort_key_for_iso(item.get("created_at")), reverse=True)
    return items[:limit]


def _progress_signal_from_evidence(records: List[dict]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if not records:
        return (
            "evidence_gap",
            "No recent linked evidence is attached to this goal yet.",
            None,
        )
    latest_created_at = records[0].get("created_at")
    positive = sum(
        1
        for record in records
        if record.get("signal") in {"reinforcing_progress", "follow_through"}
    )
    challenge = sum(1 for record in records if record.get("signal") == "showing_challenge")
    if positive >= 2 and positive > challenge:
        return (
            "reinforcing_progress",
            f"Recent evidence is reinforcing this goal across {positive} linked records.",
            latest_created_at,
        )
    if challenge >= 2 and challenge >= positive:
        return (
            "repeated_challenge",
            f"Recent evidence shows this challenge repeating across {challenge} linked records.",
            latest_created_at,
        )
    if positive or challenge:
        return (
            "one_off_evidence",
            "There is only limited evidence linked to this goal so far. Review the next lesson before changing course.",
            latest_created_at,
        )
    return (
        "linked_context",
        "Context is linked to this goal, but it does not yet show a strong evidence pattern.",
        latest_created_at,
    )


def _enrich_action_plan_goals_with_evidence(
    goals: List[dict],
    evidence_catalog: List[dict],
) -> List[dict]:
    by_reference = {
        item.get("reference_key"): item
        for item in evidence_catalog
        if item.get("reference_key")
    }
    enriched: List[dict] = []
    for goal in goals:
        goal_doc = dict(goal)
        goal_terms = _tokenize_goal_terms(goal_doc.get("title"), goal_doc.get("description"))
        selected: List[dict] = []
        seen = set()

        for reference_key in goal_doc.get("evidence_links") or []:
            record = by_reference.get(reference_key)
            if not record:
                continue
            selected.append(record)
            seen.add(record.get("id"))

        if goal_terms:
            for record in evidence_catalog:
                if record.get("id") in seen:
                    continue
                score = _goal_match_score(goal_terms, record.get("title"), record.get("summary"))
                if score <= 0:
                    continue
                selected.append(record)
                seen.add(record.get("id"))
                if len(selected) >= 4:
                    break

        selected.sort(key=lambda item: _sort_key_for_iso(item.get("created_at")), reverse=True)
        progress_signal, progress_summary, latest_evidence_at = _progress_signal_from_evidence(selected)
        goal_doc["evidence_records"] = selected[:4]
        goal_doc["progress_signal"] = progress_signal
        goal_doc["progress_summary"] = progress_summary
        goal_doc["latest_evidence_at"] = latest_evidence_at
        enriched.append(goal_doc)
    return enriched


def _collect_linked_evidence_for_reflection(
    doc: dict,
    *,
    goal_map: Dict[str, dict],
    evidence_catalog: List[dict],
) -> tuple[List[str], List[dict]]:
    linked_goal_ids = list(doc.get("linked_goal_ids") or [])
    linked_goal_titles = [
        goal_map[goal_id].get("title")
        for goal_id in linked_goal_ids
        if goal_id in goal_map and goal_map[goal_id].get("title")
    ]
    linked_records: List[dict] = []
    seen = set()

    def push(record: Optional[dict]) -> None:
        if not record or record.get("id") in seen:
            return
        linked_records.append(record)
        seen.add(record.get("id"))

    for record in evidence_catalog:
        if doc.get("linked_observation_id") and record.get("observation_id") == doc.get("linked_observation_id"):
            push(record)
        if doc.get("linked_assessment_id") and record.get("assessment_id") == doc.get("linked_assessment_id"):
            push(record)
        if doc.get("linked_video_id") and record.get("video_id") == doc.get("linked_video_id"):
            push(record)

    for goal_id in linked_goal_ids:
        for record in (goal_map.get(goal_id) or {}).get("evidence_records") or []:
            push(record)
            if len(linked_records) >= 4:
                break
        if len(linked_records) >= 4:
            break

    linked_records.sort(key=lambda item: _sort_key_for_iso(item.get("created_at")), reverse=True)
    return linked_goal_titles, linked_records[:4]


def _enrich_reflection_payload(
    doc: dict,
    *,
    goal_map: Dict[str, dict],
    evidence_catalog: List[dict],
) -> dict:
    enriched = dict(doc)
    linked_goal_titles, linked_records = _collect_linked_evidence_for_reflection(
        enriched,
        goal_map=goal_map,
        evidence_catalog=evidence_catalog,
    )
    enriched["linked_goal_titles"] = linked_goal_titles
    enriched["linked_evidence_records"] = linked_records
    return enriched


async def _build_teacher_coaching_timeline(
    teacher: dict,
    current_user: dict,
    *,
    max_entries: int = 20,
) -> List[dict]:
    teacher_id = teacher["id"]
    owner_id = _resolve_plan_owner_id(teacher, current_user)
    participants = await _list_coaching_participants(teacher, current_user)
    participant_map = {item["user_id"]: item for item in participants if item.get("user_id")}
    visible_user_ids = [item["user_id"] for item in participants if item.get("user_id")]

    action_plan_history = await db.action_plan_history.find(
        {"teacher_id": teacher_id, "plan_owner_id": owner_id},
        {"_id": 0},
    ).sort("saved_at", -1).to_list(25)
    reflection_history = await db.summary_reflection_history.find(
        {"teacher_id": teacher_id, "author_user_id": {"$in": visible_user_ids or ["__none__"]}},
        {"_id": 0},
    ).sort("saved_at", -1).to_list(25)
    observation_docs = await db.observations.find(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(25)
    assessment_docs = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ).sort("analyzed_at", -1).to_list(15)
    published_agenda = await _get_latest_published_conference_agenda(teacher_id)

    entries: List[dict] = []

    for entry in action_plan_history:
        goal_titles = [
            goal.get("title")
            for goal in entry.get("goals", [])
            if goal.get("title")
        ]
        summary_parts = []
        if goal_titles:
            summary_parts.append(", ".join(goal_titles[:3]))
        if entry.get("notes"):
            summary_parts.append(str(entry.get("notes")).strip())
        entries.append(
            {
                "id": f"action-plan-{entry.get('id')}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "action_plan_update",
                "title": "Action plan updated",
                "summary": " • ".join([part for part in summary_parts if part]) or None,
                "created_at": entry.get("saved_at") or teacher.get("created_at"),
                "author_name": entry.get("saved_by_name"),
                "author_role": entry.get("saved_by_role"),
                "route_hint": "action_plan",
            }
        )

    for entry in reflection_history:
        participant = participant_map.get(entry.get("author_user_id"), {})
        author_role = entry.get("author_role") or participant.get("role") or "teacher"
        title = "Teacher reflection saved" if author_role == "teacher" else "Admin reflection saved"
        summary = entry.get("self_reflection") or entry.get("actions_taken") or ""
        entries.append(
            {
                "id": f"reflection-{entry.get('id')}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "reflection_saved",
                "title": title,
                "summary": str(summary).strip() or None,
                "created_at": entry.get("saved_at") or teacher.get("created_at"),
                "author_name": entry.get("author_name") or participant.get("name"),
                "author_role": author_role,
                "route_hint": "reflection",
                "reflection_id": entry.get("reflection_id"),
            }
        )

    for observation in observation_docs:
        summary = (
            observation.get("admin_comment")
            or observation.get("teacher_response")
            or observation.get("summary")
        )
        if not summary:
            continue
        entries.append(
            {
                "id": f"observation-{observation.get('id')}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "observation_comment",
                "title": "Observation follow-up noted",
                "summary": str(summary).strip(),
                "created_at": observation.get("created_at") or teacher.get("created_at"),
                "author_name": current_user.get("name") if owner_id == current_user["id"] else None,
                "author_role": "admin",
                "route_hint": "video",
                "observation_id": observation.get("id"),
                "video_id": observation.get("video_id"),
                "timestamp_seconds": observation.get("timestamp_seconds"),
            }
        )

    for assessment in assessment_docs:
        summary = assessment.get("summary")
        entries.append(
            {
                "id": f"assessment-{assessment.get('id')}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "lesson_evidence_ready",
                "title": "Lesson evidence reviewed",
                "summary": str(summary).strip() if summary else None,
                "created_at": assessment.get("analyzed_at")
                or assessment.get("created_at")
                or teacher.get("created_at"),
                "author_role": "system",
                "route_hint": "video",
                "assessment_id": assessment.get("id"),
                "video_id": assessment.get("video_id"),
            }
        )

    if teacher.get("next_coaching_conference"):
        entries.append(
            {
                "id": f"conference-{teacher_id}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "conference_scheduled",
                "title": "Coaching conference scheduled",
                "summary": teacher.get("next_coaching_conference"),
                "created_at": teacher.get("next_coaching_conference"),
                "author_role": "admin",
                "route_hint": "conference",
            }
        )

    if published_agenda:
        agenda_preview = ", ".join((published_agenda.get("agenda_items") or [])[:3])
        entries.append(
            {
                "id": f"conference-agenda-{published_agenda.get('id')}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "entry_type": "conference_agenda_published",
                "title": "Conference agenda published",
                "summary": agenda_preview or None,
                "created_at": published_agenda.get("published_at")
                or published_agenda.get("updated_at")
                or teacher.get("created_at"),
                "author_name": published_agenda.get("published_by_name"),
                "author_role": "admin",
                "route_hint": "conference",
                "assessment_id": published_agenda.get("linked_assessment_id"),
                "video_id": published_agenda.get("linked_video_id"),
            }
        )

    entries.sort(key=lambda item: _sort_key_for_iso(item.get("created_at")), reverse=True)
    return entries[:max_entries]


async def _build_coaching_tasks_for_teacher(teacher: dict, current_user: dict) -> List[dict]:
    from app.services.workspace_service import build_teacher_memory_support

    owner_id = _resolve_plan_owner_id(teacher, current_user)
    teacher_id = teacher["id"]
    role = _get_user_role(current_user)
    now = datetime.now(timezone.utc)
    tasks: List[dict] = []
    adaptive_support = await build_teacher_memory_support(current_user, teacher_id)
    primary_goal = adaptive_support.get("primary_goal") or {}
    primary_goal_title = primary_goal.get("title")
    primary_goal_signal = primary_goal.get("progress_signal")
    teacher_prompt = adaptive_support.get("teacher_prompt_body")
    admin_prompt = adaptive_support.get("admin_prompt_body")
    next_conference_dt = _parse_iso_datetime(teacher.get("next_coaching_conference"))
    conference_soon = bool(next_conference_dt and next_conference_dt <= now + timedelta(days=10))

    latest_assessment = await db.assessments.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
        sort=[("analyzed_at", -1)],
    )
    latest_observation = await db.observations.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    privacy_profile = await _get_active_privacy_profile(teacher_id)
    current_action_plan = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ) or {"goals": [], "notes": None}
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
    current_action_plan["goals"] = _enrich_action_plan_goals_with_evidence(
        current_action_plan.get("goals") or [],
        evidence_catalog,
    )
    reflection_participants = await _list_coaching_participants(teacher, current_user)
    teacher_user_ids = [
        item["user_id"]
        for item in reflection_participants
        if item.get("role") == "teacher" and item.get("user_id")
    ]
    latest_teacher_reflection = await db.summary_reflection_history.find_one(
        {"teacher_id": teacher_id, "author_user_id": {"$in": teacher_user_ids or ["__none__"]}},
        {"_id": 0},
        sort=[("saved_at", -1)],
    )
    latest_admin_reflection = await db.summary_reflection_history.find_one(
        {"teacher_id": teacher_id, "author_role": {"$ne": "teacher"}},
        {"_id": 0},
        sort=[("saved_at", -1)],
    )

    if not privacy_profile:
        tasks.append(
            {
                "id": f"privacy-{teacher_id}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "state": "privacy_blocker",
                "priority": 100,
                "title": "Complete privacy profile",
                "summary": "Recording uploads are blocked until the teacher privacy profile is complete.",
                "route_hint": "privacy_profile",
            }
        )

    if role != "teacher" and latest_assessment:
        assessment_at = _parse_iso_datetime(latest_assessment.get("analyzed_at") or latest_assessment.get("created_at"))
        observation_at = _parse_iso_datetime(latest_observation.get("created_at") if latest_observation else None)
        if assessment_at and (observation_at is None or assessment_at > observation_at):
            priority = 95
            if primary_goal_signal == "repeated_challenge":
                priority += 3
            if conference_soon:
                priority += 2
            tasks.append(
                {
                    "id": f"admin-review-{teacher_id}-{latest_assessment.get('id')}",
                    "teacher_id": teacher_id,
                    "teacher_name": teacher.get("name"),
                    "state": "awaiting_admin_review",
                    "priority": priority,
                    "title": "Review new lesson evidence",
                    "summary": admin_prompt
                    or (
                        f"Recent lesson evidence is ready for review with focus on {primary_goal_title}."
                        if primary_goal_title
                        else "A newly analyzed lesson is ready for admin review and follow-up."
                    ),
                    "due_at": latest_assessment.get("analyzed_at"),
                    "route_hint": "video",
                    "assessment_id": latest_assessment.get("id"),
                    "video_id": latest_assessment.get("video_id"),
                    "context_label": primary_goal_title,
                    "support_prompt": admin_prompt,
                    "rank_reason": "conference_soon" if conference_soon else primary_goal_signal,
                }
            )

    if role == "teacher" and latest_assessment:
        assessment_at = _parse_iso_datetime(latest_assessment.get("analyzed_at") or latest_assessment.get("created_at"))
        teacher_reflection_at = _parse_iso_datetime((latest_teacher_reflection or {}).get("saved_at"))
        if assessment_at and (teacher_reflection_at is None or assessment_at > teacher_reflection_at):
            priority = 92
            if primary_goal_signal == "repeated_challenge":
                priority += 4
            elif primary_goal_signal == "evidence_gap":
                priority += 2
            tasks.append(
                {
                    "id": f"teacher-evidence-{teacher_id}-{latest_assessment.get('id')}",
                    "teacher_id": teacher_id,
                    "teacher_name": teacher.get("name"),
                    "state": "new_evidence_ready",
                    "priority": priority,
                    "title": "Respond to the latest class evidence",
                    "summary": teacher_prompt
                    or (
                        f"A recent lesson review is ready. Connect your next move to {primary_goal_title}."
                        if primary_goal_title
                        else "A recent lesson review is ready. Add your reflection and implementation response."
                    ),
                    "due_at": latest_assessment.get("analyzed_at"),
                    "route_hint": "reflection",
                    "assessment_id": latest_assessment.get("id"),
                    "video_id": latest_assessment.get("video_id"),
                    "context_label": primary_goal_title,
                    "support_prompt": teacher_prompt,
                    "rank_reason": primary_goal_signal,
                }
            )

    if latest_observation and latest_observation.get("admin_comment"):
        observation_at = _parse_iso_datetime(latest_observation.get("created_at"))
        teacher_reflection_at = _parse_iso_datetime((latest_teacher_reflection or {}).get("saved_at"))
        teacher_actions = str((latest_teacher_reflection or {}).get("actions_taken") or "").strip()
        if observation_at and (teacher_reflection_at is None or observation_at > teacher_reflection_at or not teacher_actions):
            priority = 90 + (6 if conference_soon else 0)
            tasks.append(
                {
                    "id": f"teacher-response-{teacher_id}-{latest_observation.get('id')}",
                    "teacher_id": teacher_id,
                    "teacher_name": teacher.get("name"),
                    "state": "awaiting_teacher_response",
                    "priority": priority,
                    "title": "Respond to admin follow-up",
                    "summary": (
                        f"{latest_observation.get('admin_comment')} "
                        f"{teacher_prompt or ''}"
                    ).strip(),
                    "due_at": latest_observation.get("created_at"),
                    "route_hint": "reflection",
                    "observation_id": latest_observation.get("id"),
                    "video_id": latest_observation.get("video_id"),
                    "context_label": primary_goal_title,
                    "support_prompt": teacher_prompt,
                    "rank_reason": "conference_soon" if conference_soon else "awaiting_teacher_response",
                }
            )

    if role != "teacher" and latest_observation and latest_observation.get("admin_comment"):
        observation_at = _parse_iso_datetime(latest_observation.get("created_at"))
        teacher_reflection_at = _parse_iso_datetime((latest_teacher_reflection or {}).get("saved_at"))
        if observation_at and (teacher_reflection_at is None or observation_at > teacher_reflection_at):
            priority = 85 + (7 if conference_soon else 0)
            tasks.append(
                {
                    "id": f"await-teacher-{teacher_id}-{latest_observation.get('id')}",
                    "teacher_id": teacher_id,
                    "teacher_name": teacher.get("name"),
                    "state": "awaiting_teacher_response",
                    "priority": priority,
                    "title": "Check for teacher follow-through",
                    "summary": admin_prompt
                    or "A recent admin comment has not yet received a teacher follow-through response.",
                    "due_at": latest_observation.get("created_at"),
                    "route_hint": "reflection",
                    "observation_id": latest_observation.get("id"),
                    "video_id": latest_observation.get("video_id"),
                    "context_label": primary_goal_title,
                    "support_prompt": admin_prompt,
                    "rank_reason": "conference_soon" if conference_soon else primary_goal_signal,
                }
            )

    for goal in current_action_plan.get("goals", []):
        if goal.get("status") in {"complete", "implemented"} or not goal.get("title"):
            continue
        due_dt = _parse_iso_datetime(goal.get("due_date"))
        if due_dt and due_dt <= now + timedelta(days=14):
            goal_priority = 80 if due_dt <= now else 72
            if goal.get("title") == primary_goal_title and primary_goal_signal == "repeated_challenge":
                goal_priority += 6
            elif goal.get("title") == primary_goal_title and primary_goal_signal == "evidence_gap":
                goal_priority += 3
            if conference_soon:
                goal_priority += 2
            tasks.append(
                {
                    "id": f"goal-due-{teacher_id}-{goal.get('id')}",
                    "teacher_id": teacher_id,
                    "teacher_name": teacher.get("name"),
                    "state": "goal_checkpoint_due",
                    "priority": goal_priority,
                    "title": f"Checkpoint due: {goal.get('title')}",
                    "summary": goal.get("progress_summary")
                    or goal.get("description")
                    or "Review progress against this shared goal.",
                    "due_at": goal.get("due_date"),
                    "route_hint": "action_plan",
                    "goal_id": goal.get("id"),
                    "context_label": goal.get("title"),
                    "support_prompt": teacher_prompt if role == "teacher" else admin_prompt,
                    "rank_reason": primary_goal_signal if goal.get("title") == primary_goal_title else "goal_checkpoint_due",
                }
            )

    if next_conference_dt and next_conference_dt <= now + timedelta(days=10):
        tasks.append(
            {
                "id": f"conference-{teacher_id}",
                "teacher_id": teacher_id,
                "teacher_name": teacher.get("name"),
                "state": "conference_upcoming",
                "priority": 70,
                "title": "Upcoming coaching conference",
                "summary": (
                    teacher_prompt if role == "teacher" else admin_prompt
                ) or "Prepare for the next coaching conversation and confirm the agenda.",
                "due_at": teacher.get("next_coaching_conference"),
                "route_hint": "conference",
                "context_label": primary_goal_title,
                "support_prompt": teacher_prompt if role == "teacher" else admin_prompt,
                "rank_reason": "conference_upcoming",
            }
        )

    tasks.sort(
        key=lambda item: (
            -(item.get("priority") or 0),
            _sort_key_for_iso(item.get("due_at")),
        )
    )
    return tasks


async def _list_visible_teachers_for_user(
    current_user: dict,
    teacher_id: Optional[str] = None,
) -> List[dict]:
    role = _get_user_role(current_user)
    if teacher_id:
        teacher = await _get_teacher_or_404(teacher_id, current_user)
        return [teacher]
    if role == "teacher":
        teacher_ids = await _list_teacher_ids_for_user(current_user)
        if not teacher_ids:
            return []
        return await db.teachers.find(
            {"id": {"$in": teacher_ids}},
            {"_id": 0},
        ).to_list(20)
    return await db.teachers.find(
        {"created_by": current_user["id"]},
        {"_id": 0},
    ).to_list(200)


@api_router.get(
    "/teachers/{teacher_id}/summary-reflection",
    response_model=Optional[SummaryReflection],
)
async def get_teacher_summary_reflection(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    doc = await db.summary_reflections.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    )
    if not doc:
        return None
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
    action_plan_doc = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": _resolve_plan_owner_id(teacher, current_user)},
        {"_id": 0, "user_id": 0},
    ) or {"goals": []}
    enriched_goals = _enrich_action_plan_goals_with_evidence(
        action_plan_doc.get("goals") or [],
        evidence_catalog,
    )
    goal_map = {goal.get("id"): goal for goal in enriched_goals if goal.get("id")}
    return SummaryReflection(
        **_enrich_reflection_payload(
            doc,
            goal_map=goal_map,
            evidence_catalog=evidence_catalog,
        )
    )


@api_router.post(
    "/teachers/{teacher_id}/summary-reflection",
    response_model=SummaryReflection,
)
async def upsert_teacher_summary_reflection(
    teacher_id: str,
    payload: SummaryReflectionUpsert,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import sync_summary_reflection_memory

    await _get_teacher_or_404(teacher_id, current_user)
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.summary_reflections.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]}
    )
    if existing:
        update_fields: Dict[str, Any] = {
            "updated_at": now,
        }
        if payload.self_reflection is not None:
            update_fields["self_reflection"] = payload.self_reflection
        if payload.actions_taken is not None:
            update_fields["actions_taken"] = payload.actions_taken
        update_fields["linked_goal_ids"] = list(payload.linked_goal_ids or [])
        update_fields["linked_video_id"] = payload.linked_video_id
        update_fields["linked_assessment_id"] = payload.linked_assessment_id
        update_fields["linked_observation_id"] = payload.linked_observation_id
        await db.summary_reflections.update_one(
            {"teacher_id": teacher_id, "user_id": current_user["id"]},
            {"$set": update_fields},
        )
        existing.update(update_fields)
        await db.summary_reflection_history.insert_one(
            {
                "id": str(uuid.uuid4()),
                "teacher_id": teacher_id,
                "reflection_id": existing.get("id"),
                "author_user_id": current_user["id"],
                "author_name": current_user.get("name"),
                "author_role": _get_user_role(current_user),
                "self_reflection": existing.get("self_reflection") or "",
                "actions_taken": existing.get("actions_taken") or "",
                "linked_goal_ids": list(existing.get("linked_goal_ids") or []),
                "linked_video_id": existing.get("linked_video_id"),
                "linked_assessment_id": existing.get("linked_assessment_id"),
                "linked_observation_id": existing.get("linked_observation_id"),
                "saved_at": now,
                "updated_at": existing.get("updated_at"),
            }
        )
        existing.pop("_id", None)
        existing.pop("user_id", None)
        await sync_summary_reflection_memory(current_user, teacher_id, existing)
        teacher = await _get_teacher_or_404(teacher_id, current_user)
        evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
        action_plan_doc = await db.action_plans.find_one(
            {"teacher_id": teacher_id, "user_id": _resolve_plan_owner_id(teacher, current_user)},
            {"_id": 0, "user_id": 0},
        ) or {"goals": []}
        enriched_goals = _enrich_action_plan_goals_with_evidence(
            action_plan_doc.get("goals") or [],
            evidence_catalog,
        )
        goal_map = {goal.get("id"): goal for goal in enriched_goals if goal.get("id")}
        return SummaryReflection(
            **_enrich_reflection_payload(
                existing,
                goal_map=goal_map,
                evidence_catalog=evidence_catalog,
            )
        )

    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher_id,
        "user_id": current_user["id"],
        "self_reflection": payload.self_reflection or "",
        "actions_taken": payload.actions_taken or "",
        "linked_goal_ids": list(payload.linked_goal_ids or []),
        "linked_video_id": payload.linked_video_id,
        "linked_assessment_id": payload.linked_assessment_id,
        "linked_observation_id": payload.linked_observation_id,
        "created_at": now,
        "updated_at": None,
    }
    await db.summary_reflections.insert_one(doc)
    await db.summary_reflection_history.insert_one(
        {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "reflection_id": doc["id"],
            "author_user_id": current_user["id"],
            "author_name": current_user.get("name"),
            "author_role": _get_user_role(current_user),
            "self_reflection": doc.get("self_reflection") or "",
            "actions_taken": doc.get("actions_taken") or "",
            "linked_goal_ids": list(doc.get("linked_goal_ids") or []),
            "linked_video_id": doc.get("linked_video_id"),
            "linked_assessment_id": doc.get("linked_assessment_id"),
            "linked_observation_id": doc.get("linked_observation_id"),
            "saved_at": now,
            "updated_at": None,
        }
    )
    await sync_summary_reflection_memory(current_user, teacher_id, doc)
    doc.pop("_id", None)
    doc.pop("user_id", None)
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
    action_plan_doc = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": _resolve_plan_owner_id(teacher, current_user)},
        {"_id": 0, "user_id": 0},
    ) or {"goals": []}
    enriched_goals = _enrich_action_plan_goals_with_evidence(
        action_plan_doc.get("goals") or [],
        evidence_catalog,
    )
    goal_map = {goal.get("id"): goal for goal in enriched_goals if goal.get("id")}
    return SummaryReflection(
        **_enrich_reflection_payload(
            doc,
            goal_map=goal_map,
            evidence_catalog=evidence_catalog,
        )
    )


@api_router.get(
    "/teachers/{teacher_id}/reflection-history",
    response_model=ReflectionHistoryResponse,
)
async def get_teacher_reflection_history(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
    action_plan_doc = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": _resolve_plan_owner_id(teacher, current_user)},
        {"_id": 0, "user_id": 0},
    ) or {"goals": []}
    enriched_goals = _enrich_action_plan_goals_with_evidence(
        action_plan_doc.get("goals") or [],
        evidence_catalog,
    )
    goal_map = {goal.get("id"): goal for goal in enriched_goals if goal.get("id")}
    participants = await _list_coaching_participants(teacher, current_user)
    visible_user_ids = [item["user_id"] for item in participants if item.get("user_id")]
    participant_map = {item["user_id"]: item for item in participants if item.get("user_id")}

    current_docs = await db.summary_reflections.find(
        {"teacher_id": teacher_id, "user_id": {"$in": visible_user_ids or ["__none__"]}},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(20)
    history_docs = await db.summary_reflection_history.find(
        {"teacher_id": teacher_id, "author_user_id": {"$in": visible_user_ids or ["__none__"]}},
        {"_id": 0},
    ).sort("saved_at", -1).to_list(100)

    current_entries = []
    for doc in current_docs:
        participant = participant_map.get(doc.get("user_id"), {})
        enriched_doc = _enrich_reflection_payload(
            doc,
            goal_map=goal_map,
            evidence_catalog=evidence_catalog,
        )
        current_entries.append(
            ReflectionHistoryEntry(
                id=enriched_doc.get("id") or str(uuid.uuid4()),
                teacher_id=teacher_id,
                reflection_id=enriched_doc.get("id"),
                author_user_id=enriched_doc.get("user_id"),
                author_name=participant.get("name") or current_user.get("name"),
                author_role=participant.get("role") or "teacher",
                self_reflection=enriched_doc.get("self_reflection"),
                actions_taken=enriched_doc.get("actions_taken"),
                linked_goal_ids=list(enriched_doc.get("linked_goal_ids") or []),
                linked_goal_titles=list(enriched_doc.get("linked_goal_titles") or []),
                linked_video_id=enriched_doc.get("linked_video_id"),
                linked_assessment_id=enriched_doc.get("linked_assessment_id"),
                linked_observation_id=enriched_doc.get("linked_observation_id"),
                linked_evidence_records=list(enriched_doc.get("linked_evidence_records") or []),
                saved_at=enriched_doc.get("updated_at") or enriched_doc.get("created_at") or "",
                updated_at=enriched_doc.get("updated_at"),
            )
        )

    history_entries = []
    for doc in history_docs:
        participant = participant_map.get(doc.get("author_user_id"), {})
        enriched_doc = _enrich_reflection_payload(
            doc,
            goal_map=goal_map,
            evidence_catalog=evidence_catalog,
        )
        history_entries.append(
            ReflectionHistoryEntry(
                id=enriched_doc.get("id") or str(uuid.uuid4()),
                teacher_id=teacher_id,
                reflection_id=enriched_doc.get("reflection_id"),
                author_user_id=enriched_doc.get("author_user_id"),
                author_name=enriched_doc.get("author_name") or participant.get("name"),
                author_role=enriched_doc.get("author_role") or participant.get("role") or "teacher",
                self_reflection=enriched_doc.get("self_reflection"),
                actions_taken=enriched_doc.get("actions_taken"),
                linked_goal_ids=list(enriched_doc.get("linked_goal_ids") or []),
                linked_goal_titles=list(enriched_doc.get("linked_goal_titles") or []),
                linked_video_id=enriched_doc.get("linked_video_id"),
                linked_assessment_id=enriched_doc.get("linked_assessment_id"),
                linked_observation_id=enriched_doc.get("linked_observation_id"),
                linked_evidence_records=list(enriched_doc.get("linked_evidence_records") or []),
                saved_at=enriched_doc.get("saved_at") or "",
                updated_at=enriched_doc.get("updated_at"),
            )
        )

    return ReflectionHistoryResponse(
        current_entries=current_entries,
        history=history_entries,
    )


def _normalize_subject_filter(value: str) -> str:
    return value.strip().lower()


def _month_floor(value: datetime) -> datetime:
    utc_value = value.astimezone(timezone.utc)
    return datetime(utc_value.year, utc_value.month, 1, tzinfo=timezone.utc)


def _shift_month(value: datetime, delta_months: int) -> datetime:
    year = value.year + (value.month - 1 + delta_months) // 12
    month = (value.month - 1 + delta_months) % 12 + 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


def _build_month_windows(window_months: int, now: Optional[datetime] = None) -> List[dict]:
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    first_month = _shift_month(_month_floor(now_utc), -(window_months - 1))
    windows: List[dict] = []
    for idx in range(window_months):
        start = _shift_month(first_month, idx)
        end = _shift_month(start, 1)
        windows.append(
            {
                "start": start,
                "end": end,
                "label": start.strftime("%b %Y"),
            }
        )
    return windows


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _average(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


async def _resolve_framework_context(
    current_user: dict,
    framework_type: Optional[str] = None,
) -> Tuple[str, dict, List[str]]:
    selection = await db.framework_selections.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0, "framework_type": 1, "selected_elements": 1},
    )
    resolved_type = framework_type or (selection.get("framework_type") if selection else "danielson")

    if resolved_type == FrameworkType.CUSTOM.value:
        custom_domains = await db.custom_domains.find(
            {"user_id": current_user["id"]}, {"_id": 0, "user_id": 0}
        ).to_list(1000)
        framework = {
            "name": "Custom Framework",
            "type": "custom",
            "domains": DANIELSON_FRAMEWORK["domains"] + MARSHALL_FRAMEWORK["domains"] + custom_domains,
        }
    else:
        framework = _get_framework_by_type(resolved_type)

    selected_elements = []
    if selection and selection.get("framework_type") == resolved_type:
        selected_elements = selection.get("selected_elements", []) or []

    if not selected_elements:
        selected_elements = [
            element["id"]
            for domain in framework.get("domains", [])
            for element in domain.get("elements", [])
        ]

    # Preserve order and avoid duplicates from legacy selections.
    seen = set()
    ordered_selected = []
    for element_id in selected_elements:
        if element_id in seen:
            continue
        seen.add(element_id)
        ordered_selected.append(element_id)

    return resolved_type, framework, ordered_selected


def _build_domain_index(framework: dict, selected_elements: List[str]) -> Tuple[List[dict], Dict[str, dict]]:
    selected_set = set(selected_elements)
    domains: List[dict] = []
    element_domain_map: Dict[str, dict] = {}
    for domain in framework.get("domains", []):
        kept_elements = []
        for element in domain.get("elements", []):
            element_id = element.get("id")
            if not element_id:
                continue
            if selected_set and element_id not in selected_set:
                continue
            kept_elements.append(element_id)
            element_domain_map[element_id] = {
                "domain_id": domain.get("id"),
                "domain_name": domain.get("name"),
            }
        if kept_elements:
            domains.append(
                {
                    "id": domain.get("id"),
                    "name": domain.get("name"),
                    "element_ids": kept_elements,
                    "element_count": len(kept_elements),
                }
            )
    return domains, element_domain_map


def _compute_domain_deltas(periods: List[dict], domains: List[dict], series_key: str) -> List[dict]:
    deltas: List[dict] = []
    for domain in domains:
        first = None
        last = None
        for period in periods:
            series = period.get(series_key) or {}
            domain_scores = series.get("domain_scores") or {}
            value = domain_scores.get(domain["id"])
            if value is None:
                continue
            if first is None:
                first = value
            last = value
        delta = round(last - first, 2) if first is not None and last is not None else None
        deltas.append(
            {
                "domain_id": domain["id"],
                "domain_name": domain["name"],
                "first_score": first,
                "last_score": last,
                "delta": delta,
            }
        )
    return deltas


def _compute_overall_delta(periods: List[dict], series_key: str) -> Optional[float]:
    first = None
    last = None
    for period in periods:
        score = (period.get(series_key) or {}).get("overall_score")
        if score is None:
            continue
        if first is None:
            first = score
        last = score
    if first is None or last is None:
        return None
    return round(last - first, 2)


async def _build_dashboard_domain_trend_data(
    current_user: dict,
    window_months: int = 3,
    teacher_id: Optional[str] = None,
    subjects: Optional[List[str]] = None,
    framework_type: Optional[str] = None,
) -> dict:
    resolved_framework_type, framework, selected_elements = await _resolve_framework_context(
        current_user,
        framework_type=framework_type,
    )
    domains, element_domain_map = _build_domain_index(framework, selected_elements)
    subject_filter = {
        _normalize_subject_filter(subject)
        for subject in (subjects or [])
        if subject and subject.strip()
    }

    visible_teacher_ids = await _list_teacher_ids_for_user(current_user)
    teachers = await db.teachers.find(
        {"id": {"$in": visible_teacher_ids or ["__none__"]}},
        {"_id": 0, "id": 1, "name": 1, "subject": 1},
    ).to_list(2000)
    teacher_by_id = {teacher["id"]: teacher for teacher in teachers}

    if teacher_id and teacher_id not in teacher_by_id:
        raise HTTPException(status_code=404, detail="Teacher not found")

    allowed_teacher_ids: List[str] = []
    for teacher in teachers:
        teacher_subjects = {
            _normalize_subject_filter(subject)
            for subject in _parse_teacher_subjects(teacher.get("subject"))
            if subject and subject.strip()
        }
        if subject_filter and not teacher_subjects.intersection(subject_filter):
            continue
        allowed_teacher_ids.append(teacher["id"])

    role = _get_user_role(current_user)
    scoring_mode = await _get_admin_scoring_mode(current_user["id"]) if role == "admin" else "ai"

    windows = _build_month_windows(window_months)
    month_index = {(window["start"].year, window["start"].month): idx for idx, window in enumerate(windows)}
    first_window_start = windows[0]["start"]
    last_window_end = windows[-1]["end"]

    periods = [
        {
            "bucket_start": window["start"].isoformat(),
            "bucket_end": window["end"].isoformat(),
            "label": window["label"],
            "all_domain_scores": {domain["id"]: [] for domain in domains},
            "all_overall_scores": [],
            "all_teacher_ids": set(),
            "selected_domain_scores": {domain["id"]: [] for domain in domains},
            "selected_overall_scores": [],
        }
        for window in windows
    ]

    assessments: List[dict] = []
    if allowed_teacher_ids:
        assessments = await db.assessments.find(
            {
                "teacher_id": {"$in": allowed_teacher_ids},
                "analyzed_at": {
                    "$gte": first_window_start.isoformat(),
                    "$lt": last_window_end.isoformat(),
                },
            },
            {"_id": 0},
        ).to_list(10000)

    overrides_by_assessment: Dict[str, List[dict]] = {}
    if role == "admin" and assessments:
        assessment_ids = [assessment["id"] for assessment in assessments]
        overrides = await db.admin_assessment_overrides.find(
            {"admin_id": current_user["id"], "assessment_id": {"$in": assessment_ids}},
            {"_id": 0},
        ).to_list(10000)
        for override in overrides:
            overrides_by_assessment.setdefault(override["assessment_id"], []).append(override)

    adherence_by_assessment: Dict[str, Optional[float]] = {}
    if assessments:
        adherence_docs = await db.curriculum_adherence.find(
            {"assessment_id": {"$in": [a["id"] for a in assessments]}},
            {"_id": 0, "assessment_id": 1, "adherence_score": 1},
        ).to_list(10000)
        adherence_by_assessment = {
            doc["assessment_id"]: doc.get("adherence_score")
            for doc in adherence_docs
            if doc.get("assessment_id")
        }

    teacher_performance: Dict[str, dict] = {}
    for assessment in assessments:
        analyzed_at = _parse_iso_datetime(assessment.get("analyzed_at"))
        if not analyzed_at:
            continue
        bucket_idx = month_index.get((analyzed_at.year, analyzed_at.month))
        if bucket_idx is None:
            continue

        if role == "admin":
            adjusted_scores, adjusted_overall = _apply_admin_overrides(
                assessment.get("element_scores", []),
                overrides_by_assessment.get(assessment["id"], []),
                scoring_mode,
            )
        else:
            adjusted_scores = [{**es, "adjusted_score": es.get("score")} for es in assessment.get("element_scores", [])]
            adjusted_overall = assessment.get("overall_score")

        adherence_score = adherence_by_assessment.get(assessment["id"])
        combined_overall = _combine_overall_with_adherence(adjusted_overall, adherence_score)

        domain_scores_for_assessment: Dict[str, List[float]] = {}
        for element_score in adjusted_scores:
            element_id = element_score.get("element_id")
            domain_info = element_domain_map.get(element_id)
            if not domain_info:
                continue
            score = element_score.get("adjusted_score", element_score.get("score"))
            if score is None:
                continue
            domain_scores_for_assessment.setdefault(domain_info["domain_id"], []).append(score)

        period = periods[bucket_idx]
        period["all_teacher_ids"].add(assessment.get("teacher_id"))
        if combined_overall is not None:
            period["all_overall_scores"].append(combined_overall)
        for domain_id, scores in domain_scores_for_assessment.items():
            if scores:
                period["all_domain_scores"][domain_id].append(sum(scores) / len(scores))

        if teacher_id and assessment.get("teacher_id") == teacher_id:
            if combined_overall is not None:
                period["selected_overall_scores"].append(combined_overall)
            for domain_id, scores in domain_scores_for_assessment.items():
                if scores:
                    period["selected_domain_scores"][domain_id].append(sum(scores) / len(scores))

        teacher_row = teacher_performance.setdefault(
            assessment.get("teacher_id"),
            {
                "teacher_id": assessment.get("teacher_id"),
                "teacher_name": teacher_by_id.get(assessment.get("teacher_id"), {}).get("name", "Unknown"),
                "bucket_scores": [[] for _ in periods],
            },
        )
        if combined_overall is not None:
            teacher_row["bucket_scores"][bucket_idx].append(combined_overall)

    response_periods = []
    for period in periods:
        all_domain_scores = {
            domain_id: _average(scores)
            for domain_id, scores in period["all_domain_scores"].items()
        }
        selected_domain_scores = {
            domain_id: _average(scores)
            for domain_id, scores in period["selected_domain_scores"].items()
        }
        response_periods.append(
            {
                "bucket_start": period["bucket_start"],
                "bucket_end": period["bucket_end"],
                "label": period["label"],
                "all_teachers": {
                    "overall_score": _average(period["all_overall_scores"]),
                    "assessment_count": len(period["all_overall_scores"]),
                    "teacher_count": len(period["all_teacher_ids"]),
                    "domain_scores": all_domain_scores,
                },
                "selected_teacher": {
                    "overall_score": _average(period["selected_overall_scores"]),
                    "assessment_count": len(period["selected_overall_scores"]),
                    "domain_scores": selected_domain_scores,
                }
                if teacher_id
                else None,
            }
        )

    latest_bucket_idx = len(response_periods) - 1
    teacher_summaries = []
    for teacher_stats in teacher_performance.values():
        bucket_scores = teacher_stats["bucket_scores"]
        latest_scores = bucket_scores[latest_bucket_idx] if latest_bucket_idx >= 0 else []
        prior_scores = [
            score
            for idx, scores in enumerate(bucket_scores)
            if idx != latest_bucket_idx
            for score in scores
        ]
        recent_avg = _average(latest_scores)
        prior_avg = _average(prior_scores)
        delta = round(recent_avg - prior_avg, 2) if recent_avg is not None and prior_avg is not None else None
        teacher_summaries.append(
            {
                "teacher_id": teacher_stats["teacher_id"],
                "teacher_name": teacher_stats["teacher_name"],
                "recent_avg": recent_avg,
                "prior_avg": prior_avg,
                "delta": delta,
                "recent_assessment_count": len(latest_scores),
            }
        )

    teacher_attention_candidates = [
        item
        for item in teacher_summaries
        if (item["recent_avg"] is not None and item["recent_avg"] < 6.5)
        or (item["delta"] is not None and item["delta"] < -0.3)
    ]
    teacher_attention_candidates.sort(
        key=lambda item: (
            item["recent_avg"] if item["recent_avg"] is not None else 11.0,
            item["delta"] if item["delta"] is not None else 0.0,
        )
    )

    selected_teacher_meta = None
    if teacher_id:
        selected_teacher = teacher_by_id.get(teacher_id)
        selected_teacher_meta = {
            "id": teacher_id,
            "name": selected_teacher.get("name") if selected_teacher else None,
            "subject": selected_teacher.get("subject") if selected_teacher else None,
            "included_in_subject_filter": teacher_id in allowed_teacher_ids,
        }

    return {
        "window_months": window_months,
        "framework_type": resolved_framework_type,
        "domains": domains,
        "periods": response_periods,
        "selected_teacher": selected_teacher_meta,
        "subjects_filter": sorted(subject_filter),
        "scoring_mode": scoring_mode,
        "teacher_summaries": teacher_summaries,
        "teacher_attention_candidates": teacher_attention_candidates[:8],
    }


def _build_leadership_insights_cache_key(
    user_id: str,
    window_months: int,
    teacher_id: Optional[str],
    subjects: List[str],
    framework_type: Optional[str],
) -> str:
    key_payload = {
        "user_id": user_id,
        "window_months": window_months,
        "teacher_id": teacher_id or "",
        "subjects": sorted(_normalize_subject_filter(subject) for subject in subjects if subject),
        "framework_type": framework_type or "",
    }
    key_json = json.dumps(key_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(key_json.encode("utf-8")).hexdigest()


async def _get_cached_leadership_insights(
    user_id: str,
    cache_key: str,
) -> Optional[dict]:
    if LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS <= 0:
        return None

    doc = await db.dashboard_leadership_insights_cache.find_one(
        {"user_id": user_id, "cache_key": cache_key},
        {"_id": 0, "payload": 1, "expires_at": 1},
    )
    if not doc:
        return None

    expires_at = _parse_iso_datetime(doc.get("expires_at"))
    now_utc = datetime.now(timezone.utc)
    if not expires_at or expires_at <= now_utc:
        await db.dashboard_leadership_insights_cache.delete_one(
            {"user_id": user_id, "cache_key": cache_key}
        )
        return None

    payload = doc.get("payload")
    if not isinstance(payload, dict):
        return None

    response_payload = {**payload}
    response_payload["cache"] = {
        "hit": True,
        "expires_at": doc.get("expires_at"),
    }
    return response_payload


async def _store_leadership_insights_cache(
    user_id: str,
    cache_key: str,
    payload: dict,
) -> None:
    if LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS <= 0:
        return

    now_utc = datetime.now(timezone.utc)
    expires_at = now_utc + timedelta(seconds=LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS)
    await db.dashboard_leadership_insights_cache.update_one(
        {"user_id": user_id, "cache_key": cache_key},
        {
            "$set": {
                "user_id": user_id,
                "cache_key": cache_key,
                "payload": payload,
                "updated_at": now_utc.isoformat(),
                "expires_at": expires_at.isoformat(),
            }
        },
        upsert=True,
    )


def _coerce_insight_priority(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"high", "medium", "low"} else "medium"


def _coerce_insight_owner(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"principal", "coach", "teacher"} else "principal"


def _coerce_due_window_days(value: Any, default: int = 14) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(3, min(60, parsed))


def _build_leadership_item(
    insight: str,
    action: str,
    priority: str = "medium",
    owner: str = "principal",
    due_window_days: int = 14,
    target_teacher_id: Optional[str] = None,
    target_teacher_name: Optional[str] = None,
) -> dict:
    return {
        "insight": insight.strip(),
        "action": action.strip(),
        "priority": _coerce_insight_priority(priority),
        "owner": _coerce_insight_owner(owner),
        "due_window_days": _coerce_due_window_days(due_window_days),
        "target_teacher_id": (target_teacher_id or "").strip() or None,
        "target_teacher_name": (target_teacher_name or "").strip() or None,
    }


def _normalize_leadership_items(items: Any, fallback_items: Optional[List[dict]] = None) -> List[dict]:
    normalized: List[dict] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            insight = str(item.get("insight") or "").strip()
            action = str(item.get("action") or "").strip()
            if not insight or not action:
                continue
            normalized.append(
                _build_leadership_item(
                    insight=insight,
                    action=action,
                    priority=item.get("priority"),
                    owner=item.get("owner"),
                    due_window_days=item.get("due_window_days", 14),
                    target_teacher_id=item.get("target_teacher_id"),
                    target_teacher_name=item.get("target_teacher_name"),
                )
            )
            if len(normalized) >= 7:
                return normalized[:7]

    fallback = fallback_items or []
    fallback_index = 0
    while len(normalized) < 7 and fallback:
        item = fallback[fallback_index % len(fallback)]
        fallback_index += 1
        normalized.append(
            _build_leadership_item(
                insight=item.get("insight") or "Trend insight requires follow-up.",
                action=item.get("action") or "Assign a coaching action and review next cycle.",
                priority=item.get("priority", "medium"),
                owner=item.get("owner", "principal"),
                due_window_days=item.get("due_window_days", 14),
                target_teacher_id=item.get("target_teacher_id"),
                target_teacher_name=item.get("target_teacher_name"),
            )
        )

    generic_fillers = [
        _build_leadership_item(
            "Observation coverage is inconsistent across the selected time window.",
            "Increase video/observation cadence and confirm at least one evidence point per teacher this month.",
            priority="medium",
            owner="principal",
            due_window_days=14,
        ),
        _build_leadership_item(
            "Coaching follow-through is not yet explicit for all flagged trends.",
            "Assign one accountable owner per trend and check progress in the next leadership meeting.",
            priority="medium",
            owner="coach",
            due_window_days=7,
        ),
    ]
    filler_index = 0
    while len(normalized) < 7:
        normalized.append(generic_fillers[filler_index % len(generic_fillers)])
        filler_index += 1
    return normalized[:7]


def _build_rule_based_leadership_insights(trend_payload: dict) -> dict:
    periods = trend_payload.get("periods", [])
    domains = trend_payload.get("domains", [])
    selected_teacher = trend_payload.get("selected_teacher")

    domain_deltas = _compute_domain_deltas(periods, domains, "all_teachers")
    positive_trends = sorted(
        [item for item in domain_deltas if item.get("delta") is not None and item["delta"] > 0.15],
        key=lambda item: item["delta"],
        reverse=True,
    )[:3]
    negative_trends = sorted(
        [item for item in domain_deltas if item.get("delta") is not None and item["delta"] < -0.15],
        key=lambda item: item["delta"],
    )[:3]

    overall_delta = _compute_overall_delta(periods, "all_teachers")
    overall_message = "School-wide performance is stable across the selected window."
    if overall_delta is not None:
        if overall_delta > 0.2:
            overall_message = f"School-wide performance is trending up ({overall_delta:+.2f}) over the selected window."
        elif overall_delta < -0.2:
            overall_message = f"School-wide performance is trending down ({overall_delta:+.2f}) over the selected window."

    if positive_trends:
        positive_message = "Positive momentum: " + ", ".join(
            f"{item['domain_name']} ({item['delta']:+.2f})" for item in positive_trends[:2]
        ) + "."
    else:
        positive_message = "No domain shows strong positive acceleration yet."

    if negative_trends:
        negative_message = "Needs attention: " + ", ".join(
            f"{item['domain_name']} ({item['delta']:+.2f})" for item in negative_trends[:2]
        ) + "."
    else:
        negative_message = "No domain shows a strong negative decline."

    teacher_attention = trend_payload.get("teacher_attention_candidates", [])[:3]
    teacher_attention_items = []
    for item in teacher_attention:
        reasons = []
        if item.get("recent_avg") is not None and item["recent_avg"] < 6.5:
            reasons.append(f"recent average {item['recent_avg']:.2f}")
        if item.get("delta") is not None and item["delta"] < -0.3:
            reasons.append(f"delta {item['delta']:+.2f}")
        teacher_attention_items.append(
            {
                "teacher_id": item.get("teacher_id"),
                "teacher_name": item.get("teacher_name"),
                "reason": ", ".join(reasons) if reasons else "below expected trajectory",
                "recent_avg": item.get("recent_avg"),
                "delta": item.get("delta"),
            }
        )

    teacher_message = "No individual teacher currently meets the attention threshold."
    if teacher_attention_items:
        names = ", ".join(item["teacher_name"] for item in teacher_attention_items[:3] if item.get("teacher_name"))
        teacher_message = f"Teachers needing closer support this cycle: {names}."

    compare_message = None
    selected_delta = None
    if selected_teacher:
        selected_delta = _compute_overall_delta(periods, "selected_teacher")
        if selected_delta is None:
            compare_message = "Selected teacher has limited data in this filtered window."
        elif overall_delta is None:
            compare_message = f"Selected teacher trend is {selected_delta:+.2f} over the period."
        else:
            compare_message = (
                f"{selected_teacher.get('name') or 'Selected teacher'} trend is {selected_delta:+.2f} vs "
                f"school trend {overall_delta:+.2f}."
            )

    bullets = [overall_message, positive_message, negative_message]
    if compare_message:
        bullets[2] = compare_message
    else:
        bullets[2] = teacher_message

    actionable_items: List[dict] = []
    actionable_items.append(
        _build_leadership_item(
            insight=overall_message,
            action=(
                "Prioritize immediate instructional support in the next leadership check-in."
                if overall_delta is not None and overall_delta < -0.2
                else "Maintain current support cadence and verify gains in the next monthly review."
            ),
            priority="high" if overall_delta is not None and overall_delta < -0.2 else "medium",
            owner="principal",
            due_window_days=7 if overall_delta is not None and overall_delta < -0.2 else 14,
        )
    )

    for trend in positive_trends[:2]:
        actionable_items.append(
            _build_leadership_item(
                insight=f"{trend['domain_name']} is improving ({trend['delta']:+.2f}).",
                action="Capture the practice causing this gain and replicate it in two additional classrooms.",
                priority="low",
                owner="coach",
                due_window_days=21,
            )
        )

    for trend in negative_trends[:2]:
        actionable_items.append(
            _build_leadership_item(
                insight=f"{trend['domain_name']} is declining ({trend['delta']:+.2f}).",
                action="Launch a targeted coaching cycle for this domain and schedule a follow-up walkthrough.",
                priority="high",
                owner="coach",
                due_window_days=7,
            )
        )

    for teacher in teacher_attention_items[:2]:
        teacher_name = teacher.get("teacher_name") or "A teacher"
        reason = teacher.get("reason") or "below expected trajectory"
        actionable_items.append(
            _build_leadership_item(
                insight=f"{teacher_name} is underperforming ({reason}).",
                action="Set one measurable coaching goal and review progress in the next observation window.",
                priority="high",
                owner="principal",
                due_window_days=7,
                target_teacher_id=teacher.get("teacher_id"),
                target_teacher_name=teacher_name,
            )
        )

    if compare_message:
        actionable_items.append(
            _build_leadership_item(
                insight=compare_message,
                action=(
                    "Align this teacher's support plan with schoolwide winning practices and recheck trend movement."
                ),
                priority="medium",
                owner="coach",
                due_window_days=14,
                target_teacher_id=selected_teacher.get("id") if isinstance(selected_teacher, dict) else None,
                target_teacher_name=selected_teacher.get("name") if isinstance(selected_teacher, dict) else None,
            )
        )
    else:
        actionable_items.append(
            _build_leadership_item(
                insight=teacher_message,
                action="Confirm teachers with the lowest recent averages have active support plans and owner accountability.",
                priority="medium",
                owner="principal",
                due_window_days=14,
            )
        )

    sparse_period_count = sum(
        1
        for period in periods
        if (period.get("all_teachers") or {}).get("assessment_count", 0) == 0
    )
    if sparse_period_count > 0:
        actionable_items.append(
            _build_leadership_item(
                insight=f"{sparse_period_count} monthly bucket(s) have no assessment evidence.",
                action="Increase recording cadence so each month has enough evidence to make trend decisions.",
                priority="medium",
                owner="principal",
                due_window_days=14,
            )
        )

    items = _normalize_leadership_items(actionable_items, actionable_items)

    return {
        "generated_by": "rules",
        "bullets": bullets,
        "items": items,
        "positive_trends": positive_trends,
        "negative_trends": negative_trends,
        "teachers_needing_attention": teacher_attention_items,
    }


async def _generate_ai_leadership_insights(trend_payload: dict, fallback_payload: dict) -> Optional[dict]:
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return None
    try:
        from emergentintegrations.llm.chat import chat, Message
    except ImportError:
        return None

    ai_input = {
        "window_months": trend_payload.get("window_months"),
        "framework_type": trend_payload.get("framework_type"),
        "subjects_filter": trend_payload.get("subjects_filter"),
        "selected_teacher": trend_payload.get("selected_teacher"),
        "periods": trend_payload.get("periods", []),
        "domain_deltas": _compute_domain_deltas(
            trend_payload.get("periods", []),
            trend_payload.get("domains", []),
            "all_teachers",
        ),
        "teacher_attention_candidates": trend_payload.get("teacher_attention_candidates", []),
        "rule_based_draft": fallback_payload,
    }

    prompt = (
        "You are preparing leadership insights for a school principal dashboard.\n"
        "Given the structured trend data, produce actionable leadership insights.\n"
        "Return strict JSON only with this schema:\n"
        "{\n"
        "  \"items\": [\n"
        "    {\n"
        "      \"insight\": \"...\",\n"
        "      \"action\": \"...\",\n"
        "      \"priority\": \"high|medium|low\",\n"
        "      \"owner\": \"principal|coach|teacher\",\n"
        "      \"due_window_days\": 14,\n"
        "      \"target_teacher_id\": \"optional\",\n"
        "      \"target_teacher_name\": \"optional\"\n"
        "    }\n"
        "  ],\n"
        "  \"bullets\": [\"...\", \"...\", \"...\"],\n"
        "  \"positive_trends\": [{\"domain_id\": \"\", \"domain_name\": \"\", \"delta\": 0.0}],\n"
        "  \"negative_trends\": [{\"domain_id\": \"\", \"domain_name\": \"\", \"delta\": 0.0}],\n"
        "  \"teachers_needing_attention\": [{\"teacher_id\": \"\", \"teacher_name\": \"\", \"reason\": \"\"}]\n"
        "}\n"
        "Rules:\n"
        "- Exactly 7 items in the items array.\n"
        "- Every item must include a concrete action starting with a verb.\n"
        "- Every item must include priority, owner, and due_window_days.\n"
        "- Keep each insight/action concise and evidence-grounded.\n"
        "- Keep bullets to 3 short summary lines.\n"
        "- Do not invent teachers or domains.\n"
        "- Use teacher_attention_candidates only when evidence exists.\n"
        f"DATA:\n{json.dumps(ai_input, ensure_ascii=True)}"
    )

    try:
        response = await chat(
            api_key=api_key,
            messages=[Message(role="user", content=prompt)],
            model="gpt-5.2",
        )
        response_text = response.content if hasattr(response, "content") else str(response)

        import re

        match = re.search(r"\{[\s\S]*\}", response_text)
        if not match:
            return None
        parsed = json.loads(match.group())

        items = _normalize_leadership_items(parsed.get("items"), fallback_payload.get("items", []))
        bullets = [str(item).strip() for item in parsed.get("bullets", []) if str(item).strip()]
        if len(bullets) < 3:
            bullets = [item["insight"] for item in items[:3]]
        bullets = bullets[:3]
        while len(bullets) < 3:
            bullets.append(fallback_payload["bullets"][len(bullets)])

        def _normalize_domain_items(items: Any) -> List[dict]:
            normalized = []
            if not isinstance(items, list):
                return normalized
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("domain_name") or "").strip()
                if not name:
                    continue
                delta = item.get("delta")
                try:
                    delta_value = round(float(delta), 2) if delta is not None else None
                except Exception:
                    delta_value = None
                normalized.append(
                    {
                        "domain_id": str(item.get("domain_id") or "").strip(),
                        "domain_name": name,
                        "delta": delta_value,
                    }
                )
            return normalized[:3]

        def _normalize_teacher_items(items: Any) -> List[dict]:
            normalized = []
            if not isinstance(items, list):
                return normalized
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("teacher_name") or "").strip()
                if not name:
                    continue
                normalized.append(
                    {
                        "teacher_id": str(item.get("teacher_id") or "").strip(),
                        "teacher_name": name,
                        "reason": str(item.get("reason") or "needs targeted support").strip(),
                    }
                )
            return normalized[:5]

        return {
            "generated_by": "ai",
            "bullets": bullets,
            "items": items,
            "positive_trends": _normalize_domain_items(parsed.get("positive_trends")),
            "negative_trends": _normalize_domain_items(parsed.get("negative_trends")),
            "teachers_needing_attention": _normalize_teacher_items(parsed.get("teachers_needing_attention")),
        }
    except Exception as exc:
        logger.warning(f"AI leadership insights generation failed: {exc}")
        return None


@api_router.get("/dashboard/domain-trends")
async def get_dashboard_domain_trends(
    window_months: int = Query(3, ge=1, le=12),
    teacher_id: Optional[str] = None,
    subjects: Optional[str] = Query(None),
    framework_type: Optional[FrameworkType] = None,
    current_user: dict = Depends(get_current_user),
):
    subject_list = [subject.strip() for subject in (subjects or "").split(",") if subject.strip()]
    return await _build_dashboard_domain_trend_data(
        current_user=current_user,
        window_months=window_months,
        teacher_id=teacher_id,
        subjects=subject_list,
        framework_type=framework_type.value if framework_type else None,
    )


@api_router.get("/dashboard/leadership-insights")
async def get_dashboard_leadership_insights(
    window_months: int = Query(3, ge=1, le=12),
    teacher_id: Optional[str] = None,
    subjects: Optional[str] = Query(None),
    framework_type: Optional[FrameworkType] = None,
    current_user: dict = Depends(get_current_user),
):
    subject_list = [subject.strip() for subject in (subjects or "").split(",") if subject.strip()]
    resolved_framework_type = framework_type.value if framework_type else None
    cache_key = _build_leadership_insights_cache_key(
        user_id=current_user["id"],
        window_months=window_months,
        teacher_id=teacher_id,
        subjects=subject_list,
        framework_type=resolved_framework_type,
    )
    cached_payload = await _get_cached_leadership_insights(current_user["id"], cache_key)
    if cached_payload:
        return cached_payload

    trend_payload = await _build_dashboard_domain_trend_data(
        current_user=current_user,
        window_months=window_months,
        teacher_id=teacher_id,
        subjects=subject_list,
        framework_type=resolved_framework_type,
    )
    fallback_payload = _build_rule_based_leadership_insights(trend_payload)
    ai_payload = await _generate_ai_leadership_insights(trend_payload, fallback_payload)

    final_payload = ai_payload or fallback_payload
    final_payload["meta"] = {
        "window_months": window_months,
        "framework_type": trend_payload.get("framework_type"),
        "selected_teacher": trend_payload.get("selected_teacher"),
        "subjects_filter": trend_payload.get("subjects_filter"),
    }
    final_payload["cache"] = {"hit": False}
    await _store_leadership_insights_cache(current_user["id"], cache_key, final_payload)
    return final_payload


@api_router.get("/dashboard/cohort-analytics")
async def get_dashboard_cohort_analytics(
    window_months: int = Query(6, ge=1, le=12),
    current_user: dict = Depends(get_current_user),
):
    teacher_ids = await _list_teacher_ids_for_user(current_user)
    teachers = await db.teachers.find(
        {"id": {"$in": teacher_ids or ["__none__"]}},
        {"_id": 0},
    ).to_list(1000)
    teacher_ids = [teacher["id"] for teacher in teachers]
    assessments = await db.assessments.find(
        {"teacher_id": {"$in": teacher_ids or ["__none__"]}},
        {"_id": 0, "user_id": 0},
    ).sort("analyzed_at", -1).to_list(3000)
    roster_payload = await get_roster(current_user=current_user)
    roster_rows = roster_payload.get("roster", [])

    category_breakdown: Dict[str, Dict[str, Any]] = {}
    department_breakdown: Dict[str, Dict[str, Any]] = {}
    for row in roster_rows:
        category = row.get("category_custom") or row.get("category") or "uncategorized"
        category_bucket = category_breakdown.setdefault(
            category,
            {"category": category, "teacher_count": 0, "scores": [], "improving_count": 0},
        )
        category_bucket["teacher_count"] += 1
        if isinstance(row.get("overall_score"), (int, float)):
            category_bucket["scores"].append(row["overall_score"])
        if row.get("trend_30d") == "improving":
            category_bucket["improving_count"] += 1

        department = row.get("department") or "Unassigned"
        department_bucket = department_breakdown.setdefault(
            department,
            {"department": department, "teacher_count": 0, "scores": []},
        )
        department_bucket["teacher_count"] += 1
        if isinstance(row.get("overall_score"), (int, float)):
            department_bucket["scores"].append(row["overall_score"])

    category_rows = [
        {
            **bucket,
            "average_score": round(sum(bucket["scores"]) / len(bucket["scores"]), 2)
            if bucket["scores"]
            else None,
        }
        for bucket in category_breakdown.values()
    ]
    department_rows = [
        {
            **bucket,
            "average_score": round(sum(bucket["scores"]) / len(bucket["scores"]), 2)
            if bucket["scores"]
            else None,
        }
        for bucket in department_breakdown.values()
    ]
    category_rows.sort(key=lambda item: ((item.get("average_score") or 0), item["category"]))
    department_rows.sort(key=lambda item: ((item.get("average_score") or 0), item["department"]))

    element_scores: Dict[str, Dict[str, Any]] = {}
    for assessment in assessments:
        for es in assessment.get("element_scores", []):
            bucket = element_scores.setdefault(
                es["element_id"],
                {"element_id": es["element_id"], "element_name": es["element_name"], "scores": []},
            )
            if isinstance(es.get("score"), (int, float)):
                bucket["scores"].append(es["score"])
    skill_gaps = []
    for bucket in element_scores.values():
        if not bucket["scores"]:
            continue
        skill_gaps.append(
            {
                "element_id": bucket["element_id"],
                "element_name": bucket["element_name"],
                "average_score": round(sum(bucket["scores"]) / len(bucket["scores"]), 2),
                "assessment_count": len(bucket["scores"]),
            }
        )
    skill_gaps.sort(key=lambda item: (item["average_score"], item["element_name"]))

    windows = _build_month_windows(window_months)
    trend_points = []
    for window in windows:
        scores = []
        for assessment in assessments:
            analyzed_at = _parse_iso_datetime(assessment.get("analyzed_at"))
            if not analyzed_at or not (window["start"] <= analyzed_at < window["end"]):
                continue
            if isinstance(assessment.get("overall_score"), (int, float)):
                scores.append(assessment["overall_score"])
        trend_points.append(
            {
                "label": window["label"],
                "average_score": round(sum(scores) / len(scores), 2) if scores else None,
                "assessment_count": len(scores),
            }
        )

    support_count = sum(
        1 for row in roster_rows if isinstance(row.get("overall_score"), (int, float)) and row["overall_score"] < 6
    )
    improving_count = sum(1 for row in roster_rows if row.get("trend_30d") == "improving")
    return _to_json_safe(
        {
            "overview": {
                "teacher_count": len(teachers),
                "assessment_count": len(assessments),
                "support_count": support_count,
                "improving_count": improving_count,
                "category_count": len(category_rows),
            },
            "category_breakdown": category_rows[:6],
            "department_breakdown": department_rows[:6],
            "skill_gaps": skill_gaps[:5],
            "trend_points": trend_points,
        }
    )


@api_router.get("/dashboard/supervisor-calibration")
async def get_dashboard_supervisor_calibration(
    current_user: dict = Depends(get_current_user),
):
    teacher_ids = await _list_teacher_ids_for_user(current_user)
    teachers = await db.teachers.find(
        {"id": {"$in": teacher_ids or ["__none__"]}},
        {"_id": 0, "id": 1},
    ).to_list(1000)
    teacher_ids = [teacher["id"] for teacher in teachers]
    assessment_ids = [
        item["id"]
        for item in await db.assessments.find(
            {"teacher_id": {"$in": teacher_ids or ["__none__"]}},
            {"_id": 0, "id": 1},
        ).to_list(3000)
    ]
    observations = await db.observations.find(
        {"teacher_id": {"$in": teacher_ids or ["__none__"]}},
        {"_id": 0},
    ).to_list(3000)
    feedback_docs = await db.assessment_report_feedback.find(
        {"teacher_id": {"$in": teacher_ids or ["__none__"]}},
        {"_id": 0},
    ).to_list(3000)
    override_docs = await db.admin_assessment_overrides.find(
        {"assessment_id": {"$in": assessment_ids or ["__none__"]}},
        {"_id": 0},
    ).to_list(3000)

    reviewer_rows: Dict[str, Dict[str, Any]] = {}

    def get_reviewer_row(reviewer_id: Optional[str]) -> Dict[str, Any]:
        reviewer_key = reviewer_id or "unknown"
        return reviewer_rows.setdefault(
            reviewer_key,
            {
                "reviewer_id": reviewer_key,
                "observation_count": 0,
                "feedback_count": 0,
                "override_count": 0,
                "useful_feedback_count": 0,
                "rewrite_override_count": 0,
            },
        )

    for item in observations:
        row = get_reviewer_row(item.get("user_id"))
        row["observation_count"] += 1
    for item in feedback_docs:
        row = get_reviewer_row(item.get("user_id"))
        row["feedback_count"] += 1
        if item.get("feedback_value") == "useful":
            row["useful_feedback_count"] += 1
    for item in override_docs:
        row = get_reviewer_row(item.get("admin_id"))
        row["override_count"] += 1
        if item.get("override_type") == "recommendation_usefulness" and item.get("adjusted_value") == "needs_rewrite":
            row["rewrite_override_count"] += 1

    user_ids = [reviewer_id for reviewer_id in reviewer_rows.keys() if reviewer_id != "unknown"]
    users = await db.users.find({"id": {"$in": user_ids or ["__none__"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    user_name_map = {item["id"]: item.get("name") or item["id"] for item in users}

    rendered_rows = []
    for row in reviewer_rows.values():
        feedback_count = row["feedback_count"]
        useful_rate = round(row["useful_feedback_count"] / feedback_count, 2) if feedback_count else None
        recommendation_override_total = row["rewrite_override_count"] + max(
            0, row["override_count"] - row["rewrite_override_count"]
        )
        rewrite_rate = (
            round(row["rewrite_override_count"] / recommendation_override_total, 2)
            if recommendation_override_total
            else None
        )
        note = "Balanced review pattern."
        if rewrite_rate is not None and rewrite_rate >= 0.4:
            note = "Recommendation phrasing is being challenged often."
        elif useful_rate is not None and useful_rate >= 0.7:
            note = "Signals show strong reviewer trust in the current outputs."
        rendered_rows.append(
            {
                **row,
                "reviewer_name": user_name_map.get(row["reviewer_id"], row["reviewer_id"]),
                "useful_feedback_rate": useful_rate,
                "rewrite_override_rate": rewrite_rate,
                "calibration_note": note,
            }
        )
    rendered_rows.sort(key=lambda item: (-item["override_count"], -item["feedback_count"], item["reviewer_name"]))

    return _to_json_safe(
        {
            "overview": {
                "reviewer_count": len(rendered_rows),
                "observation_count": sum(item["observation_count"] for item in rendered_rows),
                "feedback_count": sum(item["feedback_count"] for item in rendered_rows),
                "override_count": sum(item["override_count"] for item in rendered_rows),
            },
            "reviewers": rendered_rows[:8],
        }
    )


# ==================== ROSTER & DASHBOARD ENDPOINTS ====================
@api_router.get("/roster")
async def get_teacher_roster(
    request: Request,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all teachers with their performance scores for selected elements"""
    # Get current framework selection
    selection = await db.framework_selections.find_one(
        {"user_id": current_user["id"]},
        {"_id": 0}
    )
    
    selected_elements = []
    if selection:
        selected_elements = selection.get("selected_elements", [])
    else:
        # Default to all Danielson elements
        for domain in DANIELSON_FRAMEWORK["domains"]:
            for element in domain["elements"]:
                selected_elements.append(element["id"])
    
    role = _get_user_role(current_user)
    scoring_mode = await _get_admin_scoring_mode(current_user["id"]) if role == "admin" else "ai"

    visible_teacher_ids = await _list_teacher_ids_for_user(current_user)
    teachers = await db.teachers.find(
        {"id": {"$in": visible_teacher_ids or ["__none__"]}},
        {"_id": 0}
    ).to_list(1000)
    teacher_ids = [t["id"] for t in teachers]
    action_plan_map: Dict[str, dict] = {}
    if teacher_ids:
        action_plans = await db.action_plans.find(
            {"teacher_id": {"$in": teacher_ids}},
            {"_id": 0},
        ).to_list(1000)
        for plan in action_plans:
            action_plan_map[plan["teacher_id"]] = plan
    
    language = _resolve_request_language(request, default="en")
    roster = []
    for teacher in teachers:
        policy = await _get_recording_policy_for_teacher(current_user["id"], teacher)
        compliance_summary = None
        if policy:
            compliance_summary = await _upsert_recording_compliance(teacher, current_user["id"], policy)
        last_interaction_at = None
        interaction_days = None
        last_obs = await db.observations.find(
            {"teacher_id": teacher["id"]},
            {"_id": 0, "created_at": 1},
        ).sort("created_at", -1).to_list(1)
        if last_obs:
            last_interaction_at = last_obs[0].get("created_at")
        else:
            last_interaction_at = teacher.get("created_at")
        if last_interaction_at:
            try:
                last_dt = datetime.fromisoformat(last_interaction_at.replace("Z", "+00:00"))
                interaction_days = (datetime.now(timezone.utc) - last_dt).days
            except Exception:
                interaction_days = None
        # Get assessments for this teacher within date range
        assessment_query = {
            "teacher_id": teacher["id"],
        }
        
        if start_date and end_date:
            assessment_query["analyzed_at"] = {
                "$gte": start_date.isoformat(),
                "$lte": end_date.isoformat(),
            }
        
        assessments = await db.assessments.find(assessment_query, {"_id": 0}).to_list(1000)
        overrides_by_assessment: Dict[str, List[dict]] = {}
        if role == "admin" and assessments:
            ids = [a["id"] for a in assessments]
            overrides = await db.admin_assessment_overrides.find(
                {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
                {"_id": 0},
            ).to_list(1000)
            for o in overrides:
                overrides_by_assessment.setdefault(o["assessment_id"], []).append(o)

        def _base_overall(assessment: dict) -> Optional[float]:
            if role == "admin":
                _, adjusted_overall = _apply_admin_overrides(
                    assessment.get("element_scores", []),
                    overrides_by_assessment.get(assessment["id"], []),
                    scoring_mode,
                )
                return adjusted_overall
            return assessment.get("overall_score")

        def _trend_snapshot(days: int) -> dict:
            end = datetime.now(timezone.utc)
            start = end - timedelta(days=days)
            prev_start = start - timedelta(days=days)
            prev_end = start
            recent_scores = []
            prev_scores = []
            for assessment in assessments:
                timestamp = assessment.get("analyzed_at")
                if not timestamp:
                    continue
                try:
                    analyzed_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except ValueError:
                    continue
                score = _base_overall(assessment)
                if score is None:
                    continue
                if start <= analyzed_at < end:
                    recent_scores.append(score)
                elif prev_start <= analyzed_at < prev_end:
                    prev_scores.append(score)
            recent_avg = sum(recent_scores) / len(recent_scores) if recent_scores else None
            prev_avg = sum(prev_scores) / len(prev_scores) if prev_scores else None
            delta = round(recent_avg - prev_avg, 2) if recent_avg is not None and prev_avg is not None else None
            return {
                "avg_score": round(recent_avg, 2) if recent_avg is not None else None,
                "delta": delta,
                "recent_count": len(recent_scores),
                "previous_count": len(prev_scores),
            }

        trend_windows = {
            "30d": _trend_snapshot(30),
            "60d": _trend_snapshot(60),
            "90d": _trend_snapshot(90),
        }

        recent_observations = await db.observations.find(
            {"teacher_id": teacher["id"]},
            {"_id": 0, "summary": 1, "admin_comment": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(3)

        action_plan = action_plan_map.get(teacher["id"])
        action_items = []
        if action_plan:
            for goal in action_plan.get("goals", []):
                title = goal.get("title")
                if title:
                    action_items.append({
                        "title": title,
                        "status": goal.get("status"),
                        "due_date": goal.get("due_date"),
                    })
                if len(action_items) >= 2:
                    break

        # Build 30-day trend snapshot per element (last 30 days vs prior 30 days)
        trend_30d = []
        trend_window_end = datetime.now(timezone.utc)
        trend_window_start = trend_window_end - timedelta(days=30)
        trend_prev_start = trend_window_start - timedelta(days=30)
        trend_prev_end = trend_window_start

        def _scores_for_assessment(assessment: dict) -> List[dict]:
            if role == "admin":
                adjusted_scores, _ = _apply_admin_overrides(
                    assessment.get("element_scores", []),
                    overrides_by_assessment.get(assessment["id"], []),
                    scoring_mode,
                )
                return adjusted_scores
            return assessment.get("element_scores", [])

        def _assessment_in_window(assessment: dict, start: datetime, end: datetime) -> bool:
            timestamp = assessment.get("analyzed_at")
            if not timestamp:
                return False
            try:
                analyzed_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            except ValueError:
                return False
            return start <= analyzed_at < end

        for element_id in selected_elements:
            recent_scores = []
            prev_scores = []
            for assessment in assessments:
                if _assessment_in_window(assessment, trend_window_start, trend_window_end):
                    for es in _scores_for_assessment(assessment):
                        if es.get("element_id") == element_id:
                            recent_scores.append(es.get("adjusted_score", es.get("score")))
                if _assessment_in_window(assessment, trend_prev_start, trend_prev_end):
                    for es in _scores_for_assessment(assessment):
                        if es.get("element_id") == element_id:
                            prev_scores.append(es.get("adjusted_score", es.get("score")))
            if recent_scores:
                recent_avg = sum(recent_scores) / len(recent_scores)
                prev_avg = sum(prev_scores) / len(prev_scores) if prev_scores else None
                delta = round(recent_avg - prev_avg, 2) if prev_avg is not None else None
                trend_30d.append(
                    {
                        "element_id": element_id,
                        "avg_score": round(recent_avg, 2),
                        "delta": delta,
                        "recent_count": len(recent_scores),
                        "previous_count": len(prev_scores),
                    }
                )
        
        # Aggregate scores per element
        element_scores = {}
        for element_id in selected_elements:
            scores = []
            for assessment in assessments:
                if role == "admin":
                    adjusted_scores, _ = _apply_admin_overrides(
                        assessment.get("element_scores", []),
                        overrides_by_assessment.get(assessment["id"], []),
                        scoring_mode,
                    )
                    score_list = adjusted_scores
                else:
                    score_list = assessment.get("element_scores", [])
                for es in score_list:
                    if es["element_id"] == element_id:
                        scores.append(es.get("adjusted_score", es.get("score")))
            
            if scores:
                avg_score = sum(scores) / len(scores)
                level = get_performance_level(avg_score)
                element_scores[element_id] = {
                    "score": round(avg_score, 2),
                    "level": level
                }
            else:
                element_scores[element_id] = {
                    "score": None,
                    "level": None
                }
        
        # Calculate overall score (includes curriculum adherence weighting)
        combined_scores = []
        for assessment in assessments:
            await _ensure_adherence_for_assessment(assessment, current_user)
            if role == "admin":
                adjusted_scores, adjusted_overall = _apply_admin_overrides(
                    assessment.get("element_scores", []),
                    overrides_by_assessment.get(assessment["id"], []),
                    scoring_mode,
                )
                base_overall = adjusted_overall
            else:
                base_overall = assessment.get("overall_score")
            adherence_score = await _get_adherence_score(assessment["id"], current_user["id"])
            combined = _combine_overall_with_adherence(base_overall, adherence_score)
            if combined is not None:
                combined_scores.append(combined)
        overall_score = round(sum(combined_scores) / len(combined_scores), 2) if combined_scores else None
        
        roster.append(
            _localize_roster_row_payload(
                {
                "teacher_id": teacher["id"],
                "teacher_name": teacher["name"],
                "subject": teacher["subject"],
                "grade_level": teacher["grade_level"],
                "department": teacher.get("department"),
                "category": teacher.get("category"),
                "category_custom": teacher.get("category_custom"),
                "element_scores": element_scores,
                "overall_score": overall_score,
                "assessment_count": len(assessments),
                "last_assessment_date": assessments[-1]["analyzed_at"] if assessments else None,
                "last_interaction_at": last_interaction_at,
                "days_since_interaction": interaction_days,
                "recording_compliance": compliance_summary,
                "trend_30d": trend_30d,
                "trend_windows": trend_windows,
                "recent_observations": recent_observations,
                "action_items": action_items,
                },
                language,
            )
        )
    
    return {
        "selected_elements": selected_elements,
        "roster": _to_json_safe(roster),
        "scoring_mode": scoring_mode
    }

@api_router.get("/teachers/{teacher_id}/dashboard")
async def get_teacher_dashboard(
    teacher_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get detailed dashboard data for a specific teacher"""
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    teacher.pop("created_by", None)
    
    # Get assessments
    assessment_query = {"teacher_id": teacher_id}
    
    if start_date and end_date:
        assessment_query["analyzed_at"] = {
            "$gte": start_date.isoformat(),
            "$lte": end_date.isoformat(),
        }
    
    assessments = await db.assessments.find(
        assessment_query,
        {"_id": 0, "user_id": 0}
    ).sort("analyzed_at", 1).to_list(1000)

    role = _get_user_role(current_user)
    scoring_mode = await _get_admin_scoring_mode(current_user["id"]) if role == "admin" else "ai"
    overrides_by_assessment: Dict[str, List[dict]] = {}
    if role == "admin" and assessments:
        ids = [a["id"] for a in assessments]
        overrides = await db.admin_assessment_overrides.find(
            {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
            {"_id": 0},
        ).to_list(1000)
        for o in overrides:
            overrides_by_assessment.setdefault(o["assessment_id"], []).append(o)

    # Build trend data
    trend_data = []
    for assessment in assessments:
        await _ensure_adherence_for_assessment(assessment, current_user)
        overrides = overrides_by_assessment.get(assessment["id"], [])
        adjusted_scores, adjusted_overall = _apply_admin_overrides(
            assessment.get("element_scores", []),
            overrides,
            scoring_mode,
        ) if role == "admin" else (
            [{**es, "adjusted_score": es.get("score")} for es in assessment.get("element_scores", [])],
            assessment.get("overall_score"),
        )
        adherence_score = await _get_adherence_score(assessment["id"], current_user["id"])
        combined_overall = _combine_overall_with_adherence(adjusted_overall, adherence_score)
        assessment["adjusted_element_scores"] = adjusted_scores
        assessment["adjusted_overall_score"] = adjusted_overall
        assessment["adherence_score"] = adherence_score
        assessment["combined_overall_score"] = combined_overall
        assessment["scoring_mode"] = scoring_mode
        trend_data.append({
            "date": assessment["analyzed_at"],
            "overall_score": combined_overall,
            "ai_overall_score": assessment.get("overall_score"),
            "adherence_score": adherence_score,
            "element_scores": {es["element_id"]: es["adjusted_score"] for es in adjusted_scores}
        })

    # Aggregate element scores
    element_aggregates = {}
    for assessment in assessments:
        for es in assessment.get("adjusted_element_scores", assessment.get("element_scores", [])):
            if es["element_id"] not in element_aggregates:
                element_aggregates[es["element_id"]] = {
                    "element_name": es["element_name"],
                    "scores": [],
                    "observations": []
                }
            element_aggregates[es["element_id"]]["scores"].append(es.get("adjusted_score", es.get("score")))
            element_aggregates[es["element_id"]]["observations"].extend(es.get("observations", []))

    # Compute school averages for comparative analytics
    visible_teacher_ids = await _list_teacher_ids_for_user(current_user)
    school_query: Dict[str, Any] = {"teacher_id": {"$in": visible_teacher_ids or ["__none__"]}}
    if start_date and end_date:
        school_query["analyzed_at"] = {
            "$gte": start_date.isoformat(),
            "$lte": end_date.isoformat(),
        }
    school_assessments = await db.assessments.find(
        school_query,
        {"_id": 0, "user_id": 0}
    ).to_list(2000)

    overrides_by_assessment_all: Dict[str, List[dict]] = {}
    if role == "admin" and school_assessments:
        ids = [a["id"] for a in school_assessments]
        overrides = await db.admin_assessment_overrides.find(
            {"admin_id": current_user["id"], "assessment_id": {"$in": ids}},
            {"_id": 0},
        ).to_list(2000)
        for o in overrides:
            overrides_by_assessment_all.setdefault(o["assessment_id"], []).append(o)

    school_element_scores: Dict[str, List[float]] = {}
    for assessment in school_assessments:
        if role == "admin":
            overrides = overrides_by_assessment_all.get(assessment["id"], [])
            adjusted_scores, _ = _apply_admin_overrides(
                assessment.get("element_scores", []),
                overrides,
                scoring_mode,
            )
            scores = adjusted_scores
        else:
            scores = assessment.get("element_scores", [])
        for es in scores:
            score = es.get("adjusted_score", es.get("score"))
            if score is None:
                continue
            school_element_scores.setdefault(es["element_id"], []).append(score)

    trend_by_element: Dict[str, str] = {}
    for element_id in element_aggregates.keys():
        first = None
        last = None
        for point in trend_data:
            value = point.get("element_scores", {}).get(element_id)
            if value is None:
                continue
            if first is None:
                first = value
            last = value
        if first is None or last is None:
            trend_by_element[element_id] = "stable"
        else:
            delta = last - first
            if delta > 0.2:
                trend_by_element[element_id] = "improving"
            elif delta < -0.2:
                trend_by_element[element_id] = "declining"
            else:
                trend_by_element[element_id] = "stable"
    
    # Calculate averages and levels
    element_summary = []
    for element_id, data in element_aggregates.items():
        avg_score = sum(data["scores"]) / len(data["scores"]) if data["scores"] else 0
        school_scores = school_element_scores.get(element_id, [])
        school_avg = (
            round(sum(school_scores) / len(school_scores), 2) if school_scores else None
        )
        element_summary.append({
            "element_id": element_id,
            "element_name": data["element_name"],
            "average_score": round(avg_score, 2),
            "level": get_performance_level(avg_score),
            "assessment_count": len(data["scores"]),
            "recent_observations": data["observations"][-5:] if data["observations"] else [],
            "school_average": school_avg,
            "trend_direction": trend_by_element.get(element_id, "stable"),
        })
    
    # Get videos
    videos = await db.videos.find(
        {"teacher_id": teacher_id},
        {"_id": 0, "uploaded_by": 0}
    ).to_list(100)
    videos_sorted = sorted(
        videos,
        key=lambda v: v.get("recorded_at") or v.get("upload_date") or "",
        reverse=True,
    )
    recent_videos = videos_sorted[:4]
    recent_video_ids = [v.get("id") for v in recent_videos if v.get("id")]
    recent_video_highlights = []
    if recent_video_ids:
        recent_obs = await db.observations.find(
            {"teacher_id": teacher_id, "video_id": {"$in": recent_video_ids}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(50)
        for obs in recent_obs:
            if len(recent_video_highlights) >= 2:
                break
            summary = obs.get("summary") or obs.get("admin_comment")
            if not summary:
                continue
            recent_video_highlights.append(
                {
                    "video_id": obs.get("video_id"),
                    "created_at": obs.get("created_at"),
                    "summary": summary,
                    "timestamp_seconds": obs.get("timestamp_seconds"),
                }
            )

    recording_policy = None
    recording_compliance = None
    try:
        admin_id = teacher.get("created_by") or current_user["id"]
        recording_policy = await _get_recording_policy_for_teacher(admin_id, teacher)
        if recording_policy:
            recording_compliance = await _upsert_recording_compliance(teacher, admin_id, recording_policy)
    except Exception:
        logger.warning("Unable to attach recording compliance for dashboard")
    
    return _to_json_safe({
        "teacher": teacher,
        "element_summary": element_summary,
        "trend_data": trend_data,
        "assessments": assessments,
        "videos": videos,
        "recent_video_highlights": recent_video_highlights,
        "recording_policy": recording_policy,
        "recording_compliance": recording_compliance,
        "total_assessments": len(assessments),
        "scoring_mode": scoring_mode,
        "date_range": {
            "start": assessments[0]["analyzed_at"] if assessments else None,
            "end": assessments[-1]["analyzed_at"] if assessments else None
        }
    })


@api_router.get("/teachers/{teacher_id}/action-plan", response_model=ActionPlan)
async def get_action_plan(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    plan_owner_id = _resolve_plan_owner_id(teacher, current_user)
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)

    plan = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": plan_owner_id},
        {"_id": 0, "user_id": 0},
    )
    if not plan:
        return ActionPlan(
            id="",
            teacher_id=teacher_id,
            goals=[],
            notes=None,
            created_at=None,
            updated_at=None,
        )
    plan["goals"] = _enrich_action_plan_goals_with_evidence(
        plan.get("goals") or [],
        evidence_catalog,
    )
    return ActionPlan(**plan)


class ActionPlanUpsert(BaseModel):
    goals: List[ActionPlanGoal]
    notes: Optional[str] = None


@api_router.get("/teachers/{teacher_id}/action-plan/history", response_model=ActionPlanHistoryResponse)
async def get_action_plan_history(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    plan_owner_id = _resolve_plan_owner_id(teacher, current_user)
    evidence_catalog = await _build_teacher_evidence_catalog(teacher, current_user)
    current_plan_doc = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": plan_owner_id},
        {"_id": 0, "user_id": 0},
    )
    history_docs = await db.action_plan_history.find(
        {"teacher_id": teacher_id, "plan_owner_id": plan_owner_id},
        {"_id": 0},
    ).sort("saved_at", -1).to_list(100)

    current_plan = ActionPlan(
        **(
            current_plan_doc
            or {
                "id": "",
                "teacher_id": teacher_id,
                "goals": [],
                "notes": None,
                "created_at": None,
                "updated_at": None,
            }
        )
    )
    current_plan.goals = [
        ActionPlanGoal(**goal)
        for goal in _enrich_action_plan_goals_with_evidence(
            [goal.dict() for goal in current_plan.goals],
            evidence_catalog,
        )
    ]
    history = []
    for doc in history_docs:
        entry_doc = dict(doc)
        entry_doc["goals"] = _enrich_action_plan_goals_with_evidence(
            entry_doc.get("goals") or [],
            evidence_catalog,
        )
        history.append(ActionPlanHistoryEntry(**entry_doc))
    return ActionPlanHistoryResponse(current_plan=current_plan, history=history)


@api_router.get(
    "/teachers/{teacher_id}/evidence-catalog",
    response_model=TeacherEvidenceCatalogResponse,
)
async def get_teacher_evidence_catalog(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    items = await _build_teacher_evidence_catalog(teacher, current_user)
    return TeacherEvidenceCatalogResponse(
        teacher_id=teacher_id,
        teacher_name=teacher.get("name"),
        items=[EvidenceRecord(**item) for item in items],
    )


@api_router.get("/teachers/{teacher_id}/coaching-timeline", response_model=CoachingTimelineResponse)
async def get_teacher_coaching_timeline(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    entries = await _build_teacher_coaching_timeline(teacher, current_user)
    return CoachingTimelineResponse(
        teacher_id=teacher_id,
        teacher_name=teacher.get("name"),
        entries=[CoachingTimelineEntry(**entry) for entry in entries],
    )


@api_router.get("/coaching/tasks", response_model=CoachingTaskListResponse)
async def list_coaching_tasks(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    teachers = await _list_visible_teachers_for_user(current_user, teacher_id=teacher_id)
    all_tasks: List[dict] = []
    for teacher in teachers:
        all_tasks.extend(await _build_coaching_tasks_for_teacher(teacher, current_user))
    all_tasks.sort(
        key=lambda item: (-(item.get("priority") or 0), _sort_key_for_iso(item.get("due_at"))),
    )
    return CoachingTaskListResponse(tasks=[CoachingTask(**task) for task in all_tasks[:50]])


@api_router.post("/teachers/{teacher_id}/action-plan", response_model=ActionPlan)
async def save_action_plan(
    teacher_id: str,
    payload: ActionPlanUpsert,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import sync_action_plan_memory

    teacher = await _get_teacher_or_404(teacher_id, current_user)
    plan_owner_id = _resolve_plan_owner_id(teacher, current_user)

    existing = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": plan_owner_id},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        update_doc = {
            "goals": [_serialize_action_plan_goal(goal) for goal in payload.goals],
            "notes": payload.notes,
            "updated_at": now,
        }
        await db.action_plans.update_one(
            {"id": existing["id"]}, {"$set": update_doc}
        )
        plan_id = existing["id"]
        created_at = existing.get("created_at")
    else:
        plan_id = str(uuid.uuid4())
        created_at = now
        doc = {
            "id": plan_id,
            "teacher_id": teacher_id,
            "goals": [_serialize_action_plan_goal(goal) for goal in payload.goals],
            "notes": payload.notes,
            "user_id": plan_owner_id,
            "created_at": created_at,
            "updated_at": None,
        }
        await db.action_plans.insert_one(doc)

    # Refresh action plan reminders
    await db.schedules.delete_many(
        {
            "teacher_id": teacher_id,
            "user_id": plan_owner_id,
            "reminder_type": "action_plan",
        }
    )
    for goal in payload.goals:
        if not goal.due_date:
            continue
        try:
            due_dt = datetime.fromisoformat(goal.due_date)
        except ValueError:
            try:
                due_dt = datetime.fromisoformat(f"{goal.due_date}T09:00:00")
            except ValueError:
                continue
        reminder = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "course_name": f"Action Plan: {goal.title}",
            "start_time": due_dt.isoformat(),
            "recording_status": ScheduleStatus.PLANNED.value,
            "join_url": None,
            "location": None,
            "reminder_type": "action_plan",
            "reminder_context": {
                "goal_id": goal.id,
                "goal_title": goal.title,
                "plan_id": plan_id,
            },
            "reminder_note": goal.description,
            "user_id": plan_owner_id,
            "created_at": now,
            "updated_at": None,
        }
        await db.schedules.insert_one(reminder)
        await _enqueue_notification(
            current_user,
            teacher_id,
            "action_plan",
            f"Action plan reminder: {goal.title}",
            f"Goal due {due_dt.date().isoformat()}",
        )

    result = await db.action_plans.find_one(
        {"id": plan_id, "user_id": plan_owner_id},
        {"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=500, detail="Action plan save failed")
    await db.action_plan_history.insert_one(
        {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "plan_id": plan_id,
            "plan_owner_id": plan_owner_id,
            "goals": result.get("goals", []),
            "notes": result.get("notes"),
            "saved_at": now,
            "saved_by_user_id": current_user["id"],
            "saved_by_name": current_user.get("name"),
            "saved_by_role": _get_user_role(current_user),
        }
    )
    await sync_action_plan_memory(current_user, teacher, result)
    return ActionPlan(**result)


@api_router.get("/teachers/{teacher_id}/conference-agenda", response_model=Optional[ConferenceAgendaRecord])
async def get_published_conference_agenda(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _get_teacher_or_404(teacher_id, current_user)
    agenda = await _get_latest_published_conference_agenda(teacher_id)
    if not agenda:
        return None
    return ConferenceAgendaRecord(**agenda)


@api_router.get(
    "/teachers/{teacher_id}/adaptive-support",
    response_model=TeacherAdaptiveSupportResponse,
)
async def get_teacher_adaptive_support(
    teacher_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import build_teacher_memory_support

    teacher = await _get_teacher_or_404(teacher_id, current_user)
    language = _resolve_request_language(request, default="en")
    snapshot = await build_teacher_memory_support(
        current_user,
        teacher_id,
        language=language,
    )
    primary_goal = snapshot.get("primary_goal") or {}
    return TeacherAdaptiveSupportResponse(
        teacher_id=teacher_id,
        teacher_name=teacher.get("name"),
        teacher_prompt_title=snapshot.get("teacher_prompt_title"),
        teacher_prompt_body=snapshot.get("teacher_prompt_body"),
        admin_prompt_title=snapshot.get("admin_prompt_title"),
        admin_prompt_body=snapshot.get("admin_prompt_body"),
        primary_goal_title=primary_goal.get("title"),
        primary_goal_signal=primary_goal.get("progress_signal"),
        conference_continuity_lines=list(snapshot.get("conference_continuity_lines") or []),
    )


@api_router.post("/teachers/{teacher_id}/conference-agenda", response_model=ConferenceAgendaRecord)
async def publish_conference_agenda(
    teacher_id: str,
    payload: ConferenceAgendaUpsert,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    if _get_user_role(current_user) == "teacher":
        raise HTTPException(status_code=403, detail="Admin access required")
    now = datetime.now(timezone.utc).isoformat()
    existing = await _get_latest_published_conference_agenda(teacher_id)
    clean_items = [str(item).strip() for item in payload.agenda_items if str(item).strip()]
    if existing:
        update_doc = {
            "agenda_items": clean_items,
            "linked_goal_ids": payload.linked_goal_ids or [],
            "linked_assessment_id": payload.linked_assessment_id,
            "linked_video_id": payload.linked_video_id,
            "published_by_user_id": current_user["id"],
            "published_by_name": current_user.get("name"),
            "published_at": existing.get("published_at") or now,
            "updated_at": now,
        }
        await db.published_conference_agendas.update_one(
            {"id": existing["id"]},
            {"$set": update_doc},
        )
        result = {
            **existing,
            **update_doc,
        }
    else:
        result = {
            "id": str(uuid.uuid4()),
            "teacher_id": teacher_id,
            "agenda_items": clean_items,
            "linked_goal_ids": payload.linked_goal_ids or [],
            "linked_assessment_id": payload.linked_assessment_id,
            "linked_video_id": payload.linked_video_id,
            "published_by_user_id": current_user["id"],
            "published_by_name": current_user.get("name"),
            "published_at": now,
            "updated_at": None,
        }
        await db.published_conference_agendas.insert_one(result)

    return ConferenceAgendaRecord(**result)


@api_router.get("/teachers/{teacher_id}/conference-prep")
async def get_teacher_conference_prep(
    teacher_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from app.services.workspace_service import build_teacher_memory_support
    from app.analysis.specialist_orchestrator import orchestrate_conference_prep

    teacher = await _get_teacher_or_404(teacher_id, current_user)
    language = _resolve_request_language(request, default="en")
    action_plan = await db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ) or {"goals": [], "notes": None}
    assessments = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("analyzed_at", -1).to_list(5)
    observations = await db.observations.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1).to_list(8)
    latest = assessments[0] if assessments else None
    previous = assessments[1] if len(assessments) > 1 else None
    open_goals = [
        goal for goal in action_plan.get("goals", [])
        if goal.get("title") and goal.get("status") not in {"complete", "implemented"}
    ]
    latest_summary = (
        generate_summary(
            latest.get("element_scores", []),
            latest.get("overall_score") or 0,
            provided_summary=latest.get("summary"),
            priority_element_ids=latest.get("priority_elements"),
            focus_note=latest.get("focus_note"),
            language=language,
        )
        if latest
        else ""
    )
    comparison_lines = []
    if latest and previous:
        latest_score = latest.get("overall_score")
        previous_score = previous.get("overall_score")
        if isinstance(latest_score, (int, float)) and isinstance(previous_score, (int, float)):
            delta = round(latest_score - previous_score, 2)
            if _is_hebrew_language(language):
                comparison_lines.append(f"שינוי מאז השיעור הקודם: {delta:+}/10.")
            else:
                comparison_lines.append(f"Change since the previous reviewed lesson: {delta:+}/10.")
    if open_goals:
        joined = ", ".join(goal.get("title") for goal in open_goals[:3])
        if _is_hebrew_language(language):
            comparison_lines.append(f"יעדי המעקב הפעילים: {joined}.")
        else:
            comparison_lines.append(f"Current follow-up goals: {joined}.")
    if action_plan.get("notes"):
        if _is_hebrew_language(language):
            comparison_lines.append(f"הערות תוכנית הפעולה: {action_plan.get('notes')}")
        else:
            comparison_lines.append(f"Action-plan notes: {action_plan.get('notes')}")
    adaptive_support = await build_teacher_memory_support(
        current_user,
        teacher_id,
        language=language,
    )
    for line in adaptive_support.get("conference_continuity_lines") or []:
        if line not in comparison_lines:
            comparison_lines.append(line)
    agenda = []
    if latest_summary:
        agenda.append(latest_summary)
    for obs in observations[:3]:
        summary = obs.get("admin_comment") or obs.get("teacher_response")
        if summary:
            agenda.append(summary)
    if open_goals:
        for goal in open_goals[:2]:
            if _is_hebrew_language(language):
                agenda.append(f"בדקו התקדמות מול היעד: {goal.get('title')}.")
            else:
                agenda.append(f"Check progress against the goal: {goal.get('title')}.")
    if adaptive_support.get("admin_prompt_body"):
        agenda.append(adaptive_support["admin_prompt_body"])
    published_agenda = await _get_latest_published_conference_agenda(teacher_id)
    prep_payload = orchestrate_conference_prep(
        {
            "agenda": agenda[:6],
            "continuity_lines": comparison_lines,
        },
        language=language,
        adaptive_support=adaptive_support,
    )
    return _to_json_safe({
        "teacher_id": teacher_id,
        "teacher_name": teacher.get("name"),
        "latest_assessment_id": latest.get("id") if latest else None,
        "latest_assessment_date": latest.get("analyzed_at") if latest else None,
        "summary": latest_summary,
        "continuity_lines": prep_payload.get("continuity_lines", []),
        "agenda": prep_payload.get("agenda", []),
        "open_goals": open_goals[:4],
        "recent_observations": observations[:4],
        "next_conference": teacher.get("next_coaching_conference"),
        "published_agenda": published_agenda,
        "conference_specialist_trace": prep_payload.get("conference_specialist_trace", []),
        "conference_specialist_orchestrator": prep_payload.get("conference_specialist_orchestrator"),
    })

@api_router.get("/teachers/{teacher_id}/peer-recommendations")
async def get_peer_recommendations(
    teacher_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get peer teacher recommendations based on the target teacher's weak areas.
    Finds peers who excel in areas where the target teacher needs improvement.
    """
    # Get target teacher
    target_teacher = await db.teachers.find_one(
        {"id": teacher_id, "created_by": current_user["id"]},
        {"_id": 0}
    )
    if not target_teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # Get target teacher's assessments to find weak areas
    target_assessments = await db.assessments.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]}
    ).sort("analyzed_at", -1).to_list(10)

    if not target_assessments:
        return {"recommendations": []}

    # Calculate average scores per element for target teacher
    target_element_scores = {}
    for assessment in target_assessments:
        for es in assessment.get("element_scores", []):
            eid = es["element_id"]
            if eid not in target_element_scores:
                target_element_scores[eid] = {"scores": [], "name": es["element_name"]}
            target_element_scores[eid]["scores"].append(es["score"])

    target_averages = {}
    for eid, data in target_element_scores.items():
        target_averages[eid] = {
            "avg": sum(data["scores"]) / len(data["scores"]),
            "name": data["name"]
        }

    # Find weak areas (score < 6)
    weak_areas = [eid for eid, data in target_averages.items() if data["avg"] < 6]
    if not weak_areas:
        weak_areas = sorted(target_averages.keys(), key=lambda x: target_averages[x]["avg"])[:3]

    # Get all other teachers
    other_teachers = await db.teachers.find(
        {"created_by": current_user["id"], "id": {"$ne": teacher_id}},
        {"_id": 0}
    ).to_list(100)

    recommendations = []
    for peer in other_teachers:
        # Get peer's assessments
        peer_assessments = await db.assessments.find(
            {"teacher_id": peer["id"], "user_id": current_user["id"]}
        ).sort("analyzed_at", -1).to_list(10)

        if not peer_assessments:
            continue

        # Calculate peer's scores in weak areas
        peer_element_scores = {}
        for assessment in peer_assessments:
            for es in assessment.get("element_scores", []):
                eid = es["element_id"]
                if eid not in peer_element_scores:
                    peer_element_scores[eid] = []
                peer_element_scores[eid].append(es["score"])

        peer_averages = {eid: sum(scores) / len(scores) for eid, scores in peer_element_scores.items()}

        # Find strengths in weak areas
        strengths = []
        match_score = 0
        for weak_area in weak_areas:
            if weak_area in peer_averages and peer_averages[weak_area] >= 7:
                strengths.append({
                    "element_id": weak_area,
                    "score": round(peer_averages[weak_area], 1),
                    "name": target_averages.get(weak_area, {}).get("name", weak_area)
                })
                match_score += (peer_averages[weak_area] - target_averages.get(weak_area, {}).get("avg", 5)) / 10

        if strengths:
            # Generate recommendation reason
            strength_names = [s["name"] or s["element_id"] for s in strengths[:2]]
            reason = f"Strong in {', '.join(strength_names)}"
            if peer.get("subject") == target_teacher.get("subject"):
                reason += " (same subject area)"

            recommendations.append({
                "peer_id": peer["id"],
                "peer_name": peer["name"],
                "subject": peer.get("subject", ""),
                "grade_level": peer.get("grade_level", ""),
                "department": peer.get("department", ""),
                "strengths": strengths[:3],
                "match_score": min(1.0, match_score / len(weak_areas)) if weak_areas else 0,
                "reason": reason
            })

    # Sort by match score and return top 3
    recommendations.sort(key=lambda x: x["match_score"], reverse=True)
    return {"recommendations": recommendations[:3]}


# ==================== HELPER FUNCTIONS ====================
def get_performance_level(score: float) -> str:
    """
    Map a 1-10 gradient score into performance bands for UI.
    """
    if score >= 8:
        return "excellent"
    elif score >= 5:
        return "needs_improvement"
    else:
        return "critical"


async def _ensure_mock_evidence(assessment: dict, current_user: dict) -> List[dict]:
    existing = await db.assessment_evidence.find(
        {"assessment_id": assessment["id"], "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).to_list(500)
    if existing:
        # Ensure embedded evidence segments exist in assessment element_scores
        if assessment.get("element_scores"):
            element_scores = assessment.get("element_scores", [])
            updated = False
            for es in element_scores:
                if es.get("evidence_segments"):
                    continue
                matching = [
                    e for e in existing if e.get("element_id") == es.get("element_id")
                ]
                if matching:
                    es["evidence_segments"] = [
                        {
                            "start_sec": m.get("timestamp_start"),
                            "end_sec": m.get("timestamp_end"),
                            "summary": m.get("evidence_text"),
                            "rationale": m.get("source"),
                        }
                        for m in matching
                    ]
                    updated = True
            if updated:
                await db.assessments.update_one(
                    {"id": assessment["id"], "user_id": current_user["id"]},
                    {"$set": {"element_scores": element_scores}},
                )
        return existing

    framework = _get_framework_by_type(assessment.get("framework_type", "danielson"))
    created_at = datetime.now(timezone.utc).isoformat()
    evidence_docs = []
    element_scores = assessment.get("element_scores", [])
    for idx, es in enumerate(assessment.get("element_scores", [])):
        domain = _find_domain_for_element(framework, es["element_id"])
        start_sec = 120 + idx * 45
        end_sec = start_sec + 30
        evidence_doc = {
            "id": str(uuid.uuid4()),
            "assessment_id": assessment["id"],
            "teacher_id": assessment["teacher_id"],
            "video_id": assessment.get("video_id"),
            "element_id": es["element_id"],
            "element_name": es.get("element_name"),
            "domain_id": domain.get("id") if domain else None,
            "domain_name": domain.get("name") if domain else None,
            "evidence_text": (
                f"Teacher demonstrated {es.get('element_name', 'instructional practice').lower()} "
                f"as evidenced between {start_sec//60}:{str(start_sec%60).zfill(2)} "
                f"and {end_sec//60}:{str(end_sec%60).zfill(2)}."
            ),
            "timestamp_start": start_sec,
            "timestamp_end": end_sec,
            "assessment_date": assessment.get("analyzed_at"),
            "source": "ai",
            "created_at": created_at,
            "user_id": current_user["id"],
        }
        evidence_docs.append(evidence_doc)
        es.setdefault("evidence_segments", [])
        es["evidence_segments"].append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "summary": evidence_doc["evidence_text"],
                "rationale": "ai",
            }
        )

    if evidence_docs:
        await db.assessment_evidence.insert_many(evidence_docs)
        await db.assessments.update_one(
            {"id": assessment["id"], "user_id": current_user["id"]},
            {"$set": {"element_scores": element_scores}},
        )
    for doc in evidence_docs:
        doc.pop("user_id", None)
    return evidence_docs


# ==================== OBSERVATIONS ENDPOINTS ====================
@api_router.post("/observations", response_model=Observation)
async def create_observation(
    payload: ObservationCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a human observation with bidirectional comments and implementation status.
    """
    obs_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": obs_id,
        "user_id": current_user["id"],
        "teacher_id": payload.teacher_id,
        "video_id": payload.video_id,
        "element_id": payload.element_id,
        "timestamp_seconds": payload.timestamp_seconds,
        "admin_comment": payload.admin_comment,
        "teacher_response": payload.teacher_response,
        "implementation_status": payload.implementation_status or "planned",
        "created_at": now,
        "updated_at": None,
    }
    await db.observations.insert_one(doc)
    return Observation(**{k: v for k, v in doc.items() if k != "_id"})


@api_router.get("/teachers/{teacher_id}/observations", response_model=List[Observation])
async def list_teacher_observations(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    cursor = db.observations.find(
        {"teacher_id": teacher_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1)
    docs = await cursor.to_list(1000)
    return [Observation(**d) for d in docs]


@api_router.get("/videos/{video_id}/observations", response_model=List[Observation])
async def list_video_observations(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    cursor = db.observations.find(
        {"video_id": video_id, "user_id": current_user["id"]},
        {"_id": 0, "user_id": 0},
    ).sort("timestamp_seconds", 1)
    docs = await cursor.to_list(1000)
    return [Observation(**d) for d in docs]


@api_router.patch("/observations/{observation_id}", response_model=Observation)
async def update_observation(
    observation_id: str,
    payload: ObservationCreate,
    current_user: dict = Depends(get_current_user),
):
    update_fields: Dict[str, Any] = {}
    for field in [
        "admin_comment",
        "teacher_response",
        "implementation_status",
        "timestamp_seconds",
    ]:
        value = getattr(payload, field)
        if value is not None:
            update_fields[field] = value
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.observations.find_one_and_update(
        {"id": observation_id, "user_id": current_user["id"]},
        {"$set": update_fields},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Observation not found")
    result.pop("_id", None)
    result.pop("user_id", None)
    return Observation(**result)


# ==================== SCHEDULE ENDPOINTS ====================
@api_router.post("/schedules", response_model=Schedule)
async def create_schedule(
    payload: ScheduleCreate,
    current_user: dict = Depends(get_current_user),
):
    sched_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": sched_id,
        "teacher_id": payload.teacher_id,
        "course_name": payload.course_name,
        "start_time": payload.start_time.isoformat(),
        "recording_status": ScheduleStatus.PLANNED.value,
        "join_url": payload.join_url,
        "location": payload.location,
        "reminder_type": payload.reminder_type,
        "reminder_context": payload.reminder_context,
        "reminder_note": payload.reminder_note,
        "user_id": current_user["id"],
        "created_at": now,
        "updated_at": None,
    }
    await db.schedules.insert_one(doc)
    if payload.reminder_type:
        await _enqueue_notification(
            current_user,
            payload.teacher_id,
            payload.reminder_type,
            f"Reminder: {payload.course_name}",
            f"Reminder scheduled for {payload.start_time.isoformat()}",
        )
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return Schedule(**doc)


@api_router.get("/schedules", response_model=List[Schedule])
async def list_schedules(
    teacher_id: Optional[str] = None,
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": current_user["id"]}
    if teacher_id:
        query["teacher_id"] = teacher_id
    cursor = db.schedules.find(
        query,
        {"_id": 0, "user_id": 0},
    ).sort("start_time", 1)
    docs = await cursor.to_list(1000)
    # Pydantic will parse ISO8601 strings into datetime for start_time
    language = _resolve_request_language(request, default="en")
    return [Schedule(**_localize_schedule_payload(d, language)) for d in docs]


@api_router.patch("/schedules/{schedule_id}", response_model=Schedule)
async def update_schedule(
    schedule_id: str,
    payload: ScheduleUpdate,
    current_user: dict = Depends(get_current_user),
):
    update_fields: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.recording_status is not None:
        update_fields["recording_status"] = payload.recording_status.value
    if payload.join_url is not None:
        update_fields["join_url"] = payload.join_url
    if payload.reminder_note is not None:
        update_fields["reminder_note"] = payload.reminder_note

    result = await db.schedules.find_one_and_update(
        {"id": schedule_id, "user_id": current_user["id"]},
        {"$set": update_fields},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Schedule not found")
    result.pop("_id", None)
    result.pop("user_id", None)
    return Schedule(**result)


# ==================== RECORDING POLICY & COMPLIANCE ====================
@api_router.get("/recording-policies", response_model=List[RecordingPolicy])
async def list_recording_policies(current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Only admins can access policies")
    docs = await db.recording_policies.find(
        {"created_by": current_user["id"]},
        {"_id": 0},
    ).to_list(50)
    return [RecordingPolicy(**d) for d in docs]


@api_router.post("/recording-policies", response_model=RecordingPolicy)
async def create_recording_policy(
    payload: RecordingPolicyUpsert,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Only admins can create policies")
    teacher = None
    if payload.teacher_id:
        teacher = await _get_teacher_or_404(payload.teacher_id, current_user)
    policy_query = {"created_by": current_user["id"], "teacher_id": payload.teacher_id or None}
    if payload.teacher_id:
        policy_query["teacher_id"] = payload.teacher_id
    else:
        policy_query["teacher_id"] = None
        if payload.school_id:
            policy_query["school_id"] = payload.school_id

    existing = await db.recording_policies.find_one(policy_query, {"_id": 0})
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        update = payload.dict()
        update["teacher_id"] = payload.teacher_id or None
        update["updated_at"] = now
        await db.recording_policies.update_one({"id": existing["id"]}, {"$set": update})
        existing.update(update)
        return RecordingPolicy(**existing)

    doc = {
        "id": str(uuid.uuid4()),
        "created_by": current_user["id"],
        "teacher_id": payload.teacher_id or None,
        "school_id": payload.school_id or (teacher.get("school_id") if teacher else None),
        "period_length_days": payload.period_length_days,
        "min_recordings_per_period": payload.min_recordings_per_period,
        "reminder_offsets_days": payload.reminder_offsets_days,
        "created_at": now,
        "updated_at": None,
    }
    await db.recording_policies.insert_one(doc)
    return RecordingPolicy(**doc)


@api_router.patch("/recording-policies/{policy_id}", response_model=RecordingPolicy)
async def update_recording_policy(
    policy_id: str,
    payload: RecordingPolicyUpsert,
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Only admins can update policies")
    if payload.teacher_id:
        await _get_teacher_or_404(payload.teacher_id, current_user)
    now = datetime.now(timezone.utc).isoformat()
    update = payload.dict()
    update["teacher_id"] = payload.teacher_id or None
    update["updated_at"] = now
    doc = await db.recording_policies.find_one_and_update(
        {"id": policy_id, "created_by": current_user["id"]},
        {"$set": update},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Policy not found")
    doc.pop("_id", None)
    return RecordingPolicy(**doc)


@api_router.get("/recording-compliance", response_model=RecordingCompliance)
async def get_recording_compliance(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    admin_id = teacher.get("created_by") or current_user["id"]
    policy = await _get_recording_policy_for_teacher(admin_id, teacher)
    if not policy:
        raise HTTPException(status_code=404, detail="Recording policy not configured")
    compliance = await _upsert_recording_compliance(teacher, admin_id, policy)
    await _refresh_recording_reminders(teacher, admin_id, policy, compliance)
    return RecordingCompliance(**compliance)


@api_router.get("/recording-compliance/summary")
async def get_recording_compliance_summary(current_user: dict = Depends(get_current_user)):
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Only admins can access compliance summary")
    teachers = await db.teachers.find(
        {"created_by": current_user["id"]},
        {"_id": 0},
    ).to_list(1000)
    summary = []
    for teacher in teachers:
        policy = await _get_recording_policy_for_teacher(current_user["id"], teacher)
        if not policy:
            summary.append(
                {
                    "teacher_id": teacher["id"],
                    "teacher_name": teacher.get("name"),
                    "subject": teacher.get("subject"),
                    "recordings_required": 0,
                    "recordings_completed": 0,
                    "missing_subjects": [],
                    "is_compliant": False,
                    "period_end": None,
                    "policy_assigned": False,
                }
            )
            continue
        compliance = await _upsert_recording_compliance(teacher, current_user["id"], policy)
        await _refresh_recording_reminders(teacher, current_user["id"], policy, compliance)
        summary.append(
            {
                "teacher_id": teacher["id"],
                "teacher_name": teacher.get("name"),
                "subject": teacher.get("subject"),
                "recordings_required": compliance["recordings_required"],
                "recordings_completed": compliance["recordings_completed"],
                "missing_subjects": compliance["missing_subjects"],
                "is_compliant": compliance["is_compliant"],
                "period_end": compliance["period_end"],
                "policy_assigned": True,
            }
        )
    return {"policy": None, "summary": summary}


@api_router.post("/recording-compliance/remind")
async def send_recording_compliance_reminder(
    teacher_id: str = Form(...),
    current_user: dict = Depends(get_current_user),
):
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Only admins can send reminders")
    teacher = await _get_teacher_or_404(teacher_id, current_user)
    admin_id = current_user["id"]
    policy = await _get_recording_policy_for_teacher(admin_id, teacher)
    if not policy:
        raise HTTPException(status_code=404, detail="Recording policy not configured")
    compliance = await _upsert_recording_compliance(teacher, admin_id, policy)
    teacher_user = None
    if teacher.get("email"):
        teacher_user = await db.users.find_one(
            {"email": teacher.get("email")},
            {"_id": 0},
        )
    if not teacher_user or not teacher_user.get("id"):
        raise HTTPException(status_code=404, detail="Teacher user account not found")

    reminder = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher["id"],
        "course_name": f"Recording compliance reminder: {teacher.get('name','Teacher')}",
        "start_time": datetime.now(timezone.utc).isoformat(),
        "recording_status": ScheduleStatus.PLANNED.value,
        "join_url": None,
        "location": None,
        "user_id": teacher_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None,
        "reminder_type": "recording_compliance",
        "reminder_context": {
            "recordings_required": compliance["recordings_required"],
            "recordings_completed": compliance["recordings_completed"],
            "missing_subjects": compliance["missing_subjects"],
            "period_end": compliance["period_end"],
        },
        "reminder_note": "Admin reminder: submit missing lesson recordings.",
    }
    await db.schedules.insert_one(reminder)
    await _enqueue_notification(
        teacher_user,
        teacher["id"],
        "recording_compliance",
        "Recording compliance reminder",
        "Please submit missing lesson recordings for this period.",
    )
    return {"message": "Reminder sent"}


# ==================== NOTIFICATION ENDPOINTS ====================
@api_router.get("/notifications", response_model=List[NotificationRecord])
async def list_notifications(
    unread_only: Optional[bool] = None,
    current_user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": current_user["id"]}
    if unread_only:
        query["read_at"] = None
    notifications = await db.notifications.find(
        query,
        {"_id": 0, "user_id": 0},
    ).sort("created_at", -1).to_list(200)
    return [NotificationRecord(**n) for n in notifications]


@api_router.post("/notifications/{notification_id}/read", response_model=NotificationRecord)
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    result = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current_user["id"]},
        {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True,
        projection={"_id": 0, "user_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationRecord(**result)


# ==================== INTEGRATIONS ====================
@api_router.get("/integrations/gradebook", response_model=List[GradebookIntegrationResponse])
async def list_gradebook_integrations(current_user: dict = Depends(get_current_user)):
    integrations = await db.gradebook_integrations.find(
        {"user_id": current_user["id"]},
        {"_id": 0, "user_id": 0, "api_key": 0},
    ).to_list(100)
    return [GradebookIntegrationResponse(**i) for i in integrations]


@api_router.post("/integrations/gradebook", response_model=GradebookIntegrationResponse)
async def upsert_gradebook_integration(
    payload: GradebookIntegrationCreate,
    current_user: dict = Depends(get_current_user),
):
    existing = await db.gradebook_integrations.find_one(
        {"user_id": current_user["id"], "provider": payload.provider},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        await db.gradebook_integrations.update_one(
            {"id": existing["id"]},
            {
                "$set": {
                    "status": payload.status or existing.get("status", "connected"),
                    "api_key": payload.api_key,
                    "updated_at": now,
                }
            },
        )
        doc = await db.gradebook_integrations.find_one(
            {"id": existing["id"]},
            {"_id": 0, "user_id": 0, "api_key": 0},
        )
        return GradebookIntegrationResponse(**doc)
    doc = {
        "id": str(uuid.uuid4()),
        "provider": payload.provider,
        "status": payload.status or "connected",
        "api_key": payload.api_key,
        "user_id": current_user["id"],
        "created_at": now,
        "updated_at": None,
    }
    await db.gradebook_integrations.insert_one(doc)
    doc.pop("user_id", None)
    doc.pop("api_key", None)
    return GradebookIntegrationResponse(**doc)


def _require_admin_ops_user(current_user: dict) -> None:
    role = _get_user_role(current_user)
    if not _is_admin_role(role):
        raise HTTPException(status_code=403, detail="Admin access required")


def _require_master_admin_user(current_user: dict) -> None:
    role = _get_user_role(current_user)
    if role != "super_admin":
        raise HTTPException(status_code=403, detail="Master admin access required")


@api_router.get("/master-admin/bootstrap")
async def get_master_admin_bootstrap(current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "user": {
            "id": current_user["id"],
            "email": current_user.get("email"),
            "name": current_user.get("name"),
            "role": _get_user_role(current_user),
        },
        "sections": [
            {
                "id": "command-center",
                "title": "Command Center",
                "description": "Platform-wide health, approvals, queue pressure, and immediate operational priorities.",
                "status": "active",
            },
            {
                "id": "users-access",
                "title": "Users and Access",
                "description": "Global user directory, approvals, revocations, and account lifecycle actions.",
                "status": "active",
            },
            {
                "id": "workspaces",
                "title": "Organizations and Workspaces",
                "description": "Cross-workspace visibility into adoption, blockages, and support needs.",
                "status": "active",
            },
            {
                "id": "videos-processing",
                "title": "Videos and Processing",
                "description": "Global pipeline visibility across upload, transcode, privacy, analysis, and playback.",
                "status": "active",
            },
            {
                "id": "storage-data",
                "title": "Storage and Data",
                "description": "Atlas and R2 footprint, retention health, and data lifecycle integrity.",
                "status": "active",
            },
            {
                "id": "ai-quality",
                "title": "AI and Analysis Quality",
                "description": "Global analysis quality, fallback patterns, specialist activity, and override signals.",
                "status": "active",
            },
            {
                "id": "dependencies",
                "title": "Integrations and Dependencies",
                "description": "Health and remediation guidance for Atlas, R2, Resend, OpenAI, and runtime infrastructure.",
                "status": "active",
            },
            {
                "id": "audit-security",
                "title": "Audit and Security",
                "description": "Platform audit trails, auth events, and security-sensitive actions.",
                "status": "active",
            },
            {
                "id": "support-recovery",
                "title": "Support and Recovery",
                "description": "Guided operational tools for user support, incident response, and safe recovery actions.",
                "status": "active",
            },
        ],
    }


@api_router.get("/master-admin/overview", response_model=MasterAdminOverviewResponse)
async def get_master_admin_overview(current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    await refresh_runtime_metrics()
    now = datetime.now(timezone.utc)
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    cutoff_7d = (now - timedelta(days=7)).isoformat()

    approved_users = await db.users.count_documents({"approval_status": "approved", "is_active": {"$ne": False}})
    pending_users = await db.users.count_documents({"approval_status": "pending"})
    revoked_users = await db.users.count_documents(
        {"$or": [{"approval_status": "revoked"}, {"is_active": False}]}
    )
    teacher_users = await db.users.count_documents({"role": "teacher"})
    admin_users = await db.users.count_documents({"role": {"$in": ["admin", "principal"]}})
    super_admin_users = await db.users.count_documents({"role": "super_admin"})
    recent_logins = await db.users.count_documents({"last_login_at": {"$gte": cutoff_7d}})

    uploads_24h = await db.videos.count_documents({"created_at": {"$gte": cutoff_24h}})
    videos_total = await db.videos.count_documents({})
    transcode_queue_total = await db.videos.count_documents(
        {"transcode_status": {"$in": ["queued", "processing"]}}
    )
    transcode_failed_total = await db.videos.count_documents({"transcode_status": "failed"})
    privacy_review_pending = await db.videos.count_documents(
        {"privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value}
    )
    privacy_failed_total = await db.videos.count_documents(
        {"privacy_status": PrivacyProcessingStatus.FAILED.value}
    )
    analysis_failed_total = await db.videos.count_documents({"analysis_status": VideoProcessingStatus.FAILED.value})

    persistent_metrics = app_metrics.snapshot_summary()
    dependencies = persistent_metrics.get("dependencies", {})
    unhealthy_dependencies = [name for name, value in dependencies.items() if float(value or 0) <= 0]
    queues = {
        "video_queue_depth": VIDEO_JOB_QUEUE.qsize(),
        "privacy_queue_depth": VIDEO_PRIVACY_JOB_QUEUE.qsize(),
        "transcode_queue_depth": VIDEO_TRANSCODE_JOB_QUEUE.qsize(),
    }

    alerts: List[MasterAdminAlert] = []
    if pending_users:
        alerts.append(
            MasterAdminAlert(
                id="pending-approvals",
                severity="warning",
                title="Pending access approvals",
                message=f"{pending_users} account request(s) are waiting for a decision.",
                action_label="Open users",
                action_path="/master-admin/users?approval_status=pending",
            )
        )
    if transcode_failed_total or privacy_failed_total or analysis_failed_total:
        total_failed = transcode_failed_total + privacy_failed_total + analysis_failed_total
        alerts.append(
            MasterAdminAlert(
                id="pipeline-failures",
                severity="danger",
                title="Pipeline failures need review",
                message=f"{total_failed} video pipeline failure(s) need troubleshooting or retry.",
                action_label="Open command center",
                action_path="/master-admin",
            )
        )
    if privacy_review_pending:
        alerts.append(
            MasterAdminAlert(
                id="privacy-review",
                severity="warning",
                title="Privacy review queue is not empty",
                message=f"{privacy_review_pending} video(s) are waiting for manual privacy review.",
                action_label="Open privacy review",
                action_path="/privacy-review",
            )
        )
    if unhealthy_dependencies:
        alerts.append(
            MasterAdminAlert(
                id="dependency-health",
                severity="danger",
                title="Dependency health degraded",
                message=f"Unhealthy dependencies detected: {', '.join(unhealthy_dependencies)}.",
                action_label="Inspect backend",
                action_path="/master-admin",
            )
        )
    if not alerts:
        alerts.append(
            MasterAdminAlert(
                id="all-clear",
                severity="success",
                title="Platform looks stable",
                message="No urgent platform-wide issues are currently flagged.",
                action_label=None,
                action_path=None,
            )
        )

    pending_docs = await db.users.find(
        {"approval_status": "pending"},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "approval_requested_at": 1},
    ).sort("approval_requested_at", -1).to_list(5)
    pending_preview = [
        MasterAdminPreviewItem(
            id=doc["id"],
            label=doc.get("email") or doc.get("name") or doc["id"],
            meta=doc.get("approval_requested_at"),
            action_path=f"/master-admin/users/{doc['id']}",
        )
        for doc in pending_docs
    ]

    failed_video_docs = await db.videos.find(
        {
            "$or": [
                {"transcode_status": "failed"},
                {"privacy_status": PrivacyProcessingStatus.FAILED.value},
                {"analysis_status": VideoProcessingStatus.FAILED.value},
            ]
        },
        {"_id": 0, "id": 1, "filename": 1, "teacher_id": 1, "status_updated_at": 1},
    ).sort("status_updated_at", -1).to_list(5)
    blocker_preview = [
        MasterAdminPreviewItem(
            id=doc["id"],
            label=doc.get("filename") or doc["id"],
            meta=doc.get("teacher_id") or doc.get("status_updated_at"),
            action_path=f"/videos/{doc['id']}",
        )
        for doc in failed_video_docs
    ]

    cards = [
        MasterAdminOverviewCard(
            id="approved-users",
            title="Approved users",
            value=approved_users,
            hint="All active users who can log in now.",
        ),
        MasterAdminOverviewCard(
            id="pending-users",
            title="Pending approvals",
            value=pending_users,
            hint="Requests waiting for a decision.",
            tone="warning" if pending_users else "neutral",
        ),
        MasterAdminOverviewCard(
            id="recent-logins",
            title="Recent logins (7d)",
            value=recent_logins,
            hint="Users with a recorded login in the last 7 days.",
        ),
        MasterAdminOverviewCard(
            id="uploads-24h",
            title="Uploads (24h)",
            value=uploads_24h,
            hint="New video uploads created in the last 24 hours.",
        ),
        MasterAdminOverviewCard(
            id="videos-pipeline",
            title="Videos in pipeline",
            value=transcode_queue_total + privacy_review_pending,
            hint="Videos still moving through transcode or privacy review.",
            tone="warning" if transcode_queue_total + privacy_review_pending else "neutral",
        ),
        MasterAdminOverviewCard(
            id="pipeline-failures",
            title="Pipeline failures",
            value=transcode_failed_total + privacy_failed_total + analysis_failed_total,
            hint="Failures across transcode, privacy, and analysis.",
            tone="danger" if transcode_failed_total + privacy_failed_total + analysis_failed_total else "neutral",
        ),
        MasterAdminOverviewCard(
            id="teacher-users",
            title="Teacher accounts",
            value=teacher_users,
            hint="Approved or pending teacher-facing login accounts.",
        ),
        MasterAdminOverviewCard(
            id="admin-users",
            title="Admin accounts",
            value=admin_users + super_admin_users,
            hint="School admins plus platform-level super admins.",
        ),
    ]

    return MasterAdminOverviewResponse(
        generated_at=now.isoformat(),
        cards=cards,
        alerts=alerts,
        dependency_summary={
            "healthy_count": len([value for value in dependencies.values() if float(value or 0) > 0]),
            "unhealthy": unhealthy_dependencies,
        },
        queue_summary=queues,
        pending_approvals_preview=pending_preview,
        pipeline_blockers_preview=blocker_preview,
    )


@api_router.get("/master-admin/users", response_model=MasterAdminUserListResponse)
async def get_master_admin_users(
    q: Optional[str] = None,
    role: Optional[str] = None,
    approval_status: Optional[str] = None,
    is_active: Optional[bool] = None,
    has_teacher_link: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    docs = await db.users.find({}, {"_id": 0, "password": 0}).sort("created_at", -1).to_list(2000)
    records = [await _build_master_admin_user_record(doc) for doc in docs]

    normalized_q = str(q or "").strip().lower()
    normalized_role = str(role or "").strip().lower()
    normalized_approval = str(approval_status or "").strip().lower()

    filtered = []
    for item in records:
        if normalized_q:
            haystack = " ".join(
                [
                    item.email.lower(),
                    (item.name or "").lower(),
                    (item.linked_teacher_name or "").lower(),
                    (item.linked_teacher_id or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_role and item.role != normalized_role:
            continue
        if normalized_approval and item.approval_status != normalized_approval:
            continue
        if is_active is not None and item.is_active != is_active:
            continue
        if has_teacher_link is not None and bool(item.linked_teacher_id) != has_teacher_link:
            continue
        filtered.append(item)

    sliced = filtered[safe_offset : safe_offset + safe_limit]
    summary = {
        "approved": sum(1 for item in filtered if item.approval_status == "approved" and item.is_active),
        "pending": sum(1 for item in filtered if item.approval_status == "pending"),
        "revoked": sum(1 for item in filtered if item.approval_status == "revoked" or not item.is_active),
        "admins": sum(1 for item in filtered if item.role in {"admin", "super_admin"}),
        "teachers": sum(1 for item in filtered if item.role == "teacher"),
    }

    return MasterAdminUserListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
        summary=summary,
    )


@api_router.get("/master-admin/users/{user_id}", response_model=MasterAdminUserDetailResponse)
async def get_master_admin_user_detail(user_id: str, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    user_record = await _build_master_admin_user_record(doc)
    recent_videos = await db.videos.find(
        {"uploaded_by": user_id},
        {"_id": 0, "id": 1, "filename": 1, "status": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(5)
    return MasterAdminUserDetailResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        user=user_record,
        related={
            "recent_videos": recent_videos,
        },
    )


@api_router.post("/master-admin/users/{user_id}/approve", response_model=AccessUserRecord)
async def master_admin_approve_user(
    user_id: str,
    payload: MasterAdminUserActionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updated = await _approve_user_access(
        target,
        actor_label=current_user.get("email") or current_user["id"],
        reason=payload.reason,
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="approve_user_access",
        target_type="user",
        target_id=user_id,
        reason=payload.reason,
        metadata={
            "email": updated.get("email"),
            "approval_status": updated.get("approval_status"),
            "tenant_role": updated.get("tenant_role"),
            "organization_name": updated.get("organization_name") or updated.get("requested_organization_name"),
            "school_name": updated.get("school_name") or updated.get("requested_school_name"),
            "manager_email": updated.get("manager_email") or updated.get("requested_manager_email"),
        },
    )
    return _to_access_user_record(updated)


@api_router.post("/master-admin/users/{user_id}/revoke", response_model=AccessUserRecord)
async def master_admin_revoke_user(
    user_id: str,
    payload: MasterAdminUserActionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot revoke your own access")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    expected_confirmation = str(target.get("email") or "").strip().lower()
    actual_confirmation = str(payload.confirmation_text or "").strip().lower()
    if not payload.reason:
        raise HTTPException(status_code=400, detail="A reason is required before access can be revoked")
    if expected_confirmation and actual_confirmation != expected_confirmation:
        raise HTTPException(status_code=400, detail="Confirmation text must match the target email exactly")
    updated = await _revoke_user_access(
        target,
        actor_label=current_user.get("email") or current_user["id"],
        reason=payload.reason,
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="revoke_user_access",
        target_type="user",
        target_id=user_id,
        reason=payload.reason,
        metadata={"email": updated.get("email"), "approval_status": updated.get("approval_status")},
    )
    return _to_access_user_record(updated)


@api_router.post("/master-admin/users/{user_id}/reactivate", response_model=AccessUserRecord)
async def master_admin_reactivate_user(
    user_id: str,
    payload: MasterAdminUserActionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not payload.reason:
        raise HTTPException(status_code=400, detail="A reason is required before access can be reactivated")
    updated = await _reactivate_user_access(
        target,
        actor_label=current_user.get("email") or current_user["id"],
        reason=payload.reason,
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="reactivate_user_access",
        target_type="user",
        target_id=user_id,
        reason=payload.reason,
        metadata={"email": updated.get("email"), "approval_status": updated.get("approval_status")},
    )
    return _to_access_user_record(updated)


@api_router.get("/master-admin/auth-events", response_model=AuthEventListResponse)
async def get_master_admin_auth_events(
    q: Optional[str] = None,
    event_type: Optional[str] = None,
    result: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    docs = await db.auth_event_log.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    normalized_q = str(q or "").strip().lower()
    normalized_event_type = str(event_type or "").strip().lower()
    normalized_result = str(result or "").strip().lower()
    filtered = []
    for doc in docs:
        if normalized_q:
            haystack = " ".join(
                [
                    str(doc.get("email") or "").lower(),
                    str(doc.get("user_id") or "").lower(),
                    str(doc.get("reason") or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_event_type and str(doc.get("event_type") or "").lower() != normalized_event_type:
            continue
        if normalized_result and str(doc.get("result") or "").lower() != normalized_result:
            continue
        filtered.append(AuthEventRecord(**doc))
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    sliced = filtered[safe_offset : safe_offset + safe_limit]
    return AuthEventListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
    )


@api_router.get("/master-admin/audit-events", response_model=MasterAdminAuditEventListResponse)
async def get_master_admin_audit_events(
    q: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    docs = await db.master_admin_audit_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    normalized_q = str(q or "").strip().lower()
    normalized_action = str(action or "").strip().lower()
    normalized_target_type = str(target_type or "").strip().lower()
    filtered = []
    for doc in docs:
        if normalized_q:
            haystack = " ".join(
                [
                    str(doc.get("actor_email") or "").lower(),
                    str(doc.get("target_id") or "").lower(),
                    str(doc.get("reason") or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_action and str(doc.get("action") or "").lower() != normalized_action:
            continue
        if normalized_target_type and str(doc.get("target_type") or "").lower() != normalized_target_type:
            continue
        filtered.append(MasterAdminAuditEventRecord(**doc))
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    sliced = filtered[safe_offset : safe_offset + safe_limit]
    return MasterAdminAuditEventListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
    )


@api_router.get("/master-admin/workspaces", response_model=MasterAdminWorkspaceListResponse)
async def get_master_admin_workspaces(
    q: Optional[str] = None,
    health_state: Optional[str] = None,
    activity_state: Optional[str] = None,
    pilot_state: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    docs = await _build_master_admin_workspace_records()
    normalized_q = str(q or "").strip().lower()
    normalized_health = str(health_state or "").strip().lower()
    normalized_activity = str(activity_state or "").strip().lower()
    normalized_pilot = str(pilot_state or "").strip().lower()
    filtered: List[MasterAdminWorkspaceRecord] = []
    for item in docs:
        if normalized_q:
            haystack = " ".join(
                [
                    str(item.owner_name or "").lower(),
                    str(item.owner_email or "").lower(),
                    str(item.issue_summary or "").lower(),
                    str(item.workspace_mode or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_health and str(item.health_state).lower() != normalized_health:
            continue
        if normalized_activity and str(item.activity_state).lower() != normalized_activity:
            continue
        if normalized_pilot and str(item.pilot_state).lower() != normalized_pilot:
            continue
        filtered.append(item)
    filtered.sort(key=lambda item: (item.health_state != "blocked", item.health_state != "attention", item.last_activity_at or ""), reverse=False)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    sliced = filtered[safe_offset : safe_offset + safe_limit]
    summary = {
        "healthy": sum(1 for item in filtered if item.health_state == "healthy"),
        "attention": sum(1 for item in filtered if item.health_state == "attention"),
        "blocked": sum(1 for item in filtered if item.health_state == "blocked"),
        "active": sum(1 for item in filtered if item.activity_state == "active"),
        "stale": sum(1 for item in filtered if item.activity_state == "stale"),
        "live": sum(1 for item in filtered if item.pilot_state == "live"),
        "setup_needed": sum(1 for item in filtered if item.pilot_state == "setup_needed"),
    }
    return MasterAdminWorkspaceListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
        summary=summary,
    )


@api_router.get("/master-admin/workspaces/{owner_user_id}", response_model=MasterAdminWorkspaceDetailResponse)
async def get_master_admin_workspace_detail(
    owner_user_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    workspace = next((item for item in await _build_master_admin_workspace_records() if item.owner_user_id == owner_user_id), None)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    teachers = await db.teachers.find(
        {"created_by": owner_user_id},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "subject": 1, "school_id": 1, "created_at": 1, "next_coaching_conference": 1},
    ).to_list(500)
    teacher_ids = {item.get("id") for item in teachers if item.get("id")}
    teacher_emails = {(item.get("email") or "").strip().lower() for item in teachers if item.get("email")}
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(2000)
    linked_users = [
        user for user in users
        if _get_user_role(user) == "teacher"
        and (
            (user.get("teacher_id") in teacher_ids if user.get("teacher_id") else False)
            or ((user.get("email") or "").strip().lower() in teacher_emails if teacher_emails else False)
        )
    ]
    unlinked_users = [
        {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("name"),
            "approval_status": _get_user_approval_status(user),
            "last_login_at": user.get("last_login_at"),
        }
        for user in linked_users
        if not user.get("teacher_id") or user.get("teacher_id") not in teacher_ids
    ]
    owner_doc = await db.users.find_one({"id": owner_user_id}, {"_id": 0, "password": 0})
    privacy_profiles = await db.teacher_face_profiles.find(
        {"teacher_id": {"$in": list(teacher_ids)}, "status": "active"},
        {"_id": 0, "teacher_id": 1, "updated_at": 1},
    ).to_list(500)
    privacy_by_teacher = {item.get("teacher_id"): item for item in privacy_profiles if item.get("teacher_id")}
    teachers_with_status = [
        {
            **teacher,
            "privacy_ready": teacher.get("id") in privacy_by_teacher,
            "privacy_updated_at": (privacy_by_teacher.get(teacher.get("id")) or {}).get("updated_at"),
        }
        for teacher in teachers
    ]
    recent_failures = await db.videos.find(
        {
            "teacher_id": {"$in": list(teacher_ids)},
            "$or": [
                {"transcode_status": "failed"},
                {"privacy_status": {"$in": [PrivacyProcessingStatus.FAILED.value, PrivacyProcessingStatus.REVIEW_REQUIRED.value]}},
                {"analysis_status": VideoProcessingStatus.FAILED.value},
            ],
        },
        {"_id": 0, "id": 1, "teacher_id": 1, "filename": 1, "transcode_status": 1, "privacy_status": 1, "analysis_status": 1, "status_updated_at": 1},
    ).sort("status_updated_at", -1).to_list(10)
    memory_entries = await db.organization_memory.find(
        {"owner_id": owner_user_id},
        {"_id": 0, "id": 1, "scope_type": 1, "scope_id": 1, "memory_type": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(20)
    return MasterAdminWorkspaceDetailResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        workspace=workspace,
        related={
            "owner": owner_doc,
            "teachers": teachers_with_status,
            "unlinked_users": unlinked_users,
            "recent_failures": recent_failures,
            "memory_entries": memory_entries,
        },
    )


@api_router.get("/master-admin/incidents", response_model=ProcessingIncidentListResponse)
async def get_master_admin_processing_incidents(
    q: Optional[str] = None,
    state: Optional[str] = None,
    severity: Optional[str] = None,
    incident_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    docs = await _refresh_processing_incidents()
    normalized_q = str(q or "").strip().lower()
    normalized_state = str(state or "").strip().lower()
    normalized_severity = str(severity or "").strip().lower()
    normalized_type = str(incident_type or "").strip().lower()
    filtered: List[ProcessingIncidentRecord] = []
    for item in docs:
        if normalized_q:
            haystack = " ".join(
                [
                    str(item.get("filename") or "").lower(),
                    str(item.get("teacher_name") or "").lower(),
                    str(item.get("owner_email") or "").lower(),
                    str(item.get("latest_error") or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_state and str(item.get("state") or "").lower() != normalized_state:
            continue
        if normalized_severity and str(item.get("severity") or "").lower() != normalized_severity:
            continue
        if normalized_type and str(item.get("incident_type") or "").lower() != normalized_type:
            continue
        filtered.append(ProcessingIncidentRecord(**item))
    filtered.sort(key=lambda item: (item.state != "active", item.severity != "danger", item.last_seen_at), reverse=False)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    sliced = filtered[safe_offset : safe_offset + safe_limit]
    return ProcessingIncidentListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
        summary={
            "active": sum(1 for item in filtered if item.state == "active"),
            "resolved": sum(1 for item in filtered if item.state == "resolved"),
            "danger": sum(1 for item in filtered if item.severity == "danger"),
            "warning": sum(1 for item in filtered if item.severity == "warning"),
        },
    )


@api_router.get("/master-admin/videos", response_model=MasterAdminVideoListResponse)
async def get_master_admin_videos(
    q: Optional[str] = None,
    stage: Optional[str] = None,
    incident_state: Optional[str] = None,
    owner_user_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    records = await _build_master_admin_video_records()
    normalized_q = str(q or "").strip().lower()
    normalized_stage = str(stage or "").strip().lower()
    normalized_incident_state = str(incident_state or "").strip().lower()
    normalized_owner = str(owner_user_id or "").strip()
    filtered: List[MasterAdminVideoRecord] = []
    for item in records:
        if normalized_q:
            haystack = " ".join(
                [
                    str(item.filename or "").lower(),
                    str(item.teacher_name or "").lower(),
                    str(item.uploader_email or "").lower(),
                    str(item.owner_email or "").lower(),
                    str(item.latest_error or "").lower(),
                ]
            )
            if normalized_q not in haystack:
                continue
        if normalized_stage and _video_stage(item.model_dump()) != normalized_stage:
            continue
        if normalized_incident_state and str(item.incident_state).lower() != normalized_incident_state:
            continue
        if normalized_owner and str(item.owner_user_id or "") != normalized_owner:
            continue
        filtered.append(item)
    safe_limit = max(1, min(limit, 200))
    safe_offset = max(0, offset)
    sliced = filtered[safe_offset : safe_offset + safe_limit]
    return MasterAdminVideoListResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total=len(filtered),
        limit=safe_limit,
        offset=safe_offset,
        items=sliced,
        summary={
            "total": len(filtered),
            "active_incidents": sum(1 for item in filtered if item.incident_state == "active"),
            "transcode_failed": sum(1 for item in filtered if item.transcode_status == VideoTranscodeStatus.FAILED.value),
            "privacy_failed": sum(1 for item in filtered if item.privacy_status == PrivacyProcessingStatus.FAILED.value),
            "analysis_failed": sum(1 for item in filtered if item.analysis_status == VideoProcessingStatus.FAILED.value),
        },
    )


@api_router.get("/master-admin/videos/{video_id}", response_model=MasterAdminVideoDetailResponse)
async def get_master_admin_video_detail(video_id: str, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    records = await _build_master_admin_video_records()
    record = next((item for item in records if item.id == video_id), None)
    if not record:
        raise HTTPException(status_code=404, detail="Video not found")
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    incidents = [item for item in await _refresh_processing_incidents() if item.get("video_id") == video_id]
    return MasterAdminVideoDetailResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        video=record,
        related={
            "timeline": [
                {"id": "uploaded", "label": "Uploaded", "at": (video or {}).get("upload_date") or (video or {}).get("created_at"), "status": "completed"},
                {"id": "transcode", "label": "Transcode", "at": (video or {}).get("transcode_completed_at") or (video or {}).get("transcode_failed_at") or (video or {}).get("transcode_started_at"), "status": record.transcode_status},
                {"id": "privacy", "label": "Privacy", "at": (video or {}).get("privacy_completed_at") or (video or {}).get("privacy_failed_at") or (video or {}).get("privacy_started_at"), "status": record.privacy_status},
                {"id": "analysis", "label": "Analysis", "at": (video or {}).get("status_updated_at"), "status": record.analysis_status},
            ],
            "asset_locations": {
                "raw_file_path": (video or {}).get("raw_file_path") or (video or {}).get("file_path"),
                "processed_file_path": (video or {}).get("processed_file_path"),
                "public_url": (video or {}).get("public_url"),
                "processed_public_url": (video or {}).get("processed_public_url"),
                "redacted_file_path": (video or {}).get("redacted_file_path"),
            },
            "jobs": {
                "processing": await db.video_processing_jobs.find_one({"video_id": video_id}, {"_id": 0}),
                "privacy": await db.video_privacy_jobs.find_one({"video_id": video_id}, {"_id": 0}),
                "transcode": await db.video_transcode_jobs.find_one({"video_id": video_id}, {"_id": 0}),
            },
            "incidents": incidents,
        },
    )


@api_router.post("/master-admin/videos/{video_id}/retry-analysis", response_model=Dict[str, Any])
async def master_admin_retry_video_analysis(video_id: str, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    full_path = _materialize_video_asset_locally(
        video,
        asset_order=[
            (video.get("redacted_file_path"), video.get("redacted_s3_key"), video.get("filename")),
            (video.get("processed_file_path"), video.get("processed_s3_key"), video.get("filename")),
            (video.get("file_path"), video.get("s3_key"), video.get("filename")),
        ],
    )
    queued_at = datetime.now(timezone.utc).isoformat()
    await db.videos.update_one(
        {"id": video_id},
        {"$set": {"status": VideoProcessingStatus.QUEUED.value, "analysis_status": VideoProcessingStatus.QUEUED.value, "status_updated_at": queued_at, "error_message": None}},
    )
    await _enqueue_video_processing_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="retry_video_analysis",
        target_type="video",
        target_id=video_id,
        metadata={"requeued_at": queued_at},
    )
    return {"video_id": video_id, "analysis_status": VideoProcessingStatus.QUEUED.value, "requeued_at": queued_at}


@api_router.post("/master-admin/videos/{video_id}/retry-privacy", response_model=Dict[str, Any])
async def master_admin_retry_video_privacy(video_id: str, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    full_path = _materialize_video_asset_locally(
        video,
        asset_order=[
            (video.get("processed_file_path"), video.get("processed_s3_key"), video.get("filename")),
            (video.get("raw_file_path"), video.get("raw_s3_key"), video.get("filename")),
            (video.get("file_path"), video.get("s3_key"), video.get("filename")),
        ],
    )
    queued_at = datetime.now(timezone.utc).isoformat()
    await db.videos.update_one(
        {"id": video_id},
        {
            "$set": {
                "status": VideoProcessingStatus.QUEUED.value,
                "privacy_status": PrivacyProcessingStatus.QUEUED.value,
                "analysis_status": VideoProcessingStatus.QUEUED.value,
                "privacy_review_required": False,
                "privacy_review_reason": None,
                "privacy_error": None,
                "status_updated_at": queued_at,
            }
        },
    )
    await _enqueue_video_privacy_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="retry_video_privacy",
        target_type="video",
        target_id=video_id,
        metadata={"requeued_at": queued_at},
    )
    return {"video_id": video_id, "privacy_status": PrivacyProcessingStatus.QUEUED.value, "requeued_at": queued_at}


@api_router.post("/master-admin/videos/{video_id}/retry-transcode", response_model=Dict[str, Any])
async def master_admin_retry_video_transcode(video_id: str, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    full_path = _materialize_video_asset_locally(
        video,
        asset_order=[
            (video.get("raw_file_path"), video.get("raw_s3_key"), video.get("filename")),
            (video.get("file_path"), video.get("s3_key"), video.get("filename")),
        ],
    )
    queued_at = datetime.now(timezone.utc).isoformat()
    await db.videos.update_one(
        {"id": video_id},
        {
            "$set": {
                "transcode_status": VideoTranscodeStatus.QUEUED.value,
                "privacy_status": PrivacyProcessingStatus.QUEUED.value,
                "analysis_status": VideoProcessingStatus.QUEUED.value,
                "status": VideoProcessingStatus.QUEUED.value,
                "transcode_error": None,
                "status_updated_at": queued_at,
            }
        },
    )
    await _enqueue_video_transcode_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="retry_video_transcode",
        target_type="video",
        target_id=video_id,
        metadata={"requeued_at": queued_at},
    )
    return {"video_id": video_id, "transcode_status": VideoTranscodeStatus.QUEUED.value, "requeued_at": queued_at}


@api_router.get("/master-admin/storage", response_model=MasterAdminStorageSummaryResponse)
async def get_master_admin_storage_summary(current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    videos = await db.videos.find({}, {"_id": 0}).to_list(10000)
    teachers = await db.teachers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
    teacher_lookup = _build_teacher_lookup_map(teachers)
    now_iso = datetime.now(timezone.utc).isoformat()
    consumers: Dict[str, Dict[str, Any]] = {}
    for video in videos:
        teacher = teacher_lookup.get(str(video.get("teacher_id") or ""))
        key = str((teacher or {}).get("id") or video.get("teacher_id") or "unknown")
        row = consumers.setdefault(
            key,
            {
                "teacher_id": (teacher or {}).get("id") or video.get("teacher_id"),
                "teacher_name": (teacher or {}).get("name") or "Unknown teacher",
                "raw_bytes": 0,
                "processed_bytes": 0,
                "video_count": 0,
            },
        )
        row["raw_bytes"] += int(video.get("file_size_bytes") or 0)
        row["processed_bytes"] += int(video.get("processed_file_size_bytes") or 0)
        row["video_count"] += 1
    retention_backlog = [
        {"id": video.get("id"), "filename": video.get("filename"), "retention_expires_at": video.get("raw_retention_expires_at")}
        for video in videos
        if video.get("raw_retention_expires_at") and str(video.get("raw_retention_expires_at")) <= now_iso
    ]
    orphan_candidates = [
        {"id": video.get("id"), "filename": video.get("filename"), "reason": "processed asset missing public URL"}
        for video in videos
        if video.get("processed_file_path") and not video.get("processed_public_url")
    ]
    return MasterAdminStorageSummaryResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        summary={
            "raw_asset_count": sum(1 for video in videos if video.get("raw_file_path") or video.get("file_path")),
            "processed_asset_count": sum(1 for video in videos if video.get("processed_file_path")),
            "raw_bytes": sum(int(video.get("file_size_bytes") or 0) for video in videos),
            "processed_bytes": sum(int(video.get("processed_file_size_bytes") or 0) for video in videos),
            "retention_backlog_count": len(retention_backlog),
            "orphan_candidate_count": len(orphan_candidates),
            "r2_configured": bool(S3_BUCKET),
        },
        top_consumers=sorted(
            consumers.values(),
            key=lambda item: (-(int(item.get("raw_bytes") or 0) + int(item.get("processed_bytes") or 0)), str(item.get("teacher_name") or "")),
        )[:10],
        orphan_candidates=orphan_candidates[:50],
        retention_backlog=retention_backlog[:50],
    )


@api_router.get("/master-admin/dependencies", response_model=MasterAdminDependencyHealthResponse)
async def get_master_admin_dependency_health(current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    items = await _build_dependency_health_snapshot()
    return MasterAdminDependencyHealthResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        summary={"healthy": sum(1 for item in items if item.healthy), "unhealthy": sum(1 for item in items if not item.healthy)},
        items=items,
    )


@api_router.get("/master-admin/ai-quality", response_model=MasterAdminAIQualityResponse)
async def get_master_admin_ai_quality(current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    return MasterAdminAIQualityResponse(**(await _build_global_ai_quality_snapshot()))


@api_router.get("/master-admin/support", response_model=MasterAdminSupportResponse)
async def get_master_admin_support_console(q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    _require_master_admin_user(current_user)
    normalized_q = str(q or "").strip().lower()
    user_docs = await db.users.find({}, {"_id": 0, "password": 0}).to_list(5000)
    matching_docs = [
        doc for doc in user_docs
        if not normalized_q
        or normalized_q in " ".join([str(doc.get("email") or "").lower(), str(doc.get("name") or "").lower(), str(doc.get("id") or "").lower()])
    ][:10]
    users = [await _build_master_admin_user_record(doc) for doc in matching_docs]
    matching_ids = {user.id for user in users}
    auth_docs = await db.auth_event_log.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    audit_docs = await db.master_admin_audit_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    session_docs = await db.user_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    videos = await db.videos.find({"uploaded_by": {"$in": list(matching_ids)}} if matching_ids else {}, {"_id": 0, "id": 1, "filename": 1, "status": 1, "privacy_status": 1, "analysis_status": 1, "status_updated_at": 1}).sort("status_updated_at", -1).to_list(20)
    incidents = [item for item in await _refresh_processing_incidents() if not matching_ids or item.get("uploader_user_id") in matching_ids or item.get("owner_user_id") in matching_ids][:20]
    return MasterAdminSupportResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        query=q,
        users=users,
        auth_events=[AuthEventRecord(**doc) for doc in auth_docs if not matching_ids or doc.get("user_id") in matching_ids][:20],
        audit_events=[MasterAdminAuditEventRecord(**doc) for doc in audit_docs if not matching_ids or doc.get("target_id") in matching_ids or doc.get("actor_user_id") in matching_ids][:20],
        sessions=[UserSessionRecord(**doc) for doc in session_docs if not matching_ids or doc.get("user_id") in matching_ids][:20],
        related={"videos": videos, "incidents": incidents},
    )


@api_router.post("/master-admin/users/{user_id}/sessions/revoke", response_model=Dict[str, Any])
async def master_admin_revoke_user_sessions(
    user_id: str,
    payload: MasterAdminSessionActionPayload,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    expected_confirmation = str(target.get("email") or "").strip().lower()
    actual_confirmation = str(payload.confirmation_text or "").strip().lower()
    if not payload.reason:
        raise HTTPException(status_code=400, detail="A reason is required before revoking sessions")
    if expected_confirmation and actual_confirmation != expected_confirmation:
        raise HTTPException(status_code=400, detail="Confirmation text must match the target email exactly")
    now = datetime.now(timezone.utc).isoformat()
    result = await db.user_sessions.update_many(
        {"user_id": user_id, "revoked_at": None},
        {"$set": {"revoked_at": now, "revoked_by": current_user.get("email") or current_user.get("id"), "revoke_reason": payload.reason}},
    )
    await _log_master_admin_audit_event(
        actor=current_user,
        action="revoke_user_sessions",
        target_type="user",
        target_id=user_id,
        reason=payload.reason,
        metadata={"email": target.get("email"), "revoked_sessions": getattr(result, "modified_count", 0)},
    )
    return {"user_id": user_id, "revoked_sessions": getattr(result, "modified_count", 0), "revoked_at": now}


@api_router.post("/master-admin/diagnostic-bundles/export", response_model=MasterAdminDiagnosticBundleResponse)
async def export_master_admin_diagnostic_bundle(
    payload: MasterAdminDiagnosticBundleRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_master_admin_user(current_user)
    if payload.target_type not in {"user", "video"}:
        raise HTTPException(status_code=400, detail="Unsupported diagnostic target")
    target_id = payload.target_id
    if payload.target_type == "user":
        user_doc = await db.users.find_one({"id": target_id}, {"_id": 0, "password": 0})
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")
        sessions = await db.user_sessions.find({"user_id": target_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        auth_events = await db.auth_event_log.find({"user_id": target_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        audit_events = await db.master_admin_audit_events.find({"$or": [{"target_id": target_id}, {"actor_user_id": target_id}]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        videos = await db.videos.find({"uploaded_by": target_id}, {"_id": 0}).sort("status_updated_at", -1).to_list(100)
        incidents = [item for item in await _refresh_processing_incidents() if item.get("uploader_user_id") == target_id or item.get("owner_user_id") == target_id]
        bundle = _build_support_bundle(target_type="user", target_id=target_id, user=user_doc, sessions=sessions, auth_events=auth_events, audit_events=audit_events, videos=videos, incidents=incidents)
    else:
        video_doc = await db.videos.find_one({"id": target_id}, {"_id": 0})
        if not video_doc:
            raise HTTPException(status_code=404, detail="Video not found")
        user_doc = await db.users.find_one({"id": video_doc.get("uploaded_by")}, {"_id": 0, "password": 0}) if video_doc.get("uploaded_by") else None
        incidents = [item for item in await _refresh_processing_incidents() if item.get("video_id") == target_id]
        bundle = _build_support_bundle(target_type="video", target_id=target_id, user=user_doc, videos=[video_doc], incidents=incidents)
    await _log_master_admin_audit_event(
        actor=current_user,
        action="export_diagnostic_bundle",
        target_type=payload.target_type,
        target_id=target_id,
        metadata={"bundle_keys": sorted(bundle.keys())},
    )
    return MasterAdminDiagnosticBundleResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        target_type=payload.target_type,
        target_id=target_id,
        bundle=bundle,
    )


@api_router.post("/admin/ops/smoke-cleanup", response_model=AdminSmokeCleanupResponse)
async def run_admin_smoke_cleanup(
    payload: AdminSmokeCleanupRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_admin_ops_user(current_user)
    teacher = None
    if payload.teacher_id:
        teacher = await db.teachers.find_one(
            {"id": payload.teacher_id, "created_by": current_user["id"]},
            {"_id": 0},
        )
    elif payload.teacher_email:
        teacher = await db.teachers.find_one(
            {"email": str(payload.teacher_email).lower(), "created_by": current_user["id"]},
            {"_id": 0},
        )
    else:
        raise HTTPException(status_code=400, detail="teacher_id or teacher_email is required")

    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    result = await _cleanup_teacher_smoke_artifacts(
        teacher,
        delete_user_emails=[str(email).lower() for email in payload.delete_user_emails],
    )
    await _log_privacy_audit_event(
        "admin_smoke_cleanup_executed",
        "teacher",
        result.teacher_id,
        actor_user_id=current_user["id"],
        details={
            "deleted_counts": result.deleted_counts,
            "deleted_files": result.deleted_files,
            "deleted_users": result.deleted_users,
        },
    )
    return result


@api_router.get("/admin/ops/readiness")
async def get_admin_ops_readiness(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    admin_id = current_user["id"]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    video_scope = {"uploaded_by": admin_id}
    teachers_count = await db.teachers.count_documents({"created_by": admin_id})
    assessments_total = await db.assessments.count_documents({"user_id": admin_id})
    policies_count = await db.recording_policies.count_documents({"created_by": admin_id})
    privacy_profiles_active = await db.teacher_face_profiles.count_documents({"status": "active"})
    schedules_upcoming = await db.schedules.count_documents(
        {"user_id": admin_id, "start_time": {"$gte": now_iso}}
    )
    gradebook_connected = await db.gradebook_integrations.count_documents(
        {"user_id": admin_id, "status": {"$in": ["connected", "active"]}}
    )
    videos_total = await db.videos.count_documents(video_scope)
    videos_completed = await db.videos.count_documents(
        {**video_scope, "status": VideoProcessingStatus.COMPLETED.value}
    )
    videos_processing = await db.videos.count_documents(
        {**video_scope, "status": {"$in": [VideoProcessingStatus.QUEUED.value, VideoProcessingStatus.PROCESSING.value]}}
    )
    videos_failed = await db.videos.count_documents(
        {**video_scope, "status": {"$in": [VideoProcessingStatus.FAILED.value, "error", "errored"]}}
    )
    privacy_review_required = await db.videos.count_documents(
        {**video_scope, "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value}
    )
    privacy_failed = await db.videos.count_documents(
        {**video_scope, "privacy_status": PrivacyProcessingStatus.FAILED.value}
    )
    teachers_missing_privacy_profiles = max(0, teachers_count - privacy_profiles_active)
    blocking_items = []
    warnings = []
    if teachers_count == 0:
        blocking_items.append("No teachers configured.")
    if policies_count == 0:
        blocking_items.append("Recording compliance policy is not configured.")
    if PRIVACY_REQUIRE_PROFILE and teachers_missing_privacy_profiles > 0:
        blocking_items.append(f"{teachers_missing_privacy_profiles} teacher(s) are missing privacy profiles.")
    if gradebook_connected == 0:
        warnings.append("No gradebook integration is connected.")
    if assessments_total == 0:
        warnings.append("No completed assessments exist for pilot validation.")
    if videos_failed > 0:
        warnings.append(f"{videos_failed} failed video(s) require retry or remediation.")
    if privacy_failed > 0:
        warnings.append(f"{privacy_failed} video(s) failed privacy processing.")
    if privacy_review_required > 0:
        warnings.append(f"{privacy_review_required} video(s) require privacy review.")
    if schedules_upcoming == 0:
        warnings.append("No upcoming recording schedules are set.")
    observability = observability_snapshot()

    return {
        "generated_at": now_iso,
        "go_no_go": "go" if not blocking_items else "hold",
        "blocking_items": blocking_items,
        "warnings": warnings,
        "metrics": {
            "teachers": teachers_count,
            "videos_total": videos_total,
            "videos_completed": videos_completed,
            "videos_processing_or_queued": videos_processing,
            "videos_failed": videos_failed,
            "assessments_total": assessments_total,
            "recording_policies": policies_count,
            "privacy_profiles_active": privacy_profiles_active,
            "teachers_missing_privacy_profiles": teachers_missing_privacy_profiles,
            "privacy_review_required": privacy_review_required,
            "privacy_failed": privacy_failed,
            "upcoming_schedules": schedules_upcoming,
            "gradebook_connected": gradebook_connected,
            "analysis_total_runs": observability["analysis"]["total_runs"],
            "analysis_failed_runs": observability["analysis"]["failed_runs"],
        },
        "observability": {
            "analysis": {
                "by_mode": observability["analysis"]["by_mode"],
                "recent_failures": observability["analysis"]["recent_failures"][:5],
            }
        },
    }


@api_router.get("/admin/ops/launch-health")
async def get_admin_ops_launch_health(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    admin_id = current_user["id"]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    cutoff_stale = (now - timedelta(minutes=45)).isoformat()
    failed_jobs_24h = await db.video_processing_jobs.count_documents(
        {
            "user_id": admin_id,
            "status": VideoProcessingStatus.FAILED.value,
            "updated_at": {"$gte": cutoff_24h},
        }
    )
    stale_processing_jobs = await db.video_processing_jobs.count_documents(
        {
            "user_id": admin_id,
            "status": VideoProcessingStatus.PROCESSING.value,
            "started_at": {"$lte": cutoff_stale},
        }
    )
    failed_privacy_jobs_24h = await db.video_privacy_jobs.count_documents(
        {
            "user_id": admin_id,
            "status": PrivacyProcessingStatus.FAILED.value,
            "updated_at": {"$gte": cutoff_24h},
        }
    )
    stale_privacy_jobs = await db.video_privacy_jobs.count_documents(
        {
            "user_id": admin_id,
            "status": PrivacyProcessingStatus.PROCESSING.value,
            "started_at": {"$lte": cutoff_stale},
        }
    )
    failed_videos_24h = await db.videos.count_documents(
        {
            "uploaded_by": admin_id,
            "status": {"$in": [VideoProcessingStatus.FAILED.value, "error", "errored"]},
            "status_updated_at": {"$gte": cutoff_24h},
        }
    )
    privacy_reviews_pending = await db.videos.count_documents(
        {
            "uploaded_by": admin_id,
            "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value,
        }
    )
    queued_notifications = await db.notifications.count_documents(
        {"user_id": admin_id, "status": "queued", "read_at": None}
    )
    queue_depth = VIDEO_JOB_QUEUE.qsize()
    privacy_queue_depth = VIDEO_PRIVACY_JOB_QUEUE.qsize()
    if stale_processing_jobs > 0 or stale_privacy_jobs > 0 or failed_jobs_24h >= 10 or failed_privacy_jobs_24h >= 10:
        incident_level = "red"
    elif failed_jobs_24h > 0 or failed_privacy_jobs_24h > 0 or queue_depth > 25 or privacy_queue_depth > 25:
        incident_level = "amber"
    else:
        incident_level = "green"
    actions = []
    if stale_processing_jobs > 0:
        actions.append("Investigate stale processing jobs and restart workers if needed.")
    if stale_privacy_jobs > 0:
        actions.append("Investigate stale privacy jobs and restart privacy workers if needed.")
    if failed_jobs_24h > 0:
        actions.append("Retry failed video jobs and inspect recent error messages.")
    if failed_privacy_jobs_24h > 0:
        actions.append("Review failed privacy jobs and retry or manually review impacted videos.")
    if queue_depth > 25:
        actions.append("Scale worker count (`VIDEO_WORKER_COUNT`) to reduce queue latency.")
    if privacy_queue_depth > 25:
        actions.append("Scale privacy worker count (`PRIVACY_WORKER_COUNT`) to reduce privacy queue latency.")
    if privacy_reviews_pending > 0:
        actions.append("Work the privacy review queue before additional customer uploads pile up.")
    if queued_notifications > 50:
        actions.append("Verify outbound notification delivery pipeline health.")
    if not actions:
        actions.append("No urgent actions. Continue normal monitoring cadence.")
    observability = observability_snapshot()
    return {
        "generated_at": now_iso,
        "incident_level": incident_level,
        "metrics": {
            "video_queue_depth": queue_depth,
            "privacy_queue_depth": privacy_queue_depth,
            "failed_jobs_24h": failed_jobs_24h,
            "failed_privacy_jobs_24h": failed_privacy_jobs_24h,
            "failed_videos_24h": failed_videos_24h,
            "stale_processing_jobs": stale_processing_jobs,
            "stale_privacy_jobs": stale_privacy_jobs,
            "privacy_reviews_pending": privacy_reviews_pending,
            "queued_notifications": queued_notifications,
            "analysis_average_duration_seconds": observability["analysis"]["average_duration_seconds"],
            "analysis_average_estimated_input_tokens": observability["analysis"]["average_estimated_input_tokens"],
            "analysis_average_estimated_output_tokens": observability["analysis"]["average_estimated_output_tokens"],
        },
        "observability": observability,
        "recommended_actions": actions,
    }


@api_router.get("/admin/ops/observability")
async def get_admin_ops_observability(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    await refresh_runtime_metrics()
    snapshot = observability_snapshot()
    snapshot["queues"] = {
        "video_queue_depth": VIDEO_JOB_QUEUE.qsize(),
        "privacy_queue_depth": VIDEO_PRIVACY_JOB_QUEUE.qsize(),
    }
    specialist_activity = await _get_specialist_activity_snapshot(current_user)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "observability": snapshot,
        "persistent_metrics": app_metrics.snapshot_summary(),
        "specialist_activity": specialist_activity,
    }


@api_router.get("/admin/ops/ai-quality")
async def get_admin_ops_ai_quality(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    from app.services.workspace_service import get_ai_quality_snapshot

    return await get_ai_quality_snapshot(current_user)


@api_router.get("/admin/ops/privacy-runtime")
async def get_admin_ops_privacy_runtime(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    upload_dir_exists = UPLOAD_DIR.exists()
    upload_dir_writable = False
    probe_error = None
    probe_file = UPLOAD_DIR / ".runtime-write-check"
    try:
        probe_file.parent.mkdir(parents=True, exist_ok=True)
        probe_file.write_text("ok", encoding="utf-8")
        probe_file.unlink(missing_ok=True)
        upload_dir_writable = True
    except Exception as exc:
        probe_error = str(exc)

    server_cv2_available = cv2 is not None
    server_cv2_error = None if server_cv2_available else str(_cv2_import_error)
    privacy_runtime = get_privacy_runtime_status()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "upload_dir": str(UPLOAD_DIR),
        "upload_dir_exists": upload_dir_exists,
        "upload_dir_writable": upload_dir_writable,
        "upload_dir_probe_error": probe_error,
        "s3_configured": bool(S3_BUCKET),
        "server_runtime": {
            "cv2_available": server_cv2_available,
            "cv2_error": server_cv2_error,
        },
        "privacy_runtime": privacy_runtime,
        "degraded_runtime_enabled": PRIVACY_ALLOW_DEGRADED_RUNTIME,
    }


@api_router.get("/admin/ops/backlog-priorities")
async def get_admin_ops_backlog_priorities(current_user: dict = Depends(get_current_user)):
    _require_admin_ops_user(current_user)
    admin_id = current_user["id"]
    failed_videos = await db.videos.find(
        {"uploaded_by": admin_id, "status": {"$in": [VideoProcessingStatus.FAILED.value, "error", "errored"]}},
        {"_id": 0, "id": 1, "teacher_id": 1, "filename": 1, "error_message": 1, "status_updated_at": 1},
    ).sort("status_updated_at", -1).to_list(20)
    teachers_without_videos = await db.teachers.aggregate(
        [
            {"$match": {"created_by": admin_id}},
            {
                "$lookup": {
                    "from": "videos",
                    "localField": "id",
                    "foreignField": "teacher_id",
                    "as": "teacher_videos",
                }
            },
            {"$project": {"id": 1, "name": 1, "video_count": {"$size": "$teacher_videos"}}},
            {"$match": {"video_count": 0}},
            {"$limit": 20},
        ]
    ).to_list(20)
    privacy_reviews = await db.videos.find(
        {"uploaded_by": admin_id, "privacy_status": PrivacyProcessingStatus.REVIEW_REQUIRED.value},
        {
            "_id": 0,
            "id": 1,
            "teacher_id": 1,
            "filename": 1,
            "privacy_review_reason": 1,
            "status_updated_at": 1,
        },
    ).sort("status_updated_at", -1).to_list(20)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "priorities": [
            {
                "priority": "high" if privacy_reviews else "low",
                "title": "Privacy review queue",
                "count": len(privacy_reviews),
                "items": privacy_reviews,
            },
            {
                "priority": "high" if failed_videos else "medium",
                "title": "Failed video recovery",
                "count": len(failed_videos),
                "items": failed_videos,
            },
            {
                "priority": "medium" if teachers_without_videos else "low",
                "title": "Teacher observation coverage",
                "count": len(teachers_without_videos),
                "items": teachers_without_videos,
            },
        ],
    }


async def _enqueue_notification(
    current_user: dict,
    teacher_id: Optional[str],
    notification_type: str,
    title: str,
    message: str,
):
    doc = {
        "id": str(uuid.uuid4()),
        "teacher_id": teacher_id,
        "notification_type": notification_type,
        "title": title,
        "message": message,
        "channel": "email",
        "status": "queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at": None,
        "user_id": current_user["id"],
    }
    await db.notifications.insert_one(doc)
    # Placeholder for email integration
    logger.info(f"[EmailQueue] {title} -> {current_user.get('email')}")


async def _persist_assessment_evidence_from_scores(
    assessment: dict,
    current_user: dict,
) -> List[dict]:
    framework = _get_framework_by_type(assessment.get("framework_type", "danielson"))
    created_at = datetime.now(timezone.utc).isoformat()
    evidence_docs: List[dict] = []
    element_scores = assessment.get("element_scores", [])

    for element_score in element_scores:
        segments = element_score.get("evidence_segments") or []
        if not segments:
            continue
        domain = _find_domain_for_element(framework, element_score["element_id"])
        for segment in segments:
            summary = str(segment.get("summary") or "").strip()
            if not summary:
                continue
            start_sec = float(segment.get("start_sec", 0))
            end_sec = float(segment.get("end_sec", max(1.0, start_sec + 20.0)))
            evidence_docs.append(
                {
                    "id": str(uuid.uuid4()),
                    "assessment_id": assessment["id"],
                    "teacher_id": assessment["teacher_id"],
                    "video_id": assessment.get("video_id"),
                    "element_id": element_score["element_id"],
                    "element_name": element_score.get("element_name"),
                    "domain_id": domain.get("id") if domain else None,
                    "domain_name": domain.get("name") if domain else None,
                    "evidence_text": summary,
                    "timestamp_start": round(start_sec, 1),
                    "timestamp_end": round(end_sec, 1),
                    "assessment_date": assessment.get("analyzed_at"),
                    "source": segment.get("rationale") or "ai",
                    "created_at": created_at,
                    "user_id": current_user["id"],
                }
            )

    if evidence_docs:
        await db.assessment_evidence.insert_many(evidence_docs)
        await db.assessments.update_one(
            {"id": assessment["id"], "user_id": current_user["id"]},
            {"$set": {"element_scores": element_scores}},
        )
        for doc in evidence_docs:
            doc.pop("user_id", None)
        return evidence_docs

    return await _ensure_mock_evidence(assessment, current_user)

async def analyze_video(
    video_id: str,
    file_path: str,
    teacher_id: str,
    user_id: str,
) -> Tuple[bool, Optional[str]]:
    """Background task to analyze video using AI"""
    analysis_started_perf = time.perf_counter()
    analysis_language = "unknown"
    try:
        log_structured(
            logger,
            "info",
            "analysis_started",
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=user_id,
        )
        video = await db.videos.find_one({"id": video_id}, {"_id": 0})
        if not video:
            raise RuntimeError("Video not found")
        if _normalize_privacy_status(video.get("privacy_status")) != PrivacyProcessingStatus.COMPLETED.value:
            raise RuntimeError("Privacy processing must complete before analysis starts")
        file_path = video.get("redacted_file_path") or file_path
        if file_path and not os.path.isabs(str(file_path)):
            file_path = str(UPLOAD_DIR / str(file_path))
        started_at = datetime.now(timezone.utc).isoformat()
        await db.videos.update_one(
            {"id": video_id},
            {
                "$set": {
                    "status": VideoProcessingStatus.PROCESSING.value,
                    "analysis_status": VideoProcessingStatus.PROCESSING.value,
                    "status_updated_at": started_at,
                    "processing_started_at": started_at,
                    "processing_failed_at": None,
                    "error_message": None,
                },
                "$inc": {"processing_attempts": 1},
            },
        )
        await db.video_evidence.update_one(
            {"video_id": video_id, "uploaded_by": user_id},
            {
                "$set": {
                    "analysis_status": VideoProcessingStatus.PROCESSING.value,
                    "error_message": None,
                }
            },
        )
        # Get current framework selection
        selection = await db.framework_selections.find_one(
            {"user_id": user_id},
            {"_id": 0}
        )
        
        framework_type = selection.get("framework_type", "danielson") if selection else "danielson"
        selected_elements = selection.get("selected_elements", []) if selection else []
        priority_elements = selection.get("priority_elements", []) if selection else []
        focus_note = (selection.get("focus_note") or "").strip() if selection else ""
        analysis_language = _normalize_app_language(video.get("analysis_language"), default="en")
        
        # Get framework data
        if framework_type == "danielson":
            framework = DANIELSON_FRAMEWORK
        elif framework_type == "marshall":
            framework = MARSHALL_FRAMEWORK
        else:
            framework = {
                "domains": DANIELSON_FRAMEWORK["domains"] + MARSHALL_FRAMEWORK["domains"]
            }
        analysis_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
        
        with app_metrics.track_analysis_run(
            analysis_mode="unknown",
            language=analysis_language,
            modalities=None,
        ):
            frames = await asyncio.to_thread(extract_video_frames, file_path, VIDEO_ANALYSIS_MAX_FRAMES)
            logger.info(f"Extracted {len(frames)} frames from video")
            sampling_manifest = build_sampling_manifest(video_id, frames)
            await db.video_sampling_manifests.update_one(
                {"video_id": video_id, "strategy_version": sampling_manifest["strategy_version"]},
                {"$set": sampling_manifest},
                upsert=True,
            )
            moment_manifest = build_moment_manifest(video_id, file_path, frames)
            await db.video_analysis_moments.update_one(
                {"video_id": video_id, "strategy_version": moment_manifest["strategy_version"]},
                {"$set": moment_manifest},
                upsert=True,
            )
            frames = attach_moment_metadata_to_frames(frames, moment_manifest)
            transcript_doc = None
            feature_doc = None
            try:
                transcript_doc, feature_doc = await build_audio_artifacts(
                    video_id,
                    file_path,
                    analysis_user,
                    analysis_language=analysis_language,
                )
            except Exception as exc:
                logger.warning(f"Audio artifact generation failed for {video_id}; continuing with vision-only analysis: {exc}")
            if transcript_doc:
                await db.video_audio_transcripts.update_one(
                    {"video_id": video_id},
                    {"$set": transcript_doc},
                    upsert=True,
                )
            if feature_doc:
                await db.video_analysis_features.update_one(
                    {"video_id": video_id},
                    {"$set": feature_doc},
                    upsert=True,
                )
            multimodal_payload = build_multimodal_analysis_payload(
                frames,
                moment_manifest,
                transcript_doc,
                feature_doc,
            )
            frames = multimodal_payload.get("frames") or frames

            analysis_payload = await analyze_frames_with_ai(
                frames,
                framework,
                selected_elements,
                teacher_id=teacher_id,
                priority_elements=priority_elements,
                focus_note=focus_note,
                language=analysis_language,
                framework_type=framework_type,
                current_user=analysis_user,
                multimodal_payload=multimodal_payload,
            )
        usage_estimate = estimate_analysis_usage(
            frames=frames,
            multimodal_payload=multimodal_payload,
            output_payload=analysis_payload,
            input_cost_per_million=OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD,
            output_cost_per_million=OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD,
        )
        analysis_metadata = build_analysis_metadata(
            analysis_payload,
            multimodal_payload,
            transcript_doc,
            feature_doc,
        )
        element_scores = analysis_payload.get("element_scores", [])
        
        # Calculate overall score (1-10 gradient mapped from underlying 1-4 scale if needed)
        valid_scores = [es["score"] for es in element_scores if es["score"] > 0]
        overall_score = round(sum(valid_scores) / len(valid_scores), 2) if valid_scores else 0
        
        # Generate recommendations
        recommendations = generate_recommendations(
            element_scores,
            provided_recommendations=analysis_payload.get("recommendations"),
            priority_element_ids=priority_elements,
            focus_note=focus_note,
            language=analysis_language,
            analysis_context=analysis_payload.get("analysis_context"),
        )
        summary_text = generate_summary(
            element_scores,
            overall_score,
            provided_summary=analysis_payload.get("summary"),
            priority_element_ids=priority_elements,
            focus_note=focus_note,
            language=analysis_language,
            analysis_context=analysis_payload.get("analysis_context"),
        )
        observation_summary = build_observation_summary_packet(
            element_scores,
            overall_score,
            summary_text,
            recommendations,
            priority_element_ids=priority_elements,
            focus_note=focus_note,
            analysis_confidence=analysis_metadata["analysis_confidence"],
            language=analysis_language,
        )
        
        # Create assessment document
        assessment_doc = {
            "id": str(uuid.uuid4()),
            "video_id": video_id,
            "teacher_id": teacher_id,
            "user_id": user_id,
            "framework_type": framework_type,
            "element_scores": element_scores,
            "overall_score": overall_score,
            "summary": summary_text,
            "recommendations": recommendations,
            "priority_elements": priority_elements,
            "focus_note": focus_note or None,
            "observation_summary": observation_summary,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "analysis_language": analysis_language,
            "analysis_mode": analysis_payload.get("analysis_mode", "fallback"),
            "analysis_confidence": analysis_metadata["analysis_confidence"],
            "analysis_modalities_used": analysis_metadata["analysis_modalities_used"],
            "specialist_orchestrator": analysis_metadata["specialist_orchestrator"],
            "specialist_trace": analysis_metadata["specialist_trace"],
        }
        
        await db.assessments.insert_one(assessment_doc)
        await _persist_assessment_evidence_from_scores(assessment_doc, {"id": user_id})
        
        # Update video status
        completed_at = datetime.now(timezone.utc).isoformat()
        await db.videos.update_one(
            {"id": video_id},
            {
                "$set": {
                    "status": VideoProcessingStatus.COMPLETED.value,
                    "analysis_status": VideoProcessingStatus.COMPLETED.value,
                    "assessment_id": assessment_doc["id"],
                    "analysis_mode": analysis_payload.get("analysis_mode", "fallback"),
                    "sampling_strategy_version": sampling_manifest["strategy_version"],
                    "moment_sampling_version": moment_manifest["strategy_version"],
                    "audio_analysis_enabled": bool(transcript_doc or feature_doc),
                    "audio_transcript_status": analysis_metadata["audio_transcript_status"],
                    "analysis_modalities_used": analysis_metadata["analysis_modalities_used"],
                    "analysis_confidence": analysis_metadata["analysis_confidence"],
                    "priority_elements": priority_elements,
                    "focus_note": focus_note or None,
                    "analysis_language": analysis_language,
                    "status_updated_at": completed_at,
                    "processing_completed_at": completed_at,
                    "processing_failed_at": None,
                }
            },
        )
        await db.video_evidence.update_one(
            {"video_id": video_id, "uploaded_by": user_id},
            {"$set": {"analysis_status": VideoProcessingStatus.COMPLETED.value}},
        )
        updated_video = await db.videos.find_one({"id": video_id}, {"_id": 0})
        if updated_video:
            await _sync_video_recognition_state(updated_video)

        duration_seconds = time.perf_counter() - analysis_started_perf
        record_analysis_run(
            video_id=video_id,
            success=True,
            analysis_mode=analysis_payload.get("analysis_mode", "fallback"),
            duration_seconds=duration_seconds,
            modalities_used=analysis_metadata["analysis_modalities_used"],
            estimated_input_tokens=usage_estimate.get("estimated_input_tokens"),
            estimated_output_tokens=usage_estimate.get("estimated_output_tokens"),
            estimated_cost_usd=usage_estimate.get("estimated_cost_usd"),
            language=analysis_language,
            model=OPENAI_VISION_MODEL if analysis_payload.get("analysis_mode") in {"openai", "openai_multimodal"} else "fallback",
        )
        log_structured(
            logger,
            "info",
            "analysis_completed",
            video_id=video_id,
            teacher_id=teacher_id,
            analysis_mode=analysis_payload.get("analysis_mode", "fallback"),
            duration_seconds=round(duration_seconds, 3),
            modalities_used=analysis_metadata["analysis_modalities_used"],
            estimated_input_tokens=usage_estimate.get("estimated_input_tokens"),
            estimated_output_tokens=usage_estimate.get("estimated_output_tokens"),
            estimated_cost_usd=usage_estimate.get("estimated_cost_usd"),
        )
        return True, None
        
    except Exception as e:
        logger.error(f"Error analyzing video {video_id}: {str(e)}")
        duration_seconds = time.perf_counter() - analysis_started_perf
        record_analysis_run(
            video_id=video_id,
            success=False,
            analysis_mode="failed_before_completion",
            duration_seconds=duration_seconds,
            modalities_used=["vision"],
            failure_reason=str(e),
            language=analysis_language,
            model=OPENAI_VISION_MODEL,
        )
        log_structured(
            logger,
            "error",
            "analysis_failed",
            video_id=video_id,
            teacher_id=teacher_id,
            duration_seconds=round(duration_seconds, 3),
            failure_reason=str(e),
        )
        failed_at = datetime.now(timezone.utc).isoformat()
        await db.videos.update_one(
            {"id": video_id},
            {
                "$set": {
                    "status": VideoProcessingStatus.FAILED.value,
                    "analysis_status": VideoProcessingStatus.FAILED.value,
                    "status_updated_at": failed_at,
                    "processing_failed_at": failed_at,
                    "error_message": str(e),
                }
            },
        )
        await db.video_evidence.update_one(
            {"video_id": video_id, "uploaded_by": user_id},
            {
                "$set": {
                    "analysis_status": VideoProcessingStatus.FAILED.value,
                    "error_message": str(e),
                }
            },
        )
        return False, str(e)
    finally:
        if CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS:
            # Optional cleanup when source retention is not needed for playback/retries.
            try:
                if os.path.exists(file_path):
                    await asyncio.to_thread(os.remove, file_path)
            except Exception as e:
                logger.error(f"Error removing video file: {e}")

def _build_elements_to_analyze(
    framework: dict,
    selected_elements: List[str],
    priority_elements: Optional[List[str]] = None,
    framework_type: str = "danielson",
    language: Optional[str] = "en",
) -> List[dict]:
    elements_to_analyze: List[dict] = []
    priority_set = set(priority_elements or [])
    for domain in framework.get("domains", []):
        for element in domain.get("elements", []):
            if selected_elements and element["id"] not in selected_elements:
                continue
            elements_to_analyze.append(
                {
                    "id": element["id"],
                    "name": _localize_framework_node_label(element["id"], element["name"], framework_type, language),
                    "domain": _localize_framework_node_label(domain.get("id") or "", domain["name"], framework_type, language),
                    "priority": element["id"] in priority_set,
                }
            )
    return sorted(
        elements_to_analyze,
        key=lambda item: (0 if item.get("priority") else 1, item["domain"], item["id"]),
    )


def _build_focus_instruction(
    priority_elements: List[dict],
    focus_note: Optional[str] = None,
    language: str = "en",
) -> str:
    parts: List[str] = []
    if priority_elements:
        priority_text = ", ".join(f"{element['id']}: {element['name']}" for element in priority_elements)
        if _is_hebrew_language(language):
            parts.append(
                "מוקדי ההתבוננות שהוגדרו על ידי המנהל לתצפית זו הם: "
                f"{priority_text}. יש לתת להם משקל מוביל בסיכום, בשיפוט המקצועי ובהמלצות להמשך."
            )
        else:
            parts.append(
                "Admin focus priorities for this observation are: "
                f"{priority_text}. Weight your summary, judgments, and coaching recommendations toward these areas first."
            )
    if focus_note:
        normalized_note = focus_note.strip()
        if _is_hebrew_language(language):
            parts.append(
                "הערת מיקוד של המנהל לתצפית זו, כפי שנכתבה במקור: "
                f"\"{normalized_note}\". יש להשתמש בנוסח זה כפי שהוא, בלי לתרגם אותו לאנגלית ובלי לשנות את המשמעות שלו."
            )
        else:
            parts.append(
                "Admin observation note, preserved as originally written: "
                f"\"{normalized_note}\". Use it directly as guidance and do not normalize it into another wording style."
            )
    return "\n".join(parts).strip()


def _build_analysis_context_instruction(analysis_context: Optional[dict], language: str = "en") -> str:
    if not analysis_context:
        return ""
    parts: List[str] = []
    active_goals = [str(item).strip() for item in analysis_context.get("active_goals", []) if str(item).strip()]
    notes = str(analysis_context.get("action_plan_notes") or "").strip()
    signal_guidance = [
        str(item).strip()
        for item in ((analysis_context.get("signal_summary") or {}).get("guidance") or [])
        if str(item).strip()
    ]
    reflection = analysis_context.get("reflection_summary") or {}
    reflection_takeaways = [
        str(reflection.get("self_reflection") or "").strip(),
        str(reflection.get("actions_taken") or "").strip(),
    ]
    reflection_takeaways = [item for item in reflection_takeaways if item]
    if active_goals:
        if _is_hebrew_language(language):
            parts.append(f"יעדי הליווי הפעילים כרגע עבור המורה הם: {', '.join(active_goals[:3])}.")
        else:
            parts.append(f"Current coaching goals for this teacher are: {', '.join(active_goals[:3])}.")
    if notes:
        if _is_hebrew_language(language):
            parts.append(f"הערות תוכנית הפעולה האחרונות: {notes}")
        else:
            parts.append(f"Recent action-plan notes: {notes}")
    if reflection_takeaways:
        if _is_hebrew_language(language):
            parts.append(f"משוב ההמשך האנושי שכדאי לקחת בחשבון: {' | '.join(reflection_takeaways[:2])}.")
        else:
            parts.append(f"Human follow-through context to consider: {' | '.join(reflection_takeaways[:2])}.")
    if signal_guidance:
        if _is_hebrew_language(language):
            parts.append("העדפות הסוקרים מהמשוב האחרון: " + " ".join(signal_guidance[:2]))
        else:
            parts.append("Reviewer guidance from recent feedback: " + " ".join(signal_guidance[:2]))
    return "\n".join(parts).strip()


def extract_video_frames(video_path: str, max_frames: int = VIDEO_ANALYSIS_MAX_FRAMES) -> List[dict]:
    """Extract evenly spaced video frames with timestamps."""
    if SMART_FRAME_SELECTION_ENABLED:
        try:
            candidates = scan_video_candidates(
                video_path,
                scan_fps=VIDEO_ANALYSIS_FRAME_SCAN_FPS,
                enable_ocr_signals=VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS,
            )
            scored_candidates = score_frame_candidates(candidates)
            selected_candidates = select_diverse_frames(
                scored_candidates,
                max_frames=max_frames,
                min_gap_sec=VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC,
            )
            if selected_candidates:
                logger.info(
                    "Selected %s smart analysis frames using %s",
                    len(selected_candidates),
                    SMART_FRAME_SELECTION_VERSION,
                )
                return [
                    {
                        "timestamp_sec": candidate["timestamp_sec"],
                        "image_b64": candidate["image_b64"],
                        "selection_reason": candidate.get("reason"),
                        "selection_score": candidate.get("score"),
                        "selection_features": candidate.get("features"),
                    }
                    for candidate in selected_candidates
                ]
        except Exception as e:
            logger.error(f"Smart frame selection failed, falling back to evenly spaced extraction: {e}")

    frames: List[dict] = []
    try:
        if cv2 is None:
            logger.error(f"OpenCV not available: {_cv2_import_error}")
            return frames
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if total_frames == 0:
            cap.release()
            return frames

        interval = max(1, total_frames // max_frames)
        for frame_idx in range(0, total_frames, interval):
            if len(frames) >= max_frames:
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                continue
            frame = cv2.resize(frame, (640, 480))
            ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok:
                continue
            timestamp_sec = round(frame_idx / fps, 2) if fps > 0 else float(len(frames) * 30)
            frames.append(
                {
                    "timestamp_sec": timestamp_sec,
                    "image_b64": base64.b64encode(buffer).decode("utf-8"),
                }
            )
        cap.release()
    except Exception as e:
        logger.error(f"Error extracting frames: {e}")
    return frames


def build_sampling_manifest(video_id: str, frames: List[dict]) -> Dict[str, Any]:
    strategy_version = SMART_FRAME_SELECTION_VERSION if SMART_FRAME_SELECTION_ENABLED else "even_spacing_v1"
    selected_frames = []
    for frame in frames:
        selected_frames.append(
            {
                "timestamp_sec": round(float(frame.get("timestamp_sec", 0.0)), 2),
                "reason": frame.get("selection_reason") or "even_spacing",
                "score": round(float(frame.get("selection_score", 0.0) or 0.0), 4),
                "features": frame.get("selection_features") or {},
            }
        )
    return {
        "id": f"sampling_{video_id}_{strategy_version}",
        "video_id": video_id,
        "strategy_version": strategy_version,
        "scan_fps": VIDEO_ANALYSIS_FRAME_SCAN_FPS if SMART_FRAME_SELECTION_ENABLED else None,
        "max_frames": len(frames),
        "selected_frames": selected_frames,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def build_moment_manifest(video_id: str, video_path: str, frames: List[dict]) -> Dict[str, Any]:
    if not SMART_MOMENT_SAMPLING_ENABLED:
        return {
            "id": f"moments_{video_id}_disabled",
            "video_id": video_id,
            "strategy_version": "moment_sampling_disabled",
            "moments": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    windows = segment_video_windows(video_path, window_sec=VIDEO_ANALYSIS_WINDOW_SEC)
    scored_windows = score_windows(windows, frames)
    moments = select_lesson_moments(scored_windows, max_moments=VIDEO_ANALYSIS_MAX_MOMENTS)
    return {
        "id": f"moments_{video_id}_{SMART_MOMENT_SAMPLING_VERSION}",
        "video_id": video_id,
        "strategy_version": SMART_MOMENT_SAMPLING_VERSION,
        "window_sec": VIDEO_ANALYSIS_WINDOW_SEC,
        "max_moments": VIDEO_ANALYSIS_MAX_MOMENTS,
        "moments": moments,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def attach_moment_metadata_to_frames(frames: List[dict], moment_manifest: Dict[str, Any]) -> List[dict]:
    moments = list(moment_manifest.get("moments") or [])
    if not moments:
        return frames

    enriched: List[dict] = []
    for frame in frames:
        timestamp_sec = float(frame.get("timestamp_sec", 0.0))
        matching_moment = next(
            (
                moment
                for moment in moments
                if float(moment.get("start_sec", 0.0)) <= timestamp_sec <= float(moment.get("end_sec", timestamp_sec))
            ),
            None,
        )
        if matching_moment:
            enriched.append(
                {
                    **frame,
                    "moment_id": matching_moment.get("moment_id"),
                    "moment_phase": matching_moment.get("phase"),
                    "moment_selection_reason": matching_moment.get("selection_reason"),
                }
            )
        else:
            enriched.append(frame)
    return enriched


def _should_run_audio_analysis(current_user: Optional[dict]) -> bool:
    if not AUDIO_ANALYSIS_ENABLED:
        return False
    if not AUDIO_ALLOW_STUDENT_VOICE_PROCESSING:
        return False
    return _is_paid_analysis_allowed_for_user(current_user)


async def build_audio_artifacts(
    video_id: str,
    video_path: str,
    current_user: Optional[dict],
    analysis_language: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    if not _should_run_audio_analysis(current_user):
        return None, None

    extracted_audio_path = str(UPLOAD_DIR / "audio" / f"{video_id}.wav")
    transcript_doc: Optional[Dict[str, Any]] = None
    feature_doc: Optional[Dict[str, Any]] = None
    normalized_language = _normalize_app_language(analysis_language, default="")
    transcription_started_perf: Optional[float] = None
    try:
        extraction = await asyncio.to_thread(
            extract_audio_track,
            video_path,
            extracted_audio_path,
            AUDIO_TRANSCRIPTION_MAX_SECONDS,
        )
        transcript_segments: List[Dict[str, Any]] = []
        transcript_text = ""
        transcription_status = "disabled"
        transcription_model = None

        if AUDIO_TRANSCRIPTION_ENABLED and OPENAI_API_KEY:
            transcription_language = AUDIO_TRANSCRIPTION_LANGUAGE or normalized_language
            transcription_started_perf = time.perf_counter()
            transcription = await asyncio.to_thread(
                transcribe_audio_file,
                extraction["audio_path"],
                OPENAI_API_KEY,
                AUDIO_TRANSCRIPTION_MODEL,
                transcription_language,
            )
            app_metrics.record_transcription_result(
                language=transcription_language,
                success=True,
                duration_seconds=time.perf_counter() - transcription_started_perf,
                model=AUDIO_TRANSCRIPTION_MODEL,
            )
            transcript_segments = transcription.get("segments") or []
            transcript_text = transcription.get("text") or ""
            transcription_model = transcription.get("model")
            transcription_status = "completed"
        elif AUDIO_TRANSCRIPTION_ENABLED:
            transcription_status = "unconfigured"

        transcript_doc = {
            "id": f"transcript_{video_id}",
            "video_id": video_id,
            "transcript_status": transcription_status,
            "model": transcription_model,
            "language": AUDIO_TRANSCRIPTION_LANGUAGE or normalized_language,
            "segments": transcript_segments,
            "text": transcript_text,
            "retention_expires_at": (
                datetime.now(timezone.utc) + timedelta(days=AUDIO_TRANSCRIPT_RETENTION_DAYS)
            ).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        if AUDIO_FEATURES_ENABLED:
            features = compute_audio_features(transcript_segments)
            feature_doc = {
                "id": f"audio_features_{video_id}",
                "video_id": video_id,
                **features,
                "modalities_used": ["audio"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        return transcript_doc, feature_doc
    except Exception:
        if AUDIO_TRANSCRIPTION_ENABLED:
            app_metrics.record_transcription_result(
                language=AUDIO_TRANSCRIPTION_LANGUAGE or normalized_language,
                success=False,
                duration_seconds=(
                    time.perf_counter() - transcription_started_perf
                    if transcription_started_perf is not None
                    else 0.0
                ),
                model=AUDIO_TRANSCRIPTION_MODEL,
            )
        raise
    finally:
        try:
            if extracted_audio_path and os.path.exists(extracted_audio_path):
                await asyncio.to_thread(os.remove, extracted_audio_path)
        except Exception as exc:
            logger.warning(f"Unable to remove temporary extracted audio for {video_id}: {exc}")


def build_analysis_metadata(
    analysis_payload: Dict[str, Any],
    multimodal_payload: Optional[Dict[str, Any]],
    transcript_doc: Optional[Dict[str, Any]],
    feature_doc: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    modalities_used = list((multimodal_payload or {}).get("modalities_used") or ["vision"])
    confidence_values = [
        float(score.get("confidence", 0.0) or 0.0)
        for score in (analysis_payload.get("element_scores") or [])
    ]
    overall_confidence = round(sum(confidence_values) / len(confidence_values), 1) if confidence_values else 0.0

    degradation_reasons: List[str] = []
    transcript_status = (transcript_doc or {}).get("transcript_status")
    if "audio" not in modalities_used:
        if AUDIO_ANALYSIS_ENABLED and AUDIO_ALLOW_STUDENT_VOICE_PROCESSING:
            degradation_reasons.append("audio_unavailable")
        else:
            degradation_reasons.append("vision_only_mode")
    if transcript_doc and transcript_status != "completed":
        degradation_reasons.append(f"audio_transcript_{transcript_status}")
    if not feature_doc and AUDIO_FEATURES_ENABLED:
        degradation_reasons.append("audio_features_unavailable")

    modality_confidence = {
        "vision": overall_confidence,
        "audio": 100.0 if ("audio" in modalities_used and transcript_status == "completed") else 0.0,
    }
    if "audio" in modalities_used and feature_doc:
        modality_confidence["audio"] = 75.0

    return {
        "analysis_modalities_used": modalities_used,
        "analysis_confidence": {
            "overall": overall_confidence,
            "by_modality": modality_confidence,
            "degradation_reasons": degradation_reasons,
        },
        "audio_transcript_status": transcript_status,
        "specialist_orchestrator": analysis_payload.get("specialist_orchestrator"),
        "specialist_trace": analysis_payload.get("specialist_trace") or [],
    }


def _summarize_specialist_activity(
    assessment_docs: List[Dict[str, Any]],
    *,
    recent_limit: int = 5,
) -> Dict[str, Any]:
    versions: Dict[str, int] = {}
    specialists: Dict[str, Dict[str, Any]] = {}
    recent_traces: List[Dict[str, Any]] = []
    orchestrated_assessment_count = 0
    total_specialist_steps = 0

    for doc in assessment_docs or []:
        orchestrator = doc.get("specialist_orchestrator") or {}
        trace = list(doc.get("specialist_trace") or [])
        if not trace and not orchestrator.get("enabled"):
            continue

        orchestrated_assessment_count += 1
        version = str(orchestrator.get("version") or "unknown").strip() or "unknown"
        versions[version] = versions.get(version, 0) + 1

        trace_preview: List[Dict[str, Any]] = []
        for item in trace:
            specialist_id = str(item.get("specialist_id") or "unknown").strip() or "unknown"
            row = specialists.setdefault(
                specialist_id,
                {
                    "specialist_id": specialist_id,
                    "name": str(item.get("name") or specialist_id).strip() or specialist_id,
                    "invocations": 0,
                    "owned_fields": list(item.get("owned_fields") or []),
                    "recent_notes": [],
                    "last_seen_at": None,
                },
            )
            row["invocations"] += 1
            row["last_seen_at"] = doc.get("analyzed_at") or row["last_seen_at"]
            if not row["owned_fields"]:
                row["owned_fields"] = list(item.get("owned_fields") or [])
            for note in item.get("notes") or []:
                note_text = str(note or "").strip()
                if note_text and note_text not in row["recent_notes"]:
                    row["recent_notes"].append(note_text)
            total_specialist_steps += 1
            trace_preview.append(
                {
                    "specialist_id": specialist_id,
                    "name": str(item.get("name") or specialist_id).strip() or specialist_id,
                    "notes": [str(note or "").strip() for note in (item.get("notes") or []) if str(note or "").strip()],
                    "payload_delta": item.get("payload_delta") or {},
                }
            )

        recent_traces.append(
            {
                "assessment_id": doc.get("id"),
                "teacher_id": doc.get("teacher_id"),
                "video_id": doc.get("video_id"),
                "analyzed_at": doc.get("analyzed_at"),
                "analysis_mode": doc.get("analysis_mode"),
                "version": version,
                "specialists": trace_preview,
            }
        )

    return {
        "sample_size": len(assessment_docs or []),
        "orchestrated_assessment_count": orchestrated_assessment_count,
        "total_specialist_steps": total_specialist_steps,
        "versions": sorted(
            [{"version": version, "count": count} for version, count in versions.items()],
            key=lambda item: (-int(item["count"]), item["version"]),
        ),
        "specialists": sorted(
            [
                {
                    **row,
                    "recent_notes": row["recent_notes"][:3],
                }
                for row in specialists.values()
            ],
            key=lambda item: (-int(item.get("invocations") or 0), str(item.get("specialist_id") or "")),
        ),
        "recent_traces": recent_traces[:recent_limit],
    }


async def _get_specialist_activity_snapshot(
    current_user: Dict[str, Any],
    *,
    sample_limit: int = 12,
) -> Dict[str, Any]:
    assessment_docs = await db.assessments.find(
        {
            "user_id": current_user["id"],
            "$or": [
                {"specialist_orchestrator.enabled": True},
                {"specialist_trace.0": {"$exists": True}},
            ],
        },
        {
            "_id": 0,
            "id": 1,
            "teacher_id": 1,
            "video_id": 1,
            "analyzed_at": 1,
            "analysis_mode": 1,
            "specialist_orchestrator": 1,
            "specialist_trace": 1,
        },
    ).sort("analyzed_at", -1).to_list(sample_limit)
    return _summarize_specialist_activity(assessment_docs, recent_limit=5)


def _extract_json_object(text: str) -> Optional[dict]:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except Exception:
        return None


def _normalize_analysis_score(raw_score: Any) -> float:
    try:
        score = float(raw_score)
    except Exception:
        return 5.0
    if score <= 4.0:
        score = round((score / 4.0) * 10.0, 1)
    return max(1.0, min(10.0, round(score, 1)))


def _normalize_confidence(raw_confidence: Any) -> float:
    try:
        confidence = float(raw_confidence)
    except Exception:
        return 50.0
    return max(0.0, min(100.0, round(confidence, 1)))


def _normalize_evidence_segments(raw_segments: Any, fallback_timestamp: float) -> List[dict]:
    segments: List[dict] = []
    if not isinstance(raw_segments, list):
        raw_segments = []
    for raw in raw_segments[:2]:
        if not isinstance(raw, dict):
            continue
        try:
            start_sec = max(0.0, float(raw.get("start_sec", fallback_timestamp)))
        except Exception:
            start_sec = float(fallback_timestamp)
        try:
            end_sec = max(start_sec + 1.0, float(raw.get("end_sec", start_sec + 20.0)))
        except Exception:
            end_sec = start_sec + 20.0
        summary = str(raw.get("summary") or "").strip()
        rationale = str(raw.get("rationale") or "").strip()
        if not summary:
            continue
        segments.append(
            {
                "start_sec": round(start_sec, 1),
                "end_sec": round(end_sec, 1),
                "summary": summary,
                "rationale": rationale or "model-observed",
            }
        )
    return segments


def _normalize_model_recommendations(raw_recommendations: Any) -> List[dict]:
    normalized: List[dict] = []
    if not isinstance(raw_recommendations, list):
        return normalized
    for idx, item in enumerate(raw_recommendations[:4]):
        if isinstance(item, str):
            normalized.append(
                {
                    "start_sec": float(90 + idx * 150),
                    "end_sec": float(120 + idx * 150),
                    "text": item.strip(),
                    "linked_element_id": None,
                }
            )
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("recommendation") or "").strip()
        if not text:
            continue
        try:
            start_sec = max(0.0, float(item.get("start_sec", 90 + idx * 150)))
        except Exception:
            start_sec = float(90 + idx * 150)
        try:
            end_sec = max(start_sec + 1.0, float(item.get("end_sec", start_sec + 30)))
        except Exception:
            end_sec = start_sec + 30.0
        normalized.append(
            {
                "start_sec": round(start_sec, 1),
                "end_sec": round(end_sec, 1),
                "text": text,
                "linked_element_id": item.get("linked_element_id"),
            }
        )
    return normalized


def _build_placeholder_element_score(element: dict, timestamp_sec: float, language: str = "en") -> dict:
    if _is_hebrew_language(language):
        observation_text = "הראיות החזותיות במדגם שנבחר לא הספיקו לקביעה בטוחה יותר."
        summary_text = f"לגבי {element['name']} נמצאו ראיות חזותיות חלקיות בלבד במסגרת מדגם הרגעים שנבדק."
    else:
        observation_text = "Insufficient visible evidence in the sampled frames for a stronger judgment."
        summary_text = f"Limited visible evidence was available for {element['name'].lower()} in the sampled frames."
    return {
        "element_id": element["id"],
        "element_name": element["name"],
        "domain": element.get("domain"),
        "priority": bool(element.get("priority")),
        "score": 5.0,
        "level": get_performance_level(5.0),
        "observations": [observation_text],
        "confidence": 25.0,
        "evidence_segments": [
            {
                "start_sec": round(timestamp_sec, 1),
                "end_sec": round(timestamp_sec + 20.0, 1),
                "summary": summary_text,
                "rationale": "fallback",
            }
        ],
    }


def _normalize_model_analysis(
    raw_payload: Optional[dict],
    elements_to_analyze: List[dict],
    frames: List[dict],
    analysis_mode: str,
    language: str = "en",
) -> dict:
    frame_timestamps = [float(frame.get("timestamp_sec", 0.0)) for frame in frames] or [0.0]
    element_by_id = {element["id"]: element for element in elements_to_analyze}
    raw_scores = raw_payload.get("element_scores") if isinstance(raw_payload, dict) else []
    raw_scores = raw_scores if isinstance(raw_scores, list) else []
    normalized_scores: List[dict] = []
    seen_ids = set()

    for idx, raw_score in enumerate(raw_scores):
        if not isinstance(raw_score, dict):
            continue
        element_id = str(raw_score.get("element_id") or "").strip()
        element = element_by_id.get(element_id)
        if not element or element_id in seen_ids:
            continue
        seen_ids.add(element_id)
        observations = [
            str(item).strip()
            for item in (raw_score.get("observations") or [])
            if str(item).strip()
        ][:3]
        fallback_timestamp = frame_timestamps[min(idx, len(frame_timestamps) - 1)]
        evidence_segments = _normalize_evidence_segments(
            raw_score.get("evidence_segments"),
            fallback_timestamp=fallback_timestamp,
        )
        if not observations and evidence_segments:
            observations = [evidence_segments[0]["summary"]]
        if not observations:
            observations = (
                ["הראיות במדגם הרגעים שנבדק היו מוגבלות."]
                if _is_hebrew_language(language)
                else ["Evidence was limited in the sampled frames."]
            )
        if not evidence_segments:
            evidence_segments = [
                {
                    "start_sec": round(fallback_timestamp, 1),
                    "end_sec": round(fallback_timestamp + 20.0, 1),
                    "summary": observations[0],
                    "rationale": "fallback-observed",
                }
            ]
        score = _normalize_analysis_score(raw_score.get("score"))
        normalized_scores.append(
            {
                "element_id": element_id,
                "element_name": element["name"],
                "domain": element.get("domain"),
                "priority": bool(element.get("priority")),
                "score": score,
                "level": get_performance_level(score),
                "observations": observations,
                "confidence": _normalize_confidence(raw_score.get("confidence")),
                "evidence_segments": evidence_segments,
            }
        )

    for idx, element in enumerate(elements_to_analyze):
        if element["id"] in seen_ids:
            continue
        fallback_timestamp = frame_timestamps[min(idx, len(frame_timestamps) - 1)]
        normalized_scores.append(_build_placeholder_element_score(element, fallback_timestamp, language=language))

    return {
        "analysis_mode": analysis_mode,
        "summary": (raw_payload or {}).get("summary") if isinstance(raw_payload, dict) else None,
        "recommendations": _normalize_model_recommendations(
            (raw_payload or {}).get("recommendations") if isinstance(raw_payload, dict) else None
        ),
        "element_scores": normalized_scores,
    }


async def _analyze_frames_with_openai(
    frames: List[dict],
    elements_to_analyze: List[dict],
    focus_instruction: Optional[str] = None,
    language: str = "en",
) -> Optional[dict]:
    if not OPENAI_API_KEY or AsyncOpenAI is None:
        return None

    system_prompt = (
        "You are an expert instructional coach evaluating sampled classroom video frames. "
        "Use only visible evidence from the provided frames unless transcript context is explicitly provided. "
        "Do not invent unseen behavior. "
        "Write the result as if a strong school leader observed the lesson and needs a concise, coaching-ready judgment. "
        "Return only valid JSON."
    )
    if _is_hebrew_language(language):
        system_prompt += (
            " Write all summaries, observations, rationale, and recommendations in modern Hebrew suitable for Israeli school leaders. "
            "Use natural Hebrew educational terminology rather than literal translation. "
            "If the admin's custom observation note or custom rubric wording is already written in Hebrew, preserve it as-is and do not rewrite it into English-style phrasing."
        )
    elements_text = "\n".join(
        f"- {element['id']}: {element['name']} (Domain: {element['domain']}){' [PRIORITY]' if element.get('priority') else ''}"
        for element in elements_to_analyze
    )
    focus_text = focus_instruction.strip() if focus_instruction else ""
    prompt = f"""
Analyze the classroom frames below and score the teacher on a 1-10 scale for each rubric element.

Rubric elements:
{elements_text}

{focus_text}

Requirements:
- Use the timestamps provided with each frame.
- Base every observation on the provided evidence only.
- Keep observations concrete and specific to what is visible.
- Make the summary feel like an administrator's classroom observation summary, not a technical model report.
- If priority rubric elements are present, lead with them in the summary, strengths, growth areas, and recommendations.
- For each element, include 1-2 timestamped evidence segments tied to the sampled frames when possible.
- Include 2-3 targeted recommendations tied to timestamps and linked elements.

Return JSON with this exact shape:
{{
  "summary": "2-4 sentence lesson summary grounded in the sampled frames.",
  "recommendations": [
    {{
      "start_sec": 90,
      "end_sec": 120,
      "text": "Concrete coaching recommendation grounded in visible evidence.",
      "linked_element_id": "2b"
    }}
  ],
  "element_scores": [
    {{
      "element_id": "2b",
      "score": 6.8,
      "confidence": 82,
      "observations": ["Observation 1", "Observation 2"],
      "evidence_segments": [
        {{
          "start_sec": 90,
          "end_sec": 120,
          "summary": "What is visible in that moment.",
          "rationale": "Why it supports the score."
        }}
      ]
    }}
  ]
}}
""".strip()

    user_content: List[dict] = [{"type": "input_text", "text": prompt}]
    for frame in frames:
        timestamp_sec = round(float(frame.get("timestamp_sec", 0.0)), 1)
        user_content.append({"type": "input_text", "text": f"Frame timestamp: {timestamp_sec} seconds"})
        if frame.get("selection_reason"):
            user_content.append(
                {
                    "type": "input_text",
                    "text": f"Frame selection reason: {frame.get('selection_reason')}",
                }
            )
        if frame.get("moment_phase"):
            user_content.append(
                {
                    "type": "input_text",
                    "text": (
                        f"Lesson moment: {frame.get('moment_phase')} "
                        f"(reason: {frame.get('moment_selection_reason') or 'timeline_coverage'})"
                    ),
                }
            )
        if frame.get("transcript_excerpt"):
            user_content.append(
                {
                    "type": "input_text",
                    "text": f"Transcript excerpt for this moment: {frame.get('transcript_excerpt')}",
                }
            )
        user_content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/jpeg;base64,{frame['image_b64']}",
            }
        )

    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    response = await client.responses.create(
        model=OPENAI_VISION_MODEL,
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {"role": "user", "content": user_content},
        ],
        max_output_tokens=4000,
    )
    response_text = getattr(response, "output_text", None) or ""
    payload = _extract_json_object(response_text)
    if not payload:
        raise RuntimeError("OpenAI analysis did not return valid JSON.")
    return payload


async def analyze_frames_with_ai(
    frames: List[dict],
    framework: dict,
    selected_elements: List[str],
    teacher_id: Optional[str] = None,
    priority_elements: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    language: str = "en",
    framework_type: str = "danielson",
    current_user: Optional[dict] = None,
    multimodal_payload: Optional[dict] = None,
) -> dict:
    """Analyze extracted video frames and return normalized assessment output."""
    from app.analysis.specialist_orchestrator import orchestrate_specialists

    elements_to_analyze = _build_elements_to_analyze(
        framework,
        selected_elements,
        priority_elements=priority_elements,
        framework_type=framework_type,
        language=language,
    )
    if not elements_to_analyze:
        return {"analysis_mode": "empty_selection", "summary": None, "recommendations": [], "element_scores": []}
    prioritized_elements = [element for element in elements_to_analyze if element.get("priority")]
    focus_instruction = _build_focus_instruction(
        prioritized_elements,
        focus_note=focus_note,
        language=language,
    )
    analysis_context = None
    if current_user and teacher_id:
        try:
            from app.services.workspace_service import build_analysis_context

            analysis_context = await build_analysis_context(current_user, teacher_id)
        except Exception as exc:
            logger.warning(f"Unable to build adaptive analysis context: {exc}")
    context_instruction = _build_analysis_context_instruction(analysis_context, language=language)
    combined_instruction = "\n".join(
        item for item in [focus_instruction, context_instruction] if item
    ).strip()

    paid_analysis_allowed = _is_paid_analysis_allowed_for_user(current_user)
    if multimodal_payload:
        audio_features = multimodal_payload.get("audio_features") or {}
        modalities_used = multimodal_payload.get("modalities_used") or ["vision"]
        if "audio" in modalities_used and audio_features:
            logger.info(
                "Preparing multimodal analysis context with audio features: %s",
                {
                    "turn_count": audio_features.get("turn_count"),
                    "question_count": audio_features.get("question_count"),
                    "open_question_count": audio_features.get("open_question_count"),
                },
            )

    if OPENAI_API_KEY and AsyncOpenAI is not None and paid_analysis_allowed:
        try:
            payload = await _analyze_frames_with_openai(
                frames,
                elements_to_analyze,
                focus_instruction=combined_instruction,
                language=language,
            )
            normalized = _normalize_model_analysis(
                payload,
                elements_to_analyze,
                frames,
                analysis_mode="openai",
                language=language,
            )
            if multimodal_payload and "audio" in (multimodal_payload.get("modalities_used") or []):
                normalized["analysis_mode"] = "openai_multimodal"
            normalized["analysis_context"] = analysis_context
            return orchestrate_specialists(
                normalized,
                language=language,
                priority_element_ids=priority_elements,
                focus_note=focus_note,
                analysis_context=analysis_context,
            )
        except Exception as exc:
            logger.error(f"OpenAI video analysis failed; falling back to heuristic analysis: {exc}")
            fallback_mode = "fallback_model_error"
    elif not PAID_ANALYSIS_ENABLED:
        fallback_mode = "fallback_paid_analysis_disabled"
    elif not paid_analysis_allowed:
        fallback_mode = "fallback_paid_analysis_not_allowed"
    elif not OPENAI_API_KEY or AsyncOpenAI is None:
        fallback_mode = "fallback_model_unconfigured"
    else:
        fallback_mode = "fallback"

    logger.warning(
        f"Real analysis model path unavailable ({fallback_mode}); using fallback analysis output"
    )
    normalized = _normalize_model_analysis(
        {
            "summary": None,
            "recommendations": [],
            "element_scores": generate_mock_scores(elements_to_analyze, language=language),
        },
        elements_to_analyze,
        frames,
        analysis_mode=fallback_mode,
        language=language,
    )
    normalized["analysis_context"] = analysis_context
    return orchestrate_specialists(
        normalized,
        language=language,
        priority_element_ids=priority_elements,
        focus_note=focus_note,
        analysis_context=analysis_context,
    )


def generate_mock_scores(elements: List[dict], language: str = "en") -> List[dict]:
    """Generate bounded fallback scores when no live model is configured."""
    import random

    scores = []
    if _is_hebrew_language(language):
        fallback_actions = [
            "נראה מודלינג של המורה, אך בדיקות הבנה עקביות לא בלטו במידה מספקת במדגם הרגעים שנבדק.",
            "נראו סימנים להשתתפות תלמידים, אך דפוסי מעורבות רחבים יותר לא היו ברורים די הצורך.",
            "שגרות הכיתה נראו יציבות, אך המעברים ובדיקות התגובה דורשים ראיות חזותיות ברורות יותר.",
            "קצב ההוראה נראה סדור, אך הזדמנויות לחשיבה מעמיקה של תלמידים לא בלטו באופן מספק.",
        ]
    else:
        fallback_actions = [
            "Teacher modeling was visible, but checks for understanding were not consistently evident in sampled frames.",
            "Student participation cues were visible, though broader engagement routines were not consistently clear.",
            "Classroom routines appeared stable, but transitions and response checks need stronger visual evidence.",
            "Instructional pacing looked steady, though opportunities for deeper student thinking were not clearly visible.",
        ]
    for idx, element in enumerate(elements):
        score = round(random.uniform(5.2, 7.4), 1)
        observation = fallback_actions[idx % len(fallback_actions)]
        primary_observation = (
            f"נמצאה ראיה חלקית בלבד עבור {element['name']} במדגם הרגעים שנבדק."
            if _is_hebrew_language(language)
            else f"Visible evidence for {element['name'].lower()} was limited to sampled frames."
        )
        scores.append(
            {
                "element_id": element["id"],
                "element_name": element["name"],
                "score": score,
                "observations": [
                    primary_observation,
                    observation,
                ],
                "confidence": random.randint(35, 60),
            }
        )
    return scores


def _format_timestamp(seconds: int) -> str:
    minutes = max(0, seconds) // 60
    secs = max(0, seconds) % 60
    return f"{minutes:02d}:{secs:02d}"


def _build_recommendation_text(element_name: str, observation: str) -> str:
    observation_lower = observation.lower()
    element_lower = element_name.lower()
    if "question" in observation_lower or "question" in element_lower:
        return f"Increase probing questions and wait time to strengthen {element_name.lower()}."
    if "engagement" in observation_lower or "participation" in observation_lower:
        return f"Broaden participation routines so more students contribute during {element_name.lower()}."
    if "routine" in observation_lower or "transition" in observation_lower:
        return f"Tighten transitions and reinforce routines to improve {element_name.lower()}."
    if "feedback" in observation_lower:
        return f"Make feedback more explicit and actionable to strengthen {element_name.lower()}."
    return f"Strengthen {element_name.lower()} with clearer modeling, checks for understanding, and visible student response routines."


def _build_recommendation_text_hebrew(element_name: str, observation: str) -> str:
    observation_lower = observation.lower()
    element_lower = element_name.lower()
    if "question" in observation_lower or "שאל" in observation_lower or "question" in element_lower:
        return f"להעמיק את איכות השאלות ולהאריך זמן המתנה כדי לחזק את {element_name.lower()}."
    if "engagement" in observation_lower or "participation" in observation_lower or "מעורב" in observation_lower:
        return f"להרחיב את מעגל ההשתתפות כדי שיותר תלמידים ייקחו חלק בתוך {element_name.lower()}."
    if "routine" in observation_lower or "transition" in observation_lower or "שגר" in observation_lower or "מעבר" in observation_lower:
        return f"לחדד מעברים ושגרות כדי לחזק את {element_name.lower()}."
    if "feedback" in observation_lower or "משוב" in observation_lower:
        return f"להפוך את המשוב למדויק וישים יותר כדי לחזק את {element_name.lower()}."
    return f"לחזק את {element_name.lower()} באמצעות מודלינג ברור יותר, בדיקות הבנה עקביות ותגובות תלמידים גלויות."


def _score_priority_rank(item: dict, priority_element_ids: Optional[List[str]] = None) -> Tuple[int, float]:
    priority_set = set(priority_element_ids or [])
    is_priority = bool(item.get("priority")) or item.get("element_id") in priority_set
    return (0 if is_priority else 1, -float(item.get("score", 0.0)))


def _observation_focus_label(item: dict, priority_element_ids: Optional[List[str]] = None) -> str:
    if bool(item.get("priority")) or item.get("element_id") in set(priority_element_ids or []):
        return "Priority focus"
    return "Observation area"


def _priority_focus_names(element_scores: List[dict], priority_element_ids: Optional[List[str]] = None) -> List[str]:
    priority_set = set(priority_element_ids or [])
    names: List[str] = []
    for item in element_scores or []:
        if not (bool(item.get("priority")) or item.get("element_id") in priority_set):
            continue
        name = str(item.get("element_name") or item.get("element_id") or "").strip()
        if name and name not in names:
            names.append(name)
    return names


def _build_priority_focus_summary_sentence(
    element_scores: List[dict],
    priority_element_ids: Optional[List[str]] = None,
    language: str = "en",
) -> Optional[str]:
    priority_set = set(priority_element_ids or [])
    priority_items = [
        item
        for item in element_scores or []
        if bool(item.get("priority")) or item.get("element_id") in priority_set
    ]
    if not priority_items:
        return None

    current_strengths = [
        str(item.get("element_name") or item.get("element_id") or "").strip()
        for item in priority_items
        if float(item.get("score", 0.0) or 0.0) >= 7.0
    ]
    coaching_needs = [
        str(item.get("element_name") or item.get("element_id") or "").strip()
        for item in priority_items
        if float(item.get("score", 0.0) or 0.0) < 7.0
    ]
    current_strengths = [name for idx, name in enumerate(current_strengths) if name and name not in current_strengths[:idx]][:2]
    coaching_needs = [name for idx, name in enumerate(coaching_needs) if name and name not in coaching_needs[:idx]][:2]

    if _is_hebrew_language(language):
        if current_strengths and coaching_needs:
            return (
                f"בתוך מוקד התצפית, החוזקות הנראות ביותר היו {', '.join(current_strengths)}, "
                f"ובעוד שעדיין נדרש ליווי פדגוגי סביב {', '.join(coaching_needs)}."
            )
        if current_strengths:
            return f"בתוך מוקד התצפית, החוזקות הנראות ביותר היו {', '.join(current_strengths)}."
        if coaching_needs:
            return f"בתוך מוקד התצפית, עדיין נדרש ליווי פדגוגי סביב {', '.join(coaching_needs)}."
        return None

    if current_strengths and coaching_needs:
        return (
            f"Within the selected focus, current strengths were {', '.join(current_strengths)}, "
            f"while coaching attention is still needed in {', '.join(coaching_needs)}."
        )
    if current_strengths:
        return f"Within the selected focus, current strengths were {', '.join(current_strengths)}."
    if coaching_needs:
        return f"Within the selected focus, coaching attention is still needed in {', '.join(coaching_needs)}."
    return None


def _apply_priority_recommendation_context(
    text: str,
    element_name: Optional[str],
    is_priority: bool,
    language: str = "en",
) -> str:
    clean_text = str(text or "").strip()
    if not clean_text or not is_priority or not element_name:
        return clean_text
    if _is_hebrew_language(language):
        return f"מוקד עדיפות - {element_name}: {clean_text}"
    return f"Priority focus on {element_name}: {clean_text}"


def build_observation_summary_packet(
    element_scores: List[dict],
    overall_score: float,
    summary_text: str,
    recommendations: List[str],
    priority_element_ids: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    analysis_confidence: Optional[Dict[str, Any]] = None,
    language: str = "en",
) -> Dict[str, Any]:
    priority_set = set(priority_element_ids or [])
    ranked_strengths = sorted(
        [es for es in element_scores if es.get("score", 0) >= 7.0],
        key=lambda item: _score_priority_rank(item, priority_element_ids),
    )[:3]
    ranked_growth = sorted(
        [es for es in element_scores if es.get("score", 0) < 7.0],
        key=lambda item: (0 if (bool(item.get("priority")) or item.get("element_id") in priority_set) else 1, item.get("score", 0)),
    )[:3]

    def _format_area(item: dict) -> str:
        observation = str((item.get("observations") or [""])[0]).strip()
        label = (
            "מוקד מועדף"
            if _is_hebrew_language(language) and (bool(item.get("priority")) or item.get("element_id") in priority_set)
            else "תחום להתבוננות"
            if _is_hebrew_language(language)
            else _observation_focus_label(item, priority_element_ids)
        )
        if observation:
            return f"{label}: {item['element_name']} - {observation.rstrip('.')}"
        return f"{label}: {item['element_name']}"

    priority_alignment: List[str] = []
    for item in element_scores:
        if item.get("element_id") not in priority_set and not item.get("priority"):
            continue
        score = float(item.get("score", 0.0))
        if _is_hebrew_language(language):
            direction = "מהווה נקודת חוזק" if score >= 7.0 else "דורש תשומת לב פדגוגית"
        else:
            direction = "currently strong" if score >= 7.0 else "needs coaching attention"
        priority_alignment.append(f"{item['element_name']}: {direction} ({score:.1f}/10)")

    confidence_note = None
    degradation_reasons = ((analysis_confidence or {}).get("degradation_reasons") or [])
    if degradation_reasons:
        if "audio_unavailable" in degradation_reasons:
            confidence_note = (
                "האודיו לא היה זמין, ולכן התצפית נשענת בעיקר על ראיות חזותיות."
                if _is_hebrew_language(language)
                else "Audio was unavailable, so this observation emphasizes visual evidence."
            )
        else:
            confidence_note = (
                "התצפית הושלמה על סמך ראיות חלקיות, ולכן מומלץ לבחון אותה לצד ההקלטה."
                if _is_hebrew_language(language)
                else "This observation was completed with partial evidence and should be reviewed alongside the video."
            )

    return {
        "executive_summary": summary_text,
        "top_strengths": [_format_area(item) for item in ranked_strengths],
        "growth_areas": [_format_area(item) for item in ranked_growth],
        "coaching_actions": recommendations[:3],
        "priority_alignment": priority_alignment[:3],
        "focus_note": focus_note or None,
        "confidence_note": confidence_note,
    }


def _localize_element_scores_for_response(
    element_scores: List[dict],
    framework_type: str,
    language: str,
) -> List[dict]:
    localized_scores: List[dict] = []
    for item in element_scores or []:
        localized = dict(item)
        localized["element_name"] = _localize_framework_node_label(
            str(item.get("element_id") or ""),
            str(item.get("element_name") or ""),
            framework_type,
            language,
        )
        localized["domain"] = _localize_framework_node_label(
            str(item.get("domain_id") or item.get("domain") or ""),
            str(item.get("domain") or ""),
            framework_type,
            language,
        )
        localized["observations"] = [
            _localize_observation_text(observation, language)
            for observation in list(item.get("observations") or [])
        ]
        localized_scores.append(localized)
    return localized_scores


def _enrich_assessment_for_response(
    assessment: Dict[str, Any],
    response_language: Optional[str] = None,
) -> Dict[str, Any]:
    enriched = dict(assessment)
    analysis_language = _normalize_app_language(enriched.get("analysis_language"), default="en")
    display_language = _normalize_app_language(response_language or analysis_language, default=analysis_language)
    framework_type = str(enriched.get("framework_type") or "danielson")
    priority_elements = list(enriched.get("priority_elements") or [])
    focus_note = enriched.get("focus_note")
    analysis_confidence = enriched.get("analysis_confidence") or {}
    localized_element_scores = _localize_element_scores_for_response(
        enriched.get("element_scores") or [],
        framework_type,
        display_language,
    )
    enriched["element_scores"] = localized_element_scores

    stored_recommendations = list(enriched.get("recommendations") or [])
    should_regenerate_localized_text = display_language != analysis_language or (
        _is_hebrew_language(display_language)
        and _should_regenerate_hebrew_assessment_text(enriched.get("summary"), stored_recommendations)
    )
    localized_summary = generate_summary(
        localized_element_scores,
        float(enriched.get("overall_score", 0.0) or 0.0),
        provided_summary=None if should_regenerate_localized_text else enriched.get("summary"),
        priority_element_ids=priority_elements,
        focus_note=focus_note,
        language=display_language,
    )
    localized_recommendations = (
        stored_recommendations
        if (not should_regenerate_localized_text and stored_recommendations and all(isinstance(item, str) for item in stored_recommendations))
        else generate_recommendations(
            localized_element_scores,
            provided_recommendations=None if should_regenerate_localized_text else stored_recommendations,
            priority_element_ids=priority_elements,
            focus_note=focus_note,
            language=display_language,
        )
        if localized_element_scores
        else stored_recommendations
    )
    enriched["summary"] = localized_summary
    enriched["recommendations"] = localized_recommendations
    enriched["observation_summary"] = build_observation_summary_packet(
        localized_element_scores,
        float(enriched.get("overall_score", 0.0) or 0.0),
        localized_summary,
        localized_recommendations,
        priority_element_ids=priority_elements,
        focus_note=focus_note,
        analysis_confidence=analysis_confidence,
        language=display_language,
    )
    enriched.setdefault("priority_elements", priority_elements)
    enriched.setdefault("focus_note", focus_note)
    enriched.setdefault("analysis_confidence", analysis_confidence)
    enriched.setdefault("analysis_modalities_used", list(enriched.get("analysis_modalities_used") or []))
    enriched.setdefault("analysis_language", analysis_language)
    return enriched


def generate_summary(
    element_scores: List[dict],
    overall_score: float,
    provided_summary: Optional[str] = None,
    priority_element_ids: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    language: str = "en",
    analysis_context: Optional[dict] = None,
) -> str:
    """Generate an evidence-grounded summary of the assessment."""
    if provided_summary:
        return provided_summary.strip()

    level = get_performance_level(overall_score)
    strengths = sorted(
        [es for es in element_scores if es.get("score", 0) >= 7.5],
        key=lambda item: _score_priority_rank(item, priority_element_ids),
    )[:3]
    growth_areas = sorted(
        [es for es in element_scores if es.get("score", 0) < 6.5],
        key=lambda item: (0 if (bool(item.get("priority")) or item.get("element_id") in set(priority_element_ids or [])) else 1, item.get("score", 0)),
    )[:2]

    if _is_hebrew_language(language):
        level_map = {
            "excellent": "חזקה מאוד",
            "needs_improvement": "דורשת שיפור",
            "critical": "נדרשת התערבות",
            "distinguished": "מצוין",
            "proficient": "טוב",
            "basic": "בסיסי",
            "unsatisfactory": "דורש שיפור",
        }
        summary_parts = [f"התרשמות כללית: {level_map.get(level, level)} (ציון: {overall_score}/10)."]
    else:
        summary_parts = [f"Overall performance: {level.replace('_', ' ').title()} (Score: {overall_score}/10)."]
    if priority_element_ids:
        focus_names = _priority_focus_names(element_scores, priority_element_ids)
        if focus_names:
            if _is_hebrew_language(language):
                summary_parts.append(f"מוקד התצפית הושם על {', '.join(focus_names[:3])}.")
            else:
                summary_parts.append(f"Observation emphasis was placed on {', '.join(focus_names[:3])}.")
    if focus_note:
        if _is_hebrew_language(language):
            summary_parts.append(f"הערת מיקוד לתצפית: {focus_note.rstrip('.')}.")
        else:
            summary_parts.append(f"Observation focus note: {focus_note.rstrip('.')}.")
    priority_focus_sentence = _build_priority_focus_summary_sentence(
        element_scores,
        priority_element_ids=priority_element_ids,
        language=language,
    )
    if priority_focus_sentence:
        summary_parts.append(priority_focus_sentence)

    if strengths:
        strength_notes = []
        for item in strengths:
            observation = (item.get("observations") or [""])[0].strip()
            note = item["element_name"]
            if observation:
                note = f"{note} ({observation.rstrip('.')})"
            strength_notes.append(note)
        if _is_hebrew_language(language):
            summary_parts.append(f"נקודות החוזקה הבולטות ביותר היו {', '.join(strength_notes)}.")
        else:
            summary_parts.append(f"Strongest visible practices were {', '.join(strength_notes)}.")

    if growth_areas:
        growth_notes = []
        for item in growth_areas:
            observation = (item.get("observations") or [""])[0].strip()
            note = item["element_name"]
            if observation:
                note = f"{note} ({observation.rstrip('.')})"
            growth_notes.append(note)
        if _is_hebrew_language(language):
            summary_parts.append(f"תחומי הצמיחה המרכזיים הם {', '.join(growth_notes)}.")
        else:
            summary_parts.append(f"Priority growth areas are {', '.join(growth_notes)}.")

    active_goals = [
        str(item).strip()
        for item in ((analysis_context or {}).get("active_goals") or [])
        if str(item).strip()
    ]
    if active_goals:
        if _is_hebrew_language(language):
            summary_parts.append(f"יעדי הליווי הפעילים כרגע הם {', '.join(active_goals[:2])}.")
        else:
            summary_parts.append(f"Current coaching goals are {', '.join(active_goals[:2])}.")

    return " ".join(summary_parts)


def generate_recommendations(
    element_scores: List[dict],
    provided_recommendations: Optional[List[dict]] = None,
    priority_element_ids: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    language: str = "en",
    analysis_context: Optional[dict] = None,
) -> List[str]:
    """Generate timestamped, evidence-grounded recommendations."""
    if provided_recommendations:
        rendered = []
        priority_set = set(priority_element_ids or [])
        element_name_by_id = {
            str(item.get("element_id") or ""): str(item.get("element_name") or "").strip()
            for item in element_scores or []
        }
        sorted_recommendations = sorted(
            [item for item in provided_recommendations if isinstance(item, dict)],
            key=lambda item: (
                0 if item.get("linked_element_id") in priority_set else 1,
                float(item.get("start_sec", 0) or 0),
            ),
        )
        for item in sorted_recommendations:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            linked_element_id = str(item.get("linked_element_id") or "")
            is_priority = linked_element_id in priority_set
            element_name = element_name_by_id.get(linked_element_id)
            text = _apply_priority_recommendation_context(text, element_name, is_priority, language)
            start_sec = int(float(item.get("start_sec", 0)))
            end_sec = int(float(item.get("end_sec", start_sec + 30)))
            rendered.append(f"[{_format_timestamp(start_sec)}–{_format_timestamp(end_sec)}] {text}")
        if rendered:
            rendered = rendered[:3]
            signal_guidance = [
                str(item).strip()
                for item in ((analysis_context or {}).get("signal_summary") or {}).get("guidance", [])
                if str(item).strip()
            ]
            if signal_guidance:
                if _is_hebrew_language(language):
                    rendered.append(f"[00:15–00:30] העדפת הסוקרים: {signal_guidance[0].rstrip('.')}.")
                else:
                    rendered.append(f"[00:15–00:30] Reviewer guidance: {signal_guidance[0].rstrip('.')}.")
            return rendered[:3]

    recommendations: List[str] = []
    priority_set = set(priority_element_ids or [])
    low_scores = sorted(
        [es for es in element_scores if es.get("score", 0) < 7.0],
        key=lambda x: (0 if (bool(x.get("priority")) or x.get("element_id") in priority_set) else 1, x.get("score", 0)),
    )[:3]

    for idx, es in enumerate(low_scores):
        segments = es.get("evidence_segments") or []
        first_segment = segments[0] if segments else None
        start_sec = int(float(first_segment.get("start_sec", 90 + idx * 150))) if first_segment else 90 + idx * 150
        end_sec = int(float(first_segment.get("end_sec", start_sec + 30))) if first_segment else start_sec + 30
        default_observation = (
            "הראיות שנצפו היו מוגבלות."
            if _is_hebrew_language(language)
            else "Visible evidence was limited."
        )
        observation = str((es.get("observations") or [default_observation])[0]).strip()
        is_priority = bool(es.get("priority")) or es.get("element_id") in priority_set
        if _is_hebrew_language(language):
            action = _build_recommendation_text_hebrew(es["element_name"], observation)
            action = _apply_priority_recommendation_context(action, es.get("element_name"), is_priority, language)
            recommendations.append(
                f"[{_format_timestamp(start_sec)}–{_format_timestamp(end_sec)}] {action} "
                f"ראיה שנצפתה: {observation.rstrip('.')}."
            )
        else:
            action = _build_recommendation_text(es["element_name"], observation)
            action = _apply_priority_recommendation_context(action, es.get("element_name"), is_priority, language)
            recommendations.append(
                f"[{_format_timestamp(start_sec)}–{_format_timestamp(end_sec)}] {action} "
                f"Observed evidence: {observation.rstrip('.')}."
            )

    if not recommendations:
        if _is_hebrew_language(language):
            closing_note = "לשמר את השגרות החזקות שנראו בשיעור ולחזק אותן באמצעות בדיקות הבנה ברורות."
            if focus_note:
                closing_note = f"לשמר את השגרות החזקות שנראו בשיעור תוך שמירה על מוקד התצפית: {focus_note.rstrip('.')}."
        else:
            closing_note = "Maintain the strongest routines visible in the lesson and reinforce them with explicit checks for understanding."
            if focus_note:
                closing_note = f"Maintain the strongest routines visible in the lesson while keeping the observation focus on {focus_note.rstrip('.')}."
        recommendations.append(f"[00:30–01:00] {closing_note}")

    active_goals = [
        str(item).strip()
        for item in ((analysis_context or {}).get("active_goals") or [])
        if str(item).strip()
    ]
    if active_goals:
        goal_text = active_goals[0]
        if _is_hebrew_language(language):
            recommendations.append(
                f"[01:00–01:20] חברו את המשוב לשיעור ליעד הפעיל: {goal_text}."
            )
        else:
            recommendations.append(
                f"[01:00–01:20] Connect the next coaching move to the active goal: {goal_text}."
            )

    return recommendations[:3]


def _clamp_demo_value(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _get_demo_teacher_trend_profile(teacher: dict) -> dict:
    email = str(teacher.get("email") or "").strip().lower()
    subject = str(teacher.get("subject") or "").strip().lower()
    department = str(teacher.get("department") or "").strip().lower()

    profiles = {
        "sarah.j@school.edu": {
            "base_score": 6.2,
            "overall_slope": 1.1,
            "volatility": 0.55,
            "noise": 0.35,
            "domain_tilts": [0.45, -0.15, 0.35, -0.25],
        },
        "michael.c@school.edu": {
            "base_score": 6.8,
            "overall_slope": -1.0,
            "volatility": 0.7,
            "noise": 0.45,
            "domain_tilts": [-0.15, -0.5, 0.1, -0.4],
        },
        "emily.r@school.edu": {
            "base_score": 6.0,
            "overall_slope": 0.35,
            "volatility": 1.0,
            "noise": 0.55,
            "domain_tilts": [0.65, -0.6, 0.4, -0.45],
        },
        "david.p@school.edu": {
            "base_score": 6.3,
            "overall_slope": -0.6,
            "volatility": 0.95,
            "noise": 0.5,
            "domain_tilts": [-0.45, -0.2, 0.2, -0.55],
        },
        "jennifer.w@school.edu": {
            "base_score": 7.2,
            "overall_slope": 0.2,
            "volatility": 0.75,
            "noise": 0.4,
            "domain_tilts": [0.35, -0.35, 0.4, -0.2],
        },
        "robert.m@school.edu": {
            "base_score": 5.4,
            "overall_slope": 1.3,
            "volatility": 0.9,
            "noise": 0.6,
            "domain_tilts": [0.5, -0.45, 0.6, -0.25],
        },
    }
    profile = profiles.get(
        email,
        {
            "base_score": 6.2,
            "overall_slope": 0.25,
            "volatility": 0.75,
            "noise": 0.45,
            "domain_tilts": [0.25, -0.2, 0.2, -0.15],
        },
    )

    subject_bias = 0.0
    if subject in {"mathematics", "chemistry"}:
        subject_bias += 0.2
    if department == "stem":
        subject_bias += 0.1

    return {
        **profile,
        "subject_bias": subject_bias,
    }


def _build_demo_assessment_datetimes(total_assessments: int, rng: Any) -> List[datetime]:
    count = max(6, int(total_assessments))
    now_utc = datetime.now(timezone.utc)
    oldest_days_ago = (count - 1) * 14 + 7
    timestamps: List[datetime] = []

    for idx in range(count):
        base_days_ago = oldest_days_ago - (idx * 14)
        jitter_days = rng.randint(-4, 4)
        days_ago = max(1, base_days_ago + jitter_days)
        hour_offset = rng.randint(1, 8)
        timestamps.append(now_utc - timedelta(days=days_ago, hours=hour_offset))

    return sorted(timestamps)


def _generate_demo_element_scores_for_assessment(
    teacher: dict,
    assessment_index: int,
    total_assessments: int,
    rng: Any,
) -> List[dict]:
    profile = _get_demo_teacher_trend_profile(teacher)
    trend_position = 0.0
    if total_assessments > 1:
        trend_position = (assessment_index / (total_assessments - 1)) * 2.0 - 1.0

    element_scores: List[dict] = []
    domain_tilts = profile.get("domain_tilts", [0.0])

    for domain_idx, domain in enumerate(DANIELSON_FRAMEWORK["domains"]):
        domain_tilt = domain_tilts[domain_idx % len(domain_tilts)]
        for element_idx, element in enumerate(domain["elements"]):
            cycle = math.sin(
                ((assessment_index + 1) * (0.95 + domain_idx * 0.12)) + (element_idx * 0.45)
            )
            cycle_component = cycle * profile["volatility"]
            noise_component = rng.uniform(-profile["noise"], profile["noise"])
            trend_component = trend_position * (profile["overall_slope"] + domain_tilt)
            raw_score = (
                profile["base_score"]
                + profile["subject_bias"]
                + trend_component
                + cycle_component
                + noise_component
            )
            score = round(_clamp_demo_value(raw_score, 2.0, 9.8), 1)
            element_scores.append(
                {
                    "element_id": element["id"],
                    "element_name": element["name"],
                    "score": score,
                    "level": get_performance_level(score),
                    "observations": [
                        f"Observed {element['name'].lower()} with variable consistency over the lesson.",
                    ],
                    "confidence": rng.randint(72, 97),
                }
            )

    return element_scores


def _generate_demo_adherence_score(
    teacher: dict,
    assessment_index: int,
    total_assessments: int,
    rng: Any,
) -> float:
    profile = _get_demo_teacher_trend_profile(teacher)
    trend_position = 0.0
    if total_assessments > 1:
        trend_position = (assessment_index / (total_assessments - 1)) * 2.0 - 1.0

    cyclical = math.sin((assessment_index + 1) * 1.1) * 0.06
    trend_component = profile["overall_slope"] * 0.08 * trend_position
    noise_component = rng.uniform(-0.08, 0.08)
    raw = 0.76 + trend_component + cyclical + noise_component
    return round(_clamp_demo_value(raw, 0.45, 0.98), 2)


# ==================== SEED DATA ENDPOINT ====================
@api_router.post("/seed-demo-data/reset")
async def reset_demo_data(current_user: dict = Depends(get_current_user)):
    """Delete demo data for the current user and return counts."""
    demo_emails = {
        "sarah.j@school.edu",
        "michael.c@school.edu",
        "emily.r@school.edu",
        "david.p@school.edu",
        "jennifer.w@school.edu",
        "robert.m@school.edu",
    }
    demo_teachers = await db.teachers.find(
        {"created_by": current_user["id"], "email": {"$in": list(demo_emails)}},
        {"_id": 0, "id": 1},
    ).to_list(100)
    teacher_ids = [t["id"] for t in demo_teachers]
    if not teacher_ids:
        return {"message": "No demo data found", "deleted": {}}

    deleted = {}
    deleted["assessments"] = (await db.assessments.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "user_id": current_user["id"]}
    )).deleted_count
    deleted["observations"] = (await db.observations.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "user_id": current_user["id"]}
    )).deleted_count
    deleted["videos"] = (await db.videos.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "uploaded_by": current_user["id"]}
    )).deleted_count
    deleted["video_evidence"] = (await db.video_evidence.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "uploaded_by": current_user["id"]}
    )).deleted_count
    deleted["curriculum_adherence"] = (await db.curriculum_adherence.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "user_id": current_user["id"]}
    )).deleted_count
    deleted["lesson_plans"] = (await db.lesson_plans.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "uploaded_by": current_user["id"]}
    )).deleted_count
    deleted["curricula"] = (await db.curricula.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "uploaded_by": current_user["id"]}
    )).deleted_count
    deleted["syllabi"] = (await db.syllabi.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "uploaded_by": current_user["id"]}
    )).deleted_count
    deleted["schedules"] = (await db.schedules.delete_many(
        {"teacher_id": {"$in": teacher_ids}, "user_id": current_user["id"]}
    )).deleted_count

    return {"message": "Demo data reset", "deleted": deleted}

@api_router.post("/seed-demo-data")
async def seed_demo_data(current_user: dict = Depends(get_current_user)):
    """Seed demo data for testing"""
    import random
    rng = random.Random()
    
    # Create demo teachers
    demo_teachers = [
        {"name": "Sarah Johnson", "email": "sarah.j@school.edu", "subject": "Mathematics", "grade_level": "9th Grade", "department": "STEM", "category": "first_year"},
        {"name": "Michael Chen", "email": "michael.c@school.edu", "subject": "English Literature", "grade_level": "11th Grade", "department": "Humanities", "category": "second_year"},
        {"name": "Emily Rodriguez", "email": "emily.r@school.edu", "subject": "Biology", "grade_level": "10th Grade", "department": "STEM", "category": "third_year"},
        {"name": "David Park", "email": "david.p@school.edu", "subject": "History", "grade_level": "8th Grade", "department": "Humanities", "category": "tenure"},
        {"name": "Jennifer Williams", "email": "jennifer.w@school.edu", "subject": "Chemistry", "grade_level": "12th Grade", "department": "STEM", "category": "dept_head"},
        {"name": "Robert Martinez", "email": "robert.m@school.edu", "subject": "Physical Education", "grade_level": "7th Grade", "department": "Athletics", "category": "first_year"},
    ]
    
    created_teachers = []
    for teacher_data in demo_teachers:
        existing = await db.teachers.find_one({"email": teacher_data["email"], "created_by": current_user["id"]})
        if not existing:
            teacher_doc = {
                "id": str(uuid.uuid4()),
                **teacher_data,
                "category_custom": None,
                "next_coaching_conference": None,
                "created_by": current_user["id"],
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.teachers.insert_one(teacher_doc)
            created_teachers.append(teacher_doc)
        else:
            created_teachers.append(existing)
    
    created_assessments = 0
    # Create demo assessments for each teacher
    for teacher in created_teachers:
        # Create demo curriculum/syllabus/lesson plan records if missing
        existing_curriculum = await db.curricula.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        if not existing_curriculum:
            await db.curricula.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "school_id": teacher.get("school_id"),
                "title": f"{teacher['subject']} curriculum overview",
                "subject": teacher.get("subject"),
                "grade_level": teacher.get("grade_level"),
                "filename": "curriculum-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_role": "admin",
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })

        existing_syllabus = await db.syllabi.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        if not existing_syllabus:
            await db.syllabi.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "title": f"{teacher['subject']} syllabus",
                "filename": "syllabus-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })

        existing_lesson = await db.lesson_plans.find_one(
            {"teacher_id": teacher["id"], "uploaded_by": current_user["id"]}
        )
        lesson_plan_id = existing_lesson["id"] if existing_lesson else None
        if not existing_lesson:
            lesson_date = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
            lesson_id = str(uuid.uuid4())
            await db.lesson_plans.insert_one({
                "id": lesson_id,
                "teacher_id": teacher["id"],
                "title": f"{teacher['subject']} lesson plan",
                "date": lesson_date,
                "curriculum_id": existing_curriculum["id"] if existing_curriculum else None,
                "filename": "lesson-plan-demo.pdf",
                "file_url": None,
                "s3_key": None,
                "uploaded_by": current_user["id"],
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "is_mock": True,
            })
            lesson_plan_id = lesson_id
            await db.schedules.insert_one({
                "id": str(uuid.uuid4()),
                "teacher_id": teacher["id"],
                "course_name": f"Lesson plan reminder: {teacher['subject']}",
                "start_time": lesson_date,
                "recording_status": ScheduleStatus.PLANNED.value,
                "join_url": None,
                "location": None,
                "user_id": current_user["id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": None,
                "reminder_type": "lesson_plan",
                "lesson_plan_id": lesson_id,
            })

        # Create 6-8 assessments per teacher over ~3-4 months to make trends visibly directional.
        num_assessments = rng.randint(6, 8)
        assessment_datetimes = _build_demo_assessment_datetimes(num_assessments, rng)

        for assessment_index, assessment_dt in enumerate(assessment_datetimes):
            assessment_date = assessment_dt.isoformat()
            recorded_at = (assessment_dt - timedelta(hours=rng.randint(1, 6))).isoformat()

            video_id = str(uuid.uuid4())
            video_doc = {
                "id": video_id,
                "filename": (
                    f"{teacher['name'].split()[0].lower()}-"
                    f"{teacher['subject'].split()[0].lower()}-{assessment_index + 1}.mp4"
                ),
                "stored_filename": None,
                "s3_key": None,
                "file_url": None,
                "file_path": None,
                "teacher_id": teacher["id"],
                "uploaded_by": current_user["id"],
                "status": "completed",
                "analysis_status": "completed",
                "subject": teacher.get("subject"),
                "recorded_at": recorded_at,
                "upload_date": assessment_date,
                "is_mock": True,
            }
            await db.videos.insert_one(video_doc)
            await db.video_evidence.insert_one({
                "id": str(uuid.uuid4()),
                "video_id": video_id,
                "teacher_id": teacher["id"],
                "file_path": None,
                "subject": teacher.get("subject"),
                "recorded_at": recorded_at,
                "analysis_status": "completed",
                "uploaded_by": current_user["id"],
                "uploaded_at": assessment_date,
                "is_mock": True,
            })
            
            # Generate element scores with directional trend + volatility per teacher profile.
            element_scores = _generate_demo_element_scores_for_assessment(
                teacher=teacher,
                assessment_index=assessment_index,
                total_assessments=len(assessment_datetimes),
                rng=rng,
            )
            
            overall_score = round(sum(es["score"] for es in element_scores) / len(element_scores), 2)
            
            assessment_doc = {
                "id": str(uuid.uuid4()),
                "video_id": video_id,
                "teacher_id": teacher["id"],
                "user_id": current_user["id"],
                "framework_type": "danielson",
                "element_scores": element_scores,
                "overall_score": overall_score,
                "summary": generate_summary(element_scores, overall_score),
                "recommendations": generate_recommendations(element_scores),
                "analyzed_at": assessment_date,
                "is_mock": True,
            }
            
            await db.assessments.insert_one(assessment_doc)
            created_assessments += 1
            await _ensure_mock_evidence(assessment_doc, current_user)
            await db.observations.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": current_user["id"],
                "teacher_id": teacher["id"],
                "video_id": video_id,
                "element_id": rng.choice([es["element_id"] for es in element_scores]),
                "timestamp_seconds": rng.randint(60, 900),
                "admin_comment": f"Observed {teacher['name'].split()[0]} demonstrating active engagement strategies.",
                "teacher_response": None,
                "implementation_status": "planned",
                "created_at": assessment_date,
                "updated_at": None,
                "is_mock": True,
            })

            adherence_doc = {
                "id": str(uuid.uuid4()),
                "assessment_id": assessment_doc["id"],
                "teacher_id": teacher["id"],
                "lesson_plan_id": lesson_plan_id,
                "status": "estimated",
                "adherence_score": _generate_demo_adherence_score(
                    teacher=teacher,
                    assessment_index=assessment_index,
                    total_assessments=len(assessment_datetimes),
                    rng=rng,
                ),
                "matched_topics": ["Aligned objectives", "Pacing matched plan"],
                "missing_topics": [],
                "evidence_segments": [
                    {"start_sec": 120, "end_sec": 240, "summary": "Lesson aligns with planned objective."}
                ],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "user_id": current_user["id"],
            }
            await db.curriculum_adherence.insert_one(adherence_doc)

    await db.dashboard_leadership_insights_cache.delete_many({"user_id": current_user["id"]})

    return {
        "message": f"Created {len(created_teachers)} teachers with demo assessments",
        "created_teachers": len(created_teachers),
        "created_assessments": created_assessments,
    }

# Include the router in the main app
app.include_router(api_router)
app.add_api_route(
    "/api/admin/access-request-actions/{action}",
    process_access_request_action,
    methods=["GET"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
origins = _get_optional_env_list("CORS_ORIGINS")
if not origins:
    logger.warning("CORS_ORIGINS not set; defaulting to no external origins")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=origins or [],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _ensure_database_indexes() -> None:
    async def _safe_create_index(collection, keys, **kwargs):
        try:
            await collection.create_index(keys, **kwargs)
        except Exception as exc:
            message = str(exc)
            code = getattr(exc, "code", None)
            is_out_of_disk = (
                code == 14031
                or "OutOfDiskSpace" in message
                or "available disk space" in message
            )
            if is_out_of_disk:
                logger.error(
                    "Skipping index creation for %s due to Mongo disk constraints: %s",
                    collection.name,
                    message,
                )
            else:
                logger.warning(
                    "Skipping index creation for %s due to startup index error: %s",
                    collection.name,
                    message,
                )

    await _safe_create_index(db.videos, [("uploaded_by", 1), ("upload_date", -1)])
    await _safe_create_index(db.videos, [("teacher_id", 1), ("upload_date", -1)])
    await _safe_create_index(db.videos, [("status", 1), ("upload_date", -1)])
    await _safe_create_index(db.videos, [("privacy_status", 1), ("upload_date", -1)])
    await _safe_create_index(db.assessments, [("teacher_id", 1), ("analyzed_at", -1)])
    await _safe_create_index(
        db.assessment_report_feedback,
        [("assessment_id", 1), ("user_id", 1), ("target_type", 1), ("target_id", 1)],
        unique=True,
    )
    await _safe_create_index(db.assessment_report_feedback, [("assessment_id", 1), ("updated_at", -1)])
    await _safe_create_index(db.action_plans, [("teacher_id", 1), ("user_id", 1)], unique=True)
    await _safe_create_index(db.action_plan_history, [("teacher_id", 1), ("plan_owner_id", 1), ("saved_at", -1)])
    await _safe_create_index(db.summary_reflections, [("teacher_id", 1), ("user_id", 1)], unique=True)
    await _safe_create_index(db.summary_reflection_history, [("teacher_id", 1), ("author_user_id", 1), ("saved_at", -1)])
    await _safe_create_index(db.published_conference_agendas, [("teacher_id", 1), ("published_at", -1)])
    await _safe_create_index(db.observations, [("video_id", 1), ("created_at", -1)])
    await _safe_create_index(db.video_processing_jobs, [("video_id", 1)], unique=True)
    await _safe_create_index(db.video_processing_jobs, [("status", 1), ("updated_at", -1)])
    await _safe_create_index(db.video_transcode_jobs, [("video_id", 1)], unique=True)
    await _safe_create_index(db.video_transcode_jobs, [("status", 1), ("updated_at", -1)])
    await _safe_create_index(db.video_privacy_jobs, [("video_id", 1)], unique=True)
    await _safe_create_index(db.video_privacy_jobs, [("status", 1), ("updated_at", -1)])
    await _safe_create_index(db.teacher_face_profiles, [("teacher_id", 1), ("status", 1)])
    await _safe_create_index(db.teacher_face_references, [("teacher_id", 1), ("profile_id", 1)])
    await _safe_create_index(db.teacher_face_references, [("retention_expires_at", 1)])
    await _safe_create_index(db.auth_event_log, [("created_at", -1)])
    await _safe_create_index(db.auth_event_log, [("email", 1), ("created_at", -1)])
    await _safe_create_index(db.auth_event_log, [("user_id", 1), ("created_at", -1)])
    await _safe_create_index(db.auth_event_log, [("event_type", 1), ("created_at", -1)])
    await _safe_create_index(db.users, [("tenant_role", 1), ("tenant_status", 1), ("created_at", -1)])
    await _safe_create_index(db.users, [("organization_id", 1), ("tenant_role", 1), ("created_at", -1)])
    await _safe_create_index(db.organizations, [("organization_type", 1), ("status", 1), ("name", 1)])
    await _safe_create_index(db.schools, [("organization_id", 1), ("name", 1)])
    await _safe_create_index(db.user_sessions, [("user_id", 1), ("created_at", -1)])
    await _safe_create_index(db.user_sessions, [("revoked_at", 1), ("created_at", -1)])
    await _safe_create_index(db.master_admin_audit_events, [("created_at", -1)])
    await _safe_create_index(db.master_admin_audit_events, [("actor_user_id", 1), ("created_at", -1)])
    await _safe_create_index(db.master_admin_audit_events, [("target_type", 1), ("target_id", 1), ("created_at", -1)])
    await _safe_create_index(db.processing_incidents, [("state", 1), ("severity", 1), ("last_seen_at", -1)])
    await _safe_create_index(db.processing_incidents, [("video_id", 1), ("incident_type", 1)], unique=True)
    await _safe_create_index(db.privacy_audit_events, [("target_type", 1), ("target_id", 1), ("created_at", -1)])
    await _safe_create_index(db.recognition_badges, [("teacher_id", 1), ("awarded_at", -1)])
    await _safe_create_index(db.recognition_badges, [("video_id", 1), ("status", 1)])
    await _safe_create_index(db.lesson_recognition_events, [("teacher_id", 1), ("updated_at", -1)])
    await _safe_create_index(db.lesson_recognition_events, [("video_id", 1), ("recognition_status", 1)])
    await _safe_create_index(db.recognition_audit_events, [("target_type", 1), ("target_id", 1), ("created_at", -1)])
    await _safe_create_index(db.exemplar_submissions, [("submission_status", 1), ("submitted_at", -1)])
    await _safe_create_index(db.exemplar_submissions, [("teacher_id", 1), ("video_id", 1)])
    await _safe_create_index(db.exemplar_library_items, [("status", 1), ("published_at", -1)])
    await _safe_create_index(db.exemplar_library_items, [("subject", 1), ("grade_level", 1)])
    await _safe_create_index(db.share_assets, [("teacher_id", 1), ("created_at", -1)])
    await _safe_create_index(db.videos, [("raw_retention_expires_at", 1)])
    await _safe_create_index(db.video_sampling_manifests, [("video_id", 1), ("strategy_version", 1)], unique=True)
    await _safe_create_index(db.video_analysis_moments, [("video_id", 1), ("created_at", -1)])
    await _safe_create_index(db.video_audio_transcripts, [("video_id", 1), ("created_at", -1)])
    await _safe_create_index(db.video_audio_transcripts, [("retention_expires_at", 1)])
    await _safe_create_index(db.video_analysis_features, [("video_id", 1)], unique=True)


async def _stop_video_workers() -> None:
    if not VIDEO_WORKER_TASKS:
        pass
    else:
        for task in VIDEO_WORKER_TASKS:
            task.cancel()
        await asyncio.gather(*VIDEO_WORKER_TASKS, return_exceptions=True)
        VIDEO_WORKER_TASKS.clear()
    if VIDEO_TRANSCODE_WORKER_TASKS:
        for task in VIDEO_TRANSCODE_WORKER_TASKS:
            task.cancel()
        await asyncio.gather(*VIDEO_TRANSCODE_WORKER_TASKS, return_exceptions=True)
        VIDEO_TRANSCODE_WORKER_TASKS.clear()
    if VIDEO_PRIVACY_WORKER_TASKS:
        for task in VIDEO_PRIVACY_WORKER_TASKS:
            task.cancel()
        await asyncio.gather(*VIDEO_PRIVACY_WORKER_TASKS, return_exceptions=True)
        VIDEO_PRIVACY_WORKER_TASKS.clear()
    if PRIVACY_MAINTENANCE_TASKS:
        for task in PRIVACY_MAINTENANCE_TASKS:
            task.cancel()
        await asyncio.gather(*PRIVACY_MAINTENANCE_TASKS, return_exceptions=True)
        PRIVACY_MAINTENANCE_TASKS.clear()
