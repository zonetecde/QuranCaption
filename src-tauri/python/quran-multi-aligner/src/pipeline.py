"""
Pipeline processing functions — GPU-decorated VAD/ASR + post-VAD alignment pipeline.

Extracted from app.py (Phase 2 refactor).
"""
import time
import numpy as np
import librosa
import gradio as gr

from config import (
    get_vad_duration, get_asr_duration,
    ANCHOR_SEGMENTS, PHONEME_ALIGNMENT_PROFILING,
    UNDERSEG_MIN_WORDS, UNDERSEG_MIN_AYAH_SPAN,
    PROGRESS_PROCESS_AUDIO, PROGRESS_RESEGMENT, PROGRESS_RETRANSCRIBE,
    SEGMENT_AUDIO_DIR, RESAMPLE_TYPE,
)
from src.core.zero_gpu import gpu_with_fallback
from src.segmenter.segmenter_model import load_segmenter, ensure_models_on_gpu
from src.segmenter.vad import detect_speech_segments
from src.segmenter.segmenter_aoti import test_vad_aoti_export
from src.alignment.alignment_pipeline import run_phoneme_matching
from src.core.segment_types import VadSegment, SegmentInfo, ProfilingData
from src.ui.segments import (
    render_segments, get_segment_word_stats,
    check_undersegmented, is_end_of_verse,
)


def _combined_duration(audio, sample_rate, *_args, **_kwargs):
    """Lease duration for VAD+ASR: sum of independent estimates."""
    minutes = len(audio) / sample_rate / 60
    model_name = _args[3] if len(_args) > 3 else _kwargs.get("model_name", "Base")
    return get_vad_duration(minutes) + get_asr_duration(minutes, model_name)

def _asr_only_duration(segment_audios, sample_rate, *_args, **_kwargs):
    """Lease duration for standalone ASR."""
    minutes = sum(len(s) for s in segment_audios) / sample_rate / 60
    model_name = _args[0] if _args else _kwargs.get("model_name", "Base")
    return get_asr_duration(minutes, model_name)


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
    t_gpu_start = time.time()

    # --- VAD phase ---
    load_segmenter()
    vad_move_time = ensure_models_on_gpu()
    intervals, vad_profiling, raw_speech_intervals, raw_is_complete = detect_speech_segments(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms)
    vad_profiling["model_move_time"] = vad_move_time
    vad_gpu_time = time.time() - t_gpu_start

    if not intervals:
        return (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete,
                None, None, None, None, 0.0, 0.0)

    # --- ASR phase ---
    segment_audios = [audio[int(s * sample_rate):int(e * sample_rate)] for s, e in intervals]
    asr_results = _run_asr_core(segment_audios, sample_rate, model_name)

    return (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete, *asr_results)


@gpu_with_fallback(duration=_asr_only_duration)
def run_phoneme_asr_gpu(segment_audios, sample_rate, model_name="Base"):
    """Standalone ASR GPU lease (used by resegment/retranscribe paths)."""
    return _run_asr_core(segment_audios, sample_rate, model_name)


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
                potentially_undersegmented=seg.potentially_undersegmented,
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
                potentially_undersegmented=seg.potentially_undersegmented,
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
                potentially_undersegmented=seg.potentially_undersegmented,
            ))
            print(f"[MFA_SPLIT] Segment {idx}: fused_basmala split at {basmala_end:.3f}s")

    print(f"[MFA_SPLIT] {len(segments)} segments → {len(new_segments)} segments")
    return new_segments


def _run_post_vad_pipeline(
    audio, sample_rate, intervals,
    model_name, device, profiling, pipeline_start, progress_steps,
    progress=gr.Progress(),
    precomputed_asr=None,
    min_silence_ms=0, min_speech_ms=0, pad_ms=0,
    request=None, log_row=None,
    is_preset=False,
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
        return "<div>No speech segments detected in audio</div>", {"segments": []}, None

    # Build VAD segments and extract audio arrays
    vad_segments = []
    segment_audios = []
    for idx, (start, end) in enumerate(intervals):
        vad_segments.append(VadSegment(start_time=start, end_time=end, segment_idx=idx))
        start_sample = int(start * sample_rate)
        end_sample = int(end * sample_rate)
        segment_audios.append(audio[start_sample:end_sample])

    print(f"[VAD] {len(vad_segments)} segments")

    if precomputed_asr is not None:
        # ASR already ran within the combined GPU lease
        phoneme_texts, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time = precomputed_asr
        print(f"[PHONEME ASR] {len(phoneme_texts)} results (precomputed, gpu {asr_gpu_time:.2f}s)")
    else:
        # Standalone ASR GPU lease (resegment/retranscribe paths)
        progress(*progress_steps["asr"])
        print(f"[STAGE] Running ASR...")

        phoneme_asr_start = time.time()
        phoneme_texts, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time = run_phoneme_asr_gpu(segment_audios, sample_rate, model_name)
        phoneme_asr_time = time.time() - phoneme_asr_start
        profiling.asr_time = phoneme_asr_time
        profiling.asr_gpu_time = asr_gpu_time
        profiling.asr_model_move_time = asr_gpu_move_time
        profiling.asr_sorting_time = asr_sorting_time
        profiling.asr_batch_build_time = asr_batch_build_time
        profiling.asr_batch_profiling = asr_batch_profiling
        print(f"[PHONEME ASR] {len(phoneme_texts)} results in {phoneme_asr_time:.2f}s (gpu {asr_gpu_time:.2f}s)")

    if asr_batch_profiling:
        for b in asr_batch_profiling:
            print(f"  Batch {b['batch_num']:>2}: {b['size']:>3} segs | "
                  f"{b['time']:.3f}s | "
                  f"{b['min_dur']:.2f}-{b['max_dur']:.2f}s "
                  f"(A {b['avg_dur']:.2f}s, T {b['total_seconds']:.1f}s, W {b['pad_waste']:.0%})")

    # Phoneme-based special segment detection
    progress(*progress_steps["special_segments"])
    print(f"[STAGE] Detecting special segments...")
    from src.alignment.special_segments import detect_special_segments
    vad_segments, segment_audios, special_results, first_quran_idx = detect_special_segments(
        phoneme_texts, vad_segments, segment_audios
    )

    # Anchor detection via phoneme n-gram voting
    progress(*progress_steps["anchor"])
    print(f"[STAGE] Anchor detection...")
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

    # Build chapter reference and set pointer
    chapter_ref = get_chapter_reference(surah)
    pointer = verse_to_word_index(chapter_ref, ayah)

    progress(*progress_steps["matching"])
    print(f"[STAGE] Text Matching...")

    # Phoneme-based DP alignment
    match_start = time.time()
    match_results, match_profiling, gap_segments, merged_into = run_phoneme_matching(
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
    profiling.tier1_attempts = match_profiling.get("tier1_attempts", 0)
    profiling.tier1_passed = match_profiling.get("tier1_passed", 0)
    profiling.tier1_segments = match_profiling.get("tier1_segments", [])
    profiling.tier2_attempts = match_profiling.get("tier2_attempts", 0)
    profiling.tier2_passed = match_profiling.get("tier2_passed", 0)
    profiling.tier2_segments = match_profiling.get("tier2_segments", [])
    profiling.consec_reanchors = match_profiling.get("consec_reanchors", 0)
    profiling.special_merges = match_profiling.get("special_merges", 0)
    profiling.transition_skips = match_profiling.get("transition_skips", 0)
    profiling.segments_attempted = match_profiling.get("segments_attempted", 0)
    profiling.segments_passed = match_profiling.get("segments_passed", 0)

    progress(*progress_steps["building"])
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

    for idx, (seg, (matched_text, score, matched_ref)) in enumerate(
        zip(vad_segments, match_results)
    ):
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

        segments.append(SegmentInfo(
            start_time=seg.start_time,
            end_time=seg_end_time,
            transcribed_text=phoneme_text,
            matched_text=matched_text,
            matched_ref=matched_ref,
            match_score=score,
            error=error,
            has_missing_words=idx in gap_segments,
            potentially_undersegmented=False,  # Recomputed after splits
        ))

    # Post-processing: split combined/fused segments via MFA timestamps
    segments = _split_fused_segments(segments, audio_int16, sample_rate)

    # Recompute stats from final segments list (after splits may have changed it)
    _seg_word_counts = []
    _seg_durations = []
    _seg_phoneme_counts = []
    _seg_ayah_spans = []
    _underseg_indices = []
    _underseg_by_words = []
    _underseg_by_ayah = []
    for i, seg in enumerate(segments):
        word_count, ayah_span = get_segment_word_stats(seg.matched_ref)
        duration = seg.end_time - seg.start_time
        underseg = check_undersegmented(seg.matched_ref, duration) if seg.matched_ref else False
        _seg_word_counts.append(word_count)
        _seg_durations.append(duration)
        _seg_phoneme_counts.append(0)  # phoneme counts not available after split
        _seg_ayah_spans.append(ayah_span)
        if underseg:
            _underseg_indices.append(i + 1)
            if word_count >= UNDERSEG_MIN_WORDS:
                _underseg_by_words.append(i + 1)
            if ayah_span >= UNDERSEG_MIN_AYAH_SPAN:
                _underseg_by_ayah.append(i + 1)

    profiling.segments_attempted = len(segments)
    profiling.segments_passed = sum(1 for s in segments if s.match_score > 0.0)

    result_build_total_time = time.time() - result_build_start
    profiling.result_build_time = result_build_total_time
    profiling.result_audio_encode_time = audio_encode_time

    # Print profiling summary
    profiling.total_time = time.time() - pipeline_start
    print(profiling.summary())

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
    if _underseg_indices:
        print(f"  Undersegmented: {len(_underseg_indices)} (segments {', '.join(str(n) for n in _underseg_indices)})")
        if _underseg_by_words:
            print(f"    by word count (>={UNDERSEG_MIN_WORDS}): {', '.join(str(n) for n in _underseg_by_words)}")
        if _underseg_by_ayah:
            print(f"    by ayah span  (>={UNDERSEG_MIN_AYAH_SPAN}): {', '.join(str(n) for n in _underseg_by_ayah)}")
    else:
        print(f"  Undersegmented: 0")

    from src.alignment.special_segments import ALL_SPECIAL_REFS

    # --- Usage logging ---
    if is_preset:
        print("[USAGE_LOG] Skipped (preset audio)")
    else:
        try:
            from src.core.usage_logger import log_alignment, update_alignment_row

            # Reciter stats (default 0.0 when no matched segments)
            _log_wpm = wpm if matched_words else 0.0
            _log_pps = pps if matched_words else 0.0
            _log_avg_d = avg_d if matched_words else 0.0
            _log_std_d = std_d if matched_words else 0.0
            _log_avg_p = avg_p if (matched_words and pauses) else 0.0
            _log_std_p = std_p if (matched_words and pauses) else 0.0

            # Mean confidence across all segments
            all_scores = [seg.match_score for seg in segments]
            _log_mean_conf = sum(all_scores) / len(all_scores) if all_scores else 0.0

            # Build per-segment objects for logging
            _log_segments = []
            for i, seg in enumerate(segments):
                sp_type = seg.matched_ref if seg.matched_ref in ALL_SPECIAL_REFS else None
                _log_segments.append({
                    "idx": i + 1,
                    "start": round(seg.start_time, 2),
                    "end": round(seg.end_time, 2),
                    "duration": round(seg.end_time - seg.start_time, 2),
                    "ref": seg.matched_ref or "",
                    "confidence": round(seg.match_score, 2),
                    "word_count": _seg_word_counts[i] if i < len(_seg_word_counts) else 0,
                    "ayah_span": _seg_ayah_spans[i] if i < len(_seg_ayah_spans) else 0,
                    "phoneme_count": _seg_phoneme_counts[i] if i < len(_seg_phoneme_counts) else 0,
                    "undersegmented": seg.potentially_undersegmented,
                    "missing_words": seg.has_missing_words,
                    "special_type": sp_type,
                    "error": seg.error,
                })

            _r = lambda v: round(v, 2)
            actual_device = device
            _log_kwargs = dict(
                audio_duration_s=_r(len(audio) / sample_rate),
                num_segments=len(segments),
                surah=surah,
                min_silence_ms=min_silence_ms,
                min_speech_ms=min_speech_ms,
                pad_ms=pad_ms,
                asr_model=model_name,
                device=actual_device,
                total_time=_r(profiling.total_time),
                vad_queue_time=_r(getattr(profiling, "vad_wall_time", 0.0) - getattr(profiling, "vad_gpu_time", 0.0)),
                vad_gpu_time=_r(getattr(profiling, "vad_gpu_time", 0.0)),
                asr_gpu_time=_r(getattr(profiling, "asr_gpu_time", 0.0)),
                dp_total_time=_r(getattr(profiling, "phoneme_dp_total_time", 0.0)),
                segments_passed=getattr(profiling, "segments_passed", 0),
                segments_failed=getattr(profiling, "segments_attempted", 0) - getattr(profiling, "segments_passed", 0),
                mean_confidence=_r(_log_mean_conf),
                tier1_retries=getattr(profiling, "tier1_attempts", 0),
                tier1_passed=getattr(profiling, "tier1_passed", 0),
                tier2_retries=getattr(profiling, "tier2_attempts", 0),
                tier2_passed=getattr(profiling, "tier2_passed", 0),
                reanchors=getattr(profiling, "consec_reanchors", 0),
                special_merges=getattr(profiling, "special_merges", 0),
                words_per_minute=_r(_log_wpm),
                phonemes_per_second=_r(_log_pps),
                avg_segment_duration=_r(_log_avg_d),
                std_segment_duration=_r(_log_std_d),
                avg_pause_duration=_r(_log_avg_p),
                std_pause_duration=_r(_log_std_p),
                log_segments=_log_segments,
            )

            if log_row is not None:
                # Resegment / retranscribe: mutate existing row in-place
                _action = "retranscribe" if log_row.get("asr_model") != model_name else "resegment"
                update_alignment_row(log_row, action=_action, **_log_kwargs)
            else:
                # Initial run: create new row (async FLAC encode in background)
                log_row = log_alignment(
                    audio=audio,
                    sample_rate=sample_rate,
                    request=request,
                    **_log_kwargs,
                    _async=True,
                )
        except Exception as e:
            print(f"[USAGE_LOG] Failed: {e}")

    # Build JSON output for API consumers
    def parse_ref(matched_ref):
        if not matched_ref:
            return "", ""
        if "-" in matched_ref:
            parts = matched_ref.split("-")
            return parts[0], parts[1] if len(parts) > 1 else parts[0]
        return matched_ref, matched_ref

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
            "potentially_undersegmented": seg.potentially_undersegmented,
            "special_type": seg.matched_ref if is_special else None,
            "error": seg.error
        }
        segments_list.append(segment_data)

    json_output = {"segments": segments_list}

    html = render_segments(segments, audio_int16, sample_rate, segment_dir=segment_dir)

    progress(*progress_steps["done"])
    print("[STAGE] Done!")

    return html, json_output, str(segment_dir), log_row


def process_audio(
    audio_data,
    min_silence_ms,
    min_speech_ms,
    pad_ms,
    model_name="Base",
    device="GPU",
    is_preset=False,
    request: gr.Request = None,
    progress=gr.Progress(),
):
    """Process uploaded audio and extract segments with automatic verse detection.

    Args:
        audio_data: File path string (from gr.Audio type="filepath") or
                    (sample_rate, numpy_array) tuple (from API's type="numpy").

    Returns:
        (html, json_output, raw_speech_intervals, raw_is_complete, preprocessed_audio, sample_rate, intervals, segment_dir, log_row)
    """
    import time

    if audio_data is None:
        return "<div>Please upload an audio file</div>", None, None, None, None, None, None, None, None

    progress(*PROGRESS_PROCESS_AUDIO["preparing"])

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
        # File path from gr.Audio(type="filepath") — load after progress bar is visible
        progress(*PROGRESS_PROCESS_AUDIO["resampling"])
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
            progress(*PROGRESS_PROCESS_AUDIO["resampling"])
            resample_start = time.time()
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000, res_type=RESAMPLE_TYPE)
            profiling.resample_time = time.time() - resample_start
            print(f"[PROFILE] Resampling {sample_rate}Hz -> 16000Hz took {profiling.resample_time:.3f}s (audio length: {len(audio)/16000:.1f}s, res_type={RESAMPLE_TYPE})")
            sample_rate = 16000

    progress(*PROGRESS_PROCESS_AUDIO["vad_asr"])
    print("[STAGE] Running VAD + ASR...")

    # Single GPU lease: VAD + ASR
    gpu_start = time.time()
    (intervals, vad_profiling, vad_gpu_time, raw_speech_intervals, raw_is_complete,
     asr_results, asr_batch_profiling, asr_sorting_time, asr_batch_build_time,
     asr_gpu_move_time, asr_gpu_time) = run_vad_and_asr_gpu(
        audio, sample_rate, int(min_silence_ms), int(min_speech_ms), int(pad_ms), model_name
    )
    wall_time = time.time() - gpu_start

    # VAD profiling: queue wait is attributed to VAD (it happens before VAD runs)
    profiling.vad_model_load_time = vad_profiling.get("model_load_time", 0.0)
    profiling.vad_model_move_time = vad_profiling.get("model_move_time", 0.0)
    profiling.vad_inference_time = vad_profiling.get("inference_time", 0.0)
    profiling.vad_gpu_time = vad_gpu_time
    profiling.vad_wall_time = wall_time - asr_gpu_time
    print(f"[GPU] VAD completed in {profiling.vad_wall_time:.2f}s (gpu {vad_gpu_time:.2f}s)")

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
        model_name, device, profiling, pipeline_start, PROGRESS_PROCESS_AUDIO,
        progress=progress,
        precomputed_asr=(asr_results, asr_batch_profiling, asr_sorting_time, asr_batch_build_time, asr_gpu_move_time, asr_gpu_time),
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request,
        is_preset=is_preset,
    )

    return html, json_output, raw_speech_intervals, raw_is_complete, audio, sample_rate, intervals, seg_dir, log_row


def resegment_audio(
    cached_speech_intervals, cached_is_complete,
    cached_audio, cached_sample_rate,
    min_silence_ms, min_speech_ms, pad_ms,
    model_name="Base", device="GPU",
    cached_log_row=None,
    is_preset=False,
    request: gr.Request = None,
    progress=gr.Progress(),
):
    """Re-run segmentation with different settings using cached VAD data.

    Skips the heavy VAD model inference — only re-cleans speech intervals
    and re-runs ASR + downstream pipeline.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, intervals, segment_dir, log_row)
    """
    import time

    if cached_speech_intervals is None or cached_audio is None:
        return "<div>No cached data. Please run Extract Segments first.</div>", None, None, None, None, None, None, None, None

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

    progress(*PROGRESS_RESEGMENT["resegment"])
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
        return "<div>No speech segments detected with these settings</div>", None, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, None, None, cached_log_row

    # Run post-VAD pipeline
    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        cached_audio, cached_sample_rate, intervals,
        model_name, device, profiling, pipeline_start, PROGRESS_RESEGMENT,
        progress=progress,
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request, log_row=cached_log_row,
        is_preset=is_preset,
    )

    # Pass through cached state unchanged, but update intervals
    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, intervals, seg_dir, log_row


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
    progress=gr.Progress(),
):
    """Re-run ASR + downstream with a different model using cached intervals.

    Uses the same segment boundaries but a different ASR model.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete,
         cached_audio, cached_sample_rate, cached_intervals, segment_dir, log_row)
    """
    import time

    if cached_intervals is None or cached_audio is None:
        return "<div>No cached data. Please run Extract Segments first.</div>", None, None, None, None, None, None, None, None

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

    pct, desc = PROGRESS_RETRANSCRIBE["retranscribe"]
    progress(pct, desc=desc.format(model=model_name))
    print(f"[STAGE] Retranscribing with {model_name} model...")

    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        cached_audio, cached_sample_rate, cached_intervals,
        model_name, device, profiling, pipeline_start, PROGRESS_RETRANSCRIBE,
        progress=progress,
        min_silence_ms=min_silence_ms, min_speech_ms=min_speech_ms, pad_ms=pad_ms,
        request=request, log_row=cached_log_row,
        is_preset=is_preset,
    )

    # Pass through all cached state unchanged
    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, cached_intervals, seg_dir, log_row


def realign_audio(
    intervals,
    cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete,
    model_name="Base", device="GPU",
    cached_log_row=None,
    request: gr.Request = None,
    progress=gr.Progress(),
):
    """Run ASR + alignment on caller-provided intervals.

    Same as retranscribe_audio but uses externally-provided intervals
    instead of cached_intervals, bypassing VAD entirely.

    Returns:
        (html, json_output, cached_speech_intervals, cached_is_complete,
         cached_audio, cached_sample_rate, intervals, segment_dir, log_row)
    """
    import time

    if cached_audio is None:
        return "<div>No cached data.</div>", None, None, None, None, None, None, None, None

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

    pct, desc = PROGRESS_RETRANSCRIBE["retranscribe"]
    progress(pct, desc=desc.format(model=model_name))

    html, json_output, seg_dir, log_row = _run_post_vad_pipeline(
        cached_audio, cached_sample_rate, intervals,
        model_name, device, profiling, pipeline_start, PROGRESS_RETRANSCRIBE,
        progress=progress,
        request=request, log_row=cached_log_row,
    )

    return html, json_output, cached_speech_intervals, cached_is_complete, cached_audio, cached_sample_rate, intervals, seg_dir, log_row


def _retranscribe_wrapper(
    cached_intervals, cached_audio, cached_sample_rate,
    cached_speech_intervals, cached_is_complete,
    cached_model_name, device,
    cached_log_row=None,
    min_silence_ms=0, min_speech_ms=0, pad_ms=0,
    is_preset=False,
    request: gr.Request = None,
    progress=gr.Progress(),
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
        progress=progress,
    )


def process_audio_json(audio_data, min_silence_ms, min_speech_ms, pad_ms, model_name="Base", device="GPU"):
    """API-only endpoint that returns just JSON (no HTML)."""
    result = process_audio(audio_data, min_silence_ms, min_speech_ms, pad_ms, model_name, device)
    return result[1]  # json_output is at index 1


def save_json_export(json_data):
    """Save JSON results to a temp file for download."""
    import tempfile
    import json

    if not json_data or not json_data.get("segments"):
        return None

    # Create temp file with JSON
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(json_data, f, separators=(',', ':'), ensure_ascii=False)
        return f.name
