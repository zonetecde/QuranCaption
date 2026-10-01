"""Numba JIT Accelerated Dynamic Programming Kernels for Quran Recitation Alignment.

Contains:
1. JumpDTW 3D Wraparound Dynamic Programming with exact Viterbi backtracking.
2. Gene Myers' 64-bit Bit-Parallel Substring Search kernel.
3. JIT warmup routines.
"""

from __future__ import annotations

from typing import Tuple, List
import numpy as np

from src.matching.phonetics import get_sub_cost_table

try:
    from numba import njit
    HAS_NUMBA = True
except ImportError:
    HAS_NUMBA = False
    def njit(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


# ═══════════════════════════════════════════════════════════════════════════════
# 1. JUMPDTW 3D WRAPAROUND VITERBI DECODER
# ═══════════════════════════════════════════════════════════════════════════════

@njit(fastmath=True, cache=True)
def _global_viterbi_fast(
    p_codes: np.ndarray,
    r_codes: np.ndarray,
    r_phone_to_word: np.ndarray,
    word_starts_mask: np.ndarray,
    word_ends_mask: np.ndarray,
    del_costs: np.ndarray,
    ins_costs: np.ndarray,
    sub_table: np.ndarray,
    wrap_penalty: float,
    wrap_span_weight: float,
) -> Tuple[int, int, float, np.ndarray, np.ndarray]:
    """JumpDTW Viterbi DP with backward jumps in O(M*N) time via suffix-minimum tracking."""
    m = len(p_codes)
    n = len(r_codes)
    INF = 1e9

    dp_prev = np.full(n + 1, INF, dtype=np.float64)
    dp_curr = np.full(n + 1, INF, dtype=np.float64)

    backtrack_op = np.zeros((m + 1, n + 1), dtype=np.uint8)
    wrap_from_j = np.zeros((m + 1, n + 1), dtype=np.uint16)

    dp_prev[0] = 0.0

    for j in range(1, n + 1):
        dp_prev[j] = dp_prev[j - 1] + del_costs[j - 1]
        backtrack_op[0, j] = 3  # REF DEL

    min_C_after = np.empty(n + 2, dtype=np.float64)
    best_j_after = np.empty(n + 2, dtype=np.int32)

    for i in range(1, m + 1):
        p_code = p_codes[i - 1]
        ins_c = ins_costs[i - 1]

        dp_curr[0] = dp_prev[0] + ins_c
        backtrack_op[i, 0] = 2  # ASR INS

        for j in range(1, n + 1):
            asr_ins_opt = dp_prev[j] + ins_c
            ref_del_opt = dp_curr[j - 1] + del_costs[j - 1]

            r_code = r_codes[j - 1]
            sub_c = sub_table[p_code, r_code]
            sub_opt = dp_prev[j - 1] + sub_c

            best = sub_opt
            choice = 1
            if asr_ins_opt < best:
                best = asr_ins_opt
                choice = 2
            if ref_del_opt < best:
                best = ref_del_opt
                choice = 3

            dp_curr[j] = best
            backtrack_op[i, j] = choice

        # O(N) backward jump calculation using suffix minimums
        min_C_after[n + 1] = INF
        best_j_after[n + 1] = -1
        current_min_C = INF
        current_best_j = -1

        for j in range(n, -1, -1):
            if word_ends_mask[j] and dp_curr[j] < INF:
                w_end = r_phone_to_word[j - 1]
                C = dp_curr[j] + (wrap_span_weight * w_end)
                if C < current_min_C:
                    current_min_C = C
                    current_best_j = j
            min_C_after[j] = current_min_C
            best_j_after[j] = current_best_j

        has_wrap = False
        for j_start in range(n + 1):
            if word_starts_mask[j_start]:
                c_after = min_C_after[j_start + 1]
                if c_after < INF:
                    w_start = r_phone_to_word[j_start] if j_start < n else r_phone_to_word[n - 1] + 1
                    new_cost = c_after + wrap_penalty - (wrap_span_weight * w_start)
                    if new_cost < dp_curr[j_start]:
                        dp_curr[j_start] = new_cost
                        backtrack_op[i, j_start] = 4  # WRAPAROUND JUMP
                        wrap_from_j[i, j_start] = np.uint16(best_j_after[j_start + 1])
                        has_wrap = True

        if has_wrap:
            for j in range(1, n + 1):
                ref_del_opt = dp_curr[j - 1] + del_costs[j - 1]
                if ref_del_opt < dp_curr[j]:
                    dp_curr[j] = ref_del_opt
                    backtrack_op[i, j] = 3

        dp_prev[:] = dp_curr[:]

    # Best endpoint among word boundaries
    best_score = INF
    best_j = -1
    for j in range(1, n + 1):
        if word_ends_mask[j] and dp_curr[j] < best_score:
            best_score = dp_curr[j]
            best_j = j

    # Exact Backtracking
    char_word_map = np.full(m, -1, dtype=np.int32)
    char_j_map = np.full(m, -1, dtype=np.int32)
    ci = m
    cj = best_j

    while ci > 0 or cj > 0:
        op = backtrack_op[ci, cj]
        if op == 1:
            w = r_phone_to_word[cj - 1]
            char_word_map[ci - 1] = w
            char_j_map[ci - 1] = cj - 1
            ci -= 1
            cj -= 1
        elif op == 2:
            w = r_phone_to_word[cj - 1] if cj > 0 else -1
            char_word_map[ci - 1] = w
            char_j_map[ci - 1] = cj - 1 if cj > 0 else -1
            ci -= 1
        elif op == 3:
            cj -= 1
        elif op == 4:
            cj = int(wrap_from_j[ci, cj])
        else:
            if cj > 0:
                cj -= 1
            elif ci > 0:
                ci -= 1
            else:
                break

    return m, best_j, best_score, char_word_map, char_j_map


# ═══════════════════════════════════════════════════════════════════════════════
# 2. GENE MYERS' 64-BIT BIT-PARALLEL SEARCH KERNEL
# ═══════════════════════════════════════════════════════════════════════════════

@njit(fastmath=True, cache=True)
def _bit_parallel_search_fast(
    query_codes: np.ndarray,
    text_codes: np.ndarray,
    max_dist: int,
) -> Tuple[List[int], List[int], List[int]]:
    """Gene Myers' 64-bit Bit-Parallel Substring Search Algorithm."""
    n = len(query_codes)
    m = len(text_codes)
    char_mask = np.zeros(2048, dtype=np.uint64)
    for i in range(n):
        c = query_codes[i]
        if c < 2048:
            char_mask[c] |= (np.uint64(1) << np.uint64(i))

    full_mask = (np.uint64(1) << np.uint64(n)) - np.uint64(1)
    top_mask = np.uint64(1) << np.uint64(n - 1)
    vp = full_mask
    vn = np.uint64(0)
    curr_dist = n

    match_starts: List[int] = []
    match_ends: List[int] = []
    match_dists: List[int] = []

    for j in range(m):
        code = text_codes[j]
        pm = char_mask[code] if code < 2048 else np.uint64(0)
        x = pm | vn
        d0 = (((pm & vp) + vp) ^ vp) | x
        hn = vp & d0
        hp = vn | (~(vp | d0) & full_mask)

        if (hp & top_mask) != 0:
            curr_dist += 1
        if (hn & top_mask) != 0:
            curr_dist -= 1

        hp = (hp << 1) & full_mask
        hn = (hn << 1) & full_mask
        vp = (hn | (~(d0 | hp) & full_mask)) & full_mask
        vn = hp & d0

        if curr_dist <= max_dist:
            match_end = j + 1
            match_starts.append(max(0, match_end - n))
            match_ends.append(match_end)
            match_dists.append(curr_dist)

    return match_starts, match_ends, match_dists


@njit(fastmath=True, cache=True)
def _refine_match_start(q_codes: np.ndarray, t_codes: np.ndarray, end_idx: int, max_d: int) -> int:
    """Finds exact match start by running backward Myers on the local window preceding end_idx."""
    n = len(q_codes)
    win_len = min(end_idx, n + max_d + 4)
    char_mask = np.zeros(2048, dtype=np.uint64)
    for i in range(n):
        c = q_codes[n - 1 - i]
        if c < 2048:
            char_mask[c] |= (np.uint64(1) << np.uint64(i))

    full_mask = (np.uint64(1) << np.uint64(n)) - np.uint64(1)
    top_mask = np.uint64(1) << np.uint64(n - 1)
    vp = full_mask
    vn = np.uint64(0)
    curr_dist = n
    best_dist = 999
    best_len = n

    for k in range(win_len):
        code = t_codes[end_idx - 1 - k]
        pm = char_mask[code] if code < 2048 else np.uint64(0)
        x = pm | vn
        d0 = (((pm & vp) + vp) ^ vp) | x
        hn = vp & d0
        hp = vn | (~(vp | d0) & full_mask)

        if (hp & top_mask) != 0:
            curr_dist += 1
        if (hn & top_mask) != 0:
            curr_dist -= 1

        hp = (hp << 1) & full_mask
        hn = (hn << 1) & full_mask
        vp = (hn | (~(d0 | hp) & full_mask)) & full_mask
        vn = hp & d0

        if curr_dist <= max_d and curr_dist <= best_dist:
            best_dist = curr_dist
            best_len = k + 1

    return end_idx - best_len


# ═══════════════════════════════════════════════════════════════════════════════
# 3. JIT WARMUP ROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

def warmup_matcher_jit() -> None:
    """Pre-compiles Numba JIT kernels for the 3D wraparound DP."""
    if not HAS_NUMBA:
        return
    try:
        p_dummy = np.array([0x0642, 0x0627, 0x0644], dtype=np.int32)
        r_dummy = np.array([0x0642, 0x0627, 0x0644], dtype=np.int32)
        phone_to_w = np.array([0, 0, 0], dtype=np.int32)
        w_starts = np.array([True, False, False, False], dtype=np.bool_)
        w_ends = np.array([False, False, False, True], dtype=np.bool_)
        del_c = np.array([1.0, 1.0, 1.0], dtype=np.float64)
        ins_c = np.array([0.75, 0.75, 0.75], dtype=np.float64)
        tbl_dummy = get_sub_cost_table(0.25)

        _global_viterbi_fast(
            p_codes=p_dummy,
            r_codes=r_dummy,
            r_phone_to_word=phone_to_w,
            word_starts_mask=w_starts,
            word_ends_mask=w_ends,
            del_costs=del_c,
            ins_costs=ins_c,
            sub_table=tbl_dummy,
            wrap_penalty=0.8,
            wrap_span_weight=0.05,
        )
    except Exception:
        pass


def warmup_detector_jit() -> None:
    """Pre-compiles Myers bit-parallel search so first query is instant."""
    if not HAS_NUMBA:
        return
    try:
        q_d = np.array([1575], dtype=np.int32)
        t_d = np.array([1575, 1576], dtype=np.int32)
        _bit_parallel_search_fast(q_d, t_d, 1)
        _refine_match_start(q_d, t_d, 1, 1)
    except Exception:
        pass


def warmup_matching() -> None:
    """Consolidated warmup for all matching subsystem JIT kernels."""
    warmup_matcher_jit()
    warmup_detector_jit()


warmup_matching_kernels = warmup_matching

