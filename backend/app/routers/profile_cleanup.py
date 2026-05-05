from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import server as legacy

from app.dependencies import get_current_user
from app.profile_cleanup import (
    archive_teacher_profile,
    build_cleanup_candidates,
    count_teacher_dependencies,
    delete_unused_teacher_profile,
    hard_delete_teacher_profile,
    hard_delete_user_account,
    restore_teacher_profile,
    run_cleanup_action,
    utc_now_iso,
)


router = APIRouter(tags=["profile-cleanup"])


class LifecycleActionPayload(BaseModel):
    reason: Optional[str] = None
    confirmation_text: Optional[str] = None


class TeacherHardDeletePayload(BaseModel):
    confirmation_text: str
    reason: str
    delete_storage_assets: bool = True
    delete_linked_user: bool = True


class UserHardDeletePayload(BaseModel):
    confirmation_text: str
    reason: str
    delete_linked_teacher: bool = False


class CleanupActionPayload(BaseModel):
    action: str
    candidate_ids: List[str]
    reason: str
    confirmation_text: Optional[str] = None


def _get_db() -> Any:
    db = getattr(legacy, "db", None)
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not initialized")
    return db


def _tenant_role(user: Dict[str, Any]) -> str:
    resolver = getattr(legacy, "_get_user_tenant_role", None)
    if callable(resolver):
        return resolver(user)
    email = str((user or {}).get("email") or "").strip().lower()
    super_admins = set(getattr(legacy, "SUPER_ADMIN_EMAILS", set()) or set())
    if email and email in super_admins:
        return "super_admin"
    return str((user or {}).get("tenant_role") or (user or {}).get("role") or "teacher").strip().lower()


def _require_super_admin(current_user: Dict[str, Any]) -> None:
    if _tenant_role(current_user) != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")


def _require_admin_or_super_admin(current_user: Dict[str, Any]) -> None:
    if _tenant_role(current_user) not in {"school_admin", "training_admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Administrator access required")


async def _audit_event(
    *,
    actor: Dict[str, Any],
    action: str,
    target_type: str,
    target_id: str,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    db = _get_db()
    collection = getattr(db, "audit_events", None)
    if collection is None:
        return
    await collection.insert_one(
        {
            "id": getattr(legacy, "uuid", None).uuid4().hex if getattr(legacy, "uuid", None) else target_id,
            "event_type": action,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "actor_user_id": actor.get("id"),
            "actor_email": actor.get("email"),
            "details": details or {},
            "created_at": utc_now_iso(),
        }
    )


async def _load_teacher_or_404(teacher_id: str) -> Dict[str, Any]:
    db = _get_db()
    teacher = await db.teachers.find_one({"id": teacher_id}, {"_id": 0})
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher profile not found")
    return teacher


async def _ensure_teacher_scope(teacher_id: str, current_user: Dict[str, Any]) -> Dict[str, Any]:
    teacher = await _load_teacher_or_404(teacher_id)
    if _tenant_role(current_user) == "super_admin":
        return teacher
    current_user_id = current_user.get("id")
    if teacher.get("created_by") == current_user_id:
        return teacher
    if teacher.get("organization_id") and teacher.get("organization_id") == current_user.get("organization_id"):
        return teacher
    if teacher.get("school_id") and teacher.get("school_id") == current_user.get("school_id"):
        return teacher
    raise HTTPException(status_code=403, detail="Teacher profile is outside your scope")


@router.get("/master-admin/cleanup-candidates")
async def get_cleanup_candidates_route(
    pending_days: int = Query(90, ge=1, le=3650),
    revoked_days: int = Query(180, ge=1, le=3650),
    include_archived: bool = True,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return await build_cleanup_candidates(
        _get_db(),
        pending_days=pending_days,
        revoked_days=revoked_days,
        include_archived=include_archived,
    )


@router.post("/master-admin/cleanup-candidates/actions")
async def run_cleanup_action_route(
    payload: CleanupActionPayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(current_user)
    try:
        result = await run_cleanup_action(
            _get_db(),
            action=payload.action,
            candidate_ids=payload.candidate_ids,
            reason=payload.reason,
            confirmation_text=payload.confirmation_text or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _audit_event(
        actor=current_user,
        action="cleanup_action_run",
        target_type="cleanup_candidates",
        target_id=payload.action,
        details=result,
    )
    return result


@router.post("/teachers/{teacher_id}/archive")
async def archive_teacher_profile_route(
    teacher_id: str,
    payload: LifecycleActionPayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_admin_or_super_admin(current_user)
    await _ensure_teacher_scope(teacher_id, current_user)
    try:
        result = await archive_teacher_profile(
            _get_db(),
            teacher_id=teacher_id,
            actor_user_id=current_user.get("id"),
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _audit_event(
        actor=current_user,
        action="teacher_profile_archived",
        target_type="teacher",
        target_id=teacher_id,
        details=result,
    )
    return result


@router.post("/teachers/{teacher_id}/restore")
async def restore_teacher_profile_route(
    teacher_id: str,
    payload: LifecycleActionPayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_admin_or_super_admin(current_user)
    await _ensure_teacher_scope(teacher_id, current_user)
    try:
        result = await restore_teacher_profile(
            _get_db(),
            teacher_id=teacher_id,
            actor_user_id=current_user.get("id"),
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _audit_event(
        actor=current_user,
        action="teacher_profile_restored",
        target_type="teacher",
        target_id=teacher_id,
        details=result,
    )
    return result


@router.post("/teachers/{teacher_id}/safe-delete")
async def safe_delete_teacher_profile_route(
    teacher_id: str,
    payload: LifecycleActionPayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_admin_or_super_admin(current_user)
    await _ensure_teacher_scope(teacher_id, current_user)
    try:
        result = await delete_unused_teacher_profile(
            _get_db(),
            teacher_id=teacher_id,
            confirmation_text=payload.confirmation_text or "",
            reason=payload.reason or "",
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("status") == "blocked":
        raise HTTPException(status_code=409, detail=result)
    await _audit_event(
        actor=current_user,
        action="teacher_profile_safe_deleted",
        target_type="teacher",
        target_id=teacher_id,
        details=result,
    )
    return result


@router.delete("/master-admin/teachers/{teacher_id}")
async def hard_delete_teacher_profile_route(
    teacher_id: str,
    payload: TeacherHardDeletePayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(current_user)
    before_counts = await count_teacher_dependencies(_get_db(), teacher_id)
    await _audit_event(
        actor=current_user,
        action="teacher_profile_hard_delete_requested",
        target_type="teacher",
        target_id=teacher_id,
        details={"reason": payload.reason, "before_counts": before_counts},
    )
    try:
        result = await hard_delete_teacher_profile(
            _get_db(),
            teacher_id=teacher_id,
            confirmation_text=payload.confirmation_text,
            reason=payload.reason,
            delete_linked_user=payload.delete_linked_user,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc)) from exc
    await _audit_event(
        actor=current_user,
        action="teacher_profile_hard_deleted",
        target_type="teacher",
        target_id=teacher_id,
        details=result,
    )
    return result


@router.delete("/master-admin/users/{user_id}")
async def hard_delete_user_account_route(
    user_id: str,
    payload: UserHardDeletePayload,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    _require_super_admin(current_user)
    if user_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot permanently delete your own account")
    await _audit_event(
        actor=current_user,
        action="user_hard_delete_requested",
        target_type="user",
        target_id=user_id,
        details={"reason": payload.reason, "delete_linked_teacher": payload.delete_linked_teacher},
    )
    try:
        result = await hard_delete_user_account(
            _get_db(),
            user_id=user_id,
            confirmation_text=payload.confirmation_text,
            reason=payload.reason,
            delete_linked_teacher=payload.delete_linked_teacher,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail=str(exc)) from exc
    await _audit_event(
        actor=current_user,
        action="user_hard_deleted",
        target_type="user",
        target_id=user_id,
        details=result,
    )
    return result
