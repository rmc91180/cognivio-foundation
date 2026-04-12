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

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query))

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
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def test_master_admin_workspaces_returns_rollups(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "admin-1",
                    "email": "admin@example.com",
                    "name": "Admin One",
                    "role": "admin",
                    "approval_status": "approved",
                    "is_active": True,
                    "created_at": "2026-04-12T10:00:00+00:00",
                },
                {
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "name": "Teacher User",
                    "role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "teacher_id": "teacher-1",
                    "last_login_at": "2026-04-12T12:00:00+00:00",
                    "created_at": "2026-04-12T11:00:00+00:00",
                },
                {
                    "id": "teacher-user-2",
                    "email": "teacher2@example.com",
                    "name": "Pending Teacher User",
                    "role": "teacher",
                    "approval_status": "pending",
                    "is_active": False,
                    "created_at": "2026-04-12T11:30:00+00:00",
                },
            ]
        ),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "name": "Teacher One",
                    "email": "teacher1@example.com",
                    "subject": "Math",
                    "created_by": "admin-1",
                    "created_at": "2026-04-12T10:00:00+00:00",
                    "school_id": "school-1",
                },
                {
                    "id": "teacher-2",
                    "name": "Teacher Two",
                    "email": "teacher2@example.com",
                    "subject": "Science",
                    "created_by": "admin-1",
                    "created_at": "2026-04-12T10:05:00+00:00",
                    "school_id": "school-1",
                },
            ]
        ),
        videos=_Collection(
            [
                {
                    "id": "video-1",
                    "teacher_id": "teacher-1",
                    "created_at": "2026-04-12T12:05:00+00:00",
                    "status_updated_at": "2026-04-12T12:10:00+00:00",
                    "transcode_status": "completed",
                    "privacy_status": "completed",
                    "analysis_status": "completed",
                },
                {
                    "id": "video-2",
                    "teacher_id": "teacher-2",
                    "created_at": "2026-04-12T12:15:00+00:00",
                    "status_updated_at": "2026-04-12T12:20:00+00:00",
                    "transcode_status": "failed",
                    "privacy_status": "queued",
                    "analysis_status": "queued",
                },
            ]
        ),
        assessments=_Collection(
            [
                {"id": "assessment-1", "teacher_id": "teacher-1", "created_at": "2026-04-12T12:30:00+00:00"},
            ]
        ),
        teacher_face_profiles=_Collection(
            [
                {"teacher_id": "teacher-1", "status": "active", "updated_at": "2026-04-12T12:00:00+00:00"},
            ]
        ),
        organization_memory=_Collection(
            [
                {"id": "mem-1", "owner_id": "admin-1", "updated_at": "2026-04-12T09:00:00+00:00"},
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    async def _fake_resolve_workspace_mode(current_user):
        return {
            "owner_id": current_user["id"],
            "effective_mode": "school",
            "updated_at": "2026-04-12T09:00:00+00:00",
        }

    import app.services.workspace_service as workspace_service

    monkeypatch.setattr(workspace_service, "resolve_workspace_mode", _fake_resolve_workspace_mode)

    result = asyncio.run(
        server.get_master_admin_workspaces(
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )

    assert result.total == 1
    workspace = result.items[0]
    assert workspace.teacher_count == 2
    assert workspace.upload_count == 2
    assert workspace.assessment_count == 1
    assert workspace.privacy_gap_count == 1
    assert workspace.failure_count == 1
    assert workspace.pending_teacher_users == 1
    assert workspace.health_state == "blocked"


def test_master_admin_workspace_detail_surfaces_linkage_and_failures(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "admin-1",
                    "email": "admin@example.com",
                    "name": "Admin One",
                    "role": "admin",
                    "approval_status": "approved",
                    "is_active": True,
                    "created_at": "2026-04-12T10:00:00+00:00",
                },
                {
                    "id": "teacher-user-2",
                    "email": "teacher2@example.com",
                    "name": "Pending Teacher User",
                    "role": "teacher",
                    "approval_status": "pending",
                    "is_active": False,
                    "created_at": "2026-04-12T11:30:00+00:00",
                },
            ]
        ),
        teachers=_Collection(
            [
                {
                    "id": "teacher-2",
                    "name": "Teacher Two",
                    "email": "teacher2@example.com",
                    "subject": "Science",
                    "created_by": "admin-1",
                    "created_at": "2026-04-12T10:05:00+00:00",
                    "school_id": "school-1",
                },
            ]
        ),
        videos=_Collection(
            [
                {
                    "id": "video-2",
                    "teacher_id": "teacher-2",
                    "filename": "lesson.mp4",
                    "status_updated_at": "2026-04-12T12:20:00+00:00",
                    "transcode_status": "failed",
                    "privacy_status": "queued",
                    "analysis_status": "queued",
                },
            ]
        ),
        assessments=_Collection([]),
        teacher_face_profiles=_Collection([]),
        organization_memory=_Collection(
            [
                {"id": "mem-1", "owner_id": "admin-1", "scope_type": "teacher", "scope_id": "teacher-2", "memory_type": "coaching_context", "updated_at": "2026-04-12T09:00:00+00:00"},
            ]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    async def _fake_resolve_workspace_mode(current_user):
        return {
            "owner_id": current_user["id"],
            "effective_mode": "training",
            "updated_at": "2026-04-12T09:00:00+00:00",
        }

    import app.services.workspace_service as workspace_service

    monkeypatch.setattr(workspace_service, "resolve_workspace_mode", _fake_resolve_workspace_mode)

    result = asyncio.run(
        server.get_master_admin_workspace_detail(
            "admin-1",
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )

    assert result.workspace.owner_email == "admin@example.com"
    assert result.workspace.workspace_mode == "training"
    assert len(result.related["teachers"]) == 1
    assert result.related["teachers"][0]["privacy_ready"] is False
    assert len(result.related["unlinked_users"]) == 1
    assert result.related["recent_failures"][0]["id"] == "video-2"
    assert result.related["memory_entries"][0]["memory_type"] == "coaching_context"
