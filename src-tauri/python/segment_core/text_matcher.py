"""
TextMatcher: Standalone segment-to-Quran text matching.

Matching algorithm:
1. Special segment detection (Isti'adha/Basmala) - see special_segments.py
2. Global anchor search (first N segments)
3. Sequential alignment with pointer tracking
"""

from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional

from .config import (
    SPECIAL_SEGMENTS,
    SPECIAL_MATCH_SCORE,
    MIN_MATCH_SCORE,
    ANCHOR_SEGMENTS,
    ANCHOR_MIN_SCORE,
    ANCHOR_TOP_K,
    ANCHOR_ALIGN_SLACK,
    LOOKBACK_WORDS,
    LOOKAHEAD_WORDS,
    WORD_SLACK,
    WORD_MATCH_THRESHOLD,
    MAX_CONSECUTIVE_FAILURES,
    TEXT_MATCH_DEBUG,
)
from .quran_index import get_quran_index, QuranIndex
from .text_preprocessor import normalize_arabic, split_words
from .special_segments import get_special_scores, match_special_segment


# =============================================================================
@dataclass
class MatchResult:
    """Result of matching a single segment."""
    start_idx: Optional[int]        # Global word index start (None if unmatched)
    end_idx: Optional[int]          # Global word index end (inclusive)
    ref: str                        # Reference string like "2:255:1-2:255:5" or special label
    matched_text: str               # Original Quran text (or canonical special segment)
    score: float                    # Match confidence 0-1
    is_special: bool = False        # True for Isti'adha/Basmala


# =============================================================================
def word_similarity(w1: str, w2: str) -> float:
    """Return similarity ratio between two words (0-1)."""
    if w1 == w2:
        return 1.0
    return SequenceMatcher(None, w1, w2).ratio()


def greedy_match_scores(asr_words: list[str], quran_words: list[str]) -> list[tuple[int, int, float]]:
    """
    Greedy in-order matching: returns (start_pos, span_len, similarity_score) for matches.
    """
    if not asr_words or not quran_words:
        return []

    matches: list[tuple[int, int, float]] = []
    q_idx = 0
    n_q = len(quran_words)

    for asr_word in asr_words:
        q_start = q_idx
        matched = False
        max_scan = min(n_q, q_idx + WORD_SLACK + 3)

        while q_idx < max_scan:
            score = word_similarity(asr_word, quran_words[q_idx])
            if score >= WORD_MATCH_THRESHOLD:
                matches.append((q_idx, 1, score))
                q_idx += 1
                matched = True
                break
            if q_idx + 1 < max_scan:
                concat = quran_words[q_idx] + quran_words[q_idx + 1]
                score2 = word_similarity(asr_word, concat)
                if score2 >= WORD_MATCH_THRESHOLD:
                    matches.append((q_idx, 2, score2))
                    q_idx += 2
                    matched = True
                    break
            q_idx += 1

        if not matched:
            q_idx = q_start

    return matches


def match_confidence(asr_words: list[str], quran_words: list[str]) -> Optional[dict]:
    """Compute match confidence using weighted F1 over the matched span."""
    matches = greedy_match_scores(asr_words, quran_words)
    if not matches:
        return None

    matched_score = sum(score for _, _, score in matches)
    span_start = matches[0][0]
    span_end = max(start + span_len - 1 for start, span_len, _ in matches)
    span_len = span_end - span_start + 1

    precision = matched_score / span_len
    recall = matched_score / len(asr_words)
    if precision + recall == 0:
        confidence = 0.0
    else:
        confidence = 2 * precision * recall / (precision + recall)

    return {
        "confidence": confidence,
        "precision": precision,
        "recall": recall,
        "matched": matched_score,
        "span_start": span_start,
        "span_end": span_end,
    }


# =============================================================================
def match_segment(
    asr_text: str,
    pointer: int,
    index: QuranIndex,
    surah: Optional[int] = None,
) -> tuple[MatchResult, int, dict]:
    """
    Match a single ASR segment to Quran text.
    """
    import time
    timing = {}

    # Phase 1: Normalization
    t0 = time.perf_counter()
    asr_normalized = normalize_arabic(asr_text)
    asr_words = split_words(asr_normalized)
    n = len(asr_words)
    timing['normalize'] = time.perf_counter() - t0

    if n == 0:
        return MatchResult(None, None, "", "", 0.0), pointer, timing

    # Phase 2: Setup bounds
    t0 = time.perf_counter()
    if surah is not None and surah in index.surah_bounds:
        search_start, search_end = index.surah_bounds[surah]
    else:
        search_start, search_end = 0, index.total_words

    pointer = max(search_start, min(pointer, search_end - 1))
    timing['setup_bounds'] = time.perf_counter() - t0

    candidates_by_span: dict[tuple[int, int], dict] = {}

    # Phase 3: Candidate generation + scoring
    t0 = time.perf_counter()
    scoring_time = 0.0

    for offset in range(-LOOKBACK_WORDS, LOOKAHEAD_WORDS + 1):
        start = pointer + offset
        if start < search_start or start >= search_end:
            continue

        for length in range(max(1, n - WORD_SLACK), n + WORD_SLACK + 1):
            end = min(start + length, search_end)
            if end <= start:
                continue

            quran_slice = index.get_slice(start, end)
            if not quran_slice:
                continue

            t_score = time.perf_counter()
            stats = match_confidence(asr_words, quran_slice)
            scoring_time += time.perf_counter() - t_score

            if not stats:
                continue

            span_start = start + stats["span_start"]
            span_end = start + stats["span_end"]
            key = (span_start, span_end)
            candidate = {
                "start": span_start,
                "end": span_end,
                "confidence": stats["confidence"],
                "precision": stats["precision"],
                "recall": stats["recall"],
                "matched": stats["matched"],
                "offset": offset,
            }

            existing = candidates_by_span.get(key)
            if existing is None or candidate["confidence"] > existing["confidence"]:
                candidates_by_span[key] = candidate

    timing['candidate_gen'] = time.perf_counter() - t0
    timing['scoring'] = scoring_time
    timing['num_candidates'] = len(candidates_by_span)

    if not candidates_by_span:
        return MatchResult(None, None, "", "", 0.0), pointer, timing

    # Phase 4: Selection
    t0 = time.perf_counter()
    candidates = list(candidates_by_span.values())
    candidates.sort(
        key=lambda c: (
            -c["confidence"],
            -c["precision"],
            abs(c["offset"]),
            c["end"] - c["start"],
        )
    )
    best = candidates[0]
    timing['selection'] = time.perf_counter() - t0

    # Phase 5: Result building
    t0 = time.perf_counter()
    if best["confidence"] >= MIN_MATCH_SCORE:
        ref = index.to_ref(best["start"], best["end"])
        matched_text = index.get_original_text(best["start"], best["end"])
        new_pointer = best["end"] + 1
        timing['result_build'] = time.perf_counter() - t0

        quran_slice = index.get_slice(best["start"], best["end"] + 1)
        timing['_asr_words'] = asr_words
        timing['_quran_words'] = quran_slice

        return MatchResult(
            start_idx=best["start"],
            end_idx=best["end"],
            ref=ref,
            matched_text=matched_text,
            score=best["confidence"],
        ), new_pointer, timing
    else:
        timing['result_build'] = time.perf_counter() - t0
        timing['_asr_words'] = asr_words
        timing['_quran_words'] = []
        return MatchResult(None, None, "", "", best["confidence"]), pointer, timing


# =============================================================================
def _has_position_in_range(positions: list[int], start: int, end: int) -> bool:
    """Check if any position exists within [start, end]."""
    idx = bisect_left(positions, start)
    return idx < len(positions) and positions[idx] <= end


def _pick_anchor_word(asr_words: list[str], index: QuranIndex) -> tuple[Optional[str], int, list[int]]:
    """Pick the rarest ASR word to prefilter anchor candidates."""
    best_word = None
    best_positions: list[int] = []
    best_idx = -1

    for i, word in enumerate(asr_words):
        positions = index.get_positions(word)
        if not positions:
            continue
        if best_word is None or len(positions) < len(best_positions):
            best_word = word
            best_positions = positions
            best_idx = i

    return best_word, best_idx, best_positions


def _find_segment_candidates(
    asr_text: str,
    index: QuranIndex,
    top_k: int = ANCHOR_TOP_K,
) -> list[dict]:
    """Find top-k candidate positions in the Quran for a single ASR segment."""
    asr_normalized = normalize_arabic(asr_text)
    asr_words = split_words(asr_normalized)
    n = len(asr_words)

    if n == 0:
        return []

    min_len = max(1, n - WORD_SLACK)
    max_len = n + WORD_SLACK

    anchor_word, anchor_idx, anchor_positions = _pick_anchor_word(asr_words, index)
    if not anchor_positions:
        return []

    positions_last = index.get_positions(asr_words[-1]) if n > 1 else anchor_positions
    candidate_starts: set[int] = set()

    for pos in anchor_positions:
        base_start = pos - anchor_idx
        for start in range(base_start - ANCHOR_ALIGN_SLACK, base_start + ANCHOR_ALIGN_SLACK + 1):
            if start < 0:
                continue
            if start + min_len > index.total_words:
                continue

            if n > 1 and positions_last:
                end_min = start + min_len - 1
                end_max = min(start + max_len - 1, index.total_words - 1)
                if not _has_position_in_range(positions_last, end_min, end_max):
                    continue

            candidate_starts.add(start)

    if not candidate_starts:
        return []

    candidates_by_span: dict[tuple[int, int], dict] = {}

    for start in candidate_starts:
        for length in range(min_len, max_len + 1):
            end = min(start + length, index.total_words)
            if end <= start:
                continue

            quran_slice = index.get_slice(start, end)
            if not quran_slice:
                continue

            stats = match_confidence(asr_words, quran_slice)
            if not stats:
                continue

            span_start = start + stats["span_start"]
            span_end = start + stats["span_end"]
            word_info = index.get_word(span_start)

            candidate = {
                "start": span_start,
                "end": span_end,
                "confidence": stats["confidence"],
                "precision": stats["precision"],
                "recall": stats["recall"],
                "surah": word_info.surah if word_info else None,
                "n_words": n,
            }

            key = (span_start, span_end)
            existing = candidates_by_span.get(key)
            if existing is None or candidate["confidence"] > existing["confidence"]:
                candidates_by_span[key] = candidate

    candidates = list(candidates_by_span.values())
    candidates.sort(key=lambda c: (-c["confidence"], -c["precision"]))
    return candidates[:top_k]


def find_global_anchor(
    segments: list[str],
    index: QuranIndex,
) -> tuple[int, Optional[int], float]:
    """Find the best starting position in Quran for a list of segments."""
    if not segments:
        return 0, None, 0.0

    anchor_texts = [s for s in segments[:ANCHOR_SEGMENTS] if s.strip()]
    wordy_anchor_texts = []
    for s in anchor_texts:
        if len(split_words(normalize_arabic(s))) >= 2:
            wordy_anchor_texts.append(s)
    if wordy_anchor_texts:
        anchor_texts = wordy_anchor_texts

    if not anchor_texts:
        return 0, None, 0.0

    # Step 1: Get candidates for each segment
    all_candidates: list[list[dict]] = []
    for i, text in enumerate(anchor_texts):
        candidates = _find_segment_candidates(text, index, top_k=ANCHOR_TOP_K)
        all_candidates.append(candidates)

    if not any(all_candidates):
        print("[ANCHOR] No candidates found for any segment")
        return 0, None, 0.0

    # Step 2: Find best sequence
    non_empty = [(i, c) for i, c in enumerate(all_candidates) if c]

    if len(non_empty) == 1:
        idx, candidates = non_empty[0]
        best = candidates[0]
        print(f"[ANCHOR] Single segment match at position {best['start']}, surah={best['surah']}, score={best['confidence']:.2f}")
        if best["confidence"] >= ANCHOR_MIN_SCORE:
            return best["start"], best["surah"], best["confidence"]
        return best["start"], None, best["confidence"]

    best_sequence_score = 0.0
    best_start = 0
    best_surah = None

    first_idx, first_candidates = non_empty[0]

    MAX_GAP = 15
    MAX_OVERLAP = 10

    for anchor in first_candidates:
        sequence_score = anchor["confidence"]
        num_matched = 1
        expected_next = anchor["end"] + 1

        for seg_idx in range(first_idx + 1, len(all_candidates)):
            seg_candidates = all_candidates[seg_idx]
            if not seg_candidates:
                continue

            best_follower = None
            best_follower_score = 0.0

            for cand in seg_candidates:
                gap = cand['start'] - expected_next

                if -MAX_OVERLAP <= gap <= MAX_GAP:
                    continuity_bonus = 1.0 - (abs(gap) / max(MAX_GAP, MAX_OVERLAP)) * 0.2
                    adjusted_score = cand["confidence"] * continuity_bonus

                    if adjusted_score > best_follower_score:
                        best_follower_score = adjusted_score
                        best_follower = cand

            if best_follower:
                sequence_score += best_follower_score
                num_matched += 1
                expected_next = best_follower["end"] + 1

        avg_score = sequence_score / max(num_matched, 1)
        combined_score = avg_score * (1 + 0.1 * num_matched)

        if combined_score > best_sequence_score:
            best_sequence_score = combined_score
            best_start = anchor["start"]
            best_surah = anchor["surah"]

    if best_sequence_score < ANCHOR_MIN_SCORE:
        print(f"[ANCHOR] Score too low ({best_sequence_score:.2f} < {ANCHOR_MIN_SCORE}), not constraining to surah")
        return best_start, None, best_sequence_score

    return best_start, best_surah, best_sequence_score


# =============================================================================
class TextMatcher:
    """
    Main text matcher for segment-to-Quran alignment.
    """

    def __init__(self):
        self.index = get_quran_index()
        self.pointer = 0
        self.detected_surah: Optional[int] = None
        self.consecutive_failures = 0

    def reset(self):
        """Reset matcher state for new audio."""
        self.pointer = 0
        self.detected_surah = None
        self.consecutive_failures = 0

    def match_segments(self, transcribed_texts: list[str]) -> tuple[list[MatchResult], dict]:
        """Match a list of transcribed segments to Quran text."""
        import time

        self.reset()
        total_start = time.time()
        n = len(transcribed_texts)

        anchor_time = 0.0
        post_anchor_time = 0.0
        num_post_anchor_segments = 0

        results: list[MatchResult] = [None] * n
        special_indices = set()

        def _add_special_result(idx: int, special_result):
            match_result = MatchResult(
                start_idx=None,
                end_idx=None,
                ref=special_result.ref,
                matched_text=special_result.matched_text,
                score=special_result.score,
                is_special=True,
            )
            results[idx] = match_result
            special_indices.add(idx)

        # PASS 1: Detect special segments
        if n >= 1 and transcribed_texts[0].strip():
            scores_0 = get_special_scores(transcribed_texts[0])
            basmala_score = scores_0.get("Basmala", 0.0)
            istiadha_score = scores_0.get("Isti'adha", 0.0)

            if basmala_score >= SPECIAL_MATCH_SCORE or istiadha_score >= SPECIAL_MATCH_SCORE:
                if basmala_score >= istiadha_score:
                    special = match_special_segment(transcribed_texts[0], required_label="Basmala")
                else:
                    special = match_special_segment(transcribed_texts[0], required_label="Isti'adha")

                if special:
                    _add_special_result(0, special)

                    if special.ref == "Isti'adha" and n >= 2 and transcribed_texts[1].strip():
                        basmala_1 = match_special_segment(transcribed_texts[1], required_label="Basmala")
                        if basmala_1:
                            _add_special_result(1, basmala_1)

        # PASS 2: Anchor search
        anchor_texts = []
        for i, text in enumerate(transcribed_texts):
            if i not in special_indices and text.strip():
                anchor_texts.append(text)

        anchor_start = time.time()
        if anchor_texts:
            self.pointer, self.detected_surah, _ = find_global_anchor(anchor_texts, self.index)
        anchor_time = time.time() - anchor_start

        # PASS 3: Sequential matching
        post_anchor_start = time.time()

        for i, text in enumerate(transcribed_texts):
            if results[i] is not None:
                continue

            if not text.strip():
                results[i] = MatchResult(None, None, "", "", 0.0)
                continue

            result, new_pointer, seg_timing = match_segment(
                text, self.pointer, self.index, self.detected_surah
            )
            num_post_anchor_segments += 1

            # Handle Basmala (1:1 -> labeled "Basmala")
            if result.ref and result.score >= MIN_MATCH_SCORE:
                if result.ref == "1:1" or result.ref.startswith("1:1:"):
                    result = MatchResult(
                        start_idx=result.start_idx,
                        end_idx=result.end_idx,
                        ref="Basmala",
                        matched_text=SPECIAL_SEGMENTS.get("Basmala", result.matched_text),
                        score=result.score,
                        is_special=True,
                    )

            # Track consecutive failures
            if result.start_idx is None or result.score < MIN_MATCH_SCORE:
                self.consecutive_failures += 1
                if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    print(f"  [SEG {i}] {MAX_CONSECUTIVE_FAILURES} failures, re-anchoring")
                    remaining_texts = [t for t in transcribed_texts[i + 1:] if t.strip()]
                    if remaining_texts:
                        self.pointer, self.detected_surah, _ = find_global_anchor(remaining_texts, self.index)
                    else:
                        self.pointer = 0
                        self.detected_surah = None
                    self.consecutive_failures = 0
            else:
                self.consecutive_failures = 0
                self.pointer = new_pointer

            results[i] = result

        post_anchor_time = time.time() - post_anchor_start
        total_time = time.time() - total_start

        profiling = {
            "total_time": total_time,
            "anchor_time": anchor_time,
            "post_anchor_time": post_anchor_time,
            "num_segments": num_post_anchor_segments,
        }

        return results, profiling


# =============================================================================
_matcher_cache: Optional[TextMatcher] = None


def get_text_matcher() -> TextMatcher:
    """Get or create the global TextMatcher singleton."""
    global _matcher_cache
    if _matcher_cache is None:
        _matcher_cache = TextMatcher()
    return _matcher_cache
