import types
from datetime import datetime, timezone, timedelta

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
        return len([doc for doc in self.docs if self._matches(doc, query)])

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


def _admin(role="school_admin", user_id="admin-1", org_id="org-1"):
    return {
        "id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Admin One",
        "role": "admin",
        "tenant_role": role,
        "organization_id": org_id,
        "organization_name": "Demo Org",
    }


def _teacher_user():
    return {
        "id": "teacher-user",
        "email": "teacher@example.com",
        "name": "Teacher One",
        "role": "teacher",
        "tenant_role": "teacher",
        "organization_id": "org-1",
    }


def _db(now):
    teachers = [
        {"id": "t1", "name": "Avery Stone", "email": "avery@example.com", "organization_id": "org-1", "created_by": "admin-1"},
        {"id": "t2", "name": "Bri Lee", "email": "bri@example.com", "organization_id": "org-1", "created_by": "admin-1"},
        {"id": "t3", "name": "Cam Rivera", "email": "cam@example.com", "organization_id": "org-1", "created_by": "admin-1"},
        {"id": "t4", "name": "Deleted Teacher", "email": "deleted@example.com", "organization_id": "org-1", "created_by": "admin-1"},
        {"id": "other", "name": "Other Workspace", "email": "other@example.com", "organization_id": "org-2", "created_by": "admin-2"},
    ]
    users = [
        {"id": "u1", "email": "avery@example.com", "teacher_id": "t1", "tenant_role": "teacher", "approval_status": "approved", "is_active": True},
        {"id": "u2", "email": "bri@example.com", "teacher_id": "t2", "tenant_role": "teacher", "approval_status": "approved", "is_active": True},
        {"id": "u3", "email": "cam@example.com", "teacher_id": "t3", "tenant_role": "teacher", "approval_status": "approved", "is_active": True},
        {"id": "u4", "email": "deleted@example.com", "teacher_id": "t4", "tenant_role": "teacher", "approval_status": "deleted", "is_active": False},
    ]
    assessments = [
        {
            "id": "a1",
            "video_id": "v1",
            "teacher_id": "t1",
            "analyzed_at": (now - timedelta(days=4)).isoformat(),
            "summary": "You gave students a clear invitation to explain their thinking.",
            "overall_score": 7,
            "element_scores": [{"element_id": "3b", "score": 5, "element_name": "3b"}],
        },
        {
            "id": "a2",
            "video_id": "v2",
            "teacher_id": "t2",
            "analyzed_at": (now - timedelta(days=6)).isoformat(),
            "summary": "You made the task feel approachable, and the next move is giving students more room to compare ideas.",
            "overall_score": 6,
            "element_scores": [{"element_id": "3b", "score": 5, "element_name": "3b"}],
        },
        {
            "id": "a3",
            "video_id": "v3",
            "teacher_id": "t3",
            "analyzed_at": (now - timedelta(days=8)).isoformat(),
            "summary": "You gave a warm opening and can press one student idea further next time.",
            "overall_score": 5,
            "element_scores": [{"element_id": "3b", "score": 5, "element_name": "3b"}],
        },
        {
            "id": "a-other",
            "video_id": "v-other",
            "teacher_id": "other",
            "analyzed_at": (now - timedelta(days=3)).isoformat(),
            "summary": "Other workspace summary",
            "overall_score": 4,
        },
    ]
    return types.SimpleNamespace(
        teachers=_Collection(teachers),
        users=_Collection(users),
        schools=_Collection([]),
        assessments=_Collection(assessments),
        observations=_Collection([{"id": "o1", "teacher_id": "t1", "created_at": (now - timedelta(days=4)).isoformat()}]),
        observation_sessions=_Collection([]),
        coaching_tasks=_Collection([
            {"id": "task-1", "teacher_id": "t1", "status": "open"},
            {"id": "task-2", "teacher_id": "t2", "status": "completed"},
        ]),
        recognition_badges=_Collection([{"id": "badge-1", "teacher_id": "t1", "status": "awarded"}]),
        video_comments=_Collection([
            {"id": "c1", "teacher_id": "t1", "visibility": "shared_with_teacher", "body": "Moment to revisit"},
            {"id": "c2", "teacher_id": "t1", "visibility": "observer_private", "body": "Private note"},
        ]),
        video_analysis_features=_Collection([]),
        schedules=_Collection([]),
        recording_policies=_Collection([]),
    )


@pytest.mark.asyncio
async def test_dashboard_intelligence_is_role_scoped_and_plain_language(monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(server, "db", _db(now))

    result = await server._build_dashboard_intelligence(_admin())

    assert result["workspace_mode"] == "school"
    assert result["cycle_summary"]["total_teachers"] == 3
    assert all("Deleted Teacher" not in item.get("teacher_name", "") for item in result["observation_gaps"])
    assert all("Other Workspace" not in item.get("teacher_name", "") for item in result["observation_gaps"])
    cluster = next(item for item in result["patterns"] if item["type"] == "cluster")
    assert "student discussion" in cluster["title"].lower()
    assert "3b" not in cluster["title"].lower()
    assert "evidence" not in cluster["description"].lower()


@pytest.mark.asyncio
async def test_teacher_cannot_access_dashboard_intelligence(monkeypatch):
    monkeypatch.setattr(server, "db", _db(datetime.now(timezone.utc)))

    with pytest.raises(HTTPException) as exc:
        await server._build_dashboard_intelligence(_teacher_user())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_coaching_snapshot_and_csv_exclude_private_notes(monkeypatch):
    monkeypatch.setattr(server, "db", _db(datetime.now(timezone.utc)))

    snapshot = await server._build_coaching_snapshot(_admin())
    assert snapshot["summary"]["open_coaching_tasks"] == 1
    assert snapshot["teacher_rows"]
    serialized = str(snapshot)
    assert "Private note" not in serialized

    response = await server.export_coaching_snapshot_csv(_admin())
    text = response.body.decode("utf-8")
    assert "Teacher,Reviewed lessons,Open coaching tasks" in text
    assert "Private note" not in text


@pytest.mark.asyncio
async def test_cohort_snapshot_returns_training_shape(monkeypatch):
    monkeypatch.setattr(server, "db", _db(datetime.now(timezone.utc)))

    result = await server._build_cohort_snapshot(_admin(role="training_admin"))

    assert result["summary"]["active_trainees"] == 3
    assert result["trainee_rows"][0]["status"] in {"At risk", "Not started", "On track"}


@pytest.mark.asyncio
async def test_school_admin_cannot_access_cohort_snapshot(monkeypatch):
    monkeypatch.setattr(server, "db", _db(datetime.now(timezone.utc)))

    with pytest.raises(HTTPException) as exc:
        await server._build_cohort_snapshot(_admin())

    assert exc.value.status_code == 403
