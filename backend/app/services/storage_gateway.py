"""StorageGateway — the single fail-closed chokepoint for all video assets.

Phase A, Work Package A1.

WHY THIS EXISTS
---------------
Video assets used to be written to one replica's local disk (then *also* pushed
to R2 as a secondary copy), while serve / rehydration still reached for the disk
path. A worker on replica B cannot read a file on replica A's disk, so the
system could not run more than one replica. This gateway makes **R2 the source
of truth** and is the ONE place every video-asset write, serve-URL vend, and
processing-location resolve funnels through.

TWO AXES — STRICTLY SEPARATED
-----------------------------
* PRIVACY axis (CONSUME, DON'T COMPUTE): the gateway does NOT re-derive a
  privacy predicate of its own. The serve decision is **delegated** to the code
  that already owns it — :func:`app.services.video_assets.select_playback_asset`
  (and, for teacher serve, the redacted-playback readiness gate). The gateway
  vends **only** what that logic already approves; it never vends anything
  today's gate refuses. The institution-policy override
  (``video["allow_unblurred_retention"]``) is honored *for free* by delegation —
  there is deliberately no separate override branch here.

  The ONE privacy thing the gateway adds is a top-level, role-independent,
  override-independent refusal for the two terminal-unsafe states (A1 Q1):
      - ``privacy_status == "review_required"``
      - ``privacy_pipeline_state == "destructive_blur_failed"``
  These run BEFORE delegation and cannot be bypassed by role or override,
  because delegation alone does not refuse them in every branch (the redacted
  branch vends unconditionally; the admin-raw path bypasses delegation; and the
  pipeline-state is never consulted by the existing decision).

* STORAGE axis (the actual A1 value): resolve approved bytes/URLs through the
  configured backend (R2 in prod). Never vend a ``/uploads/`` disk URL. Fail
  closed on ANY error resolving status or location — an exception path that
  ends in "serve anyway" is a bug.

This module imports only pure helpers (``storage_urls``, ``video_assets``) so it
has no import cycle with ``server.py``. ``server.py`` constructs the singleton
and may inject its own readiness predicate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Tuple

from app.services.storage_urls import (
    build_public_storage_url,
    is_probably_http_url,
    normalize_storage_url,
)
from app.services.video_assets import select_playback_asset

logger = logging.getLogger(__name__)

__all__ = [
    "QUARANTINE_PRIVACY_STATUSES",
    "QUARANTINE_PIPELINE_STATES",
    "GUARDED_STATIC_VIDEO_PREFIXES",
    "is_blocked_static_video_path",
    "VendResult",
    "StorageWriteError",
    "StorageBackend",
    "LocalBackend",
    "R2Backend",
    "MockBackend",
    "StorageGateway",
    "build_gateway",
    "default_redacted_ready",
]

# The two REAL terminal-unsafe states (A1 Q1, confirmed). Compared as
# lower-cased strings so we never import server-side enums (avoids a cycle).
QUARANTINE_PRIVACY_STATUSES = frozenset({"review_required"})
QUARANTINE_PIPELINE_STATES = frozenset({"destructive_blur_failed"})

# A1: bounded timeouts for the R2 backend so no S3-compatible call hangs
# unbounded — most importantly the localize() download, the single new external
# call A1 introduces. read_timeout bounds any single stalled socket read (NOT the
# total transfer), so legitimately large uploads/downloads are not falsely
# failed; connect_timeout bounds connection setup; retries are capped.
R2_CONNECT_TIMEOUT_SECONDS = 5
R2_READ_TIMEOUT_SECONDS = 60
R2_MAX_ATTEMPTS = 3

# A1: video-asset path prefixes that must NEVER be served off the dev StaticFiles
# mount under a non-local backend. These bytes are gateway-vended (R2) only.
# NOTE: these are the on-disk *relative serve paths* used by the /uploads mount
# (request path), NOT the R2 object keys — they intentionally differ. Each entry
# matches a real served prefix:
#   raw video         -> videos/{teacher}/...            (-> /uploads/videos/)
#   redacted video    -> redacted/{teacher}/...          (-> /uploads/redacted/)
#   processed video   -> processed/{teacher}/...         (-> /uploads/processed/)
#   redacted thumbnail-> thumbnails/redacted/{teacher}/. (-> /uploads/thumbnails/redacted/)
GUARDED_STATIC_VIDEO_PREFIXES = (
    "/uploads/videos/",
    "/uploads/redacted/",
    "/uploads/processed/",
    "/uploads/thumbnails/redacted/",
)


def is_blocked_static_video_path(path: Optional[str], *, backend_name: str) -> bool:
    """Defense-in-depth (belt-and-suspenders): True when a request to the dev
    StaticFiles mount targets a video asset that must only ever be vended through
    the gateway. Always False for the local/dev backend (a single replica
    legitimately serves its on-disk scratch). Out-of-scope document assets
    (curricula / lesson_plans / syllabi) are never blocked."""
    if backend_name == "local":
        return False
    candidate = (path or "").split("?", 1)[0]
    return any(candidate.startswith(prefix) for prefix in GUARDED_STATIC_VIDEO_PREFIXES)


class StorageWriteError(RuntimeError):
    """Raised when the backend cannot durably persist an asset. Fail-closed:
    callers must treat this as "no servable asset", never fall back to disk."""


@dataclass(frozen=True)
class VendResult:
    """Outcome of a serve-URL vend. ``url`` is populated ONLY when serving is
    authorized AND the location resolved to a real object-store URL. ``reason``
    is a short diagnostic code — never a URL or a disk path."""

    url: Optional[str]
    source: str  # "redacted" | "processed" | "raw" | "redacted_thumbnail" | "none"
    refused: bool
    reason: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.url is not None and not self.refused


# ---------------------------------------------------------------------------
# Asset-kind -> persisted DB field mapping (pure dict reads)
# ---------------------------------------------------------------------------

def _key_for_source(video: Mapping[str, Any], source: str) -> Optional[str]:
    if source == "redacted":
        return video.get("redacted_s3_key")
    if source == "processed":
        return video.get("processed_s3_key")
    if source == "raw":
        return video.get("raw_s3_key") or video.get("s3_key")
    return None


def default_redacted_ready(video: Mapping[str, Any]) -> bool:
    """Mirror of ``server._redacted_playback_ready`` using the same fail-closed
    rule: a redacted asset is teacher-servable only when it passed BOTH browser-
    playback validation AND visual-redaction validation. A missing/!="passed"
    record on either gate is NOT ready. ``server.py`` injects its own predicate;
    this default keeps tests and any non-server caller in agreement."""

    def _passed(field: str) -> bool:
        rec = video.get(field)
        return isinstance(rec, Mapping) and rec.get("status") == "passed"

    return _passed("redacted_playback_validation") and _passed("visual_redaction_validation")


# ---------------------------------------------------------------------------
# Storage backends
# ---------------------------------------------------------------------------

class StorageBackend:
    """Interface. Implementations must NEVER swallow a write/fetch failure into
    a disk fallback — raise instead, so the gateway can fail closed."""

    name: str = "base"

    def write(self, key: str, local_path: Path, content_type: str) -> Tuple[Optional[str], str]:
        raise NotImplementedError

    def public_url(self, key: Optional[str]) -> Optional[str]:
        raise NotImplementedError

    def fetch_to_path(self, key: str, dest: Path) -> None:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError


class LocalBackend(StorageBackend):
    """Dev-only single-replica backend. Serves the on-disk scratch copy in place
    via an absolute backend URL (NOT a bare ``/uploads/`` relative path)."""

    name = "local"

    def __init__(self, *, upload_dir: Path, public_base_url: str) -> None:
        self._upload_dir = Path(upload_dir)
        self._public_base_url = (public_base_url or "").rstrip("/")

    def _rel(self, local_path: Path) -> str:
        try:
            return str(Path(local_path).resolve().relative_to(self._upload_dir.resolve())).replace("\\", "/")
        except Exception:
            return Path(local_path).name

    def write(self, key: str, local_path: Path, content_type: str) -> Tuple[Optional[str], str]:
        rel = self._rel(Path(local_path))
        if not self._public_base_url:
            # No absolute base configured: still avoid a bare relative path by
            # returning a path the dev StaticFiles mount can serve from root.
            return None, f"/uploads/{rel}"
        return None, f"{self._public_base_url}/uploads/{rel}"

    def public_url(self, key: Optional[str]) -> Optional[str]:
        # Local backend has no object keys; serve resolution relies on the
        # already-stored absolute URL. Return None so the gateway falls through
        # to the stored URL (and fails closed if there isn't one).
        return None

    def fetch_to_path(self, key: str, dest: Path) -> None:
        # Nothing to fetch — the bytes already live on this replica's disk.
        raise FileNotFoundError("local backend has no remote object to fetch")

    def exists(self, key: str) -> bool:
        return False


class R2Backend(StorageBackend):
    """Production backend (Cloudflare R2 / any S3-compatible store). Subsumes the
    former ``_upload_path_to_s3`` / ``_get_s3_client`` / ``_get_s3_public_url``
    logic so there is exactly one write path and one URL builder."""

    name = "r2"

    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        endpoint: str,
        public_base_url: str,
        access_key: str,
        secret_key: str,
        connect_timeout: float = R2_CONNECT_TIMEOUT_SECONDS,
        read_timeout: float = R2_READ_TIMEOUT_SECONDS,
        max_attempts: int = R2_MAX_ATTEMPTS,
    ) -> None:
        self._bucket = (bucket or "").strip()
        self._region = (region or "").strip()
        self._endpoint = normalize_storage_url(endpoint) or (endpoint or "").strip()
        self._public_base_url = normalize_storage_url(public_base_url) or ""
        self._access_key = access_key or ""
        self._secret_key = secret_key or ""
        self._connect_timeout = connect_timeout
        self._read_timeout = read_timeout
        self._max_attempts = max_attempts

    def _client(self):
        import boto3  # lazy: keeps MockBackend/tests free of the boto3 dependency
        from botocore.config import Config

        session = boto3.session.Session(
            aws_access_key_id=self._access_key or None,
            aws_secret_access_key=self._secret_key or None,
            region_name=self._region or None,
        )
        # A1: bound every R2 call (connect/read/retries) so localize()'s download
        # and the write/exists calls can never hang unbounded.
        config = Config(
            connect_timeout=self._connect_timeout,
            read_timeout=self._read_timeout,
            retries={"max_attempts": self._max_attempts, "mode": "standard"},
        )
        return session.client("s3", endpoint_url=self._endpoint or None, config=config)

    def public_url(self, key: Optional[str]) -> Optional[str]:
        if not key:
            return None
        return build_public_storage_url(
            key,
            public_base_url=self._public_base_url,
            endpoint=self._endpoint,
            region=self._region,
            bucket=self._bucket,
        )

    def write(self, key: str, local_path: Path, content_type: str) -> Tuple[Optional[str], str]:
        if not self._bucket:
            raise StorageWriteError("r2_bucket_unconfigured")
        try:
            client = self._client()
            client.upload_file(
                str(local_path),
                self._bucket,
                key,
                ExtraArgs={"ContentType": content_type or "application/octet-stream"},
            )
        except Exception as exc:  # boto/network/credential failure
            raise StorageWriteError(f"r2_upload_failed: {exc}") from exc
        url = self.public_url(key)
        if not (url and is_probably_http_url(url)):
            raise StorageWriteError("r2_public_url_unresolved")
        return key, url

    def fetch_to_path(self, key: str, dest: Path) -> None:
        if not self._bucket:
            raise FileNotFoundError("r2_bucket_unconfigured")
        dest.parent.mkdir(parents=True, exist_ok=True)
        client = self._client()
        client.download_file(self._bucket, key, str(dest))

    def exists(self, key: str) -> bool:
        if not self._bucket or not key:
            return False
        try:
            self._client().head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False


class MockBackend(StorageBackend):
    """In-memory backend for tests. NEVER touches disk or network. Stored keys
    vend a syntactically-valid https URL so the serve-resolution path exercises
    the same ``is_probably_http_url`` gate as production."""

    name = "mock"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail_public_url = False  # flip in a test to simulate a resolve error

    def write(self, key: str, local_path: Path, content_type: str) -> Tuple[Optional[str], str]:
        self.objects[key] = b"mock-bytes"
        return key, f"https://mock.local/{key.lstrip('/')}"

    def public_url(self, key: Optional[str]) -> Optional[str]:
        if self.fail_public_url:
            raise RuntimeError("simulated public_url failure")
        if not key or key not in self.objects:
            return None
        return f"https://mock.local/{key.lstrip('/')}"

    def fetch_to_path(self, key: str, dest: Path) -> None:
        if key not in self.objects:
            raise FileNotFoundError(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.objects[key])

    def exists(self, key: str) -> bool:
        return key in self.objects


# ---------------------------------------------------------------------------
# The gateway
# ---------------------------------------------------------------------------

class StorageGateway:
    def __init__(self, backend: StorageBackend, *, redacted_ready=None) -> None:
        self._backend = backend
        self._redacted_ready = redacted_ready or default_redacted_ready

    @property
    def backend_name(self) -> str:
        return self._backend.name

    @property
    def backend(self) -> StorageBackend:
        return self._backend

    # -- PRIVACY: the one role/override-independent refusal -----------------
    @staticmethod
    def is_quarantined(video: Mapping[str, Any]) -> bool:
        ps = str(video.get("privacy_status") or "").strip().lower()
        pstate = str(video.get("privacy_pipeline_state") or "").strip().lower()
        return ps in QUARANTINE_PRIVACY_STATUSES or pstate in QUARANTINE_PIPELINE_STATES

    # -- SERVE: delegate the decision, resolve the location -----------------
    def vend_playback_url(
        self,
        video: Mapping[str, Any],
        viewer_role: Optional[str],
        *,
        allow_raw_for_admin: bool,
        require_redacted_ready: bool = False,
    ) -> VendResult:
        """Vend a playback URL, or refuse. The privacy decision is DELEGATED to
        ``select_playback_asset``; the gateway adds (1) the unconditional
        quarantine refusal, (2) optional redacted-readiness for teacher serve,
        and (3) object-store location resolution (never a disk URL)."""
        try:
            # (1) Unconditional terminal-state refusal — before any delegation,
            #     no role/override can bypass it.
            if self.is_quarantined(video):
                return VendResult(None, "none", True, "refused_quarantine")

            # (2) Delegate the privacy/asset decision (consume, don't compute).
            decision = select_playback_asset(
                video, viewer_role, allow_raw_for_admin=allow_raw_for_admin
            )
            if not decision.url:
                return VendResult(None, decision.source, True, decision.failure_code or "no_servable_asset")

            # (3) Teacher/observer serve additionally honors redacted readiness.
            if require_redacted_ready and not self._redacted_ready(video):
                return VendResult(None, decision.source, True, "redacted_not_ready")

            # (4) STORAGE axis: must resolve to a real object-store URL.
            return self._resolve_serve_url(video, decision.source, decision.url)
        except Exception as exc:  # fail-closed on ANY unexpected error
            logger.warning("vend_playback_url failed closed for video %s: %s", video.get("id"), exc)
            return VendResult(None, "none", True, "internal_error")

    def vend_raw_url(self, video: Mapping[str, Any]) -> VendResult:
        """Admin unblurred-source vend (the path that historically bypassed
        ``select_playback_asset``). Still subject to the quarantine refusal and
        the never-disk rule. Caller remains responsible for its own
        authorization (admin role, reason, UNBLURRED_DELETED guard)."""
        try:
            if self.is_quarantined(video):
                return VendResult(None, "none", True, "refused_quarantine")
            url = normalize_storage_url(video.get("raw_file_url") or video.get("file_url"))
            if url and is_probably_http_url(url):
                return VendResult(url, "raw", False, None)
            resolved = self._backend.public_url(_key_for_source(video, "raw"))
            if resolved and is_probably_http_url(resolved):
                return VendResult(resolved, "raw", False, None)
            return VendResult(None, "raw", True, "raw_location_unresolved")
        except Exception as exc:
            logger.warning("vend_raw_url failed closed for video %s: %s", video.get("id"), exc)
            return VendResult(None, "none", True, "internal_error")

    def vend_thumbnail_url(self, video: Mapping[str, Any]) -> VendResult:
        """Vend the redacted thumbnail URL, or refuse. Quarantined assets never
        vend a thumbnail either."""
        try:
            if self.is_quarantined(video):
                return VendResult(None, "none", True, "refused_quarantine")
            url = normalize_storage_url(video.get("redacted_thumbnail_url"))
            if url and is_probably_http_url(url):
                return VendResult(url, "redacted_thumbnail", False, None)
            return VendResult(None, "redacted_thumbnail", True, "thumbnail_location_unresolved")
        except Exception as exc:
            logger.warning("vend_thumbnail_url failed closed for video %s: %s", video.get("id"), exc)
            return VendResult(None, "none", True, "internal_error")

    def _resolve_serve_url(self, video: Mapping[str, Any], source: str, decision_url: str) -> VendResult:
        # Prefer the already-persisted public URL when it is a real http(s)/s3
        # URL (this is the R2 URL written at ingest / worker output).
        url = normalize_storage_url(decision_url)
        if url and is_probably_http_url(url):
            return VendResult(url, source, False, None)
        # Otherwise re-resolve from the persisted object key via the backend.
        resolved = self._backend.public_url(_key_for_source(video, source))
        if resolved and is_probably_http_url(resolved):
            return VendResult(resolved, source, False, None)
        # Fail closed — NEVER vend a /uploads disk URL.
        return VendResult(None, source, True, "asset_location_unresolved")

    # -- WRITE: subsumes _upload_path_to_s3 ---------------------------------
    def write_asset(self, *, key: str, local_path, content_type: str) -> Tuple[Optional[str], str]:
        """Persist ``local_path`` under ``key`` through the backend. Returns
        ``(object_key_or_None, serve_url)``. Raises ``StorageWriteError`` on
        failure — callers MUST treat that as "no servable asset" and never fall
        back to a disk URL."""
        return self._backend.write(key, Path(local_path), content_type)

    # -- RESOLVE-FOR-PROCESSING: rehydration location resolve ---------------
    def localize(
        self,
        *,
        s3_key: Optional[str],
        relative_path: Optional[str],
        scratch_dir,
    ) -> Optional[str]:
        """Return a local filesystem path a worker can open for *processing*,
        fetching the object from the backend if it is not already on this
        replica's disk. Returns ``None`` (fail-closed: caller skips) when the
        asset cannot be made available locally. Used by rehydration to replace
        the old ``UPLOAD_DIR / file_path`` disk-path assumption so any replica
        can resume work whose bytes live in R2."""
        scratch = Path(scratch_dir)
        # Local/dev backend: the bytes are already on this disk.
        if self._backend.name == "local":
            if not relative_path:
                return None
            candidate = scratch / str(relative_path)
            return str(candidate) if candidate.exists() else None
        # Object backend: reuse an existing local copy, else download by key.
        if relative_path:
            existing = scratch / str(relative_path)
            if existing.exists():
                return str(existing)
        if not s3_key:
            return None
        dest = scratch / "_gw_cache" / str(s3_key)
        try:
            if not dest.exists():
                self._backend.fetch_to_path(s3_key, dest)
                logger.info("gateway_localize_fetched_from_object_store key=%s", s3_key)
            return str(dest)
        except Exception as exc:
            logger.warning("localize failed closed for key %s: %s", s3_key, exc)
            return None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_gateway(storage_settings, *, redacted_ready=None, backend_override: Optional[str] = None) -> StorageGateway:
    """Build the gateway from ``StorageSettings``. Backend selection order:
    explicit ``backend_override`` > ``storage_settings.storage_backend`` >
    auto (``r2`` when a bucket is configured, else ``local``). ``mock`` is
    selectable for tests."""
    name = (backend_override or getattr(storage_settings, "storage_backend", "") or "auto").strip().lower()
    if name in ("", "auto"):
        name = "r2" if getattr(storage_settings, "s3_bucket", "") else "local"

    if name == "mock":
        backend: StorageBackend = MockBackend()
    elif name == "local":
        backend = LocalBackend(
            upload_dir=storage_settings.upload_dir,
            public_base_url=storage_settings.backend_public_base_url,
        )
    else:  # "r2" / "s3" / anything S3-compatible
        backend = R2Backend(
            bucket=storage_settings.s3_bucket,
            region=storage_settings.s3_region,
            endpoint=storage_settings.s3_endpoint,
            public_base_url=storage_settings.s3_public_base_url,
            access_key=storage_settings.aws_access_key_id,
            secret_key=storage_settings.aws_secret_access_key,
        )
    return StorageGateway(backend, redacted_ready=redacted_ready)
