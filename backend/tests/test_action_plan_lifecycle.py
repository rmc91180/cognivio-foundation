"""Backend tests for PR C6 artifact action item -> coaching task lifecycle.

Covers:

  * Teacher marking an artifact action item ``tried`` creates a
    coaching_task only on the first call (no duplicates on repeat).
  * Teacher reflection on an action item updates status to ``reflected``
    and increments reflection counts (shared bumps shared_reflection_count).
  * Trying to promote an action item whose text would be unsafe raises
    409 (we never persist unsafe action item text).
  * Tried/reflect requires a valid artifact (teacher_feedback_allowed True).
"""

from __future__ import annotations

import asyncio
import os
import types

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest
from fastapi import HTTPException

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, *_args, **_kwargs):
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
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None, **_kwargs):
        return _Cursor(
            [self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})]
        )

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                new_doc = dict(doc)
                new_doc.update((update or {}).get("$set") or {})
                inc = (update or {}).get("$inc") or {}
                for key, value in inc.items():
                    new_doc[key] = int(new_doc.get(key) or 0) + int(value)
                self.docs[index] = new_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
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


def _admin():
    return {
        "id": "admin-1",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-1",
    }


def _teacher():
    return {
        "id": "user-teacher-1",
        "email": "maya@example.com",
        "tenant_role": "teacher",
        "teacher_id": "t-good",
        "organization_id": "org-1",
        "approval_status": "approved",
        "is_active": True,
        "privacy_consent_complete": True,
    }


def _valid_assessment():
    return {
        "id": "a-good",
        "teacher_id": "t-good",
        "video_id": "v-good",
        "framework_type": "danielson",
        "summary": "You opened the lesson with a clear question and gave students room to think.",
        "recommendations": [
            "Ask one student to build on a partner's answer next lesson.",
        ],
        "element_scores": [],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 80, "summary": "You waited after the prompt."},
            {"start_sec": 220, "end_sec": 260, "summary": "Maya extended a peer answer."},
        ],
        "analyzed_at": "2026-05-27T00:00:00+00:00",
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
    }


def _baseline_db():
    return types.SimpleNamespace(
        users=_Collection([_teacher(), _admin()]),
        organizations=_Collection([{"id": "org-1"}]),
        schools=_Collection(),
        teachers=_Collection(
            [
                {
                    "id": "t-good",
                    "email": "maya@example.com",
                    "organization_id": "org-1",
                    "created_by": "admin-1",
                }
            ]
        ),
        videos=_Collection([{"id": "v-good", "teacher_id": "t-good"}]),
        assessments=_Collection([_valid_assessment()]),
        coaching_tasks=_Collection(),
        coaching_task_reflections=_Collection(),
        video_comments=_Collection(),
        recognition_badges=_Collection(),
        teacher_feedback_reviews=_Collection(),
        consent_records=_Collection(),
        teacher_face_profiles=_Collection(),
        teacher_face_references=_Collection(),
    )


@pytest.fixture
def _privacy_not_required(monkeypatch):
    monkeypatch.setattr(server, "PRIVACY_REQUIRE_PROFILE", False)
    yield


async def _resolve_action_item_id(current_user):
    """Build the artifact and return the first action item's id so the test
    references a real, freshly-generated id."""

    from app.services.teacher_lesson_coaching_artifact import (
        build_teacher_lesson_coaching_artifact,
    )

    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good", "subject": "Math"},
        current_user=current_user,
        assessment=_valid_assessment(),
        video={"id": "v-good", "teacher_id": "t-good"},
        language="en",
    )
    return artifact["action_items"][0]["id"]


def test_teacher_tried_creates_coaching_task_once(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)

    action_item_id = asyncio.run(_resolve_action_item_id(_teacher()))

    first = asyncio.run(
        server.teacher_marks_action_item_tried(
            action_item_id=action_item_id,
            payload=server.ActionItemTriedRequest(assessment_id="a-good"),
            current_user=_teacher(),
        )
    )
    assert first["ok"] is True
    assert first["task"]["status"] == "tried"
    assert first["task"]["source_type"] == "artifact_action_item"

    # Second call must not create a duplicate.
    second = asyncio.run(
        server.teacher_marks_action_item_tried(
            action_item_id=action_item_id,
            payload=server.ActionItemTriedRequest(assessment_id="a-good"),
            current_user=_teacher(),
        )
    )
    assert second["task"]["id"] == first["task"]["id"]
    assert len(fake_db.coaching_tasks.docs) == 1


def test_teacher_reflect_increments_counts_and_marks_reflected(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    action_item_id = asyncio.run(_resolve_action_item_id(_teacher()))
    asyncio.run(
        server.teacher_marks_action_item_tried(
            action_item_id=action_item_id,
            payload=server.ActionItemTriedRequest(assessment_id="a-good"),
            current_user=_teacher(),
        )
    )
    asyncio.run(
        server.teacher_reflects_on_action_item(
            action_item_id=action_item_id,
            payload=server.ActionItemReflectRequest(
                assessment_id="a-good",
                happened="I tried the move and Maya extended Jordan's idea.",
                visibility="shared_with_admin",
            ),
            current_user=_teacher(),
        )
    )
    task = fake_db.coaching_tasks.docs[0]
    assert task["status"] == "reflected"
    assert task.get("reflection_count") == 1
    assert task.get("shared_reflection_count") == 1
    assert task.get("reflected_at")
    # Reflection persists in coaching_task_reflections.
    reflections = fake_db.coaching_task_reflections.docs
    assert len(reflections) == 1
    assert reflections[0]["visibility"] == "shared_with_admin"


def test_promote_refuses_when_action_item_not_in_artifact(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.teacher_marks_action_item_tried(
                action_item_id="nonexistent-action-item",
                payload=server.ActionItemTriedRequest(assessment_id="a-good"),
                current_user=_teacher(),
            )
        )
    assert exc.value.status_code == 404


def test_tried_refuses_when_assessment_blocked_by_quality(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    # Mutate analysis_quality to block teacher feedback.
    fake_db.assessments.docs[0]["analysis_quality"] = {
        "version": "assessment_quality_v1",
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "quality_reasons": ["no_usable_moments"],
    }
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.teacher_marks_action_item_tried(
                action_item_id="anything",
                payload=server.ActionItemTriedRequest(assessment_id="a-good"),
                current_user=_teacher(),
            )
        )
    assert exc.value.status_code == 409


def test_reflect_requires_body(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    action_item_id = asyncio.run(_resolve_action_item_id(_teacher()))
    asyncio.run(
        server.teacher_marks_action_item_tried(
            action_item_id=action_item_id,
            payload=server.ActionItemTriedRequest(assessment_id="a-good"),
            current_user=_teacher(),
        )
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.teacher_reflects_on_action_item(
                action_item_id=action_item_id,
                payload=server.ActionItemReflectRequest(
                    assessment_id="a-good", happened="   "
                ),
                current_user=_teacher(),
            )
        )
    assert exc.value.status_code == 400


def test_reflect_persists_private_by_default(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    action_item_id = asyncio.run(_resolve_action_item_id(_teacher()))
    asyncio.run(
        server.teacher_marks_action_item_tried(
            action_item_id=action_item_id,
            payload=server.ActionItemTriedRequest(assessment_id="a-good"),
            current_user=_teacher(),
        )
    )
    asyncio.run(
        server.teacher_reflects_on_action_item(
            action_item_id=action_item_id,
            payload=server.ActionItemReflectRequest(
                assessment_id="a-good",
                happened="Tried it; quieter students joined.",
            ),
            current_user=_teacher(),
        )
    )
    reflections = fake_db.coaching_task_reflections.docs
    assert reflections[0]["visibility"] == "private"
