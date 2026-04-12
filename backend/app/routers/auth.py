from __future__ import annotations

from fastapi import APIRouter, Depends, Request

import server as legacy

from app.dependencies import get_current_user
from app.services.auth_service import get_current_user_profile, login_user, register_user


router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=legacy.TokenResponse)
async def register(user: legacy.UserCreate):
    return await register_user(user)


@router.post("/auth/login", response_model=legacy.TokenResponse)
async def login(user: legacy.UserLogin, request: Request):
    return await login_user(user, request)


@router.get("/auth/me", response_model=legacy.UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return await get_current_user_profile(current_user)
