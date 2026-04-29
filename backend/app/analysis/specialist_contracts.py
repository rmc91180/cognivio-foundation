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
    goal_progress_signals: Sequence[Dict[str, Any]] = field(default_factory=list)
    reflection_takeaways: Sequence[str] = field(default_factory=list)
    conference_continuity_lines: Sequence[str] = field(default_factory=list)
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
            specialist_id="longitudinal_pattern",
            name="Longitudinal Pattern Specialist",
            purpose=(
                "Carry repeated challenge or progress context into the summary and next-step framing "
                "without overriding lesson evidence."
            ),
            owned_fields=("summary", "recommendations"),
            inputs=("analysis_context.goal_progress_signals", "analysis_context.reflection_summary"),
            guardrails=(
                "Do not invent trends that are not supported by bounded evidence-backed goal signals.",
                "Do not add timestamps or claim lesson-specific events outside the current payload.",
                "Keep longitudinal context to one short framing move.",
            ),
            execution_order=3,
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
            execution_order=4,
        ),
    ]


def get_conference_prep_specialist_contracts() -> List[SpecialistContract]:
    return [
        SpecialistContract(
            specialist_id="conference_prep_synthesis",
            name="Conference Prep Synthesis Specialist",
            purpose=(
                "Keep conference prep concise, continuity-aware, and centered on the most important "
                "ongoing coaching thread."
            ),
            owned_fields=("agenda", "continuity_lines"),
            inputs=("adaptive_support.primary_goal", "adaptive_support.admin_prompt_body", "continuity_lines"),
            guardrails=(
                "Do not expose hidden system state to the user.",
                "Do not expand the agenda beyond the product cap.",
                "Prefer the clearest recurring coaching thread before secondary issues.",
            ),
            execution_order=1,
        )
    ]
