"""Ayah-Level Splitting via CTC Word Timestamps.

Splits multi-ayah SDK segments into per-ayah segments at word boundaries,
preserving ALL metadata (repetitions, wrap ranges, error, etc.) from the
parent segment.

Repetition handling:
- A chunk that contains a repetition (wrap_word_ranges set) is split normally
  at ayah boundaries. The sub-segment that contains the repeated section
  inherits has_repeated_words=True and the relevant wrap/repeated fields.
- Repetitions spanning two ayahs (rare) are kept on the first sub-segment.
"""

from __future__ import annotations
from typing import Any
from src.core.segment_types import SegmentInfo


WAQF_MARKS = frozenset("ۖۗۘۚۛۜ")


def _ayah_key_and_word(location: str | None):
    if not location:
        return None, None
    parts = location.split(":")
    if len(parts) >= 3:
        try:
            return f"{parts[0]}:{parts[1]}", int(parts[2])
        except ValueError:
            return f"{parts[0]}:{parts[1]}", None
    elif len(parts) >= 2:
        return f"{parts[0]}:{parts[1]}", None
    return None, None


def _wrap_ranges_for_group(wrap_word_ranges: Any, group_locs: set[str]):
    """Filter wrap_word_ranges to those whose jump_to falls in this group's locs."""
    if not wrap_word_ranges:
        return None
    result = []
    for wr in wrap_word_ranges:
        # wr is (jump_to, jump_from, repeat_end) or (jump_to, jump_from)
        jump_to = wr[0] if wr else None
        if jump_to and jump_to in group_locs:
            result.append(wr)
    return result if result else None


# A group is a plain dict with keys: key (str), reason (str), words (list[dict])
# Using dicts avoids all tuple-unpacking type checker complaints and allows
# in-place mutation of the words list.
def _new_group(key: str | None, reason: str, first_word: dict) -> dict:
    return {"key": key, "reason": reason, "words": [first_word]}


def split_segments_at_ayah_boundaries(
    segments: list[SegmentInfo],
    min_word_gap_s: float = 0.5,
    split_all_ayahs: bool = False,
) -> list[SegmentInfo]:
    """Splits segments at ayah, repetition, and meaningful intra-ayah pause boundaries.

    Ayah boundaries require a small meaningful silence gap, repetition boundaries
    are always retained, and pauses within one ayah use ``min_word_gap_s``.

    Preserves all metadata from the parent segment including:
    - has_repeated_words / wrap_word_ranges / repeated_ranges / repeated_text
    - error, match_score, _original_alignment_idx
    - has_missing_words (will be recomputed by recompute_missing_words later)
    """
    # Minimum silence gap (seconds) between the end of the last word of one
    # ayah group and the start of the first word of the next to justify a split.
    # Below this threshold the groups are merged back (reciter read continuously).
    # Set to 0.08s: the reference project's neural Waqf VAD fires on pauses as
    # short as ~100ms.  CTC timestamp jitter is typically < 40ms, so 80ms is a
    # safe floor that honours genuine ayah boundaries while ignoring jitter.
    MIN_SPLIT_GAP_S = 0.08

    from qua_sdk.domain import SPECIAL_NAMES as ALL_SPECIAL_REFS
    result: list[SegmentInfo] = []

    for seg in segments:
        # Skip specials and segments with no word timestamps
        if seg.matched_ref in ALL_SPECIAL_REFS or not seg.words:
            result.append(seg)
            continue

        # ----------------------------------------------------------------
        # Step 1: Group words by (surah:ayah) key.
        # A new group is opened when:
        #   a) the ayah key changes            → reason "ayah_boundary"
        #   b) the word index goes backward    → reason "repetition"
        #   c) two words in one ayah have a meaningful pause → reason "word_gap"
        #   d) a waqf mark is followed by a clear ASR gap   → reason "waqf"
        # ----------------------------------------------------------------
        groups: list[dict] = []
        prev_key: str | None = None
        prev_word_num: int | None = None

        for word_index, w in enumerate(seg.words):
            loc: str | None = w.get("location")
            if not loc or loc.startswith("0:0:"):
                # Special-segment words (location 0:0:N) — attach to current group
                if groups:
                    groups[-1]["words"].append(w)
                else:
                    groups.append(_new_group("special", "first", w))
                continue

            key, word_num = _ayah_key_and_word(loc)
            acoustic_gap = (
                seg._acoustic_word_gaps[word_index]
                if seg._acoustic_word_gaps
                and word_index < len(seg._acoustic_word_gaps)
                else None
            )
            asr_gap = (
                seg._asr_word_gaps[word_index]
                if seg._asr_word_gaps and word_index < len(seg._asr_word_gaps)
                else None
            )

            if not groups:
                groups.append(_new_group(key, "first", w))
            elif key != prev_key and key is not None:
                groups.append(_new_group(key, "ayah_boundary", w))
            elif (
                word_num is not None
                and prev_word_num is not None
                and word_num <= prev_word_num
            ):
                # Backward word index within the same ayah = repetition boundary
                groups.append(_new_group(key, "repetition", w))
            elif key == prev_key:
                previous_word = groups[-1]["words"][-1]
                previous_end = previous_word.get("end")
                current_start = w.get("start")
                ctc_gap = (
                    current_start - previous_end
                    if previous_end is not None and current_start is not None
                    else None
                )
                has_waqf = any(mark in previous_word.get("word", "") for mark in WAQF_MARKS)
                waqf_gap = asr_gap if asr_gap is not None else ctc_gap
                if acoustic_gap is not None and acoustic_gap >= min_word_gap_s:
                    groups.append(_new_group(key, "word_gap", w))
                elif (
                    has_waqf
                    and waqf_gap is not None
                    and waqf_gap >= max(0.4, min_word_gap_s)
                ):
                    # FastConformer timestamps advance in 80ms frames, so 400ms
                    # safely represents the upstream model's nominal 0.5s waqf gap.
                    groups.append(_new_group(key, "waqf", w))
                else:
                    groups[-1]["words"].append(w)
            else:
                groups[-1]["words"].append(w)

            if key is not None:
                prev_key = key
            if word_num is not None:
                prev_word_num = word_num

        # No split needed
        if len(groups) <= 1:
            result.append(seg)
            continue

        # ----------------------------------------------------------------
        # Step 2: Merge back adjacent ayah-boundary groups that have no
        # meaningful silence gap (the reciter read continuously).
        # Repetition and intra-ayah pause boundaries are ALWAYS kept.
        # ----------------------------------------------------------------
        merged: list[dict] = [groups[0]]
        for grp in groups[1:]:
            if grp["reason"] == "ayah_boundary":
                if split_all_ayahs:
                    merged.append(grp)
                    continue
                prev_words = merged[-1]["words"]
                last_end = prev_words[-1].get("end")
                next_start = grp["words"][0].get("start")
                gap = (
                    (next_start - last_end)
                    if last_end is not None and next_start is not None
                    else None
                )
                if gap is None or gap < MIN_SPLIT_GAP_S:
                    # No real pause — merge into previous group
                    merged[-1]["words"].extend(grp["words"])
                    continue
            merged.append(grp)

        # Still no split needed after gap filtering
        if len(merged) <= 1:
            result.append(seg)
            continue

        # ----------------------------------------------------------------
        # Step 3: Emit one SegmentInfo per group.
        # ----------------------------------------------------------------
        seg_start = seg.start_time
        parent_has_rep = seg.has_repeated_words
        parent_wraps = seg.wrap_word_ranges

        for g_idx, grp in enumerate(merged):
            words = grp["words"]
            is_first = (g_idx == 0)
            is_last  = (g_idx == len(merged) - 1)

            first_rel_start = words[0].get("start")
            last_rel_end    = words[-1].get("end")

            if is_first:
                abs_start = seg.start_time
            elif first_rel_start is not None:
                abs_start = seg_start + first_rel_start
            else:
                abs_start = result[-1].end_time if result else seg.start_time

            abs_end_word = (
                seg_start + last_rel_end if last_rel_end is not None else abs_start + 0.04
            )

            if is_last:
                abs_end = seg.end_time
            else:
                next_words     = merged[g_idx + 1]["words"]
                next_rel_start = next_words[0].get("start")
                abs_end = (
                    (abs_end_word + seg_start + next_rel_start) / 2.0
                    if next_rel_start is not None
                    else abs_end_word
                )

            abs_start = round(abs_start, 3)
            abs_end   = round(abs_end,   3)
            if abs_end <= abs_start:
                abs_end = abs_start + 0.04

            # Build ref from word locations
            locs = [
                w.get("location")
                for w in words
                if w.get("location") and not w.get("location", "").startswith("0:0:")
            ]
            if locs:
                ref_from  = locs[0]
                ref_to    = locs[-1]
                matched_ref = ref_from if ref_from == ref_to else f"{ref_from}-{ref_to}"
            else:
                matched_ref = seg.matched_ref

            matched_text = " ".join(
                w.get("word", "") for w in words if not w.get("is_missing")
            )

            # Re-offset word timestamps to be relative to sub-segment start
            offset = abs_start - seg_start
            sub_words: list[dict] = []
            for w in words:
                entry = dict(w)
                if entry.get("start") is not None:
                    entry["start"] = round(max(0.0, entry["start"] - offset), 4)
                if entry.get("end") is not None:
                    entry["end"]   = round(max(0.0, entry["end"]   - offset), 4)
                sub_words.append(entry)

            # Determine if this sub-segment owns a repetition group.
            # The jump_to location decides which sub-segment inherits the wrap.
            group_locs = {w.get("location") for w in words if w.get("location")}
            sub_wraps  = _wrap_ranges_for_group(parent_wraps, group_locs) if parent_has_rep else None
            sub_has_rep = bool(sub_wraps)

            # Recompute repeated_ranges and repeated_text for the sub-segment
            sub_rep_ranges = None
            sub_rep_text   = None
            if sub_has_rep and sub_wraps and matched_ref and "-" in matched_ref:
                try:
                    from src.core.sdk_adapt import derive_repetition
                    sub_rep_ranges, sub_rep_text = derive_repetition(matched_ref, sub_wraps)
                except Exception:
                    pass

            sub_seg = SegmentInfo(
                start_time=abs_start,
                end_time=abs_end,
                transcribed_text=seg.transcribed_text,
                matched_text=matched_text,
                matched_ref=matched_ref,
                match_score=seg.match_score,
                error=seg.error,
                has_missing_words=False,    # recomputed by recompute_missing_words
                has_repeated_words=sub_has_rep,
                wrap_word_ranges=sub_wraps,
                repeated_ranges=sub_rep_ranges,
                repeated_text=sub_rep_text,
                words=sub_words,
                _original_alignment_idx=seg._original_alignment_idx,
                _preserve_split_before=(
                    not is_first and grp["reason"] in {"word_gap", "repetition", "waqf"}
                ),
            )
            result.append(sub_seg)

    return result
