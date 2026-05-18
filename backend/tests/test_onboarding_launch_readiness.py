import types
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=1):
        self.docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query, projection=None, **kwargs):
        docs = [doc for doc in self.docs if self._matches(doc, query)]
        sort = kwargs.get("sort")
        if sort:
            for field, direction in reversed(sort):
                docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
        return self._project(docs[0], projection) if docs else None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def count_documents(self, query):
        return len([doc for doc in self.docs if self._matches(doc, query or {})])

    async def update_one(self, query, update):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    @staticmethod
    def _project(doc, projection):
        if not projection:
            return dict(doc)
        if any(value == 1 for key, value in projection.items() if key != "_id"):
            return {key: doc.get(key) for key, value in projection.items() if value == 1 and key in doc}
        payload = dict(doc)
        for key, include in projection.items():
            if include == 0:
                payload.pop(key, None)
        return payload

    def _matches(self, doc, query):
        if not query:
            return True
        for key, value in query.items():
            if key == "$or":
                if not any(self._matches(doc, clause) for clause in value):
                    return False
                continue
            if isinstance(value, dict):
                for operator, expected in value.items():
                    if operator == "$in":
                        if doc.get(key) not in expected:
                            return False
                    elif operator == "$nin":
                        if doc.get(key) in expected:
                            return False
                    elif operator == "$ne":
                        if doc.get(key) == expected:
                            return False
                    elif operator == "$exists":
                        exists = key in doc
                        if bool(expected) != exists:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _user(role="school_admin", org_id="org-1"):
    return {
        "id": "admin-1",
        "email": "admin@example.com",
        "role": "admin" if role != "teacher" else "teacher",
        "tenant_role": role,
        "organization_id": org_id,
        "organization_name": "Demo School" if role != "training_admin" else "Demo Training",
    }


def _db(*, teachers=None, sessions=None, videos=None, assessments=None, tasks=None, users=None):
    return types.SimpleNamespace(
        organizations=_Collection([{"id": "org-1", "name": "Demo School", "organization_type": "school"}]),
        users=_Collection(users or []),
        teachers=_Collection(teachers or []),
        schools=_Collection([]),
        framework_selections=_Collection([]),
        recording_policies=_Collection([]),
        observation_sessions=_Collection(sessions or []),
        observations=_Collection([]),
        videos=_Collection(videos or []),
        assessments=_Collection(assessments or []),
        coaching_tasks=_Collection(tasks or []),
        recognition_badges=_Collection([]),
    )


@pytest.mark.asyncio
async def test_onboarding_empty_school_starts_with_add_teacher(monkeypatch):
    monkeypatch.setattr(server, "db", _db())

    result = await server.get_onboarding_status(current_user=_user())

    assert result["progress_pct"] == 0
    assert result["next_step"]["id"] == "add_teachers"
    assert result["counts"]["teachers"] == 0


@pytest.mark.asyncio
async def test_onboarding_with_teacher_points_to_observation(monkeypatch):
    monkeypatch.setattr(server, "db", _db(teachers=[{"id": "t1", "name": "Teacher One", "created_by": "admin-1", "organization_id": "org-1"}]))

    result = await server.get_onboarding_status(current_user=_user())

    assert result["next_step"]["id"] == "plan_observation"
    assert result["counts"]["teachers"] == 1


@pytest.mark.asyncio
async def test_onboarding_observation_without_recording_points_to_upload(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        _db(
            teachers=[{"id": "t1", "name": "Teacher One", "created_by": "admin-1", "organization_id": "org-1"}],
            sessions=[{"id": "s1", "teacher_id": "t1"}],
        ),
    )

    result = await server.get_onboarding_status(current_user=_user())

    assert result["next_step"]["id"] == "upload_recording"


@pytest.mark.asyncio
async def test_onboarding_reviewed_workspace_is_complete(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    monkeypatch.setattr(
        server,
        "db",
        _db(
            teachers=[{"id": "t1", "name": "Teacher One", "created_by": "admin-1", "organization_id": "org-1"}],
            sessions=[{"id": "s1", "teacher_id": "t1"}],
            videos=[{"id": "v1", "teacher_id": "t1", "workspace_id": "org-1"}],
            assessments=[{"id": "a1", "teacher_id": "t1", "workspace_id": "org-1", "analyzed_at": now}],
        ),
    )

    result = await server.get_onboarding_status(current_user=_user())

    assert result["completed"] is True
    assert result["next_step"]["id"] == "dashboard"


@pytest.mark.asyncio
async def test_onboarding_training_uses_trainee_copy(monkeypatch):
    monkeypatch.setattr(server, "db", _db(teachers=[{"id": "t1", "name": "Trainee One", "created_by": "admin-1", "organization_id": "org-1"}]))

    result = await server.get_onboarding_status(current_user=_user(role="training_admin"))

    assert result["workspace_mode"] == "training"
    assert result["counts"]["trainees"] == 1
    assert "trainee" in result["steps"][1]["title"].lower()


@pytest.mark.asyncio
async def test_teacher_role_cannot_access_admin_onboarding(monkeypatch):
    monkeypatch.setattr(server, "db", _db())

    with pytest.raises(HTTPException) as exc:
        await server.get_onboarding_status(current_user=_user(role="teacher"))

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_internal_readiness_requires_master_admin(monkeypatch):
    monkeypatch.setattr(server, "db", _db())

    with pytest.raises(HTTPException) as exc:
        await server.get_admin_internal_readiness(current_user=_user())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_internal_readiness_returns_sanitized_unknowns(monkeypatch):
    async def _fake_dependency_snapshot():
        return []

    monkeypatch.setattr(server, "_build_dependency_health_snapshot", _fake_dependency_snapshot)
    monkeypatch.setattr(server, "db", _db())

    result = await server.get_admin_internal_readiness(
        current_user={"id": "master", "email": "master@example.com", "role": "super_admin", "tenant_role": "super_admin"}
    )

    assert result["dependencies"]["mongodb"] == "unknown"
    assert "warnings" in result
    assert "api_key" not in str(result).lower()
