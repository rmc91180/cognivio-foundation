"""Read-only audit for Cognivio video source-chain integrity.

The script reports derived video artifacts whose canonical video or assessment
parents are missing. It is advisory and non-destructive by default.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))


DERIVED_COLLECTIONS: Dict[str, Dict[str, Optional[str]]] = {
    "coaching_tasks": {"video_field": "video_id", "assessment_field": "assessment_id"},
    "video_analysis_moments": {"video_field": "video_id", "assessment_field": None},
    "video_audio_transcripts": {"video_field": "video_id", "assessment_field": None},
    "transcripts": {"video_field": "video_id", "assessment_field": None},
    "video_analysis_features": {"video_field": "video_id", "assessment_field": None},
    "analysis_features": {"video_field": "video_id", "assessment_field": None},
}


def _doc_id(doc: dict) -> str:
    for key in ("id", "video_id", "assessment_id", "_id"):
        value = doc.get(key)
        if value is not None:
            return str(value)
    return "<unknown>"


def _matches_filter(
    doc: dict,
    *,
    teacher_id: Optional[str] = None,
    video_id: Optional[str] = None,
    assessment_id: Optional[str] = None,
    match_id_as_video: bool = False,
    match_id_as_assessment: bool = False,
) -> bool:
    if teacher_id and doc.get("teacher_id") != teacher_id:
        return False
    if video_id:
        candidate = doc.get("video_id")
        if candidate is None and match_id_as_video:
            candidate = doc.get("id")
        if candidate is not None and candidate != video_id:
            return False
    if assessment_id:
        candidate = doc.get("assessment_id")
        if candidate is None and match_id_as_assessment:
            candidate = doc.get("id")
        if candidate is not None and candidate != assessment_id:
            return False
    return True


def _has_asset(doc: dict, prefixes: Iterable[str]) -> bool:
    suffixes = ("_file_url", "_file_path", "_s3_key", "_asset_url", "_asset_path", "_asset_key")
    for prefix in prefixes:
        for suffix in suffixes:
            if doc.get(f"{prefix}{suffix}"):
                return True
    return False


def _has_playable_asset(video: dict) -> bool:
    if video.get("playback_url"):
        return True
    if _has_asset(video, ("redacted", "processed", "raw")):
        return True
    return bool(video.get("file_url") or video.get("file_path") or video.get("s3_key"))


def _sample_issue(doc: dict, message: str) -> dict:
    return {
        "id": _doc_id(doc),
        "video_id": doc.get("video_id") or doc.get("id"),
        "assessment_id": doc.get("assessment_id"),
        "teacher_id": doc.get("teacher_id"),
        "message": message,
    }


def _add_issue(report: dict, code: str, collection: str, doc: dict, message: str, *, limit: int) -> None:
    bucket = report["issues"].setdefault(
        code,
        {
            "code": code,
            "count": 0,
            "collections": {},
            "samples": [],
        },
    )
    bucket["count"] += 1
    bucket["collections"][collection] = bucket["collections"].get(collection, 0) + 1
    if len(bucket["samples"]) < limit:
        bucket["samples"].append({"collection": collection, **_sample_issue(doc, message)})


def audit_documents(
    collections: Dict[str, List[dict]],
    *,
    teacher_id: Optional[str] = None,
    video_id: Optional[str] = None,
    assessment_id: Optional[str] = None,
    limit: int = 20,
) -> dict:
    videos = [
        doc
        for doc in collections.get("videos", [])
        if _matches_filter(
            doc,
            teacher_id=teacher_id,
            video_id=video_id,
            assessment_id=None,
            match_id_as_video=True,
        )
    ]
    assessments = [
        doc
        for doc in collections.get("assessments", [])
        if _matches_filter(
            doc,
            teacher_id=teacher_id,
            video_id=video_id,
            assessment_id=assessment_id,
            match_id_as_assessment=True,
        )
    ]
    video_ids = {doc.get("id") for doc in videos if doc.get("id")}
    assessment_ids = {doc.get("id") for doc in assessments if doc.get("id")}
    assessments_by_video: Dict[str, List[dict]] = {}
    for doc in assessments:
        if doc.get("video_id"):
            assessments_by_video.setdefault(doc["video_id"], []).append(doc)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "filters": {
            "teacher_id": teacher_id,
            "video_id": video_id,
            "assessment_id": assessment_id,
            "sample_limit": limit,
        },
        "counts": {
            "videos_loaded": len(videos),
            "assessments_loaded": len(assessments),
        },
        "issues": {},
    }

    for assessment in assessments:
        parent_video_id = assessment.get("video_id")
        if parent_video_id and parent_video_id not in video_ids:
            _add_issue(
                report,
                "assessment_missing_video_parent",
                "assessments",
                assessment,
                "Assessment references a video_id that is not present in videos.",
                limit=limit,
            )

    for collection, fields in DERIVED_COLLECTIONS.items():
        docs = collections.get(collection, [])
        report["counts"][f"{collection}_loaded"] = len(docs)
        for doc in docs:
            if not _matches_filter(doc, teacher_id=teacher_id, video_id=video_id, assessment_id=assessment_id):
                continue
            doc_video_id = doc.get(fields["video_field"] or "")
            if doc_video_id and doc_video_id not in video_ids:
                _add_issue(
                    report,
                    "derived_missing_video_parent",
                    collection,
                    doc,
                    f"{collection} references a video_id that is not present in videos.",
                    limit=limit,
                )
            assessment_field = fields.get("assessment_field")
            doc_assessment_id = doc.get(assessment_field or "")
            if doc_assessment_id and doc_assessment_id not in assessment_ids:
                _add_issue(
                    report,
                    "derived_missing_assessment_parent",
                    collection,
                    doc,
                    f"{collection} references an assessment_id that is not present in assessments.",
                    limit=limit,
                )

    for video in videos:
        status = str(video.get("analysis_status") or video.get("status") or "").lower()
        if status in {"completed", "reviewed"} and not assessments_by_video.get(video.get("id")):
            _add_issue(
                report,
                "completed_video_missing_assessment",
                "videos",
                video,
                "Video is marked completed/reviewed but has no assessment.",
                limit=limit,
            )
        if str(video.get("status") or "").lower() == "completed" and not _has_playable_asset(video):
            _add_issue(
                report,
                "completed_video_missing_playable_asset",
                "videos",
                video,
                "Video is completed but has no raw, processed, redacted, or playback asset metadata.",
                limit=limit,
            )
        raw_deleted = (
            video.get("raw_asset_state") == "deleted"
            or video.get("source_asset_state") == "deleted"
            or video.get("unblurred_deletion_status") == "deleted"
            or video.get("privacy_pipeline_state") == "unblurred_deleted"
        )
        if raw_deleted and not _has_asset(video, ("processed", "redacted")):
            _add_issue(
                report,
                "raw_deleted_missing_processed_or_redacted_asset",
                "videos",
                video,
                "Raw source is marked deleted but no processed/redacted asset metadata remains.",
                limit=limit,
            )

    report["summary"] = {
        "issue_types": len(report["issues"]),
        "total_issues": sum(issue["count"] for issue in report["issues"].values()),
    }
    return report


def _mongo_query(
    *,
    teacher_id: Optional[str],
    video_id: Optional[str],
    assessment_id: Optional[str],
    collection: str,
) -> dict:
    query: Dict[str, Any] = {}
    if teacher_id:
        query["teacher_id"] = teacher_id
    if video_id:
        if collection == "videos":
            query["id"] = video_id
        else:
            query["video_id"] = video_id
    if assessment_id:
        if collection == "assessments":
            query["id"] = assessment_id
        elif collection in {"coaching_tasks"}:
            query["assessment_id"] = assessment_id
    return query


async def _load_from_mongo(args: argparse.Namespace) -> Dict[str, List[dict]]:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError("motor is required to run the MongoDB audit script") from exc

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "cognivio")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    names = ["videos", "assessments", *DERIVED_COLLECTIONS.keys()]
    collections: Dict[str, List[dict]] = {}
    try:
        for name in names:
            query = _mongo_query(
                teacher_id=args.teacher_id,
                video_id=args.video_id,
                assessment_id=args.assessment_id,
                collection=name,
            )
            collections[name] = await db[name].find(query, {"_id": 0}).to_list(100000)
    finally:
        client.close()
    return collections


def _render_text(report: dict) -> str:
    lines = [
        "Video source-chain audit",
        f"Generated: {report['generated_at']}",
        f"Filters: {json.dumps(report['filters'], sort_keys=True)}",
        f"Total issues: {report['summary']['total_issues']}",
        "",
    ]
    if not report["issues"]:
        lines.append("No source-chain issues detected in the loaded scope.")
        return "\n".join(lines)
    for code, issue in sorted(report["issues"].items()):
        lines.append(f"{code}: {issue['count']}")
        lines.append(f"  Collections: {json.dumps(issue['collections'], sort_keys=True)}")
        for sample in issue["samples"]:
            lines.append(
                "  - "
                f"{sample['collection']} id={sample.get('id')} "
                f"video_id={sample.get('video_id')} assessment_id={sample.get('assessment_id')} "
                f"teacher_id={sample.get('teacher_id')}: {sample['message']}"
            )
        lines.append("")
    return "\n".join(lines).rstrip()


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit Cognivio video source-chain integrity.")
    parser.add_argument("--teacher-id")
    parser.add_argument("--video-id")
    parser.add_argument("--assessment-id")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of human-readable text.")
    parser.add_argument("--limit", type=int, default=20, help="Maximum samples per issue type.")
    parser.add_argument(
        "--repair-safe",
        action="store_true",
        help="Reserved for future non-destructive marking; not implemented in PR C1.",
    )
    return parser.parse_args(argv)


async def main_async(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    if args.repair_safe:
        raise SystemExit("--repair-safe is intentionally not implemented in PR C1; run read-only audit instead.")
    collections = await _load_from_mongo(args)
    report = audit_documents(
        collections,
        teacher_id=args.teacher_id,
        video_id=args.video_id,
        assessment_id=args.assessment_id,
        limit=max(1, args.limit),
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(_render_text(report))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    return asyncio.run(main_async(argv))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
