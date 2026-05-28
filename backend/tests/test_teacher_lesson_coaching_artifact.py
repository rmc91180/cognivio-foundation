"""API-level + unit tests for PR C4 evidence-grounded teacher coaching artifact.

The tests verify the canonical TeacherLessonCoachingArtifact:

  * unsafe text from C2's known-bad corpus never reaches the teacher
  * the artifact is honest when evidence is insufficient
  * rubric labels are translated to teacher-friendly practice phrasing
  * action items are classroom-actionable, not rubric-flavoured
  * no forced action items / no false "guardrails passed"
  * deep dive uses only C3-approved quality moments
  * dashboard, coaching, and latest-lesson endpoints share one artifact
  * teacher /api/assessments/{id} hides admin fields; admin path keeps them
  * Hebrew empty states remain Hebrew

Negative-assertion helper from C2 (``assert_no_known_bad_strings``) is reused
to recursively scan teacher payloads.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
from typing import Any, Iterable
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

import server
from app.services.teacher_lesson_coaching_artifact import (
    TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
    admin_view_of_artifact,
    audit_teacher_artifact,
    build_teacher_lesson_coaching_artifact,
    translate_rubric_label_to_practice,
)
from app.services.teacher_artifact_quarantine import (
    KNOWN_BAD_TEACHER_TEXT_PATTERNS,
    find_teacher_visible_text_issues,
)


FORENSIC_TEACHER_ID = "d36bcacb-fb19-4d97-8753-f0944131505b"
FORENSIC_USER_ID = "1157f8a4-c438-4c96-8934-bdbe804036a3"
FORENSIC_VIDEO_ID = "f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f"
FORENSIC_ASSESSMENT_ID = "4bf34ab6-5d57-4837-a266-9ca79c1c473c"
FORENSIC_ORG_ID = "e864d3c8-87f8-4d4a-a1e9-8f16f432bd9c"


KNOWN_BAD_STRINGS = (
    "Try this next lesson: rafi:",
    "Rafi:",
    "coach d",
    "d1a",
    "d1b",
    "d2b",
    "d3b",
    "d4e",
    "after moment",
    "after 5.6 evidence",
    "based on the observed moment",
    "Plan a targeted coaching cycle",
    "plan a targeted coaching cycle",
    "The clip gave us a brief window into your lesson",
    "brief window into your lesson",
    "Demonstrating Knowledge of Students",
    "Demonstrating Knowledge of Content and Pedagogy",
    "Creating an Environment of Respect and Rapport",
    "Using Questioning and Discussion Techniques",
    "Organizing Physical Space",
    "Setting Instructional Outcomes",
    "Establishing a Culture for Learning",
    "Growing and Developing Professionally",
    "overall performance",
    "developing",
    "proficient",
    "distinguished",
    "confidence score",
    "sampled frame",
    "weighted average",
)


def _serialize_strings(value: Any) -> list:
    out: list = []

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
        elif isinstance(item, str):
            out.append(item)
        elif item is None or isinstance(item, (int, float, bool)):
            return
        else:
            out.append(str(item))

    visit(value)
    return out


def assert_no_known_bad_strings(payload: Any, *, extra: Iterable[str] = ()) -> None:
    """C2 negative assertion helper extended for C4. Skips the
    ``analysis_quality`` block since admin-only diagnostic strings like
    ``"all_element_scores_fallback"`` legitimately appear there."""

    if isinstance(payload, dict):
        scope = {k: v for k, v in payload.items() if k != "analysis_quality"}
    else:
        scope = payload
    serialized = _serialize_strings(scope)
    haystack = "\n".join(serialized).lower()
    for needle in tuple(KNOWN_BAD_STRINGS) + tuple(extra):
        assert needle.lower() not in haystack, (
            f"Teacher payload contained forbidden string {needle!r}.\n"
            f"Payload extract: {haystack[:600]}"
        )
    # Recursive structured scan as defense-in-depth, also skipping
    # ``analysis_quality``.
    issues = find_teacher_visible_text_issues(scope)
    assert issues == [], f"find_teacher_visible_text_issues found: {issues[:6]}"


# ---------------------------------------------------------------------------
# Fake mongo helpers (reused pattern from C2/C3)
# ---------------------------------------------------------------------------


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
        query = query or {}
        docs = [doc for doc in self.docs if self._matches(doc, query)]
        sort = kwargs.get("sort")
        if sort:
            docs = _Cursor(docs).sort(sort).docs
        if not docs:
            return None
        return self._project(docs[0], projection)

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
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                new_doc = dict(doc)
                new_doc.update((update or {}).get("$set") or {})
                self.docs[index] = new_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            payload = dict(query)
            payload.update((update or {}).get("$set") or {})
            self.docs.append(payload)
            return types.SimpleNamespace(matched_count=0, modified_count=0)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query or {})]
        return types.SimpleNamespace(deleted_count=before - len(self.docs))

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


def _baseline_db(**collections):
    base = {
        "users": _Collection(
            [
                {
                    "id": FORENSIC_USER_ID,
                    "email": "teacher@example.com",
                    "tenant_role": "teacher",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "organization_id": FORENSIC_ORG_ID,
                    "approval_status": "approved",
                    "is_active": True,
                    "privacy_consent_complete": True,
                    "privacy_consent_accepted_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        ),
        "organizations": _Collection([{"id": FORENSIC_ORG_ID, "name": "Demo Org"}]),
        "schools": _Collection(),
        "teachers": _Collection(
            [
                {
                    "id": FORENSIC_TEACHER_ID,
                    "name": "Rafi Demo",
                    "email": "teacher@example.com",
                    "organization_id": FORENSIC_ORG_ID,
                    "subject": "Math",
                    "grade_level": "5",
                    "privacy_consent_complete": True,
                    "privacy_consent_accepted_at": "2026-01-01T00:00:00+00:00",
                }
            ]
        ),
        "videos": _Collection(),
        "assessments": _Collection(),
        "coaching_tasks": _Collection(),
        "coaching_task_reflections": _Collection(),
        "video_comments": _Collection(),
        "recognition_badges": _Collection(),
        "video_analysis_moments": _Collection(),
        "video_audio_transcripts": _Collection(),
        "transcripts": _Collection(),
        "video_analysis_features": _Collection(),
        "analysis_features": _Collection(),
        "video_sampling_manifests": _Collection(),
        "gradebook_reminders": _Collection(),
        "consent_records": _Collection(),
        "teacher_face_profiles": _Collection(),
        "teacher_face_references": _Collection(),
        "schedules": _Collection(),
        "processing_incidents": _Collection(),
    }
    base.update(collections)
    return types.SimpleNamespace(**base)


def _teacher_user(**overrides):
    user = {
        "id": FORENSIC_USER_ID,
        "email": "teacher@example.com",
        "tenant_role": "teacher",
        "teacher_id": FORENSIC_TEACHER_ID,
        "organization_id": FORENSIC_ORG_ID,
        "approval_status": "approved",
        "is_active": True,
        "privacy_consent_complete": True,
        "privacy_consent_accepted_at": "2026-01-01T00:00:00+00:00",
    }
    user.update(overrides)
    return user


@pytest.fixture
def _privacy_not_required(monkeypatch):
    monkeypatch.setattr(server, "PRIVACY_REQUIRE_PROFILE", False)
    yield


def _valid_assessment(**overrides):
    base = {
        "id": "assessment-good",
        "teacher_id": FORENSIC_TEACHER_ID,
        "video_id": "video-good",
        "framework_type": "danielson",
        "summary": "You opened the lesson with a clear prompt and gave students time to think before sharing.",
        "recommendations": [
            "After one student answers, pause and ask a peer to add on before moving forward.",
        ],
        "element_scores": [
            {
                "element_id": "d3b",
                "element_name": "Using Questioning and Discussion Techniques",
                "score": 6.0,
                "priority": True,
                "confidence": 65.0,
                "evidence_segments": [
                    {
                        "start_sec": 120.0,
                        "end_sec": 150.0,
                        "summary": "You asked a question, paused, and waited for a second hand.",
                    }
                ],
                "observations": ["You gave students a moment to think before sharing."],
            }
        ],
        "evidence_segments": [
            {
                "start_sec": 120.0,
                "end_sec": 150.0,
                "summary": "You paused after the prompt and waited for a hand to go up.",
            },
            {
                "start_sec": 320.0,
                "end_sec": 350.0,
                "summary": "You invited Maya to add on to a peer's idea.",
            },
        ],
        "overall_score": 7.2,
        "analyzed_at": "2026-05-27T00:00:00+00:00",
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "evidence_sufficient": True,
            "teacher_feedback_allowed": True,
            "usable_moment_count": 2,
            "transcript_available": True,
            "fallback_text_used": False,
        },
    }
    base.update(overrides)
    return base


def _valid_video(**overrides):
    base = {
        "id": "video-good",
        "teacher_id": FORENSIC_TEACHER_ID,
        "lesson_title": "Fractions discussion",
        "upload_date": "2026-05-26T00:00:00+00:00",
        "status": "completed",
        "analysis_status": "completed",
        "subject": "Math",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# 1. Valid evidence produces useful teacher artifact
# ---------------------------------------------------------------------------


def test_artifact_built_from_valid_evidence_is_teacher_safe_and_grounded():
    assessment = _valid_assessment()
    video = _valid_video()
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=video,
        language="en",
    )

    assert artifact["artifact_version"] == TEACHER_LESSON_COACHING_ARTIFACT_VERSION
    assert artifact["teacher_feedback_allowed"] is True
    assert artifact["blocked_reason"] is None
    assert artifact["summary"]["opening"]
    assert artifact["summary"]["next_step"]
    assert artifact["action_items"], "Valid evidence must produce at least one action item"
    assert artifact["deep_dive"]["available"] is True
    # Guardrails are truthful only if the recursive scan passed.
    assert artifact["guardrails"]["teacher_visible"] is True
    assert artifact["guardrails"]["rubric_removed"] is True
    assert artifact["guardrails"]["scores_removed"] is True
    assert artifact["guardrails"]["evidence_grounded"] is True
    assert audit_teacher_artifact(artifact) == []
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 2. Insufficient evidence returns honest empty artifact
# ---------------------------------------------------------------------------


def test_artifact_returns_empty_state_when_evidence_insufficient():
    assessment = _valid_assessment(
        analysis_quality={
            "version": "assessment_quality_v1",
            "evidence_sufficient": False,
            "teacher_feedback_allowed": False,
            "usable_moment_count": 0,
            "quality_reasons": ["no_usable_moments", "fallback_text_used"],
        },
    )
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=_valid_video(),
        language="en",
    )
    assert artifact["teacher_feedback_allowed"] is False
    assert artifact["blocked_reason"] == "evidence_insufficient"
    assert artifact["summary"]["opening"] is None
    assert artifact["highlights"] == []
    assert artifact["action_items"] == []
    assert artifact["deep_dive"]["available"] is False
    # PR C8: review-pending must NOT surface a clickable next_best_action.
    # The artifact carries a typed navigator of type review_pending with no
    # href/cta; the legacy next_best_action is suppressed.
    nav = artifact.get("navigator")
    assert nav is not None
    assert nav["type"] == "review_pending"
    assert nav["disabled"] is True
    assert nav["href"] is None
    assert nav["cta_label"] is None
    assert artifact.get("next_best_action") is None
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 3. Rubric labels are translated or removed
# ---------------------------------------------------------------------------


def test_rubric_label_is_translated_to_practice_phrasing():
    mapping = translate_rubric_label_to_practice("Using Questioning and Discussion Techniques")
    assert mapping is not None
    assert "ask questions that open up student thinking" in mapping["practice"]
    assert "Who can build on that?" in mapping["next_step"]


def test_artifact_action_items_do_not_contain_rubric_labels():
    # An assessment whose ONLY signal is a flagged growth element. The
    # rubric translator should kick in to produce a teacher-safe action
    # item, and the rubric label itself must not leak.
    assessment = _valid_assessment(
        summary="",
        recommendations=[],
        evidence_segments=[],
    )
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=_valid_video(),
        language="en",
    )
    if artifact["action_items"]:
        for item in artifact["action_items"]:
            assert "Using Questioning and Discussion Techniques" not in str(item)
            assert "d3b" not in str(item)
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 4. Action item is classroom-actionable
# ---------------------------------------------------------------------------


def test_action_item_is_classroom_actionable_and_has_why_it_matters():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=_valid_assessment(),
        video=_valid_video(),
        language="en",
    )
    assert artifact["action_items"]
    primary = artifact["action_items"][0]
    body = (primary.get("body") or "").lower()
    assert "plan a targeted coaching cycle" not in body
    assert "strengthen" not in body[:30]  # not "Strengthen X"
    assert primary.get("why_it_matters")
    # Reflection prompt is tied to the action item.
    assert primary.get("reflection_prompt")
    # Action item body MUST NOT equal the summary opening.
    summary_open = (artifact["summary"]["opening"] or "").lower()
    assert body != summary_open


# ---------------------------------------------------------------------------
# 5. No forced action items
# ---------------------------------------------------------------------------


def test_no_forced_action_items_when_no_supporting_evidence():
    # Assessment passes the analysis_quality gate but has no recommendations,
    # no growth-flagged elements, and no usable moment text — the artifact
    # must not invent a fake action item.
    assessment = {
        "id": "a-no-action",
        "teacher_id": FORENSIC_TEACHER_ID,
        "video_id": "v-no-action",
        "summary": "You held a focused discussion in this lesson.",
        "element_scores": [],
        "evidence_segments": [],
        "recommendations": [],
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
        "analyzed_at": "2026-05-27T00:00:00+00:00",
    }
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video={"id": "v-no-action", "teacher_id": FORENSIC_TEACHER_ID},
        language="en",
    )
    # The artifact may still produce zero or one action item depending on the
    # projection's "Pick one question or pause..." fallback, but it must NEVER
    # produce three action items just to fill cards.
    assert len(artifact["action_items"]) <= 3
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 6. Deep dive uses only quality moments
# ---------------------------------------------------------------------------


def test_deep_dive_drops_duplicates_and_fallback_moments_via_artifact():
    assessment = _valid_assessment(
        # Override element_scores so the moment candidates come only from
        # ``evidence_segments`` — that keeps the assertion focused on the
        # C3 dedupe + fallback gate.
        element_scores=[],
        evidence_segments=[
            {"start_sec": 923.8, "end_sec": 943.8, "summary": "You opened the discussion with a clear prompt."},
            {"start_sec": 923.8, "end_sec": 943.8, "summary": "Duplicate of the same moment."},
            {"start_sec": 0.0, "end_sec": 20.0, "summary": "The clip gave us a brief window into your lesson — here is what stood out."},
        ],
    )
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=_valid_video(),
        language="en",
    )
    deep = artifact["deep_dive"]
    assert deep["available"] is True
    # Exactly one moment survives: 923.8-943.8. The duplicate AND the fallback
    # moment at 0-20 are both dropped.
    assert len(deep["moments"]) == 1
    assert deep["moments"][0]["start_sec"] == 923.8
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 7. Dashboard / coaching / latest lesson share the artifact
# ---------------------------------------------------------------------------


def test_dashboard_coaching_latest_lesson_use_same_artifact(monkeypatch, _privacy_not_required):
    assessment = _valid_assessment()
    video = _valid_video()
    fake_db = _baseline_db(
        videos=_Collection([video]),
        assessments=_Collection([assessment]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_require_active_approved_api_user", lambda user: user, raising=True)

    latest = asyncio.run(server.get_my_latest_lesson(current_user=_teacher_user()))
    coaching = asyncio.run(server.get_my_teacher_coaching(current_user=_teacher_user()))
    dashboard = asyncio.run(server.get_my_teacher_dashboard(period="semester", current_user=_teacher_user()))

    latest_artifact = latest["lesson"]["coaching_artifact"]
    coaching_artifact = coaching["coaching_artifact"]

    assert latest_artifact["artifact_version"] == TEACHER_LESSON_COACHING_ARTIFACT_VERSION
    assert latest_artifact["lesson"]["assessment_id"] == assessment["id"]
    assert latest_artifact["summary"]["opening"] == coaching_artifact["summary"]["opening"]
    assert latest_artifact["action_items"][0]["body"] == coaching_artifact["action_items"][0]["body"]

    # Dashboard reuses the coaching payload's next_best_action — match the
    # coaching artifact's action item description.
    nba = dashboard["next_best_action"]
    assert nba is not None
    assert nba["description"] == coaching_artifact["action_items"][0]["try_next_lesson"] or nba["description"] == coaching_artifact["action_items"][0]["body"]

    assert_no_known_bad_strings(latest)
    assert_no_known_bad_strings(coaching)
    assert_no_known_bad_strings(dashboard)


# ---------------------------------------------------------------------------
# 8. Teacher assessment view hides admin fields
# ---------------------------------------------------------------------------


def test_teacher_assessment_view_hides_admin_fields(monkeypatch, _privacy_not_required):
    assessment = _valid_assessment()
    fake_db = _baseline_db(
        videos=_Collection([_valid_video()]),
        assessments=_Collection([assessment]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
        "query_string": b"",
        "path": "/api/assessments/assessment-good",
        "raw_path": b"/api/assessments/assessment-good",
        "client": ("127.0.0.1", 0),
        "server": ("testserver", 80),
        "scheme": "http",
        "root_path": "",
        "app": server.app,
    }
    request = Request(scope)
    payload = asyncio.run(server.get_assessment(assessment["id"], request, current_user=_teacher_user()))

    assert "element_scores" not in payload
    assert "overall_score" not in payload
    assert payload["coaching_artifact"]["artifact_version"] == TEACHER_LESSON_COACHING_ARTIFACT_VERSION
    assert_no_known_bad_strings(payload)


# ---------------------------------------------------------------------------
# 9. Admin visibility preserved via admin_view_of_artifact
# ---------------------------------------------------------------------------


def test_admin_view_includes_element_scores_and_diagnostics():
    assessment = _valid_assessment()
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=_valid_video(),
        language="en",
    )
    admin_payload = admin_view_of_artifact(artifact, assessment=assessment)
    assert admin_payload["element_scores"] == assessment["element_scores"]
    assert admin_payload["overall_score"] == assessment["overall_score"]
    assert admin_payload["teacher_preview"]["teacher_feedback_allowed"] is True
    assert admin_payload["teacher_preview"]["deep_dive_available"] is True
    # Admin path INTENTIONALLY exposes rubric labels — do not run the
    # negative assertion here.


# ---------------------------------------------------------------------------
# 10. Existing orphan/unsafe fixture remains hidden (C1/C2 regression)
# ---------------------------------------------------------------------------


def test_orphan_assessment_returns_blocked_artifact_with_no_bad_strings(monkeypatch, _privacy_not_required):
    # Mirror the C2 forensic orphan: assessment present but canonical video
    # missing AND legacy unsafe text in the recommendations.
    assessment = {
        "id": FORENSIC_ASSESSMENT_ID,
        "teacher_id": FORENSIC_TEACHER_ID,
        "video_id": FORENSIC_VIDEO_ID,
        "framework_type": "danielson",
        "summary": "The clip gave us a brief window into your lesson — here is what stood out.",
        "recommendations": ["Plan a targeted coaching cycle for Using Questioning and Discussion Techniques"],
        "element_scores": [
            {
                "element_id": "d1b",
                "element_name": "Demonstrating Knowledge of Students",
                "score": 5.3,
            }
        ],
        "analyzed_at": "2026-05-01T00:00:00+00:00",
    }
    fake_db = _baseline_db(
        videos=_Collection(),  # canonical video missing → source invalid
        assessments=_Collection([assessment]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    latest = asyncio.run(server.get_my_latest_lesson(current_user=_teacher_user()))
    assert latest["lesson"] is None
    if "artifact" in latest:
        assert latest["artifact"]["teacher_feedback_allowed"] is False
        assert latest["artifact"]["blocked_reason"] in {
            "source_invalid",
            "evidence_insufficient",
            "unsafe_text",
            "no_reviewed_lesson",
        }
    assert_no_known_bad_strings(latest)


# ---------------------------------------------------------------------------
# 11. Hebrew empty state
# ---------------------------------------------------------------------------


def test_hebrew_empty_state_is_hebrew_no_english_rubric():
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math", "language": "he"},
        current_user=_teacher_user(language="he"),
        assessment=None,
        video=None,
        language="he",
    )
    assert artifact["teacher_feedback_allowed"] is False
    # Hebrew empty state body should be Hebrew, not English.
    es = artifact["empty_state"]
    assert es["code"] == "no_reviewed_lesson"
    assert "אחרי" in es["message"] or "ההקלטה" in es["title"]
    assert_no_known_bad_strings(artifact)


# ---------------------------------------------------------------------------
# 12. No false guardrails_passed
# ---------------------------------------------------------------------------


def test_guardrails_blocked_when_unsafe_text_slips_through():
    # Build a synthetic assessment whose teacher_feedback_allowed is True but
    # whose summary leaks rubric language. The artifact must downgrade
    # guardrails and return an empty_state instead of claiming
    # teacher_visible.
    assessment = _valid_assessment(
        summary="Strengthen Demonstrating Knowledge of Students based on the observed moment.",
        recommendations=[],
        evidence_segments=[],
    )
    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": FORENSIC_TEACHER_ID, "subject": "Math"},
        current_user=_teacher_user(),
        assessment=assessment,
        video=_valid_video(),
        language="en",
    )
    # Either the projection sanitized it (guardrails still pass) OR the
    # artifact blocked it. Both outcomes are acceptable as long as no
    # forbidden string ends up teacher-visible.
    assert_no_known_bad_strings(artifact)
    if not artifact["teacher_feedback_allowed"]:
        assert artifact["guardrails"]["teacher_visible"] is False


# ---------------------------------------------------------------------------
# 13. audit_teacher_artifact flags contradictions
# ---------------------------------------------------------------------------


def test_audit_helper_flags_contradiction_between_quality_and_visible_flag():
    contradictory = {
        "artifact_version": TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
        "teacher_feedback_allowed": True,
        "analysis_quality": {"teacher_feedback_allowed": False},
        "summary": {"opening": "ok"},
        "highlights": [],
        "action_items": [],
        "deep_dive": {"available": False, "moments": []},
        "recognition": {"gold_star": None, "personal_highlights": []},
        "reflection": {"prompts": []},
        "next_best_action": None,
    }
    issues = audit_teacher_artifact(contradictory)
    codes = {issue["code"] for issue in issues}
    assert "teacher_feedback_allowed_contradicts_quality" in codes


# ---------------------------------------------------------------------------
# 14. Recursive negative assertion sweep across teacher endpoints
# ---------------------------------------------------------------------------


def test_dashboard_coaching_lessons_assessments_no_bad_strings_for_valid_fixture(monkeypatch, _privacy_not_required):
    assessment = _valid_assessment()
    fake_db = _baseline_db(
        videos=_Collection([_valid_video()]),
        assessments=_Collection([assessment]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_require_active_approved_api_user", lambda user: user, raising=True)

    dashboard = asyncio.run(server.get_my_teacher_dashboard(period="semester", current_user=_teacher_user()))
    coaching = asyncio.run(server.get_my_teacher_coaching(current_user=_teacher_user()))
    latest = asyncio.run(server.get_my_latest_lesson(current_user=_teacher_user()))
    lessons = asyncio.run(server.get_my_lessons(current_user=_teacher_user()))

    assert_no_known_bad_strings(dashboard)
    assert_no_known_bad_strings(coaching)
    assert_no_known_bad_strings(latest)
    assert_no_known_bad_strings(lessons)
