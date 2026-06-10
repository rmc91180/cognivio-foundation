from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.dependencies import get_current_user
from app.services.consent_service import (
    ConsentGrantPayload,
    ConsentWithdrawPayload,
    export_user_data,
    get_consent_status,
    grant_consent,
    list_consent_records,
    request_right_to_erasure,
    withdraw_consent,
)


router = APIRouter(tags=["consent"])


@router.get("/consent/status")
async def get_consent_status_route(
    current_user: dict = Depends(get_current_user),
):
    return await get_consent_status(current_user)


@router.post("/consent/grant")
async def grant_consent_route(
    payload: ConsentGrantPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    return await grant_consent(payload, request, current_user)


@router.post("/consent/withdraw")
async def withdraw_consent_route(
    payload: ConsentWithdrawPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    return await withdraw_consent(payload, request, current_user)


@router.get("/consent/records")
async def list_consent_records_route(
    current_user: dict = Depends(get_current_user),
):
    return await list_consent_records(current_user)


@router.post("/user/right-to-erasure")
async def request_right_to_erasure_route(
    current_user: dict = Depends(get_current_user),
):
    return await request_right_to_erasure(current_user)


@router.get("/user/data-export")
async def export_user_data_route(
    current_user: dict = Depends(get_current_user),
):
    return await export_user_data(current_user)
