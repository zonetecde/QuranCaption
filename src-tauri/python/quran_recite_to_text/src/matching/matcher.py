"""Phase 3 Matcher: 3D JumpDTW Dynamic Programming Quran Recitation Aligner.

Orchestrates forward recitation matching, repetition tracking,
and canonical Ayah segment construction from Medina Mushaf reference.
"""

from __future__ import annotations

import os
import json
import bisect
import logging
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Tuple
from collections import defaultdict
import numpy as np

import config
from config import DEFAULT_QURAN_PHONEMES_PATH
from src.models import (
    PhonemeToken,
    QuranWord,
    QuranSegment,
    AyahSubSegment,
)
from src.matching.phonetics import (
    get_sub_cost_table,
    _compute_insertion_costs_fast,
    _compute_deletion_costs_fast,
)
from src.matching.kernels import _global_viterbi_fast
from src.matching.reference import RefWord, SurahReferenceData
from src.matching.detector import SurahDetector, find_near_matches

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. MATCHER CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(frozen=True, slots=True)
class MatcherConfig:
    """Hyperparameter configuration for recitation alignment."""
    cost_substitution: float = getattr(config, "COST_SUBSTITUTION", 1.00)
    cost_deletion: float = getattr(config, "COST_DELETION", 1.00)
    cost_insertion: float = getattr(config, "COST_INSERTION", 0.75)
    acoustic_confusion_cost: float = getattr(config, "ACOUSTIC_CONFUSION_COST", 0.25)
    wrap_penalty: float = getattr(config, "WRAP_PENALTY", 0.80)
    wrap_span_weight: float = getattr(config, "WRAP_SPAN_WEIGHT", 0.05)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. WORD & SEGMENT BUILDERS
# ═══════════════════════════════════════════════════════════════════════════════

def _build_qword(
    rw: RefWord,
    tokens: List[PhonemeToken],
    score: float,
    all_passes: Optional[List[Dict[str, Any]]] = None,
) -> QuranWord:
    """Creates a unified QuranWord instance with phoneme breakdown and multi-pass support."""
    return QuranWord(
        word=rw.uthmani,
        location=rw.location,
        ref=rw.phoneme,
        start=round(tokens[0].start, 2),
        end=round(tokens[-1].end, 2),
        score=round(score, 2),
        phonemes=[t.to_dict() for t in tokens],
        all_passes=all_passes,
    )


def _build_unaligned_qword(rw: RefWord) -> QuranWord:
    """Creates an explicit unaligned placeholder for an elided/dropped word."""
    return QuranWord(
        word=rw.uthmani,
        location=rw.location,
        ref=rw.phoneme,
        start=None,
        end=None,
        score=0.0,
        phonemes=[],
        all_passes=None,
    )


def _bridge_unaligned_words(words: List[QuranWord], seg_start: float, seg_end: float) -> None:
    """Bridges unaligned words (start=None) to surrounding word boundaries in-place."""
    n = len(words)
    i = 0
    while i < n:
        if words[i].start is not None:
            i += 1
            continue

        j = i
        while j < n and words[j].start is None:
            j += 1
        count = j - i

        left = words[i - 1].end if (i > 0 and words[i - 1].end is not None) else None
        right = words[j].start if (j < n and words[j].start is not None) else None

        if left is not None and right is not None:
            gap = right - left
            t_start, dur = left, (gap if gap >= 0.04 * count else 0.06 * count)
        elif right is not None:
            t_start, dur = max(0.0, right - 0.12 * count), 0.12 * count
        else:
            t_start, dur = (left if left is not None else seg_start), 0.15 * count

        weights = [max(1, len(words[k].ref or words[k].word)) for k in range(i, j)]
        total_weight = sum(weights)
        curr = t_start
        for k in range(i, j):
            w_dur = dur * (weights[k - i] / total_weight)
            w_start = round(curr, 2)
            w_end = round(curr + w_dur, 2)
            if w_end <= w_start:
                w_end = round(w_start + 0.05, 2)
            words[k].start = w_start
            words[k].end = w_end
            words[k].is_interpolated = True
            curr += w_dur

        i = j



def _align_and_package_ayahs(
    aligned_tokens: List[PhonemeToken],
    ref_data: SurahReferenceData,
    start_word_index: int = 0,
    target_end_ayah: Optional[int] = None,
    matcher_cfg: Optional[MatcherConfig] = None,
    pause_timestamps: Optional[List[float]] = None,
) -> List[QuranSegment]:
    """Aligns speech tokens against Surah reference using JumpDTW Dynamic Programming."""
    if not aligned_tokens or ref_data.num_words == 0:
        return []

    cfg = matcher_cfg or MatcherConfig()
    total_tokens = len(aligned_tokens)
    asr_str = "".join(t.phoneme for t in aligned_tokens)

    # Fast char-to-token index lookup
    char_to_tok: List[int] = []
    for tok_idx, t in enumerate(aligned_tokens):
        char_to_tok.extend([tok_idx] * len(t.phoneme))
    char_to_tok.append(total_tokens)

    word_count = ref_data.num_words
    win_start = max(0, start_word_index - 2)

    # Robust window bounds: never truncate below acoustic length estimate
    est_words = int(len(asr_str) / 4.0) + 150
    min_required_end = start_word_index + est_words

    if target_end_ayah is not None and target_end_ayah in ref_data.ayah_to_words:
        target_end_word = ref_data.ayah_to_words[target_end_ayah][-1].global_index + 1
        win_end = min(word_count, max(min_required_end, target_end_word + 30))
    else:
        win_end = word_count

    p_start = ref_data.word_boundaries[win_start]
    p_end = ref_data.word_boundaries[win_end] if win_end < word_count else len(ref_data.full_phonemes)

    sub_r_str = ref_data.full_phonemes[p_start:p_end]
    n = len(sub_r_str)
    if n == 0:
        return []

    sub_phone_to_word = ref_data.flat_phone_to_word[p_start:p_end]
    p_codes = np.array([ord(c) for c in asr_str], dtype=np.int32)
    r_codes = np.array([ord(c) for c in sub_r_str], dtype=np.int32)

    word_starts_mask = np.zeros(n + 1, dtype=np.bool_)
    word_ends_mask = np.zeros(n + 1, dtype=np.bool_)
    for j in range(n + 1):
        if j == 0 or (j < n and sub_phone_to_word[j] != sub_phone_to_word[j - 1]):
            word_starts_mask[j] = True
        if j == n or (j > 0 and j < n and sub_phone_to_word[j] != sub_phone_to_word[j - 1]):
            word_ends_mask[j] = True

    # Fast JIT-vectorized edit costs
    ins_costs = _compute_insertion_costs_fast(p_codes, cfg.cost_insertion, cfg.acoustic_confusion_cost)
    del_costs = _compute_deletion_costs_fast(r_codes, cfg.cost_deletion, cfg.acoustic_confusion_cost)
    sub_table = get_sub_cost_table(cfg.acoustic_confusion_cost)

    _, _, _, char_word_map, char_j_map = _global_viterbi_fast(
        p_codes=p_codes,
        r_codes=r_codes,
        r_phone_to_word=sub_phone_to_word,
        word_starts_mask=word_starts_mask,
        word_ends_mask=word_ends_mask,
        del_costs=del_costs,
        ins_costs=ins_costs,
        sub_table=sub_table,
        wrap_penalty=cfg.wrap_penalty,
        wrap_span_weight=cfg.wrap_span_weight,
    )

    matched_word_tokens: Dict[int, List[List[PhonemeToken]]] = defaultdict(list)
    matched_word_scores: Dict[int, float] = {}

    word_passes: List[Tuple[int, int, int]] = []
    curr_w = -1
    span_s = -1
    m = len(asr_str)

    for i in range(m):
        w = int(char_word_map[i])
        is_jump = (i > 0 and char_j_map[i] >= 0 and char_j_map[i - 1] >= 0 and char_j_map[i] < char_j_map[i - 1])
        if w != curr_w or is_jump:
            if curr_w >= 0 and span_s >= 0:
                word_passes.append((curr_w, span_s, i))
            curr_w = w
            span_s = i if w >= 0 else -1

    if curr_w >= 0 and span_s >= 0:
        word_passes.append((curr_w, span_s, m))

    for w, s_char, e_char in word_passes:
        if e_char > s_char:
            t_s = char_to_tok[s_char]
            t_e = char_to_tok[e_char]
            if t_e > t_s:
                w_toks = aligned_tokens[t_s:t_e]
                matched_word_tokens[w].append(w_toks)
                w_conf = sum(t.confidence for t in w_toks) / len(w_toks)
                matched_word_scores[w] = round(min(1.0, w_conf), 2)

    if not matched_word_tokens:
        return []

    # Build canonical Ayah segments
    min_w = min(matched_word_tokens.keys())
    max_w = max(matched_word_tokens.keys())
    start_ay = ref_data.words[min_w].ayah if min_w < word_count else 1
    end_ay = ref_data.words[max_w].ayah if max_w < word_count else ref_data.words[-1].ayah

    segments: List[QuranSegment] = []
    seg_number = 1

    for ay in range(start_ay, end_ay + 1):
        ay_words = ref_data.ayah_to_words.get(ay, [])
        if not ay_words:
            continue

        qwords: List[QuranWord] = []
        has_repeated = False
        has_any_match = False

        for rw in ay_words:
            w_idx = rw.global_index
            passes = matched_word_tokens.get(w_idx)
            if passes:
                has_any_match = True
                multi_passes = None
                if len(passes) > 1:
                    has_repeated = True
                    multi_passes = [
                        {
                            "pass_number": p_idx + 1,
                            "start": float(round(p[0].start, 2)),
                            "end": float(round(p[-1].end, 2)),
                            "score": float(round(sum(t.confidence for t in p) / len(p), 2)),
                        }
                        for p_idx, p in enumerate(passes)
                    ]
                chosen_pass = passes[-1]
                score = matched_word_scores.get(w_idx, 1.0)
                qwords.append(_build_qword(rw, chosen_pass, score, all_passes=multi_passes))
            else:
                qwords.append(_build_unaligned_qword(rw))

        if not has_any_match:
            continue

        all_ay_passes = [p for rw in ay_words for p in matched_word_tokens.get(rw.global_index, []) if p]
        seg_start = min(p[0].start for p in all_ay_passes)
        seg_end = max(p[-1].end for p in all_ay_passes)

        if getattr(config, "ENABLE_WORD_TIMING_BRIDGE", True):
            _bridge_unaligned_words(qwords, seg_start=seg_start, seg_end=seg_end)

        sub_segments: Optional[List[AyahSubSegment]] = None
        repeated_ranges: Optional[List[str]] = None
        repeated_text: Optional[List[str]] = None

        matched_words = [w for w in qwords if w.start is not None]

        # Tier 1: Group word instances into passes (repetition tracking)
        passes: List[Tuple[List[QuranWord], bool]] = []

        if has_repeated:
            all_word_instances = []
            for rw in ay_words:
                w_idx = rw.global_index
                passes_w = matched_word_tokens.get(w_idx, [])
                multi_passes = None
                if len(passes_w) > 1:
                    multi_passes = [
                        {
                            "pass_number": p_idx + 1,
                            "start": float(round(p[0].start, 2)),
                            "end": float(round(p[-1].end, 2)),
                            "score": float(round(sum(t.confidence for t in p) / len(p), 2)),
                        }
                        for p_idx, p in enumerate(passes_w)
                    ]
                for p in passes_w:
                    if p:
                        score = matched_word_scores.get(w_idx, 1.0)
                        all_word_instances.append((w_idx, _build_qword(rw, p, score, all_passes=multi_passes)))

            all_word_instances.sort(key=lambda x: x[1].start or 0.0)

            current_pass: List[QuranWord] = []
            prev_w_idx = -1

            for w_idx, q_inst in all_word_instances:
                if current_pass and w_idx <= prev_w_idx:
                    passes.append((current_pass, len(passes) > 0))
                    current_pass = []
                current_pass.append(q_inst)
                prev_w_idx = w_idx

            if current_pass:
                passes.append((current_pass, len(passes) > 0))
        else:
            passes = [(matched_words, False)]

        # Tier 2: Split passes on Phase 1 pauses with 'Never Cut Word' geometric validation
        sub_segs_list: List[AyahSubSegment] = []
        pauses = pause_timestamps or []

        def _build_sub(pass_words: List[QuranWord], is_rep: bool) -> AyahSubSegment:
            sub_asr = " ".join("".join(p.get("phoneme", "") for p in (w.phonemes or [])) for w in pass_words if w.phonemes)
            return AyahSubSegment(
                sub_segment_number=len(sub_segs_list) + 1,
                start_time=pass_words[0].start or 0.0,
                end_time=pass_words[-1].end or 0.0,
                text=sub_asr,
                words_range=f"{pass_words[0].location}-{pass_words[-1].location}",
                is_repetition=is_rep,
                words=pass_words,
            )

        for pass_words, is_rep in passes:
            current_chunk: List[QuranWord] = []
            for w in pass_words:
                if current_chunk:
                    prev_w = current_chunk[-1]
                    min_p = (prev_w.end or 0.0) - 0.15
                    c_curr = ((w.start or 0.0) + (w.end or 0.0)) / 2.0

                    p_idx = bisect.bisect_left(pauses, min_p)
                    if p_idx < len(pauses) and pauses[p_idx] < c_curr:
                        sub_segs_list.append(_build_sub(current_chunk, is_rep))
                        current_chunk = []

                current_chunk.append(w)

            if current_chunk:
                sub_segs_list.append(_build_sub(current_chunk, is_rep))

        if sub_segs_list:
            sub_segments = sub_segs_list
            repeated_ranges = [s.words_range for s in sub_segments if s.is_repetition] or None
            repeated_text = [s.text for s in sub_segments if s.is_repetition] or None

        matched_ref_str = f"{ref_data.surah}:{ay}:1-{ref_data.surah}:{ay}:{len(ay_words)}"

        segments.append(QuranSegment(
            segment_number=seg_number,
            ayah=ay,
            surah_number=ref_data.surah,
            start_time=round(seg_start, 2),
            end_time=round(seg_end, 2),
            matched_ref=matched_ref_str,
            words=qwords,
            repeated_ranges=repeated_ranges,
            repeated_text=repeated_text,
            sub_segments=sub_segments,
        ))
        seg_number += 1

    return segments


# ═══════════════════════════════════════════════════════════════════════════════
# 3. OPENING PREAMBLE EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

ISTIAADHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَـٰنِ ٱلرَّجِيمِ"
ISTIAADHA_PH = "ءَعُۥۥذُبِللَااهِمِنَششَيطَاانِررَجِۦۦۦۦم"

ISTIAADHA_REF_DATA = SurahReferenceData(
    0,
    {
        "0:1": {
            "aya_text": ISTIAADHA_TEXT,
            "aya_phonemes_list": ["ءَعُۥۥذُ", "بِللَااهِ", "مِنَ", "ششَيطَاانِ", "ررَجِۦۦۦۦم"],
        }
    },
)


def _slice_preamble_match(
    pattern: str, tokens: List[PhonemeToken], max_error_ratio: float = 0.28
) -> Tuple[Optional[Tuple[float, float, List[PhonemeToken]]], List[PhonemeToken]]:
    """Fast bit-parallel slice for opening preamble using Gene Myers' kernel."""
    if not tokens:
        return None, tokens

    head_len = min(len(tokens), len(pattern) + 30)
    head_str = "".join(t.phoneme for t in tokens[:head_len])
    max_dist = max(3, int(len(pattern) * max_error_ratio))

    matches = find_near_matches(pattern, head_str, max_l_dist=max_dist)
    if matches and matches[0].start <= 6:
        m = matches[0]
        consumed, k = 0, len(tokens)
        start_t, end_t = None, None
        for idx, tok in enumerate(tokens):
            consumed += len(tok.phoneme)
            if start_t is None and consumed > m.start:
                start_t = tok.start
            if consumed >= m.end:
                end_t = tok.end
                k = idx + 1
                break
        matched_toks = tokens[:k]
        st = start_t if start_t is not None else matched_toks[0].start
        et = end_t if end_t is not None else matched_toks[-1].end
        return (st, et, matched_toks), tokens[k:]

    return None, tokens


def _extract_opening_preamble(
    aligned_tokens: List[PhonemeToken],
    surah: int,
    start_ayah: int,
    ref_surah_1: SurahReferenceData,
) -> Tuple[Optional[Dict[str, Any]], List[PhonemeToken]]:
    """Detects and isolates recited Isti'adha and/or pre-verse Basmalah before Ayah 1."""
    if not aligned_tokens:
        return None, aligned_tokens

    curr = aligned_tokens
    intro_words: List[Dict[str, Any]] = []
    intro_texts: List[str] = []
    intro_starts: List[float] = []
    intro_ends: List[float] = []

    def _match_and_align(pattern: str, ref: SurahReferenceData) -> None:
        nonlocal curr
        res, curr = _slice_preamble_match(pattern, curr)
        if res:
            st, et, toks = res
            intro_starts.append(st)
            intro_ends.append(et)
            segs = _align_and_package_ayahs(
                aligned_tokens=toks,
                ref_data=ref,
                start_word_index=0,
                target_end_ayah=1,
            )
            if segs:
                if segs[0].sub_segments:
                    for sub in segs[0].sub_segments:
                        intro_texts.append(sub.text)
                        for w in sub.words:
                            intro_words.append(w.to_dict())
                elif segs[0].words:
                    intro_texts.append(" ".join("".join(p.get("phoneme", "") for p in (w.phonemes or [])) for w in segs[0].words if w.phonemes))
                    for w in segs[0].words:
                        intro_words.append(w.to_dict())

    # 1. Isti'adha (can precede any recitation)
    _match_and_align(ISTIAADHA_PH, ISTIAADHA_REF_DATA)

    # 2. Basmalah (Surahs 2-114 except 9)
    if surah not in (1, 9):
        basmalah_ph = "".join(w.phoneme for w in ref_surah_1.ayah_to_words[1])
        _match_and_align(basmalah_ph, ref_surah_1)

    if intro_texts:
        return {
            "start": round(min(intro_starts), 2),
            "end": round(max(intro_ends), 2),
            "transcribed_text": " ".join(intro_texts),
            "words": intro_words,
        }, curr

    return None, curr


# ═══════════════════════════════════════════════════════════════════════════════
# 4. CONSOLIDATED QURAN RECITATION MATCHER FACADE
# ═══════════════════════════════════════════════════════════════════════════════

class QuranMatcher:
    """Unified Quran Recitation Alignment Engine."""

    def __init__(self, config: Optional[MatcherConfig] = None):
        self.config = config or MatcherConfig()
        self.detector = SurahDetector()
        self._verses: Dict[str, Any] = {}
        self._surah_refs: Dict[int, SurahReferenceData] = {}
        self._is_initialized = False

    @property
    def is_initialized(self) -> bool:
        return self._is_initialized

    def initialize_from_file(
        self,
        json_file_path: Optional[str] = None,
        ref_norm_ph_path: Optional[str] = None,
        ph_index_path: Optional[str] = None,
    ) -> None:
        path = json_file_path or DEFAULT_QURAN_PHONEMES_PATH
        if not os.path.exists(path):
            raise FileNotFoundError(f"Quran phonemes file not found: {path}")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self._verses = data.get("verses", data)

        self.detector.initialize(
            ref_norm_ph_path=ref_norm_ph_path,
            ph_index_path=ph_index_path,
        )
        self._is_initialized = True

    def _get_surah_ref(self, surah: int) -> SurahReferenceData:
        if surah not in self._surah_refs:
            self._surah_refs[surah] = SurahReferenceData(surah, self._verses)
        return self._surah_refs[surah]

    def match_segments(
        self,
        aligned_phonemes: List[PhonemeToken],
        audio_duration: float = 0.0,
        target_surah: Optional[int] = None,
        start_ayah: Optional[int] = None,
        pause_timestamps: Optional[List[float]] = None,
    ) -> List[QuranSegment]:
        if not self._is_initialized:
            self.initialize_from_file()
        if not aligned_phonemes or not self._verses:
            return []

        # 1. Automatic Surah & Start Ayah Detection
        detected_surah = target_surah
        detected_start_ayah = start_ayah
        detected_end_ayah: Optional[int] = None

        if detected_surah is None:
            det_res = self.detector.detect_single_surah(aligned_phonemes)
            if det_res is not None:
                detected_surah = det_res.surah
                detected_start_ayah = det_res.start_ayah
                # Only trust detected_end_ayah if it verified an Ayah after start_ayah
                if det_res.end_ayah is not None and det_res.end_ayah > det_res.start_ayah:
                    detected_end_ayah = det_res.end_ayah
                logger.info(
                    "Detected Surah %d starting at Ayah %d (confidence=%.2f)",
                    detected_surah,
                    detected_start_ayah,
                    det_res.confidence,
                )
            else:
                detected_surah = 1
                detected_start_ayah = 1

        # 2. Opening Preamble Extraction (Isti'adha & pre-verse Basmalah)
        intro_dict, remaining_tokens = _extract_opening_preamble(
            aligned_tokens=aligned_phonemes,
            surah=detected_surah,
            start_ayah=detected_start_ayah or 1,
            ref_surah_1=self._get_surah_ref(1),
        )

        ref_data = self._get_surah_ref(detected_surah)
        effective_start_ayah = detected_start_ayah or 1
        if intro_dict and any(w.get("location", "").startswith("1:1:") for w in intro_dict.get("words", [])):
            effective_start_ayah = 1
        start_word_idx = ref_data.ayah_start_word_index.get(effective_start_ayah, 0)

        # 3. 3D JumpDTW Alignment & Segment Construction
        segments = _align_and_package_ayahs(
            aligned_tokens=remaining_tokens,
            ref_data=ref_data,
            start_word_index=start_word_idx,
            target_end_ayah=detected_end_ayah,
            matcher_cfg=self.config,
            pause_timestamps=pause_timestamps,
        )

        if intro_dict and segments:
            segments[0].intro = intro_dict

        return segments


# Backward compatibility alias
QuranWordMatcher = QuranMatcher
