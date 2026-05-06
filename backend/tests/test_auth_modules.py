import types

import pytest
from fastapi import HTTPException

import server
from app.middleware import auth_middleware
from app.services import auth_service


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                payload = dict(doc)
                if projection:
                    for key, include in projection.items():
                        if include == 0:
                            payload.pop(key, None)
                return payload
        return None


def test_password_hash_round_trip():
    password_hash = auth_service.hash_password("correct horse battery staple")

    assert auth_service.verify_password("correct horse battery staple", password_hash)
    assert not auth_service.verify_password("wrong", password_hash)


def test_create_and_verify_access_token():
    token = auth_service.create_access_token(
        "user-1",
        "teacher@example.com",
        ["teacher"],
        "teacher",
        session_id="session-1",
    )

    payload = auth_service.verify_access_token(token)

    assert payload["user_id"] == "user-1"
    assert payload["email"] == "teacher@example.com"
    assert payload["tenant_role"] == "teacher"
    assert payload["sid"] == "session-1"


def test_get_tenant_role_uses_server_admin_allowlists(monkeypatch):
    monkeypatch.setattr(server, "SUPER_ADMIN_EMAILS", {"owner@example.com"})
    monkeypatch.setattr(server, "ADMIN_EMAILS", {"principal@example.com"})

    assert auth_service.get_tenant_role({"email": "owner@example.com", "role": "teacher"}) == "super_admin"
    assert auth_service.get_tenant_role({"email": "principal@example.com", "role": "teacher"}) == "school_admin"


def test_resolve_user_permissions():
    permissions = auth_service.resolve_user_permissions({"id": "u1", "tenant_role": "training_admin"})

    assert permissions["role"] == "admin"
    assert permissions["tenant_role"] == "training_admin"
    assert permissions["can_administer_training"] is True


@pytest.mark.asyncio
async def test_auth_middleware_get_current_user(monkeypatch):
    token = auth_service.create_access_token("teacher-1")
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "teacher-1",
                    "email": "teacher@example.com",
                    "name": "Teacher One",
                    "tenant_role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "password": "hidden",
                }
            ]
        ),
        user_sessions=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    request = types.SimpleNamespace(headers={}, cookies={})
    credentials = types.SimpleNamespace(credentials=token, scheme="bearer")

    user = await auth_middleware.get_current_user(request, credentials)

    assert user["id"] == "teacher-1"
    assert user["role"] == "teacher"
    assert user["is_preview_mode"] is False
    assert "password" not in user


def test_verify_access_token_rejects_invalid_token():
    with pytest.raises(HTTPException) as exc:
        auth_service.verify_access_token("not-a-token")

    assert exc.value.status_code == 401
