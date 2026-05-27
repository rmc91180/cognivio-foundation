import asyncio
import os
import types

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

import server
from scripts.audit_video_source_chain import audit_documents


FORENSIC_VIDEO_ID = "f01d6f7c-23e4-48a3-80d7-7e6dc15ee65f"
FORENSIC_ASSESSMENT_ID = "4bf34ab6-5d57-4837-a266-9ca79c1c473c"
FORENSIC_TEACHER_ID = "d36bcacb-fb19-4d97-8753-f0944131505b"


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

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

    async def delete_many(self, query):
        survivors = [doc for doc in self.docs if not self._matches(doc, query or {})]
        deleted_count = len(self.docs) - len(survivors)
        self.docs = survivors
        return types.SimpleNamespace(deleted_count=deleted_count)

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        include = {key for key, value in projection.items() if value}
        exclude = {key for key, value in projection.items() if not value}
        payload = dict(doc)
        if include:
            payload = {key: value for key, value in payload.items() if key in include}
        for key in exclude:
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


def test_source_chain_upload_fields_preserve_canonical_metadata():
    fields = server._build_video_source_chain_upload_fields(
        upload_time="2026-05-27T10:00:00+00:00",
        original_filename="lesson.mp4",
        original_size_bytes=1234,
        raw_file_path="videos/teacher-1/video.mp4",
        raw_file_url=None,
        raw_s3_key="uploads/videos/raw/teacher-1/video.mp4",
    )

    assert fields["created_at"] == "2026-05-27T10:00:00+00:00"
    assert fields["original_filename"] == "lesson.mp4"
    assert fields["original_size_bytes"] == 1234
    assert fields["raw_asset_state"] == "stored"
    assert fields["source_asset_state"] == "stored"
    assert fields["processed_asset_state"] == "not_created"
    assert fields["redacted_asset_state"] == "not_created"
    assert fields["source_chain_status"] == "canonical_video_record_created"


def test_raw_asset_deletion_preserves_video_document_and_processed_metadata(monkeypatch):
    videos = _Collection(
        [
            {
                "id": "video-1",
                "teacher_id": "teacher-1",
                "raw_file_path": "videos/teacher-1/video-1.mov",
                "raw_s3_key": "raw/video-1.mov",
                "processed_file_path": "processed/teacher-1/video-1.mp4",
                "processed_file_url": "https://cdn.example/video-1.mp4",
                "redacted_file_path": "redacted/teacher-1/video-1.mp4",
            }
        ]
    )
    monkeypatch.setattr(server, "db", types.SimpleNamespace(videos=videos))

    asyncio.run(
        server._mark_raw_video_asset_deleted(
            "video-1",
            reason="privacy_raw_retention_expired",
            deleted_at="2026-05-27T10:05:00+00:00",
        )
    )

    assert len(videos.docs) == 1
    video = videos.docs[0]
    assert video["raw_file_path"] is None
    assert video["raw_s3_key"] is None
    assert video["raw_asset_state"] == "deleted"
    assert video["source_asset_state"] == "deleted"
    assert video["raw_deleted_at"] == "2026-05-27T10:05:00+00:00"
    assert video["raw_deletion_reason"] == "privacy_raw_retention_expired"
    assert video["processed_file_path"] == "processed/teacher-1/video-1.mp4"
    assert video["redacted_file_path"] == "redacted/teacher-1/video-1.mp4"


def test_enqueue_processing_blocks_missing_canonical_video(monkeypatch):
    fake_db = types.SimpleNamespace(
        videos=_Collection([]),
        video_processing_jobs=_Collection([]),
        processing_incidents=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "VIDEO_JOB_QUEUE", asyncio.Queue())

    with pytest.raises(RuntimeError, match="Canonical video source record is missing"):
        asyncio.run(
            server._enqueue_video_processing_job(
                video_id=FORENSIC_VIDEO_ID,
                teacher_id=FORENSIC_TEACHER_ID,
                user_id="1157f8a4-c438-4c96-8934-bdbe804036a3",
                file_path="/tmp/missing.mp4",
            )
        )

    assert fake_db.video_processing_jobs.docs == []
    assert fake_db.processing_incidents.docs[0]["incident_type"] == "missing_source_video"
    assert fake_db.processing_incidents.docs[0]["video_id"] == FORENSIC_VIDEO_ID


def test_coaching_task_creation_blocks_orphaned_assessment(monkeypatch):
    fake_db = types.SimpleNamespace(
        teachers=_Collection([{"id": FORENSIC_TEACHER_ID, "name": "Teacher"}]),
        videos=_Collection([]),
        coaching_tasks=_Collection([]),
        processing_incidents=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)

    tasks = asyncio.run(
        server._create_coaching_tasks_for_assessment(
            {
                "id": FORENSIC_ASSESSMENT_ID,
                "video_id": FORENSIC_VIDEO_ID,
                "teacher_id": FORENSIC_TEACHER_ID,
                "user_id": "observer-1",
                "element_scores": [{"element_id": "d1b", "score": 1.5}],
            },
            video=None,
            teacher=None,
            observer_user={"id": "observer-1"},
        )
    )

    assert tasks == []
    assert fake_db.coaching_tasks.docs == []
    assert fake_db.processing_incidents.docs[0]["assessment_id"] == FORENSIC_ASSESSMENT_ID
    assert fake_db.processing_incidents.docs[0]["incident_type"] == "missing_source_video"


def test_audit_script_detects_known_forensic_orphan_pattern():
    report = audit_documents(
        {
            "videos": [],
            "assessments": [],
            "coaching_tasks": [
                {
                    "id": "task-1",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                    "assessment_id": FORENSIC_ASSESSMENT_ID,
                }
            ],
            "video_analysis_moments": [
                {
                    "id": "moments-1",
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "video_id": FORENSIC_VIDEO_ID,
                }
            ],
        },
        teacher_id=FORENSIC_TEACHER_ID,
        video_id=FORENSIC_VIDEO_ID,
        assessment_id=FORENSIC_ASSESSMENT_ID,
    )

    assert report["summary"]["total_issues"] == 3
    assert report["issues"]["derived_missing_video_parent"]["count"] == 2
    assert report["issues"]["derived_missing_assessment_parent"]["count"] == 1
    samples = report["issues"]["derived_missing_video_parent"]["samples"]
    assert {sample["video_id"] for sample in samples} == {FORENSIC_VIDEO_ID}


def test_audit_script_flags_raw_deleted_without_processed_or_redacted_asset():
    report = audit_documents(
        {
            "videos": [
                {
                    "id": "video-raw-deleted",
                    "teacher_id": "teacher-1",
                    "status": "completed",
                    "raw_asset_state": "deleted",
                    "analysis_status": "queued",
                }
            ],
            "assessments": [],
        }
    )

    assert "raw_deleted_missing_processed_or_redacted_asset" in report["issues"]


def test_cleanup_paths_cascade_delete_derived_video_artifacts(monkeypatch):
    """Demo reset / smoke cleanup must remove derived artifacts when removing videos.

    This regression test enforces the source-chain fix for cause G: cleanup
    flows that delete the canonical video document must also clear derived
    artifacts that reference the video, otherwise we leave orphans that look
    reviewed.
    """
    fake_db = types.SimpleNamespace(
        videos=_Collection(
            [
                {
                    "id": FORENSIC_VIDEO_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "uploaded_by": "1157f8a4-c438-4c96-8934-bdbe804036a3",
                }
            ]
        ),
        coaching_tasks=_Collection(
            [
                {
                    "id": "task-1",
                    "video_id": FORENSIC_VIDEO_ID,
                    "assessment_id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "observer_id": "another-observer",
                },
                {
                    "id": "task-2",
                    "video_id": FORENSIC_VIDEO_ID,
                    "assessment_id": FORENSIC_ASSESSMENT_ID,
                    "teacher_id": FORENSIC_TEACHER_ID,
                    "observer_id": "1157f8a4-c438-4c96-8934-bdbe804036a3",
                },
            ]
        ),
        video_analysis_moments=_Collection(
            [{"id": "moments-1", "video_id": FORENSIC_VIDEO_ID}]
        ),
        video_audio_transcripts=_Collection(
            [{"id": "transcript-1", "video_id": FORENSIC_VIDEO_ID}]
        ),
        video_analysis_features=_Collection(
            [{"id": "features-1", "video_id": FORENSIC_VIDEO_ID}]
        ),
        analysis_features=_Collection(),
        transcripts=_Collection(),
        video_sampling_manifests=_Collection(
            [{"id": "manifest-1", "video_id": FORENSIC_VIDEO_ID}]
        ),
        coaching_task_reflections=_Collection(
            [{"id": "reflection-1", "assessment_id": FORENSIC_ASSESSMENT_ID}]
        ),
    )
    monkeypatch.setattr(server, "db", fake_db)

    deleted = asyncio.run(
        server._delete_derived_video_artifacts(
            video_ids=[FORENSIC_VIDEO_ID],
            assessment_ids=[FORENSIC_ASSESSMENT_ID],
            teacher_id=FORENSIC_TEACHER_ID,
            context="test_cleanup",
        )
    )

    assert deleted["coaching_tasks"] >= 2  # both observer ids cleared
    assert deleted["video_analysis_moments"] == 1
    assert deleted["video_audio_transcripts"] == 1
    assert deleted["video_analysis_features"] == 1
    assert deleted["video_sampling_manifests"] == 1
    assert deleted["coaching_task_reflections"] == 1
    assert fake_db.coaching_tasks.docs == []
    assert fake_db.video_analysis_moments.docs == []
    assert fake_db.video_audio_transcripts.docs == []
    assert fake_db.video_analysis_features.docs == []
    assert fake_db.video_sampling_manifests.docs == []
    assert fake_db.coaching_task_reflections.docs == []
    # Canonical video document is left untouched by the cascade helper itself;
    # the calling cleanup path is responsible for removing the videos record
    # *after* derived artifacts are cleared.
    assert len(fake_db.videos.docs) == 1
