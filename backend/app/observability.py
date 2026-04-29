from __future__ import annotations

import json
import threading
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import metrics


_LOCK = threading.Lock()
_MAX_RECENT_ITEMS = 50

_STATE: Dict[str, Any] = {
    "analysis": {
        "total_runs": 0,
        "successful_runs": 0,
        "failed_runs": 0,
        "by_mode": {},
        "average_duration_seconds": 0.0,
        "average_estimated_input_tokens": 0.0,
        "average_estimated_output_tokens": 0.0,
        "recent_failures": deque(maxlen=_MAX_RECENT_ITEMS),
        "recent_runs": deque(maxlen=_MAX_RECENT_ITEMS),
    },
    "workers": {
        "video": {
            "completed_jobs": 0,
            "failed_jobs": 0,
            "recent_failures": deque(maxlen=_MAX_RECENT_ITEMS),
        },
        "privacy": {
            "completed_jobs": 0,
            "failed_jobs": 0,
            "recent_failures": deque(maxlen=_MAX_RECENT_ITEMS),
        },
        "transcode": {
            "completed_jobs": 0,
            "failed_jobs": 0,
            "recent_failures": deque(maxlen=_MAX_RECENT_ITEMS),
        },
    },
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rolling_average(current_avg: float, current_count: int, new_value: float) -> float:
    if current_count <= 0:
        return round(new_value, 4)
    return round(((current_avg * current_count) + new_value) / (current_count + 1), 4)


def log_structured(logger: Any, level: str, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        "timestamp": _utc_now_iso(),
        **fields,
    }
    message = json.dumps(payload, ensure_ascii=True, default=str)
    log_method = getattr(logger, level, None) or getattr(logger, "info")
    log_method(message)


def record_analysis_run(
    *,
    video_id: str,
    success: bool,
    analysis_mode: str,
    duration_seconds: float,
    modalities_used: Optional[List[str]] = None,
    estimated_input_tokens: Optional[int] = None,
    estimated_output_tokens: Optional[int] = None,
    estimated_cost_usd: Optional[float] = None,
    failure_reason: Optional[str] = None,
    language: Optional[str] = None,
    model: Optional[str] = None,
) -> None:
    with _LOCK:
        analysis = _STATE["analysis"]
        analysis["total_runs"] += 1
        run_number = analysis["total_runs"]
        if success:
            analysis["successful_runs"] += 1
        else:
            analysis["failed_runs"] += 1
        analysis["by_mode"][analysis_mode] = analysis["by_mode"].get(analysis_mode, 0) + 1
        analysis["average_duration_seconds"] = _rolling_average(
            analysis["average_duration_seconds"],
            run_number - 1,
            duration_seconds,
        )
        if estimated_input_tokens is not None:
            analysis["average_estimated_input_tokens"] = _rolling_average(
                analysis["average_estimated_input_tokens"],
                run_number - 1,
                float(estimated_input_tokens),
            )
        if estimated_output_tokens is not None:
            analysis["average_estimated_output_tokens"] = _rolling_average(
                analysis["average_estimated_output_tokens"],
                run_number - 1,
                float(estimated_output_tokens),
            )
        run_doc = {
            "video_id": video_id,
            "success": success,
            "analysis_mode": analysis_mode,
            "duration_seconds": round(duration_seconds, 3),
            "modalities_used": list(modalities_used or []),
            "estimated_input_tokens": estimated_input_tokens,
            "estimated_output_tokens": estimated_output_tokens,
            "estimated_cost_usd": estimated_cost_usd,
            "failure_reason": failure_reason,
            "recorded_at": _utc_now_iso(),
        }
        analysis["recent_runs"].appendleft(run_doc)
        if failure_reason:
            analysis["recent_failures"].appendleft(
                {
                    "video_id": video_id,
                    "analysis_mode": analysis_mode,
                    "failure_reason": failure_reason,
                    "recorded_at": run_doc["recorded_at"],
                }
            )
    metrics.record_analysis_result(
        analysis_mode=analysis_mode,
        language=language,
        modalities=modalities_used,
        success=success,
        duration_seconds=duration_seconds,
        model=model,
        estimated_input_tokens=estimated_input_tokens,
        estimated_output_tokens=estimated_output_tokens,
        estimated_cost_usd=estimated_cost_usd,
    )


def record_worker_result(
    *,
    worker_type: str,
    job_id: str,
    success: bool,
    failure_reason: Optional[str] = None,
) -> None:
    if worker_type not in _STATE["workers"]:
        return
    with _LOCK:
        worker_state = _STATE["workers"][worker_type]
        if success:
            worker_state["completed_jobs"] += 1
        else:
            worker_state["failed_jobs"] += 1
            worker_state["recent_failures"].appendleft(
                {
                    "job_id": job_id,
                    "failure_reason": failure_reason,
                    "recorded_at": _utc_now_iso(),
                }
            )
    metrics.record_worker_result(worker_type=worker_type, success=success)


def snapshot() -> Dict[str, Any]:
    with _LOCK:
        copied = deepcopy(_STATE)
    for group_name in ("analysis",):
        for key in ("recent_failures", "recent_runs"):
            copied[group_name][key] = list(copied[group_name][key])
    for worker_name in copied["workers"]:
        copied["workers"][worker_name]["recent_failures"] = list(copied["workers"][worker_name]["recent_failures"])
    return copied


def estimate_analysis_usage(
    *,
    frames: List[dict],
    multimodal_payload: Optional[dict] = None,
    output_payload: Optional[dict] = None,
    input_text_tokens_base: int = 1000,
    input_cost_per_million: Optional[float] = None,
    output_cost_per_million: Optional[float] = None,
) -> Dict[str, Optional[float]]:
    frame_count = len(frames or [])
    image_input_tokens = frame_count * 486
    transcript_excerpt = ""
    if multimodal_payload:
        for moment in multimodal_payload.get("moments") or []:
            excerpt = str(moment.get("transcript_excerpt") or "").strip()
            if excerpt:
                transcript_excerpt += f" {excerpt}"
    transcript_word_count = len(transcript_excerpt.split())
    transcript_input_tokens = int(transcript_word_count / 0.75) if transcript_word_count else 0
    estimated_input_tokens = image_input_tokens + input_text_tokens_base + transcript_input_tokens

    estimated_output_tokens = None
    if output_payload is not None:
        try:
            serialized = json.dumps(output_payload, ensure_ascii=False, default=str)
            estimated_output_tokens = max(1, int(len(serialized) / 4))
        except Exception:
            estimated_output_tokens = None

    estimated_cost_usd = None
    if (
        input_cost_per_million is not None
        and output_cost_per_million is not None
        and estimated_output_tokens is not None
    ):
        estimated_cost_usd = round(
            (estimated_input_tokens / 1_000_000.0) * input_cost_per_million
            + (estimated_output_tokens / 1_000_000.0) * output_cost_per_million,
            8,
        )

    return {
        "estimated_input_tokens": estimated_input_tokens,
        "estimated_output_tokens": estimated_output_tokens,
        "estimated_cost_usd": estimated_cost_usd,
        "frame_count": frame_count,
        "transcript_word_count": transcript_word_count,
    }
