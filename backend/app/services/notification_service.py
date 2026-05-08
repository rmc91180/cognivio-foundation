from __future__ import annotations

import html
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import server as legacy


BRAND_NAVY = "#0D1B40"
BRAND_TEAL = "#00A896"


def _first_name(name: Optional[str]) -> str:
    return str(name or "there").strip().split(" ")[0] or "there"


def _login_url(path: str = "/login") -> str:
    base = (legacy.FRONTEND_URL or legacy.BACKEND_PUBLIC_BASE_URL or "https://www.cognivio.live").rstrip("/")
    return f"{base}{path}"


def _plain(value: Any) -> str:
    return str(value or "").strip()


def _html_frame(title: str, body: str, action_url: Optional[str] = None, action_label: str = "Open Cognivio") -> str:
    escaped_title = html.escape(title)
    button = ""
    if action_url:
        button = (
            f'<p style="margin:22px 0 0;">'
            f'<a href="{html.escape(action_url)}" style="display:inline-block;background:{BRAND_TEAL};'
            f'color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">'
            f'{html.escape(action_label)}</a></p>'
        )
    return f"""
<div style="font-family:Inter,Arial,sans-serif;color:{BRAND_NAVY};line-height:1.55;max-width:620px;margin:0 auto;padding:28px;">
  <div style="font-size:22px;font-weight:800;margin-bottom:18px;">Cognivio</div>
  <h1 style="font-size:22px;line-height:1.25;margin:0 0 14px;color:{BRAND_NAVY};">{escaped_title}</h1>
  <div style="font-size:15px;color:#26324F;">{body}</div>
  {button}
</div>
""".strip()


class NotificationService:
    def __init__(self, db=None):
        self.db = db or legacy.db

    async def _preferences(self, user_doc: dict) -> dict:
        defaults = {
            "email_observation_complete": True,
            "email_goal_added": True,
            "email_recognition": True,
            "email_conference_reminder": True,
            "email_frequency": "immediate",
        }
        if not user_doc.get("id"):
            return defaults
        doc = await self.db.notification_preferences.find_one({"user_id": user_doc["id"]}, {"_id": 0})
        if doc:
            defaults.update({k: v for k, v in doc.items() if k in defaults})
        return defaults

    async def _should_email(self, user_doc: dict, preference_key: Optional[str]) -> bool:
        prefs = await self._preferences(user_doc)
        if prefs.get("email_frequency") == "off":
            return False
        if preference_key and not prefs.get(preference_key, True):
            return False
        return prefs.get("email_frequency") == "immediate"

    async def _notify(
        self,
        *,
        recipient_user: dict,
        notification_type: str,
        title: str,
        body: str,
        action_url: Optional[str] = None,
        preference_key: Optional[str] = None,
        html_body: Optional[str] = None,
        email_body: Optional[str] = None,
        workspace_id: Optional[str] = None,
        teacher_id: Optional[str] = None,
    ) -> dict:
        recipient_email = _plain(recipient_user.get("email"))
        emailed = False
        if recipient_email and await self._should_email(recipient_user, preference_key):
            emailed = legacy._send_platform_email(
                title,
                recipient_email,
                email_body or body,
                html_body=html_body or _html_frame(title, f"<p>{html.escape(email_body or body)}</p>", action_url),
            )
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "workspace_id": workspace_id or recipient_user.get("organization_id") or recipient_user.get("id"),
            "recipient_user_id": recipient_user.get("id"),
            "user_id": recipient_user.get("id"),
            "type": notification_type,
            "notification_type": notification_type,
            "title": title,
            "body": body,
            "message": body,
            "action_url": action_url,
            "cta_url": action_url,
            "teacher_id": teacher_id,
            "payload": {},
            "read": False,
            "read_at": None,
            "emailed": emailed,
            "channel": "email" if emailed else "in_app",
            "status": "sent" if emailed else "queued",
            "created_at": now,
        }
        await self.db.notifications.insert_one(doc)
        return doc

    async def send_access_approved(self, user_doc: dict, organization_name: Optional[str], approval_note: Optional[str] = None):
        role = legacy._get_user_tenant_role(user_doc)
        school = _plain(user_doc.get("school_name") or organization_name)
        admin_name = _plain(user_doc.get("manager_name") or user_doc.get("manager_email"))
        if role == "teacher":
            context = f"You've been added to {school or 'your school'}."
            if admin_name:
                context += f" Your administrator is {admin_name}."
        elif role in {"school_admin", "training_admin"}:
            context = f"Your school {school or organization_name or 'workspace'} is set up. You can add your teachers and start planning observations right away."
        else:
            context = "Your Cognivio workspace is ready."
        note = f"\n\n{approval_note}" if approval_note else ""
        text = f"Your account is ready. {context}{note}\n\nLog in here: {_login_url('/login')}"
        return await self._notify(
            recipient_user=user_doc,
            notification_type="access_approved",
            title="You're in — welcome to Cognivio",
            body=f"Your account is ready. {context}",
            action_url=_login_url("/login"),
            html_body=_html_frame("You're in — welcome to Cognivio", f"<p>{html.escape('Your account is ready. ' + context)}</p>{'<p>' + html.escape(approval_note) + '</p>' if approval_note else ''}", _login_url("/login"), "Log in"),
            email_body=text,
        )

    async def send_access_rejected(self, user_doc: dict, reason: Optional[str]):
        reason_line = f"\n\nReason: {reason}" if reason else ""
        text = f"We weren't able to approve your request at this time.{reason_line}\n\nIf you think this is a mistake, reply to this email."
        return await self._notify(
            recipient_user=user_doc,
            notification_type="access_rejected",
            title="About your Cognivio request",
            body=f"We weren't able to approve your request at this time.{(' Reason: ' + reason) if reason else ''}",
            action_url=_login_url("/login"),
            html_body=_html_frame("About your Cognivio request", f"<p>{html.escape(text).replace(chr(10), '<br/>')}</p>"),
            email_body=text,
        )

    async def send_observation_complete(self, teacher_doc: dict, assessment_doc: dict, observer_doc: dict):
        teacher_user = await legacy._find_user_by_email(teacher_doc.get("email"))
        if not teacher_user:
            return None
        summary = _plain(assessment_doc.get("summary") or "Your observer left feedback from your recent lesson.")
        first_sentence = summary.split(".")[0].strip() + "." if summary else ""
        text = f"{observer_doc.get('name')} has reviewed your recent lesson and left feedback. {first_sentence}\n\nLog in to read the full feedback and see what to try next: {_login_url('/my-workspace')}"
        return await self._notify(
            recipient_user=teacher_user,
            notification_type="observation_complete",
            title=f"{_first_name(observer_doc.get('name'))} reviewed your lesson",
            body=f"{observer_doc.get('name')} reviewed your recent lesson and left feedback.",
            action_url=_login_url("/my-workspace"),
            preference_key="email_observation_complete",
            html_body=_html_frame(f"{_first_name(observer_doc.get('name'))} reviewed your lesson", f"<p>{html.escape(text).replace(chr(10), '<br/>')}</p>", _login_url("/my-workspace"), "Read feedback"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    async def send_coaching_goal_added(self, teacher_doc: dict, goal_doc: dict, admin_doc: dict):
        teacher_user = await legacy._find_user_by_email(teacher_doc.get("email"))
        if not teacher_user:
            return None
        goal_text = _plain(goal_doc.get("goal_text") or goal_doc.get("title"))
        text = f"{admin_doc.get('name')} has added something to your coaching plan.\n\n{goal_text}\n\nTake a look and add your own notes when you're ready: {_login_url('/my-workspace')}"
        return await self._notify(
            recipient_user=teacher_user,
            notification_type="goal_added",
            title=f"{_first_name(admin_doc.get('name'))} added a goal to your plan",
            body=f"{admin_doc.get('name')} added a goal to your coaching plan.",
            action_url=_login_url("/my-workspace"),
            preference_key="email_goal_added",
            html_body=_html_frame(f"{_first_name(admin_doc.get('name'))} added a goal to your plan", f"<p>{html.escape(text).replace(chr(10), '<br/>')}</p>", _login_url("/my-workspace"), "Open plan"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    async def send_goal_tried_notification(self, admin_doc: dict, teacher_doc: dict, goal_doc: dict):
        goal_text = _plain(goal_doc.get("goal_text") or goal_doc.get("title"))
        url = _login_url(f"/teachers/{teacher_doc.get('id')}")
        text = f"{teacher_doc.get('name')} marked a goal as tried and may have added a note.\n\n{goal_text}\n\nLog in to see what they wrote: {url}"
        return await self._notify(
            recipient_user=admin_doc,
            notification_type="goal_tried",
            title=f"{_first_name(teacher_doc.get('name'))} tried something from their plan",
            body=f"{teacher_doc.get('name')} marked a goal as tried.",
            action_url=url,
            preference_key="email_goal_added",
            html_body=_html_frame(f"{_first_name(teacher_doc.get('name'))} tried something from their plan", f"<p>{html.escape(text).replace(chr(10), '<br/>')}</p>", url, "Open goal"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    async def send_recognition_earned(self, teacher_doc: dict, recognition_doc: dict, admin_doc: dict):
        teacher_user = await legacy._find_user_by_email(teacher_doc.get("email"))
        if not teacher_user:
            return None
        school = _plain(teacher_doc.get("school_name") or admin_doc.get("school_name") or "your school")
        element = _plain(recognition_doc.get("element_name") or "a powerful teaching move")
        text = f"Your recent lesson stood out. {admin_doc.get('name')} noticed {element} and wanted you to know — what you did is exactly the kind of teaching this school is working toward. Your lesson has been added to the school exemplar library. Well done. {_login_url('/my-badges')}"
        return await self._notify(
            recipient_user=teacher_user,
            notification_type="recognition_earned",
            title=f"Something worth celebrating — {school}",
            body=f"Your recent lesson stood out. {admin_doc.get('name')} noticed {element}.",
            action_url=_login_url("/my-badges"),
            preference_key="email_recognition",
            html_body=_html_frame(f"Something worth celebrating — {school}", f"<p>{html.escape(text)}</p>", _login_url("/my-badges"), "View badge"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    async def send_recognition_nominated(self, admin_doc: dict, teacher_doc: dict, recognition_doc: dict):
        text = f"A lesson from {teacher_doc.get('name')} has been nominated for the school exemplar library. Log in to review and approve: {_login_url('/recognition-review')}"
        return await self._notify(
            recipient_user=admin_doc,
            notification_type="recognition_nominated",
            title=f"{teacher_doc.get('name')}'s lesson has been flagged for recognition",
            body=f"A lesson from {teacher_doc.get('name')} is ready for recognition review.",
            action_url=_login_url("/recognition-review"),
            preference_key="email_recognition",
            html_body=_html_frame(f"{teacher_doc.get('name')}'s lesson has been flagged for recognition", f"<p>{html.escape(text)}</p>", _login_url("/recognition-review"), "Review lesson"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    async def send_conference_reminder(self, admin_doc: dict, teacher_doc: dict, scheduled_date: Any):
        url = _login_url(f"/coaching?teacher_id={teacher_doc.get('id')}&tab=conference")
        text = f"You have a coaching conversation with {teacher_doc.get('name')} tomorrow. Your conference prep is ready: {url}"
        return await self._notify(
            recipient_user=admin_doc,
            notification_type="conference_reminder",
            title=f"Coaching conversation with {_first_name(teacher_doc.get('name'))} — tomorrow",
            body=f"Your conference prep for {teacher_doc.get('name')} is ready.",
            action_url=url,
            preference_key="email_conference_reminder",
            html_body=_html_frame(f"Coaching conversation with {_first_name(teacher_doc.get('name'))} — tomorrow", f"<p>{html.escape(text)}</p>", url, "Open prep"),
            email_body=text,
            teacher_id=teacher_doc.get("id"),
        )

    def preview(self, template_name: str) -> str:
        demo_user = {"id": "demo-user", "name": "Sarah Chen", "email": "demo@cognivio.test", "tenant_role": "teacher", "school_name": "Westbrook Elementary", "manager_name": "Principal Lee"}
        title_map = {
            "access_approved": "You're in — welcome to Cognivio",
            "access_rejected": "About your Cognivio request",
            "observation_complete": "Principal Lee reviewed your lesson",
            "goal_added": "Principal Lee added a goal to your plan",
            "goal_tried": "Sarah tried something from their plan",
            "recognition_earned": "Something worth celebrating — Westbrook Elementary",
            "recognition_nominated": "Sarah Chen's lesson has been flagged for recognition",
            "conference_reminder": "Coaching conversation with Sarah — tomorrow",
        }
        title = title_map.get(template_name, "Cognivio notification")
        body = "<p>Welcome to Cognivio. This preview uses demo data so you can verify tone, spacing, and links before launch.</p>"
        return _html_frame(title, body, _login_url("/login"), "Open Cognivio")
