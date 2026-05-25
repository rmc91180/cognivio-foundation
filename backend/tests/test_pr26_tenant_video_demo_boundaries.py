import asyncio
import types

import pytest
from fastapi import HTTPException

import server
from app.services import video_service


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

    async def find_one(self, query, projection=None, sort=None):
        matches = [doc for doc in self.docs if self._matches(doc, query or {})]
        if sort:
            for field, direction in reversed(sort):
                matches.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
        if not matches:
            return None
        return self._project(matches[0], projection)

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def count_documents(self, query=None):
        return len([doc for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

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
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$exists":
                        if (key in doc) is not bool(expected):
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
            if doc_value != value:
                return False
        return True


def _tenant_db():
    return types.SimpleNamespace(
        users=_Collection(
            [
                {"id": "admin-real", "email": "admin@real.test", "tenant_role": "school_admin", "organization_id": "org-real", "approval_status": "approved", "is_active": True},
                {"id": "admin-other", "email": "admin@other.test", "tenant_role": "school_admin", "organization_id": "org-other", "approval_status": "approved", "is_active": True},
                {"id": "teacher-user-1", "email": "teacher1@real.test", "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-real", "approval_status": "approved", "is_active": True},
                {"id": "teacher-user-2", "email": "teacher2@other.test", "tenant_role": "teacher", "teacher_id": "teacher-2", "organization_id": "org-other", "approval_status": "approved", "is_active": True},
                {"id": "deleted-user", "email": "deleted@real.test", "tenant_role": "teacher", "teacher_id": "teacher-deleted", "organization_id": "org-real", "approval_status": "deleted", "is_active": False},
            ]
        ),
        schools=_Collection(
            [
                {"id": "school-real", "organization_id": "org-real", "user_id": "admin-real"},
                {"id": "school-other", "organization_id": "org-other", "user_id": "admin-other"},
            ]
        ),
        teachers=_Collection(
            [
                {"id": "teacher-1", "email": "teacher1@real.test", "name": "Real Teacher", "organization_id": "org-real", "school_id": "school-real", "created_by": "admin-real"},
                {"id": "teacher-2", "email": "teacher2@other.test", "name": "Other Teacher", "organization_id": "org-other", "school_id": "school-other", "created_by": "admin-other"},
                {"id": "teacher-demo", "email": "demo@real.test", "name": "Demo Teacher", "organization_id": "org-real", "school_id": "school-real", "created_by": "admin-real", "demo_data": True},
                {"id": "teacher-deleted", "email": "deleted@real.test", "name": "Deleted Teacher", "organization_id": "org-real", "school_id": "school-real", "created_by": "admin-real"},
            ]
        ),
        videos=_Collection(
            [
                {"id": "video-1", "teacher_id": "teacher-1", "uploaded_by": "admin-real", "raw_file_url": "https://signed.example/raw.mp4", "upload_date": "2026-01-01T00:00:00+00:00", "privacy_pipeline_state": "blurred_verified", "unblurred_deletion_status": "not_started"},
                {"id": "video-2", "teacher_id": "teacher-2", "uploaded_by": "admin-other", "raw_file_url": "https://signed.example/other.mp4", "upload_date": "2026-01-02T00:00:00+00:00"},
                {"id": "video-deleted", "teacher_id": "teacher-1", "uploaded_by": "admin-real", "raw_file_url": "https://signed.example/deleted.mp4", "privacy_pipeline_state": "unblurred_deleted", "unblurred_deletion_status": "deleted"},
            ]
        ),
        assessments=_Collection(
            [
                {"id": "assessment-1", "teacher_id": "teacher-1", "video_id": "video-1", "analyzed_at": "2026-05-20T00:00:00+00:00", "summary": "Scoped feedback"},
                {"id": "assessment-other", "teacher_id": "teacher-2", "video_id": "video-2", "analyzed_at": "2026-05-20T00:00:00+00:00", "summary": "Other tenant"},
                {"id": "assessment-demo", "teacher_id": "teacher-demo", "video_id": "video-demo", "analyzed_at": "2026-05-20T00:00:00+00:00", "summary": "Demo", "demo_data": True},
            ]
        ),
        observations=_Collection([]),
        observation_sessions=_Collection([]),
        coaching_tasks=_Collection([{"id": "task-1", "teacher_id": "teacher-1", "status": "open", "created_at": "2026-01-03T00:00:00+00:00"}]),
        recognition_badges=_Collection([{"id": "badge-1", "teacher_id": "teacher-1", "video_id": "video-1", "status": "awarded", "awarded_at": "2026-01-03T00:00:00+00:00"}]),
        video_comments=_Collection(
            [
                {"id": "comment-shared", "video_id": "video-1", "teacher_id": "teacher-1", "body": "Shared", "visibility": "shared_with_teacher", "author_id": "admin-real", "author_name": "Admin", "author_role": "school_admin", "timestamp_seconds": 3, "created_at": "2026-01-03T00:00:00+00:00"},
                {"id": "comment-private", "video_id": "video-1", "teacher_id": "teacher-1", "body": "Private", "visibility": "observer_private", "author_id": "admin-real", "author_name": "Admin", "author_role": "school_admin", "timestamp_seconds": 4, "created_at": "2026-01-03T00:00:00+00:00"},
                {"id": "comment-other", "video_id": "video-2", "teacher_id": "teacher-2", "body": "Other", "visibility": "shared_with_teacher", "author_id": "admin-other", "author_name": "Other Admin", "author_role": "school_admin", "timestamp_seconds": 1, "created_at": "2026-01-03T00:00:00+00:00"},
            ]
        ),
        video_audio_transcripts=_Collection(
            [
                {"id": "transcript-1", "video_id": "video-1", "transcript_status": "completed", "text": "Teacher prompt", "segments": [], "created_at": "2026-01-04T00:00:00+00:00"},
                {"id": "transcript-2", "video_id": "video-2", "transcript_status": "completed", "text": "Other", "segments": [], "created_at": "2026-01-04T00:00:00+00:00"},
            ]
        ),
        video_analysis_features=_Collection([{"id": "features-1", "video_id": "video-1", "teacher_talk_ratio": 0.5, "created_at": "2026-01-04T00:00:00+00:00"}]),
        schedules=_Collection([]),
        privacy_audit_events=_Collection([]),
    )


def _school_admin():
    return {"id": "admin-real", "email": "admin@real.test", "role": "admin", "tenant_role": "school_admin", "organization_id": "org-real"}


def _teacher_user():
    return {"id": "teacher-user-1", "email": "teacher1@real.test", "role": "teacher", "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-real"}


def test_teacher_cannot_access_another_teacher_video_and_denial_is_audited(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(video_service.get_video_detail("video-2", _teacher_user()))

    assert exc.value.status_code == 403
    assert exc.value.detail["reason_code"] == "forbidden_tenant_access"
    assert any(event["event_type"] == "cross_tenant_access_denied" for event in fake_db.privacy_audit_events.docs)


def test_school_admin_video_access_is_tenant_scoped(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    own = asyncio.run(video_service.get_video_detail("video-1", _school_admin()))
    assert own["id"] == "video-1"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(video_service.get_video_detail("video-2", _school_admin()))
    assert exc.value.status_code == 403


def test_audio_analysis_follows_video_access_scope(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    own = asyncio.run(server.get_video_audio_analysis("video-1", _teacher_user()))
    assert own.video_id == "video-1"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_video_audio_analysis("video-2", _teacher_user()))
    assert exc.value.status_code == 403


def test_video_comments_visibility_is_scoped_by_role_and_tenant(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    teacher_comments = asyncio.run(server.list_video_comments("video-1", _teacher_user()))
    assert [comment.id for comment in teacher_comments.comments] == ["comment-shared"]

    admin_comments = asyncio.run(server.list_video_comments("video-1", _school_admin()))
    assert {comment.id for comment in admin_comments.comments} == {"comment-shared", "comment-private"}

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.list_video_comments("video-2", _school_admin()))
    assert exc.value.status_code == 403


def test_unblurred_video_access_requires_reason_and_audits_grant_or_denial(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(video_service.get_video_raw_access("video-1", _school_admin()))
    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "unblurred_access_reason_required"

    granted = asyncio.run(
        video_service.get_video_raw_access("video-1", _school_admin(), access_reason="privacy support review")
    )
    assert granted["access_url"] == "https://signed.example/raw.mp4"
    events = [event["event_type"] for event in fake_db.privacy_audit_events.docs]
    assert "support_unblurred_access_denied" in events
    assert "support_unblurred_access_granted" in events
    assert "unblurred_video_viewed" in events

    with pytest.raises(HTTPException) as deleted_exc:
        asyncio.run(
            video_service.get_video_raw_access(
                "video-deleted",
                _school_admin(),
                access_reason="privacy support review",
            )
        )
    assert deleted_exc.value.status_code == 404


def test_dashboard_counts_exclude_demo_and_other_tenant_data_for_real_workspace(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    snapshot = asyncio.run(server._build_coaching_snapshot(_school_admin()))

    assert snapshot["summary"]["reviewed_lessons"] == 1
    assert snapshot["summary"]["teachers_with_feedback"] == 1
    assert [row["teacher_id"] for row in snapshot["teacher_rows"]] == ["teacher-1"]


def test_deleted_teachers_are_excluded_from_active_tenant_lists(monkeypatch):
    fake_db = _tenant_db()
    monkeypatch.setattr(server, "db", fake_db)

    teacher_ids = asyncio.run(server._list_teacher_ids_for_user(_school_admin()))

    assert "teacher-1" in teacher_ids
    assert "teacher-deleted" not in teacher_ids
