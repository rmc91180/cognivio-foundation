"""Seed repeatable pilot demo data.

This script only touches records marked with demo_data=true and the selected
demo_persona. It is intentionally separate from account deletion/lifecycle code.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

import bcrypt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.config import Settings  # noqa: E402

DEMO_PASSWORD = "DemoAccess2026!"
DEMO_COLLECTIONS = [
    "users",
    "organizations",
    "schools",
    "teachers",
    "training_cohorts",
    "trainee_placements",
    "videos",
    "video_comments",
    "video_audio_transcripts",
    "video_analysis_features",
    "assessments",
    "coaching_tasks",
    "coaching_task_reflections",
    "recognition_badges",
    "lesson_recognition_events",
    "teacher_face_profiles",
    "teacher_face_references",
    "gradebook_reminders",
    "observations",
    "observation_sessions",
    "schedules",
    "notifications",
    "dashboard_demo_patterns",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _hash_password() -> str:
    return bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _demo_doc(persona: str, **values: Any) -> Dict[str, Any]:
    return {
        **values,
        "demo_data": True,
        "demo_persona": persona,
    }


def _coach_assessment(persona: str, teacher: dict, observer_id: str, index: int, days_ago: int, *, with_audio: bool = False) -> Dict[str, Any]:
    reviewed_at = _now() - timedelta(days=days_ago)
    video_id = f"demo-{persona}-video-{teacher['id']}-{index}"
    assessment_id = f"demo-{persona}-assessment-{teacher['id']}-{index}"
    session_id = f"demo-{persona}-session-{teacher['id']}-{index}"
    summary = (
        f"You created a clear path for students to talk through their thinking in {teacher['subject']}. "
        "Keep naming the move you want students to use, then pause long enough for a few more voices to enter."
    )
    if index % 2:
        summary = (
            f"You kept the lesson moving with warm, specific prompts in {teacher['subject']}. "
            "Next time, choose one student response to press a little further so the class can hear the reasoning."
        )
    assessment = _demo_doc(
        persona,
        id=assessment_id,
        video_id=video_id,
        teacher_id=teacher["id"],
        user_id=observer_id,
        framework_type="danielson",
        element_scores=[],
        overall_score=0,
        summary=summary,
        recommendations=[
            "Ask one follow-up question that starts with 'What makes you say that?'",
            "Invite students to restate a classmate's idea before you add your own explanation.",
        ],
        observation_summary={
            "executive_summary": summary,
            "top_strengths": ["You gave students a clear reason to participate."],
            "growth_areas": ["Leave a little more wait time after the first answer."],
            "coaching_actions": [
                "Plan one discussion pause where students talk before you confirm the answer.",
                "Write one follow-up question in your lesson notes before class starts.",
            ],
        },
        analyzed_at=_iso(reviewed_at),
        recorded_at=_iso(reviewed_at - timedelta(hours=2)),
        subject=teacher["subject"],
    )
    video = _demo_doc(
        persona,
        id=video_id,
        filename=f"{teacher['name'].split()[0].lower()}-lesson-{index}.mp4",
        teacher_id=teacher["id"],
        uploaded_by=observer_id,
        workspace_id=teacher.get("organization_id") or teacher.get("school_id") or observer_id,
        organization_id=teacher.get("organization_id"),
        observation_session_id=session_id,
        status="completed",
        analysis_status="completed",
        privacy_status="completed",
        subject=teacher["subject"],
        recorded_at=assessment["recorded_at"],
        upload_date=assessment["analyzed_at"],
        audio_summary=(
            "Student voices carried a larger share of the discussion near the middle of the lesson."
            if with_audio
            else None
        ),
    )
    session = _demo_doc(
        persona,
        id=session_id,
        workspace_id=teacher.get("organization_id") or teacher.get("school_id") or observer_id,
        observer_id=observer_id,
        teacher_id=teacher["id"],
        teacher_name=teacher["name"],
        focus_elements=["Student discussion", "Wait time"],
        focus_note="Watch for how students build on one another before the adult voice steps back in.",
        personal_goals=[],
        status="analysis_complete",
        linked_video_id=video_id,
        linked_assessment_id=assessment_id,
        created_at=_iso(reviewed_at - timedelta(hours=3)),
        updated_at=_iso(reviewed_at),
    )
    comments: List[Dict[str, Any]] = []
    transcript = None
    features = None
    if with_audio:
        comments = [
            _demo_doc(
                persona,
                id=f"{video_id}-comment-private",
                video_id=video_id,
                workspace_id=video["workspace_id"],
                organization_id=video.get("organization_id"),
                teacher_id=teacher["id"],
                observation_session_id=session_id,
                author_id=observer_id,
                author_name="Principal Sarah Chen" if persona == "k12" else "Dr. James Okonkwo",
                author_role="school_admin" if persona == "k12" else "training_admin",
                timestamp_seconds=42.0,
                focus_area_id="Student discussion",
                focus_area_label="Student discussion",
                body="Private note: follow up on how the first student idea opened the door for two more voices.",
                visibility="observer_private",
                is_private=True,
                thread_parent_id=None,
                created_at=_iso(reviewed_at - timedelta(minutes=25)),
                updated_at=_iso(reviewed_at - timedelta(minutes=25)),
            ),
            _demo_doc(
                persona,
                id=f"{video_id}-comment-shared",
                video_id=video_id,
                workspace_id=video["workspace_id"],
                organization_id=video.get("organization_id"),
                teacher_id=teacher["id"],
                observation_session_id=session_id,
                author_id=observer_id,
                author_name="Principal Sarah Chen" if persona == "k12" else "Dr. James Okonkwo",
                author_role="school_admin" if persona == "k12" else "training_admin",
                timestamp_seconds=96.0,
                focus_area_id="Wait time",
                focus_area_label="Wait time",
                body="Moment to revisit: you paused after the first answer, and that gave another student room to add their reasoning.",
                visibility="shared_with_teacher",
                is_private=False,
                thread_parent_id=None,
                created_at=_iso(reviewed_at - timedelta(minutes=20)),
                updated_at=_iso(reviewed_at - timedelta(minutes=20)),
            ),
            _demo_doc(
                persona,
                id=f"{video_id}-comment-admin",
                video_id=video_id,
                workspace_id=video["workspace_id"],
                organization_id=video.get("organization_id"),
                teacher_id=teacher["id"],
                observation_session_id=session_id,
                author_id=observer_id,
                author_name="Principal Sarah Chen" if persona == "k12" else "Dr. James Okonkwo",
                author_role="school_admin" if persona == "k12" else "training_admin",
                timestamp_seconds=154.0,
                focus_area_id="Student discussion",
                focus_area_label="Student discussion",
                body="Use this moment in the next coaching conversation: the prompt was clear, and one next move is inviting students to respond to each other before you clarify.",
                visibility="admin_only",
                is_private=False,
                thread_parent_id=None,
                created_at=_iso(reviewed_at - timedelta(minutes=15)),
                updated_at=_iso(reviewed_at - timedelta(minutes=15)),
            ),
        ]
        transcript = _demo_doc(
            persona,
            id=f"{video_id}-transcript",
            video_id=video_id,
            transcript_status="completed",
            model="demo-transcript",
            language="en",
            text="What makes you say that? I agree because the pattern repeats. Say more about the pattern.",
            segments=[
                {"start_sec": 34.0, "end_sec": 48.0, "speaker": "teacher", "text": "What makes you say that?"},
                {"start_sec": 49.0, "end_sec": 68.0, "speaker": "student", "text": "I agree because the pattern repeats."},
                {"start_sec": 90.0, "end_sec": 105.0, "speaker": "teacher", "text": "Say more about the pattern."},
            ],
            created_at=_iso(reviewed_at),
        )
        features = _demo_doc(
            persona,
            id=f"{video_id}-audio-features",
            video_id=video_id,
            teacher_id=teacher["id"],
            teacher_talk_ratio=0.58,
            turn_count=9,
            question_count=4,
            open_question_count=2,
            directive_density=0.12,
            pause_density=0.18,
            transition_markers=2,
            modalities_used=["audio"],
            created_at=_iso(reviewed_at),
        )
    return {
        "video": video,
        "assessment": assessment,
        "observation_session": session,
        "video_comments": comments,
        "video_audio_transcript": transcript,
        "video_analysis_features": features,
    }


def build_demo_documents(persona: str) -> Dict[str, List[Dict[str, Any]]]:
    if persona not in {"k12", "training"}:
        raise ValueError("persona must be k12 or training")

    password = _hash_password()
    created_at = _iso(_now())
    docs: Dict[str, List[Dict[str, Any]]] = {collection: [] for collection in DEMO_COLLECTIONS}

    if persona == "k12":
        org_id = "demo-k12-org-westbrook"
        school_id = "demo-k12-school-westbrook"
        admin_id = "demo-k12-principal-sarah-chen"
        docs["organizations"].append(_demo_doc("k12", id=org_id, name="Westbrook Elementary", organization_type="school", status="active", created_at=created_at))
        docs["schools"].append(_demo_doc("k12", id=school_id, name="Westbrook Elementary", organization_id=org_id, user_id=admin_id, created_at=created_at))
        docs["users"].append(_demo_doc("k12", id=admin_id, email="principal.sarah.chen@demo.cognivio.local", name="Principal Sarah Chen", password=password, role="admin", tenant_role="school_admin", approval_status="approved", is_active=True, organization_id=org_id, organization_name="Westbrook Elementary", school_id=school_id, school_name="Westbrook Elementary", created_at=created_at))
        teacher_specs = [
            ("Maya Patel", "Grade 4 Math", "4"),
            ("Jordan Ellis", "Grade 5 Literacy", "5"),
            ("Ari Cohen", "Grade 3 Science", "3"),
            ("Nina Brooks", "Grade 2 Reading", "2"),
            ("Luis Ramirez", "Grade 5 Social Studies", "5"),
            ("Hannah Kim", "Grade 1 Math", "1"),
            ("Owen Miller", "Grade 4 Writing", "4"),
            ("Leah Stein", "Grade 3 Math", "3"),
        ]
        teacher_ids = []
        for idx, (name, subject, grade) in enumerate(teacher_specs):
            teacher_id = f"demo-k12-teacher-{idx + 1}"
            teacher_ids.append(teacher_id)
            email = f"{name.lower().replace(' ', '.')}@demo.cognivio.local"
            docs["teachers"].append(_demo_doc("k12", id=teacher_id, name=name, email=email, subject=subject, grade_level=grade, school_id=school_id, organization_id=org_id, created_by=admin_id, manager_user_id=admin_id, created_at=created_at, at_risk=idx in {2, 5}))
            if idx == 0:
                docs["teachers"][-1].update(subjects=[subject, "Small-group discussion"], primary_subject=subject, class_section="Period 2")
                docs["users"].append(_demo_doc("k12", id="demo-k12-teacher-login", email=email, name=name, password=password, role="teacher", tenant_role="teacher", approval_status="approved", is_active=True, teacher_id=teacher_id, organization_id=org_id, organization_name="Westbrook Elementary", school_id=school_id, school_name="Westbrook Elementary", manager_user_id=admin_id, manager_name="Principal Sarah Chen", created_at=created_at))
                profile_id = f"demo-k12-{teacher_id}-privacy-profile"
                docs["teacher_face_profiles"].append(_demo_doc("k12", id=profile_id, teacher_id=teacher_id, user_id="demo-k12-teacher-login", workspace_id=org_id, status="active", profile_version=1, reference_count=1, quality_score=1.0, embedding_model="opencv-sface", embedding_version="demo-contract-v1", created_at=created_at, updated_at=created_at, last_enrolled_at=created_at, needs_refresh=False, warnings=[]))
                docs["teacher_face_references"].append(_demo_doc("k12", id=f"demo-k12-{teacher_id}-reference-1", teacher_id=teacher_id, user_id="demo-k12-teacher-login", workspace_id=org_id, profile_id=profile_id, reference_type="image", filename="demo-teacher-reference.jpg", file_path=None, file_url=None, s3_key=f"demo/privacy/{teacher_id}/reference-1.jpg", status="ready", embedding=[], quality_checks={"validation_mode": "demo_metadata"}, created_at=created_at, updated_at=created_at, retention_expires_at=_iso(_now() + timedelta(days=365))))
                for reminder_idx, reminder_status in enumerate(["overdue", "due_soon", "completed"], start=1):
                    docs["gradebook_reminders"].append(_demo_doc("k12", id=f"demo-k12-{teacher_id}-gradebook-{reminder_idx}", teacher_id=teacher_id, workspace_id=org_id, title=f"Gradebook reminder {reminder_idx}", description="Review the latest class entries before your next coaching conversation.", status=reminder_status, due_at=_iso(_now() + timedelta(days=reminder_idx - 2)), href="/my-workspace?section=gradebook", created_at=created_at, updated_at=created_at))
            if idx < 3:
                lesson_docs = _coach_assessment("k12", docs["teachers"][-1], admin_id, idx + 1, idx + 1, with_audio=idx == 0)
                docs["videos"].append(lesson_docs["video"])
                docs["assessments"].append(lesson_docs["assessment"])
                docs["observation_sessions"].append(lesson_docs["observation_session"])
                docs["video_comments"].extend(lesson_docs["video_comments"])
                if lesson_docs["video_audio_transcript"]:
                    docs["video_audio_transcripts"].append(lesson_docs["video_audio_transcript"])
                if lesson_docs["video_analysis_features"]:
                    docs["video_analysis_features"].append(lesson_docs["video_analysis_features"])
                docs["observations"].append(_demo_doc("k12", id=f"demo-k12-observation-{idx + 1}", user_id=admin_id, teacher_id=teacher_id, video_id=lesson_docs["video"]["id"], admin_comment=lesson_docs["assessment"]["summary"], implementation_status="planned", created_at=lesson_docs["assessment"]["analyzed_at"], updated_at=None))
            elif idx == 3:
                docs["observation_sessions"].append(_demo_doc("k12", id="demo-k12-planned-observation-new-teacher", workspace_id=org_id, observer_id=admin_id, teacher_id=teacher_id, teacher_name=name, focus_elements=["Student discussion"], focus_note="Watch for one moment where students build on each other's thinking.", personal_goals=[], status="pending", created_at=created_at, updated_at=created_at))
        for idx, teacher_id in enumerate(teacher_ids[:5]):
            docs["coaching_tasks"].append(_demo_doc("k12", id=f"demo-k12-task-{idx + 1}", workspace_id=org_id, observer_id=admin_id, teacher_id=teacher_id, teacher_name=teacher_specs[idx][0], title="Try one deeper student discussion prompt", suggested_action="Choose one student answer and ask the class to build on it before you move on.", priority="medium", priority_rank=50, status="open", created_at=created_at, updated_at=None))
        docs["coaching_task_reflections"].append(_demo_doc("k12", id="demo-k12-teacher-login-reflection-1", task_id="demo-k12-task-1", teacher_id=teacher_ids[0], author_user_id="demo-k12-teacher-login", tried="I asked students to build on one answer.", happened="Two more students added their reasoning before I summarized.", text="Two more students added their reasoning before I summarized.", created_at=created_at, updated_at=None))
        for idx, teacher_id in enumerate(teacher_ids[5:7]):
            docs["coaching_tasks"].append(_demo_doc("k12", id=f"demo-k12-completed-task-{idx + 1}", workspace_id=org_id, observer_id=admin_id, teacher_id=teacher_id, teacher_name=teacher_specs[idx + 5][0], title="Add a quick partner rehearsal", suggested_action="Let students rehearse their answer with a partner before whole-group share.", priority="low", priority_rank=25, status="completed", created_at=created_at, updated_at=created_at, completed_at=created_at))
        for idx, teacher_id in enumerate(teacher_ids[:2]):
            docs["recognition_badges"].append(_demo_doc("k12", id=f"demo-k12-badge-{idx + 1}", badge_type="Strong Student Voice", status="awarded", video_id=f"demo-k12-video-{teacher_id}-{idx + 1}", teacher_id=teacher_id, awarded_for="Students had a clear invitation to explain their thinking.", awarded_at=created_at, awarded_by=admin_id))
        docs["dashboard_demo_patterns"].append(_demo_doc("k12", id="demo-k12-pattern-discussion", title="Student discussion is a common growth area this week.", affected_teachers_count=4, suggested_next_step="Plan one discussion-focused walkthrough block for the next grade-team meeting.", created_at=created_at))

    if persona == "training":
        org_id = "demo-training-org-metro"
        admin_id = "demo-training-admin-okonkwo"
        cohort_id = "demo-training-cohort-fall-2025"
        docs["organizations"].append(_demo_doc("training", id=org_id, name="Metro University Teacher Ed", organization_type="training", status="active", created_at=created_at))
        docs["users"].append(_demo_doc("training", id=admin_id, email="dr.james.okonkwo@demo.cognivio.local", name="Dr. James Okonkwo", password=password, role="admin", tenant_role="training_admin", approval_status="approved", is_active=True, organization_id=org_id, organization_name="Metro University Teacher Ed", organization_type="training", created_at=created_at))
        trainee_ids = []
        for idx in range(12):
            trainee_id = f"demo-training-trainee-{idx + 1}"
            trainee_ids.append(trainee_id)
            name = f"Trainee {idx + 1}"
            docs["teachers"].append(_demo_doc("training", id=trainee_id, name=name, email=f"trainee{idx + 1}@demo.cognivio.local", subject="Clinical Practice", grade_level="Residency", department="Teacher Education", organization_id=org_id, created_by=admin_id, manager_user_id=admin_id, placement_site=f"Metro Partner School {1 + (idx % 4)}", school_site=f"Metro Partner School {1 + (idx % 4)}", created_at=created_at))
            docs["trainee_placements"].append(_demo_doc("training", id=f"demo-placement-{idx + 1}", workspace_id=org_id, trainee_id=trainee_id, school_site=f"Metro Partner School {1 + (idx % 4)}", mentor_teacher=f"Mentor {idx + 1}", status="active", created_by=admin_id, created_at=created_at, updated_at=created_at))
            if idx < 5:
                if idx == 0:
                    docs["teachers"][-1].update(subjects=["Clinical Practice", "Small-group instruction"], primary_subject="Clinical Practice", class_section="Residency Seminar")
                    docs["users"].append(_demo_doc("training", id="demo-training-trainee-login", email=f"trainee{idx + 1}@demo.cognivio.local", name=name, password=password, role="teacher", tenant_role="teacher", approval_status="approved", is_active=True, teacher_id=trainee_id, organization_id=org_id, organization_name="Metro University Teacher Ed", organization_type="training", manager_user_id=admin_id, manager_name="Dr. James Okonkwo", created_at=created_at))
                    profile_id = f"demo-training-{trainee_id}-privacy-profile"
                    docs["teacher_face_profiles"].append(_demo_doc("training", id=profile_id, teacher_id=trainee_id, user_id="demo-training-trainee-login", workspace_id=org_id, status="active", profile_version=1, reference_count=1, quality_score=1.0, embedding_model="opencv-sface", embedding_version="demo-contract-v1", created_at=created_at, updated_at=created_at, last_enrolled_at=created_at, needs_refresh=False, warnings=[]))
                    docs["teacher_face_references"].append(_demo_doc("training", id=f"demo-training-{trainee_id}-reference-1", teacher_id=trainee_id, user_id="demo-training-trainee-login", workspace_id=org_id, profile_id=profile_id, reference_type="image", filename="demo-trainee-reference.jpg", file_path=None, file_url=None, s3_key=f"demo/privacy/{trainee_id}/reference-1.jpg", status="ready", embedding=[], quality_checks={"validation_mode": "demo_metadata"}, created_at=created_at, updated_at=created_at, retention_expires_at=_iso(_now() + timedelta(days=365))))
                    docs["gradebook_reminders"].append(_demo_doc("training", id=f"demo-training-{trainee_id}-gradebook-1", teacher_id=trainee_id, workspace_id=org_id, title="Gradebook reminder", description="Review the latest placement entries before your supervisor meeting.", status="due_soon", due_at=_iso(_now() + timedelta(days=2)), href="/my-workspace?section=gradebook", created_at=created_at, updated_at=created_at))
                lesson_docs = _coach_assessment("training", docs["teachers"][-1], admin_id, idx + 1, idx + 1, with_audio=idx == 0)
                docs["videos"].append(lesson_docs["video"])
                docs["assessments"].append(lesson_docs["assessment"])
                docs["observation_sessions"].append(lesson_docs["observation_session"])
                docs["video_comments"].extend(lesson_docs["video_comments"])
                if lesson_docs["video_audio_transcript"]:
                    docs["video_audio_transcripts"].append(lesson_docs["video_audio_transcript"])
                if lesson_docs["video_analysis_features"]:
                    docs["video_analysis_features"].append(lesson_docs["video_analysis_features"])
                docs["observations"].append(_demo_doc("training", id=f"demo-training-observation-{idx + 1}", user_id=admin_id, teacher_id=trainee_id, video_id=lesson_docs["video"]["id"], summary=lesson_docs["assessment"]["summary"], admin_comment=lesson_docs["assessment"]["summary"], implementation_status="planned", created_at=lesson_docs["assessment"]["analyzed_at"], updated_at=None))
            if idx < 3:
                scheduled = _now() + timedelta(days=idx + 1)
                docs["schedules"].append(_demo_doc("training", id=f"demo-training-schedule-{idx + 1}", teacher_id=trainee_id, course_name="Clinical observation", start_time=_iso(scheduled), recording_status="planned", location=f"Metro Partner School {1 + idx}", user_id=admin_id, created_at=created_at, updated_at=None))
        docs["training_cohorts"].append(_demo_doc("training", id=cohort_id, workspace_id=org_id, name="Fall 2025 Cohort", program_name="Metro University Teacher Ed", trainee_ids=trainee_ids, created_by=admin_id, created_at=created_at, updated_at=created_at))

    return {collection: rows for collection, rows in docs.items() if rows}


async def reset_demo_data_for_persona(db: Any, persona: str) -> Dict[str, Any]:
    personas = ["k12", "training"] if persona == "all" else [persona]
    if any(item not in {"k12", "training"} for item in personas):
        raise ValueError("persona must be k12, training, or all")

    totals = {
        "teachers_seeded": 0,
        "assessments_seeded": 0,
        "tasks_seeded": 0,
        "badges_seeded": 0,
        "reference_images_seeded": 0,
        "gradebook_reminders_seeded": 0,
    }
    deleted: Dict[str, int] = {}

    for selected in personas:
        for collection_name in DEMO_COLLECTIONS:
            collection = getattr(db, collection_name, None)
            if collection is None:
                continue
            result = await collection.delete_many({"demo_data": True, "demo_persona": selected})
            deleted[collection_name] = deleted.get(collection_name, 0) + result.deleted_count

        docs_by_collection = build_demo_documents(selected)
        for collection_name, docs in docs_by_collection.items():
            collection = getattr(db, collection_name, None)
            if docs and collection is not None:
                await collection.insert_many(docs)
        totals["teachers_seeded"] += len(docs_by_collection.get("teachers", []))
        totals["assessments_seeded"] += len(docs_by_collection.get("assessments", []))
        totals["tasks_seeded"] += len(docs_by_collection.get("coaching_tasks", []))
        totals["badges_seeded"] += len(docs_by_collection.get("recognition_badges", []))
        totals["reference_images_seeded"] += len(docs_by_collection.get("teacher_face_references", []))
        totals["gradebook_reminders_seeded"] += len(docs_by_collection.get("gradebook_reminders", []))

    return {
        "reset_at": _iso(_now()),
        "persona": persona,
        **totals,
        "deleted": deleted,
    }


async def _run_cli() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--persona", choices=["k12", "training", "all"], required=True)
    parser.add_argument("--force", action="store_true", help="Allow local/dev runs when DEMO_MODE is not true.")
    args = parser.parse_args()

    load_dotenv(ROOT_DIR / ".env")
    settings = Settings.from_env()
    demo_mode = os.getenv("DEMO_MODE", "false").strip().lower() == "true"
    environment = os.getenv("ENVIRONMENT", "development").strip().lower()
    if not demo_mode and not (args.force and environment in {"development", "local", "test"}):
        raise SystemExit("DEMO_MODE=true is required unless --force is used in local/dev.")

    client = AsyncIOMotorClient(settings.database.mongo_url)
    try:
        result = await reset_demo_data_for_persona(client[settings.database.db_name], args.persona)
        print(result)
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(_run_cli())
