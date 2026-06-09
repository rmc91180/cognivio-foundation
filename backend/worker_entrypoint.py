import asyncio
import logging
import signal

import server


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cognivio.worker")


async def main() -> None:
    stop_event = asyncio.Event()

    def _stop(*_args):
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)
    except Exception:
        pass

    logger.info("Starting Cognivio video worker service")
    await server._ensure_database_indexes()
    await server._rehydrate_video_transcode_queue()
    await server._rehydrate_video_privacy_queue()
    await server._rehydrate_video_processing_queue()
    await server._start_video_transcode_workers()
    await server._start_privacy_workers()
    await server._start_video_workers()
    await server._start_video_reclaimer()  # A2 GAP 2: live stale-job reclaimer loop
    await stop_event.wait()
    logger.info("Stopping Cognivio video worker service")
    await server._stop_video_workers()


if __name__ == "__main__":
    asyncio.run(main())
