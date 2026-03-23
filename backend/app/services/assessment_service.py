from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import server as legacy

from app.repositories import assessment_repository
from app.services.localization_service import enrich_assessment_for_response, resolve_request_language
from app.services.report_service import ensure_assessment_evidence, get_curriculum_adherence_payload


async def list_assessments(
    request: legacy.Request,
    teacher_id: Optional[str],
    current_user: dict,
) -> List[legacy.AssessmentResult]:
    assessments = await assessment_repository.list_assessments_for_user(current_user["id"], teacher_id)
    response_language = resolve_request_language(request, default="en")
    return [
        legacy.AssessmentResult(
            **enrich_assessment_for_response(a, response_language=response_language)
        )
        for a in assessments
    ]


async def get_assessment(
    assessment_id: str,
    request: legacy.Request,
    current_user: dict,
) -> legacy.AssessmentResult:
    assessment = await assessment_repository.find_assessment_for_user(assessment_id, current_user["id"])
    if not assessment:
        raise legacy.HTTPException(status_code=404, detail="Assessment not found")
    response_language = resolve_request_language(request, default="en")
    return legacy.AssessmentResult(
        **enrich_assessment_for_response(assessment, response_language=response_language)
    )


async def get_assessment_evidence(assessment_id: str, current_user: dict):
    assessment = await assessment_repository.find_assessment_for_user(assessment_id, current_user["id"])
    if not assessment:
        raise legacy.HTTPException(status_code=404, detail="Assessment not found")
    evidence = await ensure_assessment_evidence(assessment, current_user)
    return {"evidence": evidence}


async def create_admin_override(
    assessment_id: str,
    payload: legacy.AdminScoreOverride,
    current_user: dict,
):
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    doc = {
        "id": str(legacy.uuid.uuid4()),
        "assessment_id": assessment_id,
        "admin_id": current_user["id"],
        "domain_id": payload.domain_id,
        "original_score": payload.original_score,
        "adjusted_score": payload.adjusted_score,
        "rationale": payload.rationale,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await assessment_repository.insert_admin_override(doc)
    return legacy._to_json_safe({"override": doc})


async def list_admin_overrides(assessment_id: str, current_user: dict):
    role = legacy._get_user_role(current_user)
    if role != "admin":
        raise legacy.HTTPException(status_code=403, detail="Admin access required")
    docs = await assessment_repository.list_admin_overrides_for_assessment(
        assessment_id, current_user["id"]
    )
    return {"overrides": docs}


async def get_curriculum_adherence(assessment_id: str, current_user: dict):
    return await get_curriculum_adherence_payload(assessment_id, current_user)
