import asyncio
import importlib.util
import os
import sys
import types
from pathlib import Path


def _load_server_module():
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")
    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub
    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub
    module_path = Path(__file__).resolve().parents[1] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_recognition_helpers", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeUpdateResult:
    def __init__(self, modified_count=1):
        self.modified_count = modified_count


class FakeInsertResult:
    def __init__(self, inserted_id="1"):
        self.inserted_id = inserted_id


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction < 0
        self.docs.sort(key=lambda doc: doc.get(field) or "", reverse=reverse)
        return self

    async def to_list(self, limit):
        return list(self.docs[:limit])


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None, sort=None):
        matches = [doc for doc in self.docs if _matches(doc, query or {})]
        if sort:
            for field, direction in reversed(sort):
                matches.sort(key=lambda doc: doc.get(field) or "", reverse=direction < 0)
        if not matches:
            return None
        return _project(matches[0], projection)

    def find(self, query=None, projection=None):
        matches = [_project(doc, projection) for doc in self.docs if _matches(doc, query or {})]
        return FakeCursor(matches)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return FakeInsertResult(doc.get("id") or "1")

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if _matches(doc, query):
                updated = dict(doc)
                if "$set" in update:
                    updated.update(update["$set"])
                if "$inc" in update:
                    for key, value in update["$inc"].items():
                        updated[key] = updated.get(key, 0) + value
                self.docs[index] = updated
                return FakeUpdateResult(1)
        if upsert:
            doc = {}
            if "$setOnInsert" in update:
                doc.update(update["$setOnInsert"])
            if "$set" in update:
                doc.update(update["$set"])
            self.docs.append(doc)
            return FakeUpdateResult(1)
        return FakeUpdateResult(0)


def _matches(doc, query):
    for key, value in query.items():
        if isinstance(value, dict) and "$in" in value:
            if doc.get(key) not in value["$in"]:
                return False
            continue
        if doc.get(key) != value:
            return False
    return True


def _project(doc, projection):
    if not projection:
        return dict(doc)
    projected = dict(doc)
    for key, value in projection.items():
        if value == 0:
            projected.pop(key, None)
    return projected


server = _load_server_module()


def test_build_teacher_recognition_summary_counts_badges():
    badges = [
        {
            "id": "badge_1",
            "badge_type": server.FIVE_STAR_BADGE,
            "status": "awarded",
            "video_id": "video_1",
            "awarded_at": "2026-03-18T10:00:00Z",
            "criteria_snapshot": {"overall_score": 9.4},
        },
        {
            "id": "badge_2",
            "badge_type": "exemplar_published",
            "status": "published",
            "video_id": "video_2",
            "awarded_at": "2026-03-18T11:00:00Z",
            "criteria_snapshot": {},
        },
    ]

    summary = server._build_teacher_recognition_summary("teacher_1", badges)

    assert summary.teacher_id == "teacher_1"
    assert summary.summary["five_star_lessons"] == 1
    assert summary.summary["published_exemplars"] == 1
    assert len(summary.badges) == 2


def test_sync_video_recognition_state_creates_pending_admin_review():
    fake_db = types.SimpleNamespace(
        assessments=FakeCollection([
            {"id": "assessment_1", "video_id": "video_1", "overall_score": 9.5, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        event = asyncio.run(
            server._sync_video_recognition_state(
                {
                    "id": "video_1",
                    "teacher_id": "teacher_1",
                    "privacy_status": "completed",
                    "analysis_status": "completed",
                }
            )
        )
    finally:
        server.db = original_db

    assert event["eligibility_status"] == "eligible"
    assert event["recognition_status"] == "pending_admin_review"
    assert event["badge_type"] == server.FIVE_STAR_BADGE
    assert event["teacher_opt_in"] is False


def test_sync_video_recognition_state_preserves_awarded_status():
    fake_db = types.SimpleNamespace(
        assessments=FakeCollection([
            {"id": "assessment_1", "video_id": "video_1", "overall_score": 8.4, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection([
            {
                "id": "event_1",
                "teacher_id": "teacher_1",
                "video_id": "video_1",
                "eligibility_status": "eligible",
                "eligibility": {"is_eligible": True, "badge_type": server.FIVE_STAR_BADGE, "reasons": []},
                "recognition_status": "awarded",
                "badge_type": server.FIVE_STAR_BADGE,
                "badge_id": "badge_1",
                "teacher_opt_in": True,
                "sharing_scope": "cognivio_library",
                "allow_social_share": True,
                "allow_email_signature": True,
                "submission_status": "not_submitted",
                "created_at": "2026-03-18T10:05:00Z",
                "updated_at": "2026-03-18T10:05:00Z",
            }
        ]),
    )
    original_db = server.db
    server.db = fake_db
    try:
        event = asyncio.run(
            server._sync_video_recognition_state(
                {
                    "id": "video_1",
                    "teacher_id": "teacher_1",
                    "privacy_status": "completed",
                    "analysis_status": "completed",
                }
            )
        )
    finally:
        server.db = original_db

    assert event["recognition_status"] == "awarded"
    assert event["badge_type"] == server.FIVE_STAR_BADGE
    assert event["teacher_opt_in"] is True


def test_build_video_recognition_response_defaults_when_event_missing():
    response = server._build_video_recognition_response(
        {"id": "video_1", "teacher_id": "teacher_1"},
        None,
    )

    assert response.video_id == "video_1"
    assert response.recognition["status"] == "not_evaluated"
    assert response.publication["submission_status"] == "not_submitted"


def test_update_video_recognition_opt_in_persists_teacher_preferences():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher_1", "created_by": "admin_1", "email": "teacher@example.com", "name": "Alicia Stone"}
        ]),
        videos=FakeCollection([
            {"id": "video_1", "teacher_id": "teacher_1", "uploaded_by": "admin_1", "privacy_status": "completed", "analysis_status": "completed"}
        ]),
        assessments=FakeCollection([
            {"id": "assessment_1", "video_id": "video_1", "overall_score": 9.2, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection(),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.update_video_recognition_opt_in(
                "video_1",
                server.RecognitionOptInRequest(
                    teacher_opt_in=True,
                    sharing_scope="cognivio_library",
                    allow_social_share=True,
                    allow_email_signature=True,
                ),
                {"id": "admin_1", "email": "principal@demo.cognivio.app"},
            )
        )
    finally:
        server.db = original_db

    assert response.teacher_opt_in is True
    assert response.sharing_scope == "cognivio_library"
    assert response.allow_social_share is True
    assert response.allow_email_signature is True
    stored_event = fake_db.lesson_recognition_events.docs[0]
    assert stored_event["teacher_opt_in"] is True
    assert stored_event["allow_email_signature"] is True


def test_review_video_recognition_approve_creates_badge():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher_1", "created_by": "admin_1", "email": "teacher@example.com", "name": "Alicia Stone"}
        ]),
        videos=FakeCollection([
            {"id": "video_1", "teacher_id": "teacher_1", "uploaded_by": "admin_1", "privacy_status": "completed", "analysis_status": "completed"}
        ]),
        assessments=FakeCollection([
            {"id": "assessment_1", "video_id": "video_1", "overall_score": 9.6, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection(),
        recognition_badges=FakeCollection(),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.review_video_recognition(
                "video_1",
                server.RecognitionReviewRequest(
                    decision="approve",
                    badge_type=server.FIVE_STAR_BADGE,
                    reason="Strong instructional quality.",
                ),
                {"id": "admin_1", "email": "principal@demo.cognivio.app", "role": "admin"},
            )
        )
    finally:
        server.db = original_db

    assert response.recognition_status == "awarded"
    assert response.badge is not None
    assert response.badge.badge_type == server.FIVE_STAR_BADGE
    assert fake_db.recognition_badges.docs[0]["status"] == "awarded"
    assert fake_db.lesson_recognition_events.docs[0]["recognition_status"] == "awarded"
