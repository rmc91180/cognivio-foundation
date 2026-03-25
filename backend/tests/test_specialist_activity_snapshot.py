import os
import sys
import types
from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _stub_optional_dependencies():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
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


_stub_optional_dependencies()

import server  # noqa: E402


class _FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        self.docs.sort(key=lambda doc: doc.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return list(self.docs[:limit])


class _FakeCollection:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, query=None, projection=None):
        query = query or {}
        matches = []
        for doc in self.docs:
            if doc.get("user_id") != query.get("user_id"):
                continue
            orchestrator = doc.get("specialist_orchestrator") or {}
            trace = list(doc.get("specialist_trace") or [])
            if not orchestrator.get("enabled") and not trace:
                continue
            if projection:
                projected = {
                    key: doc.get(key)
                    for key, include in projection.items()
                    if include and key != "_id"
                }
            else:
                projected = dict(doc)
            matches.append(projected)
        return _FakeCursor(matches)


def test_summarize_specialist_activity_rolls_up_versions_and_notes():
    summary = server._summarize_specialist_activity(
        [
            {
                "id": "assessment-1",
                "teacher_id": "teacher-1",
                "video_id": "video-1",
                "analyzed_at": "2026-03-24T09:00:00+00:00",
                "analysis_mode": "openai_multimodal",
                "specialist_orchestrator": {
                    "enabled": True,
                    "version": "specialist_orchestrator_v1",
                },
                "specialist_trace": [
                    {
                        "specialist_id": "evidence_grounding",
                        "name": "Evidence grounding",
                        "owned_fields": ["element_scores.observations"],
                        "notes": ["Grounded 2 element observations more directly in stored evidence segments."],
                        "payload_delta": {"element_score_updates": 2},
                    },
                    {
                        "specialist_id": "priority_coach",
                        "name": "Priority coach",
                        "owned_fields": ["recommendations", "element_scores"],
                        "notes": ["Linked the leading recommendation to the active coaching goal."],
                        "payload_delta": {"goal_linked": True},
                    },
                ],
            },
            {
                "id": "assessment-2",
                "teacher_id": "teacher-2",
                "video_id": "video-2",
                "analyzed_at": "2026-03-24T10:00:00+00:00",
                "analysis_mode": "openai_multimodal",
                "specialist_orchestrator": {
                    "enabled": True,
                    "version": "specialist_orchestrator_v1",
                },
                "specialist_trace": [
                    {
                        "specialist_id": "priority_coach",
                        "name": "Priority coach",
                        "owned_fields": ["recommendations", "element_scores"],
                        "notes": ["Re-ranked element scores so configured priorities lead the coaching view."],
                        "payload_delta": {"goal_linked": False},
                    }
                ],
            },
        ]
    )

    assert summary["orchestrated_assessment_count"] == 2
    assert summary["total_specialist_steps"] == 3
    assert summary["versions"][0]["version"] == "specialist_orchestrator_v1"
    assert summary["versions"][0]["count"] == 2
    assert summary["specialists"][0]["specialist_id"] == "priority_coach"
    assert summary["specialists"][0]["invocations"] == 2
    assert summary["recent_traces"][0]["assessment_id"] == "assessment-1"


@pytest.mark.asyncio
async def test_get_specialist_activity_snapshot_reads_recent_assessments(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            assessments=_FakeCollection(
                [
                    {
                        "id": "assessment-1",
                        "user_id": "admin-1",
                        "teacher_id": "teacher-1",
                        "video_id": "video-1",
                        "analyzed_at": "2026-03-24T09:00:00+00:00",
                        "analysis_mode": "openai_multimodal",
                        "specialist_orchestrator": {
                            "enabled": True,
                            "version": "specialist_orchestrator_v1",
                        },
                        "specialist_trace": [
                            {
                                "specialist_id": "recommendation_sequence",
                                "name": "Recommendation sequence",
                                "notes": ["Deduped and capped the recommendation sequence for coach readability."],
                                "payload_delta": {"recommendation_count": 3},
                            }
                        ],
                    },
                    {
                        "id": "assessment-2",
                        "user_id": "someone-else",
                        "teacher_id": "teacher-2",
                        "video_id": "video-2",
                        "analyzed_at": "2026-03-24T10:00:00+00:00",
                        "analysis_mode": "openai_multimodal",
                        "specialist_orchestrator": {
                            "enabled": True,
                            "version": "specialist_orchestrator_v1",
                        },
                        "specialist_trace": [],
                    },
                ]
            )
        ),
    )

    summary = await server._get_specialist_activity_snapshot({"id": "admin-1"})

    assert summary["sample_size"] == 1
    assert summary["orchestrated_assessment_count"] == 1
    assert summary["specialists"][0]["specialist_id"] == "recommendation_sequence"
