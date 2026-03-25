from __future__ import annotations

from typing import List, Optional

import server as legacy


async def get_user(user_id: str) -> Optional[dict]:
    return await legacy.db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})


async def update_user_fields(user_id: str, update_fields: dict) -> None:
    await legacy.db.users.update_one({"id": user_id}, {"$set": update_fields})


async def get_workspace_mode_preference(owner_id: str) -> Optional[dict]:
    return await legacy.db.workspace_mode_preferences.find_one(
        {"owner_id": owner_id},
        {"_id": 0},
    )


async def upsert_workspace_mode_preference(owner_id: str, doc: dict) -> None:
    await legacy.db.workspace_mode_preferences.update_one(
        {"owner_id": owner_id},
        {"$set": doc},
        upsert=True,
    )


async def upsert_memory_entry(owner_id: str, scope_type: str, scope_id: str, memory_type: str, doc: dict) -> None:
    await legacy.db.organization_memory.update_one(
        {
            "owner_id": owner_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "memory_type": memory_type,
        },
        {"$set": doc},
        upsert=True,
    )


async def list_memory_entries(
    owner_id: str,
    *,
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
    memory_type: Optional[str] = None,
) -> List[dict]:
    query = {"owner_id": owner_id}
    if scope_type is not None:
        query["scope_type"] = scope_type
    if scope_id is not None:
        query["scope_id"] = scope_id
    if memory_type is not None:
        query["memory_type"] = memory_type
    return await legacy.db.organization_memory.find(query, {"_id": 0}).sort("updated_at", -1).to_list(200)
