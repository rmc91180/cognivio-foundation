from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from app.analysis.specialist_contracts import (
    SpecialistContext,
    SpecialistResult,
    get_conference_prep_specialist_contracts,
    get_default_specialist_contracts,
)


try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional dependency in some test contexts
    OpenAI = None


logger = logging.getLogger(__name__)
SPECIALIST_ORCHESTRATOR_ENABLED = os.getenv("SPECIALIST_ORCHESTRATOR_ENABLED", "true").lower() == "true"
SPECIALIST_ORCHESTRATOR_VERSION = (
    os.getenv("SPECIALIST_ORCHESTRATOR_VERSION", "specialist_orchestrator_v1").strip() or "specialist_orchestrator_v1"
)
TONE_COACH_MODEL = os.getenv("TONE_COACH_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"


TONE_COACH_BANNED_PHRASES = [
    "evidence was limited",
    "in the sampled frames",
    "analysis mode",
    "confidence score",
    "the teacher demonstrated",
    "the teacher used",
    "the teacher showed",
    "the teacher displayed",
    "rubric element",
    "score of",
    "rated at",
    "data suggests",
    "based on the evidence",
    "this segment",
    "sampled moment",
]


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


def _primary_goal_progress(context: SpecialistContext) -> Optional[Dict[str, Any]]:
    items = list(context.goal_progress_signals or [])
    if not items:
        return None
    priority = {
        "repeated_challenge": 3,
        "evidence_gap": 2,
        "one_off_evidence": 1,
        "reinforcing_progress": 0,
    }
    ranked = sorted(
        items,
        key=lambda item: (
            -priority.get(str(item.get("progress_signal") or ""), 0),
            str(item.get("latest_evidence_at") or ""),
        ),
    )
    return ranked[0] if ranked else None


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
            (
                0
                if str(item.get("linked_element_id") or "") in priority_set
                or int(item.get("priority_rank", 1) or 1) == 0
                else 1
            ),
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


def _apply_longitudinal_pattern(payload: Dict[str, Any], context: SpecialistContext) -> SpecialistResult:
    notes: List[str] = []
    primary_goal = _primary_goal_progress(context)
    if not primary_goal:
        return SpecialistResult(
            specialist_id="longitudinal_pattern",
            notes=notes,
            payload_delta={"summary_updated": False, "recommendation_linked": False},
        )

    goal_title = str(primary_goal.get("title") or "").strip()
    signal = str(primary_goal.get("progress_signal") or "").strip()
    if not goal_title or not signal:
        return SpecialistResult(
            specialist_id="longitudinal_pattern",
            notes=notes,
            payload_delta={"summary_updated": False, "recommendation_linked": False},
        )

    summary_updated = False
    recommendation_linked = False
    summary = str(payload.get("summary") or "").strip()
    summary_prefix = ""
    recommendation_suffix = ""
    if signal == "repeated_challenge":
        if _is_hebrew(context.language):
            summary_prefix = f"לאורך שיעורים אחרונים, {goal_title} מופיע כאתגר חוזר. "
            recommendation_suffix = f" שמרו את ההמשך ממוקד ביעד החוזר: {goal_title}."
        else:
            summary_prefix = f"Across recent lessons, {goal_title} is showing up as a recurring challenge. "
            recommendation_suffix = f" Keep the next move tightly focused on the recurring goal: {goal_title}."
    elif signal == "reinforcing_progress":
        if _is_hebrew(context.language):
            summary_prefix = f"לאורך שיעורים אחרונים, יש סימני התקדמות עקביים סביב {goal_title}. "
            recommendation_suffix = f" שמרו את ההמשך צמוד למה שכבר מתחיל לעבוד סביב {goal_title}."
        else:
            summary_prefix = f"Across recent lessons, there are consistent signs of improvement around {goal_title}. "
            recommendation_suffix = f" Keep the next move anchored to what is starting to work around {goal_title}."
    elif signal == "evidence_gap":
        if _is_hebrew(context.language):
            summary_prefix = f"לאורך שיעורים אחרונים, {goal_title} עדיין פעיל אבל בסיס הראיות עדיין דל. "
            recommendation_suffix = f" בקשו ראיה חדשה שתאשר או תעדכן את הכיוון סביב {goal_title}."
        else:
            summary_prefix = (
                f"Across recent lessons, {goal_title} is still active but the recent evidence base is still thin. "
            )
            recommendation_suffix = f" Ask for fresh evidence before changing direction on {goal_title}."
    elif signal == "one_off_evidence":
        if _is_hebrew(context.language):
            summary_prefix = f"לאורך שיעורים אחרונים, יש רק ראיה ראשונית סביב {goal_title}. "
            recommendation_suffix = f" השתמשו בשיעור הבא כדי לבדוק אם {goal_title} אכן מתבסס כדפוס."
        else:
            summary_prefix = f"Across recent lessons, there is only early evidence around {goal_title}. "
            recommendation_suffix = f" Use the next lesson to confirm whether {goal_title} is becoming a real pattern."

    if summary_prefix and _normalize_text(goal_title) not in _normalize_text(summary):
        payload["summary"] = f"{summary_prefix}{summary}".strip()
        summary_updated = True

    recommendations = list(payload.get("recommendations") or [])
    if recommendations and recommendation_suffix:
        first = recommendations[0]
        text = str(first.get("text") or "").strip()
        if _normalize_text(goal_title) not in _normalize_text(text):
            first["text"] = f"{text}{recommendation_suffix}".strip()
            recommendation_linked = True
    if summary_updated:
        notes.append("Added one bounded longitudinal framing move from evidence-backed goal progress.")
    if recommendation_linked:
        notes.append("Linked the leading recommendation to the current longitudinal coaching pattern.")
    return SpecialistResult(
        specialist_id="longitudinal_pattern",
        notes=notes,
        payload_delta={
            "summary_updated": summary_updated,
            "recommendation_linked": recommendation_linked,
            "goal_signal": signal,
        },
    )


def _tone_text_has_banned_phrase(value: Any) -> bool:
    text = str(value or "").lower()
    return any(phrase in text for phrase in TONE_COACH_BANNED_PHRASES)


def _tone_observation_has_direct_address(value: Any, context: SpecialistContext) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return True
    if _is_hebrew(context.language):
        hebrew_direct_markers = [
            "את ",
            "אתה",
            "אתם",
            "שלך",
            "שלכם",
            "ראית",
            "עשית",
            "הובלת",
            "נתת",
            "בחרת",
            "שאלת",
        ]
        return any(marker in text for marker in hebrew_direct_markers)
    return bool(re.search(r"\b(you|your)\b", text))


def _tone_field_should_rewrite(value: Any, context: SpecialistContext, *, observation: bool = False) -> bool:
    if not str(value or "").strip():
        return False
    if _tone_text_has_banned_phrase(value):
        return True
    if observation and not _tone_observation_has_direct_address(value, context):
        return True
    return False


def _collect_tone_flagged_fields(payload: Dict[str, Any], context: SpecialistContext) -> Dict[str, Any]:
    flagged: Dict[str, Any] = {}
    if _tone_field_should_rewrite(payload.get("summary"), context):
        flagged["summary"] = payload.get("summary")

    flagged_recommendations: List[dict] = []
    for rec_index, recommendation in enumerate(payload.get("recommendations") or []):
        text = recommendation.get("text") if isinstance(recommendation, dict) else None
        if _tone_field_should_rewrite(text, context):
            flagged_recommendations.append(
                {
                    "index": rec_index,
                    "linked_element_id": recommendation.get("linked_element_id"),
                    "start_sec": recommendation.get("start_sec"),
                    "end_sec": recommendation.get("end_sec"),
                    "text": text,
                }
            )
    if flagged_recommendations:
        flagged["recommendations"] = flagged_recommendations

    flagged_scores: List[dict] = []
    for score_index, score in enumerate(payload.get("element_scores") or []):
        if not isinstance(score, dict):
            continue
        flagged_score: Dict[str, Any] = {
            "index": score_index,
            "element_id": score.get("element_id"),
        }
        observations = []
        for observation_index, observation_text in enumerate(score.get("observations") or []):
            if _tone_field_should_rewrite(observation_text, context, observation=True):
                observations.append({"index": observation_index, "text": observation_text})
        if observations:
            flagged_score["observations"] = observations

        evidence_segments = []
        for segment_index, segment in enumerate(score.get("evidence_segments") or []):
            if not isinstance(segment, dict):
                continue
            flagged_segment: Dict[str, Any] = {
                "index": segment_index,
                "start_sec": segment.get("start_sec"),
                "end_sec": segment.get("end_sec"),
            }
            if _tone_field_should_rewrite(segment.get("summary"), context):
                flagged_segment["summary"] = segment.get("summary")
            if _tone_field_should_rewrite(segment.get("rationale"), context):
                flagged_segment["rationale"] = segment.get("rationale")
            if "summary" in flagged_segment or "rationale" in flagged_segment:
                evidence_segments.append(flagged_segment)
        if evidence_segments:
            flagged_score["evidence_segments"] = evidence_segments

        if "observations" in flagged_score or "evidence_segments" in flagged_score:
            flagged_scores.append(flagged_score)
    if flagged_scores:
        flagged["element_scores"] = flagged_scores
    return flagged


def _merge_tone_rewrites(payload: Dict[str, Any], rewritten: Dict[str, Any]) -> int:
    changed = 0
    if isinstance(rewritten.get("summary"), str):
        payload["summary"] = rewritten["summary"]
        changed += 1

    recommendations = payload.get("recommendations") or []
    for item in rewritten.get("recommendations") or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except Exception:
            continue
        text = str(item.get("text") or "").strip()
        if 0 <= index < len(recommendations) and text:
            recommendations[index]["text"] = text
            changed += 1

    element_scores = payload.get("element_scores") or []
    for score_item in rewritten.get("element_scores") or []:
        if not isinstance(score_item, dict):
            continue
        try:
            score_index = int(score_item.get("index"))
        except Exception:
            continue
        if not 0 <= score_index < len(element_scores):
            continue
        score = element_scores[score_index]

        observations = score.get("observations") or []
        for observation_item in score_item.get("observations") or []:
            if not isinstance(observation_item, dict):
                continue
            try:
                observation_index = int(observation_item.get("index"))
            except Exception:
                continue
            text = str(observation_item.get("text") or "").strip()
            if 0 <= observation_index < len(observations) and text:
                observations[observation_index] = text
                changed += 1
        score["observations"] = observations

        evidence_segments = score.get("evidence_segments") or []
        for segment_item in score_item.get("evidence_segments") or []:
            if not isinstance(segment_item, dict):
                continue
            try:
                segment_index = int(segment_item.get("index"))
            except Exception:
                continue
            if not 0 <= segment_index < len(evidence_segments):
                continue
            segment = evidence_segments[segment_index]
            summary = str(segment_item.get("summary") or "").strip()
            rationale = str(segment_item.get("rationale") or "").strip()
            if summary:
                segment["summary"] = summary
                changed += 1
            if rationale:
                segment["rationale"] = rationale
                changed += 1
        score["evidence_segments"] = evidence_segments
    return changed


def _apply_tone_coach(payload: Dict[str, Any], context: SpecialistContext) -> SpecialistResult:
    flagged = _collect_tone_flagged_fields(payload, context)
    flagged_count = (
        (1 if "summary" in flagged else 0)
        + len(flagged.get("recommendations") or [])
        + sum(
            len(item.get("observations") or []) + len(item.get("evidence_segments") or [])
            for item in (flagged.get("element_scores") or [])
        )
    )
    if not flagged:
        return SpecialistResult(
            specialist_id="tone_coach",
            notes=[],
            payload_delta={"flagged_fields": 0, "rewritten_fields": 0},
        )

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key or OpenAI is None:
        logger.warning("Tone Coach Specialist skipped rewrite because OpenAI is not configured.")
        return SpecialistResult(
            specialist_id="tone_coach",
            notes=["Flagged coach-voice issues, but rewrite was skipped because OpenAI is not configured."],
            payload_delta={"flagged_fields": flagged_count, "rewritten_fields": 0},
        )

    system_prompt = (
        "You are editing AI-generated teacher feedback to ensure it sounds like a "
        "trusted coaching colleague, not a system report. Address the teacher as "
        "you/your. Remove all system language (evidence, sampled frames, score of, "
        "rubric element, the teacher X). Keep all timestamps and element IDs unchanged. "
        "Keep the same meaning — only improve the voice. Return the same JSON structure."
    )
    try:
        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=TONE_COACH_MODEL,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(flagged, ensure_ascii=False)},
            ],
            max_output_tokens=1800,
        )
        response_text = getattr(response, "output_text", None) or ""
        rewritten = json.loads(response_text)
        if not isinstance(rewritten, dict):
            raise ValueError("Tone rewrite response was not a JSON object")
        rewritten_count = _merge_tone_rewrites(payload, rewritten)
    except Exception as exc:
        logger.warning("Tone Coach Specialist rewrite failed; preserving original payload: %s", exc)
        return SpecialistResult(
            specialist_id="tone_coach",
            notes=["Flagged coach-voice issues, but rewrite failed and the original payload was preserved."],
            payload_delta={"flagged_fields": flagged_count, "rewritten_fields": 0},
        )

    return SpecialistResult(
        specialist_id="tone_coach",
        notes=[f"Rewrote {rewritten_count} text field(s) to preserve coach voice."] if rewritten_count else [],
        payload_delta={"flagged_fields": flagged_count, "rewritten_fields": rewritten_count},
    )


def _apply_conference_prep_synthesis(
    payload: Dict[str, Any],
    *,
    language: str = "en",
    adaptive_support: Optional[Dict[str, Any]] = None,
) -> SpecialistResult:
    notes: List[str] = []
    agenda = [str(item or "").strip() for item in (payload.get("agenda") or []) if str(item or "").strip()]
    continuity_lines = [
        str(item or "").strip() for item in (payload.get("continuity_lines") or []) if str(item or "").strip()
    ]
    adaptive = adaptive_support or {}
    primary_goal = adaptive.get("primary_goal") or {}
    goal_title = str(primary_goal.get("title") or "").strip()
    goal_signal = str(primary_goal.get("progress_signal") or "").strip()
    admin_prompt = str(adaptive.get("admin_prompt_body") or "").strip()

    def _dedupe(values: List[str]) -> List[str]:
        out: List[str] = []
        seen = set()
        for value in values:
            key = _normalize_text(value)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(value)
        return out

    if goal_title and goal_signal == "repeated_challenge":
        lead = (
            f"Keep the conference centered on the recurring challenge: {goal_title}."
            if not _is_hebrew(language)
            else f"שמרו את השיחה ממוקדת באתגר החוזר: {goal_title}."
        )
        agenda = [lead, *agenda]
    elif goal_title and goal_signal == "reinforcing_progress":
        lead = (
            f"Reinforce the progress now showing up around: {goal_title}."
            if not _is_hebrew(language)
            else f"חזקו את ההתקדמות שמתחילה להופיע סביב: {goal_title}."
        )
        agenda = [lead, *agenda]

    if admin_prompt:
        agenda.append(admin_prompt)
    continuity_lines = [*(adaptive.get("conference_continuity_lines") or []), *continuity_lines]
    agenda = _dedupe(agenda)[:6]
    continuity_lines = _dedupe(continuity_lines)[:5]
    payload["agenda"] = agenda
    payload["continuity_lines"] = continuity_lines
    if goal_title:
        notes.append("Re-centered conference prep on the clearest ongoing coaching thread.")
    if admin_prompt:
        notes.append("Folded adaptive admin guidance into the conference prep agenda.")
    return SpecialistResult(
        specialist_id="conference_prep_synthesis",
        notes=notes,
        payload_delta={
            "agenda_count": len(agenda),
            "continuity_count": len(continuity_lines),
            "goal_signal": goal_signal or None,
        },
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
        goal_progress_signals=list((analysis_context or {}).get("goal_progress_signals") or []),
        reflection_takeaways=[
            str(item).strip()
            for item in [
                ((analysis_context or {}).get("reflection_summary") or {}).get("self_reflection"),
                ((analysis_context or {}).get("reflection_summary") or {}).get("actions_taken"),
            ]
            if str(item or "").strip()
        ],
        conference_continuity_lines=list(((analysis_context or {}).get("conference_continuity_lines") or [])),
        signal_guidance=list(((analysis_context or {}).get("signal_summary") or {}).get("guidance") or []),
        analysis_context=analysis_context,
    )
    specialist_trace: List[dict] = []

    specialist_functions = {
        "evidence_grounding": _apply_evidence_grounding,
        "priority_coach": _apply_priority_coach,
        "longitudinal_pattern": _apply_longitudinal_pattern,
        "recommendation_sequence": _apply_recommendation_sequence,
        "tone_coach": _apply_tone_coach,
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


def orchestrate_conference_prep(
    payload: Dict[str, Any],
    *,
    language: str = "en",
    adaptive_support: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    result = {
        **payload,
        "agenda": [str(item) for item in (payload.get("agenda") or [])],
        "continuity_lines": [str(item) for item in (payload.get("continuity_lines") or [])],
    }
    specialist_trace: List[dict] = []
    for contract in get_conference_prep_specialist_contracts():
        specialist_result = _apply_conference_prep_synthesis(
            result,
            language=language,
            adaptive_support=adaptive_support,
        )
        specialist_trace.append(
            {
                "specialist_id": contract.specialist_id,
                "name": contract.name,
                "owned_fields": list(contract.owned_fields),
                "notes": specialist_result.notes,
                "payload_delta": specialist_result.payload_delta,
            }
        )
    result["conference_specialist_trace"] = specialist_trace
    result["conference_specialist_orchestrator"] = {
        "enabled": True,
        "version": "conference_prep_specialists_v1",
        "specialist_ids": [item["specialist_id"] for item in specialist_trace],
    }
    return result
