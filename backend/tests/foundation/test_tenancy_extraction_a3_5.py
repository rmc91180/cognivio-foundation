"""A3.5 — tenancy resolvers relocated to app/tenancy.py (pure move + re-export).

The PRIMARY proof of zero-behavior-change is the full existing suite staying green
through the server.py aliases. These tests additionally pin (E1) importability,
(E2) the distinct per-function fallback policies (the one a careless "unify" would
break), and (E3) that the server.py aliases ARE the relocated functions (no stale
copy survived).
"""

from __future__ import annotations

import server
from app import tenancy


# --- E1: importable + callable directly from app.tenancy ---
def test_e1_all_three_importable_and_callable():
    for fn in (tenancy.resolve_video_workspace_id, tenancy.workspace_id_for_user, tenancy.training_workspace_id):
        assert callable(fn)


# --- E2: behavior parity per distinct chain ---
def test_e2_resolve_video_workspace_id_six_leg_chain():
    # video.workspace_id wins when present
    assert tenancy.resolve_video_workspace_id(
        {"workspace_id": "ws", "uploaded_by": "u"}, {"organization_id": "org"}, {"id": "cu"}
    ) == "ws"
    # falls through all 6 legs to current_user.id when everything above is absent
    assert tenancy.resolve_video_workspace_id({}, {}, {"id": "cu"}) == "cu"
    # intermediate legs in order: teacher.org → school → created_by → video.uploaded_by
    assert tenancy.resolve_video_workspace_id({}, {"organization_id": "org"}, {"id": "cu"}) == "org"
    assert tenancy.resolve_video_workspace_id({}, {"school_id": "sch"}, {"id": "cu"}) == "sch"
    assert tenancy.resolve_video_workspace_id({}, {"created_by": "cb"}, {"id": "cu"}) == "cb"
    assert tenancy.resolve_video_workspace_id({"uploaded_by": "ub"}, {}, {"id": "cu"}) == "ub"
    # None when even current_user.id is absent (teacher may be None)
    assert tenancy.resolve_video_workspace_id({}, None, {}) is None


def test_e2_workspace_id_for_user_three_leg_chain_str():
    assert tenancy.workspace_id_for_user({"organization_id": "org", "school_id": "sch", "id": "u"}) == "org"
    assert tenancy.workspace_id_for_user({"school_id": "sch", "id": "u"}) == "sch"
    assert tenancy.workspace_id_for_user({"id": "u"}) == "u"
    # always str()
    assert tenancy.workspace_id_for_user({"organization_id": 12345}) == "12345"
    assert isinstance(tenancy.workspace_id_for_user({"id": 7}), str)


def test_e2_training_workspace_id_never_consults_school():
    assert tenancy.training_workspace_id({"organization_id": "org", "id": "u"}) == "org"
    # The distinguishing leg: school_id present but NO org → must return id, NOT school_id.
    # This is exactly what a careless unify with workspace_id_for_user would break.
    assert tenancy.training_workspace_id({"school_id": "sch", "id": "u"}) == "u"
    assert isinstance(tenancy.training_workspace_id({"id": 9}), str)


# --- E3: server aliases ARE the relocated functions (live re-export, no stale copy) ---
def test_e3_server_aliases_are_the_same_objects():
    assert server._resolve_video_workspace_id is tenancy.resolve_video_workspace_id
    assert server._workspace_id_for_user is tenancy.workspace_id_for_user
    assert server._training_workspace_id is tenancy.training_workspace_id
