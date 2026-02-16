import importlib.util
import os
import random
import sys
import types
from datetime import datetime, timezone
from pathlib import Path


def _load_server_module():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
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
    spec = importlib.util.spec_from_file_location("backend_server", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


def test_build_month_windows_three_month_default_labels():
    now = datetime(2026, 2, 16, 12, 0, tzinfo=timezone.utc)
    windows = server._build_month_windows(3, now=now)

    assert len(windows) == 3
    assert windows[0]["label"] == "Dec 2025"
    assert windows[1]["label"] == "Jan 2026"
    assert windows[2]["label"] == "Feb 2026"


def test_compute_domain_and_overall_deltas():
    periods = [
        {
            "all_teachers": {"overall_score": 6.2, "domain_scores": {"d1": 6.0, "d2": 7.0}},
            "selected_teacher": {"overall_score": 5.8, "domain_scores": {"d1": 5.4, "d2": 6.1}},
        },
        {
            "all_teachers": {"overall_score": 6.8, "domain_scores": {"d1": 6.6, "d2": 7.1}},
            "selected_teacher": {"overall_score": 6.0, "domain_scores": {"d1": 5.7, "d2": 6.0}},
        },
    ]
    domains = [{"id": "d1", "name": "Domain 1"}, {"id": "d2", "name": "Domain 2"}]

    domain_deltas = server._compute_domain_deltas(periods, domains, "all_teachers")
    overall_delta = server._compute_overall_delta(periods, "all_teachers")

    assert overall_delta == 0.6
    by_domain = {item["domain_id"]: item["delta"] for item in domain_deltas}
    assert by_domain["d1"] == 0.6
    assert by_domain["d2"] == 0.1


def test_rule_based_insights_include_teacher_comparison_message():
    trend_payload = {
        "periods": [
            {
                "all_teachers": {"overall_score": 6.0, "domain_scores": {"d1": 5.9}},
                "selected_teacher": {"overall_score": 5.4, "domain_scores": {"d1": 5.0}},
            },
            {
                "all_teachers": {"overall_score": 6.4, "domain_scores": {"d1": 6.3}},
                "selected_teacher": {"overall_score": 5.8, "domain_scores": {"d1": 5.3}},
            },
        ],
        "domains": [{"id": "d1", "name": "Domain 1"}],
        "selected_teacher": {"id": "t1", "name": "Ms. Carter"},
        "teacher_attention_candidates": [],
    }

    insights = server._build_rule_based_leadership_insights(trend_payload)

    assert insights["generated_by"] == "rules"
    assert len(insights["bullets"]) == 3
    assert "Ms. Carter trend is" in insights["bullets"][2]
    assert len(insights["items"]) == 7
    assert any(item.get("target_teacher_id") == "t1" for item in insights["items"])
    for item in insights["items"]:
        assert item["insight"]
        assert item["action"]
        assert item["priority"] in {"high", "medium", "low"}
        assert item["owner"] in {"principal", "coach", "teacher"}
        assert 3 <= item["due_window_days"] <= 60


def test_cache_key_subject_order_is_stable():
    key_one = server._build_leadership_insights_cache_key(
        user_id="u1",
        window_months=3,
        teacher_id="t1",
        subjects=["Math", "Science"],
        framework_type="danielson",
    )
    key_two = server._build_leadership_insights_cache_key(
        user_id="u1",
        window_months=3,
        teacher_id="t1",
        subjects=["science", "math"],
        framework_type="danielson",
    )

    assert key_one == key_two


def test_demo_seed_scores_show_upward_trend_and_variance():
    teacher = {
        "email": "sarah.j@school.edu",
        "subject": "Mathematics",
        "department": "STEM",
    }
    rng = random.Random(42)
    datetimes = server._build_demo_assessment_datetimes(7, rng)
    assert len(datetimes) == 7
    assert datetimes[0] < datetimes[-1]

    overall_scores = []
    for idx in range(len(datetimes)):
        element_scores = server._generate_demo_element_scores_for_assessment(
            teacher=teacher,
            assessment_index=idx,
            total_assessments=len(datetimes),
            rng=rng,
        )
        avg = sum(item["score"] for item in element_scores) / len(element_scores)
        overall_scores.append(avg)

    assert (max(overall_scores) - min(overall_scores)) >= 0.8
    assert (overall_scores[-1] - overall_scores[0]) >= 0.4


def test_demo_seed_scores_show_decline_for_declining_profile():
    teacher = {
        "email": "michael.c@school.edu",
        "subject": "English Literature",
        "department": "Humanities",
    }
    rng = random.Random(7)
    datetimes = server._build_demo_assessment_datetimes(7, rng)

    overall_scores = []
    for idx in range(len(datetimes)):
        element_scores = server._generate_demo_element_scores_for_assessment(
            teacher=teacher,
            assessment_index=idx,
            total_assessments=len(datetimes),
            rng=rng,
        )
        avg = sum(item["score"] for item in element_scores) / len(element_scores)
        overall_scores.append(avg)

    assert (max(overall_scores) - min(overall_scores)) >= 0.8
    assert (overall_scores[-1] - overall_scores[0]) <= -0.3
