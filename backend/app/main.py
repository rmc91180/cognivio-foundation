from __future__ import annotations

from server import app as legacy_app

from . import observability
from .config import get_settings
from .routers import REGISTERED_ROUTERS
from .workers import (
    maintenance_worker,
    privacy_worker,
    video_worker,
)


def create_app():
    app = legacy_app
    app.state.settings = get_settings()
    app.state.router_registry = REGISTERED_ROUTERS
    app.state.observability = observability
    app.state.worker_registry = (
        {
            "name": "video_workers",
            "module": "app.workers.video_worker",
            "queue": "VIDEO_JOB_QUEUE",
            "status": "bridged",
        },
        {
            "name": "privacy_workers",
            "module": "app.workers.privacy_worker",
            "queue": "VIDEO_PRIVACY_JOB_QUEUE",
            "status": "bridged",
        },
        {
            "name": "maintenance_worker",
            "module": "app.workers.maintenance_worker",
            "task_group": "PRIVACY_MAINTENANCE_TASKS",
            "status": "bridged",
        },
    )
    app.state.worker_modules = {
        "video": video_worker,
        "privacy": privacy_worker,
        "maintenance": maintenance_worker,
    }
    return app


app = create_app()
