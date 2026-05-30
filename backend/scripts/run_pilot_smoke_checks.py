"""Pilot smoke-check automation for the teacher coaching workspace.

PR C6 ships this read-only script so operators can confirm the pilot
gates hold up against a real MongoDB after deploy. The script never
writes; it loads the teacher / video / assessment / coaching_tasks /
coaching_task_reflections / recognition_badges /
teacher_feedback_reviews documents and re-runs the C1–C5 + C6 gates in
memory.

Each check returns a small ``CheckResult`` (status, code, message,
samples). The aggregate result is printed as JSON when ``--json`` is
passed and as a short human-readable report otherwise.

Exit code is 0 when every check is ``ok`` or ``warn`` and 1 when any
check is ``fail``. Operators are expected to wire this into a deploy
hook or run it manually with a forensic teacher id.

USAGE
=====

    MONGO_URL=... DB_NAME=... \
      python backend/scripts/run_pilot_smoke_checks.py \
        --teacher-id <teacher-id> \
        --json

    MONGO_URL=... DB_NAME=... \
      python backend/scripts/run_pilot_smoke_checks.py \
        --assessment-id <assessment-id>

Manual API smoke (cannot be run from this script because auth is
session-scoped):

    curl -H "Authorization: Bearer $TEACHER_TOKEN" \
         "$BASE_URL/api/teachers/me/latest-lesson"

    curl -H "Authorization: Bearer $TEACHER_TOKEN" \
         "$BASE_URL/api/teachers/me/coaching"

    curl -H "Authorization: Bearer $ADMIN_TOKEN" \
         "$BASE_URL/api/assessments/<id>"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


from app.services.teacher_artifact_quarantine import (  # noqa: E402
    KNOWN_BAD_TEACHER_TEXT_PATTERNS,
    build_source_validity,
    find_teacher_visible_text_issues,
)
from app.services.lesson_moment_quality import (  # noqa: E402
    assessment_quality_blocks_teacher_feedback,
)
from app.services.teacher_lesson_coaching_artifact import (  # noqa: E402
    TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
    build_teacher_lesson_coaching_artifact,
    get_teacher_visible_lesson_feedback,
)
from app.services.storage_urls import (  # noqa: E402
    describe_storage_url_issue,
    iter_known_storage_url_fields,
)
from app.services.privacy_references import (  # noqa: E402
    summarize_privacy_references,
)
from app.services.privacy_reference_materialization import (  # noqa: E402
    evaluate_materialization_capability,
)
from app.services.video_assets import (  # noqa: E402
    decide_transcode_for_upload,
    select_analysis_asset,
    select_playback_asset,
)
from app.services.video_review_progress import (  # noqa: E402
    REVIEW_PROGRESS_STATUSES,
    build_video_review_progress,
)


@dataclass
class CheckResult:
    code: str
    status: str  # "ok" | "warn" | "fail"
    message: str
    samples: List[Dict[str, Any]] = field(default_factory=list)


def _recursive_strings(value: Any) -> List[str]:
    out: List[str] = []

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            for v in item.values():
                visit(v)
        elif isinstance(item, list):
            for v in item:
                visit(v)
        elif isinstance(item, str):
            out.append(item)

    visit(value)
    return out


def _scan_for_banned(value: Any) -> List[str]:
    haystack = "\n".join(_recursive_strings(value)).lower()
    return [pattern for pattern in KNOWN_BAD_TEACHER_TEXT_PATTERNS if pattern.lower() in haystack]


def check_teacher_artifact_has_no_banned_strings(artifact: Dict[str, Any]) -> CheckResult:
    hits = _scan_for_banned(
        {
            "summary": artifact.get("summary"),
            "highlights": artifact.get("highlights"),
            "action_items": artifact.get("action_items"),
            "deep_dive": artifact.get("deep_dive"),
            "recognition": artifact.get("recognition"),
            "reflection": artifact.get("reflection"),
            "next_best_action": artifact.get("next_best_action"),
            "empty_state": artifact.get("empty_state"),
        }
    )
    if hits:
        return CheckResult(
            code="teacher_artifact_banned_strings",
            status="fail",
            message=f"Teacher-visible surfaces contain banned strings: {hits}",
            samples=[{"hits": hits}],
        )
    return CheckResult(
        code="teacher_artifact_banned_strings",
        status="ok",
        message="No banned strings in teacher-visible artifact surfaces.",
    )


def check_artifact_blocked_not_bypassed(
    artifact: Dict[str, Any],
    assessment: Dict[str, Any],
) -> CheckResult:
    """If the artifact blocks teacher feedback, the legacy projection must
    not leak teacher-visible text either."""

    if artifact.get("teacher_feedback_allowed"):
        return CheckResult(
            code="artifact_blocked_not_bypassed",
            status="ok",
            message="Artifact is allowed; bypass check not applicable.",
        )
    legacy = assessment.get("teacher_feedback") or {}
    legacy_text_hits = _scan_for_banned(legacy)
    if legacy_text_hits:
        return CheckResult(
            code="artifact_blocked_not_bypassed",
            status="warn",
            message=(
                "Artifact is blocked but the legacy teacher_feedback field still"
                " contains banned strings. The C5 frontend fallback rule"
                " suppresses these — verify the frontend before declaring pilot"
                " ready."
            ),
            samples=[{"hits": legacy_text_hits}],
        )
    return CheckResult(
        code="artifact_blocked_not_bypassed",
        status="ok",
        message="Artifact is blocked and legacy teacher_feedback contains no banned strings.",
    )


def check_artifact_when_allowed_has_content(artifact: Dict[str, Any]) -> CheckResult:
    if not artifact.get("teacher_feedback_allowed"):
        return CheckResult(
            code="artifact_allowed_has_content",
            status="ok",
            message="Artifact is blocked; content-presence check not applicable.",
        )
    summary = artifact.get("summary") or {}
    summary_present = bool(summary.get("opening") or summary.get("what_worked"))
    action_items = artifact.get("action_items") or []
    deep_dive = artifact.get("deep_dive") or {}
    if not summary_present:
        return CheckResult(
            code="artifact_allowed_has_content",
            status="fail",
            message="Artifact reports teacher_feedback_allowed=True but summary is empty.",
        )
    if not action_items:
        return CheckResult(
            code="artifact_allowed_has_content",
            status="warn",
            message="Artifact is allowed but has zero action items.",
        )
    return CheckResult(
        code="artifact_allowed_has_content",
        status="ok",
        message=(
            f"Artifact allowed; summary present, {len(action_items)} action item(s),"
            f" deep_dive.available={deep_dive.get('available')}."
        ),
    )


def check_source_and_quality_present(
    artifact: Dict[str, Any],
    assessment: Dict[str, Any],
) -> CheckResult:
    sv = artifact.get("source_validity") or {}
    aq = assessment.get("analysis_quality") or {}
    issues: List[str] = []
    if not sv:
        issues.append("source_validity missing on artifact")
    if not aq:
        issues.append("analysis_quality missing on assessment")
    if issues:
        return CheckResult(
            code="source_and_quality_present",
            status="warn",
            message="; ".join(issues),
        )
    return CheckResult(
        code="source_and_quality_present",
        status="ok",
        message="source_validity + analysis_quality both present.",
    )


def check_no_orphan_visible_tasks(
    teacher_id: str,
    coaching_tasks: List[Dict[str, Any]],
    valid_video_ids: set,
    valid_assessment_ids: set,
) -> CheckResult:
    bad: List[Dict[str, Any]] = []
    for task in coaching_tasks:
        if not isinstance(task, dict):
            continue
        if task.get("teacher_id") != teacher_id:
            continue
        if task.get("hidden_from_teacher"):
            continue
        if task.get("source_integrity") in {"orphaned", "invalid", "quarantined"}:
            continue
        v = task.get("video_id")
        a = task.get("assessment_id")
        if v and valid_video_ids and v not in valid_video_ids:
            bad.append({"task_id": task.get("id"), "missing_video": v})
        if a and valid_assessment_ids and a not in valid_assessment_ids:
            bad.append({"task_id": task.get("id"), "missing_assessment": a})
    if bad:
        return CheckResult(
            code="no_orphan_visible_tasks",
            status="fail",
            message=f"{len(bad)} coaching tasks would render to the teacher despite missing source.",
            samples=bad[:5],
        )
    return CheckResult(
        code="no_orphan_visible_tasks",
        status="ok",
        message="No orphan teacher-visible coaching tasks detected.",
    )


def check_recognition_separation(artifact: Dict[str, Any]) -> CheckResult:
    rec = artifact.get("recognition") or {}
    gs = rec.get("gold_star")
    personal = rec.get("personal_highlights") or []
    if gs and personal:
        gs_title = (gs.get("title") or "").strip().lower()
        for h in personal:
            if isinstance(h, dict) and (h.get("title") or "").strip().lower() == gs_title:
                return CheckResult(
                    code="recognition_separation",
                    status="warn",
                    message="A personal highlight has the same title as the Gold-Star recognition.",
                    samples=[{"title": gs_title}],
                )
    return CheckResult(
        code="recognition_separation",
        status="ok",
        message=(
            f"Recognition separated: gold_star={bool(gs)},"
            f" personal_highlights={len(personal)}."
        ),
    )


def check_shared_reflection_visibility(
    reflections: List[Dict[str, Any]],
    teacher_id: str,
) -> CheckResult:
    leaks: List[Dict[str, Any]] = []
    for r in reflections:
        if not isinstance(r, dict):
            continue
        if r.get("teacher_id") != teacher_id:
            continue
        visibility = str(r.get("visibility") or "").lower()
        if visibility == "private" and r.get("admin_visible") is True:
            leaks.append({"reflection_id": r.get("id"), "leak": "private_marked_admin_visible"})
    if leaks:
        return CheckResult(
            code="shared_reflection_visibility",
            status="fail",
            message="Private reflections incorrectly marked admin-visible.",
            samples=leaks,
        )
    return CheckResult(
        code="shared_reflection_visibility",
        status="ok",
        message="Private/shared reflection visibility looks correct.",
    )


def check_admin_review_consistency(
    artifact: Dict[str, Any],
    admin_review: Optional[Dict[str, Any]],
) -> CheckResult:
    if not admin_review:
        return CheckResult(
            code="admin_review_consistency",
            status="ok",
            message="No persistent admin review; auto-computed status applies.",
        )
    status = str(admin_review.get("status") or "").lower()
    if status == "admin_hidden" and artifact.get("teacher_feedback_allowed"):
        return CheckResult(
            code="admin_review_consistency",
            status="fail",
            message="admin_hidden review present but artifact reports teacher_feedback_allowed=True.",
        )
    if status == "admin_approved" and artifact.get("blocked_reason") in {
        "unsafe_text",
        "unsafe_text_post_compose",
    }:
        return CheckResult(
            code="admin_review_consistency",
            status="warn",
            message="admin_approved but artifact blocked for unsafe_text — admin approval cannot override.",
        )
    if status == "admin_approved" and artifact.get("blocked_reason") == "source_invalid":
        return CheckResult(
            code="admin_review_consistency",
            status="warn",
            message="admin_approved but source chain is invalid — admin approval cannot override.",
        )
    return CheckResult(
        code="admin_review_consistency",
        status="ok",
        message=f"admin_review status={status} consistent with artifact.",
    )


def check_teacher_feedback_view_consistency(
    artifact: Dict[str, Any],
    assessment: Dict[str, Any],
) -> CheckResult:
    """PR C9.4 PART 4: the canonical teacher feedback view must be coherent.

    ``get_teacher_visible_lesson_feedback`` reconciles the safety gate with the
    release gate. This check confirms:

    - a blocked / withheld view always carries SPECIFIC headline + detail copy
      (so cards never fall back to the generic "no action needed" placeholder);
    - the safety gate wins over the release flag — if the assessment is
      ``released`` but the artifact still blocks teacher feedback, the view must
      report ``feedback_available=False`` (warn: teacher sees a withheld state
      despite release);
    - an allowed + released artifact yields ``feedback_available=True``.
    """
    view = get_teacher_visible_lesson_feedback(
        artifact,
        feedback_release_status=assessment.get("feedback_release_status"),
        language=assessment.get("analysis_language") or "en",
    )
    if not view.get("feedback_available"):
        if not (view.get("headline") and view.get("detail")):
            return CheckResult(
                code="teacher_feedback_view_consistency",
                status="fail",
                message=(
                    "Withheld teacher feedback view is missing specific headline/detail copy"
                    f" (status={view.get('status')}) — card would show a generic placeholder."
                ),
                samples=[{"status": view.get("status"), "headline": view.get("headline")}],
            )
        release = str(assessment.get("feedback_release_status") or "").strip().lower()
        if release == "released" and not artifact.get("teacher_feedback_allowed"):
            return CheckResult(
                code="teacher_feedback_view_consistency",
                status="warn",
                message=(
                    "Assessment is released but the safety gate still blocks teacher feedback;"
                    f" view correctly withholds (status={view.get('status')})."
                ),
                samples=[{"status": view.get("status"), "blocked_reason": artifact.get("blocked_reason")}],
            )
        return CheckResult(
            code="teacher_feedback_view_consistency",
            status="ok",
            message=f"Withheld feedback view carries specific copy (status={view.get('status')}).",
        )
    # feedback_available True — must be allowed AND not release-blocked.
    if not artifact.get("teacher_feedback_allowed"):
        return CheckResult(
            code="teacher_feedback_view_consistency",
            status="fail",
            message="Feedback view reports feedback_available=True while the artifact blocks teacher feedback.",
            samples=[{"status": view.get("status"), "blocked_reason": artifact.get("blocked_reason")}],
        )
    return CheckResult(
        code="teacher_feedback_view_consistency",
        status="ok",
        message=f"Teacher feedback view is available and coherent (status={view.get('status')}).",
    )


async def run_smoke(
    *,
    teacher_id: Optional[str],
    video_id: Optional[str],
    assessment_id: Optional[str],
) -> Dict[str, Any]:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("motor is required to run the smoke script") from exc

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "cognivio")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "artifact_version": TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
        "filters": {
            "teacher_id": teacher_id,
            "video_id": video_id,
            "assessment_id": assessment_id,
        },
        "checks": [],
        "counts": {"ok": 0, "warn": 0, "fail": 0},
    }

    try:
        assessment_query: Dict[str, Any] = {}
        if assessment_id:
            assessment_query["id"] = assessment_id
        elif teacher_id:
            assessment_query["teacher_id"] = teacher_id
        elif video_id:
            assessment_query["video_id"] = video_id
        else:
            assessment_query = {}
        assessments = await db.assessments.find(assessment_query, {"_id": 0}).sort(
            "analyzed_at", -1
        ).to_list(50) if assessment_query else []

        # We focus the smoke run on a single teacher when possible.
        target_teacher_id = teacher_id or (assessments[0].get("teacher_id") if assessments else None)
        if not target_teacher_id:
            summary["checks"].append(
                {
                    "code": "no_target_teacher",
                    "status": "warn",
                    "message": "No teacher_id supplied and no assessment found to infer one.",
                    "samples": [],
                }
            )
            summary["counts"]["warn"] += 1
            return summary

        teacher = await db.teachers.find_one({"id": target_teacher_id}, {"_id": 0})
        if not teacher:
            summary["checks"].append(
                {
                    "code": "teacher_not_found",
                    "status": "fail",
                    "message": f"teacher_id={target_teacher_id} not found in teachers collection",
                    "samples": [],
                }
            )
            summary["counts"]["fail"] += 1
            return summary

        video_ids_for_teacher = await db.videos.distinct("id", {"teacher_id": target_teacher_id})
        videos_list = await db.videos.find(
            {"id": {"$in": video_ids_for_teacher}}, {"_id": 0}
        ).to_list(10000) if video_ids_for_teacher else []
        videos_by_id = {v.get("id"): v for v in videos_list if v.get("id")}
        valid_video_ids = set(videos_by_id.keys())

        teacher_assessments = await db.assessments.find(
            {"teacher_id": target_teacher_id}, {"_id": 0}
        ).sort("analyzed_at", -1).to_list(50)
        valid_assessment_ids = {a.get("id") for a in teacher_assessments if a.get("id")}

        coaching_tasks = await db.coaching_tasks.find(
            {"teacher_id": target_teacher_id}, {"_id": 0}
        ).to_list(10000)
        reflections = await db.coaching_task_reflections.find(
            {"teacher_id": target_teacher_id}, {"_id": 0}
        ).to_list(10000)
        recognition_badges = await db.recognition_badges.find(
            {"teacher_id": target_teacher_id, "status": {"$ne": "revoked"}}, {"_id": 0}
        ).to_list(1000)

        # Target a single assessment (newest source-valid one, or the one
        # supplied via --assessment-id).
        target_assessment: Optional[Dict[str, Any]] = None
        if assessment_id:
            target_assessment = next(
                (a for a in teacher_assessments if a.get("id") == assessment_id), None
            )
        if not target_assessment and teacher_assessments:
            target_assessment = teacher_assessments[0]

        results: List[CheckResult] = []

        # Cross-teacher checks first.
        results.append(
            check_no_orphan_visible_tasks(
                target_teacher_id, coaching_tasks, valid_video_ids, valid_assessment_ids
            )
        )
        results.append(check_shared_reflection_visibility(reflections, target_teacher_id))

        if target_assessment:
            admin_review = None
            try:
                admin_review = await db.teacher_feedback_reviews.find_one(
                    {"assessment_id": target_assessment.get("id")},
                    {"_id": 0},
                    sort=[("reviewed_at", -1)],
                )
            except Exception:  # pragma: no cover
                admin_review = None
            target_video = videos_by_id.get(target_assessment.get("video_id"))
            artifact = build_teacher_lesson_coaching_artifact(
                teacher=teacher,
                current_user=None,
                assessment=target_assessment,
                video=target_video,
                coaching_tasks=coaching_tasks,
                recognition_badges=recognition_badges,
                language=target_assessment.get("analysis_language") or teacher.get("language") or "en",
                admin_review=admin_review,
            )
            results.append(check_teacher_artifact_has_no_banned_strings(artifact))
            results.append(check_artifact_blocked_not_bypassed(artifact, target_assessment))
            results.append(check_artifact_when_allowed_has_content(artifact))
            results.append(check_source_and_quality_present(artifact, target_assessment))
            results.append(check_recognition_separation(artifact))
            results.append(check_admin_review_consistency(artifact, admin_review))
            results.append(check_teacher_feedback_view_consistency(artifact, target_assessment))
        else:
            results.append(
                CheckResult(
                    code="target_assessment",
                    status="warn",
                    message="No assessment found for teacher; only orphan/reflection checks ran.",
                )
            )

        # PR C9.1: video pipeline reliability checks (always run, independent
        # of whether an artifact was buildable for the target assessment).
        try:
            references_for_teacher = await db.teacher_face_references.find(
                {"teacher_id": target_teacher_id, "status": {"$nin": ["deleted", "replaced", "expired"]}},
                {"_id": 0},
            ).to_list(100)
        except Exception:  # pragma: no cover
            references_for_teacher = []
        try:
            import server as _server  # noqa: WPS433 — lazy
            c91_upload_dir = _server.UPLOAD_DIR
            c91_transcode_enabled = _server.VIDEO_TRANSCODE_ENABLED
            c91_pipeline_enabled = _server.VIDEO_TRANSCODE_PIPELINE_ENABLED
            c91_min_bytes = _server.VIDEO_TRANSCODE_MIN_BYTES
        except Exception:  # pragma: no cover
            c91_upload_dir = Path(os.getenv("UPLOAD_DIR", "uploads"))
            c91_transcode_enabled = False
            c91_pipeline_enabled = False
            c91_min_bytes = 25 * 1024 * 1024

        results.append(check_no_malformed_storage_urls(videos_list, references_for_teacher))
        results.append(
            check_reference_readiness_matches_worker(references_for_teacher, c91_upload_dir)
        )
        results.append(
            check_transcode_status_consistency(
                videos_list,
                transcode_enabled=c91_transcode_enabled,
                pipeline_enabled=c91_pipeline_enabled,
                min_bytes=c91_min_bytes,
            )
        )
        results.append(check_playback_safety_for_teachers(videos_list))
        # PR C9.2: materialization + latest-failure visibility
        try:
            import server as _server92  # noqa: WPS433 — lazy
            storage_ok = _server92._storage_download_available()
            url_fetch_ok = _server92.PRIVACY_REFERENCE_URL_FETCH_ENABLED
        except Exception:  # pragma: no cover
            storage_ok = False
            url_fetch_ok = False
        results.append(
            check_reference_materialization_readiness(
                references_for_teacher,
                upload_dir=c91_upload_dir,
                storage_download_available=storage_ok,
                url_fetch_enabled=url_fetch_ok,
            )
        )
        results.append(check_latest_privacy_failure_codes(videos_list))
        # PR C9.3: review-progress + browser-playable redacted output
        results.append(check_review_progress_present(videos_list))
        results.append(check_review_progress_not_stuck_when_analysis_completed(videos_list))
        results.append(check_audio_disabled_copy_state(videos_list))
        results.append(check_redacted_playback_validation_present(videos_list))
        results.append(check_teacher_playback_uses_redacted(videos_list))
        results.append(check_blur_all_fallback_enforced(videos_list))
        # PR C9.4: rendered redacted output confirmed blurred
        results.append(check_visual_redaction_validation_present(videos_list))

        for r in results:
            summary["checks"].append(
                {
                    "code": r.code,
                    "status": r.status,
                    "message": r.message,
                    "samples": r.samples,
                }
            )
            summary["counts"][r.status] = summary["counts"].get(r.status, 0) + 1
    finally:
        client.close()

    summary["overall"] = "fail" if summary["counts"].get("fail", 0) else "ok"
    return summary


# ---------------------------------------------------------------------------
# PR C9.1: video pipeline reliability checks
# ---------------------------------------------------------------------------


def check_no_malformed_storage_urls(
    videos: List[Dict[str, Any]],
    references: List[Dict[str, Any]],
) -> CheckResult:
    """Report any video / reference document whose persisted URL is malformed.

    The most common production case is the leaked ``S3_PUBLIC_BASE_URL=`` prefix
    described in PR C9.1.
    """
    fields = list(iter_known_storage_url_fields())
    samples: List[Dict[str, Any]] = []
    for doc, collection in ((v, "videos") for v in videos):
        for field in fields:
            issue = describe_storage_url_issue(doc.get(field))
            if issue and issue not in {"url_missing"}:
                samples.append(
                    {
                        "collection": collection,
                        "id": doc.get("id"),
                        "field": field,
                        "issue": issue,
                    }
                )
    for doc in references:
        for field in fields:
            issue = describe_storage_url_issue(doc.get(field))
            if issue and issue not in {"url_missing"}:
                samples.append(
                    {
                        "collection": "teacher_face_references",
                        "id": doc.get("id"),
                        "field": field,
                        "issue": issue,
                    }
                )
    if samples:
        return CheckResult(
            code="video_pipeline_storage_urls",
            status="fail",
            message=f"Found {len(samples)} malformed storage URL(s).",
            samples=samples[:25],
        )
    return CheckResult(
        code="video_pipeline_storage_urls",
        status="ok",
        message="All persisted storage URLs are well-formed.",
    )


def check_reference_readiness_matches_worker(
    references: List[Dict[str, Any]],
    upload_dir: Path,
) -> CheckResult:
    """Detect the production failure: UI says ready, worker says no usable refs."""
    now_iso = datetime.now(timezone.utc).isoformat()
    ui_summary = summarize_privacy_references(
        references,
        upload_dir=upload_dir,
        now_iso=now_iso,
        allow_url_fetch=True,
    )
    worker_summary = summarize_privacy_references(
        references,
        upload_dir=upload_dir,
        now_iso=now_iso,
        allow_url_fetch=False,
    )
    if ui_summary.usable_count >= 1 and worker_summary.usable_count == 0:
        return CheckResult(
            code="video_pipeline_reference_readiness",
            status="fail",
            message=(
                "Teacher reference UI says ready but worker has no usable "
                "references — pilot block."
            ),
            samples=[
                {
                    "ui_usable_count": ui_summary.usable_count,
                    "worker_usable_count": worker_summary.usable_count,
                    "failure_codes": list(worker_summary.failure_codes),
                }
            ],
        )
    if not references:
        return CheckResult(
            code="video_pipeline_reference_readiness",
            status="warn",
            message="No reference images for this teacher.",
        )
    return CheckResult(
        code="video_pipeline_reference_readiness",
        status="ok",
        message=f"Reference readiness consistent (usable={worker_summary.usable_count}).",
    )


def check_transcode_status_consistency(
    videos: List[Dict[str, Any]],
    *,
    transcode_enabled: bool,
    pipeline_enabled: bool,
    min_bytes: int,
) -> CheckResult:
    """Find large videos silently flagged ``transcode_status=not_required``."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        size = video.get("file_size_bytes") or video.get("raw_file_size_bytes")
        decision = decide_transcode_for_upload(
            size,
            transcode_enabled=transcode_enabled,
            pipeline_enabled=pipeline_enabled,
            min_bytes=min_bytes,
        )
        if decision.decision in {"queued", "pending"} and video.get("transcode_status") == "not_required":
            samples.append(
                {
                    "video_id": video.get("id"),
                    "file_size_bytes": size,
                    "decision": decision.decision,
                    "transcode_status": video.get("transcode_status"),
                }
            )
    if samples:
        return CheckResult(
            code="video_pipeline_transcode_decisions",
            status="fail",
            message=f"{len(samples)} large video(s) marked transcode_status=not_required.",
            samples=samples[:25],
        )
    return CheckResult(
        code="video_pipeline_transcode_decisions",
        status="ok",
        message="Transcode decisions are consistent with size policy.",
    )


def check_playback_safety_for_teachers(videos: List[Dict[str, Any]]) -> CheckResult:
    """Ensure no video's teacher-facing playback would resolve to a raw URL."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        decision = select_playback_asset(video, "teacher", allow_raw_for_admin=False)
        if decision.source == "raw":
            samples.append({"video_id": video.get("id"), "source": decision.source})
    if samples:
        return CheckResult(
            code="video_pipeline_teacher_playback_safety",
            status="fail",
            message="Teacher playback would expose a raw asset.",
            samples=samples[:25],
        )
    return CheckResult(
        code="video_pipeline_teacher_playback_safety",
        status="ok",
        message="Teacher playback never resolves to raw URLs.",
    )


def check_reference_materialization_readiness(
    references: List[Dict[str, Any]],
    *,
    upload_dir: Path,
    storage_download_available: bool,
    url_fetch_enabled: bool,
) -> CheckResult:
    """PR C9.2: report whether the teacher's references would materialize."""
    if not references:
        return CheckResult(
            code="video_pipeline_reference_materialization",
            status="warn",
            message="No reference records for this teacher.",
        )
    cap = evaluate_materialization_capability(
        references,
        upload_dir=upload_dir,
        storage_download_available=storage_download_available,
        url_fetch_enabled=url_fetch_enabled,
    )
    if cap["would_materialize_count"] >= 1:
        return CheckResult(
            code="video_pipeline_reference_materialization",
            status="ok",
            message=(
                f"{cap['would_materialize_count']}/{cap['total']} references "
                "would materialize."
            ),
            samples=[cap],
        )
    if not storage_download_available and any(r.get("s3_key") for r in references):
        return CheckResult(
            code="video_pipeline_reference_materialization",
            status="fail",
            message=(
                "Teacher has remote-only references but the worker cannot "
                "download from storage (storage_download_unavailable)."
            ),
            samples=[cap],
        )
    return CheckResult(
        code="video_pipeline_reference_materialization",
        status="fail",
        message="No reference would materialize.",
        samples=[cap],
    )


def check_latest_privacy_failure_codes(
    videos: List[Dict[str, Any]],
) -> CheckResult:
    """Surface the latest privacy_reference_failure_codes on a failed video."""
    failed_videos = [v for v in videos if v.get("privacy_status") == "failed"]
    if not failed_videos:
        return CheckResult(
            code="video_pipeline_latest_privacy_failure",
            status="ok",
            message="No failed-privacy videos in scope.",
        )
    latest = sorted(
        failed_videos,
        key=lambda v: v.get("privacy_failed_at") or v.get("status_updated_at") or "",
        reverse=True,
    )[0]
    codes = list(latest.get("privacy_reference_failure_codes") or [])
    return CheckResult(
        code="video_pipeline_latest_privacy_failure",
        status="warn" if codes else "fail",
        message=(
            f"Latest failed privacy video {latest.get('id')} codes={codes}"
            if codes
            else f"Latest failed video {latest.get('id')} has no structured codes."
        ),
        samples=[{"video_id": latest.get("id"), "codes": codes}],
    )


# ---------------------------------------------------------------------------
# PR C9.3: review-progress + browser-playable redacted output checks
# ---------------------------------------------------------------------------


def _redacted_asset_present(video: Dict[str, Any]) -> bool:
    return bool(
        video.get("redacted_asset_state") == "stored"
        or video.get("redacted_file_path")
        or video.get("redacted_file_url")
    )


def check_review_progress_present(videos: List[Dict[str, Any]]) -> CheckResult:
    """Every video must produce a review-progress object in the contract vocabulary."""
    if not videos:
        return CheckResult(
            code="review_progress_present",
            status="warn",
            message="No videos in scope for this teacher.",
        )
    samples: List[Dict[str, Any]] = []
    for video in videos:
        try:
            progress = build_video_review_progress(video)
        except Exception as exc:  # pragma: no cover - defensive
            samples.append({"video_id": video.get("id"), "error": str(exc)})
            continue
        if not progress or progress.get("status") not in REVIEW_PROGRESS_STATUSES:
            samples.append(
                {
                    "video_id": video.get("id"),
                    "status": progress.get("status") if progress else None,
                }
            )
    if samples:
        return CheckResult(
            code="review_progress_present",
            status="fail",
            message=f"{len(samples)} video(s) cannot produce a valid review-progress object.",
            samples=samples[:25],
        )
    return CheckResult(
        code="review_progress_present",
        status="ok",
        message=f"All {len(videos)} video(s) produce a valid review-progress object.",
    )


def check_review_progress_not_stuck_when_analysis_completed(
    videos: List[Dict[str, Any]],
) -> CheckResult:
    """Analysis-completed videos must never report a perpetual ``processing`` spinner."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        if str(video.get("analysis_status") or "").strip().lower() != "completed":
            continue
        progress = build_video_review_progress(video)
        if progress.get("status") == "processing":
            samples.append({"video_id": video.get("id"), "status": progress.get("status")})
    if samples:
        return CheckResult(
            code="review_progress_not_stuck_when_analysis_completed",
            status="fail",
            message=f"{len(samples)} analysis-completed video(s) still report a processing spinner.",
            samples=samples[:25],
        )
    return CheckResult(
        code="review_progress_not_stuck_when_analysis_completed",
        status="ok",
        message="No analysis-completed video is stuck on a processing spinner.",
    )


def check_audio_disabled_copy_state(videos: List[Dict[str, Any]]) -> CheckResult:
    """Audio-disabled videos show a skipped audio stage and never promise audio review."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        if video.get("audio_analysis_enabled"):
            continue
        progress = build_video_review_progress(video)
        audio_stage = next(
            (s for s in (progress.get("stages") or []) if s.get("key") == "audio"), None
        )
        audio_status = audio_stage.get("status") if audio_stage else None
        teacher_msg = str(progress.get("teacher_message") or "").lower()
        if audio_status not in {"skipped", "disabled"}:
            samples.append(
                {"video_id": video.get("id"), "audio_status": audio_status, "issue": "audio_not_skipped"}
            )
        elif "audio" in teacher_msg:
            samples.append(
                {"video_id": video.get("id"), "issue": "audio_promised_in_teacher_copy"}
            )
    if samples:
        return CheckResult(
            code="audio_disabled_copy_state",
            status="fail",
            message=f"{len(samples)} audio-disabled video(s) mislabel the audio stage or promise audio review.",
            samples=samples[:25],
        )
    return CheckResult(
        code="audio_disabled_copy_state",
        status="ok",
        message="Audio-disabled videos correctly show a skipped audio stage with no audio promise.",
    )


def check_redacted_playback_validation_present(
    videos: List[Dict[str, Any]],
) -> CheckResult:
    """Privacy-completed videos with a redacted asset must carry a non-failed validation."""
    missing: List[str] = []
    failed: List[Dict[str, Any]] = []
    for video in videos:
        if str(video.get("privacy_status") or "").strip().lower() != "completed":
            continue
        if not _redacted_asset_present(video):
            continue
        validation = video.get("redacted_playback_validation") or {}
        status = str(validation.get("status") or "").strip().lower()
        if not validation:
            missing.append(video.get("id"))
        elif status == "failed":
            failed.append(
                {"video_id": video.get("id"), "failure_code": validation.get("failure_code")}
            )
    if failed:
        return CheckResult(
            code="redacted_playback_validation_present",
            status="fail",
            message=f"{len(failed)} redacted asset(s) failed browser-playback validation but privacy is completed.",
            samples=failed[:25],
        )
    if missing:
        return CheckResult(
            code="redacted_playback_validation_present",
            status="warn",
            message=(
                f"{len(missing)} legacy redacted asset(s) predate playback validation "
                "and should be reprocessed before pilot."
            ),
            samples=[{"video_id": vid} for vid in missing[:25]],
        )
    return CheckResult(
        code="redacted_playback_validation_present",
        status="ok",
        message="All completed redacted assets carry a passing playback validation.",
    )


def check_teacher_playback_uses_redacted(videos: List[Dict[str, Any]]) -> CheckResult:
    """With destructive blur enabled, teacher playback must resolve to the redacted asset."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        if str(video.get("privacy_status") or "").strip().lower() != "completed":
            continue
        destructive = video.get("destructive_blurring_enabled")
        destructive_enabled = True if destructive is None else bool(destructive)
        if not destructive_enabled:
            continue
        decision = select_playback_asset(video, "teacher", allow_raw_for_admin=False)
        if decision.url and decision.source != "redacted":
            samples.append({"video_id": video.get("id"), "source": decision.source})
    if samples:
        return CheckResult(
            code="teacher_playback_uses_redacted",
            status="fail",
            message=f"{len(samples)} teacher playback URL(s) resolve to a non-redacted asset under destructive blur.",
            samples=samples[:25],
        )
    return CheckResult(
        code="teacher_playback_uses_redacted",
        status="ok",
        message="Teacher playback resolves only to redacted assets when destructive blur is enabled.",
    )


def check_visual_redaction_validation_present(
    videos: List[Dict[str, Any]],
) -> CheckResult:
    """PR C9.4: privacy-completed redacted assets must be confirmed blurred.

    The rendered output's pixels are re-scanned by the visual-redaction
    validator. ``status == "passed"`` is the only safe state. A ``failed``
    re-scan that left privacy ``completed`` is a hard block; a missing or
    ``skipped_unavailable`` record means redaction was never confirmed
    (fail-closed) and the asset should be reprocessed before pilot.
    """
    failed: List[Dict[str, Any]] = []
    inconclusive: List[Dict[str, Any]] = []
    missing: List[str] = []
    for video in videos:
        if str(video.get("privacy_status") or "").strip().lower() != "completed":
            continue
        if not _redacted_asset_present(video):
            continue
        record = video.get("visual_redaction_validation")
        record = record if isinstance(record, dict) else None
        status = str((record or {}).get("status") or "").strip().lower()
        if not record:
            missing.append(video.get("id"))
        elif status == "failed":
            failed.append(
                {"video_id": video.get("id"), "failure_code": record.get("failure_code")}
            )
        elif status == "skipped_unavailable":
            inconclusive.append(
                {"video_id": video.get("id"), "failure_code": record.get("failure_code")}
            )
    if failed:
        return CheckResult(
            code="visual_redaction_validation_present",
            status="fail",
            message=(
                f"{len(failed)} redacted asset(s) failed visual-redaction validation "
                "but privacy is completed — a face may be visible."
            ),
            samples=failed[:25],
        )
    if missing or inconclusive:
        return CheckResult(
            code="visual_redaction_validation_present",
            status="warn",
            message=(
                f"{len(missing)} redacted asset(s) predate visual-redaction validation and "
                f"{len(inconclusive)} could not be verified — reprocess before pilot."
            ),
            samples=([{"video_id": vid} for vid in missing[:15]] + inconclusive[:10]),
        )
    return CheckResult(
        code="visual_redaction_validation_present",
        status="ok",
        message="All completed redacted assets passed visual-redaction validation.",
    )


def check_blur_all_fallback_enforced(videos: List[Dict[str, Any]]) -> CheckResult:
    """``blur_all`` manifests must preserve no face (the C9.3 PART 6 invariant)."""
    samples: List[Dict[str, Any]] = []
    for video in videos:
        manifest = video.get("privacy_manifest") or {}
        if str(manifest.get("fallback_mode") or "").strip().lower() != "blur_all":
            continue
        violations: List[str] = []
        if manifest.get("teacher_track_id") is not None:
            violations.append("teacher_track_id_not_null")
        for track in manifest.get("tracks") or []:
            if isinstance(track, dict) and str(track.get("decision") or "").strip().lower() != "blur":
                violations.append(f"track_decision={track.get('decision')}")
                break
        render_stats = manifest.get("render_stats") or {}
        detected = render_stats.get("faces_detected_total")
        blurred = render_stats.get("faces_blurred_total")
        if (
            isinstance(detected, (int, float))
            and isinstance(blurred, (int, float))
            and blurred < detected
        ):
            violations.append(f"faces_blurred={blurred}<detected={detected}")
        if violations:
            samples.append({"video_id": video.get("id"), "violations": violations})
    if samples:
        return CheckResult(
            code="blur_all_fallback_enforced",
            status="fail",
            message=f"{len(samples)} blur_all manifest(s) preserved a face — invariant violated.",
            samples=samples[:25],
        )
    return CheckResult(
        code="blur_all_fallback_enforced",
        status="ok",
        message="All blur_all manifests blurred every face (no preserved adult).",
    )


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cognivio pilot smoke checks (read-only)."
    )
    parser.add_argument("--teacher-id")
    parser.add_argument(
        "--forensic-teacher-id",
        dest="teacher_id",
        help="Alias for --teacher-id (convenient for the forensic orphan check).",
    )
    parser.add_argument("--video-id")
    parser.add_argument("--assessment-id")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--base-url",
        default=os.getenv("COGNIVIO_BASE_URL"),
        help=(
            "Optional API base URL (e.g. https://api.example.com). When set "
            "alongside --teacher-token / --admin-token the script also runs "
            "API-level smoke checks via requests."
        ),
    )
    parser.add_argument(
        "--teacher-token",
        default=os.getenv("COGNIVIO_TEACHER_TOKEN"),
        help="Teacher JWT for API-level checks.",
    )
    parser.add_argument(
        "--admin-token",
        default=os.getenv("COGNIVIO_ADMIN_TOKEN"),
        help="Admin JWT for API-level checks.",
    )
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Optional API-mode checks (run only when --base-url + tokens are present)
# ---------------------------------------------------------------------------


def _api_get(base_url: str, path: str, token: Optional[str]) -> Dict[str, Any]:
    import requests  # local import so the script still works without requests

    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.get(base_url.rstrip("/") + path, headers=headers, timeout=15)
    return {"status_code": resp.status_code, "body": (resp.json() if resp.content else None)}


def check_api_teacher_endpoint_no_banned_strings(
    base_url: str, teacher_token: str, assessment_id: Optional[str]
) -> CheckResult:
    try:
        latest = _api_get(base_url, "/api/teachers/me/latest-lesson", teacher_token)
    except Exception as exc:  # pragma: no cover
        return CheckResult(
            code="api_teacher_latest_lesson",
            status="fail",
            message=f"latest-lesson request failed: {exc}",
        )
    if latest["status_code"] != 200:
        return CheckResult(
            code="api_teacher_latest_lesson",
            status="fail",
            message=f"latest-lesson returned HTTP {latest['status_code']}",
        )
    hits = _scan_for_banned(latest["body"])
    if hits:
        return CheckResult(
            code="api_teacher_latest_lesson",
            status="fail",
            message=f"teacher latest-lesson response contains banned strings: {hits}",
        )
    return CheckResult(
        code="api_teacher_latest_lesson",
        status="ok",
        message="Teacher latest-lesson response is teacher-safe.",
    )


def check_api_admin_assessment_has_teacher_preview(
    base_url: str, admin_token: str, assessment_id: str
) -> CheckResult:
    try:
        resp = _api_get(base_url, f"/api/assessments/{assessment_id}", admin_token)
    except Exception as exc:  # pragma: no cover
        return CheckResult(
            code="api_admin_assessment_preview",
            status="fail",
            message=f"admin assessment request failed: {exc}",
        )
    if resp["status_code"] != 200:
        return CheckResult(
            code="api_admin_assessment_preview",
            status="fail",
            message=f"admin assessment returned HTTP {resp['status_code']}",
        )
    body = resp.get("body") or {}
    preview = body.get("teacher_preview") if isinstance(body, dict) else None
    status_value = body.get("teacher_feedback_admin_status") if isinstance(body, dict) else None
    if preview is None or status_value is None:
        return CheckResult(
            code="api_admin_assessment_preview",
            status="fail",
            message="admin assessment response is missing teacher_preview / teacher_feedback_admin_status",
        )
    return CheckResult(
        code="api_admin_assessment_preview",
        status="ok",
        message=f"admin assessment preview present, status={status_value}.",
    )


def _render_text(report: Dict[str, Any]) -> str:
    lines = [
        "Cognivio pilot smoke report",
        f"Generated: {report['generated_at']}",
        f"Artifact version: {report['artifact_version']}",
        f"Filters: {json.dumps(report['filters'], sort_keys=True)}",
        f"Overall: {report.get('overall', 'unknown').upper()}",
        f"Counts: ok={report['counts'].get('ok', 0)} warn={report['counts'].get('warn', 0)} fail={report['counts'].get('fail', 0)}",
        "",
    ]
    for check in report.get("checks") or []:
        prefix = {"ok": "[OK]", "warn": "[WARN]", "fail": "[FAIL]"}.get(check["status"], "[?]")
        lines.append(f"{prefix} {check['code']}: {check['message']}")
        for sample in check.get("samples") or []:
            lines.append(f"        {json.dumps(sample, sort_keys=True, default=str)}")
    return "\n".join(lines)


async def main_async(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    report = await run_smoke(
        teacher_id=args.teacher_id,
        video_id=args.video_id,
        assessment_id=args.assessment_id,
    )
    # PR C7: optional API-mode checks. They run only when the operator
    # supplied a base URL + at least one token. DB-only smoke runs without
    # them.
    if args.base_url and (args.teacher_token or args.admin_token):
        api_checks: List[CheckResult] = []
        if args.teacher_token:
            api_checks.append(
                check_api_teacher_endpoint_no_banned_strings(
                    args.base_url, args.teacher_token, args.assessment_id
                )
            )
        if args.admin_token and args.assessment_id:
            api_checks.append(
                check_api_admin_assessment_has_teacher_preview(
                    args.base_url, args.admin_token, args.assessment_id
                )
            )
        for r in api_checks:
            report["checks"].append(
                {"code": r.code, "status": r.status, "message": r.message, "samples": r.samples}
            )
            report["counts"][r.status] = report["counts"].get(r.status, 0) + 1
        report["overall"] = "fail" if report["counts"].get("fail", 0) else "ok"
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        print(_render_text(report))
    return 0 if report.get("counts", {}).get("fail", 0) == 0 else 1


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(main_async(argv))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
