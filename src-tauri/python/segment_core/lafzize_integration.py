"""
In-process Lafzize integration for word-level timestamp extraction.

This module provides word-by-word timestamps using CTC forced alignment,
integrated directly into the main app (no separate server needed).
"""
import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torchaudio

from .config import (
    LAFZIZE_MODEL,
    LAFZIZE_BATCH_SIZE,
    LAFZIZE_WINDOW_SIZE,
    LAFZIZE_CONTEXT_SIZE,
    LAFZIZE_WORDS_PATH,
    LAFZIZE_METADATA_PATH,
)

logger = logging.getLogger(__name__)

# CTC forced aligner imports
try:
    from ctc_forced_aligner import (
        load_alignment_model,
        generate_emissions,
        get_alignments,
        get_spans,
        text_normalize,
        get_uroman_tokens,
    )
    from ctc_forced_aligner.alignment_utils import SAMPLING_FREQ
    LAFZIZE_AVAILABLE = True
except Exception as e:
    LAFZIZE_AVAILABLE = False
    SAMPLING_FREQ = 16000
    logger.warning(f"ctc_forced_aligner not available - word timestamps disabled: {e}")


# =============================================================================
# Global state (loaded once)
# =============================================================================

_lafzize_model = None
_lafzize_tokenizer = None
_lafzize_words: dict = None  # word_id -> word data
_lafzize_verses: dict = None  # verse_key -> list of words
_lafzize_metadata: dict = None


@dataclass
class WordTimestamp:
    """Word-level timestamp data."""
    key: str  # e.g., "85:1:1" or "taawwudh"
    start: float  # seconds (relative to segment start)
    end: float  # seconds
    word_type: str = "word"  # "word" or "phrase"


# =============================================================================
# Data loading
# =============================================================================

def _load_lafzize_data():
    """Load Lafzize data files (words and metadata)."""
    global _lafzize_words, _lafzize_verses, _lafzize_metadata

    if _lafzize_words is not None:
        return  # Already loaded

    logger.info(f"Loading Lafzize data from {LAFZIZE_WORDS_PATH}")

    # Load words
    with open(LAFZIZE_WORDS_PATH, 'r', encoding='utf-8') as f:
        _lafzize_words = json.load(f)

    # Build verses dict: verse_key -> list of word texts (excluding verse markers)
    _lafzize_verses = defaultdict(list)
    for word_data in sorted(_lafzize_words.values(), key=lambda w: (int(w['surah']), int(w['ayah']), int(w['word']))):
        text = word_data['text']
        # Skip verse markers (start with \u06DD)
        if text.startswith('\u06DD'):
            continue
        verse_key = f"{word_data['surah']}:{word_data['ayah']}"
        _lafzize_verses[verse_key].append(text)

    # Remove last word from each verse (verse marker artifact in some data)
    for verse_key in list(_lafzize_verses.keys()):
        if _lafzize_verses[verse_key]:
            _lafzize_verses[verse_key].pop()

    _lafzize_verses = dict(_lafzize_verses)

    # Load metadata
    with open(LAFZIZE_METADATA_PATH, 'r', encoding='utf-8') as f:
        _lafzize_metadata = json.load(f)

    logger.info(f"Loaded {len(_lafzize_words)} words, {len(_lafzize_verses)} verses")


def _get_phrase_text(phrase_key: str) -> Optional[str]:
    """Get text for special phrases (taawwudh, basmalah)."""
    if _lafzize_metadata is None:
        return None
    phrases = _lafzize_metadata.get('phrases', {})
    if phrase_key.lower() in ('taawwudh', "isti'adha"):
        return phrases.get('taawwudh')
    if phrase_key.lower() == 'basmalah':
        return phrases.get('basmalah')
    return None


# =============================================================================
# Model loading
# =============================================================================

def load_lafzize_model():
    """Load the Lafzize alignment model on CPU (for ZeroGPU compatibility)."""
    global _lafzize_model, _lafzize_tokenizer

    if not LAFZIZE_AVAILABLE:
        logger.warning("ctc_forced_aligner not available")
        return False

    if _lafzize_model is not None:
        return True  # Already loaded

    # Always load on CPU first (ZeroGPU pattern)
    device = "cpu"
    dtype = torch.float32

    logger.info(f"Loading Lafzize model: {LAFZIZE_MODEL} on {device}")

    try:
        _lafzize_model, _lafzize_tokenizer = load_alignment_model(
            device=device,
            model_path=LAFZIZE_MODEL,
            attn_implementation=None,
            dtype=dtype,
        )
        logger.info("Lafzize model loaded successfully on CPU")
        return True
    except Exception as e:
        logger.error(f"Failed to load Lafzize model: {e}")
        return False


def ensure_lafzize_on_gpu():
    """Move Lafzize model to GPU. Call inside @gpu_decorator function."""
    global _lafzize_model

    if _lafzize_model is None:
        return

    if not torch.cuda.is_available():
        return

    # Check if already on GPU
    try:
        if next(_lafzize_model.parameters()).device.type == "cuda":
            return
    except StopIteration:
        return

    device = torch.device("cuda")
    dtype = torch.float16

    print("[GPU] Moving Lafzize to CUDA...")
    _lafzize_model.to(device, dtype=dtype)
    print("[GPU] Lafzize on CUDA")


def ensure_lafzize_ready() -> bool:
    """Ensure Lafzize model and data are loaded (on CPU)."""
    if not LAFZIZE_AVAILABLE:
        return False
    _load_lafzize_data()
    return load_lafzize_model()


# =============================================================================
# Text processing (ported from lafzize/text_utils.py)
# =============================================================================

def _preprocess_text(text: list[str], romanize: bool = True, language: str = "ara"):
    """Preprocess text for alignment."""
    normalized_text = [text_normalize(segment, language) for segment in text]

    if romanize:
        tokens = get_uroman_tokens(normalized_text, language)
    else:
        tokens = [" ".join(list(word)) for word in normalized_text]

    tokens_starred = []
    text_starred = []

    for token, chunk in zip(tokens, text):
        tokens_starred.extend(["<star>", token])
        text_starred.extend(["<star>", chunk])

    return tokens_starred, text_starred


# =============================================================================
# Segment generation (ported from lafzize/util.py)
# =============================================================================

def _generate_segments(ref_from: str, ref_to: str) -> tuple[list[str], list[str]]:
    """
    Generate verse and word segments from refs.

    Args:
        ref_from: Start ref like "85:1:1" or "Basmala"
        ref_to: End ref like "85:1:3"

    Returns:
        (verse_segments, word_segments)
    """
    # Handle special phrases
    if ref_from.lower() in ('basmala', 'basmalah'):
        return ['basmalah'], ['basmalah']
    if ref_from.lower() in ("isti'adha", 'taawwudh'):
        return ['taawwudh'], ['taawwudh']

    # Parse surah:ayah:word format
    from_parts = ref_from.split(':')
    to_parts = ref_to.split(':')

    if len(from_parts) < 2 or len(to_parts) < 2:
        return [], []

    from_surah, from_ayah = int(from_parts[0]), int(from_parts[1])
    to_surah, to_ayah = int(to_parts[0]), int(to_parts[1])
    from_word = int(from_parts[2]) if len(from_parts) > 2 else 1
    to_word = int(to_parts[2]) if len(to_parts) > 2 else None

    verse_segments = []
    word_segments = []

    # Build list of all verses we need
    for surah in range(from_surah, to_surah + 1):
        start_ayah = from_ayah if surah == from_surah else 1
        # Get max ayah for this surah from verses dict
        max_ayah = max(int(vk.split(':')[1]) for vk in _lafzize_verses.keys()
                       if vk.startswith(f"{surah}:"))
        end_ayah = to_ayah if surah == to_surah else max_ayah

        for ayah in range(start_ayah, end_ayah + 1):
            verse_key = f"{surah}:{ayah}"
            if verse_key not in _lafzize_verses:
                continue

            verse_segments.append(verse_key)
            verse_words = _lafzize_verses[verse_key]

            # Determine word range for this verse
            if surah == from_surah and ayah == from_ayah:
                start_word_idx = from_word - 1  # 1-indexed to 0-indexed
            else:
                start_word_idx = 0

            if surah == to_surah and ayah == to_ayah and to_word:
                end_word_idx = to_word  # exclusive
            else:
                end_word_idx = len(verse_words)

            for word_idx in range(start_word_idx, min(end_word_idx, len(verse_words))):
                word_key = f"{surah}:{ayah}:{word_idx + 1}"
                word_segments.append(word_key)

    return verse_segments, word_segments


# =============================================================================
# Main API
# =============================================================================

def get_word_timestamps(
    audio_array: np.ndarray,
    sample_rate: int,
    ref_from: str,
    ref_to: str,
) -> list[WordTimestamp]:
    """
    Get word-level timestamps for a segment using CTC forced alignment.

    Args:
        audio_array: Audio samples (float32, mono)
        sample_rate: Sample rate of audio
        ref_from: Start reference (e.g., "85:1:1" or "Basmala")
        ref_to: End reference (e.g., "85:1:3")

    Returns:
        List of WordTimestamp objects with relative timestamps (seconds from segment start)
    """
    if not LAFZIZE_AVAILABLE:
        logger.warning("Lafzize not available")
        return []

    if not ensure_lafzize_ready():
        return []

    # Generate segments
    verse_segments, word_segments = _generate_segments(ref_from, ref_to)
    if not word_segments:
        logger.warning(f"No word segments generated for {ref_from} - {ref_to}")
        return []

    # Build text list
    text = []
    for verse_segment in verse_segments:
        if verse_segment == 'taawwudh':
            phrase = _get_phrase_text('taawwudh')
            if phrase:
                text.append(phrase)
            continue
        if verse_segment == 'basmalah':
            phrase = _get_phrase_text('basmalah')
            if phrase:
                text.append(phrase)
            continue

        # Get words from this verse
        if verse_segment in _lafzize_verses:
            for word in _lafzize_verses[verse_segment]:
                text.append(word)

    if not text:
        logger.warning(f"No text generated for {ref_from} - {ref_to}")
        return []

    # Convert audio to tensor
    if isinstance(audio_array, np.ndarray):
        waveform = torch.from_numpy(audio_array).float()
    else:
        waveform = audio_array.float()

    # Resample if needed
    if sample_rate != SAMPLING_FREQ:
        resampler = torchaudio.transforms.Resample(sample_rate, SAMPLING_FREQ)
        waveform = resampler(waveform)

    # Move to device
    waveform = waveform.to(_lafzize_model.device, _lafzize_model.dtype)

    # Ensure contiguous
    if not waveform.is_contiguous():
        waveform = waveform.contiguous()

    # Preprocess text
    tokens_starred, text_starred = _preprocess_text(text, romanize=True, language="ara")

    # Generate emissions
    emissions, stride = generate_emissions(
        model=_lafzize_model,
        audio_waveform=waveform,
        window_length=LAFZIZE_WINDOW_SIZE,
        context_length=LAFZIZE_CONTEXT_SIZE,
        batch_size=LAFZIZE_BATCH_SIZE,
    )

    # Get alignments
    segments, _scores, blank_token = get_alignments(
        emissions,
        tokens_starred,
        _lafzize_tokenizer,
    )

    # Get spans
    spans = get_spans(tokens_starred, segments, blank_token)

    # Process results
    results = []
    segment_idx = 0

    for idx, txt in enumerate(text_starred):
        if txt == "<star>":
            continue

        span = spans[idx]
        span_start = span[0].start
        span_end = span[-1].end
        start_sec = span_start * stride / 1000.0  # Convert to seconds
        end_sec = span_end * stride / 1000.0

        if segment_idx < len(word_segments):
            segment_key = word_segments[segment_idx]
        else:
            segment_key = f"word_{segment_idx}"

        word_type = "phrase" if segment_key in ['taawwudh', 'basmalah'] else "word"

        results.append(WordTimestamp(
            key=segment_key,
            start=start_sec,
            end=end_sec,
            word_type=word_type,
        ))

        segment_idx += 1

    return results


def get_word_timestamps_dict(
    audio_array: np.ndarray,
    sample_rate: int,
    ref_from: str,
    ref_to: str,
    segment_duration: float = None
) -> list[dict]:
    """
    Get word-level timestamps as list of dicts (for JSON serialization).

    Args:
        segment_duration: If provided, fills gaps between words and clamps
                         the last word's end to the segment duration.

    Returns:
        List of {"key": "85:1:1", "start": 0.5, "end": 0.8, "type": "word"}
    """
    timestamps = get_word_timestamps(audio_array, sample_rate, ref_from, ref_to)

    if not timestamps:
        return []

    result = []
    for i, ts in enumerate(timestamps):
        start = round(ts.start, 3)

        # Determine end time
        if segment_duration is not None and i < len(timestamps) - 1:
            # Extend end to next word's start (fill gap)
            end = round(timestamps[i + 1].start, 3)
        elif segment_duration is not None:
            # Last word: clamp to segment duration
            end = min(round(ts.end, 3), round(segment_duration, 3))
        else:
            # No segment_duration: use original end
            end = round(ts.end, 3)

        result.append({
            "key": ts.key,
            "start": start,
            "end": end,
            "type": ts.word_type,
        })

    return result
