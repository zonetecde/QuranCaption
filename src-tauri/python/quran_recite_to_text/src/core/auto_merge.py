"""Auto-Merge: Handling natural pauses (Waqf / Sakt) and fusing same-Ayah fragments."""

from __future__ import annotations
import uuid
from qua_sdk.schemas import AlignedSegment, Alignment, Regions
from config import AUTO_MERGE_GROUP_PREFIX
from src.core.segment_types import SegmentInfo


def waqf_sakt_consumed_by_target(alignment: Alignment) -> dict[int, AlignedSegment]:
    """Scans alignment results for segments absorbed due to Waqf/Sakt pauses."""
    out: dict[int, AlignedSegment] = {}
    for seg in alignment.segments:
        if seg.merged_into is not None and getattr(seg, "merge_reason", None) == "waqf_sakt":
            out[seg.merged_into] = seg
    return out


def stamp_auto_merge_group(info: SegmentInfo, target: AlignedSegment,
                           consumed: AlignedSegment, regions: Regions) -> None:
    """Stamps unique merge_group_id and stashes member JSON for pre-merge restoration."""
    member_a = _target_half(info, target, consumed, regions)
    if member_a is None:
        return
    member_b = _consumed_half(consumed)
    info.merge_group_id = f"{AUTO_MERGE_GROUP_PREFIX}{uuid.uuid4().hex[:8]}"
    info.merge_members = [member_a.to_json_dict(), member_b.to_json_dict()]


def _target_half(info: SegmentInfo, target: AlignedSegment,
                 consumed: AlignedSegment, regions: Regions) -> SegmentInfo | None:
    a_ref = _ref_before_consumed(target.matched_ref or "", consumed.matched_ref or "")
    if a_ref is None:
        return None

    end_s = regions.regions[target.id].end_s if target.id < len(regions.regions) else consumed.region.start_s

    return SegmentInfo(
        start_time=target.region.start_s,
        end_time=end_s,
        transcribed_text="",
        matched_text=_text_without_consumed_suffix(info.matched_text or "", consumed.matched_text or "", a_ref),
        matched_ref=a_ref,
        match_score=info.match_score,
    )


def _consumed_half(consumed: AlignedSegment) -> SegmentInfo:
    from src.core.sdk_adapt import derive_repetition

    ref = consumed.matched_ref or ""
    wrap_ranges = consumed.wrap_word_ranges
    rep_ranges, rep_text = derive_repetition(ref, wrap_ranges)

    return SegmentInfo(
        start_time=consumed.region.start_s,
        end_time=consumed.region.end_s,
        transcribed_text="",
        matched_text=consumed.matched_text,
        matched_ref=ref,
        match_score=consumed.confidence,
        has_repeated_words=bool(wrap_ranges),
        wrap_word_ranges=wrap_ranges,
        repeated_ranges=rep_ranges,
        repeated_text=rep_text,
    )


def _ref_before_consumed(target_ref: str, consumed_ref: str) -> str | None:
    start = target_ref.split("-")[0]
    consumed_start = consumed_ref.split("-")[0]
    parts = consumed_start.split(":")

    if not start or len(parts) != 3:
        return None

    try:
        surah, ayah, word = (int(p) for p in parts)
    except ValueError:
        return None

    if word < 2:
        return None

    prev_loc = f"{surah}:{ayah}:{word - 1}"
    return prev_loc if start == prev_loc else f"{start}-{prev_loc}"


def _text_without_consumed_suffix(merged_text: str, consumed_text: str, a_ref: str) -> str:
    if consumed_text and merged_text.endswith(consumed_text):
        return merged_text[: len(merged_text) - len(consumed_text)].rstrip()

    from src.core.quran_index import get_quran_index
    qi = get_quran_index()
    indices = qi.ref_to_indices(a_ref)
    if not indices:
        return merged_text
    s_i, e_i = indices
    return " ".join(w.text for w in qi.words[s_i:e_i + 1])


def fuse_adjacent_same_ayah_segments(segments: list[SegmentInfo]) -> list[SegmentInfo]:
    """Fuses adjacent segments belonging to the SAME Ayah into a single unified card."""
    try:
        from config import ENABLE_SAME_AYAH_FUSION
    except ImportError:
        ENABLE_SAME_AYAH_FUSION = True

    if not ENABLE_SAME_AYAH_FUSION or not segments:
        return segments

    merged = []
    i, n, n_fused = 0, len(segments), 0

    while i < n:
        curr = segments[i]
        rf = str(curr.matched_ref or "")
        if not rf or ":" not in rf:
            merged.append(curr)
            i += 1
            continue
        p = rf.split("-")[0].split(":")
        if len(p) < 2:
            merged.append(curr)
            i += 1
            continue
        s_id, a_id = p[0], p[1]

        to_fuse = [curr]
        j = i + 1
        while j < n:
            n_rf = str(segments[j].matched_ref or "")
            if not n_rf or ":" not in n_rf:
                break
            np = n_rf.split("-")[0].split(":")
            if len(np) >= 2 and np[0] == s_id and np[1] == a_id:
                to_fuse.append(segments[j])
                j += 1
            else:
                break

        if len(to_fuse) == 1:
            merged.append(curr)
            i += 1
        else:
            first, last = to_fuse[0], to_fuse[-1]
            fused_ref_start = first.matched_ref.split("-")[0]
            fused_ref_end = last.matched_ref.split("-")[-1]
            fused_ref = f"{fused_ref_start}-{fused_ref_end}"

            fused_text = " ".join(s.matched_text for s in to_fuse if s.matched_text)
            fused_words = []
            for s in to_fuse:
                if s.words:
                    fused_words.extend(s.words)

            from src.core.quran_index import parse_location_key
            fused_words.sort(key=parse_location_key)

            fused_seg = SegmentInfo(
                start_time=first.start_time,
                end_time=last.end_time,
                transcribed_text="",
                matched_text=fused_text,
                matched_ref=fused_ref,
                match_score=min(s.match_score for s in to_fuse),
                words=fused_words,
                has_missing_words=any(s.has_missing_words for s in to_fuse),
                has_repeated_words=any(s.has_repeated_words for s in to_fuse),
            )
            merged.append(fused_seg)
            n_fused += (len(to_fuse) - 1)
            i = j

    if n_fused > 0:
        print(f"[SAME_AYAH_FUSE] Fused {n_fused} adjacent same-ayah segments.")
    return merged
