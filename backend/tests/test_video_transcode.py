import importlib.util
import subprocess
from pathlib import Path

import pytest


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "video_transcode.py"
    spec = importlib.util.spec_from_file_location("backend_video_transcode", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


video_transcode = _load_module()
transcode_video_asset = video_transcode.transcode_video_asset


def test_transcode_video_asset_runs_ffmpeg_and_returns_metadata(monkeypatch, tmp_path):
    input_path = tmp_path / "input.mov"
    output_path = tmp_path / "output.mp4"
    input_path.write_bytes(b"input")

    recorded = {}

    def _which(binary):
        assert binary == "ffmpeg"
        return "/usr/bin/ffmpeg"

    def _run(command, capture_output, text, check):
        recorded["command"] = command
        output_path.write_bytes(b"processed-video")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(video_transcode.shutil, "which", _which)
    monkeypatch.setattr(video_transcode.subprocess, "run", _run)

    result = transcode_video_asset(
        str(input_path),
        str(output_path),
        max_height=720,
        crf=28,
        preset="fast",
        audio_bitrate="96k",
    )

    assert result["output_path"] == str(output_path)
    assert result["file_size_bytes"] == len(b"processed-video")
    assert result["content_type"] == "video/mp4"
    assert result["profile"] == {
        "max_height": 720,
        "crf": 28,
        "preset": "fast",
        "audio_bitrate": "96k",
    }
    assert recorded["command"][-1] == str(output_path)
    assert "-movflags" in recorded["command"]
    assert "+faststart" in recorded["command"]


def test_transcode_video_asset_requires_ffmpeg(monkeypatch, tmp_path):
    monkeypatch.setattr(video_transcode.shutil, "which", lambda _binary: None)

    with pytest.raises(RuntimeError, match="ffmpeg is not available"):
        transcode_video_asset(
            str(tmp_path / "input.mov"),
            str(tmp_path / "output.mp4"),
        )


def test_transcode_video_asset_raises_on_ffmpeg_failure(monkeypatch, tmp_path):
    input_path = tmp_path / "input.mov"
    output_path = tmp_path / "output.mp4"
    input_path.write_bytes(b"input")

    monkeypatch.setattr(video_transcode.shutil, "which", lambda _binary: "/usr/bin/ffmpeg")
    monkeypatch.setattr(
        video_transcode.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1, stdout="", stderr="boom"),
    )

    with pytest.raises(RuntimeError, match="Video transcode failed: boom"):
        transcode_video_asset(
            str(input_path),
            str(output_path),
        )
