"""
QuranIndex: Pre-indexed Quran words for fast text matching.

Loads digital_khatt_v2_script.json and builds a flat word array with
surah boundaries for efficient segment alignment.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import get_quran_script_path
from .text_preprocessor import normalize_arabic


# Verse marker prefix to filter out (end-of-ayah markers)
VERSE_MARKER_PREFIX = '۝'


@dataclass
class WordInfo:
    """Information about a single Quran word."""
    global_idx: int       # Position in flat word array
    surah: int
    ayah: int
    word: int
    text: str             # Original text
    normalized: str       # Normalized for matching


@dataclass
class QuranIndex:
    """
    Pre-indexed Quran words for segment matching.

    Provides O(1) access to words by global index and O(1) surah boundary lookup.
    """
    words: list[WordInfo]                           # All words in order
    normalized_words: list[str]                     # Just normalized text for fast access
    word_positions: dict[str, list[int]]            # Normalized word -> list of positions
    word_lookup: dict[tuple[int, int, int], int]    # (surah, ayah, word) -> global_idx
    surah_bounds: dict[int, tuple[int, int]]        # surah -> (start_idx, end_idx exclusive)
    total_words: int

    @classmethod
    def load(cls, data_path: Optional[Path] = None) -> "QuranIndex":
        """
        Load and index the Quran from digital_khatt_v2_script.json.

        Filters out verse markers (۝) - they're not real words.
        """
        if data_path is None:
            data_path = get_quran_script_path()

        with open(data_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        words: list[WordInfo] = []
        normalized_words: list[str] = []
        surah_bounds: dict[int, tuple[int, int]] = {}
        word_positions: dict[str, list[int]] = {}
        word_lookup: dict[tuple[int, int, int], int] = {}

        current_surah = 0
        surah_start_idx = 0

        # Sort by location key to ensure order (1:1:1, 1:1:2, ..., 114:6:3)
        sorted_keys = sorted(raw_data.keys(), key=_parse_location_key)

        for key in sorted_keys:
            entry = raw_data[key]
            text = entry["text"]

            # Skip verse markers
            if text.startswith(VERSE_MARKER_PREFIX):
                continue

            surah = int(entry["surah"])
            ayah = int(entry["ayah"])
            word = int(entry["word"])

            # Track surah boundaries
            if surah != current_surah:
                if current_surah > 0:
                    surah_bounds[current_surah] = (surah_start_idx, len(words))
                current_surah = surah
                surah_start_idx = len(words)

            normalized = normalize_arabic(text)

            word_info = WordInfo(
                global_idx=len(words),
                surah=surah,
                ayah=ayah,
                word=word,
                text=text,
                normalized=normalized,
            )
            words.append(word_info)
            normalized_words.append(normalized)
            word_positions.setdefault(normalized, []).append(word_info.global_idx)
            word_lookup[(surah, ayah, word)] = word_info.global_idx

        # Close last surah
        if current_surah > 0:
            surah_bounds[current_surah] = (surah_start_idx, len(words))

        print(f"[QuranIndex] Loaded {len(words)} words across {len(surah_bounds)} surahs")

        return cls(
            words=words,
            normalized_words=normalized_words,
            word_positions=word_positions,
            word_lookup=word_lookup,
            surah_bounds=surah_bounds,
            total_words=len(words),
        )

    def get_word(self, idx: int) -> Optional[WordInfo]:
        """Get word by global index."""
        if 0 <= idx < self.total_words:
            return self.words[idx]
        return None

    def get_slice(self, start: int, end: int) -> list[str]:
        """Get normalized words in range [start, end)."""
        return self.normalized_words[max(0, start):min(end, self.total_words)]

    def get_positions(self, normalized_word: str) -> list[int]:
        """Get all positions for a normalized word."""
        return self.word_positions.get(normalized_word, [])

    def to_ref(self, start_idx: int, end_idx: int) -> str:
        """
        Convert global indices to surah:ayah:word reference string.

        Returns format like "2:255:1-2:255:5" or "2:255:3" for single word.
        """
        start_word = self.words[start_idx]
        end_word = self.words[end_idx]

        start_ref = f"{start_word.surah}:{start_word.ayah}:{start_word.word}"
        end_ref = f"{end_word.surah}:{end_word.ayah}:{end_word.word}"

        if start_ref == end_ref:
            return start_ref
        return f"{start_ref}-{end_ref}"

    def get_original_text(self, start_idx: int, end_idx: int) -> str:
        """Get original (non-normalized) text for a range."""
        return " ".join(w.text for w in self.words[start_idx:end_idx + 1])

    def get_text_with_verse_markers(
        self,
        start_idx: int,
        end_idx: int,
        verse_word_counts: dict[int, dict[int, int]]
    ) -> str:
        """
        Get original text with verse markers inserted at verse boundaries.
        """
        parts = []
        for w in self.words[start_idx:end_idx + 1]:
            parts.append(w.text)
            # Check if this is the last word of its verse
            surah_data = verse_word_counts.get(w.surah, {})
            num_words = surah_data.get(w.ayah, 0)
            if num_words > 0 and w.word == num_words:
                # This is the last word of the verse - add marker
                parts.append(f"__VERSE_MARKER_{w.ayah}__")
        return " ".join(parts)

    def ref_to_indices(self, ref: str) -> Optional[tuple[int, int]]:
        """
        Convert a ref like '2:255:1-2:255:5' or '2:255:5' to global start/end indices.
        """
        if not ref or ":" not in ref:
            return None
        try:
            if "-" in ref:
                start_ref, end_ref = ref.split("-")
            else:
                start_ref = end_ref = ref

            def _lookup(r: str) -> Optional[int]:
                parts = r.split(":")
                if len(parts) < 3:
                    return None
                return self.word_lookup.get((int(parts[0]), int(parts[1]), int(parts[2])))

            start_idx = _lookup(start_ref)
            end_idx = _lookup(end_ref)
            if start_idx is None or end_idx is None:
                return None
            return start_idx, end_idx
        except Exception:
            return None


def _parse_location_key(key: str) -> tuple[int, int, int]:
    """Parse location key like '2:255:3' into (surah, ayah, word) for sorting."""
    parts = key.split(":")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


# Global singleton - loaded on first access
_quran_index_cache: Optional[QuranIndex] = None


def get_quran_index() -> QuranIndex:
    """Get or create the global QuranIndex singleton."""
    global _quran_index_cache
    if _quran_index_cache is None:
        _quran_index_cache = QuranIndex.load()
    return _quran_index_cache
