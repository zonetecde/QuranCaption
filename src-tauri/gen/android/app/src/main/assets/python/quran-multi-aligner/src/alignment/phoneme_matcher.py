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
    WRAP_PENALTY,
    WRAP_SCORE_COST,
    WRAP_SCORING_MODE,
    WRAP_SPAN_WEIGHT,
    MAX_WRAPS,
    PHONEME_ALIGNMENT_DEBUG,
    PHONEME_ALIGNMENT_PROFILING,
)

from .phonemizer_utils import get_phonemizer, phonemize_with_stops


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
    from ._dp_core import cy_align_wraparound, init_substitution_matrix
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

    # Repetition detection (wraparound DP)
    n_wraps: int = 0
    max_j_reached: int = 0
    wrap_points: list = None       # List of (i, j_end, j_start) tuples
    wrap_word_ranges: list = None  # List of (start_ref, end_ref) for repeated sections

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
    result = phonemize_with_stops(pm, ref=str(surah_num), stops=["verse"])

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
# Wraparound DP (unified — replaces align_with_word_boundaries)
# =============================================================================


def align_wraparound(
    P: List[str],
    R: List[str],
    R_phone_to_word: List[int],
    expected_word: int = 0,
    prior_weight: float = START_PRIOR_WEIGHT,
    cost_sub: float = COST_SUBSTITUTION,
    cost_del: float = COST_DELETION,
    cost_ins: float = COST_INSERTION,
    wrap_penalty: float = WRAP_PENALTY,
    max_wraps: int = 0,
    scoring_mode: str = "additive",
    wrap_score_cost: float = WRAP_SCORE_COST,
    wrap_span_weight: float = WRAP_SPAN_WEIGHT,
):
    """
    Word-boundary-constrained substring alignment with optional wraparound.

    When max_wraps=0, equivalent to the old align_with_word_boundaries.
    When max_wraps>0, allows R to loop back at word boundaries for repetition detection.

    Returns:
        (best_j, j_start, best_cost, norm_dist, n_wraps, max_j_reached, wrap_points)
        wrap_points: list of (i, j_end, j_start) tuples (empty when no wraps)
    """
    if _USE_CYTHON_DP:
        return cy_align_wraparound(
            P, R, R_phone_to_word,
            expected_word, prior_weight,
            cost_sub, cost_del, cost_ins,
            wrap_penalty, max_wraps,
            scoring_mode, wrap_score_cost,
            wrap_span_weight,
        )

    # --- Pure Python fallback ---
    m, n = len(P), len(R)
    INF = float('inf')

    if m == 0 or n == 0:
        return None, None, INF, INF, 0, 0, []

    # Precompute word boundary sets
    word_starts = set()
    word_ends = set()
    for j in range(n + 1):
        if j == 0 or (j < n and R_phone_to_word[j] != R_phone_to_word[j - 1]):
            word_starts.add(j)
        if j == n or (j > 0 and j < n and R_phone_to_word[j] != R_phone_to_word[j - 1]):
            word_ends.add(j)

    K = max_wraps

    if K == 0:
        # ---- Rolling-row fast path (no wraparound) ----
        prev_cost = [0.0 if j in word_starts else INF for j in range(n + 1)]
        prev_start = [j if j in word_starts else -1 for j in range(n + 1)]
        curr_cost = [0.0] * (n + 1)
        curr_start = [0] * (n + 1)

        for i in range(1, m + 1):
            curr_cost[0] = i * cost_del if 0 in word_starts else INF
            curr_start[0] = 0 if 0 in word_starts else -1

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

        best_score = INF
        best_j = None
        best_j_start = None
        best_cost_val = INF
        best_norm = INF

        for j in range(1, n + 1):
            if j not in word_ends:
                continue
            if prev_cost[j] >= INF:
                continue
            dist = prev_cost[j]
            j_s = prev_start[j]
            ref_len = j - j_s
            denom = max(m, ref_len, 1)
            nd = dist / denom
            sw = R_phone_to_word[j_s] if j_s < n else R_phone_to_word[j - 1]
            prior = prior_weight * abs(sw - expected_word)
            score = nd + prior
            if score < best_score:
                best_score = score
                best_j = j
                best_j_start = j_s
                best_cost_val = dist
                best_norm = nd

        if best_j is None:
            return None, None, INF, INF, 0, 0, []
        return best_j, best_j_start, best_cost_val, best_norm, 0, best_j, []

    # ---- Full 3D matrix with traceback (max_wraps > 0) ----
    dp = [[[INF] * (n + 1) for _ in range(K + 1)] for _ in range(m + 1)]
    parent = [[[None] * (n + 1) for _ in range(K + 1)] for _ in range(m + 1)]
    start_arr = [[[-1] * (n + 1) for _ in range(K + 1)] for _ in range(m + 1)]
    max_j_arr = [[[-1] * (n + 1) for _ in range(K + 1)] for _ in range(m + 1)]
    # Track minimum word index reached along each path so wrap paths
    # can't game the position prior by starting near the expected word
    # then jumping backward.
    BIG_W = 999999
    min_w_arr = [[[BIG_W] * (n + 1) for _ in range(K + 1)] for _ in range(m + 1)]

    # Initialize: k=0, free starts at word boundaries
    for j in word_starts:
        dp[0][0][j] = 0.0
        start_arr[0][0][j] = j
        max_j_arr[0][0][j] = j
        min_w_arr[0][0][j] = R_phone_to_word[j] if j < n else BIG_W

    # Fill DP
    for i in range(1, m + 1):
        for k in range(K + 1):
            if k == 0 and 0 in word_starts:
                dp[i][k][0] = i * cost_del
                parent[i][k][0] = (i - 1, k, 0, 'D')
                start_arr[i][k][0] = 0
                max_j_arr[i][k][0] = 0
                min_w_arr[i][k][0] = min_w_arr[i-1][k][0]

            for j in range(1, n + 1):
                del_opt = dp[i-1][k][j] + cost_del if dp[i-1][k][j] < INF else INF
                ins_opt = dp[i][k][j-1] + cost_ins if dp[i][k][j-1] < INF else INF
                sub_opt = dp[i-1][k][j-1] + get_sub_cost(P[i-1], R[j-1], cost_sub) \
                          if dp[i-1][k][j-1] < INF else INF

                best = min(del_opt, ins_opt, sub_opt)
                if best < INF:
                    dp[i][k][j] = best
                    w_j = R_phone_to_word[j - 1] if j > 0 else BIG_W
                    if best == sub_opt:
                        parent[i][k][j] = (i - 1, k, j - 1, 'S')
                        start_arr[i][k][j] = start_arr[i-1][k][j-1]
                        max_j_arr[i][k][j] = max(max_j_arr[i-1][k][j-1], j)
                        min_w_arr[i][k][j] = min(min_w_arr[i-1][k][j-1], w_j)
                    elif best == del_opt:
                        parent[i][k][j] = (i - 1, k, j, 'D')
                        start_arr[i][k][j] = start_arr[i-1][k][j]
                        max_j_arr[i][k][j] = max_j_arr[i-1][k][j]
                        min_w_arr[i][k][j] = min_w_arr[i-1][k][j]
                    else:
                        parent[i][k][j] = (i, k, j - 1, 'I')
                        start_arr[i][k][j] = start_arr[i][k][j-1]
                        max_j_arr[i][k][j] = max(max_j_arr[i][k][j-1], j)
                        min_w_arr[i][k][j] = min(min_w_arr[i][k][j-1], w_j)

        # Wrap transitions
        for k in range(K):
            for j_end in word_ends:
                if dp[i][k][j_end] >= INF:
                    continue
                cost_at_end = dp[i][k][j_end]
                for j_s in word_starts:
                    if j_s >= j_end:
                        continue
                    word_span = abs(R_phone_to_word[j_end - 1] - R_phone_to_word[j_s])
                    new_cost = cost_at_end + wrap_penalty + wrap_span_weight * word_span
                    if new_cost < dp[i][k+1][j_s]:
                        dp[i][k+1][j_s] = new_cost
                        parent[i][k+1][j_s] = (i, k, j_end, 'W')
                        start_arr[i][k+1][j_s] = start_arr[i][k][j_end]
                        max_j_arr[i][k+1][j_s] = max(max_j_arr[i][k][j_end], j_end)
                        min_w_arr[i][k+1][j_s] = min(min_w_arr[i][k][j_end], R_phone_to_word[j_s])

            # Re-propagate insertions from wrap positions
            for j in range(1, n + 1):
                ins_opt = dp[i][k+1][j-1] + cost_ins if dp[i][k+1][j-1] < INF else INF
                if ins_opt < dp[i][k+1][j]:
                    dp[i][k+1][j] = ins_opt
                    parent[i][k+1][j] = (i, k+1, j-1, 'I')
                    start_arr[i][k+1][j] = start_arr[i][k+1][j-1]
                    max_j_arr[i][k+1][j] = max(max_j_arr[i][k+1][j-1], j)
                    w_j = R_phone_to_word[j - 1] if j > 0 else BIG_W
                    min_w_arr[i][k+1][j] = min(min_w_arr[i][k+1][j-1], w_j)

    # Best-match selection
    best_score = INF
    best_j = None
    best_j_start = None
    best_cost_val = INF
    best_norm = INF
    best_k = 0
    best_max_j = 0

    for k in range(K + 1):
        for j in range(1, n + 1):
            if j not in word_ends:
                continue
            if dp[m][k][j] >= INF:
                continue
            dist = dp[m][k][j]
            j_s = start_arr[m][k][j]
            if j_s < 0:
                continue
            mj = max_j_arr[m][k][j]
            ref_len = max(mj, j) - j_s
            if ref_len <= 0:
                continue
            denom = max(m, ref_len, 1)

            if scoring_mode == "no_subtract":
                pc = dist
            else:
                pc = dist - k * wrap_penalty
            nd = pc / denom

            sw = R_phone_to_word[j_s] if j_s < n else R_phone_to_word[j - 1]
            # Use the earliest word the path actually touches for a fair prior
            mw = min_w_arr[m][k][j]
            eff_sw = min(sw, mw) if mw < BIG_W else sw
            prior = prior_weight * abs(eff_sw - expected_word)
            score = nd + prior
            if scoring_mode == "additive":
                score += k * wrap_score_cost

            if score < best_score:
                best_score = score
                best_j = j
                best_j_start = j_s
                best_cost_val = dist
                best_norm = nd
                best_k = k
                best_max_j = mj

    if best_j is None:
        return None, None, INF, INF, 0, 0, []

    # Traceback: walk parent pointers, collect wrap points
    wrap_points = []
    ci, ck, cj = m, best_k, best_j
    while parent[ci][ck][cj] is not None:
        pi, pk, pj, trans = parent[ci][ck][cj]
        if trans == 'W':
            wrap_points.append((ci, pj, cj))
        ci, ck, cj = pi, pk, pj
    wrap_points.reverse()

    return best_j, best_j_start, best_cost_val, best_norm, best_k, best_max_j, wrap_points


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

    # Record DP trace for the debug collector / v3 log row.
    # Captured up front so any failure path can still emit the window state
    # the DP actually saw. j_start/best_j/basmala_consumed get filled in below
    # on the success path.
    timing['dp_trace'] = {
        'R': list(R),
        'R_phone_to_word': list(R_phone_to_word),
        'win_start': win_start,
        'win_end': win_end,
        'j_start': None,
        'best_j': None,
        'basmala_consumed': False,
        # DP outcomes — populated post-DP, retained even on failure paths so
        # retry-exhausted segments carry their best-candidate confidence,
        # edit cost, wrap count, and threshold decision into the log row.
        'norm_dist': None,
        'best_cost': None,
        'n_wraps': 0,
        'max_j_reached': 0,
        'threshold': None,
        'threshold_failed': False,
    }

    # === DP ===
    if PHONEME_ALIGNMENT_PROFILING:
        t0 = time.perf_counter()

    # 4. Run wraparound DP
    best_j, j_start, best_cost, norm_dist, n_wraps, max_j_reached, wrap_points = align_wraparound(
        P, R, R_phone_to_word,
        expected_word=pointer,
        prior_weight=START_PRIOR_WEIGHT,
        wrap_penalty=WRAP_PENALTY,
        max_wraps=MAX_WRAPS,
        scoring_mode=WRAP_SCORING_MODE,
        wrap_span_weight=WRAP_SPAN_WEIGHT,
    )

    if PHONEME_ALIGNMENT_PROFILING:
        timing['dp_time'] = time.perf_counter() - t0

    # Record DP outcomes for the trace — done before the two failure returns so
    # retry-failed segments still log their best candidate instead of collapsing.
    _finite = float('inf')
    timing['dp_trace']['best_cost'] = None if best_cost >= _finite else float(best_cost)
    timing['dp_trace']['norm_dist'] = None if norm_dist >= _finite else float(norm_dist)
    timing['dp_trace']['n_wraps'] = int(n_wraps)
    timing['dp_trace']['max_j_reached'] = int(max_j_reached)
    timing['dp_trace']['j_start'] = j_start
    timing['dp_trace']['best_j'] = best_j

    # === RESULT BUILD ===
    if PHONEME_ALIGNMENT_PROFILING:
        t0 = time.perf_counter()

    if best_j is None:
        if PHONEME_ALIGNMENT_PROFILING:
            timing['result_build_time'] = time.perf_counter() - t0
        print_debug_info(P, R, None, segment_idx, pointer, win_start, win_end, words)
        return None, timing

    # 6. Check acceptance threshold
    threshold = max_edit_distance_override if max_edit_distance_override is not None else MAX_EDIT_DISTANCE
    timing['dp_trace']['threshold'] = float(threshold)
    if norm_dist > threshold:
        timing['dp_trace']['threshold_failed'] = True
        if PHONEME_ALIGNMENT_PROFILING:
            timing['result_build_time'] = time.perf_counter() - t0
        print_debug_info(P, R, None, segment_idx, pointer, win_start, win_end, words)
        return None, timing

    # 7. Confidence is 1 - normalized distance
    confidence = 1.0 - norm_dist

    # 8. Map phoneme indices to word indices
    start_word_idx = R_phone_to_word[j_start]
    end_word_idx = R_phone_to_word[best_j - 1]

    # When wraps detected, use max_j_reached for end word (furthest position reached)
    if n_wraps > 0 and max_j_reached > best_j:
        end_word_idx = R_phone_to_word[max_j_reached - 1]

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
        n_wraps=n_wraps,
        max_j_reached=max_j_reached,
        wrap_points=wrap_points,
    )

    # Compute wrap word ranges for UI display
    # Each entry is (jump_to, jump_from, repeat_end):
    #   jump_to: where the wrap lands (start of repeated section)
    #   jump_from: where the wrap originated (end of forward section before wrap)
    #   repeat_end: where the DP actually finishes after the wrap (actual end of repeated content)
    if n_wraps > 0 and wrap_points:
        wrap_word_ranges = []
        for wp_idx, (_i_pos, _j_end, _j_start) in enumerate(wrap_points):
            jump_to = words[R_phone_to_word[_j_start]].location
            jump_from = words[R_phone_to_word[_j_end - 1]].location
            if wp_idx < len(wrap_points) - 1:
                post_end = wrap_points[wp_idx + 1][1]
            else:
                post_end = best_j
            repeat_end = words[R_phone_to_word[post_end - 1]].location
            wrap_word_ranges.append((jump_to, jump_from, repeat_end))
        result.wrap_word_ranges = wrap_word_ranges

    # Fill in success-path DP trace fields
    timing['dp_trace']['j_start'] = j_start
    timing['dp_trace']['best_j'] = best_j
    timing['dp_trace']['basmala_consumed'] = basmala_consumed

    if PHONEME_ALIGNMENT_PROFILING:
        timing['result_build_time'] = time.perf_counter() - t0

    # Debug output
    print_debug_info(P, R, result, segment_idx, pointer, win_start, win_end, words)

    return result, timing
