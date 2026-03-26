import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analysis.specialist_contracts import (  # noqa: E402
    get_conference_prep_specialist_contracts,
    get_default_specialist_contracts,
)
from app.analysis.specialist_orchestrator import (  # noqa: E402
    orchestrate_conference_prep,
    orchestrate_specialists,
)


def test_default_specialist_contracts_are_ordered_and_product_bounded():
    contracts = get_default_specialist_contracts()

    assert [item.specialist_id for item in contracts] == [
        "evidence_grounding",
        "priority_coach",
        "longitudinal_pattern",
        "recommendation_sequence",
    ]
    assert all(item.owned_fields for item in contracts)
    assert all(item.guardrails for item in contracts)

    conference_contracts = get_conference_prep_specialist_contracts()
    assert [item.specialist_id for item in conference_contracts] == [
        "conference_prep_synthesis"
    ]


def test_orchestrate_specialists_dedupes_sorts_and_links_active_goal():
    payload = {
        "analysis_mode": "openai",
        "summary": "Students were engaged during the task.",
        "recommendations": [
            {
                "start_sec": 180,
                "end_sec": 210,
                "text": "Tighten questioning routines.",
                "linked_element_id": "3c",
            },
            {
                "start_sec": 90,
                "end_sec": 120,
                "text": "Tighten questioning routines.",
                "linked_element_id": "2b",
            },
            {
                "start_sec": 130,
                "end_sec": 160,
                "text": "Increase probing questions and wait time.",
                "linked_element_id": "2b",
            },
        ],
        "element_scores": [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "priority": True,
                "score": 6.1,
                "observations": ["Evidence was limited in the sampled frames."],
                "evidence_segments": [
                    {
                        "start_sec": 95,
                        "end_sec": 125,
                        "summary": "Teacher asked mostly short recall questions.",
                        "rationale": "model-observed",
                    }
                ],
            },
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "priority": False,
                "score": 6.4,
                "observations": ["Students appeared unevenly engaged."],
                "evidence_segments": [
                    {
                        "start_sec": 180,
                        "end_sec": 210,
                        "summary": "Only one table responded during the task.",
                        "rationale": "model-observed",
                    }
                ],
            },
        ],
    }

    result = orchestrate_specialists(
        payload,
        language="en",
        priority_element_ids=["2b"],
        analysis_context={
            "active_goals": ["Increase probing questions"],
            "goal_progress_signals": [
                {
                    "title": "Increase probing questions",
                    "progress_signal": "repeated_challenge",
                    "progress_summary": "Recent evidence shows this challenge repeating across 2 linked records.",
                    "latest_evidence_at": "2026-03-25T10:00:00+00:00",
                }
            ],
            "signal_summary": {"guidance": ["Keep recommendations short and specific."]},
        },
    )

    assert result["specialist_orchestrator"]["enabled"] is True
    assert len(result["specialist_trace"]) == 4
    assert result["specialist_trace"][2]["specialist_id"] == "longitudinal_pattern"
    assert result["element_scores"][0]["element_id"] == "2b"
    assert "Teacher asked mostly short recall questions." in result["element_scores"][0]["observations"][0]
    assert len(result["recommendations"]) == 3
    assert result["recommendations"][0]["linked_element_id"] == "2b"
    assert result["recommendations"][1]["linked_element_id"] == "2b"
    assert "Connect the next move to the active goal" in result["recommendations"][0]["text"]
    assert result["summary"].startswith("Across recent lessons")


def test_orchestrate_conference_prep_centers_recurring_goal():
    result = orchestrate_conference_prep(
        {
            "agenda": [
                "Review the latest lesson evidence.",
                "Review the latest lesson evidence.",
            ],
            "continuity_lines": [
                "Recent evidence shows this challenge repeating across 3 linked records.",
            ],
        },
        language="en",
        adaptive_support={
            "primary_goal": {
                "title": "Checks for understanding",
                "progress_signal": "repeated_challenge",
            },
            "admin_prompt_body": "Center the next coaching move on this goal and confirm teacher follow-through.",
            "conference_continuity_lines": [
                "Latest linked evidence for \"Checks for understanding\" was updated on 2026-03-25T10:00:00+00:00."
            ],
        },
    )

    assert result["agenda"][0] == "Keep the conference centered on the recurring challenge: Checks for understanding."
    assert result["agenda"][-1] == "Center the next coaching move on this goal and confirm teacher follow-through."
    assert len(result["continuity_lines"]) == 2
    assert result["conference_specialist_trace"][0]["specialist_id"] == "conference_prep_synthesis"
