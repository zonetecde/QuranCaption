"""Python event handler callbacks for the Gradio UI."""
import gradio as gr

from config import (
    MIN_SILENCE_MIN, MIN_SILENCE_MAX, MIN_SILENCE_STEP,
    MIN_SPEECH_MIN, MIN_SPEECH_MAX, MIN_SPEECH_STEP,
    PAD_MIN, PAD_MAX, PAD_STEP,
    PRESET_MUJAWWAD, PRESET_MURATTAL, PRESET_FAST,
    ANIM_PRESETS,
    ANIM_DISPLAY_MODE_DEFAULT,
    ANIM_OPACITY_PREV_DEFAULT, ANIM_OPACITY_AFTER_DEFAULT,
    ANIM_WINDOW_PREV_DEFAULT, ANIM_WINDOW_AFTER_DEFAULT,
    ANIM_WORD_COLOR,
    ANIM_GRANULARITY_DEFAULT,
    MEGA_WORD_SPACING_DEFAULT, MEGA_TEXT_SIZE_DEFAULT, MEGA_LINE_SPACING_DEFAULT,
)


def create_segmentation_settings(id_suffix=""):
    """Create preset buttons and sliders. Returns (silence, speech, pad, btn_muj, btn_mur, btn_fast)."""
    _default_silence, _default_speech, _default_pad = PRESET_MURATTAL
    with gr.Row():
        with gr.Column(scale=1, min_width=0):
            btn_muj = gr.Button("Mujawwad (Slow)", size="sm", variant="secondary",
                                elem_id=f"preset-mujawwad{id_suffix}")
        with gr.Column(scale=1, min_width=0):
            btn_mur = gr.Button("Murattal (Normal)", size="sm", variant="primary",
                                elem_id=f"preset-murattal{id_suffix}")
        with gr.Column(scale=1, min_width=0):
            btn_fast = gr.Button("Hadr (Fast)", size="sm", variant="secondary",
                                 elem_id=f"preset-fast{id_suffix}")

    silence = gr.Slider(
        minimum=MIN_SILENCE_MIN, maximum=MIN_SILENCE_MAX,
        value=_default_silence, step=MIN_SILENCE_STEP,
        label="Min Silence Duration (ms)",
        info="Shorter = more segments. Decrease for reciters who have short pauses"
    )
    speech = gr.Slider(
        minimum=MIN_SPEECH_MIN, maximum=MIN_SPEECH_MAX,
        value=_default_speech, step=MIN_SPEECH_STEP,
        label="Min Speech Duration (ms)",
        info="Speech segments shorter than this are discarded. Increase to filter out false detections"
    )
    pad = gr.Slider(
        minimum=PAD_MIN, maximum=PAD_MAX,
        value=_default_pad, step=PAD_STEP,
        label="Padding (ms)",
        info="Extra audio kept before/after each segment to avoid clipping speech edges"
    )
    return silence, speech, pad, btn_muj, btn_mur, btn_fast


def wire_presets(btn_muj, btn_mur, btn_fast, silence, speech, pad):
    """Wire preset button click handlers to sliders."""
    presets = {
        "mujawwad": PRESET_MUJAWWAD,
        "murattal": PRESET_MURATTAL,
        "fast": PRESET_FAST,
    }

    def apply_preset(name):
        s, sp, p = presets[name]
        return (
            s, sp, p,
            gr.update(variant="primary" if name == "mujawwad" else "secondary"),
            gr.update(variant="primary" if name == "murattal" else "secondary"),
            gr.update(variant="primary" if name == "fast" else "secondary"),
        )

    outputs = [silence, speech, pad, btn_muj, btn_mur, btn_fast]
    btn_muj.click(fn=lambda: apply_preset("mujawwad"), inputs=[], outputs=outputs, api_name=False)
    btn_mur.click(fn=lambda: apply_preset("murattal"), inputs=[], outputs=outputs, api_name=False)
    btn_fast.click(fn=lambda: apply_preset("fast"), inputs=[], outputs=outputs, api_name=False)


def toggle_resegment_panel(currently_visible):
    """Toggle resegment panel visibility."""
    new_visible = not currently_visible
    return gr.update(visible=new_visible), new_visible


def on_mode_change(mode, verse_on, op_prev, op_after, w_prev, w_after):
    """Animation display mode change — apply preset values + toggle slider interactivity."""
    preset = ANIM_PRESETS.get(mode)
    is_custom = not preset
    return (
        gr.update(value=op_prev, interactive=is_custom),
        gr.update(value=op_after, interactive=is_custom),
        gr.update(value=w_prev, interactive=is_custom and not verse_on),
        gr.update(value=w_after, interactive=is_custom and not verse_on),
    )


def on_verse_toggle(verse_on, mode):
    """Verse checkbox change — disable window sliders when verse mode is on (Custom only)."""
    if mode != "Custom":
        return gr.update(), gr.update()
    return (
        gr.update(interactive=not verse_on),
        gr.update(interactive=not verse_on),
    )


def restore_anim_settings(cached):
    """Restore animation settings from localStorage via hidden JSON bridge."""
    if not cached:
        return (gr.update(),) * 11  # No saved settings — keep defaults
    mode = cached.get("mode", ANIM_DISPLAY_MODE_DEFAULT)
    preset = ANIM_PRESETS.get(mode)
    is_custom = not preset
    verse_on = bool(cached.get("verseOnly", False))
    if preset:
        op_prev = preset["prev_opacity"]
        op_after = preset["after_opacity"]
        w_prev = preset["prev_words"]
        w_after = preset["after_words"]
    elif cached.get("custom"):
        c = cached["custom"]
        op_prev = c.get("prevOpacity", ANIM_OPACITY_PREV_DEFAULT)
        op_after = c.get("afterOpacity", ANIM_OPACITY_AFTER_DEFAULT)
        w_prev = c.get("prevWords", ANIM_WINDOW_PREV_DEFAULT)
        w_after = c.get("afterWords", ANIM_WINDOW_AFTER_DEFAULT)
    else:
        op_prev = ANIM_OPACITY_PREV_DEFAULT
        op_after = ANIM_OPACITY_AFTER_DEFAULT
        w_prev = ANIM_WINDOW_PREV_DEFAULT
        w_after = ANIM_WINDOW_AFTER_DEFAULT
    return (
        gr.update(value=cached.get("granularity", ANIM_GRANULARITY_DEFAULT)),
        gr.update(value=mode),
        gr.update(value=verse_on),
        gr.update(value=cached.get("color", ANIM_WORD_COLOR)),
        gr.update(value=op_prev, interactive=is_custom),
        gr.update(value=op_after, interactive=is_custom),
        gr.update(value=w_prev, interactive=is_custom and not verse_on),
        gr.update(value=w_after, interactive=is_custom and not verse_on),
        gr.update(value=cached.get("wordSpacing", MEGA_WORD_SPACING_DEFAULT)),
        gr.update(value=cached.get("textSize", MEGA_TEXT_SIZE_DEFAULT)),
        gr.update(value=cached.get("lineSpacing", MEGA_LINE_SPACING_DEFAULT)),
    )
