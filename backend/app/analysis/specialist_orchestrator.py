from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from app.analysis.specialist_contracts import (
    SpecialistContext,
    SpecialistResult,
    get_default_specialist_contracts,
)


SPECIALIST_ORCHESTRATOR_ENABLED = (
    os.getenv("SPECIALIST_ORCHESTRATOR_ENABLED", "true").lower() == "true"
)
SPECIALIST_ORCHESTRATOR_VERSION = (
    os.getenv("SPECIALIST_ORCHESTRATOR_VERSION", "specialist_orchestrator_v1").strip()
    or "specialist_orchestrator_v1"
)


def _is_hebrew(language: str) -> bool:
    return str(language or "").lower().startswith("he")


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _first_active_goal(context: SpecialistContext) -> Optional[str]:
    for item in context.active_goals:
        text = str(item or "").strip()
        if text:
            return text
    return None


def _apply_evidence_grounding(payload: Dict[str, Any], context: SpecialistContext) -> SpecialistResult:
    notes: List[str] = []
    changed = 0
    for score in payload.get("element_scores", []) or []:
        observations = list(score.get("observations") or [])
        evidence_segments = list(score.get("evidence_segments") or [])
        if not evidence_segments:
            continue
        anchor = str(evidence_segments[0].get("summary") or "").strip()
        if not anchor:
            continue
        if not observations:
            score["observations"] = [anchor]
            changed += 1
            continue
        first_observation = str(observations[0] or "").strip()
        if _normalize_text(anchor) not in _normalize_text(first_observation):
            if "evidence was limited" in first_observation.lower() or "הראיות" in first_observation:
                score["observations"][0] = anchor
                changed += 1
            elif len(observations) < 3:
                score["observations"] = [first_observation, anchor][:3]
                changed += 1
    if changed:
        notes.append(f"Grounded {changed} element observations more directly in stored evidence segments.")
    return SpecialistResult(
        specialist_id="evidence_grounding",
        notes=notes,
        payload_delta={"element_score_updates": changed},
    )


def _apply_priority_coach(payload: Dict[str, Any], context: SpecialistContext) -> SpecialistResult:
    notes: List[str] = []
    priority_set = {str(item) for item in context.priority_element_ids or [] if str(item)}
    scores = list(payload.get("element_scores") or [])
    if scores:
        scores.sort(
            key=lambda item: (
                0 if str(item.get("element_id") or "") in priority_set or bool(item.get("priority")) else 1,
                float(item.get("score", 0.0) or 0.0),
            )
        )
        payload["element_scores"] = scores
        notes.append("Re-ranked element scores so configured priorities lead the coaching view.")

    goal = _first_active_goal(context)
    touched = False
    recommendations = list(payload.get("recommendations") or [])
    for item in recommendations:
        linked_id = str(item.get("linked_element_id") or "")
        if linked_id and linked_id in priority_set:
            item["priority_rank"] = 0
        else:
            item["priority_rank"] = 1
    recommendations.sort(
        key=lambda item: (
            int(item.get("priority_rank", 1) or 1),
            float(item.get("start_sec", 0.0) or 0.0),
        )
    )
    payload["recommendations"] = recommendations
    if goal and recommendations:
        first = recommendations[0]
        text = str(first.get("text") or "").strip()
        if goal and _normalize_text(goal) not in _normalize_text(text):
            if _is_hebrew(context.language):
                first["text"] = f"{text} חברו את ההמשך ליעד הפעיל: {goal}."
            else:
                first["text"] = f"{text} Connect the next move to the active goal: {goal}."
            touched = True
    if touched:
        notes.append("Linked the leading recommendation to the active coaching goal.")
    return SpecialistResult(
        specialist_id="priority_coach",
        notes=notes,
        payload_delta={"goal_linked": touched},
    )


def _apply_recommendation_sequence(payload: Dict[str, Any], context: SpecialistContext) -> SpecialistResult:
    notes: List[str] = []
    priority_set = {str(item) for item in context.priority_element_ids or [] if str(item)}
    raw_recommendations = list(payload.get("recommendations") or [])
    deduped: List[dict] = []
    seen_text = set()
    for item in raw_recommendations:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        key = _normalize_text(text)
        if key in seen_text:
            continue
        seen_text.add(key)
        deduped.append(item)
    deduped.sort(
        key=lambda item: (
            0
            if str(item.get("linked_element_id") or "") in priority_set
            or int(item.get("priority_rank", 1) or 1) == 0
            else 1,
            float(item.get("start_sec", 0.0) or 0.0),
        )
    )

    if not deduped:
        for score in list(payload.get("element_scores") or [])[:2]:
            segments = score.get("evidence_segments") or []
            first_segment = segments[0] if segments else {}
            start_sec = float(first_segment.get("start_sec", 0.0) or 0.0)
            end_sec = float(first_segment.get("end_sec", start_sec + 30.0) or start_sec + 30.0)
            name = str(score.get("element_name") or "").strip()
            observation = str((score.get("observations") or [""])[0]).strip()
            if _is_hebrew(context.language):
                text = f"לחזק את {name} על בסיס הראיה שנצפתה: {observation}".strip()
            else:
                text = f"Strengthen {name.lower()} based on the observed evidence: {observation}".strip()
            deduped.append(
                {
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "text": text,
                    "linked_element_id": score.get("element_id"),
                }
            )
        if deduped:
            notes.append("Synthesized bounded fallback recommendations from normalized evidence.")

    payload["recommendations"] = deduped[:3]
    if len(raw_recommendations) != len(payload["recommendations"]):
        notes.append("Deduped and capped the recommendation sequence for coach readability.")
    return SpecialistResult(
        specialist_id="recommendation_sequence",
        notes=notes,
        payload_delta={"recommendation_count": len(payload["recommendations"])},
    )


def orchestrate_specialists(
    payload: Dict[str, Any],
    *,
    language: str = "en",
    priority_element_ids: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    analysis_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not SPECIALIST_ORCHESTRATOR_ENABLED:
        return payload

    result = {
        **payload,
        "recommendations": [dict(item) for item in (payload.get("recommendations") or [])],
        "element_scores": [dict(item) for item in (payload.get("element_scores") or [])],
    }
    context = SpecialistContext(
        language=language,
        priority_element_ids=priority_element_ids or [],
        focus_note=focus_note,
        active_goals=list((analysis_context or {}).get("active_goals") or []),
        signal_guidance=list(
            ((analysis_context or {}).get("signal_summary") or {}).get("guidance") or []
        ),
        analysis_context=analysis_context,
    )
    specialist_trace: List[dict] = []

    specialist_functions = {
        "evidence_grounding": _apply_evidence_grounding,
        "priority_coach": _apply_priority_coach,
        "recommendation_sequence": _apply_recommendation_sequence,
    }
    for contract in sorted(get_default_specialist_contracts(), key=lambda item: item.execution_order):
        apply_fn = specialist_functions.get(contract.specialist_id)
        if not apply_fn:
            continue
        specialist_result = apply_fn(result, context)
        specialist_trace.append(
            {
                "specialist_id": contract.specialist_id,
                "name": contract.name,
                "owned_fields": list(contract.owned_fields),
                "notes": specialist_result.notes,
                "payload_delta": specialist_result.payload_delta,
            }
        )

    result["specialist_trace"] = specialist_trace
    result["specialist_orchestrator"] = {
        "enabled": True,
        "version": SPECIALIST_ORCHESTRATOR_VERSION,
        "specialist_ids": [item["specialist_id"] for item in specialist_trace],
    }
    return result
