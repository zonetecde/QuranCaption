"""VAD inference utilities."""

from typing import List, Tuple

import numpy as np
import torch

from .segmenter_aoti import is_aoti_applied
from .segmenter_model import load_segmenter, _log_env_once


def detect_speech_segments(
    audio: np.ndarray,
    sample_rate: int,
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int
) -> tuple[List[Tuple[float, float]], dict]:
    """
    Detect speech segments in audio using VAD.

    Args:
        audio: Audio waveform (mono, float32)
        sample_rate: Sample rate of audio
        min_silence_ms: Minimum silence duration to split segments
        min_speech_ms: Minimum speech duration for a valid segment
        pad_ms: Padding around speech segments

    Returns:
        Tuple of (intervals, profiling_dict, raw_speech_intervals, raw_is_complete) where:
        - intervals: List of (start_time, end_time) tuples in seconds
        - profiling_dict: {"model_load_time": float, "inference_time": float}
        - raw_speech_intervals: Raw VAD intervals before cleaning (for resegmentation)
        - raw_is_complete: Raw VAD completeness flags (for resegmentation)
    """
    import time

    model, processor, model_load_time = load_segmenter()
    if model is None:
        # Fallback: treat whole audio as one segment
        return [(0, len(audio) / sample_rate)], {"model_load_time": 0.0, "inference_time": 0.0}, None, None

    inference_start = time.time()
    _log_env_once()

    try:
        from recitations_segmenter import segment_recitations, clean_speech_intervals

        audio_tensor = torch.from_numpy(audio).float()

        device = next(model.parameters()).device
        dtype = next(model.parameters()).dtype

        # Log AoTI status
        if is_aoti_applied():
            print("[VAD] Using AOTInductor-compiled model")

        # Run segmentation
        outputs = segment_recitations(
            [audio_tensor], model, processor,
            device=device, dtype=dtype, batch_size=1,
        )

        if not outputs:
            inference_time = time.time() - inference_start
            return [(0, len(audio) / sample_rate)], {"model_load_time": model_load_time, "inference_time": inference_time}, None, None

        # Clean speech intervals with user parameters
        clean_out = clean_speech_intervals(
            outputs[0].speech_intervals,
            outputs[0].is_complete,
            min_silence_duration_ms=min_silence_ms,
            min_speech_duration_ms=min_speech_ms,
            pad_duration_ms=pad_ms,
            return_seconds=True,
        )

        inference_time = time.time() - inference_start
        intervals = clean_out.clean_speech_intervals.tolist()

        raw_count = len(outputs[0].speech_intervals)
        final_count = len(intervals)
        removed = raw_count - final_count
        print(f"[VAD] Raw model intervals: {raw_count}, after cleaning: {final_count} "
              f"({removed} removed by silence merge + min_speech={min_speech_ms}ms filter)")

        raw_speech_intervals = outputs[0].speech_intervals
        raw_is_complete = outputs[0].is_complete

        return [(start, end) for start, end in intervals], {"model_load_time": model_load_time, "inference_time": inference_time}, raw_speech_intervals, raw_is_complete

    except Exception as e:
        print(f"VAD error: {e}")
        import traceback
        traceback.print_exc()
        # Let gpu_with_fallback handle retries on CPU
        raise
