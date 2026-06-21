"""Python event handler callbacks for the Gradio UI."""
import re
import uuid
from pathlib import Path

import gradio as gr

from config import (
    URL_DOWNLOAD_DIR,
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


def _build_info_html(title, duration, thumbnail):
    """Build HTML info card for a URL-sourced audio."""
    dur_str = f"{int(duration) // 60}:{int(duration) % 60:02d}" if duration else "unknown"
    thumb_html = (
        f'<img src="{thumbnail}" style="max-width:100%;max-height:120px;border-radius:8px;margin-bottom:4px;">'
        if thumbnail else ""
    )
    return (
        f'<div style="padding:8px;border-radius:8px;background:var(--block-background-fill);'
        f'border:1px solid var(--border-color-primary);">'
        f'{thumb_html}'
        f'<div style="font-weight:bold;font-size:14px;">{title}</div>'
        f'<div style="font-size:12px;opacity:0.7;">Duration: {dur_str}</div>'
        f'</div>'
    )


_WARN_DOMAINS = ("youtube.com", "youtu.be", "facebook.com", "fb.watch", "instagram.com")


def fetch_url_info(url: str):
    """Fetch metadata only (no download). Returns (info_html, warning) tuple. Raises Exception on error."""
    import yt_dlp
    from urllib.parse import urlparse
    from src.core.usage_logger import log_error, mark_endpoint_entry, set_stage

    if not url or not url.strip():
        return None, None

    url = url.strip()
    mark_endpoint_entry()
    set_stage("validate")

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        log_error(error_code="url_probe_failed", endpoint="ui_url_info",
                  stage="validate", exception=e,
                  message=f"URL probe failed: {e}", context={"url": url})
        raise

    if info.get("_type") == "playlist":
        log_error(error_code="playlist_rejected", endpoint="ui_url_info",
                  stage="validate",
                  message="Playlists are not supported",
                  context={"url": url})
        raise Exception("Playlists are not supported. Please paste a single video/audio URL.")

    title = info.get("title", "Unknown")
    duration = info.get("duration")
    thumbnail = info.get("thumbnail", "")

    # Warn for sites that may require auth from server IPs
    warning = None
    try:
        host = urlparse(url).hostname or ""
        if any(d in host for d in _WARN_DOMAINS):
            warning = "This site may not work from our server — download could fail. Try it, or upload the file directly."
    except Exception:
        pass

    return _build_info_html(title, duration, thumbnail), warning


def _download_url_core(url: str):
    """Download audio from URL. Returns (wav_path, info_dict).

    info_dict keys: title, duration, thumbnail, source_url.
    Raises Exception on error (empty URL, playlist, download failure).
    """
    import yt_dlp

    if not url or not url.strip():
        raise Exception("Please enter a URL")

    url = url.strip()

    URL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = URL_DOWNLOAD_DIR / str(uuid.uuid4())

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_path),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "128"}],
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    mp3_path = str(out_path) + ".mp3"
    if not Path(mp3_path).exists():
        raise Exception("Download completed but audio file was not created.")

    return mp3_path, {
        "title": info.get("title", "Unknown"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail", ""),
        "source_url": url,
    }


def download_url_audio(url: str):
    """Full download of audio from URL. Returns (wav_path, info_html). Raises Exception on error."""
    from src.core.usage_logger import log_error, mark_endpoint_entry, set_stage
    mark_endpoint_entry()
    set_stage("download")
    try:
        wav_path, info = _download_url_core(url)
    except Exception as e:
        msg = str(e)
        if "Please enter a URL" in msg:
            code = "empty_url"
        elif "was not created" in msg:
            code = "download_file_missing"
        else:
            code = "download_failed"
        log_error(error_code=code, endpoint="ui_url_download",
                  stage="download", exception=e, message=msg,
                  context={"url": url})
        raise
    return wav_path, _build_info_html(info["title"], info["duration"], info["thumbnail"])


_AUDIO_ID_RE = re.compile(r"^[0-9a-f]{16}$")


def is_audio_id(val: str) -> bool:
    """True if val looks like a 16-char hex content hash (logs audio_id)."""
    return bool(_AUDIO_ID_RE.match((val or "").strip()))


def _fetch_audio_id_core(audio_id: str):
    """Fetch OGG bytes for audio_id from the logs audio dataset. Returns (ogg_path, info_dict).

    Uses streaming + Audio(decode=False) so we only decode the matched row.
    Reads HF_TOKEN from env for private-dataset access.
    """
    from datasets import load_dataset, Audio
    import soundfile as sf
    from config import (
        USAGE_LOG_AUDIO_REPO, USAGE_LOG_AUDIO_SUBSET, URL_DOWNLOAD_DIR,
    )

    ds = load_dataset(
        USAGE_LOG_AUDIO_REPO, USAGE_LOG_AUDIO_SUBSET,
        split="train", streaming=True,
    ).cast_column("audio", Audio(decode=False))

    row = next((r for r in ds if r["audio_id"] == audio_id), None)
    if row is None:
        raise Exception(f"audio_id {audio_id!r} not found in dataset")

    raw = row["audio"]["bytes"]
    URL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    out_path = URL_DOWNLOAD_DIR / f"{audio_id}.ogg"
    out_path.write_bytes(raw)

    try:
        meta = sf.info(str(out_path))
        duration = float(meta.frames) / float(meta.samplerate)
    except Exception:
        duration = None

    return str(out_path), {
        "title": f"audio_id {audio_id}",
        "duration": duration,
        "thumbnail": "",
        "source_url": f"dataset://{USAGE_LOG_AUDIO_REPO}#{audio_id}",
    }


def fetch_audio_by_id(audio_id: str):
    """Fetch audio from logs dataset by content-hash id. Returns (ogg_path, info_html)."""
    from src.core.usage_logger import log_error, mark_endpoint_entry, set_stage
    mark_endpoint_entry()
    set_stage("download")
    try:
        path, info = _fetch_audio_id_core(audio_id)
    except Exception as e:
        msg = str(e)
        code = "audio_id_not_found" if "not found" in msg else "audio_id_fetch_failed"
        log_error(error_code=code, endpoint="ui_audio_id_fetch",
                  stage="download", exception=e, message=msg,
                  context={"audio_id": audio_id})
        raise
    return path, _build_info_html(info["title"], info["duration"], info["thumbnail"])


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
