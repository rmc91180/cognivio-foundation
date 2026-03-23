from __future__ import annotations

from typing import Any, Dict, Optional

from app.analysis.audio_pipeline import transcribe_audio_file


def transcribe_audio(
    audio_path: str,
    api_key: str,
    model: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    return transcribe_audio_file(
        audio_path=audio_path,
        api_key=api_key,
        model=model,
        language=language,
    )
