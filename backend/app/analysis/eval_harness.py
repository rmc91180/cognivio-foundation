from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import types
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

DIMENSIONS = (
    "specificity",
    "evidence_grounding",
    "usefulness",
    "modality_discipline",
)


def _default_gold_set_path() -> Path:
    return Path(__file__).resolve().parents[2] / "evals" / "analysis_gold_set.json"


def _stub_optional_dependencies() -> None:
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "cognivio_test")
    os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
    os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://api.example.com")

    if "boto3" not in sys.modules:
        boto3_stub = types.ModuleType("boto3")

        class _Session:
            def client(self, *args, **kwargs):
                return object()

        boto3_stub.session = types.SimpleNamespace(Session=_Session)
        sys.modules["boto3"] = boto3_stub

    if "botocore.exceptions" not in sys.modules:
        botocore_stub = types.ModuleType("botocore")
        botocore_exceptions_stub = types.ModuleType("botocore.exceptions")

        class _BotoCoreError(Exception):
            pass

        class _ClientError(Exception):
            pass

        botocore_exceptions_stub.BotoCoreError = _BotoCoreError
        botocore_exceptions_stub.ClientError = _ClientError
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = botocore_exceptions_stub


@lru_cache(maxsize=1)
def load_server_module():
    _stub_optional_dependencies()
    module_path = Path(__file__).resolve().parents[2] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_eval_harness", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def load_gold_set(path: Optional[Path] = None) -> Dict[str, Any]:
    gold_set_path = Path(path or _default_gold_set_path())
    with gold_set_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _render_output_text(output: Any, output_key: Optional[str] = None, output_keys: Optional[List[str]] = None) -> str:
    value = output
    if output_keys and isinstance(output, dict):
        parts: List[str] = []
        for key in output_keys:
            part = output.get(key)
            if isinstance(part, list):
                parts.extend(str(item) for item in part)
            elif part not in (None, ""):
                parts.append(str(part))
        value = "\n".join(parts)
    elif output_key and isinstance(output, dict):
        value = output.get(output_key)

    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value or "")


def _evaluate_dimension(text: str, checks: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    checks = checks or {}
    passed_checks = 0
    total_checks = 0
    failures: List[str] = []

    for phrase in checks.get("includes", []):
        total_checks += 1
        if phrase in text:
            passed_checks += 1
        else:
            failures.append(f'missing "{phrase}"')

    for phrase in checks.get("excludes", []):
        total_checks += 1
        if phrase not in text:
            passed_checks += 1
        else:
            failures.append(f'unexpected "{phrase}"')

    for pattern in checks.get("regex", []):
        total_checks += 1
        if re.search(pattern, text, flags=re.MULTILINE):
            passed_checks += 1
        else:
            failures.append(f"missing pattern /{pattern}/")

    for pattern in checks.get("not_regex", []):
        total_checks += 1
        if not re.search(pattern, text, flags=re.MULTILINE):
            passed_checks += 1
        else:
            failures.append(f"unexpected pattern /{pattern}/")

    if total_checks == 0:
        return {
            "score": 5,
            "passed": True,
            "passed_checks": 0,
            "total_checks": 0,
            "failures": [],
        }

    ratio = passed_checks / total_checks
    if ratio == 1:
        score = 5
    elif ratio >= 0.5:
        score = 3
    else:
        score = 1

    return {
        "score": score,
        "passed": passed_checks == total_checks,
        "passed_checks": passed_checks,
        "total_checks": total_checks,
        "failures": failures,
    }


def _run_case(case: Dict[str, Any], server_module: Any) -> Any:
    kind = case["kind"]
    payload = case.get("input", {})

    if kind == "summary":
        return server_module.generate_summary(
            payload.get("element_scores", []),
            payload.get("overall_score", 0.0),
            provided_summary=payload.get("provided_summary"),
            priority_element_ids=payload.get("priority_element_ids"),
            focus_note=payload.get("focus_note"),
            language=payload.get("language", case.get("language", "en")),
            analysis_context=payload.get("analysis_context"),
            analysis_confidence=payload.get("analysis_confidence"),
        )
    if kind == "recommendations":
        return server_module.generate_recommendations(
            payload.get("element_scores", []),
            provided_recommendations=payload.get("provided_recommendations"),
            priority_element_ids=payload.get("priority_element_ids"),
            focus_note=payload.get("focus_note"),
            language=payload.get("language", case.get("language", "en")),
            analysis_context=payload.get("analysis_context"),
            analysis_confidence=payload.get("analysis_confidence"),
        )
    if kind == "packet":
        return server_module.build_observation_summary_packet(
            payload.get("element_scores", []),
            payload.get("overall_score", 0.0),
            payload.get("summary_text", ""),
            payload.get("recommendations", []),
            priority_element_ids=payload.get("priority_element_ids"),
            focus_note=payload.get("focus_note"),
            analysis_confidence=payload.get("analysis_confidence"),
            analysis_context=payload.get("analysis_context"),
            provided_recommendations=payload.get("provided_recommendations"),
            language=payload.get("language", case.get("language", "en")),
        )
    raise ValueError(f"Unsupported evaluation case kind: {kind}")


def evaluate_case(case: Dict[str, Any], server_module: Optional[Any] = None) -> Dict[str, Any]:
    module = server_module or load_server_module()
    output = _run_case(case, module)
    output_text = _render_output_text(
        output,
        output_key=case.get("output_key"),
        output_keys=case.get("output_keys"),
    )

    dimension_results: Dict[str, Dict[str, Any]] = {}
    thresholds = case.get("thresholds", {})
    for dimension in DIMENSIONS:
        result = _evaluate_dimension(output_text, (case.get("checks") or {}).get(dimension))
        dimension_results[dimension] = result

    failed_dimensions = [
        dimension
        for dimension, result in dimension_results.items()
        if result["score"] < int(thresholds.get(dimension, 3))
    ]

    return {
        "id": case.get("id"),
        "description": case.get("description"),
        "kind": case.get("kind"),
        "language": case.get("language", "en"),
        "passed": not failed_dimensions,
        "failed_dimensions": failed_dimensions,
        "dimensions": dimension_results,
        "output_text": output_text,
        "output": output,
    }


def evaluate_gold_set(path: Optional[Path] = None) -> Dict[str, Any]:
    gold_set = load_gold_set(path)
    server_module = load_server_module()
    results = [evaluate_case(case, server_module=server_module) for case in gold_set.get("cases", [])]
    passed_count = sum(1 for item in results if item["passed"])
    return {
        "version": gold_set.get("version"),
        "gold_set_path": str(Path(path or _default_gold_set_path())),
        "case_count": len(results),
        "passed_count": passed_count,
        "failed_count": len(results) - passed_count,
        "passed": passed_count == len(results),
        "results": results,
    }


def format_report(report: Dict[str, Any]) -> str:
    lines = [
        "Cognivio Analysis Eval Harness",
        f"Gold set: {report['gold_set_path']}",
        f"Version: {report.get('version') or 'unknown'}",
        f"Cases: {report['passed_count']}/{report['case_count']} passed",
        "",
    ]
    for result in report.get("results", []):
        status = "PASS" if result["passed"] else "FAIL"
        lines.append(f"[{status}] {result['id']} ({result['kind']}, {result['language']})")
        if result.get("description"):
            lines.append(f"  {result['description']}")
        for dimension in DIMENSIONS:
            dimension_result = result["dimensions"][dimension]
            suffix = ""
            if dimension_result["failures"]:
                suffix = f" -> {', '.join(dimension_result['failures'])}"
            lines.append(
                f"  - {dimension}: {dimension_result['score']}/5 "
                f"({dimension_result['passed_checks']}/{dimension_result['total_checks']} checks){suffix}"
            )
        preview = result["output_text"].strip().replace("\n", " ")
        if len(preview) > 220:
            preview = f"{preview[:217]}..."
        if preview:
            lines.append(f"  Output: {preview}")
        lines.append("")
    return "\n".join(lines).rstrip()
