from __future__ import annotations

import re
from statistics import pstdev
from typing import Dict, List, Optional


_REQUIRED_SECTIONS_EN = [
    "Instructional Snapshot",
    "Strengths to Keep and Build On",
    "Primary Growth Focus",
    "Evidence-Based Observation Highlights",
    "Try This Next (Actionable, Near-Term)",
    "Rubric-Aligned Interpretation (Light)",
]

_REQUIRED_SECTIONS_HE = [
    "תמונת הוראה קצרה",
    "חוזקות לשימור ולהעמקה",
    "מוקד צמיחה מרכזי",
    "הדגשות תצפית מבוססות ראיות",
    "מה לנסות עכשיו (צעדים קרובים וישימים)",
    "פרשנות מותאמת רובריקה (קלה)",
]

_BANNED_TERMS = [
    "layer",
    "confidence",
    "signal",
    "correlation",
    "overrideable",
    "aligned to",
    "model",
    "system",
    "framework",
    "effective",
    "ineffective",
    "met",
    "did not meet",
    "indicator",
    "domain",
    "rating",
    "score",
    "compliance",
    "requirement",
    "based on analysis",
    "data indicates",
    "suggests a correlation",
]

_PROCESS_TERMS = [
    "analysis",
    "this suggests",
    "we observed that",
    "model output",
    "system output",
    "confidence score",
]

_AUTHORITY_TERMS = [
    "overall performance",
    "teacher quality",
    "final judgment",
    "summative",
    "rank",
    "label readiness",
]

_CONTRAST_TERMS = [" but ", " however ", " though "]
_ACTION_VAGUE_TERMS = ["increase engagement", "ask more questions", "improve participation"]


def _is_hebrew(language: Optional[str]) -> bool:
    return str(language or "").strip().lower().startswith("he")


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip()).lower()


def _contains_phrase(normalized_text: str, phrase: str) -> bool:
    phrase = str(phrase or "").strip().lower()
    if not phrase:
        return False
    pattern = r"(?<!\w)" + re.escape(phrase) + r"(?!\w)"
    return re.search(pattern, normalized_text) is not None


def _extract_sections(text: str) -> List[Dict[str, str]]:
    lines = str(text or "").splitlines()
    sections: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    header_pattern = re.compile(r"^\s*(\d+)\.\s+(.+?)\s*$")
    for raw_line in lines:
        line = raw_line.rstrip()
        header_match = header_pattern.match(line)
        if header_match:
            if current:
                current["body"] = "\n".join(current["body_lines"]).strip()
                current.pop("body_lines", None)
                sections.append(current)
            current = {
                "index": header_match.group(1),
                "title": header_match.group(2).strip(),
                "body_lines": [],
            }
            continue
        if current is not None:
            current["body_lines"].append(line)
    if current:
        current["body"] = "\n".join(current["body_lines"]).strip()
        current.pop("body_lines", None)
        sections.append(current)
    return sections


def _structural_gate(sections: List[Dict[str, str]], language: str) -> List[str]:
    failures: List[str] = []
    required = _REQUIRED_SECTIONS_HE if _is_hebrew(language) else _REQUIRED_SECTIONS_EN
    actual_titles = [item.get("title", "") for item in sections]
    if len(sections) != len(required):
        failures.append("structural.section_count_invalid")
    if actual_titles != required:
        failures.append("structural.section_order_invalid")
    focus_count = sum(1 for title in actual_titles if title == required[2])
    if focus_count != 1:
        failures.append("structural.primary_growth_focus_count_invalid")
    strengths_body = sections[1]["body"] if len(sections) > 1 else ""
    strengths_normalized = f" {_normalize(strengths_body)} "
    for token in _CONTRAST_TERMS:
        if token in strengths_normalized:
            failures.append("structural.strengths_contains_contrast_language")
            break
    return failures


def _language_gate(text: str) -> List[str]:
    failures: List[str] = []
    normalized = _normalize(text)
    for token in _BANNED_TERMS:
        if _contains_phrase(normalized, token):
            failures.append(f"language.banned_term:{token}")
    for token in _PROCESS_TERMS:
        if _contains_phrase(normalized, token):
            failures.append(f"language.process_reference:{token}")
    if _contains_phrase(normalized, "ai"):
        failures.append("language.ai_reference")
    return failures


def _snapshot_gate(sections: List[Dict[str, str]], language: str) -> List[str]:
    failures: List[str] = []
    if not sections:
        return ["snapshot.missing"]
    snapshot = sections[0].get("body", "").strip()
    if not snapshot:
        return ["snapshot.empty"]
    first_line = snapshot.splitlines()[0].strip().lower()
    if re.match(r"^(at|around|\d{1,2}:\d{2})", first_line):
        failures.append("snapshot.opens_with_timestamp")
    if first_line.startswith("-") or first_line.startswith("•"):
        failures.append("snapshot.list_like")
    if not re.search(r"[.!?]", snapshot):
        failures.append("snapshot.not_narrative")
    competence_tokens = ["you led", "clear", "steady", "calm", "organized", "purposeful"]
    if _is_hebrew(language):
        competence_tokens = ["הובלת", "ברור", "מסודר", "רגוע", "יציב"]
    normalized = _normalize(snapshot)
    if not any(token in normalized for token in competence_tokens):
        failures.append("snapshot.teacher_competence_not_established")
    return failures


def _actionability_gate(sections: List[Dict[str, str]], language: str) -> List[str]:
    failures: List[str] = []
    if len(sections) < 5:
        return ["actionability.section_missing"]
    body = sections[4].get("body", "")
    try_label = "Try This:" if not _is_hebrew(language) else "נסו זאת:"
    look_label = "Look For:" if not _is_hebrew(language) else "מה לחפש:"
    evidence_label = "Evidence of Success:" if not _is_hebrew(language) else "עדות להצלחה:"
    step_count = body.count(try_label)
    if step_count == 0:
        failures.append("actionability.no_action_steps")
    if step_count > 2:
        failures.append("actionability.too_many_action_steps")
    if try_label in body and look_label not in body:
        failures.append("actionability.look_for_missing")
    if try_label in body and evidence_label not in body:
        failures.append("actionability.evidence_of_success_missing")
    normalized = _normalize(body)
    for token in _ACTION_VAGUE_TERMS:
        if token in normalized:
            failures.append(f"actionability.vague_action:{token}")
    return failures


def _voice_authenticity_gate(text: str) -> List[str]:
    failures: List[str] = []
    sentences = [segment.strip() for segment in re.split(r"[.!?]\s+", text) if segment.strip()]
    if len(sentences) >= 4:
        lengths = [len(sentence.split()) for sentence in sentences]
        if pstdev(lengths) < 1.5:
            failures.append("voice.uniform_sentence_lengths")
    normalized = _normalize(text)
    repeated_template = "this matters because"
    if normalized.count(repeated_template) > 2:
        failures.append("voice.repetitive_template_language")
    return failures


def _authority_gate(text: str) -> List[str]:
    failures: List[str] = []
    normalized = _normalize(text)
    for token in _AUTHORITY_TERMS:
        if _contains_phrase(normalized, token):
            failures.append(f"authority.evaluative_claim:{token}")
    return failures


def validate_voice_gate(text: str, *, language: str = "en") -> Dict[str, object]:
    sections = _extract_sections(text)
    failures: List[str] = []
    failures.extend(_structural_gate(sections, language))
    failures.extend(_language_gate(text))
    failures.extend(_snapshot_gate(sections, language))
    failures.extend(_actionability_gate(sections, language))
    failures.extend(_voice_authenticity_gate(text))
    failures.extend(_authority_gate(text))
    unique_failures = sorted(set(failures))
    return {
        "passed": len(unique_failures) == 0,
        "failures": unique_failures,
        "section_count": len(sections),
    }
