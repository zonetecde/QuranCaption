"""
Phoneme n-gram voting for global anchor detection.

Replaces Whisper-based text matching for chapter/verse identification.
Each ASR n-gram that matches the Quran index votes for (surah, ayah)
weighted by rarity (1/count). The highest vote total wins the surah.
Then we find the best contiguous run of voted ayahs in that surah and
anchor to the first ayah of that run.
"""

from collections import defaultdict
from typing import Dict, List, Tuple

from config import ANCHOR_DEBUG, ANCHOR_RARITY_WEIGHTING, ANCHOR_RUN_TRIM_RATIO
from .ngram_index import PhonemeNgramIndex
from .phoneme_matcher import ChapterReference


def _find_best_contiguous_run(
    ayah_weights: Dict[int, float],
) -> Tuple[int, int, float]:
    """
    Find the contiguous run of consecutive ayahs with highest total weight.

    Args:
        ayah_weights: {ayah_number: vote_weight} for a single surah

    Returns:
        (start_ayah, end_ayah, total_weight) of the best run
    """
    if not ayah_weights:
        return (0, 0, 0.0)

    sorted_ayahs = sorted(ayah_weights.keys())

    # Build runs of consecutive ayahs
    runs: List[Tuple[int, int, float]] = []  # (start, end, total_weight)
    run_start = sorted_ayahs[0]
    run_end = sorted_ayahs[0]
    run_weight = ayah_weights[sorted_ayahs[0]]

    for i in range(1, len(sorted_ayahs)):
        ayah = sorted_ayahs[i]
        if ayah == run_end + 1:
            # Extends current run
            run_end = ayah
            run_weight += ayah_weights[ayah]
        else:
            # Gap — save current run, start new one
            runs.append((run_start, run_end, run_weight))
            run_start = ayah
            run_end = ayah
            run_weight = ayah_weights[ayah]

    # Don't forget the last run
    runs.append((run_start, run_end, run_weight))

    # Pick run with highest total weight
    best_start, best_end, best_weight = max(runs, key=lambda r: r[2])

    # Trim leading/trailing ayahs whose weight < ANCHOR_RUN_TRIM_RATIO * max
    max_w = max(ayah_weights[a] for a in range(best_start, best_end + 1))
    threshold = ANCHOR_RUN_TRIM_RATIO * max_w

    while best_start < best_end and ayah_weights[best_start] < threshold:
        best_weight -= ayah_weights[best_start]
        best_start += 1

    while best_end > best_start and ayah_weights[best_end] < threshold:
        best_weight -= ayah_weights[best_end]
        best_end -= 1

    return (best_start, best_end, best_weight)


def find_anchor_by_voting(
    phoneme_texts: List[List[str]],
    ngram_index: PhonemeNgramIndex,
    n_segments: int,
) -> Tuple[int, int]:
    """
    Vote on (surah, ayah) using n-gram rarity weighting.

    Two-phase selection:
    1. Raw voting determines the winning surah (highest total weight across all ayahs)
    2. Within that surah, find the best contiguous run of ayahs and return
       the first ayah of that run as the anchor point.

    Args:
        phoneme_texts: Phoneme lists for segments (starting from first Quran segment)
        ngram_index: Pre-built n-gram index
        n_segments: Number of segments to use for voting

    Returns:
        (surah, ayah) of best match, or (0, 0) if nothing found
    """
    # Concatenate first N non-empty segments
    combined: List[str] = []
    segments_used = 0
    for phonemes in phoneme_texts[:n_segments]:
        if phonemes:
            combined.extend(phonemes)
            segments_used += 1

    n = ngram_index.ngram_size

    if ANCHOR_DEBUG:
        print(f"\n{'=' * 60}")
        print(f"ANCHOR VOTING DEBUG")
        print(f"{'=' * 60}")
        print(f"  Segments used: {segments_used}/{n_segments}")
        print(f"  Combined phonemes: {len(combined)}")
        print(f"  N-gram size: {n}")
        if combined:
            print(f"  ASR phonemes: {' '.join(combined[:30])}{'...' if len(combined) > 30 else ''}")

    # Extract n-grams from ASR
    asr_ngrams = [
        tuple(combined[i : i + n])
        for i in range(len(combined) - n + 1)
    ]

    if ANCHOR_DEBUG:
        print(f"  ASR n-grams extracted: {len(asr_ngrams)}")

    # =========================================================================
    # Phase 1: Raw voting — accumulate (surah, ayah) votes
    # =========================================================================
    votes: Dict[Tuple[int, int], float] = defaultdict(float)
    matched_ngrams = 0
    missed_ngrams = 0

    for ng in asr_ngrams:
        if ng not in ngram_index.ngram_positions:
            missed_ngrams += 1
            continue

        matched_ngrams += 1
        weight = (1.0 / ngram_index.ngram_counts[ng]) if ANCHOR_RARITY_WEIGHTING else 1.0

        for surah, ayah in ngram_index.ngram_positions[ng]:
            votes[(surah, ayah)] += weight

    if ANCHOR_DEBUG:
        print(f"  N-grams matched: {matched_ngrams}/{len(asr_ngrams)} "
              f"({missed_ngrams} missed)")
        print(f"  Distinct (surah, ayah) voted for: {len(votes)}")

    if not votes:
        if ANCHOR_DEBUG:
            print(f"  RESULT: No votes cast — returning (0, 0)")
            print(f"{'=' * 60}\n")
        return (0, 0)

    # =========================================================================
    # Phase 1b: Determine winning surah (by total weight across all ayahs)
    # =========================================================================
    surah_totals: Dict[int, float] = defaultdict(float)
    for (s, a), w in votes.items():
        surah_totals[s] += w

    winning_surah = max(surah_totals, key=surah_totals.get)

    if ANCHOR_DEBUG:
        ranked_surahs = sorted(surah_totals.items(), key=lambda kv: kv[1], reverse=True)
        print(f"\n  Surah vote totals (top 5):")
        print(f"  {'Surah':>5}  {'Total Weight':>12}")
        print(f"  {'-' * 20}")
        for s, w in ranked_surahs[:5]:
            marker = " <-- winner" if s == winning_surah else ""
            print(f"  {s:>5}  {w:>12.3f}{marker}")

    # =========================================================================
    # Phase 2: Within winning surah, find best contiguous ayah run
    # =========================================================================
    ayah_weights: Dict[int, float] = {}
    for (s, a), w in votes.items():
        if s == winning_surah:
            ayah_weights[a] = w

    run_start, run_end, run_weight = _find_best_contiguous_run(ayah_weights)

    if ANCHOR_DEBUG:
        # Show per-ayah votes in this surah
        print(f"\n  Surah {winning_surah} ayah votes:")
        print(f"  {'Ayah':>5}  {'Weight':>8}  {'In Best Run':>11}")
        print(f"  {'-' * 28}")
        for a in sorted(ayah_weights.keys()):
            in_run = "***" if run_start <= a <= run_end else ""
            print(f"  {a:>5}  {ayah_weights[a]:>8.3f}  {in_run:>11}")

        print(f"\n  Best contiguous run (after trim): ayahs {run_start}-{run_end} "
              f"(weight={run_weight:.3f}, trim_ratio={ANCHOR_RUN_TRIM_RATIO})")
        print(f"  RESULT: Surah {winning_surah}, Ayah {run_start} (start of run)")
        print(f"{'=' * 60}\n")

    return (winning_surah, run_start)


def reanchor_within_surah(
    phoneme_texts: List[List[str]],
    ngram_index: PhonemeNgramIndex,
    surah: int,
    n_segments: int,
) -> int:
    """
    Re-anchor within a known surah after consecutive DP failures.

    Same n-gram voting as find_anchor_by_voting but:
    - Only counts votes for the given surah (skip all others)
    - Returns ayah (start of best contiguous run), or 0 if no votes

    Args:
        phoneme_texts: Remaining unprocessed phoneme lists
        ngram_index: Pre-built n-gram index
        surah: Current surah (fixed)
        n_segments: How many segments to use for voting

    Returns:
        ayah number to re-anchor to (0 = failed)
    """
    # Concatenate first N non-empty segments
    combined: List[str] = []
    segments_used = 0
    for phonemes in phoneme_texts[:n_segments]:
        if phonemes:
            combined.extend(phonemes)
            segments_used += 1

    n = ngram_index.ngram_size

    if ANCHOR_DEBUG:
        print(f"\n{'=' * 60}")
        print(f"RE-ANCHOR WITHIN SURAH {surah}")
        print(f"{'=' * 60}")
        print(f"  Segments used: {segments_used}/{n_segments}")
        print(f"  Combined phonemes: {len(combined)}")

    # Extract n-grams from ASR
    asr_ngrams = [
        tuple(combined[i : i + n])
        for i in range(len(combined) - n + 1)
    ]

    # Vote — only accumulate weight for positions in the given surah
    ayah_weights: Dict[int, float] = defaultdict(float)
    matched_ngrams = 0

    for ng in asr_ngrams:
        if ng not in ngram_index.ngram_positions:
            continue
        matched_ngrams += 1
        weight = (1.0 / ngram_index.ngram_counts[ng]) if ANCHOR_RARITY_WEIGHTING else 1.0
        for s, a in ngram_index.ngram_positions[ng]:
            if s == surah:
                ayah_weights[a] += weight

    if ANCHOR_DEBUG:
        print(f"  N-grams matched: {matched_ngrams}/{len(asr_ngrams)}")
        print(f"  Ayahs with votes: {len(ayah_weights)}")

    if not ayah_weights:
        if ANCHOR_DEBUG:
            print(f"  RESULT: No votes — returning 0")
            print(f"{'=' * 60}\n")
        return 0

    run_start, run_end, run_weight = _find_best_contiguous_run(dict(ayah_weights))

    if ANCHOR_DEBUG:
        print(f"  Best contiguous run (after trim): ayahs {run_start}-{run_end} "
              f"(weight={run_weight:.3f}, trim_ratio={ANCHOR_RUN_TRIM_RATIO})")
        print(f"  RESULT: Ayah {run_start}")
        print(f"{'=' * 60}\n")

    return run_start


def verse_to_word_index(chapter_ref: ChapterReference, ayah: int) -> int:
    """
    Find word index of the first word in a given ayah.

    Args:
        chapter_ref: Pre-built chapter reference
        ayah: Verse number to find

    Returns:
        Word index into chapter_ref.words, or 0 if not found
    """
    for idx, word in enumerate(chapter_ref.words):
        if word.ayah == ayah:
            return idx
    return 0
