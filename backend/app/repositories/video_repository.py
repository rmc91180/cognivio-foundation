from __future__ import annotations

from typing import Any, Dict, List, Optional

import server as legacy


async def find_teacher_by_id(teacher_id: str) -> Optional[dict]:
    return await legacy.db.teachers.find_one({"id": teacher_id}, {"_id": 0})


async def insert_video(doc: dict) -> None:
    await legacy.db.videos.insert_one(doc)


async def insert_video_evidence(doc: dict) -> None:
    await legacy.db.video_evidence.insert_one(doc)


async def list_teacher_ids_for_user(current_user: dict) -> List[str]:
    return await legacy._list_teacher_ids_for_user(current_user)


def build_video_visibility_query(current_user: dict, teacher_ids_for_user: List[str]) -> Dict[str, Any]:
    return legacy._build_video_visibility_query(current_user, teacher_ids_for_user)


async def list_videos_by_query(query: Dict[str, Any]) -> List[dict]:
    return await legacy.db.videos.find(
        query, {"_id": 0, "uploaded_by": 0, "stored_filename": 0}
    ).to_list(1000)


async def find_video_by_id(video_id: str) -> Optional[dict]:
    return await legacy.db.videos.find_one({"id": video_id}, {"_id": 0})


async def update_video_fields(video_id: str, update_fields: Dict[str, Any]) -> None:
    await legacy.db.videos.update_one({"id": video_id}, {"$set": update_fields})


async def update_video_evidence_fields(video_id: str, update_fields: Dict[str, Any]) -> None:
    await legacy.db.video_evidence.update_one({"video_id": video_id}, {"$set": update_fields})
