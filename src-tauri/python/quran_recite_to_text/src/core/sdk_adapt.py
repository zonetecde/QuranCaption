"""Adapters between qua_sdk schemas and application data structures."""

from __future__ import annotations
import numpy as np
from qua_sdk.schemas import Alignment, Emissions, Region, Regions, Timings
from src.core.auto_merge import stamp_auto_merge_group, waqf_sakt_consumed_by_target
from src.core.segment_types import ProfilingData, SegmentInfo, compute_reading_sequence

SAMPLE_RATE = 16_000


def alignment_to_segment_infos(
    alignment: Alignment,
    emissions: Emissions,
    regions: Regions,
) -> list[SegmentInfo]:
    """Maps SDK Alignment output onto SegmentInfo list."""
    tokens = emissions.tokens
    auto_merged = waqf_sakt_consumed_by_target(alignment)
    segments: list[SegmentInfo] = []

    for seg in alignment.segments:
        if seg.merged_into is not None:
            continue

        matched_ref = seg.matched_ref or ""
        phoneme_text = " ".join(tokens[seg.id]) if seg.id < len(tokens) else ""
        wrap_ranges = seg.wrap_word_ranges
        rep_ranges, rep_text = derive_repetition(matched_ref, wrap_ranges)

        info = SegmentInfo(
            start_time=seg.region.start_s,
            end_time=seg.region.end_s,
            transcribed_text=phoneme_text,
            matched_text=seg.matched_text,
            matched_ref=matched_ref,
            match_score=seg.confidence,
            error=seg.error,
            has_missing_words=False,
            has_repeated_words=bool(wrap_ranges),
            wrap_word_ranges=wrap_ranges,
            repeated_ranges=rep_ranges,
            repeated_text=rep_text,
            _original_alignment_idx=seg.id + 1,
        )
        consumed = auto_merged.get(seg.id)
        if consumed is not None:
            stamp_auto_merge_group(info, seg, consumed, regions)
        segments.append(info)

    return segments


def derive_repetition(matched_ref: str, wrap_ranges) -> tuple[list | None, list | None]:
    """Derives reading sequence ranges and repeated texts."""
    if not (wrap_ranges and matched_ref and "-" in matched_ref):
        return None, None
    from src.core.quran_index import get_quran_index

    ref_from, ref_to = matched_ref.split("-", 1)
    rep_ranges = compute_reading_sequence(ref_from, ref_to, wrap_ranges)
    qi = get_quran_index()
    rep_text = []
    for sec_from, sec_to in rep_ranges:
        indices = qi.ref_to_indices(f"{sec_from}-{sec_to}")
        if indices:
            s_i, e_i = indices
            rep_text.append(" ".join(w.text for w in qi.words[s_i:e_i + 1]))
        else:
            rep_text.append("")
    return rep_ranges, rep_text


def timings_to_words(timings: Timings, segment_infos: list[SegmentInfo]) -> None:
    """Attaches SDK word timings onto SegmentInfo.words in-place."""
    by_id = {seg._original_alignment_idx - 1: seg for seg in segment_infos if seg._original_alignment_idx is not None}

    for st in timings.segments:
        seg = by_id.get(st.segment_id)
        if seg is None or st.words is None:
            continue
        words = []
        for w in st.words:
            entry = {"location": w.location, "start": w.start_s, "end": w.end_s}
            if w.letters:
                entry["letters"] = [{"char": ch, "start": s, "end": e} for ch, s, e in w.letters]
            if w.line_idx is not None:
                entry["line_idx"] = w.line_idx
            words.append(entry)
        seg.words = words


def regions_to_state(regions: Regions) -> tuple[np.ndarray | None, bool | None]:
    """Regions -> (sample-int ndarray, is_complete)."""
    if regions.raw is None:
        return None, regions.is_complete
    raw = np.array(
        [[round(r.start_s * SAMPLE_RATE), round(r.end_s * SAMPLE_RATE)] for r in regions.raw],
        dtype=np.int64,
    ).reshape(-1, 2)
    return raw, regions.is_complete


def intervals_from_regions(regions: Regions) -> list[tuple[float, float]]:
    """Regions -> list of (start_s, end_s) tuples."""
    return [(r.start_s, r.end_s) for r in regions.regions]


def metrics_to_profiling(stages: dict, profiling: ProfilingData) -> None:
    """Populates ProfilingData from per-stage SDK metrics."""
    seg = _metrics(stages.get("segmentation"))
    if seg:
        profiling.vad_model_load_time = seg.get("model_load_s", 0.0)
        profiling.vad_model_move_time = seg.get("model_move_s", 0.0)
        profiling.vad_inference_time = seg.get("inference_s", 0.0)

    rec = _metrics(stages.get("recognition"))
    if rec:
        profiling.asr_sorting_time = rec.get("sorting_s", 0.0)
        profiling.asr_batch_build_time = rec.get("batch_build_s", 0.0)
        profiling.asr_model_move_time = rec.get("model_move_s", 0.0)
        profiling.asr_batch_profiling = rec.get("batches") or []

    match = _metrics(stages.get("matching"))
    if match:
        profiling.retry_attempts = match.get("retry_attempts", 0)
        profiling.retry_passed = match.get("retry_passed", 0)
        profiling.retry_segments = match.get("retry_segments", [])
        profiling.consec_reanchors = match.get("consec_reanchors", 0)
        profiling.segments_attempted = match.get("segments_attempted", 0)
        profiling.segments_passed = match.get("segments_passed", 0)
        profiling.special_merges = match.get("special_merges", 0)
        profiling.transition_skips = match.get("transition_skips", 0)
        profiling.phoneme_wraps_detected = match.get("phoneme_wraps_detected", 0)
        wall = _wall_s(stages.get("matching"))
        if wall is not None:
            profiling.phoneme_total_time = wall


def _metrics(stage) -> dict | None:
    if stage is None:
        return None
    return stage.metrics if hasattr(stage, "metrics") else dict(stage)


def _wall_s(stage) -> float | None:
    return getattr(stage, "wall_s", None) if stage is not None else None
