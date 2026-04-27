"""Dev tab — browse and inspect usage logs from HF dataset (local only)."""

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import gradio as gr
import numpy as np

from config import SEGMENT_AUDIO_DIR, SURAH_INFO_PATH


# ── Surah names cache ──────────────────────────────────────────────────

_surah_names: dict[int, str] | None = None


def _load_surah_names() -> dict[int, str]:
    global _surah_names
    if _surah_names is not None:
        return _surah_names
    if not SURAH_INFO_PATH.exists():
        _surah_names = {}
        return _surah_names
    with open(SURAH_INFO_PATH) as f:
        data = json.load(f)
    _surah_names = {int(k): v["name_en"] for k, v in data.items()}
    return _surah_names


# ── HF token loading (same pattern as scripts/analyze_logs.py) ─────────

def _load_token() -> str | None:
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("HF_TOKEN="):
                return line.split("=", 1)[1]
    return None


# ── Dataset helpers ────────────────────────────────────────────────────

def _has_valid_segments(segments_str) -> bool:
    """V3: segments column is a flat list of segment dicts (one per matched segment)."""
    if not segments_str:
        return False
    try:
        segs = json.loads(segments_str)
        return isinstance(segs, list) and len(segs) > 0
    except (json.JSONDecodeError, TypeError):
        return False


def _fmt_duration(seconds) -> str:
    if seconds is None:
        return "N/A"
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m {int(s)}s"


def _fmt_pct(val) -> str:
    if val is None:
        return "N/A"
    return f"{val * 100:.1f}%"


def _fmt_time(val) -> str:
    if val is None:
        return "N/A"
    return f"{val:.1f}s"


# ── UI builder ─────────────────────────────────────────────────────────

def build_dev_tab_ui(c):
    """Build the Dev tab UI components and attach them to the namespace."""
    with gr.Row():
        c.dev_load_btn = gr.Button("Load Logs", variant="primary", size="sm")
        c.dev_refresh_btn = gr.Button("Refresh", size="sm")
        c.dev_status = gr.Markdown("Click **Load Logs** to stream metadata from HF dataset.")

    with gr.Row():
        c.dev_filter_device = gr.Dropdown(
            choices=["All", "GPU", "CPU"], value="All", label="Device", scale=1,
        )
        c.dev_filter_model = gr.Dropdown(
            choices=["All", "Base", "Large"], value="All", label="Model", scale=1,
        )
        c.dev_filter_status = gr.Dropdown(
            choices=["All", "All Passed", "Has Failures"], value="All", label="Status", scale=1,
        )
        c.dev_sort = gr.Dropdown(
            choices=["Newest", "Duration", "Failures"], value="Newest", label="Sort", scale=1,
        )
        c.dev_days_filter = gr.Number(
            label="Last N Days", value=None, precision=0, minimum=1, scale=1,
        )

    c.dev_table = gr.Dataframe(
        headers=["#", "Time", "Surah", "Duration", "Segs", "Model", "Device",
                 "Passed", "Failed", "Conf", "Retry", "Audio ID"],
        datatype=["number", "str", "str", "str", "number", "str", "str",
                  "number", "number", "str", "number", "number", "str"],
        interactive=False,
        label="Usage Logs",
        wrap=True,
    )

    with gr.Row():
        c.dev_plots_btn = gr.Button("Show Plots", size="sm")
    with gr.Row():
        c.dev_gpu_plot = gr.Plot(label="GPU: Audio Duration vs Processing Time", visible=False)
        c.dev_cpu_plot = gr.Plot(label="CPU: Audio Duration vs Processing Time", visible=False)

    c.dev_detail_html = gr.HTML(value="", label="Log Detail")

    with gr.Row():
        c.dev_compute_ts_btn = gr.Button("Compute Timestamps", variant="secondary",
                                          interactive=False, visible=False)
        c.dev_compute_ts_progress = gr.HTML(value="", visible=False)
        c.dev_animate_all_html = gr.HTML(value="", visible=False)

    # State
    c.dev_all_rows = gr.State(value=[])
    c.dev_filtered_indices = gr.State(value=[])
    c.dev_segment_dir = gr.State(value=None)
    c.dev_json_output = gr.State(value=None)


# ── Row extraction ─────────────────────────────────────────────────────

def _safe_load(s):
    """Parse a JSON string from a row, tolerating None / malformed input."""
    if not s:
        return {}
    if isinstance(s, (dict, list)):
        return s
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return {}


def _row_to_dict(row) -> dict:
    """Extract the fields we care about from a V3 dataset row.

    V3 layout: flat columns + JSON-string columns (`timing`, `settings`,
    `results_summary`, `reciter_stats`, `segments`, etc.). This helper
    unpacks the JSON side into flat keys so the rest of the dev_tools UI
    keeps working with the same shape it used to get from v2.
    """
    settings        = _safe_load(row.get("settings"))
    timing          = _safe_load(row.get("timing"))
    results_summary = _safe_load(row.get("results_summary"))
    anchor_col      = _safe_load(row.get("anchor"))
    vad_block       = timing.get("vad", {}) if isinstance(timing, dict) else {}
    asr_block       = timing.get("asr", {}) if isinstance(timing, dict) else {}
    dp_block        = timing.get("dp",  {}) if isinstance(timing, dict) else {}
    num_segments    = results_summary.get("num_segments") or 0
    segments_passed = results_summary.get("segments_passed") or 0

    def _vad_gpu():
        w = vad_block.get("wall_s"); q = vad_block.get("queue_s")
        return (w - q) if (w is not None and q is not None) else None

    def _asr_gpu():
        w = asr_block.get("wall_s"); q = asr_block.get("queue_s")
        return (w - q) if (w is not None and q is not None) else None

    return {
        # ── flat identity / metadata ──
        "audio_id": row.get("audio_id", ""),
        "timestamp": row.get("timestamp", ""),
        "schema_version": row.get("schema_version", ""),
        "endpoint": row.get("endpoint", ""),
        "audio_duration_s": row.get("audio_duration_s"),
        # 3.0.1+: device / asr_model / asr_model_label live inside settings
        "asr_model":       settings.get("asr_model", ""),
        "asr_model_label": settings.get("asr_model_label", ""),
        "device":          settings.get("device", ""),
        # 3.1.0+: wall_total_s lives inside timing
        "total_time": timing.get("wall_total_s") if isinstance(timing, dict) else None,

        # ── unpacked (3.1.0+: surah/anchor_ayah from anchor col; segments_failed derived) ──
        "surah": anchor_col.get("winner_surah") if isinstance(anchor_col, dict) else None,
        "anchor_ayah": anchor_col.get("winner_ayah") if isinstance(anchor_col, dict) else None,
        "num_segments": num_segments,
        "missing_word_count": results_summary.get("missing_word_count"),
        "segments_passed": segments_passed,
        "segments_failed": max(0, num_segments - segments_passed),
        "mean_confidence": results_summary.get("mean_confidence"),
        "min_confidence":  results_summary.get("min_confidence"),
        "retry_attempts": results_summary.get("retry_attempts") or 0,
        "retry_passed":   results_summary.get("retry_passed") or 0,
        "reanchors":        results_summary.get("reanchors") or 0,
        "special_merges":   results_summary.get("special_merges") or 0,
        "transition_skips": results_summary.get("transition_skips") or 0,
        "wraps_detected":   results_summary.get("wraps_detected") or 0,

        # ── timing unpacked (flattened equivalents of v2 per-stage fields) ──
        "vad_gpu_time":   _vad_gpu(),
        "asr_gpu_time":   _asr_gpu(),
        "dp_total_time":  dp_block.get("total_s"),

        # ── settings unpacked ──
        "min_silence_ms": settings.get("min_silence_ms"),
        "min_speech_ms":  settings.get("min_speech_ms"),
        "pad_ms":         settings.get("pad_ms"),

        # ── keep raw JSON columns addressable for downstream inspection ──
        "segments":        row.get("segments"),
        "events":          row.get("events"),
        "anchor":          row.get("anchor"),
        "asr_batches":     row.get("asr_batches"),
        "reciter_stats":   row.get("reciter_stats"),
        "gpu_memory":      row.get("gpu_memory"),
        "timing":          row.get("timing"),
        "results_summary": row.get("results_summary"),
    }


# ── Table building ─────────────────────────────────────────────────────

def _build_table_row(row_dict, index, surah_names):
    """Build a single table row list from a row dict."""
    ts = row_dict.get("timestamp", "")
    try:
        dt = datetime.fromisoformat(ts)
        time_display = dt.strftime("%m-%d %H:%M")
    except (ValueError, TypeError):
        time_display = str(ts)[:16] if ts else "N/A"

    surah = row_dict.get("surah")
    name = surah_names.get(surah, "") if surah else ""
    surah_display = f"{surah} {name}" if name else str(surah or "?")

    return [
        index + 1,
        time_display,
        surah_display,
        _fmt_duration(row_dict.get("audio_duration_s")),
        row_dict.get("num_segments") or 0,
        row_dict.get("asr_model", "?"),
        row_dict.get("device", "?"),
        row_dict.get("segments_passed") or 0,
        row_dict.get("segments_failed") or 0,
        _fmt_pct(row_dict.get("mean_confidence")),
        row_dict.get("retry_attempts", 0) or 0,
        row_dict.get("audio_id", ""),
    ]


def _build_table(rows, indices, surah_names):
    """Build table data from rows and their display indices."""
    return [_build_table_row(rows[i], display_idx, surah_names)
            for display_idx, i in enumerate(indices)]


# ── Handlers ───────────────────────────────────────────────────────────

def load_logs_handler():
    """Stream dataset (no audio) and return rows + table."""
    token = _load_token()
    if not token:
        gr.Warning("HF_TOKEN not found in .env or environment.")
        return [], [], "HF_TOKEN not found.", gr.update()

    try:
        from datasets import load_dataset
    except ImportError:
        gr.Warning("'datasets' package not installed.")
        return [], [], "'datasets' package not installed.", gr.update()

    surah_names = _load_surah_names()

    try:
        from config import USAGE_LOG_LOGS_REPO
        ds = load_dataset(USAGE_LOG_LOGS_REPO, token=token,
                          split="train", streaming=True)
    except Exception as e:
        gr.Warning(f"Failed to load dataset: {e}")
        return [], [], f"Error: {e}", gr.update()

    rows = []
    total = 0
    for row in ds:
        total += 1
        # V3: only parse v3-shape rows. Older subsets/versions are skipped.
        if not str(row.get("schema_version", "")).startswith("3."):
            continue
        if _has_valid_segments(row.get("segments")):
            rows.append(_row_to_dict(row))

    # Sort newest first
    rows.sort(key=lambda r: r.get("timestamp") or "", reverse=True)

    indices = list(range(len(rows)))
    table_data = _build_table(rows, indices, surah_names)
    status = f"Loaded {len(rows)} rows with segments (out of {total} total)."

    return rows, indices, status, table_data


def filter_and_sort_handler(all_rows, device, model, status_filter, sort_by, days=None):
    """Filter and sort cached rows, return new table + index mapping."""
    if not all_rows:
        return [], gr.update()

    surah_names = _load_surah_names()
    indices = []

    # Compute cutoff for days filter
    cutoff = None
    if days is not None and days > 0:
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=int(days))

    for i, row in enumerate(all_rows):
        # Days filter
        if cutoff is not None:
            ts = row.get("timestamp", "")
            try:
                row_dt = datetime.fromisoformat(ts)
                if row_dt.tzinfo is None:
                    row_dt = row_dt.replace(tzinfo=timezone.utc)
                if row_dt < cutoff:
                    continue
            except (ValueError, TypeError):
                continue

        # Device filter
        if device != "All":
            row_device = (row.get("device") or "").lower()
            if device == "GPU" and row_device not in ("cuda", "gpu"):
                continue
            if device == "CPU" and row_device not in ("cpu",):
                continue

        # Model filter
        if model != "All":
            row_model = row.get("asr_model", "")
            if model == "Base" and row_model != "Base":
                continue
            if model == "Large" and row_model != "Large":
                continue

        # Status filter
        if status_filter == "All Passed":
            if (row.get("segments_failed") or 0) > 0:
                continue
        elif status_filter == "Has Failures":
            if (row.get("segments_failed") or 0) == 0:
                continue

        indices.append(i)

    # Sort
    if sort_by == "Duration":
        indices.sort(key=lambda i: all_rows[i].get("audio_duration_s") or 0, reverse=True)
    elif sort_by == "Failures":
        indices.sort(key=lambda i: all_rows[i].get("segments_failed") or 0, reverse=True)
    # else "Newest" — already sorted by timestamp from load

    table_data = _build_table(all_rows, indices, surah_names)
    return indices, table_data


def build_profiling_plots_handler(all_rows, filtered_indices):
    """Build GPU and CPU linear regression scatter plots from filtered data."""
    if not all_rows or not filtered_indices:
        return gr.update(visible=False), gr.update(visible=False)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # Collect data points from filtered rows
    gpu_rows = []  # (audio_dur, vad_gpu, asr_gpu, asr_model)
    cpu_rows = []

    for i in filtered_indices:
        row = all_rows[i]
        audio_dur = row.get("audio_duration_s")
        vad_gpu = row.get("vad_gpu_time")
        asr_gpu = row.get("asr_gpu_time")
        device = (row.get("device") or "").lower()
        asr_model = row.get("asr_model", "")

        if audio_dur is None or audio_dur <= 0:
            continue

        entry = (audio_dur, vad_gpu, asr_gpu, asr_model)
        if device in ("cuda", "gpu"):
            gpu_rows.append(entry)
        elif device == "cpu":
            cpu_rows.append(entry)

    def _build_figure(rows, title):
        """Build a dual y-axis scatter + regression figure for one device type."""
        if not rows:
            return None

        # Split series
        vad_x, vad_y = [], []
        asr_base_x, asr_base_y = [], []
        asr_large_x, asr_large_y = [], []

        for audio_dur, vad_t, asr_t, model in rows:
            if vad_t is not None and vad_t > 0:
                vad_x.append(audio_dur)
                vad_y.append(vad_t)
            if asr_t is not None and asr_t > 0:
                if model == "Base":
                    asr_base_x.append(audio_dur)
                    asr_base_y.append(asr_t)
                elif model == "Large":
                    asr_large_x.append(audio_dur)
                    asr_large_y.append(asr_t)

        if not vad_x and not asr_base_x and not asr_large_x:
            return None

        fig, ax_vad = plt.subplots(figsize=(7, 4.5))
        ax_asr = ax_vad.twinx()

        handles, labels = [], []

        # VAD series (left y-axis, blue)
        if vad_x:
            s = ax_vad.scatter(vad_x, vad_y, color="#4a9eff", alpha=0.5, s=20, zorder=3)
            handles.append(s)
            if len(vad_x) >= 2:
                coeffs = np.polyfit(vad_x, vad_y, 1)
                x_line = np.array([min(vad_x), max(vad_x)])
                y_line = np.polyval(coeffs, x_line)
                line, = ax_vad.plot(x_line, y_line, color="#4a9eff", linewidth=1.5, zorder=4)
                labels.append(f"VAD: y={coeffs[0]:.3f}x+{coeffs[1]:.2f}")
            else:
                labels.append("VAD")

        # ASR Base series (right y-axis, orange)
        if asr_base_x:
            s = ax_asr.scatter(asr_base_x, asr_base_y, color="#f0ad4e", alpha=0.5, s=20, marker="^", zorder=3)
            handles.append(s)
            if len(asr_base_x) >= 2:
                coeffs = np.polyfit(asr_base_x, asr_base_y, 1)
                x_line = np.array([min(asr_base_x), max(asr_base_x)])
                y_line = np.polyval(coeffs, x_line)
                ax_asr.plot(x_line, y_line, color="#f0ad4e", linewidth=1.5, zorder=4)
                labels.append(f"ASR Base: y={coeffs[0]:.3f}x+{coeffs[1]:.2f}")
            else:
                labels.append("ASR Base")

        # ASR Large series (right y-axis, red)
        if asr_large_x:
            s = ax_asr.scatter(asr_large_x, asr_large_y, color="#d9534f", alpha=0.5, s=20, marker="s", zorder=3)
            handles.append(s)
            if len(asr_large_x) >= 2:
                coeffs = np.polyfit(asr_large_x, asr_large_y, 1)
                x_line = np.array([min(asr_large_x), max(asr_large_x)])
                y_line = np.polyval(coeffs, x_line)
                ax_asr.plot(x_line, y_line, color="#d9534f", linewidth=1.5, zorder=4)
                labels.append(f"ASR Large: y={coeffs[0]:.3f}x+{coeffs[1]:.2f}")
            else:
                labels.append("ASR Large")

        ax_vad.set_xlabel("Audio Duration (s)")
        ax_vad.set_ylabel("VAD Time (s)", color="#4a9eff")
        ax_asr.set_ylabel("ASR Time (s)", color="#f0ad4e")
        ax_vad.tick_params(axis="y", labelcolor="#4a9eff")
        ax_asr.tick_params(axis="y", labelcolor="#f0ad4e")
        ax_vad.set_title(title)

        if handles:
            fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.12, 0.88),
                       fontsize=8, framealpha=0.8)

        fig.tight_layout()
        return fig

    gpu_fig = _build_figure(gpu_rows, "GPU: Audio Duration vs Processing Time")
    cpu_fig = _build_figure(cpu_rows, "CPU: Audio Duration vs Processing Time")

    gpu_update = gr.update(value=gpu_fig, visible=True) if gpu_fig else gr.update(visible=False)
    cpu_update = gr.update(value=cpu_fig, visible=True) if cpu_fig else gr.update(visible=False)

    # Close figures to free memory
    plt.close("all")

    return gpu_update, cpu_update


def select_log_row_handler(all_rows, filtered_indices, evt: gr.SelectData):
    """When a table row is clicked, download audio, render segments, inject timestamps if available.

    Returns 6-tuple: (dev_detail_html, dev_json_output, dev_segment_dir,
                       dev_compute_ts_btn, dev_animate_all_html, dev_compute_ts_progress)
    """
    _empty = ("", None, None, gr.update(visible=False), gr.update(visible=False), gr.update(visible=False))
    if not all_rows or not filtered_indices:
        return _empty

    display_idx = evt.index[0] if isinstance(evt.index, (list, tuple)) else evt.index
    if display_idx < 0 or display_idx >= len(filtered_indices):
        return _empty

    row_idx = filtered_indices[display_idx]
    row = all_rows[row_idx]

    audio_id = row.get("audio_id", "")
    surah_names = _load_surah_names()

    # Build summary HTML
    summary_html = _build_summary_html(row, surah_names)

    # Reconstruct and render segments
    html, json_segments, segment_dir = _build_segments_from_log(row, audio_id)
    html = summary_html + html

    # Check if timestamps exist in the log
    has_ts = bool(row.get("word_timestamps"))

    if has_ts and json_segments:
        try:
            from src.mfa import inject_timestamps_into_html

            results = _log_timestamps_to_mfa_results(
                row.get("word_timestamps"), row.get("char_timestamps")
            )
            seg_to_result_idx = _build_seg_to_result_idx_from_log(json_segments, results)
            enriched_html, enriched_json = inject_timestamps_into_html(
                html, json_segments, results, seg_to_result_idx,
                str(segment_dir) if segment_dir else None,
            )
            animate_btn = '<button class="animate-all-btn">Animate All</button>'
            return (
                enriched_html,
                enriched_json,
                str(segment_dir) if segment_dir else None,
                gr.update(visible=False, interactive=False),
                gr.update(value=animate_btn, visible=True),
                gr.update(visible=False),
            )
        except Exception as e:
            print(f"[dev_tools] Timestamp injection from log failed: {e}")
            import traceback
            traceback.print_exc()
            # Fall through to non-timestamp path

    # No timestamps — build basic json_output and show Compute Timestamps button
    json_output = {"segments": json_segments} if json_segments else None
    has_audio = segment_dir is not None
    return (
        html,
        json_output,
        str(segment_dir) if segment_dir else None,
        gr.update(visible=has_audio, interactive=has_audio),
        gr.update(visible=False),
        gr.update(visible=False),
    )


# ── Summary HTML builder ───────────────────────────────────────────────

def _build_summary_html(row, surah_names) -> str:
    """Build the 4-section summary HTML for a log row."""
    surah = row.get("surah")
    name = surah_names.get(surah, "") if surah else ""
    surah_display = f"{surah} ({name})" if name else str(surah or "N/A")

    sections = []

    # 1. Summary
    sections.append(f"""
    <div style="margin-bottom: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #4a9eff;">
        <strong>Summary</strong><br>
        <span>Surah: {surah_display}</span> &nbsp;|&nbsp;
        <span>Duration: {_fmt_duration(row.get('audio_duration_s'))}</span> &nbsp;|&nbsp;
        <span>Segments: {row.get('num_segments', 'N/A')}</span> &nbsp;|&nbsp;
        <span>Audio ID: <code style="font-size: 0.85em;">{row.get('audio_id', 'N/A')}</code></span>
    </div>
    """)

    # 2. Settings
    sections.append(f"""
    <div style="margin-bottom: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #f0ad4e;">
        <strong>Settings</strong><br>
        <span>Min Silence: {row.get('min_silence_ms', 'N/A')} ms</span> &nbsp;|&nbsp;
        <span>Min Speech: {row.get('min_speech_ms', 'N/A')} ms</span> &nbsp;|&nbsp;
        <span>Pad: {row.get('pad_ms', 'N/A')} ms</span> &nbsp;|&nbsp;
        <span>Model: {row.get('asr_model', 'N/A')}</span> &nbsp;|&nbsp;
        <span>Device: {row.get('device', 'N/A')}</span>
    </div>
    """)

    # 3. Profiling
    sections.append(f"""
    <div style="margin-bottom: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #5cb85c;">
        <strong>Profiling</strong><br>
        <span>Total: {_fmt_time(row.get('total_time'))}</span> &nbsp;|&nbsp;
        <span>VAD Queue: {_fmt_time(row.get('vad_queue_time'))}</span> &nbsp;|&nbsp;
        <span>VAD GPU: {_fmt_time(row.get('vad_gpu_time'))}</span> &nbsp;|&nbsp;
        <span>ASR GPU: {_fmt_time(row.get('asr_gpu_time'))}</span> &nbsp;|&nbsp;
        <span>DP: {_fmt_time(row.get('dp_total_time'))}</span>
    </div>
    """)

    # 4. Quality
    passed = row.get("segments_passed") or 0
    failed = row.get("segments_failed") or 0
    total_segs = passed + failed
    pass_rate = f"{passed}/{total_segs}" if total_segs else "N/A"
    retry = f"{row.get('retry_passed', 0) or 0}/{row.get('retry_attempts', 0) or 0}"

    # V3: no session flags; derive from endpoint instead. Errors now live in
    # the separate JSONL log, not the main dataset — so there's no `error` col.
    endpoint = row.get("endpoint") or ""
    flags = []
    if endpoint == "resegment":
        flags.append("Resegment")
    elif endpoint == "retranscribe":
        flags.append("Retranscribe")
    elif endpoint == "realign":
        flags.append("Realign")
    flags_html = f" &nbsp;|&nbsp; <span>Endpoint: {', '.join(flags)}</span>" if flags else ""

    sections.append(f"""
    <div style="margin-bottom: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #d9534f;">
        <strong>Quality</strong><br>
        <span>Passed: {pass_rate}</span> &nbsp;|&nbsp;
        <span>Confidence: {_fmt_pct(row.get('mean_confidence'))}</span> &nbsp;|&nbsp;
        <span>Retries: {retry}</span> &nbsp;|&nbsp;
        <span>Reanchors: {row.get('reanchors', 0) or 0}</span>
        {flags_html}
    </div>
    """)

    return "\n".join(sections)


# ── Segment reconstruction from log ───────────────────────────────────

def _build_segments_from_log(row, audio_id):
    """Build segment cards from the log's segments JSON, downloading audio on demand.

    Returns (html, json_segments, segment_dir) where json_segments is a list
    of dicts compatible with the MFA/timestamp pipeline.
    """
    segments_str = row.get("segments")
    _empty = ('<div style="color: #999; padding: 20px;">No segment data in this log row.</div>', [], None)
    if not segments_str:
        return _empty

    try:
        seg_list = json.loads(segments_str)
    except (json.JSONDecodeError, TypeError):
        return ('<div style="color: #999; padding: 20px;">Could not parse segments JSON.</div>', [], None)

    # V3: segments column is a flat list of segment dicts (one row = one run).
    if not seg_list or not isinstance(seg_list, list):
        return ('<div style="color: #999; padding: 20px;">No segments in this row.</div>', [], None)

    # Try to download audio for this specific row
    audio_int16 = None
    sample_rate = 16000
    segment_dir = None

    try:
        audio_int16, sample_rate, segment_dir = _download_audio_for_row(audio_id)
    except Exception as e:
        print(f"[dev_tools] Audio download failed: {e}")

    # Build SegmentInfo objects and json_segments in parallel
    from src.core.segment_types import SegmentInfo
    from src.alignment.special_segments import ALL_SPECIAL_REFS, SPECIAL_TEXT
    from src.ui.segments import render_segments, get_text_with_markers

    segments = []
    json_segments = []
    for seg_idx, seg_data in enumerate(seg_list):
        ref = seg_data.get("ref", "")
        confidence = seg_data.get("confidence", 0.0) or 0.0
        start = seg_data.get("start", 0.0) or 0.0
        end = seg_data.get("end", 0.0) or 0.0
        error = seg_data.get("error")
        special_type = seg_data.get("special_type", "")
        duration = end - start

        # Parse ref into ref_from/ref_to/special_type
        if ref in ALL_SPECIAL_REFS:
            ref_from, ref_to, parsed_special = "", "", ref
        elif "-" in ref:
            ref_from, ref_to = ref.split("-", 1)
            parsed_special = ""
        else:
            ref_from = ref_to = ref
            parsed_special = ""

        # Reconstruct matched_text
        matched_text = ""
        if ref in ALL_SPECIAL_REFS:
            if ref in SPECIAL_TEXT:
                matched_text = SPECIAL_TEXT[ref]
        elif ref:
            matched_text = get_text_with_markers(ref) or ""

        # V3 renamed: missing_words → has_missing_words (but accept both for safety)
        has_missing = bool(seg_data.get("has_missing_words") or seg_data.get("missing_words"))

        seg_info = SegmentInfo(
            start_time=start,
            end_time=end,
            transcribed_text="",
            matched_text=matched_text,
            matched_ref=ref,
            match_score=confidence,
            error=error,
            has_missing_words=has_missing,
        )
        segments.append(seg_info)

        json_segments.append({
            "segment": seg_idx + 1,
            "ref_from": ref_from,
            "ref_to": ref_to,
            "time_from": start,
            "time_to": end,
            "confidence": confidence,
            "special_type": parsed_special,
            "matched_text": matched_text,
            "error": error,
            "has_missing_words": has_missing,
        })

    if not segments:
        return ('<div style="color: #999; padding: 20px;">No valid segments to display.</div>', [], None)

    # Write full.wav for playback (dev tools uses shorter recordings — sync write is fine)
    full_audio_url = ""
    if audio_int16 is not None and sample_rate > 0 and segment_dir:
        import soundfile as sf
        full_path = segment_dir / "full.wav"
        sf.write(str(full_path), audio_int16, sample_rate, format='WAV', subtype='PCM_16')
        full_audio_url = f"/gradio_api/file={full_path}"

    html = render_segments(segments, full_audio_url=full_audio_url)
    return html, json_segments, segment_dir


def _download_audio_for_row(audio_id: str):
    """Download audio for a specific row by streaming until audio_id matches.

    Returns (audio_int16, sample_rate, segment_dir) or raises on failure.
    """
    token = _load_token()
    if not token:
        raise ValueError("No HF token")

    from datasets import load_dataset
    from config import USAGE_LOG_AUDIO_REPO

    # V3: audio lives in its own dataset now, keyed by audio_id.
    ds = load_dataset(USAGE_LOG_AUDIO_REPO, token=token,
                      split="train", streaming=True)

    for row in ds:
        if row.get("audio_id") == audio_id:
            audio_data = row.get("audio")
            if audio_data is None:
                raise ValueError("Row found but audio is None")

            # HF Audio column returns {"path": ..., "array": np.array, "sampling_rate": int}
            audio_array = audio_data["array"]
            sr = audio_data["sampling_rate"]

            # Convert to int16
            audio_float = np.clip(audio_array, -1.0, 1.0)
            audio_int16 = (audio_float * 32767).astype(np.int16)

            # Clean up old dev segment directories
            for old_dir in SEGMENT_AUDIO_DIR.glob("dev_*"):
                if old_dir.is_dir():
                    shutil.rmtree(old_dir, ignore_errors=True)

            # Create segment directory
            segment_dir = SEGMENT_AUDIO_DIR / f"dev_{uuid.uuid4().hex[:8]}"
            segment_dir.mkdir(parents=True, exist_ok=True)

            return audio_int16, sr, segment_dir

    raise ValueError(f"Audio ID '{audio_id}' not found in dataset")


# ── Log timestamps → MFA results conversion ──────────────────────────

def _log_timestamps_to_mfa_results(word_ts_json, char_ts_json):
    """Convert logged timestamp format to MFA results format.

    Log char_timestamps: [{ref, words: [{word, location, letters: [{char, start, end}]}]}]
    MFA results format:  [{status: "ok", ref, words: [{word, location, start, end, letters: [...]}]}]
    """
    char_ts = json.loads(char_ts_json) if char_ts_json else []
    word_ts = json.loads(word_ts_json) if word_ts_json else []

    # Build word-level start/end lookup from word_timestamps
    word_lookup = {}  # {ref: {word_idx: (start, end)}}
    for entry in word_ts:
        ref = entry.get("ref", "")
        for widx, w in enumerate(entry.get("words", [])):
            if w.get("start") is not None and w.get("end") is not None:
                word_lookup.setdefault(ref, {})[widx] = (w["start"], w["end"])

    results = []

    if char_ts:
        # Primary path: use char_timestamps (has location + letters)
        for entry in char_ts:
            ref = entry.get("ref", "")
            ref_word_lookup = word_lookup.get(ref, {})
            words = []
            for widx, w in enumerate(entry.get("words", [])):
                word_start, word_end = ref_word_lookup.get(widx, (None, None))
                letters = w.get("letters", [])
                # Infer word start/end from letters if not in word_timestamps
                if word_start is None and letters:
                    starts = [lt["start"] for lt in letters if lt.get("start") is not None]
                    ends = [lt["end"] for lt in letters if lt.get("end") is not None]
                    if starts and ends:
                        word_start = min(starts)
                        word_end = max(ends)
                words.append({
                    "word": w.get("word", ""),
                    "location": w.get("location", ""),
                    "start": word_start,
                    "end": word_end,
                    "letters": letters,
                })
            results.append({"status": "ok", "ref": ref, "words": words})
    elif word_ts:
        # Fallback: word_timestamps only (no letters)
        for entry in word_ts:
            ref = entry.get("ref", "")
            words = []
            for w in entry.get("words", []):
                words.append({
                    "word": w.get("word", ""),
                    "location": "",
                    "start": w.get("start"),
                    "end": w.get("end"),
                    "letters": [],
                })
            results.append({"status": "ok", "ref": ref, "words": words})

    return results


def _build_seg_to_result_idx_from_log(json_segments, results):
    """Map segment indices to MFA result indices by matching refs."""
    from src.mfa import _build_mfa_ref

    # Build ref → result index lookup
    ref_to_result = {}
    for i, r in enumerate(results):
        ref = r.get("ref", "")
        if ref:
            ref_to_result[ref] = i

    seg_to_result_idx = {}
    for seg in json_segments:
        mfa_ref = _build_mfa_ref(seg)
        if mfa_ref is None:
            continue
        seg_idx = seg.get("segment", 0) - 1
        result_idx = ref_to_result.get(mfa_ref)
        if result_idx is not None:
            seg_to_result_idx[seg_idx] = result_idx

    return seg_to_result_idx
