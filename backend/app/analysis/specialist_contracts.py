from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class SpecialistContract:
    specialist_id: str
    name: str
    purpose: str
    owned_fields: Tuple[str, ...]
    inputs: Tuple[str, ...]
    guardrails: Tuple[str, ...]
    execution_order: int


@dataclass
class SpecialistContext:
    language: str = "en"
    priority_element_ids: Sequence[str] = field(default_factory=list)
    focus_note: Optional[str] = None
    active_goals: Sequence[str] = field(default_factory=list)
    signal_guidance: Sequence[str] = field(default_factory=list)
    analysis_context: Optional[Dict[str, Any]] = None


@dataclass
class SpecialistResult:
    specialist_id: str
    notes: List[str] = field(default_factory=list)
    payload_delta: Dict[str, Any] = field(default_factory=dict)


def get_default_specialist_contracts() -> List[SpecialistContract]:
    return [
        SpecialistContract(
            specialist_id="evidence_grounding",
            name="Evidence Grounding Specialist",
            purpose="Strengthen alignment between normalized evidence segments and coaching-ready observations.",
            owned_fields=("element_scores", "summary"),
            inputs=("element_scores", "recommendations", "focus_note"),
            guardrails=(
                "Do not invent new classroom events.",
                "Only strengthen wording from existing evidence segments and observations.",
                "Keep changes deterministic and bounded to visible evidence.",
            ),
            execution_order=1,
        ),
        SpecialistContract(
            specialist_id="priority_coach",
            name="Priority Coaching Specialist",
            purpose="Make sure configured priorities and active coaching goals shape the next-step framing.",
            owned_fields=("recommendations", "element_scores"),
            inputs=("priority_element_ids", "focus_note", "analysis_context.active_goals"),
            guardrails=(
                "Do not override evidence with goals.",
                "Bias sequencing toward configured priorities before secondary issues.",
                "Keep coaching direction short and explicit.",
            ),
            execution_order=2,
        ),
        SpecialistContract(
            specialist_id="recommendation_sequence",
            name="Recommendation Sequence Specialist",
            purpose="Dedupe, rank, and cap the next-step sequence so coaches see the clearest follow-through path.",
            owned_fields=("recommendations",),
            inputs=("recommendations", "element_scores", "analysis_context.signal_summary"),
            guardrails=(
                "Do not increase recommendation count beyond the product cap.",
                "Remove duplicates before adding new phrasing.",
                "Prefer earlier, higher-value evidence when priority is otherwise equal.",
            ),
            execution_order=3,
        ),
    ]
