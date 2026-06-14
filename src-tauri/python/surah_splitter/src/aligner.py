"""
aligner.py

Provides highly optimized Forced Alignment algorithms to map acoustic frames
(represented as log probabilities from a CTC model) to character tokens.

Uses the Trellis Dynamic Programming method (Viterbi decoding constrained to a specific path)
accelerated via Numba's @njit to achieve massive speedups over pure Python loops.
"""

import numpy as np
import numba
from typing import Sequence, List

@numba.njit(cache=True)
def _numba_trellis(logprobs: np.ndarray, seq_arr: np.ndarray, blank_id: int):
    T = logprobs.shape[0]
    S = len(seq_arr)
    NEG_INF = np.float32(-1e18)
    
    prev_alpha = np.full(S, NEG_INF, dtype=np.float32)
    back = np.zeros((T, S), dtype=np.int8)

    prev_alpha[0] = logprobs[0, seq_arr[0]]
    if S > 1:
        prev_alpha[1] = logprobs[0, seq_arr[1]]

    skip_ok = np.zeros(S, dtype=np.bool_)
    if S >= 3:
        for s in range(2, S):
            skip_ok[s] = (seq_arr[s] != blank_id) and (seq_arr[s] != seq_arr[s-2])

    curr_alpha = np.empty(S, dtype=np.float32)

    for t in range(1, T):
        for s in range(S):
            c0 = prev_alpha[s]
            c1 = prev_alpha[s-1] if s >= 1 else NEG_INF
            c2 = prev_alpha[s-2] if (s >= 2 and skip_ok[s]) else NEG_INF
            
            best_val = c0
            best_idx = 0
            if c1 > best_val:
                best_val = c1
                best_idx = 1
            if c2 > best_val:
                best_val = c2
                best_idx = 2
                
            curr_alpha[s] = best_val + logprobs[t, seq_arr[s]]
            back[t, s] = -best_idx
            
        # Swap pointers (faster than copying, though Numba array assignment works too)
        for s in range(S):
            prev_alpha[s] = curr_alpha[s]
        
    return prev_alpha, back

def ctc_forced_align(
    logprobs: np.ndarray,
    token_ids: Sequence[int],
    blank_id: int,
) -> List[tuple[int, int]]:
    """Trellis-based forced alignment.
    
    logprobs: (T, V) numpy array of log-softmaxed CTC outputs.
    token_ids: target token sequence (must be reachable; no consecutive
      same-token collapse — caller handles repeats by separating with blanks).

    Returns list of (start_frame, end_frame) per token (half-open).
    """
    T, _V = logprobs.shape
    
    seq = [blank_id]
    for t in token_ids:
        seq.append(int(t))
        seq.append(blank_id)
    S = len(seq)
    
    if T < S // 2:
        raise ValueError(f"Audio too short: T={T} frames, but need >= {S // 2} for {len(token_ids)} tokens")

    seq_arr = np.asarray(seq, dtype=np.int32)
    
    # Run the ultra-fast Numba JIT compiled DP loop
    final_alpha, back = _numba_trellis(logprobs, seq_arr, blank_id)

    # End state: must be at S-1 (last blank) or S-2 (last token)
    end_candidates = [(final_alpha[S - 1], S - 1)]
    if S >= 2:
        end_candidates.append((final_alpha[S - 2], S - 2))
    _best_score, s = max(end_candidates, key=lambda x: x[0])

    # Backtrack
    path: list[int] = [s]
    for t in range(T - 1, 0, -1):
        s = s + int(back[t, s])
        path.append(s)
    path.reverse()
    
    # path is a sequence of indices into `seq`. Convert to per-token intervals.
    intervals: list[tuple[int, int]] = []
    cur_token_idx = -1
    cur_start = 0
    for t, s in enumerate(path):
        if seq[s] == blank_id:
            continue
        tok_idx = (s - 1) // 2
        if tok_idx != cur_token_idx:
            if cur_token_idx >= 0:
                intervals.append((cur_start, t))
            cur_token_idx = tok_idx
            cur_start = t
            
    if cur_token_idx >= 0:
        intervals.append((cur_start, T))
        
    while len(intervals) < len(token_ids):
        last = intervals[-1][1] if intervals else 0
        intervals.append((last, last))
        
    return intervals[: len(token_ids)]