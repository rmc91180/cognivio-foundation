import types

from fastapi.testclient import TestClient

import server
from app.analysis.teacher_feedback_projection import (
    build_teacher_coaching_intelligence,
    validate_teacher_feedback_projection,
)
from tests.test_teacher_admin_endpoint_stability import _Collection


def test_teacher_projection_removes_rubric_score_and_system_language():
    projection = build_teacher_coaching_intelligence(
        assessment={
            "id": "assessment-1",
            "video_id": "video-1",
            "teacher_id": "teacher-1",
            "summary": "Overall performance: Developing (6.4/10). The teacher demonstrated rubric element d1b based on the evidence.",
            "recommendations": ["coach d1b after 5.3 evidence"],
            "element_scores": [
                {
                    "element_id": "d1b",
                    "element_name": "Demonstrating Knowledge of Students",
                    "score": 5.3,
                    "evidence_segments": [
                        {"start_sec": 42, "end_sec": 54, "summary": "The teacher used a quick prompt before students responded."}
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
            "evidence_segments": [{"start_sec": 15, "summary": "נתת מקום לקול נוסף בכיתה."}],
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
        teachers=_Collection([
            {"id": "teacher-1", "name": "Teacher One", "email": "teacher@example.com", "organization_id": "org-1", "subject": "Math"}
        ]),
        videos=_Collection([{"id": "video-1", "teacher_id": "teacher-1", "lesson_title": "Fractions"}]),
        assessments=_Collection([
            {
                "id": "assessment-1",
                "video_id": "video-1",
                "teacher_id": "teacher-1",
                "framework_type": "danielson",
                "element_scores": [{"element_id": "d1b", "element_name": "Demonstrating Knowledge of Students", "score": 5.3}],
                "overall_score": 6.4,
                "summary": "Overall performance: Developing (6.4/10).",
                "recommendations": ["coach d1b after 5.3 evidence"],
                "analyzed_at": "2026-05-01T00:00:00+00:00",
            }
        ]),
        consent_records=_Collection([]),
        teacher_face_profiles=_Collection([]),
        teacher_face_references=_Collection([]),
        coaching_task_reflections=_Collection([]),
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
    assert "teacher_feedback" in payload
    assert "element_scores" not in payload
    assert "overall_score" not in payload
    assert "d1b" not in str(payload).lower()
    assert "developing" not in str(payload).lower()
    assert "overall performance" not in str(payload).lower()


def test_private_reflection_hidden_and_shared_reflection_visible_to_admin(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection([]),
        organizations=_Collection([{"id": "org-1", "name": "Org"}]),
        schools=_Collection([]),
        teachers=_Collection([
            {"id": "teacher-1", "name": "Teacher One", "email": "teacher@example.com", "organization_id": "org-1", "created_by": "admin-1"}
        ]),
        action_plans=_Collection([]),
        summary_reflections=_Collection([]),
        summary_reflection_history=_Collection([]),
        assessments=_Collection([]),
        videos=_Collection([]),
        observations=_Collection([]),
        video_comments=_Collection([]),
        coaching_tasks=_Collection([]),
        coaching_task_reflections=_Collection([
            {"id": "private-1", "teacher_id": "teacher-1", "author_user_id": "teacher-user", "visibility": "private", "tried": "Private note", "happened": "Do not show", "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": "shared-1", "teacher_id": "teacher-1", "author_user_id": "teacher-user", "visibility": "shared_with_admin", "tried": "Shared note", "happened": "Please discuss this", "created_at": "2026-05-02T00:00:00+00:00"},
        ]),
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
