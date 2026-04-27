"""Pure data-assembly for v3 usage-log JSON columns.

Each build_* function takes explicit inputs (no globals, no thread-locals) so
it's unit-testable without the pipeline. The pipeline reads thread-locals via
helper getters in `zero_gpu` / `pipeline.py` and passes the values down.

Shape spec: `docs/usage-logging-v3.md`.
"""

from __future__ import annotations

from typing import Any, Optional


def _r(v: Optional[float], n: int = 3) -> Optional[float]:
    """Round-or-None helper. Preserves `None` so downstream JSON serializes null."""
    if v is None:
        return None
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

def build_settings(min_silence_ms: int, min_speech_ms: int, pad_ms: int,
                   asr_model_id: str, asr_model_label: Optional[str],
                   device: str, url_source: Optional[str] = None) -> dict:
    # Wrap / DP-repetition constants live in config.py. Log them per row so
    # historical analyses stay interpretable after tuning.
    try:
        from config import (
            WRAP_PENALTY, WRAP_SPAN_WEIGHT, WRAP_SCORE_COST,
            MAX_EDIT_DISTANCE, MAX_EDIT_DISTANCE_RELAXED,
        )
        align_cfg = {
            "wrap_penalty": float(WRAP_PENALTY),
            "wrap_span_weight": float(WRAP_SPAN_WEIGHT),
            "wrap_score_cost": float(WRAP_SCORE_COST),
            # Acceptance thresholds from config — both primary and retry
            # logged per-row so threshold-tuning analysis can correlate
            # dp_debug.norm_dist against the active thresholds even when
            # they're retuned between runs.
            "max_edit_distance": float(MAX_EDIT_DISTANCE),
            "max_edit_distance_relaxed": float(MAX_EDIT_DISTANCE_RELAXED),
        }
    except Exception:
        align_cfg = None

    try:
        from config import SEGMENTER_BATCH_SIZE
        # CPU path always runs VAD at bs=1 (see src/segmenter/vad.py).
        vad_bs = 1 if str(device).lower().startswith("cpu") else int(SEGMENTER_BATCH_SIZE)
    except Exception:
        vad_bs = None

    return {
        "min_silence_ms": int(min_silence_ms),
        "min_speech_ms": int(min_speech_ms),
        "pad_ms": int(pad_ms),
        "asr_model": asr_model_id,
        "asr_model_label": asr_model_label,
        "device": device,
        "url_source": url_source,
        "align_config": align_cfg,
        "vad_batch_size": vad_bs,
    }


# ---------------------------------------------------------------------------
# timing (unified CPU + GPU + stage block)
# ---------------------------------------------------------------------------

def build_timing(profiling, cpu_stats: Optional[dict], worker_dispatch: Optional[dict],
                 lease_stats: Optional[dict], estimate_given_s: Optional[float],
                 device: str, estimate_formula_s: Optional[float] = None) -> dict:
    """Assemble the v3 `timing` block.

    Args:
        profiling: ProfilingData instance (stage timings + aggregates).
        cpu_stats: `_CPU_STATS_TLS.info` dict, or None (GPU path or no dispatch).
        worker_dispatch: `worker_pool._DISPATCH_TLS.info` dict, or None (not using remote pool).
        lease_stats: `_LEASE_STATS_TLS.info` dict, or None (CPU path — no lease).
        estimate_given_s: Ceil-to-5 value handed to the user — populates
            `timing.estimate_given_s`.
        estimate_formula_s: Raw formula output pre-ceil — populates
            `timing.estimate_formula_s`. Lets estimator tuning separate ceiling
            error from slope/intercept error.
        device: "gpu" / "cpu".
    """
    is_gpu = device.lower() == "gpu" and lease_stats is not None

    # stages = non-lease, non-per-batch wall buckets (always present)
    stages = {
        "resample_s": _r(getattr(profiling, "resample_time", 0.0)),
        "anchor_s": _r(getattr(profiling, "anchor_time", 0.0)),
        "match_wall_s": _r(getattr(profiling, "match_wall_time", 0.0)),
        "result_build_s": _r(getattr(profiling, "result_build_time", 0.0)),
        "result_audio_encode_s": _r(getattr(profiling, "result_audio_encode_time", 0.0)),
    }

    # VAD / ASR: inference dominates (~99.5%). Stage decomposition collapsed
    # to wall_s + queue_s only. Per-batch ASR detail (incl QK^T) still lives
    # in `asr_batches[]` for the L3-cache-cliff signal.
    vad_wall = getattr(profiling, "vad_wall_time", 0.0) or 0.0
    vad_gpu  = getattr(profiling, "vad_gpu_time", 0.0) or 0.0
    asr_wall = getattr(profiling, "asr_time", 0.0) or 0.0
    asr_gpu  = getattr(profiling, "asr_gpu_time", 0.0) or 0.0

    vad = {
        "wall_s":  _r(vad_wall),
        "queue_s": _r(max(0.0, vad_wall - vad_gpu)),
    }
    asr = {
        "wall_s":      _r(asr_wall),
        "queue_s":     _r(max(0.0, asr_wall - asr_gpu)),
    }

    # DP aggregate block
    dp = {
        "total_s": _r(getattr(profiling, "phoneme_dp_total_time", 0.0)),
        "avg_ms_per_seg": _r(1000 * getattr(profiling, "phoneme_dp_avg_time", 0.0)),
        "min_ms_per_seg": _r(1000 * getattr(profiling, "phoneme_dp_min_time", 0.0)),
        "max_ms_per_seg": _r(1000 * getattr(profiling, "phoneme_dp_max_time", 0.0)),
        "window_setup_s_total": _r(getattr(profiling, "phoneme_window_setup_time", 0.0)),
        "ref_build_s": _r(getattr(profiling, "phoneme_ref_build_time", 0.0)),
        "num_segments_aligned": int(getattr(profiling, "phoneme_num_segments", 0)),
    }

    timing = {
        "lease_type": (lease_stats or {}).get("lease_type") if is_gpu else ("none" if device.lower() == "cpu" else None),
        "lease_requested_s": (lease_stats or {}).get("requested_s") if is_gpu else None,
        "lease_cap_hit":     (lease_stats or {}).get("cap_hit") if is_gpu else None,
        "estimate_given_s":    _r(estimate_given_s),
        "estimate_formula_s":  _r(estimate_formula_s),
        "wall_total_s":        _r(getattr(profiling, "total_time", 0.0)),
        "stages": stages,
        "vad": vad,
        "asr": asr,
        "dp":  dp,
    }

    # CPU block — local subprocess dispatch (the production CPU path)
    if cpu_stats:
        timing["cpu"] = {
            "strategy":         cpu_stats.get("strategy"),
            "worker_mode":      cpu_stats.get("worker_mode"),
            "dtype":            cpu_stats.get("dtype"),
            "concurrency_cap":  cpu_stats.get("concurrency_cap"),
            "queue_wait_s":     _r(cpu_stats.get("queue_wait_s")),
            "compute_s":        _r(cpu_stats.get("compute_s")),
            "peers_at_acquire": cpu_stats.get("peers_at_acquire"),
            "peers_at_release": cpu_stats.get("peers_at_release"),
            "subprocess_spawn_s": _r(cpu_stats.get("subprocess_spawn_s")),
        }
    else:
        timing["cpu"] = None

    # Remote worker-pool dispatch (when CPU_STRATEGY=workers). Kept alongside
    # the local `cpu` block; post-hoc analysis can pick whichever is populated.
    timing["worker_dispatch"] = worker_dispatch
    return timing


# ---------------------------------------------------------------------------
# asr_batches (pass-through of already-shaped profiling.asr_batch_profiling)
# ---------------------------------------------------------------------------

def build_asr_batches(profiling) -> list[dict]:
    """Return the per-batch ASR detail list (already in v3-compatible shape)."""
    return list(getattr(profiling, "asr_batch_profiling", None) or [])


# ---------------------------------------------------------------------------
# segments (with dp_debug)
# ---------------------------------------------------------------------------

def build_segments(seg_infos, debug_collector,
                   word_counts: list, ayah_spans: list,
                   all_special_refs: set, include_dp_debug: bool = True,
                   audio=None, sample_rate: int = 16000,
                   noise_floor_rms: Optional[float] = None) -> list[dict]:
    """Per-segment log entries, one row per seg in `seg_infos`.

    DP-trace lookup uses `seg._original_alignment_idx` (preserved across
    `_split_fused_segments`) — NOT the post-split enumerate index — so
    segments that survived a Basmala/Isti'adha split still find their trace.

    `debug_collector.to_dp_debug(idx)` is called lazily — only when
    include_dp_debug is True — to avoid the `|`-separator build cost when
    disabled via `USAGE_LOG_DISABLE_DP_DEBUG=1`.
    """
    out = []
    for i, seg in enumerate(seg_infos):
        sp_type = seg.matched_ref if seg.matched_ref in all_special_refs else None
        entry = {
            "idx": i + 1,
            "start": round(seg.start_time, 3),
            "end": round(seg.end_time, 3),
            "duration": round(seg.end_time - seg.start_time, 3),
            "ref": seg.matched_ref or "",
            "confidence": round(seg.match_score, 3),
            "word_count":    word_counts[i]    if i < len(word_counts)    else 0,
            "ayah_span":     ayah_spans[i]     if i < len(ayah_spans)     else 0,
            "has_repeated_words": seg.has_repeated_words,
            "has_missing_words":  seg.has_missing_words,
            "special_type": sp_type,
        }
        if seg.repeated_ranges:
            entry["repeated_ranges"] = seg.repeated_ranges
        if seg.repeated_text:
            entry["repeated_text"] = seg.repeated_text
        if include_dp_debug and debug_collector is not None:
            trace_idx = getattr(seg, "_original_alignment_idx", None)
            if trace_idx is None:
                trace_idx = i  # fallback for unsplit segments
            dbg = debug_collector.to_dp_debug(trace_idx)
            if dbg is not None:
                entry["dp_debug"] = dbg
        # Per-segment audio stats (3.1.3+) — rms/peak/snr_db computed on
        # the segment slice. SNR uses clip-level noise floor from the
        # non-speech VAD concat. Unlocks segment-granular correlations in
        # 07/08/10 (previously only clip-level `audio_rms` available).
        if audio is not None:
            from .audio_analytics import segment_audio_stats
            entry["audio_stats"] = segment_audio_stats(
                audio, sample_rate,
                seg.start_time, seg.end_time,
                noise_floor_rms,
            )
        out.append(entry)
    return out


# ---------------------------------------------------------------------------
# events (pass-through of DebugCollector.events)
# ---------------------------------------------------------------------------

def build_events(debug_collector) -> list[dict]:
    if debug_collector is None:
        return []
    return list(debug_collector.events)


# ---------------------------------------------------------------------------
# anchor (pass-through of DebugCollector.anchor)
# ---------------------------------------------------------------------------

def build_anchor(debug_collector) -> dict:
    if debug_collector is None:
        return {}
    return dict(debug_collector.anchor)


# ---------------------------------------------------------------------------
# reciter_stats (adds audio_rms / audio_peak; drops pps)
# ---------------------------------------------------------------------------

def build_reciter_stats(wpm: float, avg_seg_dur: float, std_seg_dur: float,
                        avg_pause_dur: float, std_pause_dur: float,
                        audio,
                        audio_analytics: Optional[dict] = None) -> dict:
    """audio is the float32 mono 16kHz waveform already in scope at log time.

    When `audio_analytics` is supplied (3.1.3+), pull `rms/peak` plus the
    additive amplitude fields from its `whole` block instead of calling
    `audio_rms_peak` a second time. Falls back to `audio_rms_peak` when
    analytics computation was skipped.
    """
    whole = (audio_analytics or {}).get("whole") or {}
    if whole:
        rms = whole.get("rms", 0.0)
        peak = whole.get("peak", 0.0)
        dc = whole.get("dc_offset")
        p99 = whole.get("p99")
        p01 = whole.get("p01")
        crest = whole.get("crest")
        dyn_range_db = whole.get("dyn_range_db")
    else:
        from .audio_stats import audio_rms_peak
        rms, peak = audio_rms_peak(audio) if audio is not None else (0.0, 0.0)
        dc = p99 = p01 = crest = dyn_range_db = None
    return {
        "wpm":           _r(wpm, 2),
        "avg_seg_dur":   _r(avg_seg_dur, 2),
        "std_seg_dur":   _r(std_seg_dur, 2),
        "avg_pause_dur": _r(avg_pause_dur, 2),
        "std_pause_dur": _r(std_pause_dur, 2),
        "audio_rms":     _r(rms, 5),
        "audio_peak":    _r(peak, 5),
        "audio_dc_offset": _r(dc, 6),
        "audio_p99":     _r(p99, 5),
        "audio_p01":     _r(p01, 5),
        "audio_crest":   _r(crest, 3),
        "audio_dyn_range_db": _r(dyn_range_db, 2),
    }


# ---------------------------------------------------------------------------
# results_summary
# ---------------------------------------------------------------------------

def _parse_detected_surahs(segments) -> list[int]:
    """Sorted distinct surah numbers across all aligned segments.

    Derived from each segment's `matched_ref` leading "surah:" prefix.
    Skips specials (Basmala/Isti'adha/Amin/etc.) and empty refs.
    """
    seen: set[int] = set()
    for s in segments:
        ref = getattr(s, "matched_ref", None) or ""
        if not ref or ":" not in ref:
            continue  # special or no match
        head = ref.split("-", 1)[0]  # handle "37:151:3-37:152:2"
        try:
            seen.add(int(head.split(":", 1)[0]))
        except ValueError:
            continue
    return sorted(seen)


def build_results_summary(segments: list, profiling,
                          total_speech_s: float,
                          missing_word_count: int) -> dict:
    all_scores = [s.match_score for s in segments]
    mean_conf = (sum(all_scores) / len(all_scores)) if all_scores else 0.0
    min_conf = min(all_scores) if all_scores else 0.0
    passed = int(getattr(profiling, "segments_passed", 0) or 0)
    return {
        "detected_surahs": _parse_detected_surahs(segments),
        "num_segments": len(segments),
        "missing_word_count": int(missing_word_count),
        "total_speech_s": round(float(total_speech_s), 3),
        "mean_confidence": _r(mean_conf, 3),
        "min_confidence":  _r(min_conf, 3),
        "segments_passed": passed,
        "retry_attempts": int(getattr(profiling, "retry_attempts", 0) or 0),
        "retry_passed":   int(getattr(profiling, "retry_passed", 0) or 0),
        "reanchors":         int(getattr(profiling, "consec_reanchors", 0) or 0),
        "special_merges":    int(getattr(profiling, "special_merges", 0) or 0),
        "transition_skips":  int(getattr(profiling, "transition_skips", 0) or 0),
        "wraps_detected":    int(getattr(profiling, "phoneme_wraps_detected", 0) or 0),
    }


# ---------------------------------------------------------------------------
# gpu_memory (small one-liner — inlined at call site but exposed for parity)
# ---------------------------------------------------------------------------

def build_gpu_memory(profiling, device: str) -> Optional[dict]:
    if device.lower() != "gpu":
        return None
    return {
        "peak_vram_mb":     _r(getattr(profiling, "gpu_peak_vram_mb", 0.0), 2),
        "reserved_vram_mb": _r(getattr(profiling, "gpu_reserved_vram_mb", 0.0), 2),
    }
