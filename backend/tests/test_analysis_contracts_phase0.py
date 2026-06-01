"""WS1 Phase 0 — analysis contract / taxonomy / config tests + regression guard.

These tests prove three things:

  1. The new, PURE contract module enforces the frozen payload + moment shapes
     (``app/analysis/contracts.py``) — positive and negative cases.
  2. The analysis_mode taxonomy + typed-exception module
     (``app/analysis/failures.py``) is internally consistent and RECONCILED
     with the fallback literals ``server.py`` actually emits (no renames).
  3. Phase 0 changed NO analysis behavior: the OpenAI normalizer
     (``server._normalize_model_analysis``) returns output byte-for-byte equal
     to a golden fixture captured from the current code, and the new config
     fields default to the OpenAI path.

Nothing here calls a model, Gemini, or the network. ``server`` is imported only
inside the regression test so the rest of the module stays pure.
"""

from __future__ import annotations

import json
import os
import re

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import app.analysis.failures as failures
from app.analysis.contracts import (
    ANALYSIS_PAYLOAD_CONTRACT,
    MOMENT_CONTRACT,
    NEAR_ZERO_FEATURE_THRESHOLD,
    ValidationResult,
    validate_moment,
    validate_payload,
)
from app.config import Settings


HERE = os.path.dirname(__file__)
SERVER_PATH = os.path.abspath(os.path.join(HERE, "..", "server.py"))
CONTRACTS_PATH = os.path.abspath(os.path.join(HERE, "..", "app", "analysis", "contracts.py"))
FAILURES_PATH = os.path.abspath(os.path.join(HERE, "..", "app", "analysis", "failures.py"))
GOLDEN_PATH = os.path.join(HERE, "fixtures", "normalizer_golden_phase0.json")


# --------------------------------------------------------------------------- #
# Shared sample data (the regression golden is generated from these exact
# inputs by the __main__ block at the bottom of this file).
# --------------------------------------------------------------------------- #
def _elements_to_analyze():
    return [
        {"id": "2b", "name": "Questioning and Discussion Techniques", "domain": "Instruction", "priority": True},
        {"id": "3c", "name": "Engaging Students in Learning", "domain": "Instruction", "priority": False},
    ]


def _frames():
    return [{"timestamp_sec": 30.0}, {"timestamp_sec": 90.0}]


def _good_payload():
    """Mirrors the literal JSON shape from the _analyze_frames_with_openai prompt.

    Note: only element ``2b`` is scored; ``3c`` is intentionally absent so the
    normalizer's placeholder path is also exercised by the regression golden.
    """

    return {
        "summary": (
            "You opened with a clear hook and your students were ready to think. "
            "Let's build on the discussion you started early in the lesson."
        ),
        "recommendations": [
            {
                "start_sec": 90,
                "end_sec": 120,
                "text": "Next lesson, pause after your big question and count to five before taking an answer.",
                "linked_element_id": "2b",
            }
        ],
        "element_scores": [
            {
                "element_id": "2b",
                "score": 6.8,
                "confidence": 82,
                "observations": [
                    "When you asked the class to explain their thinking, three students built on each other's ideas."
                ],
                "evidence_segments": [
                    {
                        "start_sec": 90,
                        "end_sec": 120,
                        "summary": "You asked an open question and gave students room to respond.",
                        "rationale": "This shows you are opening space for student-led discussion.",
                    }
                ],
            }
        ],
    }


def _good_moment():
    return {
        "start_sec": 30.0,
        "end_sec": 52.0,
        "selection_reason": "participation_spike",
        "supporting_features": {
            "raw_selection_score": 0.72,
            "average_selection_score": 0.55,
            "participant_density_score": 0.41,
            "board_text_density_score": 0.12,
            "teacher_prominence_score": 0.33,
            "evidence_density_score": 0.28,
        },
        "representative_frame_valid": True,
        "window_valid": True,
        "text": "Three students debated whether the answer could be negative, citing the number line.",
    }


def _normalizer_output():
    import server  # local import keeps the rest of the module pure

    return server._normalize_model_analysis(
        _good_payload(),
        _elements_to_analyze(),
        _frames(),
        analysis_mode="openai",
        language="en",
    )


# =========================================================================== #
# STEP 4a — contract validators, positive
# =========================================================================== #
def test_good_payload_passes_validate_payload():
    result = validate_payload(_good_payload(), allowed_element_ids=["2b", "3c"])
    assert isinstance(result, ValidationResult)
    assert result.ok is True, result.errors
    assert result.errors == []
    assert bool(result) is True


def test_good_moment_passes_validate_moment():
    result = validate_moment(_good_moment())
    assert result.ok is True, result.errors
    assert result.errors == []


def test_contracts_are_documented_non_empty():
    assert ANALYSIS_PAYLOAD_CONTRACT["fields"]["element_scores"]["required"] is True
    assert "element_id" in ANALYSIS_PAYLOAD_CONTRACT["fields"]["element_scores"]["item_fields"]
    assert MOMENT_CONTRACT["fields"]["supporting_features"]["required"] is True


# =========================================================================== #
# STEP 4b — contract validators, negative (each a specific error)
# =========================================================================== #
def test_empty_element_scores_fails():
    payload = _good_payload()
    payload["element_scores"] = []
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert "empty_element_scores" in result.errors


def test_element_id_outside_allowed_set_fails():
    payload = _good_payload()
    payload["element_scores"][0]["element_id"] = "9z"
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert any(e.startswith("element_id_not_allowed:9z") for e in result.errors), result.errors


def test_missing_summary_fails():
    payload = _good_payload()
    payload.pop("summary")
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert "missing_summary" in result.errors


def test_blank_summary_fails():
    payload = _good_payload()
    payload["summary"] = "   "
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert "missing_summary" in result.errors


def test_evidence_segment_non_numeric_start_sec_fails():
    payload = _good_payload()
    payload["element_scores"][0]["evidence_segments"][0]["start_sec"] = "not-a-number"
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert any("non_numeric_start_sec" in e for e in result.errors), result.errors


def test_evidence_segment_negative_start_sec_fails():
    payload = _good_payload()
    payload["element_scores"][0]["evidence_segments"][0]["start_sec"] = -5
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert any("negative_start_sec" in e for e in result.errors), result.errors


def test_evidence_segment_end_before_start_fails():
    payload = _good_payload()
    seg = payload["element_scores"][0]["evidence_segments"][0]
    seg["start_sec"] = 100
    seg["end_sec"] = 90
    result = validate_payload(payload, allowed_element_ids=["2b", "3c"])
    assert result.ok is False
    assert any("end_sec_not_after_start_sec" in e for e in result.errors), result.errors


def test_payload_not_a_mapping_fails():
    result = validate_payload(["not", "a", "dict"], allowed_element_ids=["2b"])
    assert result.ok is False
    assert "payload_not_a_mapping" in result.errors


def test_moment_all_features_near_zero_is_fallback_shaped():
    moment = _good_moment()
    moment["supporting_features"] = {
        "raw_selection_score": 0.0,
        "average_selection_score": 0.01,
        "participant_density_score": 0.05,
        "board_text_density_score": 0.0,
        "teacher_prominence_score": 0.02,
    }
    result = validate_moment(moment)
    assert result.ok is False
    assert "fallback_shaped_all_features_near_zero" in result.errors


def test_moment_missing_supporting_features_fails():
    moment = _good_moment()
    moment.pop("supporting_features")
    result = validate_moment(moment)
    assert result.ok is False
    assert "missing_supporting_features" in result.errors


def test_moment_negative_start_sec_fails():
    moment = _good_moment()
    moment["start_sec"] = -1
    result = validate_moment(moment)
    assert result.ok is False
    assert "moment_negative_start_sec" in result.errors


def test_one_feature_above_threshold_is_not_fallback_shaped():
    moment = _good_moment()
    moment["supporting_features"] = {
        "raw_selection_score": NEAR_ZERO_FEATURE_THRESHOLD + 0.01,
        "average_selection_score": 0.0,
        "participant_density_score": 0.0,
        "board_text_density_score": 0.0,
        "teacher_prominence_score": 0.0,
    }
    result = validate_moment(moment)
    assert result.ok is True, result.errors


# =========================================================================== #
# STEP 4c — taxonomy
# =========================================================================== #
def test_success_modes_are_not_fallback():
    for mode in failures.SUCCESS_MODES:
        assert failures.is_fallback_mode(mode) is False, mode
        assert failures.is_success_mode(mode) is True, mode


def test_fallback_modes_are_fallback():
    for mode in failures.FALLBACK_MODES:
        assert failures.is_fallback_mode(mode) is True, mode
        assert failures.is_success_mode(mode) is False, mode


def test_gemini_modes_exist():
    assert "gemini" in failures.SUCCESS_MODES
    assert "gemini_multimodal" in failures.SUCCESS_MODES
    for mode in (
        "fallback_gemini_parse_error",
        "fallback_gemini_timeout",
        "fallback_gemini_rate_limited",
    ):
        assert mode in failures.FALLBACK_MODES, mode


def test_unknown_prefixed_fallback_is_caught():
    # Defensive: any future "fallback_*" literal must read as a fallback.
    assert failures.is_fallback_mode("fallback_something_new") is True


def test_terminal_modes_are_neither_success_nor_fallback():
    for mode in failures.TERMINAL_MODES:
        assert failures.is_success_mode(mode) is False
        assert failures.is_fallback_mode(mode) is False
        assert failures.is_terminal_mode(mode) is True


def test_existing_server_modes_membership_not_renamed():
    # Explicit membership assertion: every literal server.py emits today must
    # still be present (a rename would orphan persisted assessment docs).
    expected = {
        "openai",
        "openai_multimodal",
        "fallback",
        "fallback_model_error",
        "fallback_paid_analysis_disabled",
        "fallback_paid_analysis_not_allowed",
        "fallback_model_unconfigured",
        "unknown",
        "empty_selection",
        "failed_before_completion",
    }
    assert expected <= failures.ALL_ANALYSIS_MODES


def test_server_source_fallback_literals_are_all_in_taxonomy():
    # grep-based guard: scan the real server.py for fallback_mode = "..."
    # assignments and assert each literal exists in the taxonomy.
    with open(SERVER_PATH, encoding="utf-8") as fh:
        src = fh.read()
    found = set(re.findall(r'fallback_mode\s*=\s*"([^"]+)"', src))
    assert found, "expected to find fallback_mode assignments in server.py"
    missing = found - failures.ALL_ANALYSIS_MODES
    assert not missing, f"server.py emits fallback modes absent from taxonomy: {missing}"


def test_exception_hierarchy_defined_with_modes():
    assert issubclass(failures.AnalysisParseError, failures.AnalysisError)
    assert issubclass(failures.AnalysisContractError, failures.AnalysisError)
    assert issubclass(failures.AnalysisProviderError, failures.AnalysisError)
    # Each subclass carries a self-describing default fallback mode.
    assert failures.AnalysisParseError().analysis_mode == "fallback_parse_error"
    assert failures.AnalysisProviderError().analysis_mode == "fallback_model_error"
    # Explicit override is honored.
    err = failures.AnalysisError("boom", analysis_mode="fallback_gemini_timeout")
    assert err.analysis_mode == "fallback_gemini_timeout"
    assert failures.is_fallback_mode(err.analysis_mode) is True


# =========================================================================== #
# STEP 4d — config defaults / env loading
# =========================================================================== #
def test_analysis_provider_defaults_to_openai(monkeypatch):
    for var in ("ANALYSIS_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_VIDEO_INPUT_MODE"):
        monkeypatch.delenv(var, raising=False)
    settings = Settings.from_env()
    # Default state is byte-identical to pre-change behavior: provider == openai.
    assert settings.ai.analysis_provider == "openai"
    assert settings.ai.gemini_api_key == ""
    assert settings.ai.gemini_model == ""
    assert settings.ai.gemini_video_input_mode == "inline"


def test_gemini_fields_load_from_env(monkeypatch):
    monkeypatch.setenv("ANALYSIS_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-abc123")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
    monkeypatch.setenv("GEMINI_VIDEO_INPUT_MODE", "file_api")
    settings = Settings.from_env()
    assert settings.ai.analysis_provider == "gemini"
    assert settings.ai.gemini_api_key == "test-key-abc123"
    assert settings.ai.gemini_model == "gemini-2.0-flash"
    assert settings.ai.gemini_video_input_mode == "file_api"


def test_unset_provider_keeps_openai_even_when_gemini_key_present(monkeypatch):
    # A key being present must NOT silently flip the provider.
    monkeypatch.delenv("ANALYSIS_PROVIDER", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "present-but-unused")
    settings = Settings.from_env()
    assert settings.ai.analysis_provider == "openai"


# =========================================================================== #
# STEP 4e — normalizer regression golden (PROVES zero behavior change)
# =========================================================================== #
def test_normalizer_output_matches_golden():
    assert os.path.exists(GOLDEN_PATH), (
        "Golden fixture missing — regenerate with: "
        "python tests/test_analysis_contracts_phase0.py"
    )
    with open(GOLDEN_PATH, encoding="utf-8") as fh:
        golden = json.load(fh)
    assert _normalizer_output() == golden


def test_normalizer_drops_unknown_ids_and_placeholders_missing(monkeypatch):
    # Locks in the documented normalizer behavior: an element_id outside the
    # selection set is DROPPED, and a requested-but-unscored element gets a
    # placeholder score. (Confirms the contract invariants describe reality.)
    output = _normalizer_output()
    scored_ids = [s["element_id"] for s in output["element_scores"]]
    assert scored_ids == ["2b", "3c"]  # 2b from model, 3c placeholder
    placeholder = next(s for s in output["element_scores"] if s["element_id"] == "3c")
    assert placeholder["confidence"] == 25.0
    assert placeholder["evidence_segments"][0]["rationale"] == "fallback"


# =========================================================================== #
# STEP 4f — import safety / purity (static check)
# =========================================================================== #
_FORBIDDEN_IMPORT_RE = re.compile(
    r"^\s*(?:import|from)\s+(motor|pymongo|openai|google|genai|requests|httpx|aiohttp|boto3|server)\b",
    re.MULTILINE,
)


def test_contracts_module_has_no_network_or_db_imports():
    with open(CONTRACTS_PATH, encoding="utf-8") as fh:
        src = fh.read()
    forbidden = _FORBIDDEN_IMPORT_RE.findall(src)
    assert not forbidden, f"contracts.py must stay pure; found imports: {forbidden}"


def test_failures_module_has_no_network_or_db_imports():
    with open(FAILURES_PATH, encoding="utf-8") as fh:
        src = fh.read()
    forbidden = _FORBIDDEN_IMPORT_RE.findall(src)
    assert not forbidden, f"failures.py must stay pure; found imports: {forbidden}"


def test_contracts_module_imports_with_no_side_effects():
    # Re-importing must not require env / DB / network. A fresh import in a
    # subprocess-free manner: importlib.reload keeps it honest.
    import importlib

    import app.analysis.contracts as contracts_mod

    importlib.reload(contracts_mod)
    assert hasattr(contracts_mod, "validate_payload")
    assert hasattr(contracts_mod, "validate_moment")


# --------------------------------------------------------------------------- #
# Golden generator (run manually; not collected by pytest):
#   python tests/test_analysis_contracts_phase0.py
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    os.makedirs(os.path.dirname(GOLDEN_PATH), exist_ok=True)
    output = _normalizer_output()
    with open(GOLDEN_PATH, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote golden fixture: {GOLDEN_PATH}")
