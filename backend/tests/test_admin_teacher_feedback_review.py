"""Backend tests for PR C6 admin teacher-feedback review workflow.

Covers:

  * Admin approve / hide / request-revision endpoint behavior.
  * Teacher cannot call the admin review endpoint.
  * admin_hidden blocks teacher artifact even when source/evidence pass.
  * revision_requested blocks the artifact.
  * admin_approved does NOT override source-invalid or unsafe-text gates.
  * teacher_feedback_admin_status reflects persisted review state.
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
from app.services.teacher_lesson_coaching_artifact import (
    build_teacher_lesson_coaching_artifact,
)


FORENSIC_TEACHER_ID = "d36bcacb-fb19-4d97-8753-f0944131505b"
FORENSIC_VIDEO_ID = "f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f"
FORENSIC_ASSESSMENT_ID = "4bf34ab6-5d57-4837-a266-9ca79c1c473c"


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
                inc = (update or {}).get("$inc") or {}
                for key, value in inc.items():
                    new_doc[key] = int(new_doc.get(key) or 0) + int(value)
                self.docs[index] = new_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            new_doc = dict(query)
            new_doc.update((update or {}).get("$set") or {})
            self.docs.append(new_doc)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new_doc.get("id"))
        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def distinct(self, key, query=None):
        return [
            doc.get(key)
            for doc in self.docs
            if self._matches(doc, query or {}) and doc.get(key) is not None
        ]

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


def _valid_assessment(**overrides):
    base = {
        "id": "a-good",
        "teacher_id": "t-good",
        "video_id": "v-good",
        "framework_type": "danielson",
        "summary": "You opened the lesson with a clear question and waited for a second voice.",
        "recommendations": ["Ask one student to build on a partner's answer next lesson."],
        "element_scores": [
            {
                "element_id": "d3b",
                "element_name": "Using Questioning and Discussion Techniques",
                "score": 6.0,
                "priority": True,
                "confidence": 70.0,
                "evidence_segments": [
                    {"start_sec": 60, "end_sec": 80, "summary": "You waited after the question."}
                ],
                "observations": ["You waited after the prompt."],
            }
        ],
        "evidence_segments": [
            {"start_sec": 60, "end_sec": 80, "summary": "You waited after the question."},
            {"start_sec": 220, "end_sec": 260, "summary": "Maya extended a peer answer."},
        ],
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
        "users": _Collection(),
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
                }
            ]
        ),
        "videos": _Collection(
            [
                {
                    "id": "v-good",
                    "teacher_id": "t-good",
                    "status": "completed",
                    "analysis_status": "completed",
                    "lesson_title": "Fractions",
                }
            ]
        ),
        "assessments": _Collection([_valid_assessment()]),
        "teacher_feedback_reviews": _Collection(),
        "coaching_tasks": _Collection(),
        "coaching_task_reflections": _Collection(),
        "video_comments": _Collection(),
        "recognition_badges": _Collection(),
        "consent_records": _Collection(),
    }
    base.update(overrides)
    return types.SimpleNamespace(**base)


def _admin_user(**overrides):
    user = {
        "id": "admin-1",
        "email": "admin@example.com",
        "tenant_role": "school_admin",
        "approval_status": "approved",
        "is_active": True,
        "organization_id": "org-1",
    }
    user.update(overrides)
    return user


def _teacher_user(**overrides):
    user = {
        "id": "user-teacher-1",
        "email": "maya@example.com",
        "tenant_role": "teacher",
        "teacher_id": "t-good",
        "organization_id": "org-1",
        "approval_status": "approved",
        "is_active": True,
    }
    user.update(overrides)
    return user


# ---------------------------------------------------------------------------
# Admin review endpoint
# ---------------------------------------------------------------------------


def test_admin_can_approve_and_status_is_auto_allowed_after_approval(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(
                status="admin_approved", review_note="Looks good"
            ),
            current_user=_admin_user(),
        )
    )
    assert result["ok"] is True
    assert result["review"]["status"] == "admin_approved"
    # The artifact should still be allowed because source/evidence/safety pass.
    assert result["teacher_feedback_admin_status"] == "auto_allowed"


def test_admin_hidden_blocks_teacher_artifact_even_when_other_gates_pass(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(
                status="admin_hidden",
                review_note="Needs another look",
                hidden_reason="Privacy concern",
            ),
            current_user=_admin_user(),
        )
    )
    assert result["review"]["status"] == "admin_hidden"
    assert result["teacher_feedback_admin_status"] == "admin_hidden"
    # The teacher_preview should now show teacher_feedback_allowed=False.
    preview = result["teacher_preview"]
    assert preview is not None
    inner = preview.get("teacher_preview") or {}
    assert inner.get("teacher_feedback_allowed") is False


def test_admin_revision_requested_blocks_teacher_artifact(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    result = asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(
                status="revision_requested",
                review_note="Please tighten the action item before sending",
                revision_reason="Action item phrasing too generic",
            ),
            current_user=_admin_user(),
        )
    )
    assert result["review"]["status"] == "revision_requested"
    assert result["teacher_feedback_admin_status"] == "revision_requested"


def test_admin_approval_cannot_override_missing_source():
    """The artifact builder must NOT promote teacher_feedback_allowed when
    the source chain is missing, even with admin_approved on file."""

    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=_valid_assessment(),
        video=None,  # canonical video missing → source invalid
        admin_review={"status": "admin_approved", "reviewed_by": "admin-1"},
        language="en",
    )
    assert artifact["teacher_feedback_allowed"] is False
    assert artifact["blocked_reason"] == "source_invalid"


def test_admin_approval_cannot_override_unsafe_text():
    """The artifact builder must NOT promote unsafe summary text just
    because admin marked the assessment ``admin_approved``."""

    artifact = build_teacher_lesson_coaching_artifact(
        teacher={"id": "t-good"},
        assessment=_valid_assessment(
            summary="Strengthen Demonstrating Knowledge of Students based on the observed moment.",
            element_scores=[],
            evidence_segments=[],
            recommendations=[],
        ),
        video={"id": "v-good", "teacher_id": "t-good"},
        admin_review={"status": "admin_approved"},
        language="en",
    )
    # Either guardrails refused to claim teacher_visible OR the entire
    # artifact collapsed to empty — both are acceptable as long as
    # teacher_feedback_allowed is False.
    if artifact["teacher_feedback_allowed"]:
        # Recursive scan must have cleaned the text; the test only fails if
        # the artifact still leaks the rubric label.
        body = str(artifact).lower()
        assert "demonstrating knowledge of students" not in body
    else:
        assert artifact["blocked_reason"] in {
            "unsafe_text",
            "unsafe_text_post_compose",
        }


def test_teacher_cannot_call_admin_review_endpoint(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upsert_teacher_feedback_review_endpoint(
                assessment_id="a-good",
                payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
                current_user=_teacher_user(),
            )
        )
    assert exc.value.status_code == 403


def test_admin_review_status_invalid_value_rejected(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upsert_teacher_feedback_review_endpoint(
                assessment_id="a-good",
                payload=server.TeacherFeedbackReviewRequest(status="nonsense"),
                current_user=_admin_user(),
            )
        )
    assert exc.value.status_code == 400


def test_admin_review_get_returns_persisted_doc(monkeypatch):
    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(status="admin_approved"),
            current_user=_admin_user(),
        )
    )
    result = asyncio.run(
        server.get_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            current_user=_admin_user(),
        )
    )
    assert result["review"] is not None
    assert result["review"]["status"] == "admin_approved"


def test_compute_teacher_feedback_admin_status_admin_hidden():
    artifact = {"teacher_feedback_allowed": False, "blocked_reason": "admin_hidden"}
    assert server._compute_teacher_feedback_admin_status(artifact) == "admin_hidden"


def test_compute_teacher_feedback_admin_status_revision_requested():
    artifact = {"teacher_feedback_allowed": False, "blocked_reason": "revision_requested"}
    assert server._compute_teacher_feedback_admin_status(artifact) == "revision_requested"


def test_admin_review_persists_workspace_id(monkeypatch):
    """Tenant safety: the persisted record carries the teacher's workspace."""

    fake_db = _baseline_db()
    monkeypatch.setattr(server, "db", fake_db)
    asyncio.run(
        server.upsert_teacher_feedback_review_endpoint(
            assessment_id="a-good",
            payload=server.TeacherFeedbackReviewRequest(status="admin_hidden"),
            current_user=_admin_user(),
        )
    )
    saved = fake_db.teacher_feedback_reviews.docs[-1]
    assert saved["workspace_id"] == "org-1"
    assert saved["reviewed_by"] == "admin-1"
    assert saved["assessment_id"] == "a-good"
