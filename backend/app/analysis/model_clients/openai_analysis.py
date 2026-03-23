from __future__ import annotations

from typing import Any, Dict, List, Optional

import server as legacy


async def analyze_video_frames(
    frames: List[dict],
    framework: dict,
    selected_elements: List[str],
    priority_elements: Optional[List[str]] = None,
    focus_note: Optional[str] = None,
    language: str = "en",
    framework_type: str = "danielson",
    current_user: Optional[dict] = None,
    multimodal_payload: Optional[dict] = None,
) -> Dict[str, Any]:
    return await legacy.analyze_frames_with_ai(
        frames=frames,
        framework=framework,
        selected_elements=selected_elements,
        priority_elements=priority_elements,
        focus_note=focus_note,
        language=language,
        framework_type=framework_type,
        current_user=current_user,
        multimodal_payload=multimodal_payload,
    )
