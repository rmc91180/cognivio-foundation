from __future__ import annotations

from typing import Optional

import server as legacy


async def ensure_assessment_evidence(assessment: dict, current_user: dict):
    return await legacy._ensure_mock_evidence(assessment, current_user)


async def get_curriculum_adherence_payload(assessment_id: str, current_user: dict):
    return await legacy.get_curriculum_adherence(assessment_id, current_user)


async def get_assessment_for_video(video_id: str) -> Optional[dict]:
    return await legacy._get_assessment_for_video(video_id)
