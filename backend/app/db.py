from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings


def create_mongo_client(settings: Settings | None = None) -> AsyncIOMotorClient:
    resolved = settings or Settings.from_env()
    return AsyncIOMotorClient(resolved.mongo_url)


def get_database_name(settings: Settings | None = None) -> str:
    resolved = settings or Settings.from_env()
    return resolved.db_name
