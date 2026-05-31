"""Corrective-action availability for a video (PR C9.5 PART 3).

Pure, DB-free helpers that compute which corrective controls a video exposes and,
when a control is disabled, the specific machine-readable reason code so the UI
never renders a dead button or a generic "unavailable".

Contract D of the privacy / feedback truth repair: existing videos must surface
eligible controls for Retry privacy, Retry analysis, Run/retry audio analysis,
and Retry feedback projection — each with an explicit disabled reason when the
action cannot run yet. PART 3 lands the retry-privacy and retry-analysis states;
later parts extend :func:`build_video_action_states` with the audio (PART 4) and
feedback-projection (PART 6) actions.

The eligibility predicates intentionally mirror the gates enforced by the live
endpoints (``retry_video_privacy`` / ``retry_video_processing``) so a button the
UI renders as enabled will actually be accepted by the server.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

# ---------------------------------------------------------------------------
# Action identifiers (stable contract shared with the frontend).
# ---------------------------------------------------------------------------
ACTION_RETRY_PRIVACY = "retry_privacy"
ACTION_RETRY_ANALYSIS = "retry_analysis"
ACTION_RUN_AUDIO_ANALYSIS = "run_audio_analysis"
ACTION_RETRY_FEEDBACK_PROJECTION = "retry_feedback_projection"

# ---------------------------------------------------------------------------
# Disabled reason codes (machine-readable; the UI maps these to copy).
# ---------------------------------------------------------------------------
REASON_NO_LOCAL_SOURCE = "no_local_source"
REASON_PRIVACY_IN_PROGRESS = "privacy_in_progress"
REASON_PRIVACY_NOT_COMPLETE = "privacy_not_complete"
REASON_ANALYSIS_IN_PROGRESS = "analysis_in_progress"
REASON_ANALYSIS_ALREADY_COMPLETE = "analysis_already_complete"
REASON_ANALYSIS_NOT_FAILED = "analysis_not_failed"
REASON_AUDIO_IN_PROGRESS = "audio_in_progress"
REASON_AUDIO_DISABLED = "audio_analysis_disabled"
REASON_ANALYSIS_NOT_COMPLETE = "analysis_not_complete"
REASON_FEEDBACK_ALREADY_AVAILABLE = "feedback_already_available"

# Statuses that mean "a worker is already (re)running this stage".
_BUSY_STATUSES = frozenset({"queued", "processing"})
# Audio statuses that mean a prior run has resolved (retry, not first run).
_AUDIO_TERMINAL_STATUSES = frozenset(
    {"completed", "failed", "disabled", "unconfigured", "no_audio"}
)

# Fields that prove a worker can re-read the source bytes locally.
_LOCAL_SOURCE_FIELDS = (
    "processed_file_path",
    "raw_file_path",
    "file_path",
    "redacted_file_path",
)


def _norm(value: Any) -> str:
    """Lower-case, trimmed string projection (``None`` -> ``""``)."""
    if value is None:
        return ""
    return str(value).strip().lower()


def _has_local_source(video: Mapping[str, Any]) -> bool:
    """True when at least one local source path is recorded on the video."""
    return any(video.get(field) for field in _LOCAL_SOURCE_FIELDS)


def build_retry_privacy_state(video: Mapping[str, Any]) -> Dict[str, Any]:
    """Eligibility for re-running the destructive privacy (redaction) pass.

    Mirrors ``retry_video_privacy``: a local source must exist and privacy must
    not already be queued/processing. ``supports_full_frame`` advertises that the
    retry can request the provably-safe full-frame redaction strategy.
    """
    privacy_status = _norm(video.get("privacy_status"))
    reason: Optional[str] = None
    if not _has_local_source(video):
        reason = REASON_NO_LOCAL_SOURCE
    elif privacy_status in _BUSY_STATUSES:
        reason = REASON_PRIVACY_IN_PROGRESS
    return {
        "action": ACTION_RETRY_PRIVACY,
        "eligible": reason is None,
        "disabled_reason": reason,
        "supports_full_frame": True,
    }


def build_retry_analysis_state(video: Mapping[str, Any]) -> Dict[str, Any]:
    """Eligibility for re-running AI analysis on the redacted asset.

    Mirrors ``retry_video_processing``: requires a local source, privacy
    ``completed``, the analysis stage idle, and a ``failed`` analysis to retry.
    """
    status = _norm(video.get("status"))
    privacy_status = _norm(video.get("privacy_status"))
    reason: Optional[str] = None
    if not _has_local_source(video):
        reason = REASON_NO_LOCAL_SOURCE
    elif privacy_status != "completed":
        reason = REASON_PRIVACY_NOT_COMPLETE
    elif status in _BUSY_STATUSES:
        reason = REASON_ANALYSIS_IN_PROGRESS
    elif status == "completed":
        reason = REASON_ANALYSIS_ALREADY_COMPLETE
    elif status != "failed":
        reason = REASON_ANALYSIS_NOT_FAILED
    return {
        "action": ACTION_RETRY_ANALYSIS,
        "eligible": reason is None,
        "disabled_reason": reason,
    }


def build_run_audio_analysis_state(
    video: Mapping[str, Any], *, audio_enabled: bool = True
) -> Dict[str, Any]:
    """Eligibility for running (or re-running) audio analysis on a video.

    Audio runs on the privacy-completed (redacted) asset, so it requires a local
    source and ``privacy_status == "completed"`` and must not already be running.
    ``audio_enabled`` reflects the workspace audio-analysis preference; when it is
    off the control is disabled with an explicit reason rather than silently
    no-op'ing. ``mode`` distinguishes a first ``run`` from a ``retry``.
    """
    audio_status = _norm(video.get("audio_analysis_status"))
    privacy_status = _norm(video.get("privacy_status"))
    reason: Optional[str] = None
    if not audio_enabled:
        reason = REASON_AUDIO_DISABLED
    elif not _has_local_source(video):
        reason = REASON_NO_LOCAL_SOURCE
    elif privacy_status != "completed":
        reason = REASON_PRIVACY_NOT_COMPLETE
    elif audio_status in _BUSY_STATUSES:
        reason = REASON_AUDIO_IN_PROGRESS
    already_ran = audio_status in _AUDIO_TERMINAL_STATUSES
    return {
        "action": ACTION_RUN_AUDIO_ANALYSIS,
        "eligible": reason is None,
        "disabled_reason": reason,
        "mode": "retry" if already_ran else "run",
    }


def build_retry_feedback_projection_state(
    video: Mapping[str, Any], *, feedback_view: Optional[Mapping[str, Any]] = None
) -> Dict[str, Any]:
    """Eligibility for re-projecting the canonical teacher feedback view (PART 6).

    Feedback projection turns a completed assessment into the teacher-visible
    coaching view (release + safety gates applied). It can only run once analysis
    has produced an assessment — before that there is nothing to project, so the
    control is disabled with ``analysis_not_complete``. Re-projection is
    idempotent and safe, so it stays eligible even when feedback is already
    available (``mode == "retry"``) to let a corrected assessment refresh the
    teacher view rather than leaving a stale / withheld state stuck.
    """
    status = _norm(video.get("status"))
    analysis_status = _norm(video.get("analysis_status"))
    has_assessment = bool(video.get("assessment_id") or video.get("has_assessment"))
    analysis_complete = (
        status == "completed" or analysis_status == "completed"
    ) and has_assessment
    reason: Optional[str] = None
    if not analysis_complete:
        reason = REASON_ANALYSIS_NOT_COMPLETE
    available = bool((feedback_view or {}).get("feedback_available"))
    return {
        "action": ACTION_RETRY_FEEDBACK_PROJECTION,
        "eligible": reason is None,
        "disabled_reason": reason,
        "mode": "retry" if available else "run",
    }


def build_video_action_states(
    video: Mapping[str, Any],
    *,
    audio_enabled: bool = True,
    feedback_view: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Aggregate corrective-action availability for a single video.

    Returns a mapping keyed by action id; each value is an
    ``{action, eligible, disabled_reason, ...}`` descriptor the UI renders into
    a control with an explicit disabled reason. ``audio_enabled`` is the
    workspace audio preference; callers without that context (list/detail
    projections) default to ``True`` and the run-audio endpoint enforces the
    authoritative gate at click time. ``feedback_view`` is the resolved
    teacher-feedback projection, used only to label the feedback-projection
    control ``run`` vs ``retry``.
    """
    return {
        ACTION_RETRY_PRIVACY: build_retry_privacy_state(video),
        ACTION_RETRY_ANALYSIS: build_retry_analysis_state(video),
        ACTION_RUN_AUDIO_ANALYSIS: build_run_audio_analysis_state(
            video, audio_enabled=audio_enabled
        ),
        ACTION_RETRY_FEEDBACK_PROJECTION: build_retry_feedback_projection_state(
            video, feedback_view=feedback_view
        ),
    }
