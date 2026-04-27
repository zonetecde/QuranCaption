"""Data types for the segmentation pipeline."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class VadSegment:
    """Raw VAD segment with timing info."""
    start_time: float
    end_time: float
    segment_idx: int


def compute_reading_sequence(ref_from: str, ref_to: str,
                             wrap_word_ranges: list) -> list:
    """Return reading-order [[ref_from, ref_to], ...] from wrap data.

    Given the overall matched range and the wrap points, reconstructs the
    full recitation sequence showing how the text was actually read
    (including repeated sections).

    Supports 3-element tuples (jump_to, jump_from, repeat_end) and
    legacy 2-element tuples (jump_to, jump_from).

    Example: ref "2:255:1" to "2:255:10", wrap [("2:255:3", "2:255:5", "2:255:8")]
    → [["2:255:1", "2:255:5"], ["2:255:3", "2:255:8"]]
    (read words 1-5 forward, then repeated 3-8)
    """
    if wrap_word_ranges and len(wrap_word_ranges[0]) >= 3:
        # 3-element format: (jump_to, jump_from, repeat_end)
        # Forward section: ref_from to first wrap's jump_from
        sections = [[ref_from, wrap_word_ranges[0][1]]]
        # Each wrap's actual repeated content
        for wr in wrap_word_ranges:
            sections.append([wr[0], wr[2]])
        return sections

    # Legacy 2-element format: (jump_to, jump_from)
    sections = [[ref_from, wrap_word_ranges[0][1]]]
    for i in range(len(wrap_word_ranges) - 1):
        sections.append([wrap_word_ranges[i][0], wrap_word_ranges[i + 1][1]])
    sections.append([wrap_word_ranges[-1][0], ref_to])
    return sections


@dataclass
class SegmentInfo:
    """Processed segment with transcription and matching results."""
    start_time: float
    end_time: float
    transcribed_text: str
    matched_text: str
    matched_ref: str  # e.g. "2:255:1-2:255:5" or "Basmala"
    match_score: float
    error: Optional[str] = None
    has_missing_words: bool = False
    has_repeated_words: bool = False
    wrap_word_ranges: Optional[list] = None
    repeated_ranges: Optional[list] = None   # [["2:255:1", "2:255:5"], ...]
    repeated_text: Optional[list] = None     # ["text section 1", "text section 2"]
    # 1-based segment index
    segment_number: int = 0
    # Pipeline-assigned ref before any user edits (set once on first edit, not serialized)
    _original_ref: Optional[str] = None
    # MFA word/letter timestamps (list of dicts with location, start, end, letters)
    words: Optional[list] = None
    # Index into the DebugCollector's alignment[] list (pre-split alignment order).
    # Preserved across _split_fused_segments so dp_debug lookup survives splits.
    _original_alignment_idx: Optional[int] = None
    # Shared id stamped on sub-segments produced by the Split Segments action —
    # groups sibling sub-segments from the same pre-split parent for rendering.
    split_group_id: Optional[str] = None

    def to_json_dict(self, include_words: bool = False) -> dict:
        """Convert to the JSON dict format used by exports and API.

        Word timestamps are only emitted when ``include_words=True`` — set by
        the Animate All flow, which is the only action that computes word
        timestamps for every animatable segment. Silent-MFA flows (per-segment
        animate, /split_segments, special-segment splitting) keep ``.words``
        populated in-memory as an optimization but do not surface it in the
        exported JSON.

        Letter-level timestamps are always stripped — the public API lists
        ``words+chars`` as disabled, so ``letters`` must never appear in the
        response regardless of how MFA was invoked.
        """
        from src.alignment.special_segments import ALL_SPECIAL_REFS
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
            d["words"] = [
                {k: v for k, v in w.items() if k != "letters"}
                for w in self.words
            ]
        if self.split_group_id:
            d["split_group_id"] = self.split_group_id
        return d

    @classmethod
    def from_json_dict(cls, d: dict, index: int = 0) -> 'SegmentInfo':
        """Reconstruct from a JSON dict (for loading old sessions)."""
        if d.get("special_type"):
            ref = d["special_type"]
        elif d.get("ref_to"):
            ref = f"{d['ref_from']}-{d['ref_to']}"
        else:
            ref = d.get("ref_from", "")
        return cls(
            start_time=d.get("time_from", 0),
            end_time=d.get("time_to", 0),
            transcribed_text="",
            matched_text=d.get("matched_text", ""),
            matched_ref=ref,
            match_score=d.get("confidence", 0),
            error=d.get("error"),
            has_missing_words=d.get("has_missing_words", False),
            has_repeated_words=d.get("has_repeated_words", False),
            wrap_word_ranges=d.get("wrap_word_ranges"),
            repeated_ranges=d.get("repeated_ranges"),
            repeated_text=d.get("repeated_text"),
            segment_number=d.get("segment", index + 1),
            words=d.get("words"),
            split_group_id=d.get("split_group_id"),
        )


def segments_to_json(segments: list, include_words: bool = False) -> dict:
    """Convert a list of SegmentInfo to the {"segments": [...]} JSON structure.

    See SegmentInfo.to_json_dict for the ``include_words`` semantics —
    only the Animate All flow sets it True.
    """
    return {"segments": [seg.to_json_dict(include_words=include_words) for seg in segments]}


@dataclass
class ProfilingData:
    """Profiling metrics for the processing pipeline."""
    # Preprocessing
    resample_time: float = 0.0               # Audio resampling time
    # VAD profiling
    vad_model_load_time: float = 0.0
    vad_model_move_time: float = 0.0
    vad_inference_time: float = 0.0
    vad_gpu_time: float = 0.0               # Actual GPU lease execution time
    vad_wall_time: float = 0.0              # Wall-clock time (includes queue wait)
    # Phoneme ASR profiling
    asr_time: float = 0.0                    # Wav2vec wall-clock time (includes queue wait)
    asr_gpu_time: float = 0.0               # Actual GPU lease execution time
    asr_model_move_time: float = 0.0         # ASR model GPU move time
    asr_sorting_time: float = 0.0            # Duration-sorting time
    asr_batch_build_time: float = 0.0        # Dynamic batch construction time
    asr_batch_profiling: list = None         # Per-batch timing details
    # Global anchor profiling
    anchor_time: float = 0.0                 # N-gram voting anchor detection
    # Phoneme alignment profiling
    phoneme_total_time: float = 0.0          # Overall phoneme matching time
    phoneme_ref_build_time: float = 0.0      # Time to build chapter reference
    phoneme_dp_total_time: float = 0.0       # Total DP time across all segments
    phoneme_dp_min_time: float = 0.0         # Min DP time per segment
    phoneme_dp_max_time: float = 0.0         # Max DP time per segment
    phoneme_window_setup_time: float = 0.0   # Total window slicing time
    phoneme_result_build_time: float = 0.0   # Total result construction time
    phoneme_num_segments: int = 0            # Number of segments aligned
    match_wall_time: float = 0.0             # Total matching wall-clock time
    # Retry / reanchor counters
    retry_attempts: int = 0
    retry_passed: int = 0
    retry_segments: list = None
    consec_reanchors: int = 0
    segments_attempted: int = 0
    segments_passed: int = 0
    special_merges: int = 0
    transition_skips: int = 0
    phoneme_wraps_detected: int = 0
    # Result building profiling
    result_build_time: float = 0.0           # Total result building time
    result_audio_encode_time: float = 0.0    # Audio-to-data-URL encoding
    # GPU memory profiling
    gpu_peak_vram_mb: float = 0.0            # torch.cuda.max_memory_allocated() in MB
    gpu_reserved_vram_mb: float = 0.0        # torch.cuda.max_memory_reserved() in MB
    # Total pipeline time
    total_time: float = 0.0                  # End-to-end pipeline time

    @property
    def phoneme_dp_avg_time(self) -> float:
        """Average DP time per segment."""
        if self.phoneme_num_segments == 0:
            return 0.0
        return self.phoneme_dp_total_time / self.phoneme_num_segments

    @staticmethod
    def _fmt(seconds):
        """Format seconds as m:ss.fff when >= 60s, else as s.fffs."""
        if seconds >= 60:
            m, s = divmod(seconds, 60)
            return f"{int(m)}:{s:06.3f}"
        return f"{seconds:.3f}s"

    def summary(self) -> str:
        """Return a formatted profiling summary."""
        _fmt = self._fmt
        lines = [
            "\n" + "=" * 60,
            "PROFILING SUMMARY",
            "=" * 60,
            f"  Preprocessing:",
            f"    Resample:        {self.resample_time:.3f}s",
            f"  VAD:                                 wall {_fmt(self.vad_wall_time)}",
            f"    GPU Time:        {self.vad_gpu_time:.3f}s   (queue {self.vad_wall_time - self.vad_gpu_time:.3f}s)",
            f"    Model Load:      {self.vad_model_load_time:.3f}s",
            f"    Model Move:      {self.vad_model_move_time:.3f}s",
            f"    Inference:       {self.vad_inference_time:.3f}s",
            f"  Phoneme ASR:                         wall {_fmt(self.asr_time)}",
            f"    GPU Time:        {self.asr_gpu_time:.3f}s   (queue {self.asr_time - self.asr_gpu_time:.3f}s)",
            f"    Model Move:      {self.asr_model_move_time:.3f}s",
            f"    Sorting:         {self.asr_sorting_time:.3f}s",
            f"    Batch Build:     {self.asr_batch_build_time:.3f}s",
            f"    Batches:         {len(self.asr_batch_profiling) if self.asr_batch_profiling else 0}",
        ]
        if self.asr_batch_profiling:
            for b in self.asr_batch_profiling:
                qk_per = b.get('qk_mb_per_head')
                qk_all = b.get('qk_mb_all_heads')
                qk_str = f", QK^T {qk_per:.1f} MB/head, {qk_all:.0f} MB total" if qk_per is not None else ""
                lines.append(
                    f"    Batch {b['batch_num']:>2}: {b['size']:>3} segs | "
                    f"{b['time']:.3f}s | "
                    f"{b['min_dur']:.2f}-{b['max_dur']:.2f}s "
                    f"(A {b['total_seconds']/b['size']:.2f}s, T {b['total_seconds']:.1f}s, W {b['pad_waste']:.0%}{qk_str})"
                )
        lines += [
            f"  Global Anchor:",
            f"    N-gram Voting:   {self.anchor_time:.3f}s",
            f"  Phoneme Alignment:                   wall {_fmt(self.match_wall_time)}",
            f"    Ref Build:       {self.phoneme_ref_build_time:.3f}s",
            f"    Window Setup:    {self.phoneme_window_setup_time:.3f}s",
            f"    DP Total:        {self.phoneme_dp_total_time:.3f}s",
            f"    Segments:        {self.phoneme_num_segments}",
            f"    DP Avg/segment:  {1000*self.phoneme_dp_avg_time:.3f}ms",
            f"    DP Min:          {1000*self.phoneme_dp_min_time:.3f}ms",
            f"    DP Max:          {1000*self.phoneme_dp_max_time:.3f}ms",
        ]
        pct = 100 * self.segments_passed / self.segments_attempted if self.segments_attempted else 0
        retry_segs = self.retry_segments or []
        lines += [
            f"  Alignment Stats:",
            f"    Attempted:       {self.segments_attempted}",
            f"    Passed:          {self.segments_passed}  ({pct:.1f}%)",
            f"    Retries:         {self.retry_passed}/{self.retry_attempts} passed   segments: {retry_segs}",
            f"    Reanchors (consec failures): {self.consec_reanchors}",
            f"    Special Merges:  {self.special_merges}",
            f"    Transition Skips: {self.transition_skips}",
            f"    Wraps Detected:  {self.phoneme_wraps_detected}",
            "-" * 60,
        ]
        profiled_sum = (self.resample_time + self.vad_wall_time + self.asr_time
                        + self.anchor_time + self.match_wall_time + self.result_build_time)
        unaccounted = self.total_time - profiled_sum
        lines += [
            f"  PROFILED SUM:      {_fmt(profiled_sum)}",
            f"  TOTAL (wall):      {_fmt(self.total_time)}   (unaccounted: {_fmt(unaccounted)})",
        ]
        if self.gpu_peak_vram_mb > 0:
            lines += [
                "-" * 60,
                f"  GPU VRAM Peak:     {self.gpu_peak_vram_mb:.0f} MB",
                f"  GPU VRAM Reserved: {self.gpu_reserved_vram_mb:.0f} MB",
            ]
        lines.append("=" * 60)
        return "\n".join(lines)
