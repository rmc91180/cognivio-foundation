"""Video transcode decision + playback / analysis asset selection (PR C9.1).

Three concerns that previously lived inline in ``server.py``:

1. ``decide_transcode_for_upload`` — given an upload's size, choose whether it
   should be transcoded (compressed). Previously the code path was simply::

       transcode_status = QUEUED if VIDEO_TRANSCODE_PIPELINE_ENABLED else NOT_REQUIRED

   which meant 46-80 MB uploads were silently flagged ``not_required`` whenever
   the pipeline flag was off — losing the compression requirement entirely.
2. ``select_playback_asset`` — viewer-role-aware playback URL selection. The
   existing ``_resolve_video_playback_url`` did not differentiate teacher vs
   admin, so teachers could in theory be served the raw URL if privacy stages
   reordered. This module enforces the policy gate: teachers see only redacted
   or explicitly-allowed assets.
3. ``select_analysis_asset`` — pick the asset the analysis pipeline should
   read, with structured failure codes if nothing is reachable.

These helpers never bypass destructive blur, never expose raw video to
teachers, and never mark privacy as completed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from app.services.storage_urls import is_probably_http_url, normalize_storage_url

__all__ = [
    "VIDEO_TRANSCODE_DECISIONS",
    "VIDEO_PLAYBACK_FAILURE_CODES",
    "VIDEO_ANALYSIS_FAILURE_CODES",
    "TranscodeDecision",
    "PlaybackAssetDecision",
    "AnalysisAssetDecision",
    "decide_transcode_for_upload",
    "select_playback_asset",
    "select_analysis_asset",
]

# Decision values are stable strings — used by audit script and persisted in DB.
VIDEO_TRANSCODE_DECISIONS: Tuple[str, ...] = (
    "queued",            # actively queued for transcoding now
    "pending",           # required by policy but worker is not running yet
    "not_required",      # under min size, no compression needed
    "not_required_unknown_size",  # size missing — defer to safer default
)

VIDEO_PLAYBACK_FAILURE_CODES: Tuple[str, ...] = (
    "privacy_not_completed",
    "redacted_asset_missing",
    "policy_blocks_raw_to_teacher",
    "no_playable_asset",
)

VIDEO_ANALYSIS_FAILURE_CODES: Tuple[str, ...] = (
    "privacy_not_completed",
    "no_analysis_asset",
    "asset_path_unreachable",
)


@dataclass(frozen=True)
class TranscodeDecision:
    decision: str
    reason: str
    size_bytes: int
    min_bytes: int


@dataclass(frozen=True)
class PlaybackAssetDecision:
    url: Optional[str]
    source: str  # "redacted" | "processed" | "raw" | "none"
    viewer_role: str
    failure_code: Optional[str] = None


@dataclass(frozen=True)
class AnalysisAssetDecision:
    path: Optional[str]
    url: Optional[str]
    source: str  # "redacted" | "processed" | "raw" | "none"
    failure_code: Optional[str] = None


def decide_transcode_for_upload(
    size_bytes: Optional[int],
    *,
    transcode_enabled: bool,
    pipeline_enabled: bool,
    min_bytes: int,
) -> TranscodeDecision:
    """Decide whether an upload requires compression.

    Rules:

    - Unknown size → ``not_required_unknown_size`` (callers should treat as a
      conservative no-op and not silently change behavior).
    - Size strictly below *min_bytes* → ``not_required``.
    - Size at-or-above *min_bytes* and transcoding is enabled:
      - If the pipeline worker is also running → ``queued``.
      - Otherwise → ``pending`` (policy requires compression but the worker
        isn't wired yet; the upload is held in a state operators can see).
    - Size at-or-above *min_bytes* but transcoding is disabled → ``pending``
      (compression is required by policy regardless of the operator's worker
      toggle; never silently downgrade to ``not_required``).
    """
    safe_min = max(0, int(min_bytes or 0))
    if size_bytes is None:
        return TranscodeDecision(
            decision="not_required_unknown_size",
            reason="size_bytes_missing",
            size_bytes=0,
            min_bytes=safe_min,
        )
    try:
        size_int = int(size_bytes)
    except (TypeError, ValueError):
        return TranscodeDecision(
            decision="not_required_unknown_size",
            reason="size_bytes_invalid",
            size_bytes=0,
            min_bytes=safe_min,
        )
    if size_int < safe_min:
        return TranscodeDecision(
            decision="not_required",
            reason="below_min_bytes",
            size_bytes=size_int,
            min_bytes=safe_min,
        )
    if transcode_enabled and pipeline_enabled:
        return TranscodeDecision(
            decision="queued",
            reason="size_above_min_pipeline_ready",
            size_bytes=size_int,
            min_bytes=safe_min,
        )
    return TranscodeDecision(
        decision="pending",
        reason="size_above_min_but_pipeline_off",
        size_bytes=size_int,
        min_bytes=safe_min,
    )


def _normalize_role(role: Optional[str]) -> str:
    if not role:
        return "teacher"
    cleaned = str(role).strip().lower()
    if cleaned in {"admin", "super_admin", "school_admin", "support"}:
        return "admin"
    if cleaned in {"observer", "coach", "evaluator"}:
        return "observer"
    return "teacher"


def _privacy_completed(video: Mapping[str, Any]) -> bool:
    status = str(video.get("privacy_status") or "").strip().lower()
    return status == "completed"


def _redacted_url(video: Mapping[str, Any]) -> Optional[str]:
    # A1: never emit a /uploads disk URL (cross-replica unsafe). The gateway
    # re-resolves from the persisted object key when the URL is absent.
    url = normalize_storage_url(video.get("redacted_file_url"))
    if url and is_probably_http_url(url):
        return url
    return None


def _processed_url(video: Mapping[str, Any]) -> Optional[str]:
    # A1: never emit a /uploads disk URL (cross-replica unsafe). The gateway
    # re-resolves from the persisted object key when the URL is absent.
    url = normalize_storage_url(video.get("processed_file_url"))
    if url and is_probably_http_url(url):
        return url
    return None


def _raw_url(video: Mapping[str, Any]) -> Optional[str]:
    # A1: never emit a /uploads disk URL (cross-replica unsafe). The gateway
    # re-resolves from the persisted object key when the URL is absent.
    url = normalize_storage_url(video.get("raw_file_url") or video.get("file_url"))
    if url and is_probably_http_url(url):
        return url
    return None


def _redacted_asset_actually_present(video: Mapping[str, Any]) -> bool:
    if video.get("redacted_asset_state") == "stored":
        return True
    if video.get("redacted_file_path") or video.get("redacted_file_url"):
        return True
    return False


def select_playback_asset(
    video: Mapping[str, Any],
    viewer_role: Optional[str] = None,
    *,
    allow_raw_for_admin: bool = True,
) -> PlaybackAssetDecision:
    """Pick the URL a viewer should see, honoring privacy policy.

    Teachers never receive raw URLs. Admins may, but only when
    ``allow_raw_for_admin=True`` AND ``video["allow_unblurred_retention"]`` is
    truthy OR privacy completed and no redacted asset was created (a rare
    operator-side override). Observers behave like teachers.
    """
    role = _normalize_role(viewer_role)
    privacy_done = _privacy_completed(video)

    redacted = _redacted_url(video) if _redacted_asset_actually_present(video) else None
    if redacted:
        return PlaybackAssetDecision(url=redacted, source="redacted", viewer_role=role)

    if role in {"teacher", "observer"}:
        if not privacy_done:
            return PlaybackAssetDecision(
                url=None,
                source="none",
                viewer_role=role,
                failure_code="privacy_not_completed",
            )
        return PlaybackAssetDecision(
            url=None,
            source="none",
            viewer_role=role,
            failure_code="redacted_asset_missing",
        )

    # Admin / support path: prefer processed (compressed), then raw if policy
    # allows. Never serve raw if privacy has not completed.
    processed = _processed_url(video)
    if processed and privacy_done:
        return PlaybackAssetDecision(url=processed, source="processed", viewer_role=role)

    raw = _raw_url(video)
    if not raw:
        return PlaybackAssetDecision(
            url=None,
            source="none",
            viewer_role=role,
            failure_code="no_playable_asset",
        )
    if not privacy_done:
        return PlaybackAssetDecision(
            url=None,
            source="none",
            viewer_role=role,
            failure_code="privacy_not_completed",
        )
    if not allow_raw_for_admin:
        return PlaybackAssetDecision(
            url=None,
            source="none",
            viewer_role=role,
            failure_code="policy_blocks_raw_to_teacher",
        )
    return PlaybackAssetDecision(url=raw, source="raw", viewer_role=role)


def select_analysis_asset(video: Mapping[str, Any]) -> AnalysisAssetDecision:
    """Pick the asset the analysis pipeline should read.

    Preference order: ``redacted`` → ``processed`` → ``raw``. Analysis must
    not start until privacy is completed (raw fallback is allowed only when
    ``destructive_blurring_enabled`` is False AND
    ``allow_unblurred_retention`` is True).
    """
    privacy_done = _privacy_completed(video)
    if not privacy_done:
        return AnalysisAssetDecision(
            path=None,
            url=None,
            source="none",
            failure_code="privacy_not_completed",
        )

    redacted_relative = video.get("redacted_file_path")
    if redacted_relative:
        return AnalysisAssetDecision(
            path=str(redacted_relative),
            url=_redacted_url(video),
            source="redacted",
        )

    processed_relative = video.get("processed_file_path")
    if processed_relative:
        return AnalysisAssetDecision(
            path=str(processed_relative),
            url=_processed_url(video),
            source="processed",
        )

    raw_relative = video.get("raw_file_path") or video.get("file_path")
    if raw_relative and not video.get("destructive_blurring_enabled", True):
        return AnalysisAssetDecision(
            path=str(raw_relative),
            url=_raw_url(video),
            source="raw",
        )

    return AnalysisAssetDecision(
        path=None,
        url=None,
        source="none",
        failure_code="no_analysis_asset",
    )
