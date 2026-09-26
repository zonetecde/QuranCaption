"""Unified Quran Recitation Matching Subsystem Package."""

from src.matching.reference import (
    RefWord,
    SurahReferenceData,
)
from src.matching.phonetics import (
    ZERO_COST_MARKERS,
    HAMZA_VARIANTS,
    MADD_VOWEL_CODES,
    normalize_phoneme_query,
    get_sub_cost_table,
)
from src.matching.kernels import (
    warmup_matching,
    warmup_matching_kernels,
    warmup_matcher_jit,
    warmup_detector_jit,
)
from src.matching.detector import (
    FuzzyMatch,
    SurahSearchResult,
    SurahDetectionResult,
    find_near_matches,
    SurahDetector,
)
from src.matching.matcher import (
    MatcherConfig,
    QuranMatcher,
    QuranWordMatcher,
)

__all__ = [
    "RefWord",
    "SurahReferenceData",
    "ZERO_COST_MARKERS",
    "HAMZA_VARIANTS",
    "MADD_VOWEL_CODES",
    "normalize_phoneme_query",
    "get_sub_cost_table",
    "warmup_matching",
    "warmup_matching_kernels",
    "warmup_matcher_jit",
    "warmup_detector_jit",
    "FuzzyMatch",
    "SurahSearchResult",
    "SurahDetectionResult",
    "find_near_matches",
    "SurahDetector",
    "MatcherConfig",
    "QuranMatcher",
    "QuranWordMatcher",
]
