from __future__ import annotations

from functools import lru_cache
from typing import Any

import boto3
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import Settings
from app.middleware.auth_middleware import get_current_user, security


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()


@lru_cache(maxsize=1)
def get_mongo_client() -> AsyncIOMotorClient:
    settings = get_settings()
    return AsyncIOMotorClient(settings.database.mongo_url)


def get_db() -> AsyncIOMotorDatabase:
    settings = get_settings()
    return get_mongo_client()[settings.database.db_name]


@lru_cache(maxsize=1)
def get_s3_client() -> Any:
    settings = get_settings()
    kwargs: dict[str, Any] = {}
    if settings.storage.s3_region:
        kwargs["region_name"] = settings.storage.s3_region
    if settings.storage.s3_endpoint:
        kwargs["endpoint_url"] = settings.storage.s3_endpoint
    if settings.storage.aws_access_key_id and settings.storage.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.storage.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.storage.aws_secret_access_key
    return boto3.client("s3", **kwargs)


def clear_dependency_caches() -> None:
    get_settings.cache_clear()
    get_mongo_client.cache_clear()
    get_s3_client.cache_clear()


__all__ = [
    "clear_dependency_caches",
    "get_current_user",
    "get_db",
    "get_mongo_client",
    "get_s3_client",
    "get_settings",
    "security",
]
