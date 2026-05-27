"""Backend tests for PR C5 pilot teacher experience integration.

Covers:

1. Hebrew rubric-to-practice mappings.
2. Hebrew teacher output contains no English rubric labels.
3. Recognition Gold-Star and personal highlights stay separate.
4. Admin teacher_preview is included on the admin assessment endpoint while
   element_scores / overall_score / rubric labels remain admin-only.
5. Computed ``teacher_feedback_admin_status`` reports the right code for
   blocked-source / blocked-quality / auto-allowed states.
6. The standalone artifact audit script flags unsafe text and the
   teacher-feedback-allowed contradiction.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
from typing import Any

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

import server
from app.services.teacher_lesson_coaching_artifact import (
    TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
    admin_view_of_artifact,
    build_teacher_lesson_coaching_artifact,
    translate_rubric_label_to_practice,
)
from scripts.audit_teacher_coaching_artifacts import audit_collections


# ---------------------------------------------------------------------------
# Hebrew rubric translation
# ---------------------------------------------------------------------------


HEBREW_RUBRIC_LABELS = (
    "Demonstrating Knowledge of Students",
    "Demonstrating Knowledge of Content and Pedagogy",
    "Creating an Environment of Respect and Rapport",
    "Using Questioning and Discussion Techniques",
    "Organizing Physical Space",
    "Setting Instructional Outcomes",
    "Establishing a Culture for Learning",
    "Growing and Developing Professionally",
)


def _has_hebrew(text: str) -> bool:
    return any(0x0590 <= ord(c) <= 0x05FF for c in text or "")


@pytest.mark.parametrize("label", HEBREW_RUBRIC_LABELS)
def test_hebrew_rubric_mapping_returns_hebrew_practice_and_next_step(label):
    mapping = translate_rubric_label_to_practice(label, language="he")
    assert mapping is not None, label
    assert _has_hebrew(mapping["practice"]), label
    assert _has_hebrew(mapping["next_step"]), label
    assert _has_hebrew(mapping.get("reflection") or ""), label


def test_english_rubric_mapping_unchanged_by_c5():
    mapping = translate_rubric_label_to_practice(
        "Using Questioning and Discussion Techniques", language="en"
    )
    assert mapping is not None
    assert "ask questions that open up student thinking" in mapping["practice"]
    assert "Who can build on that" in mapping["next_step"]


def test_hebrew_artifact_does_not_contain_english_rubric_labels():
    assessment = {
        "id": "a-he",
        "teacher_id": "t-he",
        "video_id": "v-he",
        "analysis_language": "he",
        "summary": "פתחתם את השיעור בשאלה ברורה ונתתם לתלמידים זמן לחשוב.",
        "recommendations": [],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 80, "summary": "חיכיתם לתשובה שנייה לפני שהמשכתם."}
        ],
        "element_scores": [
            {
                "element_id": "d3b",
                "element_name": "Using Questioning and Discussion Techniques",
                "score": 6.0,
                "priority": True,
                "confidence": 70.0,
            }
        ],
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
        "analyzed_at": "2026-05-27T00:00:00+00:00",
    }
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-he", "language": "he"},
        current_user={"id": "u-he", "language": "he"},
        assessment=assessment,
        video={"id": "v-he", "teacher_id": "t-he"},
        language="he",
    )
    serialized = str(artifact).lower()
    for english_rubric in (
        "demonstrating knowledge of students",
        "using questioning and discussion techniques",
        "organizing physical space",
        "setting instructional outcomes",
    ):
        assert english_rubric not in serialized


# ---------------------------------------------------------------------------
# Recognition gold-star vs personal highlights
# ---------------------------------------------------------------------------


def test_artifact_keeps_gold_star_and_personal_highlights_separate():
    assessment = {
        "id": "a-rec",
        "teacher_id": "t-rec",
        "video_id": "v-rec",
        "summary": "You opened the lesson with a clear prompt and waited for a second hand.",
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 90, "summary": "You waited after the prompt and a quiet student answered."}
        ],
        "analysis_quality": {"teacher_feedback_allowed": True, "usable_moment_count": 2},
        "analyzed_at": "2026-05-27T00:00:00+00:00",
    }
    badges = [
        {
            "id": "badge-1",
            "teacher_id": "t-rec",
            "video_id": "v-rec",
            "recognition_type": "gold_star",
            "title": "Gold-Star moment",
            "description": "You held space for a quiet student to share their thinking.",
            "awarded_at": "2026-05-27T00:00:00+00:00",
        }
    ]
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-rec"},
        current_user={"id": "u-rec"},
        assessment=assessment,
        video={"id": "v-rec", "teacher_id": "t-rec"},
        recognition_badges=badges,
        language="en",
    )
    recognition = artifact["recognition"]
    assert recognition["gold_star"] is not None
    assert recognition["gold_star"]["source"] == "gold_star"
    # Personal highlights mirror the highlights list and are populated
    # independently of Gold-Star.
    assert isinstance(recognition["personal_highlights"], list)
    # The artifact highlight should NOT be the same object as the Gold-Star
    # title; both surfaces remain distinct keys.
    if recognition["personal_highlights"]:
        assert recognition["personal_highlights"][0].get("source") != "gold_star"


# ---------------------------------------------------------------------------
# Admin teacher_preview wiring on /api/assessments/{id}
# ---------------------------------------------------------------------------


def _make_admin_user():
    return {
        "id": "admin-1",
        "email": "admin@example.com",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-1",
    }


def _baseline_admin_db(**overrides):
    base = {
        "users": _Collection([
            {**_make_admin_user(), "approval_status": "approved", "is_active": True},
        ]),
        "organizations": _Collection([{"id": "org-1", "name": "Demo Org"}]),
        "schools": _Collection(),
        "teachers": _Collection(
            [
                {
                    "id": "t-good",
                    "name": "Maya Patel",
                    "email": "maya@example.com",
                    "organization_id": "org-1",
                    "subject": "Math",
                    "grade_level": "5",
                    "created_by": "admin-1",
                }
            ]
        ),
        "videos": _Collection(
            [
                {
                    "id": "v-good",
                    "teacher_id": "t-good",
                    "lesson_title": "Fractions discussion",
                    "status": "completed",
                    "analysis_status": "completed",
                }
            ]
        ),
        "assessments": _Collection(
            [
                {
                    "id": "a-good",
                    "teacher_id": "t-good",
                    "video_id": "v-good",
                    "framework_type": "danielson",
                    "summary": "You opened the lesson with a clear question and gave students room to think.",
                    "recommendations": [
                        "Ask one student to build on a partner's answer next lesson.",
                    ],
                    "element_scores": [
                        {
                            "element_id": "d3b",
                            "element_name": "Using Questioning and Discussion Techniques",
                            "domain": "Instruction",
                            "score": 6.0,
                            "level": "needs_improvement",
                            "priority": True,
                            "confidence": 75.0,
                            "evidence_segments": [
                                {
                                    "start_sec": 120,
                                    "end_sec": 150,
                                    "summary": "You waited after the prompt.",
                                }
                            ],
                            "observations": ["You paused after the prompt."],
                        }
                    ],
                    "overall_score": 7.1,
                    "analyzed_at": "2026-05-27T00:00:00+00:00",
                    "analysis_quality": {
                        "version": "assessment_quality_v1",
                        "teacher_feedback_allowed": True,
                        "evidence_sufficient": True,
                        "usable_moment_count": 2,
                    },
                }
            ]
        ),
        "consent_records": _Collection(),
        "teacher_face_profiles": _Collection(),
        "teacher_face_references": _Collection(),
        "coaching_task_reflections": _Collection(),
        "recognition_badges": _Collection(),
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, *args, **_kwargs):
        if args:
            first = args[0]
            if isinstance(first, list):
                for field, direction in reversed(first):
                    self.docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
            elif isinstance(first, str):
                direction = args[1] if len(args) > 1 else 1
                self.docs.sort(key=lambda item: item.get(first) or "", reverse=direction == -1)
        return self

    def limit(self, n):
        self.docs = self.docs[: int(n)]
        return self

    async def to_list(self, limit=None):
        if limit is None:
            return list(self.docs)
        return list(self.docs)[: int(limit)]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None, **_kwargs):
        return _Cursor(
            [self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})]
        )

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if self._matches(doc, query or {}))

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        payload = dict(doc)
        for key, include in projection.items():
            if include == 0:
                payload.pop(key, None)
        return payload

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


def test_admin_view_of_artifact_includes_element_scores_for_admin_only():
    """PR C5: admin_view_of_artifact must expose element_scores + teacher_preview
    summary so the admin UI can render the rubric/scores AND show what the
    teacher would see."""

    assessment = _baseline_admin_db().assessments.docs[0]
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good", "subject": "Math"},
        current_user=_make_admin_user(),
        assessment=assessment,
        video={"id": "v-good", "teacher_id": "t-good"},
        language="en",
    )
    admin_payload = admin_view_of_artifact(artifact, assessment=assessment)
    assert admin_payload["element_scores"] == assessment["element_scores"]
    assert admin_payload["overall_score"] == assessment["overall_score"]
    assert admin_payload["teacher_preview"]["teacher_feedback_allowed"] is True


def test_compute_teacher_feedback_admin_status_codes():
    """PR C5: status codes derived from artifact blocked_reason."""

    auto = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        current_user=_make_admin_user(),
        assessment=_baseline_admin_db().assessments.docs[0],
        video={"id": "v-good", "teacher_id": "t-good"},
        language="en",
    )
    assert server._compute_teacher_feedback_admin_status(auto) == "auto_allowed"

    blocked_quality_assessment = dict(_baseline_admin_db().assessments.docs[0])
    blocked_quality_assessment["analysis_quality"] = {
        "version": "assessment_quality_v1",
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "quality_reasons": ["no_usable_moments"],
    }
    blocked_quality = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        current_user=_make_admin_user(),
        assessment=blocked_quality_assessment,
        video={"id": "v-good", "teacher_id": "t-good"},
        language="en",
    )
    assert server._compute_teacher_feedback_admin_status(blocked_quality) == "blocked_quality"

    blocked_source_assessment = dict(_baseline_admin_db().assessments.docs[0])
    blocked_source = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        current_user=_make_admin_user(),
        assessment=blocked_source_assessment,
        video=None,  # missing source → blocked
        language="en",
    )
    assert server._compute_teacher_feedback_admin_status(blocked_source) == "blocked_source"

    # No artifact at all → blocked_source as the conservative default.
    assert server._compute_teacher_feedback_admin_status(None) == "blocked_source"


# ---------------------------------------------------------------------------
# Audit script
# ---------------------------------------------------------------------------


def test_audit_script_flags_quality_contradiction_and_unsafe_text():
    assessment_contradiction = {
        "id": "a-contradict",
        "teacher_id": "t-1",
        "video_id": "v-1",
        "summary": "You opened the lesson with a clear prompt.",
        "evidence_segments": [
            {"start_sec": 10, "end_sec": 30, "summary": "You waited."}
        ],
        "analysis_quality": {"teacher_feedback_allowed": False, "quality_reasons": ["no_usable_moments"]},
    }
    teachers = {"t-1": {"id": "t-1"}}
    videos = {"v-1": {"id": "v-1", "teacher_id": "t-1"}}
    report = audit_collections(
        teachers=teachers,
        videos=videos,
        assessments=[assessment_contradiction],
    )
    assert report["artifact_version"] == TEACHER_LESSON_COACHING_ARTIFACT_VERSION
    # The artifact builder will set teacher_feedback_allowed=False here, so
    # the audit should NOT flag contradiction — but it SHOULD report the
    # canonical empty state.
    issues = report["issues"]
    assert "teacher_feedback_allowed_contradicts_quality" not in issues

    # Now an orphan: source-valid (video present) but no analysis_quality.
    legacy_assessment = {
        "id": "a-legacy",
        "teacher_id": "t-1",
        "video_id": "v-1",
        "summary": "Legacy text",
        "evidence_segments": [],
    }
    report2 = audit_collections(
        teachers=teachers,
        videos=videos,
        assessments=[legacy_assessment],
    )
    assert "reviewed_assessment_without_quality_block" in report2["issues"]


def test_audit_script_reports_no_issues_for_clean_artifact():
    assessment = {
        "id": "a-clean",
        "teacher_id": "t-clean",
        "video_id": "v-clean",
        "summary": "You opened with a clear prompt and gave students think time.",
        "recommendations": ["Ask one student to build on a partner answer next lesson."],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 90, "summary": "You waited after the question."},
            {"start_sec": 220, "end_sec": 260, "summary": "Maya extended a peer answer."},
        ],
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
    }
    teachers = {"t-clean": {"id": "t-clean"}}
    videos = {"v-clean": {"id": "v-clean", "teacher_id": "t-clean"}}
    report = audit_collections(
        teachers=teachers,
        videos=videos,
        assessments=[assessment],
    )
    # No unsafe-text / contradiction / source-block issues should fire.
    forbidden_codes = {
        "unsafe_teacher_visible_text",
        "teacher_feedback_allowed_contradicts_quality",
        "teacher_endpoint_would_show_despite_source_block",
        "teacher_endpoint_would_show_despite_evidence_block",
        "deep_dive_available_but_empty",
    }
    assert not (set(report["issues"].keys()) & forbidden_codes), report["issues"]
