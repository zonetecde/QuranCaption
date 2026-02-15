"""
Segment processor for VAD-based audio segmentation and text matching.

Splits audio into segments using VAD, transcribes each with Whisper,
and matches to Quran text using standalone TextMatcher.
"""
import json
import torch
import numpy as np
import librosa
from dataclasses import dataclass
from typing import List, Tuple, Optional

from .config import (
    SEGMENTER_MODEL, WHISPER_MODEL, SURAH_INFO_PATH,
    MIN_MATCH_SCORE, SPECIAL_SEGMENTS, SPECIAL_MATCH_SCORE,
)
from .text_matcher import get_text_matcher, MatchResult
from .text_preprocessor import normalize_arabic, split_words


# =============================================================================
# Data classes
# =============================================================================

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
    word_timestamps: Optional[list] = None  # [{key, start, end, type}, ...]


@dataclass
class ProfilingData:
    """Profiling metrics for the processing pipeline."""
    vad_model_load_time: float = 0.0
    vad_inference_time: float = 0.0
    asr_model_load_time: float = 0.0
    asr_inference_time: float = 0.0
    text_match_total_time: float = 0.0
    text_match_anchor_time: float = 0.0
    text_match_post_anchor_time: float = 0.0
    text_match_num_segments: int = 0

    @property
    def avg_per_segment_time(self) -> float:
        """Average time per segment in post-anchor matching."""
        if self.text_match_num_segments == 0:
            return 0.0
        return self.text_match_post_anchor_time / self.text_match_num_segments

    def summary(self) -> str:
        """Return a formatted profiling summary."""
        lines = [
            "\n" + "=" * 60,
            "PROFILING SUMMARY",
            "=" * 60,
            f"  VAD:",
            f"    Model Load:      {self.vad_model_load_time:.3f}s",
            f"    Inference:       {self.vad_inference_time:.3f}s",
            f"  ASR:",
            f"    Model Load:      {self.asr_model_load_time:.3f}s",
            f"    Inference:       {self.asr_inference_time:.3f}s",
            f"  Text Matching:",
            f"    Total:           {self.text_match_total_time:.3f}s",
            f"    Anchor Search:   {self.text_match_anchor_time:.3f}s",
            f"    Post-anchor:     {self.text_match_post_anchor_time:.3f}s",
            f"    Segments:        {self.text_match_num_segments}",
            f"    Avg/segment:     {1000*self.avg_per_segment_time:.3f}ms",
            "=" * 60,
        ]
        return "\n".join(lines)


# =============================================================================
# Model caches
# =============================================================================

_segmenter_cache = {"model": None, "processor": None, "loaded": False, "load_time": 0.0}
_whisper_cache = {"model": None, "processor": None, "gen_config": None, "loaded": False, "load_time": 0.0}
_surah_info_cache = {"loaded": False, "data": None}


def _get_device_and_dtype():
    """Get the best available device and dtype."""
    if torch.cuda.is_available():
        return torch.device("cuda"), torch.float16
    return torch.device("cpu"), torch.float32


def ensure_models_on_gpu():
    """
    Move models to GPU if available. Call this INSIDE a GPU-decorated function
    after ZeroGPU lease is acquired.

    On ZeroGPU, CUDA isn't available until inside the decorated function.
    Models loaded before that will be on CPU. This function moves them to GPU.
    """
    if not torch.cuda.is_available():
        return  # No GPU available

    device = torch.device("cuda")
    dtype = torch.float16

    # Move segmenter to GPU
    if _segmenter_cache["loaded"] and _segmenter_cache["model"] is not None:
        model = _segmenter_cache["model"]
        if next(model.parameters()).device.type != "cuda":
            print("[GPU] Moving segmenter to CUDA...")
            model.to(device, dtype=dtype)
            print("[GPU] Segmenter on CUDA")

    # Move Whisper to GPU
    if _whisper_cache["loaded"] and _whisper_cache["model"] is not None:
        model = _whisper_cache["model"]
        if next(model.parameters()).device.type != "cuda":
            print("[GPU] Moving Whisper to CUDA...")
            model.to(device, dtype=dtype)
            print("[GPU] Whisper on CUDA")

def _load_surah_info():
    """Load surah info JSON with caching."""
    if _surah_info_cache["loaded"]:
        return _surah_info_cache["data"]

    try:
        with open(SURAH_INFO_PATH, "r", encoding="utf-8") as f:
            _surah_info_cache["data"] = json.load(f)
            _surah_info_cache["loaded"] = True
            return _surah_info_cache["data"]
    except Exception as e:
        print(f"Failed to load surah_info.json: {e}")
        return None


def _is_end_of_verse(matched_ref: str) -> bool:
    """
    Check if a reference ends at the last word of a verse.
    Expects formats like "2:255:1-2:255:5" or "2:255:5".
    """
    if not matched_ref or ":" not in matched_ref:
        return False

    try:
        end_ref = matched_ref.split("-")[-1]
        parts = end_ref.split(":")
        if len(parts) < 3:
            return False

        surah = int(parts[0])
        ayah = int(parts[1])
        word = int(parts[2])

        surah_info = _load_surah_info()
        if not surah_info:
            return False

        surah_data = surah_info.get(str(surah))
        if not surah_data or 'verses' not in surah_data:
            return False

        for verse_data in surah_data['verses']:
            if verse_data.get('verse') == ayah:
                num_words = verse_data.get('num_words', 0)
                return word >= num_words
    except Exception as e:
        print(f"Error checking end of verse: {e}")

    return False


def _apply_gap_penalty(match_results, index, gap_penalty: float = 0.25):
    """Apply a gap penalty to both sides of missing spans."""
    adjusted = []
    prev_end = None
    prev_idx = None
    prev_ref = None

    for idx, (matched_text, score, matched_ref) in enumerate(match_results):
        start_end = index.ref_to_indices(matched_ref) if matched_ref else None
        if start_end and prev_end is not None:
            start_idx, end_idx = start_end
            if start_idx > prev_end and start_idx > prev_end + 1:
                score = max(0.0, score - gap_penalty)
                print(f"[PENALTY] Gap before ref {matched_ref} -> score {score:.2f}")
                if prev_idx is not None and prev_ref:
                    prev_m, prev_s, prev_r = adjusted[prev_idx]
                    prev_s = max(0.0, prev_s - gap_penalty)
                    adjusted[prev_idx] = (prev_m, prev_s, prev_r)
                    print(f"[PENALTY] Gap affects previous ref {prev_r} -> score {prev_s:.2f}")
            prev_end = max(prev_end, end_idx)
        elif start_end:
            prev_end = start_end[1]

        adjusted.append((matched_text, score, matched_ref))

        if start_end:
            prev_idx = len(adjusted) - 1
            prev_ref = matched_ref

    return adjusted


def _special_overlap_score(asr_text: str, canonical_text: str) -> float:
    """Compute overlap score used for special segment detection."""
    asr_norm = normalize_arabic(asr_text)
    canon_norm = normalize_arabic(canonical_text)
    asr_words = set(split_words(asr_norm))
    canon_words = set(split_words(canon_norm))
    if not asr_words or not canon_words:
        return 0.0
    overlap = len(asr_words & canon_words)
    canonical_coverage = overlap / len(canon_words)
    asr_coverage = overlap / len(asr_words)
    return (canonical_coverage + asr_coverage) / 2


def split_combined_special(vad_segments, segment_audios, transcribed_texts, transcription_errors=None):
    """
    Detect if the first segment contains both Isti'adha and Basmala
    and split it into two segments at the midpoint.
    """
    if transcription_errors is None:
        transcription_errors = [None] * len(transcribed_texts)

    if not vad_segments or not segment_audios or not transcribed_texts:
        return vad_segments, segment_audios, transcribed_texts, transcription_errors, False

    first_text = transcribed_texts[0]
    score_i = _special_overlap_score(first_text, SPECIAL_SEGMENTS.get("Isti'adha", ""))
    score_b = _special_overlap_score(first_text, SPECIAL_SEGMENTS.get("Basmala", ""))

    if score_i >= SPECIAL_MATCH_SCORE and score_b >= SPECIAL_MATCH_SCORE:
        seg = vad_segments[0]
        audio = segment_audios[0]
        mid_time = (seg.start_time + seg.end_time) / 2.0
        mid_sample = max(1, len(audio) // 2)

        new_vads = [
            VadSegment(start_time=seg.start_time, end_time=mid_time, segment_idx=0),
            VadSegment(start_time=mid_time, end_time=seg.end_time, segment_idx=1),
        ]
        new_audios = [
            audio[:mid_sample],
            audio[mid_sample:],
        ]
        new_texts = [
            SPECIAL_SEGMENTS.get("Isti'adha", ""),
            SPECIAL_SEGMENTS.get("Basmala", ""),
        ]
        new_errors = [None, None]  # Special segments have no errors

        # Append remaining segments and reindex
        for i, vs in enumerate(vad_segments[1:], start=2):
            new_vads.append(VadSegment(start_time=vs.start_time, end_time=vs.end_time, segment_idx=i))
        new_audios.extend(segment_audios[1:])
        new_texts.extend(transcribed_texts[1:])
        new_errors.extend(transcription_errors[1:])

        return new_vads, new_audios, new_texts, new_errors, True

    return vad_segments, segment_audios, transcribed_texts, transcription_errors, False


def load_segmenter():
    """Load the VAD segmenter model. Returns (model, processor, load_time)."""
    if _segmenter_cache["loaded"]:
        return _segmenter_cache["model"], _segmenter_cache["processor"], _segmenter_cache["load_time"]

    import time
    start_time = time.time()

    try:
        from transformers import AutoModelForAudioFrameClassification, AutoFeatureExtractor

        print(f"Loading segmenter: {SEGMENTER_MODEL}")
        device, dtype = _get_device_and_dtype()

        model = AutoModelForAudioFrameClassification.from_pretrained(SEGMENTER_MODEL)
        model.to(device, dtype=dtype)
        model.eval()

        processor = AutoFeatureExtractor.from_pretrained(SEGMENTER_MODEL)

        load_time = time.time() - start_time
        _segmenter_cache["model"] = model
        _segmenter_cache["processor"] = processor
        _segmenter_cache["loaded"] = True
        _segmenter_cache["load_time"] = load_time

        print(f"Segmenter loaded on {device} in {load_time:.2f}s")
        return model, processor, load_time

    except Exception as e:
        print(f"Failed to load segmenter: {e}")
        return None, None, 0.0


def load_whisper(model_name: str = None):
    """Load the Whisper ASR model. Returns (model, processor, gen_config, load_time)."""
    # Use provided model name or default from config
    actual_model = model_name or WHISPER_MODEL

    # Check cache - but only if model matches
    if _whisper_cache["loaded"] and _whisper_cache.get("model_name") == actual_model:
        return (_whisper_cache["model"], _whisper_cache["processor"],
                _whisper_cache["gen_config"], _whisper_cache["load_time"], None)

    import time
    start_time = time.time()

    try:
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        print(f"Loading Whisper: {actual_model}")
        device, dtype = _get_device_and_dtype()

        model = WhisperForConditionalGeneration.from_pretrained(
            actual_model,
            torch_dtype=dtype,
            low_cpu_mem_usage=True
        ).to(device)
        model.eval()

        processor = WhisperProcessor.from_pretrained(actual_model)
        gen_config = model.generation_config

        load_time = time.time() - start_time
        _whisper_cache["model"] = model
        _whisper_cache["processor"] = processor
        _whisper_cache["gen_config"] = gen_config
        _whisper_cache["loaded"] = True
        _whisper_cache["load_time"] = load_time
        _whisper_cache["model_name"] = actual_model

        print(f"Whisper loaded on {device} in {load_time:.2f}s")
        return model, processor, gen_config, load_time, None

    except Exception as e:
        error_msg = f"Failed to load Whisper model '{actual_model}': {str(e)}"
        print(error_msg)
        import traceback
        traceback.print_exc()
        return None, None, None, 0.0, error_msg


# =============================================================================
# VAD Detection
# =============================================================================

def detect_speech_segments(
    audio: np.ndarray,
    sample_rate: int,
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int
) -> Tuple[List[Tuple[float, float]], dict]:
    """
    Detect speech segments in audio using VAD.

    Returns:
        Tuple of (intervals, profiling_dict)
    """
    import time

    model, processor, model_load_time = load_segmenter()
    if model is None:
        # Fallback: treat whole audio as one segment
        return [(0, len(audio) / sample_rate)], {"model_load_time": 0.0, "inference_time": 0.0}

    inference_start = time.time()

    try:
        from recitations_segmenter import segment_recitations, clean_speech_intervals

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
            sample_rate = 16000

        device = next(model.parameters()).device
        dtype = next(model.parameters()).dtype

        # Convert to tensor
        audio_tensor = torch.from_numpy(audio).float()

        # Run segmentation
        outputs = segment_recitations(
            [audio_tensor],
            model,
            processor,
            device=device,
            dtype=dtype,
            batch_size=1,
        )

        if not outputs:
            inference_time = time.time() - inference_start
            return [(0, len(audio) / sample_rate)], {"model_load_time": model_load_time, "inference_time": inference_time}

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
        return [(start, end) for start, end in intervals], {"model_load_time": model_load_time, "inference_time": inference_time}

    except Exception as e:
        print(f"VAD error: {e}")
        import traceback
        traceback.print_exc()
        inference_time = time.time() - inference_start
        return [(0, len(audio) / sample_rate)], {"model_load_time": model_load_time, "inference_time": inference_time}


# =============================================================================
# Whisper Transcription
# =============================================================================

def transcribe_segment(audio: np.ndarray, sample_rate: int, model_name: str = None) -> str:
    """Transcribe a single audio segment."""
    model, processor, gen_config, _, _ = load_whisper(model_name)
    if model is None:
        return ""

    try:
        if sample_rate != 16000:
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)

        device = next(model.parameters()).device
        dtype = model.dtype

        feats = processor(audio=audio, sampling_rate=16000, return_tensors="pt")["input_features"]
        feats = feats.to(device=device, dtype=dtype)

        with torch.no_grad():
            out_ids = model.generate(
                feats,
                generation_config=gen_config,
                max_new_tokens=200,
                do_sample=False,
                num_beams=1,
            )

        text = processor.batch_decode(out_ids, skip_special_tokens=True)[0].strip()
        return text

    except Exception as e:
        print(f"Whisper error: {e}")
        return ""


def transcribe_segments_batched(
    segment_audios: List[np.ndarray],
    sample_rate: int,
    model_name: str = None,
    return_errors: bool = True,
    batch_size: int = 8,
    status_callback=None
) -> Tuple[List[str], Optional[List[str]], dict]:
    """
    Transcribe multiple audio segments in a batch.

    Returns:
        texts: List of transcribed texts (empty string if failed)
        errors: List of error messages (None if success, error string if failed)
        profiling: Dict with timing information
    """
    import time

    if not segment_audios:
        errors = [] if return_errors else None
        return [], errors, {"model_load_time": 0.0, "inference_time": 0.0}

    model, processor, gen_config, model_load_time, load_error = load_whisper(model_name)
    if model is None:
        error_msg = load_error or "Failed to load Whisper model (unknown error)"
        errors = [error_msg] * len(segment_audios) if return_errors else None
        return [""] * len(segment_audios), errors, {"model_load_time": 0.0, "inference_time": 0.0}

    inference_start = time.time()

    try:
        device = next(model.parameters()).device
        dtype = model.dtype

        texts: List[str] = []
        errors: Optional[List[str]] = [] if return_errors else None
        total = len(segment_audios)
        effective_batch = max(1, batch_size)

        for start_idx in range(0, total, effective_batch):
            end_idx = min(start_idx + effective_batch, total)
            if status_callback:
                status_callback("whisper", f"Transcribing segment {start_idx + 1}/{total}...")

            # Resample batch to 16kHz
            resampled = []
            for audio in segment_audios[start_idx:end_idx]:
                if sample_rate != 16000:
                    audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
                resampled.append(audio)

            # Process batch audios
            batch_features = []
            for audio in resampled:
                feats = processor(audio=audio, sampling_rate=16000, return_tensors="pt")["input_features"]
                batch_features.append(feats)

            # Stack into batch
            batch_input = torch.cat(batch_features, dim=0).to(device=device, dtype=dtype)
            attention_mask = torch.ones(batch_input.shape[:2], dtype=torch.long, device=device)

            # Generate
            with torch.no_grad():
                out_ids = model.generate(
                    batch_input,
                    attention_mask=attention_mask,
                    generation_config=gen_config,
                    max_new_tokens=200,
                    do_sample=False,
                    num_beams=1,
                )

            batch_texts = processor.batch_decode(out_ids, skip_special_tokens=True)
            batch_texts = [t.strip() for t in batch_texts]
            texts.extend(batch_texts)

            if errors is not None:
                errors.extend([None] * len(batch_texts))

        inference_time = time.time() - inference_start
        print(f"[WHISPER BATCH] {len(segment_audios)} segments in {inference_time:.2f}s")

        return texts, errors, {"model_load_time": model_load_time, "inference_time": inference_time}

    except Exception as e:
        error_msg = f"Whisper transcription error: {str(e)}"
        print(f"Batched Whisper error: {e}")
        import traceback
        traceback.print_exc()
        inference_time = time.time() - inference_start
        errors = [error_msg] * len(segment_audios) if return_errors else None
        return [""] * len(segment_audios), errors, {"model_load_time": model_load_time, "inference_time": inference_time}


# =============================================================================
# Text Matching
# =============================================================================

def run_text_matching(
    transcribed_texts: List[str],
) -> Tuple[List[Tuple[str, float, str]], dict]:
    """
    Run text matching using standalone TextMatcher.
    """
    matcher = get_text_matcher()
    results, profiling = matcher.match_segments(transcribed_texts)

    # Convert MatchResult to tuple format
    return [
        (r.matched_text, r.score, r.ref)
        for r in results
    ], profiling


# =============================================================================
# Model name mapping for different sizes
# =============================================================================

WHISPER_MODELS = {
    "tiny": "tarteel-ai/whisper-tiny-ar-quran",
    "base": "tarteel-ai/whisper-base-ar-quran",
    "medium": "openai/whisper-medium",
    "large": "IJyad/whisper-large-v3-Tarteel",
}


# =============================================================================
# Main Processing Pipeline
# =============================================================================

def process_audio(
    audio_data: Tuple[int, np.ndarray],
    verse_ref: str,
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int
) -> List[SegmentInfo]:
    """
    Full processing pipeline: VAD -> Whisper -> Text matching.

    Args:
        audio_data: Tuple of (sample_rate, audio_array)
        verse_ref: Verse reference (e.g., "2:255" or "2:255-2:257")
        min_silence_ms: Minimum silence to split segments
        min_speech_ms: Minimum speech for valid segment
        pad_ms: Padding around segments

    Returns:
        List of SegmentInfo with results
    """
    import time

    if audio_data is None:
        return []

    total_start = time.time()
    sample_rate, audio = audio_data

    # Convert to float32 if needed
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / 2147483648.0

    # Convert stereo to mono
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    audio_duration = len(audio) / sample_rate
    print(f"\n[PROCESS] Audio: {audio_duration:.2f}s")

    # Step 1: VAD segmentation
    vad_start = time.time()
    intervals, _vad_profiling = detect_speech_segments(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms)
    vad_time = time.time() - vad_start
    print(f"[PROCESS] VAD: {vad_time:.2f}s - {len(intervals)} segments")

    if not intervals:
        return []

    # Create VadSegment list and extract audio
    vad_segments = []
    segment_audios = []

    for idx, (start, end) in enumerate(intervals):
        vad_segments.append(VadSegment(start_time=start, end_time=end, segment_idx=idx))
        start_sample = int(start * sample_rate)
        end_sample = int(end * sample_rate)
        segment_audios.append(audio[start_sample:end_sample])

    # Step 2: Whisper transcription (batched)
    whisper_start = time.time()
    transcribed_texts, _errors, _whisper_profiling = transcribe_segments_batched(
        segment_audios, sample_rate, return_errors=False
    )
    whisper_time = time.time() - whisper_start
    print(f"[PROCESS] Whisper: {whisper_time:.2f}s")

    # Detect combined Isti'adha + Basmala in first segment and split if needed
    vad_segments, segment_audios, transcribed_texts, _errors, special_split = split_combined_special(
        vad_segments, segment_audios, transcribed_texts, [None] * len(transcribed_texts)
    )
    if special_split:
        print("[SPECIAL] Split combined Isti'adha + Basmala in first segment")

    # Step 3: Text matching (CPU)
    match_start = time.time()
    match_results, _match_profiling = run_text_matching(transcribed_texts)
    match_time = time.time() - match_start
    print(f"[PROCESS] Matching: {match_time:.2f}s")

    # Apply gap penalty
    from .quran_index import get_quran_index
    index = get_quran_index()
    match_results = _apply_gap_penalty(match_results, index)

    # Build SegmentInfo list
    segments = []
    total_segments = len(vad_segments)

    for idx, (seg, text, (matched_text, score, matched_ref)) in enumerate(
        zip(vad_segments, transcribed_texts, match_results)
    ):
        error = None

        # Apply end-of-verse penalty to final segment if it doesn't end a verse
        if idx == total_segments - 1 and matched_ref:
            if not _is_end_of_verse(matched_ref):
                score = max(0.0, score - 0.25)

        if not text:
            error = "Transcription failed"
        elif score < MIN_MATCH_SCORE:
            matched_text = ""
            matched_ref = ""
            error = f"Low confidence ({score:.0%})"

        segments.append(SegmentInfo(
            start_time=seg.start_time,
            end_time=seg.end_time,
            transcribed_text=text,
            matched_text=matched_text,
            matched_ref=matched_ref,
            match_score=score,
            error=error
        ))

    total_time = time.time() - total_start
    print(f"[PROCESS] Total: {total_time:.2f}s")

    return segments


def process_audio_full(
    audio: np.ndarray,
    sample_rate: int,
    min_silence_ms: int = 200,
    min_speech_ms: int = 1000,
    pad_ms: int = 50,
    whisper_model: str = "base",
    status_callback=None
) -> dict:
    """
    Full processing pipeline: VAD -> Whisper -> Text matching.

    Returns JSON-serializable dict with segments.

    Args:
        status_callback: Optional callable(step: str, message: str) to report progress
    """
    import time

    def emit_status(step: str, message: str):
        """Emit status update."""
        if status_callback:
            status_callback(step, message)
        print(f"[STATUS] {step}: {message}")

    total_start = time.time()
    profiling = ProfilingData()

    # Convert to float32 if needed
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / 2147483648.0

    # Convert stereo to mono
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    audio_duration = len(audio) / sample_rate
    print(f"\n[PROCESS] Audio: {audio_duration:.2f}s")

    # Step 1: VAD segmentation
    emit_status("vad", "Detecting speech segments...")
    vad_start = time.time()
    intervals, vad_profiling = detect_speech_segments(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms)
    profiling.vad_model_load_time = vad_profiling.get("model_load_time", 0.0)
    profiling.vad_inference_time = vad_profiling.get("inference_time", 0.0)
    print(f"[PROCESS] VAD: {time.time() - vad_start:.2f}s - {len(intervals)} segments")

    if not intervals:
        return {"segments": []}

    # Create VadSegment list and extract audio
    vad_segments = []
    segment_audios = []

    for idx, (start, end) in enumerate(intervals):
        vad_segments.append(VadSegment(start_time=start, end_time=end, segment_idx=idx))
        start_sample = int(start * sample_rate)
        end_sample = int(end * sample_rate)
        segment_audios.append(audio[start_sample:end_sample])

    # Step 2: Whisper transcription (batched)
    emit_status("whisper", f"Transcribing segment 1/{len(segment_audios)}...")
    whisper_start = time.time()
    # Get model name from mapping or use default
    whisper_model_name = WHISPER_MODELS.get(whisper_model, WHISPER_MODELS["base"])
    transcribed_texts, transcription_errors, whisper_profiling = transcribe_segments_batched(
        segment_audios,
        sample_rate,
        whisper_model_name,
        return_errors=True,
        status_callback=status_callback
    )
    profiling.asr_model_load_time = whisper_profiling.get("model_load_time", 0.0)
    profiling.asr_inference_time = whisper_profiling.get("inference_time", 0.0)
    print(f"[PROCESS] Whisper: {time.time() - whisper_start:.2f}s")

    # Detect combined Isti'adha + Basmala in first segment and split if needed
    vad_segments, segment_audios, transcribed_texts, transcription_errors, special_split = split_combined_special(
        vad_segments, segment_audios, transcribed_texts, transcription_errors
    )
    if special_split:
        print("[SPECIAL] Split combined Isti'adha + Basmala in first segment")

    # Step 3: Text matching (CPU)
    emit_status("matching", "Matching text to Quran...")
    match_start = time.time()
    match_results, match_profiling = run_text_matching(transcribed_texts)
    profiling.text_match_total_time = match_profiling.get("total_time", 0.0)
    profiling.text_match_anchor_time = match_profiling.get("anchor_time", 0.0)
    profiling.text_match_post_anchor_time = match_profiling.get("post_anchor_time", 0.0)
    profiling.text_match_num_segments = match_profiling.get("num_segments", 0)
    print(f"[PROCESS] Matching: {time.time() - match_start:.2f}s")

    # Apply gap penalty
    from .quran_index import get_quran_index
    index = get_quran_index()
    match_results = _apply_gap_penalty(match_results, index)

    # Build output
    def parse_ref(matched_ref):
        """Parse 'surah:ayah:word-surah:ayah:word' into (ref_from, ref_to)."""
        if not matched_ref:
            return "", ""
        if "-" in matched_ref:
            parts = matched_ref.split("-")
            return parts[0], parts[1] if len(parts) > 1 else parts[0]
        return matched_ref, matched_ref

    segments = []
    total_segments = len(vad_segments)

    for idx, (seg, text, trans_error, (matched_text, score, matched_ref)) in enumerate(
        zip(vad_segments, transcribed_texts, transcription_errors, match_results)
    ):
        error = None

        # Apply end-of-verse penalty to final segment if it doesn't end a verse
        if idx == total_segments - 1 and matched_ref:
            if not _is_end_of_verse(matched_ref):
                score = max(0.0, score - 0.25)

        # Check for transcription error first
        if trans_error:
            error = trans_error
        elif not text:
            error = "Transcription failed"
        elif score < MIN_MATCH_SCORE:
            matched_text = ""
            matched_ref = ""
            error = f"Low confidence ({score:.0%})"

        ref_from, ref_to = parse_ref(matched_ref)

        segments.append({
            "segment": idx + 1,
            "time_from": round(seg.start_time, 3),
            "time_to": round(seg.end_time, 3),
            "ref_from": ref_from,
            "ref_to": ref_to,
            "matched_text": matched_text or "",
            "confidence": round(score, 3),
            "error": error,
            "word_timestamps": []
        })

    total_time = time.time() - total_start
    print(f"[PROCESS] Total: {total_time:.2f}s")
    print(profiling.summary())

    return {"segments": segments}
