import types

from fastapi.testclient import TestClient
import pytest

import server
from app.services import auth_service


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=1):
        self.docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None, *, unique_email=False):
        self.docs = list(docs or [])
        self.unique_email = unique_email

    async def find_one(self, query=None, projection=None, *args, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, doc):
        normalized_email = str(doc.get("email") or "").strip().lower()
        if self.unique_email and normalized_email and any(str(item.get("email") or "").strip().lower() == normalized_email for item in self.docs):
            raise Exception("E11000 duplicate key error collection: users index: email")
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            payload = dict(query or {})
            payload.update(update.get("$set", {}))
            self.docs.append(payload)
            return types.SimpleNamespace(matched_count=1, modified_count=1)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        count = 0
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                count += 1
        return types.SimpleNamespace(modified_count=count)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query or {})]
        return types.SimpleNamespace(deleted_count=before - len(self.docs))

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
        for key, value in (query or {}).items():
            if key == "$or":
                if not any(self._matches(doc, item) for item in value):
                    return False
                continue
            doc_value = doc.get(key)
            if isinstance(value, dict):
                for operator, expected in value.items():
                    if operator == "$in":
                        if doc_value not in expected:
                            return False
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$regex":
                        import re

                        flags = re.I if value.get("$options") == "i" else 0
                        if not re.match(expected, str(doc_value or ""), flags=flags):
                            return False
                    elif operator == "$options":
                        continue
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc_value != value:
                return False
        return True


def _db(users=None):
    return types.SimpleNamespace(
        users=_Collection(users or [], unique_email=True),
        organizations=_Collection(),
        schools=_Collection(),
        teachers=_Collection(),
        user_sessions=_Collection(),
        auth_event_log=_Collection(),
        master_admin_audit_events=_Collection(),
        notifications=_Collection(),
        videos=_Collection(),
        assessments=_Collection(),
        teacher_face_profiles=_Collection(),
    )


def _client(monkeypatch, db_obj):
    monkeypatch.setattr(server, "db", db_obj)
    monkeypatch.setattr(server, "DEMO_MODE", False)
    monkeypatch.setattr(server, "ACCESS_APPROVAL_REQUIRED", True)
    monkeypatch.setattr(server, "_send_access_request_notification", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_request_received_confirmation", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda _user: False)
    monkeypatch.setattr(
        server,
        "create_token",
        lambda subject, **kwargs: auth_service.create_access_token(str(subject)),
    )
    server.app.dependency_overrides.clear()
    return TestClient(server.app)


def _request_payload(email="new.teacher@example.com"):
    return {
        "email": email,
        "password": "StrongPassword123",
        "name": "New Teacher",
        "role": "teacher",
        "organization_type": "school",
        "organization_name": "Sunrise Network",
        "school_name": "Sunrise Elementary",
        "requested_manager_email": "principal@example.com",
    }


def test_auth_lifecycle_routes_are_mounted_under_api():
    paths = {route.path for route in server.app.routes}

    assert "/api/auth/request-access" in paths
    assert "/api/auth/login" in paths
    assert "/api/auth/logout" in paths
    assert "/api/me" in paths


def test_public_request_access_invalid_body_returns_422_json_with_cors():
    client = TestClient(server.app)

    response = client.post(
        "/api/auth/request-access",
        json={},
        headers={"Origin": "https://app.cognivio.live"},
    )

    assert response.status_code == 422
    assert response.headers["access-control-allow-origin"]
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["content-type"].startswith("application/json")
    missing_fields = {item["loc"][-1] for item in response.json()["detail"]}
    assert {"email", "password", "name"} <= missing_fields


@pytest.fixture(autouse=True)
def _clear_overrides():
    server.app.dependency_overrides.clear()
    yield
    server.app.dependency_overrides.clear()


def test_public_request_access_safari_no_auth_persists_before_notification(monkeypatch):
    db_obj = _db()
    client = _client(monkeypatch, db_obj)

    response = client.post(
        "/api/auth/request-access",
        json=_request_payload("Safari.User@Example.com"),
        headers={
            "Origin": "https://app.cognivio.live",
            "User-Agent": "Mozilla/5.0 Safari/605.1.15",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["status"] == "pending"
    assert payload["notification"] == {"sent": False, "warning": "notification_delivery_failed"}
    assert db_obj.users.docs[0]["email"] == "safari.user@example.com"
    assert db_obj.users.docs[0]["approval_status"] == "pending"
    assert any(event["event_type"] == "request_access_persisted" for event in db_obj.auth_event_log.docs)
    assert any(event["event_type"] == "request_access_notification_failed" for event in db_obj.auth_event_log.docs)


def test_public_request_access_duplicate_pending_returns_controlled_409(monkeypatch):
    db_obj = _db(
        [
            {
                "id": "pending-1",
                "email": "Pending@Example.com",
                "name": "Pending",
                "password": server.hash_password("StrongPassword123"),
                "role": "teacher",
                "tenant_role": "teacher",
                "approval_status": "pending",
                "is_active": False,
                "created_at": "2026-05-01T10:00:00+00:00",
            }
        ]
    )
    client = _client(monkeypatch, db_obj)

    response = client.post(
        "/api/auth/request-access",
        json=_request_payload("pending@example.com"),
        headers={"Origin": "https://app.cognivio.live"},
    )

    assert response.status_code == 409
    assert response.headers["access-control-allow-origin"]
    assert response.json()["detail"]["reason_code"] == "access_request_already_pending"
    assert len(db_obj.users.docs) == 1


def test_public_request_access_reuses_rejected_email_case_insensitively(monkeypatch):
    db_obj = _db(
        [
            {
                "id": "rejected-1",
                "email": "Retry@Example.com",
                "name": "Retry",
                "password": server.hash_password("OldStrongPassword123"),
                "role": "teacher",
                "tenant_role": "teacher",
                "approval_status": "rejected",
                "is_active": False,
                "created_at": "2026-05-01T10:00:00+00:00",
            }
        ]
    )
    client = _client(monkeypatch, db_obj)

    response = client.post("/api/auth/request-access", json=_request_payload("retry@example.com"))

    assert response.status_code == 200
    assert len(db_obj.users.docs) == 1
    assert db_obj.users.docs[0]["email"] == "retry@example.com"
    assert db_obj.users.docs[0]["approval_status"] == "pending"


@pytest.mark.parametrize(
    "approval_status,is_active,reason_code",
    [
        ("pending", False, "account_pending_approval"),
        ("rejected", False, "account_rejected"),
        ("revoked", False, "account_disabled"),
    ],
)
def test_login_lifecycle_blocked_states_return_reason_codes(monkeypatch, approval_status, is_active, reason_code):
    db_obj = _db(
        [
            {
                "id": "user-1",
                "email": "user@example.com",
                "name": "User",
                "password": server.hash_password("StrongPassword123"),
                "role": "teacher",
                "tenant_role": "teacher",
                "approval_status": approval_status,
                "is_active": is_active,
                "created_at": "2026-05-01T10:00:00+00:00",
            }
        ]
    )
    client = _client(monkeypatch, db_obj)

    response = client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "StrongPassword123", "role": "teacher"},
        headers={"User-Agent": "Mozilla/5.0 Safari/605.1.15"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["reason_code"] == reason_code


def test_login_token_can_call_api_me_after_approval(monkeypatch):
    db_obj = _db(
        [
            {
                "id": "approved-1",
                "email": "approved@example.com",
                "name": "Approved",
                "password": server.hash_password("StrongPassword123"),
                "role": "teacher",
                "tenant_role": "teacher",
                "approval_status": "approved",
                "is_active": True,
                "created_at": "2026-05-01T10:00:00+00:00",
            }
        ]
    )
    client = _client(monkeypatch, db_obj)

    login = client.post(
        "/api/auth/login",
        json={"email": "approved@example.com", "password": "StrongPassword123", "role": "teacher"},
        headers={"User-Agent": "Mozilla/5.0 Safari/605.1.15"},
    )
    token = login.json()["token"]
    me = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    assert login.status_code == 200
    assert me.status_code == 200
    assert me.json()["email"] == "approved@example.com"


def test_request_access_and_login_preflight_allow_safari_headers():
    client = TestClient(server.app)

    for path in ["/api/auth/request-access", "/api/auth/login", "/api/auth/logout"]:
        response = client.options(
            path,
            headers={
                "Origin": "https://app.cognivio.live",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,authorization,x-csrf-token",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "https://app.cognivio.live"
        allow_headers = response.headers["access-control-allow-headers"].lower()
        assert "authorization" in allow_headers
        assert "content-type" in allow_headers
        assert "x-csrf-token" in allow_headers
