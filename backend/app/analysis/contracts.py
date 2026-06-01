"""Frozen analysis contracts + pure validators (WS1 Phase 0).

This module is the single, provider-agnostic source of truth for the two data
shapes the analysis pipeline depends on:

  1. :data:`ANALYSIS_PAYLOAD_CONTRACT` — the raw analysis payload a model
     provider must return. Today produced by
     ``server.py::_analyze_frames_with_openai`` and consumed by
     ``server.py::_normalize_model_analysis``. The Gemini path (Phase 1+) must
     return the SAME shape so the normalizer is provider-agnostic.

  2. :data:`MOMENT_CONTRACT` — the lesson-moment object shape that
     ``app/services/lesson_moment_quality.py::compute_moment_quality`` reads
     when it decides ``is_timeline_fallback`` / ``teacher_visible_candidate``.

Both contracts were verified by reading the real code on the WS1 Phase 0
branch (not docstrings or CLAUDE.md):

  * ``_normalize_model_analysis`` (server.py ~30579) iterates
    ``raw_payload["element_scores"]``, matches each ``element_id`` against the
    ids in ``elements_to_analyze``, **drops** any score whose id is not in that
    set or is a duplicate, and then appends a placeholder element score for any
    requested element it never saw. It also reads ``summary`` and
    ``recommendations``. This module's :func:`validate_payload` enforces the
    pre-normalization invariants so a provider can be checked BEFORE its output
    is silently degraded into placeholders.

  * ``compute_moment_quality`` (lesson_moment_quality.py ~427) reads
    ``supporting_features`` (raw_selection_score, average_selection_score,
    participant_density_score, board_text_density_score,
    teacher_prominence_score, evidence_density_score), ``selection_reason``,
    ``representative_frame_valid``, ``window_valid`` and the moment text
    (text / summary / what_happened). A moment is "timeline fallback" when its
    selection reason is low-signal AND every gate feature is ``<= 0.05`` (the
    near-zero threshold). :func:`validate_moment` flags an all-near-zero moment
    as fallback-shaped.

PHASE 0 DISCIPLINE: this module is PURE. It imports only the standard library
(``dataclasses``, ``typing``). No ``motor``, ``openai``, ``google``/``genai``,
``requests``, or any DB/network import — so it is import-safe and unit-testable
in isolation, and can later be imported by both the OpenAI and Gemini paths.
Validators NEVER raise and NEVER perform I/O; they return a structured
:class:`ValidationResult` and let the caller decide whether to raise (the
typed exceptions live in ``app/analysis/failures.py``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, List, Mapping, Optional


# --------------------------------------------------------------------------- #
# Shared constants (mirrors, not imports, to keep this module dependency-free)
# --------------------------------------------------------------------------- #

#: Gate features that ``compute_moment_quality`` checks for the near-zero
#: (timeline-fallback) condition. Mirrors the keys read in
#: ``lesson_moment_quality.compute_moment_quality``.
MOMENT_GATE_FEATURE_KEYS = (
    "raw_selection_score",
    "average_selection_score",
    "participant_density_score",
    "board_text_density_score",
    "teacher_prominence_score",
)

#: All supporting_feature keys the quality gate may read (gate keys plus the
#: weakly-weighted evidence density signal).
MOMENT_SUPPORTING_FEATURE_KEYS = MOMENT_GATE_FEATURE_KEYS + ("evidence_density_score",)

#: The "near zero" threshold. Mirrors the literal ``<= 0.05`` comparisons in
#: ``compute_moment_quality``. A contract-valid (non-fallback) moment must have
#: at least one gate feature strictly greater than this.
NEAR_ZERO_FEATURE_THRESHOLD = 0.05


# --------------------------------------------------------------------------- #
# Documented schemas (frozen contracts — the single source of truth)
# --------------------------------------------------------------------------- #

ANALYSIS_PAYLOAD_CONTRACT: Mapping[str, Any] = {
    "description": (
        "Raw analysis payload a model provider returns, BEFORE "
        "_normalize_model_analysis post-processes it. Provider-agnostic: the "
        "OpenAI and Gemini paths must both return this shape."
    ),
    "fields": {
        "summary": {
            "type": "string",
            "required": True,
            "notes": (
                "2-3 sentence coaching-voice opener. Read by "
                "_normalize_model_analysis via raw_payload['summary']. Must be "
                "non-empty for a real analysis."
            ),
        },
        "recommendations": {
            "type": "list[object]",
            "required": False,
            "item_fields": {
                "start_sec": "number >= 0",
                "end_sec": "number > start_sec",
                "text": "string (actionable next-lesson move)",
                "linked_element_id": "string | null (element id, optional)",
            },
            "notes": (
                "Normalizer tolerates a list of bare strings too, but providers "
                "should emit objects. Capped at 4 by the normalizer."
            ),
        },
        "element_scores": {
            "type": "list[object]",
            "required": True,
            "min_items": 1,
            "item_fields": {
                "element_id": (
                    "string — MUST equal one of elements_to_analyze[].id. "
                    "Scores with an unknown or duplicate id are DROPPED by "
                    "_normalize_model_analysis."
                ),
                "score": "number (1-10 or 1-4; normalizer rescales)",
                "confidence": "number (0-100)",
                "observations": "list[string] (coach-voice, capped at 3)",
                "evidence_segments": "list[object] (see evidence_segment_fields)",
            },
            "evidence_segment_fields": {
                "start_sec": "number >= 0",
                "end_sec": "number > start_sec",
                "summary": "string (non-empty; what happened in this moment)",
                "rationale": "string (why it matters)",
            },
        },
    },
    "invariants": [
        "element_scores is a non-empty list.",
        "Every element_scores[].element_id is a member of the allowed "
        "elements_to_analyze[].id set.",
        "summary is present and non-empty.",
        "Each evidence_segment start_sec/end_sec is numeric and non-negative, "
        "with end_sec > start_sec.",
    ],
}


#: Canonical JSON-shape example for the analysis payload, kept here as the single
#: source of truth so any provider prompt (OpenAI, Gemini) can lift the exact
#: shape instead of re-typing it. ``{allowed_ids}`` is a format placeholder the
#: caller fills with the concrete allowed element-id list.
ANALYSIS_PAYLOAD_JSON_SHAPE = """{
  "summary": "2-3 sentences in a warm coaching voice, addressed to 'you'.",
  "recommendations": [
    {
      "start_sec": 90,
      "end_sec": 120,
      "text": "One specific thing to try next lesson. Actionable immediately.",
      "linked_element_id": "<one of the allowed element ids>"
    }
  ],
  "element_scores": [
    {
      "element_id": "<one of the allowed element ids: {allowed_ids}>",
      "score": 6.8,
      "confidence": 82,
      "observations": [
        "What you noticed, addressed to the teacher, grounded in a specific moment."
      ],
      "evidence_segments": [
        {
          "start_sec": 90,
          "end_sec": 120,
          "summary": "What happened in this moment, described as a colleague would.",
          "rationale": "Why this moment matters for this area of their practice."
        }
      ]
    }
  ]
}"""


MOMENT_CONTRACT: Mapping[str, Any] = {
    "description": (
        "A single lesson-moment object as compute_moment_quality reads it. "
        "Attached per-moment before persistence in video_analysis_moments."
    ),
    "fields": {
        "start_sec": {"type": "number >= 0", "required": True},
        "end_sec": {"type": "number > start_sec", "required": True},
        "representative_frame_sec": {
            "type": "number in [start_sec, end_sec]",
            "required": False,
            "notes": "Normalized by normalize_lesson_moment_window.",
        },
        "selection_reason": {
            "type": "string",
            "required": False,
            "default": "timeline_coverage",
            "notes": (
                "Low-signal reasons (timeline_coverage, scene_transition) are "
                "treated as fallback candidates unless features prove otherwise."
            ),
        },
        "supporting_features": {
            "type": "object",
            "required": True,
            "keys": list(MOMENT_SUPPORTING_FEATURE_KEYS),
            "notes": (
                "Per-window feature scores in [0, 1]. A NON-FALLBACK moment must "
                "have at least one gate feature (%s) strictly greater than the "
                "near-zero threshold %.2f; otherwise compute_moment_quality "
                "marks it is_timeline_fallback for low-signal selection reasons."
                % (", ".join(MOMENT_GATE_FEATURE_KEYS), NEAR_ZERO_FEATURE_THRESHOLD)
            ),
        },
        "representative_frame_valid": {
            "type": "boolean",
            "required": False,
            "default": True,
        },
        "window_valid": {"type": "boolean", "required": False, "default": True},
        "text|summary|what_happened": {
            "type": "string",
            "required": False,
            "notes": "Moment text; scored for specificity / fallback phrasing.",
        },
        "transcript_excerpt": {"type": "string", "required": False},
    },
    "invariants": [
        "supporting_features is present.",
        "start_sec is numeric and non-negative; end_sec is numeric and "
        "strictly greater than start_sec.",
        "At least one gate feature exceeds the near-zero threshold for the "
        "moment to be contract-valid (non-fallback-shaped).",
    ],
}


# --------------------------------------------------------------------------- #
# ValidationResult
# --------------------------------------------------------------------------- #
@dataclass
class ValidationResult:
    """Structured validator outcome. Never raised — the caller decides.

    Attributes:
        ok: True iff there are no errors.
        errors: machine-readable, specific error codes (not prose). Stable
            enough to assert on in tests.
    """

    ok: bool
    errors: List[str] = field(default_factory=list)

    def __bool__(self) -> bool:  # truthiness mirrors ``ok``
        return self.ok

    @classmethod
    def success(cls) -> "ValidationResult":
        return cls(ok=True, errors=[])

    @classmethod
    def failure(cls, errors: Iterable[str]) -> "ValidationResult":
        collected = [str(e) for e in errors]
        return cls(ok=len(collected) == 0, errors=collected)


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #
def _to_number(value: Any) -> Optional[float]:
    """Return ``value`` as a float, or None if it is not a real number.

    Booleans are intentionally rejected: ``True``/``False`` are not valid
    timestamps even though ``isinstance(True, int)`` is True in Python.
    """

    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _validate_timespan(
    obj: Mapping[str, Any],
    *,
    prefix: str,
    errors: List[str],
) -> None:
    """Append errors for a {start_sec, end_sec} pair that is non-numeric,
    negative, or non-increasing. Used for evidence_segments and moments."""

    start = _to_number(obj.get("start_sec"))
    end = _to_number(obj.get("end_sec"))

    if start is None:
        errors.append(f"{prefix}_non_numeric_start_sec")
    elif start < 0:
        errors.append(f"{prefix}_negative_start_sec")

    if end is None:
        errors.append(f"{prefix}_non_numeric_end_sec")
    elif end < 0:
        errors.append(f"{prefix}_negative_end_sec")

    if start is not None and end is not None and end <= start:
        errors.append(f"{prefix}_end_sec_not_after_start_sec")


# --------------------------------------------------------------------------- #
# validate_payload
# --------------------------------------------------------------------------- #
def validate_payload(
    payload: Any,
    allowed_element_ids: Iterable[str],
) -> ValidationResult:
    """Validate a raw analysis payload against :data:`ANALYSIS_PAYLOAD_CONTRACT`.

    Catches (each as a specific error code):
      * payload not a mapping
      * missing / empty summary               -> ``missing_summary``
      * missing / empty element_scores        -> ``empty_element_scores``
      * element_scores item not a mapping
      * element_score missing element_id
      * element_id outside the allowed set     -> ``element_id_not_allowed:<id>``
      * malformed evidence_segments (not a list, item not a mapping,
        non-numeric / negative timestamps, end <= start, empty summary)

    ``allowed_element_ids`` is the set of ``elements_to_analyze[].id``. When it
    is empty, the membership check is skipped (callers without the selection
    list can still validate structure).
    """

    errors: List[str] = []

    if not isinstance(payload, Mapping):
        return ValidationResult.failure(["payload_not_a_mapping"])

    # summary
    summary = payload.get("summary")
    if summary is None or not str(summary).strip():
        errors.append("missing_summary")

    # recommendations (lenient — only structural)
    recommendations = payload.get("recommendations")
    if recommendations is not None and not isinstance(recommendations, list):
        errors.append("recommendations_not_a_list")

    # element_scores
    allowed = {str(eid) for eid in (allowed_element_ids or [])}
    element_scores = payload.get("element_scores")
    if not isinstance(element_scores, list) or len(element_scores) == 0:
        errors.append("empty_element_scores")
        element_scores = []

    for idx, score in enumerate(element_scores):
        if not isinstance(score, Mapping):
            errors.append(f"element_scores[{idx}]_not_a_mapping")
            continue

        element_id = str(score.get("element_id") or "").strip()
        if not element_id:
            errors.append(f"element_scores[{idx}]_missing_element_id")
        elif allowed and element_id not in allowed:
            errors.append(f"element_id_not_allowed:{element_id}")

        segments = score.get("evidence_segments")
        if segments is None:
            continue
        if not isinstance(segments, list):
            errors.append(f"element_scores[{idx}]_evidence_segments_not_a_list")
            continue
        for sidx, segment in enumerate(segments):
            seg_prefix = f"element_scores[{idx}].evidence_segments[{sidx}]"
            if not isinstance(segment, Mapping):
                errors.append(f"{seg_prefix}_not_a_mapping")
                continue
            _validate_timespan(segment, prefix=seg_prefix, errors=errors)
            if not str(segment.get("summary") or "").strip():
                errors.append(f"{seg_prefix}_missing_summary")

    return ValidationResult(ok=len(errors) == 0, errors=errors)


# --------------------------------------------------------------------------- #
# validate_moment
# --------------------------------------------------------------------------- #
def validate_moment(moment: Any) -> ValidationResult:
    """Validate a single moment object against :data:`MOMENT_CONTRACT`.

    Catches (each as a specific error code):
      * moment not a mapping
      * non-numeric / negative start_sec, non-numeric end_sec, end <= start
      * missing supporting_features              -> ``missing_supporting_features``
      * supporting_features not a mapping
      * all gate features <= near-zero threshold ->
        ``fallback_shaped_all_features_near_zero`` (the moment would be treated
        as a timeline fallback; it is not contract-valid teacher evidence).
    """

    errors: List[str] = []

    if not isinstance(moment, Mapping):
        return ValidationResult.failure(["moment_not_a_mapping"])

    _validate_timespan(moment, prefix="moment", errors=errors)

    features = moment.get("supporting_features")
    if features is None:
        errors.append("missing_supporting_features")
    elif not isinstance(features, Mapping):
        errors.append("supporting_features_not_a_mapping")
    else:
        gate_values = [_to_number(features.get(key)) for key in MOMENT_GATE_FEATURE_KEYS]
        # Treat missing / non-numeric as 0.0 (mirrors _safe_float in the gate).
        all_near_zero = all(
            (value is None or value <= NEAR_ZERO_FEATURE_THRESHOLD) for value in gate_values
        )
        if all_near_zero:
            errors.append("fallback_shaped_all_features_near_zero")

    return ValidationResult(ok=len(errors) == 0, errors=errors)


__all__ = [
    "ANALYSIS_PAYLOAD_CONTRACT",
    "ANALYSIS_PAYLOAD_JSON_SHAPE",
    "MOMENT_CONTRACT",
    "MOMENT_GATE_FEATURE_KEYS",
    "MOMENT_SUPPORTING_FEATURE_KEYS",
    "NEAR_ZERO_FEATURE_THRESHOLD",
    "ValidationResult",
    "validate_payload",
    "validate_moment",
]
