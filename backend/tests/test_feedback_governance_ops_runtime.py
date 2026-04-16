import asyncio
from datetime import datetime, timedelta, timezone
import importlib.util
import os
from pathlib import Path
import sys
import types


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
    spec = importlib.util.spec_from_file_location("backend_server_feedback_ops_runtime", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda item: item.get(field) or "", reverse=reverse)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query or {}))

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        include_keys = {key for key, value in projection.items() if value}
        if not include_keys:
            return dict(doc)
        return {key: value for key, value in doc.items() if key in include_keys}

    def _matches(self, doc, query):
        for key, value in (query or {}).items():
            if key == "$or":
                if not any(self._matches(doc, item) for item in value):
                    return False
                continue
            if isinstance(value, dict):
                doc_value = doc.get(key)
                for operator, expected in value.items():
                    if operator == "$in":
                        if doc_value not in expected:
                            return False
                    elif operator == "$gte":
                        if doc_value is None or doc_value < expected:
                            return False
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$exists":
                        exists = key in doc
                        if bool(expected) != exists:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _build_minimal_admin_ops_db():
    return types.SimpleNamespace(
        teachers=_Collection([]),
        assessments=_Collection([]),
        recording_policies=_Collection([]),
        teacher_face_profiles=_Collection([]),
        schedules=_Collection([]),
        gradebook_integrations=_Collection([]),
        videos=_Collection([]),
        feedback_review_queue=_Collection([]),
        video_processing_jobs=_Collection([]),
        video_privacy_jobs=_Collection([]),
        notifications=_Collection([]),
    )


def _governance_snapshot_fixture(*, incident_level="amber"):
    return {
        "generated_at": "2026-04-16T10:00:00+00:00",
        "scope_owner_user_id": "admin-1",
        "policy": {
            "master_observer_pipeline_enabled": True,
            "master_observer_require_voice_gate_pass": True,
            "voice_gate_release_enforcement_enabled": True,
            "voice_gate_human_escalation_enabled": True,
            "voice_gate_regen_max_attempts": 2,
            "release_gate_active": True,
            "policy_drift": False,
        },
        "assessment_counts": {
            "total": 12,
            "released": 10,
            "blocked": 2,
            "pending_human_review": 2,
            "blocked_without_queue": 0,
            "overrides_total": 1,
            "blocked_last_24h": 1,
            "overrides_last_24h": 1,
            "blocked_rate": 0.1667,
        },
        "review_queue": {
            "pending": 2,
            "oldest_pending_age_minutes": 18,
            "resolved_release_approved_last_24h": 1,
            "resolved_needs_regeneration_last_24h": 1,
            "resolved_dismissed_last_24h": 0,
        },
        "top_voice_gate_failures": [{"failure": "language.banned_term:correlation", "count": 2}],
        "incident_level": incident_level,
        "recommended_actions": ["Work the feedback human-review queue to unblock teacher-facing release."],
    }


def test_feedback_governance_runtime_snapshot_tracks_counts_and_top_failures(monkeypatch):
    now = datetime(2026, 4, 16, 12, 0, tzinfo=timezone.utc)
    recent_iso = (now - timedelta(minutes=30)).isoformat()
    old_iso = (now - timedelta(days=2)).isoformat()
    fake_db = types.SimpleNamespace(
        assessments=_Collection(
            [
                {"id": "a1", "user_id": "admin-1", "feedback_release_status": "released", "analyzed_at": recent_iso},
                {
                    "id": "a2",
                    "user_id": "admin-1",
                    "feedback_release_status": "blocked",
                    "feedback_human_review_required": True,
                    "feedback_review_queue_id": "rq-1",
                    "voice_gate_failures": ["language.banned_term:correlation"],
                    "analyzed_at": recent_iso,
                },
                {
                    "id": "a3",
                    "user_id": "admin-1",
                    "feedback_release_status": "blocked",
                    "feedback_human_review_required": True,
                    "feedback_review_queue_id": "rq-2",
                    "voice_gate_failures": ["language.banned_term:correlation", "snapshot.list_like"],
                    "analyzed_at": old_iso,
                    "feedback_release_override_at": recent_iso,
                },
            ]
        ),
        feedback_review_queue=_Collection(
            [
                {"id": "rq-1", "owner_user_id": "admin-1", "status": "pending", "created_at": recent_iso},
                {
                    "id": "rq-2",
                    "owner_user_id": "admin-1",
                    "status": "resolved_release_approved",
                    "created_at": old_iso,
                    "resolved_at": recent_iso,
                },
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)
    monkeypatch.setattr(server, "VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED", True)
    monkeypatch.setattr(server, "VOICE_GATE_HUMAN_ESCALATION_ENABLED", True)
    monkeypatch.setattr(server, "VOICE_GATE_REGEN_MAX_ATTEMPTS", 2)

    snapshot = asyncio.run(
        server._get_feedback_governance_runtime_snapshot(owner_user_id="admin-1", now=now)
    )

    assert snapshot["assessment_counts"]["total"] == 3
    assert snapshot["assessment_counts"]["blocked"] == 2
    assert snapshot["assessment_counts"]["blocked_without_queue"] == 0
    assert snapshot["review_queue"]["pending"] == 1
    assert snapshot["review_queue"]["oldest_pending_age_minutes"] == 30
    assert snapshot["top_voice_gate_failures"][0]["failure"] == "language.banned_term:correlation"
    assert snapshot["top_voice_gate_failures"][0]["count"] == 2
    assert snapshot["incident_level"] == "amber"


def test_feedback_governance_runtime_snapshot_flags_policy_drift_and_red_incident(monkeypatch):
    now = datetime(2026, 4, 16, 12, 0, tzinfo=timezone.utc)
    recent_iso = (now - timedelta(minutes=5)).isoformat()
    fake_db = types.SimpleNamespace(
        assessments=_Collection(
            [
                {
                    "id": "a-blocked",
                    "user_id": "admin-1",
                    "feedback_release_status": "blocked",
                    "feedback_human_review_required": True,
                    "feedback_review_queue_id": None,
                    "voice_gate_failures": ["language.banned_term:correlation"],
                    "analyzed_at": recent_iso,
                }
            ]
        ),
        feedback_review_queue=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)
    monkeypatch.setattr(server, "VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED", False)
    monkeypatch.setattr(server, "VOICE_GATE_HUMAN_ESCALATION_ENABLED", False)
    monkeypatch.setattr(server, "VOICE_GATE_REGEN_MAX_ATTEMPTS", 2)

    snapshot = asyncio.run(
        server._get_feedback_governance_runtime_snapshot(owner_user_id="admin-1", now=now)
    )

    assert snapshot["policy"]["policy_drift"] is True
    assert snapshot["assessment_counts"]["blocked_without_queue"] == 1
    assert snapshot["incident_level"] == "red"
    assert any("VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED" in item for item in snapshot["recommended_actions"])
    assert any("VOICE_GATE_HUMAN_ESCALATION_ENABLED" in item for item in snapshot["recommended_actions"])


def test_admin_ops_readiness_includes_feedback_governance_metrics(monkeypatch):
    fake_db = _build_minimal_admin_ops_db()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(
        server,
        "_get_feedback_governance_runtime_snapshot",
        lambda **kwargs: asyncio.sleep(0, result=_governance_snapshot_fixture()),
    )
    monkeypatch.setattr(
        server,
        "observability_snapshot",
        lambda: {"analysis": {"total_runs": 5, "failed_runs": 1, "by_mode": {"openai": 4}, "recent_failures": []}},
    )

    payload = asyncio.run(
        server.get_admin_ops_readiness(
            current_user={"id": "admin-1", "email": "admin@example.com", "role": "admin"}
        )
    )

    assert payload["metrics"]["feedback_release_blocked"] == 2
    assert payload["metrics"]["feedback_review_queue_pending"] == 2
    assert payload["observability"]["feedback_governance"]["incident_level"] == "amber"


def test_admin_ops_launch_health_and_observability_embed_governance(monkeypatch):
    fake_db = _build_minimal_admin_ops_db()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(
        server,
        "_get_feedback_governance_runtime_snapshot",
        lambda **kwargs: asyncio.sleep(0, result=_governance_snapshot_fixture(incident_level="red")),
    )
    monkeypatch.setattr(
        server,
        "observability_snapshot",
        lambda: {
            "analysis": {
                "average_duration_seconds": 8.1,
                "average_estimated_input_tokens": 1000.0,
                "average_estimated_output_tokens": 450.0,
                "total_runs": 8,
                "failed_runs": 1,
                "by_mode": {"openai": 7},
                "recent_failures": [],
            }
        },
    )
    monkeypatch.setattr(server, "VIDEO_JOB_QUEUE", types.SimpleNamespace(qsize=lambda: 0))
    monkeypatch.setattr(server, "VIDEO_PRIVACY_JOB_QUEUE", types.SimpleNamespace(qsize=lambda: 0))
    monkeypatch.setattr(server, "refresh_runtime_metrics", lambda: asyncio.sleep(0))
    monkeypatch.setattr(server, "_get_specialist_activity_snapshot", lambda current_user: asyncio.sleep(0, result={}))
    monkeypatch.setattr(server, "app_metrics", types.SimpleNamespace(snapshot_summary=lambda: {}))

    launch_payload = asyncio.run(
        server.get_admin_ops_launch_health(
            current_user={"id": "admin-1", "email": "admin@example.com", "role": "admin"}
        )
    )
    observability_payload = asyncio.run(
        server.get_admin_ops_observability(
            current_user={"id": "admin-1", "email": "admin@example.com", "role": "admin"}
        )
    )

    assert launch_payload["incident_level"] == "red"
    assert launch_payload["metrics"]["feedback_release_blocked"] == 2
    assert any("human-review queue" in item for item in launch_payload["recommended_actions"])
    assert observability_payload["observability"]["feedback_governance"]["incident_level"] == "red"
