from __future__ import annotations

from fastapi import APIRouter, Depends

import server as legacy

from app.dependencies import get_current_user
from app.services.recognition_service import (
    get_recognition_review_queue,
    get_teacher_recognition_summary,
    get_video_recognition,
    review_video_recognition,
    update_video_recognition_opt_in,
)


router = APIRouter(tags=["recognition"])


@router.get(
    "/teachers/{teacher_id}/recognition",
    response_model=legacy.TeacherRecognitionSummaryResponse,
)
async def get_teacher_recognition_summary_route(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_teacher_recognition_summary(teacher_id, current_user)


@router.get("/videos/{video_id}/recognition", response_model=legacy.VideoRecognitionResponse)
async def get_video_recognition_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_recognition(video_id, current_user)


@router.post(
    "/videos/{video_id}/recognition/opt-in",
    response_model=legacy.RecognitionOptInResponse,
)
async def update_video_recognition_opt_in_route(
    video_id: str,
    payload: legacy.RecognitionOptInRequest,
    current_user: dict = Depends(get_current_user),
):
    return await update_video_recognition_opt_in(video_id, payload, current_user)


@router.get(
    "/recognition/review-queue",
    response_model=legacy.RecognitionReviewQueueResponse,
)
async def get_recognition_review_queue_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_recognition_review_queue(current_user)


@router.post(
    "/videos/{video_id}/recognition/review",
    response_model=legacy.RecognitionReviewResponse,
)
async def review_video_recognition_route(
    video_id: str,
    payload: legacy.RecognitionReviewRequest,
    current_user: dict = Depends(get_current_user),
):
    return await review_video_recognition(video_id, payload, current_user)
