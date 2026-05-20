import types
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

import server
import scripts.seed_demo_data as seed_demo_data


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction=1):
        if isinstance(field, list):
            for sort_field, sort_direction in reversed(field):
                self.docs.sort(key=lambda item: item.get(sort_field) or "", reverse=sort_direction == -1)
            return self
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

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def insert_many(self, docs):
        self.docs.extend(dict(doc) for doc in docs)
        return types.SimpleNamespace(inserted_ids=[doc.get("id") for doc in docs])

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                if "$inc" in update:
                    for key, value in update["$inc"].items():
                        next_doc[key] = next_doc.get(key, 0) + value
                self.docs[index] = next_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            payload = {}
            for key, value in query.items():
                if not key.startswith("$") and not isinstance(value, dict):
                    payload[key] = value
            payload.update(update.get("$set", {}))
            self.docs.append(payload)
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
                doc_value = doc.get(key)
                for operator, expected in value.items():
                    if operator == "$in":
                        if doc_value not in expected:
                            return False
                    elif operator == "$nin":
                        if doc_value in expected:
                            return False
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$exists":
                        exists = key in doc
                        if bool(expected) != exists:
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
            if doc.get(key) != value:
                return False
        return True


def _db():
    now = datetime.now(timezone.utc)
    return types.SimpleNamespace(
        users=_Collection(
            [
                {"id": "teacher-user", "email": "teacher@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-1", "approval_status": "approved", "is_active": True},
                {"id": "demo-teacher-user", "email": "demo-teacher@example.com", "tenant_role": "teacher", "teacher_id": "demo-teacher-1", "organization_id": "demo-org", "approval_status": "approved", "is_active": True, "demo_data": True, "demo_persona": "k12"},
                {"id": "deleted-teacher-user", "email": "deleted@example.com", "tenant_role": "teacher", "teacher_id": "deleted-teacher", "organization_id": "org-1", "approval_status": "deleted", "is_active": False, "account_deleted": True},
                {"id": "school-admin", "email": "admin@example.com", "tenant_role": "school_admin", "organization_id": "org-1", "approval_status": "approved", "is_active": True},
                {"id": "training-admin", "email": "training@example.com", "tenant_role": "training_admin", "organization_id": "training-org", "approval_status": "approved", "is_active": True},
                {"id": "demo-admin", "email": "demo-admin@example.com", "tenant_role": "school_admin", "organization_id": "demo-org", "approval_status": "approved", "is_active": True, "demo_data": True, "demo_persona": "k12"},
                {"id": "super-admin", "email": "super@example.com", "tenant_role": "super_admin", "approval_status": "approved", "is_active": True},
            ]
        ),
        organizations=_Collection(
            [
                {"id": "org-1", "name": "Real Org", "demo_data": False},
                {"id": "demo-org", "name": "Demo Org", "demo_data": True},
                {"id": "training-org", "name": "Training Org", "organization_type": "training", "demo_data": False},
            ]
        ),
        schools=_Collection([]),
        teachers=_Collection(
            [
                {"id": "teacher-1", "name": "Teacher One", "email": "teacher@example.com", "organization_id": "org-1", "created_by": "school-admin", "subject": "Math", "grade_level": "4"},
                {"id": "deleted-teacher", "name": "Deleted Teacher", "email": "deleted@example.com", "organization_id": "org-1", "created_by": "school-admin"},
                {"id": "other-teacher", "name": "Other Teacher", "email": "other@example.com", "organization_id": "other-org", "created_by": "other-admin"},
                {"id": "demo-teacher-1", "name": "Demo Teacher", "email": "demo-teacher@example.com", "organization_id": "demo-org", "created_by": "demo-admin", "subject": "Math", "grade_level": "4", "demo_data": True, "demo_persona": "k12"},
            ]
        ),
        consent_records=_Collection([]),
        teacher_face_profiles=_Collection([]),
        teacher_face_references=_Collection([]),
        videos=_Collection([]),
        assessments=_Collection(
            [
                {"id": "assessment-1", "teacher_id": "teacher-1", "video_id": "video-1", "summary": "A useful coaching summary is ready.", "analyzed_at": (now - timedelta(days=2)).isoformat()},
                {"id": "assessment-other", "teacher_id": "other-teacher", "video_id": "video-other", "summary": "Other workspace", "analyzed_at": now.isoformat()},
            ]
        ),
        observations=_Collection([]),
        observation_sessions=_Collection([]),
        coaching_tasks=_Collection([{"id": "task-1", "teacher_id": "teacher-1", "title": "Follow-up", "status": "open"}]),
        recognition_badges=_Collection([{"id": "badge-1", "teacher_id": "teacher-1", "title": "Strong Student Voice", "status": "awarded"}]),
        video_comments=_Collection([{"id": "comment-1", "teacher_id": "teacher-1", "video_id": "video-1", "visibility": "shared_with_teacher", "body": "Moment to revisit"}]),
        video_analysis_features=_Collection([]),
        gradebook_reminders=_Collection([{"id": "grade-1", "teacher_id": "teacher-1", "title": "Gradebook reminder", "status": "due_soon"}]),
        coaching_task_reflections=_Collection([]),
        schedules=_Collection([]),
        dashboard_intelligence_cache=_Collection([]),
        custom_domains=_Collection([]),
        framework_selections=_Collection([]),
    )


def _client(monkeypatch, user):
    monkeypatch.setattr(server, "db", _db())
    server.app.dependency_overrides[server.get_current_user] = lambda: user
    client = TestClient(server.app)
    return client


@pytest.fixture(autouse=True)
def _clear_overrides():
    server.app.dependency_overrides.clear()
    yield
    server.app.dependency_overrides.clear()


def test_endpoint_routes_are_mounted_under_api():
    paths = {route.path for route in server.app.routes}
    assert "/api/me" in paths
    assert "/api/health/version" in paths
    assert "/api/institutions/lookup" in paths
    assert "/api/onboarding/status" in paths
    assert "/api/frameworks" in paths
    assert "/api/frameworks/selection/current" in paths
    assert "/api/dashboard/intelligence" in paths
    assert "/api/reports/coaching-snapshot" in paths
    assert "/api/reports/cohort-snapshot" in paths
    assert "/api/teachers/me/dashboard" in paths
    assert "/api/teachers/me/lessons" in paths
    assert "/api/teachers/me/coaching" in paths
    assert "/api/teachers/me/profile" in paths
    assert "/api/teachers/me/recognition" in paths
    assert "/api/demo/seed" in paths
    assert "/api/admin/workspace/dashboard" in paths
    assert "/api/admin/workspace/search" in paths
    ordered_paths = [route.path for route in server.app.routes]
    assert ordered_paths.index("/api/teachers/me/dashboard") < ordered_paths.index("/api/teachers/{teacher_id}/dashboard")
    assert ordered_paths.index("/api/teachers/me/recognition") < ordered_paths.index("/api/teachers/{teacher_id}/recognition")
    assert ordered_paths.index("/api/frameworks/selection/current") < ordered_paths.index("/api/frameworks/{framework_type}")


def test_api_me_alias_returns_current_user(monkeypatch):
    client = _client(monkeypatch, {"id": "school-admin", "email": "admin@example.com", "tenant_role": "school_admin", "approval_status": "approved", "is_active": True})

    response = client.get("/api/me")

    assert response.status_code == 200
    assert response.json()["email"] == "admin@example.com"


@pytest.mark.parametrize(
    "path",
    [
        "/api/institutions/lookup?organization_type=school&q=Test&limit=6",
        "/api/frameworks",
        "/api/admin/workspace/dashboard",
        "/api/teachers/me/dashboard",
        "/api/demo/seed",
    ],
)
def test_production_frontend_origin_preflight_is_allowed(path):
    client = TestClient(server.app)

    response = client.options(
        path,
        headers={
            "Origin": "https://app.cognivio.live",
            "Access-Control-Request-Method": "GET" if path != "/api/demo/seed" else "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://app.cognivio.live"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_health_version_returns_safe_build_payload():
    client = TestClient(server.app)

    response = client.get("/api/health/version")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert payload["service"] == "cognivio-api"
    assert "server_time" in payload
    assert "build" in payload
    assert "JWT_SECRET" not in str(payload)


def test_frameworks_route_returns_default_payload_for_empty_settings(monkeypatch):
    client = _client(monkeypatch, {"id": "school-admin", "email": "admin@example.com", "tenant_role": "school_admin", "organization_id": "org-1", "approval_status": "approved", "is_active": True})

    response = client.get("/api/frameworks")
    selection = client.get("/api/frameworks/selection/current")

    assert response.status_code == 200
    assert selection.status_code == 200
    payload = response.json()
    assert isinstance(payload["frameworks"], list)
    assert payload["default_framework_id"] == "danielson"
    assert payload["active_framework_id"] == "danielson"
    assert payload["summary"]["total"] >= 1
    assert payload["empty_state"]["title"]


def test_teacher_dashboard_and_recognition_empty_payloads_are_200(monkeypatch):
    client = _client(monkeypatch, {"id": "new-teacher-user", "email": "new@example.com", "tenant_role": "teacher", "approval_status": "approved", "is_active": True})

    dashboard = client.get("/api/teachers/me/dashboard?period=semester")
    recognition = client.get("/api/teachers/me/recognition")

    assert dashboard.status_code == 200
    assert recognition.status_code == 200
    dashboard_payload = dashboard.json()
    for key in ["readiness", "next_best_action", "latest_lesson", "highlights", "action_items", "trends", "communications", "schedule", "gradebook_reminders", "reports", "recognition", "demo_eligible"]:
        assert key in dashboard_payload
    assert dashboard_payload["readiness"]["teacher_profile_complete"] is False
    assert dashboard_payload["next_best_action"]["href"] == "/my-profile"
    recognition_payload = recognition.json()
    for key in ["badges", "accolades", "highlighted_moments", "spotlight_lessons", "share_cards", "summary", "demo_eligible"]:
        assert key in recognition_payload
    assert recognition_payload["summary"]["total_earned"] == 0


def test_deleted_teacher_user_cannot_get_active_dashboard(monkeypatch):
    client = _client(monkeypatch, {"id": "deleted-teacher-user", "email": "deleted@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1", "approval_status": "deleted", "is_active": False, "account_deleted": True})

    response = client.get("/api/teachers/me/dashboard")

    assert response.status_code == 403


def test_teacher_dashboard_excludes_other_workspace_data(monkeypatch):
    client = _client(monkeypatch, {"id": "teacher-user", "email": "teacher@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-1", "approval_status": "approved", "is_active": True})

    response = client.get("/api/teachers/me/dashboard")

    assert response.status_code == 200
    serialized = str(response.json())
    assert "Other workspace" not in serialized
    assert response.json()["recognition"]["total_earned"] == 1


def test_demo_seed_permissions_and_idempotence(monkeypatch):
    demo_user = {"id": "demo-teacher-user", "email": "demo-teacher@example.com", "tenant_role": "teacher", "teacher_id": "demo-teacher-1", "organization_id": "demo-org", "approval_status": "approved", "is_active": True, "demo_data": True, "demo_persona": "k12"}
    client = _client(monkeypatch, demo_user)

    first = client.post("/api/demo/seed", json={"persona": "teacher", "scope": "current_teacher"})
    second = client.post("/api/demo/seed", json={"persona": "teacher", "scope": "current_teacher"})

    assert first.status_code == 200
    assert second.status_code == 200
    payload = first.json()
    for key in ["organizations", "users", "teachers", "videos", "assessments", "comments", "coaching_tasks", "recognition_badges", "grading_items", "reference_images"]:
        assert key in payload["counts"]
    assert client.get("/api/teachers/me/dashboard").json()["demo_eligible"] is True


def test_non_demo_teacher_cannot_seed(monkeypatch):
    client = _client(monkeypatch, {"id": "teacher-user", "email": "teacher@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-1", "approval_status": "approved", "is_active": True})

    response = client.post("/api/demo/seed", json={"persona": "teacher", "scope": "current_teacher"})

    assert response.status_code == 403


def test_admin_workspace_dashboard_and_search_empty_contracts(monkeypatch):
    client = _client(monkeypatch, {"id": "empty-admin", "email": "empty@example.com", "tenant_role": "school_admin", "organization_id": "empty-org", "approval_status": "approved", "is_active": True})

    dashboard = client.get("/api/admin/workspace/dashboard?period=semester")
    search = client.get("/api/admin/workspace/search?q=test")

    assert dashboard.status_code == 200
    assert search.status_code == 200
    payload = dashboard.json()
    for key in ["workspace_id", "workspace_mode", "period", "generated_at", "demo_eligible", "summary", "next_best_actions", "priority_cards", "teacher_attention", "observation_gaps", "coaching_activity", "recognition_candidates", "recent_lessons", "communications", "reports", "gradebook_reminders", "trends", "search_index_summary"]:
        assert key in payload
    assert payload["summary"]["active_teachers"] == 0
    assert search.json()["results"] == []


def test_school_and_training_admin_workspace_dashboard(monkeypatch):
    school_client = _client(monkeypatch, {"id": "school-admin", "email": "admin@example.com", "tenant_role": "school_admin", "organization_id": "org-1", "approval_status": "approved", "is_active": True})
    school = school_client.get("/api/admin/workspace/dashboard")
    assert school.status_code == 200
    assert school.json()["summary"]["active_teachers"] == 1
    assert school.json()["summary"]["gradebook_reminders"] == 1
    assert school.json()["gradebook_reminders"][0]["demo_note"] == "Demo reminder — LMS sync is not connected yet."
    assert "Other Teacher" not in str(school.json())

    training_client = _client(monkeypatch, {"id": "training-admin", "email": "training@example.com", "tenant_role": "training_admin", "organization_id": "training-org", "approval_status": "approved", "is_active": True})
    training = training_client.get("/api/admin/workspace/dashboard?period=semester")
    assert training.status_code == 200
    assert training.json()["workspace_mode"] == "training"
    assert training.json()["summary"]["active_trainees"] == 0


def test_teacher_cannot_access_admin_workspace_dashboard(monkeypatch):
    client = _client(monkeypatch, {"id": "teacher-user", "email": "teacher@example.com", "tenant_role": "teacher", "teacher_id": "teacher-1", "approval_status": "approved", "is_active": True})

    response = client.get("/api/admin/workspace/dashboard")

    assert response.status_code == 403


def test_admin_demo_seed_current_workspace(monkeypatch):
    client = _client(monkeypatch, {"id": "demo-admin", "email": "demo-admin@example.com", "tenant_role": "school_admin", "organization_id": "demo-org", "approval_status": "approved", "is_active": True, "demo_data": True, "demo_persona": "k12"})

    response = client.post("/api/demo/seed", json={"persona": "k12", "scope": "current_workspace"})

    assert response.status_code == 200
    assert response.json()["scope"] == "current_workspace"
    assert response.json()["counts"]["teachers"] >= 1


def test_super_admin_can_seed_all_when_demo_mode_enabled(monkeypatch):
    async def _fake_reset(db, persona):
        return {
            "reset_at": datetime.now(timezone.utc).isoformat(),
            "teachers_seeded": 2,
            "assessments_seeded": 3,
            "tasks_seeded": 4,
            "badges_seeded": 5,
        }

    monkeypatch.setattr(seed_demo_data, "reset_demo_data_for_persona", _fake_reset)
    monkeypatch.setattr(server, "DEMO_MODE", True)
    client = _client(monkeypatch, {"id": "super-admin", "email": "super@example.com", "tenant_role": "super_admin", "approval_status": "approved", "is_active": True})

    response = client.post("/api/demo/seed", json={"persona": "all", "scope": "global", "confirm": "SEED DEMO DATA"})

    assert response.status_code == 200
    assert response.json()["scope"] == "global"
    assert response.json()["counts"]["teachers"] == 2
