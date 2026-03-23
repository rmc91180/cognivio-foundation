from __future__ import annotations

import server as legacy


VIDEO_PRIVACY_JOB_QUEUE = legacy.VIDEO_PRIVACY_JOB_QUEUE
VIDEO_PRIVACY_WORKER_TASKS = legacy.VIDEO_PRIVACY_WORKER_TASKS


async def run_video_privacy_job(video_id: str) -> None:
    await legacy._run_video_privacy_job(video_id)


async def video_privacy_worker(worker_label: str) -> None:
    await legacy._video_privacy_worker(worker_label)


async def start_privacy_workers() -> None:
    await legacy._start_privacy_workers()


async def rehydrate_video_privacy_queue() -> None:
    await legacy._rehydrate_video_privacy_queue()
