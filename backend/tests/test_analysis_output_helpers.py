import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest


def _load_server_module():
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
    module_path = Path(__file__).resolve().parents[1] / "server.py"
    spec = importlib.util.spec_from_file_location("backend_server_analysis_helpers", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


server = _load_server_module()


def test_generate_summary_uses_10_point_thresholds_and_observations():
    summary = server.generate_summary(
        [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "priority": True,
                "score": 8.2,
                "observations": ["Teacher used follow-up questions to press for reasoning."],
            },
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 6.1,
                "observations": ["Only a small subset of students appeared to participate."],
            },
        ],
        7.1,
        priority_element_ids=["2b"],
        focus_note="Pay particular attention to questioning and checks for understanding.",
    )

    assert summary.startswith("1. Instructional Snapshot")
    assert "2. Strengths to Keep and Build On" in summary
    assert "3. Primary Growth Focus" in summary
    assert "4. Evidence-Based Observation Highlights" in summary
    assert "5. Actionable Next Steps" in summary
    assert "6. Rubric-Aligned Interpretation" in summary
    assert "7. Longitudinal Insight" in summary
    assert "8. Reflection Prompts" in summary
    assert "Questioning" in summary
    assert "Engagement" in summary


def test_generate_summary_supports_hebrew_output():
    summary = server.generate_summary(
        [
            {
                "element_id": "2b",
                "element_name": "שימוש בשאלות ובדיון",
                "score": 8.2,
                "observations": ["המורה השתמשה בשאלות המשך כדי להעמיק את החשיבה."],
            },
            {
                "element_id": "3c",
                "element_name": "מעורבות תלמידים בלמידה",
                "score": 6.1,
                "observations": ["רק חלק קטן מהתלמידים השתתף באופן פעיל."],
            },
        ],
        7.1,
        priority_element_ids=["2b"],
        focus_note="לשים לב במיוחד לאיכות הדיון.",
        language="he",
    )

    assert summary.startswith("1. תמונת הוראה קצרה")
    assert "2. חוזקות לשימור ולהעמקה" in summary
    assert "3. מוקד צמיחה מרכזי" in summary
    assert "4. הדגשות תצפית מבוססות ראיות" in summary


def test_generate_recommendations_uses_evidence_segments_and_not_canned_defaults():
    recommendations = server.generate_recommendations(
        [
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 6.0,
                "observations": ["Student participation cues were uneven across the sampled frames."],
                "evidence_segments": [
                    {
                        "start_sec": 95,
                        "end_sec": 125,
                        "summary": "Only a small cluster of students responded during the task.",
                        "rationale": "model-observed",
                    }
                ],
            }
        ],
        priority_element_ids=["3c"],
    )

    assert recommendations
    assert recommendations[0].startswith("Try This ->")
    assert "Look For ->" in recommendations[0]
    assert "Evidence of Success ->" in recommendations[0]
    assert "Engagement".lower() in recommendations[0].lower()
    assert "students" in recommendations[0].lower()
    assert "Continue modeling strong routines" not in recommendations[0]


def test_generate_recommendations_supports_hebrew_output():
    recommendations = server.generate_recommendations(
        [
            {
                "element_id": "3c",
                "element_name": "מעורבות תלמידים בלמידה",
                "score": 6.0,
                "observations": ["נראו סימני השתתפות לא אחידים בין קבוצות התלמידים."],
                "evidence_segments": [
                    {
                        "start_sec": 95,
                        "end_sec": 125,
                        "summary": "רק קבוצה קטנה של תלמידים הגיבה במהלך המשימה.",
                        "rationale": "model-observed",
                    }
                ],
            }
        ],
        priority_element_ids=["3c"],
        language="he",
    )

    assert recommendations
    assert "נסו זאת ->" in recommendations[0]
    assert "מה לחפש ->" in recommendations[0]
    assert "עדות להצלחה ->" in recommendations[0]


def test_master_observer_flag_uses_new_renderer_when_voice_gate_passes(monkeypatch):
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)

    element_scores = [
        {
            "element_id": "2b",
            "element_name": "Questioning",
            "priority": True,
            "score": 7.3,
            "observations": ["You used wait time before inviting the next response."],
            "evidence_segments": [{"start_sec": 70, "end_sec": 95, "summary": "Students referred to notes before responding."}],
        }
    ]

    summary = server.generate_summary(element_scores, 7.3, priority_element_ids=["2b"])
    recommendations = server.generate_recommendations(element_scores, priority_element_ids=["2b"])

    assert "6. Rubric-Aligned Interpretation (Light)" in summary
    assert "8. Reflection Prompts" not in summary
    assert 1 <= len(recommendations) <= 2
    assert recommendations[0].startswith("Try This ->")

    packet = server.build_observation_summary_packet(
        element_scores,
        7.3,
        summary,
        recommendations,
        priority_element_ids=["2b"],
    )
    assert packet["reasoning_model"] == "master_observer_v1"
    assert packet["full_review_text"] == summary


def test_master_observer_flag_falls_back_when_voice_gate_fails(monkeypatch):
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)

    def _failing_renderer(*args, **kwargs):
        return {
            "instructional_snapshot": "You led a clear lesson.",
            "strengths_to_keep_and_build_on": ["Questioning move remained clear."],
            "primary_growth_focus": "Build one discussion routine.",
            "evidence_based_observation_highlights": ["Around 01:20, students responded to your prompt."],
            "actionable_next_steps_structured": [
                {"try_this": "Try a quick write.", "look_for": "More voices.", "evidence_of_success": "Wider participation."}
            ],
            "rubric_aligned_interpretation": "This suggests a correlation.",
            "output_order": [],
            "full_review_text": "1. Instructional Snapshot\nYou led a clear lesson.\n\n2. Strengths to Keep and Build On\n- Questioning move remained clear.\n\n3. Primary Growth Focus\nBuild one discussion routine.\n\n4. Evidence-Based Observation Highlights\n- Around 01:20, students responded to your prompt.\n\n5. Try This Next (Actionable, Near-Term)\n- Try This: Try a quick write.\n  Look For: More voices.\n  Evidence of Success: Wider participation.\n\n6. Rubric-Aligned Interpretation (Light)\nThis suggests a correlation.",
        }

    monkeypatch.setattr(server, "render_master_observer_feedback", _failing_renderer)

    summary = server.generate_summary(
        [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "score": 7.0,
                "observations": ["Teacher used wait time before inviting responses."],
            }
        ],
        7.0,
        priority_element_ids=["2b"],
    )

    assert "8. Reflection Prompts" in summary


def test_voice_gate_release_enforcement_blocks_teacher_facing_feedback(monkeypatch):
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)
    monkeypatch.setattr(server, "VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED", True)

    def _always_fail(*args, **kwargs):
        return {"passed": False, "failures": ["language.banned_term:correlation"], "section_count": 6}

    monkeypatch.setattr(server, "validate_voice_gate", _always_fail)

    enriched = server._enrich_assessment_for_response(
        {
            "id": "assessment-1",
            "video_id": "video-1",
            "teacher_id": "teacher-1",
            "framework_type": "danielson",
            "element_scores": [
                {
                    "element_id": "2b",
                    "element_name": "Questioning",
                    "score": 7.1,
                    "observations": ["Teacher used wait time before taking responses."],
                }
            ],
            "overall_score": 7.1,
            "summary": "Legacy summary text.",
            "recommendations": ["Legacy recommendation."],
            "analyzed_at": "2026-04-16T08:00:00+00:00",
            "analysis_language": "en",
            "priority_elements": ["2b"],
            "analysis_confidence": {},
            "feedback_release_status": "released",
            "voice_gate_status": "pass",
            "voice_gate_failures": [],
        },
        response_language="en",
    )

    assert enriched["feedback_release_status"] == "blocked"
    assert enriched["feedback_human_review_required"] is True
    assert enriched["summary"] == "Feedback is pending human quality review before release."
    assert enriched["recommendations"] == []
    assert enriched["observation_summary"]["executive_summary"] == "Feedback is pending human quality review before release."


def test_voice_gate_release_enforcement_allows_passed_feedback(monkeypatch):
    monkeypatch.setattr(server, "MASTER_OBSERVER_PIPELINE_ENABLED", True)
    monkeypatch.setattr(server, "MASTER_OBSERVER_REQUIRE_VOICE_GATE_PASS", True)
    monkeypatch.setattr(server, "VOICE_GATE_RELEASE_ENFORCEMENT_ENABLED", True)

    enriched = server._enrich_assessment_for_response(
        {
            "id": "assessment-2",
            "video_id": "video-2",
            "teacher_id": "teacher-2",
            "framework_type": "danielson",
            "element_scores": [
                {
                    "element_id": "2b",
                    "element_name": "Questioning",
                    "priority": True,
                    "score": 7.4,
                    "observations": ["You used a follow-up question and pause time."],
                    "evidence_segments": [{"start_sec": 64, "end_sec": 88, "summary": "Students referred to notes before speaking."}],
                }
            ],
            "overall_score": 7.4,
            "summary": "Legacy summary text.",
            "recommendations": ["Legacy recommendation."],
            "analyzed_at": "2026-04-16T08:00:00+00:00",
            "analysis_language": "en",
            "priority_elements": ["2b"],
            "analysis_confidence": {},
            "feedback_release_status": "released",
            "voice_gate_status": "pass",
            "voice_gate_failures": [],
        },
        response_language="en",
    )

    assert enriched["feedback_release_status"] == "released"
    assert enriched["summary"] != "Feedback is pending human quality review before release."
    assert enriched["recommendations"]


def test_build_focus_instruction_preserves_hebrew_admin_text_without_english_normalization():
    instruction = server._build_focus_instruction(
        [{"id": "d3b", "name": "שימוש בשאלות ובדיון", "priority": True}],
        focus_note="לשים לב במיוחד לאיכות השיח בכיתה ולהיענות של התלמידים.",
        language="he",
    )

    assert "מוקדי ההתבוננות" in instruction
    assert "כפי שנכתבה במקור" in instruction
    assert "\"לשים לב במיוחד לאיכות השיח בכיתה ולהיענות של התלמידים.\"" in instruction
    assert "Treat this as guidance" not in instruction


def test_generate_mock_scores_supports_hebrew_fallback_output():
    scores = server.generate_mock_scores(
        [{"id": "d3b", "name": "שימוש בשאלות ובדיון"}],
        language="he",
    )

    assert scores
    assert "נמצאה ראיה חלקית בלבד" in scores[0]["observations"][0]


def test_generate_recommendations_prioritizes_admin_pressure_points_when_model_output_exists():
    recommendations = server.generate_recommendations(
        [
            {"element_id": "2b", "element_name": "Questioning", "score": 6.4},
            {"element_id": "3c", "element_name": "Engagement", "score": 6.2},
        ],
        provided_recommendations=[
            {"start_sec": 210, "end_sec": 240, "text": "Reinforce discussion norms.", "linked_element_id": "3c"},
            {"start_sec": 90, "end_sec": 120, "text": "Increase probing questions and wait time.", "linked_element_id": "2b"},
        ],
        priority_element_ids=["2b"],
    )

    assert recommendations
    assert "Increase probing questions and wait time" in recommendations[0]


def test_normalize_analysis_score_scales_legacy_four_point_scores():
    assert server._normalize_analysis_score(4) == 10.0
    assert server._normalize_analysis_score(3) == 7.5
    assert server._normalize_analysis_score(6.8) == 6.8


def test_paid_analysis_gate_requires_feature_flag_and_allowlist(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(
        server,
        "PAID_ANALYSIS_ALLOWLIST_EMAILS",
        {"principal@demo.cognivio.app", "teacher@demo.cognivio.app"},
    )

    assert server._is_paid_analysis_allowed_for_user({"email": "teacher@demo.cognivio.app"}) is True
    assert server._is_paid_analysis_allowed_for_user({"email": "other@example.com"}) is False


def test_paid_analysis_gate_blocks_when_disabled(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", False)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})

    assert server._is_paid_analysis_allowed_for_user({"email": "teacher@demo.cognivio.app"}) is False


@pytest.mark.asyncio
async def test_analyze_frames_with_ai_marks_multimodal_mode_when_audio_present(monkeypatch):
    monkeypatch.setattr(server, "PAID_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "PAID_ANALYSIS_ALLOWLIST_EMAILS", {"teacher@demo.cognivio.app"})
    monkeypatch.setattr(server, "OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(server, "AsyncOpenAI", object())
    async def _fake_openai(frames, elements, focus_instruction=None, language="en", multimodal_payload=None):
        return {
            "summary": "Teacher models at the board and prompts students to compare strategies.",
            "recommendations": [],
            "element_scores": [
                {
                    "element_id": "2b",
                    "score": 7.2,
                    "confidence": 81,
                    "observations": ["Teacher prompts comparison thinking."],
                    "evidence_segments": [{"start_sec": 10, "end_sec": 20, "summary": "Teacher points to the board.", "rationale": "model"}],
                }
            ],
        }

    monkeypatch.setattr(server, "_analyze_frames_with_openai", _fake_openai)

    result = await server.analyze_frames_with_ai(
        frames=[{"timestamp_sec": 12.0, "image_b64": "abc"}],
        framework={"domains": [{"name": "Instruction", "elements": [{"id": "2b", "name": "Questioning"}]}]},
        selected_elements=[],
        priority_elements=["2b"],
        focus_note="Look especially at questioning depth.",
        current_user={"email": "teacher@demo.cognivio.app"},
        multimodal_payload={"modalities_used": ["vision", "audio"], "audio_features": {"question_count": 3}},
    )

    assert result["analysis_mode"] == "openai_multimodal"
    assert result["specialist_orchestrator"]["enabled"] is True
    assert result["specialist_trace"]


def test_build_elements_to_analyze_marks_priority_items_first():
    elements = server._build_elements_to_analyze(
        framework={
            "domains": [
                {
                    "name": "Instruction",
                    "elements": [
                        {"id": "2b", "name": "Questioning"},
                        {"id": "3c", "name": "Engagement"},
                    ],
                }
            ]
        },
        selected_elements=["2b", "3c"],
        priority_elements=["3c"],
    )

    assert elements[0]["id"] == "3c"
    assert elements[0]["priority"] is True
    assert elements[1]["priority"] is False


def test_build_elements_to_analyze_localizes_hebrew_framework_labels():
    elements = server._build_elements_to_analyze(
        framework={
            "domains": [
                {
                    "id": "d3",
                    "name": "Instruction",
                    "elements": [{"id": "d3b", "name": "Using Questioning and Discussion Techniques"}],
                }
            ]
        },
        selected_elements=["d3b"],
        framework_type="danielson",
        language="he",
    )

    assert elements[0]["name"] == "שימוש בשאלות ובדיון"
    assert elements[0]["domain"] == "תחום 3: הוראה"


def test_build_observation_summary_packet_prioritizes_focus_areas():
    packet = server.build_observation_summary_packet(
        element_scores=[
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "priority": True,
                "score": 6.2,
                "observations": ["Questions were mostly short and teacher-led."],
            },
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 7.8,
                "observations": ["Students were consistently on task."],
            },
        ],
        overall_score=7.0,
        summary_text="Students stayed engaged, while questioning remained the main coaching priority.",
        recommendations=["[02:10–02:40] Increase probing questions and wait time."],
        priority_element_ids=["2b"],
        focus_note="Look closely at questioning.",
        analysis_confidence={"degradation_reasons": ["audio_unavailable"]},
    )

    assert packet["executive_summary"].startswith("In ")
    assert packet["focus_note"] == "Look closely at questioning."
    assert packet["primary_growth_focus"]
    assert packet["priority_alignment"][0].startswith("Rubric-aligned interpretation:")
    assert "Audio was unavailable" in packet["confidence_note"]


def test_enrich_assessment_for_response_rebuilds_hebrew_summary_for_english_assessment():
    enriched = server._enrich_assessment_for_response(
        {
            "id": "assessment-1",
            "video_id": "video-1",
            "teacher_id": "teacher-1",
            "framework_type": "danielson",
            "element_scores": [
                {
                    "element_id": "d3b",
                    "element_name": "Using Questioning and Discussion Techniques",
                    "domain": "Domain 3: Instruction",
                    "score": 6.1,
                    "level": "basic",
                    "priority": True,
                    "observations": ["Questions were mostly short and teacher-directed."],
                    "confidence": 77,
                }
            ],
            "overall_score": 6.4,
            "summary": "Overall performance: Needs Improvement.",
            "recommendations": ["[01:20–01:50] Increase probing questions and wait time."],
            "priority_elements": ["d3b"],
            "focus_note": "Pay close attention to classroom discussion.",
            "analysis_language": "en",
        },
        response_language="he",
    )

    assert enriched["summary"].startswith("1. תמונת הוראה קצרה")
    assert enriched["element_scores"][0]["element_name"] == "שימוש בשאלות ובדיון"
    assert enriched["observation_summary"]["full_review_text"].startswith("1. תמונת הוראה קצרה")
    assert isinstance(enriched["recommendations"], list)


def test_enrich_assessment_for_response_regenerates_mixed_hebrew_text_when_english_leaks():
    enriched = server._enrich_assessment_for_response(
        {
            "id": "assessment_2",
            "overall_score": 4.0,
            "summary": "התרשמות כללית critical (ציון: 4.0/10).",
            "recommendations": [
                "[02:00–02:30] לחזק את הפגנת ידע בתוכן ובהוראה. Observed demonstrating knowledge of content and pedagogy during classroom instruction."
            ],
            "element_scores": [
                {
                    "element_id": "1a",
                    "element_name": "הפגנת ידע בתוכן ובהוראה",
                    "score": 4.0,
                    "observations": ["נראתה הפגנה חלקית של ידע בתוכן ובהוראה."],
                    "evidence_segments": [
                        {
                            "start_sec": 120,
                            "end_sec": 150,
                            "summary": "ההסבר התוכני נותר חלקי ולא התרחב מעבר להצגה בסיסית.",
                            "rationale": "model",
                        }
                    ],
                }
            ],
            "analysis_language": "he",
            "framework_type": "danielson",
        },
        "he",
    )

    assert "critical" not in enriched["summary"]
    assert all("Observed demonstrating" not in item for item in enriched["recommendations"])
    assert not server._contains_latin_characters(enriched["summary"])
    assert all(not server._contains_latin_characters(item) for item in enriched["recommendations"])


def test_localize_observation_text_translates_common_framework_phrases_to_hebrew():
    localized = server._localize_observation_text(
        "Observed demonstrating knowledge of resources with variable consistency over the lesson.",
        "he",
    )

    assert localized == "בתחום היכרות עם משאבים לימודיים רלוונטיים נראתה עקביות משתנה לאורך השיעור."


def test_localize_element_scores_for_response_translates_observations_for_hebrew():
    localized_scores = server._localize_element_scores_for_response(
        [
            {
                "element_id": "d1d",
                "element_name": "Knowledge of resources",
                "domain": "Planning",
                "observations": [
                    "Observed demonstrating knowledge of resources with variable consistency over the lesson."
                ],
            }
        ],
        "danielson",
        "he",
    )

    assert localized_scores[0]["observations"] == [
        "בתחום היכרות עם משאבים לימודיים רלוונטיים נראתה עקביות משתנה לאורך השיעור."
    ]


def test_localize_teacher_payload_converts_demo_fields_to_hebrew():
    localized = server._localize_teacher_payload(
        {
            "name": "Emily Rodriguez",
            "subject": "Biology",
            "grade_level": "10th Grade",
            "department": "STEM",
        },
        "he",
    )

    assert localized["subject"] == "ביולוגיה"
    assert localized["grade_level"] == "כיתה י׳"
    assert localized["department"] == "מדעים וטכנולוגיה"


def test_localize_roster_row_payload_converts_seeded_observation_text_to_hebrew():
    localized = server._localize_roster_row_payload(
        {
            "teacher_id": "teacher-1",
            "subject": "History",
            "grade_level": "8th Grade",
            "department": "Humanities",
            "recent_observations": [
                {
                    "summary": None,
                    "admin_comment": "Observed David demonstrating active engagement strategies.",
                }
            ],
            "action_items": [
                {"title": "Action Plan: Strengthen questioning routines"},
            ],
        },
        "he",
    )

    assert localized["subject"] == "היסטוריה"
    assert localized["grade_level"] == "כיתה ח׳"
    assert localized["department"] == "מדעי הרוח"
    assert "בתצפית על David" in localized["recent_observations"][0]["admin_comment"]
    assert localized["action_items"][0]["title"].startswith("תכנית פעולה:")


def test_localize_schedule_payload_translates_known_reminder_prefixes_to_hebrew():
    localized = server._localize_schedule_payload(
        {"course_name": "Lesson plan reminder: Chemistry"},
        "he",
    )

    assert localized["course_name"] == "תזכורת לתכנית שיעור: כימיה"


def test_build_analysis_metadata_tracks_modality_confidence_and_degradation(monkeypatch):
    monkeypatch.setattr(server, "AUDIO_ANALYSIS_ENABLED", True)
    monkeypatch.setattr(server, "AUDIO_ALLOW_STUDENT_VOICE_PROCESSING", True)
    monkeypatch.setattr(server, "AUDIO_FEATURES_ENABLED", True)

    metadata = server.build_analysis_metadata(
        analysis_payload={
            "element_scores": [
                {"confidence": 80},
                {"confidence": 60},
            ]
        },
        multimodal_payload={"modalities_used": ["vision"]},
        transcript_doc=None,
        feature_doc=None,
    )

    assert metadata["analysis_confidence"]["overall"] == 70.0
    assert "audio_unavailable" in metadata["analysis_confidence"]["degradation_reasons"]
    assert metadata["analysis_confidence"]["by_modality"]["vision"] == 70.0


def test_build_analysis_metadata_includes_specialist_trace_when_present():
    metadata = server.build_analysis_metadata(
        analysis_payload={
            "element_scores": [{"confidence": 80}],
            "specialist_orchestrator": {
                "enabled": True,
                "version": "specialist_orchestrator_v1",
                "specialist_ids": ["evidence_grounding"],
            },
            "specialist_trace": [{"specialist_id": "evidence_grounding", "notes": ["ok"]}],
        },
        multimodal_payload={"modalities_used": ["vision"]},
        transcript_doc=None,
        feature_doc=None,
    )

    assert metadata["specialist_orchestrator"]["enabled"] is True
    assert metadata["specialist_trace"][0]["specialist_id"] == "evidence_grounding"
