from __future__ import annotations

import json
import os
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analysis.eval_harness import QUALITY_THRESHOLDS, run_quality_gate  # noqa: E402


def _max_cases_from_env() -> int | None:
    raw_value = os.getenv("EVAL_GOLD_SET_MAX_CASES", "").strip()
    if not raw_value:
        return None
    try:
        parsed = int(raw_value)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _print_report(report: dict) -> None:
    print("Cognivio AI Quality Gate")
    print(f"Cases: {report.get('case_count', 0)}")
    print("")
    print("Dimension              Score  Threshold  Status")
    print("--------------------  -----  ---------  ------")
    for dimension, threshold in QUALITY_THRESHOLDS.items():
        score = float((report.get("scores") or {}).get(dimension, 0.0))
        status = "PASS" if score >= threshold else "FAIL"
        print(f"{dimension:<20}  {score:>5.2f}  {threshold:>9.2f}  {status}")
    if report.get("failures"):
        print("")
        print("Failures")
        for failure in report["failures"]:
            print(
                "- {case_id}: {dimension} {score:.2f} < {threshold:.2f}".format(
                    **failure
                )
            )
    if report.get("banned_phrases"):
        print("")
        print("Banned phrase detections")
        for item in report["banned_phrases"]:
            print(f"- {item['case_id']}: {item['phrase']}")


def main() -> int:
    gold_set_path = Path(os.getenv("EVAL_GOLD_SET_PATH", "")).resolve() if os.getenv("EVAL_GOLD_SET_PATH") else None
    report = run_quality_gate(path=gold_set_path, max_cases=_max_cases_from_env())
    _print_report(report)
    if os.getenv("EVAL_QUALITY_GATE_JSON"):
        print(json.dumps({k: v for k, v in report.items() if k != "results"}, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
