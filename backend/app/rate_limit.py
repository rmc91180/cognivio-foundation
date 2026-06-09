"""Canonical cross-replica rate-limit seam (introduced in A4).

The api service runs multiple Railway replicas; the previous in-process dict
counters meant the real limit was (replicas x configured limit) and reset on every
deploy. This module moves counting into Redis so a limit is enforced cluster-wide.

Design:
  * Fixed-window INCR + EXPIRE per (client, rule, window). Deliberately a shared
    wall-clock window, replacing the old per-process monotonic window (which cannot
    work across replicas — monotonic clocks are per-process and unrelated).
  * FAIL-OPEN: any Redis error, or no Redis configured, ALLOWS the request. A rate
    limiter is a protective throttle, not a security gate; a Redis blip must never
    take the API down. This holds for every rule, including login.
  * Namespaced keys so they cannot collide with future Redis use.

Imports NOTHING from server (no import cycle). This is the foundation module a
later live-repo strangle re-implements.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# A4: no REDIS_URL settings field exists today (app.config has none and no code
# reads one), so we read the env var directly with a clear module constant. If a
# settings field is added later, swap this single line.
REDIS_URL: Optional[str] = os.environ.get("REDIS_URL")

_client: Optional["aioredis.Redis"] = None
_client_init_attempted = False


async def _get_client() -> Optional["aioredis.Redis"]:
    """Lazily build (once) and return the async Redis client, or None when no
    REDIS_URL is configured (limiting disabled — fail-open). Connection failures
    are NOT detected here (from_url is lazy); they surface as command exceptions in
    check_fixed_window and are handled fail-open there."""
    global _client, _client_init_attempted
    if _client is not None:
        return _client
    if not REDIS_URL:
        return None
    if _client_init_attempted:
        return _client
    _client_init_attempted = True
    try:
        _client = aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
    except Exception as exc:  # malformed URL etc. — fail-open
        logger.warning("rate_limit: could not construct Redis client: %s", exc)
        _client = None
    return _client


async def warm_ping() -> None:
    """Optional startup probe: log Redis reachability ONCE at startup. Fail-open —
    never raises, so a Redis outage cannot block app startup."""
    if not REDIS_URL:
        logger.info("rate_limit: REDIS_URL not set — cross-replica rate limiting DISABLED (fail-open).")
        return
    try:
        client = await _get_client()
        if client is None:
            logger.warning("rate_limit: Redis client unavailable at startup (fail-open).")
            return
        await client.ping()
        logger.info("rate_limit: Redis reachable — cross-replica rate limiting ENABLED.")
    except Exception as exc:
        logger.warning("rate_limit: Redis ping failed at startup (fail-open): %s", exc)


async def check_fixed_window(key: str, max_requests: int, window_seconds: int) -> Optional[int]:
    """Fixed-window limiter primitive. Returns None when the request is ALLOWED;
    returns retry_after (int seconds, >= 1) when the request is LIMITED.

    INCR the key; on the first hit (==1) set EXPIRE; if the post-incr count exceeds
    max_requests, the request is limited and retry_after is the key's remaining TTL
    (floored to >= 1). FAIL-OPEN: any exception, or no client, returns None.
    """
    client = await _get_client()
    if client is None:
        return None
    try:
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)
        if count > max_requests:
            ttl = await client.ttl(key)
            # ttl is -1 (no expire) or -2 (missing) in edge races → fall back to window.
            retry_after = ttl if isinstance(ttl, int) and ttl > 0 else window_seconds
            return max(1, int(retry_after))
        return None
    except Exception as exc:  # any Redis/network error → fail-open (allow)
        logger.warning("rate_limit: check_fixed_window failed open for key %s: %s", key, exc)
        return None


async def aclose() -> None:
    """Close the client for clean shutdown. Fail-open / idempotent."""
    global _client, _client_init_attempted
    client = _client
    _client = None
    _client_init_attempted = False
    if client is not None:
        try:
            await client.aclose()
        except Exception as exc:  # pragma: no cover - shutdown best-effort
            logger.warning("rate_limit: error closing Redis client: %s", exc)
