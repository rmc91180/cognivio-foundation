import asyncio
import types

import pytest
from fastapi import HTTPException

import server
from scripts.seed_demo_data import build_demo_documents, reset_demo_data_for_persona


class _DeleteResult:
    def __init__(self, deleted_count=0):
        self.deleted_count = deleted_count


class _InsertManyResult:
    def __init__(self, inserted_ids):
        self.inserted_ids = inserted_ids


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, *args):
        if args:
            first = args[0]
            if isinstance(first, list):
                for field, direction in reversed(first):
                    self.docs.sort(key=lambda item: item.get(field) or "", reverse=direction == -1)
            else:
                field = first
                direction = args[1] if len(args) > 1 else 1
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
            docs = _Cursor(docs).sort(sort).docs
        if not docs:
            return None
        return self._project(docs[0], projection)

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        return _DeleteResult(before - len(self.docs))

    async def insert_many(self, docs):
        self.docs.extend(dict(doc) for doc in docs)
        return _InsertManyResult([doc.get("id") for doc in docs])

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        payload = dict(doc)
        for key, include in projection.items():
            if include == 0:
                payload.pop(key, None)
        return payload

    def _matches(self, doc, query):
        for key, value in (query or {}).items():
            if isinstance(value, dict):
                if "$in" in value and doc.get(key) not in value["$in"]:
                    return False
                continue
            if doc.get(key) != value:
                return False
        return True


def _demo_db():
    return types.SimpleNamespace(
        **{name: _Collection() for name in [
            "users",
            "organizations",
            "schools",
            "teachers",
            "training_cohorts",
            "trainee_placements",
            "videos",
            "video_comments",
            "video_audio_transcripts",
            "video_analysis_features",
            "assessments",
            "coaching_tasks",
            "coaching_task_reflections",
            "recognition_badges",
            "lesson_recognition_events",
            "observations",
            "observation_sessions",
            "schedules",
            "notifications",
            "dashboard_demo_patterns",
        ]}
    )


def test_demo_seed_documents_are_persona_scoped_and_repeatable():
    k12_docs = build_demo_documents("k12")
    training_docs = build_demo_documents("training")

    assert k12_docs["organizations"][0]["name"] == "Westbrook Elementary"
    assert training_docs["organizations"][0]["name"] == "Metro University Teacher Ed"
    assert all(doc["demo_data"] is True and doc["demo_persona"] == "k12" for doc in k12_docs["teachers"])
    assert all(doc["demo_data"] is True and doc["demo_persona"] == "training" for doc in training_docs["teachers"])


def test_reset_demo_data_for_persona_returns_stable_counts():
    db = _demo_db()

    first = asyncio.run(reset_demo_data_for_persona(db, "k12"))
    second = asyncio.run(reset_demo_data_for_persona(db, "k12"))

    assert first["teachers_seeded"] == second["teachers_seeded"] == 8
    assert first["assessments_seeded"] == second["assessments_seeded"] == 3
    assert first["tasks_seeded"] == second["tasks_seeded"] == 7
    assert first["badges_seeded"] == second["badges_seeded"] == 2


def test_demo_reset_endpoint_requires_demo_mode(monkeypatch):
    monkeypatch.setattr(server, "DEMO_MODE", False)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.reset_pilot_demo_data(
                persona="k12",
                current_user={"id": "master", "email": "rmc91180@gmail.com", "tenant_role": "super_admin"},
            )
        )

    assert exc.value.status_code == 403


def test_teacher_latest_lesson_hides_scores(monkeypatch):
    fake_db = types.SimpleNamespace(
        teachers=_Collection([
            {"id": "teacher-1", "email": "teacher@example.com", "name": "Teacher One", "subject": "Math"}
        ]),
        assessments=_Collection([
            {
                "id": "assessment-1",
                "teacher_id": "teacher-1",
                "video_id": "video-1",
                "summary": "You opened the discussion with a clear student prompt.",
                "recommendations": ["Ask one student to build on a classmate's idea."],
                "overall_score": 9.1,
                "element_scores": [{"element_id": "3b", "score": 9}],
                "analyzed_at": "2026-05-01T00:00:00+00:00",
            }
        ]),
        videos=_Collection([
            {"id": "video-1", "teacher_id": "teacher-1", "subject": "Math", "recorded_at": "2026-05-01T00:00:00+00:00"}
        ]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(
        server.get_my_latest_lesson(
            {"id": "user-1", "email": "teacher@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1"}
        )
    )

    lesson = result["lesson"]
    assert lesson["summary"].startswith("You opened")
    assert "overall_score" not in lesson
    assert "element_scores" not in lesson
