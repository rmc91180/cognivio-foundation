from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import server as legacy

from app.repositories import teacher_repository


async def create_teacher(teacher: legacy.TeacherCreate, current_user: dict) -> legacy.TeacherResponse:
    teacher_id = str(uuid.uuid4())
    if teacher.school_id:
        school = await teacher_repository.find_school_for_user(teacher.school_id, current_user["id"])
        if not school:
            raise legacy.HTTPException(status_code=404, detail="School not found")
    teacher_doc = {
        "id": teacher_id,
        "name": teacher.name,
        "email": teacher.email,
        "subject": teacher.subject,
        "grade_level": teacher.grade_level,
        "department": teacher.department,
        "school_id": teacher.school_id,
        "category": teacher.category,
        "category_custom": teacher.category_custom,
        "next_coaching_conference": teacher.next_coaching_conference,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await teacher_repository.insert_teacher(teacher_doc)
    return legacy.TeacherResponse(
        **{k: v for k, v in teacher_doc.items() if k not in ["created_by", "_id"]}
    )


async def update_teacher(
    teacher_id: str,
    payload: legacy.TeacherUpdate,
    current_user: dict,
) -> legacy.TeacherResponse:
    teacher = await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    update_fields: Dict[str, Any] = {}
    if payload.category is not None:
        update_fields["category"] = payload.category
    if payload.category_custom is not None:
        update_fields["category_custom"] = payload.category_custom
    if payload.next_coaching_conference is not None:
        update_fields["next_coaching_conference"] = payload.next_coaching_conference
    if not update_fields:
        teacher.pop("created_by", None)
        return legacy.TeacherResponse(**teacher)
    await teacher_repository.update_teacher_fields(teacher_id, update_fields)
    teacher.update(update_fields)
    teacher.pop("created_by", None)
    return legacy.TeacherResponse(**teacher)


async def list_teachers(request: legacy.Request, current_user: dict) -> List[legacy.TeacherResponse]:
    teachers = await teacher_repository.list_teachers_for_user(current_user["id"])
    language = legacy._resolve_request_language(request, default="en")
    return [legacy.TeacherResponse(**legacy._localize_teacher_payload(t, language)) for t in teachers]


async def get_teacher(
    teacher_id: str,
    request: legacy.Request,
    current_user: dict,
) -> legacy.TeacherResponse:
    teacher = await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    teacher.pop("created_by", None)
    language = legacy._resolve_request_language(request, default="en")
    return legacy.TeacherResponse(**legacy._localize_teacher_payload(teacher, language))


async def get_teacher_privacy_profile(
    teacher_id: str,
    current_user: dict,
) -> legacy.TeacherPrivacyProfileResponse:
    await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    profile = await teacher_repository.get_active_privacy_profile(teacher_id)
    return legacy._build_privacy_profile_summary(teacher_id, profile)


async def upsert_teacher_privacy_profile(
    teacher_id: str,
    files: List[legacy.UploadFile],
    replace_existing: bool,
    current_user: dict,
) -> legacy.TeacherPrivacyProfileResponse:
    await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    uploads = [upload for upload in files if (upload.filename or "").strip()]
    if len(uploads) < legacy.PRIVACY_PROFILE_MIN_REFERENCES:
        raise legacy.HTTPException(
            status_code=400,
            detail=(
                f"Teacher privacy profile requires at least "
                f"{legacy.PRIVACY_PROFILE_MIN_REFERENCES} reference images."
            ),
        )
    if len(uploads) > legacy.PRIVACY_PROFILE_MAX_REFERENCES:
        raise legacy.HTTPException(
            status_code=400,
            detail=(
                f"Teacher privacy profile supports at most "
                f"{legacy.PRIVACY_PROFILE_MAX_REFERENCES} reference images."
            ),
        )

    active_profile = await teacher_repository.get_active_privacy_profile(teacher_id)
    if active_profile and replace_existing:
        await teacher_repository.mark_privacy_profile_replaced(
            active_profile["id"],
            datetime.now(timezone.utc).isoformat(),
        )

    existing_versions = await teacher_repository.list_privacy_profile_versions(teacher_id)
    next_version = max([int(item.get("profile_version", 0) or 0) for item in existing_versions] + [0]) + 1
    now = datetime.now(timezone.utc).isoformat()
    profile_id = str(uuid.uuid4())
    reference_docs = []
    for upload in uploads:
        relative_path, file_url, s3_key = await legacy._save_privacy_reference_file(
            upload, teacher_id, profile_id
        )
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
                "retention_expires_at": (
                    datetime.now(timezone.utc) + timedelta(days=legacy.PRIVACY_PROFILE_IMAGE_RETENTION_DAYS)
                ).isoformat(),
            }
        )
    if reference_docs:
        await teacher_repository.insert_teacher_face_references(reference_docs)
    if active_profile and not replace_existing:
        await teacher_repository.supersede_active_privacy_profiles(teacher_id, now)

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
    await teacher_repository.insert_teacher_face_profile(profile_doc)
    await legacy._log_privacy_audit_event(
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
    return legacy._build_privacy_profile_summary(teacher_id, profile_doc)


async def delete_teacher_privacy_profile(
    teacher_id: str,
    current_user: dict,
) -> legacy.TeacherPrivacyProfileDeleteResponse:
    await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    deleted_at = datetime.now(timezone.utc).isoformat()
    result = await teacher_repository.delete_active_privacy_profiles(teacher_id, deleted_at)
    if result.modified_count == 0:
        raise legacy.HTTPException(status_code=404, detail="Teacher privacy profile not found")
    await teacher_repository.expire_teacher_face_references(teacher_id, deleted_at)
    await legacy._log_privacy_audit_event(
        "privacy_profile_deleted",
        "teacher",
        teacher_id,
        actor_user_id=current_user["id"],
        details={"deleted_at": deleted_at},
    )
    return legacy.TeacherPrivacyProfileDeleteResponse(
        teacher_id=teacher_id,
        deleted=True,
        status="deleted",
        deleted_at=deleted_at,
    )


async def delete_teacher(teacher_id: str, current_user: dict) -> Dict[str, str]:
    result = await teacher_repository.delete_teacher_for_user(teacher_id, current_user["id"])
    if result.deleted_count == 0:
        raise legacy.HTTPException(status_code=404, detail="Teacher not found")
    return {"message": "Teacher deleted"}
