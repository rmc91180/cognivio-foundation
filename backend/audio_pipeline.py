import os
import re
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from openai import OpenAI
except Exception:
    OpenAI = None


def extract_audio_track(video_path: str, output_path: str, max_seconds: Optional[int] = None) -> Dict[str, Any]:
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise RuntimeError("ffmpeg is not available for audio extraction")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        str(video_path),
    ]
    if max_seconds and max_seconds > 0:
        command.extend(["-t", str(int(max_seconds))])
    command.extend(
        [
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(output),
        ]
    )
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not output.exists():
        raise RuntimeError(
            f"Audio extraction failed: {(completed.stderr or completed.stdout or 'unknown ffmpeg error').strip()}"
        )
    return {
        "audio_path": str(output),
        "file_size_bytes": output.stat().st_size,
        "content_type": "audio/wav",
    }


def transcribe_audio_file(
    audio_path: str,
    api_key: str,
    model: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    if not api_key:
        raise RuntimeError("OpenAI API key is required for transcription")
    if OpenAI is None:
        raise RuntimeError("OpenAI SDK is not available for transcription")

    client = OpenAI(api_key=api_key)
    response = None
    try:
        with open(audio_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
                language=language or None,
            )
    except Exception as exc:
        message = str(exc)
        if "response_format" not in message or "verbose_json" not in message:
            raise
        with open(audio_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                response_format="json",
                language=language or None,
            )

    segments: List[Dict[str, Any]] = []
    for idx, segment in enumerate(getattr(response, "segments", []) or []):
        text = str(getattr(segment, "text", "") or "").strip()
        if not text:
            continue
        start = float(getattr(segment, "start", 0.0) or 0.0)
        end = float(getattr(segment, "end", start) or start)
        segments.append(
            {
                "segment_id": f"segment_{idx + 1:03d}",
                "start_sec": round(start, 2),
                "end_sec": round(max(end, start), 2),
                "speaker": "unknown",
                "text": text,
            }
        )

    transcript_text = str(getattr(response, "text", "") or "").strip()
    if transcript_text and not segments:
        duration_sec = 0.0
        try:
            with wave.open(audio_path, "rb") as wav_file:
                frame_rate = wav_file.getframerate() or 0
                frame_count = wav_file.getnframes() or 0
                duration_sec = round(frame_count / frame_rate, 2) if frame_rate else 0.0
        except Exception:
            duration_sec = 0.0
        segments.append(
            {
                "segment_id": "segment_001",
                "start_sec": 0.0,
                "end_sec": max(duration_sec, 0.0),
                "speaker": "unknown",
                "text": transcript_text,
            }
        )

    return {
        "text": transcript_text,
        "segments": segments,
        "model": model,
    }


def _count_questions(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(r"\?", text))


def _count_open_questions(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(r"\b(why|how|what if|explain|compare|describe)\b", text, flags=re.IGNORECASE))


def _count_directives(text: str) -> int:
    if not text:
        return 0
    return len(re.findall(r"\b(let's|please|turn|look|write|show|tell|share|complete|take)\b", text, flags=re.IGNORECASE))


def compute_audio_features(segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    cleaned_segments = [segment for segment in (segments or []) if str(segment.get("text") or "").strip()]
    if not cleaned_segments:
        return {
            "teacher_talk_ratio": 0.0,
            "turn_count": 0,
            "question_count": 0,
            "open_question_count": 0,
            "directive_density": 0.0,
            "pause_density": 0.0,
            "transition_markers": 0,
        }

    total_duration = 0.0
    total_words = 0
    question_count = 0
    open_question_count = 0
    directive_count = 0
    transition_markers = 0
    pause_gaps = 0
    previous_end = None

    for segment in cleaned_segments:
        start = float(segment.get("start_sec", 0.0) or 0.0)
        end = float(segment.get("end_sec", start) or start)
        duration = max(0.0, end - start)
        text = str(segment.get("text") or "").strip()
        total_duration += duration
        words = text.split()
        total_words += len(words)
        question_count += _count_questions(text)
        open_question_count += _count_open_questions(text)
        directive_count += _count_directives(text)
        transition_markers += len(
            re.findall(r"\b(now|next|then|let's move|in a moment|first|second|finally)\b", text, flags=re.IGNORECASE)
        )
        if previous_end is not None and start - previous_end >= 1.5:
            pause_gaps += 1
        previous_end = end

    directive_density = directive_count / max(total_words, 1)
    pause_density = pause_gaps / max(len(cleaned_segments), 1)
    return {
        "teacher_talk_ratio": 1.0,
        "turn_count": len(cleaned_segments),
        "question_count": question_count,
        "open_question_count": open_question_count,
        "directive_density": round(directive_density, 4),
        "pause_density": round(pause_density, 4),
        "transition_markers": transition_markers,
    }
