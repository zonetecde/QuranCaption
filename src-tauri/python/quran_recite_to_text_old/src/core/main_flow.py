"""Pipeline Entry Points — Orchestrates Phase 1, Phase 2, Phase 3, and Phase 4 processing."""

import time
import subprocess
import numpy as np

from src.core import sdk_adapt
from src.core.segment_types import ProfilingData
from src.phase1_transcribe.stream import run_asr_cpu
from src.phase2_matching.matcher import _run_post_asr_pipeline
from src.phase3_alignment.ctc_align import run_ctc_alignment
from src.phase1_transcribe.fastconformer import FASTCONFORMER_TOKENS_PATH


def _resample_audio_ffmpeg(audio_array, orig_sr, target_sr=16000):
    """Resamples in-memory NumPy audio array to target sample rate using FFmpeg stdin pipe."""
    command = [
        'ffmpeg', '-v', 'quiet',
        '-f', 'f32le', '-ar', str(orig_sr), '-ac', '1',
        '-i', 'pipe:0',
        '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', str(target_sr),
        'pipe:1'
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = process.communicate(input=audio_array.tobytes())

    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg resample failed: {stderr.decode('utf-8', errors='ignore')}")

    return np.frombuffer(stdout, dtype=np.float32)


def process_audio(
    audio_data,
    model_name="Base",
    profile_name="auto",
    return_profiling: bool = False,
    progress_callback=None,
    min_silence_ms: int = 1200,
    pad_ms: int = 600,
):
    """Main execution wrapper for the transcription and Quran alignment pipeline.

    Args:
        audio_data: Input audio file path or (sample_rate, numpy_array).
        model_name: Acoustic model name.
        profile_name: Transcription profile preset ('auto', 'fast', 'noisy', 'clean', 'sliding').
        return_profiling: If True, returns (json_output, profiling).
        progress_callback: Optional callable(pct, msg) for progress tracking.
        min_silence_ms: Requested silence threshold for chunk detection and subtitle splitting.
        pad_ms: Maximum adaptive padding added around speech chunks.
    """
    if audio_data is None:
        return ([], ProfilingData()) if return_profiling else []

    profiling = ProfilingData()
    pipeline_start = time.time()

    if isinstance(audio_data, str):
        audio = audio_data
        sample_rate = 16000
    else:
        sample_rate, audio = audio_data

        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype == np.int32:
            audio = audio.astype(np.float32) / 2147483648.0

        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        if sample_rate != 16000:
            resample_start = time.time()
            audio = _resample_audio_ffmpeg(audio, orig_sr=sample_rate, target_sr=16000)
            profiling.resample_time = time.time() - resample_start
            sample_rate = 16000

    (regions, emissions, stage_metrics, asr_time) = run_asr_cpu(
        audio,
        sample_rate,
        model_name=model_name,
        profile_name=profile_name,
        progress_callback=progress_callback,
        min_silence_ms=min_silence_ms,
        pad_ms=pad_ms,
    )
    sdk_adapt.metrics_to_profiling(stage_metrics, profiling)
    intervals = sdk_adapt.intervals_from_regions(regions)

    profiling.audio_duration_s = regions.audio_duration_s

    if not intervals:
        profiling.total_time = time.time() - pipeline_start
        return ([], profiling) if return_profiling else []

    profiling.asr_time = asr_time

    json_output, segments = _run_post_asr_pipeline(
        audio, sample_rate, intervals,
        model_name, profiling, pipeline_start,
        regions=regions, emissions=emissions, stage_metrics=stage_metrics
    )

    try:
        run_ctc_alignment(
            segments=segments,
            stage_metrics=stage_metrics,
            vocab_path=FASTCONFORMER_TOKENS_PATH,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()

    # Split fused specials (Isti'adha+Basmala) using CTC word timestamps.
    from src.phase4_splitting.fused_split import _split_fused_segments
    segments = _split_fused_segments(segments)

    # Split multi-ayah audio chunks into per-ayah segments using CTC word
    # timestamps. Munajjam PR #65's adaptive silence engine naturally produces
    # 1-to-1 Ayah chunks for high-precision alignment.
    # All metadata (repetitions, wrap_word_ranges, error) is preserved.
    from src.phase4_splitting.ayah_split import split_segments_at_ayah_boundaries
    segments = split_segments_at_ayah_boundaries(
        segments,
        min_word_gap_s=min_silence_ms / 1000.0,
        split_all_ayahs=bool(stage_metrics.get("multi_chapter")),
    )

    # Eliminate fake-repeat / trailing-fragment segments caused by VAD chunk
    # audio overlap or edge-cuts.  Runs AFTER ayah_split so the dedup sees
    # clean per-ayah segments and can correctly identify:
    #   1. Overlap artifacts  (nxt.start < current.end, ref is subset)
    #   2. Trailing fragments (gap ≈ 0, 1-2 words already in previous seg)
    # Genuine reciter repetitions (wrap_word_ranges set) are never removed.
    from src.core.dedup_segments import dedup_vad_overlaps, _merge_two_segments
    segments = dedup_vad_overlaps(segments)

    if stage_metrics.get("multi_chapter"):
        # Rejoin a one-word recovery fragment without consuming the following repeat.
        merged_segments = []
        segment_index = 0
        while segment_index < len(segments):
            if segment_index + 2 < len(segments):
                current, continuation, repeated = segments[segment_index:segment_index + 3]
                current_words = current.words or []
                current_loc = current_words[0].get("location") if len(current_words) == 1 else None
                continuation_loc = (
                    continuation.words[0].get("location")
                    if continuation.words else None
                )
                repeated_loc = repeated.words[0].get("location") if repeated.words else None
                try:
                    current_ref = tuple(map(int, current_loc.split(":")))
                    continuation_ref = tuple(map(int, continuation_loc.split(":")))
                    repeated_ref = tuple(map(int, repeated_loc.split(":")))
                except (AttributeError, ValueError):
                    current_ref = continuation_ref = repeated_ref = None
                if (
                    current_ref
                    and continuation_ref[:2] == current_ref[:2] == repeated_ref[:2]
                    and continuation_ref[2] == current_ref[2] + 1
                    and repeated_ref[2] <= current_ref[2]
                ):
                    merged_segments.append(_merge_two_segments(current, continuation))
                    segment_index += 2
                    continue
            merged_segments.append(segments[segment_index])
            segment_index += 1
        segments = merged_segments

    # Fuse adjacent segments belonging to the SAME Ayah when the reciter
    # recited continuously without a long pause (e.g. 17:56:1-9 + 17:56:10-13 -> 17:56:1-13).
    from src.core.auto_merge import fuse_adjacent_same_ayah_segments
    segments = fuse_adjacent_same_ayah_segments(segments)

    # Stamp segment numbers.
    for i, seg in enumerate(segments):
        seg.segment_number = i + 1

    # Recompute has_missing_words flags from word coverage (single authority).
    from src.core.missing_words import recompute_missing_words
    recompute_missing_words(segments)

    # Optional: extend word end-timestamps into trailing silence.
    # Both smooth and inject mutate seg.words in-place before serialization.
    # Controlled by ENABLE_WORD_SMOOTHING in config.py.
    from src.phase4_splitting.word_smoothing import smooth_word_timestamps
    smooth_word_timestamps(
        segments,
        audio_data=audio,
        sample_rate=sample_rate,
        min_silence_ms=min_silence_ms,
        pad_ms=pad_ms,
        bridge_unsplit_gaps=bool(stage_metrics.get("multi_chapter")),
    )
    if stage_metrics.get("multi_chapter"):
        for previous, current in zip(segments, segments[1:]):
            if current.start_time > previous.end_time:
                continue
            old_start = current.start_time
            current.start_time = round(previous.end_time + 0.001, 3)
            offset = current.start_time - old_start
            for word in current.words or []:
                if word.get("start") is not None:
                    word["start"] = round(max(0.0, word["start"] - offset), 4)
                if word.get("end") is not None:
                    word["end"] = round(max(0.0, word["end"] - offset), 4)
            if current.end_time <= current.start_time:
                current.end_time = round(current.start_time + 0.04, 3)

    # Optional: inject missing (unrecited) words into the words array.
    # Runs before serialization so injected words appear in the output JSON.
    # Controlled by ENABLE_MISSING_WORD_INJECTION in config.py.
    from src.core.missing_words import inject_missing_words
    inject_missing_words(segments)

    profiling.total_time = time.time() - pipeline_start

    # Build the core JSON payload (words always included).
    from src.phase4_splitting.export import build_segment_export
    payload = build_segment_export(segments, include_words=True)

    if return_profiling:
        return payload, profiling
    return payload
