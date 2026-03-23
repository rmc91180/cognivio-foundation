from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

import server as legacy

from app.dependencies import get_current_user
from app.services.exemplar_service import (
    generate_email_signature,
    generate_social_card,
    get_exemplar_library,
    get_exemplar_review_queue,
    review_exemplar_submission,
    submit_video_exemplar,
)


router = APIRouter(tags=["exemplars"])


@router.post(
    "/videos/{video_id}/exemplar/submit",
    response_model=legacy.ExemplarSubmissionResponse,
)
async def submit_video_exemplar_route(
    video_id: str,
    payload: legacy.ExemplarSubmissionRequest,
    current_user: dict = Depends(get_current_user),
):
    return await submit_video_exemplar(video_id, payload, current_user)


@router.get(
    "/exemplar-library/review-queue",
    response_model=legacy.ExemplarReviewQueueResponse,
)
async def get_exemplar_review_queue_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_exemplar_review_queue(current_user)


@router.post(
    "/exemplar-library/{submission_id}/review",
    response_model=legacy.ExemplarLibraryReviewResponse,
)
async def review_exemplar_submission_route(
    submission_id: str,
    payload: legacy.ExemplarLibraryReviewRequest,
    current_user: dict = Depends(get_current_user),
):
    return await review_exemplar_submission(submission_id, payload, current_user)


@router.get("/exemplar-library", response_model=legacy.ExemplarLibraryResponse)
async def get_exemplar_library_route(
    subject: Optional[str] = None,
    tag: Optional[str] = None,
    request: legacy.Request = None,
    current_user: dict = Depends(get_current_user),
):
    return await get_exemplar_library(subject, tag, request, current_user)


@router.post(
    "/videos/{video_id}/share/social-card",
    response_model=legacy.SocialCardResponse,
)
async def generate_social_card_route(
    video_id: str,
    payload: legacy.SocialCardRequest,
    current_user: dict = Depends(get_current_user),
):
    return await generate_social_card(video_id, payload, current_user)


@router.post(
    "/videos/{video_id}/share/email-signature",
    response_model=legacy.EmailSignatureResponse,
)
async def generate_email_signature_route(
    video_id: str,
    payload: legacy.EmailSignatureRequest,
    current_user: dict = Depends(get_current_user),
):
    return await generate_email_signature(video_id, payload, current_user)
