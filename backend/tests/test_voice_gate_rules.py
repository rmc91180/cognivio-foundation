import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.analysis.master_observer import render_master_observer_feedback  # noqa: E402
from app.analysis.voice_gate import validate_voice_gate  # noqa: E402


def test_master_observer_renderer_emits_required_sections_and_two_actions():
    artifact = render_master_observer_feedback(
        [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "priority": True,
                "score": 7.5,
                "observations": ["You asked a follow-up question and paused before taking responses."],
                "evidence_segments": [{"start_sec": 75, "end_sec": 100, "summary": "You invited a second student to build on a peer response."}],
            },
            {
                "element_id": "3c",
                "element_name": "Engagement",
                "score": 6.2,
                "observations": ["Participation narrowed to one side of the room during discussion."],
                "evidence_segments": [{"start_sec": 140, "end_sec": 170, "summary": "Most responses came from one table."}],
            },
        ],
        priority_element_ids=["2b"],
        language="en",
    )

    text = artifact["full_review_text"]
    assert "1. Instructional Snapshot" in text
    assert "2. Strengths to Keep and Build On" in text
    assert "3. Primary Growth Focus" in text
    assert "4. Evidence-Based Observation Highlights" in text
    assert "5. Try This Next (Actionable, Near-Term)" in text
    assert "6. Rubric-Aligned Interpretation (Light)" in text
    assert len(artifact["actionable_next_steps_structured"]) == 2


def test_voice_gate_fails_on_banned_language():
    output = """1. Instructional Snapshot
You led a clear lesson.

2. Strengths to Keep and Build On
- Your explanation was clear.

3. Primary Growth Focus
Build one discussion routine.

4. Evidence-Based Observation Highlights
- Around 02:10, students responded to your prompt.

5. Try This Next (Actionable, Near-Term)
- Try This: Ask one more question.
  Look For: More student responses.
  Evidence of Success: Wider participation in one lesson.

6. Rubric-Aligned Interpretation (Light)
This suggests a correlation in student response.
"""
    result = validate_voice_gate(output, language="en")
    assert result["passed"] is False
    assert any(str(item).startswith("language.banned_term") for item in result["failures"])


def test_voice_gate_passes_renderer_output():
    artifact = render_master_observer_feedback(
        [
            {
                "element_id": "2b",
                "element_name": "Questioning",
                "priority": True,
                "score": 7.1,
                "observations": ["You asked students to explain their reasoning before moving on."],
                "evidence_segments": [{"start_sec": 60, "end_sec": 90, "summary": "Several students used notes before speaking."}],
            }
        ],
        priority_element_ids=["2b"],
        language="en",
    )
    result = validate_voice_gate(artifact["full_review_text"], language="en")
    assert result["passed"] is True
