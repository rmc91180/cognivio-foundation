"""Adversarial contract test for the StorageGateway (Phase A, A1).

This is the most safety-critical test in Phase A. It pins the gateway's
fail-closed serve contract and the role/override-independent quarantine refusal.

It runs fully offline: the ``mock`` backend touches no disk and no network, and
nothing here imports ``server`` or MongoDB. It exercises the SAME delegation
(``select_playback_asset``) and the SAME ``is_probably_http_url`` resolution gate
that production uses.

Run:  cd backend && python -m pytest tests/foundation/test_storage_gateway_contract.py -v
"""

from __future__ import annotations

import pytest

from app.services import storage_gateway as sg
from app.services.storage_gateway import (
    MockBackend,
    R2Backend,
    StorageGateway,
    build_gateway,
    is_blocked_static_video_path,
)


R2_REDACTED = "https://r2.example.com/uploads/videos/redacted/t1/v1.mp4"
R2_PROCESSED = "https://r2.example.com/uploads/videos/processed/t1/v1.mp4"
R2_RAW = "https://r2.example.com/uploads/videos/raw/t1/v1.mp4"


def make_gateway() -> StorageGateway:
    # mock backend → no disk, no network; default readiness predicate.
    return StorageGateway(MockBackend())


def base_video(**overrides):
    """A COMPLETED, fully-validated, redacted-present video. Override per case."""
    video = {
        "id": "v1",
        "teacher_id": "t1",
        "privacy_status": "completed",
        "privacy_pipeline_state": "blurred_verified",
        "redacted_file_url": R2_REDACTED,
        "redacted_file_path": "redacted/t1/v1.mp4",
        "redacted_asset_state": "stored",
        "redacted_s3_key": "uploads/videos/redacted/t1/v1.mp4",
        "redacted_playback_validation": {"status": "passed"},
        "visual_redaction_validation": {"status": "passed"},
        "processed_file_url": R2_PROCESSED,
        "processed_s3_key": "uploads/videos/processed/t1/v1.mp4",
        "raw_file_url": R2_RAW,
        "raw_s3_key": "uploads/videos/raw/t1/v1.mp4",
        "allow_unblurred_retention": False,
    }
    video.update(overrides)
    return video


# ---------------------------------------------------------------------------
# 1. COMPLETED asset → vends
# ---------------------------------------------------------------------------

def test_completed_redacted_vends_to_teacher():
    gw = make_gateway()
    res = gw.vend_playback_url(
        base_video(), "teacher", allow_raw_for_admin=False, require_redacted_ready=True
    )
    assert res.ok
    assert res.refused is False
    assert res.source == "redacted"
    assert res.url == R2_REDACTED  # the R2 URL, never a /uploads disk path


# ---------------------------------------------------------------------------
# 2. non-COMPLETED asset, no override → REFUSES (playback path)
# ---------------------------------------------------------------------------

def test_non_completed_no_redacted_refuses_teacher_and_admin():
    gw = make_gateway()
    video = base_video(
        privacy_status="queued",
        redacted_file_url=None,
        redacted_file_path=None,
        redacted_asset_state=None,
        redacted_s3_key=None,
    )
    teacher = gw.vend_playback_url(video, "teacher", allow_raw_for_admin=False, require_redacted_ready=True)
    assert teacher.refused and teacher.url is None

    # Admin playback (even allow_raw_for_admin=True) must not vend raw while
    # privacy is not completed — delegation refuses with privacy_not_completed.
    admin = gw.vend_playback_url(video, "admin", allow_raw_for_admin=True)
    assert admin.refused and admin.url is None
    assert admin.reason == "privacy_not_completed"


# ---------------------------------------------------------------------------
# 3. Override is handled by delegation only — the gateway adds no override
#    branch, and never vends MORE than the delegated decision.
# ---------------------------------------------------------------------------

def test_override_does_not_create_a_gateway_side_vend():
    gw = make_gateway()
    # allow_unblurred_retention True but privacy not completed and NO redacted
    # asset present. The struck literal invariant ("override → vends") must NOT
    # resurrect here: delegation refuses, so the gateway refuses.
    video = base_video(
        privacy_status="queued",
        allow_unblurred_retention=True,
        redacted_file_url=None,
        redacted_file_path=None,
        redacted_asset_state=None,
        redacted_s3_key=None,
    )
    teacher = gw.vend_playback_url(video, "teacher", allow_raw_for_admin=False, require_redacted_ready=True)
    assert teacher.refused and teacher.url is None


def test_admin_processed_completed_vends_via_delegation():
    gw = make_gateway()
    # No redacted asset, but processed exists and privacy completed → admin gets
    # processed (delegation decision), resolved to the R2 URL.
    video = base_video(
        redacted_file_url=None,
        redacted_file_path=None,
        redacted_asset_state=None,
        redacted_s3_key=None,
    )
    admin = gw.vend_playback_url(video, "admin", allow_raw_for_admin=True)
    assert admin.ok
    assert admin.source == "processed"
    assert admin.url == R2_PROCESSED


# ---------------------------------------------------------------------------
# 4. QUARANTINE — never vends for ANY role, even with a valid redacted asset
#    AND the institution-policy override stamped. (A1 Q1, the critical case.)
# ---------------------------------------------------------------------------

QUARANTINE_VIDEOS = [
    pytest.param(base_video(privacy_status="review_required"), id="privacy_status=review_required"),
    pytest.param(
        base_video(privacy_status="completed", privacy_pipeline_state="destructive_blur_failed"),
        id="pipeline_state=destructive_blur_failed",
    ),
    # Hardest: terminal-unsafe state PLUS a fully-valid redacted asset PLUS the
    # override stamp. Delegation alone would vend the redacted branch — the
    # gateway's pre-delegation refusal must still win.
    pytest.param(
        base_video(privacy_status="review_required", allow_unblurred_retention=True),
        id="review_required+override+valid_redacted",
    ),
    pytest.param(
        base_video(privacy_pipeline_state="destructive_blur_failed", allow_unblurred_retention=True),
        id="blur_failed+override+valid_redacted",
    ),
]


@pytest.mark.parametrize("video", QUARANTINE_VIDEOS)
@pytest.mark.parametrize(
    "role,allow_raw",
    [("teacher", False), ("observer", False), ("admin", True), ("admin", False)],
)
def test_quarantine_never_vends_playback_for_any_role(video, role, allow_raw):
    gw = make_gateway()
    res = gw.vend_playback_url(video, role, allow_raw_for_admin=allow_raw, require_redacted_ready=False)
    assert res.refused is True
    assert res.url is None
    assert res.reason == "refused_quarantine"


@pytest.mark.parametrize("video", QUARANTINE_VIDEOS)
def test_quarantine_never_vends_admin_raw(video):
    # The admin unblurred-source path (which historically bypassed
    # select_playback_asset) must also refuse in the quarantine states.
    gw = make_gateway()
    res = gw.vend_raw_url(video)
    assert res.refused is True
    assert res.url is None
    assert res.reason == "refused_quarantine"


@pytest.mark.parametrize("video", QUARANTINE_VIDEOS)
def test_quarantine_never_vends_thumbnail(video):
    gw = make_gateway()
    res = gw.vend_thumbnail_url(video)
    assert res.refused is True and res.url is None


# ---------------------------------------------------------------------------
# 5. Internal error resolving status/location → REFUSES (fail-closed)
# ---------------------------------------------------------------------------

def test_backend_resolution_error_fails_closed():
    # A genuine backend storage error while resolving the raw object location
    # must fail closed (refuse), never vend. raw_file_url is a non-http disk
    # path so resolution falls through to the object key, and backend.public_url
    # raises for that key — this exercises the gateway's storage-resolution
    # layer post-Edit-6 (the redacted serve path no longer emits a disk URL).
    backend = MockBackend()
    backend.fail_public_url = True
    gw = StorageGateway(backend)
    video = base_video(
        raw_file_url="/uploads/videos/t1/v1.mp4",  # non-http → forces key resolution
        raw_s3_key="uploads/videos/raw/t1/v1.mp4",
    )
    res = gw.vend_raw_url(video)
    assert res.refused is True
    assert res.url is None
    assert res.reason == "internal_error"


def test_delegation_exception_fails_closed(monkeypatch):
    gw = make_gateway()

    def boom(*_a, **_k):
        raise RuntimeError("delegation blew up")

    monkeypatch.setattr(sg, "select_playback_asset", boom)
    res = gw.vend_playback_url(base_video(), "teacher", allow_raw_for_admin=False)
    assert res.refused is True and res.url is None and res.reason == "internal_error"


# ---------------------------------------------------------------------------
# 6. Never vends a /uploads disk URL — no key, non-http decision URL → refuse
# ---------------------------------------------------------------------------

def test_never_vends_disk_url():
    gw = make_gateway()
    # The redacted asset IS present (path + asset_state), but its only URL is a
    # /uploads DISK url with no object key. Post-Edit-6 a disk url is not
    # vendable, so the gateway refuses — surfaced at the delegation layer as
    # redacted_asset_missing — and NEVER falls back to serving the disk path.
    video = base_video(
        redacted_file_url="/uploads/redacted/t1/v1.mp4",  # disk URL — must never be vended
        redacted_s3_key=None,  # no object key to resolve from
    )
    assert video["redacted_file_path"]                 # asset is genuinely present…
    assert video["redacted_asset_state"] == "stored"   # …not a "missing asset" case
    res = gw.vend_playback_url(video, "teacher", allow_raw_for_admin=False, require_redacted_ready=True)
    assert res.refused is True
    assert res.url is None
    assert res.reason == "redacted_asset_missing"


# ---------------------------------------------------------------------------
# Write + localize storage-axis behavior
# ---------------------------------------------------------------------------

def test_write_asset_returns_object_url(tmp_path):
    gw = make_gateway()
    src = tmp_path / "v1.mp4"
    src.write_bytes(b"data")
    key, url = gw.write_asset(
        key="uploads/videos/raw/t1/v1.mp4", local_path=src, content_type="video/mp4"
    )
    assert key == "uploads/videos/raw/t1/v1.mp4"
    assert url.startswith("https://")


def test_localize_downloads_from_backend(tmp_path):
    backend = MockBackend()
    backend.objects["uploads/videos/raw/t1/v1.mp4"] = b"bytes"
    gw = StorageGateway(backend)
    local = gw.localize(
        s3_key="uploads/videos/raw/t1/v1.mp4", relative_path=None, scratch_dir=tmp_path
    )
    assert local is not None
    assert (tmp_path / "_gw_cache" / "uploads/videos/raw/t1/v1.mp4").exists()


def test_localize_missing_object_fails_closed(tmp_path):
    gw = StorageGateway(MockBackend())
    assert gw.localize(s3_key="nope", relative_path=None, scratch_dir=tmp_path) is None
    assert gw.localize(s3_key=None, relative_path=None, scratch_dir=tmp_path) is None


def test_build_gateway_selects_mock():
    class _S:
        storage_backend = "mock"
        s3_bucket = ""
    gw = build_gateway(_S())
    assert gw.backend_name == "mock"


# ---------------------------------------------------------------------------
# StaticFiles prod-only video guard (Edit 11, belt-and-suspenders)
# ---------------------------------------------------------------------------

# Every prefix the gateway is source-of-truth for, matched against the REAL
# on-disk serve path (not the R2 key). raw=videos/, redacted video=redacted/,
# processed=processed/, redacted thumbnail=thumbnails/redacted/.
GUARDED_PATHS = [
    "/uploads/videos/t1/v1.mp4",
    "/uploads/redacted/t1/v1.mp4",
    "/uploads/processed/t1/v1.mp4",
    "/uploads/thumbnails/redacted/t1/v1.jpg",
]

# Out-of-scope / non-gateway assets that must still serve off disk.
ALLOWED_PATHS = [
    "/uploads/curricula/c1.pdf",
    "/uploads/lesson_plans/l1.pdf",
    "/uploads/syllabi/s1.pdf",
    "/uploads/privacy/profiles/t1/p1/ref.jpg",   # privacy reference images (out of A1 scope)
    "/uploads/thumbnails/t1/v1.jpg",             # non-redacted thumbnail prefix is NOT guarded
]


@pytest.mark.parametrize("path", GUARDED_PATHS)
def test_static_guard_blocks_every_gateway_owned_prefix_under_r2(path):
    assert is_blocked_static_video_path(path, backend_name="r2") is True
    assert is_blocked_static_video_path(path + "?download=1", backend_name="r2") is True  # query ignored


@pytest.mark.parametrize("path", ALLOWED_PATHS)
def test_static_guard_passes_out_of_scope_assets_under_r2(path):
    assert is_blocked_static_video_path(path, backend_name="r2") is False


@pytest.mark.parametrize("path", GUARDED_PATHS)
def test_static_guard_never_blocks_local_dev(path):
    # Dev single-replica legitimately serves on-disk scratch via StaticFiles.
    assert is_blocked_static_video_path(path, backend_name="local") is False


# ---------------------------------------------------------------------------
# R2 backend bounded timeouts (the single new external call must not be unbounded)
# ---------------------------------------------------------------------------

def test_r2_backend_has_bounded_timeouts():
    b = R2Backend(
        bucket="b", region="auto", endpoint="https://e", public_base_url="https://p",
        access_key="k", secret_key="s",
    )
    assert b._connect_timeout > 0
    assert b._read_timeout > 0
    assert b._max_attempts >= 1


# ---------------------------------------------------------------------------
# A1 audit — branch-specific quarantine refusal (redacted-playback + admin-raw).
# Targets the docstring-admitted suspicion that the redacted branch "vends
# unconditionally" and the admin-raw path "bypasses delegation". These pin that
# the top-level, override-independent quarantine refusal dominates BOTH branches
# via the faithful serve invocations — even with a fully-valid asset present AND
# the institution-policy override stamped (the hardest adversarial shape).
# (The parametrized cases above already cover this across roles; these are the
# explicit, branch-named T6/T7 assertions requested by the A1 audit.)
# ---------------------------------------------------------------------------

def test_t6_quarantine_refuses_via_redacted_playback_branch_teacher_serve():
    # Teacher serve IS the redacted-playback branch (require_redacted_ready=True),
    # with a fully-valid redacted asset present AND the override stamped — exactly
    # the shape select_playback_asset would vend unconditionally. The gateway's
    # pre-delegation quarantine refusal must still win (genuinely fail-closed).
    gw = make_gateway()
    video = base_video(privacy_status="review_required", allow_unblurred_retention=True)
    res = gw.vend_playback_url(
        video, "teacher", allow_raw_for_admin=False, require_redacted_ready=True
    )
    assert res.refused is True
    assert res.url is None
    assert res.reason == "refused_quarantine"


def test_t7_quarantine_refuses_via_admin_raw_branch():
    # The admin unblurred-source path historically bypassed delegation entirely.
    # With a valid raw URL present AND the override stamped, vend_raw_url must
    # still refuse under quarantine (genuinely fail-closed: url is None).
    gw = make_gateway()
    video = base_video(
        privacy_pipeline_state="destructive_blur_failed", allow_unblurred_retention=True
    )
    res = gw.vend_raw_url(video)
    assert res.refused is True
    assert res.url is None
    assert res.reason == "refused_quarantine"
