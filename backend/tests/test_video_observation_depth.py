import asyncio
import types

import pytest
from fastapi import HTTPException

import server


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=1):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field) or "", reverse=reverse)
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
        if not docs:
            return None
        return self._project(docs[0], projection)

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        return types.SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        count = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                count += 1
        return types.SimpleNamespace(matched_count=count, modified_count=count)

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        await self.update_one(query, update)
        return await self.find_one(query, projection)

    @staticmethod
    def _project(doc, projection):
        payload = dict(doc)
        if projection:
            for key, include in projection.items():
                if include == 0:
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


def _user(role="school_admin", user_id="admin-1"):
    return {
        "id": user_id,
        "email": f"{user_id}@example.com",
        "name": "Admin One",
        "role": "admin" if role != "teacher" else "teacher",
        "tenant_role": role,
        "organization_id": "org-1",
    }


def test_video_comment_routes_are_mounted():
    paths = {route.path for route in server.app.routes}
    assert "/api/videos/{video_id}/comments" in paths
    assert "/api/videos/{video_id}/comments/{comment_id}" in paths
    assert "/api/videos/{video_id}/audio-analysis" in paths


@pytest.mark.asyncio
async def test_create_video_comment_attaches_video_and_session_context(monkeypatch):
    fake_db = types.SimpleNamespace(
        teachers=_Collection([{"id": "teacher-1", "organization_id": "org-1"}]),
        assessments=_Collection([]),
        video_comments=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    async def _visible(video_id, current_user):
        return {
            "id": video_id,
            "teacher_id": "teacher-1",
            "workspace_id": "org-1",
            "organization_id": "org-1",
            "observation_session_id": "session-1",
        }

    monkeypatch.setattr(server, "_get_visible_video_or_404", _visible)

    result = await server.create_video_comment(
        "video-1",
        server.VideoCommentCreate(
            timestamp_seconds=12.5,
            body="Moment to revisit: you paused long enough for another student to add their thinking.",
            focus_area_label="Student discussion",
            visibility="shared_with_teacher",
        ),
        _user(),
    )

    assert result.video_id == "video-1"
    assert result.workspace_id == "org-1"
    assert result.organization_id == "org-1"
    assert result.teacher_id == "teacher-1"
    assert result.observation_session_id == "session-1"
    assert result.visibility == "shared_with_teacher"


@pytest.mark.asyncio
async def test_list_video_comments_sorts_and_hides_private_notes_from_teacher(monkeypatch):
    fake_db = types.SimpleNamespace(
        video_comments=_Collection(
            [
                {
                    "id": "private",
                    "video_id": "video-1",
                    "author_id": "admin-1",
                    "author_name": "Admin",
                    "author_role": "school_admin",
                    "timestamp_seconds": 20,
                    "body": "Private observer note",
                    "visibility": "observer_private",
                    "created_at": "2026-05-01T00:02:00+00:00",
                },
                {
                    "id": "shared-late",
                    "video_id": "video-1",
                    "author_id": "admin-1",
                    "author_name": "Admin",
                    "author_role": "school_admin",
                    "timestamp_seconds": 30,
                    "body": "Later shared note",
                    "visibility": "shared_with_teacher",
                    "created_at": "2026-05-01T00:03:00+00:00",
                },
                {
                    "id": "shared-early",
                    "video_id": "video-1",
                    "author_id": "admin-1",
                    "author_name": "Admin",
                    "author_role": "school_admin",
                    "timestamp_seconds": 10,
                    "body": "Earlier shared note",
                    "visibility": "shared_with_teacher",
                    "created_at": "2026-05-01T00:01:00+00:00",
                },
            ]
        )
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_get_visible_video_or_404", lambda video_id, current_user: asyncio.sleep(0, result={"id": video_id}))

    result = await server.list_video_comments("video-1", _user("teacher", "teacher-user"))

    assert [comment.id for comment in result.comments] == ["shared-early", "shared-late"]


@pytest.mark.asyncio
async def test_teacher_cannot_create_private_or_admin_only_comment(monkeypatch):
    monkeypatch.setattr(server, "db", types.SimpleNamespace(teachers=_Collection([]), assessments=_Collection([]), video_comments=_Collection([])))
    monkeypatch.setattr(server, "_get_visible_video_or_404", lambda video_id, current_user: asyncio.sleep(0, result={"id": video_id, "teacher_id": "teacher-1"}))

    with pytest.raises(HTTPException) as exc:
        await server.create_video_comment(
            "video-1",
            server.VideoCommentCreate(timestamp_seconds=1, body="Private thought", visibility="observer_private"),
            _user("teacher", "teacher-user"),
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_audio_analysis_returns_no_data_response(monkeypatch):
    monkeypatch.setattr(
        server,
        "db",
        types.SimpleNamespace(
            video_audio_transcripts=_Collection([]),
            video_analysis_features=_Collection([]),
        ),
    )
    monkeypatch.setattr(server, "_get_visible_video_or_404", lambda video_id, current_user: asyncio.sleep(0, result={"id": video_id}))

    result = await server.get_video_audio_analysis("video-1", _user())

    assert result.video_id == "video-1"
    assert result.transcript_available is False
    assert result.features_available is False
    assert result.transcript_segments == []


def test_audio_analysis_suppresses_student_transcript_when_policy_disabled(monkeypatch):
    monkeypatch.setattr(server, "AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", False)

    result = server._build_video_audio_analysis_response(
        {
            "video_id": "video-1",
            "transcript_status": "completed",
            "segments": [
                {"start_sec": 0, "end_sec": 4, "speaker": "teacher", "text": "What do you notice?"},
                {"start_sec": 5, "end_sec": 9, "speaker": "student", "text": "A student answer"},
            ],
        },
        {"video_id": "video-1", "teacher_talk_ratio": 0.5},
        video_id="video-1",
    )

    assert result.student_transcript_suppressed is True
    assert [segment.text for segment in result.transcript_segments] == ["What do you notice?"]
