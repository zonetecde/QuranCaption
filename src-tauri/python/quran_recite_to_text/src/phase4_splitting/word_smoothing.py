"""Word Timestamp Smoothing / Gap Extension."""

from __future__ import annotations
import math
import numpy as np
from src.core.segment_types import SegmentInfo


def _find_sustained_silence(
    audio: np.ndarray,
    sample_rate: int,
    start_s: float,
    end_s: float,
    min_silence_s: float,
    threshold_db: float,
    max_start_s: float | None = None,
) -> tuple[float, float] | None:
    """Returns the longest sustained low-energy interval inside a time range."""
    frame_s = 0.05
    hop_s = 0.01
    frame_samples = max(1, int(frame_s * sample_rate))
    hop_samples = max(1, int(hop_s * sample_rate))
    start_sample = max(0, int(start_s * sample_rate))
    end_sample = min(len(audio), int(end_s * sample_rate))
    chunk = audio[start_sample:end_sample]
    if len(chunk) < frame_samples:
        return None

    quiet = []
    for position in range(0, len(chunk) - frame_samples + 1, hop_samples):
        frame = chunk[position:position + frame_samples]
        rms = float(np.sqrt(np.mean(np.square(frame))))
        quiet.append(20.0 * math.log10(max(rms, 1e-8)) <= threshold_db)

    best = None
    run_start = None
    for index, is_quiet in enumerate(quiet + [False]):
        if is_quiet and run_start is None:
            run_start = index
        elif not is_quiet and run_start is not None:
            silence_start = start_s + run_start * hop_s
            silence_end = start_s + (index - 1) * hop_s + frame_s
            if (
                silence_end - silence_start >= min_silence_s
                and (max_start_s is None or silence_start <= max_start_s)
                and (best is None or silence_end - silence_start > best[1] - best[0])
            ):
                best = (silence_start, silence_end)
            run_start = None
    return best


def smooth_word_timestamps(
    segments: list[SegmentInfo],
    max_stretch_s: float | None = None,
    audio_data=None,
    sample_rate: int = 16000,
    min_silence_ms: int = 200,
    pad_ms: int = 100,
    bridge_unsplit_gaps: bool = False,
) -> None:
    """Extends final word timestamps to acoustic speech boundaries in-place."""
    if not segments:
        return

    try:
        from config import ENABLE_WORD_SMOOTHING, WORD_SMOOTHING_MAX_STRETCH_S
    except ImportError:
        ENABLE_WORD_SMOOTHING = True
        WORD_SMOOTHING_MAX_STRETCH_S = 1.0

    if not ENABLE_WORD_SMOOTHING:
        return

    if max_stretch_s is None:
        max_stretch_s = WORD_SMOOTHING_MAX_STRETCH_S

    if audio_data is not None:
        import librosa

        if isinstance(audio_data, str):
            audio, _ = librosa.load(audio_data, sr=sample_rate, mono=True)
        else:
            audio = np.asarray(audio_data, dtype=np.float32)

        if len(audio) > 0:
            rms = librosa.feature.rms(y=audio, frame_length=1024, hop_length=512)[0]
            rms_db = 20.0 * np.log10(np.maximum(rms, 1e-8))
            silence_threshold_db = float(
                np.clip(np.percentile(rms_db, 75) - 15.0, -45.0, -30.0)
            )
            min_silence_s = min_silence_ms / 1000.0
            boundary_pad_s = max(pad_ms / 1000.0, min(0.2, min_silence_s))
            audio_duration_s = len(audio) / sample_rate
            start_updates: list[float | None] = [None] * len(segments)
            end_updates: list[float | None] = [None] * len(segments)

            for index, seg in enumerate(segments):
                if not seg.words:
                    continue
                last_end = seg.words[-1].get("end")
                if last_end is None:
                    continue
                last_word_end = seg.start_time + last_end

                next_word_start = None
                if index + 1 < len(segments) and segments[index + 1].words:
                    next_seg = segments[index + 1]
                    first_start = next_seg.words[0].get("start")
                    if first_start is not None:
                        next_word_start = next_seg.start_time + first_start

                search_end = min(
                    audio_duration_s,
                    (next_word_start if next_word_start is not None else last_word_end + max_stretch_s)
                    + 0.35,
                )
                silence = _find_sustained_silence(
                    audio,
                    sample_rate,
                    last_word_end,
                    search_end,
                    min_silence_s,
                    silence_threshold_db,
                    max_start_s=(next_word_start + 0.1) if next_word_start is not None else None,
                )
                if silence is None:
                    if (
                        bridge_unsplit_gaps
                        and next_word_start is not None
                        and next_word_start - last_word_end <= 3.0
                    ):
                        end_updates[index] = max(
                            last_word_end,
                            next_word_start - 0.001,
                        )
                    continue

                silence_start, silence_end = silence
                if next_word_start is None:
                    end_updates[index] = min(silence_start + boundary_pad_s, audio_duration_s)
                    continue

                midpoint = (silence_start + silence_end) / 2.0
                end_updates[index] = min(silence_start + boundary_pad_s, midpoint)
                start_updates[index + 1] = max(silence_end - boundary_pad_s, midpoint)

            for index, seg in enumerate(segments):
                if start_updates[index] is not None:
                    seg.start_time = round(start_updates[index], 3)
                if end_updates[index] is not None:
                    seg.end_time = round(end_updates[index], 3)

    for seg in segments:
        if not seg.words or seg.start_time is None or seg.end_time is None:
            continue

        num_words = len(seg.words)

        for i in range(num_words):
            w = seg.words[i]
            orig_end = w.get("end")
            if orig_end is None:
                continue

            if i + 1 < num_words:
                next_start = seg.words[i + 1].get("start")
                next_bound_rel = next_start if next_start is not None else orig_end + max_stretch_s
            else:
                next_bound_rel = max(orig_end, seg.end_time - seg.start_time)

            stretched_end = min(orig_end + max_stretch_s, next_bound_rel)
            new_end = max(orig_end, stretched_end)
            w["end"] = round(new_end, 4)
