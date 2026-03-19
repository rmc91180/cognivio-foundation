import importlib.util
import os
import sys
import types
from pathlib import Path


def _load_server_module():
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
    module_path = Path(__file__).resolve().parents[1] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_analysis_helpers", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


def test_generate_summary_uses_10_point_thresholds_and_observations():
    summary = server.generate_summary(
        [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "score": 8.2,
                "observations": ["Teacher used follow-up questions to press for reasoning."],
            },
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 6.1,
                "observations": ["Only a small subset of students appeared to participate."],
            },
        ],
        7.1,
    )

    assert "Overall performance" in summary
    assert "Strongest visible practices" in summary
    assert "Priority growth areas" in summary
    assert "Questioning" in summary
    assert "Engagement" in summary


def test_generate_recommendations_uses_evidence_segments_and_not_canned_defaults():
    recommendations = server.generate_recommendations(
        [
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 6.0,
                "observations": ["Student participation cues were uneven across the sampled frames."],
                "evidence_segments": [
                    {
                        "start_sec": 95,
                        "end_sec": 125,
                        "summary": "Only a small cluster of students responded during the task.",
                        "rationale": "model-observed",
                    }
                ],
            }
        ]
    )

    assert recommendations
    assert recommendations[0].startswith("[01:35–02:05]")
    assert "Engagement".lower() in recommendations[0].lower()
    assert "Observed evidence" in recommendations[0]
    assert "Continue modeling strong routines" not in recommendations[0]


def test_normalize_analysis_score_scales_legacy_four_point_scores():
    assert server._normalize_analysis_score(4) == 10.0
    assert server._normalize_analysis_score(3) == 7.5
    assert server._normalize_analysis_score(6.8) == 6.8


def test_paid_analysis_gate_requires_feature_flag_and_allowlist(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(
        server,
        "PAID_ANALYSIS_ALLOWLIST_EMAILS",
        {"principal@demo.cognivio.app", "teacher@demo.cognivio.app"},
    )

    assert server._is_paid_analysis_allowed_for_user({"email": "teacher@demo.cognivio.app"}) is True
    assert server._is_paid_analysis_allowed_for_user({"email": "other@example.com"}) is False


def test_paid_analysis_gate_blocks_when_disabled(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", False)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})

    assert server._is_paid_analysis_allowed_for_user({"email": "teacher@demo.cognivio.app"}) is False
