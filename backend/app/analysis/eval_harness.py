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

from app.analysis.voice_gate import BANNED_PHRASES, validate_payload_text

DIMENSIONS = (
    "specificity",
    "evidence_grounding",
    "usefulness",
    "modality_discipline",
    "coach_voice",
)

QUALITY_THRESHOLDS = {
    "specificity": 0.70,
    "evidence_grounding": 0.75,
    "usefulness": 0.72,
    "modality_discipline": 0.65,
    "coach_voice": 0.80,
}

COACH_VOICE_RUBRIC = (
    "Addresses the teacher directly as you/your when the text is teacher-facing.",
    "References at least one specific visible moment when available.",
    "Contains no banned clinical/system language.",
    "Reads naturally aloud.",
    "Makes recommendations doable in the next lesson.",
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


def check_banned_phrases(assessment_text: str) -> Dict[str, Any]:
    lowered = str(assessment_text or "").lower()
    banned_found = [phrase for phrase in BANNED_PHRASES if phrase in lowered]
    return {
        "banned_found": banned_found,
        "coach_voice_penalty": min(1.0, 0.1 * len(banned_found)),
    }


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


def _evaluate_coach_voice(text: str, output: Any, language: str = "en") -> Dict[str, Any]:
    banned_result = check_banned_phrases(text)
    payload_issues = validate_payload_text(
        output,
        language=language,
        require_direct_address=False,
        visible_only=True,
    )
    third_person_issues = [
        issue for issue in payload_issues
        if issue.get("issue_type") in {"third_person_teacher_voice", "summary_starts_with_the_teacher"}
    ]
    penalty = float(banned_result["coach_voice_penalty"]) + (0.1 * len(third_person_issues))
    normalized = max(0.0, min(1.0, 1.0 - penalty))
    score = round(normalized * 5)
    failures = []
    for phrase in banned_result["banned_found"]:
        failures.append(f'banned phrase "{phrase}"')
    for issue in third_person_issues:
        failures.append(f"{issue.get('issue_type')} at {issue.get('path')}")
    return {
        "score": score,
        "normalized_score": round(normalized, 3),
        "passed": normalized >= QUALITY_THRESHOLDS["coach_voice"],
        "passed_checks": 0 if failures else 1,
        "total_checks": 1,
        "failures": failures,
        "banned_found": banned_result["banned_found"],
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
        )
    if kind == "recommendations":
        return server_module.generate_recommendations(
            payload.get("element_scores", []),
            provided_recommendations=payload.get("provided_recommendations"),
            priority_element_ids=payload.get("priority_element_ids"),
            focus_note=payload.get("focus_note"),
            language=payload.get("language", case.get("language", "en")),
            analysis_context=payload.get("analysis_context"),
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
        if dimension == "coach_voice":
            result = _evaluate_coach_voice(output_text, output, case.get("language", "en"))
        else:
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


def _limit_gold_set(gold_set: Dict[str, Any], max_cases: Optional[int]) -> Dict[str, Any]:
    if not max_cases or max_cases <= 0:
        return gold_set
    limited = dict(gold_set)
    limited["cases"] = list(gold_set.get("cases", []))[:max_cases]
    return limited


def _normalized_dimension_score(result: Dict[str, Any], dimension: str) -> float:
    value = result["dimensions"][dimension].get("normalized_score")
    if value is not None:
        return float(value)
    score = float(result["dimensions"][dimension].get("score", 0))
    if score >= 5:
        return 1.0
    if score >= 3:
        return 0.75
    if score >= 1:
        return 0.2
    return 0.0


def run_quality_gate(path: Optional[Path] = None, max_cases: Optional[int] = None) -> Dict[str, Any]:
    gold_set = _limit_gold_set(load_gold_set(path), max_cases)
    server_module = load_server_module()
    results = [evaluate_case(case, server_module=server_module) for case in gold_set.get("cases", [])]
    scores: Dict[str, float] = {}
    failures: List[Dict[str, Any]] = []
    banned_phrases: List[Dict[str, str]] = []

    for dimension in QUALITY_THRESHOLDS:
        values = [_normalized_dimension_score(result, dimension) for result in results]
        scores[dimension] = round(sum(values) / len(values), 3) if values else 0.0

    for result in results:
        for dimension, threshold in QUALITY_THRESHOLDS.items():
            score = _normalized_dimension_score(result, dimension)
            if score < threshold:
                failures.append(
                    {
                        "case_id": result.get("id"),
                        "dimension": dimension,
                        "score": score,
                        "threshold": threshold,
                    }
                )
        for phrase in result["dimensions"].get("coach_voice", {}).get("banned_found", []):
            banned_phrases.append({"case_id": result.get("id"), "phrase": phrase})

    return {
        "passed": len(failures) == 0,
        "scores": scores,
        "thresholds": dict(QUALITY_THRESHOLDS),
        "failures": failures,
        "banned_phrases": banned_phrases,
        "case_count": len(results),
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
