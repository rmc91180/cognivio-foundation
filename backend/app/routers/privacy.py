from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query

import server as legacy

from app.dependencies import get_current_user
from app.services.privacy_service import (
    get_privacy_audit_events,
    get_privacy_review_queue,
    get_video_analysis_moments,
    get_video_audio_features,
    get_video_audio_transcript,
    get_video_sampling_manifest,
    resolve_video_privacy_review,
)


router = APIRouter(tags=["privacy"])


@router.get("/privacy/review-queue", response_model=legacy.PrivacyReviewQueueResponse)
async def get_privacy_review_queue_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_privacy_review_queue(current_user)


@router.get("/privacy/audit", response_model=List[legacy.PrivacyAuditEvent])
async def get_privacy_audit_events_route(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    return await get_privacy_audit_events(current_user, target_type, target_id, limit)


@router.get(
    "/admin/videos/{video_id}/sampling-manifest",
    response_model=legacy.SamplingManifestResponse,
)
async def get_admin_video_sampling_manifest_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_sampling_manifest(video_id, current_user)


@router.get(
    "/admin/videos/{video_id}/analysis-moments",
    response_model=legacy.AnalysisMomentManifestResponse,
)
async def get_admin_video_analysis_moments_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_analysis_moments(video_id, current_user)


@router.get(
    "/admin/videos/{video_id}/audio-transcript",
    response_model=legacy.AudioTranscriptResponse,
)
async def get_admin_video_audio_transcript_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_audio_transcript(video_id, current_user)


@router.get(
    "/admin/videos/{video_id}/audio-features",
    response_model=legacy.AudioFeatureResponse,
)
async def get_admin_video_audio_features_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_audio_features(video_id, current_user)


@router.post(
    "/videos/{video_id}/privacy/review",
    response_model=legacy.PrivacyReviewDecisionResponse,
)
async def resolve_video_privacy_review_route(
    video_id: str,
    payload: legacy.PrivacyReviewDecisionRequest,
    current_user: dict = Depends(get_current_user),
):
    return await resolve_video_privacy_review(video_id, payload, current_user)
