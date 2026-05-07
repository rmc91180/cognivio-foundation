from __future__ import annotations

import os
import json
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from pydantic.v1 import BaseModel, BaseSettings, Field, validator


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")


def _csv_list(value) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _lower_csv_list(value) -> List[str]:
    return [item.lower() for item in _csv_list(value)]


class CognivioBaseSettings(BaseSettings):
    class Config:
        env_file = str(ROOT_DIR / ".env")
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

        @classmethod
        def parse_env_var(cls, field_name: str, raw_val: str):
            if field_name in {
                "admin_emails",
                "cors_origins",
                "paid_analysis_allowlist_emails",
                "super_admin_emails",
            }:
                try:
                    return json.loads(raw_val)
                except Exception:
                    return _csv_list(raw_val)
            return json.loads(raw_val)


class DatabaseSettings(CognivioBaseSettings):
    mongo_url: str = Field("mongodb://localhost:27017", env="MONGO_URL")
    db_name: str = Field("cognivio", env="DB_NAME")


class AuthSettings(CognivioBaseSettings):
    jwt_secret: str = Field("", env="JWT_SECRET")
    jwt_algorithm: str = Field("HS256", env="JWT_ALGORITHM")
    jwt_expiration_hours: int = Field(24, env="JWT_EXPIRATION_HOURS")
    session_cookie_name: str = Field("cognivio_session", env="SESSION_COOKIE_NAME")
    csrf_cookie_name: str = Field("cognivio_csrf", env="CSRF_COOKIE_NAME")
    cookie_secure: bool = Field(True, env="COOKIE_SECURE")
    session_cookie_max_age_seconds: int = Field(86400, env="SESSION_COOKIE_MAX_AGE_SECONDS")
    session_cookie_samesite: str = Field("strict", env="SESSION_COOKIE_SAMESITE")
    cors_origins: List[str] = Field(default_factory=list, env="CORS_ORIGINS")
    admin_emails: List[str] = Field(default_factory=list, env="ADMIN_EMAILS")
    super_admin_emails: List[str] = Field(default_factory=list, env="SUPER_ADMIN_EMAILS")
    master_admin_email: str = Field("", env="MASTER_ADMIN_EMAIL")
    master_admin_password: str = Field("", env="MASTER_ADMIN_PASSWORD")
    master_admin_name: str = Field("Cognivio Master Admin", env="MASTER_ADMIN_NAME")
    access_approval_required: bool = Field(True, env="ACCESS_APPROVAL_REQUIRED")
    access_approval_notify_email: str = Field("rmc91180@gmail.com", env="ACCESS_APPROVAL_NOTIFY_EMAIL")

    _parse_cors = validator("cors_origins", pre=True, allow_reuse=True)(_csv_list)
    _parse_admins = validator("admin_emails", "super_admin_emails", pre=True, allow_reuse=True)(_lower_csv_list)

    @validator("master_admin_email", pre=True, always=True)
    def normalize_master_admin_email(cls, value: str) -> str:
        return str(value or "").strip().lower()

    @validator("session_cookie_name", "csrf_cookie_name", pre=True, always=True)
    def non_empty_cookie_name(cls, value: str, field):
        default = "cognivio_session" if field.name == "session_cookie_name" else "cognivio_csrf"
        return str(value or "").strip() or default

    @validator("session_cookie_max_age_seconds", pre=False)
    def minimum_session_age(cls, value: int) -> int:
        return max(300, int(value))

    def admin_email_set(self) -> set[str]:
        emails = set(self.admin_emails)
        if self.master_admin_email:
            emails.add(self.master_admin_email)
        return emails

    def super_admin_email_set(self) -> set[str]:
        emails = set(self.super_admin_emails)
        if self.master_admin_email:
            emails.add(self.master_admin_email)
        return emails


class StorageSettings(CognivioBaseSettings):
    s3_bucket: Optional[str] = Field(None, env="S3_BUCKET")
    s3_region: Optional[str] = Field(None, env="S3_REGION")
    s3_endpoint: Optional[str] = Field(None, env="S3_ENDPOINT")
    s3_public_base_url: Optional[str] = Field(None, env="S3_PUBLIC_BASE_URL")
    s3_presigned_url_expires_seconds: int = Field(3600, env="S3_PRESIGNED_URL_EXPIRES_SECONDS")
    aws_access_key_id: Optional[str] = Field(None, env="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: Optional[str] = Field(None, env="AWS_SECRET_ACCESS_KEY")
    upload_dir: Path = Field(default_factory=lambda: ROOT_DIR / "uploads", env="UPLOAD_DIR")
    frontend_url: Optional[str] = Field(None, env="FRONTEND_URL")
    backend_public_base_url: str = Field("", env="BACKEND_PUBLIC_BASE_URL")

    @validator("upload_dir", pre=True, always=True)
    def expand_upload_dir(cls, value) -> Path:
        return Path(value or ROOT_DIR / "uploads").expanduser()

    @validator("backend_public_base_url", pre=True, always=True)
    def strip_backend_url(cls, value: str) -> str:
        return str(value or "").rstrip("/")


class AISettings(CognivioBaseSettings):
    openai_api_key: str = Field("", env="OPENAI_API_KEY")
    openai_vision_model: str = Field("gpt-4.1-mini", env="OPENAI_VISION_MODEL")
    openai_analysis_input_cost_per_million_usd: float = Field(0.40, env="OPENAI_ANALYSIS_INPUT_COST_PER_MILLION_USD")
    openai_analysis_output_cost_per_million_usd: float = Field(1.60, env="OPENAI_ANALYSIS_OUTPUT_COST_PER_MILLION_USD")
    emergent_llm_key: str = Field("", env="EMERGENT_LLM_KEY")
    paid_analysis_enabled: bool = Field(False, env="PAID_ANALYSIS_ENABLED")
    paid_analysis_allowlist_emails: List[str] = Field(default_factory=list, env="PAID_ANALYSIS_ALLOWLIST_EMAILS")
    audio_analysis_enabled: bool = Field(False, env="AUDIO_ANALYSIS_ENABLED")
    audio_transcription_enabled: bool = Field(False, env="AUDIO_TRANSCRIPTION_ENABLED")
    audio_features_enabled: bool = Field(False, env="AUDIO_FEATURES_ENABLED")
    audio_transcription_model: str = Field("gpt-4o-mini-transcribe", env="AUDIO_TRANSCRIPTION_MODEL")
    audio_transcription_language: Optional[str] = Field(None, env="AUDIO_TRANSCRIPTION_LANGUAGE")
    audio_transcript_retention_days: int = Field(30, env="AUDIO_TRANSCRIPT_RETENTION_DAYS")
    audio_transcription_max_seconds: int = Field(120, env="AUDIO_TRANSCRIPTION_MAX_SECONDS")
    audio_allow_student_voice_processing: bool = Field(False, env="AUDIO_ALLOW_STUDENT_VOICE_PROCESSING")
    video_analysis_max_frames: int = Field(18, env="VIDEO_ANALYSIS_MAX_FRAMES")
    smart_frame_selection_enabled: bool = Field(False, env="SMART_FRAME_SELECTION_ENABLED")
    smart_frame_selection_version: str = Field("smart_frames_v2", env="SMART_FRAME_SELECTION_VERSION")
    video_analysis_frame_scan_fps: float = Field(2.0, env="VIDEO_ANALYSIS_FRAME_SCAN_FPS")
    video_analysis_min_frame_gap_sec: float = Field(8.0, env="VIDEO_ANALYSIS_MIN_FRAME_GAP_SEC")
    video_analysis_enable_ocr_signals: bool = Field(False, env="VIDEO_ANALYSIS_ENABLE_OCR_SIGNALS")
    smart_moment_sampling_enabled: bool = Field(True, env="SMART_MOMENT_SAMPLING_ENABLED")
    smart_moment_sampling_version: str = Field("lesson_moments_v2", env="SMART_MOMENT_SAMPLING_VERSION")
    video_analysis_window_sec: float = Field(20.0, env="VIDEO_ANALYSIS_WINDOW_SEC")
    video_analysis_max_moments: int = Field(10, env="VIDEO_ANALYSIS_MAX_MOMENTS")
    master_observer_pipeline_enabled: bool = Field(False, env="MASTER_OBSERVER_PIPELINE_ENABLED")
    master_observer_require_voice_gate_pass: bool = Field(True, env="MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS")
    voice_gate_release_enforcement_enabled: bool = Field(False, env="VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED")
    voice_gate_regen_max_attempts: int = Field(2, env="VOICE_GATE_REGEN_MAX_ATTEMPTS")
    voice_gate_human_escalation_enabled: bool = Field(True, env="VOICE_GATE_HUMAN_ESCALATION_ENABLED")

    _parse_paid_allowlist = validator("paid_analysis_allowlist_emails", pre=True, allow_reuse=True)(_lower_csv_list)

    @validator("audio_transcription_language", pre=True, always=True)
    def normalize_audio_language(cls, value: Optional[str]) -> Optional[str]:
        cleaned = str(value or "").strip()
        return cleaned or None

    @validator("video_analysis_max_frames", pre=False)
    def minimum_analysis_frames(cls, value: int) -> int:
        return max(6, int(value))

    @validator("video_analysis_frame_scan_fps", pre=False)
    def minimum_scan_fps(cls, value: float) -> float:
        return max(0.25, float(value))

    @validator("video_analysis_min_frame_gap_sec", pre=False)
    def minimum_frame_gap(cls, value: float) -> float:
        return max(1.0, float(value))

    @validator("video_analysis_window_sec", pre=False)
    def minimum_window(cls, value: float) -> float:
        return max(10.0, float(value))

    @validator("video_analysis_max_moments", pre=False)
    def minimum_moments(cls, value: int) -> int:
        return max(4, int(value))

    @validator("audio_transcript_retention_days", pre=False)
    def minimum_audio_retention(cls, value: int) -> int:
        return max(1, int(value))

    @validator("audio_transcription_max_seconds", pre=False)
    def minimum_audio_seconds(cls, value: int) -> int:
        return max(15, int(value))

    @validator("voice_gate_regen_max_attempts", pre=False)
    def minimum_voice_gate_attempts(cls, value: int) -> int:
        return max(1, int(value))


class VideoSettings(CognivioBaseSettings):
    max_video_bytes: int = Field(2 * 1024 * 1024 * 1024, env="MAX_VIDEO_BYTES")
    workspace_video_quota: int = Field(500, env="WORKSPACE_VIDEO_QUOTA")
    video_worker_count: int = Field(1, env="VIDEO_WORKER_COUNT")
    video_transcode_pipeline_enabled: bool = Field(False, env="VIDEO_TRANSCODE_PIPELINE_ENABLED")
    video_transcode_profile: str = Field("analysis_master_v1", env="VIDEO_TRANSCODE_PROFILE")
    video_transcode_worker_count: int = Field(1, env="VIDEO_TRANSCODE_WORKER_COUNT")
    video_transcode_raw_cleanup_enabled: bool = Field(True, env="VIDEO_TRANSCODE_RAW_CLEANUP_ENABLED")
    video_transcode_raw_retention_hours: int = Field(24, env="VIDEO_TRANSCODE_RAW_RETENTION_HOURS")
    cleanup_video_source_after_analysis: bool = Field(False, env="CLEANUP_VIDEO_SOURCE_AFTER_ANALYSIS")

    @validator("workspace_video_quota", "video_worker_count", "video_transcode_worker_count", pre=False)
    def minimum_one(cls, value: int) -> int:
        return max(1, int(value))

    @validator("video_transcode_raw_retention_hours", pre=False)
    def minimum_retention_hours(cls, value: int) -> int:
        return max(1, int(value))


class PrivacySettings(CognivioBaseSettings):
    privacy_require_profile: bool = Field(True, env="PRIVACY_REQUIRE_PROFILE")
    privacy_profile_min_references: int = Field(3, env="PRIVACY_PROFILE_MIN_REFERENCES")
    privacy_profile_max_references: int = Field(5, env="PRIVACY_PROFILE_MAX_REFERENCES")
    privacy_manual_review_enabled: bool = Field(True, env="PRIVACY_MANUAL_REVIEW_ENABLED")
    privacy_allow_blur_all_fallback: bool = Field(True, env="PRIVACY_ALLOW_BLUR_ALL_FALLBACK")
    privacy_worker_count: int = Field(1, env="PRIVACY_WORKER_COUNT")
    privacy_max_retries: int = Field(3, env="PRIVACY_MAX_RETRIES")
    privacy_teacher_match_threshold: float = Field(0.9, env="PRIVACY_TEACHER_MATCH_THRESHOLD")
    privacy_ambiguous_match_threshold: float = Field(0.8, env="PRIVACY_AMBIGUOUS_MATCH_THRESHOLD")
    privacy_raw_video_retention_days: int = Field(30, env="PRIVACY_RAW_VIDEO_RETENTION_DAYS")
    privacy_profile_image_retention_days: int = Field(30, env="PRIVACY_PROFILE_IMAGE_RETENTION_DAYS")
    privacy_purge_interval_minutes: int = Field(60, env="PRIVACY_PURGE_INTERVAL_MINUTES")
    privacy_allow_degraded_runtime: bool = Field(False, env="PRIVACY_ALLOW_DEGRADED_RUNTIME")

    @validator("privacy_profile_min_references", "privacy_worker_count", "privacy_max_retries", pre=False)
    def minimum_one(cls, value: int) -> int:
        return max(1, int(value))

    @validator("privacy_profile_max_references", pre=False)
    def minimum_profile_max(cls, value: int, values) -> int:
        return max(int(values.get("privacy_profile_min_references", 1)), int(value))

    @validator("privacy_raw_video_retention_days", "privacy_profile_image_retention_days", pre=False)
    def minimum_retention_days(cls, value: int) -> int:
        return max(1, int(value))

    @validator("privacy_purge_interval_minutes", pre=False)
    def minimum_purge_interval(cls, value: int) -> int:
        return max(5, int(value))


class EmailSettings(CognivioBaseSettings):
    resend_api_key: str = Field("", env="RESEND_API_KEY")
    resend_from_email: str = Field("", env="RESEND_FROM_EMAIL")
    resend_api_base_url: str = Field("https://api.resend.com", env="RESEND_API_BASE_URL")
    smtp_host: str = Field("", env="SMTP_HOST")
    smtp_port: int = Field(587, env="SMTP_PORT")
    smtp_username: str = Field("", env="SMTP_USERNAME")
    smtp_password: str = Field("", env="SMTP_PASSWORD")
    smtp_from_email: str = Field("", env="SMTP_FROM_EMAIL")
    smtp_use_tls: bool = Field(True, env="SMTP_USE_TLS")

    @validator("resend_api_base_url", pre=True, always=True)
    def normalize_resend_url(cls, value: str) -> str:
        return str(value or "https://api.resend.com").rstrip("/")


class OperationsSettings(CognivioBaseSettings):
    demo_mode: bool = Field(False, env="DEMO_MODE")
    railway_environment_name: Optional[str] = Field(None, env="RAILWAY_ENVIRONMENT_NAME")
    environment: str = Field("development", env="APP_ENV")
    adherence_weight: float = Field(0.15, env="ADHERENCE_WEIGHT")
    feedback_governance_queue_age_warning_minutes: int = Field(120, env="FEEDBACK_GOVERNANCE_QUEUE_AGE_WARNING_MINUTES")
    feedback_governance_queue_age_blocking_minutes: int = Field(480, env="FEEDBACK_GOVERNANCE_QUEUE_AGE_BLOCKING_MINUTES")
    recognition_five_star_score_min: Optional[float] = Field(None, env="RECOGNITION_FIVE_STAR_SCORE_MIN")
    leadership_insights_cache_ttl_seconds: int = Field(1800, env="LEADERSHIP_INSIGHTS_CACHE_TTL_SECONDS")

    @validator("feedback_governance_queue_age_warning_minutes", pre=False)
    def minimum_feedback_warning(cls, value: int) -> int:
        return max(30, int(value))

    @validator("feedback_governance_queue_age_blocking_minutes", pre=False)
    def minimum_feedback_blocking(cls, value: int, values) -> int:
        return max(int(values.get("feedback_governance_queue_age_warning_minutes", 30)), int(value))

    @validator("leadership_insights_cache_ttl_seconds", pre=False)
    def minimum_cache_ttl(cls, value: int) -> int:
        return max(0, int(value))

    @property
    def is_production(self) -> bool:
        candidates = {
            str(self.environment or "").lower(),
            str(self.railway_environment_name or "").lower(),
        }
        return bool({"prod", "production"} & candidates)


class Settings(BaseModel):
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    ai: AISettings = Field(default_factory=AISettings)
    video: VideoSettings = Field(default_factory=VideoSettings)
    privacy: PrivacySettings = Field(default_factory=PrivacySettings)
    email: EmailSettings = Field(default_factory=EmailSettings)
    operations: OperationsSettings = Field(default_factory=OperationsSettings)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls()

    def validate_startup(self) -> None:
        if self.operations.is_production and len(self.auth.jwt_secret) < 32:
            raise RuntimeError(
                "Invalid Cognivio configuration: JWT_SECRET must be at least 32 characters in production."
            )
        if self.ai.paid_analysis_enabled and not self.ai.openai_api_key:
            raise RuntimeError(
                "Invalid Cognivio configuration: OPENAI_API_KEY is required when PAID_ANALYSIS_ENABLED=true."
            )

    def startup_summary(self) -> str:
        audio_state = "on" if self.ai.audio_analysis_enabled else "off"
        demo_state = "yes" if self.operations.demo_mode else "no"
        return (
            f"Cognivio starting | DB: {self.database.db_name} | "
            f"Audio: {audio_state} | Workers: {self.video.video_worker_count} | Demo: {demo_state}"
        )

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
    def backend_public_base_url(self) -> str:
        return self.storage.backend_public_base_url

    @property
    def demo_mode(self) -> bool:
        return self.operations.demo_mode


__all__ = [
    "AISettings",
    "AuthSettings",
    "DatabaseSettings",
    "EmailSettings",
    "OperationsSettings",
    "PrivacySettings",
    "Settings",
    "StorageSettings",
    "VideoSettings",
]
