from __future__ import annotations

import server as legacy


VIDEO_JOB_QUEUE = legacy.VIDEO_JOB_QUEUE
VIDEO_WORKER_TASKS = legacy.VIDEO_WORKER_TASKS


async def run_video_job(video_id: str) -> None:
    await legacy._run_video_job(video_id)


async def video_processing_worker(worker_label: str) -> None:
    await legacy._video_processing_worker(worker_label)


async def start_video_workers() -> None:
    await legacy._start_video_workers()


async def stop_video_workers() -> None:
    await legacy._stop_video_workers()


async def rehydrate_video_processing_queue() -> None:
    await legacy._rehydrate_video_processing_queue()
