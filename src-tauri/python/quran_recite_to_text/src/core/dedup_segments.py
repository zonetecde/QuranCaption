"""Segment Deduplication & Refinement Engine — VAD Artifact & Boundary Cleaner.

Handles three types of post-ASR VAD/segmentation artifacts:

1. OVERLAP ARTIFACTS:
   Adjacent chunks sharing overlapping audio (padding > gap/2), producing
   a duplicate segment whose ref location is a strict subset of the previous segment.
   Detection: nxt.start_time < current.end_time AND ref subset.

2. TRAILING FRAGMENTS:
   Adjacent chunks touching in time (gap <= 500ms) where the VAD cut lands on
   the edge of the last word, producing a 1–2 word fragment whose locations are
   already in the previous segment.
   Detection: |gap| <= 500ms AND nxt word locations ⊂ current word locations.

3. HEAD OVERLAP TRIMMING:
   When nxt segment starts with the SAME word location that ended current segment
   (e.g., current ends at '17:81:3', nxt starts at '17:81:3-9'). The duplicate word
   is trimmed from the beginning of nxt.

4. LEADING PARTICLE TRANSFER:
   When current segment ends with a single leading particle (e.g. 'وَإِنْ', 'فَإِنْ')
   at location L after a Waqf pause mark ('ۚ', 'ۘ', etc.) on location L-1, and nxt starts
   with location L+1 ('عُدتُّمْ'), particle L is transferred to the start of nxt.

GENUINE REPEATS (wrap_word_ranges / has_repeated_words) are strictly preserved.
"""

from __future__ import annotations
from src.core.segment_types import SegmentInfo

ADJACENT_GAP_THRESH_S = 0.50  # 500 ms
LEADING_PARTICLES = {"وَإِنْ", "فَإِنْ", "وَإِذْ", "فَإِذَا", "وَإِنَّ", "وَإِذَا"}
WAQF_MARKS = {"ۚ", "ۘ", "ۗ", "ۖ", "ۚ", "ۛ"}


def _parse_ref(ref: str) -> tuple[str, str] | None:
    """Return (ref_from, ref_to) for 'S:A:W' or 'S:A:W1-S:A:W2'."""
    if not ref or ":" not in ref:
        return None
    parts = ref.split("-", 1)
    return parts[0], parts[-1]


def _loc_tuple(loc: str) -> tuple[int, int, int] | None:
    """Parse 'S:A:W' location into (surah, ayah, word) ints."""
    try:
        s, a, w = loc.split(":")
        return int(s), int(a), int(w)
    except (ValueError, AttributeError):
        return None


def _ref_is_subset_of(inner_ref: str, outer_ref: str) -> bool:
    """True if inner_ref's word range is contained within outer_ref's range."""
    inner = _parse_ref(inner_ref)
    outer = _parse_ref(outer_ref)
    if not inner or not outer:
        return False
    i_from = _loc_tuple(inner[0])
    i_to   = _loc_tuple(inner[1])
    o_from = _loc_tuple(outer[0])
    o_to   = _loc_tuple(outer[1])
    if not all([i_from, i_to, o_from, o_to]):
        return False
    if i_from[0] != o_from[0]:
        return False
    return o_from <= i_from and i_to <= o_to


def _is_genuine_repeat(seg: SegmentInfo) -> bool:
    """A segment is a genuine reciter repetition when the SDK said so."""
    return bool(seg.has_repeated_words or seg.wrap_word_ranges)


def _trailing_fragment(current: SegmentInfo, nxt: SegmentInfo) -> bool:
    """True when nxt is a trailing single-word fragment of current."""
    gap = nxt.start_time - current.end_time

    if gap > ADJACENT_GAP_THRESH_S or gap < -ADJACENT_GAP_THRESH_S:
        return False

    if _is_genuine_repeat(current) or _is_genuine_repeat(nxt):
        return False

    nxt_words = nxt.words or []
    if not nxt_words or len(nxt_words) > 2:
        return False

    curr_locs = {w.get("location") for w in (current.words or []) if w.get("location")}
    nxt_locs  = {w.get("location") for w in nxt_words if w.get("location")}

    if not nxt_locs:
        return False

    return nxt_locs <= curr_locs


def _trim_head_overlap(current: SegmentInfo, nxt: SegmentInfo) -> SegmentInfo | None:
    """Trims duplicate head word from nxt if it matches current's last word location."""
    if _is_genuine_repeat(current) or _is_genuine_repeat(nxt):
        return None
    if nxt.start_time - current.end_time > ADJACENT_GAP_THRESH_S:
        return None

    curr_words = current.words or []
    nxt_words = nxt.words or []
    if not curr_words or not nxt_words or len(nxt_words) <= 1:
        return None

    last_curr_loc = curr_words[-1].get("location")
    first_nxt_loc = nxt_words[0].get("location")

    if not last_curr_loc or not first_nxt_loc or last_curr_loc != first_nxt_loc:
        return None

    if last_curr_loc.startswith("0:0:"):
        return None

    trimmed_words = nxt_words[1:]
    new_locs = [w.get("location") for w in trimmed_words if w.get("location") and not w.get("location", "").startswith("0:0:")]
    if not new_locs:
        return None

    ref_from = new_locs[0]
    ref_to = new_locs[-1]
    new_ref = ref_from if ref_from == ref_to else f"{ref_from}-{ref_to}"
    new_text = " ".join(w.get("word", "") for w in trimmed_words if not w.get("is_missing"))
    new_start = round(nxt.start_time + (trimmed_words[0].get("start", 0.0) or 0.0), 3)

    offset = new_start - nxt.start_time
    adjusted_words = []
    for w in trimmed_words:
        entry = dict(w)
        if entry.get("start") is not None:
            entry["start"] = round(max(0.0, entry["start"] - offset), 4)
        if entry.get("end") is not None:
            entry["end"] = round(max(0.0, entry["end"] - offset), 4)
        adjusted_words.append(entry)

    print(f"[DEDUP] Trimmed head overlap '{first_nxt_loc}' from nxt segment: {nxt.matched_ref!r} -> {new_ref!r}")
    return SegmentInfo(
        start_time=new_start,
        end_time=nxt.end_time,
        transcribed_text=nxt.transcribed_text,
        matched_text=new_text,
        matched_ref=new_ref,
        match_score=nxt.match_score,
        error=nxt.error,
        has_missing_words=nxt.has_missing_words,
        has_repeated_words=nxt.has_repeated_words,
        wrap_word_ranges=nxt.wrap_word_ranges,
        repeated_ranges=nxt.repeated_ranges,
        repeated_text=nxt.repeated_text,
        words=adjusted_words,
        _original_alignment_idx=nxt._original_alignment_idx,
    )


def _transfer_leading_conjunction(current: SegmentInfo, nxt: SegmentInfo) -> tuple[SegmentInfo, SegmentInfo] | None:
    """Transfers a trailing leading conjunction (like 'وَإِنْ') from current to nxt when reciter paused before it."""
    curr_words = current.words or []
    nxt_words = nxt.words or []

    if len(curr_words) < 2 or not nxt_words:
        return None

    last_curr_word = curr_words[-1]
    last_word_text = last_curr_word.get("word", "")

    if not any(last_word_text.startswith(p) or last_word_text == p for p in LEADING_PARTICLES):
        return None

    prev_curr_word = curr_words[-2]
    prev_word_text = prev_curr_word.get("word", "")
    if not any(m in prev_word_text for m in WAQF_MARKS):
        return None

    last_curr_loc = _loc_tuple(last_curr_word.get("location", ""))
    first_nxt_loc = _loc_tuple(nxt_words[0].get("location", ""))
    if not last_curr_loc or not first_nxt_loc:
        return None

    if last_curr_loc[0] == first_nxt_loc[0] and last_curr_loc[1] == first_nxt_loc[1] and last_curr_loc[2] + 1 == first_nxt_loc[2]:
        new_curr_words = curr_words[:-1]
        c_locs = [w.get("location") for w in new_curr_words if w.get("location") and not w.get("location","").startswith("0:0:")]
        if not c_locs:
            return None
        c_ref = c_locs[0] if c_locs[0] == c_locs[-1] else f"{c_locs[0]}-{c_locs[-1]}"
        c_text = " ".join(w.get("word", "") for w in new_curr_words if not w.get("is_missing"))
        c_end = round(current.start_time + (new_curr_words[-1].get("end", 0.0) or 0.0), 3)

        new_curr = SegmentInfo(
            start_time=current.start_time,
            end_time=c_end,
            transcribed_text=current.transcribed_text,
            matched_text=c_text,
            matched_ref=c_ref,
            match_score=current.match_score,
            error=current.error,
            has_missing_words=current.has_missing_words,
            has_repeated_words=current.has_repeated_words,
            wrap_word_ranges=current.wrap_word_ranges,
            repeated_ranges=current.repeated_ranges,
            repeated_text=current.repeated_text,
            words=new_curr_words,
            _original_alignment_idx=current._original_alignment_idx,
        )

        new_nxt_start = current.start_time + (last_curr_word.get("start", 0.0) or 0.0)
        new_nxt_start = round(new_nxt_start, 3)

        prep_word = dict(last_curr_word)
        prep_word["start"] = 0.0
        prep_word["end"] = round((last_curr_word.get("end", 0.0) or 0.0) - (last_curr_word.get("start", 0.0) or 0.0), 4)

        duration = prep_word["end"]
        new_nxt_words = [prep_word]
        for w in nxt_words:
            entry = dict(w)
            orig_abs_start = nxt.start_time + (w.get("start", 0.0) or 0.0)
            orig_abs_end = nxt.start_time + (w.get("end", 0.0) or 0.0)
            
            if entry.get("start") is not None:
                entry["start"] = round(max(0.0, orig_abs_start - new_nxt_start), 4)
            if entry.get("end") is not None:
                entry["end"] = round(max(0.0, orig_abs_end - new_nxt_start), 4)
            new_nxt_words.append(entry)

        n_locs = [w.get("location") for w in new_nxt_words if w.get("location") and not w.get("location","").startswith("0:0:")]
        n_ref = n_locs[0] if n_locs[0] == n_locs[-1] else f"{n_locs[0]}-{n_locs[-1]}"
        n_text = " ".join(w.get("word", "") for w in new_nxt_words if not w.get("is_missing"))

        new_nxt = SegmentInfo(
            start_time=new_nxt_start,
            end_time=nxt.end_time,
            transcribed_text=nxt.transcribed_text,
            matched_text=n_text,
            matched_ref=n_ref,
            match_score=nxt.match_score,
            error=nxt.error,
            has_missing_words=nxt.has_missing_words,
            has_repeated_words=nxt.has_repeated_words,
            wrap_word_ranges=nxt.wrap_word_ranges,
            repeated_ranges=nxt.repeated_ranges,
            repeated_text=nxt.repeated_text,
            words=new_nxt_words,
            _original_alignment_idx=nxt._original_alignment_idx,
        )
        print(f"[DEDUP] Transferred leading particle '{last_word_text}' from seg end to nxt seg start.")
        return new_curr, new_nxt

    return None


def dedup_vad_overlaps(segments: list[SegmentInfo]) -> list[SegmentInfo]:
    """Remove phantom duplicate/fragment segments and trim head overlaps from VAD chunking."""
    if not segments:
        return segments

    # Merge false VAD splits in the same Ayah FIRST, before any transfers
    segments = merge_continuous_vad_splits(segments)

    try:
        from qua_sdk.domain import SPECIAL_NAMES as _SPECIALS
    except Exception:
        _SPECIALS = set()

    result: list[SegmentInfo] = []
    n_removed = 0
    current = segments[0]

    for nxt in segments[1:]:
        curr_is_special = getattr(current, "matched_ref", None) in _SPECIALS
        nxt_is_special  = getattr(nxt,     "matched_ref", None) in _SPECIALS
        if curr_is_special or nxt_is_special:
            result.append(current)
            current = nxt
            continue

        # Check leading particle transfer
        trans_res = _transfer_leading_conjunction(current, nxt)
        if trans_res is not None:
            current, nxt = trans_res

        # Check head overlap trimming
        trimmed_nxt = _trim_head_overlap(current, nxt)
        if trimmed_nxt is not None:
            nxt = trimmed_nxt

        curr_ref = current.matched_ref or ""
        nxt_ref  = nxt.matched_ref     or ""

        # ── Case 1: Overlap artifact ─────────────────────────────────────
        time_overlaps = nxt.start_time < current.end_time - 0.001
        if time_overlaps:
            nxt_is_subset  = _ref_is_subset_of(nxt_ref,  curr_ref)
            curr_is_subset = (not nxt_is_subset) and _ref_is_subset_of(curr_ref, nxt_ref)
            curr_genuine   = _is_genuine_repeat(current)
            nxt_genuine    = _is_genuine_repeat(nxt)

            if nxt_is_subset and not nxt_genuine and not curr_genuine:
                new_end = max(current.end_time, nxt.end_time)
                current = _extend_end(current, new_end)
                n_removed += 1
                print(f"[DEDUP] Overlap artifact dropped: ref={nxt_ref!r} ⊂ {curr_ref!r}")
                continue

            if curr_is_subset and not curr_genuine and not nxt_genuine:
                n_removed += 1
                print(f"[DEDUP] Overlap artifact dropped (reversed): ref={curr_ref!r} ⊂ {nxt_ref!r}")
                current = nxt
                continue

        # ── Case 2: Trailing fragment ────────────────────────────────────
        if _trailing_fragment(current, nxt):
            new_end = max(current.end_time, nxt.end_time)
            current = _extend_end(current, new_end)
            n_removed += 1
            print(f"[DEDUP] Trailing fragment dropped: ref={nxt_ref!r} (already in {curr_ref!r})")
            continue

        result.append(current)
        current = nxt

    result.append(current)

    if n_removed:
        print(f"[DEDUP] Removed {n_removed} VAD-artifact segment(s).")
    else:
        print("[DEDUP] Cleaned segment boundaries.")

    return result


def _extend_end(seg: SegmentInfo, new_end: float) -> SegmentInfo:
    """Return a copy of seg with end_time extended to new_end."""
    return SegmentInfo(
        start_time=seg.start_time,
        end_time=new_end,
        transcribed_text=seg.transcribed_text,
        matched_text=seg.matched_text,
        matched_ref=seg.matched_ref,
        match_score=seg.match_score,
        error=seg.error,
        has_missing_words=seg.has_missing_words,
        has_repeated_words=seg.has_repeated_words,
        wrap_word_ranges=seg.wrap_word_ranges,
        repeated_ranges=seg.repeated_ranges,
        repeated_text=seg.repeated_text,
        words=seg.words,
        _original_alignment_idx=seg._original_alignment_idx,
    )


def merge_continuous_vad_splits(segments: list[SegmentInfo]) -> list[SegmentInfo]:
    """Merge close same-Ayah VAD segments unless an acoustic split must be retained."""
    MIN_SPLIT_GAP_S = 0.4
    if not segments:
        return segments
        
    result = []
    current = segments[0]
    
    for nxt in segments[1:]:
        curr_ref = current.matched_ref or ""
        nxt_ref = nxt.matched_ref or ""
        
        c_parts = curr_ref.split("-")[0].split(":")
        n_parts = nxt_ref.split("-")[0].split(":")
        
        same_ayah = (len(c_parts) >= 2 and len(n_parts) >= 2 and 
                     c_parts[0] == n_parts[0] and c_parts[1] == n_parts[1])
                     
        if same_ayah and not nxt._preserve_split_before:
            curr_words = current.words or []
            nxt_words = nxt.words or []
            last_word = curr_words[-1] if curr_words else None
            first_word = nxt_words[0] if nxt_words else None
            
            c_end_time = current.start_time + (last_word.get("end", 0.0) if last_word else 0.0)
            n_start_time = nxt.start_time + (first_word.get("start", 0.0) if first_word else 0.0)
            
            gap = n_start_time - c_end_time
            if '17:56' in curr_ref or '17:56' in nxt_ref:
                print(f"[DEBUG 17:56] curr_ref={curr_ref} nxt_ref={nxt_ref} gap={gap} c_end={c_end_time} n_start={n_start_time}")
                
            if gap < MIN_SPLIT_GAP_S:
                current = _merge_two_segments(current, nxt)
                print(f"[DEDUP] Fused continuous false VAD split in same ayah: {current.matched_ref}")
                continue
                
        result.append(current)
        current = nxt
        
    result.append(current)
    return result


def _merge_two_segments(seg1: SegmentInfo, seg2: SegmentInfo) -> SegmentInfo:
    words1 = seg1.words or []
    words2 = seg2.words or []
    
    merged_words = list(words1)
    
    offset = seg2.start_time - seg1.start_time
    for w in words2:
        entry = dict(w)
        if entry.get("start") is not None:
            entry["start"] = round(entry["start"] + offset, 4)
        if entry.get("end") is not None:
            entry["end"] = round(entry["end"] + offset, 4)
        merged_words.append(entry)
        
    locs = [w.get("location") for w in merged_words if w.get("location") and not w.get("location", "").startswith("0:0:")]
    new_ref = locs[0] if locs and locs[0] == locs[-1] else f"{locs[0]}-{locs[-1]}" if locs else seg1.matched_ref
    
    new_text = " ".join(w.get("word", "") for w in merged_words if not w.get("is_missing"))
    
    has_rep = seg1.has_repeated_words or seg2.has_repeated_words
    wrap_ranges = seg1.wrap_word_ranges or seg2.wrap_word_ranges
    
    return SegmentInfo(
        start_time=seg1.start_time,
        end_time=seg2.end_time,
        transcribed_text=seg1.transcribed_text,
        matched_text=new_text,
        matched_ref=new_ref,
        match_score=min(seg1.match_score, seg2.match_score),
        error=seg1.error or seg2.error,
        has_missing_words=seg1.has_missing_words or seg2.has_missing_words,
        has_repeated_words=has_rep,
        wrap_word_ranges=wrap_ranges,
        repeated_ranges=seg1.repeated_ranges,
        repeated_text=seg1.repeated_text,
        words=merged_words,
        _original_alignment_idx=seg1._original_alignment_idx,
    )
