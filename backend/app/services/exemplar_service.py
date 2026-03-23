from __future__ import annotations

import server as legacy


async def submit_video_exemplar(
    video_id: str,
    payload: legacy.ExemplarSubmissionRequest,
    current_user: dict,
) -> legacy.ExemplarSubmissionResponse:
    return await legacy.submit_video_exemplar(video_id, payload, current_user)


async def get_exemplar_review_queue(current_user: dict) -> legacy.ExemplarReviewQueueResponse:
    return await legacy.get_exemplar_review_queue(current_user)


async def review_exemplar_submission(
    submission_id: str,
    payload: legacy.ExemplarLibraryReviewRequest,
    current_user: dict,
) -> legacy.ExemplarLibraryReviewResponse:
    return await legacy.review_exemplar_submission(submission_id, payload, current_user)


async def get_exemplar_library(
    subject: str | None,
    tag: str | None,
    request: legacy.Request | None,
    current_user: dict,
) -> legacy.ExemplarLibraryResponse:
    return await legacy.get_exemplar_library(subject, tag, request, current_user)


async def generate_social_card(
    video_id: str,
    payload: legacy.SocialCardRequest,
    current_user: dict,
) -> legacy.SocialCardResponse:
    return await legacy.generate_social_card(video_id, payload, current_user)


async def generate_email_signature(
    video_id: str,
    payload: legacy.EmailSignatureRequest,
    current_user: dict,
) -> legacy.EmailSignatureResponse:
    return await legacy.generate_email_signature(video_id, payload, current_user)
