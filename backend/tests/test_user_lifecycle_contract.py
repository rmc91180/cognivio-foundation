import asyncio
import types

import pytest

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda item: item.get(field) or "", reverse=reverse)
        return self

    def skip(self, count):
        self.docs = self.docs[count:]
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query or {}))

    async def find_one(self, query, projection=None, *args, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            payload = dict(query or {})
            payload.update(update.get("$set", {}))
            self.docs.append(payload)
            return types.SimpleNamespace(modified_count=1, matched_count=1)
        return types.SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update):
        updated = 0
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                updated += 1
        return types.SimpleNamespace(modified_count=updated)

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query or {}):
                self.docs.pop(index)
                return types.SimpleNamespace(deleted_count=1)
        return types.SimpleNamespace(deleted_count=0)

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
        if not query:
            return True
        for key, value in query.items():
            if key == "$or":
                if not any(self._matches(doc, item) for item in value):
                    return False
                continue
            if key == "$and":
                if not all(self._matches(doc, item) for item in value):
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
                    elif operator == "$exists":
                        if (key in doc) is not bool(expected):
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc_value != value:
                return False
        return True


def _fake_request():
    return types.SimpleNamespace(
        client=types.SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "pytest-agent"},
        cookies={},
    )


@pytest.fixture
def lifecycle_db(monkeypatch):
    db = types.SimpleNamespace(
        users=_Collection(),
        teachers=_Collection(),
        organizations=_Collection(),
        schools=_Collection(),
        user_sessions=_Collection(),
        auth_event_log=_Collection(),
        master_admin_audit_events=_Collection(),
        notifications=_Collection(),
        videos=_Collection(),
        assessments=_Collection(),
        curriculum_adherence=_Collection(),
        observations=_Collection(),
        video_evidence=_Collection(),
        video_processing_jobs=_Collection(),
        video_privacy_jobs=_Collection(),
        curricula=_Collection(),
        lesson_plans=_Collection(),
        syllabi=_Collection(),
        recording_compliance=_Collection(),
        schedules=_Collection(),
        share_assets=_Collection(),
        exemplar_library_items=_Collection(),
        exemplar_submissions=_Collection(),
        recognition_badges=_Collection(),
        lesson_recognition_events=_Collection(),
        teacher_face_references=_Collection(),
        teacher_face_profiles=_Collection(),
        privacy_audit_events=_Collection(),
        recognition_audit_events=_Collection(),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "_refresh_processing_incidents", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(server, "create_token", lambda subject, **kwargs: f"token-{subject}")
    return db


def test_pending_user_can_be_approved_email_sent_and_then_login(monkeypatch, lifecycle_db):
    sent = {}
    password = "StrongPassword123"
    lifecycle_db.users.docs.append(
        {
            "id": "teacher-1",
            "email": "teacher@example.com",
            "name": "Teacher One",
            "password": server.hash_password(password),
            "role": "teacher",
            "tenant_role": "teacher",
            "approval_status": "pending",
            "is_active": False,
            "created_at": "2026-05-01T10:00:00+00:00",
            "requested_organization_name": "Sunrise Network",
            "requested_school_name": "Sunrise Elementary",
        }
    )
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda user: sent.setdefault("approved", user["email"]) or True)

    approved = asyncio.run(
        server._approve_user_access(
            lifecycle_db.users.docs[0],
            actor_label="master@example.com",
            reason="Approved for pilot",
        )
    )
    login = asyncio.run(
        server.login(
            server.UserLogin(email="teacher@example.com", password=password, role="teacher"),
            _fake_request(),
        )
    )

    assert approved["approval_status"] == "approved"
    assert approved["is_active"] is True
    assert sent["approved"] == "teacher@example.com"
    assert login.token == "token-teacher-1"


def test_freeze_blocks_login_and_reactivate_restores_login(lifecycle_db):
    password = "StrongPassword123"
    lifecycle_db.users.docs.append(
        {
            "id": "teacher-1",
            "email": "teacher@example.com",
            "name": "Teacher One",
            "password": server.hash_password(password),
            "role": "teacher",
            "tenant_role": "teacher",
            "approval_status": "approved",
            "is_active": True,
            "created_at": "2026-05-01T10:00:00+00:00",
        }
    )

    frozen = asyncio.run(
        server.master_admin_freeze_user(
            "teacher-1",
            server.MasterAdminUserActionPayload(reason="Temporary freeze"),
            current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"},
        )
    )
    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.login(
                server.UserLogin(email="teacher@example.com", password=password, role="teacher"),
                _fake_request(),
            )
        )

    restored = asyncio.run(
        server.master_admin_reactivate_user(
            "teacher-1",
            server.MasterAdminUserActionPayload(reason="Freeze resolved"),
            current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"},
        )
    )
    login = asyncio.run(
        server.login(
            server.UserLogin(email="teacher@example.com", password=password, role="teacher"),
            _fake_request(),
        )
    )

    assert frozen.approval_status == "revoked"
    assert lifecycle_db.users.docs[0]["id"] == "teacher-1"
    assert exc.value.status_code == 403
    assert restored.approval_status == "approved"
    assert login.token == "token-teacher-1"


def test_hard_delete_removes_roster_allows_signup_again_and_preserves_audit(monkeypatch, lifecycle_db):
    sent = {}
    lifecycle_db.users.docs.append(
        {
            "id": "teacher-1",
            "email": "teacher@example.com",
            "name": "Teacher One",
            "password": server.hash_password("StrongPassword123"),
            "role": "teacher",
            "tenant_role": "teacher",
            "teacher_id": "teacher-record-1",
            "approval_status": "approved",
            "is_active": True,
            "created_at": "2026-05-01T10:00:00+00:00",
            "organization_id": "org-1",
        }
    )
    lifecycle_db.teachers.docs.append({"id": "teacher-record-1", "email": "teacher@example.com", "organization_id": "org-1"})
    lifecycle_db.auth_event_log.docs.append({"id": "auth-1", "user_id": "teacher-1", "email": "teacher@example.com"})
    lifecycle_db.organizations.docs.append({"id": "org-1", "name": "Sunrise Network", "organization_type": "school"})
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda user: sent.setdefault("denied", user["email"]) or True)

    deleted = asyncio.run(
        server.master_admin_delete_user(
            "teacher-1",
            server.MasterAdminUserActionPayload(
                reason="Hard deletion requested",
                confirmation_text="teacher@example.com",
            ),
            current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"},
        )
    )
    listing = asyncio.run(
        server.get_master_admin_users(current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"})
    )
    request_result = asyncio.run(
        server.request_access(
            server.UserCreate(
                email="Teacher@Example.com",
                password="NewStrongPassword123",
                name="Teacher Again",
                role="teacher",
            ),
            _fake_request(),
        )
    )

    assert deleted.approval_status == "deleted"
    assert lifecycle_db.users.docs[0]["email"] == "teacher@example.com"
    assert lifecycle_db.users.docs[0]["approval_status"] == "pending"
    assert lifecycle_db.teachers.docs == []
    assert lifecycle_db.auth_event_log.docs[0]["id"] == "auth-1"
    assert listing.total == 0
    assert request_result["status"] == "pending"


def test_pending_hard_delete_sends_rejection_email(monkeypatch, lifecycle_db):
    sent = {}
    lifecycle_db.users.docs.append(
        {
            "id": "pending-1",
            "email": "pending@example.com",
            "name": "Pending User",
            "password": server.hash_password("StrongPassword123"),
            "role": "teacher",
            "approval_status": "pending",
            "is_active": False,
            "created_at": "2026-05-01T10:00:00+00:00",
        }
    )
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda user: sent.setdefault("denied", user["email"]) or True)

    asyncio.run(
        server.master_admin_delete_user(
            "pending-1",
            server.MasterAdminUserActionPayload(
                reason="Request rejected",
                confirmation_text="pending@example.com",
            ),
            current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"},
        )
    )

    assert sent["denied"] == "pending@example.com"


def test_self_delete_protection_remains_intact(lifecycle_db):
    lifecycle_db.users.docs.append(
        {
            "id": "super-1",
            "email": "master@example.com",
            "role": "super_admin",
            "approval_status": "approved",
            "is_active": True,
        }
    )

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.master_admin_delete_user(
                "super-1",
                server.MasterAdminUserActionPayload(reason="bad idea", confirmation_text="master@example.com"),
                current_user={"id": "super-1", "email": "master@example.com", "role": "super_admin"},
            )
        )

    assert exc.value.status_code == 400
