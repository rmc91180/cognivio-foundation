"""Read-only audit for Cognivio teacher coaching artifact safety.

PR C5 audit script. Rebuilds the canonical TeacherLessonCoachingArtifact
for selected assessments and surfaces issues that would land bad coaching
on a teacher page:

  * unsafe teacher-visible text
  * teacher_feedback_allowed contradicts analysis_quality.teacher_feedback_allowed
  * artifact says teacher_visible true but unsafe text exists
  * action item duplicates summary
  * action item fails teacher-eligibility gate
  * deep_dive.available true with no valid moments
  * Gold-Star recognition tied to invalid source
  * reviewed/source-valid assessment with NO artifact (legacy data)
  * teacher endpoint would show feedback despite source/evidence block

The script never writes data. It is intended for production read-only
operator use.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


from app.services.teacher_artifact_quarantine import (  # noqa: E402
    build_source_validity,
    find_teacher_visible_text_issues,
)
from app.services.lesson_moment_quality import (  # noqa: E402
    assessment_quality_blocks_teacher_feedback,
)
from app.services.teacher_lesson_coaching_artifact import (  # noqa: E402
    TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
    audit_teacher_artifact,
    build_teacher_lesson_coaching_artifact,
)


def _add(issues: Dict[str, Dict[str, Any]], code: str, sample: Dict[str, Any]) -> None:
    bucket = issues.setdefault(code, {"code": code, "count": 0, "samples": []})
    bucket["count"] += 1
    if len(bucket["samples"]) < 25:
        bucket["samples"].append(sample)


def audit_collections(
    *,
    teachers: Dict[str, Dict[str, Any]],
    videos: Dict[str, Dict[str, Any]],
    assessments: List[Dict[str, Any]],
    coaching_tasks_by_teacher: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    recognition_badges_by_teacher: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    teacher_feedback_reviews_by_assessment: Optional[Dict[str, Dict[str, Any]]] = None,
    coaching_task_reflections: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run the artifact-safety audit over in-memory collections.

    The audit is fully synchronous — no DB I/O. The caller (CLI or test)
    snapshots Mongo first, then hands the dicts/lists in.

    PR C6 adds three new sources:

      * ``teacher_feedback_reviews_by_assessment`` — admin review records.
        Used to detect ``admin_hidden_but_teacher_endpoint_allowed`` and
        ``admin_approved_but_source_invalid`` /
        ``admin_approved_but_unsafe_text``.
      * ``coaching_tasks_by_teacher`` — used to detect
        ``action_item_persisted_with_unsafe_text`` and
        ``duplicate_artifact_action_task``.
      * ``coaching_task_reflections`` — used to detect
        ``shared_reflection_missing_thread_visibility`` and
        ``private_reflection_visible_to_admin`` (which should never
        happen given the existing API filter, but we audit anyway).
    """

    issues: Dict[str, Dict[str, Any]] = {}
    coaching_tasks_by_teacher = coaching_tasks_by_teacher or {}
    recognition_badges_by_teacher = recognition_badges_by_teacher or {}
    teacher_feedback_reviews_by_assessment = (
        teacher_feedback_reviews_by_assessment or {}
    )
    coaching_task_reflections = coaching_task_reflections or []

    seen = 0
    artifacts_built = 0

    for assessment in assessments or []:
        seen += 1
        teacher_id = assessment.get("teacher_id")
        video_id = assessment.get("video_id")
        teacher = teachers.get(teacher_id) if teacher_id else None
        video = videos.get(video_id) if video_id else None

        # Source-valid + analysis_quality-passed assessments with no artifact
        # at all are legacy data — flag for migration / regeneration.
        source_validity = build_source_validity(
            artifact=assessment,
            video=video,
            assessment=assessment,
            teacher_id=teacher_id,
        )
        analysis_quality = assessment.get("analysis_quality") or {}
        evidence_blocks = assessment_quality_blocks_teacher_feedback(assessment)

        admin_review = teacher_feedback_reviews_by_assessment.get(assessment.get("id"))
        try:
            artifact = build_teacher_lesson_coaching_artifact(
                teacher=teacher or {"id": teacher_id},
                current_user=None,
                assessment=assessment,
                video=video,
                coaching_tasks=coaching_tasks_by_teacher.get(teacher_id) if teacher_id else None,
                recognition_badges=recognition_badges_by_teacher.get(teacher_id) if teacher_id else None,
                language=(assessment.get("analysis_language") or "en"),
                admin_review=admin_review,
            )
            artifacts_built += 1
        except Exception as exc:  # pragma: no cover - defensive
            _add(
                issues,
                "artifact_build_failed",
                {
                    "assessment_id": assessment.get("id"),
                    "video_id": video_id,
                    "teacher_id": teacher_id,
                    "error": str(exc),
                },
            )
            continue

        sample_base = {
            "assessment_id": assessment.get("id"),
            "video_id": video_id,
            "teacher_id": teacher_id,
        }

        # PR C6: admin-review contradictions.
        admin_status = str((admin_review or {}).get("status") or "").lower()
        if admin_status == "admin_hidden" and artifact.get("teacher_feedback_allowed"):
            _add(issues, "admin_hidden_but_teacher_endpoint_allowed", sample_base)
        if admin_status == "admin_approved" and not source_validity.get(
            "valid_for_teacher_display"
        ):
            _add(issues, "admin_approved_but_source_invalid", sample_base)
        # If the artifact builder collapsed an admin_approved record into
        # unsafe_text the admin needs to know — the approval did not unlock
        # the artifact because text was still unsafe.
        if admin_status == "admin_approved" and artifact.get("blocked_reason") in {
            "unsafe_text",
            "unsafe_text_post_compose",
        }:
            _add(issues, "admin_approved_but_unsafe_text", sample_base)

        # 1. Per-artifact audit issues from the C4 helper.
        for entry in audit_teacher_artifact(artifact):
            _add(issues, entry["code"], {**sample_base, **{k: v for k, v in entry.items() if k != "code"}})

        # 2. Recursive negative-assertion scan on the teacher-visible
        #    surfaces. Belt-and-braces — should already be guarded by
        #    audit_teacher_artifact but we re-run here.
        teacher_scope = {
            "summary": artifact.get("summary"),
            "highlights": artifact.get("highlights"),
            "action_items": artifact.get("action_items"),
            "deep_dive": artifact.get("deep_dive"),
            "recognition": artifact.get("recognition"),
            "reflection": artifact.get("reflection"),
            "next_best_action": artifact.get("next_best_action"),
        }
        for entry in find_teacher_visible_text_issues(teacher_scope):
            _add(issues, "unsafe_teacher_visible_text", {**sample_base, **entry})

        # 3. Quality vs. visible-flag contradiction (already in audit helper,
        #    re-checked here for the JSON output).
        if (
            artifact.get("teacher_feedback_allowed") is True
            and analysis_quality.get("teacher_feedback_allowed") is False
        ):
            _add(issues, "teacher_feedback_allowed_contradicts_quality", sample_base)

        # 4. teacher_endpoint_would_show_despite_source_block — a "teacher
        #    feedback allowed" artifact MUST have a valid source chain.
        if artifact.get("teacher_feedback_allowed") and not source_validity.get(
            "valid_for_teacher_display"
        ):
            _add(issues, "teacher_endpoint_would_show_despite_source_block", sample_base)

        # 5. teacher_endpoint_would_show_despite_evidence_block.
        if artifact.get("teacher_feedback_allowed") and evidence_blocks:
            _add(issues, "teacher_endpoint_would_show_despite_evidence_block", sample_base)

        # 6. Legacy data: source-valid + quality-allowed but no artifact_version.
        if (
            source_validity.get("valid_for_teacher_display")
            and not evidence_blocks
            and not analysis_quality
        ):
            _add(issues, "assessment_missing_analysis_quality_for_review", sample_base)

        if (
            source_validity.get("valid_for_teacher_display")
            and not evidence_blocks
            and not assessment.get("analysis_quality")
        ):
            _add(issues, "reviewed_assessment_without_quality_block", sample_base)

        # 7. Deep dive available with no valid moments.
        deep_dive = artifact.get("deep_dive") or {}
        if deep_dive.get("available") and not deep_dive.get("moments"):
            _add(issues, "deep_dive_available_but_empty", sample_base)

        # 8. Gold-Star tied to invalid source.
        gold_star = (artifact.get("recognition") or {}).get("gold_star")
        if gold_star and not source_validity.get("valid_for_teacher_display"):
            _add(issues, "gold_star_with_invalid_source", sample_base)

        # PR C9: coach-voice diagnostics. The artifact carries
        # ``_coach_voice_admin`` when the LLM layer ran. Detect contradictions
        # (generated despite block, validation failures, banned strings).
        cv = artifact.get("_coach_voice_admin") or {}
        cv_status = cv.get("status")
        if cv_status == "generated":
            if not artifact.get("teacher_feedback_allowed"):
                _add(issues, "coach_voice_generated_despite_block", sample_base)
            for entry in cv.get("validation_issues") or []:
                _add(
                    issues,
                    "coach_voice_validation_failure",
                    {**sample_base, **entry},
                )
        elif cv_status == "failed_validation":
            _add(issues, "coach_voice_failed_validation", sample_base)

    # PR C6: cross-collection checks (run once, not per-assessment).
    from app.services.teacher_artifact_quarantine import (  # noqa: E402  (sys.path is set above)
        is_teacher_visible_text_safe,
    )
    seen_action_item_keys: Dict[str, List[str]] = {}
    for tasks in coaching_tasks_by_teacher.values():
        for task in tasks or []:
            if not isinstance(task, dict):
                continue
            if task.get("source_type") != "artifact_action_item":
                continue
            for field in ("title", "teacher_title", "teacher_body", "suggested_action", "summary", "body"):
                value = task.get(field)
                if value and not is_teacher_visible_text_safe(str(value)):
                    _add(
                        issues,
                        "action_item_persisted_with_unsafe_text",
                        {
                            "teacher_id": task.get("teacher_id"),
                            "task_id": task.get("id"),
                            "field": field,
                        },
                    )
                    break
            key = (
                task.get("teacher_id"),
                task.get("source_action_item_id") or "",
            )
            if not all(key):
                continue
            seen_action_item_keys.setdefault(key, []).append(task.get("id"))
    for key, task_ids in seen_action_item_keys.items():
        if len(task_ids) > 1:
            _add(
                issues,
                "duplicate_artifact_action_task",
                {
                    "teacher_id": key[0],
                    "source_action_item_id": key[1],
                    "task_ids": task_ids,
                },
            )

    for reflection in coaching_task_reflections or []:
        if not isinstance(reflection, dict):
            continue
        visibility = str(reflection.get("visibility") or "").lower()
        if visibility == "shared_with_admin" and not reflection.get("teacher_id"):
            _add(
                issues,
                "shared_reflection_missing_thread_visibility",
                {"reflection_id": reflection.get("id")},
            )
        # Defensive: assert private reflections actually carry the
        # ``private`` visibility tag rather than something that would leak
        # to admins via existing queries.
        if visibility == "private" and reflection.get("admin_visible") is True:
            _add(
                issues,
                "private_reflection_visible_to_admin",
                {"reflection_id": reflection.get("id")},
            )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "artifact_version": TEACHER_LESSON_COACHING_ARTIFACT_VERSION,
        "counts": {
            "assessments_seen": seen,
            "artifacts_built": artifacts_built,
            "teachers_seen": len(teachers or {}),
            "videos_seen": len(videos or {}),
        },
        "issues": issues,
    }


def _render_text(report: Dict[str, Any]) -> str:
    lines = [
        "Teacher coaching artifact audit",
        f"Generated: {report['generated_at']}",
        f"Artifact version: {report['artifact_version']}",
        f"Filters: {json.dumps(report.get('filters') or {}, sort_keys=True)}",
        "",
    ]
    counts = report.get("counts", {})
    lines.append(f"Assessments inspected: {counts.get('assessments_seen', 0)}")
    lines.append(f"Artifacts built:       {counts.get('artifacts_built', 0)}")
    lines.append("")
    issues = report.get("issues") or {}
    if not issues:
        lines.append("No artifact-safety issues detected in the loaded scope.")
        return "\n".join(lines)
    for code, issue in sorted(issues.items()):
        lines.append(f"{code}: {issue['count']}")
        for sample in issue.get("samples") or []:
            extracted = ", ".join(
                f"{k}={v}"
                for k, v in sample.items()
                if v is not None and not isinstance(v, (dict, list))
            )
            lines.append(f"  - {extracted}")
        lines.append("")
    return "\n".join(lines).rstrip()


async def _load_from_mongo(args: argparse.Namespace) -> Dict[str, Any]:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("motor is required to run the artifact audit script") from exc

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "cognivio")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    try:
        assessment_query: Dict[str, Any] = {}
        if args.teacher_id:
            assessment_query["teacher_id"] = args.teacher_id
        if args.video_id:
            assessment_query["video_id"] = args.video_id
        if args.assessment_id:
            assessment_query["id"] = args.assessment_id
        assessments = await db.assessments.find(assessment_query, {"_id": 0}).to_list(args.limit)

        teacher_ids = {a.get("teacher_id") for a in assessments if a.get("teacher_id")}
        video_ids = {a.get("video_id") for a in assessments if a.get("video_id")}

        teacher_query: Dict[str, Any] = {}
        if args.workspace_id:
            teacher_query["organization_id"] = args.workspace_id
        if teacher_ids:
            teacher_query.setdefault("id", {"$in": list(teacher_ids)})
        teachers_list = await db.teachers.find(teacher_query, {"_id": 0}).to_list(10000) if teacher_query else []
        teachers = {t["id"]: t for t in teachers_list if t.get("id")}

        video_query: Dict[str, Any] = {}
        if video_ids:
            video_query["id"] = {"$in": list(video_ids)}
        videos_list = await db.videos.find(video_query, {"_id": 0}).to_list(10000) if video_query else []
        videos = {v["id"]: v for v in videos_list if v.get("id")}

        coaching_tasks_by_teacher: Dict[str, List[Dict[str, Any]]] = {}
        if teacher_ids:
            tasks_list = await db.coaching_tasks.find(
                {"teacher_id": {"$in": list(teacher_ids)}}, {"_id": 0}
            ).to_list(10000)
            for task in tasks_list:
                coaching_tasks_by_teacher.setdefault(task.get("teacher_id"), []).append(task)

        recognition_badges_by_teacher: Dict[str, List[Dict[str, Any]]] = {}
        if teacher_ids:
            badges_list = await db.recognition_badges.find(
                {"teacher_id": {"$in": list(teacher_ids)}, "status": {"$ne": "revoked"}},
                {"_id": 0},
            ).to_list(10000)
            for badge in badges_list:
                recognition_badges_by_teacher.setdefault(badge.get("teacher_id"), []).append(badge)

        # PR C6: persistent admin reviews + reflections.
        teacher_feedback_reviews_by_assessment: Dict[str, Dict[str, Any]] = {}
        if assessments:
            try:
                reviews_list = await db.teacher_feedback_reviews.find(
                    {"assessment_id": {"$in": [a.get("id") for a in assessments if a.get("id")]}},
                    {"_id": 0},
                ).to_list(10000)
            except Exception:  # pragma: no cover
                reviews_list = []
            for review in reviews_list:
                if review.get("assessment_id"):
                    teacher_feedback_reviews_by_assessment[review["assessment_id"]] = review

        coaching_task_reflections: List[Dict[str, Any]] = []
        if teacher_ids:
            try:
                coaching_task_reflections = await db.coaching_task_reflections.find(
                    {"teacher_id": {"$in": list(teacher_ids)}}, {"_id": 0}
                ).to_list(10000)
            except Exception:  # pragma: no cover
                coaching_task_reflections = []
    finally:
        client.close()

    return {
        "assessments": assessments,
        "teachers": teachers,
        "videos": videos,
        "coaching_tasks_by_teacher": coaching_tasks_by_teacher,
        "recognition_badges_by_teacher": recognition_badges_by_teacher,
        "teacher_feedback_reviews_by_assessment": teacher_feedback_reviews_by_assessment,
        "coaching_task_reflections": coaching_task_reflections,
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit Cognivio teacher coaching artifact safety.",
    )
    parser.add_argument("--teacher-id")
    parser.add_argument("--video-id")
    parser.add_argument("--assessment-id")
    parser.add_argument(
        "--workspace-id",
        help="Restrict teacher lookup to a workspace/organization id.",
    )
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


async def main_async(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    snapshot = await _load_from_mongo(args)
    report = audit_collections(**snapshot)
    report["filters"] = {
        "teacher_id": args.teacher_id,
        "video_id": args.video_id,
        "assessment_id": args.assessment_id,
        "workspace_id": args.workspace_id,
        "limit": args.limit,
    }
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        print(_render_text(report))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(main_async(argv))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
