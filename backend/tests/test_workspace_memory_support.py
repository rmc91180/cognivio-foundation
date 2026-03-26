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

from app.services import workspace_service  # noqa: E402


def test_build_memory_support_snapshot_prioritizes_repeated_challenge():
    snapshot = workspace_service._build_memory_support_snapshot_from_inputs(
        teacher_name="Jamie",
        enriched_goals=[
            {
                "id": "goal-1",
                "title": "Checks for understanding",
                "status": "in_progress",
                "progress_signal": "repeated_challenge",
                "progress_summary": "Recent evidence shows this challenge repeating across 3 linked records.",
                "latest_evidence_at": "2026-03-25T10:00:00+00:00",
            },
            {
                "id": "goal-2",
                "title": "Student transitions",
                "status": "in_progress",
                "progress_signal": "reinforcing_progress",
                "progress_summary": "Recent evidence is reinforcing this goal across 2 linked records.",
                "latest_evidence_at": "2026-03-24T10:00:00+00:00",
            },
        ],
        reflection_summary={
            "self_reflection": "I need to pause sooner for checks.",
            "actions_taken": "I plan to add one more quick check before independent work.",
        },
        signal_summary={
            "guidance": ["Keep recommendations short and conference-ready."],
        },
        next_conference="2026-03-30T09:00:00+00:00",
        language="en",
    )

    assert snapshot["primary_goal"]["title"] == "Checks for understanding"
    assert "Checks for understanding" in snapshot["teacher_prompt_title"]
    assert "repeating as a challenge" in snapshot["teacher_prompt_body"]
    assert snapshot["conference_continuity_lines"][0].startswith("Recent evidence shows this challenge repeating")
    assert "I plan to add one more quick check" in snapshot["conference_continuity_lines"][2]
