from __future__ import annotations

import fnmatch
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any, Awaitable, Callable, Optional


class CacheClient:
    def __init__(self, db):
        self.db = db
        self.collection = getattr(db, "cache", None) if db is not None else None
        self.hits = 0
        self.misses = 0
        self.sets = 0

    async def ensure_indexes(self) -> None:
        if self.collection is None:
            return

        try:
            await self.collection.create_index("expires_at", expireAfterSeconds=0)
        except Exception:
            return

    async def get(self, key: str) -> Any | None:
        if self.collection is None:
            self.misses += 1
            return None

        now = datetime.now(timezone.utc)

        try:
            doc = await self.collection.find_one({"_id": key, "expires_at": {"$gt": now}}, {"_id": 0})
        except Exception:
            self.misses += 1
            return None

        if not doc:
            self.misses += 1
            return None

        self.hits += 1
        return doc.get("value")

    async def set(self, key: str, value: Any, ttl_seconds: int) -> None:
        if self.collection is None:
            return

        expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(1, int(ttl_seconds)))

        try:
            await self.collection.update_one(
                {"_id": key},
                {
                    "$set": {
                        "value": value,
                        "expires_at": expires_at,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
            self.sets += 1
        except Exception:
            return

    async def delete(self, key: str) -> None:
        if self.collection is None:
            return

        try:
            await self.collection.delete_one({"_id": key})
        except Exception:
            return

    async def invalidate_pattern(self, pattern: str) -> int:
        """
        Best-effort cache invalidation.

        Cache invalidation must never block core application workflows. In local
        tests and dev environments, the global cache client may still point at a
        real Motor collection even when the test has monkeypatched server.db to an
        in-memory fake. If Mongo is unavailable, return 0 instead of failing the
        request or hanging the test.
        """
        if self.collection is None:
            return 0

        try:
            if pattern.endswith("*"):
                regex = f"^{pattern[:-1].replace(':', ':')}"
                result = await self.collection.delete_many({"_id": {"$regex": regex}})
                return int(getattr(result, "deleted_count", 0) or 0)

            cursor = self.collection.find({}, {"_id": 1})
            keys = await cursor.to_list(10000)
            matched = [doc["_id"] for doc in keys if fnmatch.fnmatch(doc.get("_id", ""), pattern)]

            if not matched:
                return 0

            result = await self.collection.delete_many({"_id": {"$in": matched}})
            return int(getattr(result, "deleted_count", 0) or 0)

        except Exception:
            return 0

    async def stats(self) -> dict:
        if self.collection is None:
            total = self.hits + self.misses
            return {
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": (self.hits / total) if total else 0,
                "miss_rate": (self.misses / total) if total else 0,
                "sets": self.sets,
                "current_entries": 0,
                "estimated_total_size_bytes": 0,
            }

        total = self.hits + self.misses

        try:
            current_entries = await self.collection.count_documents({})
            sample = await self.collection.find({}, {"value": 1}).to_list(1000)
            total_size = sum(len(str(doc.get("value", ""))) for doc in sample)
        except Exception:
            current_entries = 0
            total_size = 0

        return {
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": (self.hits / total) if total else 0,
            "miss_rate": (self.misses / total) if total else 0,
            "sets": self.sets,
            "current_entries": current_entries,
            "estimated_total_size_bytes": total_size,
        }


def cached(
    ttl: int,
    key: Callable[..., str],
    client_getter: Optional[Callable[[], CacheClient]] = None,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            client = client_getter() if client_getter else kwargs.pop("cache_client", None)
            if client is None:
                return await func(*args, **kwargs)

            cache_key = key(*args, **kwargs)
            cached_value = await client.get(cache_key)
            if cached_value is not None:
                return cached_value

            started = time.perf_counter()
            value = await func(*args, **kwargs)

            if isinstance(value, dict):
                value = {
                    **value,
                    "cache_meta": {
                        "hit": False,
                        "generated_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                }

            await client.set(cache_key, value, ttl)
            return value

        return wrapper

    return decorator