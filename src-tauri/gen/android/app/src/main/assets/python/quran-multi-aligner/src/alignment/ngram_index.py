"""
Phoneme n-gram index: dataclass and cached loader.
"""

import pickle
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from config import NGRAM_INDEX_PATH


@dataclass
class PhonemeNgramIndex:
    """Pre-computed n-gram index for the entire Quran."""

    # n-gram -> list of (surah, ayah) positions where it occurs
    ngram_positions: Dict[Tuple[str, ...], List[Tuple[int, int]]]

    # n-gram -> total occurrence count (for rarity weighting)
    ngram_counts: Dict[Tuple[str, ...], int]

    # Metadata
    ngram_size: int
    total_ngrams: int


_INDEX: Optional[PhonemeNgramIndex] = None


def get_ngram_index() -> PhonemeNgramIndex:
    """Get or load the phoneme n-gram index."""
    global _INDEX
    if _INDEX is None:
        print(f"[NGRAM] Loading index from {NGRAM_INDEX_PATH}...")
        with open(NGRAM_INDEX_PATH, "rb") as f:
            _INDEX = pickle.load(f)
        print(f"[NGRAM] Loaded: {len(_INDEX.ngram_positions)} unique {_INDEX.ngram_size}-grams, "
              f"{_INDEX.total_ngrams} total occurrences")
    return _INDEX
