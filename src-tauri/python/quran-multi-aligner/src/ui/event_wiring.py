"""Event wiring — connects all Gradio component events."""
import gradio as gr

from src.pipeline import (
    process_audio, resegment_audio,
    _retranscribe_wrapper, save_json_export,
)
from src.api.session_api import (
    process_audio_session, resegment_session,
    retranscribe_session, realign_from_timestamps,
)
from src.mfa import compute_mfa_timestamps
from src.ui.handlers import (
    wire_presets, toggle_resegment_panel,
    on_mode_change, on_verse_toggle, restore_anim_settings,
)

_EMPTY_PLACEHOLDER = (
    '<div style="text-align: center; color: #666; padding: 60px;">'
    'Upload audio and click "Extract Segments" to begin</div>'
)


def wire_events(app, c):
    """Wire all event handlers to Gradio components."""
    _wire_preset_buttons(c)
    _wire_audio_input(c)
    _wire_extract_chain(c)
    _wire_mfa_chain(c)
    _wire_resegment_chain(c)
    _wire_retranscribe_chain(c)
    _wire_animation_settings(c)
    _wire_settings_restoration(app, c)
    _wire_api_endpoint(c)


def _wire_preset_buttons(c):
    """Wire preset buttons to sliders (main + resegment panels)."""
    wire_presets(c.preset_mujawwad, c.preset_murattal, c.preset_fast,
                 c.min_silence_slider, c.min_speech_slider, c.pad_slider)
    wire_presets(c.rs_btn_muj, c.rs_btn_mur, c.rs_btn_fast,
                 c.rs_silence, c.rs_speech, c.rs_pad)


def _wire_audio_input(c):
    """Clear outputs when new audio is uploaded/recorded + wire example buttons."""
    c.audio_input.change(
        fn=lambda: (
            _EMPTY_PLACEHOLDER, None, None,
            None, None, None, None, None, None, None, None,
            gr.update(visible=True),                                          # extract_btn
            gr.update(visible=False, interactive=False, variant="secondary"), # compute_ts_btn
            gr.update(visible=False),                                         # compute_ts_progress
            gr.update(visible=False),                                         # animate_all_html
            gr.update(visible=False),                                         # resegment_toggle_btn
            gr.update(visible=False),                                         # retranscribe_btn
            gr.update(visible=False),                                         # resegment_panel
        ),
        inputs=[],
        outputs=[
            c.output_html, c.output_json, c.export_file,
            c.cached_speech_intervals, c.cached_is_complete, c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_model_name, c.cached_segment_dir, c.cached_log_row,
            c.extract_btn, c.compute_ts_btn, c.compute_ts_progress, c.animate_all_html,
            c.resegment_toggle_btn, c.retranscribe_btn, c.resegment_panel,
        ],
        api_name=False, show_progress="hidden"
    )

    c.btn_ex_112.click(fn=lambda: ("data/112.mp3", "GPU"), inputs=[], outputs=[c.audio_input, c.device_radio], api_name=False)
    c.btn_ex_84.click(fn=lambda: ("data/84.mp3", "GPU"), inputs=[], outputs=[c.audio_input, c.device_radio], api_name=False)
    c.btn_ex_7.click(fn=lambda: ("data/7.mp3", "GPU"), inputs=[], outputs=[c.audio_input, c.device_radio], api_name=False)
    c.btn_ex_juz30.click(fn=lambda: ("data/Juz' 30.mp3", "GPU"), inputs=[], outputs=[c.audio_input, c.device_radio], api_name=False)


def _wire_extract_chain(c):
    """Extract segments -> save JSON -> show action buttons."""
    c.extract_btn.click(
        fn=process_audio,
        inputs=[
            c.audio_input,
            c.min_silence_slider, c.min_speech_slider, c.pad_slider,
            c.model_radio, c.device_radio,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
        ],
        api_name=False, show_progress="minimal"
    ).then(
        fn=save_json_export,
        inputs=[c.output_json],
        outputs=[c.export_file],
        show_progress="hidden"
    ).then(
        fn=lambda silence, speech, pad, model: (
            gr.update(visible=False),                                       # hide extract_btn
            gr.update(visible=True, interactive=True, variant="primary"),   # show compute_ts_btn
            gr.update(visible=True),                                        # show resegment_toggle_btn
            gr.update(                                                      # show retranscribe_btn
                visible=True,
                value=f"Retranscribe with {'Large' if model == 'Base' else 'Base'} Model"
            ),
            silence, speech, pad,                                           # sync to resegment panel
            model,                                                          # cache model name
        ),
        inputs=[c.min_silence_slider, c.min_speech_slider, c.pad_slider, c.model_radio],
        outputs=[c.extract_btn, c.compute_ts_btn, c.resegment_toggle_btn, c.retranscribe_btn,
                 c.rs_silence, c.rs_speech, c.rs_pad, c.cached_model_name],
        api_name=False, show_progress="hidden"
    )


def _wire_mfa_chain(c):
    """Compute MFA timestamps -> save JSON export."""
    c.compute_ts_btn.click(
        fn=compute_mfa_timestamps,
        inputs=[c.output_html, c.output_json, c.cached_segment_dir, c.cached_log_row],
        outputs=[c.output_html, c.compute_ts_btn, c.animate_all_html, c.compute_ts_progress, c.output_json],
        api_name=False, show_progress="hidden"
    ).then(
        fn=save_json_export,
        inputs=[c.output_json],
        outputs=[c.export_file],
        show_progress="hidden"
    )


def _wire_resegment_chain(c):
    """Toggle panel + resegment -> close panel -> save -> sync sliders."""
    c.resegment_toggle_btn.click(
        fn=toggle_resegment_panel,
        inputs=[c.resegment_panel_visible],
        outputs=[c.resegment_panel, c.resegment_panel_visible],
        api_name=False, show_progress="hidden"
    )

    c.resegment_btn.click(
        fn=resegment_audio,
        inputs=[
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.rs_silence, c.rs_speech, c.rs_pad,
            c.model_radio, c.device_radio,
            c.cached_log_row,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
        ],
        api_name=False, show_progress="minimal"
    ).then(
        fn=lambda: (gr.update(visible=False), False),
        inputs=[],
        outputs=[c.resegment_panel, c.resegment_panel_visible],
        api_name=False, show_progress="hidden"
    ).then(
        fn=save_json_export,
        inputs=[c.output_json],
        outputs=[c.export_file],
        show_progress="hidden"
    ).then(
        fn=lambda silence, speech, pad, model: (
            silence, speech, pad,                                            # sync sliders back
            model,                                                           # update cached_model_name
            gr.update(visible=True, interactive=True, variant="primary"),    # re-enable compute_ts_btn
            gr.update(visible=False),                                        # hide animate_all_html
            gr.update(                                                       # re-show retranscribe_btn
                visible=True,
                value=f"Retranscribe with {'Large' if model == 'Base' else 'Base'} Model"
            ),
        ),
        inputs=[c.rs_silence, c.rs_speech, c.rs_pad, c.model_radio],
        outputs=[c.min_silence_slider, c.min_speech_slider, c.pad_slider,
                 c.cached_model_name, c.compute_ts_btn, c.animate_all_html, c.retranscribe_btn],
        api_name=False, show_progress="hidden"
    )


def _wire_retranscribe_chain(c):
    """Retranscribe -> save -> hide button -> update model name."""
    c.retranscribe_btn.click(
        fn=_retranscribe_wrapper,
        inputs=[
            c.cached_intervals, c.cached_audio, c.cached_sample_rate,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_model_name, c.device_radio,
            c.cached_log_row,
            c.min_silence_slider, c.min_speech_slider, c.pad_slider,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
        ],
        api_name=False, show_progress="minimal"
    ).then(
        fn=save_json_export,
        inputs=[c.output_json],
        outputs=[c.export_file],
        show_progress="hidden"
    ).then(
        fn=lambda model_name: (
            gr.update(visible=False),                                       # hide retranscribe_btn
            gr.update(visible=True, interactive=True, variant="primary"),   # re-enable compute_ts_btn
            gr.update(visible=False),                                       # hide animate_all_html
            "Large" if model_name == "Base" else "Base",                    # flip cached_model_name
        ),
        inputs=[c.cached_model_name],
        outputs=[c.retranscribe_btn, c.compute_ts_btn, c.animate_all_html, c.cached_model_name],
        api_name=False, show_progress="hidden"
    )


def _wire_animation_settings(c):
    """Wire all animation setting controls (sliders, radios, checkboxes, color)."""
    # Granularity change — update JS global + toggle char class
    c.anim_granularity_radio.change(
        fn=None,
        inputs=[c.anim_granularity_radio],
        outputs=[],
        api_name=False, show_progress="hidden",
        js="""(g) => {
            window.ANIM_GRANULARITY = g;
            document.querySelectorAll('.segment-card').forEach(card => {
                if (card.querySelector('.animate-btn.active')) {
                    if (g === 'Characters') {
                        card.classList.add('anim-chars');
                    } else {
                        card.classList.remove('anim-chars');
                    }
                }
            });
            // Also update mega card if Animate All is active
            var mega = document.querySelector('.mega-card');
            if (mega) {
                if (g === 'Characters') {
                    mega.classList.add('anim-chars');
                } else {
                    mega.classList.remove('anim-chars');
                }
            }
            // Update slider labels based on granularity
            var unit = g === 'Characters' ? 'Characters' : 'Words';
            var prevEl = document.getElementById('anim-window-prev');
            if (prevEl) {
                var lbl = prevEl.querySelector('label span, label');
                if (lbl) lbl.textContent = 'Previous ' + unit;
            }
            var afterEl = document.getElementById('anim-window-after');
            if (afterEl) {
                var lbl = afterEl.querySelector('label span, label');
                if (lbl) lbl.textContent = 'After ' + unit;
            }
            saveAnimSettings();
        }"""
    )

    # Display mode change — apply preset values + toggle slider interactivity
    c.anim_mode_radio.change(
        fn=on_mode_change,
        inputs=[c.anim_mode_radio, c.anim_verse_checkbox,
                c.anim_opacity_prev_slider, c.anim_opacity_after_slider,
                c.anim_window_prev_slider, c.anim_window_after_slider],
        outputs=[c.anim_opacity_prev_slider, c.anim_opacity_after_slider,
                 c.anim_window_prev_slider, c.anim_window_after_slider],
        api_name=False, show_progress="hidden",
        js="""(mode, verseOn, opPrev, opAfter, wPrev, wAfter) => {
            // Save current Custom values before switching away
            var prevMode = window.ANIM_DISPLAY_MODE;
            if (prevMode === 'Custom') {
                saveAnimSettings();
            }
            window.ANIM_DISPLAY_MODE = mode;
            var preset = window.ANIM_PRESETS[mode];
            if (preset) {
                window.ANIM_OPACITY_PREV = preset.prev_opacity;
                window.ANIM_OPACITY_AFTER = preset.after_opacity;
                window.ANIM_WINDOW_PREV = preset.prev_words;
                window.ANIM_WINDOW_AFTER = preset.after_words;
                opPrev = preset.prev_opacity;
                opAfter = preset.after_opacity;
                wPrev = preset.prev_words;
                wAfter = preset.after_words;
            } else {
                // Entering Custom: restore saved Custom values from localStorage
                var s = loadAnimSettings();
                if (s && s.custom) {
                    window.ANIM_OPACITY_PREV = s.custom.prevOpacity;
                    window.ANIM_OPACITY_AFTER = s.custom.afterOpacity;
                    window.ANIM_WINDOW_PREV = s.custom.prevWords;
                    window.ANIM_WINDOW_AFTER = s.custom.afterWords;
                    opPrev = s.custom.prevOpacity;
                    opAfter = s.custom.afterOpacity;
                    wPrev = s.custom.prevWords;
                    wAfter = s.custom.afterWords;
                }
            }
            rebuildWindowGradient();
            reapplyWindowNow();
            updateWindowMaxLabel('anim-window-prev', window.ANIM_WINDOW_PREV, window.ANIM_WINDOW_PREV_MAX);
            updateWindowMaxLabel('anim-window-after', window.ANIM_WINDOW_AFTER, window.ANIM_WINDOW_AFTER_MAX);
            saveAnimSettings();
            return [mode, verseOn, opPrev, opAfter, wPrev, wAfter];
        }"""
    )

    # Before/After opacity sliders
    c.anim_opacity_prev_slider.change(
        fn=None, inputs=[c.anim_opacity_prev_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { window.ANIM_OPACITY_PREV = val; rebuildWindowGradient(); reapplyWindowNow(); window._windowSettingsVersion++; saveAnimSettings(); }"
    )
    c.anim_opacity_after_slider.change(
        fn=None, inputs=[c.anim_opacity_after_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { window.ANIM_OPACITY_AFTER = val; rebuildWindowGradient(); reapplyWindowNow(); window._windowSettingsVersion++; saveAnimSettings(); }"
    )

    # Before/After window count sliders
    c.anim_window_prev_slider.change(
        fn=None, inputs=[c.anim_window_prev_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="""(val) => {
            window.ANIM_WINDOW_PREV = val;
            rebuildWindowGradient(); reapplyWindowNow();
            updateWindowMaxLabel('anim-window-prev', val, window.ANIM_WINDOW_PREV_MAX);
            window._windowSettingsVersion++;
            saveAnimSettings();
        }"""
    )
    c.anim_window_after_slider.change(
        fn=None, inputs=[c.anim_window_after_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="""(val) => {
            window.ANIM_WINDOW_AFTER = val;
            rebuildWindowGradient(); reapplyWindowNow();
            updateWindowMaxLabel('anim-window-after', val, window.ANIM_WINDOW_AFTER_MAX);
            window._windowSettingsVersion++;
            saveAnimSettings();
        }"""
    )

    # Verse checkbox
    c.anim_verse_checkbox.change(
        fn=on_verse_toggle,
        inputs=[c.anim_verse_checkbox, c.anim_mode_radio],
        outputs=[c.anim_window_prev_slider, c.anim_window_after_slider],
        api_name=False, show_progress="hidden",
        js="""(val, mode) => {
            window.ANIM_VERSE_MODE = val;
            reapplyWindowNow();
            window._windowSettingsVersion++;
            saveAnimSettings();
            return [val, mode];
        }"""
    )

    # Mega card styling sliders
    c.anim_word_spacing_slider.change(
        fn=None, inputs=[c.anim_word_spacing_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { var m=document.querySelector('.mega-card'); if(m) m.style.wordSpacing=val+'em'; saveAnimSettings(); }"
    )
    c.anim_text_size_slider.change(
        fn=None, inputs=[c.anim_text_size_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { var m=document.querySelector('.mega-card'); if(m) m.style.fontSize=val+'px'; saveAnimSettings(); }"
    )
    c.anim_line_spacing_slider.change(
        fn=None, inputs=[c.anim_line_spacing_slider], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { var m=document.querySelector('.mega-card'); if(m) m.style.lineHeight=val; saveAnimSettings(); }"
    )

    # Color picker
    c.anim_color_picker.change(
        fn=None, inputs=[c.anim_color_picker], outputs=[],
        api_name=False, show_progress="hidden",
        js="(val) => { document.documentElement.style.setProperty('--anim-word-color', val); saveAnimSettings(); }"
    )


def _wire_settings_restoration(app, c):
    """Restore animation settings from localStorage on page load."""
    app.load(
        fn=restore_anim_settings,
        inputs=[c.anim_cached_settings],
        outputs=[
            c.anim_granularity_radio, c.anim_mode_radio, c.anim_verse_checkbox,
            c.anim_color_picker,
            c.anim_opacity_prev_slider, c.anim_opacity_after_slider,
            c.anim_window_prev_slider, c.anim_window_after_slider,
            c.anim_word_spacing_slider, c.anim_text_size_slider, c.anim_line_spacing_slider,
        ],
        show_progress="hidden",
        js="""(ignored) => {
            var s = loadAnimSettings();
            if (s && s.color) document.documentElement.style.setProperty('--anim-word-color', s.color);
            // Update window max labels and slider labels after Gradio renders
            if (s) setTimeout(function() {
                updateWindowMaxLabel('anim-window-prev', window.ANIM_WINDOW_PREV, window.ANIM_WINDOW_PREV_MAX);
                updateWindowMaxLabel('anim-window-after', window.ANIM_WINDOW_AFTER, window.ANIM_WINDOW_AFTER_MAX);
                if (s.granularity === 'Characters') {
                    var prevEl = document.getElementById('anim-window-prev');
                    if (prevEl) { var lbl = prevEl.querySelector('label span, label'); if (lbl) lbl.textContent = 'Previous Characters'; }
                    var afterEl = document.getElementById('anim-window-after');
                    if (afterEl) { var lbl = afterEl.querySelector('label span, label'); if (lbl) lbl.textContent = 'After Characters'; }
                }
            }, 200);
            return s;
        }"""
    )


def _wire_api_endpoint(c):
    """Hidden API-only endpoints for session-based programmatic access."""
    gr.Button(visible=False).click(
        fn=process_audio_session,
        inputs=[c.api_audio, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="process_audio_session",
    )
    gr.Button(visible=False).click(
        fn=resegment_session,
        inputs=[c.api_audio_id, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="resegment_session",
    )
    gr.Button(visible=False).click(
        fn=retranscribe_session,
        inputs=[c.api_audio_id, c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="retranscribe_session",
    )
    gr.Button(visible=False).click(
        fn=realign_from_timestamps,
        inputs=[c.api_audio_id, c.api_timestamps, c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="realign_from_timestamps",
    )
