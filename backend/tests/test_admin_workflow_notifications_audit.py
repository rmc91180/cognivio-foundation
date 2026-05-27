"""Backend tests for PR C7: workspace authorization + teacher notifications +
admin audit endpoint.

Covers:

  * `_require_admin_in_same_tenant` rejects cross-workspace admins (403).
  * Same-workspace admin can call review/thread endpoints.
  * Teacher notification created on admin_approved when artifact ends up
    allowed.
  * No teacher notification when admin_approved but artifact still
    blocked.
  * No teacher notification on admin_hidden or revision_requested.
  * Teacher notification created on admin shared_with_teacher thread
    reply; not created on admin_only.
  * Admin artifact audit endpoint returns report with expected fields
    and enforces admin role + tenant.
"""

from __future__ import annotations

import asyncio
import os
import types
from typing import Any, List

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest
from fastapi import HTTPException

import server


# ---------------------------------------------------------------------------
# Fake mongo
# ---------------------------------------------------------------------------


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
        docs = [doc for doc in self.docs if self._matches(doc, query or {})]
        sort = kwargs.get("sort")
        if sort:
            for field, direction in reversed(list(sort)):
                docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
        if not docs:
            return None
        return self._project(docs[0], projection)

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
        if upsert:
            new_doc = dict(query)
            new_doc.update((update or {}).get("$set") or {})
            self.docs.append(new_doc)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new_doc.get("id"))
        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def distinct(self, key, query=None):
        return [doc.get(key) for doc in self.docs if self._matches(doc, query or {}) and doc.get(key) is not None]

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
                if not any(self._matches(doc, sub) for sub in expected):
                    return False
                continue
            actual = doc.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and actual not in expected["$in"]:
                    return False
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$regex" in expected:
                    import re

                    flags = re.IGNORECASE if expected.get("$options") == "i" else 0
                    if not re.search(expected["$regex"], str(actual or ""), flags=flags):
                        return False
                    continue
                continue
            if actual != expected:
                return False
        return True


def _valid_assessment(**overrides):
    base = {
        "id": "a-good",
        "teacher_id": "t-good",
        "video_id": "v-good",
        "framework_type": "danielson",
        "summary": "You opened with a clear question and waited for a second voice.",
        "recommendations": ["Ask one student to build on a partner's answer next lesson."],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 80, "summary": "You waited after the prompt."},
            {"start_sec": 220, "end_sec": 260, "summary": "Maya extended a peer answer."},
        ],
        "element_scores": [],
        "overall_score": 7.0,
        "analyzed_at": "2026-05-27T00:00:00+00:00",
        "analysis_quality": {
            "version": "assessment_quality_v1",
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
    }
    base.update(overrides)
    return base


def _baseline_db(**overrides):
    base = {
        "users": _Collection(
            [
                {
                    "id": "teacher-user-1",
                    "email": "maya@example.com",
                    "teacher_id": "t-good",
                    "tenant_role": "teacher",
                    "organization_id": "org-1",
                }
            ]
        ),
        "organizations": _Collection([{"id": "org-1"}, {"id": "org-2"}]),
        "schools": _Collection(),
        "teachers": _Collection(
            [
                {
                    "id": "t-good",
                    "email": "maya@example.com",
                    "organization_id": "org-1",
                    "created_by": "admin-1",
                }
            ]
        ),
        "videos": _Collection([{"id": "v-good", "teacher_id": "t-good"}]),
        "assessments": _Collection([_valid_assessment()]),
        "teacher_feedback_reviews": _Collection(),
        "coaching_tasks": _Collection(),
        "coaching_task_reflections": _Collection(),
        "video_comments": _Collection(),
        "recognition_badges": _Collection(),
        "notifications": _Collection(),
        "consent_records": _Collection(),
        "teacher_face_profiles": _Collection(),
        "teacher_face_references": _Collection(),
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


def _same_workspace_admin():
    return {
        "id": "admin-1",
        "email": "admin@org-1.example",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-1",
    }


def _other_workspace_admin():
    return {
        "id": "admin-2",
        "email": "admin@org-2.example",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-2",
    }


def _teacher_user():
    return {
        "id": "teacher-user-1",
        "email": "maya@example.com",
        "tenant_role": "teacher",
        "teacher_id": "t-good",
        "organization_id": "org-1",
        "approval_status": "approved",
        "is_active": True,
        "privacy_consent_complete": True,
    }


# ---------------------------------------------------------------------------
# Workspace authorization
# ---------------------------------------------------------------------------


def test_cross_workspace_admin_denied_on_review(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upsert_teacher_feedback_review_endpoint(
                assessment_id="a-good",
                payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
                current_user=_other_workspace_admin(),
            )
        )
    assert exc.value.status_code == 403


def test_same_workspace_admin_can_review(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["ok"] is True


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def test_admin_approved_creates_teacher_notification_when_artifact_allowed(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is True
    note = fake_db.notifications.docs[-1]
    assert note["type"] == "teacher_feedback_ready"
    assert note["recipient_user_id"] == "teacher-user-1"
    assert note["read"] is False
    assert note["payload"]["assessment_id"] == "a-good"


def test_admin_approved_does_not_notify_when_artifact_still_blocked(monkeypatch):
    fake_db = _baseline_db()
    # Make the analysis_quality fail so the artifact stays blocked even
    # after admin approval.
    fake_db.assessments.docs[0]["analysis_quality"] = {
        "version": "assessment_quality_v1",
        "teacher_feedback_allowed": False,
        "evidence_sufficient": False,
        "quality_reasons": ["no_usable_moments"],
    }
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is False
    assert fake_db.notifications.docs == []


def test_admin_hidden_does_not_notify_teacher(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(
                status="admin_hidden", hidden_reason="Pilot smoke hide"
            ),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is False
    assert fake_db.notifications.docs == []


def test_admin_revision_requested_does_not_notify_teacher(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(
                status="revision_requested", revision_reason="Reword the action item"
            ),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is False


def test_admin_thread_shared_message_creates_notification(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.post_admin_coaching_thread_message(
            teacher_id="t-good",
            payload=server.CoachingThreadMessageRequest(
                assessment_id="a-good",
                video_id="v-good",
                body="Try the pause cue next time.",
            ),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is True
    note = fake_db.notifications.docs[-1]
    assert note["type"] == "coaching_thread_reply"
    assert "Try the pause cue next time." in note["message"]


def test_admin_thread_admin_only_message_does_not_notify(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.post_admin_coaching_thread_message(
            teacher_id="t-good",
            payload=server.CoachingThreadMessageRequest(
                assessment_id="a-good",
                video_id="v-good",
                visibility="admin_only",
                body="Internal admin note.",
            ),
            current_user=_same_workspace_admin(),
        )
    )
    assert result["notification_created"] is False
    assert fake_db.notifications.docs == []


# ---------------------------------------------------------------------------
# Admin audit endpoint
# ---------------------------------------------------------------------------


def test_admin_audit_endpoint_returns_report(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    report = asyncio.run(
        server.admin_teacher_coaching_artifact_audit(
            teacher_id="t-good",
            current_user=_same_workspace_admin(),
        )
    )
    # Report shape from the audit_collections helper.
    assert "issues" in report
    assert "counts" in report
    assert report["filters"]["teacher_id"] == "t-good"


def test_admin_audit_endpoint_rejects_teacher(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.admin_teacher_coaching_artifact_audit(
                teacher_id="t-good",
                current_user=_teacher_user(),
            )
        )
    assert exc.value.status_code == 403


def test_admin_audit_endpoint_rejects_cross_workspace(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.admin_teacher_coaching_artifact_audit(
                teacher_id="t-good",
                current_user=_other_workspace_admin(),
            )
        )
    assert exc.value.status_code == 403
