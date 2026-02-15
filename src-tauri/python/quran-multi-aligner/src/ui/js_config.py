"""Python→JS config bridge — emits window.* globals and concatenates JS files."""
import json
from pathlib import Path

from config import (
    ANIM_PRESETS,
    ANIM_WINDOW_PREV_MAX, ANIM_WINDOW_AFTER_MAX,
    ANIM_WORD_COLOR,
    MEGA_WORD_SPACING_DEFAULT, MEGA_TEXT_SIZE_DEFAULT, MEGA_LINE_SPACING_DEFAULT,
    ANIM_DISPLAY_MODE_DEFAULT, ANIM_GRANULARITY_DEFAULT,
    ANIM_OPACITY_PREV_DEFAULT, ANIM_OPACITY_AFTER_DEFAULT,
    ANIM_WINDOW_PREV_DEFAULT, ANIM_WINDOW_AFTER_DEFAULT,
)

_STATIC_DIR = Path(__file__).parent / "static"


def build_js_head(surah_ligatures: dict) -> str:
    """Return a <script> block with Python config globals and both JS files."""
    config_lines = [
        f"window.SURAH_LIGATURES = {json.dumps(surah_ligatures)};",
        f"window.ANIM_PRESETS = {json.dumps(ANIM_PRESETS)};",
        f"window.ANIM_WINDOW_PREV_MAX = {ANIM_WINDOW_PREV_MAX};",
        f"window.ANIM_WINDOW_AFTER_MAX = {ANIM_WINDOW_AFTER_MAX};",
        f"window.ANIM_WORD_COLOR_DEFAULT = {json.dumps(ANIM_WORD_COLOR)};",
        f"window.MEGA_WORD_SPACING_DEFAULT = {MEGA_WORD_SPACING_DEFAULT};",
        f"window.MEGA_TEXT_SIZE_DEFAULT = {MEGA_TEXT_SIZE_DEFAULT};",
        f"window.MEGA_LINE_SPACING_DEFAULT = {MEGA_LINE_SPACING_DEFAULT};",
        f"window.ANIM_DISPLAY_MODE_DEFAULT = {json.dumps(ANIM_DISPLAY_MODE_DEFAULT)};",
        f"window.ANIM_GRANULARITY_DEFAULT = {json.dumps(ANIM_GRANULARITY_DEFAULT)};",
        f"window.ANIM_OPACITY_PREV_DEFAULT = {ANIM_OPACITY_PREV_DEFAULT};",
        f"window.ANIM_OPACITY_AFTER_DEFAULT = {ANIM_OPACITY_AFTER_DEFAULT};",
        f"window.ANIM_WINDOW_PREV_DEFAULT = {ANIM_WINDOW_PREV_DEFAULT};",
        f"window.ANIM_WINDOW_AFTER_DEFAULT = {ANIM_WINDOW_AFTER_DEFAULT};",
    ]
    config = "\n".join(config_lines)

    core_js = (_STATIC_DIR / "animation-core.js").read_text(encoding="utf-8")
    all_js = (_STATIC_DIR / "animate-all.js").read_text(encoding="utf-8")

    return (
        "<script>\n"
        f"{config}\n"
        "(function(){\n"
        f"{core_js}\n"
        f"{all_js}\n"
        "})();\n"
        "</script>"
    )
