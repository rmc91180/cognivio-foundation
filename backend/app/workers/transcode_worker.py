from __future__ import annotations

import server as legacy


VIDEO_TRANSCODE_JOB_QUEUE = legacy.VIDEO_TRANSCODE_JOB_QUEUE
VIDEO_TRANSCODE_WORKER_TASKS = legacy.VIDEO_TRANSCODE_WORKER_TASKS


async def run_video_transcode_job(video_id: str) -> None:
    await legacy._run_video_transcode_job(video_id)


async def video_transcode_worker(worker_label: str) -> None:
    await legacy._video_transcode_worker(worker_label)


async def start_video_transcode_workers() -> None:
    await legacy._start_video_transcode_workers()


async def rehydrate_video_transcode_queue() -> None:
    await legacy._rehydrate_video_transcode_queue()
