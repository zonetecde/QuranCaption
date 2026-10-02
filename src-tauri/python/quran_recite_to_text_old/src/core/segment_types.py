"""Data types for the alignment and segmentation pipeline."""

from dataclasses import dataclass
from typing import Optional


def compute_reading_sequence(ref_from: str, ref_to: str, wrap_word_ranges: list) -> list:
    """Reconstructs recitation reading sequence [[ref_from, ref_to], ...] from wrap data."""
    if wrap_word_ranges and len(wrap_word_ranges[0]) >= 3:
        sections = [[ref_from, wrap_word_ranges[0][1]]]
        for wr in wrap_word_ranges:
            sections.append([wr[0], wr[2]])
        return sections

    sections = [[ref_from, wrap_word_ranges[0][1]]]
    for i in range(len(wrap_word_ranges) - 1):
        sections.append([wrap_word_ranges[i][0], wrap_word_ranges[i + 1][1]])
    sections.append([wrap_word_ranges[-1][0], ref_to])
    return sections


@dataclass
class SegmentInfo:
    """Processed segment representation containing timing and aligned Quranic text."""
    start_time: float
    end_time: float
    transcribed_text: str
    matched_text: str
    matched_ref: str
    match_score: float
    error: Optional[str] = None
    has_missing_words: bool = False
    has_repeated_words: bool = False
    wrap_word_ranges: Optional[list] = None
    repeated_ranges: Optional[list] = None
    repeated_text: Optional[list] = None
    segment_number: int = 0
    words: Optional[list] = None
    _original_alignment_idx: Optional[int] = None
    _asr_word_gaps: Optional[list] = None
    _acoustic_word_gaps: Optional[list] = None
    _preserve_split_before: bool = False
    split_group_id: Optional[str] = None
    merge_group_id: Optional[str] = None
    merge_members: Optional[list] = None
    partial_merge_leftover: Optional[str] = None
    duplicated: bool = False
    duplicate_kind: Optional[str] = None
    duplicate_context: Optional[str] = None
    duplicated_by_segment: Optional[int] = None

    def to_json_dict(self, include_words: bool = False, include_letters: bool = False) -> dict:
        """Serializes segment to canonical JSON structure."""
        from qua_sdk.domain import SPECIAL_NAMES as ALL_SPECIAL_REFS
        is_special = self.matched_ref in ALL_SPECIAL_REFS

        if is_special:
            ref_from, ref_to = "", ""
        elif self.matched_ref and "-" in self.matched_ref:
            parts = self.matched_ref.split("-", 1)
            ref_from, ref_to = parts[0], parts[1]
        else:
            ref_from = ref_to = self.matched_ref or ""

        d = {
            "segment": self.segment_number,
            "time_from": round(self.start_time, 3),
            "time_to": round(self.end_time, 3),
            "ref_from": ref_from,
            "ref_to": ref_to,
            "matched_text": self.matched_text or "",
            "confidence": round(self.match_score, 3),
            "has_missing_words": self.has_missing_words,
            "has_repeated_words": self.has_repeated_words,
            "special_type": self.matched_ref if is_special else None,
            "error": self.error,
        }

        if self.wrap_word_ranges:
            d["wrap_word_ranges"] = self.wrap_word_ranges
        if self.repeated_ranges:
            d["repeated_ranges"] = self.repeated_ranges
        if self.repeated_text:
            d["repeated_text"] = self.repeated_text

        if include_words and self.words is not None:
            if include_letters:
                d["words"] = [dict(w) for w in self.words]
            else:
                d["words"] = [{k: v for k, v in w.items() if k != "letters"} for w in self.words]

        if self.split_group_id:
            d["split_group_id"] = self.split_group_id
        if self.merge_group_id:
            d["merge_group_id"] = self.merge_group_id
        if self.merge_members:
            d["merge_members"] = self.merge_members
        if self.partial_merge_leftover:
            d["partial_merge_leftover"] = self.partial_merge_leftover
        if self.duplicated:
            d["duplicated"] = True
        if self.duplicate_kind is not None:
            d["duplicate_kind"] = self.duplicate_kind
        if self.duplicate_context is not None:
            d["duplicate_context"] = self.duplicate_context
        if self.duplicated_by_segment is not None:
            d["duplicated_by_segment"] = self.duplicated_by_segment

        return d


def segments_to_json(segments: list, include_words: bool = False) -> dict:
    """Converts SegmentInfo list into canonical JSON dictionary format."""
    return {"segments": [seg.to_json_dict(include_words=include_words) for seg in segments]}


@dataclass
class ProfilingData:
    """Performance profiling metrics."""
    audio_duration_s: float = 0.0
    resample_time: float = 0.0
    vad_model_load_time: float = 0.0
    vad_model_move_time: float = 0.0
    vad_inference_time: float = 0.0
    vad_gpu_time: float = 0.0
    vad_wall_time: float = 0.0
    asr_time: float = 0.0
    asr_gpu_time: float = 0.0
    asr_model_move_time: float = 0.0
    asr_sorting_time: float = 0.0
    asr_batch_build_time: float = 0.0
    asr_batch_profiling: list = None
    anchor_time: float = 0.0
    phoneme_total_time: float = 0.0
    phoneme_ref_build_time: float = 0.0
    phoneme_dp_total_time: float = 0.0
    phoneme_dp_min_time: float = 0.0
    phoneme_dp_max_time: float = 0.0
    phoneme_window_setup_time: float = 0.0
    phoneme_result_build_time: float = 0.0
    phoneme_num_segments: int = 0
    match_wall_time: float = 0.0
    retry_attempts: int = 0
    retry_passed: int = 0
    retry_segments: list = None
    consec_reanchors: int = 0
    segments_attempted: int = 0
    segments_passed: int = 0
    special_merges: int = 0
    transition_skips: int = 0
    phoneme_wraps_detected: int = 0
    result_build_time: float = 0.0
    result_audio_encode_time: float = 0.0
    gpu_peak_vram_mb: float = 0.0
    gpu_reserved_vram_mb: float = 0.0
    total_time: float = 0.0
