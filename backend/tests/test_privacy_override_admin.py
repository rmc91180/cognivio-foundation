"""PR C9.5 PART 5 — privacy (face-blurring) override admin controls (contract E).

Locks the one sanctioned path to a ``face_blurring_required=False`` effective
policy: an admin override that is audited (non-empty reason + actor + timestamp +
scope + resulting effective policy), scoped to video/teacher/school, single-active
per target, and revocable back to the fail-closed default. The dangerous failure
this guards is a *silent* blur-disable — so an empty reason must persist nothing,
and revocation must restore destructive blur.
"""

from __future__ import annotations

import asyncio
import types

import pytest
from fastapi import HTTPException

import server
from app.services.privacy_policy import build_privacy_override_record


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, length=None):
        return list(self._docs[:length] if length else self._docs)


class _FakeCollection:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _matches(doc, query):
        for key, value in (query or {}).items():
            if key == "$or":
                if not any(_FakeCollection._matches(doc, clause) for clause in value):
                    return False
            elif doc.get(key) != value:
                return False
        return True

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                clone = dict(doc)
                clone.pop("_id", None)
                return clone
        return None

    def find(self, query, projection=None):
        matches = []
        for doc in self.docs:
            if self._matches(doc, query or {}):
                clone = dict(doc)
                clone.pop("_id", None)
                matches.append(clone)
        return _FakeCursor(matches)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id="x")

    async def update_one(self, query, update):
        set_fields = (update or {}).get("$set", {})
        for doc in self.docs:
            if self._matches(doc, query or {}):
                doc.update(set_fields)
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        set_fields = (update or {}).get("$set", {})
        count = 0
        for doc in self.docs:
            if self._matches(doc, query or {}):
                doc.update(set_fields)
                count += 1
        return types.SimpleNamespace(matched_count=count, modified_count=count)


def _fake_db(overrides=None, teachers=None, schools=None):
    return types.SimpleNamespace(
        privacy_policy_overrides=_FakeCollection(overrides or []),
        teachers=_FakeCollection(teachers or []),
        schools=_FakeCollection(schools or []),
    )


def _admin():
    return {"id": "admin-1", "role": "admin"}


def _patch_common(monkeypatch, db):
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "_get_user_role", lambda user: user.get("role", "teacher"))
    monkeypatch.setattr(server, "_get_user_tenant_role", lambda user: "school_admin")

    async def fake_teacher(teacher_id, current_user):
        return {"id": teacher_id, "organization_id": "org-1"}

    async def fake_admin_video(video_id, current_user):
        return {"id": video_id, "teacher_id": "teacher-1"}

    audit = []

    async def fake_audit(event, target_type, target_id, **kwargs):
        audit.append(
            {"event": event, "target_type": target_type, "target_id": target_id, **kwargs}
        )

    monkeypatch.setattr(server, "_get_teacher_or_404", fake_teacher)
    monkeypatch.setattr(server, "_get_admin_owned_video_or_404", fake_admin_video)
    monkeypatch.setattr(server, "_log_privacy_audit_event", fake_audit)
    return audit


def _payload(**overrides):
    base = {
        "scope": "teacher",
        "scope_id": "teacher-1",
        "face_blurring_required": False,
        "reason": "Signed consent on file; public showcase lesson",
    }
    base.update(overrides)
    return server.PrivacyOverrideCreateRequest(**base)


def test_create_override_persists_and_audits(monkeypatch):
    db = _fake_db()
    audit = _patch_common(monkeypatch, db)

    result = asyncio.run(server.create_privacy_override(_payload(), _admin()))

    assert result.scope == "teacher"
    assert result.scope_id == "teacher-1"
    assert result.face_blurring_required is False
    assert result.is_active is True
    assert result.created_by == "admin-1"
    # Persisted exactly once.
    assert db.privacy_policy_overrides.docs[0]["scope_id"] == "teacher-1"
    # Audited with reason + the resulting effective policy (contract E).
    event = audit[-1]
    assert event["event"] == "privacy_override_set"
    assert event["details"]["reason"]
    assert event["details"]["effective_policy"]["face_blurring_required"] is False


def test_create_override_requires_audited_reason(monkeypatch):
    db = _fake_db()
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.create_privacy_override(_payload(reason="   "), _admin()))
    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "invalid_privacy_override"
    # Critical: a reasonless disable persists NOTHING (no silent blur-off).
    assert db.privacy_policy_overrides.docs == []


def test_create_override_rejects_unknown_scope(monkeypatch):
    db = _fake_db()
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.create_privacy_override(
                _payload(scope="district", scope_id="d-1"), _admin()
            )
        )
    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "invalid_override_scope"
    assert db.privacy_policy_overrides.docs == []


def test_create_override_rejects_non_admin(monkeypatch):
    db = _fake_db()
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.create_privacy_override(_payload(), {"id": "t-1", "role": "teacher"})
        )
    assert exc.value.status_code == 403
    assert db.privacy_policy_overrides.docs == []


def test_create_override_supersedes_prior_active(monkeypatch):
    prior = build_privacy_override_record(
        scope="teacher",
        scope_id="teacher-1",
        face_blurring_required=False,
        reason="old override",
        actor_id="admin-0",
    )
    db = _fake_db([prior])
    _patch_common(monkeypatch, db)

    asyncio.run(
        server.create_privacy_override(
            _payload(face_blurring_required=True, reason="re-enable blur for safety"),
            _admin(),
        )
    )

    docs = db.privacy_policy_overrides.docs
    assert len(docs) == 2
    old = next(d for d in docs if d["id"] == prior["id"])
    assert old["is_active"] is False
    assert old["revoked_reason"] == "superseded_by_new_override"
    active = [d for d in docs if d.get("is_active")]
    assert len(active) == 1
    assert active[0]["face_blurring_required"] is True


def test_created_override_drives_effective_policy(monkeypatch):
    db = _fake_db(teachers=[{"id": "teacher-1", "school_id": "school-9"}])
    _patch_common(monkeypatch, db)

    asyncio.run(server.create_privacy_override(_payload(), _admin()))

    policy = asyncio.run(
        server._resolve_effective_privacy_policy({"id": "v1", "teacher_id": "teacher-1"})
    )
    assert policy["face_blurring_required"] is False
    assert policy["source"] == "teacher_override"
    assert policy["scope"] == "teacher"


def test_default_policy_blur_required_without_override(monkeypatch):
    db = _fake_db(teachers=[{"id": "teacher-1", "school_id": "school-9"}])
    _patch_common(monkeypatch, db)

    policy = asyncio.run(
        server._resolve_effective_privacy_policy({"id": "v1", "teacher_id": "teacher-1"})
    )
    # Fail-closed: no override means destructive blur is required.
    assert policy["face_blurring_required"] is True
    assert policy["source"] == "default"


def test_list_overrides_scoped(monkeypatch):
    rec = build_privacy_override_record(
        scope="teacher",
        scope_id="teacher-1",
        face_blurring_required=False,
        reason="x",
        actor_id="admin-1",
    )
    db = _fake_db([rec])
    _patch_common(monkeypatch, db)

    result = asyncio.run(
        server.list_privacy_overrides(
            scope="teacher", scope_id="teacher-1", current_user=_admin()
        )
    )
    assert len(result.overrides) == 1
    assert result.overrides[0].id == rec["id"]


def test_list_requires_scope_for_non_super_admin(monkeypatch):
    db = _fake_db()
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.list_privacy_overrides(current_user=_admin()))
    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "scope_filter_required"


def test_revoke_override_restores_blur_default(monkeypatch):
    rec = build_privacy_override_record(
        scope="teacher",
        scope_id="teacher-1",
        face_blurring_required=False,
        reason="x",
        actor_id="admin-1",
    )
    db = _fake_db([rec])
    audit = _patch_common(monkeypatch, db)

    result = asyncio.run(
        server.revoke_privacy_override(
            rec["id"], reason="consent withdrawn", current_user=_admin()
        )
    )
    assert result.is_active is False
    assert result.revoked_reason == "consent withdrawn"
    assert db.privacy_policy_overrides.docs[0]["is_active"] is False
    event = audit[-1]
    assert event["event"] == "privacy_override_revoked"
    # Revocation re-arms the fail-closed default (blur required).
    assert event["details"]["restored_policy"]["face_blurring_required"] is True


def test_revoke_missing_override_404(monkeypatch):
    db = _fake_db()
    _patch_common(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.revoke_privacy_override("nope", current_user=_admin()))
    assert exc.value.status_code == 404
