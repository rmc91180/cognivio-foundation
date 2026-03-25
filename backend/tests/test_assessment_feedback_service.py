import asyncio
import os
import sys
import types
from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
os.environ.setdefault("FRONTEND_URL", "https://app.example.com")

if "boto3" not in sys.modules:
    boto3_stub = types.ModuleType("boto3")

    class _Session:
        def client(self, *args, **kwargs):
            return object()

    boto3_stub.session = types.SimpleNamespace(Session=_Session)
    sys.modules["boto3"] = boto3_stub

if "botocore.exceptions" not in sys.modules:
    botocore_stub = types.ModuleType("botocore")
    botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

    class _BotoCoreError(Exception):
        pass

    class _ClientError(Exception):
        pass

    botocore_exceptions_stub.BotoCoreError = _BotoCoreError
    botocore_exceptions_stub.ClientError = _ClientError
    sys.modules["botocore"] = botocore_stub
    sys.modules["botocore.exceptions"] = botocore_exceptions_stub


import server
from app.repositories import assessment_repository
from app.services import assessment_service


def test_upsert_assessment_feedback_normalizes_summary_target(monkeypatch):
    async def fake_find_assessment_for_user(assessment_id, user_id):
        assert assessment_id == "assessment_1"
        assert user_id == "user_1"
        return {"id": "assessment_1", "teacher_id": "teacher_1", "video_id": "video_1"}

    captured = {}

    async def fake_upsert_assessment_feedback(doc):
        captured.update(doc)
        return {
            **doc,
            "id": "feedback_1",
            "created_at": doc["updated_at"],
        }

    monkeypatch.setattr(
        assessment_repository,
        "find_assessment_for_user",
        fake_find_assessment_for_user,
    )
    monkeypatch.setattr(
        assessment_repository,
        "upsert_assessment_feedback",
        fake_upsert_assessment_feedback,
    )

    response = asyncio.run(
        assessment_service.upsert_assessment_feedback(
            "assessment_1",
            server.AssessmentFeedbackUpsert(
                target_type="summary",
                feedback_value="useful",
                rationale="This was grounded in the video.",
                source_surface="video_player",
            ),
            {
                "id": "user_1",
                "email": "principal@demo.cognivio.app",
                "role": "principal",
            },
        )
    )

    assert response["feedback"].target_id == "summary"
    assert response["feedback"].feedback_value == "useful"
    assert response["feedback"].user_role == "admin"
    assert captured["teacher_id"] == "teacher_1"
    assert captured["video_id"] == "video_1"


def test_upsert_assessment_feedback_requires_target_id_for_recommendation(monkeypatch):
    async def fake_find_assessment_for_user(assessment_id, user_id):
        return {"id": assessment_id, "teacher_id": "teacher_1", "video_id": "video_1"}

    monkeypatch.setattr(
        assessment_repository,
        "find_assessment_for_user",
        fake_find_assessment_for_user,
    )

    with pytest.raises(server.HTTPException) as exc_info:
        asyncio.run(
            assessment_service.upsert_assessment_feedback(
                "assessment_1",
                server.AssessmentFeedbackUpsert(
                    target_type="recommendation",
                    feedback_value="not_useful",
                    rationale="Too generic.",
                ),
                {"id": "user_1", "email": "teacher@demo.cognivio.app", "role": "teacher"},
            )
        )

    assert exc_info.value.status_code == 400
    assert "target_id" in exc_info.value.detail
