"""Missing Words Computation & Injection using QUA SDK output & Quran Index."""

import json
from pathlib import Path
from src.core.segment_types import SegmentInfo
from src.core.quran_index import get_quran_index, parse_location_key

_verse_word_counts_cache = None


def _load_verse_word_counts() -> dict[int, dict[int, int]]:
    """Loads and caches verse word counts from surah_info.json."""
    global _verse_word_counts_cache
    if _verse_word_counts_cache is not None:
        return _verse_word_counts_cache

    app_path = Path(__file__).parent.parent.parent.resolve()
    surah_info_path = app_path / "data" / "surah_info.json"

    with open(surah_info_path, 'r', encoding='utf-8') as f:
        surah_info = json.load(f)

    _verse_word_counts_cache = {}
    for surah_num, data in surah_info.items():
        surah_int = int(surah_num)
        _verse_word_counts_cache[surah_int] = {
            v.get('verse'): v.get('num_words', 0)
            for v in data.get('verses', []) if v.get('verse')
        }

    return _verse_word_counts_cache


def extract_missing_word_refs(segments: list[SegmentInfo]) -> list[str]:
    """Extracts all missing word location references ('surah:ayah:word') for the audio.

    Uses QUA SDK gap_events if attached to segments; otherwise derives missing
    references using quran_index canonical word sequence.
    """
    # 1. Check for QUA SDK gap events attached to segments
    gap_events = None
    for seg in segments:
        if getattr(seg, "_gap_events", None):
            gap_events = seg._gap_events
            break

    missing_refs = []
    if gap_events:
        for ev in gap_events:
            if ev.get("event") == "gap" and "missing_word_refs" in ev:
                missing_refs.extend(ev["missing_word_refs"])
        if missing_refs:
            return missing_refs

    # 2. Derive missing references using Quran Index canonical sequence
    qi = get_quran_index()
    recited_locations = set()
    for seg in segments:
        for w in (seg.words or []):
            if w.get("location") and not w.get("is_missing"):
                recited_locations.add(w["location"])

    matched_indices = []
    for loc in recited_locations:
        idx_tuple = qi.ref_to_indices(loc)
        if idx_tuple:
            matched_indices.append(idx_tuple[0])

    if not matched_indices:
        return []

    min_idx, max_idx = min(matched_indices), max(matched_indices)

    for gi in range(min_idx, max_idx + 1):
        w_info = qi.words[gi]
        loc = f"{w_info.surah}:{w_info.ayah}:{w_info.word}"
        if loc not in recited_locations:
            missing_refs.append(loc)

    return missing_refs


def recompute_missing_words(segments: list[SegmentInfo]) -> None:
    """Marks the segment immediately before each missing canonical word range."""
    qi = get_quran_index()
    missing_indices = []
    for ref in extract_missing_word_refs(segments):
        indices = qi.ref_to_indices(ref)
        if indices:
            missing_indices.append(indices[0])

    segment_bounds: list[tuple[int, int] | None] = []
    flags = []
    for seg in segments:
        word_indices = []
        for word in seg.words or []:
            location = word.get("location")
            indices = qi.ref_to_indices(location) if location else None
            if indices and not word.get("is_missing"):
                word_indices.append(indices[0])
        segment_bounds.append(
            (min(word_indices), max(word_indices)) if word_indices else None
        )
        flags.append(any(word.get("is_missing") for word in seg.words or []))

    for missing_index in missing_indices:
        containing = [
            index
            for index, bounds in enumerate(segment_bounds)
            if bounds and bounds[0] <= missing_index <= bounds[1]
        ]
        if containing:
            flags[containing[-1]] = True
            continue

        previous = [
            (bounds[1], index)
            for index, bounds in enumerate(segment_bounds)
            if bounds and bounds[1] < missing_index
        ]
        if previous:
            flags[max(previous)[1]] = True
            continue

        following = [
            (bounds[0], index)
            for index, bounds in enumerate(segment_bounds)
            if bounds and bounds[0] > missing_index
        ]
        if following:
            flags[min(following)[1]] = True

    for seg, has_missing in zip(segments, flags):
        seg.has_missing_words = has_missing


def inject_missing_words(segments: list[SegmentInfo]) -> None:
    """Injects missing (unrecited) Quranic words into seg.words at their exact sequence position."""
    try:
        from config import ENABLE_MISSING_WORD_INJECTION
    except ImportError:
        ENABLE_MISSING_WORD_INJECTION = True

    if not ENABLE_MISSING_WORD_INJECTION or not segments:
        return

    qi = get_quran_index()
    missing_refs = extract_missing_word_refs(segments)
    if not missing_refs:
        return

    # Map missing refs by (surah, ayah)
    missing_by_sa: dict[tuple[int, int], list[str]] = {}
    for ref in missing_refs:
        parts = ref.split(":")
        if len(parts) >= 3:
            try:
                sa = (int(parts[0]), int(parts[1]))
                missing_by_sa.setdefault(sa, []).append(ref)
            except ValueError:
                pass

    for seg_idx, seg in enumerate(segments):
        if seg.words is None:
            seg.words = []

        # Determine (surah, ayah) targets for this segment
        seg_sa_list = []
        if seg.matched_ref and ":" in seg.matched_ref:
            parts = seg.matched_ref.split("-") if "-" in seg.matched_ref else (seg.matched_ref, seg.matched_ref)
            try:
                sp, ep = parts[0].split(":"), parts[1].split(":")
                s_surah, s_ayah = int(sp[0]), int(sp[1])
                e_surah, e_ayah = int(ep[0]), int(ep[1])
                for ayah in range(s_ayah, e_ayah + 1):
                    seg_sa_list.append((s_surah, ayah))
            except (ValueError, IndexError):
                pass

        if not seg_sa_list and seg.words:
            for w in seg.words:
                loc = w.get("location")
                if loc and ":" in loc:
                    p = loc.split(":")
                    if len(p) >= 2:
                        try:
                            seg_sa_list.append((int(p[0]), int(p[1])))
                        except ValueError:
                            pass

        if not seg_sa_list:
            continue

        existing_locs = {w.get("location") for w in seg.words if w.get("location")}
        injected_any = False

        for sa in seg_sa_list:
            target_missing = missing_by_sa.get(sa, [])
            for loc in target_missing:
                if loc in existing_locs:
                    continue

                q_idx_tuple = qi.ref_to_indices(loc)
                if not q_idx_tuple:
                    continue

                word_info = qi.words[q_idx_tuple[0]]
                word_text = word_info.text

                # Compute interpolated timestamps
                prev_end = seg.start_time
                next_start = seg.end_time

                for w in seg.words:
                    w_loc = w.get("location")
                    if not w_loc:
                        continue
                    if parse_location_key(w_loc) < parse_location_key(loc):
                        prev_end = max(prev_end, w.get("end", prev_end))
                    elif parse_location_key(w_loc) > parse_location_key(loc):
                        next_start = min(next_start, w.get("start", next_start))
                        break

                # Ensure valid start and end bounds
                if next_start < prev_end:
                    next_start = prev_end + 0.05

                start_t = round(prev_end, 4)
                end_t = round(next_start, 4)

                seg.words.append({
                    "word": word_text,
                    "location": loc,
                    "start": start_t,
                    "end": end_t,
                    "is_missing": True,
                })
                existing_locs.add(loc)
                injected_any = True

        if injected_any:
            seg.words.sort(key=parse_location_key)
            seg.has_missing_words = True
