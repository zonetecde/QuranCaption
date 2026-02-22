"""Data types for the segmentation pipeline."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class VadSegment:
    """Raw VAD segment with timing info."""
    start_time: float
    end_time: float
    segment_idx: int


@dataclass
class SegmentInfo:
    """Processed segment with transcription and matching results."""
    start_time: float
    end_time: float
    transcribed_text: str
    matched_text: str
    matched_ref: str  # e.g. "2:255:1-2:255:5"
    match_score: float
    error: Optional[str] = None
    has_missing_words: bool = False
    potentially_undersegmented: bool = False


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
    tier1_attempts: int = 0
    tier1_passed: int = 0
    tier1_segments: list = None
    tier2_attempts: int = 0
    tier2_passed: int = 0
    tier2_segments: list = None
    consec_reanchors: int = 0
    segments_attempted: int = 0
    segments_passed: int = 0
    special_merges: int = 0
    transition_skips: int = 0
    # Result building profiling
    result_build_time: float = 0.0           # Total result building time
    result_audio_encode_time: float = 0.0    # Audio-to-data-URL encoding
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
                lines.append(
                    f"    Batch {b['batch_num']:>2}: {b['size']:>3} segs | "
                    f"{b['time']:.3f}s | "
                    f"{b['min_dur']:.2f}-{b['max_dur']:.2f}s "
                    f"(A {b['avg_dur']:.2f}s, T {b['total_seconds']:.1f}s, W {b['pad_waste']:.0%})"
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
        t1_segs = self.tier1_segments or []
        t2_segs = self.tier2_segments or []
        lines += [
            f"  Alignment Stats:",
            f"    Attempted:       {self.segments_attempted}",
            f"    Passed:          {self.segments_passed}  ({pct:.1f}%)",
            f"    Tier 1 Retries:  {self.tier1_passed}/{self.tier1_attempts} passed   segments: {t1_segs}",
            f"    Tier 2 Retries:  {self.tier2_passed}/{self.tier2_attempts} passed   segments: {t2_segs}",
            f"    Reanchors (consec failures): {self.consec_reanchors}",
            f"    Special Merges:  {self.special_merges}",
            f"    Transition Skips: {self.transition_skips}",
            "-" * 60,
        ]
        profiled_sum = (self.resample_time + self.vad_wall_time + self.asr_time
                        + self.anchor_time + self.match_wall_time + self.result_build_time)
        unaccounted = self.total_time - profiled_sum
        lines += [
            f"  PROFILED SUM:      {_fmt(profiled_sum)}",
            f"  TOTAL (wall):      {_fmt(self.total_time)}   (unaccounted: {_fmt(unaccounted)})",
            "=" * 60,
        ]
        return "\n".join(lines)
