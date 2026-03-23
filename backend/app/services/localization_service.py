from __future__ import annotations

import server as legacy


def resolve_request_language(request: legacy.Request, default: str = "en") -> str:
    return legacy._resolve_request_language(request, default=default)


def enrich_assessment_for_response(assessment: dict, response_language: str) -> dict:
    return legacy._enrich_assessment_for_response(assessment, response_language=response_language)
