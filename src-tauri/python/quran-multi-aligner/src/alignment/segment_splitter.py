"""Post-alignment segment subdivision using MFA word timestamps.

Two independent criteria (either or both can apply):
    - max verses spanned per segment
    - max words per segment

Segments that violate the active criteria are batch-submitted to MFA for
word-level timestamps, then cut at the best word boundary:
    1. Verse pass first — split at verse boundaries.
    2. Word pass — split at a waqf (stop-sign) if present in preferred order
       preferred_stop > optional_stop > preferred_continue (phonemizer-canonical
       labels). Tiebreak: word index closest to the middle. If no stop sign
       exists at any recursion depth, fall back to an equal-word split.

Recurses until every leaf sub-segment satisfies the active criteria (no cap).

Pure module: no Gradio, no session state. The caller injects an ``mfa_caller``
closure that handles the actual MFA call + audio slicing.
"""

from __future__ import annotations

import copy
import math
import uuid
from dataclasses import replace
from typing import Callable, Optional

from src.alignment.special_segments import ALL_SPECIAL_REFS
from src.core.quran_index import get_quran_index
from src.core.segment_types import SegmentInfo
from src.ui.segments import _parse_ref_verse_ranges


# Waqf stop-sign priority (phonemizer-canonical labels and Unicode chars).
# See quranic_phonemizer README §Stops (Waqf). Highest priority first.
STOP_SIGN_PRIORITY = (
    ("preferred_stop", "\u06D7"),       # ۗ
    ("optional_stop", "\u06DA"),        # ۚ
    ("preferred_continue", "\u06D6"),   # ۖ
)

_MANUAL_SPLIT_SPECIAL_REFS = {"Basmala", "Isti'adha"}

_SPECIAL_TEXT_BY_REF = {
    "Basmala": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم",
    "Isti'adha": "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم",
}


# ---------------------------------------------------------------------------
# Eligibility + counting helpers
# ---------------------------------------------------------------------------

def is_eligible(seg: SegmentInfo) -> bool:
    """Segment is a split candidate (also excluded from count totals when False)."""
    if not seg.matched_ref:
        return False
    if seg.matched_ref in ALL_SPECIAL_REFS:
        return False
    if "+" in seg.matched_ref:
        return False   # compound special+verse (e.g. "Basmala+2:255:1-2:255:5")
    if seg.has_missing_words or seg.has_repeated_words:
        return False
    if seg.error:
        return False
    return True


def verse_span(seg: SegmentInfo) -> int:
    """Number of distinct verses a segment spans (0 if unparseable/special)."""
    if not is_eligible(seg):
        return 0
    ranges = _parse_ref_verse_ranges(seg.matched_ref)
    return len(ranges)


def word_count_of(seg: SegmentInfo) -> int:
    """Number of Quran words the segment covers, using QuranIndex for ground truth."""
    if not is_eligible(seg):
        return 0
    indices = get_quran_index().ref_to_indices(seg.matched_ref)
    if not indices:
        return 0
    start_idx, end_idx = indices
    return end_idx - start_idx + 1


def duration_of(seg: SegmentInfo) -> float:
    """Segment duration in seconds."""
    return max(0.0, seg.end_time - seg.start_time)


def violates(seg: SegmentInfo, max_verses: Optional[int],
             max_words: Optional[int],
             max_duration: Optional[float] = None) -> tuple[bool, bool, bool]:
    """Return (violates_verse, violates_word, violates_duration)."""
    if not is_eligible(seg):
        return False, False, False
    v_bad = bool(max_verses is not None and verse_span(seg) > max_verses)
    w_bad = bool(max_words is not None and word_count_of(seg) > max_words)
    d_bad = bool(max_duration is not None and duration_of(seg) > max_duration)
    return v_bad, w_bad, d_bad


# ---------------------------------------------------------------------------
# Word-level helpers
# ---------------------------------------------------------------------------

def _segment_word_texts(seg: SegmentInfo) -> list[str]:
    """Return QPC Hafs text for each word in the segment, in order.

    Uses QuranIndex (ground truth), not seg.matched_text, so waqf marks that
    live as combining characters on the QPC string are visible.
    """
    indices = get_quran_index().ref_to_indices(seg.matched_ref)
    if not indices:
        return []
    start_idx, end_idx = indices
    words = get_quran_index().words
    return [words[i].text for i in range(start_idx, end_idx + 1)]


def _display_word_texts(text: str) -> list[str]:
    """Split display text into words, dropping verse markers."""
    if not text:
        return []
    return text.replace(" \u06dd ", " ").split()


def _special_word_texts(seg: SegmentInfo) -> list[str]:
    """Return special-segment words in display order."""
    if seg.matched_text:
        words = _display_word_texts(seg.matched_text)
        if words:
            return words
    return _display_word_texts(_SPECIAL_TEXT_BY_REF.get(seg.matched_ref, ""))


def manual_split_supported(seg: SegmentInfo) -> bool:
    """Segment supports manual split mode in the UI."""
    if not seg.matched_ref or seg.has_repeated_words:
        return False

    if seg.matched_ref in ALL_SPECIAL_REFS:
        return False

    indices = get_quran_index().ref_to_indices(seg.matched_ref)
    if not indices:
        return False
    return (indices[1] - indices[0] + 1) >= 2


def _manual_word_count(seg: SegmentInfo) -> int:
    """Return the word count used by manual split selection validation."""
    indices = get_quran_index().ref_to_indices(seg.matched_ref)
    if not indices:
        return 0
    return indices[1] - indices[0] + 1


def find_stop_split_idx(word_texts: list[str]) -> Optional[int]:
    """Return 0-based index of the word AFTER which to cut.

    Walks the priority tuple; the first class with any hit wins. Within that
    class, picks the hit whose index is closest to the middle of the segment.
    The LAST word is never a valid cut point (would yield an empty right half)
    so it's excluded from candidates.
    """
    n = len(word_texts)
    if n < 2:
        return None
    middle = (n - 1) / 2.0

    for _label, mark in STOP_SIGN_PRIORITY:
        hits = [i for i in range(n - 1) if mark in word_texts[i]]
        if hits:
            return min(hits, key=lambda i: abs(i - middle))
    return None


# ---------------------------------------------------------------------------
# Ref arithmetic
# ---------------------------------------------------------------------------

def _make_ref_from_global(start_global_idx: int, end_global_idx: int) -> str:
    """Build a matched_ref string from two global word indices (inclusive)."""
    words = get_quran_index().words
    a = words[start_global_idx]
    b = words[end_global_idx]
    if start_global_idx == end_global_idx:
        return f"{a.surah}:{a.ayah}:{a.word}"
    return f"{a.surah}:{a.ayah}:{a.word}-{b.surah}:{b.ayah}:{b.word}"


def _matched_text_from_global(start_global_idx: int, end_global_idx: int) -> str:
    """Rebuild matched_text (display script) over a global word range."""
    words = get_quran_index().words
    return " ".join(words[i].display_text for i in range(start_global_idx, end_global_idx + 1))


# ---------------------------------------------------------------------------
# Split point → sub-segment construction
# ---------------------------------------------------------------------------

def _slice_mfa_words(mfa_words: list[dict], lo: int, hi: int, new_zero: float) -> list[dict]:
    """Return a deep-copied slice of mfa_words with times re-based to new_zero."""
    return _shift_mfa_words(mfa_words[lo:hi + 1], -new_zero)


def _shift_mfa_words(mfa_words: list[dict], delta: float) -> list[dict]:
    """Return a deep-copied MFA words list with all times shifted by delta."""
    out = []
    for w in mfa_words:
        nw = dict(w)
        if isinstance(nw.get("start"), (int, float)):
            nw["start"] = round(nw["start"] + delta, 4)
        if isinstance(nw.get("end"), (int, float)):
            nw["end"] = round(nw["end"] + delta, 4)
        if "letters" in nw and isinstance(nw["letters"], list):
            letters = []
            for lt in nw["letters"]:
                nlt = dict(lt)
                if isinstance(nlt.get("start"), (int, float)):
                    nlt["start"] = round(nlt["start"] + delta, 4)
                if isinstance(nlt.get("end"), (int, float)):
                    nlt["end"] = round(nlt["end"] + delta, 4)
                letters.append(nlt)
            nw["letters"] = letters
        out.append(nw)
    return out


def _merge_child_mfa_words(group: list[SegmentInfo]) -> Optional[list[dict]]:
    """Combine child-local MFA timestamps back into one merged local timeline."""
    if not group or not all(seg.words for seg in group):
        return None

    merged_zero = group[0].start_time
    out = []
    for seg in group:
        delta = seg.start_time - merged_zero
        out.extend(_shift_mfa_words(seg.words or [], delta))
    return out


def _build_child(parent: SegmentInfo,
                 start_global_idx: int, end_global_idx: int,
                 rel_start: float, rel_end: float,
                 mfa_word_lo: int, mfa_word_hi: int,
                 mfa_words: Optional[list],
                 group_id: str) -> SegmentInfo:
    """Build a sub-segment from parent, covering [start_global_idx..end_global_idx].

    rel_start/rel_end are in parent-local seconds (0 == parent.start_time).
    """
    abs_start = parent.start_time + rel_start
    abs_end = parent.start_time + rel_end
    new_ref = _make_ref_from_global(start_global_idx, end_global_idx)
    new_text = _matched_text_from_global(start_global_idx, end_global_idx)

    sliced_words = None
    if mfa_words is not None and mfa_word_hi >= mfa_word_lo:
        sliced_words = _slice_mfa_words(mfa_words, mfa_word_lo, mfa_word_hi, rel_start)

    return replace(
        parent,
        start_time=abs_start,
        end_time=abs_end,
        matched_ref=new_ref,
        matched_text=new_text,
        transcribed_text="",            # ASR transcript not sliceable
        words=sliced_words,
        wrap_word_ranges=None,
        repeated_ranges=None,
        repeated_text=None,
        has_missing_words=False,
        has_repeated_words=False,
        error=None,
        split_group_id=group_id,
        # segment_number reassigned by caller at the end
        segment_number=0,
    )


# ---------------------------------------------------------------------------
# MFA word indexing
# ---------------------------------------------------------------------------

def _build_mfa_location_to_idx(mfa_words: list[dict]) -> dict[str, int]:
    """Map MFA location strings ('s:a:w') to their position in the words list."""
    out = {}
    for i, w in enumerate(mfa_words):
        loc = w.get("location")
        if loc and loc not in out:
            out[loc] = i
    return out


def _parent_segment_word_global_indices(seg: SegmentInfo) -> list[int]:
    """Global word indices the segment covers, in order."""
    indices = get_quran_index().ref_to_indices(seg.matched_ref)
    if not indices:
        return []
    return list(range(indices[0], indices[1] + 1))


def _mfa_rel_start(mfa_words: list[dict], idx: int, fallback: float) -> float:
    v = mfa_words[idx].get("start") if 0 <= idx < len(mfa_words) else None
    return float(v) if isinstance(v, (int, float)) else float(fallback)


def _mfa_rel_end(mfa_words: list[dict], idx: int, fallback: float) -> float:
    v = mfa_words[idx].get("end") if 0 <= idx < len(mfa_words) else None
    return float(v) if isinstance(v, (int, float)) else float(fallback)


# ---------------------------------------------------------------------------
# Verse pass
# ---------------------------------------------------------------------------

def _verse_cut_indices(seg: SegmentInfo, max_verses: int) -> list[int]:
    """0-based local-word indices after which to cut to limit verse span.

    For a segment covering V verses with limit N<V, group verses into chunks
    of <=N and compute cut indices at the last local-word of each non-final
    chunk.
    """
    ranges = _parse_ref_verse_ranges(seg.matched_ref)
    if len(ranges) <= max_verses:
        return []

    per_verse_wc = [(wt - wf + 1) for (_s, _a, wf, wt) in ranges]

    cut_after_local = []
    cumulative = 0
    v = 0
    while v < len(ranges):
        chunk_end = min(v + max_verses, len(ranges))
        chunk_words = sum(per_verse_wc[v:chunk_end])
        cumulative += chunk_words
        if chunk_end < len(ranges):
            cut_after_local.append(cumulative - 1)
        v = chunk_end
    return cut_after_local


def _split_by_indices(parent: SegmentInfo, mfa_words: list[dict],
                      cut_after_local: list[int],
                      group_id: str) -> list[SegmentInfo]:
    """Split parent at the given local-word indices.

    cut_after_local: 0-based local-word indices after which to cut (not
    including the final word). Returns new sub-segments in order. Uses MFA
    word times for the actual boundary timestamps.

    If mfa_words is unavailable/misaligned, returns [parent] unchanged.
    """
    local_global = _parent_segment_word_global_indices(parent)
    n_words = len(local_global)
    if n_words == 0 or not cut_after_local:
        return [parent]

    # Map each parent-local word index -> its position in the MFA words list
    # (MFA may have non-Quran prefix words like Basmala at 0:0:x — we only
    # consider MFA entries whose location matches one of our global words.)
    loc_to_mfa = _build_mfa_location_to_idx(mfa_words or [])
    words = get_quran_index().words
    local_to_mfa = []
    for gi in local_global:
        w = words[gi]
        loc = f"{w.surah}:{w.ayah}:{w.word}"
        local_to_mfa.append(loc_to_mfa.get(loc))

    # If any required boundary word has no MFA entry, bail out — can't cut.
    boundary_indices = set(cut_after_local) | {i + 1 for i in cut_after_local}
    for bi in boundary_indices:
        if 0 <= bi < n_words and local_to_mfa[bi] is None:
            return [parent]

    # Parent duration fallback if first/last words missing MFA timestamps.
    parent_dur = max(0.0, parent.end_time - parent.start_time)

    segments: list[SegmentInfo] = []
    prev_local = 0
    for cut in cut_after_local:
        # Left sub-segment: local [prev_local .. cut]
        lo_global = local_global[prev_local]
        hi_global = local_global[cut]
        mfa_lo = local_to_mfa[prev_local]
        mfa_hi = local_to_mfa[cut]
        rel_start = _mfa_rel_start(mfa_words, mfa_lo, 0.0) if prev_local > 0 else 0.0
        rel_end = _mfa_rel_end(mfa_words, mfa_hi, parent_dur)
        segments.append(_build_child(
            parent, lo_global, hi_global, rel_start, rel_end,
            mfa_lo, mfa_hi, mfa_words, group_id,
        ))
        prev_local = cut + 1

    # Final sub-segment
    lo_global = local_global[prev_local]
    hi_global = local_global[-1]
    mfa_lo = local_to_mfa[prev_local]
    mfa_hi = local_to_mfa[n_words - 1]
    rel_start = _mfa_rel_start(mfa_words, mfa_lo, 0.0)
    rel_end = parent_dur  # Always extend last sub-segment to parent's end
    segments.append(_build_child(
        parent, lo_global, hi_global, rel_start, rel_end,
        mfa_lo, mfa_hi, mfa_words, group_id,
    ))
    return segments


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _batch_mfa(segments: list[SegmentInfo],
               indices_to_call: list[int],
               mfa_caller: Callable) -> dict[int, Optional[list]]:
    """Call MFA for the segments at the given indices, return {idx: words|None}."""
    from src.mfa import _build_mfa_ref

    if not indices_to_call:
        return {}

    to_call = []
    for i in indices_to_call:
        seg = segments[i]
        if seg.words:  # already have MFA word timings from Animate-All or a prior pass
            continue
        mfa_ref = _build_mfa_ref(seg.to_json_dict())
        if mfa_ref is None:
            continue
        to_call.append((i, mfa_ref))

    if not to_call:
        return {i: segments[i].words for i in indices_to_call}

    # Extract refs + per-segment (start_time, end_time) — caller will slice audio
    refs = [ref for _i, ref in to_call]
    ranges = [(segments[i].start_time, segments[i].end_time) for i, _ref in to_call]

    results = mfa_caller(refs, ranges)  # list[words|None] aligned with to_call
    out: dict[int, Optional[list]] = {i: segments[i].words for i in indices_to_call}
    for (i, _ref), words in zip(to_call, results):
        out[i] = words
    return out


def split_segments(segments: list[SegmentInfo],
                   max_verses: Optional[int],
                   max_words: Optional[int],
                   mfa_caller: Callable,
                   max_duration: Optional[float] = None,
                   require_stop_sign: bool = False,
                   progress_cb: Optional[Callable[[int, int], None]] = None,
                   ) -> tuple[list[SegmentInfo], dict]:
    """Subdivide segments that violate max_verses / max_words / max_duration.

    Args:
        segments: current SegmentInfo list (will not be mutated).
        max_verses:   int > 0, or None to disable the verse criterion.
        max_words:    int > 0, or None to disable the word criterion.
        max_duration: float seconds > 0, or None to disable the duration criterion.
        mfa_caller:   callable(refs: list[str], ranges: list[(float, float)])
                      -> list[words|None]. Caller slices parent audio per range.
        require_stop_sign: if True, skip the equal-word fallback in the word /
                      duration pass — segments with no waqf mark stay unsplit.
                      Does NOT affect the verse pass.
        progress_cb: optional(completed_violators: int, total_violators: int).

    Returns:
        (new_segments, report) where report contains:
            "split_groups":  {group_id: [new_indices_in_new_list, ...]}
            "failed":        [original_idx, ...] — MFA failure, kept unsplit
            "unchanged_original_indices": set(original_idx, ...)
            "unchanged_new_indices":      {original_idx: new_idx}
            "violator_count":  int
    """
    n = len(segments)
    report: dict = {
        "split_groups": {},
        "failed": [],
        "unchanged_original_indices": set(),
        "unchanged_new_indices": {},
        "violator_count": 0,
    }

    if n == 0 or (max_verses is None and max_words is None and max_duration is None):
        report["unchanged_original_indices"] = set(range(n))
        report["unchanged_new_indices"] = {i: i for i in range(n)}
        return list(segments), report

    # -----------------------------------------------------------------
    # Pass 1 — verse split (only on violators of the verse criterion)
    # -----------------------------------------------------------------
    working: list[SegmentInfo] = list(segments)
    # Tracks which original indices have been replaced (and therefore should
    # NOT be in unchanged_original_indices).
    replaced_original: set[int] = set()
    # Maps each element of `working` to its original index IF unchanged.
    original_idx_of: dict[int, int] = {i: i for i in range(n)}
    failed_original: set[int] = set()

    def _mark_split_from_original(new_idx_in_working: int,
                                  original_idx: Optional[int]):
        original_idx_of.pop(new_idx_in_working, None)
        if original_idx is not None:
            replaced_original.add(original_idx)

    if max_verses is not None:
        violators = [i for i, s in enumerate(working)
                     if violates(s, max_verses, None, None)[0]]
        report["violator_count"] = len(violators)
        if violators:
            mfa_out = _batch_mfa(working, violators, mfa_caller)
            if progress_cb:
                progress_cb(len(violators), len(violators))

            new_working: list[SegmentInfo] = []
            new_original_idx_of: dict[int, int] = {}
            for i, seg in enumerate(working):
                orig_i = original_idx_of.get(i)
                if i in violators:
                    mfa_words = mfa_out.get(i)
                    if not mfa_words:
                        failed_original.add(orig_i if orig_i is not None else -1)
                        bad = replace(seg, error="split_failed")
                        new_working.append(bad)
                        if orig_i is not None:
                            new_original_idx_of[len(new_working) - 1] = orig_i
                        continue
                    group_id = f"split-{uuid.uuid4().hex[:8]}"
                    cuts = _verse_cut_indices(seg, max_verses)
                    if not cuts:
                        new_working.append(seg)
                        if orig_i is not None:
                            new_original_idx_of[len(new_working) - 1] = orig_i
                        continue
                    children = _split_by_indices(seg, mfa_words, cuts, group_id)
                    if len(children) <= 1:
                        new_working.append(seg)
                        if orig_i is not None:
                            new_original_idx_of[len(new_working) - 1] = orig_i
                        continue
                    for child in children:
                        new_working.append(child)
                        _mark_split_from_original(len(new_working) - 1, orig_i)
                    if orig_i is not None:
                        replaced_original.add(orig_i)
                else:
                    new_working.append(seg)
                    if orig_i is not None:
                        new_original_idx_of[len(new_working) - 1] = orig_i

            working = new_working
            original_idx_of = new_original_idx_of

    # -----------------------------------------------------------------
    # Pass 2 — word / duration split, recursing until every leaf satisfies
    # both criteria. Each outer iteration batches one MFA call for all
    # current violators. Same cut logic (stop-sign > equal-word) serves both.
    # -----------------------------------------------------------------
    if max_words is not None or max_duration is not None:
        while True:
            def _word_or_dur_violator(s):
                _vv, w_bad, d_bad = violates(s, None, max_words, max_duration)
                return w_bad or d_bad

            violators = [i for i, s in enumerate(working)
                         if _word_or_dur_violator(s)]
            if not violators:
                break

            mfa_out = _batch_mfa(working, violators, mfa_caller)
            if progress_cb:
                progress_cb(len(violators), len(violators))

            new_working: list[SegmentInfo] = []
            new_original_idx_of: dict[int, int] = {}
            any_progress = False
            for i, seg in enumerate(working):
                orig_i = original_idx_of.get(i)
                if i in violators:
                    mfa_words = mfa_out.get(i)
                    if not mfa_words:
                        # MFA failed — mark and stop trying to split this one.
                        failed_original.add(orig_i if orig_i is not None else -1)
                        bad = replace(seg, error="split_failed")
                        new_working.append(bad)
                        if orig_i is not None:
                            new_original_idx_of[len(new_working) - 1] = orig_i
                        continue

                    # Verse boundary is highest priority — always cut there first
                    # regardless of whether pass 1 ran or what max_verses was set to.
                    verse_cuts = _verse_cut_indices(seg, 1)
                    if verse_cuts:
                        group_id = seg.split_group_id or f"split-{uuid.uuid4().hex[:8]}"
                        children = _split_by_indices(seg, mfa_words, verse_cuts, group_id)
                        if len(children) > 1:
                            for child in children:
                                new_working.append(child)
                                _mark_split_from_original(len(new_working) - 1, orig_i)
                            if orig_i is not None:
                                replaced_original.add(orig_i)
                            any_progress = True
                            continue
                        # _split_by_indices bailed (missing MFA boundary) — fall through

                    word_texts = _segment_word_texts(seg)
                    cut = find_stop_split_idx(word_texts)
                    if cut is None:
                        # No stop sign. If the caller requires a stop sign,
                        # leave this segment unsplit even though it violates.
                        if require_stop_sign:
                            new_working.append(seg)
                            if orig_i is not None:
                                new_original_idx_of[len(new_working) - 1] = orig_i
                            continue
                        # Equal-word split fallback
                        if len(word_texts) < 2:
                            new_working.append(seg)
                            if orig_i is not None:
                                new_original_idx_of[len(new_working) - 1] = orig_i
                            continue
                        cut = (len(word_texts) // 2) - 1
                        if cut < 0:
                            cut = 0

                    group_id = seg.split_group_id or f"split-{uuid.uuid4().hex[:8]}"
                    children = _split_by_indices(seg, mfa_words, [cut], group_id)
                    if len(children) <= 1:
                        # Could not cut (e.g. missing MFA for boundary) — stop.
                        new_working.append(seg)
                        if orig_i is not None:
                            new_original_idx_of[len(new_working) - 1] = orig_i
                        continue
                    for child in children:
                        new_working.append(child)
                        _mark_split_from_original(len(new_working) - 1, orig_i)
                    if orig_i is not None:
                        replaced_original.add(orig_i)
                    any_progress = True
                else:
                    new_working.append(seg)
                    if orig_i is not None:
                        new_original_idx_of[len(new_working) - 1] = orig_i

            working = new_working
            original_idx_of = new_original_idx_of
            if not any_progress:
                break  # every violator refused to split — avoid infinite loop

    # -----------------------------------------------------------------
    # Finalize: renumber, build report.
    # -----------------------------------------------------------------
    for new_idx, seg in enumerate(working):
        seg.segment_number = new_idx + 1
        if seg.split_group_id:
            report["split_groups"].setdefault(seg.split_group_id, []).append(new_idx)

    report["failed"] = sorted(i for i in failed_original if i >= 0)
    report["unchanged_original_indices"] = {
        orig for new, orig in original_idx_of.items()
        if orig not in replaced_original
    }
    report["unchanged_new_indices"] = dict(original_idx_of)
    return working, report


def split_segment_manual(segments: list[SegmentInfo],
                         segment_idx: int,
                         cut_after_local: list[int],
                         mfa_caller: Callable) -> tuple[list[SegmentInfo], dict]:
    """Split a single user-selected segment at explicit local-word cuts."""
    n = len(segments)
    report: dict = {
        "split_groups": {},
        "failed": [],
        "unchanged_original_indices": set(),
        "unchanged_new_indices": {},
        "violator_count": 1,
    }

    if n == 0:
        raise ValueError("No segments available.")
    if segment_idx < 0 or segment_idx >= n:
        raise ValueError("Segment index out of range.")

    parent = segments[segment_idx]
    if not manual_split_supported(parent):
        raise ValueError("This segment does not support manual splitting.")

    try:
        cuts = sorted({int(c) for c in cut_after_local})
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid manual split selection.") from exc

    total_words = _manual_word_count(parent)
    if total_words < 2:
        raise ValueError("This segment is too short to split.")
    if not cuts:
        raise ValueError("Choose at least one split point.")

    max_cut = total_words - 2
    if any(c < 0 or c > max_cut for c in cuts):
        raise ValueError("Split points are out of range.")

    mfa_words = parent.words
    if not mfa_words:
        from src.mfa import _build_mfa_ref

        mfa_ref = _build_mfa_ref(parent.to_json_dict())
        if not mfa_ref:
            raise ValueError("This segment cannot be aligned for manual splitting.")

        results = mfa_caller([mfa_ref], [(parent.start_time, parent.end_time)])
        mfa_words = results[0] if results else None

    if not mfa_words:
        raise RuntimeError("MFA failed to return word boundaries for this segment.")

    group_id = parent.split_group_id or f"split-{uuid.uuid4().hex[:8]}"
    children = _split_by_indices(parent, mfa_words, cuts, group_id)

    if len(children) <= 1:
        raise RuntimeError("Could not split this segment at the selected boundaries.")

    new_segments = list(segments[:segment_idx]) + children + list(segments[segment_idx + 1:])
    for new_idx, seg in enumerate(new_segments):
        seg.segment_number = new_idx + 1

    report["split_groups"] = {group_id: list(range(segment_idx, segment_idx + len(children)))}
    report["unchanged_original_indices"] = set(range(n)) - {segment_idx}

    shift = len(children) - 1
    unchanged_new_indices = {}
    for old_idx in range(n):
        if old_idx == segment_idx:
            continue
        new_idx = old_idx if old_idx < segment_idx else old_idx + shift
        unchanged_new_indices[new_idx] = old_idx
    report["unchanged_new_indices"] = unchanged_new_indices

    return new_segments, report


def undo_split_group(segments: list[SegmentInfo],
                     segment_idx: int) -> tuple[list[SegmentInfo], dict]:
    """Merge a contiguous split-group run back into a single segment."""
    n = len(segments)
    if n == 0:
        raise ValueError("No segments available.")
    if segment_idx < 0 or segment_idx >= n:
        raise ValueError("Split group index is out of range.")

    seed = segments[segment_idx]
    group_id = seed.split_group_id
    if not group_id:
        raise ValueError("This segment is not inside a split group.")

    start_idx = segment_idx
    while start_idx > 0 and segments[start_idx - 1].split_group_id == group_id:
        start_idx -= 1

    end_idx = segment_idx
    while end_idx + 1 < n and segments[end_idx + 1].split_group_id == group_id:
        end_idx += 1

    if end_idx <= start_idx:
        raise ValueError("This split group does not have multiple segments.")

    group = segments[start_idx:end_idx + 1]
    first = group[0]
    last = group[-1]

    if first.matched_ref in _MANUAL_SPLIT_SPECIAL_REFS:
        merged_ref = first.matched_ref
        merged_text = _SPECIAL_TEXT_BY_REF.get(merged_ref) or " ".join(
            (seg.matched_text or "").strip() for seg in group if (seg.matched_text or "").strip()
        )
    else:
        first_bounds = get_quran_index().ref_to_indices(first.matched_ref)
        last_bounds = get_quran_index().ref_to_indices(last.matched_ref)
        if not first_bounds or not last_bounds:
            raise ValueError("Could not reconstruct the original split range.")
        merged_ref = _make_ref_from_global(first_bounds[0], last_bounds[1])
        merged_text = _matched_text_from_global(first_bounds[0], last_bounds[1])

    merged = replace(
        first,
        start_time=first.start_time,
        end_time=last.end_time,
        matched_ref=merged_ref,
        matched_text=merged_text,
        transcribed_text="",
        words=_merge_child_mfa_words(group),
        wrap_word_ranges=None,
        repeated_ranges=None,
        repeated_text=None,
        has_missing_words=False,
        has_repeated_words=False,
        error=None,
        split_group_id=None,
        segment_number=0,
    )

    new_segments = list(segments[:start_idx]) + [merged] + list(segments[end_idx + 1:])
    for new_idx, seg in enumerate(new_segments):
        seg.segment_number = new_idx + 1

    unchanged_new_indices = {}
    shift = end_idx - start_idx
    for old_idx in range(n):
        if start_idx <= old_idx <= end_idx:
            continue
        new_idx = old_idx if old_idx < start_idx else old_idx - shift
        unchanged_new_indices[new_idx] = old_idx

    report = {
        "undo_group_id": group_id,
        "undo_original_indices": list(range(start_idx, end_idx + 1)),
        "unchanged_new_indices": unchanged_new_indices,
    }
    return new_segments, report
