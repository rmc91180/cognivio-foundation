from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, File, Form, UploadFile

import server as legacy

from app.dependencies import get_current_user
from app.services.teacher_service import (
    create_teacher,
    delete_teacher,
    delete_teacher_privacy_profile,
    get_teacher,
    get_teacher_privacy_profile,
    list_teachers,
    update_teacher,
    upsert_teacher_privacy_profile,
)


router = APIRouter(tags=["teachers"])


@router.post("/teachers", response_model=legacy.TeacherResponse)
async def create_teacher_route(
    teacher: legacy.TeacherCreate,
    current_user: dict = Depends(get_current_user),
):
    return await create_teacher(teacher, current_user)


@router.patch("/teachers/{teacher_id}", response_model=legacy.TeacherResponse)
async def update_teacher_route(
    teacher_id: str,
    payload: legacy.TeacherUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await update_teacher(teacher_id, payload, current_user)


@router.get("/teachers", response_model=List[legacy.TeacherResponse])
async def get_teachers_route(
    request: legacy.Request,
    current_user: dict = Depends(get_current_user),
):
    return await list_teachers(request, current_user)


@router.get("/teachers/{teacher_id}", response_model=legacy.TeacherResponse)
async def get_teacher_route(
    teacher_id: str,
    request: legacy.Request,
    current_user: dict = Depends(get_current_user),
):
    return await get_teacher(teacher_id, request, current_user)


@router.get(
    "/teachers/{teacher_id}/privacy-profile",
    response_model=legacy.TeacherPrivacyProfileResponse,
)
async def get_teacher_privacy_profile_route(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_teacher_privacy_profile(teacher_id, current_user)


@router.post(
    "/teachers/{teacher_id}/privacy-profile",
    response_model=legacy.TeacherPrivacyProfileResponse,
)
async def upsert_teacher_privacy_profile_route(
    teacher_id: str,
    files: List[UploadFile] = File(...),
    replace_existing: bool = Form(False),
    current_user: dict = Depends(get_current_user),
):
    return await upsert_teacher_privacy_profile(teacher_id, files, replace_existing, current_user)


@router.delete(
    "/teachers/{teacher_id}/privacy-profile",
    response_model=legacy.TeacherPrivacyProfileDeleteResponse,
)
async def delete_teacher_privacy_profile_route(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await delete_teacher_privacy_profile(teacher_id, current_user)


@router.delete("/teachers/{teacher_id}")
async def delete_teacher_route(
    teacher_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await delete_teacher(teacher_id, current_user)
