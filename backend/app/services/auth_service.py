from __future__ import annotations

import uuid
from datetime import datetime, timezone

import server as legacy


async def register_user(user: legacy.UserCreate) -> legacy.TokenResponse:
    if legacy.DEMO_MODE:
        raise legacy.HTTPException(status_code=403, detail="Registration is disabled for demo mode")

    existing = await legacy.db.users.find_one({"email": user.email})
    if existing:
        raise legacy.HTTPException(status_code=400, detail="Email already registered")

    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user.email,
        "name": user.name,
        "password": legacy.hash_password(user.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "role": "admin" if user.email.lower() in legacy.ADMIN_EMAILS else "teacher",
    }
    await legacy.db.users.insert_one(user_doc)

    token = legacy.create_token(user_id)
    return legacy.TokenResponse(
        token=token,
        user=legacy.UserResponse(
            id=user_id,
            email=user.email,
            name=user.name,
            created_at=user_doc["created_at"],
            role=legacy._get_user_role(user_doc),
        ),
    )


async def login_user(user: legacy.UserLogin, request) -> legacy.TokenResponse:
    return await legacy.login(user, request)


async def get_current_user_profile(current_user: dict) -> legacy.UserResponse:
    return legacy.UserResponse(**current_user)
