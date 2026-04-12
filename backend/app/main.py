from __future__ import annotations

import logging

from fastapi import Response

import server as legacy_server

from . import metrics, observability
from .config import get_settings
from .routers import REGISTERED_ROUTERS
from .workers import (
    maintenance_worker,
    privacy_worker,
    transcode_worker,
    video_worker,
)


logger = logging.getLogger(__name__)


def create_app():
    app = legacy_server.app
    app.state.settings = get_settings()
    app.state.router_registry = REGISTERED_ROUTERS
    app.state.observability = observability
    app.state.metrics = metrics
    app.state.worker_registry = (
        {
            "name": "video_transcode_workers",
            "module": "app.workers.transcode_worker",
            "queue": "VIDEO_TRANSCODE_JOB_QUEUE",
            "status": "bridged",
        },
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
        "transcode": transcode_worker,
        "video": video_worker,
        "privacy": privacy_worker,
        "maintenance": maintenance_worker,
    }
    metrics_routes = getattr(app.state, "metrics_routes_registered", set())
    if "metrics_endpoint" not in metrics_routes:
        @app.get("/metrics", include_in_schema=False)
        async def prometheus_metrics() -> Response:
            if hasattr(legacy_server, "refresh_runtime_metrics"):
                try:
                    await legacy_server.refresh_runtime_metrics()
                except Exception as exc:
                    logger.warning("Metrics refresh degraded; serving existing registry snapshot: %s", exc)
            return Response(
                content=metrics.render_latest(),
                media_type=metrics.content_type(),
            )

        metrics_routes = set(metrics_routes)
        metrics_routes.add("metrics_endpoint")
        app.state.metrics_routes_registered = metrics_routes
    return app


app = create_app()
