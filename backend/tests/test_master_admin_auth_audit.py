import asyncio
import types

import pytest

import server
from app.services import workspace_service


class _UpdateResult:
    def __init__(self, matched_count=1):
        self.matched_count = matched_count


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda item: item.get(field) or "", reverse=reverse)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query))

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, payload):
        self.docs.append(dict(payload))
        return types.SimpleNamespace(inserted_id=payload.get("id"))

    async def update_one(self, query, update):
        updated = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                for key, value in (update.get("$set") or {}).items():
                    next_doc[key] = value
                self.docs[index] = next_doc
                updated += 1
                break
        return _UpdateResult(updated)

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        include_keys = {key for key, value in projection.items() if value}
        exclude_keys = {key for key, value in projection.items() if not value}
        payload = dict(doc)
        if include_keys:
            payload = {key: value for key, value in payload.items() if key in include_keys}
        for key in exclude_keys:
            payload.pop(key, None)
        return payload

    def _matches(self, doc, query):
        if not query:
            return True
        for key, value in query.items():
            if key == "$or":
                if not any(self._matches(doc, item) for item in value):
                    return False
                continue
            if isinstance(value, dict):
                doc_value = doc.get(key)
                for operator, expected in value.items():
                    if operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$in":
                        if doc_value not in expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _fake_request():
    return types.SimpleNamespace(
        client=types.SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "pytest-agent"},
    )


@pytest.fixture
def fake_db(monkeypatch):
    db = types.SimpleNamespace(
        users=_Collection([]),
        teachers=_Collection([]),
        videos=_Collection([]),
        assessments=_Collection([]),
        auth_event_log=_Collection([]),
        master_admin_audit_events=_Collection([]),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(workspace_service, "enrich_user_with_workspace_mode", lambda user_doc: asyncio.sleep(0, result=user_doc))
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(server, "create_token", lambda subject: f"token-{subject}")
    return db


def test_login_writes_success_auth_event(monkeypatch, fake_db):
    password = "StrongPassword123"
    fake_db.users.docs.append(
        {
            "id": "u1",
            "email": "teacher@example.com",
            "name": "Teacher Example",
            "password": server.hash_password(password),
            "role": "teacher",
            "approval_status": "approved",
            "is_active": True,
            "created_at": "2026-04-12T10:00:00+00:00",
        }
    )

    result = asyncio.run(
        server.login(
            server.UserLogin(email="teacher@example.com", password=password, role="teacher"),
            _fake_request(),
        )
    )

    assert result.token == "token-u1"
    assert any(
        event["event_type"] == "login_success"
        and event["email"] == "teacher@example.com"
        and event["result"] == "success"
        for event in fake_db.auth_event_log.docs
    )


def test_login_writes_failure_auth_event(fake_db):
    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.login(
                server.UserLogin(email="missing@example.com", password="bad-password", role="teacher"),
                _fake_request(),
            )
        )

    assert exc.value.status_code == 401
    assert any(
        event["event_type"] == "login_failed"
        and event["reason"] == "invalid_credentials"
        and event["email"] == "missing@example.com"
        for event in fake_db.auth_event_log.docs
    )


def test_master_admin_revoke_requires_exact_confirmation_text(fake_db):
    fake_db.users.docs.extend(
        [
            {
                "id": "super-1",
                "email": "rmc91180@gmail.com",
                "name": "RMC Master Admin",
                "role": "super_admin",
                "approval_status": "approved",
                "is_active": True,
                "created_at": "2026-04-12T10:00:00+00:00",
            },
            {
                "id": "u1",
                "email": "teacher@example.com",
                "name": "Teacher Example",
                "role": "teacher",
                "approval_status": "approved",
                "is_active": True,
                "created_at": "2026-04-12T10:00:00+00:00",
            },
        ]
    )

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.master_admin_revoke_user(
                "u1",
                server.MasterAdminUserActionPayload(reason="Remove access", confirmation_text="wrong@example.com"),
                current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
            )
        )

    assert exc.value.status_code == 400
    assert "match the target email" in exc.value.detail


def test_master_admin_approve_and_reactivate_write_audit_events(fake_db):
    fake_db.users.docs.extend(
        [
            {
                "id": "super-1",
                "email": "rmc91180@gmail.com",
                "name": "RMC Master Admin",
                "role": "super_admin",
                "approval_status": "approved",
                "is_active": True,
                "created_at": "2026-04-12T10:00:00+00:00",
            },
            {
                "id": "u1",
                "email": "teacher@example.com",
                "name": "Teacher Example",
                "role": "teacher",
                "approval_status": "pending",
                "is_active": False,
                "created_at": "2026-04-12T10:00:00+00:00",
            },
        ]
    )

    approved = asyncio.run(
        server.master_admin_approve_user(
            "u1",
            server.MasterAdminUserActionPayload(reason="Pilot approved"),
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )
    assert approved.approval_status == "approved"

    revoked = asyncio.run(
        server.master_admin_revoke_user(
            "u1",
            server.MasterAdminUserActionPayload(
                reason="Access paused",
                confirmation_text="teacher@example.com",
            ),
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )
    assert revoked.approval_status == "revoked"

    reactivated = asyncio.run(
        server.master_admin_reactivate_user(
            "u1",
            server.MasterAdminUserActionPayload(reason="Access restored"),
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )
    assert reactivated.approval_status == "approved"

    actions = [event["action"] for event in fake_db.master_admin_audit_events.docs]
    assert "approve_user_access" in actions
    assert "revoke_user_access" in actions
    assert "reactivate_user_access" in actions


def test_master_admin_event_endpoints_return_logged_activity(fake_db):
    fake_db.auth_event_log.docs.extend(
        [
            {
                "id": "auth-1",
                "email": "teacher@example.com",
                "user_id": "u1",
                "event_type": "login_success",
                "role_selected": "teacher",
                "result": "success",
                "reason": None,
                "ip_address": "127.0.0.1",
                "user_agent": "pytest-agent",
                "created_at": "2026-04-12T10:01:00+00:00",
            },
            {
                "id": "auth-2",
                "email": "teacher@example.com",
                "user_id": "u1",
                "event_type": "login_failed",
                "role_selected": "teacher",
                "result": "failure",
                "reason": "invalid_credentials",
                "ip_address": "127.0.0.1",
                "user_agent": "pytest-agent",
                "created_at": "2026-04-12T10:00:00+00:00",
            },
        ]
    )
    fake_db.master_admin_audit_events.docs.append(
        {
            "id": "audit-1",
            "actor_user_id": "super-1",
            "actor_email": "rmc91180@gmail.com",
            "actor_role": "super_admin",
            "action": "revoke_user_access",
            "target_type": "user",
            "target_id": "u1",
            "reason": "Cleanup",
            "metadata": {"email": "teacher@example.com"},
            "created_at": "2026-04-12T10:05:00+00:00",
        }
    )

    auth_events = asyncio.run(
        server.get_master_admin_auth_events(
            q="teacher@example.com",
            result="failure",
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )
    assert auth_events.total == 1
    assert auth_events.items[0].event_type == "login_failed"

    audit_events = asyncio.run(
        server.get_master_admin_audit_events(
            action="revoke_user_access",
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )
    assert audit_events.total == 1
    assert audit_events.items[0].target_id == "u1"
