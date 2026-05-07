from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

import server as legacy

from app.dependencies import get_current_user
from app.services import video_service


router = APIRouter(tags=["videos"])


@router.post("/videos/upload", response_model=legacy.VideoUploadResponse)
@legacy.limiter.limit("10/minute")
async def upload_video_route(
    request: legacy.Request,
    file: UploadFile = File(...),
    teacher_id: str = Form(...),
    subject: Optional[str] = Form(None),
    recorded_at: Optional[str] = Form(None),
    observation_session_id: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    workspace_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    return await video_service.upload_video(
        request,
        file,
        teacher_id,
        subject,
        recorded_at,
        current_user,
        session_id=session_id or observation_session_id,
        workspace_id=workspace_id,
    )


@router.get("/videos")
async def get_videos_route(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.list_videos_for_route(teacher_id, current_user)


@router.get("/videos/{video_id}")
async def get_video_detail_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_video_detail(video_id, current_user)


@router.get("/videos/{video_id}/stream")
async def get_video_stream_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    stream_url = await video_service.get_video_stream_url(
        video_id,
        user_id=current_user["id"],
        current_user=current_user,
    )
    return {"video_id": video_id, "stream_url": stream_url}


@router.get("/videos/{video_id}/raw-access")
async def get_video_raw_access_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_video_raw_access(video_id, current_user)


@router.get("/videos/{video_id}/status")
async def get_video_status_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_video_status(video_id, current_user)


@router.get("/videos/{video_id}/comments", response_model=legacy.VideoCommentListResponse)
async def list_video_comments_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.list_video_comments(video_id, current_user)


@router.post("/videos/{video_id}/comments", response_model=legacy.VideoComment)
async def create_video_comment_route(
    video_id: str,
    payload: legacy.VideoCommentCreate,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.create_video_comment(video_id, payload, current_user)


@router.patch("/videos/{video_id}/comments/{comment_id}", response_model=legacy.VideoComment)
async def update_video_comment_route(
    video_id: str,
    comment_id: str,
    payload: legacy.VideoCommentUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.update_video_comment(video_id, comment_id, payload, current_user)


@router.delete("/videos/{video_id}/comments/{comment_id}")
async def delete_video_comment_route(
    video_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.delete_video_comment(video_id, comment_id, current_user)


@router.post("/videos/{video_id}/retry")
async def retry_video_processing_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.retry_video_processing(video_id, current_user)


@router.post("/videos/{video_id}/privacy/retry")
async def retry_video_privacy_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.retry_video_privacy(video_id, current_user)


@router.get("/privacy/review-queue", response_model=legacy.PrivacyReviewQueueResponse)
async def get_privacy_review_queue_route(current_user: dict = Depends(get_current_user)):
    return await video_service.list_privacy_review_queue(current_user)


@router.get("/privacy/audit", response_model=List[legacy.PrivacyAuditEvent])
async def get_privacy_audit_events_route(
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    return await video_service.list_privacy_audit_events(target_type, target_id, limit, current_user)


@router.post("/videos/{video_id}/privacy/review", response_model=legacy.PrivacyReviewDecisionResponse)
async def resolve_video_privacy_review_route(
    video_id: str,
    payload: legacy.PrivacyReviewDecisionRequest,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.resolve_video_privacy_review(video_id, payload, current_user)


@router.get("/admin/videos/{video_id}/sampling-manifest", response_model=legacy.SamplingManifestResponse)
async def get_admin_video_sampling_manifest_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_admin_video_sampling_manifest(video_id, current_user)


@router.get("/admin/videos/{video_id}/analysis-moments", response_model=legacy.AnalysisMomentManifestResponse)
async def get_admin_video_analysis_moments_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_admin_video_analysis_moments(video_id, current_user)


@router.get("/admin/videos/{video_id}/audio-transcript", response_model=legacy.AudioTranscriptResponse)
async def get_admin_video_audio_transcript_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_admin_video_audio_transcript(video_id, current_user)


@router.get("/admin/videos/{video_id}/audio-features", response_model=legacy.AudioFeatureResponse)
async def get_admin_video_audio_features_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_admin_video_audio_features(video_id, current_user)


@router.get("/videos/{video_id}/audio-analysis", response_model=legacy.VideoAudioAnalysisResponse)
async def get_video_audio_analysis_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await video_service.get_video_audio_analysis(video_id, current_user)
