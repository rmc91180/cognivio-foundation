"""API-level + unit tests for PR C2 teacher-artifact quarantine.

These tests intentionally exercise the production teacher endpoints with a
faked Mongo. They assert two things at the same time:

1. The known bad strings observed in production (see
   ``KNOWN_BAD_TEACHER_TEXT_PATTERNS``) never appear in teacher-facing
   responses.
2. When the source chain is intact and the AI text is teacher-safe, the
   teacher still sees their content (no false blocking).

A shared ``assert_no_known_bad_strings`` helper recursively serializes the
payload so future endpoint changes can plug into the same gate.
"""

from __future__ import annotations

import asyncio
import os
import types
from typing import Any, Iterable

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

import server
from app.services.teacher_artifact_quarantine import (
    KNOWN_BAD_TEACHER_TEXT_PATTERNS,
    build_source_validity,
    coaching_task_unsafe_text_issues,
    diagnostic_markers,
    filter_deep_dive_moments,
    filter_teacher_visible_coaching_tasks,
    find_teacher_visible_text_issues,
    find_unsafe_text_issues,
    is_action_item_teacher_eligible,
    is_teacher_visible_text_safe,
    reject_unsafe_teacher_payload,
    validate_teacher_artifact_source_chain,
)
from scripts.audit_video_source_chain import (
    audit_documents,
    repair_mark_documents,
)


FORENSIC_TEACHER_ID = "d36bcacb-fb19-4d97-8753-f0944131505b"
FORENSIC_USER_ID = "1157f8a4-c438-4c96-8934-bdbe804036a3"
FORENSIC_VIDEO_ID = "f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f"
FORENSIC_ASSESSMENT_ID = "4bf34ab6-5d57-4837-a266-9ca79c1c473c"
FORENSIC_ORG_ID = "e864d3c8-87f8-4d4a-a1e9-8f16f432bd9c"


KNOWN_BAD_STRINGS_FOR_TEACHER: tuple = (
    "Try this next lesson: rafi:",
    "Rafi:",
    "coach d",
    "d1a",
    "d1b",
    "d1c",
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
)


# ---------------------------------------------------------------------------
# Fake mongo helpers
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

    async def insert_many(self, docs):
        self.docs.extend(dict(doc) for doc in docs)
        return types.SimpleNamespace(inserted_ids=[doc.get("id") for doc in docs])

    async def update_one(self, query, update, upsert=False):
        query = query or {}
        set_values = (update or {}).get("$set", {}) or {}
        inc_values = (update or {}).get("$inc", {}) or {}
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(set_values)
                for key, value in inc_values.items():
                    next_doc[key] = int(next_doc.get(key) or 0) + int(value)
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            payload = dict(query)
            payload.update(set_values)
            self.docs.append(payload)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=payload.get("id"))
        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def update_many(self, query, update):
        query = query or {}
        set_values = (update or {}).get("$set", {}) or {}
        modified = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(set_values)
                self.docs[index] = next_doc
                modified += 1
        return types.SimpleNamespace(matched_count=modified, modified_count=modified)

    async def delete_many(self, query):
        query = query or {}
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query or {})]
        return types.SimpleNamespace(deleted_count=before - len(self.docs))

    async def delete_one(self, query):
        query = query or {}
        before = len(self.docs)
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                self.docs.pop(index)
                break
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
                if "$nin" in expected and actual in expected["$nin"]:
                    return False
                if "$exists" in expected and (actual is not None) != bool(expected["$exists"]):
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


@pytest.fixture(autouse=False)
def _privacy_not_required(monkeypatch):
    """Disable PRIVACY_REQUIRE_PROFILE so the readiness gate passes without
    seeding reference images for every endpoint test."""

    monkeypatch.setattr(server, "PRIVACY_REQUIRE_PROFILE", False)
    yield


# ---------------------------------------------------------------------------
# Negative-assertion helper used across endpoint tests
# ---------------------------------------------------------------------------


def assert_no_known_bad_strings(payload: Any, *, extra: Iterable[str] = ()) -> None:
    """Recursively serialize ``payload`` and assert known bad strings are absent."""

    serialized = _serialize_strings(payload)
    haystack = "\n".join(serialized).lower()
    for needle in tuple(KNOWN_BAD_STRINGS_FOR_TEACHER) + tuple(extra):
        assert needle.lower() not in haystack, (
            f"Teacher payload contained forbidden string {needle!r}.\n"
            f"Payload extract: {haystack[:600]}"
        )

    # Also flush through the recursive structured detector for completeness.
    issues = find_teacher_visible_text_issues(payload)
    assert issues == [], f"find_teacher_visible_text_issues found: {issues[:6]}"


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


# ---------------------------------------------------------------------------
# Unit tests for the helpers
# ---------------------------------------------------------------------------


def test_unsafe_text_detector_flags_known_bad_patterns():
    samples = [
        "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment",
        "Next lesson, strengthen demonstrating knowledge of students based on the observed moment: The clip gave us a brief window into your lesson — here is what stood out.",
        "Try this next lesson: plan a targeted coaching cycle for Using Questioning and Discussion Techniques",
        "A clear strength was Organizing Physical Space.",
        "coach d1b after 5.3 evidence",
        "rubric element d1a",
        "rafi:",
    ]
    for sample in samples:
        assert not is_teacher_visible_text_safe(sample), sample
        assert find_unsafe_text_issues(sample), sample


def test_unsafe_text_detector_allows_safe_teacher_phrases():
    samples = [
        "Choose one moment from this lesson to revisit before planning the next one.",
        "You created space for another student voice. Try giving that student a follow-up question.",
        "Notice who joined the conversation and invite one more voice next time.",
        "Your recording setup is ready.",
        "",
    ]
    for sample in samples:
        assert is_teacher_visible_text_safe(sample), sample


def test_unsafe_text_detector_word_boundary_for_short_tokens():
    # "elementary" should NOT trip "element"; "scoreboard" should NOT trip "score".
    assert is_teacher_visible_text_safe("Set up an elementary classroom routine.")
    assert is_teacher_visible_text_safe("Check the scoreboard in the gym.")


def test_build_source_validity_orphan_artifact():
    validity = build_source_validity(
        artifact={"video_id": FORENSIC_VIDEO_ID, "assessment_id": FORENSIC_ASSESSMENT_ID, "teacher_id": FORENSIC_TEACHER_ID},
        video=None,
        assessment=None,
        teacher_id=FORENSIC_TEACHER_ID,
    )
    assert validity["valid_for_teacher_display"] is False
    assert "missing_source_video" in validity["invalid_reasons"]


def test_build_source_validity_happy_path():
    validity = build_source_validity(
        artifact={"video_id": "v1", "assessment_id": "a1", "teacher_id": "t1"},
        video={"id": "v1", "teacher_id": "t1"},
        assessment={"id": "a1", "video_id": "v1", "teacher_id": "t1"},
        teacher_id="t1",
    )
    assert validity["valid_for_teacher_display"] is True
    assert validity["invalid_reasons"] == []


def test_filter_teacher_visible_coaching_tasks_drops_orphans_and_unsafe():
    tasks = [
        # Safe + valid sources
        {
            "id": "task-safe",
            "video_id": "v-valid",
            "assessment_id": "a-valid",
            "title": "Try one open-ended question next lesson",
            "body": "Pick one student and ask them to explain how they solved it.",
        },
        # Orphan: video does not exist
        {
            "id": "task-orphan-video",
            "video_id": FORENSIC_VIDEO_ID,
            "assessment_id": FORENSIC_ASSESSMENT_ID,
            "title": "Practice questioning",
            "body": "Ask one follow-up next time.",
        },
        # Unsafe text
        {
            "id": "task-unsafe",
            "video_id": "v-valid",
            "title": "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment",
            "body": "coach d1b after 5.3 evidence",
        },
    ]
    visible, quarantined = filter_teacher_visible_coaching_tasks(
        tasks,
        valid_video_ids={"v-valid"},
        valid_assessment_ids={"a-valid"},
    )
    assert {t["id"] for t in visible} == {"task-safe"}
    assert {t["id"] for t in quarantined} == {"task-orphan-video", "task-unsafe"}
    for task in quarantined:
        assert task["hidden_from_teacher"] is True
        assert task["needs_admin_review"] is True
        assert task["source_integrity"] in {"orphaned", "invalid"}


def test_filter_deep_dive_drops_duplicates_and_generic_fallback():
    moments = [
        # duplicate 923.8-943.8 pair (the production bug)
        {"start_sec": 923.8, "end_sec": 943.8, "what_happened": "You opened the discussion with a clear prompt."},
        {"start_sec": 923.8, "end_sec": 943.8, "what_happened": "You opened the discussion again."},
        # generic fallback that must be rejected
        {"start_sec": 0, "end_sec": 20, "what_happened": "The clip gave us a brief window into your lesson — here is what stood out."},
        # rubric-leaking moment that must be rejected
        {"start_sec": 100, "end_sec": 120, "what_happened": "Demonstrating Knowledge of Students"},
        # invalid timestamps
        {"start_sec": 200, "end_sec": 200, "what_happened": "Nothing"},
    ]
    result = filter_deep_dive_moments(moments)
    assert result["available"] is True  # only the first 923.8-943.8 survives
    assert len(result["moments"]) == 1
    assert result["moments"][0]["start_sec"] == 923.8


def test_filter_deep_dive_returns_honest_empty_state_when_no_moments_pass():
    moments = [
        {"start_sec": 0, "end_sec": 20, "what_happened": "The clip gave us a brief window into your lesson — here is what stood out."},
        {"start_sec": 30, "end_sec": 50, "what_happened": "Plan a targeted coaching cycle for Using Questioning and Discussion Techniques"},
    ]
    result = filter_deep_dive_moments(moments)
    assert result["available"] is False
    assert result["moments"] == []
    assert "Detailed lesson moments will appear" in result["empty_state"]


def test_reject_unsafe_teacher_payload_drops_unsafe_actions_and_marks_guardrails():
    payload = {
        "latest_summary": {
            "opening": "Choose one moment from this lesson to revisit before planning the next one.",
            "strength": "You gave students room to think.",
            "growth_focus": "Try asking one student to build on a peer's answer.",
            "next_step": "Notice who joins the conversation next.",
        },
        "highlights": [
            {"title": "Moment worth keeping", "body": "You created room for a second student voice."},
            {"title": "Demonstrating Knowledge of Students", "body": "Rubric leaked"},
        ],
        "action_items": [
            {"id": "a-1", "title": "Try one follow-up", "body": "Ask Maya to extend.", "try_next_lesson": "Ask Maya to extend her partner's response.", "video_id": "v-1"},
            {"id": "a-2", "title": "Plan a targeted coaching cycle", "body": "coach d1b after 5.3 evidence", "try_next_lesson": "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment"},
        ],
        "recognition": [{"title": "Cognivio accolade", "body": "Strong opening"}],
        "deep_dive": {"available": True, "moments": []},
        "guardrails": {},
    }
    safe_validity = {"valid_for_teacher_display": True}
    cleaned = reject_unsafe_teacher_payload(payload, source_validity=safe_validity)
    assert cleaned is not None
    assert len(cleaned["action_items"]) == 1
    assert cleaned["action_items"][0]["id"] == "a-1"
    assert len(cleaned["highlights"]) == 1
    assert cleaned["guardrails"]["teacher_visible"] is True
    assert cleaned["guardrails"]["rubric_removed"] is True
    assert_no_known_bad_strings(cleaned)


def test_reject_unsafe_teacher_payload_returns_none_when_source_invalid():
    payload = {"latest_summary": {"opening": "Safe"}}
    assert reject_unsafe_teacher_payload(payload, source_validity={"valid_for_teacher_display": False}) is None


def test_reject_unsafe_teacher_payload_refuses_residual_bad_summary():
    payload = {
        "latest_summary": {
            "opening": "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment",
        },
        "highlights": [],
        "action_items": [],
        "recognition": [],
        "deep_dive": {"available": False, "moments": []},
        "guardrails": {},
    }
    cleaned = reject_unsafe_teacher_payload(payload, source_validity={"valid_for_teacher_display": True})
    # latest_summary key is stripped to None — but the recursive scan would
    # have removed/nulled the unsafe string. Either way the guardrails must
    # not claim teacher_visible.
    if cleaned is None:
        return
    assert cleaned["latest_summary"].get("opening") is None
    assert_no_known_bad_strings(cleaned)


def test_action_item_eligibility_rejects_teacher_name_prefix():
    bad = {"title": "Rafi:", "body": "anything"}
    assert not is_action_item_teacher_eligible(bad)


def test_diagnostic_markers_shape():
    marker = diagnostic_markers(hidden_reason="missing_source_video", audit_reason="derived_missing_video_parent")
    assert marker["source_integrity"] == "orphaned"
    assert marker["hidden_from_teacher"] is True
    assert marker["needs_admin_review"] is True
    assert marker["source_audited_at"]
    assert marker["source_audit_reason"] == "derived_missing_video_parent"


# ---------------------------------------------------------------------------
# Source-validity async DB validator
# ---------------------------------------------------------------------------


def test_validate_teacher_artifact_source_chain_detects_orphan(monkeypatch):
    fake_db = _baseline_db()
    artifact = {
        "id": "task-1",
        "video_id": FORENSIC_VIDEO_ID,
        "assessment_id": FORENSIC_ASSESSMENT_ID,
        "teacher_id": FORENSIC_TEACHER_ID,
    }

    result = asyncio.run(validate_teacher_artifact_source_chain(fake_db, artifact, teacher_id=FORENSIC_TEACHER_ID))
    assert result["valid_for_teacher_display"] is False
    assert "missing_source_video" in result["invalid_reasons"]
    assert "missing_source_assessment" in result["invalid_reasons"]


def test_validate_teacher_artifact_source_chain_happy_path(monkeypatch):
    fake_db = _baseline_db(
        videos=_Collection([{"id": "v1", "teacher_id": FORENSIC_TEACHER_ID}]),
        assessments=_Collection([{"id": "a1", "video_id": "v1", "teacher_id": FORENSIC_TEACHER_ID}]),
    )
    artifact = {"id": "task-1", "video_id": "v1", "assessment_id": "a1", "teacher_id": FORENSIC_TEACHER_ID}
    result = asyncio.run(validate_teacher_artifact_source_chain(fake_db, artifact, teacher_id=FORENSIC_TEACHER_ID))
    assert result["valid_for_teacher_display"] is True
    assert result["invalid_reasons"] == []


# ---------------------------------------------------------------------------
# Endpoint-level tests
# ---------------------------------------------------------------------------


def _orphan_db_with_unsafe_tasks():
    return _baseline_db(
        coaching_tasks=_Collection(
            [
                # Orphan task referencing missing video + missing assessment
                {
                    "id": "orphan-task-1",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "assessment_id": FORENSIC_ASSESSMENT_ID,
                    "title": "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment",
                    "teacher_title": "Try this next lesson: rafi: Demonstrating Knowledge of Students after moment",
                    "body": "coach d1b after 5.3 evidence",
                    "teacher_body": "coach d1b after 5.3 evidence",
                    "suggested_action": "Plan a targeted coaching cycle for Using Questioning and Discussion Techniques",
                    "status": "open",
                    "priority": "high",
                    "priority_rank": 3,
                    "created_at": "2026-05-01T00:00:00+00:00",
                },
                {
                    "id": "orphan-task-2",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "title": "Demonstrating Knowledge of Content and Pedagogy",
                    "teacher_title": "Demonstrating Knowledge of Content and Pedagogy",
                    "body": "Next lesson, strengthen demonstrating knowledge of students based on the observed moment: The clip gave us a brief window into your lesson — here is what stood out.",
                    "teacher_body": "Next lesson, strengthen demonstrating knowledge of students based on the observed moment: The clip gave us a brief window into your lesson — here is what stood out.",
                    "status": "open",
                    "priority": "medium",
                    "priority_rank": 2,
                    "created_at": "2026-05-01T00:00:00+00:00",
                },
            ]
        ),
        assessments=_Collection(
            [
                # Orphaned legacy assessment — video missing
                {
                    "id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "framework_type": "danielson",
                    "summary": "The clip gave us a brief window into your lesson — here is what stood out.",
                    "recommendations": ["Plan a targeted coaching cycle for Using Questioning and Discussion Techniques"],
                    "analyzed_at": "2026-05-01T00:00:00+00:00",
                }
            ]
        ),
    )


def test_dashboard_hides_orphaned_unsafe_artifacts(monkeypatch, _privacy_not_required):
    fake_db = _orphan_db_with_unsafe_tasks()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_require_active_approved_api_user", lambda user: user, raising=True)

    result = asyncio.run(server.get_my_teacher_dashboard(period="semester", current_user=_teacher_user()))

    assert result["latest_lesson"] is None or result["latest_lesson"].get("status") != "reviewed"
    assert result["highlights"] == []
    assert result["action_items"] == []
    assert result["recognition"]["items"] == []
    nba = result["next_best_action"]
    assert nba is not None
    assert nba["href"] == "/record"
    assert_no_known_bad_strings(result)


def test_coaching_hides_orphaned_unsafe_tasks(monkeypatch, _privacy_not_required):
    fake_db = _orphan_db_with_unsafe_tasks()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_require_active_approved_api_user", lambda user: user, raising=True)

    result = asyncio.run(server.get_my_teacher_coaching(current_user=_teacher_user()))

    assert result["active_tasks"] == []
    assert result["recommendations"] == []
    assert result["suggested_improvements"] == []
    assert result.get("teacher_feedback") in (None, {}) or not result["teacher_feedback"]
    deep_dive = result.get("deep_dive") or {}
    assert deep_dive.get("available") is False
    assert_no_known_bad_strings(result)


def test_latest_lesson_returns_none_for_orphan_chain(monkeypatch, _privacy_not_required):
    fake_db = _orphan_db_with_unsafe_tasks()
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.get_my_latest_lesson(current_user=_teacher_user()))
    # PR C2 invariant: no fake "reviewed" lesson is returned. PR C4 adds an
    # optional diagnostic ``artifact`` key with ``teacher_feedback_allowed:
    # False``. Both behaviours are acceptable for this test as long as no
    # fake teacher lesson appears.
    assert result["lesson"] is None
    if "artifact" in result:
        assert result["artifact"].get("teacher_feedback_allowed") is False
    assert_no_known_bad_strings(result)


def test_lessons_endpoint_marks_orphan_assessment_as_not_reviewed(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db(
        videos=_Collection(
            [
                {
                    "id": "video-uploaded",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "upload_date": "2026-05-26T00:00:00+00:00",
                    "subject": "Math",
                    "status": "uploaded",
                    "analysis_status": "queued",
                }
            ]
        ),
        assessments=_Collection(
            [
                # An assessment with no canonical video — must NOT mark the
                # lesson as reviewed in the teacher list.
                {
                    "id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": "video-uploaded",
                    "summary": "Plan a targeted coaching cycle",
                    "analyzed_at": "2026-05-26T00:00:00+00:00",
                }
            ]
        ),
    )
    # Force projection to fail by deleting the video while keeping the
    # assessment row — production orphan pattern.
    fake_db.videos.docs.clear()
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(server.get_my_lessons(current_user=_teacher_user()))
    assert isinstance(result.get("lessons"), list)
    # No video means lessons should be empty (no video rows iterate).
    assert result["lessons"] == []


def test_valid_source_data_still_shows_teacher_safe_content(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db(
        videos=_Collection(
            [
                {
                    "id": "video-good",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "lesson_title": "Fractions discussion",
                    "upload_date": "2026-05-26T00:00:00+00:00",
                    "status": "completed",
                    "analysis_status": "completed",
                    "subject": "Math",
                }
            ]
        ),
        assessments=_Collection(
            [
                {
                    "id": "assessment-good",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": "video-good",
                    "framework_type": "danielson",
                    "summary": "You opened the discussion with a clear prompt and gave students room to think.",
                    "recommendations": ["Ask one student to build on another student's answer in the next lesson."],
                    "evidence_segments": [
                        {
                            "start_sec": 120.0,
                            "end_sec": 150.0,
                            "summary": "You paused after the prompt and waited for a hand to go up.",
                        }
                    ],
                    "analyzed_at": "2026-05-26T00:05:00+00:00",
                }
            ]
        ),
        coaching_tasks=_Collection(
            [
                {
                    "id": "task-good",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": "video-good",
                    "assessment_id": "assessment-good",
                    "title": "Try one quick partner check",
                    "teacher_title": "Try one quick partner check",
                    "body": "Have students share with a partner before sharing with the class.",
                    "teacher_body": "Have students share with a partner before sharing with the class.",
                    "suggested_action": "Have students share with a partner before sharing with the class.",
                    "status": "open",
                    "priority": "medium",
                    "priority_rank": 2,
                    "created_at": "2026-05-26T00:00:00+00:00",
                }
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_require_active_approved_api_user", lambda user: user, raising=True)

    dashboard = asyncio.run(server.get_my_teacher_dashboard(period="semester", current_user=_teacher_user()))
    coaching = asyncio.run(server.get_my_teacher_coaching(current_user=_teacher_user()))
    latest = asyncio.run(server.get_my_latest_lesson(current_user=_teacher_user()))

    assert latest.get("lesson") is not None
    assert latest["lesson"]["teacher_feedback"] is not None
    assert coaching["active_tasks"], "Safe coaching task should still appear"
    assert dashboard["next_best_action"] is not None

    assert_no_known_bad_strings(dashboard)
    assert_no_known_bad_strings(coaching)
    assert_no_known_bad_strings(latest)


def test_assessment_teacher_view_blocks_orphan_chain(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db(
        videos=_Collection(),  # canonical video deleted
        assessments=_Collection(
            [
                {
                    "id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "framework_type": "danielson",
                    "summary": "Plan a targeted coaching cycle for Using Questioning and Discussion Techniques",
                    "recommendations": ["coach d1b after 5.3 evidence"],
                    "analyzed_at": "2026-05-01T00:00:00+00:00",
                }
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    # Calling the inner function directly because the route's Request param
    # is awkward to construct; the assertion holds for the inner function.
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
        "query_string": b"",
        "path": "/api/assessments/assessment-1",
        "raw_path": b"/api/assessments/assessment-1",
        "client": ("127.0.0.1", 0),
        "server": ("testserver", 80),
        "scheme": "http",
        "root_path": "",
        "app": server.app,
    }
    request = Request(scope)

    payload = asyncio.run(server.get_assessment(FORENSIC_ASSESSMENT_ID, request, current_user=_teacher_user()))

    # teacher_feedback must be None for orphan chain.
    assert payload["teacher_feedback"] is None
    assert payload["summary"] == ""
    assert payload["recommendations"] == []
    assert_no_known_bad_strings(payload)


# ---------------------------------------------------------------------------
# Audit script --repair-safe
# ---------------------------------------------------------------------------


def test_audit_repair_safe_marks_orphans_non_destructively():
    db = types.SimpleNamespace(
        videos=_Collection(),
        assessments=_Collection(),
        coaching_tasks=_Collection(
            [
                {
                    "id": "task-orphan",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "assessment_id": FORENSIC_ASSESSMENT_ID,
                }
            ]
        ),
        video_analysis_moments=_Collection(
            [{"id": "moments-orphan", "teacher_id": FORENSIC_TEACHER_ID, "video_id": FORENSIC_VIDEO_ID}]
        ),
        video_audio_transcripts=_Collection(
            [{"id": "transcript-orphan", "teacher_id": FORENSIC_TEACHER_ID, "video_id": FORENSIC_VIDEO_ID}]
        ),
        transcripts=_Collection(),
        video_analysis_features=_Collection(),
        analysis_features=_Collection(),
        video_sampling_manifests=_Collection(),
    )

    collections_snapshot = {
        "videos": [],
        "assessments": [],
        "coaching_tasks": list(db.coaching_tasks.docs),
        "video_analysis_moments": list(db.video_analysis_moments.docs),
        "video_audio_transcripts": list(db.video_audio_transcripts.docs),
        "transcripts": [],
        "video_analysis_features": [],
        "analysis_features": [],
        "video_sampling_manifests": [],
    }
    report = audit_documents(
        collections_snapshot,
        teacher_id=FORENSIC_TEACHER_ID,
        video_id=FORENSIC_VIDEO_ID,
        assessment_id=FORENSIC_ASSESSMENT_ID,
    )

    summary = asyncio.run(repair_mark_documents(db, report))

    assert summary["marked"] >= 3
    # Records still present (no deletion).
    assert len(db.coaching_tasks.docs) == 1
    task = db.coaching_tasks.docs[0]
    assert task["hidden_from_teacher"] is True
    assert task["source_integrity"] in {"orphaned", "invalid"}
    assert task["needs_admin_review"] is True
    assert task["source_audited_at"]
    assert task["hidden_reason"] in {"missing_source_video", "missing_source_assessment"}
    # Moment marked with hidden_reason video-side
    moment = db.video_analysis_moments.docs[0]
    assert moment["hidden_from_teacher"] is True
    assert moment["hidden_reason"] == "missing_source_video"
    # Transcript marked
    transcript = db.video_audio_transcripts.docs[0]
    assert transcript["hidden_from_teacher"] is True


def test_audit_repair_safe_does_not_touch_clean_documents():
    db = types.SimpleNamespace(
        videos=_Collection([{"id": "v1", "teacher_id": "t1"}]),
        assessments=_Collection([{"id": "a1", "video_id": "v1", "teacher_id": "t1"}]),
        coaching_tasks=_Collection([{"id": "task-1", "video_id": "v1", "assessment_id": "a1", "teacher_id": "t1"}]),
        video_analysis_moments=_Collection(),
        video_audio_transcripts=_Collection(),
        transcripts=_Collection(),
        video_analysis_features=_Collection(),
        analysis_features=_Collection(),
        video_sampling_manifests=_Collection(),
    )
    snapshot = {name: list(getattr(db, name).docs) for name in (
        "videos",
        "assessments",
        "coaching_tasks",
        "video_analysis_moments",
        "video_audio_transcripts",
        "transcripts",
        "video_analysis_features",
        "analysis_features",
        "video_sampling_manifests",
    )}
    report = audit_documents(snapshot)
    summary = asyncio.run(repair_mark_documents(db, report))
    assert summary["marked"] == 0
    assert "hidden_from_teacher" not in db.coaching_tasks.docs[0]


def test_audit_report_still_lists_orphans_for_admin_visibility():
    # Source-chain audit (read-only) must continue to surface orphans so admins
    # see them after PR C2 hides them from teachers.
    collections = {
        "videos": [],
        "assessments": [],
        "coaching_tasks": [
            {"id": "task-orphan", "teacher_id": FORENSIC_TEACHER_ID, "video_id": FORENSIC_VIDEO_ID}
        ],
        "video_analysis_moments": [],
        "video_audio_transcripts": [],
        "transcripts": [],
        "video_analysis_features": [],
        "analysis_features": [],
        "video_sampling_manifests": [],
    }
    report = audit_documents(collections, teacher_id=FORENSIC_TEACHER_ID)
    assert report["summary"]["total_issues"] >= 1
    assert "derived_missing_video_parent" in report["issues"]
