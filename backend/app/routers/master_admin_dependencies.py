from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app.services.dependency_health import get_dependency_health

router = APIRouter(prefix="/master-admin", tags=["master-admin"])


async def require_super_admin_compat(request: Request) -> Any:
    """
    Compatibility guard.

    Replace this with the repo's existing super-admin dependency if one exists,
    for example:
        from app.middleware.auth_middleware import require_super_admin
        return await require_super_admin(...)

    This fallback expects upstream auth middleware to attach the current user to
    request.state.user.
    """
    user = getattr(request.state, "user", None)

    if isinstance(user, dict):
        role = user.get("role")
        email = (user.get("email") or "").lower()
        is_super = bool(user.get("is_super_admin")) or role in {"super_admin", "master_admin"}
        if is_super:
            return user

    # Import lazily to avoid breaking apps whose auth dependencies live elsewhere.
    from fastapi import HTTPException, status

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Master admin access required.",
    )


@router.get("/dependencies")
async def read_master_admin_dependencies(
    request: Request,
    _current_user: Any = Depends(require_super_admin_compat),
) -> dict:
    db = getattr(request.app.state, "db", None)
    return await get_dependency_health(db)