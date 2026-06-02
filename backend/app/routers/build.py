"""Build-identity endpoint (diagnostic).

``GET /__build`` returns the running git SHA + handler-file identity so we can
confirm exactly which build/handler a deploy is actually serving — so we never
debug a stale deploy blind again. GIT_SHA is injected at image build time
(Dockerfile ARG/ENV) and/or as a Railway service variable; it defaults to
"unknown" when unset.

Mounted on the live app (``server:app``) the same way the other
``app/routers/*`` routers are included.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter()


@router.get("/__build")
async def build_identity() -> dict:
    return {
        "git_sha": os.environ.get("GIT_SHA", "unknown"),
        "service": "backend",
        "handler_file": "app/services/video_service.py",
    }
