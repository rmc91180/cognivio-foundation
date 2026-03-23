from __future__ import annotations

import server as legacy


PRIVACY_MAINTENANCE_TASKS = legacy.PRIVACY_MAINTENANCE_TASKS


async def purge_expired_privacy_artifacts() -> None:
    await legacy._purge_expired_privacy_artifacts()


async def privacy_maintenance_worker() -> None:
    await legacy._privacy_maintenance_worker()


async def start_privacy_maintenance_tasks() -> None:
    await legacy._start_privacy_maintenance_tasks()
