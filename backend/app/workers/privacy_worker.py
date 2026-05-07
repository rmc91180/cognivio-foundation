from __future__ import annotations

import server as legacy


VIDEO_PRIVACY_JOB_QUEUE = legacy.VIDEO_PRIVACY_JOB_QUEUE
VIDEO_PRIVACY_WORKER_TASKS = legacy.VIDEO_PRIVACY_WORKER_TASKS


async def enqueue_video_privacy_job(
    *,
    video_id: str,
    teacher_id: str,
    user_id: str,
    file_path: str,
) -> None:
    await legacy._enqueue_video_privacy_job(
        video_id=video_id,
        teacher_id=teacher_id,
        user_id=user_id,
        file_path=file_path,
    )


async def run_video_privacy_job(video_id: str) -> None:
    await legacy._run_video_privacy_job(video_id)


async def video_privacy_worker(worker_label: str) -> None:
    await legacy._video_privacy_worker(worker_label)


async def start_privacy_workers() -> None:
    await legacy._start_privacy_workers()


async def rehydrate_video_privacy_queue() -> None:
    await legacy._rehydrate_video_privacy_queue()


__all__ = [
    "VIDEO_PRIVACY_JOB_QUEUE",
    "VIDEO_PRIVACY_WORKER_TASKS",
    "enqueue_video_privacy_job",
    "run_video_privacy_job",
    "video_privacy_worker",
    "start_privacy_workers",
    "rehydrate_video_privacy_queue",
]
