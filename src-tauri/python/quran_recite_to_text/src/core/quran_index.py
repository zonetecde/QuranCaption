"""QuranIndex: Single Source of Truth for Quranic Text."""

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_project_root = Path(__file__).parent.parent.parent.resolve()
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from config import QURAN_SCRIPT_PATH_COMPUTE

VERSE_MARKER_PREFIX = '۝'


@dataclass
class WordInfo:
    """Represents a single logical word in the Quran."""
    global_idx: int
    surah: int
    ayah: int
    word: int
    text: str

    @property
    def display_text(self) -> str:
        return self.text


@dataclass
class QuranIndex:
    """Pre-indexed in-memory Quran database for reference resolution."""
    words: list[WordInfo]
    word_lookup: dict[tuple[int, int, int], int]

    @classmethod
    def load(cls, compute_path: Optional[Path] = None) -> "QuranIndex":
        if compute_path is None:
            compute_path = QURAN_SCRIPT_PATH_COMPUTE

        with open(compute_path, "r", encoding="utf-8") as f:
            compute_data = json.load(f)

        words: list[WordInfo] = []
        word_lookup: dict[tuple[int, int, int], int] = {}
        sorted_keys = sorted(compute_data.keys(), key=parse_location_key)

        for key in sorted_keys:
            entry = compute_data[key]
            text = entry["text"]

            if text.startswith(VERSE_MARKER_PREFIX):
                continue

            surah, ayah, word = int(entry["surah"]), int(entry["ayah"]), int(entry["word"])
            word_info = WordInfo(
                global_idx=len(words),
                surah=surah,
                ayah=ayah,
                word=word,
                text=text,
            )
            words.append(word_info)
            word_lookup[(surah, ayah, word)] = word_info.global_idx

        return cls(words=words, word_lookup=word_lookup)

    def ref_to_indices(self, ref: str) -> Optional[tuple[int, int]]:
        """Converts reference strings (e.g. '1:1:1-1:1:4') to (start_idx, end_idx)."""
        if not ref or ":" not in ref:
            return None
        try:
            start_ref, end_ref = ref.split("-") if "-" in ref else (ref, ref)

            def _lookup(r: str) -> Optional[int]:
                parts = r.split(":")
                if len(parts) < 3:
                    return None
                return self.word_lookup.get((int(parts[0]), int(parts[1]), int(parts[2])))

            start_idx, end_idx = _lookup(start_ref), _lookup(end_ref)
            if start_idx is None or end_idx is None:
                return None
            return start_idx, end_idx
        except Exception:
            return None


def parse_location_key(item) -> tuple[int, int, int]:
    """Parses location string like '2:255:3' or dict with location into (2, 255, 3)."""
    key = str(item.get("location", "")) if isinstance(item, dict) else str(item)
    if ":" in key:
        parts = key.split(":")
        if len(parts) >= 3:
            try:
                return (int(parts[0]), int(parts[1]), int(parts[2]))
            except ValueError:
                pass
    return (0, 0, 0)


_parse_location_key = parse_location_key
_quran_index_cache: Optional[QuranIndex] = None


def get_quran_index() -> QuranIndex:
    """Global accessor for QuranIndex (singleton instance)."""
    global _quran_index_cache
    if _quran_index_cache is None:
        _quran_index_cache = QuranIndex.load()
    return _quran_index_cache
