import pytest
from fastapi import HTTPException

import server


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = docs or []

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                if not projection:
                    return dict(doc)
                return {
                    key: value
                    for key, value in doc.items()
                    if key in projection and projection[key]
                }
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, update):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))
                return


class _FakeDb:
    def __init__(self):
        self.organizations = _FakeCollection()
        self.schools = _FakeCollection()
        self.users = _FakeCollection()
        self.teachers = _FakeCollection()


def test_normalize_requested_role_maps_school_and_training_roles():
    assert server._normalize_requested_role("teacher") == "teacher"
    assert server._normalize_requested_role("admin") == "school_admin"
    assert server._normalize_requested_role("principal") == "school_admin"
    assert server._normalize_requested_role("school_admin") == "school_admin"
    assert server._normalize_requested_role("training_admin") == "training_admin"
    assert server._normalize_requested_role("super_admin") == "super_admin"


def test_get_user_tenant_role_prefers_explicit_tenant_role(monkeypatch):
    monkeypatch.setattr(server, "SUPER_ADMIN_EMAILS", {"root@example.com"})
    monkeypatch.setattr(server, "ADMIN_EMAILS", {"principal@example.com"})

    assert server._get_user_tenant_role({"email": "root@example.com"}) == "super_admin"
    assert server._get_user_tenant_role({"email": "principal@example.com"}) == "school_admin"
    assert (
        server._get_user_tenant_role({"email": "coach@example.com", "role": "training_admin"})
        == "training_admin"
    )
    assert (
        server._get_user_tenant_role({"email": "teacher@example.com", "tenant_role": "teacher"})
        == "teacher"
    )


def test_normalize_access_request_requires_org_and_school_for_teacher():
    payload = server.UserCreate(
        email="teacher@example.com",
        password="secret",
        name="Teacher",
        role="teacher",
        organization_name="Sunrise Network",
        school_name="Sunrise Elementary",
        requested_manager_email="principal@example.com",
    )

    normalized = server._normalize_access_request_tenancy_fields(payload, "teacher")

    assert normalized == {
        "organization_type": "school",
        "requested_organization_name": "Sunrise Network",
        "requested_school_name": "Sunrise Elementary",
        "requested_manager_email": "principal@example.com",
    }


def test_normalize_access_request_requires_school_for_school_admin():
    payload = server.UserCreate(
        email="principal@example.com",
        password="secret",
        name="Principal",
        role="school_admin",
        organization_name="Sunrise Network",
    )

    with pytest.raises(HTTPException) as exc:
        server._normalize_access_request_tenancy_fields(payload, "school_admin")

    assert exc.value.status_code == 400
    assert exc.value.detail == "School name is required"


def test_normalize_access_request_for_training_admin_uses_training_org_type():
    payload = server.UserCreate(
        email="coach@example.com",
        password="secret",
        name="Coach",
        role="training_admin",
        organization_name="Residency Cohort 2026",
    )

    normalized = server._normalize_access_request_tenancy_fields(payload, "training_admin")

    assert normalized["organization_type"] == "training"
    assert normalized["requested_organization_name"] == "Residency Cohort 2026"
    assert normalized["requested_school_name"] is None


@pytest.mark.asyncio
async def test_build_user_tenancy_migration_preview_marks_teacher_incomplete(monkeypatch):
    fake_db = _FakeDb()
    monkeypatch.setattr(server, "db", fake_db)

    preview = await server._build_user_tenancy_migration_preview(
        {
            "id": "u1",
            "email": "teacher@example.com",
            "role": "teacher",
            "approval_status": "approved",
        }
    )

    assert preview["tenant_role"] == "teacher"
    assert preview["is_complete"] is False
    assert preview["missing_required_fields"] == ["organization_name", "school_name"]


@pytest.mark.asyncio
async def test_build_user_tenancy_migration_preview_resolves_linked_school(monkeypatch):
    fake_db = _FakeDb()
    fake_db.teachers.docs.append(
        {
            "id": "teacher-1",
            "email": "teacher@example.com",
            "school_id": "school-1",
        }
    )
    fake_db.schools.docs.append(
        {
            "id": "school-1",
            "name": "Sunrise Elementary",
            "organization_id": "org-1",
        }
    )
    fake_db.organizations.docs.append(
        {
            "id": "org-1",
            "name": "Sunrise Network",
            "organization_type": "school",
            "status": "active",
        }
    )
    monkeypatch.setattr(server, "db", fake_db)

    preview = await server._build_user_tenancy_migration_preview(
        {
            "id": "u1",
            "email": "teacher@example.com",
            "role": "teacher",
            "teacher_id": "teacher-1",
            "approval_status": "approved",
        }
    )

    assert preview["organization_name"] == "Sunrise Network"
    assert preview["school_name"] == "Sunrise Elementary"
    assert preview["is_complete"] is True
    assert preview["missing_required_fields"] == []
