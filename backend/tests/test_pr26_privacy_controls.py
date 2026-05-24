import asyncio
import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest


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
    spec = importlib.util.spec_from_file_location("backend_server_pr26_privacy_controls", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeUpdateResult:
    def __init__(self, modified_count=1, matched_count=1):
        self.modified_count = modified_count
        self.matched_count = matched_count


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
        return _project(matches[0], projection) if matches else None

    def find(self, query=None, projection=None):
        return FakeCursor([_project(doc, projection) for doc in self.docs if _matches(doc, query or {})])

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
                return FakeUpdateResult(1, 1)
        if upsert:
            doc = {}
            doc.update(update.get("$setOnInsert", {}))
            doc.update(update.get("$set", {}))
            self.docs.append(doc)
            return FakeUpdateResult(1, 1)
        return FakeUpdateResult(0, 0)

    async def update_many(self, query, update):
        modified = 0
        for index, doc in enumerate(self.docs):
            if _matches(doc, query):
                updated = dict(doc)
                if "$set" in update:
                    updated.update(update["$set"])
                self.docs[index] = updated
                modified += 1
        return FakeUpdateResult(modified, modified)

    async def count_documents(self, query):
        return len([doc for doc in self.docs if _matches(doc, query or {})])


def _matches(doc, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if "$in" in value and doc.get(key) not in value["$in"]:
                return False
            if "$nin" in value and doc.get(key) in value["$nin"]:
                return False
            if "$ne" in value and doc.get(key) == value["$ne"]:
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


def test_forbidden_processing_purpose_is_rejected():
    with pytest.raises(server.HTTPException) as exc:
        server._assert_allowed_processing_purpose("advertising")

    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "forbidden_processing_purpose"


def test_classroom_video_policy_metadata_defaults_to_destructive_blurring():
    fields = server._build_upload_privacy_policy_fields(
        {"id": "user-1", "role": "teacher"},
        {"id": "teacher-1"},
    )

    assert "student_data" in fields["data_classifications"]
    assert "classroom_video_audio" in fields["data_classifications"]
    assert "privacy_blurring" in fields["processing_purposes"]
    assert fields["destructive_blurring_enabled"] is True
    assert fields["privacy_pipeline_state"] == "uploaded_unprocessed"
    assert fields["privacy_gate"]["status"] == "allowed"


def test_privacy_gate_blocks_when_workspace_requires_missing_setup():
    fields = server._build_upload_privacy_policy_fields(
        {"id": "user-1", "privacy_setup_required": True},
        {"id": "teacher-1"},
    )

    with pytest.raises(server.HTTPException) as exc:
        server._ensure_upload_privacy_gate(fields)

    assert exc.value.status_code == 409
    assert exc.value.detail["reason_code"] == "privacy_setup_required"
    assert "recording_notice_confirmed" in exc.value.detail["missing_items"]


def test_forbidden_biometric_purpose_is_rejected():
    with pytest.raises(server.HTTPException) as exc:
        server._assert_allowed_biometric_processing_purpose("recognize_student")

    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "forbidden_biometric_purpose"


def test_saved_biometric_payload_rejects_persistent_identifiers():
    with pytest.raises(server.HTTPException) as exc:
        server._validate_saved_biometric_payload({"face_embedding": [0.1, 0.2]})

    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "prohibited_biometric_field"

    with pytest.raises(server.HTTPException) as embedding_exc:
        server._validate_saved_biometric_payload({"embedding": [0.3]})

    assert embedding_exc.value.detail["reason_code"] == "persistent_biometric_embedding_blocked"


def test_reference_image_policy_is_privacy_blur_only():
    fields = server._build_reference_image_policy_fields()

    assert fields["reference_image_policy"]["allowed_use"] == "privacy_blur_workflow_only"
    assert fields["reference_image_policy"]["persistent_embeddings_allowed"] is False
    assert "authentication" in fields["reference_image_policy"]["prohibited_uses"]


def test_non_identifiable_export_blocks_raw_student_data():
    with pytest.raises(server.HTTPException) as exc:
        server._build_non_identifiable_export_metadata({"raw_file_url": "https://cdn.example/raw.mp4"})

    assert exc.value.status_code == 422
    assert exc.value.detail["reason_code"] == "identifiable_export_field_blocked"

    metadata = server._build_non_identifiable_export_metadata({"aggregate_rows": [{"count": 12}]})
    assert metadata["deidentification_status"] == "aggregated_only"
    assert metadata["no_reidentification_required"] is True


def test_ai_output_safeguards_block_determinative_fields_and_language():
    with pytest.raises(server.HTTPException) as exc:
        server._assert_ai_output_safeguards({"employment_decision": "retain"})

    assert exc.value.detail["reason_code"] == "prohibited_ai_output_field"

    with pytest.raises(server.HTTPException) as phrase_exc:
        server._assert_ai_output_safeguards({"summary": "This is a teacher ranking."})

    assert phrase_exc.value.detail["reason_code"] == "prohibited_ai_output_language"


def test_admin_cannot_set_teacher_exemplar_authorization():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher-1", "created_by": "admin-1", "email": "teacher@example.com", "name": "Alicia Stone"}
        ]),
        videos=FakeCollection([
            {"id": "video-1", "teacher_id": "teacher-1", "uploaded_by": "admin-1", "privacy_status": "completed", "analysis_status": "completed"}
        ]),
        assessments=FakeCollection([
            {"id": "assessment-1", "video_id": "video-1", "overall_score": 9.2, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection(),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(
                server.update_video_recognition_opt_in(
                    "video-1",
                    server.RecognitionOptInRequest(
                        teacher_opt_in=True,
                        sharing_scope="cognivio_library",
                        allow_social_share=True,
                    ),
                    {"id": "admin-1", "email": "principal@demo.cognivio.app", "role": "admin"},
                )
            )
    finally:
        server.db = original_db

    assert exc.value.status_code == 403
    assert exc.value.detail["reason_code"] == "teacher_authorization_required"


def test_teacher_can_authorize_exemplar_sharing():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher-1", "created_by": "admin-1", "email": "teacher@example.com", "name": "Alicia Stone"}
        ]),
        videos=FakeCollection([
            {"id": "video-1", "teacher_id": "teacher-1", "uploaded_by": "admin-1", "privacy_status": "completed", "analysis_status": "completed"}
        ]),
        assessments=FakeCollection([
            {"id": "assessment-1", "video_id": "video-1", "overall_score": 9.2, "analyzed_at": "2026-03-18T10:00:00Z"}
        ]),
        lesson_recognition_events=FakeCollection(),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.update_video_recognition_opt_in(
                "video-1",
                server.RecognitionOptInRequest(
                    teacher_opt_in=True,
                    sharing_scope="cognivio_library",
                    allow_social_share=True,
                ),
                {"id": "teacher-user-1", "teacher_id": "teacher-1", "tenant_role": "teacher", "role": "teacher"},
            )
        )
    finally:
        server.db = original_db

    assert response.teacher_opt_in is True
    stored_event = fake_db.lesson_recognition_events.docs[0]
    assert stored_event["teacher_authorized_by"] == "teacher-user-1"
    assert stored_event["blurred_required"] is True
    assert stored_event["promotional_use_allowed"] is False


def test_exemplar_publication_requires_redacted_asset_and_records_institution_authorization():
    fake_db = types.SimpleNamespace(
        teachers=FakeCollection([
            {"id": "teacher-1", "created_by": "admin-1", "name": "Alicia Stone", "grade_level": "5"}
        ]),
        videos=FakeCollection([
            {
                "id": "video-1",
                "teacher_id": "teacher-1",
                "uploaded_by": "admin-1",
                "privacy_status": "completed",
                "redacted_file_url": "https://cdn.example/redacted.mp4",
                "redacted_thumbnail_url": "https://cdn.example/thumb.jpg",
            }
        ]),
        exemplar_submissions=FakeCollection([
            {
                "id": "submission-1",
                "video_id": "video-1",
                "teacher_id": "teacher-1",
                "teacher_display_name": "Alicia Stone",
                "title": "Strong discussion",
                "summary": "Students built on one another's thinking.",
                "sharing_scope": "cognivio_library",
                "submission_status": "pending_admin_review",
                "teacher_opt_in": True,
                "teacher_authorized_by": "teacher-user-1",
            }
        ]),
        exemplar_library_items=FakeCollection(),
        lesson_recognition_events=FakeCollection([
            {"id": "event-1", "video_id": "video-1", "teacher_id": "teacher-1", "teacher_opt_in": True}
        ]),
        recognition_audit_events=FakeCollection(),
    )
    original_db = server.db
    server.db = fake_db
    try:
        response = asyncio.run(
            server.review_exemplar_submission(
                "submission-1",
                server.ExemplarLibraryReviewRequest(decision="approve", reason="Ready for library."),
                {"id": "admin-1", "role": "admin"},
            )
        )
    finally:
        server.db = original_db

    assert response.publication_status == "published"
    library_item = fake_db.exemplar_library_items.docs[0]
    assert library_item["blurred_required"] is True
    assert library_item["unblurred_allowed"] is False
    assert library_item["promotional_use_allowed"] is False
    assert library_item["institution_authorized_by"] == "admin-1"

