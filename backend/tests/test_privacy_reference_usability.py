"""Unit tests for PR C9.1 privacy reference usability helpers.

These tests pin the contract between the readiness endpoint and the privacy
worker: a reference doc that the UI calls "ready" must produce the same usable
decision the worker would reach, with the same structured failure code when
they disagree.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.privacy_references import (
    PRIVACY_REFERENCE_FAILURE_CODES,
    extract_reference_paths,
    has_usable_privacy_references,
    summarize_privacy_references,
    validate_privacy_reference_usability,
)


@pytest.fixture
def upload_dir(tmp_path: Path) -> Path:
    return tmp_path


def _make_reference(**overrides):
    base = {
        "id": "ref-1",
        "teacher_id": "teacher-1",
        "status": "ready",
        "reference_type": "image",
        "file_url": "https://pub.example.com/ref-1.jpg",
        "quality_checks": {"validation_mode": "contract_only"},
    }
    base.update(overrides)
    return base


class TestValidatePrivacyReferenceUsability:
    def test_local_file_present_is_usable(self, upload_dir: Path) -> None:
        local = upload_dir / "ref.jpg"
        local.write_bytes(b"\x89PNG")
        reference = _make_reference(file_path="ref.jpg")
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert decision.usable is True
        assert decision.local_path == str(local)
        assert decision.failure_codes == ()

    def test_local_missing_but_s3_key_present_url_fetch_allowed(self, upload_dir: Path) -> None:
        reference = _make_reference(file_path="missing.jpg", s3_key="uploads/x.jpg")
        decision = validate_privacy_reference_usability(
            reference, upload_dir=upload_dir, allow_url_fetch=True
        )
        assert decision.usable is True
        assert decision.s3_key == "uploads/x.jpg"

    def test_local_missing_and_url_fetch_disabled_is_unusable(self, upload_dir: Path) -> None:
        reference = _make_reference(file_path="missing.jpg", s3_key="uploads/x.jpg")
        decision = validate_privacy_reference_usability(
            reference, upload_dir=upload_dir, allow_url_fetch=False
        )
        assert decision.usable is False
        assert "no_local_file_and_no_fetchable_url" in decision.failure_codes

    def test_recoverable_leaked_prefix_is_usable_but_audited(self, upload_dir: Path) -> None:
        # The persisted URL is corrupt but normalize_storage_url repairs it.
        # The reference stays usable so the worker proceeds, while operators
        # still see the audit signal via ``notes``.
        reference = _make_reference(
            file_url="S3_PUBLIC_BASE_URL=https://pub.example.com/ref-1.jpg",
        )
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert decision.usable is True
        assert "reference_url_malformed" in decision.notes
        assert "reference_url_malformed" not in decision.failure_codes

    def test_unrecoverable_url_blocks_and_emits_failure(self, upload_dir: Path) -> None:
        reference = _make_reference(file_url="not-a-url", s3_key=None, file_path=None)
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert decision.usable is False
        assert "reference_url_malformed" in decision.failure_codes

    def test_deleted_status_is_expired(self, upload_dir: Path) -> None:
        reference = _make_reference(status="deleted")
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert decision.usable is False
        assert decision.failure_codes == ("reference_expired",)

    def test_retention_expired(self, upload_dir: Path) -> None:
        reference = _make_reference(
            file_path="ref.jpg",
            retention_expires_at="2000-01-01T00:00:00+00:00",
        )
        decision = validate_privacy_reference_usability(
            reference,
            upload_dir=upload_dir,
            now_iso="2030-01-01T00:00:00+00:00",
        )
        assert decision.usable is False
        assert "reference_expired" in decision.failure_codes

    def test_unsupported_reference_type(self, upload_dir: Path) -> None:
        reference = _make_reference(reference_type="audio_clip", file_path="ref.jpg")
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert "unsupported_reference_type" in decision.failure_codes
        assert decision.usable is False

    def test_policy_blocked(self, upload_dir: Path) -> None:
        reference = _make_reference(
            reference_image_policy={"allowed_use": "biometric_authentication"},
        )
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert "reference_policy_blocked" in decision.failure_codes
        assert decision.usable is False

    def test_quality_check_blocks_when_failed(self, upload_dir: Path) -> None:
        reference = _make_reference(
            file_path="ref.jpg",
            quality_checks={"validation_status": "failed"},
        )
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert "reference_quality_unverified" in decision.failure_codes
        assert decision.usable is False

    def test_no_anchors_at_all(self, upload_dir: Path) -> None:
        reference = _make_reference(file_url=None, s3_key=None, file_path=None)
        decision = validate_privacy_reference_usability(reference, upload_dir=upload_dir)
        assert decision.usable is False
        assert "no_local_file_and_no_fetchable_url" in decision.failure_codes


class TestSummarize:
    def test_no_records_returns_no_reference_records(self, upload_dir: Path) -> None:
        summary = summarize_privacy_references([], upload_dir=upload_dir)
        assert summary.total == 0
        assert summary.usable_count == 0
        assert summary.primary_failure_code == "no_reference_records"

    def test_aggregate_failure_codes(self, upload_dir: Path) -> None:
        refs = [
            _make_reference(id="a", file_url="bad", s3_key=None, file_path=None),
            _make_reference(id="b", status="deleted"),
        ]
        summary = summarize_privacy_references(refs, upload_dir=upload_dir)
        assert summary.usable_count == 0
        assert "no_usable_references" in summary.failure_codes

    def test_mixed_set_reports_some_usable(self, upload_dir: Path) -> None:
        local = upload_dir / "ok.jpg"
        local.write_bytes(b"\x00")
        refs = [
            _make_reference(id="a", file_path="ok.jpg"),
            _make_reference(id="b", file_path="missing.jpg", file_url=None, s3_key=None),
        ]
        summary = summarize_privacy_references(refs, upload_dir=upload_dir)
        assert summary.total == 2
        assert summary.usable_count == 1
        assert summary.has_usable is True


class TestHasUsable:
    def test_required_count(self, upload_dir: Path) -> None:
        local = upload_dir / "ok.jpg"
        local.write_bytes(b"\x00")
        refs = [_make_reference(id="a", file_path="ok.jpg")]
        assert has_usable_privacy_references(refs, upload_dir=upload_dir, required_count=1) is True
        assert has_usable_privacy_references(refs, upload_dir=upload_dir, required_count=2) is False


class TestExtractReferencePaths:
    def test_only_returns_locally_present_files(self, upload_dir: Path) -> None:
        local = upload_dir / "a.jpg"
        local.write_bytes(b"\x00")
        refs = [
            _make_reference(id="a", file_path="a.jpg"),
            _make_reference(id="b", s3_key="uploads/b.jpg", file_path=None),
        ]
        summary = summarize_privacy_references(
            refs, upload_dir=upload_dir, allow_url_fetch=True
        )
        paths = extract_reference_paths(summary)
        assert paths == [str(local)]


class TestFailureCodeContract:
    def test_known_codes_are_stable(self) -> None:
        # If you rename one of these, audits and the retry endpoint will lose
        # the structured signal — bump the contract intentionally.
        assert set(PRIVACY_REFERENCE_FAILURE_CODES).issuperset(
            {
                "no_reference_records",
                "reference_url_malformed",
                "reference_expired",
                "unsupported_reference_type",
                "reference_policy_blocked",
                "no_usable_references",
            }
        )
