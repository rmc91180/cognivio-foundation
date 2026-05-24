from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import aiofiles
import server as legacy

from app.repositories import teacher_repository, video_repository


def _now_iso() -> str:
    """Return a timezone-aware UTC ISO timestamp."""
    return datetime.now(timezone.utc).isoformat()


async def upload_video(
    file: legacy.UploadFile,
    teacher_id: Optional[str],
    workspace_id: Optional[str] = None,
    session_id: Optional[str] = None,
    *,
    request: Optional[legacy.Request] = None,
    subject: Optional[str] = None,
    lesson_title: Optional[str] = None,
    class_section: Optional[str] = None,
    recorded_at: Optional[str] = None,
    current_user: Optional[dict] = None,
) -> legacy.VideoUploadResponse:
    """Validate, store, register, and queue a teacher video upload."""
    if current_user is None:
        raise legacy.HTTPException(status_code=401, detail="Authentication required")

    preferred_language = legacy._resolve_request_language(request, default="en") if request else "en"
    upload_source = legacy._get_user_role(current_user)
    upload_started_perf = time.perf_counter()

    try:
        session_id = legacy._clean_optional_string(session_id)
        detected_video = await legacy._validate_video_upload_file(file)
        file_ext = detected_video["extension"]
        content_type = detected_video["content_type"]
        normalized_recorded_at = legacy._parse_optional_iso_datetime(recorded_at, "recorded_at")
        upload_time = _now_iso()

        if not teacher_id and legacy._get_user_tenant_role(current_user) == "teacher":
            teacher = await legacy._get_current_teacher_for_workspace(current_user)
            teacher_id = teacher["id"]
        elif not teacher_id:
            raise legacy.HTTPException(status_code=400, detail="Teacher is required for admin uploads")
        else:
            teacher = await teacher_repository.get_teacher_or_404(teacher_id, current_user)

        observation_session = None
        if session_id:
            observation_session = await legacy._get_observation_session_or_404(session_id, current_user)
            if observation_session.get("teacher_id") != teacher_id:
                raise legacy.HTTPException(
                    status_code=400,
                    detail="Observation session must belong to the selected teacher",
                )

        await legacy._ensure_workspace_upload_quota_available(teacher, current_user)
        active_profile = await teacher_repository.get_active_privacy_profile(teacher_id)
        if legacy.PRIVACY_REQUIRE_PROFILE and not active_profile:
            raise legacy.HTTPException(
                status_code=409,
                detail={
                    "code": "PRIVACY_PROFILE_REQUIRED",
                    "message": "Teacher privacy profile must be completed before video upload.",
                    "teacher_id": teacher_id,
                },
            )

        privacy_policy_fields = legacy._build_upload_privacy_policy_fields(current_user, teacher)
        legacy._ensure_upload_privacy_gate(privacy_policy_fields)
        subject = subject or teacher.get("subject")
        lesson_title = legacy._clean_optional_string(lesson_title) or file.filename or subject
        class_section = legacy._clean_optional_string(class_section) or teacher.get("class_section") or teacher.get("department")
        reference_images = await legacy.get_teacher_reference_images_for_blur(teacher_id, workspace_id or legacy._workspace_id_for_user(current_user))
        reference_count = len(reference_images)
        reference_status = "ready" if reference_count else "missing_reference_images"
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
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    raise legacy.HTTPException(
                        status_code=413,
                        detail=(
                            "File too large. Maximum allowed is "
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
            legacy.logger.warning("S3 upload failed for video %s: %s", video_id, exc)

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
            "observation_session_id": session_id,
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
            "lesson_title": lesson_title,
            "class_section": class_section,
            "recorded_at": normalized_recorded_at,
            "upload_date": upload_time,
            "analysis_language": preferred_language,
            "workspace_id": workspace_id,
            "session_id": session_id,
            "upload_source": upload_source,
            "teacher_reference_images_available": reference_count > 0,
            "teacher_reference_image_count": reference_count,
            "privacy_blur_teacher_match_status": reference_status,
            **privacy_policy_fields,
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
                "observation_session_id": session_id,
                "file_path": relative_path,
                "subject": subject,
                "lesson_title": lesson_title,
                "class_section": class_section,
                "recorded_at": normalized_recorded_at,
                "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
                "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
                "uploaded_by": current_user["id"],
                "uploaded_at": upload_time,
                "workspace_id": workspace_id,
                "session_id": session_id,
                "teacher_reference_images_available": reference_count > 0,
                "teacher_reference_image_count": reference_count,
                "privacy_blur_teacher_match_status": reference_status,
                "data_classifications": privacy_policy_fields["data_classifications"],
                "processing_purposes": privacy_policy_fields["processing_purposes"],
                "privacy_pipeline_state": privacy_policy_fields["privacy_pipeline_state"],
                "destructive_blurring_enabled": privacy_policy_fields["destructive_blurring_enabled"],
            }
        )

        if observation_session:
            await legacy.db.observation_sessions.update_one(
                {"id": observation_session["id"]},
                {
                    "$set": {
                        "linked_video_id": video_id,
                        "status": legacy.ObservationSessionStatus.RECORDING_UPLOADED.value,
                        "updated_at": upload_time,
                    }
                },
            )

        try:
            admin_id = teacher.get("created_by") or current_user["id"]
            policy = await legacy._get_recording_policy(admin_id, teacher.get("school_id"))
            if policy:
                compliance = await legacy._upsert_recording_compliance(teacher, admin_id, policy)
                await legacy._refresh_recording_reminders(teacher, admin_id, policy, compliance)
        except Exception:
            legacy.logger.warning("Unable to update recording compliance after upload", exc_info=True)

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
                "destructive_blurring_enabled": video_doc["destructive_blurring_enabled"],
                "privacy_pipeline_state": video_doc["privacy_pipeline_state"],
                "upload_source": upload_source,
                "duration_ms": round((time.perf_counter() - upload_started_perf) * 1000, 2),
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
            lesson_title=lesson_title,
            class_section=class_section,
            recorded_at=normalized_recorded_at,
            file_path=relative_path,
            file_size_bytes=size,
            content_type=content_type or "video/mp4",
            teacher_reference_images_available=reference_count > 0,
            teacher_reference_image_count=reference_count,
            privacy_blur_teacher_match_status=reference_status,
            data_classifications=privacy_policy_fields["data_classifications"],
            processing_purposes=privacy_policy_fields["processing_purposes"],
            student_face_blur_enabled=privacy_policy_fields["student_face_blur_enabled"],
            destructive_blurring_enabled=privacy_policy_fields["destructive_blurring_enabled"],
            privacy_pipeline_state=privacy_policy_fields["privacy_pipeline_state"],
            unblurred_deletion_status=privacy_policy_fields["unblurred_deletion_status"],
            privacy_gate=privacy_policy_fields["privacy_gate"],
        )

    except legacy.HTTPException:
        raise
    except Exception as exc:
        legacy.logger.exception("Video upload failed for teacher %s", teacher_id)
        raise legacy.HTTPException(status_code=500, detail=f"Video upload failed: {exc}") from exc


async def list_videos(teacher_id: Optional[str], current_user: dict) -> list[dict]:
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


async def get_video_detail(video_id: str, current_user: dict) -> dict:
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")

    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    return legacy._sanitize_video_response(legacy._apply_video_response_defaults(video))


async def get_video_raw_access(video_id: str, current_user: dict) -> dict:
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")

    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")

    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    if (
        video.get("privacy_pipeline_state") == legacy.PrivacyPipelineState.UNBLURRED_DELETED.value
        or video.get("unblurred_deletion_status") == "deleted"
    ):
        raise legacy.HTTPException(status_code=404, detail="Raw asset is no longer available")
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


async def get_video_status(video_id: str, current_user: dict) -> dict:
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
        "privacy_pipeline_state": video.get("privacy_pipeline_state"),
        "destructive_blurring_enabled": bool(video.get("destructive_blurring_enabled", True)),
        "unblurred_deletion_status": video.get("unblurred_deletion_status"),
        "source_deletion_deferred_reason": video.get("source_deletion_deferred_reason"),
        "error_message": video.get("error_message"),
        "privacy_error": video.get("privacy_error"),
    }


async def retry_video_processing(video_id: str, current_user: dict) -> dict:
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
            status_code=409,
            detail="Retry unavailable until privacy processing is complete",
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


async def retry_video_privacy(video_id: str, current_user: dict) -> dict:
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
