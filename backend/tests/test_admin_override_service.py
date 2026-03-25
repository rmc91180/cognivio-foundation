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
from app.services import assessment_service  # noqa: E402


def test_build_admin_override_doc_preserves_score_override_compatibility():
    payload = server.AdminScoreOverride(
        domain_id="d3b",
        original_score=6.4,
        adjusted_score=7.2,
        rationale="Admin score correction",
    )

    doc = assessment_service._build_admin_override_doc(
        "assessment-1",
        payload,
        {"id": "admin-1", "role": "admin"},
    )

    assert doc["override_type"] == "score"
    assert doc["target_type"] == "element"
    assert doc["target_id"] == "d3b"
    assert doc["domain_id"] == "d3b"
    assert doc["original_value"] == 6.4
    assert doc["adjusted_value"] == 7.2
    assert doc["original_score"] == 6.4
    assert doc["adjusted_score"] == 7.2


def test_build_admin_override_doc_supports_recommendation_usefulness_override():
    payload = server.AdminScoreOverride(
        override_type="recommendation_usefulness",
        target_type="recommendation",
        target_id="teacher-recommendation-0",
        original_value="ai_generated",
        adjusted_value="needs_rewrite",
        rationale="Recommendation is too generic",
        metadata={"surface": "teacher_profile"},
    )

    doc = assessment_service._build_admin_override_doc(
        "assessment-1",
        payload,
        {"id": "admin-1", "role": "admin"},
    )

    assert doc["override_type"] == "recommendation_usefulness"
    assert doc["target_type"] == "recommendation"
    assert doc["target_id"] == "teacher-recommendation-0"
    assert doc["domain_id"] is None
    assert doc["adjusted_value"] == "needs_rewrite"
    assert doc["metadata"]["surface"] == "teacher_profile"


def test_apply_admin_overrides_ignores_non_score_override_records():
    adjusted_scores, adjusted_overall = server._apply_admin_overrides(
        [{"element_id": "d3b", "score": 6.0, "element_name": "Questioning"}],
        [
            {
                "override_type": "recommendation_usefulness",
                "target_type": "recommendation",
                "target_id": "teacher-recommendation-0",
                "adjusted_value": "needs_rewrite",
            }
        ],
        "override",
    )

    assert adjusted_scores[0]["adjusted_score"] == 6.0
    assert adjusted_overall == 6.0


def test_build_admin_override_doc_requires_adjusted_value_for_non_score_override():
    payload = server.AdminScoreOverride(
        override_type="recommendation_usefulness",
        target_type="recommendation",
        target_id="teacher-recommendation-0",
    )

    with pytest.raises(server.HTTPException):
        assessment_service._build_admin_override_doc(
            "assessment-1",
            payload,
            {"id": "admin-1", "role": "admin"},
        )
