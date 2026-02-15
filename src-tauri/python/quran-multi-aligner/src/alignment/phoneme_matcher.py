"""
Phoneme-based alignment using substring Levenshtein DP.

This module implements the core alignment algorithm for matching ASR phoneme
sequences to reference Quranic text phonemes with word-boundary constraints.
"""

import json
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from config import (
    DATA_PATH,
    LOOKBACK_WORDS,
    LOOKAHEAD_WORDS,
    MAX_EDIT_DISTANCE,
    START_PRIOR_WEIGHT,
    COST_SUBSTITUTION,
    COST_DELETION,
    COST_INSERTION,
    PHONEME_ALIGNMENT_DEBUG,
    PHONEME_ALIGNMENT_PROFILING,
)

from .phonemizer_utils import get_phonemizer


# =============================================================================
# Phoneme Substitution Cost Lookup
# =============================================================================


def _load_substitution_costs() -> Dict[Tuple[str, str], float]:
    """Load phoneme pair substitution costs from JSON data file.

    Stores both orderings (a,b) and (b,a) so lookups need only a plain tuple.
    """
    path = DATA_PATH / "phoneme_sub_costs.json"
    if not path.exists():
        return {}
    with open(path) as f:
        raw = json.load(f)
    costs = {}
    for key, section in raw.items():
        if key == "_meta":
            continue
        for pair_str, cost in section.items():
            a, b = pair_str.split("|")
            c = float(cost)
            costs[(a, b)] = c
            costs[(b, a)] = c
    return costs


_SUBSTITUTION_COSTS: Dict[Tuple[str, str], float] = _load_substitution_costs()

# Try to load Cython-accelerated DP; fall back to pure Python silently.
try:
    from ._dp_core import cy_align_with_word_boundaries, init_substitution_matrix
    init_substitution_matrix(_SUBSTITUTION_COSTS, COST_SUBSTITUTION)
    _USE_CYTHON_DP = True
except ImportError:
    _USE_CYTHON_DP = False


def get_sub_cost(p: str, r: str, default: float) -> float:
    """Look up substitution cost for a phoneme pair.

    Returns 0.0 for exact match, pair-specific cost if defined, otherwise default.
    """
    if p == r:
        return 0.0
    return _SUBSTITUTION_COSTS.get((p, r), default)


# =============================================================================
# Data Structures
# =============================================================================


@dataclass
class RefWord:
    """Reference word with phoneme metadata."""
    text: str              # Arabic text
    phonemes: List[str]    # Phoneme list for this word
    surah: int             # Surah number
    ayah: int              # Verse number within surah
    word_num: int          # Word number within verse (1-indexed)

    @property
    def location(self) -> str:
        """Format as 'surah:ayah:word'."""
        return f"{self.surah}:{self.ayah}:{self.word_num}"


@dataclass
class ChapterReference:
    """Pre-built reference data for a chapter."""
    surah: int
    words: List[RefWord]
    avg_phones_per_word: float

    # Pre-flattened phoneme data (avoids rebuilding per segment)
    flat_phonemes: List[str]        # All phonemes concatenated
    flat_phone_to_word: List[int]   # Word index for each phoneme (GLOBAL indices)
    word_phone_offsets: List[int]   # Prefix sum: word i starts at offset[i]

    @property
    def num_words(self) -> int:
        return len(self.words)


@dataclass
class AlignmentResult:
    """Result of aligning a segment."""
    start_word_idx: int        # Index into ChapterReference.words
    end_word_idx: int          # Index into ChapterReference.words (inclusive)
    edit_cost: float           # Raw edit distance (may be non-integer with substitution costs)
    confidence: float          # 1.0 - (edit_cost / max(asr_len, ref_len))

    # For debugging
    j_start: int               # Start phoneme index in R window
    best_j: int                # End phoneme index in R window (exclusive)

    # Resolved word references
    start_word: RefWord
    end_word: RefWord

    # Whether Basmala prefix was consumed by the alignment
    basmala_consumed: bool = False

    @property
    def ref_from(self) -> str:
        """Start reference as 'surah:ayah:word'."""
        return self.start_word.location

    @property
    def ref_to(self) -> str:
        """End reference as 'surah:ayah:word'."""
        return self.end_word.location

    @property
    def matched_ref(self) -> str:
        """Combined reference as 'start-end'."""
        return f"{self.ref_from}-{self.ref_to}"


# =============================================================================
# Helper Functions
# =============================================================================


def parse_location(location: str) -> Tuple[int, int, int]:
    """Parse 'surah:ayah:word' into (surah, ayah, word_num)."""
    parts = location.split(":")
    return int(parts[0]), int(parts[1]), int(parts[2])


def get_matched_text(chapter_ref: ChapterReference, result: AlignmentResult) -> str:
    """Get Arabic text for aligned words."""
    words = chapter_ref.words[result.start_word_idx : result.end_word_idx + 1]
    return ' '.join(w.text for w in words)


def _word_loc(words: List, idx: int) -> str:
    """Format word index as 'ayah:word_num'."""
    if idx < 0 or idx >= len(words):
        return f"?({idx})"
    w = words[idx]
    return f"{w.ayah}:{w.word_num}"


def print_debug_info(
    P: List[str],
    R: List[str],
    result: Optional[AlignmentResult],
    segment_idx: int,
    pointer: int,
    win_start: int,
    win_end: int,
    words: List = None,
) -> None:
    """Print detailed alignment debug info."""
    if not PHONEME_ALIGNMENT_DEBUG:
        return

    print("\n" + "━" * 60)
    print(f"[PHONEME ALIGN] Segment {segment_idx}")
    print("─" * 60)
    loc_range = ""
    if words:
        loc_range = f" = {_word_loc(words, win_start)}-{_word_loc(words, win_end)}"
    print(f"  Window: words [{win_start}-{win_end}]{loc_range} "
          f"({win_end - win_start} words, {len(R)} phonemes)")
    ptr_loc = ""
    if words:
        ptr_loc = f" = {_word_loc(words, pointer)}"
    print(f"  Expected start: word {pointer}{ptr_loc}")
    print()
    if len(R) <= 40:
        print(f"  R:        {' '.join(R)}")
    else:
        print(f"  R:        {' '.join(R[:20])} ... {' '.join(R[-20:])}")
    print(f"  P:        {' '.join(P)}  ({len(P)} phonemes)")
    print()

    if result:
        recovered = R[result.j_start:result.best_j]
        print(f"  ✓ MATCH: words [{result.start_word_idx}-{result.end_word_idx}] "
              f"({result.end_word_idx - result.start_word_idx + 1} words)")
        print(f"  Recovered: {' '.join(recovered)}  ({len(recovered)} phonemes)")
        print(f"  Edit cost: {result.edit_cost}")
        print(f"  Confidence: {result.confidence:.2f}")
    else:
        print(f"  ✗ NO MATCH (no candidates passed threshold)")

    print("━" * 60)


# =============================================================================
# Chapter Reference Building
# =============================================================================


def build_chapter_reference(surah_num: int) -> ChapterReference:
    """Build phoneme reference for entire chapter."""
    pm = get_phonemizer()

    # Phonemize entire chapter with stopping rules at verse boundaries
    result = pm.phonemize(
        ref=str(surah_num),
        stops=["verse"]
    )

    # Get mapping - provides word metadata and phonemes directly
    mapping = result.get_mapping()

    # Build RefWord list - WordMapping already has phonemes as List[str]
    words = []
    for word in mapping.words:
        surah, ayah, word_num = parse_location(word.location)
        words.append(RefWord(
            text=word.text,
            phonemes=word.phonemes,  # Direct access, no string parsing needed
            surah=surah,
            ayah=ayah,
            word_num=word_num,
        ))

    # Compute average phonemes per word
    total_phones = sum(len(w.phonemes) for w in words)
    avg_phones_per_word = total_phones / len(words) if words else 4.0

    # Pre-flatten phonemes for efficient windowing (avoids per-segment rebuilds)
    flat_phonemes = []
    flat_phone_to_word = []
    word_phone_offsets = []

    for word_idx, word in enumerate(words):
        word_phone_offsets.append(len(flat_phonemes))  # Start offset for this word
        for ph in word.phonemes:
            flat_phonemes.append(ph)
            flat_phone_to_word.append(word_idx)

    # Sentinel: offset past last phoneme (for slicing convenience)
    word_phone_offsets.append(len(flat_phonemes))

    return ChapterReference(
        surah=surah_num,
        words=words,
        avg_phones_per_word=avg_phones_per_word,
        flat_phonemes=flat_phonemes,
        flat_phone_to_word=flat_phone_to_word,
        word_phone_offsets=word_phone_offsets,
    )


# =============================================================================
# Word-Boundary-Constrained Alignment (DP)
# =============================================================================


def align_with_word_boundaries(
    P: List[str],
    R: List[str],
    R_phone_to_word: List[int],
    expected_word: int = 0,
    prior_weight: float = START_PRIOR_WEIGHT,
    cost_sub: float = COST_SUBSTITUTION,
    cost_del: float = COST_DELETION,
    cost_ins: float = COST_INSERTION,
) -> Tuple[Optional[int], Optional[int], float, float]:
    """
    Word-boundary-constrained substring alignment.

    Combines DP computation with best-match selection:
    - Start: only word-start positions allowed (INF cost otherwise)
    - End: only word-end positions evaluated as candidates

    Args:
        P: ASR phoneme sequence
        R: Reference phoneme window
        R_phone_to_word: Maps phoneme index -> word index (GLOBAL indices)
        expected_word: Expected starting word index (for position prior)
        prior_weight: Penalty per word distance from expected
        cost_sub: Substitution cost
        cost_del: Deletion cost (delete from P)
        cost_ins: Insertion cost (insert from R)

    Returns:
        (best_j, best_j_start, best_cost, best_norm_dist) or (None, None, INF, INF)
    """
    if _USE_CYTHON_DP:
        return cy_align_with_word_boundaries(
            P, R, R_phone_to_word,
            expected_word, prior_weight,
            cost_sub, cost_del, cost_ins,
        )

    # --- Pure Python fallback ---
    m, n = len(P), len(R)
    INF = float('inf')

    if m == 0 or n == 0:
        return None, None, INF, float('inf')

    # DP column semantics:
    #   Column j represents "consumed j phonemes" / boundary after phoneme j-1
    #   Column 0 = before any phonemes, Column n = after all phonemes
    #   Phoneme indices are 0..n-1, DP columns are 0..n

    def is_start_boundary(j: int) -> bool:
        """Can alignment START at DP column j? (before phoneme j)"""
        if j >= n:
            return False  # Can't start at or past end
        if j == 0:
            return True   # Column 0 is always valid start (first word)
        # Valid if phoneme j begins a new word
        return R_phone_to_word[j] != R_phone_to_word[j - 1]

    def is_end_boundary(j: int) -> bool:
        """Can alignment END at DP column j? (after phoneme j-1)"""
        if j == 0:
            return False  # Can't end before consuming anything
        if j == n:
            return True   # Column n (end of reference) always valid
        # Valid if phoneme j starts a new word (meaning j-1 ended a word)
        return R_phone_to_word[j] != R_phone_to_word[j - 1]

    # Initialize: free start ONLY at word boundaries
    prev_cost = [0.0 if is_start_boundary(j) else INF for j in range(n + 1)]
    prev_start = [j if is_start_boundary(j) else -1 for j in range(n + 1)]

    curr_cost = [0.0] * (n + 1)
    curr_start = [0] * (n + 1)

    # DP computation
    for i in range(1, m + 1):
        curr_cost[0] = i * cost_del if is_start_boundary(0) else INF
        curr_start[0] = 0 if is_start_boundary(0) else -1

        for j in range(1, n + 1):
            del_option = prev_cost[j] + cost_del
            ins_option = curr_cost[j-1] + cost_ins
            sub_option = prev_cost[j-1] + get_sub_cost(P[i-1], R[j-1], cost_sub)

            if sub_option <= del_option and sub_option <= ins_option:
                curr_cost[j] = sub_option
                curr_start[j] = prev_start[j-1]
            elif del_option <= ins_option:
                curr_cost[j] = del_option
                curr_start[j] = prev_start[j]
            else:
                curr_cost[j] = ins_option
                curr_start[j] = curr_start[j-1]

        prev_cost, curr_cost = curr_cost, prev_cost
        prev_start, curr_start = curr_start, prev_start

    # After DP: evaluate only valid end boundary positions
    # prev_cost/prev_start now contain the final row (after m iterations)
    best_score = float('inf')  # Score includes float norm_dist, so keep as float
    best_j = None
    best_j_start = None
    best_cost = INF
    best_norm_dist = float('inf')

    for j in range(1, n + 1):
        # Skip non-end-boundary positions
        if not is_end_boundary(j):
            continue

        # Skip infinite cost (no valid alignment ends here)
        if prev_cost[j] >= INF:
            continue

        dist = prev_cost[j]
        j_start = prev_start[j]

        # Compute normalized edit distance
        ref_len = j - j_start
        denom = max(m, ref_len, 1)
        norm_dist = dist / denom

        # Position prior on start word
        start_word = R_phone_to_word[j_start] if j_start < n else R_phone_to_word[j - 1]
        prior = prior_weight * abs(start_word - expected_word)
        score = norm_dist + prior

        if score < best_score:
            best_score = score
            best_j = j
            best_j_start = j_start
            best_cost = dist
            best_norm_dist = norm_dist

    return best_j, best_j_start, best_cost, best_norm_dist


# =============================================================================
# Per-Segment Alignment
# =============================================================================


def align_segment(
    asr_phonemes: List[str],
    chapter_ref: ChapterReference,
    pointer: int,
    segment_idx: int = 0,
    basmala_prefix: bool = False,
    lookback_override: Optional[int] = None,
    lookahead_override: Optional[int] = None,
    max_edit_distance_override: Optional[float] = None,
) -> Tuple[Optional[AlignmentResult], dict]:
    """
    Align ASR phonemes to reference using substring Levenshtein DP.

    Args:
        asr_phonemes: Phoneme sequence from ASR for this segment
        chapter_ref: Pre-built chapter reference data
        pointer: First unprocessed word index (0 at start of chapter)
        segment_idx: Segment number for debug output
        basmala_prefix: If True, prepend Basmala phonemes to the R window
            so the DP can consume a fused Basmala+verse segment
        lookback_override: Override LOOKBACK_WORDS for this call
        lookahead_override: Override LOOKAHEAD_WORDS for this call
        max_edit_distance_override: Override MAX_EDIT_DISTANCE for this call

    Returns: (AlignmentResult or None, timing_dict)
    """
    timing = {'window_setup_time': 0.0, 'dp_time': 0.0, 'result_build_time': 0.0}

    # Only import time if profiling is enabled
    if PHONEME_ALIGNMENT_PROFILING:
        import time

    P = asr_phonemes
    m = len(P)

    if m == 0:
        return None, timing

    words = chapter_ref.words
    avg_phones = chapter_ref.avg_phones_per_word
    num_words = chapter_ref.num_words

    # === WINDOW SETUP ===
    if PHONEME_ALIGNMENT_PROFILING:
        t0 = time.perf_counter()

    # 1. Estimate word count from phoneme count
    est_words = max(1, round(m / avg_phones))

    # 2. Define search window (word indices)
    lb = lookback_override if lookback_override is not None else LOOKBACK_WORDS
    la = lookahead_override if lookahead_override is not None else LOOKAHEAD_WORDS
    win_start = max(0, pointer - lb)
    win_end = min(num_words, pointer + est_words + la)

    # End of chapter check
    if win_start >= num_words:
        if PHONEME_ALIGNMENT_PROFILING:
            timing['window_setup_time'] = time.perf_counter() - t0
        if PHONEME_ALIGNMENT_DEBUG:
            print(f"[PHONEME ALIGN] Segment {segment_idx}: Past end of chapter")
        return None, timing

    # 3. Slice pre-flattened phoneme window
    phone_start = chapter_ref.word_phone_offsets[win_start]
    phone_end = chapter_ref.word_phone_offsets[win_end]

    R = chapter_ref.flat_phonemes[phone_start:phone_end]
    R_phone_to_word = chapter_ref.flat_phone_to_word[phone_start:phone_end]

    # Optionally prepend Basmala phonemes so the DP can consume fused Basmala+verse
    BASMALA_SENTINEL = -1
    prefix_phonemes = None
    if basmala_prefix:
        from .special_segments import SPECIAL_PHONEMES
        prefix_phonemes = SPECIAL_PHONEMES["Basmala"]

    if prefix_phonemes is not None:
        prefix_len = len(prefix_phonemes)
        R = list(prefix_phonemes) + list(R)
        R_phone_to_word = [BASMALA_SENTINEL] * prefix_len + list(R_phone_to_word)

    n = len(R)

    if n == 0:
        if PHONEME_ALIGNMENT_PROFILING:
            timing['window_setup_time'] = time.perf_counter() - t0
        if PHONEME_ALIGNMENT_DEBUG:
            print(f"[PHONEME ALIGN] Segment {segment_idx}: Empty reference window")
        return None, timing

    if PHONEME_ALIGNMENT_PROFILING:
        timing['window_setup_time'] = time.perf_counter() - t0

    # === DP ===
    if PHONEME_ALIGNMENT_PROFILING:
        t0 = time.perf_counter()

    # 4. Run word-boundary-constrained alignment (DP + selection in one pass)
    best_j, j_start, best_cost, norm_dist = align_with_word_boundaries(
        P, R, R_phone_to_word,
        expected_word=pointer,
        prior_weight=START_PRIOR_WEIGHT
    )

    if PHONEME_ALIGNMENT_PROFILING:
        timing['dp_time'] = time.perf_counter() - t0

    # === RESULT BUILD ===
    if PHONEME_ALIGNMENT_PROFILING:
        t0 = time.perf_counter()

    if best_j is None:
        if PHONEME_ALIGNMENT_PROFILING:
            timing['result_build_time'] = time.perf_counter() - t0
        print_debug_info(P, R, None, segment_idx, pointer, win_start, win_end, words)
        return None, timing

    # 5. Check acceptance threshold
    threshold = max_edit_distance_override if max_edit_distance_override is not None else MAX_EDIT_DISTANCE
    if norm_dist > threshold:
        if PHONEME_ALIGNMENT_PROFILING:
            timing['result_build_time'] = time.perf_counter() - t0
        print_debug_info(P, R, None, segment_idx, pointer, win_start, win_end, words)
        return None, timing

    # 6. Confidence is 1 - normalized distance
    confidence = 1.0 - norm_dist

    # 7. Map phoneme indices to word indices
    start_word_idx = R_phone_to_word[j_start]
    end_word_idx = R_phone_to_word[best_j - 1]

    # Handle prefix: if alignment starts in the prefix region, find the first real word
    basmala_consumed = False
    if prefix_phonemes is not None and start_word_idx == BASMALA_SENTINEL:
        basmala_consumed = True
        for k in range(j_start, best_j):
            if R_phone_to_word[k] != BASMALA_SENTINEL:
                start_word_idx = R_phone_to_word[k]
                break
        else:
            # Entire match is just Basmala with no verse content — reject
            if PHONEME_ALIGNMENT_PROFILING:
                timing['result_build_time'] = time.perf_counter() - t0
            return None, timing

    result = AlignmentResult(
        start_word_idx=start_word_idx,
        end_word_idx=end_word_idx,
        edit_cost=best_cost,
        confidence=confidence,
        j_start=j_start,
        best_j=best_j,
        start_word=words[start_word_idx],
        end_word=words[end_word_idx],
        basmala_consumed=basmala_consumed,
    )

    if PHONEME_ALIGNMENT_PROFILING:
        timing['result_build_time'] = time.perf_counter() - t0

    # Debug output
    print_debug_info(P, R, result, segment_idx, pointer, win_start, win_end, words)

    return result, timing
