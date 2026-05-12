import asyncio
from datetime import datetime, timedelta, timezone

import server


async def main() -> None:
    now = datetime.now(timezone.utc)
    stale_before = (now - timedelta(minutes=10)).isoformat()
    result = await server.db.video_processing_jobs.update_many(
        {
            "status": server.VideoProcessingStatus.PROCESSING.value,
            "$or": [
                {"last_heartbeat": {"$lt": stale_before}},
                {"last_heartbeat": {"$exists": False}},
            ],
        },
        {
            "$set": {
                "status": server.VideoProcessingStatus.QUEUED.value,
                "claimed_by": None,
                "claimed_at": None,
                "updated_at": now.isoformat(),
                "last_error": "Re-queued by stale worker monitor.",
            }
        },
    )
    queue_depth = await server.db.video_processing_jobs.count_documents(
        {"status": server.VideoProcessingStatus.QUEUED.value}
    )
    if queue_depth > 20:
        subject = "Cognivio video queue needs attention"
        body = f"The video processing queue depth is {queue_depth}. {result.modified_count} stale jobs were re-queued."
        for email in server.SUPER_ADMIN_EMAILS:
            server._send_platform_email(subject, email, body)
    print({"stale_requeued": result.modified_count, "queue_depth": queue_depth})


if __name__ == "__main__":
    asyncio.run(main())
