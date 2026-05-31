"""PR C9.5 PART 1 + PART 5 — effective privacy policy + truth/playback gates.

This module is the single, pure, testable source of truth for *whether a
teacher-facing surface may claim privacy is ready and may be served a
playback URL*. It exists because the production symptom was a "Privacy ready"
badge (and a teacher playback URL) shown for a video whose redacted output
still contained visibly unblurred faces.

The contracts implemented here (mission C9.5):

A. **Privacy truth** — "Privacy ready" may be asserted only when
   (1) face blurring is required AND the exact playback asset's visual
   redaction validation passed (and browser-playback validation passed), OR
   (2) face blurring is explicitly disabled by an *audited, active* privacy
   policy override.

B. **Playback** — a teacher playback URL may be exposed only when
   (1) the redacted asset passed visual + playback validation, OR
   (2) an active audited policy override allows unblurred/processed playback.

E. **Override precedence** — ``video`` > ``teacher`` > ``school`` > default.
   The default is ALWAYS ``face_blurring_required = True`` (fail-closed). An
   override only ever takes effect when it is active, unexpired, and carries a
   non-empty audited reason + actor (validated at the write site in server.py).

Everything here is dependency-free (no FastAPI, no Mongo) so it can be unit
tested directly and imported by both the API layer and the audit/smoke tools.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

# --------------------------------------------------------------------------- #
# Vocabulary
# --------------------------------------------------------------------------- #
PRIVACY_OVERRIDE_SCOPES: Tuple[str, ...] = ("video", "teacher", "school")

# Higher number wins. ``default`` is the implicit baseline (no override).
_SCOPE_PRECEDENCE: Dict[str, int] = {"video": 3, "teacher": 2, "school": 1, "default": 0}

TEACHER_SAFE_LABEL_BLURRED = "Privacy protection applied"
TEACHER_SAFE_LABEL_DISABLED = "Face blurring disabled by admin policy"

# Privacy-readiness badge statuses surfaced to the frontend.
PRIVACY_BADGE_STATUSES: Tuple[str, ...] = (
    "ready",            # policy satisfied — safe to show "Privacy ready"
    "needs_attention",  # required-but-unverified (missing/inconclusive) — NOT ready
    "retry_needed",     # required-and-failed — NOT ready, retry eligible
    "processing",       # pipeline still running
    "blocked",          # awaiting human privacy review
)


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _validation_status(record: Any) -> Tuple[Optional[str], Optional[str]]:
    """Return ``(status, failure_code)`` from a stored validation dict."""
    if isinstance(record, Mapping):
        return record.get("status"), record.get("failure_code")
    return None, None


def redacted_asset_present(video: Mapping[str, Any]) -> bool:
    """True when a rendered redacted asset actually exists on the doc."""
    if not isinstance(video, Mapping):
        return False
    return bool(
        video.get("redacted_asset_state") == "stored"
        or video.get("redacted_file_path")
        or video.get("redacted_file_url")
    )


# --------------------------------------------------------------------------- #
# Override selection (PART 5 model is queried; this picks the effective one)
# --------------------------------------------------------------------------- #
def override_is_active(override: Any, now: Optional[datetime] = None) -> bool:
    """An override counts only when active and not expired.

    A missing ``is_active`` defaults to active (back-compat), but an explicit
    ``False`` deactivates it. Deactivation is preferred over deletion so the
    audit trail survives.
    """
    if not isinstance(override, Mapping):
        return False
    if override.get("is_active") is False:
        return False
    expires = _parse_iso(override.get("expires_at"))
    if expires is not None and expires <= (now or _now()):
        return False
    return True


def _override_matches(
    override: Mapping[str, Any],
    *,
    video_id: Optional[str],
    teacher_id: Optional[str],
    school_id: Optional[str],
) -> bool:
    scope = _norm(override.get("scope"))
    scope_id = str(override.get("scope_id") or "")
    if scope == "video":
        return bool(video_id) and scope_id == str(video_id)
    if scope == "teacher":
        return bool(teacher_id) and scope_id == str(teacher_id)
    if scope == "school":
        return bool(school_id) and scope_id == str(school_id)
    return False


def select_active_override(
    overrides: Optional[Iterable[Mapping[str, Any]]],
    *,
    video_id: Optional[str] = None,
    teacher_id: Optional[str] = None,
    school_id: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Optional[Mapping[str, Any]]:
    """Pick the highest-precedence active override matching this video.

    Precedence: ``video`` > ``teacher`` > ``school``. Ties (same scope) break
    by most recent ``created_at``.
    """
    now = now or _now()
    candidates: List[Mapping[str, Any]] = []
    for override in overrides or []:
        if not override_is_active(override, now):
            continue
        if _override_matches(
            override, video_id=video_id, teacher_id=teacher_id, school_id=school_id
        ):
            candidates.append(override)
    if not candidates:
        return None

    def _key(o: Mapping[str, Any]) -> Tuple[int, str]:
        return (
            _SCOPE_PRECEDENCE.get(_norm(o.get("scope")), 0),
            str(o.get("created_at") or ""),
        )

    return sorted(candidates, key=_key)[-1]


# --------------------------------------------------------------------------- #
# PART 1 — effective privacy policy
# --------------------------------------------------------------------------- #
def default_privacy_policy() -> Dict[str, Any]:
    """The fail-closed default: destructive face blurring required."""
    return {
        "face_blurring_required": True,
        "source": "default",
        "scope": "default",
        "reason": "Destructive face blurring enabled by default",
        "actor_id": None,
        "set_at": None,
        "expires_at": None,
        "policy_version": 1,
        "override_id": None,
        "teacher_safe_label": TEACHER_SAFE_LABEL_BLURRED,
    }


def build_effective_privacy_policy(
    video: Optional[Mapping[str, Any]],
    teacher: Optional[Mapping[str, Any]] = None,
    school: Optional[Mapping[str, Any]] = None,
    admin_overrides: Optional[Iterable[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    """Resolve the effective privacy policy for one video.

    Precedence: video override > teacher override > school override > default.
    The default is ``face_blurring_required = True``. ``admin_overrides`` is the
    list of override records the caller loaded from the
    ``privacy_policy_overrides`` collection; this function filters them to the
    active, in-scope, highest-precedence one. Pure — no DB access.
    """
    video = dict(video or {})
    teacher = dict(teacher or {})
    school = dict(school or {})

    video_id = video.get("id") or video.get("video_id")
    teacher_id = video.get("teacher_id") or teacher.get("id")
    school_id = (
        teacher.get("school_id")
        or school.get("id")
        or video.get("school_id")
    )

    override = select_active_override(
        admin_overrides,
        video_id=video_id,
        teacher_id=teacher_id,
        school_id=school_id,
    )
    if override is None:
        return default_privacy_policy()

    required = bool(override.get("face_blurring_required"))
    scope = _norm(override.get("scope")) or "video"
    return {
        "face_blurring_required": required,
        "source": f"{scope}_override",
        "scope": scope,
        "reason": override.get("reason"),
        "actor_id": override.get("created_by") or override.get("actor_id"),
        "set_at": override.get("created_at"),
        "expires_at": override.get("expires_at"),
        "policy_version": int(override.get("policy_version") or 1),
        "override_id": override.get("id"),
        "teacher_safe_label": (
            TEACHER_SAFE_LABEL_BLURRED if required else TEACHER_SAFE_LABEL_DISABLED
        ),
    }


# --------------------------------------------------------------------------- #
# PART 1 — privacy readiness (the badge truth)
# --------------------------------------------------------------------------- #
def evaluate_privacy_readiness(
    video: Optional[Mapping[str, Any]],
    policy: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Decide whether "Privacy ready" may truthfully be shown.

    Returns ``{privacy_ready, badge_status, reason_code, teacher_safe_label,
    face_blurring_required}``. Fail-closed: when blur is required, readiness
    demands BOTH validations ``passed``; a missing/skipped/inconclusive visual
    record reads ``needs_attention`` (NOT ready), and a failed one reads
    ``retry_needed``.
    """
    video = dict(video or {})
    policy = dict(policy or default_privacy_policy())
    required = bool(policy.get("face_blurring_required", True))
    label = policy.get("teacher_safe_label") or (
        TEACHER_SAFE_LABEL_BLURRED if required else TEACHER_SAFE_LABEL_DISABLED
    )

    def _result(ready: bool, badge: str, reason: str) -> Dict[str, Any]:
        return {
            "privacy_ready": ready,
            "badge_status": badge,
            "reason_code": reason,
            "teacher_safe_label": label,
            "face_blurring_required": required,
        }

    # Blur disabled by an audited active policy → privacy is resolved by policy.
    if not required:
        return _result(True, "ready", "blur_disabled_by_policy")

    privacy_status = _norm(video.get("privacy_status"))
    if privacy_status == "failed":
        return _result(False, "retry_needed", "privacy_failed")
    if privacy_status == "review_required":
        return _result(False, "blocked", "privacy_review_required")
    if privacy_status in {"", "queued", "processing", "pending"}:
        return _result(False, "processing", "privacy_processing")
    if privacy_status == "not_required":
        # Pipeline declared privacy not required (no faces / policy) — treat as
        # resolved only when no redacted asset is expected.
        return _result(True, "ready", "privacy_not_required")

    # privacy_status == "completed" (or other terminal) → must VERIFY the asset.
    if not redacted_asset_present(video):
        return _result(False, "needs_attention", "no_redacted_asset")

    vis_status, _vis_code = _validation_status(video.get("visual_redaction_validation"))
    if vis_status == "failed":
        return _result(False, "retry_needed", "visual_redaction_failed")
    if vis_status != "passed":
        # missing / skipped_unavailable / inconclusive — never assert ready.
        return _result(False, "needs_attention", "visual_redaction_unverified")

    pb_status, _pb_code = _validation_status(video.get("redacted_playback_validation"))
    if pb_status == "failed":
        return _result(False, "retry_needed", "playback_validation_failed")
    if pb_status != "passed":
        return _result(False, "needs_attention", "playback_validation_pending")

    return _result(True, "ready", "redaction_verified")


# --------------------------------------------------------------------------- #
# PART 1 — teacher playback gate
# --------------------------------------------------------------------------- #
def teacher_playback_policy_allows(
    video: Optional[Mapping[str, Any]],
    policy: Optional[Mapping[str, Any]] = None,
) -> Tuple[bool, str, str]:
    """Whether a teacher MAY be served *any* playback URL under the policy.

    Returns ``(allowed, mode, reason_code)`` where ``mode`` is
    ``"blurred_required"`` or ``"blur_disabled_by_policy"``. This is the policy
    half of the decision; the concrete URL/asset selection still runs through
    ``select_playback_asset`` at the call site. Fail-closed by default.
    """
    video = dict(video or {})
    policy = dict(policy or default_privacy_policy())
    required = bool(policy.get("face_blurring_required", True))

    if not required:
        # An audited override permits processed/raw playback to the teacher.
        return True, "blur_disabled_by_policy", "policy_allows_unblurred"

    vis_status, _ = _validation_status(video.get("visual_redaction_validation"))
    pb_status, _ = _validation_status(video.get("redacted_playback_validation"))
    if (
        redacted_asset_present(video)
        and vis_status == "passed"
        and pb_status == "passed"
    ):
        return True, "blurred_required", "redaction_verified"
    return False, "blurred_required", "redaction_unverified"


# --------------------------------------------------------------------------- #
# PART 5 — override record construction + validation
# --------------------------------------------------------------------------- #
class PrivacyOverrideError(ValueError):
    """Raised when an override write request is invalid."""


def build_privacy_override_record(
    *,
    scope: str,
    scope_id: str,
    face_blurring_required: bool,
    reason: str,
    actor_id: str,
    actor_role: Optional[str] = None,
    expires_at: Optional[str] = None,
    policy_version: int = 1,
    override_id: Optional[str] = None,
    created_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate + construct a privacy override record (PART 5).

    Guardrails enforced here (fail-closed): scope must be one of
    ``video|teacher|school``; ``scope_id`` and a non-empty ``reason`` and
    ``actor_id`` are mandatory. The caller (server.py) is responsible for
    admin-role authorization and for persisting/deactivating prior records.
    """
    scope_norm = _norm(scope)
    if scope_norm not in PRIVACY_OVERRIDE_SCOPES:
        raise PrivacyOverrideError(
            f"scope must be one of {PRIVACY_OVERRIDE_SCOPES}, got {scope!r}"
        )
    if not str(scope_id or "").strip():
        raise PrivacyOverrideError("scope_id is required")
    if not str(reason or "").strip():
        raise PrivacyOverrideError("a non-empty reason is required for a privacy override")
    if not str(actor_id or "").strip():
        raise PrivacyOverrideError("actor_id is required")

    import uuid as _uuid

    now_iso = created_at or _now().isoformat()
    return {
        "id": override_id or str(_uuid.uuid4()),
        "scope": scope_norm,
        "scope_id": str(scope_id),
        "face_blurring_required": bool(face_blurring_required),
        "reason": str(reason).strip(),
        "created_by": str(actor_id),
        "actor_role": actor_role,
        "created_at": now_iso,
        "expires_at": expires_at,
        "is_active": True,
        "policy_version": int(policy_version or 1),
    }


def privacy_policy_public_view(policy: Mapping[str, Any]) -> Dict[str, Any]:
    """Teacher-safe projection of an effective policy (no actor PII leaked)."""
    policy = dict(policy or {})
    required = bool(policy.get("face_blurring_required", True))
    return {
        "face_blurring_required": required,
        "teacher_safe_label": policy.get("teacher_safe_label")
        or (TEACHER_SAFE_LABEL_BLURRED if required else TEACHER_SAFE_LABEL_DISABLED),
        "source": policy.get("source", "default"),
        "scope": policy.get("scope", "default"),
    }
