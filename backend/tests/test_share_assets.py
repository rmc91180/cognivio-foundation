import importlib.util
from pathlib import Path


def _load_share_assets_module():
    module_path = Path(__file__).resolve().parents[1] / "share_assets.py"
    spec = importlib.util.spec_from_file_location("backend_share_assets", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


share_assets = _load_share_assets_module()


def test_render_social_share_card_creates_png(tmp_path):
    output = tmp_path / "social_card.png"
    stats = share_assets.render_social_share_card(
        str(output),
        teacher_name="Alicia Stone",
        badge_label="5-Star Lesson",
        lesson_title="Algebraic Thinking",
        summary="High-clarity questioning, pacing, and checks for understanding.",
        subject="Math",
        grade_level="8",
    )

    assert output.exists()
    assert output.stat().st_size > 0
    assert stats["width"] == share_assets.CARD_WIDTH


def test_build_email_signature_html_contains_image_and_link():
    html = share_assets.build_email_signature_html(
        image_url="https://cdn.example.com/signature.png",
        teacher_name="Alicia Stone",
        badge_label="5-Star Lesson",
        link_url="https://app.example.com/videos/video_1",
    )

    assert "https://cdn.example.com/signature.png" in html
    assert "https://app.example.com/videos/video_1" in html
    assert "Alicia Stone" in html
