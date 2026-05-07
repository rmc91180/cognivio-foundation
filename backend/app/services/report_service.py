from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import server as legacy


BRAND_TEAL = colors.HexColor("#00A896")
BRAND_NAVY = colors.HexColor("#0D1B40")


async def ensure_assessment_evidence(assessment: dict, current_user: dict):
    return await legacy._ensure_mock_evidence(assessment, current_user)


async def get_curriculum_adherence_payload(assessment_id: str, current_user: dict):
    return await legacy.get_curriculum_adherence(assessment_id, current_user)


async def get_assessment_for_video(video_id: str) -> Optional[dict]:
    return await legacy._get_assessment_for_video(video_id)


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "CognivioTitle",
            parent=base["Title"],
            textColor=BRAND_NAVY,
            fontSize=26,
            leading=30,
            spaceAfter=18,
        ),
        "h1": ParagraphStyle(
            "CognivioHeading",
            parent=base["Heading1"],
            textColor=BRAND_NAVY,
            fontSize=18,
            leading=22,
            spaceBefore=8,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "CognivioSubheading",
            parent=base["Heading2"],
            textColor=BRAND_NAVY,
            fontSize=13,
            leading=16,
            spaceBefore=8,
            spaceAfter=6,
        ),
        "body": ParagraphStyle("CognivioBody", parent=base["BodyText"], fontSize=9.5, leading=13),
        "small": ParagraphStyle("CognivioSmall", parent=base["BodyText"], fontSize=8, leading=10, textColor=colors.HexColor("#475569")),
    }


def _safe_text(value: Any, fallback: str = "") -> str:
    text = str(value if value is not None else fallback).strip()
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _format_date(value: Any) -> str:
    if not value:
        return "Not recorded"
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return str(value)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d")


async def _visible_teachers(current_user: dict) -> List[dict]:
    teacher_ids = await legacy._list_teacher_ids_for_user(current_user)
    if not teacher_ids:
        return []
    return await legacy.db.teachers.find({"id": {"$in": teacher_ids}}, {"_id": 0}).sort("name", 1).to_list(5000)


async def _teacher_assessments(teacher_id: str, current_user: dict) -> List[dict]:
    await legacy._get_teacher_or_404(teacher_id, current_user)
    docs = await legacy.db.assessments.find(
        {"teacher_id": teacher_id},
        {"_id": 0},
    ).sort("analyzed_at", 1).to_list(5000)
    visible_video_ids = {
        doc.get("id")
        for doc in await legacy.db.videos.find(
            {"teacher_id": teacher_id},
            {"_id": 0, "id": 1},
        ).to_list(5000)
    }
    user_id = current_user.get("id")
    return [
        doc
        for doc in docs
        if doc.get("user_id") == user_id or not doc.get("user_id") or doc.get("video_id") in visible_video_ids
    ]


def _latest_overall(assessments: List[dict]) -> Optional[float]:
    scores = [doc.get("overall_score") for doc in assessments if isinstance(doc.get("overall_score"), (int, float))]
    return round(float(scores[-1]), 2) if scores else None


def _domain_rows(assessments: List[dict]) -> List[Tuple[str, float, int]]:
    buckets: Dict[str, List[float]] = {}
    for assessment in assessments:
        for score in assessment.get("element_scores") or []:
            name = score.get("domain") or score.get("element_name") or score.get("element_id") or "Element"
            value = score.get("score")
            if isinstance(value, (int, float)):
                buckets.setdefault(str(name), []).append(float(value))
    rows = []
    for name, values in buckets.items():
        rows.append((name, round(sum(values) / len(values), 2), len(values)))
    return sorted(rows, key=lambda row: row[0])


async def _record_history(current_user: dict, report_type: str, filename: str, metadata: Optional[dict] = None) -> None:
    await legacy.db.report_history.insert_one(
        {
            "id": legacy.uuid.uuid4().hex,
            "workspace_id": legacy._get_dashboard_workspace_id(current_user),
            "user_id": current_user.get("id"),
            "report_type": report_type,
            "filename": filename,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def _build_pdf(story: List[Any], title: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=0.6 * inch,
        leftMargin=0.6 * inch,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        title=title,
    )
    doc.build(story)
    return buffer.getvalue()


async def generate_teacher_report(teacher_id: str, current_user: dict, cycle_year: Optional[int] = None) -> bytes:
    teacher = await legacy._get_teacher_or_404(teacher_id, current_user)
    assessments = await _teacher_assessments(teacher_id, current_user)
    coaching = await legacy.db.coaching_tasks.find({"teacher_id": teacher_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    styles = _styles()
    latest = assessments[-1] if assessments else {}
    observer = current_user.get("name") or current_user.get("email") or "Cognivio observer"
    cycle_label = str(cycle_year or datetime.now(timezone.utc).year)

    story: List[Any] = [
        Paragraph("Cognivio", styles["title"]),
        Paragraph(_safe_text(teacher.get("name") or teacher.get("email") or "Teacher performance summary"), styles["h1"]),
        Paragraph(f"School: {_safe_text(teacher.get('school_name') or teacher.get('organization_name') or 'Not recorded')}", styles["body"]),
        Paragraph(f"Cycle: {_safe_text(cycle_label)}", styles["body"]),
        Paragraph(f"Observer: {_safe_text(observer)}", styles["body"]),
        Paragraph(f"Generated: {_format_date(datetime.now(timezone.utc))}", styles["body"]),
        Spacer(1, 0.25 * inch),
        Table([["", ""]], colWidths=[1.4 * inch, 4.8 * inch], rowHeights=[0.08 * inch], style=[("BACKGROUND", (0, 0), (-1, -1), BRAND_TEAL)]),
        PageBreak(),
        Paragraph("Overall Summary", styles["h1"]),
        Table(
            [
                ["Overall score", _latest_overall(assessments) if assessments else "No score"],
                ["Observation count", len(assessments)],
                ["Latest observation", _format_date(latest.get("analyzed_at") or latest.get("created_at"))],
            ],
            colWidths=[2.2 * inch, 4.4 * inch],
            style=[
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                ("TEXTCOLOR", (0, 0), (0, -1), BRAND_NAVY),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("PADDING", (0, 0), (-1, -1), 7),
            ],
        ),
        Spacer(1, 0.2 * inch),
        Paragraph("Trend", styles["h2"]),
        Paragraph("Recent score movement is summarized from stored assessment records for this cycle.", styles["body"]),
        PageBreak(),
        Paragraph("Domain Breakdown", styles["h1"]),
    ]

    domain_table = [["Domain or element", "Average score", "Evidence count"]]
    domain_table.extend([[name, score, count] for name, score, count in _domain_rows(assessments)])
    if len(domain_table) == 1:
        domain_table.append(["No scored evidence yet", "", ""])
    story.append(
        Table(
            domain_table,
            colWidths=[3.4 * inch, 1.4 * inch, 1.5 * inch],
            repeatRows=1,
            style=[
                ("BACKGROUND", (0, 0), (-1, 0), BRAND_NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("PADDING", (0, 0), (-1, -1), 6),
            ],
        )
    )
    for assessment in assessments[-3:]:
        story.append(Spacer(1, 0.15 * inch))
        story.append(Paragraph(f"AI evidence from {_format_date(assessment.get('analyzed_at') or assessment.get('created_at'))}", styles["h2"]))
        for evidence in (assessment.get("evidence") or assessment.get("evidence_quotes") or [])[:2]:
            story.append(Paragraph(_safe_text(evidence.get("text") if isinstance(evidence, dict) else evidence), styles["small"]))

    story.extend([PageBreak(), Paragraph("Coaching History", styles["h1"])])
    rows = [["Task", "Status", "Completion note"]]
    rows.extend(
        [
            [
                _safe_text(task.get("title") or task.get("element_name") or "Coaching task"),
                _safe_text(task.get("status") or "open"),
                _safe_text(task.get("completion_note") or task.get("notes") or ""),
            ]
            for task in coaching[:30]
        ]
    )
    if len(rows) == 1:
        rows.append(["No coaching tasks this cycle", "", ""])
    story.append(Table(rows, colWidths=[2.8 * inch, 1.2 * inch, 2.5 * inch], repeatRows=1, style=[("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")), ("BACKGROUND", (0, 0), (-1, 0), BRAND_TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("PADDING", (0, 0), (-1, -1), 5)]))

    filename = f"teacher-{teacher_id}-report.pdf"
    await _record_history(current_user, "teacher_report", filename, {"teacher_id": teacher_id, "cycle_year": cycle_year})
    return _build_pdf(story, filename)


async def generate_school_summary(current_user: dict, cycle_year: Optional[int] = None) -> bytes:
    legacy._require_observation_planner(current_user)
    teachers = await _visible_teachers(current_user)
    teacher_ids = [teacher["id"] for teacher in teachers if teacher.get("id")]
    assessments = await legacy.db.assessments.find({"teacher_id": {"$in": teacher_ids or ["__none__"]}}, {"_id": 0}).to_list(10000)
    by_teacher: Dict[str, List[dict]] = {}
    for assessment in assessments:
        by_teacher.setdefault(assessment.get("teacher_id"), []).append(assessment)
    compliance = await legacy._build_schedule_compliance_payload(current_user)
    recognition = await legacy.db.recognition_badges.find({"teacher_id": {"$in": teacher_ids or ["__none__"]}}, {"_id": 0}).to_list(1000)
    scored = [_latest_overall(by_teacher.get(teacher.get("id"), [])) for teacher in teachers]
    scored = [score for score in scored if isinstance(score, (int, float))]
    avg_score = round(sum(scored) / len(scored), 2) if scored else None
    coverage_pct = round((compliance["summary"]["on_track"] / compliance["summary"]["total"]) * 100, 1) if compliance["summary"]["total"] else 0
    styles = _styles()
    story: List[Any] = [
        Paragraph("Cognivio School Summary", styles["title"]),
        Paragraph(f"Cycle: {_safe_text(cycle_year or datetime.now(timezone.utc).year)}", styles["body"]),
        Paragraph(f"Generated: {_format_date(datetime.now(timezone.utc))}", styles["body"]),
        Spacer(1, 0.2 * inch),
        Paragraph("Executive Summary", styles["h1"]),
        Table(
            [
                ["Total observations", len(assessments)],
                ["Average score", avg_score if avg_score is not None else "No score"],
                ["Coverage", f"{coverage_pct}%"],
                ["Recognition awarded", len(recognition)],
            ],
            colWidths=[2.4 * inch, 4.2 * inch],
            style=[("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")), ("PADDING", (0, 0), (-1, -1), 7)],
        ),
        Spacer(1, 0.25 * inch),
        Paragraph("All Teachers", styles["h1"]),
    ]
    rows = [["Teacher", "Latest score", "Assessments", "Compliance"]]
    compliance_by_teacher = {item["teacher_id"]: item for item in compliance["items"]}
    for teacher in teachers:
        teacher_assessments = by_teacher.get(teacher.get("id"), [])
        rows.append(
            [
                _safe_text(teacher.get("name") or teacher.get("email") or "Teacher"),
                _latest_overall(teacher_assessments) if teacher_assessments else "No score",
                len(teacher_assessments),
                _safe_text((compliance_by_teacher.get(teacher.get("id")) or {}).get("compliance_status") or "unknown"),
            ]
        )
    if len(rows) == 1:
        rows.append(["No teachers found", "", "", ""])
    story.append(Table(rows, colWidths=[2.6 * inch, 1.2 * inch, 1.2 * inch, 1.4 * inch], repeatRows=1, style=[("BACKGROUND", (0, 0), (-1, 0), BRAND_NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")), ("PADDING", (0, 0), (-1, -1), 5)]))
    story.extend([
        Spacer(1, 0.25 * inch),
        Paragraph("Recommended Actions", styles["h1"]),
        Paragraph("Prioritize teachers marked at risk or non-compliant, then use coaching tasks to close element-specific gaps before the next cycle checkpoint.", styles["body"]),
    ])
    filename = "school-summary-report.pdf"
    await _record_history(current_user, "school_summary", filename, {"cycle_year": cycle_year})
    return _build_pdf(story, filename)


def _csv_response(rows: Iterable[Dict[str, Any]], columns: List[str]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in columns})
    return buffer.getvalue().encode("utf-8")


async def export_csv(export_type: str, current_user: dict) -> Tuple[bytes, str]:
    export_type = str(export_type or "").lower()
    teacher_ids = await legacy._list_teacher_ids_for_user(current_user)
    if export_type == "assessments":
        docs = await legacy.db.assessments.find({"teacher_id": {"$in": teacher_ids or ["__none__"]}}, {"_id": 0}).sort("analyzed_at", -1).to_list(20000)
        teachers = {doc["id"]: doc for doc in await _visible_teachers(current_user)}
        rows = []
        for doc in docs:
            teacher = teachers.get(doc.get("teacher_id"), {})
            rows.append(
                {
                    "teacher": teacher.get("name") or doc.get("teacher_id"),
                    "teacher_id": doc.get("teacher_id"),
                    "date": _format_date(doc.get("analyzed_at") or doc.get("created_at")),
                    "overall_score": doc.get("overall_score"),
                    "element_scores": "; ".join(f"{score.get('element_id') or score.get('element_code')}={score.get('score')}" for score in doc.get("element_scores") or []),
                    "observer": doc.get("observer_name") or doc.get("user_id"),
                }
            )
        filename = "assessments.csv"
        await _record_history(current_user, "csv_assessments", filename)
        return _csv_response(rows, ["teacher", "teacher_id", "date", "overall_score", "element_scores", "observer"]), filename
    if export_type == "compliance":
        payload = await legacy._build_schedule_compliance_payload(current_user)
        filename = "observation-compliance.csv"
        await _record_history(current_user, "csv_compliance", filename)
        return _csv_response(payload["items"], ["teacher_name", "teacher_id", "required_observations", "completed", "planned", "remaining", "compliance_status", "next_observation"]), filename
    if export_type == "coaching":
        docs = await legacy.db.coaching_tasks.find({"teacher_id": {"$in": teacher_ids or ["__none__"]}}, {"_id": 0}).sort("created_at", -1).to_list(20000)
        rows = [
            {
                "teacher": doc.get("teacher_name"),
                "task": doc.get("title"),
                "status": doc.get("status"),
                "priority": doc.get("priority"),
                "due_date": _format_date(doc.get("due_date")),
                "completion_date": _format_date(doc.get("completed_at")),
                "completion_note": doc.get("completion_note") or doc.get("notes"),
            }
            for doc in docs
        ]
        filename = "coaching-tasks.csv"
        await _record_history(current_user, "csv_coaching", filename)
        return _csv_response(rows, ["teacher", "task", "status", "priority", "due_date", "completion_date", "completion_note"]), filename
    raise HTTPException(status_code=400, detail="Unsupported CSV export type")


async def generate_all_teacher_reports_zip(current_user: dict, cycle_year: Optional[int] = None) -> bytes:
    teachers = await _visible_teachers(current_user)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for teacher in teachers:
            teacher_id = teacher.get("id")
            if not teacher_id:
                continue
            pdf = await generate_teacher_report(teacher_id, current_user, cycle_year=cycle_year)
            safe_name = "".join(ch for ch in (teacher.get("name") or teacher_id) if ch.isalnum() or ch in {" ", "-", "_"}).strip().replace(" ", "-")
            archive.writestr(f"{safe_name or teacher_id}-report.pdf", pdf)
    await _record_history(current_user, "teacher_report_zip", "teacher-reports.zip", {"cycle_year": cycle_year, "count": len(teachers)})
    return buffer.getvalue()


async def list_report_history(current_user: dict) -> List[dict]:
    workspace_id = legacy._get_dashboard_workspace_id(current_user)
    return await legacy.db.report_history.find(
        {"workspace_id": workspace_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
