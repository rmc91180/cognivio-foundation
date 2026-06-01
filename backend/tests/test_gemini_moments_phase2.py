"""WS1 Phase 2 — Gemini moment-path integration (Option A, honest gate).

The CORE proof is the contrast between :func:`test_honest_pass` and
:func:`test_honest_fail`: both run the derived moments through the REAL,
UNCHANGED quality gate (``compute_moment_quality`` / ``compute_assessment_quality``
imported directly, never mocked). Specific, confident Gemini evidence flips
``teacher_feedback_allowed`` to True; vague, low-confidence evidence keeps it
False. If the feature mapping were a rubber stamp, the honest-fail test would
fail — that is the anti-cheat guarantee.

No live Gemini calls: the dispatch tests inject a fake engine through the
existing seam; the derivation module is pure.
"""

from __future__ import annotations

import asyncio
import inspect
import os
from types import SimpleNamespace

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import app.analysis.gemini_moments as gemini_moments
import app.services.lesson_moment_quality as lmq
from app.analysis.contracts import validate_moment
from app.analysis.failures import (
    ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS,
    AnalysisContractError,
    is_fallback_mode,
)
from app.analysis.gemini_moments import (
    GEMINI_MOMENT_SELECTION_REASON,
    GEMINI_MOMENT_STRATEGY_VERSION,
    build_gemini_moment_manifest,
    derive_moments_from_payload,
)
from app.services.lesson_moment_quality import (
    compute_assessment_quality,
    compute_moment_quality,
)


ELEMENTS = [
    {"id": "2b", "name": "Questioning", "domain": "Instruction", "priority": True},
    {"id": "3c", "name": "Engagement", "domain": "Instruction", "priority": False},
]

# 3 specific, high-confidence evidence segments across 2 elements.
STRONG_PAYLOAD = {
    "summary": "Strong discussion-led lesson.",
    "element_scores": [
        {
            "element_id": "2b",
            "confidence": 82,
            "observations": ["You pressed for reasoning."],
            "evidence_segments": [
                {
                    "start_sec": 30,
                    "end_sec": 52,
                    "summary": "You asked three students to explain their reasoning at the board and they built on each other's ideas about the number line.",
                    "rationale": "Student discussion deepened.",
                },
                {
                    "start_sec": 120,
                    "end_sec": 145,
                    "summary": "When a student answered, you asked the class whether they agreed and a partner discussion followed about the worked example.",
                    "rationale": "Whole-class checking.",
                },
            ],
        },
        {
            "element_id": "3c",
            "confidence": 74,
            "observations": ["Students stayed on task."],
            "evidence_segments": [
                {
                    "start_sec": 200,
                    "end_sec": 222,
                    "summary": "Students worked in pairs on the worksheet while you circulated and checked their written explanations.",
                    "rationale": "Active engagement.",
                }
            ],
        },
    ],
}

# Vague, low-confidence evidence (generic one-liners).
WEAK_PAYLOAD = {
    "summary": "ok",
    "element_scores": [
        {
            "element_id": "2b",
            "confidence": 20,
            "observations": ["ok"],
            "evidence_segments": [
                {"start_sec": 10, "end_sec": 30, "summary": "Good lesson.", "rationale": "x"},
                {"start_sec": 40, "end_sec": 60, "summary": "Nice job.", "rationale": "y"},
            ],
        }
    ],
}


# =========================================================================== #
# STEP 4a — derivation
# =========================================================================== #
def test_derive_moments_basic_shape():
    moments = derive_moments_from_payload(
        STRONG_PAYLOAD, duration_sec=None, available_frames=None, elements_to_analyze=ELEMENTS
    )
    assert len(moments) >= 2
    for moment in moments:
        assert moment["selection_reason"] == GEMINI_MOMENT_SELECTION_REASON
        assert validate_moment(moment).ok is True, moment


# =========================================================================== #
# STEP 4b — HONEST PASS (real gate, not mocked)
# =========================================================================== #
def test_honest_pass():
    manifest = build_gemini_moment_manifest(
        "vid-pass",
        STRONG_PAYLOAD,
        duration_sec=None,
        available_frames=None,
        elements_to_analyze=ELEMENTS,
        max_moments=6,
    )
    quality = compute_assessment_quality(
        moments=manifest["moments"], element_scores=STRONG_PAYLOAD["element_scores"]
    )
    assert quality["usable_moment_count"] >= 2
    assert quality["teacher_feedback_allowed"] is True


# =========================================================================== #
# STEP 4c — HONEST FAIL (proves the mapping is not a rubber stamp)
# =========================================================================== #
def test_honest_fail():
    manifest = build_gemini_moment_manifest(
        "vid-fail",
        WEAK_PAYLOAD,
        duration_sec=None,
        available_frames=None,
        elements_to_analyze=ELEMENTS,
        max_moments=6,
    )
    # The vague moments are KEPT (not dropped) so the gate evaluates them...
    assert len(manifest["moments"]) == 2
    # ...and every derived feature is low (well under a strong signal).
    for moment in manifest["moments"]:
        feats = moment["supporting_features"]
        assert feats["raw_selection_score"] < 0.2
        assert moment["quality"]["confidence"] < 0.35
    quality = compute_assessment_quality(
        moments=manifest["moments"], element_scores=WEAK_PAYLOAD["element_scores"]
    )
    assert quality["usable_moment_count"] == 0
    assert quality["teacher_feedback_allowed"] is False


# =========================================================================== #
# STEP 4d — near-zero guard
# =========================================================================== #
def test_blank_evidence_features_are_near_zero_and_excluded():
    moments = derive_moments_from_payload(
        {
            "element_scores": [
                {
                    "element_id": "2b",
                    "confidence": 0,
                    "evidence_segments": [
                        {"start_sec": 5, "end_sec": 25, "summary": "", "rationale": ""}
                    ],
                }
            ]
        },
        elements_to_analyze=ELEMENTS,
    )
    assert len(moments) == 1
    moment = moments[0]
    # All gate features near zero -> fails validate_moment (fallback-shaped).
    assert validate_moment(moment).ok is False
    # And the real gate would not count it as usable.
    quality = compute_moment_quality(moment, has_transcript_globally=None)
    assert quality["confidence"] < 0.35
    assert quality["teacher_visible_candidate"] is False


def test_manifest_drops_blank_only_evidence_and_raises():
    with pytest.raises(AnalysisContractError) as ei:
        build_gemini_moment_manifest(
            "vid-blank",
            {
                "element_scores": [
                    {
                        "element_id": "2b",
                        "confidence": 0,
                        "evidence_segments": [
                            {"start_sec": 5, "end_sec": 25, "summary": "", "rationale": ""}
                        ],
                    }
                ]
            },
            max_moments=6,
        )
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS


# =========================================================================== #
# STEP 4e — manifest shape parity
# =========================================================================== #
def test_manifest_shape_parity():
    manifest = build_gemini_moment_manifest(
        "vid-parity", STRONG_PAYLOAD, available_frames=None, elements_to_analyze=ELEMENTS
    )
    expected_keys = {
        "id",
        "video_id",
        "strategy_version",
        "window_sec",
        "max_moments",
        "candidate_target",
        "candidate_pool_size",
        "duration_sec",
        "moments",
        "deduped_moments",
        "created_at",
    }
    assert set(manifest.keys()) == expected_keys
    assert manifest["strategy_version"] == GEMINI_MOMENT_STRATEGY_VERSION
    for moment in manifest["moments"]:
        assert "quality" in moment and isinstance(moment["quality"], dict)


# =========================================================================== #
# STEP 4g — failure path (zero evidence segments)
# =========================================================================== #
def test_zero_evidence_segments_raises_typed_no_moments():
    with pytest.raises(AnalysisContractError) as ei:
        build_gemini_moment_manifest(
            "vid-none",
            {"element_scores": [{"element_id": "2b", "confidence": 80, "evidence_segments": []}]},
            max_moments=6,
        )
    assert ei.value.analysis_mode == ANALYSIS_MODE_FALLBACK_GEMINI_NO_MOMENTS
    assert is_fallback_mode(ei.value.analysis_mode) is True


# =========================================================================== #
# STEP 4h — reuse, not reinvent
# =========================================================================== #
def test_reuses_gate_helpers_from_lesson_moment_quality():
    # Identity: the names in gemini_moments ARE the gate's functions.
    assert gemini_moments.specificity_score is lmq.specificity_score
    assert gemini_moments.compute_moment_quality is lmq.compute_moment_quality
    assert gemini_moments.normalize_lesson_moment_window is lmq.normalize_lesson_moment_window
    assert gemini_moments.dedupe_lesson_moments is lmq.dedupe_lesson_moments
    # Source: it imports from lesson_moment_quality and does not redefine it.
    src = inspect.getsource(gemini_moments)
    assert "from app.services.lesson_moment_quality import" in src
    assert "def specificity_score" not in src


# =========================================================================== #
# STEP 4f — dispatch dormancy + gate-on (server.py)
# =========================================================================== #
import server  # noqa: E402

import app.analysis.gemini_engine as gemini_engine  # noqa: E402

_FRAMEWORK = {"domains": [{"name": "Instruction", "elements": [{"id": "2b", "name": "Questioning"}, {"id": "3c", "name": "Engagement"}]}]}


def test_dispatch_openai_does_not_call_gemini_moments(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "AsyncOpenAI", object())
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(ai=SimpleNamespace(analysis_provider="openai", gemini_api_key="ignored")),
    )

    async def _fake_openai(frames, elements, focus_instruction=None, language="en"):
        return STRONG_PAYLOAD

    monkeypatch.setattr(server, "_analyze_frames_with_openai", _fake_openai)

    called = {"n": 0}

    def _spy(*a, **k):
        called["n"] += 1
        return {}

    monkeypatch.setattr(gemini_moments, "build_gemini_moment_manifest", _spy)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 40.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
            video_id="vid-openai",
        )
    )

    assert called["n"] == 0  # gemini moment module never touched
    assert "_gemini_moment_manifest" not in result
    assert result["analysis_mode"] in {"openai", "openai_multimodal"}


def test_dispatch_gemini_attaches_grounded_manifest(monkeypatch):
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(
            ai=SimpleNamespace(
                analysis_provider="gemini",
                gemini_api_key="k",
                gemini_model="m",
                gemini_video_input_mode="inline",
            )
        ),
    )

    async def _fake_engine(**kwargs):
        return STRONG_PAYLOAD

    # Inject the engine; the REAL build_gemini_moment_manifest runs (end-to-end).
    monkeypatch.setattr(gemini_engine, "analyze_video_with_gemini", _fake_engine)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 40.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
            video_id="vid-gemini",
        )
    )

    assert result["analysis_mode"] == "gemini_multimodal"
    manifest = result.get("_gemini_moment_manifest")
    assert manifest is not None
    assert manifest["strategy_version"] == GEMINI_MOMENT_STRATEGY_VERSION
    assert len(manifest["moments"]) >= 2
    # The grounded manifest flips the gate honestly.
    quality = compute_assessment_quality(
        moments=manifest["moments"], element_scores=result["element_scores"]
    )
    assert quality["teacher_feedback_allowed"] is True


def test_dispatch_gemini_no_evidence_falls_through_to_openai(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "AsyncOpenAI", object())
    monkeypatch.setattr(
        server, "APP_SETTINGS",
        SimpleNamespace(
            ai=SimpleNamespace(
                analysis_provider="gemini",
                gemini_api_key="k",
                gemini_model="m",
                gemini_video_input_mode="inline",
            )
        ),
    )

    async def _engine_no_evidence(**kwargs):
        # Parseable analysis but zero usable evidence -> derivation raises.
        return {"summary": "ok", "element_scores": [{"element_id": "2b", "confidence": 80, "evidence_segments": []}]}

    async def _fake_openai(frames, elements, focus_instruction=None, language="en"):
        return STRONG_PAYLOAD

    monkeypatch.setattr(gemini_engine, "analyze_video_with_gemini", _engine_no_evidence)
    monkeypatch.setattr(server, "_analyze_frames_with_openai", _fake_openai)

    result = asyncio.run(
        server.analyze_frames_with_ai(
            frames=[{"timestamp_sec": 40.0, "image_b64": "abc"}],
            framework=_FRAMEWORK,
            selected_elements=[],
            priority_elements=["2b"],
            current_user={"email": "teacher@demo.cognivio.app"},
            video_source_path="/tmp/source.mp4",
            video_id="vid-fallthrough",
        )
    )

    # Fell through to OpenAI; never labeled gemini, never attached a gemini manifest.
    assert result["analysis_mode"] in {"openai", "openai_multimodal"}
    assert "_gemini_moment_manifest" not in result
