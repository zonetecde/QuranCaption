"""
Cache for ChapterReference objects.

Loads pre-built chapter references from a pickle file (built by
scripts/build_phoneme_cache.py) to avoid runtime phonemization.
"""

import pickle
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .phoneme_matcher import ChapterReference

# Global cache: surah number -> ChapterReference
_chapter_cache: dict[int, "ChapterReference"] = {}


def get_chapter_reference(surah: int) -> "ChapterReference":
    """
    Get chapter reference from cache.

    Args:
        surah: Surah number (1-114)

    Returns:
        ChapterReference with pre-built phoneme data
    """
    if surah not in _chapter_cache:
        # Fallback: build at runtime if cache wasn't preloaded
        from .phoneme_matcher import build_chapter_reference
        print(f"[CACHE] WARNING: Building reference for Surah {surah} at runtime "
              "(phoneme cache not loaded — run scripts/build_phoneme_cache.py)")
        _chapter_cache[surah] = build_chapter_reference(surah)
    return _chapter_cache[surah]


def preload_all_chapters() -> None:
    """Load all 114 chapter references from the pre-built cache file."""
    from config import PHONEME_CACHE_PATH

    if PHONEME_CACHE_PATH.exists():
        print(f"[CACHE] Loading phoneme cache from {PHONEME_CACHE_PATH}...")
        with open(PHONEME_CACHE_PATH, "rb") as f:
            loaded: dict[int, "ChapterReference"] = pickle.load(f)
        _chapter_cache.update(loaded)
        print(f"[CACHE] Loaded {len(loaded)} chapters from cache")
    else:
        print(f"[CACHE] WARNING: {PHONEME_CACHE_PATH} not found, "
              "falling back to runtime phonemization")
        print("[CACHE] Run: python scripts/build_phoneme_cache.py")
        for surah in range(1, 115):
            get_chapter_reference(surah)
        print(f"[CACHE] All 114 chapters built at runtime")


def clear_chapter_cache() -> None:
    """Clear cache (for memory management)."""
    _chapter_cache.clear()
    print("[CACHE] Cleared chapter cache")
