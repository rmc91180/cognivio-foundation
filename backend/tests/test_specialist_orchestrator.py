import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.analysis.specialist_contracts import get_default_specialist_contracts  # noqa: E402
from app.analysis.specialist_orchestrator import orchestrate_specialists  # noqa: E402


def test_default_specialist_contracts_are_ordered_and_product_bounded():
    contracts = get_default_specialist_contracts()

    assert [item.specialist_id for item in contracts] == [
        "evidence_grounding",
        "priority_coach",
        "recommendation_sequence",
    ]
    assert all(item.owned_fields for item in contracts)
    assert all(item.guardrails for item in contracts)


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
            "signal_summary": {"guidance": ["Keep recommendations short and specific."]},
        },
    )

    assert result["specialist_orchestrator"]["enabled"] is True
    assert len(result["specialist_trace"]) == 3
    assert result["element_scores"][0]["element_id"] == "2b"
    assert "Teacher asked mostly short recall questions." in result["element_scores"][0]["observations"][0]
    assert len(result["recommendations"]) == 3
    assert result["recommendations"][0]["linked_element_id"] == "2b"
    assert result["recommendations"][1]["linked_element_id"] == "2b"
    assert "Connect the next move to the active goal" in result["recommendations"][0]["text"]
