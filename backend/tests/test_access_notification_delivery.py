import os
import sys
import types
import asyncio
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _stub_optional_dependencies():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub
    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub


_stub_optional_dependencies()

import server  # noqa: E402


def _sample_user_doc():
    return {
        "name": "Pilot Teacher",
        "email": "pilot.teacher@example.com",
        "role": "teacher",
        "organization_type": "school",
        "requested_organization_name": "Sunrise Network",
        "requested_school_name": "Sunrise Elementary",
        "created_at": "2026-03-31T10:00:00+00:00",
        "approval_requested_at": "2026-03-31T10:00:00+00:00",
    }


def test_send_access_request_notification_prefers_resend(monkeypatch):
    captured = {}

    class _Response:
        ok = True
        status_code = 200
        text = '{"id":"email_123"}'

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(server, "RESEND_API_KEY", "re_test_123")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "Cognivio <login@cognivio.live>")
    monkeypatch.setattr(server, "RESEND_API_BASE_URL", "https://api.resend.com")
    monkeypatch.setattr(server, "ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server.requests, "post", _fake_post)

    result = server._send_access_request_notification(_sample_user_doc())

    assert result is True
    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_test_123"
    assert captured["json"]["from"] == "Cognivio <login@cognivio.live>"
    assert captured["json"]["to"] == ["rmc91180@gmail.com"]
    assert captured["json"]["subject"] == "Cognivio approval needed: pilot.teacher@example.com"
    assert "Pilot Teacher" in captured["json"]["text"]
    assert "Institution type: School" in captured["json"]["text"]
    assert "Approve now:" in captured["json"]["text"]
    assert "Deny now:" in captured["json"]["text"]
    assert "/api/admin/access-request-actions/approve?token=" in captured["json"]["html"]
    assert "/api/admin/access-request-actions/deny?token=" in captured["json"]["html"]


def test_send_access_request_notification_returns_false_without_provider(monkeypatch):
    monkeypatch.setattr(server, "RESEND_API_KEY", "")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "")
    monkeypatch.setattr(server, "SMTP_HOST", "")
    monkeypatch.setattr(server, "SMTP_FROM_EMAIL", "")
    monkeypatch.setattr(server, "ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com")

    assert server._send_access_request_notification(_sample_user_doc()) is False


def test_send_access_request_notification_falls_back_to_smtp(monkeypatch):
    smtp_calls = {}

    class _FakeSMTP:
        def __init__(self, host, port, timeout=None):
            smtp_calls["host"] = host
            smtp_calls["port"] = port
            smtp_calls["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def starttls(self, context=None):
            smtp_calls["starttls"] = True

        def login(self, username, password):
            smtp_calls["username"] = username
            smtp_calls["password"] = password

        def send_message(self, message):
            smtp_calls["subject"] = message["Subject"]
            smtp_calls["to"] = message["To"]

    monkeypatch.setattr(server, "RESEND_API_KEY", "")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "")
    monkeypatch.setattr(server, "ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setattr(server, "SMTP_PORT", 587)
    monkeypatch.setattr(server, "SMTP_USERNAME", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "SMTP_PASSWORD", "app-password")
    monkeypatch.setattr(server, "SMTP_FROM_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "SMTP_USE_TLS", True)
    monkeypatch.setattr(server.smtplib, "SMTP", _FakeSMTP)

    result = server._send_access_request_notification(_sample_user_doc())

    assert result is True
    assert smtp_calls["host"] == "smtp.gmail.com"
    assert smtp_calls["port"] == 587
    assert smtp_calls["username"] == "rmc91180@gmail.com"
    assert smtp_calls["password"] == "app-password"
    assert smtp_calls["to"] == "rmc91180@gmail.com"
    assert smtp_calls["subject"] == "Cognivio approval needed: pilot.teacher@example.com"


def test_send_access_request_received_confirmation_prefers_resend(monkeypatch):
    captured = {}

    class _Response:
        ok = True
        status_code = 200
        text = '{"id":"email_456"}'

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(server, "RESEND_API_KEY", "re_test_123")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "Cognivio <login@cognivio.live>")
    monkeypatch.setattr(server, "RESEND_API_BASE_URL", "https://api.resend.com")
    monkeypatch.setattr(server.requests, "post", _fake_post)

    result = server._send_access_request_received_confirmation(_sample_user_doc())

    assert result is True
    assert captured["json"]["to"] == ["pilot.teacher@example.com"]
    assert captured["json"]["subject"] == "Cognivio sign-up received"
    assert "pending approval" in captured["json"]["text"]
    assert "Institution type: School" in captured["json"]["text"]


def test_send_access_approved_confirmation_prefers_resend(monkeypatch):
    captured = {}

    class _Response:
        ok = True
        status_code = 200
        text = '{"id":"email_789"}'

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return _Response()

    approved_doc = {
        **_sample_user_doc(),
        "approved_at": "2026-03-31T11:00:00+00:00",
    }

    monkeypatch.setattr(server, "RESEND_API_KEY", "re_test_123")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "Cognivio <login@cognivio.live>")
    monkeypatch.setattr(server, "RESEND_API_BASE_URL", "https://api.resend.com")
    monkeypatch.setattr(server, "FRONTEND_URL", "https://www.cognivio.live")
    monkeypatch.setattr(server.requests, "post", _fake_post)

    result = server._send_access_approved_confirmation(approved_doc)

    assert result is True
    assert captured["json"]["to"] == ["pilot.teacher@example.com"]
    assert captured["json"]["subject"] == "Your Cognivio access is approved"
    assert "Institution type: School" in captured["json"]["text"]
    assert "https://www.cognivio.live" in captured["json"]["text"]
    assert "Open Cognivio" in captured["json"]["html"]


def test_send_access_denied_confirmation_prefers_resend(monkeypatch):
    captured = {}

    class _Response:
        ok = True
        status_code = 200
        text = '{"id":"email_101"}'

    def _fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return _Response()

    monkeypatch.setattr(server, "RESEND_API_KEY", "re_test_123")
    monkeypatch.setattr(server, "RESEND_FROM_EMAIL", "Cognivio <login@cognivio.live>")
    monkeypatch.setattr(server, "RESEND_API_BASE_URL", "https://api.resend.com")
    monkeypatch.setattr(server.requests, "post", _fake_post)

    result = server._send_access_denied_confirmation(_sample_user_doc())

    assert result is True
    assert captured["json"]["to"] == ["pilot.teacher@example.com"]
    assert captured["json"]["subject"] == "Your Cognivio access request was not approved"
    assert "not approved" in captured["json"]["text"]
    assert "not approved" in captured["json"]["html"]


def test_ensure_master_admin_user_creates_or_updates_admin(monkeypatch):
    class _Users:
        def __init__(self):
            self.record = None
            self.updated = None

        async def find_one(self, query):
            if self.record and self.record.get("email") == query.get("email"):
                return self.record
            return None

        async def insert_one(self, doc):
            self.record = doc
            return types.SimpleNamespace(inserted_id=doc["id"])

        async def update_one(self, query, update):
            self.updated = (query, update)
            if self.record and self.record.get("email") == query.get("email"):
                self.record.update(update.get("$set", {}))
            return types.SimpleNamespace(modified_count=1)

    users = _Users()
    fake_db = types.SimpleNamespace(users=users)

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "MASTER_ADMIN_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "MASTER_ADMIN_PASSWORD", "CognivioAdmin2026")
    monkeypatch.setattr(server, "MASTER_ADMIN_NAME", "RMC Master Admin")

    asyncio.run(server._ensure_master_admin_user())

    assert users.record is not None
    assert users.record["email"] == "rmc91180@gmail.com"
    assert users.record["role"] == "super_admin"
    assert users.record["approval_status"] == "approved"
    assert users.record["is_active"] is True
    assert users.record["name"] == "RMC Master Admin"

    users.record["name"] = "Old Admin Name"
    asyncio.run(server._ensure_master_admin_user())

    assert users.record["name"] == "RMC Master Admin"


def test_process_access_request_action_approve(monkeypatch):
    class _Users:
        def __init__(self):
            self.record = {
                "id": "user-123",
                "name": "Pilot Teacher",
                "email": "pilot.teacher@example.com",
                "role": "teacher",
                "approval_status": "pending",
                "approval_requested_at": "2026-03-31T10:00:00+00:00",
                "is_active": False,
            }

        async def find_one(self, query, projection=None):
            if self.record and self.record.get("id") == query.get("id"):
                return dict(self.record)
            return None

        async def update_one(self, query, update):
            if self.record and self.record.get("id") == query.get("id"):
                self.record.update(update.get("$set", {}))
            return types.SimpleNamespace(modified_count=1)

    users = _Users()
    fake_db = types.SimpleNamespace(users=users)
    sent = {}

    def _fake_send(user_doc):
        sent["email"] = user_doc["email"]
        return True

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "_send_access_approved_confirmation", _fake_send)

    token = server._create_access_request_action_token(users.record, "approve")
    response = asyncio.run(server.process_access_request_action("approve", token))

    assert response.status_code == 200
    assert users.record["approval_status"] == "approved"
    assert users.record["is_active"] is True
    assert users.record["approved_by"] == "email_link:rmc91180@gmail.com"
    assert sent["email"] == "pilot.teacher@example.com"
    assert "Applicant approved" in response.body.decode("utf-8")


def test_process_access_request_action_deny(monkeypatch):
    class _Users:
        def __init__(self):
            self.record = {
                "id": "user-456",
                "name": "Pending Teacher",
                "email": "pending.teacher@example.com",
                "role": "teacher",
                "approval_status": "pending",
                "approval_requested_at": "2026-03-31T10:00:00+00:00",
                "is_active": False,
            }

        async def find_one(self, query, projection=None):
            if self.record and self.record.get("id") == query.get("id"):
                return dict(self.record)
            return None

        async def update_one(self, query, update):
            if self.record and self.record.get("id") == query.get("id"):
                self.record.update(update.get("$set", {}))
            return types.SimpleNamespace(modified_count=1)

    users = _Users()
    fake_db = types.SimpleNamespace(users=users)
    sent = {}

    def _fake_send(user_doc):
        sent["email"] = user_doc["email"]
        return True

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "ACCESS_APPROVAL_NOTIFY_EMAIL", "rmc91180@gmail.com")
    monkeypatch.setattr(server, "_send_access_denied_confirmation", _fake_send)

    token = server._create_access_request_action_token(users.record, "deny")
    response = asyncio.run(server.process_access_request_action("deny", token))

    assert response.status_code == 200
    assert users.record is None
    assert sent["email"] == "pending.teacher@example.com"
    assert "Applicant denied" in response.body.decode("utf-8")
