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
    os.environ.setdefault("FRONTEND_URL", "https://app.example.com")
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
    spec = importlib.util.spec_from_file_location("backend_server_exemplar_helpers", module_path)
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
    for key, value in (query or {}).items():
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


def test_submit_video_exemplar_creates_pending_submission():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher_1", "created_by": "admin_1", "name": "Alicia Stone", "email": "teacher@example.com"}
        ]),
        videos=FakeCollection([
            {"id": "video_1", "teacher_id": "teacher_1", "uploaded_by": "admin_1", "privacy_status": "completed", "analysis_status": "completed"}
        ]),
        assessments=FakeCollection(),
        lesson_recognition_events=FakeCollection([
            {
                "id": "event_1",
                "teacher_id": "teacher_1",
                "video_id": "video_1",
                "recognition_status": "awarded",
                "teacher_opt_in": True,
                "sharing_scope": "cognivio_library",
                "submission_status": "not_submitted",
                "badge_type": server.FIVE_STAR_BADGE,
            }
        ]),
        exemplar_submissions=FakeCollection(),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.submit_video_exemplar(
                "video_1",
                server.ExemplarSubmissionRequest(
                    title="5-Star Lesson: Algebra",
                    summary="High-clarity questioning and pacing.",
                    sharing_scope="cognivio_library",
                    tags=["math", "questioning"],
                ),
                {"id": "admin_1", "email": "principal@demo.cognivio.app"},
            )
        )
    finally:
        server.db = original_db

    assert response.submission_status == "pending_admin_review"
    assert fake_db.exemplar_submissions.docs[0]["sharing_scope"] == "cognivio_library"
    assert fake_db.lesson_recognition_events.docs[0]["submission_status"] == "pending_admin_review"


def test_review_exemplar_submission_approve_creates_library_item():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher_1", "created_by": "admin_1", "name": "Alicia Stone", "email": "teacher@example.com", "grade_level": "8"}
        ]),
        videos=FakeCollection([
            {
                "id": "video_1",
                "teacher_id": "teacher_1",
                "uploaded_by": "admin_1",
                "subject": "Math",
                "redacted_file_url": "https://cdn.example.com/redacted/video_1.mp4",
                "redacted_thumbnail_url": "https://cdn.example.com/redacted/video_1.jpg",
            }
        ]),
        exemplar_submissions=FakeCollection([
            {
                "id": "submission_1",
                "teacher_id": "teacher_1",
                "video_id": "video_1",
                "title": "5-Star Lesson: Algebra",
                "summary": "High-clarity questioning and pacing.",
                "sharing_scope": "cognivio_library",
                "submission_status": "pending_admin_review",
                "tags": ["math", "questioning"],
            }
        ]),
        exemplar_library_items=FakeCollection(),
        lesson_recognition_events=FakeCollection([
            {"id": "event_1", "video_id": "video_1", "submission_status": "pending_admin_review"}
        ]),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.review_exemplar_submission(
                "submission_1",
                server.ExemplarLibraryReviewRequest(
                    decision="approve",
                    reason="Approved for publication.",
                ),
                {"id": "admin_1", "email": "principal@demo.cognivio.app"},
            )
        )
    finally:
        server.db = original_db

    assert response.publication_status == "published"
    assert response.library_item is not None
    assert fake_db.exemplar_library_items.docs[0]["status"] == "published"
    assert fake_db.lesson_recognition_events.docs[0]["submission_status"] == "published"
