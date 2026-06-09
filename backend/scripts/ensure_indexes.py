"""Idempotent MongoDB index definitions for Cognivio operational readiness.

The helper is intentionally small and dependency-light so startup code, tests,
and manual checks can all use the same critical index inventory.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, List, Sequence, Tuple


IndexKey = Tuple[str, int]


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    keys: Tuple[IndexKey, ...]
    name: str
    unique: bool = False
    sparse: bool = False
    expire_after_seconds: int | None = None
    # A2: partialFilterExpression support. Required for a UNIQUE COMPOUND index
    # that must skip legacy docs missing one of the keys — `sparse` is wrong for
    # a compound key (it only skips when ALL keyed fields are absent), so a
    # partial filter on field existence is the correct tool.
    partial_filter: dict[str, Any] | None = None

    def create_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"name": self.name}
        if self.unique:
            kwargs["unique"] = True
        if self.sparse:
            kwargs["sparse"] = True
        if self.expire_after_seconds is not None:
            kwargs["expireAfterSeconds"] = self.expire_after_seconds
        if self.partial_filter is not None:
            kwargs["partialFilterExpression"] = dict(self.partial_filter)
        return kwargs


def _spec(
    collection: str,
    keys: Sequence[IndexKey],
    name: str,
    *,
    unique: bool = False,
    sparse: bool = False,
    expire_after_seconds: int | None = None,
    partial_filter: dict[str, Any] | None = None,
) -> IndexSpec:
    return IndexSpec(
        collection=collection,
        keys=tuple((field, int(direction)) for field, direction in keys),
        name=name,
        unique=unique,
        sparse=sparse,
        expire_after_seconds=expire_after_seconds,
        partial_filter=partial_filter,
    )


INDEX_SPECS: Tuple[IndexSpec, ...] = (
    _spec("users", [("email", 1)], "users_email_lookup"),
    _spec("users", [("approval_status", 1), ("created_at", -1)], "users_approval_status_created"),
    _spec("users", [("tenant_role", 1), ("tenant_status", 1), ("created_at", -1)], "users_tenant_role_status_created"),
    _spec("users", [("organization_id", 1), ("tenant_role", 1), ("created_at", -1)], "users_org_role_created"),
    _spec("users", [("school_id", 1), ("tenant_role", 1), ("created_at", -1)], "users_school_role_created"),
    _spec("users", [("deleted_at", 1), ("approval_deleted", 1)], "users_deleted_lifecycle"),
    _spec("user_sessions", [("user_id", 1), ("created_at", -1)], "sessions_user_created"),
    _spec("user_sessions", [("session_id", 1)], "sessions_session_id", unique=True, sparse=True),
    _spec("user_sessions", [("expires_at", 1)], "sessions_expires_at"),
    _spec("user_sessions", [("revoked_at", 1), ("created_at", -1)], "sessions_revoked_created"),
    _spec("auth_event_log", [("created_at", -1)], "auth_events_created"),
    _spec("auth_event_log", [("email", 1), ("created_at", -1)], "auth_events_email_created"),
    _spec("auth_event_log", [("user_id", 1), ("created_at", -1)], "auth_events_user_created"),
    _spec("auth_event_log", [("event_type", 1), ("created_at", -1)], "auth_events_type_created"),
    _spec("organizations", [("organization_type", 1), ("status", 1), ("name", 1)], "organizations_type_status_name"),
    _spec("schools", [("organization_id", 1), ("name", 1)], "schools_org_name"),
    _spec("teachers", [("organization_id", 1), ("school_id", 1), ("created_at", -1)], "teachers_tenant_created"),
    _spec("teachers", [("email", 1), ("organization_id", 1)], "teachers_email_org"),
    _spec("videos", [("organization_id", 1), ("school_id", 1), ("workspace_id", 1), ("upload_date", -1)], "videos_tenant_upload"),
    _spec("videos", [("teacher_id", 1), ("upload_date", -1)], "videos_teacher_upload"),
    _spec("videos", [("uploaded_by", 1), ("upload_date", -1)], "videos_uploader_upload"),
    _spec("videos", [("demo_data", 1), ("organization_id", 1), ("upload_date", -1)], "videos_demo_org_upload"),
    _spec("videos", [("status", 1), ("upload_date", -1)], "videos_status_upload"),
    _spec("videos", [("privacy_status", 1), ("upload_date", -1)], "videos_privacy_upload"),
    _spec("videos", [("raw_retention_expires_at", 1)], "videos_raw_retention_expires"),
    _spec("assessments", [("video_id", 1)], "assessments_video"),
    # A2 GAP 3c: structural idempotency for analysis completion. UNIQUE on
    # (video_id, analysis_run_id) so the same analysis run can never produce two
    # assessments; partial filter excludes legacy docs without analysis_run_id.
    _spec(
        "assessments",
        [("video_id", 1), ("analysis_run_id", 1)],
        "assessments_video_run_idempotent",
        unique=True,
        partial_filter={"analysis_run_id": {"$exists": True}},
    ),
    _spec("assessments", [("teacher_id", 1), ("analyzed_at", -1)], "assessments_teacher_analyzed"),
    _spec("assessments", [("organization_id", 1), ("school_id", 1), ("analyzed_at", -1)], "assessments_tenant_analyzed"),
    _spec("assessments", [("user_id", 1), ("feedback_release_status", 1), ("analyzed_at", -1)], "assessments_user_release_analyzed"),
    _spec("assessment_report_feedback", [("assessment_id", 1), ("user_id", 1), ("target_type", 1), ("target_id", 1)], "assessment_feedback_unique_target", unique=True),
    _spec("assessment_report_feedback", [("assessment_id", 1), ("updated_at", -1)], "assessment_feedback_assessment_updated"),
    _spec("action_plans", [("teacher_id", 1), ("user_id", 1)], "action_plans_teacher_user", unique=True),
    _spec("action_plan_history", [("teacher_id", 1), ("plan_owner_id", 1), ("saved_at", -1)], "action_plan_history_teacher_owner_saved"),
    _spec("summary_reflections", [("teacher_id", 1), ("user_id", 1)], "summary_reflections_teacher_user", unique=True),
    _spec("summary_reflection_history", [("teacher_id", 1), ("author_user_id", 1), ("saved_at", -1)], "summary_reflection_history_teacher_author_saved"),
    _spec("published_conference_agendas", [("teacher_id", 1), ("published_at", -1)], "published_agendas_teacher_published"),
    _spec("observations", [("video_id", 1), ("created_at", -1)], "observations_video_created"),
    _spec("video_comments", [("video_id", 1), ("timestamp_seconds", 1), ("created_at", 1)], "comments_video_timestamp_created"),
    _spec("video_comments", [("video_id", 1), ("thread_parent_id", 1), ("created_at", 1)], "comments_video_thread_created"),
    _spec("video_comments", [("workspace_id", 1), ("created_at", -1)], "comments_workspace_created"),
    _spec("video_comments", [("author_id", 1), ("created_at", -1)], "comments_author_created"),
    _spec("video_audio_transcripts", [("video_id", 1), ("created_at", -1)], "transcripts_video_created"),
    _spec("video_audio_transcripts", [("retention_expires_at", 1)], "transcripts_retention_expires"),
    _spec("video_analysis_features", [("video_id", 1)], "analysis_features_video", unique=True),
    _spec("video_analysis_moments", [("video_id", 1), ("created_at", -1)], "analysis_moments_video_created"),
    _spec("reports", [("organization_id", 1), ("workspace_id", 1), ("created_at", -1)], "reports_tenant_created"),
    _spec("reports", [("teacher_id", 1), ("created_at", -1)], "reports_teacher_created"),
    _spec("teacher_face_profiles", [("teacher_id", 1), ("status", 1)], "face_profiles_teacher_status"),
    _spec("teacher_face_references", [("teacher_id", 1), ("profile_id", 1)], "face_refs_teacher_profile"),
    _spec("teacher_face_references", [("retention_expires_at", 1)], "face_refs_retention_expires"),
    _spec("consent_records", [("workspace_id", 1), ("user_id", 1), ("consent_type", 1), ("created_at", -1)], "consent_workspace_user_type_created"),
    _spec("framework_selections", [("workspace_id", 1), ("user_id", 1), ("updated_at", -1)], "framework_selection_workspace_user"),
    _spec("custom_frameworks", [("workspace_id", 1), ("created_by", 1), ("created_at", -1)], "custom_frameworks_workspace_creator"),
    _spec("coaching_tasks", [("teacher_id", 1), ("status", 1), ("due_date", 1)], "coaching_tasks_teacher_status_due"),
    _spec("coaching_tasks", [("workspace_id", 1), ("status", 1), ("priority_rank", -1)], "coaching_tasks_workspace_status_priority"),
    _spec("coaching_tasks", [("assessment_id", 1), ("teacher_id", 1), ("element_id", 1)], "coaching_tasks_assessment_teacher_element", unique=True),
    _spec("coaching_task_reflections", [("teacher_id", 1), ("created_at", -1)], "coaching_reflections_teacher_created"),
    _spec("recognition_badges", [("teacher_id", 1), ("awarded_at", -1)], "recognition_badges_teacher_awarded"),
    _spec("recognition_badges", [("video_id", 1), ("status", 1)], "recognition_badges_video_status"),
    _spec("lesson_recognition_events", [("teacher_id", 1), ("updated_at", -1)], "recognition_events_teacher_updated"),
    _spec("lesson_recognition_events", [("video_id", 1), ("recognition_status", 1)], "recognition_events_video_status"),
    _spec("recognition_audit_events", [("target_type", 1), ("target_id", 1), ("created_at", -1)], "recognition_audit_target_created"),
    _spec("gradebook_reminders", [("teacher_id", 1), ("due_at", 1)], "gradebook_reminders_teacher_due"),
    _spec("observation_sessions", [("observer_id", 1), ("scheduled_date", 1)], "observation_sessions_observer_scheduled"),
    _spec("observation_sessions", [("teacher_id", 1), ("scheduled_date", -1)], "observation_sessions_teacher_scheduled"),
    _spec("observation_sessions", [("status", 1), ("scheduled_date", 1)], "observation_sessions_status_scheduled"),
    _spec("observation_sessions", [("linked_video_id", 1)], "observation_sessions_linked_video"),
    _spec("observer_goals", [("observer_id", 1), ("achieved", 1), ("created_at", -1)], "observer_goals_observer_achieved_created"),
    _spec("observer_goals", [("workspace_id", 1), ("goal_type", 1)], "observer_goals_workspace_type"),
    _spec("training_cohorts", [("workspace_id", 1), ("created_at", -1)], "training_cohorts_workspace_created"),
    _spec("trainee_placements", [("trainee_id", 1), ("start_date", -1)], "trainee_placements_trainee_start"),
    _spec("trainee_placements", [("workspace_id", 1), ("status", 1)], "trainee_placements_workspace_status"),
    _spec("master_admin_audit_events", [("created_at", -1)], "master_audit_created"),
    _spec("master_admin_audit_events", [("actor_user_id", 1), ("created_at", -1)], "master_audit_actor_created"),
    _spec("master_admin_audit_events", [("target_type", 1), ("target_id", 1), ("created_at", -1)], "master_audit_target_created"),
    _spec("privacy_audit_events", [("target_type", 1), ("target_id", 1), ("created_at", -1)], "privacy_audit_target_created"),
    _spec("dashboard_intelligence_cache", [("workspace_id", 1)], "dashboard_cache_workspace", unique=True),
    _spec("dashboard_intelligence_cache", [("expires_at", 1)], "dashboard_cache_expires"),
    _spec("web_vitals", [("created_at", -1)], "web_vitals_created"),
    _spec("worker_heartbeats", [("worker_label", 1)], "worker_heartbeats_label", unique=True),
    _spec("video_processing_jobs", [("video_id", 1)], "video_processing_jobs_video", unique=True),
    _spec("video_processing_jobs", [("status", 1), ("updated_at", -1)], "video_processing_jobs_status_updated"),
    _spec("video_transcode_jobs", [("video_id", 1)], "video_transcode_jobs_video", unique=True),
    _spec("video_transcode_jobs", [("status", 1), ("updated_at", -1)], "video_transcode_jobs_status_updated"),
    _spec("video_privacy_jobs", [("video_id", 1)], "video_privacy_jobs_video", unique=True),
    _spec("video_privacy_jobs", [("status", 1), ("updated_at", -1)], "video_privacy_jobs_status_updated"),
    _spec("video_sampling_manifests", [("video_id", 1), ("strategy_version", 1)], "sampling_manifests_video_strategy", unique=True),
    _spec("processing_incidents", [("state", 1), ("severity", 1), ("last_seen_at", -1)], "processing_incidents_state_severity_seen"),
    _spec("processing_incidents", [("video_id", 1), ("incident_type", 1)], "processing_incidents_video_type", unique=True),
    _spec("feedback_review_queue", [("status", 1), ("created_at", -1)], "feedback_queue_status_created"),
    _spec("feedback_review_queue", [("assessment_id", 1), ("status", 1)], "feedback_queue_assessment_status"),
    _spec("feedback_review_queue", [("owner_user_id", 1), ("status", 1), ("created_at", -1)], "feedback_queue_owner_status_created"),
    _spec("feedback_review_queue", [("owner_user_id", 1), ("resolved_at", -1)], "feedback_queue_owner_resolved"),
    _spec("exemplar_submissions", [("submission_status", 1), ("submitted_at", -1)], "exemplar_submissions_status_submitted"),
    _spec("exemplar_submissions", [("teacher_id", 1), ("video_id", 1)], "exemplar_submissions_teacher_video"),
    _spec("exemplar_library_items", [("status", 1), ("published_at", -1)], "exemplar_library_status_published"),
    _spec("share_assets", [("teacher_id", 1), ("created_at", -1)], "share_assets_teacher_created"),
)


def expected_index_summary() -> dict[str, Any]:
    collections = sorted({spec.collection for spec in INDEX_SPECS})
    return {
        "collections": len(collections),
        "expected_indexes": len(INDEX_SPECS),
        "collection_names": collections,
    }


async def ensure_indexes(db: Any, *, logger: Any = None, specs: Iterable[IndexSpec] = INDEX_SPECS) -> dict[str, Any]:
    created = 0
    skipped = 0
    failed: List[dict[str, str]] = []
    for spec in specs:
        collection = db[spec.collection] if hasattr(db, "__getitem__") else getattr(db, spec.collection)
        try:
            await collection.create_index(list(spec.keys), **spec.create_kwargs())
            created += 1
        except Exception as exc:  # pragma: no cover - exercised through server startup fallback
            skipped += 1
            error_type = exc.__class__.__name__
            failed.append({"collection": spec.collection, "index": spec.name, "error_type": error_type})
            if logger is not None:
                logger.warning("Skipping index creation for %s.%s due to %s", spec.collection, spec.name, error_type)
    return {"attempted": created + skipped, "created_or_existing": created, "skipped": skipped, "failed": failed}
