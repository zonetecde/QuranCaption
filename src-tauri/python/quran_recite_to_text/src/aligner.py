"""Phase 2: CTC Viterbi Trellis Forced Alignment Engine."""

from __future__ import annotations

import math
import bisect
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


# Minimum phoneme duration to prevent visual UI flickering (100ms ≈ 2.5 CTC frames at 25 Hz)
_MIN_PHONEME_DURATION_S = 0.100
_MIN_PHONEME_DURATION_FRAMES = 2.5

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
        audio_pcm: Optional[np.ndarray] = None,
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

        # 7. Acoustic-Neural Hybrid Boundary Engine
        #    - True acoustic pauses & breath: preserved as unhighlighted gaps (zero silence absorption)
        #    - Continuous speech within words/phrases: strictly contiguous (zero gap, zero flickering)
        #    - Held letters / Madd / Ghunnah: extended through the full held vocalic/nasal duration
        #    - Causal Acoustic Onset: starts at energy rise so letters NEVER START LATE
        frame_samples = int(cls.frame_step * 16000)
        if audio_pcm is not None and len(audio_pcm) >= frame_samples:
            n_audio_frames = min(total_frames, len(audio_pcm) // frame_samples)
            audio_frames = audio_pcm[:n_audio_frames * frame_samples].reshape(n_audio_frames, frame_samples)
            rms = np.sqrt(np.mean(audio_frames**2, axis=-1) + 1e-12)
            rms_db = 20.0 * np.log10(rms)
            zcr = np.mean(np.abs(np.diff(np.sign(audio_frames), axis=-1)), axis=-1) / 2.0
            p05 = float(np.percentile(rms_db, 5))
            p85 = float(np.percentile(rms_db, 85))
            # Adaptive threshold: 6 dB above 5th percentile noise floor, safely bounded
            silence_energy_threshold = float(np.clip(p05 + 6.0, -50.0, -34.0))
        else:
            rms_db = np.full(total_frames, -30.0, dtype=np.float32)
            zcr = np.full(total_frames, 0.10, dtype=np.float32)
            silence_energy_threshold = -36.0
            if lp is not None and lp.shape[0] >= total_frames:
                for f in range(total_frames):
                    if float(lp[f, b_id]) > -0.05:
                        rms_db[f] = -50.0

        min_dur_s = _MIN_PHONEME_DURATION_S
        min_dur_f = _MIN_PHONEME_DURATION_FRAMES

        token_starts = np.zeros(n, dtype=np.float64)
        token_ends = np.zeros(n, dtype=np.float64)
        is_silence_gap = np.zeros(n, dtype=bool)

        # First token onset: scan backward from peak for acoustic onset (never start late!)
        pk0 = int(peak_frames[0])
        on0 = pk0
        for f in range(pk0 - 1, max(-1, pk0 - 5), -1):
            if f < len(rms_db) and rms_db[f] > silence_energy_threshold:
                on0 = f
            else:
                break
        token_starts[0] = float(on0)

        p_starts = [p.start_sec for p in pause_intervals] if pause_intervals else []
        num_pauses = len(p_starts)

        for k in range(1, n):
            gap_start = int(raw_ends[k - 1] + 1)
            gap_end = int(raw_starts[k] - 1)
            curr_pk = int(peak_frames[k])

            gap_s_sec = gap_start * cls.frame_step
            gap_e_sec = (gap_end + 1) * cls.frame_step

            # Check 1: VAD pause overlap (confirmed Tajweed pause)
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

            # Check 2: Acoustic silence / breath inhalation in the gap
            silence_frames = 0
            breath_frames = 0
            silence_start_f = -1
            silence_end_f = -1
            if gap_end >= gap_start:
                for f in range(gap_start, min(gap_end + 1, len(rms_db))):
                    is_dead_silence = rms_db[f] < silence_energy_threshold
                    is_breath_inhalation = (rms_db[f] < (silence_energy_threshold + 14.0) and zcr[f] > 0.12 and lp[f, b_id] > -0.10)
                    if is_dead_silence:
                        if silence_start_f == -1:
                            silence_start_f = f
                        silence_end_f = f + 1
                        silence_frames += 1
                    elif is_breath_inhalation:
                        if silence_start_f == -1:
                            silence_start_f = f
                        silence_end_f = f + 1
                        breath_frames += 1

            # A true Tajweed pause or breath takes at least 160ms (4 frames) or has VAD pause confirmation.
            # Short dips under 120ms without VAD are intra-word stop closures (حروف الشدة) and should remain contiguous.
            has_acoustic_silence = has_vad_pause or (silence_frames >= 4) or (breath_frames >= 3)

            if has_acoustic_silence:
                # TRUE SILENCE GAP: Never absorb silence into phonemes!
                is_silence_gap[k] = True
                if silence_start_f != -1:
                    token_ends[k - 1] = max(token_starts[k - 1] + min_dur_f, float(silence_start_f))
                else:
                    token_ends[k - 1] = max(token_starts[k - 1] + min_dur_f, float(gap_start))

                # Onset of next phoneme: scan backward from peak for acoustic onset (never start late!)
                on_f = curr_pk
                min_f = max(silence_end_f if silence_end_f != -1 else gap_start, curr_pk - 4)
                for f in range(curr_pk - 1, min_f - 1, -1):
                    if f < len(rms_db) and rms_db[f] > silence_energy_threshold:
                        on_f = f
                    else:
                        break
                token_starts[k] = float(on_f)
            else:
                # CONTINUOUS SPEECH: strictly contiguous (zero gap, zero flickering)
                prev_ph = target_phonemes[k - 1].phoneme
                curr_ph = target_phonemes[k].phoneme
                is_prev_madd = any(m in prev_ph for m in ("اا", "وو", "يي", "ںںں", "مممم", "نننن"))
                is_curr_madd = any(m in curr_ph for m in ("اا", "وو", "يي", "ںںں", "مممم", "نننن"))

                if is_curr_madd and not is_prev_madd:
                    # Consonant into Madd vowel: keep consonant compact, Madd spans remainder
                    boundary = min(raw_starts[k], max(raw_ends[k - 1] + 1, int(round(token_starts[k - 1] + min_dur_f))))
                elif is_prev_madd and not is_curr_madd:
                    # Madd into consonant: Madd holds through vocalic energy until consonant onset
                    boundary = max(raw_ends[k - 1] + 1, raw_starts[k] - 1)
                else:
                    # Consonant to consonant: clean midpoint
                    boundary = int(round((gap_start + raw_starts[k]) / 2.0)) if gap_end >= gap_start else raw_starts[k]

                b_float = float(boundary)
                token_ends[k - 1] = max(token_starts[k - 1] + min_dur_f, b_float)
                token_starts[k] = token_ends[k - 1]

        # Final token offset
        token_ends[n - 1] = max(token_starts[n - 1] + min_dur_f, float(min(total_frames, raw_ends[n - 1] + 1)))

        # 8. Convert frames to seconds & Enforce strict monotonicity and silence protection
        s_secs = token_starts * cls.frame_step
        e_secs = np.maximum(s_secs + min_dur_s, token_ends * cls.frame_step)
        pk_secs = peak_frames * cls.frame_step

        for k in range(1, n):
            if not is_silence_gap[k]:
                s_secs[k] = e_secs[k - 1]
                e_secs[k] = max(s_secs[k] + min_dur_s, e_secs[k])
            elif s_secs[k] < e_secs[k - 1]:
                mid = (e_secs[k - 1] + s_secs[k]) / 2.0
                e_secs[k - 1] = mid
                s_secs[k] = mid
                if e_secs[k - 1] - s_secs[k - 1] < min_dur_s:
                    s_secs[k - 1] = max(0.0 if k == 1 else e_secs[k - 2], e_secs[k - 1] - min_dur_s)
                if e_secs[k] - s_secs[k] < min_dur_s:
                    e_secs[k] = s_secs[k] + min_dur_s

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
                    if p_s < e_secs[k] <= p_e:
                        e_secs[k] = max(s_secs[k] + min_dur_s, p_s)
                    if p_s <= s_secs[k] < p_e:
                        s_secs[k] = p_e
                        if e_secs[k] <= s_secs[k]:
                            e_secs[k] = s_secs[k] + min_dur_s
                    if s_secs[k] < p_s and e_secs[k] > p_e:
                        if pk_secs[k] <= (p_s + p_e) / 2.0:
                            e_secs[k] = max(s_secs[k] + min_dur_s, p_s)
                        else:
                            s_secs[k] = p_e
                            e_secs[k] = max(s_secs[k] + min_dur_s, e_secs[k])

        for k in range(n - 1, 0, -1):
            if s_secs[k] < e_secs[k - 1]:
                e_secs[k - 1] = s_secs[k]
                if e_secs[k - 1] - s_secs[k - 1] < min_dur_s:
                    s_secs[k - 1] = max(0.0 if k == 1 else e_secs[k - 2], e_secs[k - 1] - min_dur_s)

        # 10. Construct final PhonemeToken outputs with zero overlap and preserved silence gaps
        aligned: List[PhonemeToken] = []
        for i in range(n):
            s_final = min(audio_duration, max(0.0, s_secs[i]))
            e_final = min(audio_duration, max(s_final + min_dur_s, e_secs[i]))
            pk_final = min(audio_duration, max(s_final, min(e_final, pk_secs[i])))

            if aligned:
                if not is_silence_gap[i] or s_final < aligned[-1].end:
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
