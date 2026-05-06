from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

import server as legacy
from app.middleware.auth_middleware import get_current_user
from app.services import auth_service


router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=legacy.AuthSessionResponse)
async def register(user: legacy.UserCreate, request: Request, response: Response = None):
    return await auth_service.register_user(user, request, response)


@router.post("/auth/request-access", response_model=legacy.AccessRequestResponse)
async def request_access(user: legacy.UserCreate, request: Request):
    return await auth_service.request_access(user, request)


@router.post("/auth/login", response_model=legacy.AuthSessionResponse)
@legacy.limiter.limit("5/minute")
async def login(user: legacy.UserLogin, request: Request, response: Response = None):
    return await auth_service.login_user(user, request, response)


login = login.__wrapped__


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    return await auth_service.logout_user(request, response)


@router.post("/auth/password-reset/request")
async def request_password_reset(payload: legacy.PasswordResetRequestPayload, request: Request):
    return await auth_service.request_password_reset(payload, request)


@router.post("/auth/password-reset/confirm")
async def confirm_password_reset(payload: legacy.PasswordResetConfirmPayload, request: Request):
    return await auth_service.confirm_password_reset(payload, request)


@router.get("/auth/me", response_model=legacy.UserResponse)
async def get_me(
    request: Request,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    return await auth_service.get_current_user_profile(current_user, request, response)
