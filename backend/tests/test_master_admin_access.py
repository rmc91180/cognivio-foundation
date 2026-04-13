import types

import pytest
from fastapi import HTTPException
from starlette.responses import Response

import server


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                if projection:
                    include_keys = {key for key, value in projection.items() if value}
                    if include_keys:
                        return {key: value for key, value in doc.items() if key in include_keys}
                return dict(doc)
        return None


def test_get_user_role_prioritizes_super_admin_email(monkeypatch):
    monkeypatch.setattr(server, "SUPER_ADMIN_EMAILS", {"rmc91180@gmail.com"})
    monkeypatch.setattr(server, "ADMIN_EMAILS", {"rmc91180@gmail.com", "principal@example.com"})

    role = server._get_user_role(
        {
            "email": "rmc91180@gmail.com",
            "role": "admin",
        }
    )

    assert role == "super_admin"


def test_require_master_admin_user_rejects_admin():
    with pytest.raises(HTTPException) as exc:
        server._require_master_admin_user({"id": "u1", "email": "admin@example.com", "role": "admin"})

    assert exc.value.status_code == 403


def test_require_master_admin_user_allows_super_admin():
    server._require_master_admin_user({"id": "u1", "email": "super@example.com", "role": "super_admin"})


def test_is_admin_role_still_treats_super_admin_as_admin():
    assert server._is_admin_role("super_admin") is True


@pytest.mark.asyncio
async def test_get_current_user_returns_preview_target_for_super_admin(monkeypatch):
    token = server.jwt.encode({"user_id": "super-1"}, server.JWT_SECRET, algorithm=server.JWT_ALGORITHM)
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "super-1",
                    "email": "rmc91180@gmail.com",
                    "name": "RMC Master Admin",
                    "role": "super_admin",
                    "approval_status": "approved",
                    "is_active": True,
                },
                {
                    "id": "teacher-1",
                    "email": "teacher@example.com",
                    "name": "Teacher One",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                },
            ]
        ),
        user_sessions=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    request = types.SimpleNamespace(headers={"X-Cognivio-Preview-User": "teacher-1"})
    credentials = types.SimpleNamespace(credentials=token)

    user = await server.get_current_user(request, credentials)

    assert user["id"] == "teacher-1"
    assert user["is_preview_mode"] is True
    assert user["preview_source_email"] == "rmc91180@gmail.com"


@pytest.mark.asyncio
async def test_preview_mode_blocks_write_requests():
    async def _call_next(_request):
        return Response(status_code=200)

    request = types.SimpleNamespace(
        headers={"X-Cognivio-Preview-User": "teacher-1"},
        url=types.SimpleNamespace(path="/api/teachers"),
        method="POST",
    )

    response = await server.block_write_requests_in_preview_mode(
        request,
        _call_next,
    )

    assert response.status_code == 403
