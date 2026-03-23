from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings, get_settings


def create_mongo_client(settings: Settings | None = None) -> AsyncIOMotorClient:
    resolved = settings or get_settings()
    return AsyncIOMotorClient(resolved.mongo_url)


def get_database_name(settings: Settings | None = None) -> str:
    resolved = settings or get_settings()
    return resolved.db_name
