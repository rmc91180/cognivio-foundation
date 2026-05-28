"""Privacy reference image materialization (PR C9.2).

C9.1 surfaced the production failure mode: teacher reference images live only
in object storage (R2 / S3) but the destructive blur worker still needs local
image files because :mod:`privacy_pipeline` calls ``cv2.imread(local_path)``.
Without a materialization step the worker reports::

    Teacher privacy profile has no usable references
        (codes: no_local_file_and_no_fetchable_url,
                reference_url_malformed,
                remote_only_but_fetch_disabled,
                no_usable_references)

This module is the single canonical "make remote references usable" step:

- Prefers existing local file (``UPLOAD_DIR / file_path``) when readable.
- Else downloads via authenticated storage client using ``s3_key``.
- Else optionally fetches the normalized public ``file_url`` — only when the
  operator has explicitly enabled URL fetch and the host is allow-listed.

Privacy invariants preserved:

- **Temp-only**: materialized files live in a unique per-job temp directory
  under the system tempdir and are deleted by :func:`cleanup_materialized_privacy_references`
  in a ``finally`` block.
- **No persistent embeddings**: this module reads bytes and verifies the
  image; it never computes nor persists a biometric signature.
- **Policy-honoring**: references with
  ``reference_image_policy.allowed_use != "privacy_blur_workflow_only"`` are
  rejected (failure code ``reference_policy_blocked``).
- **Type-safe**: only ``image/jpeg``, ``image/png``, ``image/webp`` are
  accepted; unexpected content types are rejected.
- **Size-capped**: downloads stop at ``max_bytes`` to refuse pathological
  payloads.
- **Prefix-validated**: storage downloads must come from the
  ``uploads/privacy/`` prefix used by the reference image upload helper.

Failure codes are stable strings — extend :data:`PRIVACY_MATERIALIZATION_FAILURE_CODES`
when adding new ones; do not rename existing codes.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Tuple

from app.services.privacy_references import (
    PrivacyReferenceUsability,
    summarize_privacy_references,
    validate_privacy_reference_usability,
)
from app.services.storage_urls import (
    is_probably_http_url,
    normalize_storage_url,
)

logger = logging.getLogger(__name__)

__all__ = [
    "PRIVACY_MATERIALIZATION_FAILURE_CODES",
    "SUPPORTED_IMAGE_CONTENT_TYPES",
    "SUPPORTED_IMAGE_EXTENSIONS",
    "STORAGE_PRIVACY_PREFIX",
    "PrivacyReferenceMaterializationResult",
    "MaterializedReference",
    "UnusableReference",
    "materialize_privacy_reference",
    "materialize_privacy_references",
    "cleanup_materialized_privacy_references",
    "verify_materialized_reference_file",
    "is_safe_privacy_s3_key",
    "is_allowed_reference_url",
]

PRIVACY_MATERIALIZATION_FAILURE_CODES: Tuple[str, ...] = (
    "no_reference_records",
    "reference_url_malformed",
    "reference_object_not_found",
    "reference_fetch_failed",
    "storage_download_unavailable",
    "reference_quality_unverified",
    "reference_policy_blocked",
    "reference_expired",
    "unsupported_reference_type",
    "remote_only_but_fetch_disabled",
    "url_fetch_disallowed_host",
    "url_fetch_disabled",
    "materialized_file_unreadable",
    "materialized_file_too_large",
    "no_usable_references",
)

SUPPORTED_IMAGE_CONTENT_TYPES: Tuple[str, ...] = (
    "image/jpeg",
    "image/jpg",
    "image/pjpeg",
    "image/png",
    "image/webp",
)

SUPPORTED_IMAGE_EXTENSIONS: Tuple[str, ...] = (".jpg", ".jpeg", ".png", ".webp")

# Storage prefix used by ``_save_privacy_reference_file``.
STORAGE_PRIVACY_PREFIX = "uploads/privacy/"

# Magic byte prefixes used for a defense-in-depth check after writing the file
# to disk. We do not import PIL here — the worker (OpenCV) is the real reader;
# we just confirm the bytes look like a supported image format.
_IMAGE_MAGIC = (
    b"\xff\xd8\xff",            # JPEG
    b"\x89PNG\r\n\x1a\n",        # PNG
    b"RIFF",                     # WEBP (followed by "WEBP")
)


@dataclass(frozen=True)
class MaterializedReference:
    """A reference image that is now available as a local file."""

    reference_id: Optional[str]
    teacher_id: Optional[str]
    source: str  # "local_path" | "s3_key" | "normalized_url"
    local_path: str
    content_type: Optional[str]
    bytes_written: int = 0
    cleanup_required: bool = True
    notes: Tuple[str, ...] = ()


@dataclass(frozen=True)
class UnusableReference:
    """A reference that could not be materialized."""

    reference_id: Optional[str]
    teacher_id: Optional[str]
    failure_codes: Tuple[str, ...]
    message: str
    notes: Tuple[str, ...] = ()


@dataclass
class PrivacyReferenceMaterializationResult:
    """Aggregate materialization outcome.

    The ``cleanup`` callable removes ``temp_dir`` and any other materialized
    files. Workers MUST call it from a ``finally`` block.
    """

    usable: List[MaterializedReference] = field(default_factory=list)
    unusable: List[UnusableReference] = field(default_factory=list)
    temp_dir: Optional[str] = None
    failure_codes: Tuple[str, ...] = ()
    notes: Tuple[str, ...] = ()
    cleanup: Optional[Callable[[], None]] = None

    @property
    def usable_count(self) -> int:
        return len(self.usable)

    @property
    def total(self) -> int:
        return len(self.usable) + len(self.unusable)

    def usable_local_paths(self) -> List[str]:
        return [ref.local_path for ref in self.usable]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def is_safe_privacy_s3_key(s3_key: Optional[str]) -> bool:
    """Return ``True`` when *s3_key* is under the privacy prefix.

    Defense-in-depth: even though the application only sets these keys
    internally, the worker downloads using whatever value is in the document.
    A misconfigured row should not let an attacker pull arbitrary objects from
    the bucket.
    """
    if not s3_key or not isinstance(s3_key, str):
        return False
    cleaned = s3_key.strip().lstrip("/")
    if not cleaned:
        return False
    return cleaned.startswith(STORAGE_PRIVACY_PREFIX)


def is_allowed_reference_url(
    url: Optional[str],
    *,
    allowed_hosts: Iterable[str] = (),
) -> bool:
    """Return ``True`` when *url* is a normalized HTTPS URL and host-allow-listed."""
    if not url:
        return False
    if not is_probably_http_url(url):
        return False
    lowered = url.strip().lower()
    if not lowered.startswith("https://"):
        # Only HTTPS is acceptable for cross-network reference fetch.
        return False
    hosts = [h.strip().lower() for h in allowed_hosts if h and h.strip()]
    if not hosts:
        # Allowed-host policy not configured → refuse to be safe.
        return False
    try:
        host = lowered.split("/", 3)[2]
    except IndexError:
        return False
    host = host.split(":", 1)[0]
    for allowed in hosts:
        if host == allowed or host.endswith("." + allowed):
            return True
    return False


def verify_materialized_reference_file(
    path: Path,
    *,
    max_bytes: int,
) -> Optional[str]:
    """Return ``None`` when *path* looks like a usable image, else a failure code.

    We do not import OpenCV here — the worker is the real reader. We only
    confirm the file exists, is under ``max_bytes``, and starts with a known
    image magic byte sequence.
    """
    if not path.exists() or not path.is_file():
        return "materialized_file_unreadable"
    try:
        size = path.stat().st_size
    except OSError:
        return "materialized_file_unreadable"
    if size <= 0:
        return "materialized_file_unreadable"
    if max_bytes and size > max_bytes:
        return "materialized_file_too_large"
    try:
        with path.open("rb") as handle:
            header = handle.read(16)
    except OSError:
        return "materialized_file_unreadable"
    if header.startswith(_IMAGE_MAGIC[0]) or header.startswith(_IMAGE_MAGIC[1]):
        return None
    if header.startswith(_IMAGE_MAGIC[2]) and len(header) >= 12 and header[8:12] == b"WEBP":
        return None
    return "materialized_file_unreadable"


def _ext_from_content_type(content_type: Optional[str]) -> str:
    if not content_type:
        return ".jpg"
    lowered = content_type.lower().split(";", 1)[0].strip()
    if lowered in {"image/jpeg", "image/jpg", "image/pjpeg"}:
        return ".jpg"
    if lowered == "image/png":
        return ".png"
    if lowered == "image/webp":
        return ".webp"
    return ".bin"


def _safe_filename_for_reference(
    reference: Mapping[str, Any],
    extension: str,
    index: int,
) -> str:
    raw_id = str(reference.get("id") or reference.get("reference_id") or f"ref-{index}")
    safe = "".join(ch for ch in raw_id if ch.isalnum() or ch in ("-", "_"))
    if not safe:
        safe = f"ref-{index}"
    return f"{safe}{extension}"


# ---------------------------------------------------------------------------
# Per-reference materialization
# ---------------------------------------------------------------------------


def _materialize_local(
    reference: Mapping[str, Any],
    upload_dir: Optional[Path],
    max_bytes: int,
) -> Optional[MaterializedReference]:
    file_path = reference.get("file_path")
    if not file_path or upload_dir is None:
        return None
    candidate = upload_dir / str(file_path)
    if not candidate.exists():
        return None
    issue = verify_materialized_reference_file(candidate, max_bytes=max_bytes)
    if issue:
        # Local file is unreadable / corrupt — fall through so the s3 path can
        # repair it.
        return None
    return MaterializedReference(
        reference_id=reference.get("id"),
        teacher_id=reference.get("teacher_id"),
        source="local_path",
        local_path=str(candidate),
        content_type=(reference.get("quality_checks") or {}).get("content_type"),
        bytes_written=candidate.stat().st_size,
        cleanup_required=False,
    )


def _materialize_via_storage(
    reference: Mapping[str, Any],
    storage_downloader: Optional[Callable[[str, Path], None]],
    *,
    temp_dir: Path,
    index: int,
    max_bytes: int,
) -> Tuple[Optional[MaterializedReference], Optional[str]]:
    s3_key = reference.get("s3_key") or reference.get("raw_s3_key")
    if not s3_key:
        return None, None
    if storage_downloader is None:
        return None, "storage_download_unavailable"
    if not is_safe_privacy_s3_key(s3_key):
        return None, "reference_policy_blocked"
    content_type = (reference.get("quality_checks") or {}).get("content_type")
    extension = _ext_from_content_type(content_type) or Path(str(s3_key)).suffix.lower()
    if extension not in SUPPORTED_IMAGE_EXTENSIONS:
        extension = ".jpg"
    filename = _safe_filename_for_reference(reference, extension, index)
    destination = temp_dir / filename
    try:
        storage_downloader(str(s3_key), destination)
    except FileNotFoundError:
        return None, "reference_object_not_found"
    except PermissionError:
        return None, "storage_download_unavailable"
    except Exception as exc:  # pragma: no cover — boto error subclasses vary
        # Boto's NoSuchKey shows up as ClientError("NoSuchKey"); we treat
        # anything containing "not found" as object-not-found, else generic
        # fetch_failed. We never include the full URL/token in the message.
        message = str(exc).lower()
        if "not found" in message or "nosuchkey" in message or "404" in message:
            return None, "reference_object_not_found"
        logger.warning(
            "privacy_reference_storage_download_failed reference_id=%s",
            reference.get("id"),
        )
        return None, "reference_fetch_failed"
    issue = verify_materialized_reference_file(destination, max_bytes=max_bytes)
    if issue:
        try:
            destination.unlink()
        except OSError:
            pass
        return None, issue
    return (
        MaterializedReference(
            reference_id=reference.get("id"),
            teacher_id=reference.get("teacher_id"),
            source="s3_key",
            local_path=str(destination),
            content_type=content_type,
            bytes_written=destination.stat().st_size,
            cleanup_required=True,
        ),
        None,
    )


def _materialize_via_url(
    reference: Mapping[str, Any],
    url_fetcher: Optional[Callable[[str, Path, int, int], None]],
    *,
    temp_dir: Path,
    index: int,
    url_fetch_enabled: bool,
    allowed_hosts: Iterable[str],
    timeout_seconds: int,
    max_bytes: int,
) -> Tuple[Optional[MaterializedReference], Optional[str]]:
    if not url_fetch_enabled:
        return None, "url_fetch_disabled"
    raw_url = reference.get("file_url")
    normalized = normalize_storage_url(raw_url)
    if not normalized:
        return None, "reference_url_malformed"
    if not is_allowed_reference_url(normalized, allowed_hosts=allowed_hosts):
        return None, "url_fetch_disallowed_host"
    if url_fetcher is None:
        return None, "url_fetch_disabled"
    content_type = (reference.get("quality_checks") or {}).get("content_type")
    extension = _ext_from_content_type(content_type)
    filename = _safe_filename_for_reference(reference, extension, index)
    destination = temp_dir / filename
    try:
        url_fetcher(normalized, destination, timeout_seconds, max_bytes)
    except FileNotFoundError:
        return None, "reference_object_not_found"
    except Exception as exc:  # pragma: no cover
        message = str(exc).lower()
        if "too large" in message or "max bytes" in message:
            return None, "materialized_file_too_large"
        logger.warning(
            "privacy_reference_url_fetch_failed reference_id=%s",
            reference.get("id"),
        )
        return None, "reference_fetch_failed"
    issue = verify_materialized_reference_file(destination, max_bytes=max_bytes)
    if issue:
        try:
            destination.unlink()
        except OSError:
            pass
        return None, issue
    return (
        MaterializedReference(
            reference_id=reference.get("id"),
            teacher_id=reference.get("teacher_id"),
            source="normalized_url",
            local_path=str(destination),
            content_type=content_type,
            bytes_written=destination.stat().st_size,
            cleanup_required=True,
            notes=("url_fetch_used",),
        ),
        None,
    )


def materialize_privacy_reference(
    reference: Mapping[str, Any],
    *,
    temp_dir: Path,
    upload_dir: Optional[Path] = None,
    storage_downloader: Optional[Callable[[str, Path], None]] = None,
    url_fetcher: Optional[Callable[[str, Path, int, int], None]] = None,
    url_fetch_enabled: bool = False,
    allowed_hosts: Iterable[str] = (),
    timeout_seconds: int = 20,
    max_bytes: int = 10 * 1024 * 1024,
    now_iso: Optional[str] = None,
    index: int = 0,
) -> Tuple[Optional[MaterializedReference], Optional[UnusableReference]]:
    """Materialize a single reference document.

    Returns a tuple ``(materialized, unusable)`` where exactly one element is
    not ``None``.
    """
    decision = validate_privacy_reference_usability(
        reference,
        upload_dir=upload_dir,
        now_iso=now_iso,
        allow_url_fetch=True,
        allow_storage_download=storage_downloader is not None,
    )
    if not decision.usable and decision.failure_codes:
        return None, UnusableReference(
            reference_id=reference.get("id"),
            teacher_id=reference.get("teacher_id"),
            failure_codes=tuple(decision.failure_codes),
            message=(
                "Reference rejected before materialization: "
                + ", ".join(decision.failure_codes)
            ),
            notes=tuple(decision.notes),
        )

    # 1. Local file path — fastest, no cleanup required.
    local = _materialize_local(reference, upload_dir, max_bytes)
    if local:
        return local, None

    # 2. Authenticated storage download.
    storage_ref, storage_code = _materialize_via_storage(
        reference,
        storage_downloader,
        temp_dir=temp_dir,
        index=index,
        max_bytes=max_bytes,
    )
    if storage_ref:
        return storage_ref, None

    # 3. Optional URL fetch fallback.
    url_ref, url_code = _materialize_via_url(
        reference,
        url_fetcher,
        temp_dir=temp_dir,
        index=index,
        url_fetch_enabled=url_fetch_enabled,
        allowed_hosts=allowed_hosts,
        timeout_seconds=timeout_seconds,
        max_bytes=max_bytes,
    )
    if url_ref:
        return url_ref, None

    failure_codes: List[str] = []
    for code in (storage_code, url_code):
        if code and code not in failure_codes:
            failure_codes.append(code)
    if not failure_codes:
        failure_codes.append("no_usable_references")
    return None, UnusableReference(
        reference_id=reference.get("id"),
        teacher_id=reference.get("teacher_id"),
        failure_codes=tuple(failure_codes),
        message=(
            "Reference could not be materialized: " + ", ".join(failure_codes)
        ),
        notes=tuple(decision.notes),
    )


# ---------------------------------------------------------------------------
# Batch orchestration + cleanup
# ---------------------------------------------------------------------------


def _make_temp_dir(prefix: str) -> Path:
    return Path(tempfile.mkdtemp(prefix=prefix))


def _make_cleanup_callback(temp_dir: Path) -> Callable[[], None]:
    def _cleanup() -> None:
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:  # pragma: no cover
            logger.warning("Failed to clean privacy reference temp dir %s", temp_dir)

    return _cleanup


def materialize_privacy_references(
    references: Iterable[Mapping[str, Any]],
    *,
    upload_dir: Optional[Path] = None,
    storage_downloader: Optional[Callable[[str, Path], None]] = None,
    url_fetcher: Optional[Callable[[str, Path, int, int], None]] = None,
    url_fetch_enabled: bool = False,
    allowed_hosts: Iterable[str] = (),
    timeout_seconds: int = 20,
    max_bytes: int = 10 * 1024 * 1024,
    now_iso: Optional[str] = None,
    temp_dir_prefix: str = "cognivio-privacy-refs-",
) -> PrivacyReferenceMaterializationResult:
    """Materialize a collection of references into a single temp directory.

    The returned :class:`PrivacyReferenceMaterializationResult` carries a
    ``cleanup`` callable; the worker MUST call it in a ``finally`` block to
    delete the temp directory and any materialized files.
    """
    ref_list = list(references)
    if not ref_list:
        return PrivacyReferenceMaterializationResult(
            usable=[],
            unusable=[],
            temp_dir=None,
            failure_codes=("no_reference_records",),
            cleanup=lambda: None,
        )

    temp_dir = _make_temp_dir(temp_dir_prefix)
    cleanup_callback = _make_cleanup_callback(temp_dir)

    usable: List[MaterializedReference] = []
    unusable: List[UnusableReference] = []
    aggregated_codes: List[str] = []
    aggregated_notes: List[str] = []

    for index, reference in enumerate(ref_list):
        materialized, problem = materialize_privacy_reference(
            reference,
            temp_dir=temp_dir,
            upload_dir=upload_dir,
            storage_downloader=storage_downloader,
            url_fetcher=url_fetcher,
            url_fetch_enabled=url_fetch_enabled,
            allowed_hosts=allowed_hosts,
            timeout_seconds=timeout_seconds,
            max_bytes=max_bytes,
            now_iso=now_iso,
            index=index,
        )
        if materialized:
            usable.append(materialized)
            for note in materialized.notes:
                if note not in aggregated_notes:
                    aggregated_notes.append(note)
        else:
            assert problem is not None
            unusable.append(problem)
            for code in problem.failure_codes:
                if code not in aggregated_codes:
                    aggregated_codes.append(code)

    if not usable:
        if "no_usable_references" not in aggregated_codes:
            aggregated_codes.append("no_usable_references")

    return PrivacyReferenceMaterializationResult(
        usable=usable,
        unusable=unusable,
        temp_dir=str(temp_dir),
        failure_codes=tuple(aggregated_codes),
        notes=tuple(aggregated_notes),
        cleanup=cleanup_callback,
    )


def cleanup_materialized_privacy_references(
    result: PrivacyReferenceMaterializationResult,
) -> None:
    """Best-effort cleanup of *result*'s temp directory.

    Safe to call multiple times. Workers MUST call this from a ``finally``
    block; tests may also call it explicitly.
    """
    if result is None or result.cleanup is None:
        return
    try:
        result.cleanup()
    except Exception:  # pragma: no cover
        logger.warning("Privacy reference cleanup failed", exc_info=True)


# ---------------------------------------------------------------------------
# Aggregate readiness — used by readiness endpoint, audit script, smoke
# ---------------------------------------------------------------------------


def evaluate_materialization_capability(
    references: Iterable[Mapping[str, Any]],
    *,
    upload_dir: Optional[Path] = None,
    storage_download_available: bool,
    url_fetch_enabled: bool = False,
    allowed_hosts: Iterable[str] = (),
    now_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Cheap, side-effect-free probe used by readiness / audit / smoke.

    Returns ``{"total", "would_materialize_count", "would_fail_codes"}``.
    Does NOT download anything — it only checks whether the inputs are
    structurally sufficient for materialization to succeed.
    """
    refs_list = list(references)
    summary = summarize_privacy_references(
        refs_list,
        upload_dir=upload_dir,
        now_iso=now_iso,
        allow_url_fetch=url_fetch_enabled,
        allow_storage_download=storage_download_available,
    )
    would_count = 0
    would_codes: List[str] = []
    for detail in summary.details:
        if detail.usable:
            would_count += 1
            continue
        for code in detail.failure_codes:
            if code not in would_codes:
                would_codes.append(code)
    if summary.total and would_count == 0 and "no_usable_references" not in would_codes:
        would_codes.append("no_usable_references")
    return {
        "total": summary.total,
        "would_materialize_count": would_count,
        "would_fail_codes": would_codes,
    }
