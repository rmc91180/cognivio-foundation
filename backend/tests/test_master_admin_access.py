import pytest
from fastapi import HTTPException

import server


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

