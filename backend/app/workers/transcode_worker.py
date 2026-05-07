from __future__ import annotations

from typing import Optional

import server as legacy


VIDEO_TRANSCODE_JOB_QUEUE = legacy.VIDEO_TRANSCODE_JOB_QUEUE
VIDEO_TRANSCODE_WORKER_TASKS = legacy.VIDEO_TRANSCODE_WORKER_TASKS


async def enqueue_video_transcode_job(
    *,
    video_id: str,
    teacher_id: str,
    user_id: str,
    file_path: str,
    source_content_type: Optional[str] = None,
    raw_s3_key: Optional[str] = None,
    raw_file_url: Optional[str] = None,
    requested_profile: Optional[str] = None,
) -> None:
    await legacy._enqueue_video_transcode_job(
        video_id=video_id,
        teacher_id=teacher_id,
        user_id=user_id,
        file_path=file_path,
        source_content_type=source_content_type,
        raw_s3_key=raw_s3_key,
        raw_file_url=raw_file_url,
        requested_profile=requested_profile,
    )


async def run_video_transcode_job(video_id: str) -> None:
    await legacy._run_video_transcode_job(video_id)


async def video_transcode_worker(worker_label: str) -> None:
    await legacy._video_transcode_worker(worker_label)


async def start_video_transcode_workers() -> None:
    await legacy._start_video_transcode_workers()


async def rehydrate_video_transcode_queue() -> None:
    await legacy._rehydrate_video_transcode_queue()


__all__ = [
    "VIDEO_TRANSCODE_JOB_QUEUE",
    "VIDEO_TRANSCODE_WORKER_TASKS",
    "enqueue_video_transcode_job",
    "run_video_transcode_job",
    "video_transcode_worker",
    "start_video_transcode_workers",
    "rehydrate_video_transcode_queue",
]
