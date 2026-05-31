"""PR C9.5 PART 6 — review-progress feedback stage consumes the canonical view.

Contract C: a lesson's review progress must not claim "Feedback" done unless the
teacher can actually SEE feedback. The dangerous failure this locks is a stale
``feedback_release_status == "released"`` flag (or any heuristic) over-claiming
completion while the canonical :func:`get_teacher_visible_lesson_feedback` view
is still withholding the content. When the view is supplied it is the source of
truth, and every withheld / awaiting-release state carries a specific reason code
rather than a generic "done".
"""

from __future__ import annotations

from app.services.video_review_progress import build_video_review_progress


def _video(**overrides):
    base = {
        "status": "completed",
        "analysis_status": "completed",
        "privacy_status": "completed",
        "transcode_status": "not_required",
        "assessment_id": "a1",
    }
    base.update(overrides)
    return base


def _feedback_stage(progress):
    return next(s for s in progress["stages"] if s["key"] == "feedback")


def test_view_ready_marks_feedback_completed():
    progress = build_video_review_progress(
        _video(),
        teacher_feedback_view={"status": "ready", "feedback_available": True},
    )
    fb = _feedback_stage(progress)
    assert fb["status"] == "completed"
    assert progress["status"] == "completed"
    assert progress["feedback_reason_code"] is None


def test_view_awaiting_release_blocks_even_when_release_flag_says_released():
    # The video carries a stale "released" flag, but the canonical view is still
    # holding the feedback for admin release. Safety/truth must win.
    progress = build_video_review_progress(
        _video(feedback_release_status="released"),
        teacher_feedback_view={
            "status": "awaiting_admin_release",
            "feedback_available": False,
            "detail": "An administrator is doing a final check.",
        },
    )
    fb = _feedback_stage(progress)
    assert fb["status"] == "blocked"
    assert fb["reason_code"] == "feedback_awaiting_release"
    assert progress["status"] == "blocked"
    assert progress["failure_code"] == "feedback_awaiting_release"
    assert progress["feedback_reason_code"] == "feedback_awaiting_release"


def test_view_safety_withheld_blocks_with_specific_reason():
    progress = build_video_review_progress(
        _video(),
        teacher_feedback_view={"status": "safety_withheld", "feedback_available": False},
    )
    fb = _feedback_stage(progress)
    assert fb["status"] == "blocked"
    assert fb["reason_code"] == "safety_withheld"
    assert progress["failure_code"] == "safety_withheld"


def test_view_evidence_insufficient_blocks_with_specific_reason():
    progress = build_video_review_progress(
        _video(),
        teacher_feedback_view={
            "status": "evidence_insufficient",
            "feedback_available": False,
        },
    )
    assert _feedback_stage(progress)["reason_code"] == "evidence_insufficient"
    assert progress["feedback_reason_code"] == "evidence_insufficient"


def test_view_processing_marks_pending_not_done():
    progress = build_video_review_progress(
        _video(),
        teacher_feedback_view={"status": "processing", "feedback_available": False},
    )
    fb = _feedback_stage(progress)
    assert fb["status"] == "pending"
    assert progress["status"] == "processing"


def test_feedback_stays_blocked_until_analysis_done_even_with_ready_view():
    progress = build_video_review_progress(
        _video(status="processing", analysis_status="processing"),
        teacher_feedback_view={"status": "ready", "feedback_available": True},
    )
    # Feedback cannot precede analysis completion regardless of the view.
    assert _feedback_stage(progress)["status"] == "blocked"


def test_without_view_release_heuristic_still_completes():
    # Back-compat: callers that do not pass a view keep the prior behavior.
    progress = build_video_review_progress(_video(feedback_release_status="released"))
    assert _feedback_stage(progress)["status"] == "completed"
    assert progress["status"] == "completed"
