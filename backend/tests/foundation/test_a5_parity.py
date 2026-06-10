"""A5 — Phase A exit-gate parity harness. DESELECTED by default
(-m "not parity"). Run by hand against REAL ephemeral infra to clear Phase A.

Stand up disposable infra (local Docker; both torn down after):
    docker run --rm -d -p 27018:27017 --name a5mongo mongo:7
    docker run --rm -d -p 6380:6379 --name a5redis redis:7
Point the harness at them and run ONLY the parity tests:
    $env:MONGO_PARITY_URL = "mongodb://localhost:27018"
    $env:REDIS_PARITY_URL = "redis://localhost:6380"
    python -m pytest backend/tests/foundation/test_a5_parity.py -m parity -q
Tear down:
    docker rm -f a5mongo a5redis
Non-default ports (27018/6380) avoid colliding with any local mongod/Redis.
If MONGO_PARITY_URL / REDIS_PARITY_URL are unset, every test SKIPS cleanly
(never errors) — so a bare `pytest -m parity` with no infra is a no-op.

WHY THIS EXISTS (retires two doubts the fake-backed suite structurally cannot test):
  * mongomock silently ACCEPTED duplicates on the unique partial index, so the
    A2/A3 idempotent-assessment guarantee is unproven against a real backend. A5-M1
    proves real mongod rejects the duplicate; A5-M3 runs the A3 stamp write
    behaviorally under the enforced index.
  * The A4 rate-limit stub was a single in-memory dict and could not prove
    cross-replica counter sharing. A5-R1 drives the REAL check_fixed_window and
    forces a fresh client mid-test to prove a new connection inherits the counter.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError

from scripts.ensure_indexes import ensure_indexes, INDEX_SPECS  # mirrors server.py:34216
from app import rate_limit

# Every test in this module requires real infra and is deselected by default.
pytestmark = [pytest.mark.asyncio, pytest.mark.parity]


# ---------------------------------------------------------------------------
# Fixtures — skip cleanly (never error) when the parity env vars are unset.
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def mongo_db():
    url = os.environ.get("MONGO_PARITY_URL")
    if not url:
        pytest.skip("MONGO_PARITY_URL unset — mongod parity skipped")
    client = AsyncIOMotorClient(url)
    db_name = f"a5_parity_{uuid4().hex}"  # unique throwaway db; never an existing name
    db = client[db_name]
    try:
        yield db
    finally:
        await client.drop_database(db_name)
        client.close()


@pytest_asyncio.fixture
async def redis_ready(monkeypatch):
    url = os.environ.get("REDIS_PARITY_URL")
    if not url:
        pytest.skip("REDIS_PARITY_URL unset — Redis parity skipped")
    # Approach (b): point the SHIPPING module at parity Redis and clear the cached
    # singleton so check_fixed_window builds a real client against it. monkeypatch
    # auto-restores REDIS_URL/_client/_client_init_attempted after the test.
    monkeypatch.setattr(rate_limit, "REDIS_URL", url)
    monkeypatch.setattr(rate_limit, "_client", None)
    monkeypatch.setattr(rate_limit, "_client_init_attempted", False)
    try:
        yield url
    finally:
        await rate_limit.aclose()  # close whatever live client the test built


# ===========================================================================
# HALF 1 — mongod parity
# ===========================================================================
async def test_a5_m1_unique_index_rejects_duplicate(mongo_db):
    """KEYSTONE: real mongod rejects a second (video_id, analysis_run_id) duplicate
    — the assertion mongomock could never make. If green, A2/A3 idempotency is real."""
    await ensure_indexes(mongo_db)
    await mongo_db.assessments.insert_one(
        {"id": "a1", "video_id": "v1", "analysis_run_id": "r1", "workspace_id": "ws1"}
    )
    with pytest.raises(DuplicateKeyError):
        await mongo_db.assessments.insert_one(
            {"id": "a2", "video_id": "v1", "analysis_run_id": "r1"}
        )


async def test_a5_m2_partial_filter_excludes_legacy_rows(mongo_db):
    """partialFilterExpression {"analysis_run_id": {"$exists": True}} carves legacy
    docs (no analysis_run_id) out of the unique constraint — both must insert."""
    await ensure_indexes(mongo_db)
    await mongo_db.assessments.insert_one({"id": "L1", "video_id": "v9"})
    await mongo_db.assessments.insert_one({"id": "L2", "video_id": "v9"})  # same vid, no run_id
    assert await mongo_db.assessments.count_documents({"video_id": "v9"}) == 2


async def test_a5_m3_upsert_contract_and_tenancy_stamp(mongo_db):
    """A3 write contract (server.py ~29965) under the enforced index: same
    (video_id, run_id) upserted twice → ONE doc; a NEW run_id → a second doc;
    workspace_id round-trips (tenancy stamp exercised behaviorally)."""
    await ensure_indexes(mongo_db)
    doc_a = {"id": "x1", "video_id": "vU", "analysis_run_id": "rA",
             "workspace_id": "wsU", "subject": "Math"}
    await mongo_db.assessments.update_one(
        {"video_id": "vU", "analysis_run_id": "rA"}, {"$setOnInsert": doc_a}, upsert=True)
    # Same (video_id, run_id) again → no-op (idempotent).
    await mongo_db.assessments.update_one(
        {"video_id": "vU", "analysis_run_id": "rA"},
        {"$setOnInsert": {"id": "x2", "video_id": "vU", "analysis_run_id": "rA"}}, upsert=True)
    assert await mongo_db.assessments.count_documents({"video_id": "vU"}) == 1

    # A NEW analysis_run_id for the same video → a new assessment alongside.
    await mongo_db.assessments.update_one(
        {"video_id": "vU", "analysis_run_id": "rB"},
        {"$setOnInsert": {"id": "x3", "video_id": "vU", "analysis_run_id": "rB",
                          "workspace_id": "wsU"}}, upsert=True)
    assert await mongo_db.assessments.count_documents({"video_id": "vU"}) == 2

    stored = await mongo_db.assessments.find_one({"video_id": "vU", "analysis_run_id": "rA"})
    assert stored["workspace_id"] == "wsU"  # A3 tenancy stamp round-trips


# ===========================================================================
# HALF 2 — Redis parity (approach (b): drive the REAL check_fixed_window)
# ===========================================================================
async def test_a5_r1_cross_replica_counter_survives_client_replacement(redis_ready):
    """The cross-replica proof the A4 stub could not make: three allowed hits, then
    a FRESH client (a 2nd 'replica') sees the prior increments and is LIMITED."""
    key = "ratelimit:parity:" + uuid4().hex
    assert await rate_limit.check_fixed_window(key, 3, 60) is None  # 1
    assert await rate_limit.check_fixed_window(key, 3, 60) is None  # 2
    assert await rate_limit.check_fixed_window(key, 3, 60) is None  # 3

    # Force a brand-new connection = a second api replica sharing one Redis.
    await rate_limit.aclose()
    rate_limit._client = None
    rate_limit._client_init_attempted = False

    limited = await rate_limit.check_fixed_window(key, 3, 60)  # 4th hit, fresh client
    assert isinstance(limited, int) and limited >= 1, "fresh client must inherit the shared counter"


async def test_a5_r2_retry_after_is_real_ttl(redis_ready):
    """retry_after is the key's remaining TTL from real Redis (not a constant):
    1 <= retry_after <= window_seconds."""
    key = "ratelimit:parity:" + uuid4().hex
    assert await rate_limit.check_fixed_window(key, 1, 30) is None  # allowed, sets ttl≈30
    retry = await rate_limit.check_fixed_window(key, 1, 30)  # limited
    assert isinstance(retry, int)
    assert 1 <= retry <= 30


async def test_a5_r3_fail_open_on_unreachable_redis(redis_ready):
    """A REAL connection failure must fail OPEN (allow). Point at a dead endpoint,
    reset the cached client, and assert None. The stub only faked this path."""
    rate_limit.REDIS_URL = "redis://localhost:1"  # connection-refused fast
    await rate_limit.aclose()
    rate_limit._client = None
    rate_limit._client_init_attempted = False

    result = await rate_limit.check_fixed_window("ratelimit:parity:dead:" + uuid4().hex, 1, 60)
    assert result is None  # fail-open
    # Teardown: redis_ready fixture's monkeypatch restores REDIS_URL/_client and
    # calls aclose(), so the dead URL never leaks into another test.
