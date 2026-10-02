"""Splitting of combined/fused special segments (Isti'adha/Basmala)."""

from src.core.segment_types import SegmentInfo


def _split_fused_segments(segments):
    """Splits combined or fused special segments using word timestamps."""
    from qua_sdk.domain import SPECIAL_TEXT, SPECIAL_NAMES as ALL_SPECIAL_REFS

    _BASMALA_TEXT = SPECIAL_TEXT["Basmala"]
    _ISTIATHA_TEXT = SPECIAL_TEXT["Isti'adha"]
    _COMBINED_TEXT = _ISTIATHA_TEXT + " ۝ " + _BASMALA_TEXT

    _ISTIATHA_WORD_COUNT = len(_ISTIATHA_TEXT.split())
    _BASMALA_WORD_COUNT = len(_BASMALA_TEXT.split())

    split_indices = []
    for idx, seg in enumerate(segments):
        if seg.matched_ref == "Isti'adha+Basmala":
            split_indices.append((idx, "combined", "Isti'adha+Basmala", None))
        elif seg.matched_ref and seg.matched_ref not in ALL_SPECIAL_REFS and seg.matched_text:
            if seg.matched_text.startswith(_COMBINED_TEXT):
                split_indices.append((idx, "fused_combined", f"Isti'adha+Basmala+{seg.matched_ref}", seg.matched_ref))
            elif seg.matched_text.startswith(_ISTIATHA_TEXT):
                split_indices.append((idx, "fused_istiatha", f"Isti'adha+{seg.matched_ref}", seg.matched_ref))
            elif seg.matched_text.startswith(_BASMALA_TEXT):
                split_indices.append((idx, "fused_basmala", f"Basmala+{seg.matched_ref}", seg.matched_ref))

    if not split_indices:
        return segments

    new_segments = []
    split_set = {idx for idx, _, _, _ in split_indices}
    split_map = {idx: (i, case, mfa_ref, verse_ref) for i, (idx, case, mfa_ref, verse_ref) in enumerate(split_indices)}

    for idx, seg in enumerate(segments):
        if idx not in split_set:
            new_segments.append(seg)
            continue

        batch_i, case, mfa_ref, verse_ref = split_map[idx]
        words = seg.words

        if words is None:
            if case == "combined":
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
            else:
                new_segments.append(seg)
            continue

        seg_start = seg.start_time

        if case == "combined":
            istiatha_end = None
            for w in words:
                if w.get("location", "") == f"0:0:{_ISTIATHA_WORD_COUNT}":
                    istiatha_end = seg_start + w["end"]
                    break
            if istiatha_end is None:
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

        elif case == "fused_combined":
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
                _original_alignment_idx=seg._original_alignment_idx,
            ))

        elif case == "fused_istiatha":
            istiatha_end = None
            for w in words:
                if w.get("location", "") == f"0:0:{_ISTIATHA_WORD_COUNT}":
                    istiatha_end = seg_start + w["end"]
                    break
            if istiatha_end is None:
                new_segments.append(seg)
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
                _original_alignment_idx=seg._original_alignment_idx,
            ))

        elif case == "fused_basmala":
            basmala_end = None
            for w in words:
                if w.get("location", "") == f"0:0:{_BASMALA_WORD_COUNT}":
                    basmala_end = seg_start + w["end"]
                    break
            if basmala_end is None:
                new_segments.append(seg)
                continue

            verse_text = seg.matched_text
            if verse_text.startswith(_BASMALA_TEXT):
                verse_text = verse_text[len(_BASMALA_TEXT):].lstrip()

            verse_words, basmala_words = None, None
            verse_asr_gaps, verse_acoustic_gaps = None, None
            verse_start = basmala_end
            if seg.words:
                split_rel = basmala_end - seg.start_time
                b_list, v_list = [], []
                v_asr_gaps, v_acoustic_gaps = [], []
                for word_index, w in enumerate(seg.words):
                    w_copy = dict(w)
                    loc = w_copy.get("location", "")
                    if loc.startswith("0:0:"):
                        b_list.append(w_copy)
                    else:
                        if w_copy.get("start") is not None:
                            w_copy["start"] = max(0.0, round(w_copy["start"] - split_rel, 4))
                        if w_copy.get("end") is not None:
                            w_copy["end"] = max(0.0, round(w_copy["end"] - split_rel, 4))
                        v_list.append(w_copy)
                        v_asr_gaps.append(
                            seg._asr_word_gaps[word_index]
                            if seg._asr_word_gaps and word_index < len(seg._asr_word_gaps)
                            else None
                        )
                        v_acoustic_gaps.append(
                            seg._acoustic_word_gaps[word_index]
                            if seg._acoustic_word_gaps
                            and word_index < len(seg._acoustic_word_gaps)
                            else None
                        )

                verse_offset = v_list[0].get("start") if v_list else None
                if verse_offset is not None and verse_offset > 0:
                    verse_start += verse_offset
                    for word in v_list:
                        if word.get("start") is not None:
                            word["start"] = max(0.0, round(word["start"] - verse_offset, 4))
                        if word.get("end") is not None:
                            word["end"] = max(0.0, round(word["end"] - verse_offset, 4))
                basmala_words = b_list or None
                verse_words = v_list or None
                verse_asr_gaps = ([None] + v_asr_gaps[1:]) if v_asr_gaps else None
                verse_acoustic_gaps = (
                    [None] + v_acoustic_gaps[1:] if v_acoustic_gaps else None
                )

            new_segments.append(SegmentInfo(
                start_time=seg.start_time, end_time=basmala_end,
                transcribed_text="", matched_text=_BASMALA_TEXT,
                matched_ref="Basmala", match_score=seg.match_score,
                words=basmala_words,
            ))
            new_segments.append(SegmentInfo(
                start_time=verse_start, end_time=seg.end_time,
                transcribed_text=seg.transcribed_text, matched_text=verse_text,
                matched_ref=verse_ref, match_score=seg.match_score,
                error=seg.error, has_missing_words=seg.has_missing_words,
                words=verse_words,
                _original_alignment_idx=seg._original_alignment_idx,
                _asr_word_gaps=verse_asr_gaps,
                _acoustic_word_gaps=verse_acoustic_gaps,
            ))

    return new_segments
