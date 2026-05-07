from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import server as legacy


async def find_teacher_by_id(teacher_id: str) -> Optional[dict]:
    return await legacy.db.teachers.find_one({"id": teacher_id}, {"_id": 0})


async def insert_video(doc: dict) -> None:
    await legacy.db.videos.insert_one(doc)


async def insert_video_evidence(doc: dict) -> None:
    await legacy.db.video_evidence.insert_one(doc)


async def link_observation_session(session_id: str, video_id: str, status: str, updated_at: str) -> None:
    await legacy.db.observation_sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "linked_video_id": video_id,
                "status": status,
                "updated_at": updated_at,
            }
        },
    )


async def list_teacher_ids_for_user(current_user: dict) -> List[str]:
    return await legacy._list_teacher_ids_for_user(current_user)


def build_video_visibility_query(current_user: dict, teacher_ids_for_user: List[str]) -> Dict[str, Any]:
    return legacy._build_video_visibility_query(current_user, teacher_ids_for_user)


async def list_videos_by_query(query: Dict[str, Any]) -> List[dict]:
    return await legacy.db.videos.find(
        query, {"_id": 0, "uploaded_by": 0, "stored_filename": 0}
    ).to_list(1000)


async def list_videos_paginated(
    query: Dict[str, Any],
    *,
    skip: int = 0,
    limit: int = 100,
    projection: Optional[Dict[str, int]] = None,
) -> Tuple[List[dict], int]:
    limit = max(1, min(int(limit or 100), 500))
    skip = max(0, int(skip or 0))
    projection = projection or {"_id": 0}
    total = await legacy.db.videos.count_documents(query)
    docs = await legacy.db.videos.find(query, projection).sort("upload_date", -1).skip(skip).limit(limit).to_list(limit)
    return docs, total


async def find_video_by_id(video_id: str) -> Optional[dict]:
    return await legacy.db.videos.find_one({"id": video_id}, {"_id": 0})


async def find_video_in_workspace(video_id: str, workspace_id: Optional[str]) -> Optional[dict]:
    query: Dict[str, Any] = {"id": video_id}
    if workspace_id:
        query["$or"] = [
            {"workspace_id": workspace_id},
            {"uploaded_by": workspace_id},
            {"teacher_id": workspace_id},
            {"organization_id": workspace_id},
            {"school_id": workspace_id},
        ]
    return await legacy.db.videos.find_one(query, {"_id": 0})


async def update_video_fields(video_id: str, update_fields: Dict[str, Any]) -> None:
    await legacy.db.videos.update_one({"id": video_id}, {"$set": update_fields})


async def update_video_evidence_fields(video_id: str, update_fields: Dict[str, Any]) -> None:
    await legacy.db.video_evidence.update_one({"video_id": video_id}, {"$set": update_fields})


async def find_video_evidence(video_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    query: Dict[str, Any] = {"video_id": video_id}
    if user_id:
        query["uploaded_by"] = user_id
    return await legacy.db.video_evidence.find_one(query, {"_id": 0})


async def find_assessment_element_scores(video_id: str) -> List[dict]:
    assessment = await legacy.db.assessments.find_one(
        {"video_id": video_id},
        {"_id": 0, "element_scores": 1},
    )
    return list((assessment or {}).get("element_scores") or [])


async def find_teacher_name(teacher_id: Optional[str]) -> Optional[str]:
    if not teacher_id:
        return None
    teacher = await legacy.db.teachers.find_one({"id": teacher_id}, {"_id": 0, "name": 1})
    return (teacher or {}).get("name")


async def find_observation_session(session_id: str) -> Optional[dict]:
    return await legacy.db.observation_sessions.find_one({"id": session_id}, {"_id": 0})


async def list_privacy_review_videos(user_id: str, limit: int = 200) -> List[dict]:
    return await legacy.db.videos.find(
        {
            "uploaded_by": user_id,
            "privacy_status": legacy.PrivacyProcessingStatus.REVIEW_REQUIRED.value,
        },
        {"_id": 0},
    ).sort("upload_date", -1).to_list(limit)


async def list_privacy_audit_events(query: Dict[str, Any], limit: int) -> List[dict]:
    return await legacy.db.privacy_audit_events.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)


async def find_latest_sampling_manifest(video_id: str) -> Optional[dict]:
    return await legacy.db.video_sampling_manifests.find_one(
        {"video_id": video_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def find_latest_analysis_moments(video_id: str) -> Optional[dict]:
    return await legacy.db.video_analysis_moments.find_one(
        {"video_id": video_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def find_latest_audio_transcript(video_id: str) -> Optional[dict]:
    return await legacy.db.video_audio_transcripts.find_one(
        {"video_id": video_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


async def find_audio_features(video_id: str) -> Optional[dict]:
    return await legacy.db.video_analysis_features.find_one({"video_id": video_id}, {"_id": 0})


async def list_video_comments(query: Dict[str, Any], limit: int = 1000) -> List[dict]:
    return await legacy.db.video_comments.find(query, {"_id": 0}).sort("timestamp_seconds", 1).to_list(limit)


async def insert_video_comment(doc: dict) -> None:
    await legacy.db.video_comments.insert_one(doc)


async def find_video_comment(video_id: str, comment_id: str) -> Optional[dict]:
    return await legacy.db.video_comments.find_one({"id": comment_id, "video_id": video_id}, {"_id": 0})


async def update_video_comment(video_id: str, comment_id: str, update_fields: Dict[str, Any]) -> Optional[dict]:
    return await legacy.db.video_comments.find_one_and_update(
        {"id": comment_id, "video_id": video_id},
        {"$set": update_fields},
        projection={"_id": 0},
        return_document=True,
    )


async def delete_video_comment(video_id: str, comment_id: str, include_replies: bool) -> int:
    if include_replies:
        result = await legacy.db.video_comments.delete_many(
            {
                "video_id": video_id,
                "$or": [{"id": comment_id}, {"thread_parent_id": comment_id}],
            }
        )
    else:
        result = await legacy.db.video_comments.delete_one({"id": comment_id, "video_id": video_id})
    return int(result.deleted_count or 0)
