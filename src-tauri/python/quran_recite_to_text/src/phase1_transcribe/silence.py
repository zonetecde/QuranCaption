"""Phase 1 Silence Detection — Munajjam PR #65 Adaptive Silence Engine.

Provides peak-relative Librosa RMS energy splitting (`top_db`) and 4-Level Progressive
Threshold Relaxation for continuous reciters (Hadr style) and noisy recordings.

Source: https://github.com/Itqan-community/Munajjam/pull/65
Author: ahmed-alramah
"""

import numpy as np
import librosa
from pathlib import Path
from typing import List, Tuple, Optional


def _detect_non_silent_fast(
    audio_data: np.ndarray | str | Path,
    min_silence_len_ms: int = 1200,
    silence_thresh_db: int = -45,
    sample_rate: int = 16000,
) -> List[Tuple[int, int]]:
    """Librosa Fast Engine: Peak-relative top_db RMS non-silent interval detection with chunk merging."""
    if isinstance(audio_data, (str, Path)):
        y, sr = librosa.load(str(audio_data), sr=sample_rate, mono=True)
    else:
        y, sr = audio_data, sample_rate

    if len(y) == 0:
        return []

    total_duration_ms = int((len(y) / sr) * 1000)

    # Rule 1: Audio under 3 minutes (180,000ms) -> Single Pass
    if total_duration_ms <= 180000:
        return [(0, total_duration_ms)]

    # Dynamic adaptive top_db estimation based on signal peak & RMS energy
    frame_length = 2048
    hop_length = 512

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    percentile_75 = np.percentile(rms_db, 75)
    
    # Adaptive top_db: 35 dB below 75th percentile speech energy, capped between 32 dB and 45 dB
    adaptive_top_db = float(np.clip(abs(percentile_75) + 20.0, 32.0, 45.0))

    intervals = librosa.effects.split(
        y,
        top_db=adaptive_top_db,
        frame_length=frame_length,
        hop_length=hop_length
    )

    if len(intervals) == 0:
        return [(0, total_duration_ms)]

    raw_chunks = []
    min_silence_samples = int((min_silence_len_ms / 1000.0) * sr)

    for start_sample, end_sample in intervals:
        start_ms = int((start_sample / sr) * 1000)
        end_ms = int((end_sample / sr) * 1000)

        if not raw_chunks:
            raw_chunks.append((start_ms, end_ms))
        else:
            prev_start_ms, prev_end_ms = raw_chunks[-1]
            gap_samples = start_sample - int((prev_end_ms / 1000.0) * sr)

            if gap_samples < min_silence_samples:
                raw_chunks[-1] = (prev_start_ms, end_ms)
            else:
                raw_chunks.append((start_ms, end_ms))

    # Rule 2: Post-process & Merge micro-chunks (< 5000ms) or small gaps (< 2500ms)
    merged_chunks = []
    min_chunk_dur_ms = 5000   # 5 seconds min chunk target
    max_gap_ms = 2500         # 2.5 seconds max gap to merge

    for start_ms, end_ms in raw_chunks:
        if not merged_chunks:
            merged_chunks.append([start_ms, end_ms])
        else:
            prev_start_ms, prev_end_ms = merged_chunks[-1]
            gap = start_ms - prev_end_ms
            prev_dur = prev_end_ms - prev_start_ms
            curr_dur = end_ms - start_ms

            # Merge if gap is small OR if either chunk is a micro-chunk
            if gap <= max_gap_ms or prev_dur < min_chunk_dur_ms or curr_dur < min_chunk_dur_ms:
                merged_chunks[-1][1] = max(prev_end_ms, end_ms)
            else:
                merged_chunks.append([start_ms, end_ms])

    # Convert back to tuples and split oversized chunks (> 35s) at local RMS energy minima
    final_chunks = []
    for s_ms, e_ms in merged_chunks:
        chunk_dur_ms = e_ms - s_ms
        if chunk_dur_ms <= 38000:
            final_chunks.append((s_ms, e_ms))
        else:
            # Extract slice array for RMS energy minima search
            s_sample = int((s_ms / 1000.0) * sr)
            e_sample = int((e_ms / 1000.0) * sr)
            sub_y = y[s_sample:e_sample]

            hop_len = int(0.05 * sr)   # 50ms hop
            frame_len = int(0.10 * sr) # 100ms frame
            if len(sub_y) >= frame_len:
                rms = librosa.feature.rms(y=sub_y, frame_length=frame_len, hop_length=hop_len)[0]
                rms_db = librosa.amplitude_to_db(rms, ref=np.max)

                curr_ms = s_ms
                while curr_ms + 38000 < e_ms:
                    search_start_ms = curr_ms + 15000
                    search_end_ms = min(curr_ms + 38000, e_ms)

                    rel_start_frame = int(((search_start_ms - s_ms) / 1000.0) * sr / hop_len)
                    rel_end_frame = int(((search_end_ms - s_ms) / 1000.0) * sr / hop_len)

                    rel_start_frame = max(0, min(len(rms_db) - 1, rel_start_frame))
                    rel_end_frame = max(rel_start_frame + 1, min(len(rms_db), rel_end_frame))

                    window = rms_db[rel_start_frame:rel_end_frame]
                    min_rel_idx = np.argmin(window)

                    split_ms = int(((rel_start_frame + min_rel_idx) * hop_len / sr) * 1000) + s_ms
                    final_chunks.append((curr_ms, split_ms))
                    curr_ms = split_ms

                if curr_ms < e_ms:
                    final_chunks.append((curr_ms, e_ms))
            else:
                final_chunks.append((s_ms, e_ms))

    return final_chunks


def detect_acoustic_silences(
    audio_data: np.ndarray | str | Path,
    min_silence_len_ms: int = 1200,
    sample_rate: int = 16000,
) -> List[Tuple[float, float]]:
    """Returns qualifying acoustic silence intervals in seconds."""
    if isinstance(audio_data, (str, Path)):
        y, sr = librosa.load(str(audio_data), sr=sample_rate, mono=True)
    else:
        y, sr = audio_data, sample_rate

    if len(y) == 0:
        return []

    frame_length = 2048
    hop_length = 512
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    adaptive_top_db = float(
        np.clip(abs(np.percentile(rms_db, 75)) + 20.0, 32.0, 45.0)
    )
    non_silent = librosa.effects.split(
        y,
        top_db=adaptive_top_db,
        frame_length=frame_length,
        hop_length=hop_length,
    )

    minimum_samples = int((min_silence_len_ms / 1000.0) * sr)
    return [
        (previous_end / sr, next_start / sr)
        for (_, previous_end), (next_start, _) in zip(non_silent, non_silent[1:])
        if next_start - previous_end >= minimum_samples
    ]


def _detect_non_silent_chunks_raw(
    audio_data: np.ndarray | str | Path,
    min_silence_len: int = 1200,
    silence_thresh: int = -45,
    use_fast: bool = True,
    sample_rate: int = 16000,
) -> List[Tuple[int, int]]:
    """Internal helper: detect non-silent chunks with fixed thresholds."""
    return _detect_non_silent_fast(audio_data, min_silence_len, silence_thresh, sample_rate=sample_rate)


def detect_non_silent_chunks(
    audio_data: np.ndarray | str | Path,
    min_silence_len: int = 1200,
    silence_thresh: int = -45,
    use_fast: bool = True,
    adaptive: bool = False,
    expected_chunks: Optional[int] = None,
    min_chunks_ratio: float = 0.5,
    sample_rate: int = 16000,
) -> List[Tuple[int, int]]:
    """Detects non-silent speech portions in audio using gentle thresholding and chunk merging.

    Returns:
        List of (start_ms, end_ms) tuples for non-silent speech portions.
    """
    chunks = _detect_non_silent_chunks_raw(audio_data, min_silence_len, silence_thresh, use_fast, sample_rate)
    return chunks
