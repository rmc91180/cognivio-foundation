"""A2 — replica-safe, idempotent claim model for the ANALYSIS worker.

Component tests against mongomock-motor (sanctioned fallback; no real mongod in
this environment). C1 and C3 assert concurrency / replica-safety semantics that
mongomock can only EMULATE single-process — the assertions are written to be
correct under a REAL ephemeral mongod, which A5's harness will run for the true
race proof. "Green under mongomock" here is a contract check, NOT a race proof.

Run: cd backend && python -m pytest tests/foundation/test_analysis_claim_model_a2.py -v
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from mongomock_motor import AsyncMongoMockClient

import server


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@pytest.fixture
def mock_db(monkeypatch):
    client = AsyncMongoMockClient()
    db = client["a2_test_db"]
    monkeypatch.setattr(server, "db", db, raising=False)
    return db


async def _seed_job(db, **fields):
    doc = {
        "id": fields.get("id", f"job-{fields['video_id']}"),
        "status": server.VideoProcessingStatus.QUEUED.value,
        "attempts": 0,
        "retry_count": 0,
        "analysis_run_id": fields.get("analysis_run_id", "run-fixed"),
        "teacher_id": "t1",
        "user_id": "u1",
        "file_path": "videos/t1/x.mp4",
        "created_at": _iso(datetime.now(timezone.utc)),
    }
    doc.update(fields)
    await db.video_processing_jobs.insert_one(doc)
    return doc


# ---------------------------------------------------------------------------
# C1 — CLAIM ATOMICITY (race-proven under real mongod in A5; emulated here)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_c1_claim_atomicity_single_winner(mock_db):
    """Two concurrent claims of ONE queued job → claimed EXACTLY ONCE (single winner).

    NOTE: atomicity emulated under mongomock; race-proven under real mongod in A5.
    mongomock's find_one_and_update applies the update but returns None when a
    `sort` is supplied (a mongomock fidelity gap, not a production defect — the
    claim is the live, deployed primitive), so we cannot assert on the RETURNED
    winner here. We assert the DB single-winner invariant instead: the job is
    PROCESSING and `attempts` was incremented exactly once. The return-value
    winner-detection is proven under real mongod in A5."""
    await _seed_job(mock_db, video_id="v-c1")
    await asyncio.gather(
        server._claim_video_processing_job("worker-a"),
        server._claim_video_processing_job("worker-b"),
    )
    job = await mock_db.video_processing_jobs.find_one({"video_id": "v-c1"})
    assert job["status"] == server.VideoProcessingStatus.PROCESSING.value
    assert job["attempts"] == 1, f"single-winner violated: attempts={job['attempts']}"
    assert job["claimed_instance"] == server.VIDEO_WORKER_INSTANCE_ID


# ---------------------------------------------------------------------------
# C2 — RECLAIMER recovers ONLY stale jobs; preserves analysis_run_id
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_c2_reclaimer_recovers_only_stale_and_preserves_run_id(mock_db):
    now = datetime.now(timezone.utc)
    # fresh: heartbeat 10s ago, claimed 10s ago → must stay PROCESSING
    await _seed_job(
        mock_db, video_id="v-fresh", status=server.VideoProcessingStatus.PROCESSING.value,
        claimed_by="w1", claimed_instance="i1", claimed_at=_iso(now - timedelta(seconds=10)),
        last_heartbeat=_iso(now - timedelta(seconds=10)), analysis_run_id="run-fresh",
    )
    # stale heartbeat: 120s ago (>90s) → reclaim
    await _seed_job(
        mock_db, video_id="v-stale", status=server.VideoProcessingStatus.PROCESSING.value,
        claimed_by="w1", claimed_instance="i1", claimed_at=_iso(now - timedelta(seconds=120)),
        last_heartbeat=_iso(now - timedelta(seconds=120)), analysis_run_id="run-stale",
    )
    # wall-clock ceiling: heartbeat FRESH (5s) but claimed 31min ago → reclaim
    await _seed_job(
        mock_db, video_id="v-ceiling", status=server.VideoProcessingStatus.PROCESSING.value,
        claimed_by="w1", claimed_instance="i1", claimed_at=_iso(now - timedelta(minutes=31)),
        last_heartbeat=_iso(now - timedelta(seconds=5)), analysis_run_id="run-ceiling",
    )

    await server._reclaim_stale_video_jobs()

    # Assert DB state (the real outcome). mongomock's find_one_and_update return
    # is unreliable with a projection, so we don't assert on the returned list;
    # the EXACT reclaim set is reconstructed from DB state below.
    fresh = await mock_db.video_processing_jobs.find_one({"video_id": "v-fresh"})
    assert fresh["status"] == server.VideoProcessingStatus.PROCESSING.value, "fresh-heartbeat job must NOT be reclaimed"
    for vid, run in (("v-stale", "run-stale"), ("v-ceiling", "run-ceiling")):
        doc = await mock_db.video_processing_jobs.find_one({"video_id": vid})
        assert doc["status"] == server.VideoProcessingStatus.QUEUED.value, f"{vid} should be reclaimed"
        assert doc["claimed_by"] is None and doc["claimed_at"] is None
        # CRITICAL: reclaim is the SAME analysis attempt — run_id preserved.
        assert doc["analysis_run_id"] == run


# ---------------------------------------------------------------------------
# C3 — INSTANCE-FILTERED REHYDRATION (double-spend regression)
#      emulated under mongomock; race-proven under real mongod in A5
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_c3_instance_filtered_rehydration_no_double_spend(mock_db, monkeypatch):
    """Replica A restarting must reset ONLY its own jobs, never replica B's
    actively-heartbeating job. Both jobs share the colliding worker label
    'video-worker-1'; the discriminator is claimed_instance + heartbeat."""
    now = datetime.now(timezone.utc)
    fresh_hb = _iso(now - timedelta(seconds=5))
    # A's job: owned by replica-A, fresh heartbeat (A just died → instance-match resets it)
    await _seed_job(
        mock_db, video_id="v-A", status=server.VideoProcessingStatus.PROCESSING.value,
        claimed_by="video-worker-1", claimed_instance="replica-A",
        claimed_at=_iso(now - timedelta(seconds=5)), last_heartbeat=fresh_hb,
    )
    # B's job: owned by replica-B, fresh heartbeat (B is ALIVE → must be untouched)
    await _seed_job(
        mock_db, video_id="v-B", status=server.VideoProcessingStatus.PROCESSING.value,
        claimed_by="video-worker-1", claimed_instance="replica-B",
        claimed_at=_iso(now - timedelta(seconds=5)), last_heartbeat=fresh_hb,
    )
    monkeypatch.setattr(server, "VIDEO_WORKER_INSTANCE_ID", "replica-A", raising=False)

    await server._rehydrate_video_processing_queue()

    job_a = await mock_db.video_processing_jobs.find_one({"video_id": "v-A"})
    job_b = await mock_db.video_processing_jobs.find_one({"video_id": "v-B"})
    assert job_a["status"] == server.VideoProcessingStatus.QUEUED.value, "A's own job must be requeued"
    assert job_b["status"] == server.VideoProcessingStatus.PROCESSING.value, "B's live job must NOT be touched (double-spend)"


# ---------------------------------------------------------------------------
# C4 — IDEMPOTENT vs NEW (scheme iii): the completion-write contract
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_c4_idempotent_same_run_new_alongside_different_run(mock_db):
    """Exercises the exact upsert the completion path uses:
    same (video_id, analysis_run_id) twice → ONE doc; different run_id → a NEW
    doc alongside (deliberate re-analysis, scheme iii)."""
    def _doc(run_id):
        return {"id": f"a-{run_id}", "video_id": "v-c4", "analysis_run_id": run_id, "summary": "s"}

    async def _write(run_id):
        await mock_db.assessments.update_one(
            {"video_id": "v-c4", "analysis_run_id": run_id},
            {"$setOnInsert": _doc(run_id)},
            upsert=True,
        )

    await _write("run-1")
    await _write("run-1")  # same run reprocessed (crash/reclaim/retry) → no-op
    assert await mock_db.assessments.count_documents({"video_id": "v-c4"}) == 1

    await _write("run-2")  # different run_id → new assessment alongside
    assert await mock_db.assessments.count_documents({"video_id": "v-c4"}) == 2
    runs = {d["analysis_run_id"] async for d in mock_db.assessments.find({"video_id": "v-c4"})}
    assert runs == {"run-1", "run-2"}


# ---------------------------------------------------------------------------
# C5 — DEAD-LETTER + ALERT on 3rd failure
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_c5_dead_letter_and_alert_on_third_failure(mock_db, monkeypatch):
    await _seed_job(
        mock_db, video_id="v-c5", retry_count=2,
        status=server.VideoProcessingStatus.QUEUED.value, analysis_run_id="run-c5",
    )
    await mock_db.videos.insert_one({"id": "v-c5", "teacher_id": "t1", "uploaded_by": "u1"})

    async def _fake_analyze(*, video_id, file_path, teacher_id, user_id, analysis_run_id=None):
        return False, "technical failure: model exploded"

    async def _noop_hb(*a, **k):
        return None

    # mongomock's sorted find_one_and_update returns None (fidelity gap, not a
    # production defect — claim atomicity is C1's job). Stub the claim's RETURN
    # so this test exercises the real failure→dead-letter→alert path under test.
    async def _fake_claim(worker_label, video_id=None):
        return await mock_db.video_processing_jobs.find_one({"video_id": "v-c5"}, {"_id": 0})

    monkeypatch.setattr(server, "_claim_video_processing_job", _fake_claim, raising=False)
    monkeypatch.setattr(server, "analyze_video", _fake_analyze, raising=False)
    monkeypatch.setattr(server, "_resolve_replica_local_input", lambda v: "/tmp/x.mp4", raising=False)
    monkeypatch.setattr(server, "_heartbeat_during_job", _noop_hb, raising=False)

    await server._run_video_job("v-c5", "worker-a")

    job = await mock_db.video_processing_jobs.find_one({"video_id": "v-c5"})
    assert job["status"] == server.VideoProcessingStatus.DEAD_LETTER.value, "3rd failure must DEAD_LETTER, not FAILED"
    assert job["retry_count"] == 3
    valid_reasons = {r.value for r in server.AnalysisFailureReason}
    assert job.get("failure_reason") in valid_reasons
    alerts = await mock_db.master_admin_alerts.find({"video_id": "v-c5"}).to_list(10)
    assert len(alerts) == 1, f"expected exactly one alert, got {len(alerts)}"
    assert alerts[0]["reason"] in valid_reasons
    assert alerts[0]["status"] == "open"
