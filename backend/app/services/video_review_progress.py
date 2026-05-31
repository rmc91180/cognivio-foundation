"""Deterministic, teacher-safe review progress model (PR C9.3).

Teachers were shown a single ambiguous "processing" spinner that never
resolved — even when the review was actually complete (just degraded to
vision-only), or when audio analysis was *disabled by configuration* and was
never going to run. This module centralizes a single, deterministic progress
object so every surface (video detail, status endpoint, teacher workspace,
admin) tells the same story.

Key rules encoded here (from the C9.3 brief):

- Analysis cannot start until privacy is ``completed`` → analysis stage is
  ``blocked`` while privacy is in flight / failed.
- Analysis ``completed`` **with** an ``assessment_id`` → review ``completed``.
- Degraded analysis (``vision_only_mode`` /
  ``fallback_paid_analysis_not_allowed``) is reported as ``completed_degraded``
  — **never** a perpetual "processing".
- Audio analysis disabled (``audio_analysis_enabled`` falsey) → the audio stage
  is ``skipped`` (disabled), **not** ``processing``/pending, and the teacher
  copy must not promise "after audio review is complete".
- Feedback released → feedback stage ``completed``; feedback blocked (human
  review) → ``blocked``.
- Analysis ``completed`` but the assessment is missing → ``failed`` /
  needs admin attention (we never fake completion).

This module is pure (no DB / network / config imports) so it is fully unit
testable. It never exposes raw video and never weakens privacy policy.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Tuple

__all__ = [
    "REVIEW_PROGRESS_STATUSES",
    "REVIEW_STAGE_KEYS",
    "REVIEW_STAGE_STATUSES",
    "REVIEW_RETRY_ACTIONS",
    "build_video_review_progress",
]

# Top-level review status vocabulary.
REVIEW_PROGRESS_STATUSES: Tuple[str, ...] = (
    "completed",
    "completed_degraded",
    "processing",
    "blocked",
    "failed",
)

# Ordered stage keys. Audio is informational and does not gate completion.
REVIEW_STAGE_KEYS: Tuple[str, ...] = (
    "upload",
    "video_preparation",
    "privacy",
    "analysis",
    "audio",
    "feedback",
)

# Per-stage status vocabulary.
REVIEW_STAGE_STATUSES: Tuple[str, ...] = (
    "completed",
    "processing",
    "pending",
    "blocked",
    "failed",
    "skipped",
    "not_started",
)

REVIEW_RETRY_ACTIONS: Tuple[str, ...] = (
    "retry_privacy",
    "retry_analysis",
    "retry_transcode",
)

# Weights used to compute ``percent`` (audio is informational, weight 0).
_STAGE_WEIGHTS: Dict[str, int] = {
    "upload": 5,
    "video_preparation": 10,
    "privacy": 35,
    "analysis": 35,
    "feedback": 15,
}

_DEGRADATION_FLAGS = {
    "vision_only_mode",
    "fallback_paid_analysis_not_allowed",
}


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_hebrew(language: Optional[str]) -> bool:
    return _norm(language) in {"he", "he-il", "hebrew", "iw"}


def _stage(key: str, label: str, status: str, detail: Optional[str] = None) -> Dict[str, Any]:
    entry: Dict[str, Any] = {"key": key, "label": label, "status": status}
    if detail:
        entry["detail"] = detail
    return entry


def _normalize_overall(value: Any) -> str:
    raw = _norm(value)
    if raw in {"queued", "processing", "completed", "failed", "cancelled"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "queued"


def _normalize_privacy(value: Any) -> str:
    raw = _norm(value)
    if raw in {"not_required", "queued", "processing", "review_required", "completed", "failed"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "queued"


def _normalize_transcode(value: Any) -> str:
    raw = _norm(value)
    if raw in {"queued", "processing", "completed", "failed", "not_required"}:
        return raw
    if raw in {"error", "errored"}:
        return "failed"
    return "not_required"


def _degradation_reasons(video: Mapping[str, Any]) -> List[str]:
    confidence = video.get("analysis_confidence")
    reasons: List[str] = []
    if isinstance(confidence, Mapping):
        raw = confidence.get("degradation_reasons")
        if isinstance(raw, (list, tuple)):
            reasons = [str(r) for r in raw if r]
    mode = _norm(video.get("analysis_mode"))
    if mode == "fallback_paid_analysis_not_allowed" and "fallback_paid_analysis_not_allowed" not in reasons:
        reasons.append("fallback_paid_analysis_not_allowed")
    return reasons


def _is_degraded(video: Mapping[str, Any]) -> bool:
    reasons = set(_degradation_reasons(video))
    if reasons & _DEGRADATION_FLAGS:
        return True
    # audio enabled but transcript failed is a degradation
    if video.get("audio_analysis_enabled") and _norm(video.get("audio_transcript_status")) == "failed":
        return True
    return False


def _feedback_completed(video: Mapping[str, Any], teacher_feedback: Optional[Mapping[str, Any]]) -> bool:
    if isinstance(teacher_feedback, Mapping):
        status = _norm(teacher_feedback.get("status") or teacher_feedback.get("release_status"))
        if status in {"released", "published", "sent", "completed", "delivered"}:
            return True
    return _norm(video.get("feedback_release_status")) == "released"


def _feedback_blocked(video: Mapping[str, Any], teacher_feedback: Optional[Mapping[str, Any]]) -> bool:
    if isinstance(teacher_feedback, Mapping):
        status = _norm(teacher_feedback.get("status") or teacher_feedback.get("release_status"))
        if status in {"blocked", "pending_review", "needs_review"}:
            return True
    if _norm(video.get("feedback_release_status")) == "blocked":
        return True
    return bool(video.get("feedback_human_review_required"))


def build_video_review_progress(
    video: Mapping[str, Any],
    assessment: Optional[Mapping[str, Any]] = None,
    teacher_feedback: Optional[Mapping[str, Any]] = None,
    *,
    language: str = "en",
    teacher_feedback_view: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a deterministic, teacher-safe progress object for a video.

    Returns a dict with: ``status``, ``percent``, ``current_stage``,
    ``teacher_message``, ``admin_message``, ``stages`` (list of
    {key,label,status}), ``retry`` ({eligible, action}),
    ``needs_admin_attention``, ``failure_code``, ``feedback_reason_code`` and
    ``degradation_reasons``.

    PR C9.5 PART 6 (contract C): when ``teacher_feedback_view`` (the resolved
    :func:`get_teacher_visible_lesson_feedback` projection) is supplied, the
    feedback stage is derived from it so the stage only reads ``completed`` when
    the teacher can actually SEE feedback, and every withheld / awaiting-release
    state carries its specific ``reason_code`` instead of a generic "done".
    """
    if not isinstance(video, Mapping):
        video = {}

    transcode_status = _normalize_transcode(video.get("transcode_status"))
    privacy_status = _normalize_privacy(video.get("privacy_status"))
    analysis_status = _normalize_overall(video.get("analysis_status"))
    overall_status = _normalize_overall(video.get("status"))

    has_assessment = bool(
        video.get("assessment_id")
        or (isinstance(assessment, Mapping) and (assessment.get("id") or assessment.get("assessment_id")))
    )

    audio_enabled = bool(video.get("audio_analysis_enabled"))
    audio_transcript_status = _norm(video.get("audio_transcript_status"))
    degradation_reasons = _degradation_reasons(video)
    degraded = _is_degraded(video)

    latest_error = (
        video.get("privacy_error")
        or video.get("transcode_error")
        or video.get("error_message")
        or video.get("playback_error")
    )

    # ------------------------------------------------------------------ #
    # Stage computation
    # ------------------------------------------------------------------ #
    stages: List[Dict[str, Any]] = []

    # 1. Upload — the video document existing implies the upload finished.
    if overall_status == "cancelled":
        stages.append(_stage("upload", "Upload", "failed", "Upload cancelled"))
    else:
        stages.append(_stage("upload", "Upload", "completed"))

    # 2. Video preparation (transcode).
    if transcode_status == "completed":
        prep_status = "completed"
    elif transcode_status == "not_required":
        prep_status = "completed"
    elif transcode_status == "failed":
        prep_status = "failed"
    elif transcode_status in {"queued", "processing"}:
        prep_status = "processing"
    else:
        prep_status = "pending"
    stages.append(_stage("video_preparation", "Video preparation", prep_status))

    # 3. Privacy (destructive blur).
    if privacy_status == "completed":
        privacy_stage = "completed"
    elif privacy_status == "not_required":
        privacy_stage = "completed"
    elif privacy_status == "review_required":
        privacy_stage = "blocked"
    elif privacy_status == "failed":
        privacy_stage = "failed"
    elif privacy_status in {"queued", "processing"}:
        privacy_stage = "processing"
    else:
        privacy_stage = "pending"
    privacy_detail = None
    if privacy_stage == "blocked":
        privacy_detail = str(video.get("privacy_review_reason") or "Awaiting privacy review")
    elif privacy_stage == "failed":
        privacy_detail = str(video.get("privacy_error") or "Privacy blur failed")
    stages.append(_stage("privacy", "Privacy blur", privacy_stage, privacy_detail))

    privacy_done = privacy_stage == "completed"

    # 4. Analysis — gated on privacy completion.
    analysis_inconsistent = False
    if not privacy_done:
        analysis_stage = "blocked"
    elif analysis_status == "completed":
        if has_assessment:
            analysis_stage = "completed"
        else:
            analysis_stage = "failed"
            analysis_inconsistent = True
    elif analysis_status == "failed":
        analysis_stage = "failed"
    elif analysis_status in {"queued", "processing"}:
        analysis_stage = "processing"
    else:
        analysis_stage = "pending"
    analysis_detail = None
    if analysis_inconsistent:
        analysis_detail = "Analysis marked complete but no assessment was produced"
    elif degraded and analysis_stage == "completed":
        analysis_detail = "Completed with reduced modalities"
    stages.append(_stage("analysis", "AI analysis", analysis_stage, analysis_detail))

    analysis_done = analysis_stage == "completed"

    # 5. Audio — informational. Disabled config must NOT read as pending.
    if not audio_enabled:
        audio_stage = "skipped"
        audio_detail = "Audio analysis is not enabled for this review"
    elif audio_transcript_status == "completed":
        audio_stage = "completed"
        audio_detail = None
    elif audio_transcript_status == "failed":
        audio_stage = "failed"
        audio_detail = "Audio analysis could not be completed"
    elif audio_transcript_status in {"queued", "processing", "pending"}:
        audio_stage = "processing"
        audio_detail = None
    elif analysis_done:
        # Analysis finished and audio never produced a status → it did not run.
        audio_stage = "skipped"
        audio_detail = "Audio analysis did not run for this review"
    else:
        audio_stage = "pending"
        audio_detail = None
    stages.append(_stage("audio", "Audio analysis", audio_stage, audio_detail))

    # 6. Feedback — gated on analysis completion. When the canonical teacher
    #    feedback view is supplied (PART 6), it is the SOURCE OF TRUTH: the stage
    #    is "completed" only when the teacher can actually see feedback, and any
    #    withheld / awaiting-release state carries its specific reason code so the
    #    UI never shows a generic "done" for a still-hidden review.
    feedback_reason_code: Optional[str] = None
    if isinstance(teacher_feedback_view, Mapping) and teacher_feedback_view.get("status"):
        view_status = _norm(teacher_feedback_view.get("status"))
        view_available = bool(teacher_feedback_view.get("feedback_available"))
        view_detail = teacher_feedback_view.get("detail")
        if not analysis_done:
            feedback_stage = "blocked"
            feedback_detail = None
        elif view_available and view_status == "ready":
            feedback_stage = "completed"
            feedback_detail = None
        elif view_status in {"processing", "not_yet_reviewed"}:
            feedback_stage = "pending"
            feedback_detail = view_detail
            feedback_reason_code = view_status
        else:
            # awaiting_admin_release / admin_hidden / revision_requested /
            # safety_withheld / evidence_insufficient / source_unavailable —
            # ready-but-hidden or content-withheld. NEVER "completed".
            feedback_stage = "blocked"
            feedback_detail = view_detail
            feedback_reason_code = (
                "feedback_awaiting_release"
                if view_status == "awaiting_admin_release"
                else view_status
            )
        feedback_done = feedback_stage == "completed"
        feedback_blocked = feedback_stage == "blocked"
    else:
        feedback_done = _feedback_completed(video, teacher_feedback)
        feedback_blocked = _feedback_blocked(video, teacher_feedback)
        if not analysis_done:
            feedback_stage = "blocked"
            feedback_detail = None
        elif feedback_done:
            feedback_stage = "completed"
            feedback_detail = None
        elif feedback_blocked:
            feedback_stage = "blocked"
            feedback_detail = "Feedback is pending human quality review before release"
            feedback_reason_code = "feedback_pending_review"
        else:
            feedback_stage = "pending"
            feedback_detail = None
    feedback_entry = _stage("feedback", "Feedback", feedback_stage, feedback_detail)
    if feedback_reason_code:
        feedback_entry["reason_code"] = feedback_reason_code
    stages.append(feedback_entry)

    # ------------------------------------------------------------------ #
    # Overall status + failure code
    # ------------------------------------------------------------------ #
    failure_code: Optional[str] = None
    needs_admin_attention = False

    required_failed = (
        prep_status == "failed" or privacy_stage == "failed" or analysis_stage == "failed"
    )

    if analysis_inconsistent:
        status = "failed"
        failure_code = "analysis_completed_without_assessment"
        needs_admin_attention = True
    elif required_failed:
        status = "failed"
        if privacy_stage == "failed":
            failure_code = str(video.get("privacy_error") or "privacy_failed")
        elif prep_status == "failed":
            failure_code = str(video.get("transcode_error") or "video_preparation_failed")
        else:
            failure_code = str(video.get("error_message") or "analysis_failed")
    elif privacy_stage == "blocked":
        status = "blocked"
        failure_code = "privacy_review_required"
    elif feedback_stage == "blocked" and analysis_done:
        status = "blocked"
        failure_code = feedback_reason_code or "feedback_pending_review"
    elif analysis_done and (feedback_done or feedback_stage in {"pending"}):
        # Review is effectively complete once analysis + assessment exist and
        # feedback is released. A "pending" feedback (released by default
        # pipeline) still counts as completed; "blocked" was handled above.
        if feedback_stage == "pending" and not feedback_done:
            # Analysis is done but feedback not yet released and not blocked —
            # treat as still processing the final step.
            status = "processing"
        else:
            status = "completed_degraded" if degraded else "completed"
    else:
        status = "processing"

    # ------------------------------------------------------------------ #
    # current_stage + percent
    # ------------------------------------------------------------------ #
    stage_status_by_key = {s["key"]: s["status"] for s in stages}

    def _first_stage_in(states: set) -> Optional[str]:
        for key in REVIEW_STAGE_KEYS:
            if key == "audio":
                continue  # audio never the headline stage
            if stage_status_by_key.get(key) in states:
                return key
        return None

    if status in {"completed", "completed_degraded"}:
        current_stage = "feedback"
    elif status == "failed":
        current_stage = _first_stage_in({"failed"}) or "analysis"
    elif status == "blocked":
        current_stage = _first_stage_in({"blocked"}) or "privacy"
    else:
        current_stage = (
            _first_stage_in({"processing"})
            or _first_stage_in({"pending"})
            or "analysis"
        )

    if status in {"completed", "completed_degraded"}:
        percent = 100
    else:
        earned = 0.0
        for key, weight in _STAGE_WEIGHTS.items():
            st = stage_status_by_key.get(key)
            if st == "completed":
                earned += weight
            elif st == "processing":
                earned += weight * 0.5
        percent = int(max(0, min(99, round(earned))))

    # ------------------------------------------------------------------ #
    # retry eligibility
    # ------------------------------------------------------------------ #
    retry_action: Optional[str] = None
    retry_eligible = False
    if privacy_stage == "failed":
        retry_action = "retry_privacy"
        retry_eligible = True
    elif prep_status == "failed":
        retry_action = "retry_transcode"
        retry_eligible = True
    elif analysis_stage == "failed":
        retry_action = "retry_analysis"
        retry_eligible = True

    # ------------------------------------------------------------------ #
    # Messages
    # ------------------------------------------------------------------ #
    teacher_message, admin_message = _build_messages(
        status=status,
        current_stage=current_stage,
        privacy_stage=privacy_stage,
        analysis_stage=analysis_stage,
        feedback_stage=feedback_stage,
        degraded=degraded,
        needs_admin_attention=needs_admin_attention,
        failure_code=failure_code,
        latest_error=latest_error,
        language=language,
    )

    return {
        "status": status,
        "percent": percent,
        "current_stage": current_stage,
        "teacher_message": teacher_message,
        "admin_message": admin_message,
        "stages": stages,
        "retry": {"eligible": retry_eligible, "action": retry_action},
        "needs_admin_attention": needs_admin_attention,
        "failure_code": failure_code,
        "feedback_reason_code": feedback_reason_code,
        "degraded": degraded,
        "degradation_reasons": degradation_reasons,
    }


def _build_messages(
    *,
    status: str,
    current_stage: str,
    privacy_stage: str,
    analysis_stage: str,
    feedback_stage: str,
    degraded: bool,
    needs_admin_attention: bool,
    failure_code: Optional[str],
    latest_error: Optional[str],
    language: str,
) -> Tuple[str, str]:
    hebrew = _is_hebrew(language)

    if status == "completed":
        if hebrew:
            return ("הבדיקה הושלמה והמשוב מוכן.", "Review complete; assessment and feedback are ready.")
        return (
            "Your review is complete. Your feedback is ready.",
            "Review complete; assessment and feedback are ready.",
        )

    if status == "completed_degraded":
        if hebrew:
            return (
                "הבדיקה הושלמה. הניתוח התבסס על וידאו בלבד.",
                "Review complete with reduced modalities (vision-only / fallback).",
            )
        return (
            "Your review is complete. This analysis was based on video only.",
            "Review complete but degraded (vision-only / paid analysis not available).",
        )

    if status == "failed":
        if needs_admin_attention:
            return (
                "We hit a problem finishing your review. Our team has been notified.",
                f"Inconsistent state needs admin attention: {failure_code or 'unknown'}.",
            )
        if privacy_stage == "failed":
            if hebrew:
                return (
                    "עיבוד הפרטיות נכשל. הצוות יבדוק וינסה שוב.",
                    f"Privacy blur failed: {latest_error or failure_code or 'unknown'}.",
                )
            return (
                "We couldn't finish privacy processing for this video. Our team will retry it.",
                f"Privacy blur failed: {latest_error or failure_code or 'unknown'}.",
            )
        return (
            "We hit a problem processing this video. Our team will retry it.",
            f"Processing failed: {latest_error or failure_code or 'unknown'}.",
        )

    if status == "blocked":
        if current_stage == "privacy":
            return (
                "Your video is being reviewed for privacy before analysis begins.",
                "Privacy review required before analysis can continue.",
            )
        if feedback_stage == "blocked":
            return (
                "Your review is almost ready and is going through a final quality check.",
                "Feedback is blocked pending human quality review before release.",
            )
        return (
            "Your review is waiting on a required step.",
            "Review is blocked on a required step.",
        )

    # processing
    if current_stage == "privacy":
        if hebrew:
            return ("הוידאו עובר טשטוש פרטיות.", "Privacy blur in progress.")
        return (
            "We're protecting privacy in your video. Analysis starts once this finishes.",
            "Privacy blur in progress.",
        )
    if current_stage == "analysis":
        return (
            "We're analyzing your lesson now. This usually takes a few minutes.",
            "AI analysis in progress.",
        )
    if current_stage == "video_preparation":
        return (
            "We're preparing your video for review.",
            "Video preparation (transcode) in progress.",
        )
    if current_stage == "feedback":
        return (
            "We're finalizing your feedback.",
            "Finalizing feedback release.",
        )
    return (
        "Your review is in progress.",
        "Review in progress.",
    )
