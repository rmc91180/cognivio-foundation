from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT_DIR, ".env"))


IndexKeys = Sequence[Tuple[str, int]]


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    keys: IndexKeys
    unique: bool = False

    @property
    def name(self) -> str:
        suffix = "_".join(f"{field}_{direction}" for field, direction in self.keys)
        return f"idx_{suffix}"


INDEX_SPECS: List[IndexSpec] = [
    IndexSpec("videos", [("workspace_id", ASCENDING), ("teacher_id", ASCENDING), ("status", ASCENDING)]),
    IndexSpec("videos", [("workspace_id", ASCENDING), ("privacy_status", ASCENDING), ("analysis_status", ASCENDING)]),
    IndexSpec("videos", [("teacher_id", ASCENDING)]),
    IndexSpec("videos", [("created_at", ASCENDING)]),
    IndexSpec("assessments", [("workspace_id", ASCENDING), ("teacher_id", ASCENDING), ("created_at", DESCENDING)]),
    IndexSpec("assessments", [("workspace_id", ASCENDING), ("status", ASCENDING)]),
    IndexSpec("assessments", [("video_id", ASCENDING)]),
    IndexSpec("users", [("email", ASCENDING)], unique=True),
    IndexSpec("users", [("organization_id", ASCENDING), ("tenant_role", ASCENDING)]),
    IndexSpec("observation_sessions", [("workspace_id", ASCENDING), ("observer_id", ASCENDING), ("status", ASCENDING)]),
    IndexSpec("observation_sessions", [("workspace_id", ASCENDING), ("teacher_id", ASCENDING)]),
    IndexSpec("observation_sessions", [("scheduled_date", ASCENDING)]),
    IndexSpec("coaching_tasks", [("workspace_id", ASCENDING), ("observer_id", ASCENDING), ("status", ASCENDING)]),
    IndexSpec("coaching_tasks", [("workspace_id", ASCENDING), ("teacher_id", ASCENDING)]),
    IndexSpec("coaching_tasks", [("due_date", ASCENDING)]),
    IndexSpec("audit_events", [("workspace_id", ASCENDING), ("created_at", DESCENDING)]),
    IndexSpec("audit_events", [("actor_user_id", ASCENDING), ("created_at", DESCENDING)]),
]


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Environment variable {name} must be set")
    return value


def _normalize_keys(keys: Iterable[Tuple[str, int]]) -> Tuple[Tuple[str, int], ...]:
    return tuple((field, int(direction)) for field, direction in keys)


def _index_exists(existing_indexes: dict, spec: IndexSpec) -> bool:
    expected_keys = _normalize_keys(spec.keys)
    for index_doc in existing_indexes.values():
        if _normalize_keys(index_doc.get("key", [])) != expected_keys:
            continue
        if bool(index_doc.get("unique", False)) != spec.unique:
            continue
        return True
    return False


def ensure_indexes() -> dict:
    client = MongoClient(_required_env("MONGO_URL"))
    db = client[_required_env("DB_NAME")]
    summary = {"created": [], "already_existing": [], "total_expected": len(INDEX_SPECS)}
    try:
        for spec in INDEX_SPECS:
            collection = db[spec.collection]
            existing_before = collection.index_information()
            label = f"{spec.collection}.{spec.name}"
            if _index_exists(existing_before, spec):
                summary["already_existing"].append(label)
                continue
            collection.create_index(
                list(spec.keys),
                name=spec.name,
                unique=spec.unique,
                background=True,
            )
            summary["created"].append(label)
    finally:
        client.close()
    return summary


def main() -> None:
    summary = ensure_indexes()
    print("MongoDB index migration complete")
    print(f"Created: {len(summary['created'])}")
    for item in summary["created"]:
        print(f"  + {item}")
    print(f"Already existing: {len(summary['already_existing'])}")
    for item in summary["already_existing"]:
        print(f"  = {item}")
    print(f"Total expected: {summary['total_expected']}")


if __name__ == "__main__":
    main()
