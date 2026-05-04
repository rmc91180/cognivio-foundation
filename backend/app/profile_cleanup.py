"""Profile lifecycle cleanup helpers.

This module contains backend service helpers for archive, restore, cleanup-candidate
reporting, and super-admin hard deletion. It is intentionally side-effect explicit:
route handlers should pass the authenticated actor and confirmation payloads, then
record returned summaries in audit logs.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable, List, Optional


TEACHER_LINKED_COLLECTIONS = {
    "videos": ["teacher_id"],
    "assessments": ["teacher_id"],
    "observations": ["teacher_id"],
    "action_plans": ["teacher_id"],
    "teacher_face_profiles": ["teacher_id"],
    "privacy_reviews": ["teacher_id"],
    "schedules": ["teacher_id"],
    "coaching_tasks": ["teacher_id"],
    "recognition_records": ["teacher_id"],
}

USER_LINKED_COLLECTIONS = {
    "videos": ["uploaded_by", "user_id"],
    "assessments": ["user_id"],
    "observations": ["created_by", "user_id"],
    "action_plans": ["created_by", "user_id"],
    "audit_events": ["actor_user_id", "target_user_id"],
    "auth_events": ["user_id"],
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _candidate_label(doc: Dict[str, Any]) -> str:
    return doc.get("name") or doc.get("email") or doc.get("id") or "Unknown record"


def _clean_confirmation(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _confirmation_matches(*, confirmation_text: str, target: Dict[str, Any]) -> bool:
    confirmation = _clean_confirmation(confirmation_text)
    if not confirmation:
        return False
    candidates = {
        _clean_confirmation(target.get("id")),
        _clean_confirmation(target.get("email")),
        _clean_confirmation(target.get("name")),
    }
    return confirmation in {item for item in candidates if item}


async def count_teacher_dependencies(db: Any, teacher_id: str) -> Dict[str, int]:
    """Return counts for data linked to a teacher profile."""
    counts: Dict[str, int] = {}
    for collection_name, fields in TEACHER_LINKED_COLLECTIONS.items():
        collection = getattr(db, collection_name, None)
        if collection is None:
            counts[collection_name] = 0
            continue
        query = {"$or": [{field: teacher_id} for field in fields]}
        counts[collection_name] = await collection.count_documents(query)
    users_collection = getattr(db, "users", None)
    if users_collection is not None:
        counts["linked_users"] = await users_collection.count_documents({"teacher_id": teacher_id})
    else:
        counts["linked_users"] = 0
    return counts


async def count_user_dependencies(db: Any, user_id: str) -> Dict[str, int]:
    """Return counts for data linked to a user account."""
    counts: Dict[str, int] = {}
    for collection_name, fields in USER_LINKED_COLLECTIONS.items():
        collection = getattr(db, collection_name, None)
        if collection is None:
            counts[collection_name] = 0
            continue
        query = {"$or": [{field: user_id} for field in fields]}
        counts[collection_name] = await collection.count_documents(query)
    return counts


async def archive_teacher_profile(
    db: Any,
    *,
    teacher_id: str,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise ValueError("Teacher profile not found")
    update = {
        "status": "archived",
        "archived_at": utc_now_iso(),
        "archived_by": actor_user_id,
        "archive_reason": reason,
        "updated_at": utc_now_iso(),
    }
    await db.teachers.update_one({"id": teacher_id}, {"$set": update})
    return {"status": "archived", "teacher_id": teacher_id, "archive": update}


async def restore_teacher_profile(
    db: Any,
    *,
    teacher_id: str,
    actor_user_id: str,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise ValueError("Teacher profile not found")
    update = {
        "status": "active",
        "restored_at": utc_now_iso(),
        "restored_by": actor_user_id,
        "restore_reason": reason,
        "updated_at": utc_now_iso(),
    }
    await db.teachers.update_one({"id": teacher_id}, {"$set": update})
    return {"status": "active", "teacher_id": teacher_id, "restore": update}


async def delete_unused_teacher_profile(
    db: Any,
    *,
    teacher_id: str,
    confirmation_text: str,
    reason: str,
) -> Dict[str, Any]:
    """Delete a teacher profile only if it has no linked data.

    This is the school/training admin safe-delete path. Super-admin hard delete uses
    `hard_delete_teacher_profile` and intentionally allows data-bearing profiles.
    """
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise ValueError("Teacher profile not found")
    if not _confirmation_matches(confirmation_text=confirmation_text, target=teacher):
        raise PermissionError("Confirmation text does not match the teacher profile")
    if not str(reason or "").strip():
        raise ValueError("Reason is required")
    dependency_counts = await count_teacher_dependencies(db, teacher_id)
    if any(value > 0 for value in dependency_counts.values()):
        return {
            "status": "blocked",
            "teacher_id": teacher_id,
            "detail": "This profile contains data and can only be archived or deleted by a super admin.",
            "dependency_counts": dependency_counts,
        }
    result = await db.teachers.delete_one({"id": teacher_id})
    return {
        "status": "deleted",
        "teacher_id": teacher_id,
        "deleted_counts": {"teachers": result.deleted_count},
    }


async def hard_delete_teacher_profile(
    db: Any,
    *,
    teacher_id: str,
    confirmation_text: str,
    reason: str,
    delete_linked_user: bool = True,
) -> Dict[str, Any]:
    """Super-admin hard delete for teacher profiles.

    Product policy: super admins may delete teacher profiles even when they contain
    data. This function cascades through known linked collections and returns
    deleted counts for audit logging.
    """
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise ValueError("Teacher profile not found")
    if not _confirmation_matches(confirmation_text=confirmation_text, target=teacher):
        raise PermissionError("Confirmation text does not match the teacher profile")
    if not str(reason or "").strip():
        raise ValueError("Reason is required")

    before_counts = await count_teacher_dependencies(db, teacher_id)
    deleted_counts: Dict[str, int] = {}

    for collection_name, fields in TEACHER_LINKED_COLLECTIONS.items():
        collection = getattr(db, collection_name, None)
        if collection is None:
            deleted_counts[collection_name] = 0
            continue
        query = {"$or": [{field: teacher_id} for field in fields]}
        result = await collection.delete_many(query)
        deleted_counts[collection_name] = result.deleted_count

    if delete_linked_user:
        linked_user_result = await db.users.delete_many({"teacher_id": teacher_id})
        deleted_counts["users"] = linked_user_result.deleted_count
    else:
        unlink_result = await db.users.update_many(
            {"teacher_id": teacher_id},
            {"$unset": {"teacher_id": ""}, "$set": {"updated_at": utc_now_iso()}},
        )
        deleted_counts["users_unlinked"] = unlink_result.modified_count

    teacher_result = await db.teachers.delete_one({"id": teacher_id})
    deleted_counts["teachers"] = teacher_result.deleted_count

    return {
        "status": "deleted",
        "teacher_id": teacher_id,
        "reason": reason,
        "before_counts": before_counts,
        "deleted_counts": deleted_counts,
    }


async def hard_delete_user_account(
    db: Any,
    *,
    user_id: str,
    confirmation_text: str,
    reason: str,
    delete_linked_teacher: bool = False,
) -> Dict[str, Any]:
    """Super-admin hard delete for user accounts."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise ValueError("User not found")
    if not _confirmation_matches(confirmation_text=confirmation_text, target=user):
        raise PermissionError("Confirmation text does not match the user account")
    if not str(reason or "").strip():
        raise ValueError("Reason is required")

    before_counts = await count_user_dependencies(db, user_id)
    deleted_counts: Dict[str, int] = {}

    linked_teacher_summary = None
    linked_teacher_id = user.get("teacher_id")
    if delete_linked_teacher and linked_teacher_id:
        linked_teacher_summary = await hard_delete_teacher_profile(
            db,
            teacher_id=linked_teacher_id,
            confirmation_text=linked_teacher_id,
            reason=reason,
            delete_linked_user=False,
        )

    result = await db.users.delete_one({"id": user_id})
    deleted_counts["users"] = result.deleted_count

    return {
        "status": "deleted",
        "user_id": user_id,
        "reason": reason,
        "before_counts": before_counts,
        "deleted_counts": deleted_counts,
        "linked_teacher_summary": linked_teacher_summary,
    }


async def build_cleanup_candidates(
    db: Any,
    *,
    pending_days: int = 90,
    revoked_days: int = 180,
    include_archived: bool = True,
    limit: int = 250,
) -> Dict[str, List[Dict[str, Any]]]:
    """Build profile cleanup candidate groups for the master-admin dashboard."""
    now = datetime.now(timezone.utc)
    pending_threshold = (now - timedelta(days=pending_days)).isoformat()
    revoked_threshold = (now - timedelta(days=revoked_days)).isoformat()

    teachers = await db.teachers.find({}, {"_id": 0}).to_list(limit)
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(limit)

    unused_teachers: List[Dict[str, Any]] = []
    duplicate_teachers: List[Dict[str, Any]] = []
    seen_teacher_keys: Dict[str, List[Dict[str, Any]]] = {}

    for teacher in teachers:
        teacher_id = teacher.get("id")
        if not teacher_id:
            continue
        status = teacher.get("status") or "active"
        if status == "archived" and not include_archived:
            continue
        counts = await count_teacher_dependencies(db, teacher_id)
        if sum(counts.values()) == 0:
            unused_teachers.append(
                {
                    "id": teacher_id,
                    "teacher_id": teacher_id,
                    "label": _candidate_label(teacher),
                    "email": teacher.get("email"),
                    "status": status,
                    "dependency_counts": counts,
                    "organization_name": teacher.get("organization_name"),
                    "school_name": teacher.get("school_name"),
                }
            )
        key = (teacher.get("email") or teacher.get("name") or "").strip().lower()
        if key:
            seen_teacher_keys.setdefault(key, []).append(teacher)

    for docs in seen_teacher_keys.values():
        if len(docs) <= 1:
            continue
        for teacher in docs:
            duplicate_teachers.append(
                {
                    "id": teacher.get("id"),
                    "teacher_id": teacher.get("id"),
                    "label": _candidate_label(teacher),
                    "email": teacher.get("email"),
                    "status": teacher.get("status") or "active",
                    "meta": "Possible duplicate by shared email/name",
                }
            )

    abandoned_pending_users = [
        {
            "id": user.get("id"),
            "user_id": user.get("id"),
            "label": _candidate_label(user),
            "email": user.get("email"),
            "approval_status": user.get("approval_status"),
            "meta": user.get("approval_requested_at") or user.get("created_at"),
        }
        for user in users
        if user.get("approval_status") == "pending"
        and (user.get("approval_requested_at") or user.get("created_at") or "") < pending_threshold
    ]

    revoked_users = [
        {
            "id": user.get("id"),
            "user_id": user.get("id"),
            "label": _candidate_label(user),
            "email": user.get("email"),
            "approval_status": user.get("approval_status"),
            "meta": user.get("revoked_at") or user.get("updated_at"),
        }
        for user in users
        if user.get("approval_status") == "revoked"
        and (user.get("revoked_at") or user.get("updated_at") or "") < revoked_threshold
    ]

    teacher_ids = {teacher.get("id") for teacher in teachers if teacher.get("id")}
    orphaned_privacy_profiles: List[Dict[str, Any]] = []
    privacy_profiles = await db.teacher_face_profiles.find({}, {"_id": 0}).to_list(limit) if getattr(db, "teacher_face_profiles", None) is not None else []
    for profile in privacy_profiles:
        if profile.get("teacher_id") not in teacher_ids:
            orphaned_privacy_profiles.append(
                {
                    "id": profile.get("id") or profile.get("teacher_id"),
                    "teacher_id": profile.get("teacher_id"),
                    "label": profile.get("teacher_name") or profile.get("teacher_id") or "Orphaned privacy profile",
                    "status": profile.get("status"),
                }
            )

    orphaned_videos: List[Dict[str, Any]] = []
    videos = await db.videos.find({}, {"_id": 0}).to_list(limit) if getattr(db, "videos", None) is not None else []
    for video in videos:
        if video.get("teacher_id") and video.get("teacher_id") not in teacher_ids:
            orphaned_videos.append(
                {
                    "id": video.get("id"),
                    "teacher_id": video.get("teacher_id"),
                    "label": video.get("filename") or video.get("id") or "Orphaned video",
                    "status": video.get("status"),
                }
            )

    return {
        "unused_teachers": unused_teachers,
        "duplicate_teachers": duplicate_teachers,
        "abandoned_pending_users": abandoned_pending_users,
        "revoked_users": revoked_users,
        "orphaned_privacy_profiles": orphaned_privacy_profiles,
        "orphaned_videos": orphaned_videos,
    }


async def run_cleanup_action(
    db: Any,
    *,
    action: str,
    candidate_ids: Iterable[str],
    reason: str,
    confirmation_text: str,
) -> Dict[str, Any]:
    """Run a supported bulk cleanup action."""
    ids = [item for item in candidate_ids if item]
    if not ids:
        raise ValueError("At least one candidate id is required")
    if not str(reason or "").strip():
        raise ValueError("Reason is required")

    results: List[Dict[str, Any]] = []
    if action == "archive_unused_teachers":
        for teacher_id in ids:
            results.append(
                await archive_teacher_profile(
                    db,
                    teacher_id=teacher_id,
                    actor_user_id="cleanup_action",
                    reason=reason,
                )
            )
    elif action == "delete_unused_teachers":
        for teacher_id in ids:
            results.append(
                await delete_unused_teacher_profile(
                    db,
                    teacher_id=teacher_id,
                    confirmation_text=confirmation_text,
                    reason=reason,
                )
            )
    elif action == "purge_pending_users":
        delete_result = await db.users.delete_many({"id": {"$in": ids}, "approval_status": "pending"})
        results.append({"status": "deleted", "deleted_counts": {"users": delete_result.deleted_count}})
    elif action == "purge_revoked_users_without_data":
        for user_id in ids:
            counts = await count_user_dependencies(db, user_id)
            if any(value > 0 for value in counts.values()):
                results.append({"status": "blocked", "user_id": user_id, "dependency_counts": counts})
            else:
                delete_result = await db.users.delete_one({"id": user_id, "approval_status": "revoked"})
                results.append({"status": "deleted", "user_id": user_id, "deleted_counts": {"users": delete_result.deleted_count}})
    else:
        raise ValueError(f"Unsupported cleanup action: {action}")

    return {"status": "completed", "action": action, "results": results}
