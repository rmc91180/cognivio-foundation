"""A1 coverage-hole close: HTTP-level proof that the admin unblurred-source
endpoint refuses quarantined videos.

The 49 existing foundation tests pin the StorageGateway *contract* offline, but
none of them ever HTTP-GET ``/api/videos/{id}/raw-access`` — which is exactly
why the unwired handler stayed invisible. This module exercises the real route
(``app.routers.videos`` → ``video_service.get_video_raw_access`` →
``STORAGE_GATEWAY.vend_raw_url``) through a FastAPI ``TestClient`` and asserts:

  * BOTH quarantine states (``privacy_status == "review_required"`` and
    ``privacy_pipeline_state == "destructive_blur_failed"``) return 404 EVEN
    THOUGH a resolvable raw asset is present — proving the 404 is the quarantine
    gate, not a missing asset.
  * A non-quarantined video with the SAME raw asset + SAME admin + reason
    returns 200 and an http(s) ``access_url`` that is NEVER a ``/uploads`` disk
    path. This positive control is what distinguishes "refused because
    quarantined" from "refused because no asset", so the 404s above are real.

Runs fully offline: ``server.db`` is monkeypatched to an in-memory fake (the
same shape the rest of the suite uses) and ``get_current_user`` is overridden;
nothing hits the network or R2. The raw asset is a syntactically-valid https URL
so ``vend_raw_url`` WOULD vend it if the video were not quarantined.

Run:  cd backend && python -m pytest tests/foundation/test_raw_access_quarantine.py -q
"""

from __future__ import annotations

import types
from urllib.parse import urlparse

import pytest
from fastapi.testclient import TestClient

import server


# A real, resolvable raw asset URL. It is a plain https object URL (no
# "/uploads/" disk segment), so vend_raw_url returns it directly when the video
# is not quarantined — that is the whole point: the asset WOULD vend.
RESOLVABLE_RAW_URL = "https://signed.example/raw/teacher-1/v1.mp4"

ADMIN_USER = {
    "id": "admin-1",
    "email": "admin@school.test",
    "role": "admin",
    "tenant_role": "school_admin",
    "organization_id": "org-1",
}


class _Collection:
    """Minimal async Mongo collection stand-in (matches the suite's pattern)."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query, projection=None, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query or {}):
                return self._project(doc, projection)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return types.SimpleNamespace(inserted_id=doc.get("id"))

    @staticmethod
    def _project(doc, projection):
        payload = dict(doc)
        if not projection:
            return payload
        exclude = {key for key, value in projection.items() if not value}
        for key in exclude:
            payload.pop(key, None)
        return payload

    def _matches(self, doc, query):
        for key, value in query.items():
            if doc.get(key) != value:
                return False
        return True


def _base_video(**overrides):
    """A video owned by ADMIN_USER's teacher, with a resolvable raw asset."""
    video = {
        "id": "v1",
        "teacher_id": "teacher-1",
        "uploaded_by": "admin-1",
        "raw_file_url": RESOLVABLE_RAW_URL,
        "raw_s3_key": "uploads/videos/raw/teacher-1/v1.mp4",
        "privacy_status": "completed",
        "privacy_pipeline_state": "blurred_verified",
        "unblurred_deletion_status": "not_started",
    }
    video.update(overrides)
    return video


def _fake_db(video):
    return types.SimpleNamespace(
        videos=_Collection([video]),
        teachers=_Collection(
            [
                {
                    "id": "teacher-1",
                    "email": "teacher1@school.test",
                    "name": "Teacher One",
                    "organization_id": "org-1",
                    "created_by": "admin-1",
                }
            ]
        ),
        privacy_audit_events=_Collection([]),
    )


def _client(monkeypatch, video):
    monkeypatch.setattr(server, "db", _fake_db(video))
    server.app.dependency_overrides[server.get_current_user] = lambda: ADMIN_USER
    return TestClient(server.app)


@pytest.fixture(autouse=True)
def _clear_overrides():
    server.app.dependency_overrides.clear()
    yield
    server.app.dependency_overrides.clear()


def test_raw_access_route_is_mounted_under_api():
    paths = {route.path for route in server.app.routes}
    assert "/api/videos/{video_id}/raw-access" in paths


# ---------------------------------------------------------------------------
# Quarantine — a PRESENT, resolvable raw asset must still be refused (404).
# ---------------------------------------------------------------------------

QUARANTINE_CASES = [
    pytest.param({"privacy_status": "review_required"}, id="privacy_status=review_required"),
    pytest.param(
        {"privacy_pipeline_state": "destructive_blur_failed"},
        id="privacy_pipeline_state=destructive_blur_failed",
    ),
]


@pytest.mark.parametrize("overrides", QUARANTINE_CASES)
def test_quarantined_video_raw_access_is_refused(monkeypatch, overrides):
    client = _client(monkeypatch, _base_video(**overrides))

    response = client.get("/api/videos/v1/raw-access", params={"reason": "qa-privacy-audit"})

    # The raw asset WOULD vend (see positive control) — the 404 is the
    # unconditional quarantine refusal, not a missing asset.
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Positive control — same admin, same reason, same resolvable raw asset, but
# NOT quarantined → 200 with a real object-store URL (never a /uploads path).
# ---------------------------------------------------------------------------

def test_non_quarantined_video_raw_access_vends_object_url(monkeypatch):
    client = _client(monkeypatch, _base_video())  # privacy_status="completed"

    response = client.get("/api/videos/v1/raw-access", params={"reason": "qa-privacy-audit"})

    assert response.status_code == 200
    access_url = response.json()["access_url"]
    assert access_url == RESOLVABLE_RAW_URL
    assert access_url.startswith("https://")
    # "Never a disk path" is a HOST invariant, not a path-substring one: a real
    # R2 vend URL legitimately contains "uploads/" as the object-key prefix
    # (https://<bucket>.<acct>.r2.cloudflarestorage.com/uploads/videos/raw/...),
    # so a `"/uploads/" not in url` check would false-fail on real R2. A disk
    # leak instead surfaces on the app's OWN origin (or a relative path with an
    # empty netloc). Assert the URL points at an external object-store host.
    host = urlparse(access_url).netloc.split(":")[0].lower()
    APP_ORIGIN_HOSTS = {"", "testserver", "127.0.0.1", "localhost"}
    assert host not in APP_ORIGIN_HOSTS, (
        f"raw access_url must vend an external object-store host, not a disk/app-origin "
        f"path; got netloc {host!r} from {access_url!r}"
    )
