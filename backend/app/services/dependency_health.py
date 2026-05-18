from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from email.utils import parseaddr
from typing import Any, Dict, Optional

import boto3
import httpx

try:
    from openai import AsyncOpenAI
except Exception:
    AsyncOpenAI = None

from app.config import get_settings


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status(
    name: str,
    healthy: bool,
    message: str,
    remediation: str,
    details: Optional[Dict[str, Any]] = None,
    *,
    reason_code: Optional[str] = None,
    status_override: Optional[str] = None,
) -> Dict[str, Any]:
    status = status_override or ("healthy" if healthy else "unhealthy")
    resolved_details = dict(details or {})
    if reason_code:
        resolved_details["reason_code"] = reason_code
    return {
        "name": name,
        "status": status,
        "healthy": healthy,
        "last_probe": _now_iso(),
        "message": message,
        "failure_note": None if healthy else message,
        "suggested_remediation": remediation,
        "action": remediation,
        "reason_code": reason_code or ("ok" if healthy else "unknown"),
        "details": resolved_details,
    }


def _failure_message(service_name: str, exc: Exception) -> str:
    return f"{service_name} probe failed due to {exc.__class__.__name__}."


async def probe_mongodb(db: Any) -> Dict[str, Any]:
    settings = get_settings()

    try:
        if db is None or not hasattr(db, "command"):
            return _status(
                "MongoDB Atlas",
                False,
                "Database handle is not available.",
                "Verify MongoDB initialization and MONGO_URL in Railway.",
                {"database_name": settings.database.db_name},
            )

        result = await db.command("ping")
        ok = result.get("ok") == 1

        return _status(
            "MongoDB Atlas",
            ok,
            "No active failure note." if ok else "MongoDB ping failed.",
            "Verify Atlas credentials, cluster availability, and network access.",
            {
                "database_name": settings.database.db_name,
                "ping_ok": result.get("ok"),
            },
        )

    except Exception as exc:
        return _status(
            "MongoDB Atlas",
            False,
            _failure_message("MongoDB", exc),
            "Verify Atlas credentials, cluster availability, IP access list, and MONGO_URL.",
            {"database_name": settings.database.db_name, "error_type": exc.__class__.__name__},
        )


async def probe_r2() -> Dict[str, Any]:
    settings = get_settings()
    storage = settings.storage

    missing = [
        name
        for name, value in {
            "S3_BUCKET": storage.s3_bucket,
            "S3_ENDPOINT": storage.s3_endpoint,
            "AWS_ACCESS_KEY_ID": storage.aws_access_key_id,
            "AWS_SECRET_ACCESS_KEY": storage.aws_secret_access_key,
        }.items()
        if not value
    ]

    if missing:
        return _status(
            "Cloudflare R2",
            False,
            "Object storage is unavailable or not configured.",
            "Set S3_BUCKET, S3_ENDPOINT, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in Railway.",
            {
                "configured": False,
                "missing": missing,
                "bucket": storage.s3_bucket or None,
                "endpoint_configured": bool(storage.s3_endpoint),
            },
        )

    def _head_bucket() -> Dict[str, Any]:
        try:
            from botocore.config import Config as BotoConfig

            boto_config = BotoConfig(
                signature_version="s3v4",
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=3,
                read_timeout=5,
            )
        except Exception:
            boto_config = None

        client = boto3.client(
            "s3",
            endpoint_url=storage.s3_endpoint,
            region_name=storage.s3_region or "auto",
            aws_access_key_id=storage.aws_access_key_id,
            aws_secret_access_key=storage.aws_secret_access_key,
            config=boto_config,
        )
        client.head_bucket(Bucket=storage.s3_bucket)
        return {"bucket": storage.s3_bucket}

    try:
        details = await asyncio.to_thread(_head_bucket)

        return _status(
            "Cloudflare R2",
            True,
            "No active failure note.",
            "Verify R2 endpoint, bucket, and access keys in Railway.",
            {
                **details,
                "configured": True,
                "endpoint_configured": True,
                "public_base_url_configured": bool(storage.s3_public_base_url),
            },
        )

    except Exception as exc:
        error_code = None
        error_message = str(exc)

        response = getattr(exc, "response", None)
        if isinstance(response, dict):
            error = response.get("Error") or {}
            error_code = error.get("Code")
            error_message = error.get("Message") or error_message

        return _status(
            "Cloudflare R2",
            False,
            f"R2 probe failed: {error_code or exc.__class__.__name__}",
            "Verify the R2 bucket name, endpoint, access key permissions, and secret key in Railway.",
            {
                "configured": True,
                "bucket": storage.s3_bucket,
                "endpoint_configured": bool(storage.s3_endpoint),
                "error_code": error_code,
                "error_type": exc.__class__.__name__,
            },
        )


async def probe_resend() -> Dict[str, Any]:
    settings = get_settings()
    email = settings.email

    missing = [
        name
        for name, value in {
            "RESEND_API_KEY": email.resend_api_key,
            "RESEND_FROM_EMAIL": email.resend_from_email,
        }.items()
        if not value
    ]

    if missing:
        return _status(
            "Resend",
            False,
            "Outbound email is unavailable or not configured.",
            "Set RESEND_API_KEY and RESEND_FROM_EMAIL in the backend environment.",
            {
                "configured": False,
                "missing": missing,
                "from_email_configured": bool(email.resend_from_email),
            },
            reason_code="missing_api_key" if "RESEND_API_KEY" in missing else "missing_sender",
        )

    parsed_from_email = parseaddr(email.resend_from_email or "")[1].strip().lower()
    if not parsed_from_email or "@" not in parsed_from_email:
        return _status(
            "Resend",
            False,
            "Resend sender address is missing or invalid.",
            "Set RESEND_FROM_EMAIL to a verified sender address such as Cognivio <login@your-domain>.",
            {
                "configured": True,
                "from_email_configured": bool(email.resend_from_email),
                "sender_valid": False,
            },
            reason_code="invalid_sender",
        )

    sender_domain = parsed_from_email.rsplit("@", 1)[1]

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{email.resend_api_base_url.rstrip('/')}/domains",
                headers={"Authorization": f"Bearer {email.resend_api_key}"},
            )

        if response.status_code in {401, 403}:
            return _status(
                "Resend",
                False,
                "Resend API key was rejected.",
                "Verify RESEND_API_KEY in Railway and confirm the sending domain is verified.",
                {
                    "configured": True,
                    "from_email_configured": bool(email.resend_from_email),
                    "status_code": response.status_code,
                },
                reason_code="invalid_api_key",
            )

        if response.status_code >= 500:
            return _status(
                "Resend",
                False,
                f"Resend API returned HTTP {response.status_code}.",
                "Retry after Resend service recovery or check Railway outbound network health.",
                {
                    "configured": True,
                    "from_email_configured": bool(email.resend_from_email),
                    "sender_domain": sender_domain,
                    "status_code": response.status_code,
                },
                reason_code="api_error",
            )

        if response.status_code >= 400:
            return _status(
                "Resend",
                False,
                f"Resend domain probe returned HTTP {response.status_code}.",
                "Verify RESEND_API_KEY permissions and RESEND_FROM_EMAIL in Railway.",
                {
                    "configured": True,
                    "from_email_configured": bool(email.resend_from_email),
                    "sender_domain": sender_domain,
                    "status_code": response.status_code,
                },
                reason_code="api_error",
            )

        try:
            payload = response.json()
        except Exception:
            payload = {}

        domain_rows = payload.get("data") if isinstance(payload, dict) else []
        matching_domain = None
        for row in domain_rows or []:
            domain_name = str(row.get("name") or row.get("domain") or "").strip().lower()
            if domain_name and (sender_domain == domain_name or sender_domain.endswith(f".{domain_name}")):
                matching_domain = row
                break

        if not matching_domain:
            return _status(
                "Resend",
                False,
                "Resend API key works, but the sender domain was not found.",
                "Add and verify the RESEND_FROM_EMAIL domain in Resend, or use a verified sender domain.",
                {
                    "configured": True,
                    "from_email_configured": bool(email.resend_from_email),
                    "sender_domain": sender_domain,
                    "status_code": response.status_code,
                    "domain_visible": False,
                },
                reason_code="domain_not_found",
            )

        domain_status = str(
            matching_domain.get("status")
            or matching_domain.get("verification_status")
            or ""
        ).strip().lower()
        verified = domain_status in {"verified", "success", "active"}

        if not verified:
            return _status(
                "Resend",
                False,
                "Resend sender domain is not verified.",
                "Complete DNS verification for the configured sender domain in Resend.",
                {
                    "configured": True,
                    "from_email_configured": bool(email.resend_from_email),
                    "sender_domain": sender_domain,
                    "status_code": response.status_code,
                    "domain_visible": True,
                    "domain_status": domain_status or "unknown",
                },
                reason_code="domain_not_verified",
            )

        return _status(
            "Resend",
            True,
            "No active failure note.",
            "Set RESEND_API_KEY and RESEND_FROM_EMAIL in the backend environment.",
            {
                "configured": True,
                "from_email_configured": bool(email.resend_from_email),
                "sender_domain": sender_domain,
                "status_code": response.status_code,
                "domain_visible": True,
                "domain_status": domain_status or "verified",
            },
            reason_code="ok",
        )

    except Exception as exc:
        return _status(
            "Resend",
            False,
            "Resend probe failed due to a network or API client error.",
            "Verify RESEND_API_KEY, RESEND_FROM_EMAIL, and outbound network access from Railway.",
            {
                "configured": True,
                "from_email_configured": bool(email.resend_from_email),
                "sender_domain": sender_domain,
                "error_type": exc.__class__.__name__,
            },
            reason_code="network_error",
        )


async def probe_openai() -> Dict[str, Any]:
    settings = get_settings()
    ai = settings.ai

    if not ai.openai_api_key:
        return _status(
            "OpenAI",
            False,
            "OpenAI client or API key is not available.",
            "Set OPENAI_API_KEY in Railway and redeploy the backend.",
            {
                "configured": False,
                "model": ai.openai_vision_model,
            },
        )

    if AsyncOpenAI is None:
        return _status(
            "OpenAI",
            False,
            "OpenAI client is not available in the backend runtime.",
            "Verify the openai package is installed and OPENAI_API_KEY is set in Railway.",
            {
                "configured": True,
                "model": ai.openai_vision_model,
            },
        )

    try:
        client = AsyncOpenAI(api_key=ai.openai_api_key, timeout=5.0, max_retries=0)
        models = await client.models.list()

        return _status(
            "OpenAI",
            True,
            "No active failure note.",
            "Verify OPENAI_API_KEY and backend OpenAI runtime access.",
            {
                "configured": True,
                "model": ai.openai_vision_model,
                "model_count_visible": len(getattr(models, "data", []) or []),
            },
        )

    except Exception as exc:
        return _status(
            "OpenAI",
            False,
            _failure_message("OpenAI", exc),
            "Verify OPENAI_API_KEY, account billing/access, selected model, and Railway outbound network access.",
            {
                "configured": True,
                "model": ai.openai_vision_model,
                "error_type": exc.__class__.__name__,
            },
        )


async def get_dependency_health(db: Any = None) -> Dict[str, Any]:
    probes = await asyncio.gather(
        probe_mongodb(db),
        probe_r2(),
        probe_resend(),
        probe_openai(),
        return_exceptions=True,
    )

    dependencies = []
    for result in probes:
        if isinstance(result, Exception):
            dependencies.append(
                _status(
                    "Unknown dependency",
                    False,
                    _failure_message("Dependency", result),
                    "Check backend logs for the failed dependency probe.",
                    {"error_type": result.__class__.__name__},
                )
            )
        else:
            dependencies.append(result)

    healthy_count = sum(1 for item in dependencies if item.get("healthy"))
    unhealthy_count = len(dependencies) - healthy_count

    return {
        "generated_at": _now_iso(),
        "healthy": unhealthy_count == 0,
        "summary": {
            "total": len(dependencies),
            "healthy": healthy_count,
            "unhealthy": unhealthy_count,
        },
        "dependencies": dependencies,
    }
