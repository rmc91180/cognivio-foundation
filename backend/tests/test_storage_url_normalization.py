"""Unit tests for PR C9.1 storage URL normalization helpers.

These tests are deliberately pure (no DB, no FastAPI app). They cover the exact
production failure modes the helpers were added for:

* Leaked ``S3_PUBLIC_BASE_URL=`` prefix on the persisted URL.
* Surrounding whitespace and quotes from copy/paste of .env entries.
* Empty / non-string / mis-scheme inputs.
* ``build_public_storage_url`` precedence and fallbacks.
"""

from __future__ import annotations

import pytest

from app.services.storage_urls import (
    STORAGE_URL_LEAKED_NAME_PATTERN,
    build_public_storage_url,
    describe_storage_url_issue,
    is_probably_http_url,
    iter_known_storage_url_fields,
    normalize_storage_url,
)


class TestNormalizeStorageUrl:
    def test_strips_leaked_env_name_prefix(self) -> None:
        raw = "S3_PUBLIC_BASE_URL=https://pub-abc123.r2.dev"
        assert normalize_storage_url(raw) == "https://pub-abc123.r2.dev"

    def test_strips_leaked_prefix_with_uploads_suffix(self) -> None:
        raw = "S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev/uploads/privacy/x.jpg"
        assert normalize_storage_url(raw) == "https://pub-abc.r2.dev/uploads/privacy/x.jpg"

    def test_strips_leaked_prefix_with_surrounding_whitespace(self) -> None:
        raw = "   S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev   "
        assert normalize_storage_url(raw) == "https://pub-abc.r2.dev"

    def test_strips_surrounding_quotes(self) -> None:
        assert normalize_storage_url('"https://x.example.com"') == "https://x.example.com"
        assert normalize_storage_url("'https://x.example.com'") == "https://x.example.com"

    def test_strips_quoted_leaked_env_name(self) -> None:
        raw = '"S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev"'
        assert normalize_storage_url(raw) == "https://pub-abc.r2.dev"

    def test_returns_none_for_empty_and_invalid_inputs(self) -> None:
        assert normalize_storage_url(None) is None
        assert normalize_storage_url("") is None
        assert normalize_storage_url("   ") is None
        assert normalize_storage_url(b"https://x.example.com") is None  # type: ignore[arg-type]

    def test_idempotent_on_clean_urls(self) -> None:
        url = "https://example.com/path?token=abc"
        assert normalize_storage_url(url) == url

    def test_does_not_strip_query_string_with_equals(self) -> None:
        # Query strings often look like ``?Signature=ABCD123`` — we must NOT
        # treat the trailing token as a leaked NAME prefix.
        url = "https://example.com/x.mp4?Expires=1700000000"
        assert normalize_storage_url(url) == url

    def test_handles_lowercase_name_left_alone(self) -> None:
        # An UPPER_SNAKE name match is required — lowercased query keys do not
        # qualify as "leaked env name prefixes".
        url = "foo=bar"
        # ``foo=bar`` is not a valid URL but we still don't want a "name strip"
        # to silently turn it into ``bar``.
        assert normalize_storage_url(url) == "foo=bar"

    def test_repeats_for_double_wrapping(self) -> None:
        # An operator might have copied the bad value twice; normalize anyway.
        raw = "S3_PUBLIC_BASE_URL=S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev"
        assert normalize_storage_url(raw) == "https://pub-abc.r2.dev"


class TestIsProbablyHttpUrl:
    @pytest.mark.parametrize(
        "value",
        [
            "https://example.com",
            "http://localhost:8000",
            "HTTPS://EXAMPLE.COM",
            "s3://bucket/key",
        ],
    )
    def test_valid_scheme(self, value: str) -> None:
        assert is_probably_http_url(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            "",
            None,
            "ftp://example.com",
            "javascript:alert(1)",
            "uploads/x.mp4",
            "S3_PUBLIC_BASE_URL=https://x.example.com",
            123,
            ["https://example.com"],
        ],
    )
    def test_invalid_inputs(self, value: object) -> None:
        assert is_probably_http_url(value) is False  # type: ignore[arg-type]

    def test_rejects_newline_injection(self) -> None:
        assert is_probably_http_url("https://example.com\n.attacker.com") is False


class TestBuildPublicStorageUrl:
    def test_prefers_public_base_url(self) -> None:
        url = build_public_storage_url(
            "uploads/videos/raw/v1.mp4",
            public_base_url="https://pub-abc.r2.dev",
            endpoint="https://endpoint.example.com",
            region="us-east-1",
            bucket="cognivio",
        )
        assert url == "https://pub-abc.r2.dev/uploads/videos/raw/v1.mp4"

    def test_normalizes_leaked_public_base_url(self) -> None:
        url = build_public_storage_url(
            "uploads/k.jpg",
            public_base_url="S3_PUBLIC_BASE_URL=https://pub-abc.r2.dev",
            bucket="cognivio",
        )
        assert url == "https://pub-abc.r2.dev/uploads/k.jpg"

    def test_falls_back_to_endpoint(self) -> None:
        url = build_public_storage_url(
            "key.mp4",
            public_base_url=None,
            endpoint="https://endpoint.example.com",
            bucket="my-bucket",
        )
        assert url == "https://my-bucket.endpoint.example.com/key.mp4"

    def test_falls_back_to_region(self) -> None:
        url = build_public_storage_url(
            "key.mp4",
            public_base_url=None,
            endpoint=None,
            region="us-east-1",
            bucket="my-bucket",
        )
        assert url == "https://my-bucket.s3.us-east-1.amazonaws.com/key.mp4"

    def test_legacy_aws_hostname(self) -> None:
        url = build_public_storage_url("key.mp4", bucket="my-bucket")
        assert url == "https://my-bucket.s3.amazonaws.com/key.mp4"

    def test_returns_none_without_bucket_and_base(self) -> None:
        assert build_public_storage_url("key.mp4") is None

    def test_returns_none_for_empty_key(self) -> None:
        assert build_public_storage_url("", public_base_url="https://x.example.com") is None


class TestDescribeStorageUrlIssue:
    def test_clean_url_returns_none(self) -> None:
        assert describe_storage_url_issue("https://example.com/x.jpg") is None

    def test_missing_url(self) -> None:
        assert describe_storage_url_issue(None) == "url_missing"

    def test_non_string(self) -> None:
        assert describe_storage_url_issue(123) == "url_not_string"  # type: ignore[arg-type]

    def test_empty(self) -> None:
        assert describe_storage_url_issue("   ") == "url_empty"

    def test_leaked_env_name(self) -> None:
        assert (
            describe_storage_url_issue("S3_PUBLIC_BASE_URL=https://x.example.com")
            == "url_env_name_prefix_leak"
        )

    def test_invalid_scheme(self) -> None:
        assert describe_storage_url_issue("ftp://example.com") == "url_not_http_scheme"


class TestRegexPattern:
    def test_pattern_requires_uppercase(self) -> None:
        assert STORAGE_URL_LEAKED_NAME_PATTERN.match("S3_PUBLIC_BASE_URL=https://x") is not None
        assert STORAGE_URL_LEAKED_NAME_PATTERN.match("s3_public_base_url=https://x") is None

    def test_pattern_requires_min_length(self) -> None:
        assert STORAGE_URL_LEAKED_NAME_PATTERN.match("AB=https://x") is None
        assert STORAGE_URL_LEAKED_NAME_PATTERN.match("ABC=https://x") is not None


class TestIterKnownStorageUrlFields:
    def test_includes_video_and_reference_fields(self) -> None:
        fields = set(iter_known_storage_url_fields())
        assert "file_url" in fields
        assert "redacted_file_url" in fields
        assert "image_url" in fields
        assert "processed_file_url" in fields
