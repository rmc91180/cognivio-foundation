"""Unit tests for PR C9.1 transcode-decision + asset-selection helpers."""

from __future__ import annotations

import pytest

from app.services.video_assets import (
    VIDEO_TRANSCODE_DECISIONS,
    decide_transcode_for_upload,
    select_analysis_asset,
    select_playback_asset,
)


class TestDecideTranscodeForUpload:
    @pytest.mark.parametrize(
        "size,expected",
        [
            (1, "not_required"),
            (10 * 1024 * 1024, "not_required"),  # below 25MB default
        ],
    )
    def test_small_upload_not_required(self, size: int, expected: str) -> None:
        decision = decide_transcode_for_upload(
            size,
            transcode_enabled=True,
            pipeline_enabled=True,
            min_bytes=25 * 1024 * 1024,
        )
        assert decision.decision == expected

    def test_large_upload_with_pipeline_is_queued(self) -> None:
        decision = decide_transcode_for_upload(
            60 * 1024 * 1024,
            transcode_enabled=True,
            pipeline_enabled=True,
            min_bytes=25 * 1024 * 1024,
        )
        assert decision.decision == "queued"

    def test_large_upload_without_pipeline_is_pending_not_silently_skipped(self) -> None:
        # This is the production bug: 46-80MB videos were marked
        # not_required when pipeline_enabled=False. The new contract pings the
        # operator with "pending" instead.
        decision = decide_transcode_for_upload(
            60 * 1024 * 1024,
            transcode_enabled=False,
            pipeline_enabled=False,
            min_bytes=25 * 1024 * 1024,
        )
        assert decision.decision == "pending"
        assert decision.size_bytes == 60 * 1024 * 1024

    def test_unknown_size_returns_not_required_unknown_size(self) -> None:
        decision = decide_transcode_for_upload(
            None,
            transcode_enabled=True,
            pipeline_enabled=True,
            min_bytes=25 * 1024 * 1024,
        )
        assert decision.decision == "not_required_unknown_size"

    def test_invalid_size_handled_gracefully(self) -> None:
        decision = decide_transcode_for_upload(
            "not-a-number",  # type: ignore[arg-type]
            transcode_enabled=True,
            pipeline_enabled=True,
            min_bytes=25 * 1024 * 1024,
        )
        assert decision.decision == "not_required_unknown_size"

    def test_stable_decision_values(self) -> None:
        assert "queued" in VIDEO_TRANSCODE_DECISIONS
        assert "pending" in VIDEO_TRANSCODE_DECISIONS
        assert "not_required" in VIDEO_TRANSCODE_DECISIONS


class TestSelectPlaybackAsset:
    def test_teacher_gets_redacted_when_present(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "completed",
                "redacted_file_url": "https://cdn.example.com/redacted.mp4",
            },
            "teacher",
        )
        assert decision.source == "redacted"
        assert decision.url == "https://cdn.example.com/redacted.mp4"

    def test_teacher_never_gets_raw(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "completed",
                "raw_file_url": "https://cdn.example.com/raw.mp4",
            },
            "teacher",
        )
        assert decision.url is None
        assert decision.failure_code == "redacted_asset_missing"

    def test_teacher_blocked_when_privacy_not_completed(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "processing",
                "raw_file_url": "https://cdn.example.com/raw.mp4",
            },
            "teacher",
        )
        assert decision.url is None
        assert decision.failure_code == "privacy_not_completed"

    def test_admin_gets_processed_then_raw_when_privacy_completed(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "completed",
                "processed_file_url": "https://cdn.example.com/processed.mp4",
                "raw_file_url": "https://cdn.example.com/raw.mp4",
            },
            "admin",
            allow_raw_for_admin=True,
        )
        assert decision.source == "processed"

    def test_admin_falls_back_to_raw_only_when_allowed(self) -> None:
        video = {
            "privacy_status": "completed",
            "raw_file_url": "https://cdn.example.com/raw.mp4",
        }
        ok = select_playback_asset(video, "admin", allow_raw_for_admin=True)
        assert ok.source == "raw"
        assert ok.url == "https://cdn.example.com/raw.mp4"

        blocked = select_playback_asset(video, "admin", allow_raw_for_admin=False)
        assert blocked.url is None
        assert blocked.failure_code == "policy_blocks_raw_to_teacher"

    def test_strips_malformed_urls_before_returning(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "completed",
                "redacted_file_url": "S3_PUBLIC_BASE_URL=https://x.example.com/redacted.mp4",
                "redacted_file_path": "redacted/t1/v1.mp4",
            },
            "teacher",
        )
        # Falls back to the path-based URL when the malformed URL is rejected.
        assert decision.url is not None
        assert not decision.url.startswith("S3_PUBLIC_BASE_URL")

    def test_observer_treated_like_teacher(self) -> None:
        decision = select_playback_asset(
            {
                "privacy_status": "completed",
                "raw_file_url": "https://cdn.example.com/raw.mp4",
            },
            "observer",
        )
        assert decision.url is None


class TestSelectAnalysisAsset:
    def test_blocks_when_privacy_not_completed(self) -> None:
        decision = select_analysis_asset(
            {"privacy_status": "processing", "raw_file_path": "raw.mp4"}
        )
        assert decision.path is None
        assert decision.failure_code == "privacy_not_completed"

    def test_prefers_redacted(self) -> None:
        decision = select_analysis_asset(
            {
                "privacy_status": "completed",
                "redacted_file_path": "redacted/x.mp4",
                "processed_file_path": "processed/x.mp4",
                "raw_file_path": "raw/x.mp4",
            }
        )
        assert decision.source == "redacted"
        assert decision.path == "redacted/x.mp4"

    def test_falls_back_to_processed(self) -> None:
        decision = select_analysis_asset(
            {
                "privacy_status": "completed",
                "processed_file_path": "processed/x.mp4",
                "raw_file_path": "raw/x.mp4",
            }
        )
        assert decision.source == "processed"

    def test_refuses_raw_when_destructive_blur_enabled(self) -> None:
        # Destructive blur means raw was destroyed/should not be used; analysis
        # must refuse.
        decision = select_analysis_asset(
            {
                "privacy_status": "completed",
                "raw_file_path": "raw/x.mp4",
                "destructive_blurring_enabled": True,
            }
        )
        assert decision.path is None
        assert decision.failure_code == "no_analysis_asset"

    def test_allows_raw_when_policy_permits(self) -> None:
        decision = select_analysis_asset(
            {
                "privacy_status": "completed",
                "raw_file_path": "raw/x.mp4",
                "destructive_blurring_enabled": False,
            }
        )
        assert decision.source == "raw"
        assert decision.path == "raw/x.mp4"
