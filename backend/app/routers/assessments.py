from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends

import server as legacy

from app.dependencies import get_current_user
from app.services.assessment_service import (
    create_admin_override,
    get_assessment,
    get_assessment_evidence,
    get_curriculum_adherence,
    list_assessment_feedback,
    list_admin_overrides,
    list_assessments,
    upsert_assessment_feedback,
)


router = APIRouter(tags=["assessments"])


@router.get("/assessments", response_model=List[legacy.AssessmentResult])
async def get_assessments_route(
    request: legacy.Request,
    teacher_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    return await list_assessments(request, teacher_id, current_user)


@router.get("/assessments/{assessment_id}", response_model=legacy.AssessmentResult)
async def get_assessment_route(
    assessment_id: str,
    request: legacy.Request,
    current_user: dict = Depends(get_current_user),
):
    return await get_assessment(assessment_id, request, current_user)


@router.get("/assessments/{assessment_id}/evidence")
async def get_assessment_evidence_route(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_assessment_evidence(assessment_id, current_user)


@router.post("/assessments/{assessment_id}/admin-override")
async def create_admin_override_route(
    assessment_id: str,
    payload: legacy.AdminScoreOverride,
    current_user: dict = Depends(get_current_user),
):
    return await create_admin_override(assessment_id, payload, current_user)


@router.get("/assessments/{assessment_id}/admin-overrides")
async def list_admin_overrides_route(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await list_admin_overrides(assessment_id, current_user)


@router.post(
    "/assessments/{assessment_id}/feedback",
    response_model=legacy.AssessmentFeedbackListResponse,
)
async def upsert_assessment_feedback_route(
    assessment_id: str,
    payload: legacy.AssessmentFeedbackUpsert,
    current_user: dict = Depends(get_current_user),
):
    await upsert_assessment_feedback(assessment_id, payload, current_user)
    return await list_assessment_feedback(assessment_id, current_user)


@router.get(
    "/assessments/{assessment_id}/feedback",
    response_model=legacy.AssessmentFeedbackListResponse,
)
async def list_assessment_feedback_route(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await list_assessment_feedback(assessment_id, current_user)


@router.get("/assessments/{assessment_id}/curriculum-adherence")
async def get_curriculum_adherence_route(
    assessment_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_curriculum_adherence(assessment_id, current_user)
