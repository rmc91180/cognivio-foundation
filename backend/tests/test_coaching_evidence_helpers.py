import os
import sys
import types
from pathlib import Path


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


def test_enrich_action_plan_goals_with_evidence_adds_progress_signal():
    goals = [
        {
            "id": "goal-1",
            "title": "Checks for understanding",
            "description": "Strengthen checks for understanding during guided practice.",
            "status": "in_progress",
            "evidence_links": [],
        }
    ]
    evidence_catalog = [
        {
            "id": "record-1",
            "reference_key": "assessment:a1:recommendation:0",
            "title": "AI coaching move",
            "summary": "Use clearer checks for understanding during guided practice.",
            "created_at": "2026-03-24T10:00:00+00:00",
            "signal": "showing_challenge",
        },
        {
            "id": "record-2",
            "reference_key": "observation:o1:admin_comment",
            "title": "Admin observation",
            "summary": "Students needed stronger understanding checks before independent work.",
            "created_at": "2026-03-23T10:00:00+00:00",
            "signal": "showing_challenge",
        },
    ]

    enriched = server._enrich_action_plan_goals_with_evidence(goals, evidence_catalog)

    assert len(enriched) == 1
    assert len(enriched[0]["evidence_records"]) == 2
    assert enriched[0]["progress_signal"] == "repeated_challenge"
    assert enriched[0]["latest_evidence_at"] == "2026-03-24T10:00:00+00:00"


def test_enrich_reflection_payload_uses_linked_goal_titles_and_records():
    goal_map = {
        "goal-1": {
            "id": "goal-1",
            "title": "Checks for understanding",
            "evidence_records": [
                {
                    "id": "record-goal",
                    "title": "Observed strength",
                    "summary": "Teacher paused to verify understanding after modeling.",
                    "created_at": "2026-03-22T09:00:00+00:00",
                    "signal": "reinforcing_progress",
                }
            ],
        }
    }
    evidence_catalog = [
        {
            "id": "record-observation",
            "title": "Admin observation",
            "summary": "Add one more understanding check before independent work.",
            "created_at": "2026-03-24T09:00:00+00:00",
            "observation_id": "obs-1",
            "signal": "showing_challenge",
        }
    ]

    enriched = server._enrich_reflection_payload(
        {
            "id": "reflection-1",
            "linked_goal_ids": ["goal-1"],
            "linked_observation_id": "obs-1",
        },
        goal_map=goal_map,
        evidence_catalog=evidence_catalog,
    )

    assert enriched["linked_goal_titles"] == ["Checks for understanding"]
    assert [record["id"] for record in enriched["linked_evidence_records"]] == [
        "record-observation",
        "record-goal",
    ]
