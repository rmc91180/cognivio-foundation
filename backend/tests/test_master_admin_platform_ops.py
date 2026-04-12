import asyncio
import types

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

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if self._matches(doc, query))

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return self._project(doc, projection)
        return None

    def find(self, query=None, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query or {})])

    async def update_one(self, query, update, upsert=False):
        updated = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                for key, value in (update.get("$set") or {}).items():
                    next_doc[key] = value
                self.docs[index] = next_doc
                updated += 1
                break
        if not updated and upsert:
            payload = dict(query)
            for key, value in (update.get("$set") or {}).items():
                payload[key] = value
            self.docs.append(payload)
            updated = 1
        return types.SimpleNamespace(modified_count=updated, matched_count=updated)

    async def update_many(self, query, update):
        updated = 0
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                next_doc = dict(doc)
                for key, value in (update.get("$set") or {}).items():
                    next_doc[key] = value
                self.docs[index] = next_doc
                updated += 1
        return types.SimpleNamespace(modified_count=updated)

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
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    elif operator == "$gte":
                        if not doc_value or doc_value < expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def test_master_admin_platform_ops_endpoints(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {"id": "super-1", "email": "rmc91180@gmail.com", "name": "RMC Master Admin", "role": "super_admin", "approval_status": "approved", "is_active": True, "created_at": "2026-04-12T10:00:00+00:00"},
                {"id": "admin-1", "email": "admin@example.com", "name": "Admin One", "role": "admin", "approval_status": "approved", "is_active": True, "created_at": "2026-04-12T10:00:00+00:00"},
                {"id": "teacher-user-1", "email": "teacher@example.com", "name": "Teacher User", "role": "teacher", "teacher_id": "teacher-1", "approval_status": "approved", "is_active": True, "created_at": "2026-04-12T10:05:00+00:00"},
            ]
        ),
        teachers=_Collection(
            [
                {"id": "teacher-1", "name": "Teacher One", "email": "teacher@example.com", "created_by": "admin-1", "school_id": "school-1", "created_at": "2026-04-12T10:00:00+00:00"},
            ]
        ),
        videos=_Collection(
            [
                {
                    "id": "video-1",
                    "teacher_id": "teacher-1",
                    "uploaded_by": "teacher-user-1",
                    "filename": "lesson.mp4",
                    "status": "failed",
                    "privacy_status": "completed",
                    "analysis_status": "failed",
                    "transcode_status": "completed",
                    "error_message": "Analysis timeout",
                    "file_path": "uploads/lesson.mp4",
                    "file_size_bytes": 100,
                    "processed_file_size_bytes": 55,
                    "created_at": "2026-04-12T12:00:00+00:00",
                    "status_updated_at": "2026-04-12T12:15:00+00:00",
                }
            ]
        ),
        assessments=_Collection([]),
        auth_event_log=_Collection(
            [
                {"id": "auth-1", "email": "teacher@example.com", "user_id": "teacher-user-1", "event_type": "login_success", "result": "success", "created_at": "2026-04-12T12:16:00+00:00"},
            ]
        ),
        master_admin_audit_events=_Collection([]),
        user_sessions=_Collection(
            [
                {"id": "session-1", "user_id": "teacher-user-1", "email": "teacher@example.com", "role": "teacher", "created_at": "2026-04-12T12:10:00+00:00", "last_seen_at": "2026-04-12T12:20:00+00:00", "revoked_at": None},
            ]
        ),
        processing_incidents=_Collection([]),
        assessment_report_feedback=_Collection(
            [
                {"id": "feedback-1", "user_id": "admin-1", "feedback_value": "useful"},
                {"id": "feedback-2", "user_id": "admin-1", "feedback_value": "not_useful"},
            ]
        ),
        admin_assessment_overrides=_Collection(
            [
                {"id": "override-1", "admin_id": "admin-1", "override_type": "recommendation_usefulness"},
            ]
        ),
        video_processing_jobs=_Collection([]),
        video_privacy_jobs=_Collection([]),
        video_transcode_jobs=_Collection([]),
        teacher_face_profiles=_Collection([]),
        organization_memory=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "refresh_runtime_metrics", lambda: asyncio.sleep(0))
    monkeypatch.setattr(
        server,
        "app_metrics",
        types.SimpleNamespace(snapshot_summary=lambda: {"dependencies": {"mongodb": 1.0, "openai": 1.0, "railway_runtime": 1.0, "storage": 1.0}}),
    )
    import app.services.workspace_service as workspace_service
    monkeypatch.setattr(
        workspace_service,
        "resolve_workspace_mode",
        lambda current_user: asyncio.sleep(0, result={"owner_id": current_user["id"], "effective_mode": "school"}),
    )

    current_user = {"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"}

    incidents = asyncio.run(server.get_master_admin_processing_incidents(current_user=current_user))
    assert incidents.total == 1
    assert incidents.items[0].incident_type == "analysis_failed"

    videos = asyncio.run(server.get_master_admin_videos(current_user=current_user))
    assert videos.total == 1
    assert videos.items[0].latest_error == "Analysis timeout"

    storage = asyncio.run(server.get_master_admin_storage_summary(current_user=current_user))
    assert storage.summary["raw_asset_count"] == 1
    assert storage.summary["processed_asset_count"] == 0

    dependencies = asyncio.run(server.get_master_admin_dependency_health(current_user=current_user))
    assert dependencies.summary["healthy"] >= 1

    ai_quality = asyncio.run(server.get_master_admin_ai_quality(current_user=current_user))
    assert ai_quality.metrics["total_feedback"] == 2

    support = asyncio.run(server.get_master_admin_support_console(q="teacher@example.com", current_user=current_user))
    assert len(support.users) == 1
    assert len(support.sessions) == 1


def test_master_admin_support_actions_revoke_sessions_and_export_bundle(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {"id": "super-1", "email": "rmc91180@gmail.com", "name": "RMC Master Admin", "role": "super_admin", "approval_status": "approved", "is_active": True},
                {"id": "teacher-user-1", "email": "teacher@example.com", "name": "Teacher User", "role": "teacher", "approval_status": "approved", "is_active": True},
            ]
        ),
        teachers=_Collection([]),
        videos=_Collection([]),
        auth_event_log=_Collection([]),
        master_admin_audit_events=_Collection([]),
        user_sessions=_Collection(
            [
                {"id": "session-1", "user_id": "teacher-user-1", "email": "teacher@example.com", "role": "teacher", "created_at": "2026-04-12T12:10:00+00:00", "last_seen_at": "2026-04-12T12:20:00+00:00", "revoked_at": None},
            ]
        ),
        processing_incidents=_Collection([]),
        assessment_report_feedback=_Collection([]),
        admin_assessment_overrides=_Collection([]),
        video_processing_jobs=_Collection([]),
        video_privacy_jobs=_Collection([]),
        video_transcode_jobs=_Collection([]),
        assessments=_Collection([]),
        teacher_face_profiles=_Collection([]),
        organization_memory=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "refresh_runtime_metrics", lambda: asyncio.sleep(0))
    monkeypatch.setattr(
        server,
        "app_metrics",
        types.SimpleNamespace(snapshot_summary=lambda: {"dependencies": {"mongodb": 1.0, "openai": 1.0, "railway_runtime": 1.0, "storage": 1.0}}),
    )
    import app.services.workspace_service as workspace_service
    monkeypatch.setattr(
        workspace_service,
        "resolve_workspace_mode",
        lambda current_user: asyncio.sleep(0, result={"owner_id": current_user["id"], "effective_mode": "school"}),
    )

    current_user = {"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"}
    revoke_result = asyncio.run(
        server.master_admin_revoke_user_sessions(
            "teacher-user-1",
            server.MasterAdminSessionActionPayload(reason="Support reset", confirmation_text="teacher@example.com"),
            current_user=current_user,
        )
    )
    assert revoke_result["revoked_sessions"] == 1
    assert fake_db.user_sessions.docs[0]["revoked_at"] is not None

    bundle = asyncio.run(
        server.export_master_admin_diagnostic_bundle(
            server.MasterAdminDiagnosticBundleRequest(target_type="user", target_id="teacher-user-1"),
            current_user=current_user,
        )
    )
    assert bundle.target_type == "user"
    assert bundle.bundle["sessions"][0]["id"] == "session-1"
