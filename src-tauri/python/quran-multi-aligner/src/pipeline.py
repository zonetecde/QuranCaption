"""
Pipeline processing functions — GPU-decorated VAD/ASR + post-VAD alignment pipeline.
"""
import json
import time
import torch
import numpy as np
import librosa
import gradio as gr

from config import (
    get_vad_duration, get_asr_duration, ZEROGPU_MAX_DURATION,
    ANCHOR_SEGMENTS, PHONEME_ALIGNMENT_PROFILING,
    SEGMENT_AUDIO_DIR, RESAMPLE_TYPE,
)
from src.core.zero_gpu import gpu_with_fallback


def _reset_worker_dispatch_tls():
    """Clear stale per-request dispatch stats and start a fresh DebugCollector.

    Called at every pipeline entry so v3 log rows always carry populated
    `events` / `anchor` / per-segment `dp_debug` — not only `/debug_process`
    runs. A previous collector on the thread is replaced (stale state dropped).
    """
    try:
        from src.core.worker_pool import clear_last_dispatch_info
        clear_last_dispatch_info()
    except Exception:
        pass
    try:
        from src.core.zero_gpu import clear_cpu_stats
        clear_cpu_stats()
    except Exception:
        pass
    if hasattr(_LEASE_STATS_TLS, "info"):
        del _LEASE_STATS_TLS.info
    try:
        from src.core.debug_collector import start_debug_collection
        start_debug_collection()
    except Exception:
        pass


def _get_worker_dispatch_info():
    """Return the current thread's CPU-worker dispatch info, or None."""
    try:
        from src.core.worker_pool import get_last_dispatch_info
        return get_last_dispatch_info()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Thread-local lease stats — captured inside _combined_duration / _asr_only_duration
# so pipeline.py can log the requested lease size + whether the ZeroGPU cap
# bit the uncapped estimate. Read at log-build time.
# ---------------------------------------------------------------------------
import threading as _threading
_LEASE_STATS_TLS = _threading.local()


def _get_lease_stats() -> dict | None:
    """Return this thread's last lease stats, or None."""
    return getattr(_LEASE_STATS_TLS, "info", None)
from src.segmenter.segmenter_model import load_segmenter, ensure_models_on_gpu
from src.segmenter.vad import detect_speech_segments
from src.segmenter.segmenter_aoti import test_vad_aoti_export
from src.alignment.alignment_pipeline import run_phoneme_matching
from src.core.segment_types import VadSegment, SegmentInfo, ProfilingData, segments_to_json
from src.ui.segments import (
    render_segments, get_segment_word_stats,
    is_end_of_verse,
    recompute_missing_words,
)

# ---------------------------------------------------------------------------
# Audio cache — avoids passing large numpy arrays through Gradio gr.State
# (Gradio deep-copies State values, which would double ~1GB+ audio memory)
# ---------------------------------------------------------------------------
import uuid as _uuid

_AUDIO_STORE: dict[str, tuple] = {}   # key → (audio_array, sample_rate)

def _store_audio(audio: np.ndarray, sample_rate: int) -> str:
    """Cache audio in-process, return a lightweight reference key."""
    key = _uuid.uuid4().hex
    _AUDIO_STORE[key] = (audio, sample_rate)
    return key

def _load_audio(ref) -> tuple:
    """Retrieve (audio, sample_rate) from a cache key or pass-through arrays."""
    if isinstance(ref, str):
        entry = _AUDIO_STORE.get(ref)
        if entry is not None:
            return entry
        raise ValueError(f"Audio cache miss: {ref}")
    # Backward compat: raw numpy array (shouldn't happen in normal flow)
    return (ref, None)

def _audio_duration_from_ref(ref, fallback_sr=16000) -> float | None:
    """Get audio duration in seconds from a cache key."""
    if isinstance(ref, str):
        entry = _AUDIO_STORE.get(ref)
        if entry:
            audio, sr = entry
            return len(audio) / (sr or fallback_sr)
    elif ref is not None and hasattr(ref, '__len__'):
        return len(ref) / fallback_sr
    return None


_gpu_info_logged = False
_gpu_info_cache = {}

def _log_gpu_info():
    """Print GPU device info once per lease and cache for logging."""
    global _gpu_info_logged
    if _gpu_info_logged or not torch.cuda.is_available():
        return
    _gpu_info_logged = True
    props = torch.cuda.get_device_properties(0)
    _gpu_info_cache["name"] = props.name
    _gpu_info_cache["total_vram_gb"] = round(props.total_memory / (1024**3), 1)
    _gpu_info_cache["sms"] = props.multi_processor_count
    _gpu_info_cache["compute"] = f"{props.major}.{props.minor}"
    print(f"[GPU LEASE] {props.name} | "
          f"VRAM: {_gpu_info_cache['total_vram_gb']:.1f} GB | "
          f"SMs: {props.multi_processor_count} | "
          f"Compute: {props.major}.{props.minor}")


def _capture_vram_safely():
    """Read CUDA peak VRAM stats — returns (0.0, 0.0) when not on GPU.

    Defensive against the CPU-subprocess path where `torch.cuda.is_available()`
    can deceptively report True (because spaces' patches or stray
    CUDA_VISIBLE_DEVICES handling let the subprocess see the parent's GPU).
    Calling `max_memory_allocated()` in that situation can hang because the
    subprocess has no actual GPU lease — the C-level CUDA query waits forever
    on a context that will never be granted.
    """
    from src.core.zero_gpu import is_user_forced_cpu
    if is_user_forced_cpu() or not torch.cuda.is_available():
        return 0.0, 0.0
    try:
        peak_vram = torch.cuda.max_memory_allocated() / (1024 * 1024)
        reserved_vram = torch.cuda.max_memory_reserved() / (1024 * 1024)
        torch.cuda.reset_peak_memory_stats()
        return peak_vram, reserved_vram
    except RuntimeError:
        return 0.0, 0.0


def _combined_duration(audio, sample_rate, *_args, **_kwargs):
    """Lease duration for VAD+ASR: sum of independent estimates, capped at ZeroGPU max."""
    minutes = len(audio) / sample_rate / 60
    model_name = _args[3] if len(_args) > 3 else _kwargs.get("model_name", "Base")
    uncapped = get_vad_duration(minutes) + get_asr_duration(minutes, model_name)
    capped = min(uncapped, ZEROGPU_MAX_DURATION)
    _LEASE_STATS_TLS.info = {
        "lease_type": "combined",
        "requested_s": round(capped, 3),
        "uncapped_s": round(uncapped, 3),
        "cap_hit": uncapped > ZEROGPU_MAX_DURATION,
        "cap_s": ZEROGPU_MAX_DURATION,
    }
    return capped

def _asr_only_duration(segment_audios, sample_rate, *_args, **_kwargs):
    """Lease duration for standalone ASR, capped at ZeroGPU max."""
    minutes = sum(len(s) for s in segment_audios) / sample_rate / 60
    model_name = _args[0] if _args else _kwargs.get("model_name", "Base")
    uncapped = get_asr_duration(minutes, model_name)
    capped = min(uncapped, ZEROGPU_MAX_DURATION)
    _LEASE_STATS_TLS.info = {
        "lease_type": "asr_only",
        "requested_s": round(capped, 3),
        "uncapped_s": round(uncapped, 3),
        "cap_hit": uncapped > ZEROGPU_MAX_DURATION,
        "cap_s": ZEROGPU_MAX_DURATION,
    }
    return capped


def _run_asr_core(segment_audios, sample_rate, model_name="Base"):
    """Core ASR logic: load, move to GPU, transcribe. No GPU decorator."""
    from src.alignment.phoneme_asr import load_phoneme_asr, transcribe_batch

    t_gpu_start = time.time()
    load_phoneme_asr(model_name)
    t_move = time.time()
    ensure_models_on_gpu(asr_model_name=model_name)
    gpu_move_time = time.time() - t_move
    print(f"[PHONEME ASR] GPU move: {gpu_move_time:.3f}s")
    results, batch_profiling, sorting_time, batch_build_time = transcribe_batch(segment_audios, sample_rate, model_name)
    gpu_time = time.time() - t_gpu_start
    return results, batch_profiling, sorting_time, batch_build_time, gpu_move_time, gpu_time


@gpu_with_fallback(duration=_combined_duration)
def run_vad_and_asr_gpu(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms, model_name="Base"):
    """Single GPU lease: VAD segmentation + Phoneme ASR."""
    _log_gpu_info()
    t_gpu_start = time.time()

    # --- VAD phase ---
    load_segmenter()
    vad_move_time = ensure_models_on_gpu()
    intervals, vad_profiling, raw_speech_intervals, raw_is_complete = detect_speech_segments(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms)
    vad_profiling["model_move_time"] = vad_move_time
    vad_gpu_time = time.time() - t_gpu_start

    if not intervals:
        return (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete,
                None, None, None, None, 0.0, 0.0, 0.0, 0.0)

    # --- ASR phase ---
    segment_audios = [audio[int(s * sample_rate):int(e * sample_rate)] for s, e in intervals]
    asr_results = _run_asr_core(segment_audios, sample_rate, model_name)

    peak_vram, reserved_vram = _capture_vram_safely()

    return (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete, *asr_results, peak_vram, reserved_vram)


@gpu_with_fallback(duration=_asr_only_duration)
def run_phoneme_asr_gpu(segment_audios, sample_rate, model_name="Base"):
    """Standalone ASR GPU lease (used by resegment/retranscribe paths)."""
    _log_gpu_info()
    asr_results = _run_asr_core(segment_audios, sample_rate, model_name)

    peak_vram, reserved_vram = _capture_vram_safely()

    return (*asr_results, peak_vram, reserved_vram)


@gpu_with_fallback(duration=lambda: 300)  # 5 min lease for compilation test
def test_aoti_compilation_gpu():
    """
    Test AoT compilation for VAD model on GPU.
    Called at startup to verify torch.export works.
    """
    load_segmenter()
    ensure_models_on_gpu()
    return test_vad_aoti_export()


def _split_fused_segments(segments, audio_int16, sample_rate):
    """Post-processing: split combined/fused segments into separate ones via MFA.

    Scans for:
    - Combined "Isti'adha+Basmala" specials → split into Isti'adha + Basmala
    - Fused Basmala+verse → split into Basmala + verse
    - Fused Isti'adha+verse → split into Isti'adha + verse

    Uses MFA word timestamps to find accurate split boundaries.
    On MFA failure: midpoint fallback for combined, keep-as-is for fused.

    Args:
        segments: List of SegmentInfo objects.
        audio_int16: Full recording as int16 numpy array.
        sample_rate: Audio sample rate.

    Returns:
        New list of SegmentInfo objects with splits applied.
    """
    from src.alignment.special_segments import SPECIAL_TEXT, ALL_SPECIAL_REFS

    _BASMALA_TEXT = SPECIAL_TEXT["Basmala"]
    _ISTIATHA_TEXT = SPECIAL_TEXT["Isti'adha"]
    _COMBINED_TEXT = _ISTIATHA_TEXT + " ۝ " + _BASMALA_TEXT

    # Number of words in each special
    _ISTIATHA_WORD_COUNT = len(_ISTIATHA_TEXT.split())  # 5
    _BASMALA_WORD_COUNT = len(_BASMALA_TEXT.split())     # 4

    # Identify segments that need splitting
    split_indices = []  # (idx, case, mfa_ref, split_info)
    for idx, seg in enumerate(segments):
        if seg.matched_ref == "Isti'adha+Basmala":
            # Combined special — always split
            split_indices.append((idx, "combined", "Isti'adha+Basmala", None))
        elif seg.matched_ref and seg.matched_ref not in ALL_SPECIAL_REFS and seg.matched_text:
            if seg.matched_text.startswith(_COMBINED_TEXT):
                # Fused Isti'adha+Basmala+verse
                split_indices.append((idx, "fused_combined", f"Isti'adha+Basmala+{seg.matched_ref}", seg.matched_ref))
            elif seg.matched_text.startswith(_ISTIATHA_TEXT):
                # Fused Isti'adha+verse
                split_indices.append((idx, "fused_istiatha", f"Isti'adha+{seg.matched_ref}", seg.matched_ref))
            elif seg.matched_text.startswith(_BASMALA_TEXT):
                # Fused Basmala+verse
                split_indices.append((idx, "fused_basmala", f"Basmala+{seg.matched_ref}", seg.matched_ref))

    if not split_indices:
        return segments

    print(f"[MFA_SPLIT] {len(split_indices)} segments to split: "
          f"{[(i, c) for i, c, _, _ in split_indices]}")

    # Extract audio for each segment and call MFA in batch
    mfa_audios = []
    mfa_refs = []
    for idx, case, mfa_ref, _ in split_indices:
        seg = segments[idx]
        start_sample = int(seg.start_time * sample_rate)
        end_sample = int(seg.end_time * sample_rate)
        mfa_audios.append(audio_int16[start_sample:end_sample])
        mfa_refs.append(mfa_ref)

    from src.mfa import mfa_split_timestamps
    mfa_results = mfa_split_timestamps(mfa_audios, sample_rate, mfa_refs)

    # Build new segment list with splits
    new_segments = []
    split_set = {idx for idx, _, _, _ in split_indices}
    split_map = {idx: (i, case, mfa_ref, verse_ref) for i, (idx, case, mfa_ref, verse_ref) in enumerate(split_indices)}

    for idx, seg in enumerate(segments):
        if idx not in split_set:
            new_segments.append(seg)
            continue

        batch_i, case, mfa_ref, verse_ref = split_map[idx]
        words = mfa_results[batch_i]

        if words is None:
            # MFA failed — fallback
            if case == "combined":
                # Midpoint fallback for combined
                mid_time = (seg.start_time + seg.end_time) / 2.0
                new_segments.append(SegmentInfo(
                    start_time=seg.start_time, end_time=mid_time,
                    transcribed_text="", matched_text=_ISTIATHA_TEXT,
                    matched_ref="Isti'adha", match_score=seg.match_score,
                ))
                new_segments.append(SegmentInfo(
                    start_time=mid_time, end_time=seg.end_time,
                    transcribed_text="", matched_text=_BASMALA_TEXT,
                    matched_ref="Basmala", match_score=seg.match_score,
                ))
                print(f"[MFA_SPLIT] Segment {idx}: combined fallback to midpoint split")
            else:
                # Keep fused as-is when MFA fails
                new_segments.append(seg)
                print(f"[MFA_SPLIT] Segment {idx}: fused fallback, keeping as-is")
            continue

        # Find split boundaries from MFA word timestamps
        seg_start = seg.start_time

        if case == "combined":
            # Split after Isti'adha words (0:0:1..0:0:5), Basmala starts at 0:0:6
            istiatha_end = None
            for w in words:
                loc = w.get("location", "")
                if loc == f"0:0:{_ISTIATHA_WORD_COUNT}":
                    istiatha_end = seg_start + w["end"]
                    break
            if istiatha_end is None:
                # Fallback: midpoint
                istiatha_end = (seg.start_time + seg.end_time) / 2.0

            new_segments.append(SegmentInfo(
                start_time=seg.start_time, end_time=istiatha_end,
                transcribed_text="", matched_text=_ISTIATHA_TEXT,
                matched_ref="Isti'adha", match_score=seg.match_score,
            ))
            new_segments.append(SegmentInfo(
                start_time=istiatha_end, end_time=seg.end_time,
                transcribed_text="", matched_text=_BASMALA_TEXT,
                matched_ref="Basmala", match_score=seg.match_score,
            ))
            print(f"[MFA_SPLIT] Segment {idx}: combined split at {istiatha_end:.3f}s")

        elif case == "fused_combined":
            # Isti'adha (0:0:1..5) + Basmala (0:0:6..9) + verse
            istiatha_end = None
            basmala_end = None
            basmala_last_loc = f"0:0:{_ISTIATHA_WORD_COUNT + _BASMALA_WORD_COUNT}"
            for w in words:
                loc = w.get("location", "")
                if loc == f"0:0:{_ISTIATHA_WORD_COUNT}":
                    istiatha_end = seg_start + w["end"]
                if loc == basmala_last_loc:
                    basmala_end = seg_start + w["end"]
            if istiatha_end is None:
                istiatha_end = seg.start_time + (seg.end_time - seg.start_time) / 3.0
            if basmala_end is None:
                basmala_end = seg.start_time + 2 * (seg.end_time - seg.start_time) / 3.0

            # Strip prefix text from matched_text to get verse text
            verse_text = seg.matched_text
            if verse_text.startswith(_COMBINED_TEXT):
                verse_text = verse_text[len(_COMBINED_TEXT):].lstrip()

            new_segments.append(SegmentInfo(
                start_time=seg.start_time, end_time=istiatha_end,
                transcribed_text="", matched_text=_ISTIATHA_TEXT,
                matched_ref="Isti'adha", match_score=seg.match_score,
            ))
            new_segments.append(SegmentInfo(
                start_time=istiatha_end, end_time=basmala_end,
                transcribed_text="", matched_text=_BASMALA_TEXT,
                matched_ref="Basmala", match_score=seg.match_score,
            ))
            new_segments.append(SegmentInfo(
                start_time=basmala_end, end_time=seg.end_time,
                transcribed_text=seg.transcribed_text, matched_text=verse_text,
                matched_ref=verse_ref, match_score=seg.match_score,
                error=seg.error, has_missing_words=seg.has_missing_words,
                _original_alignment_idx=seg._original_alignment_idx,
            ))
            print(f"[MFA_SPLIT] Segment {idx}: fused_combined split at "
                  f"{istiatha_end:.3f}s / {basmala_end:.3f}s")

        elif case == "fused_istiatha":
            # Isti'adha (0:0:1..5) + verse
            istiatha_end = None
            for w in words:
                loc = w.get("location", "")
                if loc == f"0:0:{_ISTIATHA_WORD_COUNT}":
                    istiatha_end = seg_start + w["end"]
                    break
            if istiatha_end is None:
                # Keep as-is if we can't find the boundary
                new_segments.append(seg)
                print(f"[MFA_SPLIT] Segment {idx}: fused_istiatha boundary not found, keeping as-is")
                continue

            verse_text = seg.matched_text
            if verse_text.startswith(_ISTIATHA_TEXT):
                verse_text = verse_text[len(_ISTIATHA_TEXT):].lstrip()

            new_segments.append(SegmentInfo(
                start_time=seg.start_time, end_time=istiatha_end,
                transcribed_text="", matched_text=_ISTIATHA_TEXT,
                matched_ref="Isti'adha", match_score=seg.match_score,
            ))
            new_segments.append(SegmentInfo(
                start_time=istiatha_end, end_time=seg.end_time,
                transcribed_text=seg.transcribed_text, matched_text=verse_text,
                matched_ref=verse_ref, match_score=seg.match_score,
                error=seg.error, has_missing_words=seg.has_missing_words,
                _original_alignment_idx=seg._original_alignment_idx,
            ))
            print(f"[MFA_SPLIT] Segment {idx}: fused_istiatha split at {istiatha_end:.3f}s")

        elif case == "fused_basmala":
            # Basmala (0:0:1..4) + verse
            basmala_end = None
            for w in words:
                loc = w.get("location", "")
                if loc == f"0:0:{_BASMALA_WORD_COUNT}":
                    basmala_end = seg_start + w["end"]
                    break
            if basmala_end is None:
                new_segments.append(seg)
                print(f"[MFA_SPLIT] Segment {idx}: fused_basmala boundary not found, keeping as-is")
                continue

            verse_text = seg.matched_text
            if verse_text.startswith(_BASMALA_TEXT):
                verse_text = verse_text[len(_BASMALA_TEXT):].lstrip()

            new_segments.append(SegmentInfo(
                start_time=seg.start_time, end_time=basmala_end,
                transcribed_text="", matched_text=_BASMALA_TEXT,
                matched_ref="Basmala", match_score=seg.match_score,
            ))
            new_segments.append(SegmentInfo(
                start_time=basmala_end, end_time=seg.end_time,
                transcribed_text=seg.transcribed_text, matched_text=verse_text,
                matched_ref=verse_ref, match_score=seg.match_score,
                error=seg.error, has_missing_words=seg.has_missing_words,
                _original_alignment_idx=seg._original_alignment_idx,
            ))
            print(f"[MFA_SPLIT] Segment {idx}: fused_basmala split at {basmala_end:.3f}s")

    print(f"[MFA_SPLIT] {len(segments)} segments → {len(new_segments)} segments")
    return new_segments


def _compute_pad_waste(profiling):
    """Average pad_waste across all ASR batches."""
    batches = profiling.asr_batch_profiling
    if not batches:
        return 0.0
    return sum(b.get("pad_waste", 0.0) for b in batches) / len(batches)


def _run_post_vad_pipeline(
    audio, sample_rate, intervals,
    model_name, device, profiling, pipeline_start,
    precomputed_asr=None,
    min_silence_ms=0, min_speech_ms=0, pad_ms=0,
    request=None, log_row=None,
    is_preset=False,
    endpoint="ui",
    estimated_wall_s=None,
    estimate_formula_s=None,
    url_source=None,
):
    """Shared pipeline after VAD: ASR → specials → anchor → matching → results.

    Args:
        audio: Preprocessed float32 mono 16kHz audio array
        sample_rate: Sample rate (16000)
        intervals: List of (start, end) tuples from VAD cleaning
        model_name: ASR model name ("Base" or "Large")
        device: Device string ("gpu" or "cpu")
        profiling: ProfilingData instance to populate
        pipeline_start: time.time() when pipeline started
        precomputed_asr: Optional tuple of (results, batch_profiling, sorting_time,
            batch_build_time, gpu_move_time, gpu_time) from a combined GPU lease.
            If provided, skips the standalone ASR GPU call.

    Returns:
        (html, json_output, segment_dir) tuple
    """
    import time

    if not intervals:
        empty = {"segments": []} if not endpoint.startswith("ui") else []
        return "<div>No speech segments detected in audio</div>", empty, None, None

    # Build VAD segments and extract audio arrays
    vad_segments = []
    segment_audios = []
    for idx, (start, end) in enumerate(intervals):
        vad_segments.append(VadSegment(start_time=start, end_time=end, segment_idx=idx))
        start_sample = int(start * sample_rate)
        end_sample = int(end * sample_rate)
        segment_audios.append(audio[start_sample:end_sample])

    print(f"[VAD] {len(vad_segments)} segments")

    # Store VAD intervals on debug collector if active
    from src.core.debug_collector import get_debug_collector as _get_dc
    _dc = _get_dc()
    if _dc is not None:
        _dc.vad = {
            "cleaned_interval_count": len(intervals),
            "cleaned_intervals": [[round(s, 4), round(e, 4)] for s, e in intervals],
            "params": {
                "min_silence_ms": int(min_silence_ms),
                "min_speech_ms": int(min_speech_ms),
                "pad_ms": int(pad_ms),
            },
        }

    if precomputed_asr is not None:
        # ASR already ran within the combined GPU lease
        phoneme_texts, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time = precomputed_asr
        print(f"[PHONEME ASR] {len(phoneme_texts)} results (precomputed, gpu {asr_gpu_time:.2f}s)")
    else:
        # Standalone ASR GPU lease (resegment/retranscribe paths)
        print(f"[STAGE] Running ASR...")
        from src.core.usage_logger import set_stage as _set_stage
        _set_stage("asr")

        phoneme_asr_start = time.time()
        phoneme_texts, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time, peak_vram, reserved_vram = run_phoneme_asr_gpu(segment_audios, sample_rate, model_name)
        phoneme_asr_time = time.time() - phoneme_asr_start
        profiling.asr_time = phoneme_asr_time
        profiling.asr_gpu_time = asr_gpu_time
        profiling.asr_model_move_time = asr_gpu_move_time
        profiling.asr_sorting_time = asr_sorting_time
        profiling.asr_batch_build_time = asr_batch_build_time
        profiling.asr_batch_profiling = asr_batch_profiling
        profiling.gpu_peak_vram_mb = peak_vram
        profiling.gpu_reserved_vram_mb = reserved_vram
        print(f"[PHONEME ASR] {len(phoneme_texts)} results in {phoneme_asr_time:.2f}s (gpu {asr_gpu_time:.2f}s)")

    if asr_batch_profiling:
        for b in asr_batch_profiling:
            print(f"  Batch {b['batch_num']:>2}: {b['size']:>3} segs | "
                  f"{b['time']:.3f}s | "
                  f"{b['min_dur']:.2f}-{b['max_dur']:.2f}s "
                  f"(A {b['total_seconds']/b['size']:.2f}s, T {b['total_seconds']:.1f}s, W {b['pad_waste']:.0%}, "
                  f"QK^T {b['qk_mb_per_head']:.1f} MB/head, {b['qk_mb_all_heads']:.0f} MB total)")

    # Store ASR results on debug collector if active
    _dc = _get_dc()
    if _dc is not None:
        _dc.asr = {
            "model_name": model_name,
            "num_segments": len(phoneme_texts),
            "per_segment_phonemes": [
                {"segment_idx": i, "phonemes": ph}
                for i, ph in enumerate(phoneme_texts)
            ],
        }

    # Phoneme-based special segment detection
    print(f"[STAGE] Detecting special segments...")
    from src.alignment.special_segments import detect_special_segments
    vad_segments, segment_audios, special_results, first_quran_idx = detect_special_segments(
        phoneme_texts, vad_segments, segment_audios
    )

    # Anchor detection via phoneme n-gram voting
    print(f"[STAGE] Anchor detection...")
    from src.core.usage_logger import set_stage as _set_stage_anchor
    _set_stage_anchor("anchor")
    anchor_start = time.time()
    from src.alignment.phoneme_anchor import find_anchor_by_voting, verse_to_word_index
    from src.alignment.ngram_index import get_ngram_index
    from src.alignment.phoneme_matcher_cache import get_chapter_reference

    surah, ayah = find_anchor_by_voting(
        phoneme_texts[first_quran_idx:],
        get_ngram_index(),
        ANCHOR_SEGMENTS,
    )

    if surah == 0:
        raise ValueError("Could not anchor to any chapter - no n-gram matches found")

    profiling.anchor_time = time.time() - anchor_start
    print(f"[ANCHOR] Anchored to Surah {surah}, Ayah {ayah}")

    # Store anchor result on debug collector
    _dc = _get_dc()
    if _dc is not None:
        _dc.anchor["start_pointer"] = verse_to_word_index(
            get_chapter_reference(surah), ayah)

    # Build chapter reference and set pointer
    chapter_ref = get_chapter_reference(surah)
    pointer = verse_to_word_index(chapter_ref, ayah)

    print(f"[STAGE] Text Matching...")
    from src.core.usage_logger import set_stage as _set_stage_dp
    _set_stage_dp("dp")

    # Phoneme-based DP alignment
    match_start = time.time()
    match_results, match_profiling, gap_segments, merged_into, repetition_segments = run_phoneme_matching(
        phoneme_texts,
        surah,
        first_quran_idx,
        special_results,
        start_pointer=pointer,
    )
    match_time = time.time() - match_start
    profiling.match_wall_time = match_time
    print(f"[MATCH] {len(match_results)} phoneme alignments in {match_time:.2f}s")

    # Populate phoneme alignment profiling (if enabled)
    if PHONEME_ALIGNMENT_PROFILING:
        profiling.phoneme_total_time = match_profiling.get("total_time", 0.0)
        profiling.phoneme_ref_build_time = match_profiling.get("ref_build_time", 0.0)
        profiling.phoneme_dp_total_time = match_profiling.get("dp_total_time", 0.0)
        profiling.phoneme_dp_min_time = match_profiling.get("dp_min_time", 0.0)
        profiling.phoneme_dp_max_time = match_profiling.get("dp_max_time", 0.0)
        profiling.phoneme_window_setup_time = match_profiling.get("window_setup_time", 0.0)
        profiling.phoneme_result_build_time = match_profiling.get("result_build_time", 0.0)
        profiling.phoneme_num_segments = match_profiling.get("num_segments", 0)

    # Retry / reanchor counters (always available)
    profiling.retry_attempts = match_profiling.get("retry_attempts", 0)
    profiling.retry_passed = match_profiling.get("retry_passed", 0)
    profiling.retry_segments = match_profiling.get("retry_segments", [])
    profiling.consec_reanchors = match_profiling.get("consec_reanchors", 0)
    profiling.special_merges = match_profiling.get("special_merges", 0)
    profiling.transition_skips = match_profiling.get("transition_skips", 0)
    profiling.segments_attempted = match_profiling.get("segments_attempted", 0)
    profiling.segments_passed = match_profiling.get("segments_passed", 0)
    profiling.phoneme_wraps_detected = match_profiling.get("phoneme_wraps_detected", 0)

    print(f"[STAGE] Building results...")

    # Build SegmentInfo list
    segments = []
    result_build_start = time.time()

    # Convert full audio to int16 once
    t_wav = time.time()
    audio_int16 = np.clip(audio * 32767, -32768, 32767).astype(np.int16)
    audio_encode_time = time.time() - t_wav

    # Create a per-request directory for segment WAV files
    import uuid
    segment_dir = SEGMENT_AUDIO_DIR / uuid.uuid4().hex
    segment_dir.mkdir(parents=True, exist_ok=True)

    last_display_idx = len(vad_segments) - 1

    # Pre-compute merged end times: extend target segment's end_time
    _merged_end_times = {}  # {target_idx: extended_end_time}
    for consumed_idx, target_idx in merged_into.items():
        if consumed_idx < len(vad_segments):
            _merged_end_times[target_idx] = vad_segments[consumed_idx].end_time

    for idx, (seg, result_tuple) in enumerate(
        zip(vad_segments, match_results)
    ):
        # Unpack result tuple (4 elements for alignment results, 3 for legacy specials)
        matched_text, score, matched_ref = result_tuple[0], result_tuple[1], result_tuple[2]
        wrap_ranges = result_tuple[3] if len(result_tuple) > 3 else None

        # Skip segments consumed by Tahmeed merge
        if idx in merged_into:
            continue

        if idx == last_display_idx and matched_ref:
            if not is_end_of_verse(matched_ref):
                score = max(0.0, score - 0.25)

        error = None
        phoneme_text = " ".join(phoneme_texts[idx]) if idx < len(phoneme_texts) else ""

        if score <= 0.0:
            matched_text = ""
            matched_ref = ""
            error = f"Low confidence ({score:.0%})"

        # Extend end_time if this segment absorbed a merged segment
        seg_end_time = _merged_end_times.get(idx, seg.end_time)

        # Compute reading sequence for repeated segments
        rep_ranges = None
        rep_text = None
        if wrap_ranges and matched_ref and "-" in matched_ref:
            from src.core.segment_types import compute_reading_sequence
            from src.core.quran_index import get_quran_index
            ref_from, ref_to = matched_ref.split("-", 1)
            rep_ranges = compute_reading_sequence(ref_from, ref_to, wrap_ranges)
            qi = get_quran_index()
            rep_text = []
            for sec_from, sec_to in rep_ranges:
                sec_ref = f"{sec_from}-{sec_to}"
                indices = qi.ref_to_indices(sec_ref)
                if indices:
                    s_i, e_i = indices
                    rep_text.append(" ".join(
                        w.display_text for w in qi.words[s_i:e_i + 1]
                    ))
                else:
                    rep_text.append("")

        segments.append(SegmentInfo(
            start_time=seg.start_time,
            end_time=seg_end_time,
            transcribed_text=phoneme_text,
            matched_text=matched_text,
            matched_ref=matched_ref,
            match_score=score,
            error=error,
            has_missing_words=idx in gap_segments,
            has_repeated_words=idx in repetition_segments,
            wrap_word_ranges=wrap_ranges,
            repeated_ranges=rep_ranges,
            repeated_text=rep_text,
            # alignment_pipeline keys DebugCollector entries by 1-indexed absolute
            # VAD position (first_quran_idx + i + 1 ≡ vad_idx + 1). Match that here
            # so build_segments can look up dp_debug by _original_alignment_idx.
            _original_alignment_idx=idx + 1,
        ))

    # Post-processing: split combined/fused segments via MFA timestamps
    segments = _split_fused_segments(segments, audio_int16, sample_rate)
    del audio_int16  # Free ~576MB — no longer needed (full.wav written from float32)

    # Recompute stats from final segments list (after splits may have changed it)
    _seg_word_counts = []
    _seg_durations = []
    _seg_phoneme_counts = []
    _seg_ayah_spans = []
    for i, seg in enumerate(segments):
        word_count, ayah_span = get_segment_word_stats(seg.matched_ref)
        duration = seg.end_time - seg.start_time
        _seg_word_counts.append(word_count)
        _seg_durations.append(duration)
        _seg_phoneme_counts.append(0)  # phoneme counts not available after split
        _seg_ayah_spans.append(ayah_span)

    profiling.segments_attempted = len(segments)
    profiling.segments_passed = sum(1 for s in segments if s.match_score > 0.0)

    result_build_total_time = time.time() - result_build_start
    profiling.result_build_time = result_build_total_time
    profiling.result_audio_encode_time = audio_encode_time

    # Print profiling summary
    profiling.total_time = time.time() - pipeline_start
    print(profiling.summary())

    # Store profiling on debug collector if active
    from src.core.debug_collector import get_debug_collector as _get_dc
    _dc = _get_dc()
    if _dc is not None:
        _dc._profiling = profiling

    # Segment distribution stats
    matched_words = [w for w in _seg_word_counts if w > 0]
    matched_durs = [d for i, d in enumerate(_seg_durations) if _seg_word_counts[i] > 0]
    matched_phonemes = [p for i, p in enumerate(_seg_phoneme_counts) if _seg_word_counts[i] > 0]
    pauses = [vad_segments[i + 1].start_time - vad_segments[i].end_time
              for i in range(len(vad_segments) - 1)]
    pauses = [p for p in pauses if p > 0]
    if matched_words:
        def _std(vals):
            n = len(vals)
            if n < 2:
                return 0.0
            mean = sum(vals) / n
            return (sum((v - mean) ** 2 for v in vals) / n) ** 0.5

        avg_w = sum(matched_words) / len(matched_words)
        std_w = _std(matched_words)
        min_w, max_w = min(matched_words), max(matched_words)
        avg_d = sum(matched_durs) / len(matched_durs)
        std_d = _std(matched_durs)
        min_d, max_d = min(matched_durs), max(matched_durs)
        total_speech_sec = sum(matched_durs)
        total_words = sum(matched_words)
        total_phonemes = sum(matched_phonemes)
        wpm = total_words / (total_speech_sec / 60) if total_speech_sec > 0 else 0
        pps = total_phonemes / total_speech_sec if total_speech_sec > 0 else 0
        print(f"\n[SEGMENT STATS] {len(segments)} total segments, {len(matched_words)} matched")
        print(f"  Words/segment : min={min_w}, max={max_w}, avg={avg_w:.1f}\u00b1{std_w:.1f}")
        print(f"  Duration (s)  : min={min_d:.1f}, max={max_d:.1f}, avg={avg_d:.1f}\u00b1{std_d:.1f}")
        if pauses:
            avg_p = sum(pauses) / len(pauses)
            std_p = _std(pauses)
            print(f"  Pause (s)     : min={min(pauses):.1f}, max={max(pauses):.1f}, avg={avg_p:.1f}\u00b1{std_p:.1f}")
        print(f"  Speech pace   : {wpm:.1f} words/min, {pps:.1f} phonemes/sec (speech time only)")
    from src.alignment.special_segments import ALL_SPECIAL_REFS

    # --- Usage logging (V3 schema) ---
    if is_preset:
        print("[USAGE_LOG] Skipped (preset audio)")
    else:
        try:
            from src.core.usage_logger import log_alignment
            from src.core.log_blocks import (
                build_settings, build_timing, build_asr_batches, build_segments,
                build_events, build_anchor, build_results_summary,
                build_reciter_stats, build_gpu_memory,
            )
            from src.core.audio_analytics import (
                compute_audio_analytics, compute_noise_floor_rms,
            )
            from src.core.zero_gpu import get_cpu_stats
            from config import PHONEME_ASR_MODELS, USAGE_LOG_DISABLE_DP_DEBUG

            # Two-phase audio analytics:
            #   1) sync: noise_floor_rms only (~10-50ms) so per-segment SNR
            #      lands in the initial log row.
            #   2) bg thread (after response yielded): full `audio_analytics`
            #      dict (whole / speech / nonspeech Welch PSDs + reciter_stats
            #      additive fields), mutates the same log_row and re-syncs
            #      via `_sync_row_to_scheduler`. Keeps the long-clip 3-5s
            #      Welch-PSD cost off the user's wall-time path.
            try:
                _noise_floor_rms = compute_noise_floor_rms(
                    audio, sample_rate, intervals,
                )
            except Exception as _e:
                print(f"[USAGE_LOG] noise_floor_rms failed: {_e}")
                _noise_floor_rms = None

            # Reciter stats fallbacks when there are no matched segments
            _log_wpm   = wpm   if matched_words else 0.0
            _log_avg_d = avg_d if matched_words else 0.0
            _log_std_d = std_d if matched_words else 0.0
            _log_avg_p = avg_p if (matched_words and pauses) else 0.0
            _log_std_p = std_p if (matched_words and pauses) else 0.0
            _total_speech_s = sum(matched_durs) if matched_words else 0.0

            # Resolve model label → HF id for stable cross-version analysis
            _model_id    = PHONEME_ASR_MODELS.get(model_name, model_name)
            _model_label = model_name if model_name in PHONEME_ASR_MODELS else None

            # Count segments flagged has_missing_words after gap-analysis
            _missing_word_count = sum(1 for s in segments if s.has_missing_words)

            _timing_block = build_timing(
                profiling=profiling,
                cpu_stats=get_cpu_stats(),
                worker_dispatch=_get_worker_dispatch_info(),
                lease_stats=_get_lease_stats(),
                estimate_given_s=estimated_wall_s,
                estimate_formula_s=estimate_formula_s,
                device=device,
            )

            log_row = log_alignment(
                audio=audio,
                sample_rate=sample_rate,
                request=request,
                audio_duration_s=round(len(audio) / sample_rate, 3),
                endpoint=endpoint,
                settings=build_settings(
                    min_silence_ms, min_speech_ms, pad_ms,
                    asr_model_id=_model_id, asr_model_label=_model_label,
                    device=device,
                    url_source=url_source,
                ),
                timing=_timing_block,
                asr_batches=build_asr_batches(profiling),
                segments=build_segments(
                    segments, _dc,
                    _seg_word_counts, _seg_ayah_spans,
                    ALL_SPECIAL_REFS,
                    include_dp_debug=not USAGE_LOG_DISABLE_DP_DEBUG,
                    audio=audio, sample_rate=sample_rate,
                    noise_floor_rms=_noise_floor_rms,
                ),
                events=build_events(_dc),
                anchor=build_anchor(_dc),
                gpu_memory=build_gpu_memory(profiling, device),
                results_summary=build_results_summary(
                    segments=segments, profiling=profiling,
                    total_speech_s=_total_speech_s,
                    missing_word_count=_missing_word_count,
                ),
                reciter_stats=build_reciter_stats(
                    wpm=_log_wpm,
                    avg_seg_dur=_log_avg_d, std_seg_dur=_log_std_d,
                    avg_pause_dur=_log_avg_p, std_pause_dur=_log_std_p,
                    audio=audio,
                    audio_analytics=None,  # additive fields patched by bg thread below
                ),
                audio_analytics=None,
                _async=True,
            )

            # Bg: compute full analytics, mutate row, re-sync scheduler.
            # Holds a ref to `audio` (~180MB for 48-min clip) until done.
            if log_row is not None:
                def _fill_analytics_bg(
                    _audio=audio, _sr=sample_rate, _intervals=intervals,
                    _row=log_row,
                ):
                    try:
                        aa = compute_audio_analytics(_audio, _sr, _intervals)
                    except Exception as _e:
                        print(f"[USAGE_LOG] audio_analytics failed (bg): {_e}")
                        return
                    if not aa:
                        return
                    try:
                        whole = aa.get("whole") or {}
                        import json as _json
                        rs = _json.loads(_row.get("reciter_stats") or "{}")
                        rs["audio_dc_offset"]    = whole.get("dc_offset")
                        rs["audio_p99"]          = whole.get("p99")
                        rs["audio_p01"]          = whole.get("p01")
                        rs["audio_crest"]        = whole.get("crest")
                        rs["audio_dyn_range_db"] = whole.get("dyn_range_db")
                        _row["reciter_stats"]   = _json.dumps(rs)
                        _row["audio_analytics"] = _json.dumps(aa)
                        from src.core.usage_logger import _sync_row_to_scheduler
                        _sync_row_to_scheduler(_row)
                    except Exception as _e:
                        print(f"[USAGE_LOG] audio_analytics bg-sync failed: {_e}")

                import threading
                threading.Thread(
                    target=_fill_analytics_bg,
                    name="audio_analytics_bg",
                    daemon=True,
                ).start()
        except Exception as e:
            print(f"[USAGE_LOG] Failed: {e}")

    # API callers get a JSON dict; UI callers get the SegmentInfo list directly
    if not endpoint.startswith("ui"):
        json_output = segments_to_json(segments)
        return "", json_output, str(segment_dir), log_row

    # UI path: stamp segment_number and pass SegmentInfo list through as json_output
    for i, seg in enumerate(segments):
        seg.segment_number = i + 1
    json_output = segments  # List[SegmentInfo] — Gradio gr.State is type-agnostic

    # Compute full audio URL (file written in background after render)
    full_path = segment_dir / "full.wav"
    full_audio_url = f"/gradio_api/file={full_path}"

    # Diagnostics before render
    import os as _os
    _rss = -1
    try:
        with open('/proc/self/status') as _f:
            for _line in _f:
                if _line.startswith('VmRSS:'):
                    _rss = int(_line.split()[1]) / 1024
                    break
    except Exception:
        pass
    print(f"[DIAG] Before render_segments: RSS={_rss:.0f}MB, segments={len(segments)}")

    t_render = time.time()
    html = render_segments(segments, full_audio_url=full_audio_url, segment_dir=str(segment_dir))
    print(f"[PROFILE] render_segments: {time.time() - t_render:.3f}s ({len(segments)} segments, HTML={len(html)/1e6:.2f}MB)")

    # Write full.wav + per-segment WAVs in background thread
    # sf.write converts float32→PCM16 internally (no extra int16 copy in memory)
    # Files ready before user can click play (browser still rendering cards)
    import threading
    import soundfile as sf
    _audio_ref = audio  # prevent GC while thread runs
    _sr_ref = sample_rate
    _path_ref = str(full_path)
    _seg_dir_ref = str(segment_dir)
    _segments_ref = segments
    def _write_audio_files():
        import os
        # Diagnostics: memory + disk before write
        rss_mb = -1
        try:
            with open('/proc/self/status') as f:
                for line in f:
                    if line.startswith('VmRSS:'):
                        rss_mb = int(line.split()[1]) / 1024  # kB → MB
                        break
        except Exception:
            pass
        try:
            disk = os.statvfs('/tmp')
            free_mb = disk.f_bavail * disk.f_frsize / 1e6
        except Exception:
            free_mb = -1
        expected_mb = len(_audio_ref) * 2 / 1e6  # int16 = 2 bytes/sample
        print(f"[DIAG] Before full.wav write: RSS={rss_mb:.0f}MB, /tmp free={free_mb:.0f}MB, expected file={expected_mb:.0f}MB")
        t = time.time()
        try:
            sf.write(_path_ref, _audio_ref, _sr_ref, format='WAV', subtype='PCM_16')
            print(f"[PROFILE] Full audio write (bg): {time.time() - t:.3f}s ({expected_mb:.0f}MB)")
        except Exception as e:
            print(f"[ERROR] Full audio write failed: {e}")
            return  # Can't write per-segment files without full.wav succeeding
        # Per-segment WAVs (slices from float32 array, converted to PCM16 by soundfile)
        t_segs = time.time()
        try:
            for i, seg in enumerate(_segments_ref):
                start = int(seg.start_time * _sr_ref)
                end = int(seg.end_time * _sr_ref)
                sf.write(os.path.join(_seg_dir_ref, f"seg_{i}.wav"),
                         _audio_ref[start:end], _sr_ref, format='WAV', subtype='PCM_16')
            print(f"[PROFILE] Per-segment WAVs (bg): {time.time() - t_segs:.3f}s ({len(_segments_ref)} files)")
        except Exception as e:
            print(f"[ERROR] Per-segment WAV write failed: {e}")
    threading.Thread(target=_write_audio_files, daemon=True).start()

    print("[STAGE] Done!")

    return html, json_output, str(segment_dir), log_row


def _with_cancel_watch(fn):
    """Decorator: wraps a pipeline entry function so a client disconnect on
    its `request` kwarg propagates down into the CPU worker dispatcher.
    """
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        from src.core.cancel_ctx import watch_disconnect
        with watch_disconnect(kwargs.get("request")):
            return fn(*args, **kwargs)
    return wrapper


@_with_cancel_watch
def process_audio(
    audio_data,
    min_silence_ms,
    min_speech_ms,
    pad_ms,
    model_name="Base",
    device="GPU",
    is_preset=False,
    request: gr.Request = None,
    endpoint="ui",
    estimated_wall_s=None,
    estimate_formula_s=None,
    url_source=None,
):
    """Process uploaded audio and extract segments with automatic verse detection.

    Args:
        audio_data: File path string (from gr.Audio type="filepath") or
                    (sample_rate, numpy_array) tuple (from API's type="numpy").

    Returns:
        (html, json_output, raw_speech_intervals, raw_is_complete, preprocessed_audio, sample_rate, intervals, segment_dir, log_row)
    """
    import time

    _reset_worker_dispatch_tls()

    if audio_data is None:
        return "<div>Please upload an audio file</div>", None, None, None, None, None, None, None, None

    # Normalize device label to lowercase for downstream checks
    device = device.lower()

    # Reset per-request so each request retries GPU fresh
    from src.core.zero_gpu import reset_quota_flag, force_cpu_mode
    reset_quota_flag()

    if device == "cpu":
        force_cpu_mode()

    print(f"\n{'='*60}")
    print(f"Processing audio with automatic verse detection")
    print(f"Settings: silence={min_silence_ms}ms, speech={min_speech_ms}ms, pad={pad_ms}ms, device={device}")
    print(f"{'='*60}")

    # Initialize profiling data
    profiling = ProfilingData()
    pipeline_start = time.time()

    if isinstance(audio_data, str):
        # File path from gr.Audio(type="filepath")
        load_start = time.time()
        audio, sample_rate = librosa.load(audio_data, sr=16000, mono=True, res_type=RESAMPLE_TYPE)
        profiling.resample_time = time.time() - load_start
        print(f"[PROFILE] Audio loaded and resampled to 16kHz in {profiling.resample_time:.3f}s "
              f"(duration: {len(audio)/16000:.1f}s, res_type={RESAMPLE_TYPE})")
    else:
        # (sample_rate, numpy_array) tuple from gr.Audio(type="numpy") — API path
        sample_rate, audio = audio_data

        # Convert to float32
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype == np.int32:
            audio = audio.astype(np.float32) / 2147483648.0

        # Convert stereo to mono
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Resample to 16kHz once (both VAD and ASR models require 16kHz)
        if sample_rate != 16000:
            resample_start = time.time()
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000, res_type=RESAMPLE_TYPE)
            profiling.resample_time = time.time() - resample_start
            print(f"[PROFILE] Resampling {sample_rate}Hz -> 16000Hz took {profiling.resample_time:.3f}s (audio length: {len(audio)/16000:.1f}s, res_type={RESAMPLE_TYPE})")
            sample_rate = 16000

    print("[STAGE] Running VAD + ASR...")
    from src.core.usage_logger import set_stage as _set_stage
    _set_stage("vad")

    # Single GPU lease: VAD + ASR
    gpu_start = time.time()
    (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete,
     asr_results, asr_batch_profiling, asr_sorting_time, asr_batch_build_time,
     asr_gpu_move_time, asr_gpu_time, peak_vram, reserved_vram) = run_vad_and_asr_gpu(
        audio, sample_rate, int(min_silence_ms), int(min_speech_ms), int(pad_ms), model_name
    )
    wall_time = time.time() - gpu_start
    profiling.gpu_peak_vram_mb = peak_vram
    profiling.gpu_reserved_vram_mb = reserved_vram

    # VAD profiling: queue wait is attributed to VAD (it happens before VAD runs)
    profiling.vad_model_load_time = vad_profiling.get("model_load_time", 0.0)
    profiling.vad_model_move_time = vad_profiling.get("model_move_time", 0.0)
    profiling.vad_inference_time = vad_profiling.get("inference_time", 0.0)
    profiling.vad_gpu_time = vad_gpu_time
    profiling.vad_wall_time = wall_time - asr_gpu_time
    print(f"[GPU] VAD completed in {profiling.vad_wall_time:.2f}s (gpu {vad_gpu_time:.2f}s)")

    # Store raw VAD intervals on debug collector if active
    from src.core.debug_collector import get_debug_collector as _get_dc_top
    _dc_top = _get_dc_top()
    if _dc_top is not None:
        import torch as _torch
        raw_intervals_list = raw_speech_intervals
        if _torch.is_tensor(raw_intervals_list):
            raw_intervals_list = raw_intervals_list.cpu().numpy().tolist()
        elif hasattr(raw_intervals_list, 'tolist'):
            raw_intervals_list = raw_intervals_list.tolist()
        _dc_top.vad["raw_interval_count"] = len(raw_intervals_list) if raw_intervals_list is not None else 0
        _dc_top.vad["raw_intervals"] = [[round(s, 4), round(e, 4)] for s, e in raw_intervals_list] if raw_intervals_list is not None else []

    if not intervals:
        return "<div>No speech segments detected in audio</div>", None, None, None, None, None, None, None, None

    # ASR profiling: no separate queue (ran within same lease)
    profiling.asr_time = asr_gpu_time
    profiling.asr_gpu_time = asr_gpu_time
    profiling.asr_model_move_time = asr_gpu_move_time
    profiling.asr_sorting_time = asr_sorting_time
    profiling.asr_batch_build_time = asr_batch_build_time
    profiling.asr_batch_profiling = asr_batch_profiling
    print(f"[GPU] ASR completed in {asr_gpu_time:.2f}s")

    # Run post-VAD pipeline (ASR already done, pass results)
    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        audio, sample_rate, intervals,
        model_name, device, profiling, pipeline_start,
        precomputed_asr=(asr_results, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time),
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request,
        is_preset=is_preset,
        endpoint=endpoint,
        estimated_wall_s=estimated_wall_s,
        estimate_formula_s=estimate_formula_s,
        url_source=url_source,
    )

    audio_ref = _store_audio(audio, sample_rate)
    return html, json_output, raw_speech_intervals, raw_is_complete, audio_ref, sample_rate, intervals, seg_dir, log_row


@_with_cancel_watch
def resegment_audio(
    cached_speech_intervals, cached_is_complete,
    cached_audio, cached_sample_rate,
    min_silence_ms, min_speech_ms, pad_ms,
    model_name="Base", device="GPU",
    cached_log_row=None,
    is_preset=False,
    request: gr.Request = None,
    endpoint="ui",
    estimated_wall_s=None,
    estimate_formula_s=None,
    url_source=None,
):
    """Re-run segmentation with different settings using cached VAD data.

    Skips the heavy VAD model inference — only re-cleans speech intervals
    and re-runs ASR + downstream pipeline.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, intervals, segment_dir, log_row)
    """
    import time

    _reset_worker_dispatch_tls()

    if cached_speech_intervals is None or cached_audio is None:
        return "<div>No cached data. Please run Extract Segments first.</div>", None, None, None, None, None, None, None, None

    # Resolve audio from cache key
    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    # Normalize device label
    device = device.lower()

    from src.core.zero_gpu import reset_quota_flag, force_cpu_mode
    reset_quota_flag()
    if device == "cpu":
        force_cpu_mode()

    print(f"\n{'='*60}")
    print(f"RESEGMENTING with different settings")
    print(f"Settings: silence={min_silence_ms}ms, speech={min_speech_ms}ms, pad={pad_ms}ms")
    print(f"{'='*60}")

    profiling = ProfilingData()
    pipeline_start = time.time()

    print("[STAGE] Resegmenting...")

    # Re-clean speech intervals with new parameters (CPU, no GPU needed)
    # Convert numpy→torch if needed (VAD returns numpy for picklability)
    import torch as _torch
    _intervals_tensor = (
        _torch.from_numpy(cached_speech_intervals)
        if isinstance(cached_speech_intervals, np.ndarray)
        else cached_speech_intervals
    )
    from recitations_segmenter import clean_speech_intervals
    clean_out = clean_speech_intervals(
        _intervals_tensor,
        cached_is_complete,
        min_silence_duration_ms=int(min_silence_ms),
        min_speech_duration_ms=int(min_speech_ms),
        pad_duration_ms=int(pad_ms),
        return_seconds=True,
    )

    intervals = clean_out.clean_speech_intervals.tolist()
    intervals = [(start, end) for start, end in intervals]

    raw_count = len(cached_speech_intervals)
    final_count = len(intervals)
    removed = raw_count - final_count
    print(f"[RESEGMENT] Raw intervals: {raw_count}, after cleaning: {final_count} "
          f"({removed} removed by silence merge + min_speech={min_speech_ms}ms filter)")

    if not intervals:
        return "<div>No speech segments detected with these settings</div>", None, cached_speech_intervals, cached_is_complete, cached_audio, sr, None, None, cached_log_row

    # Run post-VAD pipeline
    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        audio, sr, intervals,
        model_name, device, profiling, pipeline_start,
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request, log_row=cached_log_row,
        is_preset=is_preset,
        endpoint=endpoint,
        estimated_wall_s=estimated_wall_s,
        estimate_formula_s=estimate_formula_s,
        url_source=url_source,
    )

    # Pass through cached state unchanged (audio_ref key stays the same), but update intervals
    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, sr, intervals, seg_dir, log_row


@_with_cancel_watch
def retranscribe_audio(
    cached_intervals,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete,
    model_name,
    device="GPU",
    cached_log_row=None,
    is_preset=False,
    min_silence_ms=0, min_speech_ms=0, pad_ms=0,
    request: gr.Request = None,
    endpoint="ui",
    estimated_wall_s=None,
    estimate_formula_s=None,
    url_source=None,
):
    """Re-run ASR + downstream with a different model using cached intervals.

    Uses the same segment boundaries but a different ASR model.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete,
         cached_audio, cached_sample_rate, cached_intervals, segment_dir, log_row)
    """
    import time

    _reset_worker_dispatch_tls()

    if cached_intervals is None or cached_audio is None:
        return "<div>No cached data. Please run Extract Segments first.</div>", None, None, None, None, None, None, None, None

    # Resolve audio from cache key
    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    device = device.lower()

    from src.core.zero_gpu import reset_quota_flag, force_cpu_mode
    reset_quota_flag()
    if device == "cpu":
        force_cpu_mode()

    print(f"\n{'='*60}")
    print(f"RETRANSCRIBING with {model_name} model")
    print(f"{'='*60}")

    profiling = ProfilingData()
    pipeline_start = time.time()

    print(f"[STAGE] Retranscribing with {model_name} model...")

    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        audio, sr, cached_intervals,
        model_name, device, profiling, pipeline_start,
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request, log_row=cached_log_row,
        is_preset=is_preset,
        endpoint=endpoint,
        estimated_wall_s=estimated_wall_s,
        estimate_formula_s=estimate_formula_s,
        url_source=url_source,
    )

    # Pass through all cached state unchanged (audio_ref key stays the same)
    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, sr, cached_intervals, seg_dir, log_row


@_with_cancel_watch
def realign_audio(
    intervals,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete,
    model_name="Base", device="GPU",
    cached_log_row=None,
    request: gr.Request = None,
    endpoint="ui",
    estimated_wall_s=None,
    estimate_formula_s=None,
    url_source=None,
):
    """Run ASR + alignment on caller-provided intervals.

    Same as retranscribe_audio but uses externally-provided intervals
    instead of cached_intervals, bypassing VAD entirely.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete,
         cached_audio, cached_sample_rate, intervals, segment_dir, log_row)
    """
    import time

    _reset_worker_dispatch_tls()

    if cached_audio is None:
        return "<div>No cached data.</div>", None, None, None, None, None, None, None, None

    # Resolve audio from cache key
    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    device = device.lower()

    from src.core.zero_gpu import reset_quota_flag, force_cpu_mode
    reset_quota_flag()
    if device == "cpu":
        force_cpu_mode()

    print(f"\n{'='*60}")
    print(f"REALIGNING with {len(intervals)} custom timestamps, model={model_name}")
    print(f"{'='*60}")

    profiling = ProfilingData()
    pipeline_start = time.time()

    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        audio, sr, intervals,
        model_name, device, profiling, pipeline_start,
        request=request, log_row=cached_log_row,
        endpoint=endpoint,
        estimated_wall_s=estimated_wall_s,
        estimate_formula_s=estimate_formula_s,
        url_source=url_source,
    )

    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, sr, intervals, seg_dir, log_row


@_with_cancel_watch
def split_segments_audio(
    cached_segments,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete, cached_intervals,
    max_verses, max_words, max_duration,
    require_stop_sign=False,
    cached_log_row=None,
    cached_segment_dir=None,
    request: gr.Request = None,
    endpoint="ui",
):
    """Subdivide segments that violate max_verses / max_words / max_duration.

    Silent batched MFA call + word-boundary splits. Preserves VAD and ASR
    artifacts; only re-renders HTML and re-slices per-segment WAVs for
    segments that were actually split.

    Args:
        cached_segments: current List[SegmentInfo] (from c.output_json).
        max_verses, max_words, max_duration: ints (or floats for duration),
            or sentinels for disabled — SPLIT_MAX_VERSES_MAX, SPLIT_MAX_WORDS_MAX,
            and SPLIT_MAX_DURATION_MAX each disable their respective criterion.

    Returns:
        Same 9-tuple shape as resegment_audio / retranscribe_audio.
    """
    import os
    import time
    from config import (
        SPLIT_MAX_VERSES_MAX, SPLIT_MAX_WORDS_MAX, SPLIT_MAX_DURATION_MAX,
        MFA_SPLIT_PADDING, MFA_METHOD, MFA_BEAM, MFA_RETRY_BEAM, MFA_SHARED_CMVN,
    )
    from src.alignment.segment_splitter import split_segments as _split
    from src.mfa import mfa_split_timestamps

    if not cached_segments or cached_audio is None:
        return "<div>No cached data. Please run Extract Segments first.</div>", cached_segments, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, cached_intervals, cached_segment_dir, cached_log_row

    # Resolve audio from cache key (may be numpy float32 16kHz)
    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    # Coerce sentinel values → None (criterion disabled)
    try:
        mv = int(max_verses) if max_verses is not None else None
    except (TypeError, ValueError):
        mv = None
    try:
        mw = int(max_words) if max_words is not None else None
    except (TypeError, ValueError):
        mw = None
    try:
        md = float(max_duration) if max_duration is not None else None
    except (TypeError, ValueError):
        md = None
    if mv is not None and mv >= SPLIT_MAX_VERSES_MAX:
        mv = None
    if mw is not None and mw >= SPLIT_MAX_WORDS_MAX:
        mw = None
    if md is not None and md >= SPLIT_MAX_DURATION_MAX:
        md = None

    print(f"\n{'='*60}")
    print(f"SPLIT SEGMENTS — max_verses={mv if mv else 'Off'}, "
          f"max_words={mw if mw else 'Off'}, "
          f"max_duration={f'{md}s' if md else 'Off'}, "
          f"require_stop_sign={bool(require_stop_sign)}")
    print(f"{'='*60}")

    if mv is None and mw is None and md is None:
        # Nothing to do — return current state unchanged
        return _noop_split_return(cached_segments, cached_speech_intervals,
                                  cached_is_complete, cached_audio, sr,
                                  cached_intervals, cached_segment_dir,
                                  cached_log_row)

    # Build MFA caller closure. Called once per pass with (refs, ranges).
    # Slices per-segment audio (int16) from the parent float32 in-memory.
    def _mfa_caller(refs, ranges):
        audio_chunks = []
        for (t0, t1) in ranges:
            s = max(0, int(t0 * sr))
            e = min(len(audio), int(t1 * sr))
            chunk = audio[s:e]
            chunk_i16 = np.clip(chunk * 32767, -32768, 32767).astype(np.int16)
            audio_chunks.append(chunk_i16)
        try:
            return mfa_split_timestamps(
                audio_chunks, sr, refs,
                method=MFA_METHOD, beam=MFA_BEAM, retry_beam=MFA_RETRY_BEAM,
                shared_cmvn=MFA_SHARED_CMVN, padding=MFA_SPLIT_PADDING,
            )
        except Exception as exc:
            print(f"[SPLIT] MFA batch call failed: {exc}")
            return [None] * len(refs)

    # Run the pure splitter — returns (new_segments, report)
    t0 = time.time()
    new_segments, report = _split(cached_segments, mv, mw, _mfa_caller,
                                  max_duration=md,
                                  require_stop_sign=bool(require_stop_sign))
    print(f"[SPLIT] splitter: {time.time() - t0:.3f}s — {len(cached_segments)} → {len(new_segments)} segments, "
          f"{len(report['split_groups'])} groups, {len(report['failed'])} failed")

    if len(new_segments) == len(cached_segments) and not report["split_groups"]:
        # Nothing actually changed
        return _noop_split_return(cached_segments, cached_speech_intervals,
                                  cached_is_complete, cached_audio, sr,
                                  cached_intervals, cached_segment_dir,
                                  cached_log_row)

    # Rewrite per-segment WAVs only for affected segments — unchanged ones
    # are renamed on disk (if index shifted), split-children are re-sliced
    # from the float32 audio in-memory.
    if cached_segment_dir:
        _rewrite_segment_wavs_after_split(
            cached_segment_dir, audio, sr, cached_segments, new_segments, report,
        )

    # Rebuild the intervals list from new_segments (time-ordered).
    intervals = [(seg.start_time, seg.end_time) for seg in new_segments]

    # Re-render HTML (O(N) but no MFA / ASR work).
    full_path = os.path.join(cached_segment_dir, "full.wav") if cached_segment_dir else None
    full_audio_url = f"/gradio_api/file={full_path}" if full_path else ""
    html = render_segments(new_segments,
                           full_audio_url=full_audio_url,
                           segment_dir=cached_segment_dir or "",
                           split_report=report)

    return (html, new_segments,
            cached_speech_intervals, cached_is_complete,
            cached_audio, sr, intervals, cached_segment_dir, cached_log_row)


def manual_split_segment_audio(
    cached_segments,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete, cached_intervals,
    segment_idx, cut_after_local,
    cached_log_row=None,
    cached_segment_dir=None,
    request: gr.Request = None,
    endpoint="ui",
):
    """Split one segment at explicit user-selected word boundaries."""
    import os
    import time
    from config import (
        MFA_SPLIT_PADDING, MFA_METHOD, MFA_BEAM, MFA_RETRY_BEAM, MFA_SHARED_CMVN,
    )
    from src.alignment.segment_splitter import split_segment_manual as _split_manual
    from src.mfa import mfa_split_timestamps

    if not cached_segments or cached_audio is None:
        raise ValueError("No cached data. Please run Extract Segments first.")

    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    try:
        seg_idx = int(segment_idx)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid segment selection.") from exc

    try:
        cuts = [int(c) for c in (cut_after_local or [])]
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid split boundary selection.") from exc

    if not cuts:
        raise ValueError("Choose at least one split point.")

    print(f"\n{'='*60}")
    print(f"MANUAL SPLIT — segment={seg_idx + 1}, cuts={cuts}")
    print(f"{'='*60}")

    def _mfa_caller(refs, ranges):
        audio_chunks = []
        for (t0, t1) in ranges:
            s = max(0, int(t0 * sr))
            e = min(len(audio), int(t1 * sr))
            chunk = audio[s:e]
            chunk_i16 = np.clip(chunk * 32767, -32768, 32767).astype(np.int16)
            audio_chunks.append(chunk_i16)
        try:
            return mfa_split_timestamps(
                audio_chunks, sr, refs,
                method=MFA_METHOD, beam=MFA_BEAM, retry_beam=MFA_RETRY_BEAM,
                shared_cmvn=MFA_SHARED_CMVN, padding=MFA_SPLIT_PADDING,
            )
        except Exception as exc:
            print(f"[MANUAL_SPLIT] MFA call failed: {exc}")
            return [None] * len(refs)

    t0 = time.time()
    new_segments, report = _split_manual(cached_segments, seg_idx, cuts, _mfa_caller)
    print(f"[MANUAL_SPLIT] splitter: {time.time() - t0:.3f}s — "
          f"{len(cached_segments)} → {len(new_segments)} segments")

    if cached_segment_dir:
        _rewrite_segment_wavs_after_split(
            cached_segment_dir, audio, sr, cached_segments, new_segments, report,
        )

    intervals = [(seg.start_time, seg.end_time) for seg in new_segments]

    full_path = os.path.join(cached_segment_dir, "full.wav") if cached_segment_dir else None
    full_audio_url = f"/gradio_api/file={full_path}" if full_path else ""
    html = render_segments(new_segments,
                           full_audio_url=full_audio_url,
                           segment_dir=cached_segment_dir or "",
                           split_report=report)

    return (html, new_segments,
            cached_speech_intervals, cached_is_complete,
            cached_audio, sr, intervals, cached_segment_dir, cached_log_row)


def undo_split_group_audio(
    cached_segments,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete, cached_intervals,
    segment_idx,
    cached_log_row=None,
    cached_segment_dir=None,
    request: gr.Request = None,
    endpoint="ui",
):
    """Undo one contiguous split group back into its original parent segment."""
    import os
    from src.alignment.segment_splitter import undo_split_group as _undo_split_group

    if not cached_segments or cached_audio is None:
        raise ValueError("No cached data. Please run Extract Segments first.")

    audio, sr = _load_audio(cached_audio)
    if cached_sample_rate:
        sr = cached_sample_rate

    try:
        seg_idx = int(segment_idx)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid split group selection.") from exc

    print(f"\n{'='*60}")
    print(f"UNDO SPLIT — segment={seg_idx + 1}")
    print(f"{'='*60}")

    t0 = time.time()
    new_segments, report = _undo_split_group(cached_segments, seg_idx)
    recompute_missing_words(new_segments)
    print(f"[UNDO_SPLIT] merge: {time.time() - t0:.3f}s — "
          f"{len(cached_segments)} → {len(new_segments)} segments")

    if cached_segment_dir:
        _rewrite_segment_wavs_after_split(
            cached_segment_dir, audio, sr, cached_segments, new_segments, report,
        )

    intervals = [(seg.start_time, seg.end_time) for seg in new_segments]

    full_path = os.path.join(cached_segment_dir, "full.wav") if cached_segment_dir else None
    full_audio_url = f"/gradio_api/file={full_path}" if full_path else ""
    html = render_segments(new_segments,
                           full_audio_url=full_audio_url,
                           segment_dir=cached_segment_dir or "")

    return (html, new_segments,
            cached_speech_intervals, cached_is_complete,
            cached_audio, sr, intervals, cached_segment_dir, cached_log_row)


def _noop_split_return(segments, speech_intervals, is_complete, audio_ref, sr,
                       intervals, segment_dir, log_row):
    """Early-return no-op tuple for split_segments_audio (no violations)."""
    print("[SPLIT] No violations — noop")
    return (gr.update(), segments, speech_intervals, is_complete,
            audio_ref, sr, intervals, segment_dir, log_row)


def _rewrite_segment_wavs_after_split(segment_dir, audio, sr,
                                      old_segments, new_segments, report):
    """Renumber unchanged seg_N.wav files and slice new ones for split children.

    Strategy:
      1. Rename all existing seg_N.wav → seg_N.wav.bak (single atomic pass).
      2. For each new_segment at new_idx:
         - If it was unchanged: copy the backup at its old_idx → seg_{new_idx}.wav.
         - Else (split child): slice audio[start:end] → seg_{new_idx}.wav.
      3. Delete all remaining .bak files.
    """
    import os
    import soundfile as sf

    if not segment_dir or not os.path.isdir(segment_dir):
        return

    # 1) Back up existing per-segment WAVs
    existing = {}  # old_idx -> path
    for fname in os.listdir(segment_dir):
        if fname.startswith("seg_") and fname.endswith(".wav"):
            try:
                old_idx = int(fname[4:-4])
            except ValueError:
                continue
            src = os.path.join(segment_dir, fname)
            dst = src + ".bak"
            try:
                os.replace(src, dst)
                existing[old_idx] = dst
            except OSError as e:
                print(f"[SPLIT] backup failed for {fname}: {e}")

    unchanged_new_indices = report.get("unchanged_new_indices", {}) or {}

    t0 = time.time()
    rewritten = 0
    renamed = 0
    for new_idx, seg in enumerate(new_segments):
        dst_path = os.path.join(segment_dir, f"seg_{new_idx}.wav")

        old_idx = unchanged_new_indices.get(new_idx)
        if old_idx is not None and old_idx in existing:
            # Unchanged: rename backup in-place (no re-slicing)
            try:
                os.replace(existing[old_idx], dst_path)
                existing.pop(old_idx, None)
                renamed += 1
                continue
            except OSError as e:
                print(f"[SPLIT] rename {old_idx}->{new_idx} failed: {e}")

        # Split child (or rename failed) — slice the audio for this range.
        s = max(0, int(seg.start_time * sr))
        e = min(len(audio), int(seg.end_time * sr))
        try:
            sf.write(dst_path, audio[s:e], sr, format='WAV', subtype='PCM_16')
            rewritten += 1
        except Exception as exc:
            print(f"[SPLIT] slice write for new seg_{new_idx}.wav failed: {exc}")

    # 3) Drop any leftover backups (old segments that got fully split and replaced)
    for p in existing.values():
        try:
            os.remove(p)
        except OSError:
            pass

    print(f"[SPLIT] WAV rewrite: renamed={renamed}, sliced={rewritten} "
          f"in {time.time() - t0:.3f}s")


def _retranscribe_wrapper(
    cached_intervals, cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete,
    cached_model_name, device,
    cached_log_row=None,
    min_silence_ms=0, min_speech_ms=0, pad_ms=0,
    is_preset=False,
    request: gr.Request = None,
    endpoint="ui",
    url_source=None,
):
    """Compute opposite model from cached_model_name and run retranscribe."""
    opposite = "Large" if cached_model_name == "Base" else "Base"
    return retranscribe_audio(
        cached_intervals, cached_audio, cached_sample_rate,
        cached_speech_intervals, cached_is_complete,
        opposite, device,
        cached_log_row=cached_log_row,
        is_preset=is_preset,
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request,
        endpoint=endpoint,
        url_source=url_source,
    )


def process_audio_json(audio_data, min_silence_ms, min_speech_ms, pad_ms, model_name="Base", device="GPU"):
    """API-only endpoint that returns just JSON (no HTML)."""
    result = process_audio(audio_data, min_silence_ms, min_speech_ms, pad_ms, model_name, device)
    return result[1]  # json_output is at index 1


def save_json_export(json_data, include_words: bool = False):
    """Save JSON results to a temp file for download.

    Accepts either a List[SegmentInfo] (UI path) or a dict (API/legacy path).

    Word timestamps are only included when ``include_words=True`` — set by the
    Animate All flow. Silent-MFA flows (per-segment animate, /split_segments,
    special-segment splitting) keep word data in-memory for animation caching
    but don't surface it in the downloaded JSON. Letter timestamps are always
    stripped (``words+chars`` is documented as disabled via API).
    """
    import tempfile
    import json

    # Convert SegmentInfo list to JSON dict if needed
    if isinstance(json_data, list):
        if not json_data:
            return None
        data = segments_to_json(json_data, include_words=include_words)
    else:
        if not json_data or not json_data.get("segments"):
            return None
        # Dict path: scrub words/letters unless the caller opts in
        if include_words:
            data = {
                **json_data,
                "segments": [
                    {**seg,
                     "words": [{k: v for k, v in w.items() if k != "letters"}
                               for w in seg["words"]]}
                    if "words" in seg else seg
                    for seg in json_data["segments"]
                ],
            }
        else:
            data = {
                **json_data,
                "segments": [
                    {k: v for k, v in seg.items() if k != "words"}
                    for seg in json_data["segments"]
                ],
            }

    # Create temp file with JSON
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
        return f.name


# ---------------------------------------------------------------------------
# Inline ref editing — live sync from JS edits
# ---------------------------------------------------------------------------

def _normalize_ref(raw_ref: str) -> str | None:
    """Normalize a user-typed ref to full form. Returns None if invalid.

    Handles:
      "2:255:1-2:255:6"  → canonical (unchanged)
      "2:255:1-6"        → "2:255:1-2:255:6"
      "2:255:5"          → "2:255:5-2:255:5"
      "76:5"             → "76:5:1-76:5:N" (whole verse)
      "76:1-76:2"        → "76:1:1-76:2:N" (verse range)
      Special codes kept as-is (case-insensitive).
    """
    from src.alignment.special_segments import ALL_SPECIAL_REFS
    from src.ui.segments import _load_verse_word_counts

    raw = raw_ref.strip()
    if not raw:
        return None

    # Special codes
    if raw in ALL_SPECIAL_REFS:
        return raw

    # Case-insensitive special match
    for sp in ALL_SPECIAL_REFS:
        if raw.lower() == sp.lower():
            return sp

    verse_wc = _load_verse_word_counts()

    # Parse ref parts
    if "-" in raw:
        start, end = raw.split("-", 1)
        sp = start.split(":")
        ep = end.split(":")

        # Verse range: "76:1-76:2" → "76:1:1-76:2:N"
        if len(sp) == 2 and len(ep) == 2:
            try:
                e_surah, e_ayah = int(ep[0]), int(ep[1])
                n = verse_wc.get(e_surah, {}).get(e_ayah, 0)
                if n == 0:
                    return None
                return f"{int(sp[0])}:{int(sp[1])}:1-{e_surah}:{e_ayah}:{n}"
            except (ValueError, IndexError):
                return None

        if len(sp) < 3:
            return None
        # Short form: "2:255:1-6" → expand end
        if len(ep) == 1:
            ep = [sp[0], sp[1], ep[0]]
        elif len(ep) == 2:
            ep = [sp[0], ep[0], ep[1]]
        try:
            s = f"{int(sp[0])}:{int(sp[1])}:{int(sp[2])}"
            e = f"{int(ep[0])}:{int(ep[1])}:{int(ep[2])}"
        except (ValueError, IndexError):
            return None
        return f"{s}-{e}"
    else:
        parts = raw.split(":")
        # Whole verse: "76:5" → "76:5:1-76:5:N"
        if len(parts) == 2:
            try:
                surah, ayah = int(parts[0]), int(parts[1])
                n = verse_wc.get(surah, {}).get(ayah, 0)
                if n == 0:
                    return None
                return f"{surah}:{ayah}:1-{surah}:{ayah}:{n}"
            except (ValueError, IndexError):
                return None
        # Single word: "2:255:5" → "2:255:5-2:255:5"
        if len(parts) < 3:
            return None
        try:
            r = f"{int(parts[0])}:{int(parts[1])}:{int(parts[2])}"
        except (ValueError, IndexError):
            return None
        return f"{r}-{r}"


def _json_to_segments(json_output: dict) -> list:
    """Reconstruct SegmentInfo list from json_output.

    DEPRECATED: Only used by mfa.py's MFA loading path (Phase 4).
    Use SegmentInfo.from_json_dict() for new code.
    """
    segments = []
    for s in json_output.get("segments", []):
        if s.get("special_type"):
            ref = s["special_type"]
        elif s.get("ref_to"):
            ref = f"{s['ref_from']}-{s['ref_to']}"
        else:
            ref = s.get("ref_from", "")
        segments.append(SegmentInfo(
            start_time=s["time_from"], end_time=s["time_to"],
            transcribed_text="",
            matched_text=s.get("matched_text", ""),
            matched_ref=ref, match_score=s.get("confidence", 0),
            error=s.get("error"),
            has_missing_words=s.get("has_missing_words", False),
            has_repeated_words=s.get("has_repeated_words", False),
            wrap_word_ranges=s.get("wrap_word_ranges"),
        ))
    return segments


def _segments_to_json(segments: list, old_json_segments: list | None = None) -> dict:
    """Build json_output from SegmentInfo list, preserving extra keys from old json.

    DEPRECATED: No remaining callers after Phase 3. Can be removed.
    Use segments_to_json() from segment_types for new code.
    """
    from src.alignment.special_segments import ALL_SPECIAL_REFS

    def parse_ref(matched_ref):
        if not matched_ref or "-" not in matched_ref:
            return matched_ref, matched_ref
        parts = matched_ref.split("-", 1)
        return parts[0], parts[1] if len(parts) > 1 else parts[0]

    segments_list = []
    for i, seg in enumerate(segments):
        is_special = seg.matched_ref in ALL_SPECIAL_REFS
        segment_data = {
            "segment": i + 1,
            "time_from": round(seg.start_time, 3),
            "time_to": round(seg.end_time, 3),
            "ref_from": "" if is_special else parse_ref(seg.matched_ref)[0],
            "ref_to": "" if is_special else parse_ref(seg.matched_ref)[1],
            "matched_text": seg.matched_text or "",
            "confidence": round(seg.match_score, 3),
            "has_missing_words": seg.has_missing_words,
            "has_repeated_words": seg.has_repeated_words,
            "special_type": seg.matched_ref if is_special else None,
            "error": seg.error,
        }
        if seg.wrap_word_ranges:
            segment_data["wrap_word_ranges"] = seg.wrap_word_ranges
        # Preserve extra keys from previous json (e.g. words, wrap_word_ranges)
        if old_json_segments and i < len(old_json_segments):
            for key in ("words", "wrap_word_ranges"):
                if key in old_json_segments[i] and key not in segment_data:
                    segment_data[key] = old_json_segments[i][key]
        segments_list.append(segment_data)
    return {"segments": segments_list}


def apply_repeat_feedback(payload_str: str, log_row):
    """Handle repetition feedback from the JS UI (thumbs up/down)."""
    if not payload_str or not log_row:
        return log_row
    try:
        payload = json.loads(payload_str)
    except (json.JSONDecodeError, TypeError):
        return log_row
    seg_idx = payload.get("idx")
    vote = payload.get("vote")
    if seg_idx is None or vote not in ("up", "down"):
        return log_row
    try:
        from src.core.usage_logger import update_feedback
        update_feedback(log_row, seg_idx, vote, payload.get("comment"))
        print(f"[FEEDBACK] idx={seg_idx} vote={vote} comment={payload.get('comment', '')!r}")
    except Exception as e:
        print(f"[FEEDBACK] Failed: {e}")
    return log_row


def apply_ref_edit(edit_payload_str: str, segments_state: list, segment_dir: str, log_row=None):
    """Apply an inline ref edit from the JS UI.

    Operates directly on List[SegmentInfo]. Returns (segments_state, export_file, patch_json, log_row).
    """
    from src.ui.segments import recompute_missing_words, resolve_ref_text, get_text_with_markers, _wrap_word, simplify_ref
    from src.alignment.special_segments import ALL_SPECIAL_REFS

    _skip = (gr.skip(), gr.skip(), gr.skip(), gr.skip())

    if not edit_payload_str or not segments_state:
        return _skip

    try:
        payload = json.loads(edit_payload_str)
    except (json.JSONDecodeError, TypeError):
        return _skip

    # Route special actions
    if payload.get("action") == "recompute_mfa":
        mfa_result = _recompute_single_mfa(
            payload.get("idx"), segments_state, segment_dir,
            auto_start=bool(payload.get("auto_start")),
        )
        return (*mfa_result, gr.skip())

    idx = payload.get("idx")
    raw_ref = payload.get("new_ref", "")

    if idx is None or not raw_ref:
        return _skip

    if idx < 0 or idx >= len(segments_state):
        return _skip

    seg = segments_state[idx]
    old_ref = seg.matched_ref

    def _error_patch(message):
        return (gr.skip(), gr.skip(), json.dumps({
            "status": "error", "message": message,
            "edited_idx": idx, "old_ref": simplify_ref(old_ref),
        }), gr.skip())

    # Normalize the ref
    new_ref = _normalize_ref(raw_ref)
    if not new_ref:
        print(f"[REF-EDIT] Invalid ref: {raw_ref!r}")
        return _error_patch(f"Invalid ref: {raw_ref}")

    # No-op if normalized ref matches the current ref (handles shortcut variations)
    if new_ref == old_ref:
        return _skip

    # Validate non-special refs against QuranIndex
    if new_ref not in ALL_SPECIAL_REFS:
        from src.core.quran_index import get_quran_index
        index = get_quran_index()
        if not index.ref_to_indices(new_ref):
            print(f"[REF-EDIT] Ref not found in QuranIndex: {new_ref}")
            return _error_patch(f"Ref not found: {new_ref}")

    # Snapshot old missing-words flags before mutation
    old_flags = [s.has_missing_words for s in segments_state]

    # MFA timestamp handling: clear on ref change
    had_mfa = bool(seg.words)
    if had_mfa:
        seg.words = None

    # Stash pipeline-assigned ref on first edit (for usage logging)
    if seg._original_ref is None:
        seg._original_ref = old_ref

    # Apply the edit
    seg.matched_ref = new_ref
    seg.matched_text = resolve_ref_text(new_ref)
    seg.match_score = 1.0
    seg.error = None

    # Recompute missing words flags and track changes
    recompute_missing_words(segments_state)
    flag_changes = []
    for i, s in enumerate(segments_state):
        if old_flags[i] != s.has_missing_words:
            flag_changes.append({"idx": i, "has_missing_words": s.has_missing_words})

    # Build patch for JS (no full HTML re-render)
    is_special = new_ref in ALL_SPECIAL_REFS
    matched_text_html = get_text_with_markers(new_ref)
    if not matched_text_html and is_special:
        special_text = resolve_ref_text(new_ref)
        if special_text:
            words = special_text.replace(" \u06dd ", " ").split()
            matched_text_html = " ".join(
                _wrap_word(w, pos=f"{new_ref}:0:0:{i+1}") for i, w in enumerate(words)
            )
    if not matched_text_html:
        matched_text_html = ""

    patch = json.dumps({
        "status": "ok",
        "edited_idx": idx,
        "flag_changes": flag_changes,
        "matched_text_html": matched_text_html,
        "new_ref": new_ref,
        "is_special": is_special,
        "mfa_stripped": had_mfa,
        "edited_has_missing_words": seg.has_missing_words,
    })

    print(f"[REF-EDIT] idx={idx} {old_ref!r} → {new_ref!r} is_special={is_special} has_mw={seg.has_missing_words} text_len={len(matched_text_html)}")

    # Log edited ref to usage logger (1-based segment idx)
    if log_row:
        try:
            from src.core.usage_logger import update_edited_ref
            update_edited_ref(log_row, idx + 1, new_ref)
        except Exception as e:
            print(f"[REF-EDIT] Failed to log edited ref: {e}")

    return segments_state, save_json_export(segments_state), patch, log_row


def _recompute_single_mfa(seg_idx, segments_state: list, segment_dir, auto_start: bool = False):
    """Recompute MFA timestamps for a single segment.

    Operates directly on List[SegmentInfo]. Returns (segments_state, export, patch).
    If *auto_start* is true, the JS patch handler will immediately start the
    per-segment animation after injecting timestamps.
    """
    import os
    from src.mfa import (
        _build_mfa_ref, _mfa_upload_and_submit, _mfa_wait_result,
        _build_timestamp_lookups, _build_crossword_groups,
        _extend_word_timestamps, inject_timestamps_into_html,
    )
    from src.ui.segments import build_segment_text_html

    _skip3 = (gr.skip(), gr.skip(), gr.skip())

    if seg_idx is None or not segments_state:
        return _skip3

    if seg_idx < 0 or seg_idx >= len(segments_state):
        return _skip3

    seg = segments_state[seg_idx]
    seg_dir_str = str(segment_dir) if segment_dir else ""

    # _build_mfa_ref expects a dict — convert the single segment
    seg_dict = seg.to_json_dict()
    mfa_ref = _build_mfa_ref(seg_dict)
    if mfa_ref is None:
        return (gr.skip(), gr.skip(),
                json.dumps({"status": "mfa_failed", "idx": seg_idx}))

    audio_path = os.path.join(seg_dir_str, f"seg_{seg_idx}.wav") if seg_dir_str else None
    if not audio_path or not os.path.exists(audio_path):
        return (gr.skip(), gr.skip(),
                json.dumps({"status": "mfa_failed", "idx": seg_idx}))

    try:
        print(f"[MFA-RECOMPUTE] Sending segment {seg_idx + 1} to MFA...")
        event_id, headers, base = _mfa_upload_and_submit([mfa_ref], [audio_path])
        results = _mfa_wait_result(event_id, headers, base)
    except Exception as e:
        print(f"[MFA-RECOMPUTE] Failed for segment {seg_idx + 1}: {e}")
        return (gr.skip(), gr.skip(),
                json.dumps({"status": "mfa_failed", "idx": seg_idx}))

    if not results or results[0].get("status") != "ok":
        return (gr.skip(), gr.skip(),
                json.dumps({"status": "mfa_failed", "idx": seg_idx}))

    # Build timestamp lookups
    word_ts, letter_ts, _ = _build_timestamp_lookups(results)
    _build_crossword_groups(results, letter_ts)
    # _extend_word_timestamps and inject_timestamps_into_html expect dict-based segments;
    # convert to dicts for these MFA helpers, then write results back to SegmentInfo
    seg_dicts = [s.to_json_dict() for s in segments_state]
    seg_to_result_idx = {seg_idx: 0}
    _extend_word_timestamps(word_ts, seg_dicts, seg_to_result_idx, results, seg_dir_str)

    # Build text HTML with timestamps injected. Use the same helper as
    # render_segments so fused Basmala/Isti'adha prefixes and special-ref
    # word spans (data-pos) are present — otherwise the patch would replace
    # .segment-text innerHTML with an empty/partial string.
    text_html = build_segment_text_html(seg) or ""
    fake_html = (
        f'<div data-segment-idx="{seg_idx}">'
        f'<span class="word" data-pos="BOUNDARY"></span>'
        f'{text_html}'
        f'</div>'
    )
    enriched_html, _ = inject_timestamps_into_html(
        fake_html, seg_dicts, results, seg_to_result_idx, seg_dir_str
    )

    # Extract just the text content (strip the fake wrapper)
    import re
    inner_match = re.search(r'data-pos="BOUNDARY"></span>(.*)</div>', enriched_html, re.DOTALL)
    enriched_text = inner_match.group(1) if inner_match else text_html

    # Store timestamps back in the SegmentInfo
    words_data = []
    result = results[0]
    for w in result.get("words", []):
        word_entry = {
            "location": w.get("location", ""),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
        }
        if w.get("letters"):
            word_entry["letters"] = w["letters"]
        words_data.append(word_entry)
    seg.words = words_data

    print(f"[MFA-RECOMPUTE] Success for segment {seg_idx + 1}")
    patch = {"status": "mfa_done", "idx": seg_idx, "text_html": enriched_text}
    if auto_start:
        patch["auto_start"] = True
    return (segments_state, save_json_export(segments_state), json.dumps(patch))
