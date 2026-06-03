import types

from fastapi.testclient import TestClient

import server
from app.analysis.teacher_feedback_projection import (
    build_teacher_coaching_intelligence,
    validate_teacher_feedback_projection,
)


class _Cursor:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, limit):
        self.docs = self.docs[: int(limit)]
        return self

    async def to_list(self, length=None):
        if length is None:
            return list(self.docs)
        return list(self.docs)[: int(length)]


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, *_args, **_kwargs):
        query = query or {}
        return _Cursor([dict(doc) for doc in self.docs if self._matches(doc, query)])

    async def find_one(self, query=None, *_args, **_kwargs):
        query = query or {}
        for doc in self.docs:
            if self._matches(doc, query):
                return dict(doc)
        return None

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for doc in self.docs if self._matches(doc, query))

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, **kwargs):
        query = query or {}
        set_values = (update or {}).get("$set", {})
        push_values = (update or {}).get("$push", {})

        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(set_values)
                for key, value in push_values.items():
                    existing = list(next_doc.get(key) or [])
                    existing.append(value)
                    next_doc[key] = existing
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

        if kwargs.get("upsert"):
            next_doc = dict(query)
            next_doc.update(set_values)
            for key, value in push_values.items():
                next_doc[key] = [value]
            self.docs.append(next_doc)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=next_doc.get("id"))

        return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def update_many(self, query, update, **_kwargs):
        query = query or {}
        set_values = (update or {}).get("$set", {})
        modified = 0

        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(set_values)
                self.docs[index] = next_doc
                modified += 1

        return types.SimpleNamespace(matched_count=modified, modified_count=modified)

    async def delete_one(self, query):
        query = query or {}
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        deleted = 1 if len(self.docs) < before else 0
        return types.SimpleNamespace(deleted_count=deleted)

    async def delete_many(self, query):
        query = query or {}
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not self._matches(doc, query)]
        return types.SimpleNamespace(deleted_count=before - len(self.docs))

    def _matches(self, doc, query):
        for key, expected in (query or {}).items():
            actual = doc.get(key)

            if isinstance(expected, dict):
                if "$in" in expected:
                    if actual not in expected["$in"]:
                        return False
                    continue

                if "$ne" in expected:
                    if actual == expected["$ne"]:
                        return False
                    continue

                if "$regex" in expected:
                    import re

                    flags = re.IGNORECASE if expected.get("$options") == "i" else 0
                    if not re.search(expected["$regex"], str(actual or ""), flags=flags):
                        return False
                    continue

            if actual != expected:
                return False

        return True


def test_teacher_projection_removes_rubric_score_and_system_language():
    projection = build_teacher_coaching_intelligence(
        assessment={
            "id": "assessment-1",
            "video_id": "video-1",
            "teacher_id": "teacher-1",
            "summary": (
                "Overall performance: Developing (6.4/10). "
                "The teacher demonstrated rubric element d1b based on the evidence."
            ),
            "recommendations": ["coach d1b after 5.3 evidence"],
            "element_scores": [
                {
                    "element_id": "d1b",
                    "element_name": "Demonstrating Knowledge of Students",
                    "score": 5.3,
                    "evidence_segments": [
                        {
                            "start_sec": 42,
                            "end_sec": 54,
                            "summary": "The teacher used a quick prompt before students responded.",
                        }
                    ],
                }
            ],
        },
        video={"id": "video-1", "lesson_title": "Fractions discussion"},
        teacher={"id": "teacher-1", "subject": "Math"},
        readiness={"upload_ready": True, "blockers": []},
        language="en",
    )

    visible = str({key: projection[key] for key in ("latest_summary", "highlights", "action_items", "deep_dive")})
    lowered = visible.lower()

    assert "overall performance" not in lowered
    assert "developing" not in lowered
    assert "d1b" not in lowered
    assert "6.4/10" not in lowered
    assert "rubric" not in lowered
    assert "score" not in lowered
    assert projection["latest_summary"]["opening"] != projection["action_items"][0]["body"]
    assert projection["highlights"][0]["body"] != projection["action_items"][0]["body"]
    assert validate_teacher_feedback_projection(projection) == []


def test_hebrew_teacher_projection_is_teacher_facing_and_safe():
    projection = build_teacher_coaching_intelligence(
        assessment={
            "id": "assessment-he",
            "video_id": "video-he",
            "teacher_id": "teacher-1",
            "summary": "נתת לתלמידים זמן להסביר את החשיבה שלהם לפני שהמשכת.",
            "recommendations": ["בשיעור הבא, בקשו מתלמיד נוסף לבנות על תשובה שנאמרה."],
            "evidence_segments": [
                {
                    "start_sec": 15,
                    "summary": "נתת מקום לקול נוסף בכיתה.",
                }
            ],
        },
        video={"id": "video-he", "lesson_title": "דיון בכיתה"},
        teacher={"id": "teacher-1", "language": "he"},
        language="he",
    )

    visible = str(projection["latest_summary"]) + str(projection["action_items"]) + str(projection["deep_dive"])

    assert "score" not in visible.lower()
    assert "rubric" not in visible.lower()
    assert "בשיעור הבא" in visible or "אפשר" in visible
    assert validate_teacher_feedback_projection(projection, language="he") == []


def test_teacher_assessment_endpoint_returns_projection_without_raw_scores(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection([]),
        organizations=_Collection([{"id": "org-1", "name": "Org"}]),
        schools=_Collection([]),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "name": "Teacher One",
                    "email": "teacher@example.com",
                    "organization_id": "org-1",
                    "subject": "Math",
                }
            ]
        ),
        videos=_Collection([{"id": "video-1", "teacher_id": "teacher-1", "lesson_title": "Fractions"}]),
        assessments=_Collection(
            [
                {
                    "id": "assessment-1",
                    "video_id": "video-1",
                    "teacher_id": "teacher-1",
                    "framework_type": "danielson",
                    "element_scores": [
                        {
                            "element_id": "d1b",
                            "element_name": "Demonstrating Knowledge of Students",
                            "score": 5.3,
                        }
                    ],
                    "overall_score": 6.4,
                    "summary": "Overall performance: Developing (6.4/10).",
                    "recommendations": ["coach d1b after 5.3 evidence"],
                    "analyzed_at": "2026-05-01T00:00:00+00:00",
                }
            ]
        ),
        consent_records=_Collection([]),
        teacher_face_profiles=_Collection([]),
        teacher_face_references=_Collection([]),
        coaching_task_reflections=_Collection([]),
        recognition_badges=_Collection([]),
    )

    monkeypatch.setattr(server, "db", fake_db)
    server.app.dependency_overrides[server.get_current_user] = lambda: {
        "id": "teacher-user",
        "email": "teacher@example.com",
        "tenant_role": "teacher",
        "teacher_id": "teacher-1",
        "organization_id": "org-1",
        "approval_status": "approved",
        "is_active": True,
    }

    try:
        client = TestClient(server.app)
        response = client.get("/api/assessments/assessment-1")
    finally:
        server.app.dependency_overrides.clear()

    assert response.status_code == 200

    payload = response.json()
    serialized = str(payload).lower()

    assert "teacher_feedback" in payload
    assert "element_scores" not in payload
    assert "overall_score" not in payload
    assert "d1b" not in serialized
    assert "developing" not in serialized
    assert "overall performance" not in serialized


def test_private_reflection_hidden_and_shared_reflection_visible_to_admin(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection([]),
        organizations=_Collection([{"id": "org-1", "name": "Org"}]),
        schools=_Collection([]),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "name": "Teacher One",
                    "email": "teacher@example.com",
                    "organization_id": "org-1",
                    "created_by": "admin-1",
                }
            ]
        ),
        action_plans=_Collection([]),
        summary_reflections=_Collection([]),
        summary_reflection_history=_Collection([]),
        assessments=_Collection([]),
        videos=_Collection([]),
        observations=_Collection([]),
        video_comments=_Collection([]),
        coaching_tasks=_Collection([]),
        coaching_task_reflections=_Collection(
            [
                {
                    "id": "private-1",
                    "teacher_id": "teacher-1",
                    "author_user_id": "teacher-user",
                    "visibility": "private",
                    "tried": "Private note",
                    "happened": "Do not show",
                    "created_at": "2026-05-01T00:00:00+00:00",
                },
                {
                    "id": "shared-1",
                    "teacher_id": "teacher-1",
                    "author_user_id": "teacher-user",
                    "visibility": "shared_with_admin",
                    "tried": "Shared note",
                    "happened": "Please discuss this",
                    "created_at": "2026-05-02T00:00:00+00:00",
                },
            ]
        ),
    )

    monkeypatch.setattr(server, "db", fake_db)
    server.app.dependency_overrides[server.get_current_user] = lambda: {
        "id": "admin-1",
        "email": "admin@example.com",
        "tenant_role": "school_admin",
        "organization_id": "org-1",
        "approval_status": "approved",
        "is_active": True,
    }

    try:
        client = TestClient(server.app)
        response = client.get("/api/teachers/teacher-1/reflection-history")
    finally:
        server.app.dependency_overrides.clear()

    assert response.status_code == 200

    serialized = str(response.json())
    assert "Please discuss this" in serialized
    assert "Do not show" not in serialized


def test_teacher_voice_preserves_hyphenated_co_teacher():
    """Regression: the render-time `_teacher_voice` pass must NOT corrupt the
    hyphenated compound 'co-teacher' into 'co-You'. The old unguarded
    case-insensitive substring replace matched the 'teacher' inside 'co-teacher';
    the guarded word-boundary subs (mirroring voice_gate) leave it intact while
    still rewriting a bare 'The teacher ...' -> 'You ...'.
    """
    from app.analysis.teacher_feedback_projection import _teacher_voice

    # The exact production shape (assessment 5849a3b9 executive_summary opening).
    corrupted_input = "You and your co-teacher created a highly active, collaborative lesson."
    out = _teacher_voice(corrupted_input, language="en", path="summary")
    assert "co-teacher" in out
    assert "co-You" not in out
    assert "co-you" not in out

    # Other hyphenated compound must also survive.
    out_st = _teacher_voice("She is a student-teacher this year.", language="en", path="summary")
    assert "student-teacher" in out_st

    # The legitimate bare 'The teacher <verb>' -> 'You <verb>' rewrite still works.
    out_legit = _teacher_voice("The teacher asked students to explain.", language="en", path="summary")
    assert out_legit.startswith("You asked")
    assert "teacher" not in out_legit.lower()