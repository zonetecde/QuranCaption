"""
QuranIndex: Pre-indexed Quran words for reference lookup and display.

Uses dual-script loading:
- QPC Hafs (qpc_hafs.json) for computation (indices, word counts, lookups)
- Digital Khatt (digital_khatt_v2_script.json) for display (renders correctly with DK font)

Stop signs in Digital Khatt are combining marks attached to words, while QPC Hafs
has spaces before stop signs. The DigitalKhatt font renders DK text correctly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from config import QURAN_SCRIPT_PATH_COMPUTE, QURAN_SCRIPT_PATH_DISPLAY


# Verse marker prefix to filter out (end-of-ayah markers)
VERSE_MARKER_PREFIX = '۝'


@dataclass
class WordInfo:
    """Information about a single Quran word."""
    global_idx: int       # Position in flat word array
    surah: int
    ayah: int
    word: int
    text: str             # QPC Hafs text (computation)
    display_text: str     # Digital Khatt text (display)


@dataclass
class QuranIndex:
    """
    Pre-indexed Quran words for reference lookup and display.

    Used to convert matched references (e.g. "2:255:1-2:255:5") back to
    original Arabic text with verse markers for UI rendering.
    """
    words: list[WordInfo]                           # All words in order
    word_lookup: dict[tuple[int, int, int], int]    # (surah, ayah, word) -> global_idx

    @classmethod
    def load(cls, compute_path: Optional[Path] = None, display_path: Optional[Path] = None) -> "QuranIndex":
        """
        Load and index the Quran from dual script sources.

        Uses QPC Hafs as primary (determines word structure) and Digital Khatt
        for display text. Falls back to QPC text if DK entry is missing.

        Filters out verse markers (۝) - they're not real words.
        """
        if compute_path is None:
            compute_path = QURAN_SCRIPT_PATH_COMPUTE
        if display_path is None:
            display_path = QURAN_SCRIPT_PATH_DISPLAY

        with open(compute_path, "r", encoding="utf-8") as f:
            compute_data = json.load(f)
        with open(display_path, "r", encoding="utf-8") as f:
            display_data = json.load(f)

        words: list[WordInfo] = []
        word_lookup: dict[tuple[int, int, int], int] = {}

        # Sort by location key to ensure order (1:1:1, 1:1:2, ..., 114:6:3)
        sorted_keys = sorted(compute_data.keys(), key=_parse_location_key)

        for key in sorted_keys:
            entry = compute_data[key]
            text = entry["text"]

            # Skip verse markers (QPC shouldn't have any, but safety check)
            if text.startswith(VERSE_MARKER_PREFIX):
                continue

            surah = int(entry["surah"])
            ayah = int(entry["ayah"])
            word = int(entry["word"])

            # Get display text from Digital Khatt, fallback to QPC text
            dk_entry = display_data.get(key)
            display_text = dk_entry["text"] if dk_entry else text

            word_info = WordInfo(
                global_idx=len(words),
                surah=surah,
                ayah=ayah,
                word=word,
                text=text,
                display_text=display_text,
            )
            words.append(word_info)
            word_lookup[(surah, ayah, word)] = word_info.global_idx

        print(f"[QuranIndex] Loaded {len(words)} words")

        return cls(
            words=words,
            word_lookup=word_lookup,
        )

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
