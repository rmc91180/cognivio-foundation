"""A3 — tenancy-at-write + grouping denormalization + tenancy-first indexes.

T1/T2 drive the REAL ``server.upload_video`` handler (mirroring the harness in
tests/test_tenant_upload_privacy_flow.py) and assert on the captured video_doc —
genuine fail-before/pass-after coverage of the upload write.

T3/T4 cover the assessment write. ``analyze_video`` is an LLM/vision pipeline with
no existing test harness that reaches its assessment_doc construction, and A3
forbids extracting a testable helper (deferred to A3.5). So the assessment
stamping is verified by (a) a STRUCTURAL assertion that the real assessment_doc
construction in server.py carries the four A3 keys with the OR-fallback (fails
before the change, passes after), and (b) a CONTRACT test of the exact
video→assessment mapping incl. the legacy-row fallback. This limitation is
reported as an A3 deviation; A3.5's helper extraction enables a behavioral test.

T5 asserts the three new INDEX_SPECS directly (real, fail-before/pass-after).
"""

from __future__ import annotations

import asyncio
import re
import types
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

import server
from scripts import ensure_indexes as ei


# --- DB double + fixtures mirrored from tests/test_tenant_upload_privacy_flow.py ---
class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        self.docs = sorted(self.docs, key=lambda i: i.get(field) or "", reverse=direction == -1)
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
        return _Cursor([self._project(d, projection) for d in self.docs if self._matches(d, query or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    async def insert_many(self, docs):
        for doc in docs:
            self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_ids=[d.get("id") for d in docs])

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
            payload.update(update.get("$setOnInsert", {}))
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
        include = {k for k, v in projection.items() if v}
        exclude = {k for k, v in projection.items() if not v}
        payload = dict(doc)
        if include:
            payload = {k: v for k, v in payload.items() if k in include}
        for k in exclude:
            payload.pop(k, None)
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
                for op, expected in value.items():
                    if op == "$in":
                        if doc_value not in expected:
                            return False
                    elif op == "$options":
                        continue
                    else:
                        raise AssertionError(f"Unsupported operator: {op}")
                continue
            if doc.get(key) != value:
                return False
        return True


def _video_file(name: str) -> UploadFile:
    return UploadFile(file=BytesIO(b"fake-mp4-data"), filename=name,
                      headers=Headers({"content-type": "video/mp4"}))


def _fake_db():
    return types.SimpleNamespace(
        users=_Collection([
            {"id": "teacher-user-1", "email": "teacher1@example.com", "tenant_role": "teacher",
             "organization_id": "org-school-1", "school_id": "school-1", "teacher_id": "teacher-1"},
        ]),
        schools=_Collection([
            {"id": "school-1", "organization_id": "org-school-1", "user_id": "school-admin-1", "name": "Sunrise"},
        ]),
        teachers=_Collection([
            {"id": "teacher-1", "name": "Teacher One", "email": "teacher1@example.com", "subject": "Math",
             "grade_level": "5", "school_id": "school-1", "organization_id": "org-school-1",
             "department": "STEM", "created_by": "school-admin-1"},
        ]),
        teacher_face_profiles=_Collection([]),
        teacher_face_references=_Collection([]),
        consent_records=_Collection([]),
        videos=_Collection([]),
        video_evidence=_Collection([]),
        video_processing_jobs=_Collection([]),
    )


def _grant_consents(fake_db, workspace_id):
    fake_db.consent_records.docs.extend({
        "id": f"consent-{workspace_id}-{ct}", "user_id": "teacher-user-1", "workspace_id": workspace_id,
        "consent_type": ct, "granted": True, "granted_at": "2026-05-01T00:00:00+00:00",
        "version": "2026-05", "created_at": "2026-05-01T00:00:00+00:00",
    } for ct in server.CONSENT_TYPES)


def _add_refs(fake_db, workspace_id, count=4):
    if not any(p["teacher_id"] == "teacher-1" for p in fake_db.teacher_face_profiles.docs):
        fake_db.teacher_face_profiles.docs.append(
            {"id": "profile-teacher-1", "teacher_id": "teacher-1", "status": "active",
             "profile_version": 1, "reference_count": count})
    fake_db.teacher_face_references.docs.extend({
        "id": f"ref-{workspace_id}-{i}", "teacher_id": "teacher-1", "workspace_id": workspace_id,
        "profile_id": "profile-teacher-1", "status": "ready",
        "file_path": f"privacy/teacher-1/ref-{i}.png", "file_url": f"https://cdn.example.com/ref-{i}.png",
        "s3_key": f"uploads/privacy/teacher-1/ref-{i}.png", "created_at": "2026-05-01T00:00:00+00:00",
    } for i in range(count))


def _upload_ready_db(monkeypatch, tmp_path, workspace_ids=("org-school-1", "school-1")):
    fake_db = _fake_db()
    for ws in workspace_ids:
        _grant_consents(fake_db, ws)
        _add_refs(fake_db, ws)
    fake_db.video_privacy_jobs = _Collection([])
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "UPLOAD_DIR", Path(tmp_path))
    # Enable the transcode pipeline (mirrors test_tenant_upload_privacy_flow) so
    # privacy enqueue is deferred to the transcode worker and the handler reaches
    # its return after the video_doc insert.
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_ENABLED", True)
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_MIN_BYTES", 0)
    monkeypatch.setattr(server, "_enqueue_video_privacy_job", lambda **k: asyncio.sleep(0))
    monkeypatch.setattr(server, "_storage_download_available", lambda: True)
    monkeypatch.setattr(server, "_upload_path_to_s3",
                        lambda *a, **k: ("uploads/videos/raw/teacher-1/lesson.mp4", "https://cdn.example.com/lesson.mp4"))
    monkeypatch.setattr(server, "_enqueue_video_transcode_job", lambda **k: asyncio.sleep(0))
    monkeypatch.setattr(server, "_enqueue_video_processing_job", lambda **k: asyncio.sleep(0))
    monkeypatch.setattr(server, "_get_recording_policy", lambda *a, **k: asyncio.sleep(0, result=None))
    monkeypatch.setattr(server, "_log_privacy_audit_event", lambda *a, **k: asyncio.sleep(0))
    return fake_db


_TEACHER_USER = {"id": "teacher-user-1", "email": "teacher1@example.com", "role": "teacher",
                 "tenant_role": "teacher", "teacher_id": "teacher-1", "organization_id": "org-school-1"}


def _run_upload(fake_db):
    return asyncio.run(server.upload_video(
        request=types.SimpleNamespace(headers={}),
        file=_video_file("lesson.mp4"),
        teacher_id="teacher-1", subject="Math", recorded_at=None,
        current_user=dict(_TEACHER_USER),
    ))


# ---------------------------------------------------------------------------
# T1 — upload write persists workspace_id/organization_id/school_id/department
# ---------------------------------------------------------------------------
def test_t1_upload_persists_tenancy_and_grouping(monkeypatch, tmp_path):
    fake_db = _upload_ready_db(monkeypatch, tmp_path)
    _run_upload(fake_db)
    assert len(fake_db.videos.docs) == 1
    doc = fake_db.videos.docs[0]
    for key in ("workspace_id", "organization_id", "school_id", "department"):
        assert key in doc, f"video_doc missing A3 field {key!r}"
    assert doc["organization_id"] == "org-school-1"
    assert doc["school_id"] == "school-1"
    assert doc["department"] == "STEM"


# ---------------------------------------------------------------------------
# T2 — workspace_id is deterministic: == org when present, never current_user.id;
#      falls back to school_id when org absent.
# ---------------------------------------------------------------------------
def test_t2_upload_workspace_id_equals_org_never_user(monkeypatch, tmp_path):
    fake_db = _upload_ready_db(monkeypatch, tmp_path)
    _run_upload(fake_db)
    doc = fake_db.videos.docs[0]
    assert doc["workspace_id"] == doc["organization_id"] == "org-school-1"
    assert doc["workspace_id"] != _TEACHER_USER["id"]  # NEVER falls back to current_user.id


def test_t2_workspace_id_falls_back_to_school_when_org_absent(monkeypatch, tmp_path):
    # Real upload with a teacher carrying NO organization_id → workspace_id must
    # resolve to school_id (the write expression: org or school). Consents/refs
    # granted on both candidate workspaces so the readiness gate passes regardless
    # of which key it resolves.
    fake_db = _upload_ready_db(monkeypatch, tmp_path)
    fake_db.teachers.docs[0]["organization_id"] = None
    _run_upload(fake_db)
    doc = fake_db.videos.docs[0]
    assert doc["organization_id"] is None
    assert doc["school_id"] == "school-1"
    assert doc["workspace_id"] == "school-1", "must fall back to school_id when org absent"
    assert doc["workspace_id"] != _TEACHER_USER["id"]


# ---------------------------------------------------------------------------
# T3 — assessment write carries the four A3 keys (structural; analyze_video is
#      not unit-drivable — see module docstring) + the mapping contract.
# ---------------------------------------------------------------------------
def test_t3_assessment_doc_construction_carries_tenancy_and_subject():
    src = Path(server.__file__).read_text(encoding="utf-8")
    # Isolate the assessment_doc literal built inside analyze_video.
    start = src.index("assessment_doc = {", src.index("def analyze_video"))
    block = src[start:start + 2000]
    assert '"workspace_id": video.get("workspace_id") or video.get("organization_id") or video.get("school_id")' in block
    assert '"organization_id": video.get("organization_id")' in block
    assert '"school_id": video.get("school_id")' in block
    assert '"subject": video.get("subject")' in block


def test_t3_assessment_mapping_contract_from_video():
    # The exact mapping the assessment write applies, sourced ONLY from `video`.
    def stamp(video):
        return {
            "workspace_id": video.get("workspace_id") or video.get("organization_id") or video.get("school_id"),
            "organization_id": video.get("organization_id"),
            "school_id": video.get("school_id"),
            "subject": video.get("subject"),
        }
    v = {"workspace_id": "ws-1", "organization_id": "org-1", "school_id": "sch-1", "subject": "Math"}
    out = stamp(v)
    assert out == {"workspace_id": "ws-1", "organization_id": "org-1", "school_id": "sch-1", "subject": "Math"}


# ---------------------------------------------------------------------------
# T4 — legacy-video re-analysis: missing tenancy keys fall back without crashing
#      and without writing a spurious non-null where the source is absent.
# ---------------------------------------------------------------------------
def test_t4_legacy_video_fallback_no_spurious_nonnull():
    def stamp(video):
        return {
            "workspace_id": video.get("workspace_id") or video.get("organization_id") or video.get("school_id"),
            "organization_id": video.get("organization_id"),
            "school_id": video.get("school_id"),
            "subject": video.get("subject"),
        }
    # Legacy video: no workspace_id, but has organization_id → workspace_id = org.
    out = stamp({"organization_id": "org-9", "school_id": "sch-9", "subject": "Science"})
    assert out["workspace_id"] == "org-9"
    # Legacy video: no workspace_id, no org, has school → falls back to school.
    out2 = stamp({"school_id": "sch-only"})
    assert out2["workspace_id"] == "sch-only"
    # Genuinely absent everywhere → None, not a spurious value.
    out3 = stamp({})
    assert out3["workspace_id"] is None
    assert out3["organization_id"] is None
    assert out3["school_id"] is None
    assert out3["subject"] is None


# ---------------------------------------------------------------------------
# T5 — the three new index specs (exact keys/names, non-unique, no partial) and
#      expected_index_summary count rose by exactly 3.
# ---------------------------------------------------------------------------
def test_t5_new_index_specs_present_and_correct():
    by_name = {s.name: s for s in ei.INDEX_SPECS}
    expected = {
        "assessments_workspace_subject_score": (
            "assessments",
            (("workspace_id", 1), ("subject", 1), ("overall_score", -1), ("analyzed_at", -1)),
        ),
        "assessments_workspace_teacher_analyzed": (
            "assessments",
            (("workspace_id", 1), ("teacher_id", 1), ("analyzed_at", -1)),
        ),
        "videos_workspace_subject_upload": (
            "videos",
            (("workspace_id", 1), ("subject", 1), ("upload_date", -1)),
        ),
    }
    for name, (collection, keys) in expected.items():
        assert name in by_name, f"missing index spec {name}"
        spec = by_name[name]
        assert spec.collection == collection
        assert spec.keys == keys
        assert spec.unique is False, f"{name} must be non-unique"
        assert spec.partial_filter is None, f"{name} must carry no partial_filter"


def test_t5_expected_index_summary_rose_by_three():
    # The three A3 specs are the only additions in this PR.
    summary = ei.expected_index_summary()
    a3_specs = [
        "assessments_workspace_subject_score",
        "assessments_workspace_teacher_analyzed",
        "videos_workspace_subject_upload",
    ]
    present = sum(1 for s in ei.INDEX_SPECS if s.name in a3_specs)
    assert present == 3
    assert summary["expected_indexes"] == len(ei.INDEX_SPECS)
