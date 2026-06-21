"""
Data models for transcription results.
"""

from dataclasses import dataclass
from typing import Any, List, TypedDict

from surah_splitter.models.base import DataclassJsonMixin


class RecognizedSentencesAndWords(TypedDict):
    transcription: Any
    word_segments: List[Any]


class MatchedAyahsAndSpans(TypedDict):
    ayah_timestamps: List["AyahTimestamp"]
    word_spans: List["SegmentedWordSpan"]


@dataclass
class WordMatch:
    """Represents a match for a word in the Quran w.r.t its surah/ayah."""

    surah: int
    ayah: int
    position_wrt_surah: int  # Position of word within the surah
    word: str


@dataclass
class ReferenceWord(DataclassJsonMixin):
    """Represents a word from the ground truth text with position information."""

    word: str
    ayah_number: int
    position_wrt_surah: int = None
    position_wrt_ayah: int = None


@dataclass
class RecognizedWord(DataclassJsonMixin):
    """Represents a word recognized by WhisperX with timing information."""

    word: str
    start_time: float
    end_time: float
    score: float = None  # Confidence score, if available


@dataclass
class SegmentedWordSpan(DataclassJsonMixin):
    """
    Represents a span of words with timing information, matching the structure
    used in the quran-align C++ implementation but adapted for Python.
    """

    reference_index_start: int  # Start index within reference (i.e., ground truth) words
    reference_index_end: int  # End index (exclusive) within reference words
    reference_words_segment: str  # Segment of reference words (just for tracing purposes)

    input_words_segment: str  # Segment of input (i.e., WhisperX recognized) words (just for tracing purposes)
    start: float  # Start time in seconds
    end: float  # End time in seconds

    flags: int = 0  # Flags indicating match quality
    flags_info: dict = None  # Dictionary with human-readable flag information

    # Flag values (matching the C++ impl)
    CLEAR = 0
    MATCHED_INPUT = 1
    MATCHED_REFERENCE = 2
    EXACT = 4
    INEXACT = 8

    def __post_init__(self):
        """Initialize the flags_info dictionary if not provided"""
        if self.flags_info is None:
            self.flags_info = {
                "matched_input": bool(self.flags & self.MATCHED_INPUT),
                "matched_reference": bool(self.flags & self.MATCHED_REFERENCE),
                "exact": bool(self.flags & self.EXACT),
                "inexact": bool(self.flags & self.INEXACT),
            }


@dataclass
class SegmentationStats(DataclassJsonMixin):
    """Track statistics about the matching process."""

    insertions: int = 0
    deletions: int = 0
    transpositions: int = 0


@dataclass
class AyahTimestamp(DataclassJsonMixin):
    """The final output format for ayah timing information."""

    ayah_number: int
    start_time: float
    end_time: float
    text: str
