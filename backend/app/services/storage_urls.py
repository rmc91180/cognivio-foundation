"""Storage URL normalization and validation helpers (PR C9.1).

The production R2/S3 configuration occasionally surfaces malformed public URLs
such as ``"S3_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev"`` — the literal
environment variable name leaked into the configured value (typically because a
.env file line was copied as-is into a deploy variable, or a shell expanded the
whole line as a single token). Persisting that value as ``file_url`` then
produces URLs like ``"S3_PUBLIC_BASE_URL=https://.../uploads/...jpg"`` that the
privacy worker (and downstream playback) cannot fetch.

These helpers do three things:

1. ``normalize_storage_url`` — strip the leaked ``NAME=`` prefix, surrounding
   whitespace and quotes, before persisting URLs.
2. ``is_probably_http_url`` — minimal syntactic check used before treating a
   value as fetchable.
3. ``build_public_storage_url`` — pure helper used by ``_get_s3_public_url`` so
   normalization is always applied at the source.

The helpers are deliberately defensive: they preserve existing behaviour for
well-formed URLs and only repair the specific corruption patterns seen in
production. They never weaken privacy policy, never expose raw assets, and they
do not delete data.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional, Tuple

__all__ = [
    "STORAGE_URL_LEAKED_NAME_PATTERN",
    "normalize_storage_url",
    "is_probably_http_url",
    "build_public_storage_url",
    "describe_storage_url_issue",
]

# Match a leaked ENV-style assignment prefix such as "S3_PUBLIC_BASE_URL=" or
# "AWS_S3_BUCKET_URL =" at the very start of a value. We require the leading
# token to look like an UPPER_SNAKE environment variable so we never strip a
# legitimate query parameter or path segment that happens to contain "=".
STORAGE_URL_LEAKED_NAME_PATTERN = re.compile(
    r"^\s*(?P<name>[A-Z][A-Z0-9_]{2,})\s*=\s*",
)

_QUOTE_CHARS = "\"'`"
_VALID_SCHEMES: Tuple[str, ...] = ("http://", "https://", "s3://")


def _strip_surrounding_quotes(value: str) -> str:
    cleaned = value.strip()
    while len(cleaned) >= 2 and cleaned[0] in _QUOTE_CHARS and cleaned[-1] == cleaned[0]:
        cleaned = cleaned[1:-1].strip()
    return cleaned


def normalize_storage_url(raw: Optional[str]) -> Optional[str]:
    """Return a cleaned public storage URL or ``None`` if not usable.

    - Strips a leaked ``NAME=`` prefix (e.g. ``S3_PUBLIC_BASE_URL=https://...``)
    - Strips surrounding whitespace and quotes
    - Returns ``None`` for empty / non-string input
    - Does **not** validate reachability — call ``is_probably_http_url`` next.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    value = _strip_surrounding_quotes(raw)
    if not value:
        return None

    # Strip leaked NAME= prefix. Repeat in case of unusual double-wrapping.
    for _ in range(3):
        match = STORAGE_URL_LEAKED_NAME_PATTERN.match(value)
        if not match:
            break
        value = value[match.end():]
        value = _strip_surrounding_quotes(value)
        if not value:
            return None

    return value or None


def is_probably_http_url(value: Optional[str]) -> bool:
    """Return ``True`` when *value* looks like a fetchable storage URL.

    Accepts ``http(s)://`` and ``s3://`` schemes. This is a *syntactic* check —
    callers must still handle network failures.
    """
    if not isinstance(value, str):
        return False
    candidate = value.strip().lower()
    if not candidate:
        return False
    if "\n" in candidate or "\r" in candidate:
        return False
    return any(candidate.startswith(scheme) for scheme in _VALID_SCHEMES)


def build_public_storage_url(
    key: str,
    *,
    public_base_url: Optional[str] = None,
    endpoint: Optional[str] = None,
    region: Optional[str] = None,
    bucket: Optional[str] = None,
) -> Optional[str]:
    """Build a public storage URL for *key*, applying URL normalization.

    Resolution order (matches existing ``_get_s3_public_url`` precedence):

    1. ``public_base_url`` (e.g. an R2 ``pub-...r2.dev`` host)
    2. ``endpoint`` (custom S3 endpoint)
    3. ``region`` + ``bucket`` (default AWS hostname)
    4. ``bucket`` only (legacy S3 hostname)

    All inputs are normalized through :func:`normalize_storage_url` before use.
    Returns ``None`` if no source can form a URL.
    """
    safe_key = (key or "").lstrip("/")
    if not safe_key:
        return None

    base = normalize_storage_url(public_base_url)
    if base:
        return f"{base.rstrip('/')}/{safe_key}"

    endpoint_clean = normalize_storage_url(endpoint)
    bucket_clean = (bucket or "").strip()
    if endpoint_clean and bucket_clean:
        without_scheme = re.sub(r"^https?://", "", endpoint_clean)
        return f"https://{bucket_clean}.{without_scheme.rstrip('/')}/{safe_key}"

    region_clean = (region or "").strip()
    if region_clean and bucket_clean:
        return f"https://{bucket_clean}.s3.{region_clean}.amazonaws.com/{safe_key}"

    if bucket_clean:
        return f"https://{bucket_clean}.s3.amazonaws.com/{safe_key}"
    return None


def describe_storage_url_issue(value: Optional[str]) -> Optional[str]:
    """Return a short structured code describing why *value* is not usable.

    Used by the audit script and privacy reference validators. Returns
    ``None`` when *value* normalizes to a syntactically valid URL.
    """
    if value is None:
        return "url_missing"
    if not isinstance(value, str):
        return "url_not_string"
    stripped = _strip_surrounding_quotes(value)
    if not stripped:
        return "url_empty"
    if STORAGE_URL_LEAKED_NAME_PATTERN.match(stripped):
        return "url_env_name_prefix_leak"
    if not is_probably_http_url(stripped):
        return "url_not_http_scheme"
    return None


def iter_known_storage_url_fields() -> Iterable[str]:
    """Public list of document fields known to hold storage URLs.

    Returned so the audit script can scan ``videos`` and
    ``teacher_face_references`` documents without hard-coding the list in
    multiple places.
    """
    return (
        "file_url",
        "raw_file_url",
        "processed_file_url",
        "redacted_file_url",
        "redacted_thumbnail_url",
        "thumbnail_url",
        "raw_thumbnail_url",
        "image_url",
    )
