"""Find and optionally unlink stale active relationships for deleted users.

Dry-run is the default. Use --apply to mutate data. Demo records are reported
but not changed unless --include-demo is supplied.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Set

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.config import Settings  # noqa: E402

DELETED_STATUSES = {"deleted", "hard_deleted", "account_deleted", "approval_deleted"}


def _is_deleted_user(doc: Dict[str, Any]) -> bool:
    status = str(doc.get("approval_status") or "").strip().lower()
    return (
        status in DELETED_STATUSES
        or doc.get("account_deleted") is True
        or doc.get("approval_deleted") is True
        or doc.get("deleted_at") is not None
    )


def _is_demo(doc: Dict[str, Any]) -> bool:
    return doc.get("demo_data") is True


def _active_user(doc: Dict[str, Any]) -> bool:
    if _is_deleted_user(doc):
        return False
    status = str(doc.get("approval_status") or "approved").strip().lower()
    return status == "approved" and doc.get("is_active", True) is not False


async def _docs(collection, query=None) -> List[Dict[str, Any]]:
    if collection is None:
        return []
    return await collection.find(query or {}, {"_id": 0}).to_list(100000)


async def analyze(db, *, include_demo: bool = False) -> Dict[str, Any]:
    users = await _docs(db.users)
    deleted_users = [doc for doc in users if _is_deleted_user(doc)]
    deleted_ids: Set[str] = {doc.get("id") for doc in deleted_users if doc.get("id")}
    deleted_emails: Set[str] = {str(doc.get("email") or "").strip().lower() for doc in deleted_users if doc.get("email")}

    stale_admin_links = []
    for user in users:
        if not include_demo and _is_demo(user):
            continue
        if user.get("manager_user_id") in deleted_ids or str(user.get("manager_email") or "").strip().lower() in deleted_emails:
            stale_admin_links.append(user)

    teachers = await _docs(getattr(db, "teachers", None))
    stale_teacher_links = [
        teacher
        for teacher in teachers
        if (include_demo or not _is_demo(teacher))
        and (
            teacher.get("created_by") in deleted_ids
            or teacher.get("linked_admin_user_id") in deleted_ids
            or str(teacher.get("linked_admin_email") or "").strip().lower() in deleted_emails
            or str(teacher.get("manager_email") or "").strip().lower() in deleted_emails
        )
    ]

    schools = await _docs(getattr(db, "schools", None))
    stale_workspace_links = [
        school
        for school in schools
        if (include_demo or not _is_demo(school)) and school.get("user_id") in deleted_ids
    ]

    organizations = await _docs(getattr(db, "organizations", None))
    active_users_by_org: Dict[str, int] = {}
    for user in users:
        if not _active_user(user):
            continue
        org_id = user.get("organization_id")
        if org_id:
            active_users_by_org[org_id] = active_users_by_org.get(org_id, 0) + 1

    organizations_with_zero_active = [
        org
        for org in organizations
        if (include_demo or not _is_demo(org))
        and active_users_by_org.get(org.get("id"), 0) == 0
        and str(org.get("status") or "active").lower() not in {"archived", "archived_orphaned", "deleted"}
    ]

    return {
        "deleted_users": deleted_users,
        "stale_admin_links": stale_admin_links,
        "stale_teacher_links": stale_teacher_links,
        "stale_workspace_links": stale_workspace_links,
        "organizations_with_zero_active": organizations_with_zero_active,
    }


async def apply_reconciliation(db, analysis: Dict[str, Any], *, actor: str, include_demo: bool = False) -> Dict[str, int]:
    now = datetime.now(timezone.utc).isoformat()
    counts = {
        "stale_admin_links": 0,
        "stale_teacher_links": 0,
        "stale_workspace_links": 0,
        "organizations_archived_orphaned": 0,
    }

    for user in analysis["stale_admin_links"]:
        result = await db.users.update_one(
            {"id": user.get("id")},
            {"$set": {"manager_user_id": None, "manager_email": None, "manager_name": None, "updated_at": now}},
        )
        counts["stale_admin_links"] += getattr(result, "modified_count", 0)

    for teacher in analysis["stale_teacher_links"]:
        result = await db.teachers.update_one(
            {"id": teacher.get("id")},
            {
                "$set": {
                    "linked_admin_user_id": None,
                    "linked_admin_name": None,
                    "linked_admin_email": None,
                    "manager_email": None,
                    "manager_name": None,
                    "updated_at": now,
                }
            },
        )
        counts["stale_teacher_links"] += getattr(result, "modified_count", 0)

    for school in analysis["stale_workspace_links"]:
        result = await db.schools.update_one(
            {"id": school.get("id")},
            {"$set": {"user_id": None, "updated_at": now}},
        )
        counts["stale_workspace_links"] += getattr(result, "modified_count", 0)

    for org in analysis["organizations_with_zero_active"]:
        if _is_demo(org) and not include_demo:
            continue
        result = await db.organizations.update_one(
            {"id": org.get("id")},
            {"$set": {"status": "archived_orphaned", "archived_orphaned_at": now, "updated_at": now}},
        )
        counts["organizations_archived_orphaned"] += getattr(result, "modified_count", 0)

    audit = getattr(db, "master_admin_audit_events", None)
    if audit is not None:
        await audit.insert_one(
            {
                "id": f"reconcile-{now}",
                "action": "reconcile_deleted_user_links",
                "actor_user_id": actor,
                "target_type": "platform",
                "target_id": "deleted-user-links",
                "created_at": now,
                "metadata": {"counts": counts, "include_demo": include_demo},
            }
        )
    return counts


def _print_summary(analysis: Dict[str, Any], *, applying: bool) -> None:
    print("Deleted-user link reconciliation")
    print(f"Mode: {'apply' if applying else 'dry-run'}")
    print(f"deleted users: {len(analysis['deleted_users'])}")
    print(f"stale admin links: {len(analysis['stale_admin_links'])}")
    print(f"stale teacher links: {len(analysis['stale_teacher_links'])}")
    print(f"stale workspace links: {len(analysis['stale_workspace_links'])}")
    print(f"organizations with zero active users/admins/teachers: {len(analysis['organizations_with_zero_active'])}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Mutate stale links. Dry-run is the default.")
    parser.add_argument("--include-demo", action="store_true", help="Allow mutations to demo_data records.")
    parser.add_argument("--actor", default="script:reconcile_deleted_user_links")
    args = parser.parse_args()

    load_dotenv(ROOT_DIR / ".env")
    settings = Settings.from_env()
    client = AsyncIOMotorClient(settings.database.mongo_url)
    db = client[settings.database.db_name]
    try:
        analysis = await analyze(db, include_demo=args.include_demo)
        _print_summary(analysis, applying=args.apply)
        if args.apply:
            counts = await apply_reconciliation(db, analysis, actor=args.actor, include_demo=args.include_demo)
            print(f"applied: {counts}")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
