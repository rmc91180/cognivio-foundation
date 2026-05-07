from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Generic, List, Optional, TypeVar

import aiofiles
import server as legacy

from app.repositories import teacher_repository, video_repository


VideoDoc = Dict[str, Any]
T = TypeVar("T")


class NotFound(legacy.HTTPException):
    def __init__(self, detail: str = "Video not found"):
        super().__init__(status_code=404, detail=detail)


@dataclass
class PaginatedList(Generic[T]):
    items: List[T]
    total: int
    page: int = 1
    page_size: int = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_workspace_id_from_user(current_user: Optional[dict]) -> Optional[str]:
    current_user = current_user or {}
    return (
        current_user.get("organization_id")
        or current_user.get("school_id")
        or current_user.get("id")
    )


def _asset_url_from_local_path(relative_path: Optional[str]) -> Optional[str]:
    if not relative_path:
        return None
    safe_path = str(relative_path).replace("\\", "/").lstrip("/")
    return legacy._to_public_backend_url(f"/uploads/{safe_path}")


def _presign_s3_url(s3_key: Optional[str], content_type: Optional[str] = None) -> Optional[str]:
    if not s3_key or not legacy.S3_BUCKET:
        return None
    try:
        client = legacy._get_s3_client()
        params: Dict[str, Any] = {"Bucket": legacy.S3_BUCKET, "Key": s3_key}
        if content_type:
            params["ResponseContentType"] = content_type
        return client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=legacy.S3_PRESIGNED_URL_EXPIRES_SECONDS,
        )
    except Exception as exc:
        legacy.logger.warning("Unable to generate S3 stream URL for %s: %s", s3_key, exc)
        return None


async def _resolve_video_comment_rubric_fields(
    video_id: str,
    element_id: Optional[str],
    element_code: Optional[str],
    element_name: Optional[str],
) -> Dict[str, Optional[str]]:
    cleaned_element_id = legacy._clean_optional_string(element_id)
    cleaned_code = legacy._clean_optional_string(element_code) or cleaned_element_id
    cleaned_name = legacy._clean_optional_string(element_name)
    if cleaned_element_id and not cleaned_name:
        for score in await video_repository.find_assessment_element_scores(video_id):
            if score.get("element_id") == cleaned_element_id:
                cleaned_name = legacy._clean_optional_string(score.get("element_name"))
                cleaned_code = cleaned_code or legacy._clean_optional_string(score.get("element_id"))
                break
    return {
        "rubric_element_id": cleaned_element_id,
        "rubric_element_code": cleaned_code,
        "rubric_element_name": cleaned_name,
    }


def _audio_speaker_bucket(raw_speaker: Optional[Any]) -> str:
    normalized = str(raw_speaker or "").strip().lower()
    if any(token in normalized for token in ["student", "pupil", "learner", "class"]):
        return "student" if legacy.AUDIO_ALLOW_STUDENT_VOICE_PROCESSING else "teacher"
    if any(token in normalized for token in ["silence", "pause", "quiet"]):
        return "silence"
    return "teacher"


def _build_video_audio_analysis_response(
    transcript_doc: Optional[dict],
    feature_doc: Optional[dict],
) -> legacy.VideoAudioAnalysisResponse:
    raw_segments = list((transcript_doc or {}).get("segments") or [])
    normalized_segments: List[dict] = []
    transcript_segments: List[dict] = []
    key_moments: List[dict] = []
    teacher_seconds = 0.0
    student_seconds = 0.0
    silence_seconds = 0.0
    previous_end = 0.0
    total_duration = 0.0

    for segment in sorted(raw_segments, key=lambda item: float(item.get("start_sec") or 0.0)):
        start = max(0.0, float(segment.get("start_sec") or 0.0))
        end = max(start, float(segment.get("end_sec") or start))
        if start > previous_end:
            gap = start - previous_end
            silence_seconds += gap
            normalized_segments.append(
                {"start_sec": round(previous_end, 2), "end_sec": round(start, 2), "speaker": "silence"}
            )
            if gap >= 3.0:
                key_moments.append(
                    {"timestamp_sec": round(previous_end, 2), "label": "Extended pause", "signal_type": "silence"}
                )

        speaker = _audio_speaker_bucket(segment.get("speaker"))
        duration = max(0.0, end - start)
        if speaker == "student":
            student_seconds += duration
        elif speaker == "silence":
            silence_seconds += duration
        else:
            teacher_seconds += duration
        normalized_segments.append({"start_sec": round(start, 2), "end_sec": round(end, 2), "speaker": speaker})
        text = str(segment.get("text") or "").strip()
        if text:
            transcript_segments.append(
                {"start_sec": round(start, 2), "end_sec": round(end, 2), "text": text, "speaker": speaker}
            )
            if "?" in text:
                key_moments.append(
                    {"timestamp_sec": round(start, 2), "label": "Question", "signal_type": "question"}
                )
        if speaker == "student":
            key_moments.append(
                {"timestamp_sec": round(start, 2), "label": "Student talk", "signal_type": "student_voice"}
            )
        previous_end = max(previous_end, end)
        total_duration = max(total_duration, end)

    if not normalized_segments and feature_doc:
        teacher_ratio = max(0.0, min(1.0, float(feature_doc.get("teacher_talk_ratio") or 0.0)))
        teacher_seconds = teacher_ratio
        total_duration = 1.0 if teacher_ratio else 0.0

    total_duration = max(total_duration, teacher_seconds + student_seconds + silence_seconds)
    if total_duration > 0:
        teacher_pct = round((teacher_seconds / total_duration) * 100, 1)
        student_pct = round((student_seconds / total_duration) * 100, 1)
        silence_pct = round(max(0.0, 100.0 - teacher_pct - student_pct), 1)
    else:
        teacher_pct = student_pct = silence_pct = 0.0

    return legacy.VideoAudioAnalysisResponse(
        transcript_available=(transcript_doc or {}).get("transcript_status") == "completed",
        features_available=bool(feature_doc),
        teacher_talk_pct=teacher_pct,
        student_talk_pct=student_pct,
        silence_pct=silence_pct,
        teacher_talk_seconds=round(teacher_seconds, 2),
        student_talk_seconds=round(student_seconds, 2),
        total_duration_seconds=round(total_duration, 2),
        segments=[legacy.AudioAnalysisTimelineSegment(**item) for item in normalized_segments],
        transcript_segments=[legacy.AudioAnalysisTranscriptSegment(**item) for item in transcript_segments],
        key_moments=[legacy.AudioAnalysisKeyMoment(**item) for item in key_moments[:20]],
    )


async def create_video(
    file: legacy.UploadFile,
    teacher_id: str,
    workspace_id: Optional[str] = None,
    session_id: Optional[str] = None,
    *,
    request: Optional[legacy.Request] = None,
    subject: Optional[str] = None,
    recorded_at: Optional[str] = None,
    current_user: Optional[dict] = None,
) -> VideoDoc:
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
                    raise legacy.UploadTooLargeError()
                await handle.write(chunk)

        s3_key = None
        file_url = None
        try:
            raw_s3_key_override = legacy._build_video_asset_s3_key("raw", teacher_id, filename)
            s3_key, file_url = legacy._upload_path_to_s3(
                file_path,
                "videos",
                filename,
                content_type,
                key_override=raw_s3_key_override,
            )
        except Exception as exc:
            legacy.logger.warning("S3 upload failed for video %s: %s", video_id, exc)

        transcode_status = (
            legacy.VideoTranscodeStatus.QUEUED.value
            if legacy.VIDEO_TRANSCODE_PIPELINE_ENABLED
            else legacy.VideoTranscodeStatus.NOT_REQUIRED.value
        )
        resolved_workspace_id = workspace_id or legacy._resolve_video_workspace_id(
            {"uploaded_by": current_user["id"]},
            teacher,
            current_user,
        )
        video_doc: VideoDoc = {
            "id": video_id,
            "filename": file.filename,
            "stored_filename": filename,
            "s3_key": s3_key,
            "raw_s3_key": s3_key,
            "file_url": file_url,
            "raw_file_url": file_url,
            "file_path": relative_path,
            "raw_file_path": relative_path,
            "content_type": content_type,
            "file_size_bytes": size,
            "raw_file_size_bytes": size,
            "processed_s3_key": None,
            "processed_file_url": None,
            "processed_file_path": None,
            "processed_content_type": None,
            "processed_file_size_bytes": None,
            "teacher_id": teacher_id,
            "workspace_id": resolved_workspace_id,
            "observation_session_id": session_id or None,
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
                source_content_type=content_type,
                raw_s3_key=s3_key,
                raw_file_url=file_url,
                requested_profile=legacy.VIDEO_TRANSCODE_PROFILE,
            )

        await video_repository.insert_video_evidence(
            {
                "id": str(legacy.uuid.uuid4()),
                "video_id": video_id,
                "teacher_id": teacher_id,
                "observation_session_id": session_id or None,
                "file_path": relative_path,
                "subject": subject,
                "recorded_at": normalized_recorded_at,
                "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
                "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
                "uploaded_by": current_user["id"],
                "uploaded_at": upload_time,
            }
        )

        if observation_session:
            await video_repository.link_observation_session(
                observation_session["id"],
                video_id,
                legacy.ObservationSessionStatus.RECORDING_UPLOADED.value,
                upload_time,
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
        legacy.app_metrics.record_upload_result(
            source=upload_source,
            language=preferred_language,
            success=True,
            duration_seconds=time.perf_counter() - upload_started_perf,
        )
        return video_doc
    except legacy.HTTPException:
        legacy.app_metrics.record_upload_result(
            source=upload_source,
            language=preferred_language,
            success=False,
            duration_seconds=time.perf_counter() - upload_started_perf,
        )
        raise
    except Exception:
        legacy.app_metrics.record_upload_result(
            source=upload_source,
            language=preferred_language,
            success=False,
            duration_seconds=time.perf_counter() - upload_started_perf,
        )
        raise


async def upload_video(
    request: legacy.Request,
    file: legacy.UploadFile,
    teacher_id: str,
    subject: Optional[str],
    recorded_at: Optional[str],
    current_user: dict,
    session_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> legacy.VideoUploadResponse:
    video_doc = await create_video(
        file,
        teacher_id,
        workspace_id,
        session_id,
        request=request,
        subject=subject,
        recorded_at=recorded_at,
        current_user=current_user,
    )
    return legacy.VideoUploadResponse(
        id=video_doc["id"],
        filename=video_doc.get("filename") or "",
        teacher_id=video_doc["teacher_id"],
        observation_session_id=video_doc.get("observation_session_id"),
        status=video_doc["status"],
        privacy_status=video_doc["privacy_status"],
        analysis_status=video_doc["analysis_status"],
        transcode_status=video_doc.get("transcode_status"),
        upload_date=video_doc["upload_date"],
        subject=video_doc.get("subject"),
        recorded_at=video_doc.get("recorded_at"),
        file_path=video_doc.get("file_path"),
        file_size_bytes=video_doc.get("file_size_bytes"),
        content_type=video_doc.get("content_type"),
    )


async def get_video(
    video_id: str,
    workspace_id: Optional[str] = None,
    *,
    current_user: Optional[dict] = None,
) -> VideoDoc:
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise NotFound()
    if workspace_id and workspace_id not in {
        video.get("workspace_id"),
        video.get("uploaded_by"),
        video.get("teacher_id"),
        video.get("organization_id"),
        video.get("school_id"),
    }:
        raise NotFound()
    if current_user is not None:
        await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    return video


async def get_video_detail(video_id: str, current_user: dict):
    video = await get_video(video_id, current_user=current_user)
    return legacy._sanitize_video_response(legacy._apply_video_response_defaults(video))


async def get_video_stream_url(
    video_id: str,
    workspace_id: Optional[str] = None,
    user_id: Optional[str] = None,
    *,
    current_user: Optional[dict] = None,
) -> str:
    video = await get_video(video_id, workspace_id, current_user=current_user)
    privacy_status = legacy._normalize_privacy_status(video.get("privacy_status"))
    if video.get("privacy_status") is not None and privacy_status != legacy.PrivacyProcessingStatus.COMPLETED.value:
        raise legacy.HTTPException(status_code=409, detail="Video is not ready for playback")

    stream_url = (
        _presign_s3_url(video.get("redacted_s3_key"), "video/mp4")
        or _presign_s3_url(video.get("processed_s3_key"), video.get("processed_content_type"))
        or _presign_s3_url(video.get("s3_key"), video.get("content_type"))
        or video.get("redacted_file_url")
        or video.get("processed_file_url")
        or video.get("file_url")
        or _asset_url_from_local_path(video.get("redacted_file_path"))
        or _asset_url_from_local_path(video.get("processed_file_path"))
        or _asset_url_from_local_path(video.get("file_path"))
    )
    if not stream_url:
        raise legacy.HTTPException(status_code=404, detail="Video playback asset not found")

    await legacy._log_privacy_audit_event(
        "video_stream_url_generated",
        "video",
        video_id,
        actor_user_id=user_id or (current_user or {}).get("id"),
        details={
            "workspace_id": workspace_id,
            "privacy_status": privacy_status,
            "asset_preference": video.get("processing_asset_preference"),
        },
    )
    return stream_url


async def get_video_raw_access(video_id: str, current_user: dict):
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    video = await get_video(video_id, current_user=current_user)
    access_url = (
        _presign_s3_url(video.get("raw_s3_key"), video.get("content_type"))
        or video.get("raw_file_url")
        or _asset_url_from_local_path(video.get("raw_file_path"))
    )
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


async def update_video_status(video_id: str, status_updates: dict) -> None:
    if not status_updates:
        return
    updates = dict(status_updates)
    updates.setdefault("status_updated_at", _now_iso())
    await video_repository.update_video_fields(video_id, updates)


async def list_videos(
    workspace_id: Optional[str] = None,
    filters: Optional[Dict[str, Any]] = None,
    *,
    current_user: Optional[dict] = None,
) -> PaginatedList[VideoDoc]:
    filters = filters or {}
    page = max(1, int(filters.get("page") or 1))
    page_size = max(1, min(int(filters.get("page_size") or filters.get("limit") or 100), 500))
    query: Dict[str, Any] = {}
    teacher_id = filters.get("teacher_id")

    if current_user:
        if teacher_id:
            await teacher_repository.get_teacher_or_404(teacher_id, current_user)
            query["teacher_id"] = teacher_id
        else:
            teacher_ids_for_user = await video_repository.list_teacher_ids_for_user(current_user)
            query = video_repository.build_video_visibility_query(current_user, teacher_ids_for_user)
    elif teacher_id:
        query["teacher_id"] = teacher_id

    workspace_id = workspace_id or filters.get("workspace_id")
    if workspace_id and not current_user:
        query["$or"] = [
            {"workspace_id": workspace_id},
            {"uploaded_by": workspace_id},
            {"organization_id": workspace_id},
            {"school_id": workspace_id},
        ]

    for key in ["status", "privacy_status", "analysis_status", "transcode_status"]:
        if filters.get(key):
            query[key] = filters[key]

    docs, total = await video_repository.list_videos_paginated(
        query,
        skip=(page - 1) * page_size,
        limit=page_size,
        projection={"_id": 0, "uploaded_by": 0, "stored_filename": 0},
    )
    for video in docs:
        legacy._apply_video_response_defaults(video)
    return PaginatedList(
        items=[legacy._sanitize_video_response(video) for video in docs],
        total=total,
        page=page,
        page_size=page_size,
    )


async def list_videos_for_route(teacher_id: Optional[str], current_user: dict):
    result = await list_videos(
        _resolve_workspace_id_from_user(current_user),
        {"teacher_id": teacher_id, "limit": 1000},
        current_user=current_user,
    )
    return result.items


async def get_video_status(video_id: str, current_user: dict):
    video = await get_video(video_id, current_user=current_user)
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
    video = await get_video(video_id, current_user=current_user)
    current_status = legacy._normalize_video_status(video.get("status"))
    if current_status != legacy.VideoProcessingStatus.FAILED.value:
        raise legacy.HTTPException(status_code=400, detail="Only failed videos can be retried")
    if legacy._normalize_privacy_status(video.get("privacy_status")) != legacy.PrivacyProcessingStatus.COMPLETED.value:
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable until privacy processing is complete")
    relative_path = video.get("redacted_file_path") or video.get("file_path")
    if not relative_path:
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = legacy.UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable because the local video file is missing")
    queued_at = _now_iso()
    await update_video_status(
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
    video = await get_video(video_id, current_user=current_user)
    relative_path = video.get("processed_file_path") or video.get("raw_file_path") or video.get("file_path")
    if not relative_path:
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable for videos without local source")
    full_path = legacy.UPLOAD_DIR / str(relative_path)
    if not full_path.exists():
        raise legacy.HTTPException(status_code=409, detail="Retry unavailable because the local video file is missing")
    queued_at = _now_iso()
    await update_video_status(
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


async def list_privacy_review_queue(current_user: dict) -> legacy.PrivacyReviewQueueResponse:
    if legacy._get_user_role(current_user) != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    videos = await video_repository.list_privacy_review_videos(current_user["id"])
    items: List[legacy.PrivacyReviewQueueItem] = []
    for video in videos:
        candidates = [
            legacy.PrivacyReviewCandidateTrack(**candidate)
            for candidate in (video.get("privacy_candidate_tracks") or [])
            if candidate.get("track_id")
        ]
        items.append(
            legacy.PrivacyReviewQueueItem(
                video_id=video["id"],
                teacher_id=video.get("teacher_id"),
                teacher_name=await video_repository.find_teacher_name(video.get("teacher_id")),
                filename=video.get("filename") or "recording",
                privacy_status=legacy._normalize_privacy_status(video.get("privacy_status")),
                privacy_review_reason=video.get("privacy_review_reason"),
                upload_date=video.get("upload_date") or _now_iso(),
                candidate_tracks=candidates,
            )
        )
    return legacy.PrivacyReviewQueueResponse(items=items)


async def list_privacy_audit_events(
    target_type: Optional[str],
    target_id: Optional[str],
    limit: int,
    current_user: dict,
) -> List[legacy.PrivacyAuditEvent]:
    if legacy._get_user_role(current_user) != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    query: Dict[str, Any] = {}
    if target_type:
        query["target_type"] = target_type
    if target_id:
        query["target_id"] = target_id
    docs = await video_repository.list_privacy_audit_events(query, limit)
    return [legacy.PrivacyAuditEvent(**doc) for doc in docs]


async def resolve_video_privacy_review(
    video_id: str,
    payload: legacy.PrivacyReviewDecisionRequest,
    current_user: dict,
) -> legacy.PrivacyReviewDecisionResponse:
    if legacy._get_user_role(current_user) != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    video = await get_video(video_id, current_user=current_user)
    if legacy._normalize_privacy_status(video.get("privacy_status")) != legacy.PrivacyProcessingStatus.REVIEW_REQUIRED.value:
        raise legacy.HTTPException(status_code=400, detail="Video is not awaiting privacy review")
    resolved_at = _now_iso()
    update_fields: Dict[str, Any] = {
        "privacy_review_required": False,
        "privacy_review_reason": None,
        "privacy_review_resolved_by": current_user["id"],
        "privacy_review_resolved_at": resolved_at,
    }
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue"}:
        update_fields.update(
            {
                "status": legacy.VideoProcessingStatus.QUEUED.value,
                "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
                "privacy_completed_at": None,
                "analysis_status": legacy.VideoProcessingStatus.QUEUED.value,
                "privacy_error": None,
                "privacy_manual_override": {
                    "decision": payload.decision,
                    "approved_track_id": payload.approved_track_id,
                    "reason": payload.reason,
                    "resolved_by": current_user["id"],
                    "resolved_at": resolved_at,
                },
            }
        )
    elif payload.decision == "rerun":
        update_fields.update(
            {
                "status": legacy.VideoProcessingStatus.QUEUED.value,
                "privacy_status": legacy.PrivacyProcessingStatus.QUEUED.value,
                "privacy_manual_override": None,
            }
        )
    elif payload.decision == "reject_video":
        update_fields.update(
            {
                "status": legacy.VideoProcessingStatus.FAILED.value,
                "privacy_status": legacy.PrivacyProcessingStatus.FAILED.value,
                "privacy_failed_at": resolved_at,
                "privacy_error": payload.reason,
                "privacy_manual_override": None,
            }
        )
    else:
        raise legacy.HTTPException(status_code=400, detail="Unsupported privacy review decision")
    await update_video_status(video_id, update_fields)
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue", "rerun"}:
        relative_path = video.get("processed_file_path") or video.get("raw_file_path") or video.get("file_path")
        if relative_path:
            await legacy._enqueue_video_privacy_job(
                video_id=video_id,
                teacher_id=video.get("teacher_id"),
                user_id=video.get("uploaded_by") or current_user["id"],
                file_path=str(legacy.UPLOAD_DIR / str(relative_path)),
            )
    await legacy._log_privacy_audit_event(
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
    return legacy.PrivacyReviewDecisionResponse(
        video_id=video_id,
        privacy_status=legacy._normalize_privacy_status(update_fields.get("privacy_status")),
        analysis_status=legacy._normalize_video_status(update_fields.get("analysis_status", video.get("analysis_status"))),
        review_resolved_by=current_user["id"],
        review_resolved_at=resolved_at,
    )


async def get_admin_video_sampling_manifest(video_id: str, current_user: dict) -> legacy.SamplingManifestResponse:
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await video_repository.find_latest_sampling_manifest(video_id)
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Sampling manifest not found")
    return legacy.SamplingManifestResponse(**doc)


async def get_admin_video_analysis_moments(video_id: str, current_user: dict) -> legacy.AnalysisMomentManifestResponse:
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await video_repository.find_latest_analysis_moments(video_id)
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Analysis moments not found")
    return legacy.AnalysisMomentManifestResponse(**doc)


async def get_admin_video_audio_transcript(video_id: str, current_user: dict) -> legacy.AudioTranscriptResponse:
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await video_repository.find_latest_audio_transcript(video_id)
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Audio transcript not found")
    return legacy.AudioTranscriptResponse(**doc)


async def get_admin_video_audio_features(video_id: str, current_user: dict) -> legacy.AudioFeatureResponse:
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await video_repository.find_audio_features(video_id)
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Audio features not found")
    return legacy.AudioFeatureResponse(**doc)


async def get_video_audio_analysis(video_id: str, current_user: dict) -> legacy.VideoAudioAnalysisResponse:
    await legacy._get_visible_video_or_404(video_id, current_user)
    transcript_doc = await video_repository.find_latest_audio_transcript(video_id)
    feature_doc = await video_repository.find_audio_features(video_id)
    return _build_video_audio_analysis_response(transcript_doc, feature_doc)


async def list_video_comments(video_id: str, current_user: dict) -> legacy.VideoCommentListResponse:
    await legacy._get_visible_video_or_404(video_id, current_user)
    docs = await video_repository.list_video_comments(legacy._comment_visibility_query(video_id, current_user))
    docs.sort(key=lambda item: (float(item.get("timestamp_seconds") or 0), str(item.get("created_at") or "")))
    return legacy.VideoCommentListResponse(
        comments=[legacy.VideoComment(**legacy._sanitize_video_comment_doc(doc)) for doc in docs]
    )


async def create_video_comment(
    video_id: str,
    payload: legacy.VideoCommentCreate,
    current_user: dict,
) -> legacy.VideoComment:
    video = await legacy._get_visible_video_or_404(video_id, current_user)
    teacher = await video_repository.find_teacher_by_id(video.get("teacher_id"))
    body = (payload.body or "").strip()
    if not body:
        raise legacy.HTTPException(status_code=400, detail="Comment text is required")
    timestamp_seconds = float(payload.timestamp_seconds or 0)
    if timestamp_seconds < 0:
        raise legacy.HTTPException(status_code=400, detail="Comment timestamp cannot be negative")
    thread_parent_id = legacy._clean_optional_string(payload.thread_parent_id)
    if thread_parent_id:
        parent = await legacy._get_video_comment_or_404(video_id, thread_parent_id, current_user)
        if parent.get("thread_parent_id"):
            raise legacy.HTTPException(status_code=400, detail="Replies can only be one level deep")
        timestamp_seconds = float(parent.get("timestamp_seconds") or timestamp_seconds)
    now = _now_iso()
    doc = {
        "id": str(legacy.uuid.uuid4()),
        "video_id": video_id,
        "workspace_id": legacy._resolve_video_workspace_id(video, teacher, current_user),
        "author_id": current_user["id"],
        "author_name": (
            legacy._clean_optional_string(current_user.get("name"))
            or legacy._clean_optional_string(current_user.get("email"))
            or "Cognivio user"
        ),
        "author_role": legacy._get_user_tenant_role(current_user),
        "timestamp_seconds": timestamp_seconds,
        **await _resolve_video_comment_rubric_fields(
            video_id,
            payload.rubric_element_id,
            payload.rubric_element_code,
            payload.rubric_element_name,
        ),
        "body": body,
        "is_private": bool(payload.is_private),
        "thread_parent_id": thread_parent_id,
        "created_at": now,
        "updated_at": now,
    }
    await video_repository.insert_video_comment(doc)
    return legacy.VideoComment(**legacy._sanitize_video_comment_doc(doc))


async def update_video_comment(
    video_id: str,
    comment_id: str,
    payload: legacy.VideoCommentUpdate,
    current_user: dict,
) -> legacy.VideoComment:
    await legacy._get_visible_video_or_404(video_id, current_user)
    comment = await legacy._get_video_comment_or_404(video_id, comment_id, current_user)
    if comment.get("author_id") != current_user["id"]:
        raise legacy.HTTPException(status_code=403, detail="Only the author can edit this comment")
    if datetime.now(timezone.utc) - legacy._parse_comment_created_at(comment.get("created_at")) > timedelta(minutes=15):
        raise legacy.HTTPException(status_code=403, detail="Comments can only be edited within 15 minutes")
    updates = payload.dict(exclude_unset=True)
    update_fields: Dict[str, Any] = {}
    if "body" in updates:
        body = (payload.body or "").strip()
        if not body:
            raise legacy.HTTPException(status_code=400, detail="Comment text is required")
        update_fields["body"] = body
    if "is_private" in updates and payload.is_private is not None:
        update_fields["is_private"] = bool(payload.is_private)
    if {"rubric_element_id", "rubric_element_code", "rubric_element_name"}.intersection(updates.keys()):
        update_fields.update(
            await _resolve_video_comment_rubric_fields(
                video_id,
                payload.rubric_element_id,
                payload.rubric_element_code,
                payload.rubric_element_name,
            )
        )
    if not update_fields:
        raise legacy.HTTPException(status_code=400, detail="No fields to update")
    update_fields["updated_at"] = _now_iso()
    updated = await video_repository.update_video_comment(video_id, comment_id, update_fields)
    if not updated:
        raise legacy.HTTPException(status_code=404, detail="Comment not found")
    return legacy.VideoComment(**legacy._sanitize_video_comment_doc(updated))


async def delete_video_comment(video_id: str, comment_id: str, current_user: dict):
    await legacy._get_visible_video_or_404(video_id, current_user)
    comment = await legacy._get_video_comment_or_404(video_id, comment_id, current_user)
    role = legacy._get_user_role(current_user)
    if comment.get("author_id") != current_user["id"] and role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Only the author or an admin can delete this comment")
    if comment.get("is_private") and comment.get("author_id") != current_user["id"]:
        raise legacy.HTTPException(status_code=403, detail="Only the author can delete a private comment")
    deleted_count = await video_repository.delete_video_comment(
        video_id,
        comment_id,
        include_replies=not bool(comment.get("thread_parent_id")),
    )
    if deleted_count == 0:
        raise legacy.HTTPException(status_code=404, detail="Comment not found")
    return {"message": "Comment deleted", "deleted_count": deleted_count}
