import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analysis.eval_harness import evaluate_gold_set, evaluate_voice_gate_gold_set  # noqa: E402


def test_default_analysis_gold_set_passes():
    report = evaluate_gold_set()

    assert report["case_count"] >= 9
    assert report["failed_count"] == 0
    assert report["passed"] is True


def test_default_voice_gate_gold_set_passes():
    report = evaluate_voice_gate_gold_set()

    assert report["case_count"] >= 6
    assert report["failed_count"] == 0
    assert report["passed"] is True
