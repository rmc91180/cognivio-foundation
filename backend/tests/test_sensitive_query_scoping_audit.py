from pathlib import Path

from scripts.audit_sensitive_query_scoping import run_scan


def test_sensitive_query_audit_runs_and_detects_unscoped_fixture(tmp_path):
    sample = tmp_path / "sample.py"
    sample.write_text(
        """
async def unsafe(db):
    return await db.videos.find({}).to_list(100)

async def scoped(db, teacher_id):
    return await db.videos.find({"teacher_id": teacher_id}).to_list(100)

async def documented_master(db):
    # master-admin-scope-ok: global readiness count.
    return await db.users.count_documents({})
""",
        encoding="utf-8",
    )

    findings = run_scan([sample], tmp_path)

    assert len(findings) == 1
    assert findings[0].collection == "videos"
    assert findings[0].method == "find"
