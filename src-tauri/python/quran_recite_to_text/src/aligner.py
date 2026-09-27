"""Phase 2: CTC Viterbi Trellis Forced Alignment Engine."""

from __future__ import annotations

import math
import bisect
import logging
from typing import Optional, List, Dict, Tuple
import numpy as np

from config import (
    BLANK_ID,
    FRAME_RATE,
    FRAME_STEP,
    CTC_BLANK_PENALTY,
    LOOKAHEAD_OFFSET_FRAMES,
)
from src.models import PhonemeToken, PauseInterval

logger = logging.getLogger(__name__)

# Minimum phoneme duration to prevent UI flickering (60ms ≈ 1.5 CTC frames at 25 Hz)
_MIN_PHONEME_DURATION_S = 0.060
_MIN_PHONEME_DURATION_FRAMES = 1.5

try:
    from numba import njit
except ImportError:
    def njit(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


@njit(fastmath=True, cache=True)
def _ctc_viterbi_forward(
    lp: np.ndarray,
    s_array: np.ndarray,
    skip_mask: np.ndarray,
    s_base: np.ndarray,
    total_frames: int,
    l: int,
    band_width: int,
    b_id: int,
    blank_penalty: float,
) -> Tuple[np.ndarray, np.ndarray]:
    """Unified exact/banded CTC Viterbi Trellis forward pass.

    When l > 256, restricts dynamic programming to a moving corridor of width `band_width`
    anchored to speech token progress (O(T) memory, 0% disk).
    When l <= 256, runs full exact trellis with s_base = 0 and band_width = l.
    """
    backtrack = np.zeros((total_frames, band_width), dtype=np.uint8)
    v_prev = np.full(l, -1e30, dtype=np.float32)
    v_curr = np.full(l, -1e30, dtype=np.float32)

    v_prev[0] = lp[0, s_array[0]]
    if l > 1:
        v_prev[1] = lp[0, s_array[1]]

    for t in range(1, total_frames):
        base = s_base[t]
        reach_min = max(0, l - 2 * (total_frames - t) - 2)
        reach_max = min(l, 2 * t + 2)
        s_start = max(base, reach_min)
        s_end = min(min(l, base + band_width), reach_max)

        v_curr[max(0, base - 2):min(l, base + band_width + 2)].fill(-1e30)

        for s in range(s_start, s_end):
            c0 = v_prev[s]
            c1 = v_prev[s - 1] if s > 0 else -1e30
            c2 = v_prev[s - 2] if (skip_mask[s] == 1 and s >= 2) else -1e30

            max_v = c0
            best_step = 0

            if c1 > max_v:
                max_v = c1
                best_step = 1

            if c2 > max_v:
                max_v = c2
                best_step = 2

            backtrack[t, s - base] = best_step

            if max_v > -1e29:
                tok_class = s_array[s]
                emit = lp[t, tok_class]
                if tok_class == b_id:
                    emit -= blank_penalty
                v_curr[s] = max_v + emit

        v_prev, v_curr = v_curr, v_prev

    return backtrack, v_prev


def warmup_aligner_jit() -> None:
    """Pre-compiles JIT function with dummy arrays so first audio run is instant."""
    try:
        lp = np.zeros((2, 251), dtype=np.float32)
        s_arr = np.zeros(3, dtype=np.int32)
        sk_m = np.zeros(3, dtype=np.uint8)
        s_b = np.zeros(2, dtype=np.int32)
        _ctc_viterbi_forward(lp, s_arr, sk_m, s_b, 2, 3, 3, 250, 0.5)
    except Exception:
        pass


class CtcViterbiAligner:
    """Exact dynamic programming Viterbi Trellis alignment over acoustic emission logprobs."""
    default_blank_id: int = BLANK_ID  # 250
    frame_rate: float = FRAME_RATE    # 25.0 Hz (40ms per frame)
    frame_step: float = FRAME_STEP    # 0.040s
    vocab_size: int = 251

    @classmethod
    def align_phonemes(
        cls,
        target_phonemes: List[PhonemeToken],
        audio_duration: float,
        token2id: Dict[str, int],
        logprobs_matrix: Optional[np.ndarray],
        num_frames: Optional[int] = None,
        custom_blank_id: Optional[int] = None,
        pause_intervals: Optional[List[PauseInterval]] = None,
    ) -> List[PhonemeToken]:
        if not target_phonemes:
            return []

        b_id = custom_blank_id if custom_blank_id is not None else cls.default_blank_id
        n = len(target_phonemes)

        lp = logprobs_matrix
        if lp is not None and lp.ndim == 2:
            total_frames = lp.shape[0] if num_frames is None else num_frames
        elif lp is not None and lp.ndim == 1:
            total_frames = (len(lp) // cls.vocab_size) if num_frames is None else num_frames
            lp = lp.reshape(-1, cls.vocab_size)
        else:
            total_frames = int(math.ceil(audio_duration * cls.frame_rate)) if num_frames is None else num_frames

        if lp is None or total_frames <= 0 or lp.shape[0] < total_frames:
            return [
                PhonemeToken(
                    phoneme=p.phoneme, start=p.start, end=p.end, confidence=p.confidence,
                    is_recovered=p.is_recovered, start_frame=p.start_frame,
                    end_frame=p.end_frame, peak_frame=p.peak_frame, peak_timestamp=p.peak_timestamp,
                    raw_start=p.raw_start if p.raw_start is not None else p.start,
                    raw_end=p.raw_end if p.raw_end is not None else p.end,
                )
                for p in target_phonemes
            ]

        # 1. Map target phonemes to token IDs
        token_ids = np.empty(n, dtype=np.int32)
        for i in range(n):
            token_ids[i] = token2id.get(target_phonemes[i].phoneme, b_id)

        # 2. Interleaved CTC state sequence: [blank, tok_0, blank, tok_1, ..., blank]
        l = 2 * n + 1
        s_array = np.empty(l, dtype=np.int32)
        for i in range(l):
            s_array[i] = b_id if (i % 2 == 0) else token_ids[i // 2]

        # 3. Skip mask: allow direct s-2 -> s when s is odd and S[s] != S[s-2]
        skip_mask = np.zeros(l, dtype=np.uint8)
        for s in range(3, l, 2):
            if s_array[s] != s_array[s - 2]:
                skip_mask[s] = 1

        # 4. Fast Viterbi Trellis (Banded for l > 256 to guarantee 0% disk and O(T) memory)
        if l > 256:
            band_width = 256
            pk_frames = []
            pk_states = []
            for k in range(n):
                pk = target_phonemes[k].peak_frame
                if pk is not None:
                    pk_frames.append(pk)
                    pk_states.append(2 * k + 1)

            if not pk_frames:
                s_guide = np.linspace(0, l - 1, total_frames, dtype=np.int32)
            else:
                pk_frames_arr = np.array(pk_frames, dtype=np.float64)
                pk_states_arr = np.array(pk_states, dtype=np.float64)
                all_frames = np.arange(total_frames, dtype=np.float64)
                s_guide = np.interp(all_frames, pk_frames_arr, pk_states_arr).astype(np.int32)

            s_base = np.clip(s_guide - (band_width // 2), 0, max(0, l - band_width)).astype(np.int32)
        else:
            band_width = l
            s_base = np.zeros(total_frames, dtype=np.int32)

        backtrack, v_prev = _ctc_viterbi_forward(
            lp=lp,
            s_array=s_array,
            skip_mask=skip_mask,
            s_base=s_base,
            total_frames=total_frames,
            l=l,
            band_width=band_width,
            b_id=b_id,
            blank_penalty=CTC_BLANK_PENALTY,
        )

        # 5. Backtracking
        curr_s = l - 1
        if l > 1 and v_prev[l - 2] > v_prev[l - 1]:
            curr_s = l - 2

        if v_prev[curr_s] <= -1e29:
            max_score = -1e30
            for s in range(l - 1, -1, -1):
                if v_prev[s] > max_score:
                    max_score = v_prev[s]
                    curr_s = s

        state_path = np.empty(total_frames, dtype=np.int32)
        for t in range(total_frames - 1, -1, -1):
            state_path[t] = curr_s
            if t > 0:
                col = curr_s - s_base[t]
                step = int(backtrack[t, col]) if (0 <= col < band_width) else 0
                curr_s = max(0, curr_s - step)

        # 6. Extract Boundaries & Acoustic Confidence
        raw_starts = np.full(n, -1, dtype=np.int32)
        raw_ends = np.full(n, -1, dtype=np.int32)

        for t in range(total_frames):
            s = int(state_path[t])
            if s % 2 == 1:
                k = s // 2
                if k < n:
                    if raw_starts[k] == -1:
                        raw_starts[k] = t
                    raw_ends[k] = t

        peak_frames = np.empty(n, dtype=np.int32)
        peak_confidences = np.empty(n, dtype=np.float32)

        for k in range(n):
            s_f = int(raw_starts[k])
            e_f = int(raw_ends[k])
            tok_id = int(token_ids[k])

            if s_f != -1:
                best_f = s_f
                max_lp = -1e30
                for f in range(s_f, e_f + 1):
                    if state_path[f] == 2 * k + 1:
                        lp_val = float(lp[f, tok_id])
                        if lp_val > max_lp:
                            max_lp = lp_val
                            best_f = f
                peak_frames[k] = best_f

                frame_row = lp[best_f]
                orig_val = frame_row[tok_id]
                frame_row[tok_id] = -1e30
                runner_up = float(np.max(frame_row)) if cls.vocab_size > 1 else -1e30
                frame_row[tok_id] = orig_val
                peak_confidences[k] = max(0.1, max_lp - runner_up)
            else:
                fallback_pk = (
                    target_phonemes[k].peak_frame
                    if target_phonemes[k].peak_frame is not None
                    else int(round(target_phonemes[k].start * cls.frame_rate))
                )
                peak_frames[k] = int(np.clip(fallback_pk, 0, total_frames - 1))
                peak_confidences[k] = float(target_phonemes[k].confidence)
                raw_starts[k] = peak_frames[k]
                raw_ends[k] = peak_frames[k]

        # 7. Compute Clean Boundaries with Acoustic Gap Classification
        #    - VAD pauses: preserved as true silence gaps (phonemes do NOT absorb silence)
        #    - Continuous speech: phonemes are strictly contiguous (zero gap, no flickering)
        #    - Held letters / Madd: extended through the held portion until next phoneme onset
        #    - Opening & trailing silence: preserved from emission bounds
        token_starts = np.zeros(n, dtype=np.float64)
        token_ends = np.zeros(n, dtype=np.float64)
        is_vad_pause_gap = np.zeros(n, dtype=bool)

        # Token 0 starts at its real acoustic emission, NEVER at 0.0 (opening silence preserved!)
        token_starts[0] = float(max(0, raw_starts[0]))

        p_starts = [p.start_sec for p in pause_intervals] if pause_intervals else []
        num_pauses = len(p_starts)

        for k in range(1, n):
            gap_start = int(raw_ends[k - 1] + 1)
            gap_end = int(raw_starts[k] - 1)

            if gap_end < gap_start:
                # No gap — contiguous emission frames
                token_ends[k - 1] = float(raw_starts[k])
                token_starts[k] = float(raw_starts[k])
                continue

            gap_s_sec = gap_start * cls.frame_step
            gap_e_sec = (gap_end + 1) * cls.frame_step

            # Check VAD pause overlap (true acoustic silence) via fast binary search
            has_vad_pause = False
            if num_pauses > 0:
                p_idx = bisect.bisect_right(p_starts, gap_e_sec)
                for i in range(p_idx - 1, -1, -1):
                    p = pause_intervals[i]
                    if p.start_sec < gap_s_sec - 15.0:
                        break
                    overlap_s = max(gap_s_sec, p.start_sec)
                    overlap_e = min(gap_e_sec, p.end_sec)
                    if overlap_e - overlap_s >= 0.05 or (overlap_e > overlap_s and p.duration_sec >= 0.15):
                        has_vad_pause = True
                        break

            if has_vad_pause:
                # Confirmed VAD pause — preserve as true silence gap
                token_ends[k - 1] = float(gap_start)
                token_starts[k] = float(raw_starts[k])
                is_vad_pause_gap[k] = True
                continue

            # Continuous speech within speech segment:
            # CTC emits single spikes and blanks during held letters/madd/coarticulation.
            # Phonemes must be contiguous with ZERO gap to eliminate flickering and early disappearance.
            prev_tok = int(token_ids[k - 1])
            curr_tok = int(token_ids[k])
            prev_ph = target_phonemes[k - 1].phoneme
            curr_ph = target_phonemes[k].phoneme

            is_prev_madd = any(m in prev_ph for m in ("اا", "وو", "يي", "ںںں"))
            is_curr_madd = any(m in curr_ph for m in ("اا", "وو", "يي", "ںںں"))

            if is_curr_madd and not is_prev_madd:
                # Preceding consonant/short sound into Madd vowel:
                # Keep preceding consonant compact (1-2 frames), allocate rest of gap to the Madd
                boundary = min(raw_starts[k], gap_start)
            elif is_prev_madd and not is_curr_madd:
                # Madd / held letter into next consonant:
                # Extend previous phoneme through the held gap until next phoneme onset
                boundary = max(gap_start, raw_starts[k] - 1)
                for t in range(gap_start, min(gap_end + 1, total_frames)):
                    if lp[t, curr_tok] > lp[t, prev_tok] + 0.5:
                        boundary = t
                        break
            else:
                # General coarticulation: find logprob crossover, or split at midpoint
                boundary = gap_start
                for t in range(gap_start, min(gap_end + 1, total_frames)):
                    if lp[t, curr_tok] >= lp[t, prev_tok]:
                        boundary = t
                        break
                else:
                    boundary = int(round((gap_start + raw_starts[k]) / 2.0))

            token_ends[k - 1] = float(boundary)
            token_starts[k] = float(boundary)

        # Final token ends at its real acoustic offset, NEVER at total_frames (trailing silence preserved!)
        token_ends[n - 1] = float(min(total_frames, raw_ends[n - 1] + 1))

        # 8. Shift by Calibrated Model Lookahead (140ms = 3.5 frames)
        #    After shift, verify each phoneme doesn't absorb silence and enforce minimum duration.
        lookahead = float(LOOKAHEAD_OFFSET_FRAMES)
        min_dur_f = _MIN_PHONEME_DURATION_FRAMES
        min_dur_s = _MIN_PHONEME_DURATION_S
        s_secs = np.zeros(n, dtype=np.float64)
        e_secs = np.zeros(n, dtype=np.float64)
        pk_secs = np.zeros(n, dtype=np.float64)

        for k in range(n):
            s_f = max(0.0, token_starts[k] - lookahead)
            e_f = max(s_f + min_dur_f, token_ends[k] - lookahead)
            pk_f = max(0.0, float(peak_frames[k]) - lookahead)

            # Prevent lookahead shift from absorbing pre-phoneme silence:
            # ONLY for token 0 (audio start) or tokens following a true VAD pause.
            # In continuous speech, phoneme k-1 and phoneme k shift together and must stay contiguous!
            if k == 0 or is_vad_pause_gap[k]:
                s_f_int = int(s_f)
                orig_start = int(token_starts[k])
                if s_f_int < orig_start and s_f_int < total_frames:
                    for t_scan in range(s_f_int, min(orig_start + 1, total_frames)):
                        tok_lp_scan = float(lp[t_scan, int(token_ids[k])])
                        blank_lp_scan = float(lp[t_scan, b_id])
                        if tok_lp_scan > blank_lp_scan - 4.0:
                            s_f = float(t_scan)
                            break
                    e_f = max(s_f + min_dur_f, e_f)
            else:
                # Continuous speech: connect cleanly with previous token
                s_f = max(0.0, token_starts[k] - lookahead)
                e_f = max(s_f + min_dur_f, token_ends[k] - lookahead)

            s_secs[k] = s_f * cls.frame_step
            e_secs[k] = max(s_secs[k] + min_dur_s, e_f * cls.frame_step)
            pk_secs[k] = pk_f * cls.frame_step

        # Enforce exact contiguity for continuous speech transitions before hard silence masking
        for k in range(1, n):
            if not is_vad_pause_gap[k]:
                s_secs[k] = e_secs[k - 1]
                e_secs[k] = max(s_secs[k] + min_dur_s, e_secs[k])

        # 9. Hard Silence Masking: Ensure NO phoneme ever absorbs or overlaps a VAD pause interval
        if pause_intervals:
            for p in pause_intervals:
                p_s = p.start_sec
                p_e = p.end_sec
                if p_e <= p_s:
                    continue
                k_start = max(0, bisect.bisect_left(s_secs, p_s - 4.0) - 2)
                k_end = min(n, bisect.bisect_right(s_secs, p_e + 1.0) + 2)
                for k in range(k_start, k_end):
                    # If phoneme ends inside the pause -> clamp end to pause start
                    if p_s < e_secs[k] <= p_e:
                        e_secs[k] = max(s_secs[k] + min_dur_s, p_s)
                    # If phoneme starts inside the pause -> clamp start to pause end
                    if p_s <= s_secs[k] < p_e:
                        s_secs[k] = p_e
                        if e_secs[k] <= s_secs[k]:
                            e_secs[k] = s_secs[k] + min_dur_s
                    # If phoneme completely swallows the pause -> clamp to side of peak
                    if s_secs[k] < p_s and e_secs[k] > p_e:
                        if pk_secs[k] <= (p_s + p_e) / 2.0:
                            e_secs[k] = max(s_secs[k] + min_dur_s, p_s)
                        else:
                            s_secs[k] = p_e
                            e_secs[k] = max(s_secs[k] + min_dur_s, e_secs[k])

        # 10. Strict Monotonic Non-Overlapping Invariant: end[k-1] <= start[k] < end[k]
        for k in range(1, n):
            if not is_vad_pause_gap[k]:
                # Continuous speech: phonemes are contiguous with zero gap
                s_secs[k] = e_secs[k - 1]
                e_secs[k] = max(s_secs[k] + min_dur_s, e_secs[k])
            elif s_secs[k] < e_secs[k - 1]:
                # VAD pause gap overlap resolution
                mid = (e_secs[k - 1] + s_secs[k]) / 2.0
                e_secs[k - 1] = mid
                s_secs[k] = mid
                if e_secs[k - 1] - s_secs[k - 1] < min_dur_s:
                    s_secs[k - 1] = max(0.0 if k == 1 else e_secs[k - 2], e_secs[k - 1] - min_dur_s)
                if e_secs[k] - s_secs[k] < min_dur_s:
                    e_secs[k] = s_secs[k] + min_dur_s

        for k in range(n - 1, 0, -1):
            if s_secs[k] < e_secs[k - 1]:
                e_secs[k - 1] = s_secs[k]
                if e_secs[k - 1] - s_secs[k - 1] < min_dur_s:
                    s_secs[k - 1] = max(0.0 if k == 1 else e_secs[k - 2], e_secs[k - 1] - min_dur_s)

        # 11. Construct final PhonemeToken outputs with zero overlap and preserved silence gaps
        aligned: List[PhonemeToken] = []
        for i in range(n):
            s_final = min(audio_duration, max(0.0, s_secs[i]))
            e_final = min(audio_duration, max(s_final + min_dur_s, e_secs[i]))
            pk_final = min(audio_duration, max(s_final, min(e_final, pk_secs[i])))

            if aligned:
                if not is_vad_pause_gap[i]:
                    s_final = aligned[-1].end
                    if e_final <= s_final:
                        e_final = min(audio_duration, s_final + min_dur_s)
                elif s_final < aligned[-1].end:
                    s_final = aligned[-1].end
                    if e_final <= s_final:
                        e_final = min(audio_duration, s_final + min_dur_s)

            aligned.append(
                PhonemeToken(
                    phoneme=target_phonemes[i].phoneme,
                    start=round(s_final, 3),
                    end=round(e_final, 3),
                    confidence=round(float(peak_confidences[i]), 2),
                    is_recovered=target_phonemes[i].is_recovered,
                    start_frame=int(round(s_final / cls.frame_step)),
                    end_frame=int(round(e_final / cls.frame_step)),
                    peak_frame=int(peak_frames[i]),
                    peak_timestamp=round(pk_final, 3),
                    raw_start=target_phonemes[i].raw_start if target_phonemes[i].raw_start is not None else target_phonemes[i].start,
                    raw_end=target_phonemes[i].raw_end if target_phonemes[i].raw_end is not None else target_phonemes[i].end,
                )
            )

        return aligned
