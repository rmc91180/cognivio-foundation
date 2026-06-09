"""A4 — Redis-backed cross-replica rate limiting.

Proves the fixed-window PRIMITIVE, the FAIL-OPEN contract, and that rewiring the
two consume functions preserved their exact return contracts (the middleware
depends on those). Uses a minimal in-test async Redis stub (fakeredis is not a
pinned dependency). Real-Redis behavior is A5's parity bar.
"""

from __future__ import annotations

import types

import pytest

import server
from app import rate_limit


# --- Minimal async Redis stub (incr/expire/ttl) ---------------------------------
class _FakeRedis:
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

    async def ping(self):
        return True


class _RaisingRedis(_FakeRedis):
    async def incr(self, key):
        raise RuntimeError("simulated redis outage")


def _use_client(monkeypatch, client):
    async def _fake_get_client():
        return client
    monkeypatch.setattr(rate_limit, "_get_client", _fake_get_client)


# --- R1: allow first max_requests, limit max+1, same key ------------------------
@pytest.mark.asyncio
async def test_r1_allows_then_limits_within_window(monkeypatch):
    _use_client(monkeypatch, _FakeRedis())
    key, max_req, window = "ratelimit:test:r1", 3, 60
    results = [await rate_limit.check_fixed_window(key, max_req, window) for _ in range(max_req)]
    assert results == [None, None, None], "first max_requests calls must be allowed"
    limited = await rate_limit.check_fixed_window(key, max_req, window)
    assert isinstance(limited, int) and limited >= 1, "the (max+1)th call must be limited"


# --- R2: distinct keys are independent ------------------------------------------
@pytest.mark.asyncio
async def test_r2_distinct_keys_independent(monkeypatch):
    _use_client(monkeypatch, _FakeRedis())
    assert await rate_limit.check_fixed_window("ratelimit:test:a", 1, 60) is None
    # client B's first hit must still be allowed (separate budget).
    assert await rate_limit.check_fixed_window("ratelimit:test:b", 1, 60) is None
    # client A's second hit is limited (proves A's budget was consumed, not B's).
    assert isinstance(await rate_limit.check_fixed_window("ratelimit:test:a", 1, 60), int)


# --- R3: fail-open when redis raises --------------------------------------------
@pytest.mark.asyncio
async def test_r3_fail_open_on_redis_error(monkeypatch):
    _use_client(monkeypatch, _RaisingRedis())
    # incr raises → must be swallowed and the request allowed.
    assert await rate_limit.check_fixed_window("ratelimit:test:r3", 1, 60) is None


# --- R4: no client configured → fail-open ---------------------------------------
@pytest.mark.asyncio
async def test_r4_fail_open_when_no_client(monkeypatch):
    async def _none_client():
        return None
    monkeypatch.setattr(rate_limit, "_get_client", _none_client)
    assert await rate_limit.check_fixed_window("ratelimit:test:r4", 1, 60) is None


# --- R5: retry_after derived from TTL, >= 1 -------------------------------------
@pytest.mark.asyncio
async def test_r5_retry_after_from_ttl(monkeypatch):
    fake = _FakeRedis()
    _use_client(monkeypatch, fake)
    key, window = "ratelimit:test:r5", 45
    await rate_limit.check_fixed_window(key, 1, window)  # count=1, sets ttl=45
    retry = await rate_limit.check_fixed_window(key, 1, window)  # count=2 > 1 → limited
    assert retry == 45  # TTL-derived

    # Edge: TTL missing/-1 falls back to window_seconds, still >= 1.
    fake.ttls.pop(key, None)
    retry2 = await rate_limit.check_fixed_window(key, 1, window)
    assert retry2 == window and retry2 >= 1


# --- R6: consume functions preserve their return contracts ----------------------
class _Req:
    def __init__(self, method, path, host="1.2.3.4"):
        self.method = method
        self.url = types.SimpleNamespace(path=path)
        self.client = types.SimpleNamespace(host=host)
        self.headers = {}


@pytest.mark.asyncio
async def test_r6_consume_contracts_preserved(monkeypatch):
    async def _fake_check(key, max_requests, window_seconds):
        return 7  # always "limited" so we can observe the contract shape
    monkeypatch.setattr(rate_limit, "check_fixed_window", _fake_check)

    # endpoint limiter: matched rule → (retry_after, reason_code)
    res = await server._consume_endpoint_rate_limit(_Req("POST", "/api/auth/login"))
    assert res == (7, "login_rate_limited")
    # endpoint limiter: unmatched path → None (rule miss, never consults redis)
    assert await server._consume_endpoint_rate_limit(_Req("GET", "/api/does-not-exist")) is None

    # post limiter: limited POST /api/* (not exempt) → int
    assert await server._consume_post_rate_limit(_Req("POST", "/api/teachers/me/coaching")) == 7
    # post limiter: exempt path → None
    assert await server._consume_post_rate_limit(_Req("POST", "/api/auth/login")) is None
    # post limiter: non-POST → None
    assert await server._consume_post_rate_limit(_Req("GET", "/api/teachers/me/coaching")) is None
