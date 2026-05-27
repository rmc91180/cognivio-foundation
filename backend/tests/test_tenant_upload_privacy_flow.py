import asyncio
from io import BytesIO
from pathlib import Path
import types

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

import server


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

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor(
            [self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})]
        )

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def insert_many(self, docs):
        for doc in docs:
            self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_ids=[doc.get("id") for doc in docs])

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                return types.SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            payload = dict(query)
            payload.update(update.get("$set", {}))
            self.docs.append(payload)
            return types.SimpleNamespace(modified_count=1, matched_count=1)
        return types.SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update):
        count = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                next_doc.update(update.get("$set", {}))
                self.docs[index] = next_doc
                count += 1
        return types.SimpleNamespace(modified_count=count)

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
            if isinstance(value, dict):
                doc_value = doc.get(key)
                for operator, expected in value.items():
                    if operator == "$in":
                        if doc_value not in expected:
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


def _privacy_image(name: str) -> UploadFile:
    # Valid 1x1 PNG
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02\x00\x00\x00\x0bIDATx\xdac\xfc\xff"
        b"\x1f\x00\x03\x03\x02\x00\xed\x99/[\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return UploadFile(
        file=BytesIO(png_bytes),
        filename=name,
        headers=Headers({"content-type": "image/png"}),
    )


def _video_file(name: str) -> UploadFile:
    return UploadFile(
        file=BytesIO(b"fake-mp4-data"),
        filename=name,
        headers=Headers({"content-type": "video/mp4"}),
    )


def _fake_school_db():
    return types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "school-admin-1",
                    "email": "principal@example.com",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-1",
                },
                {
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "tenant_role": "teacher",
                    "organization_id": "org-school-1",
                    "school_id": "school-1",
                    "teacher_id": "teacher-1",
                },
                {
                    "id": "school-admin-2",
                    "email": "otherprincipal@example.com",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-2",
                },
            ]
        ),
        schools=_Collection(
            [
                {"id": "school-1", "organization_id": "org-school-1", "user_id": "school-admin-1", "name": "Sunrise"},
                {"id": "school-2", "organization_id": "org-school-2", "user_id": "school-admin-2", "name": "Riverside"},
            ]
        ),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "name": "Teacher One",
                    "email": "teacher1@example.com",
                    "subject": "Math",
                    "grade_level": "5",
                    "school_id": "school-1",
                    "organization_id": "org-school-1",
                    "created_by": "school-admin-1",
                },
                {
                    "id": "teacher-2",
                    "name": "Teacher Two",
                    "email": "teacher2@example.com",
                    "subject": "Science",
                    "grade_level": "6",
                    "school_id": "school-2",
                    "organization_id": "org-school-2",
                    "created_by": "school-admin-2",
                },
            ]
        ),
        teacher_face_profiles=_Collection([]),
        teacher_face_references=_Collection([]),
        consent_records=_Collection([]),
        videos=_Collection([]),
        video_evidence=_Collection([]),
    )


def _grant_required_consents(fake_db, user_id="teacher-user-1", workspace_id="org-school-1"):
    fake_db.consent_records.docs.extend(
        {
            "id": f"consent-{consent_type}",
            "user_id": user_id,
            "workspace_id": workspace_id,
            "consent_type": consent_type,
            "granted": True,
            "granted_at": "2026-05-01T00:00:00+00:00",
            "version": "2026-05",
            "created_at": "2026-05-01T00:00:00+00:00",
        }
        for consent_type in server.CONSENT_TYPES
    )


def _add_ready_reference_images(fake_db, teacher_id="teacher-1", workspace_id="org-school-1", count=4):
    fake_db.teacher_face_profiles.docs.append(
        {
            "id": f"profile-{teacher_id}",
            "teacher_id": teacher_id,
            "status": "active",
            "profile_version": 1,
            "reference_count": count,
        }
    )
    fake_db.teacher_face_references.docs.extend(
        {
            "id": f"ref-{teacher_id}-{index}",
            "teacher_id": teacher_id,
            "workspace_id": workspace_id,
            "profile_id": f"profile-{teacher_id}",
            "status": "ready",
            "file_path": f"privacy/{teacher_id}/ref-{index}.png",
            "created_at": "2026-05-01T00:00:00+00:00",
        }
        for index in range(count)
    )


def test_teacher_can_upsert_privacy_profile_inside_school_tenant(monkeypatch):
    fake_db = _fake_school_db()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(
        server,
        "_save_privacy_reference_file",
        lambda upload, teacher_id, profile_id: asyncio.sleep(0, result=(f"privacy/{teacher_id}/{profile_id}/{upload.filename}", f"https://cdn.example.com/{upload.filename}", f"privacy/{upload.filename}")),
    )
    monkeypatch.setattr(server, "_log_privacy_audit_event", lambda *args, **kwargs: asyncio.sleep(0))

    response = asyncio.run(
        server.upsert_teacher_privacy_profile(
            "teacher-1",
            files=[_privacy_image("ref1.png"), _privacy_image("ref2.png"), _privacy_image("ref3.png"), _privacy_image("ref4.png")],
            replace_existing=False,
            current_user={
                "id": "teacher-user-1",
                "email": "teacher1@example.com",
                "tenant_role": "teacher",
                "organization_id": "org-school-1",
            },
        )
    )

    assert response.status == "active"
    assert response.reference_count == 4
    assert len(fake_db.teacher_face_profiles.docs) == 1
    assert len(fake_db.teacher_face_references.docs) == 4


def test_cross_tenant_school_admin_cannot_upsert_privacy_profile(monkeypatch):
    fake_db = _fake_school_db()
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upsert_teacher_privacy_profile(
                "teacher-1",
                files=[_privacy_image("ref1.png"), _privacy_image("ref2.png"), _privacy_image("ref3.png"), _privacy_image("ref4.png")],
                replace_existing=False,
                current_user={
                    "id": "school-admin-2",
                    "email": "otherprincipal@example.com",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-2",
                },
            )
        )

    assert exc.value.status_code == 403


def test_teacher_video_upload_queues_transcode_inside_tenant(monkeypatch, tmp_path):
    fake_db = _fake_school_db()
    _grant_required_consents(fake_db)
    _add_ready_reference_images(fake_db)
    queued_jobs = []

    async def _enqueue_video_transcode_job(**kwargs):
        queued_jobs.append(kwargs)

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "UPLOAD_DIR", Path(tmp_path))
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_PIPELINE_ENABLED", True)
    monkeypatch.setattr(
        server,
        "_upload_path_to_s3",
        lambda *args, **kwargs: ("uploads/videos/raw/teacher-1/lesson.mp4", "https://cdn.example.com/lesson.mp4"),
    )
    monkeypatch.setattr(server, "_enqueue_video_transcode_job", _enqueue_video_transcode_job)
    monkeypatch.setattr(server, "_get_recording_policy", lambda *args, **kwargs: asyncio.sleep(0, result=None))
    monkeypatch.setattr(server, "_log_privacy_audit_event", lambda *args, **kwargs: asyncio.sleep(0))

    response = asyncio.run(
        server.upload_video(
            request=types.SimpleNamespace(headers={}),
            file=_video_file("lesson.mp4"),
            teacher_id="teacher-1",
            subject=None,
            recorded_at=None,
            current_user={
                "id": "teacher-user-1",
                "email": "teacher1@example.com",
                "role": "teacher",
                "tenant_role": "teacher",
                "organization_id": "org-school-1",
            },
        )
    )

    assert response.teacher_id == "teacher-1"
    assert response.transcode_status == "queued"
    assert len(fake_db.videos.docs) == 1
    video_doc = fake_db.videos.docs[0]
    assert video_doc["id"] == response.id
    assert video_doc["teacher_id"] == "teacher-1"
    assert video_doc["created_at"] == video_doc["upload_date"]
    assert video_doc["original_filename"] == "lesson.mp4"
    assert video_doc["raw_asset_state"] == "stored"
    assert video_doc["processed_asset_state"] == "not_created"
    assert video_doc["redacted_asset_state"] == "not_created"
    assert video_doc["source_chain_status"] == "canonical_video_record_created"
    assert len(fake_db.video_evidence.docs) == 1
    assert queued_jobs[0]["teacher_id"] == "teacher-1"


def test_teacher_readiness_progression_separates_consent_profile_and_reference_images(monkeypatch):
    fake_db = _fake_school_db()
    monkeypatch.setattr(server, "db", fake_db)
    user = {
        "id": "teacher-user-1",
        "email": "teacher1@example.com",
        "tenant_role": "teacher",
        "teacher_id": "teacher-1",
        "organization_id": "org-school-1",
    }
    teacher = dict(fake_db.teachers.docs[0])
    teacher["subject"] = ""

    readiness = asyncio.run(server._teacher_readiness(teacher, user))
    assert readiness["setup_next_step"]["code"] == "PRIVACY_CONSENT_REQUIRED"
    assert readiness["upload_ready"] is False

    _grant_required_consents(fake_db)
    readiness = asyncio.run(server._teacher_readiness(teacher, user))
    assert readiness["privacy_consent_complete"] is True
    assert readiness["setup_next_step"]["code"] == "TEACHER_PROFILE_REQUIRED"
    assert all(item["code"] != "PRIVACY_CONSENT_REQUIRED" for item in readiness["missing_items"])

    teacher["subject"] = "Math"
    readiness = asyncio.run(server._teacher_readiness(teacher, user))
    assert readiness["setup_next_step"]["code"] == "REFERENCE_IMAGES_REQUIRED"

    _add_ready_reference_images(fake_db)
    readiness = asyncio.run(server._teacher_readiness(teacher, user))
    assert readiness["setup_next_step"] is None
    assert readiness["missing_items"] == []
    assert readiness["privacy_reference_images_count"] == 4
    assert readiness["upload_ready"] is True


def test_upload_endpoint_returns_exact_readiness_blockers(monkeypatch, tmp_path):
    fake_db = _fake_school_db()
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "UPLOAD_DIR", Path(tmp_path))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upload_video(
                request=types.SimpleNamespace(headers={}),
                file=_video_file("lesson.mp4"),
                teacher_id="teacher-1",
                subject=None,
                recorded_at=None,
                current_user={
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "teacher_id": "teacher-1",
                    "organization_id": "org-school-1",
                },
            )
        )

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "PRIVACY_CONSENT_REQUIRED"
    assert exc.value.detail["message"] == "Complete privacy consent before uploading videos."

    _grant_required_consents(fake_db)
    fake_db.teachers.docs[0]["subject"] = ""
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upload_video(
                request=types.SimpleNamespace(headers={}),
                file=_video_file("lesson.mp4"),
                teacher_id="teacher-1",
                subject=None,
                recorded_at=None,
                current_user={
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "teacher_id": "teacher-1",
                    "organization_id": "org-school-1",
                },
            )
        )
    assert exc.value.detail["code"] == "TEACHER_PROFILE_REQUIRED"

    fake_db.teachers.docs[0]["subject"] = "Math"
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upload_video(
                request=types.SimpleNamespace(headers={}),
                file=_video_file("lesson.mp4"),
                teacher_id="teacher-1",
                subject=None,
                recorded_at=None,
                current_user={
                    "id": "teacher-user-1",
                    "email": "teacher1@example.com",
                    "role": "teacher",
                    "tenant_role": "teacher",
                    "teacher_id": "teacher-1",
                    "organization_id": "org-school-1",
                },
            )
        )
    assert exc.value.detail["code"] == "REFERENCE_IMAGES_REQUIRED"
    assert exc.value.detail["message"] == "Add at least 4 teacher reference photos before uploading videos."


def test_another_teachers_reference_images_do_not_satisfy_readiness(monkeypatch):
    fake_db = _fake_school_db()
    _grant_required_consents(fake_db)
    _add_ready_reference_images(fake_db, teacher_id="teacher-2", workspace_id="org-school-2", count=4)
    monkeypatch.setattr(server, "db", fake_db)

    readiness = asyncio.run(
        server._teacher_readiness(
            fake_db.teachers.docs[0],
            {
                "id": "teacher-user-1",
                "email": "teacher1@example.com",
                "tenant_role": "teacher",
                "teacher_id": "teacher-1",
                "organization_id": "org-school-1",
            },
        )
    )

    assert readiness["privacy_reference_images_count"] == 0
    assert readiness["setup_next_step"]["code"] == "REFERENCE_IMAGES_REQUIRED"


def test_admin_upload_checks_target_teacher_readiness_not_admin_readiness(monkeypatch, tmp_path):
    fake_db = _fake_school_db()
    _grant_required_consents(fake_db, user_id="school-admin-1", workspace_id="org-school-1")
    _add_ready_reference_images(fake_db)
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "UPLOAD_DIR", Path(tmp_path))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            server.upload_video(
                request=types.SimpleNamespace(headers={}),
                file=_video_file("lesson.mp4"),
                teacher_id="teacher-1",
                subject=None,
                recorded_at=None,
                current_user={
                    "id": "school-admin-1",
                    "email": "principal@example.com",
                    "role": "admin",
                    "tenant_role": "school_admin",
                    "organization_id": "org-school-1",
                },
            )
        )

    assert exc.value.detail["code"] == "PRIVACY_CONSENT_REQUIRED"


def test_school_admin_video_list_stays_school_scoped(monkeypatch):
    fake_db = _fake_school_db()
    fake_db.videos.docs.extend(
        [
            {
                "id": "video-1",
                "teacher_id": "teacher-1",
                "uploaded_by": "teacher-user-1",
                "filename": "lesson-1.mp4",
                "privacy_status": "completed",
                "analysis_status": "completed",
                "transcode_status": "completed",
                "processed_file_url": "https://cdn.example.com/lesson-1.mp4",
                "upload_date": "2026-04-13T10:00:00+00:00",
            },
            {
                "id": "video-2",
                "teacher_id": "teacher-2",
                "uploaded_by": "teacher-user-2",
                "filename": "lesson-2.mp4",
                "privacy_status": "completed",
                "analysis_status": "completed",
                "transcode_status": "completed",
                "processed_file_url": "https://cdn.example.com/lesson-2.mp4",
                "upload_date": "2026-04-13T10:00:00+00:00",
            },
        ]
    )
    monkeypatch.setattr(server, "db", fake_db)

    videos = asyncio.run(
        server.get_videos(
            teacher_id=None,
            current_user={
                "id": "school-admin-1",
                "email": "principal@example.com",
                "role": "admin",
                "tenant_role": "school_admin",
                "organization_id": "org-school-1",
            },
        )
    )

    assert len(videos) == 1
    assert videos[0]["id"] == "video-1"
