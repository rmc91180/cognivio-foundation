import asyncio
import types

import pytest

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=None):
        sort_fields = field if isinstance(field, list) else [(field, direction or 1)]
        for key, order in reversed(sort_fields):
            self.docs = sorted(self.docs, key=lambda item: item.get(key) or "", reverse=order == -1)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None, *args, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            next_doc = dict(query or {})
            next_doc.update(update.get("$set", {}))
            self.docs.append(next_doc)
            return types.SimpleNamespace(modified_count=1, matched_count=1)
        return types.SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update):
        count = 0
        for index, doc in enumerate(list(self.docs)):
            if self._matches(doc, query or {}):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                count += 1
        return types.SimpleNamespace(modified_count=count)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if self._matches(doc, query or {}))

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        include = {key for key, value in projection.items() if value}
        exclude = {key for key, value in projection.items() if not value}
        payload = {key: value for key, value in doc.items() if not include or key in include}
        for key in exclude:
            payload.pop(key, None)
        return payload

    def _matches(self, doc, query):
        for key, value in (query or {}).items():
            if key == "$or":
                if not any(self._matches(doc, clause) for clause in value):
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
                    else:
                        raise AssertionError(f"Unsupported operator {operator}")
                continue
            if doc_value != value:
                return False
        return True


@pytest.fixture
def flow_db(monkeypatch):
    db = types.SimpleNamespace(
        users=_Collection(),
        teachers=_Collection(),
        schools=_Collection(),
        organizations=_Collection(),
        videos=_Collection(),
        assessments=_Collection(),
        consent_records=_Collection(),
        teacher_face_profiles=_Collection(),
        coaching_tasks=_Collection(),
        coaching_task_reflections=_Collection(),
        video_comments=_Collection(),
        recognition_badges=_Collection(),
        notifications=_Collection(),
        auth_event_log=_Collection(),
        master_admin_audit_events=_Collection(),
        user_sessions=_Collection(),
    )
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "PRIVACY_REQUIRE_PROFILE", False)
    monkeypatch.setattr(server, "_send_access_approved_confirmation", lambda _user: False)
    monkeypatch.setattr(server, "_send_access_denied_confirmation", lambda _user: True)
    return db


def _request():
    return types.SimpleNamespace(client=types.SimpleNamespace(host="127.0.0.1"), headers={})


def _super_user():
    return {"id": "super-1", "email": "master@example.com", "role": "super_admin", "tenant_role": "super_admin"}


def _teacher_user(**overrides):
    payload = {
        "id": "teacher-user-1",
        "email": "teacher@example.com",
        "name": "Teacher One",
        "role": "teacher",
        "tenant_role": "teacher",
        "approval_status": "approved",
        "is_active": True,
        "teacher_id": "teacher-1",
    }
    payload.update(overrides)
    return payload


def test_master_admin_approve_returns_success_with_email_warning(flow_db):
    flow_db.users.docs.append(
        {
            "id": "pending-1",
            "email": "pending@example.com",
            "name": "Pending User",
            "role": "teacher",
            "tenant_role": "teacher",
            "approval_status": "pending",
            "is_active": False,
            "created_at": "2026-05-01T10:00:00+00:00",
        }
    )

    result = asyncio.run(
        server.master_admin_approve_user(
            "pending-1",
            server.MasterAdminUserActionPayload(reason="Internal test"),
            current_user=_super_user(),
        )
    )

    assert result.ok is True
    assert result.approval_status == "approved"
    assert result.email_status.attempted is True
    assert result.email_status.sent is False
    assert "Resend" in result.message


def test_consent_grant_persists_and_status_advances(flow_db):
    user = _teacher_user()
    for consent_type in server.CONSENT_TYPES:
        status = asyncio.run(
            server.grant_consent(
                server.ConsentGrantPayload(consent_type=consent_type, granted=True, version="2026-05"),
                _request(),
                current_user=user,
            )
        )

    assert status["all_granted"] is True
    assert len(flow_db.consent_records.docs) == len(server.CONSENT_TYPES)


def test_teacher_profile_update_creates_profile_and_links_user(flow_db):
    user = _teacher_user(teacher_id=None)
    flow_db.users.docs.append(dict(user))

    result = asyncio.run(
        server.update_my_teacher_profile(
            server.TeacherSelfProfileUpdate(subject="Science", grade_level="Grade 6", department="Section A"),
            _request(),
            current_user=user,
        )
    )

    assert result["teacher_profile_complete"] is True
    assert result["profile"]["subject"] == "Science"
    assert flow_db.users.docs[0]["teacher_id"] == result["profile"]["id"]


def test_teacher_lessons_include_linked_teacher_videos(flow_db):
    flow_db.users.docs.append(_teacher_user())
    flow_db.teachers.docs.append(
        {"id": "teacher-1", "email": "different@example.com", "name": "Teacher One", "subject": "Math", "grade_level": "7", "created_at": "2026-05-01"}
    )
    flow_db.videos.docs.append(
        {"id": "video-1", "teacher_id": "teacher-1", "filename": "Lesson.mp4", "upload_date": "2026-05-02", "status": "completed", "analysis_status": "completed"}
    )
    flow_db.assessments.docs.append(
        {"id": "assessment-1", "teacher_id": "teacher-1", "video_id": "video-1", "summary": "You gave students time to explain their thinking.", "analyzed_at": "2026-05-03"}
    )

    result = asyncio.run(server.get_my_lessons(current_user=_teacher_user()))

    assert result["profile_required"] is False
    assert result["lessons"][0]["video_id"] == "video-1"
    assert result["lessons"][0]["status"] == "reviewed"


def test_teacher_coaching_excludes_private_comments(flow_db):
    flow_db.users.docs.append(_teacher_user())
    flow_db.teachers.docs.append(
        {"id": "teacher-1", "email": "teacher@example.com", "name": "Teacher One", "subject": "Math", "grade_level": "7", "created_at": "2026-05-01"}
    )
    flow_db.coaching_tasks.docs.append(
        {"id": "task-1", "teacher_id": "teacher-1", "title": "Try a longer pause", "suggested_action": "Give students five seconds before stepping back in.", "status": "open"}
    )
    flow_db.video_comments.docs.extend(
        [
            {"id": "shared-1", "teacher_id": "teacher-1", "video_id": "video-1", "visibility": "shared_with_teacher", "body": "Moment to revisit.", "timestamp_seconds": 42},
            {"id": "private-1", "teacher_id": "teacher-1", "video_id": "video-1", "visibility": "observer_private", "body": "Private note.", "timestamp_seconds": 52},
        ]
    )

    result = asyncio.run(server.get_my_teacher_coaching(current_user=_teacher_user()))

    assert len(result["active_tasks"]) == 1
    assert [moment["comment_id"] for moment in result["shared_moments"]] == ["shared-1"]