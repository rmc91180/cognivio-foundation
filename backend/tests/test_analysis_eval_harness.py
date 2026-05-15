import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analysis.eval_harness import (  # noqa: E402
    QUALITY_THRESHOLDS,
    check_banned_phrases,
    run_quality_gate,
)
from app.analysis import eval_harness  # noqa: E402
from scripts import run_quality_gate as run_quality_gate_script  # noqa: E402
import server  # noqa: E402


def test_default_analysis_gold_set_passes():
    report = eval_harness.evaluate_gold_set()

    assert report["case_count"] >= 9
    assert report["failed_count"] == 0
    assert report["passed"] is True


def test_quality_thresholds_include_coach_voice():
    assert QUALITY_THRESHOLDS["coach_voice"] == 0.80
    assert set(QUALITY_THRESHOLDS) == {
        "specificity",
        "evidence_grounding",
        "usefulness",
        "modality_discipline",
        "coach_voice",
    }


def test_banned_phrase_check_penalizes_coach_voice():
    result = check_banned_phrases("The teacher used a rubric element in this segment.")

    assert "the teacher used" in result["banned_found"]
    assert "rubric element" in result["banned_found"]
    assert result["coach_voice_penalty"] >= 0.2


def test_quality_gate_reports_failure_shape(monkeypatch):
    monkeypatch.setattr(eval_harness, "load_gold_set", lambda path=None: {"cases": [{"id": "case-1", "kind": "summary", "input": {}}]})
    monkeypatch.setattr(eval_harness, "load_server_module", lambda: object())
    monkeypatch.setattr(
        eval_harness,
        "evaluate_case",
        lambda case, server_module=None: {
            "id": case["id"],
            "dimensions": {
                "specificity": {"score": 5},
                "evidence_grounding": {"score": 5},
                "usefulness": {"score": 5},
                "modality_discipline": {"score": 5},
                "coach_voice": {"normalized_score": 0.5, "banned_found": ["rubric element"]},
            },
        },
    )

    report = run_quality_gate()

    assert report["passed"] is False
    assert report["failures"] == [
        {"case_id": "case-1", "dimension": "coach_voice", "score": 0.5, "threshold": 0.8}
    ]
    assert report["banned_phrases"] == [{"case_id": "case-1", "phrase": "rubric element"}]


def test_quality_gate_limits_cases(monkeypatch):
    seen = []
    monkeypatch.setattr(
        eval_harness,
        "load_gold_set",
        lambda path=None: {"cases": [{"id": f"case-{idx}", "kind": "summary", "input": {}} for idx in range(4)]},
    )
    monkeypatch.setattr(eval_harness, "load_server_module", lambda: object())

    def _evaluate(case, server_module=None):
        seen.append(case["id"])
        return {
            "id": case["id"],
            "dimensions": {
                "specificity": {"score": 5},
                "evidence_grounding": {"score": 5},
                "usefulness": {"score": 5},
                "modality_discipline": {"score": 5},
                "coach_voice": {"normalized_score": 1.0, "banned_found": []},
            },
        }

    monkeypatch.setattr(eval_harness, "evaluate_case", _evaluate)

    report = run_quality_gate(max_cases=2)

    assert report["passed"] is True
    assert report["case_count"] == 2
    assert seen == ["case-0", "case-1"]


def test_quality_gate_script_exits_nonzero_on_failure(monkeypatch, capsys):
    monkeypatch.setenv("EVAL_GOLD_SET_MAX_CASES", "1")
    monkeypatch.setattr(
        run_quality_gate_script,
        "run_quality_gate",
        lambda path=None, max_cases=None: {
            "passed": False,
            "case_count": max_cases,
            "scores": {dimension: 0.0 for dimension in QUALITY_THRESHOLDS},
            "failures": [{"case_id": "case-1", "dimension": "coach_voice", "score": 0.0, "threshold": 0.8}],
            "banned_phrases": [],
        },
    )

    assert run_quality_gate_script.main() == 1
    assert "coach_voice" in capsys.readouterr().out


def test_quality_gate_script_exits_zero_on_pass(monkeypatch):
    monkeypatch.delenv("EVAL_GOLD_SET_PATH", raising=False)
    monkeypatch.setattr(
        run_quality_gate_script,
        "run_quality_gate",
        lambda path=None, max_cases=None: {
            "passed": True,
            "case_count": 1,
            "scores": dict(QUALITY_THRESHOLDS),
            "failures": [],
            "banned_phrases": [],
        },
    )

    assert run_quality_gate_script.main() == 0


def test_ai_quality_history_missing_file_returns_no_data(tmp_path):
    assert server._read_ai_quality_history(tmp_path / "missing.json") == []
    assert server._empty_ai_quality_eval_snapshot()["no_data"] is True


def test_ai_quality_history_is_sanitized(tmp_path):
    path = tmp_path / "quality_history.json"
    path.write_text(
        """
        {
          "runs": [
            {
              "run_at": "2026-05-15T10:00:00Z",
              "git_sha": "abcdef1234567890abcdef1234567890abcdef12SECRET",
              "triggered_by": "CI",
              "scores": {"coach_voice": 0.91, "unknown": 1},
              "thresholds": {"coach_voice": 0.8},
              "passed": true,
              "failures": [],
              "banned_phrases": [{"case_id": "case-1", "phrase": "rubric element", "secret": "x"}]
            }
          ]
        }
        """,
        encoding="utf-8",
    )

    history = server._read_ai_quality_history(path)

    assert history[0]["git_sha"] == "abcdef1234567890abcdef1234567890abcdef12"
    assert history[0]["scores"] == {"coach_voice": 0.91}
    assert history[0]["banned_phrases"] == [{"case_id": "case-1", "phrase": "rubric element"}]
