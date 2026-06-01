"""Gemini grounded moment derivation (WS1 Phase 2).

For the Gemini provider, the lesson-moment manifest is derived from the model's
OWN grounded evidence (analysis-first ordering) instead of the OpenCV
score_windows path. The derived manifest is fed to the EXISTING, UNCHANGED
quality gate (`app/services/lesson_moment_quality.compute_moment_quality` /
`compute_assessment_quality`) so `teacher_feedback_allowed` can flip true
HONESTLY — on real signals, with no threshold changes and no relabeling tricks.

WHY THIS IS HONEST, NOT A RUBBER STAMP
--------------------------------------
Each derived moment's ``supporting_features`` are computed from TWO real Gemini
signals only:

  1. ``element_confidence`` — the model's own confidence in that element score
     (0-100), normalized to ``conf01`` in [0, 1].
  2. ``specificity`` — ``lesson_moment_quality.specificity_score`` of the
     evidence segment's summary (the SAME function the gate trusts; it scores
     concrete, lesson-specific language and penalizes generic fallback phrases).

The features are blends of those two — never hardcoded to 1.0. Consequences:

  * A confident (e.g. 82) + specific evidence segment yields features well above
    the gate's near-zero (0.05) threshold and a per-moment confidence >= 0.35 —
    it passes honestly.
  * A low-confidence (e.g. 20) + generic ("good lesson") segment yields small
    features and a per-moment confidence well below 0.35 — it FAILS honestly
    (the gate excludes it from ``usable_moment_count``). The HONEST-FAIL test
    (test_gemini_moments_phase2.py) proves this: if the mapping ever became a
    rubber stamp, that test would fail.
  * A blank/empty segment yields all-near-zero features; it fails
    ``contracts.validate_moment`` and is DROPPED (never shipped).

``selection_reason = "gemini_grounded"`` is truthful (model-grounded) and is
deliberately NOT in ``LOW_SIGNAL_SELECTION_REASONS``. But the label alone never
passes the gate: ``compute_moment_quality`` still derives confidence from the
features, so a real-but-weak gemini moment is still rejected on confidence.

PURITY / WS3-SAFETY
-------------------
No I/O, no network, no DB, no module-global MUTABLE state. The gate helpers are
imported from the pure ``lesson_moment_quality`` module (reuse, not reinvent);
``compute_quality_fn`` / ``normalize_fn`` / ``dedupe_fn`` are injectable for
tests but default to the real functions. All inputs are passed explicitly and
all outputs returned explicitly.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from app.analysis.contracts import validate_moment
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS,
    AnalysisContractError,
)
from app.services.lesson_moment_quality import (
    compute_moment_quality,
    dedupe_lesson_moments,
    normalize_lesson_moment_window,
    specificity_score,
)

logger = logging.getLogger(__name__)

GEMINI_MOMENT_STRATEGY_VERSION = "gemini_grounded_v1"
GEMINI_MOMENT_SELECTION_REASON = "gemini_grounded"
DEFAULT_MAX_MOMENTS = 6


def _to_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _confidence_to_unit(element_confidence: Any) -> float:
    """Normalize a 0-100 model confidence to [0, 1]. Tolerates 0-1 already."""

    value = _to_float(element_confidence)
    if value is None:
        return 0.0
    if value > 1.0:
        value = value / 100.0
    return max(0.0, min(1.0, value))


def _derive_supporting_features(element_confidence: Any, segment_summary: Any) -> Dict[str, float]:
    """HONEST feature mapping from (model confidence, evidence specificity).

    Every feature is a blend of ``conf01`` and ``spec`` — never a constant. A
    confident + specific segment exceeds the gate's near-zero threshold; a
    vague / low-confidence one does not.

    Rationale per feature (keys read by ``compute_moment_quality``):
      * evidence_density_score    = conf01
            The model's own confidence that this evidence exists.
      * board_text_density_score  = spec
            Specific, concrete language is a proxy for on-task visible content.
      * participant_density_score = conf01 * (0.5 + 0.5*spec)
            Confidence, scaled down when the evidence is vague.
      * teacher_prominence_score  = 0.4*conf01 + 0.6*spec
            Specific descriptions of teacher action dominate.
      * raw_selection_score       = 0.6*conf01 + 0.4*spec
      * average_selection_score   = 0.5*conf01 + 0.5*spec
            Overall selection strength blends both signals.
    """

    conf01 = _confidence_to_unit(element_confidence)
    spec = float(specificity_score(segment_summary))

    return {
        "raw_selection_score": round(0.6 * conf01 + 0.4 * spec, 4),
        "average_selection_score": round(0.5 * conf01 + 0.5 * spec, 4),
        "participant_density_score": round(conf01 * (0.5 + 0.5 * spec), 4),
        "board_text_density_score": round(spec, 4),
        "teacher_prominence_score": round(0.4 * conf01 + 0.6 * spec, 4),
        "evidence_density_score": round(conf01, 4),
    }


def derive_moments_from_payload(
    payload: Mapping[str, Any],
    *,
    duration_sec: Optional[float] = None,
    available_frames: Optional[Sequence[Mapping[str, Any]]] = None,
    elements_to_analyze: Optional[Sequence[Mapping[str, Any]]] = None,
    max_moments: int = DEFAULT_MAX_MOMENTS,
    normalize_fn: Callable[..., Dict[str, Any]] = normalize_lesson_moment_window,
    dedupe_fn: Callable[..., Any] = dedupe_lesson_moments,
) -> List[Dict[str, Any]]:
    """Derive normalized lesson-moment dicts from a Gemini analysis payload.

    Iterates ``payload['element_scores'][].evidence_segments[]`` and builds one
    moment per segment with honestly-derived ``supporting_features``. Windows
    are normalized (and deduped) with the SAME helpers the OpenCV path uses.
    The returned moments carry NO ``quality`` block yet (added by
    :func:`build_gemini_moment_manifest`).
    """

    element_scores = payload.get("element_scores") if isinstance(payload, Mapping) else None
    if not isinstance(element_scores, list):
        return []

    priority_by_id: Dict[str, bool] = {}
    for element in elements_to_analyze or []:
        if isinstance(element, Mapping) and element.get("id") is not None:
            priority_by_id[str(element["id"])] = bool(element.get("priority"))

    raw_moments: List[Dict[str, Any]] = []
    counter = 0
    for score in element_scores:
        if not isinstance(score, Mapping):
            continue
        element_id = str(score.get("element_id") or "").strip()
        confidence = score.get("confidence")
        segments = score.get("evidence_segments")
        if not isinstance(segments, list):
            continue
        for segment in segments:
            if not isinstance(segment, Mapping):
                continue
            start = _to_float(segment.get("start_sec"))
            end = _to_float(segment.get("end_sec"))
            if start is None or end is None:
                continue
            summary = str(segment.get("summary") or "").strip()
            counter += 1
            # The model analyzed the CONTINUOUS native video (no frame-sampling
            # gaps), so a timestamp inside the model's own cited evidence window
            # is genuinely grounded. We set representative_frame_sec to the window
            # midpoint; normalize_lesson_moment_window then keeps it valid. This
            # is honest (the model evidenced this window) and does NOT rescue weak
            # evidence — compute_moment_quality still rejects low-confidence
            # moments on the confidence threshold regardless of this field.
            representative = (start + end) / 2.0 if end > start else start
            moment = {
                "moment_id": f"gemini-{element_id or 'el'}-{counter}",
                "start_sec": start,
                "end_sec": end,
                "representative_frame_sec": representative,
                "selection_reason": GEMINI_MOMENT_SELECTION_REASON,
                "linked_element_id": element_id or None,
                "text": summary,
                "summary": summary,
                "rationale": str(segment.get("rationale") or "").strip(),
                "priority": priority_by_id.get(element_id, False),
                "supporting_features": _derive_supporting_features(confidence, summary),
            }
            raw_moments.append(moment)

    normalized: List[Dict[str, Any]] = []
    for moment in raw_moments:
        window = normalize_fn(
            moment,
            duration_sec=duration_sec,
            available_frames=available_frames,
        )
        # normalize_fn returns a fresh dict that preserves our extra keys
        # (supporting_features, selection_reason, text, ...) and adds the
        # window-validity + representative-frame fields the gate reads.
        normalized.append(window)

    kept, _dropped = dedupe_fn(normalized)
    if max_moments and len(kept) > max_moments:
        kept = kept[: int(max_moments)]
    return kept


def build_gemini_moment_manifest(
    video_id: str,
    payload: Mapping[str, Any],
    *,
    duration_sec: Optional[float] = None,
    available_frames: Optional[Sequence[Mapping[str, Any]]] = None,
    elements_to_analyze: Optional[Sequence[Mapping[str, Any]]] = None,
    max_moments: int = DEFAULT_MAX_MOMENTS,
    normalize_fn: Callable[..., Dict[str, Any]] = normalize_lesson_moment_window,
    dedupe_fn: Callable[..., Any] = dedupe_lesson_moments,
    compute_quality_fn: Callable[..., Dict[str, Any]] = compute_moment_quality,
    has_transcript_globally: Optional[bool] = None,
    transcript_lookup: Optional[Callable[[Mapping[str, Any]], Sequence[Mapping[str, Any]]]] = None,
    audio_features: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a manifest with the SAME shape as ``build_moment_manifest``.

    Each kept moment carries ``moment["quality"] = compute_quality_fn(...)`` —
    the UNCHANGED gate. Moments that fail ``contracts.validate_moment`` are
    dropped and logged (a derivation bug must be visible, not silently shipped).

    Raises ``AnalysisContractError`` (mode ``fallback_gemini_no_moments``) when
    no usable moment survives — the caller falls through to OpenAI exactly like
    the Phase 1 engine-failure path. This guarantees OpenCV moments are NEVER
    attached to a Gemini-labeled assessment.
    """

    derived = derive_moments_from_payload(
        payload,
        duration_sec=duration_sec,
        available_frames=available_frames,
        elements_to_analyze=elements_to_analyze,
        max_moments=max_moments,
        normalize_fn=normalize_fn,
        dedupe_fn=dedupe_fn,
    )

    kept: List[Dict[str, Any]] = []
    dropped_invalid: List[Dict[str, Any]] = []
    for moment in derived:
        result = validate_moment(moment)
        if not result.ok:
            logger.warning(
                "Dropping invalid gemini-derived moment %s for video %s: %s",
                moment.get("moment_id"),
                video_id,
                result.errors,
            )
            dropped_invalid.append({**moment, "drop_reasons": result.errors})
            continue
        transcript_segments = transcript_lookup(moment) if transcript_lookup else None
        moment["quality"] = compute_quality_fn(
            moment,
            transcript_segments=transcript_segments,
            audio_features=audio_features,
            has_transcript_globally=has_transcript_globally,
        )
        kept.append(moment)

    if not kept:
        raise AnalysisContractError(
            f"Gemini analysis yielded no usable grounded moments for video {video_id}.",
            analysis_mode=ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS,
        )

    return {
        "id": f"moments_{video_id}_{GEMINI_MOMENT_STRATEGY_VERSION}",
        "video_id": video_id,
        "strategy_version": GEMINI_MOMENT_STRATEGY_VERSION,
        "window_sec": None,
        "max_moments": int(max_moments),
        "candidate_target": len(kept),
        "candidate_pool_size": len(derived),
        "duration_sec": duration_sec,
        "moments": kept,
        "deduped_moments": dropped_invalid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = [
    "GEMINI_MOMENT_STRATEGY_VERSION",
    "GEMINI_MOMENT_SELECTION_REASON",
    "DEFAULT_MAX_MOMENTS",
    "derive_moments_from_payload",
    "build_gemini_moment_manifest",
    "_derive_supporting_features",
]
