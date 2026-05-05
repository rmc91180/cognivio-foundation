from __future__ import annotations

from server import api_router

from .assessments import router as assessments_router
from .auth import router as auth_router
from .exemplars import router as exemplars_router
from .privacy import router as privacy_router
from .profile_cleanup import router as profile_cleanup_router
from .recognition import router as recognition_router
from .teachers import router as teachers_router
from .videos import router as videos_router

REGISTERED_ROUTERS = (
    {
        "name": "legacy_api_router",
        "prefix": "/api",
        "router": api_router,
        "status": "bridged",
    },
    {
        "name": "auth_router",
        "prefix": "/api",
        "router": auth_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "teachers_router",
        "prefix": "/api",
        "router": teachers_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "videos_router",
        "prefix": "/api",
        "router": videos_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "assessments_router",
        "prefix": "/api",
        "router": assessments_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "privacy_router",
        "prefix": "/api",
        "router": privacy_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "recognition_router",
        "prefix": "/api",
        "router": recognition_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "exemplars_router",
        "prefix": "/api",
        "router": exemplars_router,
        "status": "extracted_unmounted",
    },
    {
        "name": "profile_cleanup_router",
        "prefix": "/api",
        "router": profile_cleanup_router,
        "status": "mounted",
    },
)
