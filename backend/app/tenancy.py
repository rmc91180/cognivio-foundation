"""Canonical tenancy-resolution seam (extracted from server.py in A3.5).

These are the READ-time workspace resolvers. A3 moved tenancy to WRITE time
(workspace_id stamped on video + assessment writes); these resolvers remain to
resolve legacy rows and caller-supplied dicts, and are the foundation module a
later live-repo strangle will re-implement.

EACH FUNCTION PRESERVES A DISTINCT HISTORICAL FALLBACK POLICY — they are NOT
interchangeable and MUST NOT be unified:
  * resolve_video_workspace_id — 6-leg (video → teacher → current_user), Optional[str]
  * workspace_id_for_user       — 3-leg (org → school → id), always str()
  * training_workspace_id       — 2-leg (org → id), NO school_id, always str()

Pure dict functions: this module imports NOTHING from server (no import cycle).
"""

from __future__ import annotations

from typing import Optional


def resolve_video_workspace_id(video: dict, teacher: Optional[dict], current_user: dict) -> Optional[str]:
    """Legacy-row fallback. New rows persist workspace_id at write time (A3); this
    resolver remains to resolve rows written before A3 and is the foundation seam a
    later strangle will replace. Behavior and signature are intentionally unchanged."""
    teacher = teacher or {}
    return (
        video.get("workspace_id")
        or teacher.get("organization_id")
        or teacher.get("school_id")
        or teacher.get("created_by")
        or video.get("uploaded_by")
        or current_user.get("id")
    )


def workspace_id_for_user(current_user: dict) -> str:
    return str(current_user.get("organization_id") or current_user.get("school_id") or current_user.get("id"))


def training_workspace_id(current_user: dict) -> str:
    return str(current_user.get("organization_id") or current_user.get("id"))
