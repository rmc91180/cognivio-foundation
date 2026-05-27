"""Read-only audit for Cognivio lesson moment + assessment evidence quality.

PR C3 audit script. Reports evidence-quality problems against MongoDB:

  * representative_frame_sec values outside their moment window
  * duplicate moment windows persisted under the same video
  * timeline_coverage moments with near-zero scoring features
  * moments missing the new ``quality`` block (legacy data)
  * assessments missing the ``analysis_quality`` block
  * assessments whose ``analysis_quality.teacher_feedback_allowed`` is False

The script is advisory only and never modifies records. It complements
``audit_video_source_chain.py`` (C1/C2): source-chain audit covers existence
+ orphans; this script covers signal quality.
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


from app.services.lesson_moment_quality import (  # noqa: E402  (sys.path setup above)
    audit_assessment_evidence_quality,
    audit_moment_evidence_quality,
)


def _render_text(report: Dict[str, Any]) -> str:
    lines = [
        "Lesson moment evidence-quality audit",
        f"Generated: {report['generated_at']}",
        f"Filters: {json.dumps(report['filters'], sort_keys=True)}",
        "",
    ]
    counts = report.get("counts", {})
    lines.append(f"Manifests inspected: {counts.get('manifests_seen', 0)}")
    lines.append(f"Moments inspected:   {counts.get('moments_seen', 0)}")
    lines.append(f"Assessments inspected: {counts.get('assessments_seen', 0)}")
    lines.append("")
    issues = report.get("issues") or {}
    if not issues:
        lines.append("No evidence-quality issues detected in the loaded scope.")
        return "\n".join(lines)
    for code, issue in sorted(issues.items()):
        lines.append(f"{code}: {issue['count']}")
        for sample in issue.get("samples") or []:
            lines.append(
                "  - " + ", ".join(f"{k}={v}" for k, v in sample.items() if v is not None)
            )
        lines.append("")
    return "\n".join(lines).rstrip()


async def _load_from_mongo(
    args: argparse.Namespace,
) -> Dict[str, List[dict]]:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError("motor is required to run the MongoDB audit script") from exc

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "cognivio")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    collections: Dict[str, List[dict]] = {}
    try:
        moment_query: Dict[str, Any] = {}
        if args.video_id:
            moment_query["video_id"] = args.video_id
        collections["video_analysis_moments"] = await db.video_analysis_moments.find(
            moment_query, {"_id": 0}
        ).to_list(args.limit)

        assessment_query: Dict[str, Any] = {}
        if args.video_id:
            assessment_query["video_id"] = args.video_id
        if args.teacher_id:
            assessment_query["teacher_id"] = args.teacher_id
        if args.assessment_id:
            assessment_query["id"] = args.assessment_id
        collections["assessments"] = await db.assessments.find(
            assessment_query, {"_id": 0}
        ).to_list(args.limit)

        video_query: Dict[str, Any] = {}
        if args.video_id:
            video_query["id"] = args.video_id
        if args.teacher_id:
            video_query["teacher_id"] = args.teacher_id
        collections["videos"] = await db.videos.find(
            video_query, {"_id": 0, "id": 1, "duration_sec": 1}
        ).to_list(args.limit)
    finally:
        client.close()
    return collections


def audit_collections(collections: Dict[str, List[dict]]) -> Dict[str, Any]:
    """Run both moment + assessment audits over in-memory snapshots."""

    duration_by_video_id: Dict[str, float] = {}
    for video in collections.get("videos") or []:
        try:
            duration = float(video.get("duration_sec") or 0.0)
        except (TypeError, ValueError):
            duration = 0.0
        if video.get("id") and duration:
            duration_by_video_id[video["id"]] = duration

    moment_audit = audit_moment_evidence_quality(
        collections.get("video_analysis_moments") or [],
        duration_by_video_id=duration_by_video_id,
    )
    assessment_audit = audit_assessment_evidence_quality(
        collections.get("assessments") or []
    )

    issues: Dict[str, Any] = {}
    issues.update(moment_audit.get("issues") or {})
    issues.update(assessment_audit.get("issues") or {})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "manifests_seen": moment_audit.get("manifests_seen", 0),
            "moments_seen": moment_audit.get("moments_seen", 0),
            "assessments_seen": assessment_audit.get("assessments_seen", 0),
            "videos_seen": len(collections.get("videos") or []),
        },
        "issues": issues,
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit Cognivio lesson moment and assessment evidence quality.",
    )
    parser.add_argument("--teacher-id")
    parser.add_argument("--video-id")
    parser.add_argument("--assessment-id")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


async def main_async(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    collections = await _load_from_mongo(args)
    report = audit_collections(collections)
    report["filters"] = {
        "teacher_id": args.teacher_id,
        "video_id": args.video_id,
        "assessment_id": args.assessment_id,
        "limit": args.limit,
    }
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(_render_text(report))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(main_async(argv))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
