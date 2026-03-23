from __future__ import annotations

from typing import List, Optional

import server as legacy


async def list_recognition_badges_for_teacher(teacher_id: str) -> List[dict]:
    return await legacy.db.recognition_badges.find(
        {"teacher_id": teacher_id},
        {"_id": 0},
    ).sort("awarded_at", -1).to_list(200)


async def get_or_sync_video_recognition_event(video: dict) -> dict:
    return await legacy._get_or_sync_video_recognition_event(video)


async def update_lesson_recognition_event(event_id: str, update_fields: dict) -> None:
    await legacy.db.lesson_recognition_events.update_one(
        {"id": event_id},
        {"$set": update_fields},
    )


async def list_recognition_events_pending_review() -> List[dict]:
    return await legacy.db.lesson_recognition_events.find(
        {"recognition_status": "pending_admin_review"},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(200)


async def find_recognition_badge(video_id: str, badge_type: Optional[str] = None) -> Optional[dict]:
    query = {"video_id": video_id}
    if badge_type is not None:
        query["badge_type"] = badge_type
    return await legacy.db.recognition_badges.find_one(query, {"_id": 0})


async def update_recognition_badge(badge_id: str, doc: dict) -> None:
    await legacy.db.recognition_badges.update_one({"id": badge_id}, {"$set": doc})


async def insert_recognition_badge(doc: dict) -> None:
    await legacy.db.recognition_badges.insert_one(doc)


async def get_latest_exemplar_submission(video_id: str) -> Optional[dict]:
    return await legacy._get_latest_exemplar_submission(video_id)
