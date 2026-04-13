import asyncio
import types

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

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

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
                    if operator == "$in":
                        if doc_value not in expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def test_approve_user_access_links_teacher_into_existing_school(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "admin-1",
                    "email": "principal@example.com",
                    "name": "Principal One",
                    "role": "admin",
                    "tenant_role": "school_admin",
                    "approval_status": "approved",
                    "organization_id": "org-1",
                    "organization_name": "Sunrise Network",
                },
                {
                    "id": "teacher-user-1",
                    "email": "teacher@example.com",
                    "name": "Teacher One",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "pending",
                    "requested_organization_name": "Sunrise Network",
                    "requested_school_name": "Sunrise Elementary",
                },
            ]
        ),
        organizations=_Collection(
            [
                {
                    "id": "org-1",
                    "name": "Sunrise Network",
                    "organization_type": "school",
                    "status": "active",
                }
            ]
        ),
        schools=_Collection(
            [
                {
                    "id": "school-1",
                    "name": "Sunrise Elementary",
                    "organization_id": "org-1",
                    "user_id": "admin-1",
                    "district_name": "Sunrise Network",
                }
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_log_auth_event", lambda *args, **kwargs: asyncio.sleep(0))
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda *_args, **_kwargs: True)

    updated = asyncio.run(
        server._approve_user_access(
            fake_db.users.docs[1],
            actor_label="rmc91180@gmail.com",
            reason="Approved into Sunrise tenant",
        )
    )

    assert updated["approval_status"] == "approved"
    assert updated["organization_id"] == "org-1"
    assert updated["school_id"] == "school-1"
    assert updated["manager_user_id"] == "admin-1"
    assert updated["manager_email"] == "principal@example.com"


def test_approve_user_access_creates_training_organization(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "training-admin-1",
                    "email": "coach@example.com",
                    "name": "Coach One",
                    "role": "admin",
                    "tenant_role": "training_admin",
                    "approval_status": "pending",
                    "requested_organization_name": "Residency Cohort 2026",
                    "organization_type": "training",
                }
            ]
        ),
        organizations=_Collection(),
        schools=_Collection(),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_log_auth_event", lambda *args, **kwargs: asyncio.sleep(0))
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda *_args, **_kwargs: True)

    updated = asyncio.run(
        server._approve_user_access(
            fake_db.users.docs[0],
            actor_label="rmc91180@gmail.com",
            reason="Approved into training tenant",
        )
    )

    assert updated["approval_status"] == "approved"
    assert updated["tenant_role"] == "training_admin"
    assert updated["organization_name"] == "Residency Cohort 2026"
    assert updated["school_id"] is None
    assert len(fake_db.organizations.docs) == 1
    assert fake_db.organizations.docs[0]["organization_type"] == "training"


def test_access_request_notification_text_includes_tenant_context():
    text = server._build_access_request_notification_text(
        {
            "name": "Teacher One",
            "email": "teacher@example.com",
            "tenant_role": "teacher",
            "requested_organization_name": "Sunrise Network",
            "requested_school_name": "Sunrise Elementary",
            "requested_manager_email": "principal@example.com",
            "approval_requested_at": "2026-04-13T08:00:00+00:00",
        }
    )

    assert "Requested role: Teacher" in text
    assert "Organization: Sunrise Network" in text
    assert "School: Sunrise Elementary" in text
    assert "Requested school administrator: principal@example.com" in text
