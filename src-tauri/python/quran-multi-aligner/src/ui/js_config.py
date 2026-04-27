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
    MANUAL_SPLIT_TEXT_MIN_HEIGHT_PX, MANUAL_SPLIT_TEXT_MAX_HEIGHT_PX,
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
        f"window.MANUAL_SPLIT_TEXT_MIN_HEIGHT_PX = {MANUAL_SPLIT_TEXT_MIN_HEIGHT_PX};",
        f"window.MANUAL_SPLIT_TEXT_MAX_HEIGHT_PX = {MANUAL_SPLIT_TEXT_MAX_HEIGHT_PX};",
    ]
    config = "\n".join(config_lines)

    core_js = (_STATIC_DIR / "animation-core.js").read_text(encoding="utf-8")
    all_js = (_STATIC_DIR / "animate-all.js").read_text(encoding="utf-8")
    manual_split_js = (_STATIC_DIR / "manual-split.js").read_text(encoding="utf-8")
    undo_split_js = (_STATIC_DIR / "undo-split.js").read_text(encoding="utf-8")

    ppb_observer_js = """
// Pipeline progress bar timer — fires when a bar is added to the DOM
(function() {
    var _timers = {};
    function _startPpbTimer(el) {
        var uid = el.id;
        if (!uid || _timers[uid]) return;
        var dur = parseInt(el.getAttribute('data-ppb-duration'), 10) || 30;
        var textEl = document.getElementById(uid + '-text');
        if (!textEl) return;
        var start = Date.now();
        _timers[uid] = setInterval(function() {
            if (!document.getElementById(uid)) {
                clearInterval(_timers[uid]);
                delete _timers[uid];
                return;
            }
            var elapsed = (Date.now() - start) / 1000;
            textEl.textContent = Math.floor(elapsed * 10) / 10 + 's / ' + dur + 's';
        }, 100);
    }
    var _obs = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType !== 1) continue;
                if (node.hasAttribute && node.hasAttribute('data-ppb-duration')) {
                    _startPpbTimer(node);
                } else if (node.querySelectorAll) {
                    var found = node.querySelectorAll('[data-ppb-duration]');
                    for (var k = 0; k < found.length; k++) _startPpbTimer(found[k]);
                }
            }
        }
    });
    _obs.observe(document.body, { childList: true, subtree: true });
})();
"""

    return (
        "<script>\n"
        f"{config}\n"
        "(function(){\n"
        f"{core_js}\n"
        f"{all_js}\n"
        f"{manual_split_js}\n"
        f"{undo_split_js}\n"
        "})();\n"
        f"{ppb_observer_js}\n"
        "</script>"
    )
