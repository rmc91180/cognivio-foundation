"""Backend tests for PR C9 evidence-grounded LLM coach voice.

All tests use a MOCK provider — no real LLM call is ever made.

Covers:

  1. Sufficiency gate blocks missing source / quality / admin-hidden /
     low transcript coverage.
  2. Sufficiency gate allows strong moments + transcript.
  3. build_coach_voice_input excludes rubric/scores/admin notes and
     truncates transcript excerpts.
  4. Valid mock JSON output integrates into the artifact's summary /
     primary action / highlight / deep-dive moments.
  5. Mock output with banned strings is rejected.
  6. Mock output with unsupported timestamp is rejected.
  7. Non-JSON output is rejected.
  8. Output referencing unknown moment id is rejected (via quality.used_moment_ids).
  9. ``COACH_VOICE_LLM_ENABLED`` disabled returns skipped_disabled and
     never calls the provider.
 10. admin_hidden artifact never calls the provider.
 11. Cache reused on second call with same evidence_hash.
 12. Evidence change invalidates cache.
 13. Hebrew mock output integrates; English-only Hebrew leak rejected.
 14. apply_coach_voice_to_artifact strips admin diagnostics for the
     teacher-safe artifact and preserves them under
     ``_coach_voice_admin`` for the admin view.
 15. Deterministic fallback preserved when generation skipped.
"""

from __future__ import annotations

import asyncio
import os
import types
from typing import Any

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "cognivio_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

import pytest

from app.services.coach_voice_generation import (
    COACH_VOICE_VERSION,
    apply_coach_voice_to_artifact,
    build_coach_voice_input,
    coach_voice_enabled,
    evaluate_coach_voice_sufficiency,
    evidence_hash,
    generate_teacher_coach_voice,
    validate_generated_coach_voice,
)
from app.services.teacher_lesson_coaching_artifact import (
    admin_view_of_artifact,
    teacher_safe_artifact,
)


# ---------------------------------------------------------------------------
# Fake mongo collection for cache tests
# ---------------------------------------------------------------------------


class _FakeColl:
    def __init__(self):
        self.docs = []

    async def find_one(self, query=None, projection=None, **_kwargs):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in (query or {}).items()):
                return dict(doc)
        return None

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if all(doc.get(k) == v for k, v in (query or {}).items()):
                new_doc = dict(doc)
                new_doc.update((update or {}).get("$set") or {})
                self.docs[index] = new_doc
                return types.SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new_doc = dict(query)
            new_doc.update((update or {}).get("$set") or {})
            self.docs.append(new_doc)
            return types.SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new_doc.get("id"))
        return types.SimpleNamespace(matched_count=0, modified_count=0)


def _fake_db():
    return types.SimpleNamespace(teacher_coach_voice_generations=_FakeColl())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


VALID_MOMENTS = [
    {
        "moment_id": "m1",
        "start_sec": 60.0,
        "end_sec": 80.0,
        "phase": "discussion",
        "summary": "You waited after the prompt and a second student offered an answer.",
        "transcript_excerpt": "Who can build on that?",
        "quality": {
            "teacher_visible_candidate": True,
            "visual_signal_score": 0.6,
            "transcript_signal_score": 0.7,
            "audio_signal_score": 0.4,
            "has_transcript_window": True,
            "specificity_score": 0.6,
        },
    },
    {
        "moment_id": "m2",
        "start_sec": 200.0,
        "end_sec": 220.0,
        "phase": "guided_practice",
        "summary": "A peer added on to the partial answer.",
        "transcript_excerpt": "I think because the answer needs to be doubled.",
        "quality": {
            "teacher_visible_candidate": True,
            "visual_signal_score": 0.5,
            "transcript_signal_score": 0.6,
            "audio_signal_score": 0.3,
            "has_transcript_window": True,
            "specificity_score": 0.5,
        },
    },
]


TRANSCRIPT_DOC = {
    "transcript_status": "completed",
    "segments": [{"text": "Who can build on that?"}] * 8,
}


def _allowed_artifact():
    return {
        "artifact_version": "teacher_lesson_coaching_artifact_v1",
        "teacher_feedback_allowed": True,
        "blocked_reason": None,
        "lesson": {"lesson_id": "a-good", "video_id": "v-good", "assessment_id": "a-good", "subject": "Math"},
        "summary": {
            "headline": None,
            "opening": "Original opening.",
            "what_worked": "Original what worked.",
            "growth_focus": "Original growth.",
            "next_step": "Original next step.",
        },
        "highlights": [{"id": "h1", "title": "Old", "body": "Old hl body."}],
        "action_items": [
            {
                "id": "a1",
                "title": "Old title",
                "body": "Old body.",
                "try_next_lesson": "Old try.",
                "why_it_matters": "Old why.",
                "video_href": "/videos/v-good?t=60",
            }
        ],
        "deep_dive": {
            "available": True,
            "moments": [
                {"id": "dd1", "start_sec": 60.0, "end_sec": 80.0, "video_href": "/videos/v-good?t=60"}
            ],
        },
        "recognition": {"gold_star": None, "personal_highlights": []},
        "reflection": {"private_by_default": True, "prompts": []},
        "navigator": {"type": "coaching_action", "label": "Coaching focus", "disabled": False},
        "language": "en",
    }


def _allowed_assessment():
    return {
        "id": "a-good",
        "teacher_id": "t-good",
        "video_id": "v-good",
        "analysis_quality": {
            "teacher_feedback_allowed": True,
            "evidence_sufficient": True,
            "usable_moment_count": 2,
        },
    }


def _good_mock_output(language="en"):
    return {
        "language": language,
        "summary": {
            "headline": "You waited after the question and a peer added on.",
            "opening": "You opened with a clear question and waited for a build.",
            "what_worked": "You held space for a second student voice.",
            "growth_focus": "Invite one quiet student into the next exchange.",
            "next_step": "After one student answers, pause and ask a peer to extend.",
        },
        "primary_action": {
            "title": "Try one peer build",
            "body": "After the next answer, pause and ask, who can build on that.",
            "try_next_lesson": "After one student answers, pause and invite a peer to add on.",
            "why_it_matters": "Keeps the practice focused on one small move.",
            "reflection_prompt": "Who joined the conversation when you paused?",
            "moment_start_sec": 60.0,
            "moment_end_sec": 80.0,
        },
        "highlight": {
            "title": "Moment worth keeping",
            "body": "You gave space for a second student to add on.",
            "start_sec": 60.0,
            "end_sec": 80.0,
        },
        "deep_dive_moments": [
            {
                "title": "Question exchange",
                "what_happened": "A peer added on to the answer after you paused.",
                "why_it_matters": "Repeating this gives a second voice room.",
                "start_sec": 60.0,
                "end_sec": 80.0,
            }
        ],
        "quality": {"used_transcript": True, "used_moment_ids": ["m1"], "limitations": []},
    }


def _good_hebrew_mock_output():
    return {
        "language": "he",
        "summary": {
            "headline": "פתחתם בשאלה ברורה ועצרתם לתשובה שנייה.",
            "opening": "פתחתם בשאלה ברורה ונתתם זמן לחשוב.",
            "what_worked": "חיכיתם לתשובה שנייה לפני שהמשכתם.",
            "growth_focus": "הזמינו תלמיד אחד שקט להצטרף בשיחה הבאה.",
            "next_step": "אחרי שתלמיד עונה, עצרו ובקשו מתלמיד אחר להוסיף.",
        },
        "primary_action": {
            "title": "בקשו תוספת אחת",
            "body": "אחרי תשובה, עצרו ובקשו מתלמיד אחר להוסיף.",
            "try_next_lesson": "אחרי תשובה, עצרו ושאלו מי יכול להוסיף.",
            "why_it_matters": "כך תרכזו את התרגול במהלך אחד קטן.",
            "reflection_prompt": "מי הצטרף לשיחה אחרי שעצרתם?",
            "moment_start_sec": 60.0,
            "moment_end_sec": 80.0,
        },
        "highlight": {
            "title": "רגע שכדאי לשמר",
            "body": "נתתם מקום לתלמיד שני להוסיף לתשובה.",
            "start_sec": 60.0,
            "end_sec": 80.0,
        },
        "deep_dive_moments": [
            {
                "title": "חילופי שאלה",
                "what_happened": "תלמיד נוסף הוסיף לתשובה אחרי שעצרתם.",
                "why_it_matters": "חזרה על המהלך הזה פותחת מקום לקול נוסף.",
                "start_sec": 60.0,
                "end_sec": 80.0,
            }
        ],
        "quality": {"used_transcript": True, "used_moment_ids": ["m1"], "limitations": []},
    }


# ---------------------------------------------------------------------------
# Sufficiency gate
# ---------------------------------------------------------------------------


def test_sufficiency_blocks_artifact_block():
    result = evaluate_coach_voice_sufficiency(
        artifact={"teacher_feedback_allowed": False, "blocked_reason": "evidence_insufficient"},
        assessment={"id": "a1"},
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
    )
    assert result["eligible"] is False
    assert result["reason"] == "blocked_artifact"


def test_sufficiency_blocks_admin_hidden():
    result = evaluate_coach_voice_sufficiency(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        admin_review={"status": "admin_hidden"},
    )
    assert result["eligible"] is False
    assert result["reason"] == "admin_blocked"


def test_sufficiency_blocks_revision_requested():
    result = evaluate_coach_voice_sufficiency(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        admin_review={"status": "revision_requested"},
    )
    assert result["eligible"] is False
    assert result["reason"] == "admin_blocked"


def test_sufficiency_blocks_evidence_quality_block():
    assessment = _allowed_assessment()
    assessment["analysis_quality"]["teacher_feedback_allowed"] = False
    result = evaluate_coach_voice_sufficiency(
        artifact=_allowed_artifact(),
        assessment=assessment,
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
    )
    assert result["eligible"] is False
    assert result["reason"] == "evidence_blocked"


def test_sufficiency_blocks_low_evidence():
    result = evaluate_coach_voice_sufficiency(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=[VALID_MOMENTS[0]],  # only one moment
        transcript_doc={"transcript_status": "missing", "segments": []},
    )
    assert result["eligible"] is False
    assert result["reason"] == "insufficient_evidence"


def test_sufficiency_allows_strong_moments_and_transcript():
    result = evaluate_coach_voice_sufficiency(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
    )
    assert result["eligible"] is True
    assert result["signals"]["usable_moment_count"] == 2


# ---------------------------------------------------------------------------
# Input builder
# ---------------------------------------------------------------------------


def test_build_input_excludes_admin_rubric_internal_fields():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment={**_allowed_assessment(), "element_scores": [{"element_name": "Using Questioning and Discussion Techniques", "score": 6.0, "confidence": 80.0}]},
        teacher={"id": "t-good", "name": "Maya Patel", "email": "maya@school.org", "subject": "Math", "grade_level": "5"},
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    serialized = str(payload).lower()
    # No rubric labels or scoring leakage.
    for forbidden in ("using questioning", "rubric", "confidence", "overall_score", "element_scores", "maya patel", "maya@school"):
        assert forbidden not in serialized
    # Bounded transcript excerpt — present but length-limited.
    assert all(len(m.get("transcript_excerpt") or "") <= 240 for m in payload["moments"])


def test_evidence_hash_changes_when_moments_change():
    payload1 = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    payload2 = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=[VALID_MOMENTS[0]],
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    assert evidence_hash(payload1) != evidence_hash(payload2)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_validate_rejects_non_json():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    result = validate_generated_coach_voice("not json", input_payload=payload)
    assert result["ok"] is False
    assert any(issue["code"] == "invalid_json" for issue in result["issues"])


def test_validate_rejects_unsupported_timestamp():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    bad = _good_mock_output()
    bad["primary_action"]["moment_start_sec"] = 999.9
    bad["primary_action"]["moment_end_sec"] = 1020.0
    result = validate_generated_coach_voice(bad, input_payload=payload)
    assert result["ok"] is False
    assert any(issue["code"] == "primary_action_unsupported_timestamp" for issue in result["issues"])


def test_validate_rejects_banned_string():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    bad = _good_mock_output()
    bad["summary"]["next_step"] = "Try this next lesson: rafi: Demonstrating Knowledge of Students."
    result = validate_generated_coach_voice(bad, input_payload=payload)
    assert result["ok"] is False
    assert any(issue["code"] == "unsafe_teacher_text" for issue in result["issues"])


def test_validate_rejects_unknown_moment_id():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    bad = _good_mock_output()
    bad["quality"]["used_moment_ids"] = ["m1", "m999_unknown"]
    result = validate_generated_coach_voice(bad, input_payload=payload)
    assert result["ok"] is False
    assert any(issue["code"] == "quality_unknown_moment_id" for issue in result["issues"])


def test_validate_rejects_model_blocked():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="en",
    )
    result = validate_generated_coach_voice({"blocked": True, "reason": "insufficient_evidence"}, input_payload=payload)
    assert result["ok"] is False
    assert any(issue["code"] == "model_blocked" for issue in result["issues"])


def test_validate_rejects_hebrew_english_leak():
    payload = build_coach_voice_input(
        artifact=_allowed_artifact(),
        assessment=_allowed_assessment(),
        moments=VALID_MOMENTS,
        transcript_doc=TRANSCRIPT_DOC,
        language="he",
    )
    # Hebrew target but model returned English summary.
    result = validate_generated_coach_voice(_good_mock_output(language="en"), input_payload=payload)
    assert result["ok"] is False
    codes = {issue["code"] for issue in result["issues"]}
    assert "language_mismatch" in codes or "hebrew_english_leak" in codes


# ---------------------------------------------------------------------------
# generate_teacher_coach_voice + cache
# ---------------------------------------------------------------------------


async def _good_mock_provider(payload, language):
    return _good_mock_output(language=payload.get("language", language) or language)


async def _hebrew_mock_provider(payload, language):
    return _good_hebrew_mock_output()


def test_generation_skipped_when_disabled(monkeypatch):
    monkeypatch.delenv("COACH_VOICE_LLM_ENABLED", raising=False)
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=_fake_db(),
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            # no provider supplied
        )
    )
    assert record["status"] == "skipped_disabled"


def test_generation_runs_with_explicit_provider_even_when_env_disabled(monkeypatch):
    monkeypatch.delenv("COACH_VOICE_LLM_ENABLED", raising=False)
    db = _fake_db()
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=_good_mock_provider,
        )
    )
    assert record["status"] == "generated"
    assert record["output"]["summary"]["opening"]
    # Cache row persisted.
    assert len(db.teacher_coach_voice_generations.docs) == 1


def test_generation_uses_cache_on_second_call():
    db = _fake_db()
    call_count = {"n": 0}

    async def counting_provider(payload, language):
        call_count["n"] += 1
        return _good_mock_output(language=language)

    record1 = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=counting_provider,
        )
    )
    record2 = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=counting_provider,
        )
    )
    assert record1["status"] == "generated"
    assert record2["status"] == "generated"
    assert call_count["n"] == 1  # second call hit cache


def test_generation_skipped_for_admin_hidden_does_not_call_provider():
    called = {"n": 0}

    async def provider(payload, language):
        called["n"] += 1
        return _good_mock_output()

    record = asyncio.run(
        generate_teacher_coach_voice(
            db=_fake_db(),
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            admin_review={"status": "admin_hidden"},
            language="en",
            provider=provider,
        )
    )
    assert record["status"] == "skipped_insufficient"
    assert called["n"] == 0


# ---------------------------------------------------------------------------
# apply_coach_voice_to_artifact + teacher_safe_artifact + admin_view
# ---------------------------------------------------------------------------


def test_apply_replaces_summary_and_action_and_highlight_and_deep_dive():
    db = _fake_db()
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=_good_mock_provider,
        )
    )
    artifact = apply_coach_voice_to_artifact(_allowed_artifact(), record)
    assert artifact["summary"]["opening"] == "You opened with a clear question and waited for a build."
    assert "peer build" in artifact["action_items"][0]["title"].lower()
    assert "second student" in artifact["highlights"][0]["body"].lower()
    assert artifact["deep_dive"]["moments"][0]["what_happened"].startswith("A peer added on")
    assert artifact["coach_voice"]["status"] == "generated"
    assert "_coach_voice_admin" in artifact


def test_teacher_safe_artifact_strips_admin_diagnostics():
    db = _fake_db()
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=_good_mock_provider,
        )
    )
    artifact = apply_coach_voice_to_artifact(_allowed_artifact(), record)
    safe = teacher_safe_artifact(artifact)
    assert "_coach_voice_admin" not in safe
    # The short teacher-facing block is still there.
    assert safe["coach_voice"]["status"] == "generated"
    # No provider/model/token diagnostics leak.
    text = str(safe).lower()
    for diag in ("openai", "gpt-4", "token", "validation_issues", "evidence_hash"):
        assert diag not in text


def test_admin_view_exposes_coach_voice_diagnostics():
    db = _fake_db()
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=_good_mock_provider,
        )
    )
    artifact = apply_coach_voice_to_artifact(_allowed_artifact(), record)
    admin = admin_view_of_artifact(artifact, assessment=_allowed_assessment())
    assert admin["coach_voice_diagnostics"]["status"] == "generated"
    assert "evidence_hash" in admin["coach_voice_diagnostics"]


def test_hebrew_mock_output_integrates_when_language_is_he():
    db = _fake_db()
    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="he",
            provider=_hebrew_mock_provider,
        )
    )
    assert record["status"] == "generated"
    artifact = apply_coach_voice_to_artifact(_allowed_artifact(), record)
    # Hebrew summary chars present.
    assert any("֐" <= c <= "׿" for c in artifact["summary"]["opening"])
    # No rubric label leakage.
    assert "using questioning" not in str(artifact).lower()


def test_failed_validation_preserves_deterministic_artifact():
    db = _fake_db()

    async def bad_provider(payload, language):
        return "not json"

    record = asyncio.run(
        generate_teacher_coach_voice(
            db=db,
            artifact=_allowed_artifact(),
            assessment=_allowed_assessment(),
            moments=VALID_MOMENTS,
            transcript_doc=TRANSCRIPT_DOC,
            language="en",
            provider=bad_provider,
        )
    )
    assert record["status"] == "failed_validation"
    artifact = apply_coach_voice_to_artifact(_allowed_artifact(), record)
    # Deterministic summary remains intact.
    assert artifact["summary"]["opening"] == "Original opening."
    assert artifact["coach_voice"]["status"] == "failed_validation"


def test_blocked_artifact_apply_does_not_overwrite_summary():
    blocked = _allowed_artifact()
    blocked["teacher_feedback_allowed"] = False
    blocked["blocked_reason"] = "evidence_insufficient"
    blocked["summary"] = {"opening": None, "what_worked": None, "growth_focus": None, "next_step": None}
    record = {"status": "skipped_insufficient", "language": "en"}
    out = apply_coach_voice_to_artifact(blocked, record)
    assert out["summary"]["opening"] is None
    assert out["coach_voice"]["status"] == "skipped_insufficient"
