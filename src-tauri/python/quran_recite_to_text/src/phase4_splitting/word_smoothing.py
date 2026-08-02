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

    total_segs = len(segments)

    for seg_idx, seg in enumerate(segments):
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
                next_bound_rel = orig_end + max_stretch_s
                for next_idx in range(seg_idx + 1, total_segs):
                    next_seg = segments[next_idx]
                    if next_seg.words and next_seg.start_time is not None:
                        first_word_start = next_seg.words[0].get("start", 0.0)
                        abs_next_start = next_seg.start_time + first_word_start
                        next_bound_rel = abs_next_start - seg.start_time
                        break

            stretched_end = min(orig_end + max_stretch_s, next_bound_rel)
            new_end = max(orig_end, stretched_end)
            w["end"] = round(new_end, 4)

            if i == num_words - 1:
                new_abs_end = round(seg.start_time + new_end, 3)
                if new_abs_end > seg.end_time:
                    seg.end_time = new_abs_end
