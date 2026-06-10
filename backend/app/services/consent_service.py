"""Foundation seam for consent + data-subject-rights logic.

These signatures are the stable contract for the consent/privacy-rights
cluster — the live repo can later swap implementations behind them without
touching call sites.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel

import server as legacy

from app.tenancy import workspace_id_for_user


CONSENT_TYPES = ["video_recording", "data_processing", "ai_analysis"]


class ConsentGrantPayload(BaseModel):
    consent_type: str
    granted: bool = True
    version: str = "2026-05"


class ConsentWithdrawPayload(BaseModel):
    consent_type: str
    reason: Optional[str] = None


async def latest_consent_status(user_id: str, workspace_id: Optional[str] = None) -> Dict[str, dict]:
    query: Dict[str, Any] = {"user_id": user_id}
    if workspace_id:
        query["workspace_id"] = workspace_id
    records = await legacy.db.consent_records.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    status = {}
    for consent_type in CONSENT_TYPES:
        record = next((item for item in records if item.get("consent_type") == consent_type), None)
        status[consent_type] = record or {"consent_type": consent_type, "granted": False}
    return status


async def get_consent_status(current_user: dict):
    workspace_id = workspace_id_for_user(current_user)
    status = await latest_consent_status(current_user["id"], workspace_id)
    return {"workspace_id": workspace_id, "consents": status, "all_granted": all(status[k].get("granted") for k in CONSENT_TYPES)}


async def grant_consent(
    payload: ConsentGrantPayload,
    request: Request,
    current_user: dict,
):
    if payload.consent_type not in CONSENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported consent type")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "workspace_id": workspace_id_for_user(current_user),
        "user_id": current_user["id"],
        "consent_type": payload.consent_type,
        "granted": bool(payload.granted),
        "granted_at": now if payload.granted else None,
        "withdrawn_at": None,
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "version": payload.version,
        "created_at": now,
    }
    await legacy.db.consent_records.insert_one(doc)
    return await get_consent_status(current_user=current_user)


async def withdraw_consent(
    payload: ConsentWithdrawPayload,
    request: Request,
    current_user: dict,
):
    if payload.consent_type not in CONSENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported consent type")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "workspace_id": workspace_id_for_user(current_user),
        "user_id": current_user["id"],
        "consent_type": payload.consent_type,
        "granted": False,
        "granted_at": None,
        "withdrawn_at": now,
        "withdrawal_reason": payload.reason,
        "anonymization_due_at": (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat(),
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "version": "2026-05",
        "created_at": now,
    }
    await legacy.db.consent_records.insert_one(doc)
    await legacy.db.data_subject_requests.insert_one(
        {
            "id": str(uuid.uuid4()),
            "workspace_id": doc["workspace_id"],
            "user_id": current_user["id"],
            "request_type": "consent_withdrawal",
            "status": "pending_anonymization",
            "due_at": doc["anonymization_due_at"],
            "created_at": now,
        }
    )
    return {"status": "withdrawn", "anonymization_due_at": doc["anonymization_due_at"]}


async def list_consent_records(current_user: dict):
    if legacy._get_user_tenant_role(current_user) == "teacher":
        raise HTTPException(status_code=403, detail="Admin access required")
    workspace_id = workspace_id_for_user(current_user)
    teachers = await legacy.db.teachers.find({"$or": [{"created_by": current_user["id"]}, {"organization_id": workspace_id}, {"school_id": workspace_id}]}, {"_id": 0}).to_list(1000)
    records = await legacy.db.consent_records.find({"workspace_id": workspace_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    user_ids_with_all = set()
    for user_id in {record.get("user_id") for record in records if record.get("user_id")}:
        status = await latest_consent_status(user_id, workspace_id)
        if all(status[k].get("granted") and not status[k].get("withdrawn_at") for k in CONSENT_TYPES):
            user_ids_with_all.add(user_id)
    return {
        "records": records,
        "summary": {
            "teacher_count": len(teachers),
            "consented_count": len(user_ids_with_all),
            "completion_rate": (len(user_ids_with_all) / len(teachers)) if teachers else 1,
            "pending_count": max(0, len(teachers) - len(user_ids_with_all)),
        },
        "data_subject_requests": await legacy.db.data_subject_requests.find({"workspace_id": workspace_id}, {"_id": 0}).sort("created_at", -1).to_list(200),
    }


async def run_user_erasure(current_user: dict) -> dict:
    user_hash = hashlib.sha256(str(current_user["id"]).encode("utf-8")).hexdigest()[:10]
    deleted_label = f"Deleted User {user_hash}"
    email = current_user.get("email")
    teacher = None
    if current_user.get("teacher_id"):
        teacher = await legacy.db.teachers.find_one({"id": current_user["teacher_id"]}, {"_id": 0})
    if not teacher and email:
        teacher = await legacy.db.teachers.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0})
    teacher_id = (teacher or {}).get("id")
    video_query = {"$or": [{"uploaded_by": current_user["id"]}]}
    if teacher_id:
        video_query["$or"].append({"teacher_id": teacher_id})
    videos = await legacy.db.videos.find(video_query, {"_id": 0}).to_list(1000)
    for video in videos:
        for key_field in ["raw_s3_key", "processed_s3_key", "redacted_s3_key", "thumbnail_s3_key", "s3_key"]:
            legacy._delete_s3_key(video.get(key_field))
        for path_field in ["file_path", "raw_file_path", "processed_file_path", "redacted_file_path", "thumbnail_path"]:
            await legacy._delete_local_upload_file(video.get(path_field))
    if teacher_id:
        await legacy.db.assessments.update_many({"teacher_id": teacher_id}, {"$set": {"teacher_name": deleted_label, "teacher_email": None, "pii_removed": True}})
        await legacy.db.teachers.update_one({"id": teacher_id}, {"$set": {"name": deleted_label, "email": None, "privacy_profile_image_url": None, "pii_removed": True}})
        await legacy.db.teacher_face_profiles.delete_many({"teacher_id": teacher_id})
        await legacy.db.teacher_face_references.delete_many({"teacher_id": teacher_id})
    await legacy.db.users.update_one({"id": current_user["id"]}, {"$set": {"name": deleted_label, "email": f"deleted-{user_hash}@deleted.local", "pii_removed": True, "erased_at": datetime.now(timezone.utc).isoformat()}})
    await legacy.db.data_subject_requests.insert_one({"id": str(uuid.uuid4()), "workspace_id": workspace_id_for_user(current_user), "user_id": current_user["id"], "request_type": "right_to_erasure", "status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()})
    if email:
        legacy._send_platform_email("Your Cognivio data deletion is complete", email, "Your Cognivio data deletion request has been completed. Aggregate, anonymized learning data may remain without personal identifiers.")
    return {"status": "completed", "deleted_user_label": deleted_label, "videos_deleted": len(videos)}


async def request_right_to_erasure(current_user: dict):
    return await run_user_erasure(current_user)


async def export_user_data(current_user: dict):
    teacher_id = current_user.get("teacher_id")
    if not teacher_id and current_user.get("email"):
        teacher = await legacy.db.teachers.find_one({"email": {"$regex": f"^{re.escape(current_user['email'])}$", "$options": "i"}}, {"_id": 0})
        teacher_id = (teacher or {}).get("id")
    assessments = await legacy.db.assessments.find({"$or": [{"user_id": current_user["id"]}, {"teacher_id": teacher_id} if teacher_id else {"_never": True}]}, {"_id": 0}).to_list(1000)
    videos = await legacy.db.videos.find({"$or": [{"uploaded_by": current_user["id"]}, {"teacher_id": teacher_id} if teacher_id else {"_never": True}]}, {"_id": 0}).to_list(1000)
    consents = await legacy.db.consent_records.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(1000)
    export = {"user": {k: v for k, v in current_user.items() if k != "password"}, "assessments": assessments, "videos": videos, "consent_history": consents}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("cognivio-data-export.json", json.dumps(legacy._to_json_safe(export), indent=2))
    buffer.seek(0)
    return Response(content=buffer.getvalue(), media_type="application/zip", headers={"Content-Disposition": "attachment; filename=cognivio-data-export.zip"})
