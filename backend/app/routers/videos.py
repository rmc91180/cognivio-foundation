from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

import server as legacy

from app.dependencies import get_current_user
from app.services.video_service import (
    get_video_detail,
    get_video_raw_access,
    get_video_status,
    list_videos,
    retry_video_privacy,
    retry_video_processing,
    upload_video,
)


router = APIRouter(tags=["videos"])


@router.post("/videos/upload", response_model=legacy.VideoUploadResponse)
async def upload_video_route(
    request: legacy.Request,
    file: UploadFile = File(...),
    teacher_id: Optional[str] = Form(None),
    subject: Optional[str] = Form(None),
    lesson_title: Optional[str] = Form(None),
    class_section: Optional[str] = Form(None),
    recorded_at: Optional[str] = Form(None),
    observation_session_id: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    return await upload_video(
        file=file,
        teacher_id=teacher_id,
        session_id=observation_session_id or session_id,
        request=request,
        subject=subject,
        lesson_title=lesson_title,
        class_section=class_section,
        recorded_at=recorded_at,
        current_user=current_user,
    )


@router.get("/videos")
async def get_videos_route(
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    return await list_videos(teacher_id, current_user)


@router.get("/videos/{video_id}")
async def get_video_detail_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_detail(video_id, current_user)


@router.get("/videos/{video_id}/raw-access")
async def get_video_raw_access_route(
    video_id: str,
    reason: Optional[str] = Query(None, min_length=3),
    current_user: dict = Depends(get_current_user),
):
    return await get_video_raw_access(video_id, current_user, access_reason=reason)


@router.get("/videos/{video_id}/status")
async def get_video_status_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_video_status(video_id, current_user)


@router.post("/videos/{video_id}/retry")
async def retry_video_processing_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await retry_video_processing(video_id, current_user)


@router.post("/videos/{video_id}/privacy/retry")
async def retry_video_privacy_route(
    video_id: str,
    payload: Optional[legacy.PrivacyRetryOptions] = None,
    current_user: dict = Depends(get_current_user),
):
    force_full_frame = bool(payload.force_full_frame) if payload else False
    return await retry_video_privacy(
        video_id, current_user, force_full_frame=force_full_frame
    )
