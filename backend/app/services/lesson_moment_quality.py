"""Lesson moment evidence-quality helpers (PR C3).

This module centralizes the upstream evidence-quality rules that PR C3
introduces. PR C1 hardened the source chain and PR C2 hardened the teacher
read path. C3's job is to make sure the evidence those gates protect is
actually usable: timestamps must be valid, representative frames must fall
inside their window, duplicate windows must be pruned, low-signal timeline
coverage must be flagged as fallback, and the assessment must know whether
it has enough evidence to be teacher-visible at all.

Everything here is a pure helper. No database I/O, no LLM calls. The module
is consumed by:

  * ``backend/server.py`` :: ``build_moment_manifest`` — to normalize +
    dedupe moments and attach per-moment ``quality`` blocks before they
    reach ``video_analysis_moments``.
  * ``backend/server.py`` :: analysis pipeline — to attach an
    ``analysis_quality`` block to every assessment, including the
    ``teacher_feedback_allowed`` boolean.
  * ``backend/app/services/teacher_artifact_quarantine.py`` — to pick up the
    new boolean as one more reason a projection can be rejected.
  * ``backend/scripts/audit_lesson_evidence_quality.py`` — the read-only
    audit script that surfaces evidence-quality problems.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


LESSON_MOMENT_QUALITY_VERSION = "lesson_moment_quality_v1"
ASSESSMENT_QUALITY_VERSION = "assessment_quality_v1"

# Long videos need a richer candidate pool than the legacy 6-window cap.
LONG_VIDEO_THRESHOLD_SEC = 600  # 10 minutes
SUGGESTED_CANDIDATE_INTERVAL_SEC_DEFAULT = 30.0
SUGGESTED_CANDIDATE_INTERVAL_SEC_LONG = 45.0

# A moment is only "usable" for teacher-facing evidence once it clears these
# thresholds. They are intentionally low so the upstream pipeline can grow into
# them; the gates push back fake/generic data, not real lessons.
TEACHER_VISIBLE_MIN_CONFIDENCE = 0.35
TEACHER_VISIBLE_MIN_SPECIFICITY = 0.4
EVIDENCE_SUFFICIENT_MIN_MOMENT_COUNT = 2

# Two windows are treated as duplicates when their start times are within
# this many seconds AND their durations are equivalent within the tolerance.
DUPLICATE_WINDOW_START_TOLERANCE_SEC = 0.5
DUPLICATE_REPRESENTATIVE_FRAME_TOLERANCE_SEC = 0.5
HIGH_OVERLAP_RATIO = 0.85

# Numeric tolerance for "end_sec must not exceed duration" — accounts for
# rounding in the OpenCV duration estimate.
DURATION_OVERRUN_TOLERANCE_SEC = 1.5

# Generic / fallback phrases that must never count as real moment evidence.
# Kept independent of the teacher-facing quarantine list so we can grow this
# vocabulary without leaking admin-only labels into teacher payloads.
GENERIC_FALLBACK_PHRASES: Tuple[str, ...] = (
    "the clip gave us a brief window into your lesson",
    "the clip gave us a brief window into this lesson",
    "brief window into your lesson",
    "brief window into this lesson",
    "here is what stood out",
    "evidence was limited",
    "limited visible evidence",
    "visible evidence was limited",
    "evidence was limited in the sampled frames",
    "plan a targeted coaching cycle",
    "based on the observed moment",
    "the clip we had was brief",
)

# Selection reasons that we treat as low-signal placeholders unless the
# scored features prove otherwise.
LOW_SIGNAL_SELECTION_REASONS: Tuple[str, ...] = (
    "timeline_coverage",
    "scene_transition",
)


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------


def detect_fallback_text(text: Any) -> bool:
    """Return True iff ``text`` looks like one of the generic fallback phrases."""

    if not text:
        return False
    lowered = str(text).lower()
    return any(phrase in lowered for phrase in GENERIC_FALLBACK_PHRASES)


_TOKEN_RE = re.compile(r"[A-Za-z֐-׿']+")


def specificity_score(text: Any) -> float:
    """Cheap heuristic specificity score in [0, 1].

    Specific text mentions a concrete moment / time / classroom action / topic.
    The score rewards length and lesson-specific keywords; it strongly
    penalizes the known fallback phrases.
    """

    if not text:
        return 0.0
    cleaned = str(text).strip()
    if not cleaned:
        return 0.0
    if detect_fallback_text(cleaned):
        return 0.05

    tokens = _TOKEN_RE.findall(cleaned)
    if not tokens:
        return 0.0

    length_signal = min(1.0, len(tokens) / 18.0)
    lowered = cleaned.lower()

    specific_markers = (
        "student", "students", "question", "answer", "partner",
        "board", "wrote", "asked", "responded", "explained", "showed",
        "discussion", "shared", "thought", "noticed", "checked",
        "demonstration", "modeled", "example", "minute", "second", "around",
        "תלמיד", "תלמידים", "שאלה", "תשובה", "לוח", "הסביר", "הראית",
    )
    keyword_hits = sum(1 for marker in specific_markers if marker in lowered)
    keyword_signal = min(1.0, keyword_hits / 3.0)

    return round(min(1.0, 0.55 * length_signal + 0.45 * keyword_signal), 4)


# ---------------------------------------------------------------------------
# Timestamp validation + representative-frame correction
# ---------------------------------------------------------------------------


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_lesson_moment_window(
    moment: Mapping[str, Any],
    *,
    duration_sec: Optional[float] = None,
    available_frames: Optional[Sequence[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    """Return a normalized moment dict with valid timestamps.

    The function never mutates the input. It returns a new dict with:

      * ``start_sec`` / ``end_sec`` clamped to non-negative and within
        ``duration_sec`` (when supplied)
      * ``representative_frame_sec`` clamped or replaced so it always falls
        within ``[start_sec, end_sec]``
      * ``representative_frame_valid: bool`` — True only when the moment had
        a real frame inside the window
      * ``representative_frame_source`` — one of
        ``"real_frame"`` (frame inside window), ``"clamped"`` (closest
        available frame, but outside the window — clamped to the boundary),
        ``"synthetic_midpoint"`` (no frame found at all)
      * ``window_valid: bool`` — False if start/end could not be repaired
      * ``window_invalid_reason`` — populated only when ``window_valid`` is
        False
    """

    moment = dict(moment or {})

    start_sec = _to_float(moment.get("start_sec"))
    end_sec = _to_float(moment.get("end_sec"))
    representative = _to_float(moment.get("representative_frame_sec"))

    window_valid = True
    window_invalid_reason: Optional[str] = None

    if start_sec is None:
        start_sec = 0.0
    if start_sec < 0:
        start_sec = 0.0

    if end_sec is None:
        # Best effort: synthesize a 1-second window starting at start_sec.
        end_sec = start_sec + 1.0
        window_invalid_reason = "missing_end_sec"
        window_valid = False

    if end_sec <= start_sec:
        # Try to repair: bump end_sec just past start_sec; mark as invalid.
        end_sec = start_sec + 1.0
        window_invalid_reason = window_invalid_reason or "end_sec_before_start_sec"
        window_valid = False

    if duration_sec is not None and duration_sec > 0:
        if start_sec >= duration_sec:
            window_invalid_reason = "start_sec_beyond_duration"
            window_valid = False
            start_sec = max(0.0, duration_sec - 1.0)
            end_sec = duration_sec
        if end_sec > duration_sec + DURATION_OVERRUN_TOLERANCE_SEC:
            window_invalid_reason = window_invalid_reason or "end_sec_beyond_duration"
            window_valid = False
            end_sec = duration_sec

    # Representative frame correction.
    representative_frame_valid = True
    representative_frame_source = "real_frame"

    in_window_frames: List[float] = []
    if available_frames:
        for frame in available_frames:
            ts = _to_float(frame.get("timestamp_sec"))
            if ts is None:
                continue
            if start_sec <= ts <= end_sec:
                in_window_frames.append(ts)

    if representative is not None and start_sec <= representative <= end_sec:
        # Original representative falls inside the window — keep it.
        representative_frame_valid = True
        representative_frame_source = "real_frame"
    elif in_window_frames:
        # Prefer a real frame near the middle of the window.
        midpoint = (start_sec + end_sec) / 2.0
        representative = min(in_window_frames, key=lambda ts: abs(ts - midpoint))
        representative_frame_valid = True
        representative_frame_source = "real_frame"
    else:
        # No real frame inside the window — use the midpoint and mark it
        # synthetic so downstream gates know not to trust this for
        # teacher-visible evidence on its own.
        representative = (start_sec + end_sec) / 2.0
        representative_frame_valid = False
        representative_frame_source = "synthetic_midpoint"

    # Final invariant: representative_frame_sec MUST be inside the window.
    if representative < start_sec:
        representative = start_sec
        representative_frame_valid = False
        representative_frame_source = "clamped"
    elif representative > end_sec:
        representative = end_sec
        representative_frame_valid = False
        representative_frame_source = "clamped"

    normalized = dict(moment)
    normalized["start_sec"] = round(start_sec, 1)
    normalized["end_sec"] = round(end_sec, 1)
    normalized["representative_frame_sec"] = round(representative, 1)
    normalized["representative_frame_valid"] = representative_frame_valid
    normalized["representative_frame_source"] = representative_frame_source
    normalized["window_valid"] = window_valid
    if window_invalid_reason:
        normalized["window_invalid_reason"] = window_invalid_reason
    return normalized


def validate_lesson_moment_timestamps(
    moment: Mapping[str, Any],
    *,
    duration_sec: Optional[float] = None,
) -> List[str]:
    """Lightweight validator returning the list of timestamp problems.

    Use this when you need to *report* invalid timestamps without rewriting
    them (audit script). For *normalization* in the pipeline, use
    ``normalize_lesson_moment_window`` instead.
    """

    issues: List[str] = []
    start_sec = _to_float(moment.get("start_sec"))
    end_sec = _to_float(moment.get("end_sec"))
    representative = _to_float(moment.get("representative_frame_sec"))

    if start_sec is None or start_sec < 0:
        issues.append("invalid_start_sec")
    if end_sec is None:
        issues.append("missing_end_sec")
    if start_sec is not None and end_sec is not None and end_sec <= start_sec:
        issues.append("end_sec_before_start_sec")
    if (
        duration_sec is not None
        and end_sec is not None
        and end_sec > duration_sec + DURATION_OVERRUN_TOLERANCE_SEC
    ):
        issues.append("end_sec_beyond_duration")
    if representative is None:
        issues.append("missing_representative_frame_sec")
    elif (
        start_sec is not None
        and end_sec is not None
        and (representative < start_sec or representative > end_sec)
    ):
        issues.append("representative_frame_outside_window")
    return issues


# ---------------------------------------------------------------------------
# Duplicate moment prevention
# ---------------------------------------------------------------------------


def _window_overlap_ratio(a: Mapping[str, Any], b: Mapping[str, Any]) -> float:
    a_start, a_end = float(a.get("start_sec", 0.0)), float(a.get("end_sec", 0.0))
    b_start, b_end = float(b.get("start_sec", 0.0)), float(b.get("end_sec", 0.0))
    if a_end <= a_start or b_end <= b_start:
        return 0.0
    overlap = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    smallest = min(a_end - a_start, b_end - b_start)
    if smallest <= 0:
        return 0.0
    return overlap / smallest


def _moment_strength(moment: Mapping[str, Any]) -> float:
    """Pick a single number to compare two duplicates and keep the stronger.

    The score combines (in order of importance): explicit moment ``score``,
    ``supporting_features.raw_selection_score``, transcript availability,
    and representative_frame_valid.
    """

    score = float(moment.get("score") or 0.0)
    features = moment.get("supporting_features") or {}
    raw_signal = float(features.get("raw_selection_score") or 0.0)
    avg_signal = float(features.get("average_selection_score") or 0.0)
    transcript_bonus = 0.1 if moment.get("transcript_excerpt") else 0.0
    frame_bonus = 0.05 if moment.get("representative_frame_valid") else 0.0
    text_bonus = 0.0
    if moment.get("text") or moment.get("summary") or moment.get("what_happened"):
        candidate_text = (
            moment.get("text") or moment.get("summary") or moment.get("what_happened") or ""
        )
        text_bonus = specificity_score(candidate_text) * 0.1
    return score + raw_signal * 0.5 + avg_signal * 0.25 + transcript_bonus + frame_bonus + text_bonus


def dedupe_lesson_moments(
    moments: Sequence[Mapping[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Return ``(kept, dropped)``.

    Two moments are duplicates when:

      * their ``(start_sec, end_sec)`` rounded to one decimal place match;
      * OR their overlap ratio (relative to the shorter window) is
        ``>= HIGH_OVERLAP_RATIO``;
      * OR their representative_frame_sec values match within
        ``DUPLICATE_REPRESENTATIVE_FRAME_TOLERANCE_SEC`` AND their
        starts agree within ``DUPLICATE_WINDOW_START_TOLERANCE_SEC``;
      * OR they share an identical non-empty text/summary.

    The stronger moment (by ``_moment_strength``) is kept. Dropped moments
    are returned with a ``deduped_from`` field referencing the kept moment.
    """

    kept: List[Dict[str, Any]] = []
    dropped: List[Dict[str, Any]] = []
    for raw in moments or []:
        candidate = dict(raw)
        matched_index: Optional[int] = None
        for index, existing in enumerate(kept):
            same_pair = (
                round(float(candidate.get("start_sec", 0.0)), 1)
                == round(float(existing.get("start_sec", 0.0)), 1)
                and round(float(candidate.get("end_sec", 0.0)), 1)
                == round(float(existing.get("end_sec", 0.0)), 1)
            )
            overlap_ratio = _window_overlap_ratio(candidate, existing)
            same_rep = (
                _to_float(candidate.get("representative_frame_sec")) is not None
                and _to_float(existing.get("representative_frame_sec")) is not None
                and abs(
                    float(candidate.get("representative_frame_sec"))
                    - float(existing.get("representative_frame_sec"))
                )
                <= DUPLICATE_REPRESENTATIVE_FRAME_TOLERANCE_SEC
                and abs(
                    float(candidate.get("start_sec", 0.0))
                    - float(existing.get("start_sec", 0.0))
                )
                <= DUPLICATE_WINDOW_START_TOLERANCE_SEC
            )
            text_a = str(candidate.get("text") or candidate.get("summary") or candidate.get("what_happened") or "").strip().lower()
            text_b = str(existing.get("text") or existing.get("summary") or existing.get("what_happened") or "").strip().lower()
            same_text = bool(text_a) and text_a == text_b
            # Element-aware dedupe (WS1): the product's unit of value is the
            # (element, evidence) pair, not the timestamp. Two DIFFERENT rubric
            # elements observed in the same window are two distinct takeaways and
            # must both survive. Only collapse when the elements are the same.
            # Legacy OpenCV moments carry no element_id; both-absent compares
            # equal, so this preserves the legacy path's behavior exactly.
            cand_el = str(candidate.get("element_id") or "").strip()
            exist_el = str(existing.get("element_id") or "").strip()
            same_element = cand_el == exist_el
            if same_element and (
                same_pair or overlap_ratio >= HIGH_OVERLAP_RATIO or same_rep or same_text
            ):
                matched_index = index
                break

        if matched_index is None:
            kept.append(candidate)
            continue

        existing = kept[matched_index]
        if _moment_strength(candidate) > _moment_strength(existing):
            # New one is stronger — keep it, drop the previous.
            dropped_entry = dict(existing)
            dropped_entry["deduped_from"] = candidate.get("moment_id") or candidate.get("id")
            dropped.append(dropped_entry)
            kept[matched_index] = candidate
        else:
            dropped_entry = dict(candidate)
            dropped_entry["deduped_from"] = existing.get("moment_id") or existing.get("id")
            dropped.append(dropped_entry)

    return kept, dropped


# ---------------------------------------------------------------------------
# Moment quality metadata
# ---------------------------------------------------------------------------


def _safe_float(value: Any, default: float = 0.0) -> float:
    parsed = _to_float(value)
    return parsed if parsed is not None else default


def compute_moment_quality(
    moment: Mapping[str, Any],
    *,
    transcript_segments: Optional[Sequence[Mapping[str, Any]]] = None,
    audio_features: Optional[Mapping[str, Any]] = None,
    has_transcript_globally: Optional[bool] = None,
) -> Dict[str, Any]:
    """Return the structured quality block for ``moment``.

    The block does not modify the moment; the caller should attach it as
    ``moment["quality"] = compute_moment_quality(moment, ...)``.
    """

    moment = dict(moment or {})
    features = moment.get("supporting_features") or {}
    selection_reason = str(moment.get("selection_reason") or "timeline_coverage").lower()

    quality_reasons: List[str] = []

    # Visual signal — combine the available per-window scores.
    visual_components = [
        _safe_float(features.get("raw_selection_score")),
        _safe_float(features.get("average_selection_score")),
        _safe_float(features.get("participant_density_score")) * 0.7,
        _safe_float(features.get("board_text_density_score")) * 0.7,
        _safe_float(features.get("teacher_prominence_score")) * 0.6,
        _safe_float(features.get("evidence_density_score")) * 0.5,
    ]
    visual_signal_score = round(min(1.0, sum(visual_components) / 3.0), 4)

    # Transcript signal.
    segments = list(transcript_segments or [])
    transcript_signal_score = 0.0
    teacher_action_signal = 0.0
    student_response_signal = 0.0
    has_transcript_window = bool(segments)
    if segments:
        joined = " ".join(
            str(seg.get("text") or "").strip()
            for seg in segments
            if str(seg.get("text") or "").strip()
        ).strip()
        if joined:
            transcript_signal_score = round(min(1.0, len(joined) / 240.0 + min(1.0, len(segments) / 4.0) * 0.3), 4)
            lowered = joined.lower()
            if any(marker in lowered for marker in ("?", "who can", "what do", "can someone", "מה ", "מי ")):
                teacher_action_signal = 0.65
            if any(marker in lowered for marker in ("because", "so we", "i think", "אני חושב", "כי ")):
                student_response_signal = 0.6
    elif has_transcript_globally is False:
        quality_reasons.append("missing_transcript")

    # Audio features.
    audio_signal_score = 0.0
    if audio_features:
        # If we have any audio feature signal at all, treat it as weak-but-real.
        audio_signal_score = round(
            min(
                1.0,
                _safe_float(audio_features.get("teacher_talk_ratio")) * 0.3
                + _safe_float(audio_features.get("student_talk_ratio")) * 0.5
                + (0.2 if audio_features.get("turns_count") else 0.0),
            ),
            4,
        )

    # Specificity / fallback detection on any provided moment text.
    moment_text = (
        moment.get("text")
        or moment.get("summary")
        or moment.get("what_happened")
        or ""
    )
    moment_specificity = specificity_score(moment_text)
    fallback_text_used = detect_fallback_text(moment_text)
    if fallback_text_used:
        quality_reasons.append("fallback_text_used")
        moment_specificity = min(moment_specificity, 0.05)

    # Confidence is the weighted blend.
    confidence = round(
        min(
            1.0,
            0.45 * visual_signal_score
            + 0.30 * transcript_signal_score
            + 0.10 * audio_signal_score
            + 0.15 * moment_specificity,
        ),
        4,
    )

    is_low_signal_reason = selection_reason in LOW_SIGNAL_SELECTION_REASONS
    near_zero_features = (
        _safe_float(features.get("raw_selection_score")) <= 0.05
        and _safe_float(features.get("average_selection_score")) <= 0.05
        and _safe_float(features.get("participant_density_score")) <= 0.05
        and _safe_float(features.get("board_text_density_score")) <= 0.05
        and _safe_float(features.get("teacher_prominence_score")) <= 0.05
    )
    is_timeline_fallback = is_low_signal_reason and near_zero_features
    if is_timeline_fallback:
        quality_reasons.append("timeline_coverage_low_signal")

    representative_frame_valid = bool(moment.get("representative_frame_valid", True))
    if not representative_frame_valid:
        quality_reasons.append("representative_frame_synthetic_or_clamped")

    window_valid = bool(moment.get("window_valid", True))
    if not window_valid:
        quality_reasons.append("window_invalid")

    if not has_transcript_window and (has_transcript_globally is None or has_transcript_globally is False):
        quality_reasons.append("no_transcript_for_window")

    teacher_visible_candidate = (
        window_valid
        and not fallback_text_used
        and not is_timeline_fallback
        and confidence >= TEACHER_VISIBLE_MIN_CONFIDENCE
        and (moment_specificity >= TEACHER_VISIBLE_MIN_SPECIFICITY or has_transcript_window)
        and representative_frame_valid
    )

    return {
        "version": LESSON_MOMENT_QUALITY_VERSION,
        "source_valid": True,
        "timestamp_valid": window_valid,
        "representative_frame_valid": representative_frame_valid,
        "selection_reason": selection_reason,
        "is_timeline_fallback": is_timeline_fallback,
        "visual_signal_score": visual_signal_score,
        "audio_signal_score": audio_signal_score,
        "transcript_signal_score": transcript_signal_score,
        "specificity_score": moment_specificity,
        "teacher_action_signal": teacher_action_signal,
        "student_response_signal": student_response_signal,
        "has_transcript_window": has_transcript_window,
        "fallback_text_used": fallback_text_used,
        "confidence": confidence,
        "teacher_visible_candidate": teacher_visible_candidate,
        "quality_reasons": quality_reasons,
    }


# ---------------------------------------------------------------------------
# Assessment-level quality metadata
# ---------------------------------------------------------------------------


def _transcript_segment_count(transcript_doc: Optional[Mapping[str, Any]]) -> int:
    if not transcript_doc:
        return 0
    segments = transcript_doc.get("segments") or []
    return len(list(segments))


def _looks_like_completed_transcript(transcript_doc: Optional[Mapping[str, Any]]) -> bool:
    if not transcript_doc:
        return False
    status = str(transcript_doc.get("transcript_status") or "").lower()
    if status and status != "completed":
        return False
    return _transcript_segment_count(transcript_doc) > 0


def compute_assessment_quality(
    *,
    moments: Optional[Sequence[Mapping[str, Any]]] = None,
    transcript_doc: Optional[Mapping[str, Any]] = None,
    feature_doc: Optional[Mapping[str, Any]] = None,
    element_scores: Optional[Sequence[Mapping[str, Any]]] = None,
    fallback_text_used: Optional[bool] = None,
) -> Dict[str, Any]:
    """Return the ``analysis_quality`` block attached to every assessment.

    The block is computed AFTER the model has produced its element_scores. It
    looks at the persisted moments (which already have their per-moment
    quality blocks) and at the supporting modality docs.
    """

    moments = list(moments or [])
    quality_reasons: List[str] = []

    usable_moment_count = 0
    low_confidence_moment_count = 0
    visible_candidate_count = 0
    fallback_in_moments = False

    for moment in moments:
        quality = dict(moment.get("quality") or {})
        if quality.get("teacher_visible_candidate"):
            visible_candidate_count += 1
        if quality.get("confidence", 0) >= TEACHER_VISIBLE_MIN_CONFIDENCE and not quality.get(
            "is_timeline_fallback"
        ):
            usable_moment_count += 1
        else:
            low_confidence_moment_count += 1
        if quality.get("fallback_text_used"):
            fallback_in_moments = True

    if fallback_text_used is None:
        fallback_text_used = fallback_in_moments
    else:
        fallback_text_used = bool(fallback_text_used) or fallback_in_moments

    transcript_available = _looks_like_completed_transcript(transcript_doc)
    transcript_segment_count = _transcript_segment_count(transcript_doc)
    audio_features_available = bool(feature_doc)
    visual_features_available = any(moment.get("supporting_features") for moment in moments)

    # Element-score signal — fallback element scores carry confidence 25 and
    # the placeholder summary text. Detect them so we don't mark an
    # all-placeholder assessment as teacher-visible.
    element_fallback_count = 0
    element_count = 0
    for score in element_scores or []:
        element_count += 1
        is_fallback_element = False
        if score.get("confidence") is not None and float(score.get("confidence") or 0) < 30.0:
            is_fallback_element = True
        observations = score.get("observations") or []
        for obs in observations:
            if detect_fallback_text(obs):
                is_fallback_element = True
                fallback_text_used = True
                break
        for segment in score.get("evidence_segments") or []:
            if detect_fallback_text(segment.get("summary") or "") or detect_fallback_text(
                segment.get("rationale") or ""
            ):
                is_fallback_element = True
                fallback_text_used = True
                break
        rationale = (score.get("evidence_segments") or [{}])[0].get("rationale") if score.get("evidence_segments") else ""
        if str(rationale or "").lower().startswith("fallback"):
            is_fallback_element = True
            fallback_text_used = True
        if is_fallback_element:
            element_fallback_count += 1

    if element_count and element_fallback_count >= element_count:
        quality_reasons.append("all_element_scores_fallback")

    if not transcript_available:
        quality_reasons.append("transcript_unavailable")
    if not audio_features_available:
        quality_reasons.append("audio_features_unavailable")
    if not visual_features_available:
        quality_reasons.append("visual_features_unavailable")
    if fallback_text_used:
        quality_reasons.append("fallback_text_used")
    if not moments:
        quality_reasons.append("no_moments_persisted")
    if usable_moment_count == 0 and moments:
        quality_reasons.append("no_usable_moments")

    evidence_sufficient = (
        usable_moment_count >= EVIDENCE_SUFFICIENT_MIN_MOMENT_COUNT
        and not (element_count and element_fallback_count >= element_count)
    )

    teacher_feedback_allowed = bool(
        evidence_sufficient
        and visible_candidate_count >= 1
        and not (element_count and element_fallback_count >= element_count)
    )

    return {
        "version": ASSESSMENT_QUALITY_VERSION,
        "evidence_sufficient": evidence_sufficient,
        "teacher_feedback_allowed": teacher_feedback_allowed,
        "usable_moment_count": usable_moment_count,
        "low_confidence_moment_count": low_confidence_moment_count,
        "visible_candidate_count": visible_candidate_count,
        "transcript_available": transcript_available,
        "transcript_segment_count": transcript_segment_count,
        "audio_features_available": audio_features_available,
        "visual_features_available": visual_features_available,
        "fallback_text_used": fallback_text_used,
        "element_score_count": element_count,
        "element_fallback_count": element_fallback_count,
        "quality_reasons": quality_reasons,
    }


# ---------------------------------------------------------------------------
# Candidate sizing for longer videos
# ---------------------------------------------------------------------------


def suggested_candidate_window_count(
    duration_sec: Optional[float],
    *,
    default_window_sec: float = 20.0,
    long_video_threshold_sec: float = LONG_VIDEO_THRESHOLD_SEC,
) -> int:
    """Suggest how many candidate windows the sampler should evaluate.

    The returned value is a *suggested floor* on the number of candidates
    evaluated, not the number of final teacher-visible moments. The legacy
    behaviour evaluated contiguous 20-second windows for the entire video
    length — which is already plenty of candidates — but selected only 6.
    The selection cap is unchanged; what C3 needs is for the audit/quality
    layer to recognize when the candidate pool was too thin.
    """

    if not duration_sec or duration_sec <= 0:
        return 6
    if duration_sec >= long_video_threshold_sec:
        # Aim for one candidate every ~45 seconds for long videos.
        return max(8, int(duration_sec // SUGGESTED_CANDIDATE_INTERVAL_SEC_LONG))
    # Otherwise one candidate every ~30 seconds is plenty.
    return max(6, int(duration_sec // SUGGESTED_CANDIDATE_INTERVAL_SEC_DEFAULT))


def assessment_quality_blocks_teacher_feedback(assessment: Optional[Mapping[str, Any]]) -> bool:
    """Return True iff ``assessment.analysis_quality.teacher_feedback_allowed`` is False."""

    if not assessment:
        return False
    quality = assessment.get("analysis_quality") or {}
    if not isinstance(quality, Mapping):
        return False
    return quality.get("teacher_feedback_allowed") is False


# ---------------------------------------------------------------------------
# Audit helpers (shared with backend/scripts/audit_lesson_evidence_quality.py)
# ---------------------------------------------------------------------------


def audit_moment_evidence_quality(
    moments_docs: Iterable[Mapping[str, Any]],
    *,
    duration_by_video_id: Optional[Mapping[str, float]] = None,
) -> Dict[str, Any]:
    """Aggregate evidence-quality issues across persisted ``video_analysis_moments`` docs.

    Each input doc looks like the persisted manifest:
        {
            "video_id": ...,
            "moments": [ { start_sec, end_sec, representative_frame_sec, ... } ],
            ...
        }
    """

    issues: Dict[str, Dict[str, Any]] = {}

    def _add(code: str, sample: Dict[str, Any]) -> None:
        bucket = issues.setdefault(code, {"code": code, "count": 0, "samples": []})
        bucket["count"] += 1
        if len(bucket["samples"]) < 25:
            bucket["samples"].append(sample)

    moments_seen = 0
    manifests_seen = 0

    for manifest in moments_docs or []:
        manifests_seen += 1
        video_id = manifest.get("video_id")
        duration_sec = None
        if duration_by_video_id and video_id:
            duration_sec = duration_by_video_id.get(video_id)
        moments = list(manifest.get("moments") or [])
        seen_pairs: List[Tuple[float, float]] = []
        for moment in moments:
            moments_seen += 1
            timestamp_issues = validate_lesson_moment_timestamps(moment, duration_sec=duration_sec)
            for issue in timestamp_issues:
                _add(
                    f"moment_{issue}",
                    {
                        "video_id": video_id,
                        "moment_id": moment.get("moment_id"),
                        "start_sec": moment.get("start_sec"),
                        "end_sec": moment.get("end_sec"),
                        "representative_frame_sec": moment.get("representative_frame_sec"),
                    },
                )
            pair = (
                round(_safe_float(moment.get("start_sec")), 1),
                round(_safe_float(moment.get("end_sec")), 1),
            )
            if pair in seen_pairs:
                _add(
                    "moment_duplicate_window",
                    {
                        "video_id": video_id,
                        "moment_id": moment.get("moment_id"),
                        "start_sec": pair[0],
                        "end_sec": pair[1],
                    },
                )
            else:
                seen_pairs.append(pair)

            quality = moment.get("quality") or {}
            if not quality:
                _add(
                    "moment_missing_quality",
                    {
                        "video_id": video_id,
                        "moment_id": moment.get("moment_id"),
                    },
                )
                continue
            if quality.get("is_timeline_fallback"):
                _add(
                    "moment_timeline_coverage_low_signal",
                    {
                        "video_id": video_id,
                        "moment_id": moment.get("moment_id"),
                        "confidence": quality.get("confidence"),
                    },
                )
            if quality.get("fallback_text_used"):
                _add(
                    "moment_fallback_text_used",
                    {
                        "video_id": video_id,
                        "moment_id": moment.get("moment_id"),
                    },
                )

    return {
        "manifests_seen": manifests_seen,
        "moments_seen": moments_seen,
        "issues": issues,
    }


def audit_assessment_evidence_quality(
    assessments: Iterable[Mapping[str, Any]],
) -> Dict[str, Any]:
    """Aggregate assessment-level evidence-quality issues."""

    issues: Dict[str, Dict[str, Any]] = {}

    def _add(code: str, sample: Dict[str, Any]) -> None:
        bucket = issues.setdefault(code, {"code": code, "count": 0, "samples": []})
        bucket["count"] += 1
        if len(bucket["samples"]) < 25:
            bucket["samples"].append(sample)

    seen = 0
    for assessment in assessments or []:
        seen += 1
        quality = assessment.get("analysis_quality")
        if not isinstance(quality, Mapping):
            _add(
                "assessment_missing_analysis_quality",
                {
                    "assessment_id": assessment.get("id"),
                    "video_id": assessment.get("video_id"),
                },
            )
            continue
        if quality.get("teacher_feedback_allowed") is False:
            _add(
                "assessment_teacher_feedback_blocked",
                {
                    "assessment_id": assessment.get("id"),
                    "video_id": assessment.get("video_id"),
                    "quality_reasons": list(quality.get("quality_reasons") or []),
                },
            )
        if quality.get("fallback_text_used"):
            _add(
                "assessment_fallback_text_used",
                {
                    "assessment_id": assessment.get("id"),
                    "video_id": assessment.get("video_id"),
                },
            )

    return {"assessments_seen": seen, "issues": issues}


__all__ = [
    "LESSON_MOMENT_QUALITY_VERSION",
    "ASSESSMENT_QUALITY_VERSION",
    "GENERIC_FALLBACK_PHRASES",
    "TEACHER_VISIBLE_MIN_CONFIDENCE",
    "TEACHER_VISIBLE_MIN_SPECIFICITY",
    "EVIDENCE_SUFFICIENT_MIN_MOMENT_COUNT",
    "detect_fallback_text",
    "specificity_score",
    "normalize_lesson_moment_window",
    "validate_lesson_moment_timestamps",
    "dedupe_lesson_moments",
    "compute_moment_quality",
    "compute_assessment_quality",
    "suggested_candidate_window_count",
    "assessment_quality_blocks_teacher_feedback",
    "audit_moment_evidence_quality",
    "audit_assessment_evidence_quality",
]
