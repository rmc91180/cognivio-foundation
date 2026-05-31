"""PR C9.5 PART 6 — the reproject-feedback endpoint backs the Retry control.

Contract D requires the "Retry feedback projection" button to map to a real
endpoint, and contract C requires that endpoint to return the *canonical*
teacher-visible view — never fabricated feedback. These tests lock that the
route re-derives the view from the stored assessment, fails closed (409) when
there is nothing to project, and faithfully surfaces a withheld/blocked state
with its specific reason code rather than pretending feedback is ready.
"""

from __future__ import annotations

import asyncio
import types

import pytest
from fastapi import HTTPException

import server


class _FakeAssessments:
    """Minimal assessments collection whose ``find_one`` accepts ``sort``."""

    def __init__(self, doc=None):
        self._doc = doc

    async def find_one(self, query, projection=None, sort=None):
        return dict(self._doc) if self._doc else None


def _fake_db(assessment=None):
    return types.SimpleNamespace(assessments=_FakeAssessments(assessment))


def _teacher_user():
    return {"id": "teacher-1", "role": "teacher"}


def _patch_common(monkeypatch, db, *, artifact):
    monkeypatch.setattr(server, "db", db)

    async def fake_video(video_id, current_user):
        return {
            "id": video_id,
            "teacher_id": "teacher-1",
            "status": "completed",
            "analysis_status": "completed",
        }

    async def fake_teacher(teacher_id, current_user):
        return {"id": teacher_id, "organization_id": "org-1"}

    async def fake_artifact(**kwargs):
        return artifact

    audit = []

    async def fake_audit(event, target_type, target_id, **kwargs):
        audit.append(
            {"event": event, "target_type": target_type, "target_id": target_id, **kwargs}
        )

    monkeypatch.setattr(server, "_get_visible_video_or_404", fake_video)
    monkeypatch.setattr(server, "_get_teacher_or_404", fake_teacher)
    monkeypatch.setattr(
        server, "_build_teacher_lesson_coaching_artifact_for", fake_artifact
    )
    monkeypatch.setattr(server, "_log_privacy_audit_event", fake_audit)
    return audit


def test_reproject_returns_canonical_ready_view(monkeypatch):
    db = _fake_db(assessment={"video_id": "v1", "feedback_release_status": "released"})
    audit = _patch_common(
        monkeypatch,
        db,
        artifact={
            "teacher_feedback_view": {
                "status": "ready",
                "feedback_available": True,
                "blocked_reason": None,
            }
        },
    )

    result = asyncio.run(server.reproject_video_feedback("v1", _teacher_user()))

    assert result["video_id"] == "v1"
    assert result["feedback_available"] is True
    assert result["status"] == "ready"
    assert result["reason_code"] is None
    assert result["teacher_feedback_view"]["status"] == "ready"
    # The re-projection is audited as a real corrective action.
    assert audit[-1]["event"] == "feedback_projection_reprojected"
    assert audit[-1]["details"]["feedback_available"] is True


def test_reproject_blocks_when_no_assessment(monkeypatch):
    db = _fake_db(assessment=None)
    _patch_common(monkeypatch, db, artifact={"teacher_feedback_view": {"status": "ready"}})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.reproject_video_feedback("v1", _teacher_user()))
    assert exc.value.status_code == 409
    assert exc.value.detail["reason_code"] == "analysis_not_complete"


def test_reproject_surfaces_withheld_reason_without_faking_feedback(monkeypatch):
    # Safety win: a successful re-projection that reveals the feedback is still
    # withheld must report the specific reason, NOT a generic "done".
    db = _fake_db(assessment={"video_id": "v1"})
    audit = _patch_common(
        monkeypatch,
        db,
        artifact={
            "teacher_feedback_view": {
                "status": "safety_withheld",
                "feedback_available": False,
                "blocked_reason": "safety_withheld",
            }
        },
    )

    result = asyncio.run(server.reproject_video_feedback("v1", _teacher_user()))

    assert result["feedback_available"] is False
    assert result["status"] == "safety_withheld"
    assert result["reason_code"] == "safety_withheld"
    assert audit[-1]["details"]["blocked_reason"] == "safety_withheld"
