"""Teacher privacy reference usability (PR C9.1).

Production was failing with::

    Teacher privacy profile has no usable references

even though teacher setup said references were ready. The root cause was that
``_teacher_readiness`` counted any document with ``s3_key``, ``file_path`` or
``file_url`` as "ready", while the privacy worker only considered a reference
usable when ``UPLOAD_DIR / file_path`` existed on the worker's local
filesystem. When the worker runs on a different container (Railway replica /
fly machine) the local file is missing even though the S3 / R2 object is fine.

This module exposes one canonical "is this reference usable by the worker
right now" check that BOTH the readiness endpoint and the worker call, so the
teacher UI cannot lie about readiness.

Failure codes are structured strings (used in audits, telemetry, and the retry
endpoint response). They are stable identifiers — do not rename without
sweeping callers.

Privacy policy guarantees preserved by this module:

- Does NOT require persistent biometric embeddings (policy forbids them).
- Does NOT relax reference quality / consent requirements.
- Does NOT mark privacy as completed when references are missing — it only
  reports a usability decision; the worker is still responsible for the
  privacy pipeline state transitions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, List, Mapping, Optional, Tuple

from app.services.storage_urls import (
    describe_storage_url_issue,
    is_probably_http_url,
    normalize_storage_url,
)

__all__ = [
    "PRIVACY_REFERENCE_FAILURE_CODES",
    "PrivacyReferenceUsability",
    "PrivacyReferenceSummary",
    "validate_privacy_reference_usability",
    "has_usable_privacy_references",
    "summarize_privacy_references",
    "extract_reference_paths",
]

# Public, stable structured failure codes.
PRIVACY_REFERENCE_FAILURE_CODES: Tuple[str, ...] = (
    "no_reference_records",
    "reference_url_malformed",
    "reference_fetch_failed",
    "reference_expired",
    "unsupported_reference_type",
    "reference_policy_blocked",
    "reference_quality_unverified",
    "no_local_file_and_no_fetchable_url",
    "no_usable_references",
)

# Statuses that mean "this reference is not currently part of the active set".
_INACTIVE_STATUSES = {"deleted", "replaced", "expired"}

# Statuses that mean "this reference is OK to use".
_ACTIVE_STATUSES = {"uploaded", "ready", "active", "validated", "complete"}

# Validation statuses that block usability.
_BAD_VALIDATION_STATUSES = {"pending", "processing", "failed", "rejected", "invalid", "error"}

# Reference document types we know how to use for blur reference signatures.
_SUPPORTED_REFERENCE_TYPES = {"image", "photo", "headshot", None, ""}


@dataclass(frozen=True)
class PrivacyReferenceUsability:
    """Per-reference usability decision."""

    reference_id: Optional[str]
    usable: bool
    failure_codes: Tuple[str, ...] = ()
    local_path: Optional[str] = None
    fetchable_url: Optional[str] = None
    s3_key: Optional[str] = None
    notes: Tuple[str, ...] = ()

    @property
    def primary_failure_code(self) -> Optional[str]:
        return self.failure_codes[0] if self.failure_codes else None


@dataclass(frozen=True)
class PrivacyReferenceSummary:
    """Aggregate summary across all of a teacher's references."""

    total: int
    usable_count: int
    failure_codes: Tuple[str, ...]
    details: Tuple[PrivacyReferenceUsability, ...] = field(default_factory=tuple)

    @property
    def has_usable(self) -> bool:
        return self.usable_count > 0

    @property
    def primary_failure_code(self) -> Optional[str]:
        if self.has_usable:
            return None
        if not self.total:
            return "no_reference_records"
        return self.failure_codes[0] if self.failure_codes else "no_usable_references"


def _normalize_status(value: Any, default: str = "ready") -> str:
    text = str(value or default).strip().lower()
    return text or default


def _is_inactive(reference: Mapping[str, Any]) -> bool:
    status = _normalize_status(reference.get("status"), "ready")
    return status in _INACTIVE_STATUSES


def _is_status_active(reference: Mapping[str, Any]) -> bool:
    status = _normalize_status(reference.get("status"), "ready")
    return status in _ACTIVE_STATUSES


def _validation_status(reference: Mapping[str, Any]) -> str:
    quality_checks = reference.get("quality_checks") or {}
    candidate = (
        reference.get("validation_status")
        or reference.get("quality_status")
        or quality_checks.get("validation_status")
        or quality_checks.get("status")
        or "ready"
    )
    return _normalize_status(candidate, "ready")


def _local_file_path(reference: Mapping[str, Any], upload_dir: Optional[Path]) -> Optional[Path]:
    file_path = reference.get("file_path")
    if not file_path:
        return None
    if upload_dir is None:
        return None
    try:
        candidate = upload_dir / str(file_path)
    except Exception:
        return None
    return candidate


def _is_supported_type(reference: Mapping[str, Any]) -> bool:
    ref_type = reference.get("reference_type") or reference.get("kind")
    if ref_type is None:
        return True
    normalized = str(ref_type).strip().lower()
    return normalized in _SUPPORTED_REFERENCE_TYPES


def _is_policy_blocked(reference: Mapping[str, Any]) -> bool:
    policy = reference.get("reference_image_policy") or {}
    allowed_use = policy.get("allowed_use")
    if allowed_use and str(allowed_use).strip().lower() not in {"privacy_blur_workflow_only", ""}:
        return True
    if reference.get("policy_block_reason"):
        return True
    return False


def _retention_expired(reference: Mapping[str, Any], now_iso: Optional[str]) -> bool:
    expires_at = reference.get("retention_expires_at")
    if not expires_at or not now_iso:
        return False
    try:
        return str(expires_at) <= str(now_iso)
    except Exception:
        return False


def validate_privacy_reference_usability(
    reference: Mapping[str, Any],
    *,
    upload_dir: Optional[Path] = None,
    now_iso: Optional[str] = None,
    allow_url_fetch: bool = True,
    allow_storage_download: bool = False,
) -> PrivacyReferenceUsability:
    """Compute the usability decision for a single reference document.

    *allow_url_fetch* controls whether a usable ``file_url`` (with no local
    copy) counts as fetchable. PR C9.2 splits the "remote OK" decision into
    two independent dimensions:

    - *allow_storage_download* — the caller has an authenticated S3/R2
      client that can pull ``s3_key`` into a temp file via materialization.
      Defaults to ``False`` for backwards compatibility; the privacy worker
      passes ``True`` once the materializer is wired in.
    - *allow_url_fetch* — the caller may fetch the normalized public
      ``file_url`` over HTTPS. Off by default; must be explicitly enabled by
      the operator because public URL fetch is harder to allow-list and
      throttle than authenticated storage downloads.

    A reference is considered usable when at least one of:

    1. local file is present, OR
    2. ``s3_key`` is set AND ``allow_storage_download`` is True, OR
    3. normalized ``file_url`` is set AND ``allow_url_fetch`` is True.
    """
    reference_id = reference.get("id") or reference.get("reference_id")
    failure_codes: List[str] = []
    notes: List[str] = []

    if _is_inactive(reference):
        return PrivacyReferenceUsability(
            reference_id=reference_id,
            usable=False,
            failure_codes=("reference_expired",),
        )

    if not _is_status_active(reference):
        failure_codes.append("reference_quality_unverified")

    if _validation_status(reference) in _BAD_VALIDATION_STATUSES:
        failure_codes.append("reference_quality_unverified")

    if not _is_supported_type(reference):
        failure_codes.append("unsupported_reference_type")

    if _is_policy_blocked(reference):
        failure_codes.append("reference_policy_blocked")

    if _retention_expired(reference, now_iso):
        failure_codes.append("reference_expired")

    local_path = _local_file_path(reference, upload_dir)
    local_ok = bool(local_path and local_path.exists())

    raw_file_url = reference.get("file_url")
    file_url_normalized = normalize_storage_url(raw_file_url)
    fetchable_url: Optional[str] = None
    if file_url_normalized:
        if is_probably_http_url(file_url_normalized):
            fetchable_url = file_url_normalized
        else:
            failure_codes.append("reference_url_malformed")
    raw_issue = describe_storage_url_issue(raw_file_url) if raw_file_url is not None else None
    if raw_issue and raw_issue != "url_missing":
        # Operators must still see the corruption even when normalize_storage_url
        # rescued the value. We use ``notes`` for the recoverable case so the
        # reference remains usable; the summary lifts notes into the audit
        # surface alongside hard failures.
        if fetchable_url and "reference_url_malformed" not in failure_codes:
            notes.append("reference_url_malformed")
        elif "reference_url_malformed" not in failure_codes:
            failure_codes.append("reference_url_malformed")

    s3_key = reference.get("s3_key") or reference.get("raw_s3_key")
    if s3_key and not isinstance(s3_key, str):
        s3_key = str(s3_key)
    if s3_key and not s3_key.strip():
        s3_key = None

    has_any_anchor = bool(local_ok or fetchable_url or s3_key)
    if not has_any_anchor and "reference_url_malformed" not in failure_codes:
        failure_codes.append("no_local_file_and_no_fetchable_url")

    # PR C9.2: storage download and URL fetch are independent capabilities.
    storage_path_available = bool(s3_key) and allow_storage_download
    url_path_available = bool(fetchable_url) and allow_url_fetch

    usable = not failure_codes and (
        local_ok
        or storage_path_available
        or url_path_available
    )

    if not local_ok and not (storage_path_available or url_path_available) and (
        fetchable_url or s3_key
    ):
        # PR C9.2: prefer the most actionable code for the operator. If the
        # only blocker is missing storage credentials, say so explicitly.
        if bool(s3_key) and not allow_storage_download:
            if "storage_download_unavailable" not in failure_codes:
                failure_codes.append("storage_download_unavailable")
        elif "no_local_file_and_no_fetchable_url" not in failure_codes:
            failure_codes.append("no_local_file_and_no_fetchable_url")
        notes.append("remote_only_but_fetch_disabled")
        usable = False

    return PrivacyReferenceUsability(
        reference_id=reference_id,
        usable=bool(usable),
        failure_codes=tuple(dict.fromkeys(failure_codes)),
        local_path=str(local_path) if local_path else None,
        fetchable_url=fetchable_url,
        s3_key=s3_key,
        notes=tuple(notes),
    )


def summarize_privacy_references(
    references: Iterable[Mapping[str, Any]],
    *,
    upload_dir: Optional[Path] = None,
    now_iso: Optional[str] = None,
    allow_url_fetch: bool = True,
    allow_storage_download: bool = False,
) -> PrivacyReferenceSummary:
    """Run :func:`validate_privacy_reference_usability` over a collection."""
    details: List[PrivacyReferenceUsability] = []
    total = 0
    usable_count = 0
    failure_codes: List[str] = []

    for reference in references:
        total += 1
        decision = validate_privacy_reference_usability(
            reference,
            upload_dir=upload_dir,
            now_iso=now_iso,
            allow_url_fetch=allow_url_fetch,
            allow_storage_download=allow_storage_download,
        )
        details.append(decision)
        if decision.usable:
            usable_count += 1
        for code in decision.failure_codes:
            if code not in failure_codes:
                failure_codes.append(code)
        for code in decision.notes:
            # Notes (e.g. recoverable URL corruption) need to surface to the
            # audit script and admin UI alongside hard failures.
            if code not in failure_codes:
                failure_codes.append(code)

    if total == 0:
        failure_codes.insert(0, "no_reference_records")
    elif usable_count == 0 and "no_usable_references" not in failure_codes:
        failure_codes.append("no_usable_references")

    return PrivacyReferenceSummary(
        total=total,
        usable_count=usable_count,
        failure_codes=tuple(failure_codes),
        details=tuple(details),
    )


def has_usable_privacy_references(
    references: Iterable[Mapping[str, Any]],
    *,
    upload_dir: Optional[Path] = None,
    now_iso: Optional[str] = None,
    allow_url_fetch: bool = True,
    allow_storage_download: bool = False,
    required_count: int = 1,
) -> bool:
    """Return ``True`` when at least *required_count* references are usable."""
    summary = summarize_privacy_references(
        references,
        upload_dir=upload_dir,
        now_iso=now_iso,
        allow_url_fetch=allow_url_fetch,
        allow_storage_download=allow_storage_download,
    )
    return summary.usable_count >= max(1, required_count)


def extract_reference_paths(
    summary: PrivacyReferenceSummary,
) -> List[str]:
    """Return the list of local paths the privacy worker can hand to OpenCV.

    Only references whose *local* file is present are included — even if the
    summary marked others as usable via URL/s3 fetch (the worker is responsible
    for materializing those before calling this helper).
    """
    return [
        detail.local_path
        for detail in summary.details
        if detail.usable and detail.local_path
    ]
