"""Tests for PR C9.2 privacy reference materialization.

Covers the production failure shape (video
``8c81ff86-c0b0-476e-ad5d-7220803577e9`` after PR C9.1) where teacher
reference rows live only in R2/S3 with ``remote_only_but_fetch_disabled``.

These tests are pure (no DB, no FastAPI app) so the harness stays fast. The
storage downloader and URL fetcher are simulated through callables that
write predictable bytes to the destination path.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.services.privacy_reference_materialization import (
    PRIVACY_MATERIALIZATION_FAILURE_CODES,
    cleanup_materialized_privacy_references,
    evaluate_materialization_capability,
    is_allowed_reference_url,
    is_safe_privacy_s3_key,
    materialize_privacy_reference,
    materialize_privacy_references,
    verify_materialized_reference_file,
)

# Minimal JPEG byte sequence (12 bytes — enough to satisfy the magic-byte check).
JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 16
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def _production_shaped_reference(
    *,
    reference_id: str = "ref-prod-1",
    teacher_id: str = "d36bcacb-fb19-4d97-8753-f0944131505b",
    s3_key: str = "uploads/privacy/profiles/d36b/prof/ref.jpg",
    file_url: str | None = "S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev/uploads/privacy/profiles/d36b/prof/ref.jpg",
    file_path: str | None = "privacy/missing.jpg",
) -> Dict[str, Any]:
    """Return a reference document matching the C9.1 forensic fixture exactly."""
    return {
        "id": reference_id,
        "teacher_id": teacher_id,
        "user_id": "user-uploader",
        "workspace_id": "org-school-1",
        "status": "ready",
        "reference_type": "image",
        "file_path": file_path,
        "file_url": file_url,
        "s3_key": s3_key,
        "embedding": [],
        "biometric_artifact_status": "no_persistent_embedding_saved",
        "quality_checks": {"validation_mode": "contract_only"},
        "reference_image_policy": {
            "allowed_use": "privacy_blur_workflow_only",
            "persistent_embeddings_allowed": False,
        },
    }


def _make_storage_downloader(jpeg_bytes: bytes = JPEG_BYTES):
    def downloader(s3_key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(jpeg_bytes)
    return downloader


# ---------------------------------------------------------------------------
# Per-reference materialization
# ---------------------------------------------------------------------------


class TestMaterializePrivacyReference:
    def test_remote_s3_key_materializes_to_temp_file(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference()
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert unusable is None
        assert materialized is not None
        assert materialized.source == "s3_key"
        assert Path(materialized.local_path).exists()
        assert Path(materialized.local_path).read_bytes() == JPEG_BYTES
        assert materialized.cleanup_required is True

    def test_local_path_preferred_when_present(self, tmp_path: Path) -> None:
        local = tmp_path / "local.jpg"
        local.write_bytes(JPEG_BYTES)
        ref = {
            "id": "ref-local-1",
            "teacher_id": "t1",
            "status": "ready",
            "file_path": "local.jpg",
            "s3_key": "uploads/privacy/x.jpg",
        }
        materialized, _ = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path / "tmp",
            upload_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is not None
        assert materialized.source == "local_path"
        assert materialized.cleanup_required is False

    def test_malformed_url_with_valid_s3_key_still_materializes(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference()
        materialized, _ = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is not None

    def test_no_storage_downloader_emits_storage_download_unavailable(
        self, tmp_path: Path
    ) -> None:
        ref = _production_shaped_reference(file_path=None, file_url=None)
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=None,
        )
        assert materialized is None
        assert unusable is not None
        assert "storage_download_unavailable" in unusable.failure_codes

    def test_missing_object_emits_reference_object_not_found(self, tmp_path: Path) -> None:
        def missing_downloader(s3_key: str, destination: Path) -> None:
            raise FileNotFoundError("NoSuchKey")

        ref = _production_shaped_reference()
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=missing_downloader,
        )
        assert materialized is None
        assert unusable is not None
        assert "reference_object_not_found" in unusable.failure_codes

    def test_policy_blocked_reference_does_not_materialize(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference()
        ref["reference_image_policy"] = {"allowed_use": "biometric_authentication"}
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is None
        assert unusable is not None
        assert "reference_policy_blocked" in unusable.failure_codes

    def test_expired_status_does_not_materialize(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference()
        ref["status"] = "deleted"
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is None
        assert unusable is not None
        assert "reference_expired" in unusable.failure_codes

    def test_retention_expired_does_not_materialize(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference()
        ref["retention_expires_at"] = "2000-01-01T00:00:00+00:00"
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
            now_iso="2030-01-01T00:00:00+00:00",
        )
        assert materialized is None
        assert unusable is not None
        assert "reference_expired" in unusable.failure_codes

    def test_no_persistent_embedding_does_not_block_materialization(
        self, tmp_path: Path
    ) -> None:
        ref = _production_shaped_reference()
        assert ref["embedding"] == []
        assert ref["biometric_artifact_status"] == "no_persistent_embedding_saved"
        materialized, _ = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is not None

    def test_unsafe_s3_key_prefix_is_rejected(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference(s3_key="uploads/videos/raw/some.mp4")
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=_make_storage_downloader(),
        )
        assert materialized is None
        assert unusable is not None
        assert "reference_policy_blocked" in unusable.failure_codes


# ---------------------------------------------------------------------------
# Batch + cleanup
# ---------------------------------------------------------------------------


class TestMaterializePrivacyReferencesBatch:
    def test_production_fixture_materializes(self, tmp_path: Path) -> None:
        refs = [_production_shaped_reference(reference_id=f"ref-{i}") for i in range(4)]
        result = materialize_privacy_references(
            refs,
            storage_downloader=_make_storage_downloader(),
        )
        try:
            assert result.total == 4
            assert result.usable_count == 4
            assert all(
                Path(ref.local_path).exists() for ref in result.usable
            )
            assert "no_usable_references" not in result.failure_codes
            assert "remote_only_but_fetch_disabled" not in result.failure_codes
        finally:
            cleanup_materialized_privacy_references(result)
        # All temp files cleaned up.
        for ref in result.usable:
            assert not Path(ref.local_path).exists()

    def test_temp_files_cleaned_up_after_failure(self, tmp_path: Path) -> None:
        ok_ref = _production_shaped_reference(reference_id="ok-1")
        bad_ref = _production_shaped_reference(reference_id="bad-1")
        bad_ref["status"] = "deleted"
        result = materialize_privacy_references(
            [ok_ref, bad_ref],
            storage_downloader=_make_storage_downloader(),
        )
        temp_paths = [ref.local_path for ref in result.usable]
        try:
            assert any(Path(p).exists() for p in temp_paths)
        finally:
            cleanup_materialized_privacy_references(result)
        for path in temp_paths:
            assert not Path(path).exists()
        assert not Path(result.temp_dir or "").exists() if result.temp_dir else True

    def test_no_references_emits_no_reference_records(self, tmp_path: Path) -> None:
        result = materialize_privacy_references([])
        assert result.failure_codes == ("no_reference_records",)
        assert result.temp_dir is None

    def test_all_unusable_emits_no_usable_references(self, tmp_path: Path) -> None:
        bad_refs = [
            _production_shaped_reference(reference_id=f"bad-{i}", s3_key="not-in-privacy-prefix")
            for i in range(2)
        ]
        result = materialize_privacy_references(
            bad_refs,
            storage_downloader=_make_storage_downloader(),
        )
        try:
            assert result.usable_count == 0
            assert "no_usable_references" in result.failure_codes
        finally:
            cleanup_materialized_privacy_references(result)


# ---------------------------------------------------------------------------
# URL fallback
# ---------------------------------------------------------------------------


class TestUrlFetchFallback:
    def test_url_fetch_disabled_blocks_pure_url_only_reference(self, tmp_path: Path) -> None:
        ref = _production_shaped_reference(
            s3_key=None,
            file_url="https://pub-abc.r2.dev/uploads/privacy/x.jpg",
            file_path=None,
        )
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            storage_downloader=None,
            url_fetcher=None,
            url_fetch_enabled=False,
        )
        assert materialized is None
        assert unusable is not None

    def test_url_fetch_enabled_with_allowed_host_materializes(self, tmp_path: Path) -> None:
        def url_fetcher(url, dest, timeout, max_bytes):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(PNG_BYTES)
        ref = _production_shaped_reference(
            s3_key=None,
            file_url="https://pub-abc.r2.dev/uploads/privacy/x.png",
            file_path=None,
        )
        materialized, _ = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            url_fetcher=url_fetcher,
            url_fetch_enabled=True,
            allowed_hosts=("pub-abc.r2.dev",),
        )
        assert materialized is not None
        assert materialized.source == "normalized_url"
        assert "url_fetch_used" in materialized.notes

    def test_url_fetch_rejects_unlisted_host(self, tmp_path: Path) -> None:
        def url_fetcher(url, dest, timeout, max_bytes):
            dest.write_bytes(PNG_BYTES)
        ref = _production_shaped_reference(
            s3_key=None,
            file_url="https://attacker.example.com/x.png",
            file_path=None,
        )
        materialized, unusable = materialize_privacy_reference(
            ref,
            temp_dir=tmp_path,
            url_fetcher=url_fetcher,
            url_fetch_enabled=True,
            allowed_hosts=("pub-abc.r2.dev",),
        )
        assert materialized is None
        assert unusable is not None
        assert "url_fetch_disallowed_host" in unusable.failure_codes


# ---------------------------------------------------------------------------
# Verification + helpers
# ---------------------------------------------------------------------------


class TestVerifyMaterializedReferenceFile:
    def test_jpeg_passes(self, tmp_path: Path) -> None:
        path = tmp_path / "ok.jpg"
        path.write_bytes(JPEG_BYTES)
        assert verify_materialized_reference_file(path, max_bytes=1024) is None

    def test_png_passes(self, tmp_path: Path) -> None:
        path = tmp_path / "ok.png"
        path.write_bytes(PNG_BYTES)
        assert verify_materialized_reference_file(path, max_bytes=1024) is None

    def test_oversize_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "big.jpg"
        path.write_bytes(JPEG_BYTES + b"\x00" * 200)
        code = verify_materialized_reference_file(path, max_bytes=8)
        assert code == "materialized_file_too_large"

    def test_unreadable_payload_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "bad.jpg"
        path.write_bytes(b"not an image")
        assert verify_materialized_reference_file(path, max_bytes=1024) == "materialized_file_unreadable"


class TestSafeS3Key:
    def test_privacy_prefix_allowed(self) -> None:
        assert is_safe_privacy_s3_key("uploads/privacy/profiles/t1/p1/x.jpg") is True

    def test_outside_prefix_rejected(self) -> None:
        assert is_safe_privacy_s3_key("uploads/videos/raw/t1/x.mp4") is False
        assert is_safe_privacy_s3_key("") is False
        assert is_safe_privacy_s3_key(None) is False


class TestAllowedReferenceUrl:
    def test_https_allowed_host(self) -> None:
        assert is_allowed_reference_url(
            "https://pub-abc.r2.dev/x.jpg",
            allowed_hosts=("pub-abc.r2.dev",),
        ) is True

    def test_http_rejected(self) -> None:
        assert is_allowed_reference_url(
            "http://pub-abc.r2.dev/x.jpg",
            allowed_hosts=("pub-abc.r2.dev",),
        ) is False

    def test_empty_allow_list_refuses(self) -> None:
        assert is_allowed_reference_url("https://x.example.com/", allowed_hosts=()) is False


# ---------------------------------------------------------------------------
# Capability probe
# ---------------------------------------------------------------------------


class TestEvaluateMaterializationCapability:
    def test_production_fixture_with_storage_download_succeeds(self) -> None:
        refs = [_production_shaped_reference(reference_id=f"r-{i}") for i in range(4)]
        cap = evaluate_materialization_capability(
            refs,
            storage_download_available=True,
        )
        assert cap["would_materialize_count"] == 4

    def test_production_fixture_without_storage_download_fails(self) -> None:
        refs = [_production_shaped_reference(reference_id=f"r-{i}") for i in range(4)]
        cap = evaluate_materialization_capability(
            refs,
            storage_download_available=False,
        )
        assert cap["would_materialize_count"] == 0
        # PR C9.2 now surfaces the more actionable "storage_download_unavailable"
        # code when the only blocker is missing R2/S3 credentials. The legacy
        # "remote_only_but_fetch_disabled" still lives in ``notes`` on each
        # per-ref decision but no longer pollutes the aggregate failure codes.
        assert "storage_download_unavailable" in cap["would_fail_codes"]


# ---------------------------------------------------------------------------
# Failure code contract
# ---------------------------------------------------------------------------


class TestFailureCodeContract:
    def test_known_codes_stable(self) -> None:
        assert set(PRIVACY_MATERIALIZATION_FAILURE_CODES).issuperset(
            {
                "reference_object_not_found",
                "reference_fetch_failed",
                "storage_download_unavailable",
                "remote_only_but_fetch_disabled",
                "no_usable_references",
            }
        )
