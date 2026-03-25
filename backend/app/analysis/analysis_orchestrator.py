from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.analysis.model_clients.openai_analysis import analyze_video_frames
from app.analysis.multimodal_analysis import build_multimodal_analysis_payload


async def run_analysis_pipeline(
    frames: List[dict],
    framework: dict,
    selected_elements: List[str],
    *,
    teacher_id: Optional[str] = None,
    priority_elements: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    language: str = "en",
    framework_type: str = "danielson",
    current_user: Optional[dict] = None,
    moment_manifest: Optional[Dict[str, Any]] = None,
    transcript_doc: Optional[Dict[str, Any]] = None,
    feature_doc: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    multimodal_payload = build_multimodal_analysis_payload(
        frames=frames,
        moment_manifest=moment_manifest,
        transcript_doc=transcript_doc,
        feature_doc=feature_doc,
    )
    return await analyze_video_frames(
        frames=multimodal_payload.get("frames") or frames,
        framework=framework,
        selected_elements=selected_elements,
        teacher_id=teacher_id,
        priority_elements=priority_elements,
        focus_note=focus_note,
        language=language,
        framework_type=framework_type,
        current_user=current_user,
        multimodal_payload=multimodal_payload,
    )
