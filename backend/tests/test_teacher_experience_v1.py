from scripts.seed_demo_data import build_demo_documents


def test_demo_seed_builds_connected_teacher_experience_records():
    docs = build_demo_documents("k12")
    teacher = next(t for t in docs["teachers"] if t["id"] == "demo-k12-teacher-1")
    assert teacher["subjects"]
    assert teacher["class_section"] == "Period 2"
    assert any(ref["teacher_id"] == teacher["id"] for ref in docs["teacher_face_references"])
    assert any(reminder["teacher_id"] == teacher["id"] for reminder in docs["gradebook_reminders"])
    assert any(task["teacher_id"] == teacher["id"] for task in docs["coaching_tasks"])
    assert any(badge["teacher_id"] == teacher["id"] for badge in docs["recognition_badges"])


def test_training_seed_includes_demo_trainee_workspace_records():
    docs = build_demo_documents("training")
    trainee = next(t for t in docs["teachers"] if t["id"] == "demo-training-trainee-1")
    assert trainee["subjects"]
    assert any(user["teacher_id"] == trainee["id"] for user in docs["users"] if user.get("tenant_role") == "teacher")
    assert any(ref["teacher_id"] == trainee["id"] for ref in docs["teacher_face_references"])
    assert any(reminder["teacher_id"] == trainee["id"] for reminder in docs["gradebook_reminders"])
