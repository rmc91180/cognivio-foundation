from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import server as legacy


async def get_privacy_review_queue(current_user: dict) -> legacy.PrivacyReviewQueueResponse:
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    videos = await legacy.db.videos.find(
        {
            "uploaded_by": current_user["id"],
            "privacy_status": legacy.PrivacyProcessingStatus.REVIEW_REQUIRED.value,
        },
        {"_id": 0},
    ).sort("upload_date", -1).to_list(200)
    items: List[legacy.PrivacyReviewQueueItem] = []
    for video in videos:
        teacher = await legacy.db.teachers.find_one(
            {"id": video.get("teacher_id")},
            {"_id": 0, "name": 1},
        )
        candidates = [
            legacy.PrivacyReviewCandidateTrack(**candidate)
            for candidate in (video.get("privacy_candidate_tracks") or [])
            if candidate.get("track_id")
        ]
        items.append(
            legacy.PrivacyReviewQueueItem(
                video_id=video["id"],
                teacher_id=video.get("teacher_id"),
                teacher_name=(teacher or {}).get("name"),
                filename=video.get("filename") or "recording",
                privacy_status=legacy._normalize_privacy_status(video.get("privacy_status")),
                privacy_review_reason=video.get("privacy_review_reason"),
                upload_date=video.get("upload_date") or datetime.now(timezone.utc).isoformat(),
                candidate_tracks=candidates,
            )
        )
    return legacy.PrivacyReviewQueueResponse(items=items)


async def get_privacy_audit_events(
    current_user: dict,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = 100,
):
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    query: Dict[str, Any] = {}
    if target_type:
        query["target_type"] = target_type
    if target_id:
        query["target_id"] = target_id
    docs = await legacy.db.privacy_audit_events.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return [legacy.PrivacyAuditEvent(**doc) for doc in docs]


async def get_video_sampling_manifest(video_id: str, current_user: dict):
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await legacy.db.video_sampling_manifests.find_one(
        {"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Sampling manifest not found")
    return legacy.SamplingManifestResponse(**doc)


async def get_video_analysis_moments(video_id: str, current_user: dict):
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await legacy.db.video_analysis_moments.find_one(
        {"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Analysis moments not found")
    return legacy.AnalysisMomentManifestResponse(**doc)


async def get_video_audio_transcript(video_id: str, current_user: dict):
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await legacy.db.video_audio_transcripts.find_one(
        {"video_id": video_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Audio transcript not found")
    return legacy.AudioTranscriptResponse(**doc)


async def get_video_audio_features(video_id: str, current_user: dict):
    await legacy._get_admin_owned_video_or_404(video_id, current_user)
    doc = await legacy.db.video_analysis_features.find_one(
        {"video_id": video_id}, {"_id": 0}
    )
    if not doc:
        raise legacy.HTTPException(status_code=404, detail="Audio features not found")
    return legacy.AudioFeatureResponse(**doc)


async def resolve_video_privacy_review(
    video_id: str,
    payload: legacy.PrivacyReviewDecisionRequest,
    current_user: dict,
) -> legacy.PrivacyReviewDecisionResponse:
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    video = await legacy.db.videos.find_one({"id": video_id}, {"_id": 0})
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await legacy._get_teacher_or_404(video.get("teacher_id"), current_user)
    if (
        legacy._normalize_privacy_status(video.get("privacy_status"))
        != legacy.PrivacyProcessingStatus.REVIEW_REQUIRED.value
    ):
        raise legacy.HTTPException(status_code=400, detail="Video is not awaiting privacy review")
    resolved_at = datetime.now(timezone.utc).isoformat()
    update_fields: Dict[str, Any] = {
        "privacy_review_required": False,
        "privacy_review_reason": None,
        "privacy_review_resolved_by": current_user["id"],
        "privacy_review_resolved_at": resolved_at,
    }
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue"}:
        update_fields["status"] = legacy.VideoProcessingStatus.QUEUED.value
        update_fields["privacy_status"] = legacy.PrivacyProcessingStatus.QUEUED.value
        update_fields["privacy_completed_at"] = None
        update_fields["analysis_status"] = legacy.VideoProcessingStatus.QUEUED.value
        update_fields["privacy_error"] = None
        update_fields["privacy_manual_override"] = {
            "decision": payload.decision,
            "approved_track_id": payload.approved_track_id,
            "reason": payload.reason,
            "resolved_by": current_user["id"],
            "resolved_at": resolved_at,
        }
    elif payload.decision == "rerun":
        update_fields["status"] = legacy.VideoProcessingStatus.QUEUED.value
        update_fields["privacy_status"] = legacy.PrivacyProcessingStatus.QUEUED.value
        update_fields["privacy_manual_override"] = None
    elif payload.decision == "reject_video":
        update_fields["status"] = legacy.VideoProcessingStatus.FAILED.value
        update_fields["privacy_status"] = legacy.PrivacyProcessingStatus.FAILED.value
        update_fields["privacy_failed_at"] = resolved_at
        update_fields["privacy_error"] = payload.reason
        update_fields["privacy_manual_override"] = None
    else:
        raise legacy.HTTPException(status_code=400, detail="Unsupported privacy review decision")
    await legacy.db.videos.update_one({"id": video_id}, {"$set": update_fields})
    if payload.decision in {"approve_teacher_track", "blur_all_and_continue", "rerun"}:
        relative_path = video.get("raw_file_path") or video.get("file_path")
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
        analysis_status=legacy._normalize_video_status(
            update_fields.get("analysis_status", video.get("analysis_status"))
        ),
        review_resolved_by=current_user["id"],
        review_resolved_at=resolved_at,
    )
