"""Unit + integration tests for PR C3 lesson moment evidence quality.

These tests use the exact production failure pattern reported in the C3
brief: a 1108.6-second video where the only persisted moment had
``representative_frame_sec: 923.8`` inside a ``1100``/``1108.6`` window, plus
duplicate ``923.8-943.8`` windows and timeline_coverage with near-zero
scoring features.

The test suite verifies that:

  * representative-frame validity is enforced
  * duplicate windows are removed and the higher-quality one is kept
  * timeline-coverage low-signal moments are quarantined from
    teacher-visible evidence
  * transcript-rich windows beat timeline-only windows for quality
  * the assessment quality block correctly blocks teacher feedback when
    evidence is weak
  * the assessment quality block permits teacher feedback when evidence is
    valid
  * the production "brief window" fallback text never counts as evidence
  * the audit script surfaces the expected issue codes
  * existing C2 teacher quarantine + C1 source-chain tests are unaffected
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import types
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

import server
from app.services.lesson_moment_quality import (
    ASSESSMENT_QUALITY_VERSION,
    LESSON_MOMENT_QUALITY_VERSION,
    assessment_quality_blocks_teacher_feedback,
    compute_assessment_quality,
    compute_moment_quality,
    dedupe_lesson_moments,
    detect_fallback_text,
    normalize_lesson_moment_window,
    specificity_score,
    suggested_candidate_window_count,
    validate_lesson_moment_timestamps,
)
from scripts.audit_lesson_evidence_quality import audit_collections


def _load_local_moment_sampler():
    path = Path(__file__).resolve().parents[1] / "moment_sampler.py"
    spec = importlib.util.spec_from_file_location("backend_moment_sampler_c3", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


_moment_sampler = _load_local_moment_sampler()


FORENSIC_VIDEO_ID = "f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f"
FORENSIC_ASSESSMENT_ID = "4bf34ab6-5d57-4837-a266-9ca79c1c473c"
FORENSIC_TEACHER_ID = "d36bcacb-fb19-4d97-8753-f0944131505b"
FORENSIC_DURATION_SEC = 1108.6


# ---------------------------------------------------------------------------
# 1. Representative frame correction / rejection
# ---------------------------------------------------------------------------


def test_representative_frame_outside_window_is_clamped_to_synthetic_midpoint():
    """The exact production failure: 1100-1108.6 window with rep_frame=923.8."""

    normalized = normalize_lesson_moment_window(
        {
            "start_sec": 1100,
            "end_sec": FORENSIC_DURATION_SEC,
            "representative_frame_sec": 923.8,
        },
        duration_sec=FORENSIC_DURATION_SEC,
    )

    assert normalized["start_sec"] == 1100.0
    assert normalized["end_sec"] == 1108.6
    rep = normalized["representative_frame_sec"]
    assert 1100.0 <= rep <= 1108.6, rep
    assert normalized["representative_frame_valid"] is False
    assert normalized["representative_frame_source"] == "synthetic_midpoint"


def test_representative_frame_inside_window_kept_as_real_frame():
    normalized = normalize_lesson_moment_window(
        {"start_sec": 100, "end_sec": 120, "representative_frame_sec": 110},
        duration_sec=600.0,
    )
    assert normalized["representative_frame_sec"] == 110.0
    assert normalized["representative_frame_valid"] is True
    assert normalized["representative_frame_source"] == "real_frame"


def test_representative_frame_replaced_with_synthetic_midpoint_when_outside_and_no_inwindow_frame():
    normalized = normalize_lesson_moment_window(
        {"start_sec": 100, "end_sec": 120, "representative_frame_sec": 125},
        duration_sec=600.0,
    )
    rep = normalized["representative_frame_sec"]
    assert 100.0 <= rep <= 120.0
    assert normalized["representative_frame_valid"] is False
    assert normalized["representative_frame_source"] == "synthetic_midpoint"


def test_normalize_uses_in_window_frame_when_available():
    """When a real frame falls inside the window we MUST prefer it."""

    normalized = normalize_lesson_moment_window(
        {"start_sec": 100, "end_sec": 120, "representative_frame_sec": 923.8},
        duration_sec=600.0,
        available_frames=[{"timestamp_sec": 108.0}, {"timestamp_sec": 200.0}],
    )
    assert normalized["representative_frame_sec"] == 108.0
    assert normalized["representative_frame_valid"] is True


def test_validate_timestamps_reports_production_pattern():
    issues = validate_lesson_moment_timestamps(
        {
            "start_sec": 1100,
            "end_sec": FORENSIC_DURATION_SEC,
            "representative_frame_sec": 923.8,
        },
        duration_sec=FORENSIC_DURATION_SEC,
    )
    assert "representative_frame_outside_window" in issues


# ---------------------------------------------------------------------------
# 2. Duplicate moment dedupe
# ---------------------------------------------------------------------------


def test_duplicate_923_943_moments_collapse_to_one():
    moments = [
        {
            "moment_id": "weak",
            "start_sec": 923.8,
            "end_sec": 943.8,
            "score": 0.0267,
            "supporting_features": {"raw_selection_score": 0.0, "average_selection_score": 0.0},
        },
        {
            "moment_id": "stronger",
            "start_sec": 923.8,
            "end_sec": 943.8,
            "score": 0.12,
            "supporting_features": {"raw_selection_score": 0.3, "average_selection_score": 0.2},
        },
    ]
    kept, dropped = dedupe_lesson_moments(moments)
    assert len(kept) == 1
    assert kept[0]["moment_id"] == "stronger"
    assert len(dropped) == 1
    assert dropped[0]["moment_id"] == "weak"
    assert dropped[0]["deduped_from"] == "stronger"


def test_dedupe_treats_high_overlap_as_duplicate():
    moments = [
        {"moment_id": "a", "start_sec": 100, "end_sec": 120, "score": 0.1},
        {"moment_id": "b", "start_sec": 101, "end_sec": 121, "score": 0.5},
    ]
    kept, dropped = dedupe_lesson_moments(moments)
    assert {m["moment_id"] for m in kept} == {"b"}
    assert {m["moment_id"] for m in dropped} == {"a"}


def test_dedupe_keeps_distinct_windows():
    moments = [
        {"moment_id": "a", "start_sec": 0, "end_sec": 20, "score": 0.3},
        {"moment_id": "b", "start_sec": 200, "end_sec": 220, "score": 0.4},
        {"moment_id": "c", "start_sec": 500, "end_sec": 520, "score": 0.5},
    ]
    kept, dropped = dedupe_lesson_moments(moments)
    assert {m["moment_id"] for m in kept} == {"a", "b", "c"}
    assert dropped == []


# ---------------------------------------------------------------------------
# 3. Low-signal timeline-coverage gating
# ---------------------------------------------------------------------------


def test_low_signal_timeline_coverage_is_marked_fallback_and_not_visible():
    moment = {
        "selection_reason": "timeline_coverage",
        "supporting_features": {
            "raw_selection_score": 0,
            "average_selection_score": 0,
            "participant_density_score": 0,
            "board_text_density_score": 0,
            "teacher_prominence_score": 0,
            "evidence_density_score": 0.3333,
        },
    }
    quality = compute_moment_quality(moment, has_transcript_globally=False)
    assert quality["version"] == LESSON_MOMENT_QUALITY_VERSION
    assert quality["is_timeline_fallback"] is True
    assert quality["teacher_visible_candidate"] is False
    assert quality["confidence"] < 0.2
    assert "timeline_coverage_low_signal" in quality["quality_reasons"]


def test_evidence_rich_window_is_teacher_visible():
    moment = {
        "selection_reason": "participant_density_change",
        "supporting_features": {
            "raw_selection_score": 0.74,
            "average_selection_score": 0.68,
            "participant_density_score": 0.55,
            "board_text_density_score": 0.4,
            "teacher_prominence_score": 0.5,
            "evidence_density_score": 0.6,
        },
        "summary": "Students worked in pairs and one student explained how they solved the multiplication problem on the board.",
        "representative_frame_valid": True,
    }
    quality = compute_moment_quality(moment, has_transcript_globally=True)
    assert quality["teacher_visible_candidate"] is True
    assert quality["is_timeline_fallback"] is False
    assert quality["confidence"] >= 0.35


# ---------------------------------------------------------------------------
# 4. Transcript-rich candidate preferred
# ---------------------------------------------------------------------------


def test_transcript_rich_moment_scores_higher_than_timeline_only():
    """The transcript-rich window must dominate when both options exist."""

    timeline_only = compute_moment_quality(
        {
            "selection_reason": "timeline_coverage",
            "supporting_features": {
                "raw_selection_score": 0,
                "average_selection_score": 0,
                "participant_density_score": 0,
                "board_text_density_score": 0,
                "teacher_prominence_score": 0,
                "evidence_density_score": 0,
            },
        },
        has_transcript_globally=True,
    )
    transcript_rich = compute_moment_quality(
        {
            "selection_reason": "participant_density_change",
            "supporting_features": {
                "raw_selection_score": 0.3,
                "average_selection_score": 0.25,
                "participant_density_score": 0.5,
                "board_text_density_score": 0.2,
                "teacher_prominence_score": 0.3,
                "evidence_density_score": 0.4,
            },
            "summary": "You asked who could explain the next step and Maya shared with the class.",
        },
        transcript_segments=[
            {"start_sec": 100, "end_sec": 110, "text": "Who can explain the next step?"},
            {"start_sec": 110, "end_sec": 118, "text": "I think because the answer needs to be doubled."},
        ],
        has_transcript_globally=True,
    )
    assert transcript_rich["confidence"] > timeline_only["confidence"]
    assert transcript_rich["transcript_signal_score"] > 0
    assert transcript_rich["teacher_visible_candidate"] is True
    assert timeline_only["teacher_visible_candidate"] is False


# ---------------------------------------------------------------------------
# 5. Assessment quality insufficient with weak evidence
# ---------------------------------------------------------------------------


def test_assessment_quality_blocks_teacher_feedback_when_only_timeline_fallback():
    moments = [
        {"quality": compute_moment_quality({"selection_reason": "timeline_coverage", "supporting_features": {}}, has_transcript_globally=False)}
        for _ in range(6)
    ]
    element_scores = [
        {
            "confidence": 25.0,
            "observations": ["The clip gave us a brief window into your lesson — here is what stood out."],
            "evidence_segments": [
                {"summary": "The clip gave us a brief window into this lesson — here is what stood out.", "rationale": "fallback"}
            ],
        }
    ]
    quality = compute_assessment_quality(
        moments=moments,
        transcript_doc=None,
        feature_doc=None,
        element_scores=element_scores,
    )
    assert quality["version"] == ASSESSMENT_QUALITY_VERSION
    assert quality["evidence_sufficient"] is False
    assert quality["teacher_feedback_allowed"] is False
    assert quality["fallback_text_used"] is True
    assert "all_element_scores_fallback" in quality["quality_reasons"]


# ---------------------------------------------------------------------------
# 6. Assessment quality sufficient when evidence valid
# ---------------------------------------------------------------------------


def test_assessment_quality_allows_teacher_feedback_when_evidence_present():
    moment_quality_block = compute_moment_quality(
        {
            "selection_reason": "participant_density_change",
            "supporting_features": {
                "raw_selection_score": 0.74,
                "average_selection_score": 0.68,
                "participant_density_score": 0.55,
                "board_text_density_score": 0.4,
                "teacher_prominence_score": 0.5,
                "evidence_density_score": 0.6,
            },
            "summary": "Students worked in pairs and one student explained how they solved the multiplication problem on the board.",
            "representative_frame_valid": True,
        },
        has_transcript_globally=True,
        transcript_segments=[
            {"text": "Who can explain how you got that answer?"},
            {"text": "I added the numbers and then doubled them."},
        ],
    )
    moments = [{"quality": moment_quality_block}, {"quality": moment_quality_block}]
    element_scores = [
        {
            "confidence": 75.0,
            "observations": ["You opened the lesson with a clear prompt and gave students room to think."],
            "evidence_segments": [{"summary": "You asked Maya to extend her answer.", "rationale": "model-observed"}],
        }
    ]
    transcript_doc = {
        "transcript_status": "completed",
        "segments": [{"text": "Maya"}, {"text": "explain"}],
    }
    quality = compute_assessment_quality(
        moments=moments,
        transcript_doc=transcript_doc,
        feature_doc={"teacher_talk_ratio": 0.6, "turns_count": 12},
        element_scores=element_scores,
    )
    assert quality["evidence_sufficient"] is True
    assert quality["teacher_feedback_allowed"] is True
    assert quality["usable_moment_count"] >= 2


# ---------------------------------------------------------------------------
# 7. Generic fallback text never counts as evidence
# ---------------------------------------------------------------------------


def test_fallback_text_detection_matches_production_phrases():
    assert detect_fallback_text(
        "The clip gave us a brief window into your lesson — here is what stood out."
    )
    assert detect_fallback_text(
        "Plan a targeted coaching cycle for Using Questioning and Discussion Techniques"
    )
    assert detect_fallback_text("Evidence was limited in the sampled frames.")
    assert detect_fallback_text("The clip we had was brief — here is what stood out in that window.")
    assert not detect_fallback_text(
        "You opened the lesson with a clear question and waited for students to respond."
    )


def test_fallback_text_drops_specificity_score():
    assert specificity_score(
        "You moved to the board and asked Maya to explain how she solved the problem."
    ) > 0.4
    assert specificity_score(
        "The clip gave us a brief window into your lesson — here is what stood out."
    ) <= 0.1


def test_fallback_text_makes_moment_not_teacher_visible():
    moment = {
        "selection_reason": "evidence_rich",
        "supporting_features": {
            "raw_selection_score": 0.6,
            "average_selection_score": 0.5,
            "participant_density_score": 0.4,
            "board_text_density_score": 0.3,
            "teacher_prominence_score": 0.4,
            "evidence_density_score": 0.5,
        },
        "summary": "The clip gave us a brief window into your lesson — here is what stood out.",
    }
    quality = compute_moment_quality(moment)
    assert quality["fallback_text_used"] is True
    assert quality["teacher_visible_candidate"] is False
    assert "fallback_text_used" in quality["quality_reasons"]


# ---------------------------------------------------------------------------
# 8. Audit script detects evidence-quality problems
# ---------------------------------------------------------------------------


def test_audit_script_surfaces_known_issue_codes():
    moment_manifest = {
        "video_id": FORENSIC_VIDEO_ID,
        "moments": [
            {
                "moment_id": "moment_06",
                "start_sec": 1100,
                "end_sec": FORENSIC_DURATION_SEC,
                "representative_frame_sec": 923.8,
                "quality": compute_moment_quality(
                    {
                        "selection_reason": "timeline_coverage",
                        "supporting_features": {},
                    },
                    has_transcript_globally=False,
                ),
            },
            {
                "moment_id": "moment_03",
                "start_sec": 923.8,
                "end_sec": 943.8,
                "representative_frame_sec": 933.8,
            },
            {
                "moment_id": "moment_04",
                "start_sec": 923.8,
                "end_sec": 943.8,
                "representative_frame_sec": 933.8,
            },
        ],
    }
    assessment = {
        "id": FORENSIC_ASSESSMENT_ID,
        "video_id": FORENSIC_VIDEO_ID,
        # No analysis_quality block — legacy assessment.
    }
    blocked = {
        "id": "blocked-1",
        "video_id": FORENSIC_VIDEO_ID,
        "analysis_quality": {
            "version": ASSESSMENT_QUALITY_VERSION,
            "teacher_feedback_allowed": False,
            "quality_reasons": ["no_usable_moments"],
        },
    }
    report = audit_collections(
        {
            "video_analysis_moments": [moment_manifest],
            "assessments": [assessment, blocked],
            "videos": [{"id": FORENSIC_VIDEO_ID, "duration_sec": FORENSIC_DURATION_SEC}],
        }
    )
    issue_codes = set((report.get("issues") or {}).keys())
    assert "moment_representative_frame_outside_window" in issue_codes
    assert "moment_duplicate_window" in issue_codes
    assert "moment_timeline_coverage_low_signal" in issue_codes
    assert "assessment_missing_analysis_quality" in issue_codes
    assert "assessment_teacher_feedback_blocked" in issue_codes


# ---------------------------------------------------------------------------
# 9. Suggested candidate count for long videos
# ---------------------------------------------------------------------------


def test_long_video_suggests_more_candidates_than_short_video():
    short = suggested_candidate_window_count(120)
    long = suggested_candidate_window_count(FORENSIC_DURATION_SEC)
    assert long > short
    # 1108 / 45 ~= 24
    assert long >= 12


# ---------------------------------------------------------------------------
# 10. moment_sampler integration: no representative_frame outside window
# ---------------------------------------------------------------------------


def test_score_windows_never_emits_representative_frame_outside_window():
    """Frames live nowhere near the closure window — sampler must not borrow."""

    windows = [
        {"start_sec": 0.0, "end_sec": 20.0, "duration_sec": 20.0},
        {"start_sec": 1100.0, "end_sec": 1108.6, "duration_sec": 8.6},
    ]
    frames = [
        {
            "timestamp_sec": 10.0,
            "selection_score": 0.5,
            "selection_reason": "teacher_prominence",
            "selection_features": {"teacher_prominence_score": 0.7},
        },
    ]
    scored = _moment_sampler.score_windows(windows, frames)
    closure_window = scored[-1]
    assert closure_window["start_sec"] == 1100.0
    rep = float(closure_window["representative_frame_sec"])
    assert 1100.0 <= rep <= 1108.6, rep
    assert closure_window["representative_frame_valid"] is False
    assert closure_window["representative_frame_source"] == "synthetic_midpoint"


# ---------------------------------------------------------------------------
# 11. Teacher projection refuses to render when analysis_quality blocks it
# ---------------------------------------------------------------------------


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, *args, **_kwargs):
        return self

    def limit(self, n):
        self.docs = self.docs[: int(n)]
        return self

    async def to_list(self, limit=None):
        return list(self.docs) if limit is None else list(self.docs)[: int(limit)]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None, **_kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return dict(doc)
        return None

    def find(self, query=None, projection=None, **_kwargs):
        return _Cursor([dict(doc) for doc in self.docs if self._matches(doc, query or {})])

    async def update_one(self, query, update, **_kwargs):
        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    def _matches(self, doc, query):
        for key, expected in (query or {}).items():
            actual = doc.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and actual not in expected["$in"]:
                    return False
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                continue
            if actual != expected:
                return False
        return True


def test_projection_returns_none_when_analysis_quality_blocks_teacher_feedback(monkeypatch):
    fake_db = types.SimpleNamespace(
        videos=_Collection([{"id": FORENSIC_VIDEO_ID, "teacher_id": FORENSIC_TEACHER_ID}]),
        assessments=_Collection(
            [
                {
                    "id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "summary": "Some text",
                    "analysis_quality": {
                        "version": ASSESSMENT_QUALITY_VERSION,
                        "teacher_feedback_allowed": False,
                        "evidence_sufficient": False,
                        "quality_reasons": ["no_usable_moments"],
                    },
                }
            ]
        ),
        coaching_task_reflections=_Collection(),
    )
    monkeypatch.setattr(server, "db", fake_db)

    projection = asyncio.run(
        server._teacher_projection_for_assessment(
            {"id": FORENSIC_TEACHER_ID},
            {"id": "user-1", "tenant_role": "teacher", "teacher_id": FORENSIC_TEACHER_ID},
            fake_db.assessments.docs[0],
            video=fake_db.videos.docs[0],
        )
    )
    assert projection is None


def test_projection_allows_teacher_feedback_when_quality_allows(monkeypatch):
    """Without the explicit teacher_feedback_allowed=False guard, valid
    assessments still produce a projection. This is the no-false-blocking
    side of the gate."""

    fake_db = types.SimpleNamespace(
        videos=_Collection([{"id": "v-good", "teacher_id": FORENSIC_TEACHER_ID, "lesson_title": "Fractions"}]),
        assessments=_Collection(
            [
                {
                    "id": "a-good",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": "v-good",
                    "summary": "You opened the lesson with a clear question.",
                    "recommendations": ["Try asking one student to build on a partner's answer."],
                    "analysis_quality": {
                        "version": ASSESSMENT_QUALITY_VERSION,
                        "teacher_feedback_allowed": True,
                        "evidence_sufficient": True,
                        "usable_moment_count": 3,
                    },
                }
            ]
        ),
        coaching_task_reflections=_Collection(),
    )
    monkeypatch.setattr(server, "db", fake_db)

    projection = asyncio.run(
        server._teacher_projection_for_assessment(
            {"id": FORENSIC_TEACHER_ID},
            {"id": "user-1", "tenant_role": "teacher", "teacher_id": FORENSIC_TEACHER_ID},
            fake_db.assessments.docs[0],
            video=fake_db.videos.docs[0],
        )
    )
    assert projection is not None
    assert assessment_quality_blocks_teacher_feedback(fake_db.assessments.docs[0]) is False


# ---------------------------------------------------------------------------
# 12. C1 / C2 regression guard
# ---------------------------------------------------------------------------


def test_c2_quarantine_module_helpers_still_importable():
    """Smoke check: C3 must not break the C2 import surface."""

    from app.services.teacher_artifact_quarantine import (
        build_source_validity,
        find_unsafe_text_issues,
        is_teacher_visible_text_safe,
        reject_unsafe_teacher_payload,
    )

    assert callable(build_source_validity)
    assert callable(find_unsafe_text_issues)
    assert callable(is_teacher_visible_text_safe)
    assert callable(reject_unsafe_teacher_payload)


def test_c1_source_chain_audit_still_importable():
    from scripts.audit_video_source_chain import audit_documents, repair_mark_documents

    assert callable(audit_documents)
    assert callable(repair_mark_documents)
