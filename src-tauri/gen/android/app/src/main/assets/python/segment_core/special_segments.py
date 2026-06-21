"""
Special segment detection for Basmala and Isti'adha.

These are common recitation openers that need special handling:
- Isti'adha: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ" (I seek refuge in Allah)
- Basmala: "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ" (In the name of Allah)
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

from .config import (
    SPECIAL_SEGMENTS,
    SPECIAL_MATCH_SCORE,
    SPECIAL_WORD_THRESHOLD,
)
from .text_preprocessor import normalize_arabic, split_words


# =============================================================================
@dataclass
class SpecialMatchResult:
    """Result of matching a special segment."""
    ref: str                  # "Basmala" or "Isti'adha"
    matched_text: str         # Canonical text
    score: float              # Match confidence 0-1


# =============================================================================
def _word_similarity(w1: str, w2: str) -> float:
    """Return similarity ratio between two words (0-1)."""
    if w1 == w2:
        return 1.0
    return SequenceMatcher(None, w1, w2).ratio()


# =============================================================================
def _compute_special_score(asr_words: list[str], canonical_words: list[str]) -> float:
    """
    Compute fuzzy match score between ASR words and canonical special segment words.

    Uses SPECIAL_WORD_THRESHOLD (stricter than general matching) to avoid
    false positives from unrelated words matching.
    """
    if not asr_words or not canonical_words:
        return 0.0

    # Greedy bipartite matching: each word can only match once
    used_can = set()
    matched_pairs = 0

    for asr_w in asr_words:
        best_sim = 0.0
        best_can_idx = -1
        for j, can_w in enumerate(canonical_words):
            if j in used_can:
                continue
            sim = _word_similarity(asr_w, can_w)
            if sim > best_sim and sim >= SPECIAL_WORD_THRESHOLD:
                best_sim = sim
                best_can_idx = j
        if best_can_idx >= 0:
            used_can.add(best_can_idx)
            matched_pairs += 1

    # F1-style score
    recall = matched_pairs / len(asr_words)
    precision = matched_pairs / len(canonical_words)
    if recall + precision > 0:
        return 2 * recall * precision / (recall + precision)
    return 0.0


def get_special_scores(asr_text: str) -> dict[str, float]:
    """
    Get match scores for all special segments (Basmala/Isti'adha).

    Returns dict mapping label to score, e.g. {"Basmala": 0.75, "Isti'adha": 0.5}
    """
    if not asr_text:
        return {}

    asr_normalized = normalize_arabic(asr_text)
    asr_words = split_words(asr_normalized)

    if not asr_words:
        return {}

    scores = {}
    for label, canonical_text in SPECIAL_SEGMENTS.items():
        canonical_normalized = normalize_arabic(canonical_text)
        canonical_words = split_words(canonical_normalized)
        scores[label] = _compute_special_score(asr_words, canonical_words)

    return scores


def match_special_segment(asr_text: str, required_label: Optional[str] = None) -> Optional[SpecialMatchResult]:
    """
    Check if ASR text matches a special segment (Basmala/Isti'adha).

    Uses fuzzy word matching for robustness against ASR errors.
    Each word can only be matched once (greedy best-match).

    Args:
        asr_text: The ASR transcription to check
        required_label: If provided, only match this specific label (e.g., "Basmala")

    Returns:
        SpecialMatchResult if match found, None otherwise
    """
    if not asr_text:
        return None

    asr_normalized = normalize_arabic(asr_text)
    asr_words = split_words(asr_normalized)

    if not asr_words:
        return None

    best_match: Optional[SpecialMatchResult] = None
    best_score = 0.0

    for label, canonical_text in SPECIAL_SEGMENTS.items():
        # Skip if we're looking for a specific label
        if required_label and label != required_label:
            continue

        canonical_normalized = normalize_arabic(canonical_text)
        canonical_words = split_words(canonical_normalized)

        if not canonical_words:
            continue

        score = _compute_special_score(asr_words, canonical_words)

        if score > best_score and score >= SPECIAL_MATCH_SCORE:
            best_score = score
            best_match = SpecialMatchResult(
                ref=label,
                matched_text=canonical_text,
                score=score,
            )

    return best_match
