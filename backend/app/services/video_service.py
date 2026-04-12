from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import aiofiles
import server as legacy

from app.repositories import teacher_repository, video_repository


async def upload_video(
    request: legacy.Request,
    file: legacy.UploadFile,
    teacher_id: str,
    subject: Optional[str],
    recorded_at: Optional[str],
    current_user: dict,
) -> legacy.VideoUploadResponse:
    if not (file.filename or "").strip():
        raise legacy.HTTPException(status_code=400, detail="Filename is required")
    file_ext = Path(file.filename or "").suffix.lower()
    if file_ext not in legacy.VIDEO_ALLOWED_EXTENSIONS:
        raise legacy.HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {sorted(legacy.VIDEO_ALLOWED_EXTENSIONS)}",
        )
    content_type = (file.content_type or "").lower()
    if content_type and content_type not in legacy.VIDEO_ALLOWED_CONTENT_TYPES:
        raise legacy.HTTPException(
            status_code=400,
            detail=f"Invalid content type. Allowed: {sorted(legacy.VIDEO_ALLOWED_CONTENT_TYPES)}",
        )
    normalized_recorded_at = legacy._parse_optional_iso_datetime(recorded_at, "recorded_at")
    upload_time = datetime.now(timezone.utc).isoformat()
    preferred_language = legacy._resolve_request_language(request, default="en")

    teacher = await video_repository.find_teacher_by_id(teacher_id)
    if not teacher:
        raise legacy.HTTPException(status_code=404, detail="Teacher not found")
    role = legacy._get_user_role(current_user)
    if role == "admin":
        if teacher.get("created_by") != current_user["id"]:
            raise legacy.HTTPException(status_code=403, detail="Not authorized for this teacher")
    else:
        if teacher.get("email", "").lower() != current_user.get("email", "").lower():
            raise legacy.HTTPException(status_code=403, detail="Not authorized for this teacher")
    active_profile = await legacy._get_active_privacy_profile(teacher_id)
    if legacy.PRIVACY_REQUIRE_PROFILE and not active_profile:
        raise legacy.HTTPException(
            status_code=409,
            detail={
                "code": "PRIVACY_PROFILE_REQUIRED",
                "message": "Teacher privacy profile must be completed before video upload.",
                "teacher_id": teacher_id,
            },
        )

    subject = subject or teacher.get("subject")
    video_id = str(legacy.uuid.uuid4())
    filename = f"{video_id}{file_ext}"
    teacher_dir = legacy.UPLOAD_DIR / "videos" / teacher_id
    teacher_dir.mkdir(parents=True, exist_ok=True)
    file_path = teacher_dir / filename
    relative_path = f"videos/{teacher_id}/{filename}"

    size = 0
    async with aiofiles.open(file_path, "wb") as handle:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if legacy.VIDEO_MAX_UPLOAD_BYTES and size > legacy.VIDEO_MAX_UPLOAD_BYTES:
                await handle.close()
                os.remove(file_path)
                raise legacy.HTTPException(
                    status_code=413,
                    detail=(
                        f"File too large. Maximum allowed is "
                        f"{legacy.VIDEO_MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                    ),
                )
            await handle.write(chunk)

    s3_key = None
    file_url = None
    try:
        raw_s3_key_override = legacy._build_video_asset_s3_key("raw", teacher_id, filename)
        s3_key, file_url = legacy._upload_path_to_s3(
            file_path,
            "videos",
            filename,
            content_type or "video/mp4",
            key_override=raw_s3_key_override,
        )
    except Exception as exc:
        legacy.logger.warning(f"S3 upload failed for video {video_id}: {exc}")

    transcode_status = (
        legacy.VideoTranscodeStatus.QUEUED.value
        if legacy.VIDEO_TRANSCODE_PIPELINE_ENABLED
        else legacy.VideoTranscodeStatus.NOT_REQUIRED.value
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
        "status": legacy.VideoProcessingStatus.QUEUED.value,
        "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
        "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
        "transcode_status": transcode_status,
        "transcode_started_at": None,
        "transcode_completed_at": None,
        "transcode_failed_at": None,
        "transcode_error": None,
        "transcode_profile": legacy.VIDEO_TRANSCODE_PROFILE,
        "processing_asset_preference": "raw",
        "privacy_review_required": False,
        "privacy_review_reason": None,
        "privacy_started_at": None,
        "privacy_completed_at": None,
        "privacy_failed_at": None,
        "privacy_error": None,
        "privacy_profile_version": active_profile.get("profile_version") if active_profile else None,
        "raw_retention_expires_at": (
            datetime.now(timezone.utc) + timedelta(days=legacy.PRIVACY_RAW_VIDEO_RETENTION_DAYS)
        ).isoformat(),
        "status_updated_at": upload_time,
        "processing_started_at": None,
        "processing_completed_at": None,
        "processing_failed_at": None,
        "subject": subject,
        "recorded_at": normalized_recorded_at,
        "upload_date": upload_time,
        "analysis_language": preferred_language,
    }
    await video_repository.insert_video(video_doc)

    if legacy.VIDEO_TRANSCODE_PIPELINE_ENABLED:
        await legacy._enqueue_video_transcode_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=current_user["id"],
            file_path=str(file_path),
            source_content_type=content_type or "video/mp4",
            raw_s3_key=s3_key,
            raw_file_url=file_url,
            requested_profile=legacy.VIDEO_TRANSCODE_PROFILE,
        )

    await video_repository.insert_video_evidence(
        {
            "id": str(legacy.uuid.uuid4()),
            "video_id": video_id,
            "teacher_id": teacher_id,
            "file_path": relative_path,
            "subject": subject,
            "recorded_at": normalized_recorded_at,
            "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
            "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
            "uploaded_by": current_user["id"],
            "uploaded_at": upload_time,
        }
    )

    try:
        admin_id = teacher.get("created_by") or current_user["id"]
        policy = await legacy._get_recording_policy(admin_id, teacher.get("school_id"))
        if policy:
            compliance = await legacy._upsert_recording_compliance(teacher, admin_id, policy)
            await legacy._refresh_recording_reminders(teacher, admin_id, policy, compliance)
    except Exception:
        legacy.logger.warning("Unable to update recording compliance after upload")

    if not legacy.VIDEO_TRANSCODE_PIPELINE_ENABLED:
        await legacy._enqueue_video_privacy_job(
            video_id=video_id,
            teacher_id=teacher_id,
            user_id=current_user["id"],
            file_path=str(file_path),
        )
    await legacy._log_privacy_audit_event(
        "privacy_video_uploaded",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={
            "teacher_id": teacher_id,
            "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
            "raw_retention_expires_at": video_doc["raw_retention_expires_at"],
        },
    )

    return legacy.VideoUploadResponse(
        id=video_id,
        filename=file.filename,
        teacher_id=teacher_id,
        status=legacy.VideoProcessingStatus.QUEUED.value,
        privacy_status=legacy.PrivacyProcessingStatus.QUEUED.value,
        analysis_status=legacy.VideoProcessingStatus.QUEUED.value,
        transcode_status=transcode_status,
        upload_date=video_doc["upload_date"],
        subject=subject,
        recorded_at=normalized_recorded_at,
        file_path=relative_path,
        file_size_bytes=size,
        content_type=content_type or "video/mp4",
    )


async def list_videos(teacher_id: Optional[str], current_user: dict):
    query: Dict[str, Any] = {}
    if teacher_id:
        await teacher_repository.get_teacher_or_404(teacher_id, current_user)
        query["teacher_id"] = teacher_id
    else:
        teacher_ids_for_user = await video_repository.list_teacher_ids_for_user(current_user)
        query = video_repository.build_video_visibility_query(current_user, teacher_ids_for_user)
    videos = await video_repository.list_videos_by_query(query)
    for video in videos:
        legacy._apply_video_response_defaults(video)
    return [legacy._sanitize_video_response(video) for video in videos]


async def get_video_detail(video_id: str, current_user: dict):
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    return legacy._sanitize_video_response(legacy._apply_video_response_defaults(video))


async def get_video_raw_access(video_id: str, current_user: dict):
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    raw_url = video.get("raw_file_url")
    raw_path = video.get("raw_file_path")
    access_url = raw_url
    if not access_url and raw_path:
        safe_path = str(raw_path).replace("\\", "/").lstrip("/")
        access_url = legacy._to_public_backend_url(f"/uploads/{safe_path}")
    if not access_url:
        raise legacy.HTTPException(status_code=404, detail="Raw asset is no longer available")
    await legacy._log_privacy_audit_event(
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


async def get_video_status(video_id: str, current_user: dict):
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    return {
        "status": legacy._normalize_video_status(video.get("status")),
        "privacy_status": legacy._normalize_privacy_status(video.get("privacy_status")),
        "analysis_status": legacy._normalize_video_status(video.get("analysis_status")),
        "transcode_status": legacy._normalize_video_transcode_status(video.get("transcode_status")),
        "privacy_review_required": bool(video.get("privacy_review_required", False)),
        "privacy_review_reason": video.get("privacy_review_reason"),
        "error_message": video.get("error_message"),
        "privacy_error": video.get("privacy_error"),
    }


async def retry_video_processing(video_id: str, current_user: dict):
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    current_status = legacy._normalize_video_status(video.get("status"))
    if current_status != legacy.VideoProcessingStatus.FAILED.value:
        raise legacy.HTTPException(status_code=400, detail="Only failed videos can be retried")
    if (
        legacy._normalize_privacy_status(video.get("privacy_status"))
        != legacy.PrivacyProcessingStatus.COMPLETED.value
    ):
        raise legacy.HTTPException(
            status_code=409, detail="Retry unavailable until privacy processing is complete"
        )
    relative_path = video.get("redacted_file_path") or video.get("file_path")
    if not relative_path:
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = legacy.UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise legacy.HTTPException(
            status_code=409,
            detail="Retry unavailable because the local video file is missing",
        )
    queued_at = datetime.now(timezone.utc).isoformat()
    await video_repository.update_video_fields(
        video_id,
        {
            "status": legacy.VideoProcessingStatus.QUEUED.value,
            "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
            "status_updated_at": queued_at,
            "error_message": None,
        },
    )
    await video_repository.update_video_evidence_fields(
        video_id,
        {"analysis_status": legacy.VideoProcessingStatus.QUEUED.value, "error_message": None},
    )
    await legacy._enqueue_video_processing_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    return {"video_id": video_id, "status": legacy.VideoProcessingStatus.QUEUED.value}


async def retry_video_privacy(video_id: str, current_user: dict):
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    relative_path = (
        video.get("processed_file_path")
        or video.get("raw_file_path")
        or video.get("file_path")
    )
    if not relative_path:
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = legacy.UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise legacy.HTTPException(
            status_code=409,
            detail="Retry unavailable because the local video file is missing",
        )
    queued_at = datetime.now(timezone.utc).isoformat()
    await video_repository.update_video_fields(
        video_id,
        {
            "status": legacy.VideoProcessingStatus.QUEUED.value,
            "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
            "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
            "privacy_review_required": False,
            "privacy_review_reason": None,
            "privacy_error": None,
            "privacy_started_at": None,
            "privacy_completed_at": None,
            "privacy_failed_at": None,
            "status_updated_at": queued_at,
        },
    )
    await legacy._enqueue_video_privacy_job(
        video_id=video_id,
        teacher_id=video.get("teacher_id"),
        user_id=video.get("uploaded_by") or current_user["id"],
        file_path=str(full_path),
    )
    await legacy._log_privacy_audit_event(
        "privacy_retry_queued",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"requeued_at": queued_at},
    )
    return {
        "video_id": video_id,
        "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
        "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
        "requeued_at": queued_at,
    }
