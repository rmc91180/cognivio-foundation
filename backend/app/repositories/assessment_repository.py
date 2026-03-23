from __future__ import annotations

from typing import List, Optional

import server as legacy


async def list_assessments_for_user(user_id: str, teacher_id: Optional[str] = None) -> List[dict]:
    query = {"user_id": user_id}
    if teacher_id:
        query["teacher_id"] = teacher_id
    return await legacy.db.assessments.find(
        query, {"_id": 0, "user_id": 0}
    ).to_list(1000)


async def find_assessment_for_user(assessment_id: str, user_id: str) -> Optional[dict]:
    return await legacy.db.assessments.find_one(
        {"id": assessment_id, "user_id": user_id},
        {"_id": 0, "user_id": 0},
    )


async def insert_admin_override(doc: dict) -> None:
    await legacy.db.admin_assessment_overrides.insert_one(doc)


async def list_admin_overrides_for_assessment(assessment_id: str, admin_id: str) -> List[dict]:
    return await legacy.db.admin_assessment_overrides.find(
        {"assessment_id": assessment_id, "admin_id": admin_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
