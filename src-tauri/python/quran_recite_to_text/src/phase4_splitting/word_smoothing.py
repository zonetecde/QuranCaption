"""Word Timestamp Smoothing / Gap Extension."""

from __future__ import annotations
from src.core.segment_types import SegmentInfo


def smooth_word_timestamps(segments: list[SegmentInfo], max_stretch_s: float | None = None) -> None:
    """In-place extension of word 'end' timestamps into trailing silence."""
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
