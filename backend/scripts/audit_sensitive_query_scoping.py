#!/usr/bin/env python
"""Advisory scanner for potentially unscoped sensitive MongoDB queries.

This is intentionally conservative. It flags direct collection calls that touch
high-risk collections without an obvious tenant, teacher, user, workspace, demo,
or master-admin exception scope in the query literal.
"""

from __future__ import annotations

import argparse
import ast
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Optional


SENSITIVE_COLLECTIONS = {
    "users",
    "teachers",
    "videos",
    "assessments",
    "video_comments",
    "video_audio_transcripts",
    "video_analysis_features",
    "reports",
    "coaching_tasks",
    "recognition_badges",
    "lesson_recognition_events",
    "teacher_face_references",
    "teacher_face_profiles",
    "framework_selections",
    "gradebook_reminders",
    "privacy_audit_events",
    "auth_event_log",
    "master_admin_audit_events",
    "user_sessions",
    "demo_reset_events",
}

QUERY_METHODS = {
    "find",
    "find_one",
    "count_documents",
    "find_one_and_update",
    "update_one",
    "update_many",
    "delete_one",
    "delete_many",
}

SCOPE_KEYS = {
    "id",
    "_id",
    "user_id",
    "actor_user_id",
    "author_id",
    "owner_id",
    "uploaded_by",
    "created_by",
    "teacher_id",
    "teacher_ids",
    "organization_id",
    "school_id",
    "program_id",
    "workspace_id",
    "video_id",
    "target_id",
    "email",
    "tenant_role",
    "demo_data",
    "demo_persona",
}

MASTER_ADMIN_HINTS = {
    "master_admin",
    "super_admin",
    "internal_readiness",
    "platform_ops",
    "dependency",
    "health",
    "diagnostic",
}


@dataclass
class Finding:
    file: str
    line: int
    collection: str
    method: str
    severity: str
    reason: str
    source: str


def _attribute_chain(node: ast.AST) -> list[str]:
    parts: list[str] = []
    current = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
    return list(reversed(parts))


def _collection_for_call(call: ast.Call) -> Optional[str]:
    if not isinstance(call.func, ast.Attribute):
        return None
    if call.func.attr not in QUERY_METHODS:
        return None
    chain = _attribute_chain(call.func.value)
    for item in reversed(chain):
        if item in SENSITIVE_COLLECTIONS:
            return item
    return None


def _literal_query_keys(node: ast.AST) -> set[str]:
    keys: set[str] = set()
    if isinstance(node, ast.Dict):
        for raw_key, raw_value in zip(node.keys, node.values):
            if isinstance(raw_key, ast.Constant) and isinstance(raw_key.value, str):
                key = raw_key.value
                keys.add(key)
                if key in {"$or", "$and"} and isinstance(raw_value, (ast.List, ast.Tuple)):
                    for item in raw_value.elts:
                        keys.update(_literal_query_keys(item))
            elif raw_key is None:
                keys.add("**")
        return keys
    if isinstance(node, ast.Name):
        return {f"${node.id}"}
    if isinstance(node, ast.Call):
        return {"$call"}
    if isinstance(node, ast.BinOp):
        keys.update(_literal_query_keys(node.left))
        keys.update(_literal_query_keys(node.right))
    return keys


def _line_has_exception(lines: list[str], lineno: int) -> bool:
    start = max(0, lineno - 3)
    end = min(len(lines), lineno + 1)
    window = "\n".join(lines[start:end]).lower()
    return "tenant-scope-ok" in window or "master-admin-scope-ok" in window


def _function_context(functions: list[tuple[int, int, str]], lineno: int) -> str:
    context = ""
    for start, end, name in functions:
        if start <= lineno <= end:
            context = name
    return context


def _function_ranges(tree: ast.AST) -> list[tuple[int, int, str]]:
    ranges: list[tuple[int, int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            end_lineno = getattr(node, "end_lineno", node.lineno)
            ranges.append((node.lineno, end_lineno, node.name))
    return ranges


def scan_file(path: Path, root: Path) -> list[Finding]:
    path = path.resolve()
    root = root.resolve()
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        source = path.read_text(encoding="utf-8", errors="ignore")
    tree = ast.parse(source, filename=str(path))
    lines = source.splitlines()
    functions = _function_ranges(tree)
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        collection = _collection_for_call(node)
        if not collection or not isinstance(node.func, ast.Attribute):
            continue
        method = node.func.attr
        if _line_has_exception(lines, node.lineno):
            continue
        context = _function_context(functions, node.lineno).lower()
        query_arg = node.args[0] if node.args else None
        keys = _literal_query_keys(query_arg) if query_arg is not None else set()
        has_scope = bool(keys & SCOPE_KEYS)
        master_admin_context = any(token in context for token in MASTER_ADMIN_HINTS)
        if has_scope:
            continue
        severity = "warning" if master_admin_context else "advisory"
        reason = (
            "master/internal context lacks an obvious query scope; document with master-admin-scope-ok if intentional"
            if master_admin_context
            else "sensitive collection query lacks an obvious tenant/user/teacher/workspace/demo scope"
        )
        findings.append(
            Finding(
                file=str(path.relative_to(root)),
                line=node.lineno,
                collection=collection,
                method=method,
                severity=severity,
                reason=reason,
                source=lines[node.lineno - 1].strip() if node.lineno - 1 < len(lines) else "",
            )
        )
    return findings


def iter_python_files(paths: Iterable[Path]) -> Iterable[Path]:
    for path in paths:
        path = path.resolve()
        if path.is_file() and path.suffix == ".py":
            yield path
            continue
        if path.is_dir():
            for candidate in path.rglob("*.py"):
                if "__pycache__" in candidate.parts or "tests" in candidate.parts:
                    continue
                yield candidate


def run_scan(paths: Iterable[Path], root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_python_files(paths):
        findings.extend(scan_file(path, root))
    return sorted(findings, key=lambda item: (item.file, item.line, item.collection))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", default=["backend"], help="Files or directories to scan.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when findings are present.")
    parser.add_argument("--limit", type=int, default=200, help="Maximum human findings to print.")
    args = parser.parse_args()

    root = Path.cwd()
    paths = [Path(item) for item in args.paths]
    findings = run_scan(paths, root)

    if args.json:
        print(json.dumps([asdict(item) for item in findings], indent=2))
    else:
        print("Sensitive query scoping audit")
        print(f"Findings: {len(findings)}")
        print("Mode: advisory by default; use --strict to fail on findings.")
        for item in findings[: max(0, args.limit)]:
            print(
                f"- {item.severity}: {item.file}:{item.line} "
                f"{item.collection}.{item.method} - {item.reason}"
            )
            print(f"  {item.source}")
        if len(findings) > args.limit:
            print(f"... {len(findings) - args.limit} more findings omitted by --limit.")

    return 1 if args.strict and findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
