from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional


FIVE_STAR_BADGE = "five_star_lesson"
DEFAULT_FIVE_STAR_SCORE_MIN = 9.0


def build_recognition_eligibility(
    video: Optional[dict],
    assessment: Optional[dict],
    score_threshold: float = DEFAULT_FIVE_STAR_SCORE_MIN,
) -> Dict[str, Any]:
    reasons: List[str] = []
    video = video or {}
    assessment = assessment or {}

    if (video.get("privacy_status") or "").lower() != "completed":
        reasons.append("privacy_not_completed")
    if (video.get("analysis_status") or "").lower() != "completed":
        reasons.append("analysis_not_completed")

    overall_score = assessment.get("overall_score")
    if overall_score is None:
        reasons.append("missing_assessment")
    elif float(overall_score) < float(score_threshold):
        reasons.append("score_below_threshold")

    return {
        "is_eligible": len(reasons) == 0,
        "badge_type": FIVE_STAR_BADGE if len(reasons) == 0 else None,
        "reasons": reasons,
        "criteria_snapshot": {
            "overall_score": float(overall_score) if overall_score is not None else None,
            "score_threshold": float(score_threshold),
            "privacy_status": video.get("privacy_status"),
            "analysis_status": video.get("analysis_status"),
        },
    }


def calculate_active_streak(badges: List[dict]) -> int:
    awarded = [
        badge for badge in badges
        if badge.get("status") == "awarded" and badge.get("badge_type") == FIVE_STAR_BADGE
    ]
    if not awarded:
        return 0

    awarded.sort(
        key=lambda badge: (
            badge.get("awarded_at") or badge.get("created_at") or "",
            badge.get("id") or "",
        )
    )
    streak = 0
    previous_dt: Optional[datetime] = None
    for badge in awarded:
        streak += 1
        raw_dt = badge.get("awarded_at") or badge.get("created_at")
        if raw_dt:
            try:
                previous_dt = datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
            except ValueError:
                previous_dt = previous_dt
    return streak
