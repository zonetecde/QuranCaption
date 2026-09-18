"""Phase 2: CTC Viterbi Trellis Forced Alignment Engine."""

from __future__ import annotations

import math
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
import config as _cfg
from src.models import PhonemeToken

logger = logging.getLogger(__name__)

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
        pause_timestamps: Optional[List[float]] = None,
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
                    end_frame=p.end_frame, peak_frame=p.peak_frame, peak_timestamp=p.peak_timestamp
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
                mask = np.ones(cls.vocab_size, dtype=bool)
                mask[tok_id] = False
                runner_up = float(np.max(frame_row[mask])) if cls.vocab_size > 1 else -1e30
                peak_confidences[k] = max(0.1, max_lp - runner_up)
            else:
                fallback_pk = (
                    target_phonemes[k].peak_frame
                    if target_phonemes[k].peak_frame is not None
                    else int(round(target_phonemes[k].start * cls.frame_rate))
                )
                peak_frames[k] = int(np.clip(fallback_pk, 0, total_frames - 1))
                peak_confidences[k] = float(target_phonemes[k].confidence)

        token_starts = np.zeros(n, dtype=np.float64)
        token_ends = np.zeros(n, dtype=np.float64)

        # Acoustic silence preservation settings
        _trim = getattr(_cfg, "ENABLE_ACOUSTIC_SILENCE_PRESERVATION", False)
        _min_gap = getattr(_cfg, "MIN_SILENCE_GAP_FRAMES", 12)
        _onset_pad = getattr(_cfg, "PHONEME_ONSET_PAD_FRAMES", 7.5)
        _offset_pad = getattr(_cfg, "PHONEME_OFFSET_PAD_FRAMES", 2.5)

        # Anchor first phoneme: use actual speech onset with onset padding to capture consonant attack
        if _trim and raw_starts[0] != -1:
            token_starts[0] = max(0.0, float(raw_starts[0]) - _onset_pad)
        else:
            token_starts[0] = 0.0

        for k in range(1, n):
            if raw_starts[k] == -1:
                token_starts[k] = token_ends[k - 1]
                token_ends[k] = token_starts[k]
                continue
            if raw_starts[k - 1] == -1:
                token_starts[k] = token_ends[k - 1]
                continue

            if raw_starts[k] <= raw_ends[k - 1]:
                token_ends[k - 1] = float(raw_starts[k])
                token_starts[k] = float(raw_starts[k])
                continue

            gap_frames = raw_starts[k] - raw_ends[k - 1]
            lookahead = LOOKAHEAD_OFFSET_FRAMES

            # Check if a REAL acoustic silence pause (from VAD) falls in this gap
            t_gap_start = (raw_ends[k - 1] - lookahead) * cls.frame_step
            t_gap_end = (raw_starts[k] - lookahead) * cls.frame_step

            if pause_timestamps is not None and len(pause_timestamps) > 0:
                is_true_pause = any(t_gap_start - 0.10 <= p <= t_gap_end + 0.10 for p in pause_timestamps) or (gap_frames >= 45)
            else:
                is_true_pause = (gap_frames >= 40)

            if _trim and is_true_pause and gap_frames >= _min_gap:
                # Genuine breath pause (Waqf) detected by VAD & CTC Trellis — preserve silence
                token_ends[k - 1] = min(float(raw_starts[k]), float(raw_ends[k - 1]) + _offset_pad)
                token_starts[k] = max(float(token_ends[k - 1]), float(raw_starts[k]) - _onset_pad)
            else:
                # Continuous speech transition (Wasl, Ghunnah, stop consonants, Madd)
                # In continuous speech, token k-1 has finished its vowel/consonant at raw_ends[k-1].
                # Any subsequent acoustic energy (Ghunnah, Tashdeed closure, vowel onset) belongs to token k!
                boundary = float(raw_ends[k - 1])
                token_ends[k - 1] = boundary
                token_starts[k] = boundary

        # Anchor last phoneme: use actual speech offset instead of absorbing post-speech silence
        if n > 0:
            if _trim and raw_ends[n - 1] != -1:
                token_ends[n - 1] = min(float(total_frames), float(raw_ends[n - 1]) + _offset_pad)
            else:
                token_ends[n - 1] = float(total_frames)

        lookahead = LOOKAHEAD_OFFSET_FRAMES
        aligned: List[PhonemeToken] = []

        for i in range(n):
            s_frame = max(0.0, token_starts[i] - lookahead)
            e_frame = max(s_frame + 0.5, token_ends[i] - lookahead)

            s_sec = min(audio_duration, s_frame * cls.frame_step)
            e_sec = min(audio_duration, max(s_sec + cls.frame_step, e_frame * cls.frame_step))
            pk_sec = min(audio_duration, float(peak_frames[i]) * cls.frame_step)

            aligned.append(
                PhonemeToken(
                    phoneme=target_phonemes[i].phoneme,
                    start=round(s_sec, 3),
                    end=round(e_sec, 3),
                    confidence=round(float(peak_confidences[i]), 2),
                    is_recovered=target_phonemes[i].is_recovered,
                    start_frame=int(round(s_frame)),
                    end_frame=int(round(e_frame)),
                    peak_frame=int(peak_frames[i]),
                    peak_timestamp=round(pk_sec, 3),
                )
            )

        return aligned
