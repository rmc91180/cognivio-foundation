from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import server as legacy

from app.repositories import assessment_repository
from app.services.localization_service import enrich_assessment_for_response, resolve_request_language
from app.services.report_service import ensure_assessment_evidence, get_curriculum_adherence_payload


def _build_admin_override_doc(
    assessment_id: str,
    payload: legacy.AdminScoreOverride,
    current_user: dict,
) -> dict:
    override_type = (payload.override_type or "score").strip().lower()
    target_type = (payload.target_type or "element").strip().lower()
    target_id = (payload.target_id or payload.domain_id or "").strip() or None
    if override_type not in {"score", "recommendation_usefulness", "evidence_relevance"}:
        raise legacy.HTTPException(status_code=400, detail="Invalid override_type")
    if target_type not in {"element", "recommendation", "evidence_segment"}:
        raise legacy.HTTPException(status_code=400, detail="Invalid target_type")
    if not target_id:
        raise legacy.HTTPException(status_code=400, detail="target_id is required")

    original_value = payload.original_value
    adjusted_value = payload.adjusted_value
    domain_id = payload.domain_id or target_id
    original_score = payload.original_score
    adjusted_score = payload.adjusted_score
    if override_type == "score":
        if original_score is None or adjusted_score is None:
            raise legacy.HTTPException(
                status_code=400,
                detail="Score overrides require original_score and adjusted_score",
            )
        original_value = original_score
        adjusted_value = adjusted_score
        target_type = "element"
    else:
        domain_id = payload.domain_id if target_type == "element" else None
        if adjusted_value in (None, ""):
            raise legacy.HTTPException(
                status_code=400,
                detail="Non-score overrides require adjusted_value",
            )

    return {
        "id": str(legacy.uuid.uuid4()),
        "assessment_id": assessment_id,
        "admin_id": current_user["id"],
        "override_type": override_type,
        "target_type": target_type,
        "target_id": target_id,
        "domain_id": domain_id,
        "original_score": original_score,
        "adjusted_score": adjusted_score,
        "original_value": original_value,
        "adjusted_value": adjusted_value,
        "rationale": payload.rationale,
        "metadata": payload.metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


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
    doc = _build_admin_override_doc(assessment_id, payload, current_user)
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


async def upsert_assessment_feedback(
    assessment_id: str,
    payload: legacy.AssessmentFeedbackUpsert,
    current_user: dict,
):
    assessment = await assessment_repository.find_assessment_for_user(assessment_id, current_user["id"])
    if not assessment:
        raise legacy.HTTPException(status_code=404, detail="Assessment not found")

    target_type = (payload.target_type or "").strip().lower()
    feedback_value = (payload.feedback_value or "").strip().lower()
    if target_type not in {"summary", "recommendation"}:
        raise legacy.HTTPException(status_code=400, detail="Invalid target_type")
    if feedback_value not in {"useful", "not_useful"}:
        raise legacy.HTTPException(status_code=400, detail="Invalid feedback_value")

    target_id = (payload.target_id or "").strip() or None
    if target_type == "summary":
        target_id = target_id or "summary"
    if target_type == "recommendation" and not target_id:
        raise legacy.HTTPException(
            status_code=400,
            detail="target_id is required for recommendation feedback",
        )

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "assessment_id": assessment_id,
        "teacher_id": assessment.get("teacher_id"),
        "video_id": assessment.get("video_id"),
        "user_id": current_user["id"],
        "user_role": legacy._get_user_role(current_user),
        "target_type": target_type,
        "target_id": target_id,
        "feedback_value": feedback_value,
        "rationale": payload.rationale,
        "source_surface": payload.source_surface,
        "metadata": payload.metadata or {},
        "updated_at": now,
    }
    record = await assessment_repository.upsert_assessment_feedback(doc)
    return {"feedback": legacy.AssessmentFeedbackRecord(**record)}


async def list_assessment_feedback(assessment_id: str, current_user: dict):
    assessment = await assessment_repository.find_assessment_for_user(assessment_id, current_user["id"])
    if not assessment:
        raise legacy.HTTPException(status_code=404, detail="Assessment not found")
    docs = await assessment_repository.list_assessment_feedback_for_user(
        assessment_id, current_user["id"]
    )
    return {
        "feedback": [legacy.AssessmentFeedbackRecord(**doc) for doc in docs],
    }


async def get_curriculum_adherence(assessment_id: str, current_user: dict):
    return await get_curriculum_adherence_payload(assessment_id, current_user)
