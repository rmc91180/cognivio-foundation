"""Analysis failure / mode taxonomy (WS1 Phase 0).

This module is the single source of truth for the ``analysis_mode`` string an
assessment document can carry, and for the typed exception hierarchy the
analysis providers will raise in Phase 1+.

Phase 0 discipline:

  * This module is PURE — no network, no DB, no SDK imports. It can be imported
    and unit-tested in isolation, and later imported by both the OpenAI and the
    Gemini analysis paths.
  * Nothing here is wired into the live request path yet. The exceptions are
    DEFINED but not raised by ``server.py`` in this phase; the gemini_* modes
    are RESERVED but not emitted yet.
  * The taxonomy is RECONCILED against the fallback strings already present in
    ``backend/server.py`` (see :data:`_EXISTING_SERVER_MODES`). Existing names
    are reused verbatim — renaming any of them would be a behavior change,
    because assessment documents already persist these literals.

Verified against ``backend/server.py`` (``analyze_frames_with_ai`` ~ line 30819
and ``_normalize_model_analysis`` ~ line 30579) on the WS1 Phase 0 branch:

  Success modes set on a real model response:
    * ``openai``              — set after a successful OpenAI vision response
    * ``openai_multimodal``   — same, upgraded when audio modality was fused in

  Fallback modes (heuristic / mock output served instead of a real model run):
    * ``fallback``                          — generic catch-all default
    * ``fallback_model_error``              — the model call raised
    * ``fallback_paid_analysis_disabled``   — PAID_ANALYSIS_ENABLED is false
    * ``fallback_paid_analysis_not_allowed``— user not on the paid allowlist
    * ``fallback_model_unconfigured``       — no API key / SDK unavailable

  Non-success terminal / pre-completion states (NOT fallback output, NOT a real
  model run — they mean "nothing analyzable happened"):
    * ``unknown``                  — default placeholder before a run resolves
    * ``empty_selection``          — no rubric elements were selected to analyze
    * ``failed_before_completion`` — the pipeline aborted before producing output
"""

from __future__ import annotations

from typing import FrozenSet


# --------------------------------------------------------------------------- #
# analysis_mode string taxonomy
# --------------------------------------------------------------------------- #

# Success: a real model produced the analysis.
ANALYSIS_MODE_OPENAI = "openai"
ANALYSIS_MODE_OPENAI_MULTIMODAL = "openai_multimodal"
ANALYSIS_MODE_GEMINI = "gemini"
ANALYSIS_MODE_GEMINI_MULTIMODAL = "gemini_multimodal"

SUCCESS_MODES: FrozenSet[str] = frozenset(
    {
        ANALYSIS_MODE_OPENAI,
        ANALYSIS_MODE_OPENAI_MULTIMODAL,
        ANALYSIS_MODE_GEMINI,
        ANALYSIS_MODE_GEMINI_MULTIMODAL,
    }
)

# Fallback: heuristic/mock output was served because a real run was impossible
# or failed. Every distinct cause has its own self-describing string so a
# fallback can never be silently disguised as success.
#
# The first five are ALREADY emitted by server.py today (reused verbatim — do
# NOT rename). The remaining ones are RESERVED for Phase 1+ (parse/empty/drop
# handling and the new Gemini provider) and are not emitted yet.
ANALYSIS_MODE_FALLBACK = "fallback"  # generic default in server.py
ANALYSIS_MODE_FALLBACK_MODEL_ERROR = "fallback_model_error"
ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_DISABLED = "fallback_paid_analysis_disabled"
ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_NOT_ALLOWED = "fallback_paid_analysis_not_allowed"
ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED = "fallback_model_unconfigured"
# Reserved (defined, not yet emitted):
ANALYSIS_MODE_FALLBACK_PARSE_ERROR = "fallback_parse_error"
ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES = "fallback_empty_element_scores"
ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED = "fallback_all_elements_dropped"
ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR = "fallback_gemini_parse_error"
ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT = "fallback_gemini_timeout"
ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED = "fallback_gemini_rate_limited"
# WS1 Phase 2: Gemini produced a parseable analysis but no usable grounded
# evidence to derive lesson moments from (all candidate moments empty/invalid).
ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS = "fallback_gemini_no_moments"
# WS1 Phase 3: Gemini File API upload failed or the uploaded file never became
# ACTIVE (state FAILED, or a transport error during upload).
ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR = "fallback_gemini_upload_error"
# WS1 Phase 4: Gemini stopped before finishing (non-STOP finish_reason such as
# MAX_TOKENS or SAFETY) — visible JSON may be truncated; never patch, fail loud.
ANALYSIS_MODE_FALLBACK_GEMINI_TRUNCATED = "fallback_gemini_truncated"

FALLBACK_MODES: FrozenSet[str] = frozenset(
    {
        ANALYSIS_MODE_FALLBACK,
        ANALYSIS_MODE_FALLBACK_MODEL_ERROR,
        ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_DISABLED,
        ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_NOT_ALLOWED,
        ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        ANALYSIS_MODE_FALLBACK_PARSE_ERROR,
        ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES,
        ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED,
        ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR,
        ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT,
        ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED,
        ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS,
        ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR,
        ANALYSIS_MODE_FALLBACK_GEMINI_TRUNCATED,
    }
)

# Non-success terminal / pre-completion states. These are neither a real model
# run nor fallback output; they describe "no analyzable result" situations.
ANALYSIS_MODE_UNKNOWN = "unknown"
ANALYSIS_MODE_EMPTY_SELECTION = "empty_selection"
ANALYSIS_MODE_FAILED_BEFORE_COMPLETION = "failed_before_completion"

TERMINAL_MODES: FrozenSet[str] = frozenset(
    {
        ANALYSIS_MODE_UNKNOWN,
        ANALYSIS_MODE_EMPTY_SELECTION,
        ANALYSIS_MODE_FAILED_BEFORE_COMPLETION,
    }
)

ALL_ANALYSIS_MODES: FrozenSet[str] = SUCCESS_MODES | FALLBACK_MODES | TERMINAL_MODES

# The exact set of analysis_mode/fallback literals server.py emits TODAY. The
# test suite asserts every one of these is still present in the taxonomy, so a
# future rename that would orphan persisted assessment documents fails loudly.
_EXISTING_SERVER_MODES: FrozenSet[str] = frozenset(
    {
        ANALYSIS_MODE_OPENAI,
        ANALYSIS_MODE_OPENAI_MULTIMODAL,
        ANALYSIS_MODE_FALLBACK,
        ANALYSIS_MODE_FALLBACK_MODEL_ERROR,
        ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_DISABLED,
        ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_NOT_ALLOWED,
        ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED,
        ANALYSIS_MODE_UNKNOWN,
        ANALYSIS_MODE_EMPTY_SELECTION,
        ANALYSIS_MODE_FAILED_BEFORE_COMPLETION,
    }
)

# One-line human meaning for every known mode. Useful for dashboards/audits.
ANALYSIS_MODE_MEANINGS = {
    ANALYSIS_MODE_OPENAI: "OpenAI vision model produced the analysis.",
    ANALYSIS_MODE_OPENAI_MULTIMODAL: "OpenAI analysis fused with audio modality.",
    ANALYSIS_MODE_GEMINI: "Gemini native video model produced the analysis.",
    ANALYSIS_MODE_GEMINI_MULTIMODAL: "Gemini analysis fused with audio modality.",
    ANALYSIS_MODE_FALLBACK: "Generic heuristic fallback (cause not specialized).",
    ANALYSIS_MODE_FALLBACK_MODEL_ERROR: "Model call raised; heuristic output served.",
    ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_DISABLED: "Paid analysis disabled platform-wide.",
    ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_NOT_ALLOWED: "User not on the paid-analysis allowlist.",
    ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED: "No model API key / SDK unavailable.",
    ANALYSIS_MODE_FALLBACK_PARSE_ERROR: "Model returned unparseable output (reserved).",
    ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES: "Model returned zero element_scores (reserved).",
    ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED: "All element_scores failed the contract (reserved).",
    ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR: "Gemini returned unparseable output (reserved).",
    ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT: "Gemini call timed out (reserved).",
    ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED: "Gemini call was rate-limited (reserved).",
    ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS: "Gemini analysis had no usable grounded evidence for moments.",
    ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR: "Gemini File API upload failed or never became ACTIVE.",
    ANALYSIS_MODE_FALLBACK_GEMINI_TRUNCATED: "Gemini stopped before finishing (non-STOP finish_reason, e.g. MAX_TOKENS or SAFETY).",
    ANALYSIS_MODE_UNKNOWN: "Default placeholder before a run resolves.",
    ANALYSIS_MODE_EMPTY_SELECTION: "No rubric elements were selected to analyze.",
    ANALYSIS_MODE_FAILED_BEFORE_COMPLETION: "Pipeline aborted before producing output.",
}


def is_success_mode(mode: str) -> bool:
    """True iff ``mode`` represents a real (non-fallback) model analysis."""

    return mode in SUCCESS_MODES


def is_fallback_mode(mode: str) -> bool:
    """True iff ``mode`` represents served fallback / heuristic output.

    Matches the explicit fallback set and, defensively, any string with the
    ``fallback`` prefix so a future-added fallback literal is never mistaken
    for success.
    """

    if not isinstance(mode, str):
        return False
    return mode in FALLBACK_MODES or mode.startswith("fallback")


def is_terminal_mode(mode: str) -> bool:
    """True iff ``mode`` is a non-success, non-fallback terminal/pre-run state."""

    return mode in TERMINAL_MODES


def describe_mode(mode: str) -> str:
    """Return the one-line human meaning of ``mode`` (or an 'unrecognized' note)."""

    return ANALYSIS_MODE_MEANINGS.get(mode, f"Unrecognized analysis_mode: {mode!r}")


# --------------------------------------------------------------------------- #
# Typed exception hierarchy (DEFINED in Phase 0; raised in Phase 1+).
# --------------------------------------------------------------------------- #
class AnalysisError(Exception):
    """Base class for analysis-pipeline errors.

    Carries an optional ``analysis_mode`` so a caller that converts the
    exception into a fallback result can record the precise, self-describing
    cause instead of a generic ``"fallback"``.
    """

    #: The fallback analysis_mode a handler should record for this error class.
    default_mode: str = ANALYSIS_MODE_FALLBACK

    def __init__(self, message: str = "", *, analysis_mode: str | None = None) -> None:
        super().__init__(message)
        self.analysis_mode = analysis_mode or self.default_mode


class AnalysisParseError(AnalysisError):
    """The model returned output that could not be parsed into the contract."""

    default_mode = ANALYSIS_MODE_FALLBACK_PARSE_ERROR


class AnalysisContractError(AnalysisError):
    """Parsed output violated the frozen analysis/moment contract."""

    default_mode = ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED


class AnalysisProviderError(AnalysisError):
    """The provider (transport/auth/quota/timeout) failed before producing output."""

    default_mode = ANALYSIS_MODE_FALLBACK_MODEL_ERROR


__all__ = [
    # success
    "ANALYSIS_MODE_OPENAI",
    "ANALYSIS_MODE_OPENAI_MULTIMODAL",
    "ANALYSIS_MODE_GEMINI",
    "ANALYSIS_MODE_GEMINI_MULTIMODAL",
    "SUCCESS_MODES",
    # fallback
    "ANALYSIS_MODE_FALLBACK",
    "ANALYSIS_MODE_FALLBACK_MODEL_ERROR",
    "ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_DISABLED",
    "ANALYSIS_MODE_FALLBACK_PAID_ANALYSIS_NOT_ALLOWED",
    "ANALYSIS_MODE_FALLBACK_MODEL_UNCONFIGURED",
    "ANALYSIS_MODE_FALLBACK_PARSE_ERROR",
    "ANALYSIS_MODE_FALLBACK_EMPTY_ELEMENT_SCORES",
    "ANALYSIS_MODE_FALLBACK_ALL_ELEMENTS_DROPPED",
    "ANALYSIS_MODE_FALLBACK_GEMINI_PARSE_ERROR",
    "ANALYSIS_MODE_FALLBACK_GEMINI_TIMEOUT",
    "ANALYSIS_MODE_FALLBACK_GEMINI_RATE_LIMITED",
    "ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS",
    "ANALYSIS_MODE_FALLBACK_GEMINI_UPLOAD_ERROR",
    "ANALYSIS_MODE_FALLBACK_GEMINI_TRUNCATED",
    "FALLBACK_MODES",
    # terminal
    "ANALYSIS_MODE_UNKNOWN",
    "ANALYSIS_MODE_EMPTY_SELECTION",
    "ANALYSIS_MODE_FAILED_BEFORE_COMPLETION",
    "TERMINAL_MODES",
    # aggregate + helpers
    "ALL_ANALYSIS_MODES",
    "ANALYSIS_MODE_MEANINGS",
    "is_success_mode",
    "is_fallback_mode",
    "is_terminal_mode",
    "describe_mode",
    # exceptions
    "AnalysisError",
    "AnalysisParseError",
    "AnalysisContractError",
    "AnalysisProviderError",
]
