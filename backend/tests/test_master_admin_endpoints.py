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

    def find(self, query, projection=None):
        return _Cursor([self._project(doc, projection) for doc in self.docs if self._matches(doc, query)])

    @staticmethod
    def _project(doc, projection):
        if projection is None:
            return dict(doc)
        include_keys = {key for key, value in projection.items() if value}
        if not include_keys:
            return dict(doc)
        return {key: value for key, value in doc.items() if key in include_keys}

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
                    if operator == "$gte":
                        if not doc_value or doc_value < expected:
                            return False
                    elif operator == "$in":
                        if doc_value not in expected:
                            return False
                    elif operator == "$ne":
                        if doc_value == expected:
                            return False
                    else:
                        raise AssertionError(f"Unsupported operator: {operator}")
                continue
            if doc.get(key) != value:
                return False
        return True


def test_master_admin_overview_returns_global_counts(monkeypatch):
    now = "2026-04-12T10:00:00+00:00"
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "super-1",
                    "email": "rmc91180@gmail.com",
                    "name": "RMC Master Admin",
                    "role": "super_admin",
                    "approval_status": "approved",
                    "is_active": True,
                    "last_login_at": now,
                    "created_at": now,
                },
                {
                    "id": "teacher-1",
                    "email": "teacher@example.com",
                    "name": "Teacher One",
                    "role": "teacher",
                    "approval_status": "pending",
                    "is_active": False,
                    "approval_requested_at": now,
                    "created_at": now,
                },
            ]
        ),
        videos=_Collection(
            [
                {
                    "id": "video-1",
                    "filename": "lesson.mp4",
                    "created_at": now,
                    "transcode_status": "failed",
                    "privacy_status": "completed",
                    "analysis_status": "completed",
                    "status_updated_at": now,
                },
                {
                    "id": "video-2",
                    "filename": "lesson-2.mp4",
                    "created_at": now,
                    "transcode_status": "processing",
                    "privacy_status": "review_required",
                    "analysis_status": "queued",
                    "status_updated_at": now,
                },
            ]
        ),
    )

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "refresh_runtime_metrics", lambda: asyncio.sleep(0))
    monkeypatch.setattr(
        server,
        "app_metrics",
        types.SimpleNamespace(
            snapshot_summary=lambda: {
                "dependencies": {"mongodb": 1.0, "openai": 1.0, "storage": 0.0},
            }
        ),
    )
    monkeypatch.setattr(server, "VIDEO_JOB_QUEUE", types.SimpleNamespace(qsize=lambda: 2))
    monkeypatch.setattr(server, "VIDEO_PRIVACY_JOB_QUEUE", types.SimpleNamespace(qsize=lambda: 1))
    monkeypatch.setattr(server, "VIDEO_TRANSCODE_JOB_QUEUE", types.SimpleNamespace(qsize=lambda: 3))

    result = asyncio.run(
        server.get_master_admin_overview({"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"})
    )

    assert any(card.id == "pending-users" and card.value == 1 for card in result.cards)
    assert any(card.id == "pipeline-failures" and card.value == 1 for card in result.cards)
    assert result.queue_summary["transcode_queue_depth"] == 3
    assert "storage" in result.dependency_summary["unhealthy"]
    assert result.pending_approvals_preview[0].id == "teacher-1"


def test_master_admin_users_filters_by_approval_status(monkeypatch):
    fake_db = types.SimpleNamespace(
        users=_Collection(
            [
                {
                    "id": "u1",
                    "email": "approved@example.com",
                    "name": "Approved User",
                    "role": "teacher",
                    "approval_status": "approved",
                    "is_active": True,
                    "created_at": "2026-04-12T10:00:00+00:00",
                },
                {
                    "id": "u2",
                    "email": "pending@example.com",
                    "name": "Pending User",
                    "role": "teacher",
                    "approval_status": "pending",
                    "is_active": False,
                    "approval_requested_at": "2026-04-12T10:00:00+00:00",
                    "created_at": "2026-04-12T10:00:00+00:00",
                },
            ]
        ),
        teachers=_Collection([]),
        videos=_Collection([]),
        assessments=_Collection([]),
    )

    monkeypatch.setattr(server, "db", fake_db)

    result = asyncio.run(
        server.get_master_admin_users(
            approval_status="pending",
            current_user={"id": "super-1", "email": "rmc91180@gmail.com", "role": "super_admin"},
        )
    )

    assert result.total == 1
    assert result.items[0].id == "u2"
    assert result.summary["pending"] == 1


def test_institution_lookup_returns_existing_school_matches(monkeypatch):
    fake_db = types.SimpleNamespace(
        organizations=_Collection(
            [
                {
                    "id": "org-1",
                    "name": "Sunrise Network",
                    "organization_type": "school",
                    "seat_limit": 10,
                }
            ]
        ),
        schools=_Collection(
            [
                {
                    "id": "school-1",
                    "name": "Sunrise Elementary",
                    "organization_id": "org-1",
                }
            ]
        ),
        users=_Collection(
            [
                {
                    "id": "admin-1",
                    "email": "principal@sunrise.edu",
                    "name": "Principal One",
                    "tenant_role": "school_admin",
                    "organization_id": "org-1",
                    "school_id": "school-1",
                    "approval_status": "approved",
                    "is_active": True,
                    "last_login_at": "2026-04-12T10:00:00+00:00",
                }
            ]
        ),
        teachers=_Collection([]),
        videos=_Collection([]),
        assessments=_Collection([]),
    )
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_refresh_processing_incidents", lambda: asyncio.sleep(0, result=[]))

    result = asyncio.run(server.lookup_institutions("school", q="sunrise"))

    assert len(result.suggestions) == 1
    assert result.suggestions[0].organization_name == "Sunrise Network"
    assert result.suggestions[0].school_name == "Sunrise Elementary"
    assert result.suggestions[0].manager_email == "principal@sunrise.edu"
