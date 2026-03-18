from pathlib import Path
import importlib.util


def _load_recognition_engine():
    module_path = Path(__file__).resolve().parents[1] / "recognition_engine.py"
    spec = importlib.util.spec_from_file_location("backend_recognition_engine", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


recognition_engine = _load_recognition_engine()


def test_build_recognition_eligibility_requires_privacy_analysis_and_threshold():
    result = recognition_engine.build_recognition_eligibility(
        {"privacy_status": "completed", "analysis_status": "completed"},
        {"overall_score": 9.3},
        score_threshold=9.0,
    )

    assert result["is_eligible"] is True
    assert result["badge_type"] == recognition_engine.FIVE_STAR_BADGE
    assert result["reasons"] == []
    assert result["criteria_snapshot"]["overall_score"] == 9.3


def test_build_recognition_eligibility_returns_reasons_when_not_ready():
    result = recognition_engine.build_recognition_eligibility(
        {"privacy_status": "processing", "analysis_status": "queued"},
        {"overall_score": 8.6},
        score_threshold=9.0,
    )

    assert result["is_eligible"] is False
    assert result["badge_type"] is None
    assert "privacy_not_completed" in result["reasons"]
    assert "analysis_not_completed" in result["reasons"]
    assert "score_below_threshold" in result["reasons"]


def test_calculate_active_streak_counts_awarded_five_star_badges():
    badges = [
        {"id": "badge_1", "badge_type": recognition_engine.FIVE_STAR_BADGE, "status": "awarded", "awarded_at": "2026-03-15T10:00:00Z"},
        {"id": "badge_2", "badge_type": recognition_engine.FIVE_STAR_BADGE, "status": "awarded", "awarded_at": "2026-03-16T10:00:00Z"},
        {"id": "badge_3", "badge_type": "exemplar_published", "status": "published", "awarded_at": "2026-03-17T10:00:00Z"},
    ]

    assert recognition_engine.calculate_active_streak(badges) == 2
