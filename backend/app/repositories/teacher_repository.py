from __future__ import annotations

from typing import Any, Dict, List, Optional

import server as legacy


async def find_school_for_user(school_id: str, user_id: str) -> Optional[dict]:
    return await legacy.db.schools.find_one({"id": school_id, "user_id": user_id})


async def insert_teacher(doc: dict) -> None:
    await legacy.db.teachers.insert_one(doc)


async def get_teacher_or_404(teacher_id: str, current_user: dict) -> dict:
    return await legacy._get_teacher_or_404(teacher_id, current_user)


async def update_teacher_fields(teacher_id: str, update_fields: Dict[str, Any]) -> None:
    await legacy.db.teachers.update_one({"id": teacher_id}, {"$set": update_fields})


async def list_teachers_for_user(user_id: str) -> List[dict]:
    return await legacy.db.teachers.find(
        {"created_by": user_id},
        {"_id": 0, "created_by": 0},
    ).to_list(1000)


async def delete_teacher_for_user(teacher_id: str, user_id: str):
    return await legacy.db.teachers.delete_one({"id": teacher_id, "created_by": user_id})


async def get_active_privacy_profile(teacher_id: str):
    return await legacy._get_active_privacy_profile(teacher_id)


async def mark_privacy_profile_replaced(profile_id: str, updated_at: str) -> None:
    await legacy.db.teacher_face_profiles.update_one(
        {"id": profile_id},
        {"$set": {"status": "replaced", "updated_at": updated_at}},
    )


async def list_privacy_profile_versions(teacher_id: str) -> List[dict]:
    return await legacy.db.teacher_face_profiles.find(
        {"teacher_id": teacher_id},
        {"_id": 0, "profile_version": 1},
    ).to_list(100)


async def insert_teacher_face_references(reference_docs: List[dict]) -> None:
    if reference_docs:
        await legacy.db.teacher_face_references.insert_many(reference_docs)


async def supersede_active_privacy_profiles(teacher_id: str, updated_at: str) -> None:
    await legacy.db.teacher_face_profiles.update_many(
        {"teacher_id": teacher_id, "status": "active"},
        {"$set": {"status": "superseded", "updated_at": updated_at}},
    )


async def insert_teacher_face_profile(profile_doc: dict) -> None:
    await legacy.db.teacher_face_profiles.insert_one(profile_doc)


async def delete_active_privacy_profiles(teacher_id: str, deleted_at: str):
    return await legacy.db.teacher_face_profiles.update_many(
        {"teacher_id": teacher_id, "status": "active"},
        {"$set": {"status": "deleted", "updated_at": deleted_at}},
    )


async def expire_teacher_face_references(teacher_id: str, deleted_at: str) -> None:
    await legacy.db.teacher_face_references.update_many(
        {"teacher_id": teacher_id},
        {"$set": {"retention_expires_at": deleted_at}},
    )
