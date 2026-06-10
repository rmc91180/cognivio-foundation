from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.services.video_comment_service import (
    VideoComment,
    VideoCommentCreate,
    VideoCommentListResponse,
    VideoCommentUpdate,
    create_video_comment,
    delete_video_comment,
    list_video_comments,
    update_video_comment,
)


router = APIRouter(tags=["video-comments"])


@router.get("/videos/{video_id}/comments", response_model=VideoCommentListResponse)
async def list_video_comments_route(
    video_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await list_video_comments(video_id, current_user)


@router.post("/videos/{video_id}/comments", response_model=VideoComment)
async def create_video_comment_route(
    video_id: str,
    payload: VideoCommentCreate,
    current_user: dict = Depends(get_current_user),
):
    return await create_video_comment(video_id, payload, current_user)


@router.patch("/videos/{video_id}/comments/{comment_id}", response_model=VideoComment)
async def update_video_comment_route(
    video_id: str,
    comment_id: str,
    payload: VideoCommentUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await update_video_comment(video_id, comment_id, payload, current_user)


@router.delete("/videos/{video_id}/comments/{comment_id}")
async def delete_video_comment_route(
    video_id: str,
    comment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await delete_video_comment(video_id, comment_id, current_user)
