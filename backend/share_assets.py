from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

from PIL import Image, ImageDraw, ImageFont


CARD_WIDTH = 1600
CARD_HEIGHT = 900
SIGNATURE_WIDTH = 1200
SIGNATURE_HEIGHT = 280


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "arialbd.ttf" if bold else "arial.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _draw_wrapped_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: str,
    max_width: int,
    line_spacing: int = 10,
) -> int:
    x, y = xy
    words = (text or "").split()
    if not words:
        return y
    line = words[0]
    lines = []
    for word in words[1:]:
        candidate = f"{line} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width:
            line = candidate
        else:
            lines.append(line)
            line = word
    lines.append(line)
    current_y = y
    for item in lines:
        draw.text((x, current_y), item, font=font, fill=fill)
        bbox = draw.textbbox((0, 0), item, font=font)
        current_y += (bbox[3] - bbox[1]) + line_spacing
    return current_y


def render_social_share_card(
    output_path: str,
    *,
    teacher_name: str,
    badge_label: str,
    lesson_title: str,
    summary: str,
    subject: Optional[str] = None,
    grade_level: Optional[str] = None,
) -> Dict[str, int]:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), "#f5f1e8")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((60, 60, CARD_WIDTH - 60, CARD_HEIGHT - 60), radius=28, fill="#fffdf8", outline="#d7c7ab", width=4)
    draw.rounded_rectangle((90, 90, 530, 180), radius=26, fill="#0f766e")
    draw.text((120, 116), "COGNIVIO RECOGNITION", font=_load_font(36, bold=True), fill="#f8fafc")
    draw.text((110, 240), badge_label.upper(), font=_load_font(74, bold=True), fill="#92400e")
    draw.text((110, 340), teacher_name, font=_load_font(54, bold=True), fill="#111827")
    meta = " • ".join([item for item in [subject, grade_level] if item])
    if meta:
        draw.text((110, 414), meta, font=_load_font(28), fill="#475569")
    draw.text((110, 470), lesson_title, font=_load_font(40, bold=True), fill="#1f2937")
    end_y = _draw_wrapped_text(
        draw,
        summary,
        (110, 540),
        _load_font(28),
        "#475569",
        max_width=1320,
        line_spacing=12,
    )
    draw.rounded_rectangle((110, CARD_HEIGHT - 180, 420, CARD_HEIGHT - 110), radius=24, fill="#1d4ed8")
    draw.text((145, CARD_HEIGHT - 160), "Teach. Reflect. Grow.", font=_load_font(28, bold=True), fill="#eff6ff")
    draw.text((110, max(end_y + 30, CARD_HEIGHT - 250)), "Recognized inside Cognivio's professional learning network.", font=_load_font(26), fill="#64748b")

    image.save(path, format="PNG")
    return {"width": CARD_WIDTH, "height": CARD_HEIGHT}


def render_email_signature_badge(
    output_path: str,
    *,
    teacher_name: str,
    badge_label: str,
    featured_label: Optional[str] = None,
) -> Dict[str, int]:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGB", (SIGNATURE_WIDTH, SIGNATURE_HEIGHT), "#ffffff")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((20, 20, SIGNATURE_WIDTH - 20, SIGNATURE_HEIGHT - 20), radius=24, fill="#f8fafc", outline="#cbd5e1", width=3)
    draw.rounded_rectangle((40, 50, 280, 230), radius=22, fill="#7c2d12")
    draw.text((78, 95), "COGNIVIO", font=_load_font(34, bold=True), fill="#fff7ed")
    draw.text((78, 142), "5-STAR", font=_load_font(42, bold=True), fill="#fef3c7")
    draw.text((340, 78), teacher_name, font=_load_font(42, bold=True), fill="#0f172a")
    draw.text((340, 136), badge_label, font=_load_font(30), fill="#334155")
    if featured_label:
        draw.text((340, 182), featured_label, font=_load_font(24), fill="#0f766e")
    draw.text((340, 214), "Recognized by Cognivio", font=_load_font(22), fill="#64748b")

    image.save(path, format="PNG")
    return {"width": SIGNATURE_WIDTH, "height": SIGNATURE_HEIGHT}


def build_email_signature_html(
    *,
    image_url: str,
    teacher_name: str,
    badge_label: str,
    link_url: str,
) -> str:
    safe_image_url = (image_url or "").replace('"', "&quot;")
    safe_link_url = (link_url or "").replace('"', "&quot;")
    safe_teacher_name = (teacher_name or "").replace("<", "&lt;").replace(">", "&gt;")
    safe_badge_label = (badge_label or "").replace("<", "&lt;").replace(">", "&gt;")
    return (
        "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"font-family:Arial,sans-serif;\">"
        "<tr>"
        f"<td style=\"padding-right:12px;\"><a href=\"{safe_link_url}\">"
        f"<img src=\"{safe_image_url}\" alt=\"{safe_badge_label}\" style=\"display:block;height:70px;border:0;\" />"
        "</a></td>"
        "<td style=\"font-size:13px;line-height:1.4;color:#334155;\">"
        f"<div style=\"font-weight:700;color:#0f172a;\">{safe_teacher_name}</div>"
        f"<div>{safe_badge_label}</div>"
        f"<div><a href=\"{safe_link_url}\" style=\"color:#2563eb;text-decoration:none;\">Recognized by Cognivio</a></div>"
        "</td>"
        "</tr>"
        "</table>"
    )
