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

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query))

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


def test_approve_user_access_blocks_when_seat_limit_is_reached(monkeypatch):
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
                    "is_active": True,
                    "organization_id": "org-1",
                    "organization_name": "Sunrise Network",
                },
                {
                    "id": "teacher-1",
                    "email": "teacher1@example.com",
                    "name": "Teacher One",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "organization_id": "org-1",
                    "organization_name": "Sunrise Network",
                    "school_id": "school-1",
                    "school_name": "Sunrise Elementary",
                },
                {
                    "id": "teacher-2",
                    "email": "teacher2@example.com",
                    "name": "Teacher Two",
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
                    "seat_limit": 2,
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
                }
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_log_auth_event", lambda *args, **kwargs: asyncio.sleep(0))
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda *_args, **_kwargs: True)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server._approve_user_access(
                fake_db.users.docs[2],
                actor_label="rmc91180@gmail.com",
                reason="Seat-limited approval test",
            )
        )

    assert exc.value.status_code == 409
    assert "Seat limit reached" in exc.value.detail


def test_reactivate_user_access_blocks_when_seat_limit_is_reached(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "teacher-1",
                    "email": "teacher1@example.com",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "organization_id": "org-1",
                },
                {
                    "id": "teacher-2",
                    "email": "teacher2@example.com",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "revoked",
                    "is_active": False,
                    "organization_id": "org-1",
                    "approved_at": "2026-04-13T08:00:00+00:00",
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
                    "seat_limit": 1,
                }
            ]
        ),
        schools=_Collection(),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_log_auth_event", lambda *args, **kwargs: asyncio.sleep(0))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server._reactivate_user_access(
                fake_db.users.docs[1],
                actor_label="rmc91180@gmail.com",
                reason="Seat-limited reactivation test",
            )
        )

    assert exc.value.status_code == 409
    assert "Seat limit reached" in exc.value.detail


def test_master_admin_organizations_and_seat_policy_update(monkeypatch):
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
                    "is_active": True,
                    "organization_id": "org-1",
                },
                {
                    "id": "teacher-1",
                    "email": "teacher1@example.com",
                    "name": "Teacher One",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "organization_id": "org-1",
                },
                {
                    "id": "teacher-2",
                    "email": "teacher2@example.com",
                    "name": "Teacher Two",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "approval_status": "pending",
                    "is_active": False,
                    "organization_id": "org-1",
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
                    "seat_limit": 5,
                    "created_at": "2026-04-13T08:00:00+00:00",
                    "created_by": "rmc91180@gmail.com",
                }
            ]
        ),
        schools=_Collection(
            [
                {"id": "school-1", "organization_id": "org-1", "name": "Sunrise Elementary"},
                {"id": "school-2", "organization_id": "org-1", "name": "Sunrise Middle"},
            ]
        ),
        teachers=_Collection(
            [
                {"id": "teacher-record-1", "organization_id": "org-1"},
                {"id": "teacher-record-2", "organization_id": "org-1"},
            ]
        ),
        videos=_Collection(
            [
                {"id": "video-1", "organization_id": "org-1", "created_at": "2026-04-13T09:00:00+00:00"},
            ]
        ),
        assessments=_Collection(
            [
                {"id": "assessment-1", "organization_id": "org-1", "created_at": "2026-04-13T09:15:00+00:00"},
            ]
        ),
        teacher_face_profiles=_Collection(
            [
                {"id": "profile-1", "teacher_id": "teacher-record-1"},
            ]
        ),
        master_admin_audit_events=_Collection(),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_refresh_processing_incidents", lambda: asyncio.sleep(0, result=[]))

    listing = asyncio.run(
        server.get_master_admin_organizations(
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"}
        )
    )

    assert listing.total == 1
    assert listing.items[0].active_user_count == 2
    assert listing.items[0].pending_user_count == 1
    assert listing.items[0].seats_remaining == 3
    assert listing.items[0].capacity_state == "available"

    updated = asyncio.run(
        server.update_master_admin_organization_seat_policy(
            "org-1",
            server.MasterAdminOrganizationSeatPolicyPayload(seat_limit=2, reason="Pilot contract"),
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )

    assert updated.seat_limit == 2
    assert updated.seats_remaining == 0
    assert updated.capacity_state == "at_limit"
    assert fake_db.organizations.docs[0]["seat_limit"] == 2
    assert fake_db.master_admin_audit_events.docs[0]["action"] == "update_organization_seat_policy"
