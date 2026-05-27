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
        else:
            results.append(
                CheckResult(
                    code="target_assessment",
                    status="warn",
                    message="No assessment found for teacher; only orphan/reflection checks ran.",
                )
            )

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


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cognivio pilot smoke checks (read-only)."
    )
    parser.add_argument("--teacher-id")
    parser.add_argument("--video-id")
    parser.add_argument("--assessment-id")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


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
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        print(_render_text(report))
    return 0 if report.get("counts", {}).get("fail", 0) == 0 else 1


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(main_async(argv))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
