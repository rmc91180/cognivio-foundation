from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import List, Set

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_list(name: str) -> List[str]:
    raw = os.getenv(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def _env_set(name: str) -> Set[str]:
    return {item.strip().lower() for item in _env_list(name) if item.strip()}


@dataclass(frozen=True)
class DatabaseSettings:
    mongo_url: str
    db_name: str


@dataclass(frozen=True)
class AuthSettings:
    jwt_secret: str
    jwt_algorithm: str
    jwt_expiration_hours: int
    session_cookie_name: str
    csrf_cookie_name: str
    cookie_secure: bool
    session_cookie_max_age_seconds: int
    session_cookie_samesite: str
    admin_emails: Set[str]
    super_admin_emails: Set[str]
    master_admin_email: str
    master_admin_password: str
    master_admin_name: str
    access_approval_required: bool
    access_approval_notify_email: str
    cors_origins: List[str]

    def admin_email_set(self) -> Set[str]:
        return set(self.admin_emails)

    def super_admin_email_set(self) -> Set[str]:
        return set(self.super_admin_emails)


@dataclass(frozen=True)
class EmailSettings:
    resend_api_key: str
    resend_from_email: str
    resend_api_base_url: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from_email: str
    smtp_use_tls: bool


@dataclass(frozen=True)
class OperationsSettings:
    demo_mode: bool
    railway_environment_name: str
    adherence_weight: float
    leadership_insights_cache_ttl_seconds: int
    recognition_five_star_score_min: float
    feedback_governance_queue_age_warning_minutes: int
    feedback_governance_queue_age_blocking_minutes: int


@dataclass(frozen=True)
class PrivacySettings:
    privacy_require_profile: bool
    privacy_profile_min_references: int
    privacy_profile_max_references: int
    privacy_manual_review_enabled: bool
    privacy_allow_blur_all_fallback: bool
    privacy_allow_degraded_runtime: bool
    privacy_worker_count: int
    privacy_max_retries: int
    privacy_teacher_match_threshold: float
    privacy_ambiguous_match_threshold: float
    privacy_raw_video_retention_days: int
    privacy_profile_image_retention_days: int
    privacy_purge_interval_minutes: int
    # PR C9.2: reference materialization controls
    privacy_reference_url_fetch_enabled: bool = False
    privacy_reference_url_fetch_timeout_seconds: int = 20
    privacy_reference_max_bytes: int = 10 * 1024 * 1024
    privacy_reference_url_allowed_hosts: str = ""

    @property
    def require_profile(self) -> bool:
        return self.privacy_require_profile

    @property
    def profile_min_references(self) -> int:
        return self.privacy_profile_min_references

    @property
    def profile_max_references(self) -> int:
        return self.privacy_profile_max_references

    @property
    def manual_review_enabled(self) -> bool:
        return self.privacy_manual_review_enabled

    @property
    def allow_blur_all_fallback(self) -> bool:
        return self.privacy_allow_blur_all_fallback

    @property
    def allow_degraded_runtime(self) -> bool:
        return self.privacy_allow_degraded_runtime

    @property
    def worker_count(self) -> int:
        return self.privacy_worker_count

    @property
    def max_retries(self) -> int:
        return self.privacy_max_retries

    @property
    def teacher_match_threshold(self) -> float:
        return self.privacy_teacher_match_threshold

    @property
    def ambiguous_match_threshold(self) -> float:
        return self.privacy_ambiguous_match_threshold

    @property
    def raw_video_retention_days(self) -> int:
        return self.privacy_raw_video_retention_days

    @property
    def profile_image_retention_days(self) -> int:
        return self.privacy_profile_image_retention_days

    @property
    def purge_interval_minutes(self) -> int:
        return self.privacy_purge_interval_minutes


@dataclass(frozen=True)
class VideoSettings:
    max_video_bytes: int
    video_worker_count: int
    video_transcode_pipeline_enabled: bool
    video_transcode_profile: str
    video_transcode_worker_count: int
    video_transcode_raw_cleanup_enabled: bool
    video_transcode_raw_retention_hours: int
    workspace_video_quota: int
    cleanup_video_source_after_analysis: bool
    # PR C9.1: compression-decision controls
    video_transcode_enabled: bool = False
    video_transcode_min_bytes: int = 25 * 1024 * 1024
    video_upload_timeout_ms: int = 5 * 60 * 1000

    @property
    def max_upload_bytes(self) -> int:
        return self.max_video_bytes

    @property
    def worker_count(self) -> int:
        return self.video_worker_count

    @property
    def transcode_pipeline_enabled(self) -> bool:
        return self.video_transcode_pipeline_enabled

    @property
    def transcode_profile(self) -> str:
        return self.video_transcode_profile

    @property
    def transcode_worker_count(self) -> int:
        return self.video_transcode_worker_count

    @property
    def transcode_raw_cleanup_enabled(self) -> bool:
        return self.video_transcode_raw_cleanup_enabled

    @property
    def transcode_raw_retention_hours(self) -> int:
        return self.video_transcode_raw_retention_hours


@dataclass(frozen=True)
class AISettings:
    openai_api_key: str
    openai_vision_model: str
    emergent_llm_key: str

    video_analysis_max_frames: int
    video_analysis_frame_scan_fps: int
    video_analysis_min_frame_gap_sec: int
    video_analysis_enable_ocr_signals: bool
    video_analysis_window_sec: int
    video_analysis_max_moments: int

    smart_frame_selection_enabled: bool
    smart_frame_selection_version: str
    smart_moment_sampling_enabled: bool
    smart_moment_sampling_version: str

    audio_analysis_enabled: bool
    audio_transcription_enabled: bool
    audio_features_enabled: bool
    audio_transcription_model: str
    audio_transcription_language: str
    audio_transcription_max_seconds: int
    audio_transcript_retention_days: int
    audio_allow_student_voice_processing: bool

    paid_analysis_enabled: bool
    paid_analysis_allowlist_emails: Set[str]

    openai_analysis_input_cost_per_million_usd: float
    openai_analysis_output_cost_per_million_usd: float

    master_observer_pipeline_enabled: bool
    master_observer_require_voice_gate_pass: bool
    voice_gate_release_enforcement_enabled: bool
    voice_gate_human_escalation_enabled: bool
    voice_gate_regen_max_attempts: int


@dataclass(frozen=True)
class StorageSettings:
    upload_dir: Path
    backend_public_base_url: str
    frontend_url: str
    s3_bucket: str
    s3_region: str
    s3_endpoint: str
    s3_public_base_url: str
    s3_presigned_url_expires_seconds: int
    aws_access_key_id: str
    aws_secret_access_key: str


@dataclass(frozen=True)
class Settings:
    database: DatabaseSettings
    auth: AuthSettings
    email: EmailSettings
    operations: OperationsSettings
    privacy: PrivacySettings
    video: VideoSettings
    ai: AISettings
    storage: StorageSettings
    cors_origins: List[str]
    environment: str

    @classmethod
    def from_env(cls) -> "Settings":
        cors_origins = _env_list("CORS_ORIGINS")
        railway_environment_name = os.getenv("RAILWAY_ENVIRONMENT_NAME", "")
        environment = os.getenv("ENVIRONMENT", railway_environment_name or "development")

        backend_public_base_url = os.getenv("BACKEND_PUBLIC_BASE_URL", "")
        frontend_url = os.getenv("FRONTEND_URL", "")
        upload_dir = Path(os.getenv("UPLOAD_DIR", str(ROOT_DIR / "uploads")))

        return cls(
            database=DatabaseSettings(
                mongo_url=os.getenv("MONGO_URL", "mongodb://localhost:27017"),
                db_name=os.getenv("DB_NAME", "cognivio"),
            ),
            auth=AuthSettings(
                jwt_secret=os.getenv("JWT_SECRET", ""),
                jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
                jwt_expiration_hours=_env_int("JWT_EXPIRATION_HOURS", 24),
                session_cookie_name=os.getenv("SESSION_COOKIE_NAME", "cognivio_session"),
                csrf_cookie_name=os.getenv("CSRF_COOKIE_NAME", "cognivio_csrf"),
                cookie_secure=_env_bool("COOKIE_SECURE", False),
                session_cookie_max_age_seconds=_env_int(
                    "SESSION_COOKIE_MAX_AGE_SECONDS",
                    60 * 60 * 24,
                ),
                session_cookie_samesite=os.getenv("SESSION_COOKIE_SAMESITE", "lax"),
                admin_emails=_env_set("ADMIN_EMAILS"),
                super_admin_emails=_env_set("SUPER_ADMIN_EMAILS"),
                master_admin_email=os.getenv("MASTER_ADMIN_EMAIL", ""),
                master_admin_password=os.getenv("MASTER_ADMIN_PASSWORD", ""),
                master_admin_name=os.getenv("MASTER_ADMIN_NAME", "Cognivio Master Admin"),
                access_approval_required=_env_bool("ACCESS_APPROVAL_REQUIRED", True),
                access_approval_notify_email=os.getenv("ACCESS_APPROVAL_NOTIFY_EMAIL", ""),
                cors_origins=cors_origins,
            ),
            email=EmailSettings(
                resend_api_key=os.getenv("RESEND_API_KEY", ""),
                resend_from_email=os.getenv("RESEND_FROM_EMAIL", ""),
                resend_api_base_url=os.getenv("RESEND_API_BASE_URL", "https://api.resend.com"),
                smtp_host=os.getenv("SMTP_HOST", ""),
                smtp_port=_env_int("SMTP_PORT", 587),
                smtp_username=os.getenv("SMTP_USERNAME", ""),
                smtp_password=os.getenv("SMTP_PASSWORD", ""),
                smtp_from_email=os.getenv("SMTP_FROM_EMAIL", ""),
                smtp_use_tls=_env_bool("SMTP_USE_TLS", True),
            ),
            operations=OperationsSettings(
                demo_mode=_env_bool("DEMO_MODE", False),
                railway_environment_name=railway_environment_name,
                adherence_weight=_env_float("ADHERENCE_WEIGHT", 0.15),
                leadership_insights_cache_ttl_seconds=_env_int(
                    "LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS",
                    1800,
                ),
                recognition_five_star_score_min=_env_float("RECOGNITION_FIVE_STAR_SCORE_MIN", 9.0),
                feedback_governance_queue_age_warning_minutes=_env_int(
                    "FEEDBACK_GOVERNANCE_QUEUE_AGE_WARNING_MINUTES",
                    60,
                ),
                feedback_governance_queue_age_blocking_minutes=_env_int(
                    "FEEDBACK_GOVERNANCE_QUEUE_AGE_BLOCKING_MINUTES",
                    240,
                ),
            ),
            privacy=PrivacySettings(
                privacy_require_profile=_env_bool("PRIVACY_REQUIRE_PROFILE", True),
                privacy_profile_min_references=_env_int("PRIVACY_PROFILE_MIN_REFERENCES", 4),
                privacy_profile_max_references=_env_int("PRIVACY_PROFILE_MAX_REFERENCES", 5),
                privacy_manual_review_enabled=_env_bool("PRIVACY_MANUAL_REVIEW_ENABLED", True),
                privacy_allow_blur_all_fallback=_env_bool("PRIVACY_ALLOW_BLUR_ALL_FALLBACK", True),
                privacy_allow_degraded_runtime=_env_bool("PRIVACY_ALLOW_DEGRADED_RUNTIME", False),
                privacy_worker_count=_env_int("PRIVACY_WORKER_COUNT", 1),
                privacy_max_retries=_env_int("PRIVACY_MAX_RETRIES", 3),
                privacy_teacher_match_threshold=_env_float("PRIVACY_TEACHER_MATCH_THRESHOLD", 0.9),
                privacy_ambiguous_match_threshold=_env_float("PRIVACY_AMBIGUOUS_MATCH_THRESHOLD", 0.8),
                privacy_raw_video_retention_days=_env_int("PRIVACY_RAW_VIDEO_RETENTION_DAYS", 30),
                privacy_profile_image_retention_days=_env_int("PRIVACY_PROFILE_IMAGE_RETENTION_DAYS", 30),
                privacy_purge_interval_minutes=_env_int("PRIVACY_PURGE_INTERVAL_MINUTES", 60),
                # PR C9.2: reference materialization. Defaults are safe — public
                # URL fetch stays off until the operator explicitly enables it.
                privacy_reference_url_fetch_enabled=_env_bool(
                    "PRIVACY_REFERENCE_URL_FETCH_ENABLED", False
                ),
                privacy_reference_url_fetch_timeout_seconds=_env_int(
                    "PRIVACY_REFERENCE_URL_FETCH_TIMEOUT_SECONDS", 20
                ),
                privacy_reference_max_bytes=_env_int(
                    "PRIVACY_REFERENCE_MAX_BYTES", 10 * 1024 * 1024
                ),
                privacy_reference_url_allowed_hosts=os.getenv(
                    "PRIVACY_REFERENCE_URL_ALLOWED_HOSTS", ""
                ),
            ),
            video=VideoSettings(
                max_video_bytes=_env_int("VIDEO_MAX_UPLOAD_BYTES", 500 * 1024 * 1024),
                video_worker_count=_env_int("VIDEO_WORKER_COUNT", 1),
                video_transcode_pipeline_enabled=_env_bool("VIDEO_TRANSCODE_PIPELINE_ENABLED", False),
                video_transcode_profile=os.getenv("VIDEO_TRANSCODE_PROFILE", "analysis_master_v1"),
                video_transcode_worker_count=_env_int("VIDEO_TRANSCODE_WORKER_COUNT", 1),
                video_transcode_raw_cleanup_enabled=_env_bool("VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED", True),
                video_transcode_raw_retention_hours=_env_int("VIDEO_TRANSCODE_RAW_RETENTION_HOURS", 24),
                workspace_video_quota=_env_int("WORKSPACE_VIDEO_QUOTA", 50),
                cleanup_video_source_after_analysis=_env_bool("CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS", False),
                # PR C9.1: compression decision (independent of pipeline-enabled flag).
                video_transcode_enabled=_env_bool("VIDEO_TRANSCODE_ENABLED", False),
                video_transcode_min_bytes=_env_int(
                    "VIDEO_TRANSCODE_MIN_BYTES", 25 * 1024 * 1024
                ),
                video_upload_timeout_ms=_env_int(
                    "VIDEO_UPLOAD_TIMEOUT_MS", 5 * 60 * 1000
                ),
            ),
            ai=AISettings(
                openai_api_key=os.getenv("OPENAI_API_KEY", ""),
                openai_vision_model=os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
                emergent_llm_key=os.getenv("EMERGENT_LLM_KEY", ""),
                video_analysis_max_frames=_env_int("VIDEO_ANALYSIS_MAX_FRAMES", 6),
                video_analysis_frame_scan_fps=_env_int("VIDEO_ANALYSIS_FRAME_SCAN_FPS", 1),
                video_analysis_min_frame_gap_sec=_env_int("VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC", 8),
                video_analysis_enable_ocr_signals=_env_bool("VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS", False),
                video_analysis_window_sec=_env_int("VIDEO_ANALYSIS_WINDOW_SEC", 20),
                video_analysis_max_moments=_env_int("VIDEO_ANALYSIS_MAX_MOMENTS", 6),
                smart_frame_selection_enabled=_env_bool("SMART_FRAME_SELECTION_ENABLED", False),
                smart_frame_selection_version=os.getenv("SMART_FRAME_SELECTION_VERSION", "smart_frames_v1"),
                smart_moment_sampling_enabled=_env_bool("SMART_MOMENT_SAMPLING_ENABLED", True),
                smart_moment_sampling_version=os.getenv("SMART_MOMENT_SAMPLING_VERSION", "lesson_moments_v1"),
                audio_analysis_enabled=_env_bool("AUDIO_ANALYSIS_ENABLED", False),
                audio_transcription_enabled=_env_bool("AUDIO_TRANSCRIPTION_ENABLED", False),
                audio_features_enabled=_env_bool("AUDIO_FEATURES_ENABLED", False),
                audio_transcription_model=os.getenv("AUDIO_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
                audio_transcription_language=os.getenv("AUDIO_TRANSCRIPTION_LANGUAGE", ""),
                audio_transcription_max_seconds=_env_int("AUDIO_TRANSCRIPTION_MAX_SECONDS", 3600),
                audio_transcript_retention_days=_env_int("AUDIO_TRANSCRIPT_RETENTION_DAYS", 30),
                audio_allow_student_voice_processing=_env_bool("AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", False),
                paid_analysis_enabled=_env_bool("PAID_ANALYSIS_ENABLED", False),
                paid_analysis_allowlist_emails=_env_set("PAID_ANALYSIS_ALLOWLIST_EMAILS"),
                openai_analysis_input_cost_per_million_usd=_env_float(
                    "OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD",
                    0.15,
                ),
                openai_analysis_output_cost_per_million_usd=_env_float(
                    "OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD",
                    0.60,
                ),
                master_observer_pipeline_enabled=_env_bool("MASTER_OBSERVER_PIPELINE_ENABLED", True),
                master_observer_require_voice_gate_pass=_env_bool(
                    "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS",
                    False,
                ),
                voice_gate_release_enforcement_enabled=_env_bool(
                    "VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED",
                    False,
                ),
                voice_gate_human_escalation_enabled=_env_bool(
                    "VOICE_GATE_HUMAN_ESCALATION_ENABLED",
                    True,
                ),
                voice_gate_regen_max_attempts=_env_int("VOICE_GATE_REGEN_MAX_ATTEMPTS", 1),
            ),
            storage=StorageSettings(
                upload_dir=upload_dir,
                backend_public_base_url=backend_public_base_url,
                frontend_url=frontend_url,
                s3_bucket=os.getenv("S3_BUCKET", ""),
                s3_region=os.getenv("S3_REGION", "us-east-1"),
                s3_endpoint=os.getenv("S3_ENDPOINT", ""),
                s3_public_base_url=os.getenv("S3_PUBLIC_BASE_URL", ""),
                s3_presigned_url_expires_seconds=_env_int("S3_PRESIGNED_URL_EXPIRES_SECONDS", 3600),
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", ""),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", ""),
            ),
            cors_origins=cors_origins,
            environment=environment,
        )

    @property
    def security(self) -> AuthSettings:
        return self.auth

    @property
    def urls(self) -> StorageSettings:
        return self.storage

    @property
    def mongo_url(self) -> str:
        return self.database.mongo_url

    @property
    def db_name(self) -> str:
        return self.database.db_name

    @property
    def jwt_secret(self) -> str:
        return self.auth.jwt_secret

    @property
    def jwt_algorithm(self) -> str:
        return self.auth.jwt_algorithm

    @property
    def jwt_expiration_hours(self) -> int:
        return self.auth.jwt_expiration_hours

    @property
    def backend_public_base_url(self) -> str:
        return self.storage.backend_public_base_url

    @property
    def frontend_url(self) -> str:
        return self.storage.frontend_url

    @property
    def demo_mode(self) -> bool:
        return self.operations.demo_mode

    @property
    def railway_environment_name(self) -> str:
        return self.operations.railway_environment_name

    @property
    def is_production(self) -> bool:
        normalized = (self.environment or "").strip().lower()
        railway_env = (self.railway_environment_name or "").strip().lower()
        return normalized in {"production", "prod"} or railway_env in {"production", "prod"}

    def validate_startup(self) -> None:
        missing: List[str] = []

        if not self.database.mongo_url:
            missing.append("MONGO_URL")

        if not self.database.db_name:
            missing.append("DB_NAME")

        if self.is_production:
            if not self.auth.jwt_secret:
                missing.append("JWT_SECRET")
            if not self.storage.backend_public_base_url:
                missing.append("BACKEND_PUBLIC_BASE_URL")
            if not self.storage.frontend_url:
                missing.append("FRONTEND_URL")
            if not self.cors_origins:
                missing.append("CORS_ORIGINS")

        if missing:
            raise RuntimeError(
                "Missing required Cognivio environment variable(s): "
                + ", ".join(sorted(set(missing)))
            )

    def startup_summary(self) -> str:
        cors_count = len(self.cors_origins or [])
        return (
            "Cognivio settings loaded "
            f"(environment={self.environment or 'development'}, "
            f"db_name={self.database.db_name or 'unset'}, "
            f"demo_mode={self.operations.demo_mode}, "
            f"backend_public_base_url={'set' if self.storage.backend_public_base_url else 'unset'}, "
            f"frontend_url={'set' if self.storage.frontend_url else 'unset'}, "
            f"cors_origins={cors_count})"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
