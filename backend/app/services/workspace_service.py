from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import server as legacy

from app.repositories import workspace_repository


VALID_WORKSPACE_MODES = {"school", "training"}


def _owner_id(current_user: dict) -> str:
    return current_user.get("workspace_owner_id") or current_user.get("created_by") or current_user["id"]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def resolve_workspace_mode(current_user: dict) -> Dict[str, Optional[str]]:
    owner_id = _owner_id(current_user)
    user_doc = await workspace_repository.get_user(current_user["id"]) or current_user
    pref = await workspace_repository.get_workspace_mode_preference(owner_id)
    user_override = user_doc.get("workspace_mode_override")
    org_default = pref.get("org_default_mode") if pref else None
    effective = user_override or org_default or "school"
    if effective not in VALID_WORKSPACE_MODES:
        effective = "school"
    return {
        "owner_id": owner_id,
        "user_override_mode": user_override,
        "org_default_mode": org_default,
        "effective_mode": effective,
        "updated_at": (pref or {}).get("updated_at"),
    }


async def enrich_user_with_workspace_mode(user_doc: dict) -> dict:
    if not user_doc:
        return user_doc
    mode = await resolve_workspace_mode(user_doc)
    tenancy = await legacy._resolve_user_tenancy_context(user_doc)
    teacher_id = user_doc.get("teacher_id")
    if not teacher_id and legacy._get_user_role(user_doc) == "teacher":
        email = (user_doc.get("email") or "").strip().lower()
        teacher_doc = None
        if email:
            teacher_doc = await legacy.db.teachers.find_one(
                {"email": email},
                {"_id": 0, "id": 1},
            )
        if not teacher_doc:
            teacher_doc = await legacy.db.teachers.find_one(
                {"created_by": user_doc["id"]},
                {"_id": 0, "id": 1},
            )
        teacher_id = (teacher_doc or {}).get("id")
    return {
        **user_doc,
        "workspace_mode": mode["effective_mode"],
        "teacher_id": teacher_id,
        **tenancy,
    }


async def set_workspace_mode(current_user: dict, payload: dict) -> Dict[str, Optional[str]]:
    owner_id = _owner_id(current_user)
    mode = (payload.get("mode") or "").strip().lower() or None
    use_org_default = bool(payload.get("use_org_default"))
    set_org_default = bool(payload.get("set_org_default"))
    role = legacy._get_user_role(current_user)
    if mode is not None and mode not in VALID_WORKSPACE_MODES:
        raise legacy.HTTPException(status_code=400, detail="Invalid workspace mode")
    if use_org_default:
        await workspace_repository.update_user_fields(
            current_user["id"],
            {
                "workspace_mode_override": None,
                "workspace_mode_updated_at": _utc_now(),
            },
        )
    else:
        if not mode:
            raise legacy.HTTPException(status_code=400, detail="mode is required")
        await workspace_repository.update_user_fields(
            current_user["id"],
            {
                "workspace_mode_override": mode,
                "workspace_mode_updated_at": _utc_now(),
            },
        )
    if set_org_default:
        if role != "admin":
            raise legacy.HTTPException(status_code=403, detail="Admin access required")
        if not mode:
            raise legacy.HTTPException(status_code=400, detail="mode is required to set org default")
        await workspace_repository.upsert_workspace_mode_preference(
            owner_id,
            {
                "owner_id": owner_id,
                "org_default_mode": mode,
                "updated_by": current_user["id"],
                "updated_at": _utc_now(),
            },
        )
    return await resolve_workspace_mode(current_user)


async def sync_framework_memory(current_user: dict, selection_doc: dict) -> None:
    owner_id = _owner_id(current_user)
    now = _utc_now()
    await workspace_repository.upsert_memory_entry(
        owner_id,
        "organization",
        owner_id,
        "observation_priorities",
        {
            "id": f"{owner_id}:organization:observation_priorities",
            "owner_id": owner_id,
            "scope_type": "organization",
            "scope_id": owner_id,
            "memory_type": "observation_priorities",
            "title": "Observation priorities",
            "payload": {
                "framework_type": selection_doc.get("framework_type"),
                "selected_elements": selection_doc.get("selected_elements", []),
                "priority_elements": selection_doc.get("priority_elements", []),
                "focus_note": selection_doc.get("focus_note"),
            },
            "updated_by": current_user["id"],
            "updated_at": now,
        },
    )


async def sync_action_plan_memory(current_user: dict, teacher: dict, plan_doc: dict) -> None:
    owner_id = _owner_id(current_user)
    now = _utc_now()
    goals = [
        {
            "title": goal.get("title"),
            "status": goal.get("status"),
            "due_date": goal.get("due_date"),
        }
        for goal in plan_doc.get("goals", [])
        if goal.get("title")
    ]
    await workspace_repository.upsert_memory_entry(
        owner_id,
        "teacher",
        teacher["id"],
        "coaching_context",
        {
            "id": f"{owner_id}:teacher:{teacher['id']}:coaching_context",
            "owner_id": owner_id,
            "scope_type": "teacher",
            "scope_id": teacher["id"],
            "memory_type": "coaching_context",
            "title": f"Coaching context for {teacher.get('name') or teacher['id']}",
            "payload": {
                "teacher_name": teacher.get("name"),
                "active_goals": goals,
                "notes": plan_doc.get("notes"),
                "next_coaching_conference": teacher.get("next_coaching_conference"),
                "goal_evidence_links": {
                    goal.get("id"): list(goal.get("evidence_links") or [])
                    for goal in plan_doc.get("goals", [])
                    if goal.get("id")
                },
            },
            "updated_by": current_user["id"],
            "updated_at": now,
        },
    )


async def sync_summary_reflection_memory(current_user: dict, teacher_id: str, reflection_doc: dict) -> None:
    owner_id = _owner_id(current_user)
    now = _utc_now()
    await workspace_repository.upsert_memory_entry(
        owner_id,
        "teacher",
        teacher_id,
        "reflection_context",
        {
            "id": f"{owner_id}:teacher:{teacher_id}:reflection_context",
            "owner_id": owner_id,
            "scope_type": "teacher",
            "scope_id": teacher_id,
            "memory_type": "reflection_context",
            "title": f"Reflection context for {teacher_id}",
            "payload": {
                "self_reflection": reflection_doc.get("self_reflection") or "",
                "actions_taken": reflection_doc.get("actions_taken") or "",
                "linked_goal_ids": list(reflection_doc.get("linked_goal_ids") or []),
                "linked_video_id": reflection_doc.get("linked_video_id"),
                "linked_assessment_id": reflection_doc.get("linked_assessment_id"),
                "linked_observation_id": reflection_doc.get("linked_observation_id"),
            },
            "updated_by": current_user["id"],
            "updated_at": now,
        },
    )


def _goal_signal_priority(signal: Optional[str]) -> int:
    order = {
        "repeated_challenge": 4,
        "evidence_gap": 3,
        "one_off_evidence": 2,
        "linked_context": 1,
        "reinforcing_progress": 0,
    }
    return order.get(signal or "", 0)


def _build_memory_support_snapshot_from_inputs(
    *,
    teacher_name: Optional[str],
    enriched_goals: List[dict],
    reflection_summary: Dict[str, Any],
    signal_summary: Dict[str, Any],
    next_conference: Optional[str],
    language: str = "en",
) -> Dict[str, Any]:
    def is_hebrew() -> bool:
        return str(language or "").lower().startswith("he")

    open_goals = [
        goal for goal in enriched_goals if goal.get("title") and goal.get("status") not in {"complete", "implemented"}
    ]
    open_goals.sort(
        key=lambda goal: (
            -_goal_signal_priority(goal.get("progress_signal")),
            legacy._sort_key_for_iso(goal.get("latest_evidence_at")),
        )
    )
    primary_goal = open_goals[0] if open_goals else None
    reflection_text = str(reflection_summary.get("self_reflection") or "").strip()
    actions_taken = str(reflection_summary.get("actions_taken") or "").strip()
    guidance = [str(item).strip() for item in (signal_summary.get("guidance") or []) if str(item).strip()]
    continuity_lines: List[str] = []
    teacher_prompt_title = None
    teacher_prompt_body = None
    admin_prompt_title = None
    admin_prompt_body = None

    if primary_goal:
        goal_title = primary_goal.get("title")
        signal = primary_goal.get("progress_signal")
        progress_summary = primary_goal.get("progress_summary")
        if signal == "repeated_challenge":
            if is_hebrew():
                teacher_prompt_title = f"פוקוס לשיעור הבא: {goal_title}"
                teacher_prompt_body = (
                    f'ראיות אחרונות מראות שהאתגר סביב "{goal_title}" עדיין חוזר. '
                    "תעדו מה תנסו לעשות אחרת בשיעור הבא וקשרו זאת לראיה האחרונה."
                )
                admin_prompt_title = f"אתגר חוזר: {goal_title}"
                admin_prompt_body = (
                    f'היעד "{goal_title}" עדיין מופיע כאתגר חוזר. '
                    "עדיף למקד את שיחת הליווי הקרובה ביעד הזה ולבדוק תגובת מורה."
                )
            else:
                teacher_prompt_title = f"Next class focus: {goal_title}"
                teacher_prompt_body = (
                    f'Recent evidence shows that "{goal_title}" is still repeating as a challenge. '
                    "Log what you will try next and connect it to the latest evidence."
                )
                admin_prompt_title = f"Recurring challenge: {goal_title}"
                admin_prompt_body = (
                    f'"{goal_title}" is still showing up as a repeated challenge. '
                    "Center the next coaching move on this goal and confirm teacher follow-through."
                )
        elif signal == "reinforcing_progress":
            if is_hebrew():
                teacher_prompt_title = f"שמרו על התנופה: {goal_title}"
                teacher_prompt_body = (
                    f'נראה שהעבודה על "{goal_title}" מתחילה להתחזק. '
                    "תעדו מה עבד כדי שהמנהל יוכל לחזק את זה בשיחה הבאה."
                )
                admin_prompt_title = f"מומנטום חיובי: {goal_title}"
                admin_prompt_body = (
                    f'היעד "{goal_title}" מקבל חיזוק מראיות אחרונות. ' "שווה לחזק את המהלך שעבד ולשמר אותו."
                )
            else:
                teacher_prompt_title = f"Keep building: {goal_title}"
                teacher_prompt_body = (
                    f'Recent evidence suggests progress on "{goal_title}". '
                    "Capture what worked so your admin can reinforce it in the next conference."
                )
                admin_prompt_title = f"Positive momentum: {goal_title}"
                admin_prompt_body = (
                    f'Recent evidence is reinforcing progress on "{goal_title}". '
                    "Use the next conference to reinforce what is starting to work."
                )
        else:
            if is_hebrew():
                teacher_prompt_title = f"צרו ראיה חדשה עבור: {goal_title}"
                teacher_prompt_body = (
                    f'היעד "{goal_title}" עדיין פעיל, אבל אין מספיק ראיות חדשות. '
                    "אחרי השיעור הבא, הוסיפו רפלקציה קצרה או העלו שיעור חדש."
                )
                admin_prompt_title = f"נדרשת ראיה חדשה: {goal_title}"
                admin_prompt_body = (
                    f'היעד "{goal_title}" עדיין פעיל, אבל חסרות ראיות חדשות. '
                    "כדאי לוודא שיש שיעור או תגובת מורה חדשים לפני שינוי הכיוון."
                )
            else:
                teacher_prompt_title = f"Create fresh evidence for: {goal_title}"
                teacher_prompt_body = (
                    f'"{goal_title}" is still active, but there is not enough fresh evidence yet. '
                    "After the next class, add a short reflection or link new lesson evidence."
                )
                admin_prompt_title = f"Fresh evidence needed: {goal_title}"
                admin_prompt_body = (
                    f'"{goal_title}" is still active, but the recent evidence base is thin. '
                    "Look for a new lesson or teacher response before changing the coaching plan."
                )
        if progress_summary:
            continuity_lines.append(progress_summary)
        if primary_goal.get("latest_evidence_at"):
            if is_hebrew():
                continuity_lines.append(
                    f"הראיה האחרונה ליעד \"{goal_title}\" נוספה ב-{primary_goal.get('latest_evidence_at')}."
                )
            else:
                continuity_lines.append(
                    "Latest linked evidence for "
                    f"\"{goal_title}\" was updated on {primary_goal.get('latest_evidence_at')}."
                )

    if actions_taken:
        continuity_lines.append(actions_taken)
    elif reflection_text:
        continuity_lines.append(reflection_text)

    if guidance:
        continuity_lines.extend(guidance[:2])

    if next_conference:
        if is_hebrew():
            continuity_lines.append("שיחת הליווי הבאה מתקרבת, ולכן כדאי להגיע עם ראיה ותגובה מעודכנות.")
        else:
            continuity_lines.append(
                "The next coaching conference is coming up, so it is worth bringing fresh evidence "
                "and a current follow-through response."
            )

    unique_lines: List[str] = []
    seen = set()
    for line in continuity_lines:
        line = str(line).strip()
        if not line or line in seen:
            continue
        seen.add(line)
        unique_lines.append(line)

    return {
        "teacher_name": teacher_name,
        "primary_goal": primary_goal,
        "teacher_prompt_title": teacher_prompt_title,
        "teacher_prompt_body": teacher_prompt_body,
        "admin_prompt_title": admin_prompt_title,
        "admin_prompt_body": admin_prompt_body,
        "conference_continuity_lines": unique_lines[:4],
    }


async def build_teacher_memory_support(
    current_user: dict,
    teacher_id: str,
    *,
    language: str = "en",
) -> Dict[str, Any]:
    owner_id = _owner_id(current_user)
    teacher = await legacy.db.teachers.find_one(
        {"id": teacher_id, "created_by": owner_id},
        {"_id": 0},
    )
    if not teacher:
        return {
            "teacher_name": None,
            "primary_goal": None,
            "teacher_prompt_title": None,
            "teacher_prompt_body": None,
            "admin_prompt_title": None,
            "admin_prompt_body": None,
            "conference_continuity_lines": [],
        }

    action_plan = await legacy.db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    ) or {"goals": [], "notes": None}
    reflection = (
        await legacy.db.summary_reflections.find_one(
            {"teacher_id": teacher_id, "user_id": owner_id},
            {"_id": 0},
        )
        or {}
    )
    evidence_catalog = await legacy._build_teacher_evidence_catalog(teacher, current_user)
    enriched_goals = legacy._enrich_action_plan_goals_with_evidence(
        action_plan.get("goals") or [],
        evidence_catalog,
    )
    signal_summary = await build_feedback_signal_summary(current_user, teacher_id=teacher_id)
    return _build_memory_support_snapshot_from_inputs(
        teacher_name=teacher.get("name"),
        enriched_goals=enriched_goals,
        reflection_summary={
            "self_reflection": reflection.get("self_reflection"),
            "actions_taken": reflection.get("actions_taken"),
        },
        signal_summary=signal_summary,
        next_conference=teacher.get("next_coaching_conference"),
        language=language,
    )


async def list_organization_memory(
    current_user: dict, scope_type: Optional[str] = None, scope_id: Optional[str] = None
) -> List[dict]:
    return await workspace_repository.list_memory_entries(
        _owner_id(current_user),
        scope_type=scope_type,
        scope_id=scope_id,
    )


async def build_feedback_signal_summary(current_user: dict, teacher_id: Optional[str] = None) -> Dict[str, Any]:
    owner_id = _owner_id(current_user)
    feedback_query: Dict[str, Any] = {"user_id": owner_id}
    override_query: Dict[str, Any] = {"admin_id": owner_id}
    if teacher_id:
        feedback_query["teacher_id"] = teacher_id
        assessment_ids = [
            item["id"]
            for item in await legacy.db.assessments.find(
                {"user_id": owner_id, "teacher_id": teacher_id},
                {"_id": 0, "id": 1},
            ).to_list(200)
        ]
        override_query["assessment_id"] = {"$in": assessment_ids or ["__none__"]}
    feedback_docs = await legacy.db.assessment_report_feedback.find(feedback_query, {"_id": 0}).to_list(1000)
    override_docs = await legacy.db.admin_assessment_overrides.find(override_query, {"_id": 0}).to_list(1000)
    useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "useful")
    not_useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "not_useful")
    useful_overrides = sum(
        1
        for item in override_docs
        if item.get("override_type") == "recommendation_usefulness" and item.get("adjusted_value") == "useful"
    )
    rewrite_overrides = sum(
        1
        for item in override_docs
        if item.get("override_type") == "recommendation_usefulness" and item.get("adjusted_value") == "needs_rewrite"
    )
    evidence_overrides = sum(1 for item in override_docs if item.get("override_type") == "evidence_relevance")
    guidance: List[str] = []
    if rewrite_overrides + not_useful >= useful + useful_overrides:
        guidance.append("Keep recommendations short, specific, and immediately usable in a coaching conference.")
    if evidence_overrides > 0:
        guidance.append(
            "Prioritize evidence segments that align closely to the active focus note and current coaching goals."
        )
    if useful + useful_overrides > rewrite_overrides + not_useful:
        guidance.append("Preserve concrete, timestamped coaching language because reviewers are responding well to it.")
    return {
        "feedback_counts": {
            "useful": useful,
            "not_useful": not_useful,
        },
        "override_counts": {
            "recommendation_useful": useful_overrides,
            "recommendation_needs_rewrite": rewrite_overrides,
            "evidence_relevance": evidence_overrides,
        },
        "guidance": guidance,
    }


async def build_analysis_context(current_user: dict, teacher_id: str) -> Dict[str, Any]:
    owner_id = _owner_id(current_user)
    framework_selection = await legacy.db.framework_selections.find_one(
        {"user_id": owner_id},
        {"_id": 0},
    )
    teacher = await legacy.db.teachers.find_one(
        {"id": teacher_id, "created_by": owner_id},
        {"_id": 0},
    )
    action_plan = await legacy.db.action_plans.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    )
    reflection = await legacy.db.summary_reflections.find_one(
        {"teacher_id": teacher_id, "user_id": owner_id},
        {"_id": 0},
    )
    memory_entries = await workspace_repository.list_memory_entries(
        owner_id,
        scope_type="teacher",
        scope_id=teacher_id,
    )
    enriched_goals = (
        legacy._enrich_action_plan_goals_with_evidence(
            (action_plan or {}).get("goals", []),
            await legacy._build_teacher_evidence_catalog(teacher or {"id": teacher_id}, current_user),
        )
        if teacher
        else []
    )
    signal_summary = await build_feedback_signal_summary(current_user, teacher_id=teacher_id)
    memory_support = await build_teacher_memory_support(
        current_user,
        teacher_id,
        language="en",
    )
    linked_goal_ids = list((reflection or {}).get("linked_goal_ids") or [])
    linked_goal_titles = [
        goal.get("title") for goal in enriched_goals if goal.get("id") in linked_goal_ids and goal.get("title")
    ]
    return {
        "teacher_name": (teacher or {}).get("name"),
        "priority_elements": (framework_selection or {}).get("priority_elements", []),
        "focus_note": (framework_selection or {}).get("focus_note"),
        "active_goals": [
            goal.get("title")
            for goal in enriched_goals
            if goal.get("title") and goal.get("status") not in {"complete", "implemented"}
        ][:3],
        "goal_progress_signals": [
            {
                "id": goal.get("id"),
                "title": goal.get("title"),
                "progress_signal": goal.get("progress_signal"),
                "progress_summary": goal.get("progress_summary"),
                "latest_evidence_at": goal.get("latest_evidence_at"),
            }
            for goal in enriched_goals
            if goal.get("title")
        ][:4],
        "action_plan_notes": (action_plan or {}).get("notes"),
        "reflection_summary": {
            "self_reflection": (reflection or {}).get("self_reflection"),
            "actions_taken": (reflection or {}).get("actions_taken"),
            "linked_goal_ids": linked_goal_ids,
            "linked_goal_titles": linked_goal_titles,
        },
        "memory_entries": memory_entries[:4],
        "signal_summary": signal_summary,
        "conference_continuity_lines": list(memory_support.get("conference_continuity_lines") or []),
    }


async def build_feedback_digest(current_user: dict) -> Dict[str, Any]:
    owner_id = _owner_id(current_user)
    feedback_docs = await legacy.db.assessment_report_feedback.find(
        {"user_id": owner_id},
        {"_id": 0},
    ).to_list(5000)
    override_docs = await legacy.db.admin_assessment_overrides.find(
        {"admin_id": owner_id},
        {"_id": 0},
    ).to_list(5000)

    feedback_by_surface: Dict[str, int] = {}
    for item in feedback_docs:
        surface = item.get("source_surface") or "unknown"
        feedback_by_surface[surface] = feedback_by_surface.get(surface, 0) + 1

    rewrite_sections: Dict[str, int] = {}
    for item in override_docs:
        if item.get("override_type") != "recommendation_usefulness":
            continue
        if item.get("adjusted_value") != "needs_rewrite":
            continue
        section = (item.get("metadata") or {}).get("section") or "unknown"
        rewrite_sections[section] = rewrite_sections.get(section, 0) + 1

    memory_count = len(await workspace_repository.list_memory_entries(owner_id))
    useful_count = sum(1 for item in feedback_docs if item.get("feedback_value") == "useful")
    not_useful_count = sum(1 for item in feedback_docs if item.get("feedback_value") == "not_useful")
    digest_items: List[dict] = []
    if useful_count or not_useful_count:
        digest_items.append(
            {
                "id": "recommendation_feedback",
                "title": "Recommendation feedback pattern",
                "summary": f"{useful_count} useful vs {not_useful_count} not useful ratings collected.",
            }
        )
    if rewrite_sections:
        top_section = sorted(rewrite_sections.items(), key=lambda item: item[1], reverse=True)[0]
        digest_items.append(
            {
                "id": "rewrite_pressure",
                "title": "Recommendation rewrite pressure",
                "summary": f"Most rewrite requests are coming from {top_section[0]} ({top_section[1]} overrides).",
            }
        )
    if memory_count:
        digest_items.append(
            {
                "id": "memory_scope",
                "title": "Adaptive context in use",
                "summary": f"{memory_count} bounded memory entries are available to ground coaching context.",
            }
        )
    return {
        "generated_at": _utc_now(),
        "totals": {
            "feedback_records": len(feedback_docs),
            "override_records": len(override_docs),
            "memory_entries": memory_count,
        },
        "feedback_by_surface": feedback_by_surface,
        "rewrite_sections": rewrite_sections,
        "items": digest_items,
    }


async def get_ai_quality_snapshot(current_user: dict) -> Dict[str, Any]:
    owner_id = _owner_id(current_user)
    feedback_docs = await legacy.db.assessment_report_feedback.find(
        {"user_id": owner_id},
        {"_id": 0},
    ).to_list(5000)
    override_docs = await legacy.db.admin_assessment_overrides.find(
        {"admin_id": owner_id},
        {"_id": 0},
    ).to_list(5000)
    useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "useful")
    not_useful = sum(1 for item in feedback_docs if item.get("feedback_value") == "not_useful")
    total_feedback = useful + not_useful
    useful_rate = round(useful / total_feedback, 3) if total_feedback else None
    override_breakdown: Dict[str, int] = {}
    for item in override_docs:
        key = item.get("override_type") or "unknown"
        override_breakdown[key] = override_breakdown.get(key, 0) + 1
    return {
        "generated_at": _utc_now(),
        "metrics": {
            "total_feedback": total_feedback,
            "useful_feedback": useful,
            "not_useful_feedback": not_useful,
            "useful_feedback_rate": useful_rate,
            "total_overrides": len(override_docs),
            "override_breakdown": override_breakdown,
        },
    }
