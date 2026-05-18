import asyncio
import types

import pytest

import server
from app.services import auth_service
from scripts import reconcile_deleted_user_links as reconcile_script


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

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if self._matches(doc, query or {}))

    async def find_one(self, query=None, projection=None, *args, **kwargs):
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
        for index, doc in enumerate(list(self.docs)):
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

    async def delete_one(self, query):
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                self.docs.pop(index)
                return types.SimpleNamespace(deleted_count=1)
        return types.SimpleNamespace(deleted_count=0)

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
                    elif operator == "$nin":
                        if doc_value in expected:
                            return False
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$exists":
                        if (key in doc) is not bool(expected):
                            return False
                    elif operator == "$gte":
                        if not doc_value or doc_value < expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc_value != value:
                return False
        return True


@pytest.fixture
def hotfix_db(monkeypatch):
    db = types.SimpleNamespace(
        users=_Collection(),
        organizations=_Collection(),
        schools=_Collection(),
        teachers=_Collection(),
        videos=_Collection(),
        assessments=_Collection(),
        user_sessions=_Collection(),
        auth_event_log=_Collection(),
        master_admin_audit_events=_Collection(),
        notifications=_Collection(),
        teacher_face_profiles=_Collection(),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "ACCESS_APPROVAL_REQUIRED", True)
    monkeypatch.setattr(server, "DEMO_MODE", False)
    monkeypatch.setattr(server, "create_token", lambda subject, **kwargs: f"token-{subject}")
    monkeypatch.setattr(server, "_send_access_request_notification", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_request_received_confirmation", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda _user: True)
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda _user: True)
    monkeypatch.setattr(server, "_refresh_processing_incidents", lambda: asyncio.sleep(0, result=[]))
    return db


def _request():
    return types.SimpleNamespace(client=types.SimpleNamespace(host="127.0.0.1"), headers={}, cookies={})


def _super_user():
    return {"id": "super-1", "email": "master@example.com", "role": "super_admin", "tenant_role": "super_admin"}


def test_register_creates_pending_approval_and_master_admin_can_approve_login(monkeypatch, hotfix_db):
    result = asyncio.run(
        auth_service.register_user(
            server.UserCreate(
                email="Tester@Example.com",
                password="StrongPassword123",
                name="Tester One",
                role="school_admin",
                organization_type="school",
                organization_name="Sunrise Network",
                school_name="Sunrise Elementary",
            ),
            _request(),
        )
    )

    pending = asyncio.run(server.get_master_admin_users(approval_status="pending", current_user=_super_user()))
    approved = asyncio.run(
        server.master_admin_approve_user(
            result["user_id"],
            server.MasterAdminUserActionPayload(reason="Approved for internal test"),
            current_user=_super_user(),
        )
    )
    login = asyncio.run(server.login(server.UserLogin(email="tester@example.com", password="StrongPassword123", role="admin"), _request()))

    assert result["status"] == "pending"
    assert result["email"] == "tester@example.com"
    assert result["email_warning"] is True
    assert pending.total == 1
    assert pending.items[0].email == "tester@example.com"
    assert approved.approval_status == "approved"
    assert login.token.startswith("token-")


def test_duplicate_blocks_active_pending_but_allows_tombstoned_email(hotfix_db):
    hotfix_db.users.docs.append(
        {
            "id": "active-1",
            "email": "active@example.com",
            "name": "Active",
            "password": server.hash_password("StrongPassword123"),
            "role": "teacher",
            "approval_status": "approved",
            "is_active": True,
            "created_at": "2026-05-01T10:00:00+00:00",
        }
    )
    with pytest.raises(server.HTTPException):
        asyncio.run(server.request_access(server.UserCreate(email="active@example.com", password="StrongPassword123", name="Again"), _request()))

    hotfix_db.users.docs.append(
        {
            "id": "deleted-1",
            "email": "deleted@example.com",
            "name": "Deleted",
            "role": "teacher",
            "approval_status": "deleted",
            "account_deleted": True,
            "deleted_at": "2026-05-01T10:00:00+00:00",
        }
    )
    result = asyncio.run(server.request_access(server.UserCreate(email="Deleted@Example.com", password="StrongPassword123", name="Back"), _request()))

    assert result["status"] == "pending"
    assert hotfix_db.users.docs[-1]["email"] == "deleted@example.com"


def test_rejection_removes_pending_queue(hotfix_db):
    hotfix_db.users.docs.append(
        {
            "id": "pending-1",
            "email": "pending@example.com",
            "name": "Pending",
            "password": server.hash_password("StrongPassword123"),
            "role": "teacher",
            "approval_status": "pending",
            "is_active": False,
            "created_at": "2026-05-01T10:00:00+00:00",
        }
    )

    asyncio.run(
        server.master_admin_delete_user(
            "pending-1",
            server.MasterAdminUserActionPayload(reason="Rejected", confirmation_text="pending@example.com"),
            current_user=_super_user(),
        )
    )
    pending = asyncio.run(server.get_master_admin_users(approval_status="pending", current_user=_super_user()))

    assert pending.total == 0


def test_deleted_users_and_orphaned_orgs_hidden_but_demo_org_visible(hotfix_db):
    hotfix_db.users.docs.extend(
        [
            {
                "id": "deleted-admin",
                "email": "zack@example.com",
                "name": "Zack Isakow",
                "role": "admin",
                "approval_status": "deleted",
                "is_active": False,
                "account_deleted": True,
                "deleted_at": "2026-05-01T10:00:00+00:00",
                "organization_id": "org-stale",
                "created_at": "2026-05-01T10:00:00+00:00",
            },
            {
                "id": "active-admin",
                "email": "principal@example.com",
                "name": "Principal",
                "role": "admin",
                "tenant_role": "school_admin",
                "approval_status": "approved",
                "is_active": True,
                "organization_id": "org-active",
                "created_at": "2026-05-01T10:00:00+00:00",
            },
        ]
    )
    hotfix_db.organizations.docs.extend(
        [
            {"id": "org-stale", "name": "Zack Isakow", "organization_type": "school", "status": "active"},
            {"id": "org-active", "name": "Active School", "organization_type": "school", "status": "active"},
            {"id": "org-demo", "name": "Westbrook Elementary", "organization_type": "school", "status": "active", "demo_data": True, "demo_persona": "k12"},
        ]
    )
    hotfix_db.schools.docs.extend(
        [
            {"id": "school-stale-1", "organization_id": "org-stale", "name": "Old School A"},
            {"id": "school-stale-2", "organization_id": "org-stale", "name": "Old School B"},
        ]
    )

    users = asyncio.run(server.get_master_admin_users(current_user=_super_user()))
    orgs = asyncio.run(server.get_master_admin_organizations(current_user=_super_user()))

    assert "zack@example.com" not in [item.email for item in users.items]
    assert "Zack Isakow" not in [item.name for item in orgs.items]
    assert "Westbrook Elementary" in [item.name for item in orgs.items]
    assert orgs.summary["demo"] == 1
    assert orgs.summary["school"] == 1


def test_internal_readiness_demo_mode_disabled_is_neutral(monkeypatch, hotfix_db):
    hotfix_db.organizations.docs.append({"id": "org-demo", "demo_data": True, "demo_persona": "k12"})
    monkeypatch.setattr(server, "_build_dependency_health_snapshot", lambda: asyncio.sleep(0, result=[]))
    monkeypatch.setattr(server, "_read_ai_quality_history", lambda: [])

    result = asyncio.run(server.get_admin_internal_readiness(current_user=_super_user()))

    assert result["environment"]["demo_mode_status"] == "disabled"
    assert result["environment"]["demo_reset_controls_status"] == "disabled"
    assert result["demo_data"]["k12_seeded_status"] == "available"
    assert result["demo_data"]["training_seeded_status"] == "not_seeded"
    assert result["quality"]["latest_quality_gate_status"] == "unknown"


def test_signup_health_counts_are_sanitized(hotfix_db):
    hotfix_db.users.docs.append({"id": "deleted-1", "email": "deleted@example.com", "approval_status": "deleted", "account_deleted": True})
    hotfix_db.organizations.docs.append({"id": "org-demo", "demo_data": True, "demo_persona": "k12"})

    result = asyncio.run(server.get_admin_signup_health(current_user=_super_user()))

    assert result["deleted_tombstones_count"] == 1
    assert result["demo_orgs_count"] == 1
    assert "deleted@example.com" not in str(result)


def test_reconciliation_script_dry_run_and_apply_skip_demo_by_default(hotfix_db):
    hotfix_db.users.docs.extend(
        [
            {"id": "deleted-1", "email": "deleted@example.com", "approval_status": "deleted", "account_deleted": True},
            {"id": "teacher-user", "email": "teacher@example.com", "approval_status": "approved", "manager_email": "deleted@example.com"},
        ]
    )
    hotfix_db.teachers.docs.extend(
        [
            {"id": "teacher-1", "linked_admin_user_id": "deleted-1"},
            {"id": "teacher-demo", "linked_admin_user_id": "deleted-1", "demo_data": True},
        ]
    )
    hotfix_db.schools.docs.append({"id": "school-1", "user_id": "deleted-1"})
    hotfix_db.organizations.docs.append({"id": "org-1", "name": "Orphan Org", "status": "active"})

    analysis = asyncio.run(reconcile_script.analyze(hotfix_db))
    counts = asyncio.run(reconcile_script.apply_reconciliation(hotfix_db, analysis, actor="pytest"))

    assert len(analysis["stale_admin_links"]) == 1
    assert len(analysis["stale_teacher_links"]) == 1
    assert counts["stale_admin_links"] == 1
    assert counts["stale_teacher_links"] == 1
    assert hotfix_db.teachers.docs[0]["linked_admin_user_id"] is None
    assert hotfix_db.teachers.docs[1]["linked_admin_user_id"] == "deleted-1"
