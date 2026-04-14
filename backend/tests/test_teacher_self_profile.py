import asyncio
import re
import types

from starlette.requests import Request

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

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
        return _Cursor(
            [self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})]
        )

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            payload = dict(query)
            payload.update(update.get("$set", {}))
            self.docs.append(payload)
            return types.SimpleNamespace(modified_count=1, matched_count=1)
        return types.SimpleNamespace(modified_count=0, matched_count=0)

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
            if isinstance(value, dict):
                doc_value = doc.get(key)
                for operator, expected in value.items():
                    if operator == "$regex":
                        candidate = str(doc_value or "")
                        pattern = str(expected)
                        flags = re.IGNORECASE if value.get("$options", "").lower().find("i") >= 0 else 0
                        if not re.fullmatch(pattern, candidate, flags):
                            return False
                    elif operator == "$options":
                        continue
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _request():
    return Request({"type": "http", "headers": []})


def test_upload_storage_health_uses_bucket_probe(monkeypatch):
    class _HealthyClient:
        def head_bucket(self, Bucket):
            assert Bucket == "cognivio"

    monkeypatch.setattr(server, "S3_BUCKET", "cognivio")
    monkeypatch.setattr(server, "_get_s3_client", lambda: _HealthyClient())

    assert server._upload_storage_is_healthy() is True


def test_teacher_can_create_self_profile_and_link_account(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "teacher-user-1",
                    "email": "teacher@example.com",
                    "name": "Teacher Example",
                    "tenant_role": "teacher",
                    "organization_id": "org-1",
                    "school_id": "school-1",
                    "manager_user_id": "admin-1",
                },
                {
                    "id": "admin-1",
                    "email": "principal@example.com",
                    "name": "Principal Example",
                    "tenant_role": "school_admin",
                    "organization_id": "org-1",
                    "school_id": "school-1",
                },
            ]
        ),
        teachers=_Collection([]),
        schools=_Collection([{"id": "school-1", "name": "Sunrise Elementary", "organization_id": "org-1"}]),
        organizations=_Collection([{"id": "org-1", "name": "Sunrise Network", "organization_type": "school"}]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(
        server.create_teacher_self_profile(
            server.TeacherSelfProfileCreate(
                subject="Mathematics",
                grade_level="5th grade",
                department="STEM",
            ),
            request=_request(),
            current_user={
                "id": "teacher-user-1",
                "email": "teacher@example.com",
                "name": "Teacher Example",
                "tenant_role": "teacher",
                "organization_id": "org-1",
                "school_id": "school-1",
                "manager_user_id": "admin-1",
            },
        )
    )

    assert result.email == "teacher@example.com"
    assert result.subject == "Mathematics"
    assert fake_db.users.docs[0]["teacher_id"] == result.id
    assert fake_db.teachers.docs[0]["created_by"] == "admin-1"


def test_teacher_self_profile_links_existing_teacher_by_email(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "teacher-user-1",
                    "email": "teacher@example.com",
                    "name": "Teacher Example",
                    "tenant_role": "teacher",
                    "organization_id": "org-1",
                    "school_id": "school-1",
                    "manager_user_id": "admin-1",
                },
                {
                    "id": "admin-1",
                    "email": "principal@example.com",
                    "name": "Principal Example",
                    "tenant_role": "school_admin",
                    "organization_id": "org-1",
                    "school_id": "school-1",
                },
            ]
        ),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "name": "Teacher Example",
                    "email": "teacher@example.com",
                    "subject": "Science",
                    "grade_level": "6th grade",
                    "department": "STEM",
                    "school_id": "school-1",
                    "organization_id": "org-1",
                    "created_by": "admin-1",
                    "created_at": "2026-04-14T00:00:00+00:00",
                }
            ]
        ),
        schools=_Collection([{"id": "school-1", "name": "Sunrise Elementary", "organization_id": "org-1"}]),
        organizations=_Collection([{"id": "org-1", "name": "Sunrise Network", "organization_type": "school"}]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(
        server.create_teacher_self_profile(
            server.TeacherSelfProfileCreate(
                subject="Mathematics",
                grade_level="5th grade",
            ),
            request=_request(),
            current_user={
                "id": "teacher-user-1",
                "email": "teacher@example.com",
                "name": "Teacher Example",
                "tenant_role": "teacher",
                "organization_id": "org-1",
                "school_id": "school-1",
                "manager_user_id": "admin-1",
            },
        )
    )

    assert result.id == "teacher-1"
    assert len(fake_db.teachers.docs) == 1
    assert fake_db.users.docs[0]["teacher_id"] == "teacher-1"
