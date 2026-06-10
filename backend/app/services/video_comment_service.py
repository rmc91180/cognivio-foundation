"""Foundation seam for the video-comments cluster (A.9-3 relocation).

Pure relocation of the timeline comment models, helpers, and handlers from
server.py — stable signatures so the live repo can later swap implementations
behind them without touching call sites.
"""

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel

from app.tenancy import resolve_video_workspace_id

import server as legacy


class VideoComment(BaseModel):
    id: str
    video_id: str
    workspace_id: Optional[str] = None
    organization_id: Optional[str] = None
    teacher_id: Optional[str] = None
    observation_session_id: Optional[str] = None
    author_id: str
    author_name: str
    author_role: str
    timestamp_seconds: float
    focus_area_id: Optional[str] = None
    focus_area_label: Optional[str] = None
    visibility: str = "shared_with_teacher"
    rubric_element_id: Optional[str] = None
    rubric_element_code: Optional[str] = None
    rubric_element_name: Optional[str] = None
    body: str
    is_private: bool = False
    thread_parent_id: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None
    edited_at: Optional[str] = None
    deleted_at: Optional[str] = None


class VideoCommentListResponse(BaseModel):
    comments: List[VideoComment] = []


class VideoCommentCreate(BaseModel):
    timestamp_seconds: float
    focus_area_id: Optional[str] = None
    focus_area_label: Optional[str] = None
    visibility: Optional[str] = None
    rubric_element_id: Optional[str] = None
    rubric_element_code: Optional[str] = None
    rubric_element_name: Optional[str] = None
    body: str
    is_private: bool = False
    thread_parent_id: Optional[str] = None


class VideoCommentUpdate(BaseModel):
    focus_area_id: Optional[str] = None
    focus_area_label: Optional[str] = None
    visibility: Optional[str] = None
    rubric_element_id: Optional[str] = None
    rubric_element_code: Optional[str] = None
    rubric_element_name: Optional[str] = None
    body: Optional[str] = None
    is_private: Optional[bool] = None


def sanitize_video_comment_doc(doc: dict) -> dict:
    cleaned = {k: v for k, v in (doc or {}).items() if k != "_id"}
    cleaned["timestamp_seconds"] = float(cleaned.get("timestamp_seconds") or 0)
    cleaned["visibility"] = normalize_video_comment_visibility(
        cleaned.get("visibility"),
        bool(cleaned.get("is_private", False)),
        cleaned.get("author_role"),
    )
    cleaned["is_private"] = cleaned["visibility"] == "observer_private"
    cleaned.setdefault("updated_at", None)
    cleaned.setdefault("edited_at", None)
    cleaned.setdefault("deleted_at", None)
    cleaned.setdefault("thread_parent_id", None)
    cleaned.setdefault("focus_area_id", cleaned.get("rubric_element_id"))
    cleaned.setdefault(
        "focus_area_label",
        cleaned.get("focus_area_label")
        or cleaned.get("rubric_element_name")
        or cleaned.get("rubric_element_code"),
    )
    return cleaned


def normalize_video_comment_visibility(
    visibility: Optional[Any],
    is_private: bool = False,
    author_role: Optional[str] = None,
) -> str:
    normalized = str(visibility or "").strip().lower()
    if normalized in {"observer_private", "shared_with_teacher", "admin_only"}:
        return normalized
    if normalized in {"private", "observer"} or is_private:
        return "observer_private"
    if normalized in {"admin", "admins"}:
        return "admin_only"
    return "shared_with_teacher"


def video_comment_is_admin_role(current_user: dict) -> bool:
    tenant_role = legacy._get_user_tenant_role(current_user)
    role = legacy._get_user_role(current_user)
    return tenant_role in {"school_admin", "training_admin", "super_admin"} or role == "admin"


def video_comment_can_manage(comment: dict, current_user: dict) -> bool:
    if comment.get("author_id") == current_user.get("id"):
        return True
    return video_comment_is_admin_role(current_user)


def parse_comment_created_at(value: Optional[str]) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(status_code=409, detail="Comment creation timestamp is invalid")


def comment_visibility_query(video_id: str, current_user: dict) -> Dict[str, Any]:
    base_query: Dict[str, Any] = {"video_id": video_id, "deleted_at": {"$exists": False}}
    tenant_role = legacy._get_user_tenant_role(current_user)
    if tenant_role == "super_admin":
        return base_query
    if tenant_role == "teacher":
        return {
            **base_query,
            "$or": [
                {"visibility": "shared_with_teacher"},
                {"visibility": {"$exists": False}, "is_private": {"$ne": True}},
            ],
        }
    if video_comment_is_admin_role(current_user):
        return {
            **base_query,
            "$or": [
                {"visibility": {"$in": ["shared_with_teacher", "admin_only"]}},
                {"visibility": {"$exists": False}, "is_private": {"$ne": True}},
                {"visibility": "observer_private", "author_id": current_user["id"]},
                {"is_private": True, "author_id": current_user["id"]},
            ],
        }
    return {**base_query, "visibility": "shared_with_teacher"}


async def get_video_comment_or_404(
    video_id: str,
    comment_id: str,
    current_user: dict,
    *,
    visible_only: bool = True,
) -> dict:
    query: Dict[str, Any] = {"video_id": video_id, "id": comment_id}
    if visible_only:
        query = {"$and": [query, comment_visibility_query(video_id, current_user)]}
    comment = await legacy.db.video_comments.find_one(query, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


async def resolve_video_comment_rubric_fields(
    video_id: str,
    element_id: Optional[str],
    element_code: Optional[str],
    element_name: Optional[str],
) -> Dict[str, Optional[str]]:
    cleaned_element_id = legacy._clean_optional_string(element_id)
    cleaned_code = legacy._clean_optional_string(element_code) or cleaned_element_id
    cleaned_name = legacy._clean_optional_string(element_name)
    if cleaned_element_id and not cleaned_name:
        assessment = await legacy.db.assessments.find_one(
            {"video_id": video_id},
            {"_id": 0, "element_scores": 1},
        )
        for score in assessment.get("element_scores", []) if assessment else []:
            if score.get("element_id") == cleaned_element_id:
                cleaned_name = legacy._clean_optional_string(score.get("element_name"))
                cleaned_code = cleaned_code or legacy._clean_optional_string(score.get("element_id"))
                break
    return {
        "rubric_element_id": cleaned_element_id,
        "rubric_element_code": cleaned_code,
        "rubric_element_name": cleaned_name,
    }


async def list_video_comments(
    video_id: str,
    current_user: dict,
):
    await legacy._get_visible_video_or_404(video_id, current_user)
    docs = await legacy.db.video_comments.find(
        comment_visibility_query(video_id, current_user),
        {"_id": 0},
    ).sort("timestamp_seconds", 1).to_list(1000)
    docs.sort(
        key=lambda item: (
            float(item.get("timestamp_seconds") or 0),
            str(item.get("created_at") or ""),
        )
    )
    return VideoCommentListResponse(
        comments=[VideoComment(**sanitize_video_comment_doc(doc)) for doc in docs]
    )


async def create_video_comment(
    video_id: str,
    payload: VideoCommentCreate,
    current_user: dict,
):
    video = await legacy._get_visible_video_or_404(video_id, current_user)
    teacher = await legacy.db.teachers.find_one({"id": video.get("teacher_id")}, {"_id": 0})
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment text is required")
    if len(body) > 4000:
        raise HTTPException(status_code=400, detail="Comment text is too long")
    timestamp_seconds = float(payload.timestamp_seconds or 0)
    if timestamp_seconds < 0:
        raise HTTPException(status_code=400, detail="Comment timestamp cannot be negative")
    visibility = normalize_video_comment_visibility(payload.visibility, payload.is_private)
    tenant_role = legacy._get_user_tenant_role(current_user)
    if tenant_role == "teacher" and visibility != "shared_with_teacher":
        raise HTTPException(status_code=403, detail="Teachers can only add shared lesson comments")
    if visibility == "admin_only" and not video_comment_is_admin_role(current_user):
        raise HTTPException(status_code=403, detail="Admin access required for admin-only comments")
    thread_parent_id = legacy._clean_optional_string(payload.thread_parent_id)
    if thread_parent_id:
        parent = await get_video_comment_or_404(video_id, thread_parent_id, current_user)
        if parent.get("thread_parent_id"):
            raise HTTPException(status_code=400, detail="Replies can only be one level deep")
        timestamp_seconds = float(parent.get("timestamp_seconds") or timestamp_seconds)
    rubric_fields = await resolve_video_comment_rubric_fields(
        video_id,
        payload.rubric_element_id,
        payload.rubric_element_code,
        payload.rubric_element_name,
    )
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "video_id": video_id,
        "workspace_id": resolve_video_workspace_id(video, teacher, current_user),
        "organization_id": video.get("organization_id") or (teacher or {}).get("organization_id"),
        "teacher_id": video.get("teacher_id"),
        "observation_session_id": video.get("observation_session_id") or video.get("session_id"),
        "author_id": current_user["id"],
        "author_name": (
            legacy._clean_optional_string(current_user.get("name"))
            or legacy._clean_optional_string(current_user.get("email"))
            or "Cognivio user"
        ),
        "author_role": legacy._get_user_tenant_role(current_user),
        "timestamp_seconds": timestamp_seconds,
        "focus_area_id": legacy._clean_optional_string(payload.focus_area_id) or rubric_fields.get("rubric_element_id"),
        "focus_area_label": legacy._clean_optional_string(payload.focus_area_label) or rubric_fields.get("rubric_element_name") or rubric_fields.get("rubric_element_code"),
        "visibility": visibility,
        **rubric_fields,
        "body": body,
        "is_private": visibility == "observer_private",
        "thread_parent_id": thread_parent_id,
        "created_at": now,
        "updated_at": now,
    }
    await legacy.db.video_comments.insert_one(doc)
    return VideoComment(**sanitize_video_comment_doc(doc))


async def update_video_comment(
    video_id: str,
    comment_id: str,
    payload: VideoCommentUpdate,
    current_user: dict,
):
    await legacy._get_visible_video_or_404(video_id, current_user)
    comment = await get_video_comment_or_404(video_id, comment_id, current_user)
    if not video_comment_can_manage(comment, current_user):
        raise HTTPException(status_code=403, detail="Only the author or an admin can edit this comment")
    created_at = parse_comment_created_at(comment.get("created_at"))
    if comment.get("author_id") == current_user["id"] and datetime.now(timezone.utc) - created_at > timedelta(minutes=15):
        raise HTTPException(status_code=403, detail="Comments can only be edited within 15 minutes")
    updates = payload.dict(exclude_unset=True)
    update_fields: Dict[str, Any] = {}
    if "body" in updates:
        body = (payload.body or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="Comment text is required")
        if len(body) > 4000:
            raise HTTPException(status_code=400, detail="Comment text is too long")
        update_fields["body"] = body
    if "is_private" in updates and payload.is_private is not None:
        update_fields["visibility"] = normalize_video_comment_visibility(None, bool(payload.is_private))
        update_fields["is_private"] = update_fields["visibility"] == "observer_private"
    if "visibility" in updates and payload.visibility is not None:
        visibility = normalize_video_comment_visibility(payload.visibility)
        if legacy._get_user_tenant_role(current_user) == "teacher" and visibility != "shared_with_teacher":
            raise HTTPException(status_code=403, detail="Teachers can only add shared lesson comments")
        if visibility == "admin_only" and not video_comment_is_admin_role(current_user):
            raise HTTPException(status_code=403, detail="Admin access required for admin-only comments")
        update_fields["visibility"] = visibility
        update_fields["is_private"] = visibility == "observer_private"
    if "focus_area_id" in updates:
        update_fields["focus_area_id"] = legacy._clean_optional_string(payload.focus_area_id)
    if "focus_area_label" in updates:
        update_fields["focus_area_label"] = legacy._clean_optional_string(payload.focus_area_label)
    rubric_keys = {"rubric_element_id", "rubric_element_code", "rubric_element_name"}
    if rubric_keys.intersection(updates.keys()):
        rubric_fields = await resolve_video_comment_rubric_fields(
            video_id,
            payload.rubric_element_id,
            payload.rubric_element_code,
            payload.rubric_element_name,
        )
        update_fields.update(rubric_fields)
        update_fields.setdefault("focus_area_id", rubric_fields.get("rubric_element_id"))
        update_fields.setdefault("focus_area_label", rubric_fields.get("rubric_element_name") or rubric_fields.get("rubric_element_code"))
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_fields["edited_at"] = update_fields["updated_at"]
    updated = await legacy.db.video_comments.find_one_and_update(
        {"id": comment_id, "video_id": video_id},
        {"$set": update_fields},
        projection={"_id": 0},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    return VideoComment(**sanitize_video_comment_doc(updated))


async def delete_video_comment(
    video_id: str,
    comment_id: str,
    current_user: dict,
):
    await legacy._get_visible_video_or_404(video_id, current_user)
    comment = await get_video_comment_or_404(video_id, comment_id, current_user)
    if not video_comment_can_manage(comment, current_user):
        raise HTTPException(status_code=403, detail="Only the author or an admin can delete this comment")
    if comment.get("is_private") and comment.get("author_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only the author can delete a private comment")
    now = datetime.now(timezone.utc).isoformat()
    if comment.get("thread_parent_id"):
        result = await legacy.db.video_comments.update_one(
            {"id": comment_id, "video_id": video_id},
            {"$set": {"deleted_at": now, "updated_at": now}},
        )
        deleted_count = getattr(result, "modified_count", 0) or getattr(result, "matched_count", 0)
    else:
        result = await legacy.db.video_comments.update_many(
            {
                "video_id": video_id,
                "$or": [{"id": comment_id}, {"thread_parent_id": comment_id}],
            },
            {"$set": {"deleted_at": now, "updated_at": now}},
        )
        deleted_count = getattr(result, "modified_count", 0) or getattr(result, "matched_count", 0)
    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"message": "Comment deleted", "deleted_count": deleted_count}
