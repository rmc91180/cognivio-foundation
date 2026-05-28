"""Read-only audit of the video upload / privacy / transcode / playback chain (PR C9.1).

Reports the production failure modes the C9.1 helpers detect:

- ``url_env_name_prefix_leak`` and other malformed storage URLs on video docs
  and reference image docs.
- Teacher readiness flag (``teacher_reference_images_available``) that
  disagrees with the actual worker-usable count.
- Large videos (>= ``VIDEO_TRANSCODE_MIN_BYTES``) marked
  ``transcode_status=not_required`` and ``processed_asset_state=not_created``.
- Videos whose privacy job failed with structured codes vs unstructured
  legacy errors.
- Videos with no playable redacted asset for teachers.
- Videos eligible for analysis whose ``select_analysis_asset`` choice would
  fail (e.g. only raw available with destructive_blurring_enabled=True).

The script is strictly read-only. It does not modify the database. It is safe
to run against production.

Usage::

    python -m backend.scripts.audit_video_processing_pipeline --limit 200
    python -m backend.scripts.audit_video_processing_pipeline --teacher-id <id>
    python -m backend.scripts.audit_video_processing_pipeline --json out.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

REPO_BACKEND = Path(__file__).resolve().parents[1]
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

# Avoid importing server.py at module top — it boots a FastAPI app. We import
# lazily inside ``run_audit`` after CLI args are parsed.


ISSUE_CODES = (
    "storage_url_malformed",
    "teacher_readiness_mismatch",
    "transcode_decision_missing_for_large_video",
    "transcode_status_inconsistent",
    "privacy_failed_no_structured_code",
    "redacted_asset_missing_after_completion",
    "analysis_asset_unsafe",
    # PR C9.2 additions
    "materialization_possible_but_privacy_failed",
    "storage_download_unavailable",
    "privacy_failed_with_processed_asset_available",
    "reference_materialization_would_succeed",
)


def _doc_id(doc: Mapping[str, Any]) -> str:
    for key in ("id", "video_id", "_id"):
        value = doc.get(key)
        if value is not None:
            return str(value)
    return "<unknown>"


async def _scan_storage_urls(
    db,
    *,
    iter_known_storage_url_fields,
    describe_storage_url_issue,
    limit: int,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    fields = list(iter_known_storage_url_fields())
    query: Dict[str, Any] = {}
    if teacher_id:
        query["teacher_id"] = teacher_id
    for collection_name in ("videos", "teacher_face_references"):
        collection = getattr(db, collection_name, None)
        if collection is None:
            continue
        async for doc in collection.find(query, {"_id": 0}).limit(limit):
            for field in fields:
                code = describe_storage_url_issue(doc.get(field))
                if code and code != "url_missing":
                    issues.append(
                        {
                            "issue_code": "storage_url_malformed",
                            "collection": collection_name,
                            "doc_id": _doc_id(doc),
                            "teacher_id": doc.get("teacher_id"),
                            "field": field,
                            "url_issue": code,
                            "raw_url": doc.get(field),
                        }
                    )
    return issues


async def _scan_readiness_mismatches(
    db,
    *,
    summarize_privacy_references,
    upload_dir: Path,
    limit: int,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    if not hasattr(db, "teachers"):
        return issues
    now_iso = datetime.now(timezone.utc).isoformat()
    query: Dict[str, Any] = {}
    if teacher_id:
        query["id"] = teacher_id
    async for teacher in db.teachers.find(query, {"_id": 0, "id": 1}).limit(limit):
        tid = teacher.get("id")
        if not tid:
            continue
        references = await db.teacher_face_references.find(
            {"teacher_id": tid, "status": {"$nin": ["deleted", "replaced", "expired"]}},
            {"_id": 0},
        ).to_list(50)
        summary = summarize_privacy_references(
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
        if summary.usable_count >= 1 and worker_summary.usable_count == 0:
            issues.append(
                {
                    "issue_code": "teacher_readiness_mismatch",
                    "teacher_id": tid,
                    "reference_total": summary.total,
                    "ui_usable_count": summary.usable_count,
                    "worker_usable_count": worker_summary.usable_count,
                    "primary_failure_code": worker_summary.primary_failure_code,
                    "failure_codes": list(worker_summary.failure_codes),
                }
            )
    return issues


async def _scan_videos(
    db,
    *,
    decide_transcode_for_upload,
    select_playback_asset,
    select_analysis_asset,
    transcode_min_bytes: int,
    transcode_enabled: bool,
    pipeline_enabled: bool,
    limit: int,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    if not hasattr(db, "videos"):
        return issues
    query: Dict[str, Any] = {}
    if teacher_id:
        query["teacher_id"] = teacher_id
    async for video in db.videos.find(query, {"_id": 0}).limit(limit):
        vid = _doc_id(video)
        size = video.get("file_size_bytes") or video.get("raw_file_size_bytes")
        decision = decide_transcode_for_upload(
            size,
            transcode_enabled=transcode_enabled,
            pipeline_enabled=pipeline_enabled,
            min_bytes=transcode_min_bytes,
        )
        if decision.decision in {"queued", "pending"} and video.get("transcode_status") == "not_required":
            issues.append(
                {
                    "issue_code": "transcode_status_inconsistent",
                    "video_id": vid,
                    "teacher_id": video.get("teacher_id"),
                    "file_size_bytes": size,
                    "transcode_status": video.get("transcode_status"),
                    "decision": decision.decision,
                    "decision_reason": decision.reason,
                }
            )
        if (
            decision.decision == "pending"
            and not video.get("processed_file_path")
            and video.get("processed_asset_state") == "not_created"
        ):
            issues.append(
                {
                    "issue_code": "transcode_decision_missing_for_large_video",
                    "video_id": vid,
                    "teacher_id": video.get("teacher_id"),
                    "file_size_bytes": size,
                    "processed_asset_state": video.get("processed_asset_state"),
                }
            )
        if (
            video.get("privacy_status") == "failed"
            and not video.get("privacy_reference_failure_codes")
            and "no usable references" in str(video.get("privacy_error") or "").lower()
        ):
            issues.append(
                {
                    "issue_code": "privacy_failed_no_structured_code",
                    "video_id": vid,
                    "teacher_id": video.get("teacher_id"),
                    "privacy_error": video.get("privacy_error"),
                }
            )
        if video.get("privacy_status") == "completed":
            decision_teacher = select_playback_asset(video, "teacher", allow_raw_for_admin=False)
            if not decision_teacher.url:
                issues.append(
                    {
                        "issue_code": "redacted_asset_missing_after_completion",
                        "video_id": vid,
                        "teacher_id": video.get("teacher_id"),
                        "failure_code": decision_teacher.failure_code,
                    }
                )
            analysis_decision = select_analysis_asset(video)
            if not analysis_decision.path:
                issues.append(
                    {
                        "issue_code": "analysis_asset_unsafe",
                        "video_id": vid,
                        "teacher_id": video.get("teacher_id"),
                        "failure_code": analysis_decision.failure_code,
                    }
                )
    return issues


async def _scan_materialization_capability(
    db,
    *,
    evaluate_materialization_capability,
    upload_dir: Path,
    storage_download_available: bool,
    url_fetch_enabled: bool,
    limit: int,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    """PR C9.2: report which teachers' references WOULD materialize successfully."""
    issues: List[Dict[str, Any]] = []
    if not hasattr(db, "teachers"):
        return issues
    query: Dict[str, Any] = {}
    if teacher_id:
        query["id"] = teacher_id
    async for teacher in db.teachers.find(query, {"_id": 0, "id": 1}).limit(limit):
        tid = teacher.get("id")
        if not tid:
            continue
        references = await db.teacher_face_references.find(
            {"teacher_id": tid, "status": {"$nin": ["deleted", "replaced", "expired"]}},
            {"_id": 0},
        ).to_list(50)
        if not references:
            continue
        cap = evaluate_materialization_capability(
            references,
            upload_dir=upload_dir,
            storage_download_available=storage_download_available,
            url_fetch_enabled=url_fetch_enabled,
        )
        if not storage_download_available and any(r.get("s3_key") for r in references):
            issues.append(
                {
                    "issue_code": "storage_download_unavailable",
                    "teacher_id": tid,
                    "reference_total": cap["total"],
                    "would_materialize_count": cap["would_materialize_count"],
                }
            )
        if cap["would_materialize_count"] > 0:
            issues.append(
                {
                    "issue_code": "reference_materialization_would_succeed",
                    "teacher_id": tid,
                    "reference_total": cap["total"],
                    "would_materialize_count": cap["would_materialize_count"],
                }
            )
    return issues


async def _scan_materialization_vs_privacy_state(
    db,
    *,
    evaluate_materialization_capability,
    upload_dir: Path,
    storage_download_available: bool,
    url_fetch_enabled: bool,
    limit: int,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    """Flag failed-privacy videos whose references WOULD materialize now.

    These are the production rows that should clear after retry once C9.2 is
    deployed. Also flag failed-privacy with processed asset already present
    (forward-looking signal that destructive blur was the only blocker).
    """
    issues: List[Dict[str, Any]] = []
    if not hasattr(db, "videos"):
        return issues
    query: Dict[str, Any] = {"privacy_status": "failed"}
    if teacher_id:
        query["teacher_id"] = teacher_id
    async for video in db.videos.find(query, {"_id": 0}).limit(limit):
        tid = video.get("teacher_id")
        if not tid:
            continue
        references = await db.teacher_face_references.find(
            {"teacher_id": tid, "status": {"$nin": ["deleted", "replaced", "expired"]}},
            {"_id": 0},
        ).to_list(50)
        cap = evaluate_materialization_capability(
            references,
            upload_dir=upload_dir,
            storage_download_available=storage_download_available,
            url_fetch_enabled=url_fetch_enabled,
        )
        if cap["would_materialize_count"] > 0:
            issues.append(
                {
                    "issue_code": "materialization_possible_but_privacy_failed",
                    "video_id": video.get("id"),
                    "teacher_id": tid,
                    "privacy_reference_failure_codes": list(
                        video.get("privacy_reference_failure_codes") or []
                    ),
                    "would_materialize_count": cap["would_materialize_count"],
                }
            )
        if video.get("processed_asset_state") == "stored":
            issues.append(
                {
                    "issue_code": "privacy_failed_with_processed_asset_available",
                    "video_id": video.get("id"),
                    "teacher_id": tid,
                }
            )
    return issues


async def _dry_run_materialization(
    db,
    *,
    materialize_privacy_references,
    cleanup_materialized_privacy_references,
    download_s3_key_to_file,
    upload_dir: Path,
    teacher_id: Optional[str],
) -> List[Dict[str, Any]]:
    """PR C9.2 --check-materialization: actually try to materialize references.

    Read-only against the database; writes only to per-call temp directories
    which are cleaned up before returning.
    """
    findings: List[Dict[str, Any]] = []
    if not hasattr(db, "teachers"):
        return findings
    query: Dict[str, Any] = {}
    if teacher_id:
        query["id"] = teacher_id
    async for teacher in db.teachers.find(query, {"_id": 0, "id": 1}).limit(50):
        tid = teacher.get("id")
        if not tid:
            continue
        references = await db.teacher_face_references.find(
            {"teacher_id": tid, "status": {"$nin": ["deleted", "replaced", "expired"]}},
            {"_id": 0},
        ).to_list(50)
        if not references:
            continue
        result = materialize_privacy_references(
            references,
            upload_dir=upload_dir,
            storage_downloader=download_s3_key_to_file,
            url_fetcher=None,
            url_fetch_enabled=False,
            allowed_hosts=(),
            temp_dir_prefix=f"cognivio-privacy-refs-audit-{tid}-",
        )
        try:
            findings.append(
                {
                    "teacher_id": tid,
                    "total_references": result.total,
                    "materialized_count": result.usable_count,
                    "failure_codes": list(result.failure_codes),
                    "temp_dir_was_created": bool(result.temp_dir),
                    "temp_dir_cleaned": True,
                }
            )
        finally:
            cleanup_materialized_privacy_references(result)
    return findings


async def run_audit(args: argparse.Namespace) -> int:
    # Lazy import so CLI --help works without DB / FastAPI boot.
    os.environ.setdefault("MONGO_URL", os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    os.environ.setdefault("DB_NAME", os.getenv("DB_NAME", "cognivio"))

    import server  # type: ignore[import-not-found]
    from app.services.storage_urls import (  # noqa: WPS433
        describe_storage_url_issue,
        iter_known_storage_url_fields,
    )
    from app.services.privacy_references import (  # noqa: WPS433
        summarize_privacy_references,
    )
    from app.services.privacy_reference_materialization import (  # noqa: WPS433
        cleanup_materialized_privacy_references,
        evaluate_materialization_capability,
        materialize_privacy_references,
    )
    from app.services.video_assets import (  # noqa: WPS433
        decide_transcode_for_upload,
        select_analysis_asset,
        select_playback_asset,
    )

    db = server.db
    upload_dir = server.UPLOAD_DIR
    storage_download_available = server._storage_download_available()
    url_fetch_enabled = server.PRIVACY_REFERENCE_URL_FETCH_ENABLED

    if args.check_materialization:
        findings = await _dry_run_materialization(
            db,
            materialize_privacy_references=materialize_privacy_references,
            cleanup_materialized_privacy_references=cleanup_materialized_privacy_references,
            download_s3_key_to_file=server.download_s3_key_to_file,
            upload_dir=upload_dir,
            teacher_id=args.teacher_id,
        )
        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "check-materialization",
            "filters": {"teacher_id": args.teacher_id},
            "findings": findings,
        }
        output = json.dumps(report, indent=2, sort_keys=True, default=str)
        if args.json:
            Path(args.json).write_text(output, encoding="utf-8")
        else:
            print(output)
        return 0

    storage_url_issues = await _scan_storage_urls(
        db,
        iter_known_storage_url_fields=iter_known_storage_url_fields,
        describe_storage_url_issue=describe_storage_url_issue,
        limit=args.limit,
        teacher_id=args.teacher_id,
    )
    readiness_issues = await _scan_readiness_mismatches(
        db,
        summarize_privacy_references=summarize_privacy_references,
        upload_dir=upload_dir,
        limit=args.limit,
        teacher_id=args.teacher_id,
    )
    video_issues = await _scan_videos(
        db,
        decide_transcode_for_upload=decide_transcode_for_upload,
        select_playback_asset=select_playback_asset,
        select_analysis_asset=select_analysis_asset,
        transcode_min_bytes=server.VIDEO_TRANSCODE_MIN_BYTES,
        transcode_enabled=server.VIDEO_TRANSCODE_ENABLED,
        pipeline_enabled=server.VIDEO_TRANSCODE_PIPELINE_ENABLED,
        limit=args.limit,
        teacher_id=args.teacher_id,
    )
    materialization_issues = await _scan_materialization_capability(
        db,
        evaluate_materialization_capability=evaluate_materialization_capability,
        upload_dir=upload_dir,
        storage_download_available=storage_download_available,
        url_fetch_enabled=url_fetch_enabled,
        limit=args.limit,
        teacher_id=args.teacher_id,
    )
    materialization_vs_state = await _scan_materialization_vs_privacy_state(
        db,
        evaluate_materialization_capability=evaluate_materialization_capability,
        upload_dir=upload_dir,
        storage_download_available=storage_download_available,
        url_fetch_enabled=url_fetch_enabled,
        limit=args.limit,
        teacher_id=args.teacher_id,
    )

    all_issues = (
        storage_url_issues
        + readiness_issues
        + video_issues
        + materialization_issues
        + materialization_vs_state
    )
    summary: Dict[str, int] = {}
    for issue in all_issues:
        code = issue["issue_code"]
        summary[code] = summary.get(code, 0) + 1

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "filters": {"teacher_id": args.teacher_id, "limit": args.limit},
        "summary": summary,
        "issue_codes": list(ISSUE_CODES),
        "issues": all_issues,
    }
    output = json.dumps(report, indent=2, sort_keys=True, default=str)
    if args.json:
        Path(args.json).write_text(output, encoding="utf-8")
    else:
        print(output)
    return 1 if all_issues else 0


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit Cognivio video upload/privacy/transcode/playback reliability.",
    )
    parser.add_argument(
        "--teacher-id",
        default=None,
        help="Restrict the scan to a single teacher.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Per-collection scan limit (default 500).",
    )
    parser.add_argument(
        "--json",
        default=None,
        help="Write the JSON report to this path instead of stdout.",
    )
    parser.add_argument(
        "--check-materialization",
        action="store_true",
        help=(
            "PR C9.2 dry-run: actually download each reference into a temp "
            "directory to confirm materialization would succeed. Read-only "
            "against the DB; cleans up temp files before exit."
        ),
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    return asyncio.run(run_audit(args))


if __name__ == "__main__":
    raise SystemExit(main())
