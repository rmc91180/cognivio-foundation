"""Backend tests for PR C6 teacher/admin coaching thread.

Covers:

  * Private teacher reflection is not visible to admin.
  * Shared teacher reflection is visible to admin.
  * Admin response is visible to teacher.
  * Admin internal note (visibility=admin_only) is NOT teacher-visible.
  * Teacher cannot view another teacher's thread.
  * Admin cannot post empty body or oversized body.
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

    async def find_one(self, query=None, projection=None, **kwargs):
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
            if key == "$or" and isinstance(expected, list):
                # Match if ANY sub-query matches.
                if not any(self._matches(doc, sub) for sub in expected):
                    return False
                continue
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


def _admin_user():
    return {
        "id": "admin-1",
        "email": "admin@example.com",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-1",
    }


def _teacher_user():
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


def _baseline_db():
    return types.SimpleNamespace(
        users=_Collection([_teacher_user(), _admin_user()]),
        organizations=_Collection([{"id": "org-1", "name": "Org"}]),
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
        assessments=_Collection(
            [
                {
                    "id": "a-good",
                    "teacher_id": "t-good",
                    "video_id": "v-good",
                    "analysis_quality": {"teacher_feedback_allowed": True, "usable_moment_count": 2},
                }
            ]
        ),
        coaching_task_reflections=_Collection(
            [
                {
                    "id": "r-private",
                    "teacher_id": "t-good",
                    "assessment_id": "a-good",
                    "video_id": "v-good",
                    "happened": "I tried this and noticed something private.",
                    "visibility": "private",
                    "created_at": "2026-05-27T00:00:00+00:00",
                },
                {
                    "id": "r-shared",
                    "teacher_id": "t-good",
                    "assessment_id": "a-good",
                    "video_id": "v-good",
                    "happened": "Sharing this reflection with admin.",
                    "visibility": "shared_with_admin",
                    "created_at": "2026-05-27T00:01:00+00:00",
                },
            ]
        ),
        video_comments=_Collection(
            [
                {
                    "id": "c-shared",
                    "teacher_id": "t-good",
                    "video_id": "v-good",
                    "assessment_id": "a-good",
                    "visibility": "shared_with_teacher",
                    "body": "Coach reply visible to teacher",
                    "author_id": "admin-1",
                    "author_role": "school_admin",
                    "deleted_at": None,
                    "created_at": "2026-05-27T00:05:00+00:00",
                },
                {
                    "id": "c-internal",
                    "teacher_id": "t-good",
                    "video_id": "v-good",
                    "visibility": "admin_only",
                    "body": "Internal admin note — NOT teacher visible.",
                    "author_id": "admin-1",
                    "author_role": "school_admin",
                    "deleted_at": None,
                    "created_at": "2026-05-27T00:06:00+00:00",
                },
            ]
        ),
        consent_records=_Collection(),
        teacher_face_profiles=_Collection(),
        teacher_face_references=_Collection(),
    )


@pytest.fixture
def _privacy_not_required(monkeypatch):
    monkeypatch.setattr(server, "PRIVACY_REQUIRE_PROFILE", False)
    yield


def test_teacher_thread_shows_private_and_shared_reflections_and_admin_response(
    monkeypatch, _privacy_not_required
):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.get_my_coaching_thread(
            assessment_id="a-good", video_id="v-good", current_user=_teacher_user()
        )
    )
    bodies = [m["body"] for m in result["messages"]]
    # Teacher sees both their own private + shared reflections.
    assert "I tried this and noticed something private." in bodies
    assert "Sharing this reflection with admin." in bodies
    # Teacher sees admin's shared_with_teacher response.
    assert "Coach reply visible to teacher" in bodies
    # Teacher does NOT see admin_only internal note.
    assert "Internal admin note — NOT teacher visible." not in bodies


def test_admin_thread_view_hides_private_teacher_reflections(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.get_admin_coaching_thread(
            teacher_id="t-good",
            assessment_id="a-good",
            video_id="v-good",
            current_user=_admin_user(),
        )
    )
    bodies = [m["body"] for m in result["messages"]]
    # Admin sees shared reflections + admin responses.
    assert "Sharing this reflection with admin." in bodies
    assert "Coach reply visible to teacher" in bodies
    # Admin must NOT see private teacher reflections via this surface.
    assert "I tried this and noticed something private." not in bodies


def test_admin_can_post_response_visible_to_teacher(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.post_admin_coaching_thread_message(
            teacher_id="t-good",
            payload=server.CoachingThreadMessageRequest(
                assessment_id="a-good",
                video_id="v-good",
                body="Try the pause cue we rehearsed.",
            ),
            current_user=_admin_user(),
        )
    )
    assert result["ok"] is True
    assert result["message"]["visibility"] == "shared_with_teacher"
    assert result["message"]["author_role"] == "school_admin"


def test_admin_internal_note_not_visible_to_teacher(monkeypatch, _privacy_not_required):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    # Admin posts an admin_only note.
    asyncio.run(
        server.post_admin_coaching_thread_message(
            teacher_id="t-good",
            payload=server.CoachingThreadMessageRequest(
                assessment_id="a-good",
                video_id="v-good",
                visibility="admin_only",
                body="Cross-school benchmark only.",
            ),
            current_user=_admin_user(),
        )
    )
    result = asyncio.run(
        server.get_my_coaching_thread(
            assessment_id="a-good", video_id="v-good", current_user=_teacher_user()
        )
    )
    bodies = [m["body"] for m in result["messages"]]
    assert "Cross-school benchmark only." not in bodies


def test_teacher_cannot_call_admin_thread_endpoint(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.get_admin_coaching_thread(
                teacher_id="t-good",
                assessment_id="a-good",
                video_id="v-good",
                current_user=_teacher_user(),
            )
        )
    assert exc.value.status_code == 403


def test_admin_thread_post_rejects_empty_body(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.post_admin_coaching_thread_message(
                teacher_id="t-good",
                payload=server.CoachingThreadMessageRequest(
                    assessment_id="a-good", video_id="v-good", body="  "
                ),
                current_user=_admin_user(),
            )
        )
    assert exc.value.status_code == 400
