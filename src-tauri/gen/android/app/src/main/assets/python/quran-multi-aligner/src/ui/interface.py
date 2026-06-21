"""Gradio UI — layout orchestrator."""
import json
from pathlib import Path
from types import SimpleNamespace

import gradio as gr

from config import (
    DELETE_CACHE_FREQUENCY, DELETE_CACHE_AGE,
    DEV_TAB_VISIBLE,
    ANIM_WORD_COLOR, ANIM_STYLE_ROW_SCALES,
    ANIM_DISPLAY_MODES, ANIM_DISPLAY_MODE_DEFAULT,
    ANIM_OPACITY_PREV_DEFAULT, ANIM_OPACITY_AFTER_DEFAULT, ANIM_OPACITY_STEP,
    ANIM_PRESETS,
    ANIM_GRANULARITIES, ANIM_GRANULARITY_DEFAULT,
    ANIM_WINDOW_PREV_DEFAULT, ANIM_WINDOW_AFTER_DEFAULT,
    ANIM_WINDOW_PREV_MIN, ANIM_WINDOW_PREV_MAX,
    ANIM_WINDOW_AFTER_MIN, ANIM_WINDOW_AFTER_MAX,
    MEGA_WORD_SPACING_MIN, MEGA_WORD_SPACING_MAX, MEGA_WORD_SPACING_STEP, MEGA_WORD_SPACING_DEFAULT,
    MEGA_TEXT_SIZE_MIN, MEGA_TEXT_SIZE_MAX, MEGA_TEXT_SIZE_STEP, MEGA_TEXT_SIZE_DEFAULT,
    MEGA_LINE_SPACING_MIN, MEGA_LINE_SPACING_MAX, MEGA_LINE_SPACING_STEP, MEGA_LINE_SPACING_DEFAULT,
    LEFT_COLUMN_SCALE, RIGHT_COLUMN_SCALE,
    DEFAULT_INPUT_MODE,
)
from src.ui.styles import build_css
from src.ui.js_config import build_js_head
from src.ui.handlers import create_segmentation_settings
from src.ui.event_wiring import wire_events

# Load surah name ligature map
with open(Path(__file__).parent.parent.parent / "data" / "ligatures.json") as _f:
    _SURAH_LIGATURES = json.load(_f)


def build_interface():
    """Build the Gradio interface."""
    c = SimpleNamespace()
    css = build_css()
    js = build_js_head(_SURAH_LIGATURES)

    with gr.Blocks(title="Quranic Universal Aligner", css=css, head=js, delete_cache=(DELETE_CACHE_FREQUENCY, DELETE_CACHE_AGE)) as app:
        gr.Markdown("# \U0001f399\ufe0f Quranic Universal Aligner")
        gr.Markdown("""
- Transcribe and split any recitation by pauses within 1-2 minutes
- Get precise pause-, verse-, word- and character-level timestamps, exportable as JSON
- GPU-powered <a href="https://github.com/Wider-Community/quranic-universal-audio/blob/main/docs/client_api.md" target="_blank">API usage</a> with daily quotas, and unlimited CPU usage
- Reliable confidence system to flag uncertain segments and missed words — no silent errors
- Robust tolerance to noise, speaker variation and low audio quality, particularly with the large model
- <a href="https://github.com/Wider-Community/quranic-universal-audio/issues" target="_blank">Feedback/contributions are welcome</a>
""")

        # API Documentation accordion
        _app_root = Path(__file__).parent.parent.parent
        _api_doc_candidates = [
            _app_root / "docs" / "client_api.md",            # HF Space (if copied) or local aligner dir
            _app_root.parent / "docs" / "client_api.md",     # parent repo on local dev
        ]
        _api_doc_path = next((p for p in _api_doc_candidates if p.exists()), None)
        _api_doc = _api_doc_path.read_text() if _api_doc_path else (
            "See [API documentation](https://github.com/Wider-Community/quranic-universal-audio"
            "/blob/main/docs/client_api.md)."
        )
        with gr.Accordion("\U0001f4e1 API Usage", open=False):
            gr.Markdown(_api_doc)

        # Changelog accordion
        _changelog = (Path(__file__).parent.parent.parent / "docs" / "CHANGELOG.md").read_text()
        with gr.Accordion("📋 Changelog", open=False):
            gr.Markdown(_changelog)

        if DEV_TAB_VISIBLE:
            with gr.Tabs():
                with gr.Tab("Results"):
                    with gr.Row(elem_id="main-row"):
                        _build_left_column(c)
                        _build_right_column(c)
                with gr.Tab("Dev"):
                    _build_dev_tab(c)
        else:
            with gr.Row(elem_id="main-row"):
                _build_left_column(c)
                _build_right_column(c)

        # State components for caching VAD data between runs
        c.cached_speech_intervals = gr.State(value=None)
        c.cached_is_complete = gr.State(value=None)
        c.cached_audio = gr.State(value=None)
        c.cached_sample_rate = gr.State(value=None)
        c.cached_intervals = gr.State(value=None)
        c.cached_model_name = gr.State(value=None)
        c.cached_segment_dir = gr.State(value=None)
        c.cached_log_row = gr.State(value=None)
        c.is_preset = gr.State(value=False)
        c.audio_source = gr.State(value="upload")
        c.resegment_panel_visible = gr.State(value=False)
        c.split_panel_visible = gr.State(value=False)

        # Session API components (hidden, API-only)
        c.api_audio = gr.Audio(visible=False, type="numpy")
        c.api_audio_id = gr.Textbox(visible=False)
        c.api_silence = gr.Number(visible=False, precision=0)
        c.api_speech = gr.Number(visible=False, precision=0)
        c.api_pad = gr.Number(visible=False, precision=0)
        c.api_split_max_verses = gr.Number(visible=False, precision=0)
        c.api_split_max_words = gr.Number(visible=False, precision=0)
        c.api_split_max_duration = gr.Number(visible=False)
        c.api_split_require_stop_sign = gr.Checkbox(visible=False, value=False)
        c.api_model = gr.Textbox(visible=False)
        c.api_device = gr.Textbox(visible=False)
        c.api_timestamps = gr.JSON(visible=False)
        c.api_mfa_segments = gr.JSON(visible=False)
        c.api_mfa_granularity = gr.Textbox(visible=False)
        c.api_estimate_endpoint = gr.Textbox(visible=False)
        c.api_estimate_audio_duration = gr.Number(visible=False)
        c.api_url = gr.Textbox(visible=False)
        c.api_debug_token = gr.Textbox(visible=False)
        c.api_cpu_exec_token = gr.Textbox(visible=False)
        c.api_cpu_exec_module = gr.Textbox(visible=False)
        c.api_cpu_exec_func = gr.Textbox(visible=False)
        c.api_cpu_exec_args = gr.Textbox(visible=False)
        c.api_cpu_exec_kwargs = gr.Textbox(visible=False)
        c.api_cpu_exec_meta = gr.Textbox(visible=False)
        c.api_pool_status_token = gr.Textbox(visible=False)
        c.api_bench_audio = gr.Audio(visible=False, type="filepath")
        c.api_bench_batch_size = gr.Number(visible=False, precision=0, value=1)
        c.api_bench_dtype = gr.Textbox(visible=False, value="bfloat16")
        c.api_result = gr.JSON(visible=False)

        # Inline ref editing bridge (JS → Python)
        # Must be visible=True + CSS hide (visible=False removes from DOM in Gradio 6)
        with gr.Row(visible=True, elem_id="ref-edit-bridge"):
            c.ref_edit_payload = gr.Textbox(elem_id="ref-edit-payload", show_label=False, container=False)
            c.ref_edit_trigger = gr.Button("", elem_id="ref-edit-trigger", size="sm")

        # Repetition feedback bridge (JS → Python)
        with gr.Row(visible=True, elem_id="repeat-fb-bridge"):
            c.repeat_fb_payload = gr.Textbox(elem_id="repeat-fb-payload", show_label=False, container=False)
            c.repeat_fb_trigger = gr.Button("", elem_id="repeat-fb-trigger", size="sm")

        # Manual split bridge (JS → Python)
        with gr.Row(visible=True, elem_id="manual-split-bridge"):
            c.manual_split_payload = gr.Textbox(elem_id="manual-split-payload", show_label=False, container=False)
            c.manual_split_trigger = gr.Button("", elem_id="manual-split-trigger", size="sm")

        # Undo split bridge (JS → Python)
        with gr.Row(visible=True, elem_id="undo-split-bridge"):
            c.undo_split_payload = gr.Textbox(elem_id="undo-split-payload", show_label=False, container=False)
            c.undo_split_trigger = gr.Button("", elem_id="undo-split-trigger", size="sm")

        # Edit patch channel (Python → JS, carries surgical patch instructions)
        with gr.Row(visible=True, elem_id="edit-patch"):
            c.edit_patch = gr.Textbox(elem_id="edit-patch-data", show_label=False, container=False)

        wire_events(app, c)

    return app


def _build_left_column(c):
    """Build the left input column."""
    with gr.Column(scale=LEFT_COLUMN_SCALE, elem_id="left-col"):
        _is_link = DEFAULT_INPUT_MODE == "Link"
        _is_upload = DEFAULT_INPUT_MODE == "Upload"
        _is_record = DEFAULT_INPUT_MODE == "Record"

        # Input mode toggle
        with gr.Row(elem_id="input-mode-row"):
            c.mode_link = gr.Button("Link", size="sm", min_width=0,
                                     elem_classes=["mode-active"] if _is_link else [])
            c.mode_upload = gr.Button("Upload", size="sm", min_width=0,
                                       elem_classes=["mode-active"] if _is_upload else [])
            c.mode_record = gr.Button("Record", size="sm", min_width=0,
                                       elem_classes=["mode-active"] if _is_record else [])

        # Link panel
        with gr.Column(visible=_is_link, elem_id="link-panel") as c.link_panel:
            with gr.Row(elem_id="link-example-row"):
                c.btn_site_tiktok = gr.Button("TikTok", size="sm", min_width=0)
                c.btn_site_soundcloud = gr.Button("SoundCloud", size="sm", min_width=0)
                c.btn_site_mp3quran = gr.Button("MP3Quran", size="sm", min_width=0)
            c.url_input = gr.Textbox(
                label="Paste a link",
                info='[all supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)',
                lines=1,
            )
            c.url_download_btn = gr.Button("Download", size="sm", variant="secondary", interactive=False)
            c.url_audio_player = gr.Audio(label="Downloaded Audio", visible=False, sources=[])

        # Upload panel
        with gr.Column(visible=_is_upload, elem_id="upload-panel") as c.upload_panel:
            with gr.Row(elem_id="example-row"):
                c.btn_ex_112 = gr.Button("112", size="sm", min_width=0)
                c.btn_ex_84 = gr.Button("84", size="sm", min_width=0)
                c.btn_ex_7 = gr.Button("7", size="sm", min_width=0)
                c.btn_ex_juz30 = gr.Button("Juz' 30", size="sm", min_width=0)
            c.audio_upload = gr.Audio(label="Upload Recitation", sources=["upload"], type="filepath")

        # Record panel
        with gr.Column(visible=_is_record, elem_id="record-panel") as c.record_panel:
            c.audio_record = gr.Audio(label="Record Recitation", sources=["microphone"], type="filepath")

        # Hidden unified audio state (fed by upload, record, or URL download)
        # gr.State avoids cascading .change events that gr.Audio would fire
        c.audio_input = gr.State(value=None)

        _build_animation_settings(c)

        c.anim_cached_settings = gr.JSON(value=None, visible=False)
        with gr.Accordion("Model Settings", open=True) as c.model_accordion:
            with gr.Row():
                c.model_radio = gr.Radio(
                    choices=["Base", "Large"],
                    value="Base",
                    label="ASR Model",
                    info="Large: more robust to noisy/non-studio recitations but slower"
                )
                c.device_radio = gr.Radio(
                    choices=["GPU", "CPU"],
                    value="GPU",
                    label="Device",
                    info="Daily GPU usage limits. Unlimitted CPU usage but slower"
                )

        with gr.Accordion("Segmentation Settings", open=True) as c.seg_accordion:
            c.min_silence_slider, c.min_speech_slider, c.pad_slider, \
                c.preset_mujawwad, c.preset_murattal, c.preset_fast = create_segmentation_settings()

        # JSON download appears here after extraction
        c.export_file = gr.File(label="\U0001f4e5 Download JSON", visible=True, interactive=False)


def _build_animation_settings(c):
    """Build the animation settings accordion."""
    with gr.Accordion("Animation Settings", open=False, elem_id="anim-settings-accordion"):
        with gr.Row(elem_id="anim-style-row"):
            c.anim_granularity_radio = gr.Radio(
                choices=ANIM_GRANULARITIES,
                value=ANIM_GRANULARITY_DEFAULT,
                label="Granularity",
                scale=ANIM_STYLE_ROW_SCALES[0],
            )
            c.anim_mode_radio = gr.Radio(
                choices=ANIM_DISPLAY_MODES,
                value=ANIM_DISPLAY_MODE_DEFAULT,
                label="Animation Style",
                scale=ANIM_STYLE_ROW_SCALES[1],
            )
            c.anim_verse_checkbox = gr.Checkbox(
                value=False,
                label="Verse Only",
                elem_id="anim-verse-mode",
                scale=ANIM_STYLE_ROW_SCALES[2], min_width=90,
            )
            c.anim_color_picker = gr.ColorPicker(
                value=ANIM_WORD_COLOR,
                label="Color",
                scale=ANIM_STYLE_ROW_SCALES[3],
            )
        _is_custom = (ANIM_DISPLAY_MODE_DEFAULT == "Custom")
        _preset = ANIM_PRESETS.get(ANIM_DISPLAY_MODE_DEFAULT, {})
        with gr.Row():
            c.anim_opacity_prev_slider = gr.Slider(
                minimum=0, maximum=1, step=ANIM_OPACITY_STEP,
                value=_preset.get("prev_opacity", ANIM_OPACITY_PREV_DEFAULT),
                label="Before Opacity",
                interactive=_is_custom,
                elem_id="anim-opacity-prev",
            )
            c.anim_opacity_after_slider = gr.Slider(
                minimum=0, maximum=1, step=ANIM_OPACITY_STEP,
                value=_preset.get("after_opacity", ANIM_OPACITY_AFTER_DEFAULT),
                label="After Opacity",
                interactive=_is_custom,
                elem_id="anim-opacity-after",
            )
        with gr.Row():
            c.anim_window_prev_slider = gr.Slider(
                minimum=ANIM_WINDOW_PREV_MIN, maximum=ANIM_WINDOW_PREV_MAX, step=1,
                value=_preset.get("prev_words", ANIM_WINDOW_PREV_DEFAULT),
                label="Before Words", elem_id="anim-window-prev",
                interactive=_is_custom,
            )
            c.anim_window_after_slider = gr.Slider(
                minimum=ANIM_WINDOW_AFTER_MIN, maximum=ANIM_WINDOW_AFTER_MAX, step=1,
                value=_preset.get("after_words", ANIM_WINDOW_AFTER_DEFAULT),
                label="After Words", elem_id="anim-window-after",
                interactive=_is_custom,
            )
        with gr.Row(elem_id="mega-styling-row"):
            c.anim_word_spacing_slider = gr.Slider(
                minimum=MEGA_WORD_SPACING_MIN, maximum=MEGA_WORD_SPACING_MAX,
                step=MEGA_WORD_SPACING_STEP, value=MEGA_WORD_SPACING_DEFAULT,
                label="Word Spacing", elem_id="anim-word-spacing",
            )
            c.anim_text_size_slider = gr.Slider(
                minimum=MEGA_TEXT_SIZE_MIN, maximum=MEGA_TEXT_SIZE_MAX,
                step=MEGA_TEXT_SIZE_STEP, value=MEGA_TEXT_SIZE_DEFAULT,
                label="Text Size", elem_id="anim-text-size",
            )
            c.anim_line_spacing_slider = gr.Slider(
                minimum=MEGA_LINE_SPACING_MIN, maximum=MEGA_LINE_SPACING_MAX,
                step=MEGA_LINE_SPACING_STEP, value=MEGA_LINE_SPACING_DEFAULT,
                label="Line Spacing", elem_id="anim-line-spacing",
            )


def _build_right_column(c):
    """Build the right output column."""
    with gr.Column(scale=RIGHT_COLUMN_SCALE):
        _build_results_content(c)


def _build_results_content(c):
    """Build the main results content (extract/resegment/output)."""
    c.extract_btn = gr.Button("Align Recitation", variant="secondary", size="lg", interactive=False)
    c.pipeline_progress = gr.HTML(value="", visible=False)
    with gr.Row(elem_id="action-btns-row"):
        c.resegment_toggle_btn = gr.Button(
            "Resegment with New Settings", variant="primary", size="lg", visible=False
        )
        c.retranscribe_btn = gr.Button(
            "Retranscribe with Large Model", variant="primary", size="lg", visible=False
        )
        c.split_toggle_btn = gr.Button(
            "Split Segments", variant="primary", size="lg", visible=False
        )
    with gr.Row(elem_id="ts-row"):
        c.animate_all_btn = gr.Button(
            "Animate All", variant="secondary", size="lg", interactive=False, visible=False
        )
        c.compute_ts_progress = gr.HTML(value="", visible=False)

    with gr.Column(visible=False) as c.resegment_panel:
        gr.Markdown(
            "Uses cached data, skipping the heavy computation, "
            "so it's much faster. Useful if results are over-segmented "
            "or under-segmented"
        )
        c.rs_silence, c.rs_speech, c.rs_pad, \
            c.rs_btn_muj, c.rs_btn_mur, c.rs_btn_fast = create_segmentation_settings(id_suffix="-rs")
        c.resegment_btn = gr.Button("Resegment", variant="primary", size="lg")

    with gr.Column(visible=False) as c.split_panel:
        from config import (
            SPLIT_MAX_VERSES_MIN, SPLIT_MAX_VERSES_MAX, SPLIT_MAX_VERSES_DEFAULT,
            SPLIT_MAX_WORDS_MIN, SPLIT_MAX_WORDS_MAX, SPLIT_MAX_WORDS_STEP,
            SPLIT_MAX_WORDS_DEFAULT,
            SPLIT_MAX_DURATION_MIN, SPLIT_MAX_DURATION_MAX, SPLIT_MAX_DURATION_STEP,
            SPLIT_MAX_DURATION_DEFAULT,
        )
        gr.Markdown(
            "Subdivide long segments at word boundaries."
            "Sliders at max mean criterion disabled."
        )
        c.split_max_verses = gr.Slider(
            minimum=SPLIT_MAX_VERSES_MIN, maximum=SPLIT_MAX_VERSES_MAX, step=1,
            value=SPLIT_MAX_VERSES_DEFAULT,
            label=f"Max verses per segment: {SPLIT_MAX_VERSES_DEFAULT}",
            elem_id="split-max-verses",
        )
        c.split_max_words = gr.Slider(
            minimum=SPLIT_MAX_WORDS_MIN, maximum=SPLIT_MAX_WORDS_MAX,
            step=SPLIT_MAX_WORDS_STEP,
            value=SPLIT_MAX_WORDS_DEFAULT,
            label="Max words per segment: Off",
            elem_id="split-max-words",
        )
        c.split_max_duration = gr.Slider(
            minimum=SPLIT_MAX_DURATION_MIN, maximum=SPLIT_MAX_DURATION_MAX,
            step=SPLIT_MAX_DURATION_STEP,
            value=SPLIT_MAX_DURATION_DEFAULT,
            label="Max duration per segment (s): Off",
            elem_id="split-max-duration",
        )
        c.split_require_stop_sign = gr.Checkbox(
            value=False,
            label="Only split at stop signs",
            info="Segments without a waqf mark stay as-is, even if they exceed "
                 "word/duration limits. Verse splitting is unaffected.",
            elem_id="split-require-stop-sign",
        )
        c.split_btn = gr.Button("Split", variant="primary", size="lg")

    c.output_html = gr.HTML(
        value='<div style="text-align: center; color: #666; padding: 60px;">Upload audio and click "Align Recitation" to begin</div>',
        elem_classes=["output-html"]
    )
    # Server-side state (gr.State avoids serializing the full JSON to the browser on every update)
    c.output_json = gr.State(None)


def _build_dev_tab(c):
    """Build the Dev tab UI (delegates to dev_tools module)."""
    from src.ui.dev_tools import build_dev_tab_ui
    build_dev_tab_ui(c)
