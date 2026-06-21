"""Event wiring — connects all Gradio component events."""
import gradio as gr

from config import DEV_TAB_VISIBLE
from src.core.zero_gpu import QuotaExhaustedError
from src.core.worker_pool import PoolExhaustedError, PoolQueueFullError
from src.pipeline import (
    process_audio, resegment_audio, split_segments_audio,
    manual_split_segment_audio, undo_split_group_audio,
    _retranscribe_wrapper, save_json_export,
    apply_ref_edit, apply_repeat_feedback,
)
from src.api.session_api import (
    estimate_duration,
    process_audio_session, process_url_session,
    resegment, retranscribe, realign_from_timestamps,
    split_segments,
    timestamps, timestamps_direct,
    debug_process,
    cpu_exec,
    pool_status,
    cpu_pool_status,
    cpu_pool_kill,
)
from src.api.bench_api import bench_prepare, bench_vad
from src.mfa import compute_mfa_timestamps
from src.ui.progress_bar import pipeline_progress_bar_html
from src.ui.handlers import (
    wire_presets, toggle_resegment_panel,
    on_mode_change, on_verse_toggle, restore_anim_settings,
    download_url_audio,
    fetch_audio_by_id,
    is_audio_id,
)

_EMPTY_PLACEHOLDER = ""


def _on_audio_change(audio_path):
    """Reset UI state for new audio. Returns 20-tuple of reset values."""
    # Warn early if audio is very long (before user wastes GPU clicking Extract)
    if audio_path and isinstance(audio_path, str):
        try:
            import soundfile as _sf
            from config import AUDIO_DURATION_WARNING_MINUTES
            _info = _sf.info(audio_path)
            dur_min = _info.duration / 60
            if dur_min > AUDIO_DURATION_WARNING_MINUTES:
                hr = dur_min / 60
                gr.Warning(f"Audio is {hr:.1f} hours — processing will likely time out or crash. Consider splitting into separate surahs.")
        except Exception:
            pass
    has_audio = bool(audio_path)
    return (
        _EMPTY_PLACEHOLDER, None, None,
        None, None, None, None, None, None, None, None,
        gr.update(visible=True, interactive=has_audio,                    # extract_btn
                  variant="primary" if has_audio else "secondary"),
        gr.update(visible=False),                                         # pipeline_progress
        gr.update(visible=False, interactive=False, variant="secondary"), # animate_all_btn
        gr.update(visible=False),                                         # compute_ts_progress
        gr.update(visible=False),                                         # resegment_toggle_btn
        gr.update(visible=False),                                         # retranscribe_btn
        gr.update(visible=False),                                         # resegment_panel
        gr.update(visible=False),                                         # split_toggle_btn
        gr.update(visible=False),                                         # split_panel
        gr.Accordion(open=True),                                          # re-expand model_accordion
        gr.Accordion(open=True),                                          # re-expand seg_accordion
    )


def wire_events(app, c):
    """Wire all event handlers to Gradio components."""
    _wire_preset_buttons(c)
    _wire_input_mode_toggle(c)
    _wire_url_input(c)
    _wire_audio_input(c)
    _wire_extract_chain(c)
    _wire_animate_all_chain(c)
    _wire_resegment_chain(c)
    _wire_retranscribe_chain(c)
    _wire_split_chain(c)
    _wire_animation_settings(c)
    _wire_settings_restoration(app, c)
    _wire_manual_split(c)
    _wire_undo_split(c)
    _wire_ref_edit(c)
    _wire_repeat_feedback(c)
    _wire_api_endpoint(c)
    if DEV_TAB_VISIBLE:
        _wire_dev_tab(c)


def _wire_preset_buttons(c):
    """Wire preset buttons to sliders (main + resegment panels)."""
    wire_presets(c.preset_mujawwad, c.preset_murattal, c.preset_fast,
                 c.min_silence_slider, c.min_speech_slider, c.pad_slider)
    wire_presets(c.rs_btn_muj, c.rs_btn_mur, c.rs_btn_fast,
                 c.rs_silence, c.rs_speech, c.rs_pad)


def _wire_input_mode_toggle(c):
    """Wire Link/Upload/Record toggle buttons."""

    def _switch_to(mode):
        is_link = mode == "Link"
        is_upload = mode == "Upload"
        is_record = mode == "Record"
        return (
            gr.update(elem_classes=["mode-active"] if is_link else []),
            gr.update(elem_classes=["mode-active"] if is_upload else []),
            gr.update(elem_classes=["mode-active"] if is_record else []),
            gr.update(visible=is_link),      # link_panel
            gr.update(visible=is_upload),    # upload_panel
            gr.update(visible=is_record),    # record_panel
            # Clear all input panels so switching starts fresh
            gr.update(value=""),                                      # url_input
            gr.update(value="Download", variant="secondary",
                      interactive=False),                             # url_download_btn
            gr.update(visible=False),                                 # url_audio_player
            None,                                                     # audio_upload
            None,                                                     # audio_record
            None,                                                     # audio_input (State)
            # Clear pipeline UI
            *_on_audio_change(None),
        )

    _toggle_outputs = [
        c.mode_link, c.mode_upload, c.mode_record,
        c.link_panel, c.upload_panel, c.record_panel,
        c.url_input, c.url_download_btn, c.url_audio_player,
        c.audio_upload, c.audio_record, c.audio_input,
        # _on_audio_change returns 20 values:
        c.output_html, c.output_json, c.export_file,
        c.cached_speech_intervals, c.cached_is_complete, c.cached_audio, c.cached_sample_rate,
        c.cached_intervals, c.cached_model_name, c.cached_segment_dir, c.cached_log_row,
        c.extract_btn, c.pipeline_progress, c.animate_all_btn, c.compute_ts_progress,
        c.resegment_toggle_btn, c.retranscribe_btn, c.resegment_panel,
        c.split_toggle_btn, c.split_panel,
        c.model_accordion, c.seg_accordion,
    ]
    c.mode_link.click(fn=lambda: _switch_to("Link"), inputs=[], outputs=_toggle_outputs, api_name=False)
    c.mode_upload.click(fn=lambda: _switch_to("Upload"), inputs=[], outputs=_toggle_outputs, api_name=False)
    c.mode_record.click(fn=lambda: _switch_to("Record"), inputs=[], outputs=_toggle_outputs, api_name=False)



def _wire_url_input(c):
    """Wire URL input → enable download button, download on click."""

    # Enable/disable download button based on whether URL is present
    def _btn_state(url):
        stripped = (url or "").strip()
        return gr.update(
            interactive=bool(stripped),
            variant="primary" if stripped else "secondary",
            value="Fetch" if is_audio_id(stripped) else "Download",
        )

    c.url_input.change(
        fn=_btn_state,
        inputs=[c.url_input],
        outputs=[c.url_download_btn],
        api_name=False, show_progress="hidden",
    )

    # Manual URL edit clears preset flag (programmatic sets from pill buttons
    # use .change not .input, so pill's is_preset=True survives).
    c.url_input.input(
        fn=lambda: False, inputs=[], outputs=[c.is_preset],
        api_name=False, show_progress="hidden",
    )

    def _on_download(url):
        """Download audio from URL, or fetch from logs dataset if input is an audio_id."""
        via_id = is_audio_id(url)
        busy_label = "Fetching…" if via_id else "Downloading…"

        yield (
            gr.update(),                                              # audio_input
            gr.update(value=busy_label, interactive=False),           # btn
            gr.update(visible=False),                                 # hide prev player
        )

        try:
            if via_id:
                wav_path, _info_html = fetch_audio_by_id((url or "").strip())
            else:
                wav_path, _info_html = download_url_audio(url)
            reset_label = "Fetch" if via_id else "Download"
            yield (
                wav_path,                                             # set audio_input
                gr.update(value=reset_label, variant="primary",
                          interactive=True),                          # reset btn
                gr.update(value=wav_path, visible=True),              # show audio player
            )
        except Exception as e:
            yield (
                gr.update(),
                gr.update(value=f"Error: {str(e)[:100]}",
                          variant="stop", interactive=True),          # error on btn
                gr.update(),
            )

    _dl_outputs = [c.audio_input, c.url_download_btn, c.url_audio_player]
    _dl_reset_outputs = [
        c.output_html, c.output_json, c.export_file,
        c.cached_speech_intervals, c.cached_is_complete, c.cached_audio, c.cached_sample_rate,
        c.cached_intervals, c.cached_model_name, c.cached_segment_dir, c.cached_log_row,
        c.extract_btn, c.pipeline_progress, c.animate_all_btn, c.compute_ts_progress,
        c.resegment_toggle_btn, c.retranscribe_btn, c.resegment_panel,
        c.split_toggle_btn, c.split_panel,
        c.model_accordion, c.seg_accordion,
    ]
    c.url_download_btn.click(
        fn=_on_download, inputs=[c.url_input], outputs=_dl_outputs,
        api_name=False, show_progress="hidden",
    ).then(
        fn=_on_audio_change, inputs=[c.audio_input], outputs=_dl_reset_outputs,
        api_name=False, show_progress="hidden",
    ).then(
        fn=lambda: "link", inputs=[], outputs=[c.audio_source],
        api_name=False, show_progress="hidden",
    )

    # Site pill buttons: set URL (+ optional slider override) → download → reset UI
    _SITE_URLS = {
        "tiktok": ("https://www.tiktok.com/@quraan_recit/video/7274127758484163847", None),
        "soundcloud": ("https://soundcloud.com/quranmta/recitation-of-the-764269316?in=quranmta/sets/suras", None),
        "mp3quran": ("https://server12.mp3quran.net/maher/027.mp3", 100),
    }
    _pill_outputs = [c.url_input, c.min_silence_slider, c.is_preset]
    for btn, key in [(c.btn_site_tiktok, "tiktok"),
                     (c.btn_site_soundcloud, "soundcloud"),
                     (c.btn_site_mp3quran, "mp3quran")]:
        _url, _sil = _SITE_URLS[key]
        btn.click(
            fn=lambda u=_url, s=_sil: (u, gr.update() if s is None else s, True),
            inputs=[], outputs=_pill_outputs, api_name=False,
        ).then(
            fn=_on_download, inputs=[c.url_input], outputs=_dl_outputs,
            api_name=False, show_progress="hidden",
        ).then(
            fn=_on_audio_change, inputs=[c.audio_input], outputs=_dl_reset_outputs,
            api_name=False, show_progress="hidden",
        ).then(
            fn=lambda: "link", inputs=[], outputs=[c.audio_source],
            api_name=False, show_progress="hidden",
        )


def _wire_audio_input(c):
    """Clear outputs when new audio is uploaded/recorded + wire example buttons."""

    def _on_audio_ready(audio_path):
        """Bridge audio to State + reset UI in a single round-trip."""
        return (audio_path, *_on_audio_change(audio_path))

    # Upload/record → set audio_input State + reset UI (single round-trip)
    # Uses .input() (not .change()) so programmatic clears from mode-switch don't cascade.
    _reset_outputs = [
        c.output_html, c.output_json, c.export_file,
        c.cached_speech_intervals, c.cached_is_complete, c.cached_audio, c.cached_sample_rate,
        c.cached_intervals, c.cached_model_name, c.cached_segment_dir, c.cached_log_row,
        c.extract_btn, c.pipeline_progress, c.animate_all_btn, c.compute_ts_progress,
        c.resegment_toggle_btn, c.retranscribe_btn, c.resegment_panel,
        c.split_toggle_btn, c.split_panel,
        c.model_accordion, c.seg_accordion,
    ]
    _ready_outputs = [c.audio_input] + _reset_outputs

    def _on_upload(audio_path):
        """Bridge upload to State + reset UI + clear is_preset + tag source."""
        return (*_on_audio_ready(audio_path), False, "upload")

    def _on_record(audio_path):
        """Bridge record to State + reset UI + clear is_preset + tag source."""
        return (*_on_audio_ready(audio_path), False, "record")

    _ready_preset_outputs = _ready_outputs + [c.is_preset, c.audio_source]
    c.audio_upload.input(fn=_on_upload, inputs=[c.audio_upload], outputs=_ready_preset_outputs, api_name=False, show_progress="hidden")
    c.audio_record.input(fn=_on_record, inputs=[c.audio_record], outputs=_ready_preset_outputs, api_name=False, show_progress="hidden")

    # Example buttons: set audio_upload (for waveform) + device + preset flag,
    # then chain _on_audio_ready since .input() won't fire for programmatic sets.
    _ex_outputs = [c.audio_upload, c.device_radio, c.is_preset]
    c.btn_ex_112.click(fn=lambda: ("data/112.mp3", "GPU", True), inputs=[], outputs=_ex_outputs, api_name=False).then(
        fn=_on_audio_ready, inputs=[c.audio_upload], outputs=_ready_outputs, api_name=False, show_progress="hidden")
    c.btn_ex_84.click(fn=lambda: ("data/84.mp3", "GPU", True), inputs=[], outputs=_ex_outputs, api_name=False).then(
        fn=_on_audio_ready, inputs=[c.audio_upload], outputs=_ready_outputs, api_name=False, show_progress="hidden")
    c.btn_ex_7.click(fn=lambda: ("data/7.mp3", "GPU", True), inputs=[], outputs=_ex_outputs, api_name=False).then(
        fn=_on_audio_ready, inputs=[c.audio_upload], outputs=_ready_outputs, api_name=False, show_progress="hidden")
    c.btn_ex_juz30.click(fn=lambda: ("data/Juz' 30.mp3", "GPU", True), inputs=[], outputs=_ex_outputs, api_name=False).then(
        fn=_on_audio_ready, inputs=[c.audio_upload], outputs=_ready_outputs, api_name=False, show_progress="hidden")


def _wire_extract_chain(c):
    """Extract segments + save JSON + show action buttons in one round-trip."""
    def _extract_all(audio_data, silence, speech, pad, model, device, is_preset,
                     audio_source="upload", url_input="", request: gr.Request = None):
        # Compute audio duration and show animated progress bar
        import librosa
        audio_dur = librosa.get_duration(path=audio_data) if audio_data else None
        est = estimate_duration("process_audio_session", audio_dur, model_name=model, device=device)
        est_s = est.get("estimated_duration_s") or 30
        bar_html = pipeline_progress_bar_html(est_s)

        # Yield 1: show progress bar, hide extract button
        _skip = gr.update()
        yield (
            _skip, _skip,                                                       # output_html, output_json
            _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
            _skip,                                                              # export_file
            gr.update(visible=False),                                           # hide extract_btn
            gr.update(value=bar_html, visible=True),                            # show pipeline_progress
            _skip,                                                              # animate_all_btn
            _skip, _skip,                                                       # resegment/retranscribe btns
            _skip,                                                              # split_toggle_btn
            _skip, _skip, _skip, _skip,                                         # rs sliders + model
            _skip, _skip,                                                       # accordions
        )

        try:
            result = process_audio(audio_data, silence, speech, pad, model, device,
                                   is_preset=is_preset, request=request,
                                   endpoint=f"ui:{audio_source}",
                                   url_source=url_input if audio_source == "link" else None)
        except QuotaExhaustedError as e:
            raw = str(e).lower()
            if e.reset_time and e.reset_time != "0:00:00":
                reset_msg = f" Resets in {e.reset_time}."
            elif e.reset_time == "0:00:00":
                reset_msg = " Daily limit — resets ~24h after your first GPU use today."
            else:
                reset_msg = ""
            if "unlogged user" in raw or "signup for free" in raw:
                msg = (f"Anonymous GPU quota exhausted.{reset_msg} "
                       "Sign in on Hugging Face for more quota, or switch Device to CPU.")
            else:
                msg = (f"Your GPU quota is exhausted.{reset_msg} "
                       "Upgrade to Hugging Face Pro for more quota, or switch Device to CPU.")
            gr.Warning(msg)
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip,                                                              # export_file
                gr.update(visible=True, interactive=True),                          # re-show extract_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # animate_all_btn
                _skip, _skip,                                                       # resegment/retranscribe
                _skip,                                                              # split_toggle_btn
                _skip, _skip, _skip, _skip,                                         # rs sliders + model
                _skip, _skip,                                                       # accordions
            )
            return
        except (PoolQueueFullError, PoolExhaustedError) as e:
            gr.Warning(f"CPU workers busy: {e}. Please retry in a minute.")
            yield (
                _skip, _skip,
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,
                _skip,
                gr.update(visible=True, interactive=True),
                gr.update(visible=False),
                _skip,
                _skip, _skip,
                _skip,
                _skip, _skip, _skip, _skip,
                _skip, _skip,
            )
            return
        except Exception as e:
            gr.Warning(f"Processing failed: {e}")
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip,                                                              # export_file
                gr.update(visible=True, interactive=True),                          # re-show extract_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # animate_all_btn
                _skip, _skip,                                                       # resegment/retranscribe
                _skip,                                                              # split_toggle_btn
                _skip, _skip, _skip, _skip,                                         # rs sliders + model
                _skip, _skip,                                                       # accordions
            )
            return
        # result: (html, json, speech_intervals, is_complete, audio, sr, intervals, seg_dir, log_row)
        json_data = result[1]

        # Yield 2 (final): hide progress bar, show results
        yield (
            *result,                                                            # 9 pipeline outputs
            save_json_export(json_data),                                        # export_file
            gr.update(visible=False),                                           # hide extract_btn
            gr.update(visible=False),                                           # hide pipeline_progress
            gr.update(visible=True, interactive=True, variant="primary"),       # show animate_all_btn
            gr.update(visible=True),                                            # show resegment_toggle_btn
            gr.update(                                                          # show retranscribe_btn
                visible=True,
                value=f"Retranscribe with {'Large' if model == 'Base' else 'Base'} Model"
            ),
            gr.update(visible=True),                                            # show split_toggle_btn
            silence, speech, pad,                                               # sync to resegment panel
            model,                                                              # cache model name
            gr.Accordion(open=False),                                           # collapse model_accordion
            gr.Accordion(open=False),                                           # collapse seg_accordion
        )

    c.extract_btn.click(
        fn=_extract_all,
        inputs=[
            c.audio_input,
            c.min_silence_slider, c.min_speech_slider, c.pad_slider,
            c.model_radio, c.device_radio,
            c.is_preset, c.audio_source, c.url_input,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
            c.export_file, c.extract_btn, c.pipeline_progress, c.animate_all_btn,
            c.resegment_toggle_btn, c.retranscribe_btn,
            c.split_toggle_btn,
            c.rs_silence, c.rs_speech, c.rs_pad, c.cached_model_name,
            c.model_accordion, c.seg_accordion,
        ],
        api_name=False, show_progress="hidden"
    )


def _wire_animate_all_chain(c):
    """Animate All: run MFA for uncomputed segments then jump into the mega card.

    This is the one flow that persists word timestamps into the exported JSON —
    all other MFA paths (per-segment animate, /split_segments, special-segment
    splitting) are silent and must NOT leak their word data into the download.
    """
    c.animate_all_btn.click(
        fn=compute_mfa_timestamps,
        inputs=[c.output_html, c.output_json, c.cached_segment_dir, c.cached_log_row],
        outputs=[c.output_html, c.animate_all_btn, c.edit_patch, c.compute_ts_progress, c.output_json],
        api_name=False, show_progress="hidden"
    ).then(
        fn=lambda segs: save_json_export(segs, include_words=True),
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

    def _resegment_all(speech_intervals, is_complete, audio, sr,
                       silence, speech, pad, model, device, log_row, is_preset,
                       audio_source="upload", url_input="", request: gr.Request = None):
        # Compute estimate and show progress bar
        from src.pipeline import _audio_duration_from_ref
        audio_dur = _audio_duration_from_ref(audio)
        est = estimate_duration("resegment", audio_dur, model_name=model, device=device)
        est_s = est.get("estimated_duration_s") or 15
        bar_html = pipeline_progress_bar_html(est_s)

        _skip = gr.update()
        yield (
            _skip, _skip,                                                       # output_html, output_json
            _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
            _skip, _skip,                                                       # resegment_panel, panel_visible
            _skip,                                                              # export_file
            _skip, _skip, _skip, _skip,                                         # sliders + model
            _skip,                                                              # animate_all_btn
            gr.update(value=bar_html, visible=True),                            # show pipeline_progress
            _skip,                                                              # retranscribe_btn
        )

        try:
            result = resegment_audio(speech_intervals, is_complete, audio, sr,
                                     silence, speech, pad, model, device, log_row,
                                     is_preset=is_preset, request=request,
                                     endpoint=f"ui:{audio_source}",
                                     url_source=url_input if audio_source == "link" else None)
        except QuotaExhaustedError as e:
            raw = str(e).lower()
            if e.reset_time and e.reset_time != "0:00:00":
                reset_msg = f" Resets in {e.reset_time}."
            elif e.reset_time == "0:00:00":
                reset_msg = " Daily limit — resets ~24h after your first GPU use today."
            else:
                reset_msg = ""
            if "unlogged user" in raw or "signup for free" in raw:
                msg = (f"Anonymous GPU quota exhausted.{reset_msg} "
                       "Sign in on Hugging Face for more quota, or switch Device to CPU.")
            else:
                msg = (f"Your GPU quota is exhausted.{reset_msg} "
                       "Upgrade to Hugging Face Pro for more quota, or switch Device to CPU.")
            gr.Warning(msg)
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip, _skip,                                                       # resegment_panel, panel_visible
                _skip,                                                              # export_file
                _skip, _skip, _skip, _skip,                                         # sliders + model
                _skip,                                                              # animate_all_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # retranscribe_btn
            )
            return
        except (PoolQueueFullError, PoolExhaustedError) as e:
            gr.Warning(f"CPU workers busy: {e}. Please retry in a minute.")
            yield (
                _skip, _skip,
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,
                _skip, _skip,
                _skip,
                _skip, _skip, _skip, _skip,
                _skip,
                gr.update(visible=False),
                _skip,
            )
            return
        except Exception as e:
            gr.Warning(f"Processing failed: {e}")
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip, _skip,                                                       # resegment_panel, panel_visible
                _skip,                                                              # export_file
                _skip, _skip, _skip, _skip,                                         # sliders + model
                _skip,                                                              # animate_all_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # retranscribe_btn
            )
            return
        json_data = result[1]
        yield (
            *result,                                                            # 9 pipeline outputs
            gr.update(visible=False), False,                                    # close resegment_panel
            save_json_export(json_data),                                        # export_file
            silence, speech, pad,                                               # sync sliders back
            model,                                                              # update cached_model_name
            gr.update(visible=True, interactive=True, variant="primary"),       # re-enable animate_all_btn
            gr.update(visible=False),                                           # hide pipeline_progress
            gr.update(                                                          # re-show retranscribe_btn
                visible=True,
                value=f"Retranscribe with {'Large' if model == 'Base' else 'Base'} Model"
            ),
        )

    c.resegment_btn.click(
        fn=_resegment_all,
        inputs=[
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.rs_silence, c.rs_speech, c.rs_pad,
            c.model_radio, c.device_radio,
            c.cached_log_row,
            c.is_preset, c.audio_source, c.url_input,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
            c.resegment_panel, c.resegment_panel_visible,
            c.export_file,
            c.min_silence_slider, c.min_speech_slider, c.pad_slider,
            c.cached_model_name, c.animate_all_btn, c.pipeline_progress,
            c.retranscribe_btn,
        ],
        api_name=False, show_progress="hidden"
    )


def _wire_retranscribe_chain(c):
    """Retranscribe + save + hide button + update model name in one round-trip."""
    def _retranscribe_all(intervals, audio, sr, speech_intervals, is_complete,
                          model_name, device, log_row, silence, speech, pad, is_preset,
                          audio_source="upload", url_input="", request: gr.Request = None):
        # Compute estimate and show progress bar
        from src.pipeline import _audio_duration_from_ref
        audio_dur = _audio_duration_from_ref(audio)
        est = estimate_duration("retranscribe", audio_dur, model_name=model_name, device=device)
        est_s = est.get("estimated_duration_s") or 15
        bar_html = pipeline_progress_bar_html(est_s)

        _skip = gr.update()
        yield (
            _skip, _skip,                                                       # output_html, output_json
            _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
            _skip,                                                              # export_file
            _skip,                                                              # retranscribe_btn
            _skip,                                                              # animate_all_btn
            gr.update(value=bar_html, visible=True),                            # show pipeline_progress
            _skip,                                                              # cached_model_name
        )

        try:
            result = _retranscribe_wrapper(intervals, audio, sr, speech_intervals,
                                           is_complete, model_name, device, log_row,
                                           silence, speech, pad,
                                           is_preset=is_preset, request=request,
                                           endpoint=f"ui:{audio_source}",
                                           url_source=url_input if audio_source == "link" else None)
        except QuotaExhaustedError as e:
            raw = str(e).lower()
            if e.reset_time and e.reset_time != "0:00:00":
                reset_msg = f" Resets in {e.reset_time}."
            elif e.reset_time == "0:00:00":
                reset_msg = " Daily limit — resets ~24h after your first GPU use today."
            else:
                reset_msg = ""
            if "unlogged user" in raw or "signup for free" in raw:
                msg = (f"Anonymous GPU quota exhausted.{reset_msg} "
                       "Sign in on Hugging Face for more quota, or switch Device to CPU.")
            else:
                msg = (f"Your GPU quota is exhausted.{reset_msg} "
                       "Upgrade to Hugging Face Pro for more quota, or switch Device to CPU.")
            gr.Warning(msg)
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip,                                                              # export_file
                _skip,                                                              # retranscribe_btn
                _skip,                                                              # animate_all_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # cached_model_name
            )
            return
        except (PoolQueueFullError, PoolExhaustedError) as e:
            gr.Warning(f"CPU workers busy: {e}. Please retry in a minute.")
            yield (
                _skip, _skip,
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,
                _skip,
                _skip,
                _skip,
                gr.update(visible=False),
                _skip,
            )
            return
        except Exception as e:
            gr.Warning(f"Processing failed: {e}")
            yield (
                _skip, _skip,                                                       # output_html, output_json
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached states
                _skip,                                                              # export_file
                _skip,                                                              # retranscribe_btn
                _skip,                                                              # animate_all_btn
                gr.update(visible=False),                                           # hide pipeline_progress
                _skip,                                                              # cached_model_name
            )
            return
        json_data = result[1]
        yield (
            *result,                                                            # 9 pipeline outputs
            save_json_export(json_data),                                        # export_file
            gr.update(visible=False),                                           # hide retranscribe_btn
            gr.update(visible=True, interactive=True, variant="primary"),       # re-enable animate_all_btn
            gr.update(visible=False),                                           # hide pipeline_progress
            "Large" if model_name == "Base" else "Base",                        # flip cached_model_name
        )

    c.retranscribe_btn.click(
        fn=_retranscribe_all,
        inputs=[
            c.cached_intervals, c.cached_audio, c.cached_sample_rate,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_model_name, c.device_radio,
            c.cached_log_row,
            c.min_silence_slider, c.min_speech_slider, c.pad_slider,
            c.is_preset, c.audio_source, c.url_input,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
            c.export_file, c.retranscribe_btn, c.animate_all_btn,
            c.pipeline_progress, c.cached_model_name,
        ],
        api_name=False, show_progress="hidden"
    )


def _wire_split_chain(c):
    """Wire Split-Segments toggle, sentinel-label updaters, and the split run."""
    from config import (
        SPLIT_MAX_VERSES_MAX, SPLIT_MAX_WORDS_MAX, SPLIT_MAX_DURATION_MAX,
        SPLIT_PROGRESS_SEGMENT_RATE,
    )
    from src.alignment.segment_splitter import is_eligible, violates

    def _toggle_split_panel(currently_visible):
        new_visible = not currently_visible
        return gr.update(visible=new_visible), new_visible

    c.split_toggle_btn.click(
        fn=_toggle_split_panel,
        inputs=[c.split_panel_visible],
        outputs=[c.split_panel, c.split_panel_visible],
        api_name=False, show_progress="hidden",
    )

    # Sentinel-label updaters: show "Off" instead of the raw sentinel
    # numeric value at slider max.
    def _label_for_verses(v):
        try:
            iv = int(v)
        except (TypeError, ValueError):
            iv = SPLIT_MAX_VERSES_MAX
        shown = "Off" if iv >= SPLIT_MAX_VERSES_MAX else iv
        return gr.update(label=f"Max verses per segment: {shown}")

    def _label_for_words(v):
        try:
            iv = int(v)
        except (TypeError, ValueError):
            iv = SPLIT_MAX_WORDS_MAX
        shown = "Off" if iv >= SPLIT_MAX_WORDS_MAX else iv
        return gr.update(label=f"Max words per segment: {shown}")

    def _label_for_duration(v):
        try:
            fv = float(v)
        except (TypeError, ValueError):
            fv = SPLIT_MAX_DURATION_MAX
        shown = "Off" if fv >= SPLIT_MAX_DURATION_MAX else f"{int(fv)}s"
        return gr.update(label=f"Max duration per segment (s): {shown}")

    c.split_max_verses.change(
        fn=_label_for_verses,
        inputs=[c.split_max_verses],
        outputs=[c.split_max_verses],
        api_name=False, show_progress="hidden",
    )
    c.split_max_words.change(
        fn=_label_for_words,
        inputs=[c.split_max_words],
        outputs=[c.split_max_words],
        api_name=False, show_progress="hidden",
    )
    c.split_max_duration.change(
        fn=_label_for_duration,
        inputs=[c.split_max_duration],
        outputs=[c.split_max_duration],
        api_name=False, show_progress="hidden",
    )

    def _count_violators(segments, max_v, max_w, max_d):
        if not segments:
            return 0
        mv = None if (max_v is None or int(max_v) >= SPLIT_MAX_VERSES_MAX) else int(max_v)
        mw = None if (max_w is None or int(max_w) >= SPLIT_MAX_WORDS_MAX) else int(max_w)
        md = None if (max_d is None or float(max_d) >= SPLIT_MAX_DURATION_MAX) else float(max_d)
        if mv is None and mw is None and md is None:
            return 0
        return sum(1 for s in segments
                   if is_eligible(s) and any(violates(s, mv, mw, md)))

    def _split_all(segments_state, audio, sr,
                   speech_intervals, is_complete, intervals,
                   max_v, max_w, max_d, require_stop,
                   log_row, segment_dir,
                   request: gr.Request = None):
        _skip = gr.update()

        # Yield 1: animate progress bar (per-violator rate) to cover the MFA call.
        violator_count = _count_violators(segments_state, max_v, max_w, max_d)
        est_s = max(2.0, violator_count * SPLIT_PROGRESS_SEGMENT_RATE + 1.0)
        bar_html = pipeline_progress_bar_html(est_s)
        yield (
            _skip, _skip,                                                       # output_html, output_json
            _skip, _skip, _skip, _skip, _skip, _skip, _skip,                   # 7 cached / intervals / seg_dir / log_row / audio / sr / speech_intervals / is_complete
            gr.update(value=bar_html, visible=True),                            # pipeline_progress
            _skip,                                                              # export_file
            _skip, _skip,                                                       # split_panel, split_panel_visible
        )

        try:
            result = split_segments_audio(
                segments_state, audio, sr,
                speech_intervals, is_complete, intervals,
                max_v, max_w, max_d,
                require_stop_sign=bool(require_stop),
                cached_log_row=log_row, cached_segment_dir=segment_dir,
                request=request, endpoint="ui",
            )
        except Exception as e:
            gr.Warning(f"Split failed: {e}")
            yield (
                _skip, _skip,
                _skip, _skip, _skip, _skip, _skip, _skip, _skip,
                gr.update(visible=False),                                       # hide progress bar
                _skip,
                gr.update(visible=False), False,                                # close split panel
            )
            return

        json_data = result[1]
        yield (
            *result,                                                            # 9 pipeline outputs
            gr.update(visible=False),                                           # hide progress bar
            save_json_export(json_data),                                        # export_file
            gr.update(visible=False), False,                                    # close split panel
        )

    c.split_btn.click(
        fn=_split_all,
        inputs=[
            c.output_json,
            c.cached_audio, c.cached_sample_rate,
            c.cached_speech_intervals, c.cached_is_complete, c.cached_intervals,
            c.split_max_verses, c.split_max_words, c.split_max_duration,
            c.split_require_stop_sign,
            c.cached_log_row, c.cached_segment_dir,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
            c.pipeline_progress, c.export_file,
            c.split_panel, c.split_panel_visible,
        ],
        api_name=False, show_progress="hidden",
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


def _wire_manual_split(c):
    """Wire manual per-card split requests from the JS bridge."""
    from config import SPLIT_PROGRESS_SEGMENT_RATE
    import json

    def _manual_split(payload_str, segments_state, audio, sr,
                      speech_intervals, is_complete, intervals,
                      log_row, segment_dir,
                      request: gr.Request = None):
        _skip = gr.update()

        if not payload_str:
            return

        try:
            payload = json.loads(payload_str)
        except (json.JSONDecodeError, TypeError):
            gr.Warning("Invalid split request.")
            return

        seg_idx = payload.get("idx")
        cuts = payload.get("cuts") or []
        if seg_idx is None or not cuts:
            gr.Warning("Choose at least one split point.")
            return

        est_s = max(2.0, SPLIT_PROGRESS_SEGMENT_RATE + 1.0)
        bar_html = pipeline_progress_bar_html(est_s)
        yield (
            _skip, _skip, _skip, _skip, _skip, _skip, _skip, _skip, _skip,
            gr.update(value=bar_html, visible=True),
            _skip,
        )

        try:
            result = manual_split_segment_audio(
                segments_state,
                audio, sr,
                speech_intervals, is_complete, intervals,
                seg_idx, cuts,
                cached_log_row=log_row,
                cached_segment_dir=segment_dir,
                request=request,
                endpoint="ui",
            )
        except Exception as e:
            gr.Warning(f"Split failed: {e}")
            yield (
                _skip, _skip, _skip, _skip, _skip, _skip, _skip, _skip, _skip,
                gr.update(visible=False),
                _skip,
            )
            return

        json_data = result[1]
        yield (
            *result,
            gr.update(visible=False),
            save_json_export(json_data),
        )

    _manual_io = dict(
        fn=_manual_split,
        inputs=[
            c.manual_split_payload,
            c.output_json,
            c.cached_audio, c.cached_sample_rate,
            c.cached_speech_intervals, c.cached_is_complete, c.cached_intervals,
            c.cached_log_row, c.cached_segment_dir,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row,
            c.pipeline_progress, c.export_file,
        ],
        show_progress="hidden",
    )
    c.manual_split_trigger.click(**_manual_io)
    c.manual_split_payload.submit(**_manual_io)


def _wire_undo_split(c):
    """Wire split-group undo requests from the JS bridge."""
    import json

    def _undo_split(payload_str, segments_state, audio, sr,
                    speech_intervals, is_complete, intervals,
                    log_row, segment_dir,
                    request: gr.Request = None):
        _skip = tuple(gr.skip() for _ in range(10))

        if not payload_str:
            return _skip

        try:
            payload = json.loads(payload_str)
        except (json.JSONDecodeError, TypeError):
            gr.Warning("Invalid undo split request.")
            return _skip

        seg_idx = payload.get("idx")
        if seg_idx is None:
            gr.Warning("Invalid split group selection.")
            return _skip

        try:
            result = undo_split_group_audio(
                segments_state,
                audio, sr,
                speech_intervals, is_complete, intervals,
                seg_idx,
                cached_log_row=log_row,
                cached_segment_dir=segment_dir,
                request=request,
                endpoint="ui",
            )
        except Exception as e:
            gr.Warning(f"Undo split failed: {e}")
            return _skip

        json_data = result[1]
        return (*result, save_json_export(json_data))

    _undo_io = dict(
        fn=_undo_split,
        inputs=[
            c.undo_split_payload,
            c.output_json,
            c.cached_audio, c.cached_sample_rate,
            c.cached_speech_intervals, c.cached_is_complete, c.cached_intervals,
            c.cached_log_row, c.cached_segment_dir,
        ],
        outputs=[
            c.output_html, c.output_json,
            c.cached_speech_intervals, c.cached_is_complete,
            c.cached_audio, c.cached_sample_rate,
            c.cached_intervals, c.cached_segment_dir,
            c.cached_log_row, c.export_file,
        ],
        show_progress="hidden",
    )
    c.undo_split_trigger.click(**_undo_io)
    c.undo_split_payload.submit(**_undo_io)


def _wire_ref_edit(c):
    """Wire inline ref editing — JS edits trigger Python state sync + patch."""
    _edit_io = dict(
        fn=apply_ref_edit,
        inputs=[c.ref_edit_payload, c.output_json, c.cached_segment_dir, c.cached_log_row],
        outputs=[c.output_json, c.export_file, c.edit_patch, c.cached_log_row],
        show_progress="hidden",
    )
    # Both paths: button click (primary) and textbox submit (Enter key fallback)
    c.ref_edit_trigger.click(**_edit_io)
    c.ref_edit_payload.submit(**_edit_io)


def _wire_repeat_feedback(c):
    """Wire repetition feedback — JS thumbs up/down triggers Python log update."""
    _fb_io = dict(
        fn=apply_repeat_feedback,
        inputs=[c.repeat_fb_payload, c.cached_log_row],
        outputs=[c.cached_log_row],
        show_progress="hidden",
    )
    c.repeat_fb_trigger.click(**_fb_io)
    c.repeat_fb_payload.submit(**_fb_io)


def _wire_api_endpoint(c):
    """Hidden API-only endpoints for session-based programmatic access."""
    gr.Button(visible=False).click(
        fn=estimate_duration,
        inputs=[c.api_estimate_endpoint, c.api_estimate_audio_duration,
                c.api_audio_id, c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="estimate_duration",
    )
    gr.Button(visible=False).click(
        fn=process_audio_session,
        inputs=[c.api_audio, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="process_audio_session",
    )
    gr.Button(visible=False).click(
        fn=process_url_session,
        inputs=[c.api_url, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="process_url_session",
    )
    gr.Button(visible=False).click(
        fn=resegment,
        inputs=[c.api_audio_id, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="resegment",
    )
    gr.Button(visible=False).click(
        fn=retranscribe,
        inputs=[c.api_audio_id, c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="retranscribe",
    )
    gr.Button(visible=False).click(
        fn=split_segments,
        inputs=[c.api_audio_id, c.api_split_max_verses, c.api_split_max_words,
                c.api_split_max_duration, c.api_split_require_stop_sign],
        outputs=[c.api_result],
        api_name="split_segments",
    )
    gr.Button(visible=False).click(
        fn=realign_from_timestamps,
        inputs=[c.api_audio_id, c.api_timestamps, c.api_model, c.api_device],
        outputs=[c.api_result],
        api_name="realign_from_timestamps",
    )
    gr.Button(visible=False).click(
        fn=timestamps,
        inputs=[c.api_audio_id, c.api_mfa_segments, c.api_mfa_granularity],
        outputs=[c.api_result],
        api_name="timestamps",
    )
    gr.Button(visible=False).click(
        fn=timestamps_direct,
        inputs=[c.api_audio, c.api_mfa_segments, c.api_mfa_granularity],
        outputs=[c.api_result],
        api_name="timestamps_direct",
    )
    gr.Button(visible=False).click(
        fn=debug_process,
        inputs=[c.api_audio, c.api_silence, c.api_speech, c.api_pad,
                c.api_model, c.api_device, c.api_debug_token],
        outputs=[c.api_result],
        api_name="debug_process",
    )
    # VAD-only benchmark endpoints (dev only).
    gr.Button(visible=False).click(
        fn=bench_prepare,
        inputs=[c.api_bench_audio, c.api_url],
        outputs=[c.api_result],
        api_name="bench_prepare",
    )
    gr.Button(visible=False).click(
        fn=bench_vad,
        inputs=[c.api_audio_id, c.api_bench_batch_size, c.api_bench_dtype],
        outputs=[c.api_result],
        api_name="bench_vad",
    )
    # CPU worker exec — invoked by main Space's worker_pool dispatcher.
    # Only functional when WORKER_MODE=cpu is set on this Space.
    gr.Button(visible=False).click(
        fn=cpu_exec,
        inputs=[c.api_cpu_exec_token, c.api_cpu_exec_module, c.api_cpu_exec_func,
                c.api_cpu_exec_args, c.api_cpu_exec_kwargs, c.api_cpu_exec_meta],
        outputs=[c.api_result],
        api_name="cpu_exec",
    )
    # Pool status — HF-token-gated, returns per-worker state + pool config.
    gr.Button(visible=False).click(
        fn=pool_status,
        inputs=[c.api_pool_status_token],
        outputs=[c.api_result],
        api_name="pool_status",
    )
    # Persistent CPU worker pool status — HF-token-gated.
    gr.Button(visible=False).click(
        fn=cpu_pool_status,
        inputs=[c.api_pool_status_token],
        outputs=[c.api_result],
        api_name="cpu_pool_status",
    )
    # Kill a persistent worker — crash-recovery test helper, HF-token-gated.
    gr.Button(visible=False).click(
        fn=cpu_pool_kill,
        inputs=[c.api_pool_status_token, c.api_cpu_exec_module],  # reuse token + a string input
        outputs=[c.api_result],
        api_name="cpu_pool_kill",
    )


def _wire_dev_tab(c):
    """Wire dev tab event handlers."""
    from src.ui.dev_tools import (
        load_logs_handler, filter_and_sort_handler, select_log_row_handler,
        build_profiling_plots_handler,
    )

    # Load / Refresh buttons
    _load_outputs = [c.dev_all_rows, c.dev_filtered_indices, c.dev_status, c.dev_table]

    _plot_outputs = [c.dev_gpu_plot, c.dev_cpu_plot]

    c.dev_load_btn.click(
        fn=load_logs_handler,
        inputs=[],
        outputs=_load_outputs,
        api_name=False, show_progress="minimal",
    )
    c.dev_refresh_btn.click(
        fn=load_logs_handler,
        inputs=[],
        outputs=_load_outputs,
        api_name=False, show_progress="minimal",
    )

    # Filter / Sort changes
    _filter_inputs = [c.dev_all_rows, c.dev_filter_device, c.dev_filter_model,
                      c.dev_filter_status, c.dev_sort, c.dev_days_filter]
    _filter_outputs = [c.dev_filtered_indices, c.dev_table]

    for component in [c.dev_filter_device, c.dev_filter_model,
                      c.dev_filter_status, c.dev_sort, c.dev_days_filter]:
        component.change(
            fn=filter_and_sort_handler,
            inputs=_filter_inputs,
            outputs=_filter_outputs,
            api_name=False, show_progress="hidden",
        )

    # Plots — only on explicit button click
    c.dev_plots_btn.click(
        fn=build_profiling_plots_handler,
        inputs=[c.dev_all_rows, c.dev_filtered_indices],
        outputs=_plot_outputs,
        api_name=False, show_progress="minimal",
    )

    # Table row selection — returns 6-tuple with timestamps + controls
    c.dev_table.select(
        fn=select_log_row_handler,
        inputs=[c.dev_all_rows, c.dev_filtered_indices],
        outputs=[c.dev_detail_html, c.dev_json_output, c.dev_segment_dir,
                 c.dev_compute_ts_btn, c.dev_animate_all_html, c.dev_compute_ts_progress],
        api_name=False, show_progress="minimal",
    )

    # Compute Timestamps button — uses same MFA flow as main tab
    c.dev_compute_ts_btn.click(
        fn=compute_mfa_timestamps,
        inputs=[c.dev_detail_html, c.dev_json_output, c.dev_segment_dir],
        outputs=[c.dev_detail_html, c.dev_compute_ts_btn, c.dev_animate_all_html,
                 c.dev_compute_ts_progress, c.dev_json_output],
        api_name=False, show_progress="hidden",
    )
