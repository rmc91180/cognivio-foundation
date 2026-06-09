import asyncio
import types

from fastapi.testclient import TestClient

import server
from app import rate_limit
from scripts.ensure_indexes import INDEX_SPECS, ensure_indexes, expected_index_summary


class _FakeRateLimitRedis:
    """A4: in-memory async Redis stand-in so the rate-limit middleware actually
    counts in tests (production now counts in Redis; there is no Redis in the test
    env, where the limiter otherwise fail-opens). Replaces the old in-process
    bucket dicts these tests used to clear()."""

    def __init__(self):
        self.counts = {}
        self.ttls = {}

    async def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        self.ttls[key] = seconds
        return True

    async def ttl(self, key):
        return self.ttls.get(key, -1)


def _install_fake_rate_limit_redis(monkeypatch):
    fake = _FakeRateLimitRedis()

    async def _fake_get_client():
        return fake

    monkeypatch.setattr(rate_limit, "_get_client", _fake_get_client)
    return fake


class _IndexCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    async def to_list(self, limit):
        return self.docs


class _IndexCollection:
    def __init__(self, name, existing=None, fail_list=False):
        self.name = name
        self.created = []
        self.existing = list(existing or [{"name": "_id_", "key": {"_id": 1}}])
        self.fail_list = fail_list

    async def create_index(self, keys, **kwargs):
        self.created.append((tuple(keys), dict(kwargs)))
        self.existing.append(
            {
                "name": kwargs.get("name") or "_generated_",
                "key": {field: direction for field, direction in keys},
                "unique": bool(kwargs.get("unique", False)),
            }
        )
        return kwargs.get("name")

    def list_indexes(self):
        if self.fail_list:
            raise RuntimeError("secret mongodb url should not leak")
        return _IndexCursor(self.existing)


class _IndexDb:
    def __init__(self, fail_collection=None):
        self.collections = {}
        self.fail_collection = fail_collection
        self.commands = []

    def __getitem__(self, name):
        if name not in self.collections:
            self.collections[name] = _IndexCollection(name, fail_list=name == self.fail_collection)
        return self.collections[name]

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return self[name]

    async def command(self, command, collection_name=None):
        self.commands.append((command, collection_name))
        if command == "collStats":
            return {"count": 0, "storageSize": 0, "totalIndexSize": 0, "indexSizes": {}}
        return {"ok": 1}


def test_pr26_index_inventory_covers_security_sensitive_collections():
    summary = expected_index_summary()
    spec_collections = {spec.collection for spec in INDEX_SPECS}

    assert summary["expected_indexes"] >= 70
    for collection in {
        "users",
        "user_sessions",
        "videos",
        "assessments",
        "video_comments",
        "video_audio_transcripts",
        "reports",
        "teacher_face_references",
        "coaching_tasks",
        "recognition_badges",
        "framework_selections",
        "master_admin_audit_events",
        "privacy_audit_events",
    }:
        assert collection in spec_collections


def test_pr26_index_helper_is_idempotent_shape():
    db = _IndexDb()

    first = asyncio.run(ensure_indexes(db, specs=INDEX_SPECS[:3]))
    second = asyncio.run(ensure_indexes(db, specs=INDEX_SPECS[:3]))

    assert first["attempted"] == 3
    assert second["attempted"] == 3
    assert first["skipped"] == 0
    assert all(collection.created for collection in db.collections.values())


def test_admin_db_health_reports_missing_indexes_without_secrets(monkeypatch):
    fake_db = _IndexDb(fail_collection="users")
    monkeypatch.setattr(server, "db", fake_db)

    payload = asyncio.run(server._build_db_index_health())
    users = next(item for item in payload["collections"] if item["collection"] == "users")

    assert payload["healthy"] is False
    assert users["stats"]["reason_code"] == "index_health_unavailable"
    assert "secret mongodb url" not in str(payload)


def test_endpoint_rate_limit_returns_json_reason_and_cors(monkeypatch):
    _install_fake_rate_limit_redis(monkeypatch)  # A4: Redis-backed limiter (was in-process dict)
    monkeypatch.setitem(
        server.ENDPOINT_RATE_LIMIT_RULES,
        ("POST", "/api/pr26-rate-limit-smoke"),
        (1, 60, "login_rate_limited"),
    )
    client = TestClient(server.app)

    client.post("/api/pr26-rate-limit-smoke", json={})
    response = client.post(
        "/api/pr26-rate-limit-smoke",
        json={},
        headers={"Origin": "https://app.cognivio.live"},
    )

    assert response.status_code == 429
    assert response.json()["reason_code"] == "login_rate_limited"
    assert response.headers["access-control-allow-origin"]
    assert int(response.headers["retry-after"]) >= 1


def test_general_post_rate_limit_uses_structured_reason(monkeypatch):
    _install_fake_rate_limit_redis(monkeypatch)  # A4: Redis-backed limiter (was in-process dict)
    monkeypatch.setattr(server, "POST_RATE_LIMIT_MAX_REQUESTS", 1)
    monkeypatch.setattr(server, "POST_RATE_LIMIT_EXEMPT_PATHS", set())
    monkeypatch.setattr(server, "ENDPOINT_RATE_LIMIT_RULES", {})
    client = TestClient(server.app)

    client.post("/api/not-a-real-route", json={})
    response = client.post("/api/not-a-real-route", json={})

    assert response.status_code == 429
    assert response.json()["reason_code"] == "post_rate_limited"
