import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict


def transcode_video_asset(
    input_path: str,
    output_path: str,
    *,
    max_height: int = 720,
    crf: int = 27,
    preset: str = "veryfast",
    audio_bitrate: str = "128k",
) -> Dict[str, Any]:
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise RuntimeError("ffmpeg is not available for video transcoding")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    max_width = int(max_height * 16 / 9)
    scale_filter = f"scale={max_width}:{max_height}:force_original_aspect_ratio=decrease"
    command = [
        ffmpeg_path,
        "-y",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        scale_filter,
        "-c:v",
        "libx264",
        "-preset",
        str(preset),
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        str(audio_bitrate),
        "-movflags",
        "+faststart",
        str(output),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not output.exists():
        raise RuntimeError(
            f"Video transcode failed: {(completed.stderr or completed.stdout or 'unknown ffmpeg error').strip()}"
        )
    return {
        "output_path": str(output),
        "file_size_bytes": output.stat().st_size,
        "content_type": "video/mp4",
        "profile": {
            "max_height": max_height,
            "crf": crf,
            "preset": preset,
            "audio_bitrate": audio_bitrate,
        },
    }
