from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

import server as legacy

from app.dependencies import get_current_user
from app.services.auth_service import (
    confirm_password_reset,
    get_current_user_profile,
    login_user,
    register_user,
    request_access,
    request_password_reset,
)


class PasswordResetRequestPayload(BaseModel):
    email: str


class PasswordResetConfirmPayload(BaseModel):
    token: str
    password: Optional[str] = None
    new_password: Optional[str] = None


router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=legacy.TokenResponse)
async def register(user: legacy.UserCreate):
    return await register_user(user)


@router.post("/auth/login", response_model=legacy.TokenResponse)
async def login(user: legacy.UserLogin, request: Request):
    return await login_user(user, request)


@router.post("/auth/request-access")
async def request_access_route(user: legacy.UserCreate, request: Request):
    return await request_access(user, request)


@router.post("/auth/password-reset/request")
async def request_password_reset_route(payload: PasswordResetRequestPayload, request: Request):
    return await request_password_reset(payload, request)


@router.post("/auth/password-reset/confirm")
async def confirm_password_reset_route(payload: PasswordResetConfirmPayload, request: Request):
    return await confirm_password_reset(payload, request)


@router.get("/auth/me", response_model=legacy.UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return await get_current_user_profile(current_user)