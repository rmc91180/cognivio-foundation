import asyncio
import types

import pytest
from fastapi import HTTPException

import server


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

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

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
                    if operator == "$in":
                        if doc_value not in expected:
                            return False
                    elif operator == "$regex":
                        candidate = str(doc_value or "")
                        pattern = str(expected).strip("^$")
                        if candidate.lower() != pattern.lower():
                            return False
                    elif operator == "$options":
                        continue
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _fake_db():
    return types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "school-admin-1",
                    "email": "principal@example.com",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-1",
                },
                {
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "tenant_role": "teacher",
                    "organization_id": "org-school-1",
                },
                {
                    "id": "teacher-user-2",
                    "email": "teacher2@example.com",
                    "tenant_role": "teacher",
                    "organization_id": "org-school-2",
                },
                {
                    "id": "training-admin-1",
                    "email": "coach@example.com",
                    "tenant_role": "training_admin",
                    "organization_id": "org-training-1",
                },
                {
                    "id": "training-teacher-1",
                    "email": "candidate1@example.com",
                    "tenant_role": "teacher",
                    "organization_id": "org-training-1",
                },
                {
                    "id": "training-teacher-2",
                    "email": "candidate2@example.com",
                    "tenant_role": "teacher",
                    "organization_id": "org-training-2",
                },
            ]
        ),
        schools=_Collection(
            [
                {"id": "school-1", "organization_id": "org-school-1", "user_id": "school-admin-1", "name": "Sunrise"},
                {"id": "school-2", "organization_id": "org-school-2", "user_id": "other-admin", "name": "Riverside"},
            ]
        ),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "email": "teacher1@example.com",
                    "school_id": "school-1",
                    "organization_id": "org-school-1",
                    "created_by": "school-admin-1",
                },
                {
                    "id": "teacher-2",
                    "email": "teacher2@example.com",
                    "school_id": "school-2",
                    "organization_id": "org-school-2",
                    "created_by": "other-admin",
                },
                {
                    "id": "teacher-3",
                    "email": "candidate1@example.com",
                    "school_id": None,
                    "organization_id": "org-training-1",
                    "created_by": "training-admin-1",
                },
                {
                    "id": "teacher-4",
                    "email": "candidate2@example.com",
                    "school_id": None,
                    "organization_id": "org-training-2",
                    "created_by": "other-training-admin",
                },
            ]
        ),
    )


def test_require_school_admin_user_enforces_tenant_role():
    server._require_school_admin_user({"id": "u1", "tenant_role": "school_admin"})
    with pytest.raises(HTTPException):
        server._require_school_admin_user({"id": "u2", "tenant_role": "training_admin"})


def test_list_teacher_ids_for_school_admin_is_org_scoped(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    teacher_ids = asyncio.run(
        server._list_teacher_ids_for_user(
            {
                "id": "school-admin-1",
                "email": "principal@example.com",
                "tenant_role": "school_admin",
                "organization_id": "org-school-1",
            }
        )
    )

    assert teacher_ids == ["teacher-1"]


def test_get_teacher_or_404_rejects_cross_tenant_access(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server._get_teacher_or_404(
                "teacher-2",
                {
                    "id": "school-admin-1",
                    "email": "principal@example.com",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-1",
                },
            )
        )

    assert exc.value.status_code == 403


def test_list_teacher_ids_for_training_admin_is_org_scoped(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    teacher_ids = asyncio.run(
        server._list_teacher_ids_for_user(
            {
                "id": "training-admin-1",
                "email": "coach@example.com",
                "tenant_role": "training_admin",
                "organization_id": "org-training-1",
            }
        )
    )

    assert teacher_ids == ["teacher-3"]


def test_get_teacher_or_404_rejects_cross_training_tenant_access(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server._get_teacher_or_404(
                "teacher-4",
                {
                    "id": "training-admin-1",
                    "email": "coach@example.com",
                    "tenant_role": "training_admin",
                    "organization_id": "org-training-1",
                },
            )
        )

    assert exc.value.status_code == 403
