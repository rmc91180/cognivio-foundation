from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import server as legacy

from app.repositories import recognition_repository, teacher_repository, video_repository


async def get_teacher_recognition_summary(
    teacher_id: str,
    current_user: dict,
) -> legacy.TeacherRecognitionSummaryResponse:
    await teacher_repository.get_teacher_or_404(teacher_id, current_user)
    badges = await recognition_repository.list_recognition_badges_for_teacher(teacher_id)
    return legacy._build_teacher_recognition_summary(teacher_id, badges)


async def get_video_recognition(
    video_id: str,
    current_user: dict,
) -> legacy.VideoRecognitionResponse:
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await recognition_repository.get_or_sync_video_recognition_event(video)
    return legacy._build_video_recognition_response(video, event)


async def update_video_recognition_opt_in(
    video_id: str,
    payload: legacy.RecognitionOptInRequest,
    current_user: dict,
) -> legacy.RecognitionOptInResponse:
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await recognition_repository.get_or_sync_video_recognition_event(video)
    updated_at = datetime.now(timezone.utc).isoformat()
    teacher_opt_in = bool(payload.teacher_opt_in)
    sharing_scope = payload.sharing_scope if teacher_opt_in else None
    allow_social_share = bool(payload.allow_social_share) if teacher_opt_in else False
    allow_email_signature = bool(payload.allow_email_signature) if teacher_opt_in else False
    await recognition_repository.update_lesson_recognition_event(
        event["id"],
        {
            "teacher_opt_in": teacher_opt_in,
            "sharing_scope": sharing_scope,
            "allow_social_share": allow_social_share,
            "allow_email_signature": allow_email_signature,
            "updated_at": updated_at,
        },
    )
    await legacy._log_recognition_audit_event(
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
    return legacy.RecognitionOptInResponse(
        video_id=video_id,
        teacher_opt_in=teacher_opt_in,
        sharing_scope=sharing_scope,
        allow_social_share=allow_social_share,
        allow_email_signature=allow_email_signature,
        updated_at=updated_at,
    )


async def get_recognition_review_queue(current_user: dict) -> legacy.RecognitionReviewQueueResponse:
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    events = await recognition_repository.list_recognition_events_pending_review()
    items: List[legacy.RecognitionReviewQueueItem] = []
    for event in events:
        video = await video_repository.find_video_by_id(event.get("video_id"))
        if not video or video.get("uploaded_by") != current_user["id"]:
            continue
        teacher = await video_repository.find_teacher_by_id(video.get("teacher_id"))
        items.append(
            legacy.RecognitionReviewQueueItem(
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
    return legacy.RecognitionReviewQueueResponse(items=items)


async def review_video_recognition(
    video_id: str,
    payload: legacy.RecognitionReviewRequest,
    current_user: dict,
) -> legacy.RecognitionReviewResponse:
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    video = await video_repository.find_video_by_id(video_id)
    if not video:
        raise legacy.HTTPException(status_code=404, detail="Video not found")
    teacher = await teacher_repository.get_teacher_or_404(video.get("teacher_id"), current_user)
    event = await recognition_repository.get_or_sync_video_recognition_event(video)
    decision = (payload.decision or "").strip().lower()
    reviewed_at = datetime.now(timezone.utc).isoformat()
    badge_doc: Optional[dict] = None

    if decision == "approve":
        if not (event.get("eligibility") or {}).get("is_eligible"):
            raise legacy.HTTPException(
                status_code=400,
                detail="Video is not eligible for recognition approval",
            )
        badge_type = payload.badge_type or event.get("badge_type") or legacy.FIVE_STAR_BADGE
        existing_badge = await recognition_repository.find_recognition_badge(video_id, badge_type)
        if existing_badge:
            badge_doc = {
                **existing_badge,
                "status": "awarded",
                "awarded_at": existing_badge.get("awarded_at") or reviewed_at,
                "awarded_by": current_user["id"],
                "criteria_snapshot": (event.get("eligibility") or {}).get("criteria_snapshot") or {},
            }
            await recognition_repository.update_recognition_badge(existing_badge["id"], badge_doc)
        else:
            badge_doc = {
                "id": str(legacy.uuid.uuid4()),
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
            await recognition_repository.insert_recognition_badge(badge_doc)
        await recognition_repository.update_lesson_recognition_event(
            event["id"],
            {
                "recognition_status": "awarded",
                "badge_id": badge_doc["id"],
                "badge_type": badge_doc["badge_type"],
                "reviewed_at": reviewed_at,
                "reviewed_by": current_user["id"],
                "review_reason": payload.reason,
                "updated_at": reviewed_at,
            },
        )
        await legacy._log_recognition_audit_event(
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
        await legacy._notify_teacher_recognition_awarded(video, teacher, current_user)
        return legacy.RecognitionReviewResponse(
            video_id=video_id,
            recognition_status="awarded",
            badge=legacy.RecognitionBadgeResponse(
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
        raise legacy.HTTPException(status_code=400, detail="Unsupported recognition review decision")

    existing_badge = await recognition_repository.find_recognition_badge(video_id)
    if decision == "revoke" and existing_badge:
        await recognition_repository.update_recognition_badge(
            existing_badge["id"],
            {
                **existing_badge,
                "status": "revoked",
                "updated_at": reviewed_at,
                "revoked_at": reviewed_at,
                "revoked_by": current_user["id"],
            },
        )
    await recognition_repository.update_lesson_recognition_event(
        event["id"],
        {
            "recognition_status": "rejected" if decision == "reject" else "revoked",
            "reviewed_at": reviewed_at,
            "reviewed_by": current_user["id"],
            "review_reason": payload.reason,
            "updated_at": reviewed_at,
        },
    )
    await legacy._log_recognition_audit_event(
        "recognition_rejected" if decision == "reject" else "recognition_revoked",
        "video",
        video_id,
        actor_user_id=current_user["id"],
        details={"reason": payload.reason},
    )
    return legacy.RecognitionReviewResponse(
        video_id=video_id,
        recognition_status="rejected" if decision == "reject" else "revoked",
        badge=None,
    )
