# Under-Segmentation Detection v2: Unified Wraparound DP

## Motivation & Context

### What v1 does

v1 (see [`proposed-algo.md`](proposed-algo.md)) is a two-step pipeline:

1. **Standard DP** — `align_with_word_boundaries(P, R, ...)` finds the best contiguous word match `[word_from, word_to]` in the search window.
2. **Post-hoc repetition check** — if `len(P) - ref_len ≥ 8`, enumerate ~50-100 decomposition candidates of the matched range and test each with a separate DP call.

### Why v1 has structural weaknesses

**The anchoring problem.** When P is under-segmented (contains a repetition), the standard DP in step 1 is already working with corrupted evidence. The extra phonemes from the repeated portion pull the best-match range in unpredictable ways — it may land on the right range, or it may drift. Step 2 is then anchored to whatever range step 1 chose. If step 1 was wrong, step 2 tests the wrong decompositions.

**The enumeration ceiling.** Decomposition enumeration is viable for k=2 and k=3. Dataset analysis of the two aligned reciters shows:

| Reciter | Verses with reps | Max reps/verse | k=4+ verses |
|---------|-----------------|----------------|-------------|
| ali_jaber | 133 (2.1%) | 2 | 0 |
| minshawy_murattal | 472 (7.6%) | **5** | 9 |

For k=5 (5 repetitions = 6-pass decomposition), raw candidates are in the millions before length filtering. v1 cannot handle this.

**The pre-filter is a performance workaround, not a correctness requirement.** The `excess ≥ 8` gate exists solely to avoid running 100 DP calls per segment. Remove the cost reason and the gate is unnecessary.

### The unified solution

Instead of separating "find R" from "detect repetition", run a **single DP that simultaneously**:
- Searches for the best R range (same lookback/lookahead window as today)
- Discovers whether P traverses that range more than once, and where the wrap points are

This is the wraparound DP: the standard alignment DP with the reference allowed to loop back at word boundaries. A single DP call replaces step 1 + pre-filter + all of step 2.

---

## High-Level Overview

### Standard DP (v1)

The reference window R is a flat sequence of phonemes. The DP finds the minimum-cost path from some word-boundary start to some word-boundary end in R. The path is **monotone**: both P-index and R-index only increase.

```
P:  [f a b i ʔ a j i | ʔ aː l aː ʔ i | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n]
     ───────────────────────────────────────────────────────────────────────────────→
R:  [f a b i ʔ a jj i | ʔ aː l aː ʔ i | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n]
     ───────────────────────────────────────────────────────────────────────────────→
```

### Wraparound DP (v2)

Same DP, but at any word boundary in R, the path may **wrap** — paying `WRAP_PENALTY` and jumping back to an earlier word boundary in R. P continues forward; only R jumps back.

```
P:  [f a b i ʔ a j i | ʔ aː l aː ʔ i | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n]
     ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────→
R:  [f a b i ʔ a jj i | ʔ aː l aː ʔ i | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n]←─┐ [rˤ aˤ bb i k u m aː | t u k a ðð i b aː n]
     ─────────────────────────────────────────────────────────────────────────────────┘ └──────────────────────────────────────────→
                                                                              WRAP (penalty paid here)
```

The DP path traverses R once, then wraps back to w2 (start of رَبِّكُمَا), then traverses w2-w3 again. The traceback yields:
- Matched range: w0–w3
- Wrap count: 1
- Wrap point: after w3, back to w2 → decomposition `[w0-w3, w2-w3]`

The wrap penalty acts as a continuous gate: if P does not contain a genuine repetition, paying `WRAP_PENALTY` is always more expensive than absorbing the small phoneme excess as deletions, so the DP never wraps.

---

## Worked Example: 55:13 — Short Suffix Repeat

**Reference R** (w0–w3, 31 phones):

| Idx | Arabic | Phonemes | Phones |
|-----|--------|----------|--------|
| w0 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| w1 | ءَالَآءِ | `ʔ aː l aː ʔ i` | 6 |
| w2 | رَبِّكُمَا | `rˤ aˤ bb i k u m aː` | 8 |
| w3 | تُكَذِّبَانِ | `t u k a ðð i b aː n` | 9 |

**Reciter**: reads w0-w3 once, pauses, repeats w2-w3, continues.
**P** ≈ 50 phones (31 + 17 repeated + 2 noise).

### Standard DP (v1 result)

P length (50) >> R length (31). DP absorbs the 19 extra P phonemes as deletions:
```
H0 cost  = 19 × 0.8 + 3 × 0.5 = 16.7
H0 norm  = 16.7 / 50 = 0.33    confidence = 0.67
```

### Wraparound DP (v2)

The DP fills a matrix of P (rows 0–50) × R (columns 0–31). At column 31 (word boundary after w3), the DP finds that wrapping back to column 14 (start of w2, after 8+6=14 phones) and continuing is cheaper than absorbing P[31:50] as 19 deletions.

**Phase 1** — align P[0:31] against R[0:31] (first pass):
```
Cost after first pass ≈ 3 × 0.5 = 1.5   (3 ASR substitutions at custom pair costs from phoneme_sub_costs.json; default COST_SUBSTITUTION is 1.0)
```

**Wrap decision** at (P=31, R=31):
```
No-wrap continuation cost: absorb P[31:50] as 19 deletions = 19 × 0.8 = 15.2
Wrap to w2 cost:           WRAP_PENALTY (e.g. 2.0) + align P[31:48] vs R[14:31]
  P[31:48] vs R[14:31]:    17 phones vs 17 phones ≈ 1 noise deletion = 0.8
  Remaining P[48:50]:      2 noise deletions = 1.6
  Wrap total:              2.0 + 0.8 + 1.6 = 4.4
```

**Wrap is taken**: 4.4 << 15.2.

**Phase 2** — align P[31:48] against R[14:31] (w2–w3, second pass):
```
Cost ≈ 1 noise deletion = 0.8   (COST_DELETION = 0.8; not insertion which costs 1.0)
```

**Final result:**
```
Total cost  = 1.5 + 2.0 + 0.8 + 1.6 = 5.9
Phoneme-only cost (excluding WRAP_PENALTY) = 3.9
Norm dist   = 3.9 / 50 = 0.078    confidence = 0.92   (wrap cost excluded, see Risk §4)
Wraps       = 1
Wrap point  = after R position 31 → back to R position 14 (start of w2)
Decomp      = [w0-w3, w2-w3]
```

Compare:
| | Norm dist | Conf | Decomp |
|--|-----------|------|--------|
| v1 H0 (no rep) | 0.33 | 0.67 | — |
| v1 H1 (best cand) | 0.06 | 0.94 | [w0-w3, w2-w3] |
| **v2 wraparound** | **0.078** | **0.92** | **[w0-w3, w2-w3]** |

v2 finds the same correct decomposition. norm_dist excludes wrap penalty (phoneme quality only), so the threshold semantics of `MAX_EDIT_DISTANCE` remain identical to v1. v2 is more conservative than v1 H1: wraps are only taken when the phoneme evidence strongly justifies them.

### Why the DP does not wrap on a normal segment

For a non-repeated segment where P ≈ R length (e.g., P = 33 phonemes, R = 31 phonemes, 2 phonemes of noise):

```
No-wrap cost:  2 × 0.8 = 1.6   (2 deletions for noise)
Wrap cost:     WRAP_PENALTY + cost of aligning P tail against rewound R
               The tail phonemes (noise/next verse) don't match any R sub-range well
               → wrap cost >> 1.6
```

The wrap is never taken. No false positive. No pre-filter needed.

---

## Technical Details and Algorithm

### DP State

```
dp[i][j][k] = minimum cost to:
  - consume P[0:i]
  - with the R-pointer currently at position j
  - having performed k wraps so far
```

- `i` ∈ [0, |P|]
- `j` ∈ [0, |R|]
- `k` ∈ [0, MAX_WRAPS]

Alongside the cost array, two auxiliary rolling arrays track per-path metadata:
- `start[i][j][k]` — the original j position where this path began (same as v1's `prev_start`)
- `max_j[i][j][k]` — the furthest-right R position ever reached on this path (needed for correct `ref_len` normalization; within a k-layer j is monotonic, but after wraps j resets leftward)

### Recurrence

```python
# Standard transitions (same as v1):
dp[i][j][k] = min(
    dp[i-1][j-1][k] + sub_cost(P[i-1], R[j-1]),   # match/substitute
    dp[i-1][j  ][k] + COST_DELETION,                # delete P phoneme
    dp[i  ][j-1][k] + COST_INSERTION,               # insert R phoneme
)

# Wrap transition — only at word boundaries, only from column > j:
# "We completed a pass up to position j_end (a word boundary),
#  paid WRAP_PENALTY, and jumped back to j (an earlier word boundary)"
for j_end in word_boundaries where j_end > j:
    dp[i][j][k] = min(dp[i][j][k],
                      dp[i][j_end][k-1] + WRAP_PENALTY)
```

### Boundary conditions

- **Start**: same as v1 — `dp[0][j][0] = 0` if `j` is a word-start boundary, else `∞`. Free start at any word boundary.
- **End**: same as v1 — evaluate only at word-end boundaries.
- **Wrap target**: any word boundary `j` in R, with `j < j_end`. In practice, constrained to word-start positions since we want to restart at a clean word.

### Python implementation (pure Python, no Cython yet)

```python
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
    max_wraps: int = MAX_WRAPS,
) -> Tuple[Optional[int], Optional[int], float, float, int, List[int]]:
    """
    Wraparound DP: aligns P against R with optional looping at word boundaries.

    Returns:
        (best_j_end, best_j_start, best_cost, best_norm_dist, n_wraps, wrap_positions)
        wrap_positions: list of R positions (word indices) where wraps occurred
    """
    m, n = len(P), len(R)
    INF = float('inf')

    if m == 0 or n == 0:
        return None, None, INF, INF, 0, []

    # Precompute word boundary sets (same as v1)
    word_starts = set()
    word_ends = set()
    for j in range(n + 1):
        if j == 0 or (j < n and R_phone_to_word[j] != R_phone_to_word[j - 1]):
            word_starts.add(j)
        if j == n or (j > 0 and j < n and R_phone_to_word[j] != R_phone_to_word[j - 1]):
            word_ends.add(j)

    # dp[k][j] = min cost with k wraps used, R-pointer at j, after consuming P[0:i]
    # We iterate over i (P rows), keeping only current and previous rows.
    # Shape: (max_wraps+1) × (n+1)
    INF_ROW = [INF] * (n + 1)

    # prev[k][j], curr[k][j]
    prev = [[INF] * (n + 1) for _ in range(max_wraps + 1)]
    curr = [[INF] * (n + 1) for _ in range(max_wraps + 1)]

    # Track start positions (original alignment start, propagated through wraps)
    prev_start = [[-1] * (n + 1) for _ in range(max_wraps + 1)]
    curr_start = [[-1] * (n + 1) for _ in range(max_wraps + 1)]

    # Track furthest-right R position reached on each path (for correct ref_len
    # normalization — within a single k-layer j is monotonic, but after a wrap
    # j resets to j_start which is left of the pre-wrap maximum)
    prev_max_j = [[-1] * (n + 1) for _ in range(max_wraps + 1)]
    curr_max_j = [[-1] * (n + 1) for _ in range(max_wraps + 1)]

    # Initialize row 0: free starts at word boundaries, k=0 only
    for j in word_starts:
        prev[0][j] = 0.0
        prev_start[0][j] = j
        prev_max_j[0][j] = j

    # Fill DP row by row (i = P phoneme index)
    for i in range(1, m + 1):
        # Reset curr
        for k in range(max_wraps + 1):
            for j in range(n + 1):
                curr[k][j] = INF
                curr_start[k][j] = -1
                curr_max_j[k][j] = -1

        for k in range(max_wraps + 1):
            # --- Standard transitions ---
            # Column 0: deletion only — ONLY for k=0.
            # k>0 states at j=0 must be reached via wrap transitions; giving them
            # the free deletion-fill base case creates phantom paths that never paid
            # a wrap penalty.
            if k == 0 and 0 in word_starts:
                curr[k][0] = i * cost_del
                curr_start[k][0] = 0
                curr_max_j[k][0] = 0

            for j in range(1, n + 1):
                del_opt = prev[k][j]   + cost_del   if prev[k][j]   < INF else INF
                ins_opt = curr[k][j-1] + cost_ins   if curr[k][j-1] < INF else INF
                sub_opt = prev[k][j-1] + get_sub_cost(P[i-1], R[j-1], cost_sub) \
                          if prev[k][j-1] < INF else INF

                best = min(del_opt, ins_opt, sub_opt)
                if best < INF:
                    curr[k][j] = best
                    if best == sub_opt:
                        curr_start[k][j] = prev_start[k][j-1]
                        curr_max_j[k][j] = max(prev_max_j[k][j-1], j)
                    elif best == del_opt:
                        curr_start[k][j] = prev_start[k][j]
                        curr_max_j[k][j] = prev_max_j[k][j]
                    else:
                        curr_start[k][j] = curr_start[k][j-1]
                        curr_max_j[k][j] = max(curr_max_j[k][j-1], j)

        # --- Wrap transitions (applied after each full row) ---
        # For k wraps used at j_end (word boundary), can jump back to j_start < j_end
        # This populates k+1 wraps at j_start
        for k in range(max_wraps):
            for j_end in word_ends:
                if curr[k][j_end] >= INF:
                    continue
                cost_at_end = curr[k][j_end]
                for j_start in word_starts:
                    if j_start >= j_end:
                        continue
                    new_cost = cost_at_end + wrap_penalty
                    if new_cost < curr[k+1][j_start]:
                        curr[k+1][j_start] = new_cost
                        curr_start[k+1][j_start] = curr_start[k][j_end]
                        curr_max_j[k+1][j_start] = max(curr_max_j[k][j_end], j_end)

            # After wrap updates, re-propagate insertions from the new j_start values
            # (a wrap to j_start may enable cheaper paths through j_start+1..j_end-1)
            for j in range(1, n + 1):
                ins_opt = curr[k+1][j-1] + cost_ins if curr[k+1][j-1] < INF else INF
                if ins_opt < curr[k+1][j]:
                    curr[k+1][j] = ins_opt
                    curr_start[k+1][j] = curr_start[k+1][j-1]
                    curr_max_j[k+1][j] = max(curr_max_j[k+1][j-1], j)

        prev, curr = curr, prev
        prev_start, curr_start = curr_start, prev_start
        prev_max_j, curr_max_j = curr_max_j, prev_max_j

    # --- Find best end position across all k ---
    best_score = INF
    best_j = None
    best_j_start = None
    best_cost = INF
    best_norm_dist = INF
    best_k = 0

    for k in range(max_wraps + 1):
        for j in range(1, n + 1):
            if j not in word_ends:
                continue
            if prev[k][j] >= INF:
                continue

            dist = prev[k][j]
            j_start = prev_start[k][j]
            if j_start < 0:
                continue

            # ref_len = unique R span: furthest-right position ever reached minus start.
            # For k=0 this equals j - j_start (monotonic). For k>0, the path may
            # have reached past j before wrapping back, so we use max_j.
            max_j_reached = prev_max_j[k][j]
            ref_len = max(max_j_reached, j) - j_start
            if ref_len <= 0:
                continue  # Backward wrap — final R position before start; skip
            denom = max(m, ref_len, 1)
            # Exclude wrap penalties from norm_dist so that MAX_EDIT_DISTANCE
            # retains the same phoneme-quality semantics as v1.
            phoneme_cost = dist - k * wrap_penalty
            norm_dist = phoneme_cost / denom

            # Position prior (same as v1)
            start_word = R_phone_to_word[j_start] if j_start < n else R_phone_to_word[j - 1]
            prior = prior_weight * abs(start_word - expected_word)
            score = norm_dist + prior

            if score < best_score:
                best_score = score
                best_j = j
                best_j_start = j_start
                best_cost = dist
                best_norm_dist = norm_dist
                best_k = k

    # NOTE: wrap_positions traceback is NOT yet implemented — returns [].
    # See §Traceback Design below for the concrete approach.
    # Until implemented, n_wraps > 0 is usable as a boolean "has repetition"
    # flag and ref_len gives the unique span, but repetition_ranges cannot
    # be populated.
    return best_j, best_j_start, best_cost, best_norm_dist, best_k, []
```

### Wrap transition propagation note

After applying wrap transitions for row `i`, the DP must re-propagate **insertion** transitions from the new `j_start` positions within the same row. This is because a wrap to `j_start` may open cheaper paths through `j_start+1 .. j_end-1` via insertions, which were computed before the wrap update. A single left-to-right sweep through `j_start..j_end` after each wrap set is sufficient (wraps only go backward in R, so no circular dependency).

Only insertions need re-sweeping within the same row. Substitutions and deletions from the wrap position use `prev[k+1][j]` (previous i-row), which naturally propagates in the next iteration — no re-sweep needed for those operations.

### Traceback design (deferred — required for `repetition_ranges`)

The rolling-row DP retains only the final row, so it can report *how many* wraps occurred (`best_k`) but not *where* they occurred. Recovering `wrap_positions` — the ordered list of `(i, j_end, j_start)` triples — requires a parent-pointer structure that records which transition produced each cell's value.

**Approach: Cython-side flat parent array.**

Allocate a flat `int` array of size `(m+1) × (n+1) × (K+1)`, indexed as `parent[i * (n+1) * (K+1) + j * (K+1) + k]`. Each entry stores an encoded parent: the `(i', j', k')` triple packed into a single int (e.g., `i' * stride_j * stride_k + j' * stride_k + k'`), plus a tag bit distinguishing standard transitions from wraps.

**Memory:** For the extreme case (m=600, n=300, K=5): `601 × 301 × 6 × 4 bytes = ~4.3 MB`. Acceptable for Cython. For Python fallback, the same structure using a flat `array.array('i')` avoids per-element Python object overhead.

**Traceback:** After identifying `(best_j, best_k)`, walk backward through the parent array from `(m, best_j, best_k)`. Each time the tag indicates a wrap transition (`k` decreases by 1), record `(i, j_end, j_start)`. The walk terminates at row 0.

**Output:** `wrap_positions` becomes a list of `(j_end, j_start)` pairs in P-order (the i values give ordering). From these, `repetition_ranges` is computed:

```python
# Each pass through R is a contiguous segment between wraps.
# Pass 0: j_start_original → wrap_0.j_end
# Pass 1: wrap_0.j_start → wrap_1.j_end  (or final j if last pass)
# Convert j positions to word indices via R_phone_to_word.
```

**Integration with K=0 short-circuit:** When the short-circuit fires (k=0, no wraps), `wrap_positions = []` and `repetition_ranges = []` — no traceback needed. The parent array is only allocated when `align_wraparound` is actually called (the slow path).

### Cython implementation (`_dp_core.pyx`)

Added to `_dp_core.pyx` alongside the existing `cy_align_with_word_boundaries`. Uses the same phoneme encoding infrastructure, substitution matrix, and `_grow_matrix()` mechanism. Key differences from the Python version:

- Flat C arrays instead of Python lists-of-lists: `prev_c[k * stride + j]`
- Pre-computed compact boundary position arrays (`ws_pos`, `we_pos`) for the wrap transition loops, avoiding set iteration
- `nogil` inner loops where possible for C-speed execution

```cython
def cy_align_wraparound(
    list P_list,
    list R_list,
    list R_phone_to_word_list,
    int expected_word,
    double prior_weight,
    double cost_sub,
    double cost_del,
    double cost_ins,
    double wrap_penalty,
    int max_wraps,
):
    """Wraparound word-boundary-constrained substring alignment (Cython).

    Identical semantics to pure-Python align_wraparound().
    Returns (best_j, best_j_start, best_cost, best_norm_dist, best_k, []).
    """
    cdef int m = len(P_list)
    cdef int n = len(R_list)
    cdef int K = max_wraps
    cdef double INF_VAL = INFINITY

    if m == 0 or n == 0:
        return (None, None, float('inf'), float('inf'), 0, [])

    # ------------------------------------------------------------------
    # Encode string lists → C arrays (reuses module-level _phoneme_to_id)
    # ------------------------------------------------------------------
    cdef int *P_ids = <int *>malloc(m * sizeof(int))
    cdef int *R_ids = <int *>malloc(n * sizeof(int))
    cdef int *R_w   = <int *>malloc(n * sizeof(int))
    if P_ids == NULL or R_ids == NULL or R_w == NULL:
        if P_ids != NULL: free(P_ids)
        if R_ids != NULL: free(R_ids)
        if R_w   != NULL: free(R_w)
        raise MemoryError()

    cdef int i, j, k, idx
    cdef bint need_rebuild = False

    for i in range(m):
        p = P_list[i]
        if p not in _phoneme_to_id:
            _encode_phoneme(p)
            need_rebuild = True
        P_ids[i] = _phoneme_to_id[p]

    for j in range(n):
        r = R_list[j]
        if r not in _phoneme_to_id:
            _encode_phoneme(r)
            need_rebuild = True
        R_ids[j] = _phoneme_to_id[r]
        R_w[j] = <int>R_phone_to_word_list[j]

    if need_rebuild and _sub_matrix != NULL:
        _grow_matrix()

    cdef int mat_size = _num_phonemes

    # ------------------------------------------------------------------
    # Precompute boundary flags (same as cy_align_with_word_boundaries)
    # ------------------------------------------------------------------
    cdef char *start_bd = <char *>malloc((n + 1) * sizeof(char))
    cdef char *end_bd   = <char *>malloc((n + 1) * sizeof(char))
    if start_bd == NULL or end_bd == NULL:
        free(P_ids); free(R_ids); free(R_w)
        if start_bd != NULL: free(start_bd)
        if end_bd   != NULL: free(end_bd)
        raise MemoryError()

    start_bd[0] = 1
    for j in range(1, n):
        start_bd[j] = 1 if R_w[j] != R_w[j - 1] else 0
    start_bd[n] = 0

    end_bd[0] = 0
    for j in range(1, n):
        end_bd[j] = 1 if R_w[j] != R_w[j - 1] else 0
    end_bd[n] = 1

    # ------------------------------------------------------------------
    # Build compact sorted arrays of boundary positions for wrap loops
    # ------------------------------------------------------------------
    cdef int n_ws = 0, n_we = 0
    for j in range(n + 1):
        if start_bd[j]: n_ws += 1
        if end_bd[j]:   n_we += 1

    cdef int *ws_pos = <int *>malloc(n_ws * sizeof(int))
    cdef int *we_pos = <int *>malloc(n_we * sizeof(int))
    if ws_pos == NULL or we_pos == NULL:
        free(P_ids); free(R_ids); free(R_w)
        free(start_bd); free(end_bd)
        if ws_pos != NULL: free(ws_pos)
        if we_pos != NULL: free(we_pos)
        raise MemoryError()

    cdef int ws_i = 0, we_i = 0
    for j in range(n + 1):
        if start_bd[j]:
            ws_pos[ws_i] = j; ws_i += 1
        if end_bd[j]:
            we_pos[we_i] = j; we_i += 1

    # ------------------------------------------------------------------
    # Allocate 3D rolling arrays: flat layout [k * stride + j]
    # ------------------------------------------------------------------
    cdef int stride = n + 1
    cdef int total = (K + 1) * stride

    cdef double *prev_c = <double *>malloc(total * sizeof(double))
    cdef double *curr_c = <double *>malloc(total * sizeof(double))
    cdef int    *prev_s = <int *>malloc(total * sizeof(int))
    cdef int    *curr_s = <int *>malloc(total * sizeof(int))
    cdef int    *prev_mj = <int *>malloc(total * sizeof(int))   # max_j tracking
    cdef int    *curr_mj = <int *>malloc(total * sizeof(int))
    if (prev_c == NULL or curr_c == NULL or prev_s == NULL or curr_s == NULL
            or prev_mj == NULL or curr_mj == NULL):
        free(P_ids); free(R_ids); free(R_w)
        free(start_bd); free(end_bd); free(ws_pos); free(we_pos)
        if prev_c  != NULL: free(prev_c)
        if curr_c  != NULL: free(curr_c)
        if prev_s  != NULL: free(prev_s)
        if curr_s  != NULL: free(curr_s)
        if prev_mj != NULL: free(prev_mj)
        if curr_mj != NULL: free(curr_mj)
        raise MemoryError()

    # Initialize all to INF / -1
    for idx in range(total):
        prev_c[idx] = INF_VAL
        prev_s[idx] = -1
        prev_mj[idx] = -1

    # k=0 free starts at word boundaries
    for j in range(n + 1):
        if start_bd[j]:
            prev_c[j] = 0.0       # k=0 offset = 0 * stride + j = j
            prev_s[j] = j
            prev_mj[j] = j

    # ------------------------------------------------------------------
    # Core DP loop
    # ------------------------------------------------------------------
    cdef double del_opt, ins_opt, sub_opt, sc, new_cost, cost_at_end
    cdef int koff, koff_src, koff_dst, j_end, j_sw, mj_val
    cdef double *tmp_d
    cdef int    *tmp_i

    for i in range(1, m + 1):
        # Reset curr
        for idx in range(total):
            curr_c[idx] = INF_VAL
            curr_s[idx] = -1
            curr_mj[idx] = -1

        # --- Standard transitions for each k ---
        for k in range(K + 1):
            koff = k * stride

            # Column 0: deletion base case, k=0 only
            if k == 0 and start_bd[0]:
                curr_c[koff] = i * cost_del
                curr_s[koff] = 0
                curr_mj[koff] = 0

            for j in range(1, n + 1):
                del_opt = prev_c[koff + j] + cost_del \
                          if prev_c[koff + j] < INF_VAL else INF_VAL
                ins_opt = curr_c[koff + j - 1] + cost_ins \
                          if curr_c[koff + j - 1] < INF_VAL else INF_VAL
                sc = _get_sub_cost(P_ids[i - 1], R_ids[j - 1], mat_size)
                sub_opt = prev_c[koff + j - 1] + sc \
                          if prev_c[koff + j - 1] < INF_VAL else INF_VAL

                if sub_opt <= del_opt and sub_opt <= ins_opt:
                    curr_c[koff + j] = sub_opt
                    curr_s[koff + j] = prev_s[koff + j - 1]
                    mj_val = prev_mj[koff + j - 1]
                    curr_mj[koff + j] = j if j > mj_val else mj_val
                elif del_opt <= ins_opt:
                    curr_c[koff + j] = del_opt
                    curr_s[koff + j] = prev_s[koff + j]
                    curr_mj[koff + j] = prev_mj[koff + j]
                else:
                    curr_c[koff + j] = ins_opt
                    curr_s[koff + j] = curr_s[koff + j - 1]
                    mj_val = curr_mj[koff + j - 1]
                    curr_mj[koff + j] = j if j > mj_val else mj_val

        # --- Wrap transitions ---
        for k in range(K):
            koff_src = k * stride
            koff_dst = (k + 1) * stride

            for we_i in range(n_we):
                j_end = we_pos[we_i]
                if curr_c[koff_src + j_end] >= INF_VAL:
                    continue
                cost_at_end = curr_c[koff_src + j_end]

                for ws_i in range(n_ws):
                    j_sw = ws_pos[ws_i]
                    if j_sw >= j_end:
                        continue
                    new_cost = cost_at_end + wrap_penalty
                    if new_cost < curr_c[koff_dst + j_sw]:
                        curr_c[koff_dst + j_sw] = new_cost
                        curr_s[koff_dst + j_sw] = curr_s[koff_src + j_end]
                        mj_val = curr_mj[koff_src + j_end]
                        curr_mj[koff_dst + j_sw] = j_end if j_end > mj_val else mj_val

            # Insertion re-sweep from wrap positions
            for j in range(1, n + 1):
                ins_opt = curr_c[koff_dst + j - 1] + cost_ins
                if ins_opt < curr_c[koff_dst + j]:
                    curr_c[koff_dst + j] = ins_opt
                    curr_s[koff_dst + j] = curr_s[koff_dst + j - 1]
                    mj_val = curr_mj[koff_dst + j - 1]
                    curr_mj[koff_dst + j] = j if j > mj_val else mj_val

        # Swap rows
        tmp_d = prev_c; prev_c = curr_c; curr_c = tmp_d
        tmp_i = prev_s; prev_s = curr_s; curr_s = tmp_i
        tmp_i = prev_mj; prev_mj = curr_mj; curr_mj = tmp_i

    # ------------------------------------------------------------------
    # Best-match selection (end boundaries only, across all k)
    # ------------------------------------------------------------------
    cdef double best_score = INF_VAL
    cdef int best_j = -1
    cdef int best_j_start = -1
    cdef double best_cost_val = INF_VAL
    cdef double best_norm = INF_VAL
    cdef int best_k_val = 0

    cdef double dist, norm_dist, prior, score, phoneme_cost
    cdef int j_start_val, ref_len, denom, start_word, max_j_val

    for k in range(K + 1):
        koff = k * stride
        for j in range(1, n + 1):
            if not end_bd[j]:
                continue
            if prev_c[koff + j] >= INF_VAL:
                continue

            dist = prev_c[koff + j]
            j_start_val = prev_s[koff + j]
            if j_start_val < 0:
                continue

            # Unique span: furthest-right R position ever reached minus start
            max_j_val = prev_mj[koff + j]
            ref_len = (max_j_val if max_j_val > j else j) - j_start_val
            if ref_len <= 0:
                continue  # Backward wrap — skip
            denom = m if m > ref_len else ref_len
            if denom < 1:
                denom = 1

            phoneme_cost = dist - k * wrap_penalty
            norm_dist = phoneme_cost / denom

            if j_start_val < n:
                start_word = R_w[j_start_val]
            else:
                start_word = R_w[j - 1]

            prior = prior_weight * fabs(<double>(start_word - expected_word))
            score = norm_dist + prior

            if score < best_score:
                best_score = score
                best_j = j
                best_j_start = j_start_val
                best_cost_val = dist
                best_norm = norm_dist
                best_k_val = k

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    free(P_ids); free(R_ids); free(R_w)
    free(start_bd); free(end_bd)
    free(ws_pos); free(we_pos)
    free(prev_c); free(curr_c)
    free(prev_s); free(curr_s)
    free(prev_mj); free(curr_mj)

    if best_j < 0:
        return (None, None, float('inf'), float('inf'), 0, [])

    return (best_j, best_j_start, best_cost_val, best_norm, best_k_val, [])
```

**Dispatch in `phoneme_matcher.py`:** The module-level import block gains:

```python
try:
    from ._dp_core import cy_align_with_word_boundaries, cy_align_wraparound, init_substitution_matrix
    init_substitution_matrix(_SUBSTITUTION_COSTS, COST_SUBSTITUTION)
    _USE_CYTHON_DP = True
except ImportError:
    _USE_CYTHON_DP = False
```

And `align_wraparound()` dispatches at the top:

```python
def align_wraparound(P, R, R_phone_to_word, ...):
    if _USE_CYTHON_DP:
        return cy_align_wraparound(
            P, R, R_phone_to_word,
            expected_word, prior_weight,
            cost_sub, cost_del, cost_ins,
            wrap_penalty, max_wraps,
        )
    # ... pure Python fallback below ...
```

---

## Relationship to Current Implementation (`phoneme_matcher.py`)

### What changes

| Component | Current (production) | v2 |
|-----------|---------------------|-----|
| Core function | `align_with_word_boundaries()` — 2D rolling DP | new `align_wraparound()` — 3D DP |
| DP state | 2 rolling arrays of length `\|R\|+1` | 3×2×(K+1) arrays of length `\|R\|+1` (cost, start, max_j) |
| Return signature | `(best_j, best_j_start, cost, norm_dist)` | `+ (n_wraps, wrap_positions)` |
| Under-segmentation | Undetected — extra phonemes silently absorbed as deletions, confidence 0.67–0.88 with wrong boundaries | Detected — wrap transitions find the correct decomposition |
| `check_repetition()` | Does not exist | Not needed — detection is in the DP itself |
| Pre-filter | Does not exist | Not needed — wrap penalty acts as continuous gate |
| Cython acceleration | `cy_align_with_word_boundaries` in `_dp_core.pyx` | new `cy_align_wraparound` in `_dp_core.pyx` — same dispatch pattern |
| Call site in `align_segment()` | One call to `align_with_word_boundaries` | One call to `align_wraparound` |

### What stays the same

- `align_with_word_boundaries()` and `cy_align_with_word_boundaries` are kept untouched — v2 is additive. Any caller still using the old function gets the same Cython dispatch.
- `is_start_boundary()` / `is_end_boundary()` logic — identical semantics, reused in `align_wraparound`
- `get_sub_cost()`, `phoneme_sub_costs.json`, and the Cython substitution matrix — unchanged, shared by both functions

### Integration touch-points

v2 adds repetition metadata that must flow through the pipeline. Required before deployment:

1. **`AlignmentResult` dataclass** (`phoneme_matcher.py`) — add `n_wraps: int = 0` and `wrap_positions: List[Tuple[int, int]] = field(default_factory=list)`. The return 6-tuple from `align_wraparound` maps directly. Note: `edit_cost` intentionally includes wrap penalties (it is the raw DP cost), while `confidence = 1.0 - norm_dist` excludes them (it reflects phoneme alignment quality only). This is consistent with v1 semantics — `edit_cost` is the DP output, `confidence` is the normalized quality metric. Downstream code should use `confidence` for quality gating and `n_wraps` separately for repetition detection.

2. **`SegmentInfo` dataclass** (`segment_types.py`) — currently has no repetition fields. Add `has_repetition: bool = False` and `repetition_ranges: List[List[int]] = field(default_factory=list)`. Without this, repetition data cannot leave `align_segment()`.

3. **`run_phoneme_matching`** (`alignment_pipeline.py`) — the existing result 3-tuple `(matched_text, score, matched_ref)` **stays unchanged in format**. Repetition metadata flows out via a **parallel list**, following the same pattern as the existing `word_indices` parallel list.

   **Concrete mechanism:** Add a `repetition_info` list, parallel to `results`, where each entry is either `None` (specials, failures, no repetition) or a dict:

   ```python
   repetition_info.append({
       "n_wraps": alignment.n_wraps,
       "wrap_positions": alignment.wrap_positions,  # [] until traceback implemented
   })
   ```

   Extend the return signature from `(results, profiling, gap_segments, merged_into)` to:

   ```python
   return results, profiling, gap_segments, merged_into, repetition_info
   ```

   **All callers must be updated** — `pipeline.py` unpacks this return value. Until callers are updated, `repetition_info` can be returned as a separate variable and ignored (backward-compatible if callers use `results, profiling, gap_segments, merged_into = run_phoneme_matching(...)`  without `*` — Python will raise `ValueError` on the extra element). The safer migration: update the caller at the same time to unpack 5 values.

   Downstream, `pipeline.py` maps `repetition_info` entries onto `SegmentInfo` fields when building the segment list.

4. **Output JSON** (`extract_segments.py`) — `segments.json` and `detailed.json` gain additive fields per segment. Existing readers are unaffected by extra keys.

   **New fields per segment:**
   ```json
   {
     "has_repetition": true,
     "n_wraps": 1,
     "repetition_ranges": [[0, 3], [2, 3]]
   }
   ```
   `repetition_ranges` is a list of `[word_from_idx, word_to_idx]` pairs — one per pass through R. The first element is the full range; subsequent elements are the repeated sub-ranges. Empty when `n_wraps == 0`.

5. **No frontend changes** in this iteration — Inspector, validators, and HF Space UI consume the existing fields unchanged. Repetition-aware rendering is deferred.

### Call site change in `align_segment()`

```python
# Current production (phoneme_matcher.py, align_segment())
best_j, best_j_start, best_cost, best_norm_dist = align_with_word_boundaries(
    P, R, R_phone_to_word, expected_word=ptr, prior_weight=prior_weight, ...
)
# Under-segmentation: silently missed, manifests as low confidence

# v2 — same call site, different function
best_j, best_j_start, best_cost, best_norm_dist, n_wraps, wrap_positions = align_wraparound(
    P, R, R_phone_to_word, expected_word=ptr, prior_weight=prior_weight,
    wrap_penalty=WRAP_PENALTY, max_wraps=MAX_WRAPS, ...
)
# Under-segmentation: detected when n_wraps > 0; wrap_positions gives decomposition
```

---

## Time Complexity: Before vs After

The baseline is the **current production implementation** of `align_with_word_boundaries()` in `phoneme_matcher.py`. This is a rolling two-row 2D DP — `prev_cost`/`curr_cost` each of length `|R|+1`. There is no repetition detection in the current code at all.

Let:
- `|P|` = ASR phoneme count (~50–300)
- `|R|` = reference window phonemes = `(LOOKBACK + LOOKAHEAD) × avg_phones_per_word` (~200–400)
- `K` = MAX_WRAPS (e.g. 5)
- `W` = word boundaries in R (~20–40)

### Current implementation

```python
# phoneme_matcher.py — align_with_word_boundaries()
# Two rolling arrays of length |R|+1, iterated |P| times
# Memory: O(|R|)    Time: O(|P| × |R|)
prev_cost = [...]   # length n+1
curr_cost = [...]   # length n+1
for i in range(1, m + 1):          # |P| iterations
    for j in range(1, n + 1):      # |R| iterations
        curr_cost[j] = min(del, ins, sub)
    prev_cost, curr_cost = curr_cost, prev_cost
# Returns: (best_j, best_j_start, best_cost, best_norm_dist)
# Under-segmentation: undetected — absorbed as high deletion cost
```

### v2 wraparound DP

```python
# align_wraparound()
# 3D state: (|P|+1) × (|R|+1) × (K+1), with 3 rolling array pairs (cost, start, max_j)
# At each of |P| rows, one forward sweep + one wrap propagation sweep
# Memory: O(|R| × K)    Time: O(|P| × |R| × K) + O(|P| × W² × K) wrap sweep
```

### Comparison table

| | Current (production) | v2 (wraparound) |
|--|----------------------|-----------------|
| **Memory** | O(\|R\|) — 2 arrays | O(\|R\| × K) — 3×2×(K+1) arrays (cost, start, max_j) |
| **Time** | O(\|P\| × \|R\|) | O(\|P\| × \|R\| × K) |
| **Wrap sweep** | — | O(\|P\| × W² × K) |
| **Repetition detection** | None — missed entirely | Built-in |
| **Return values** | 4-tuple | 6-tuple (+n_wraps, wrap_positions) |

For typical values (`|P|`=100, `|R|`=300, K=5, W=30):

| | Current | v2 |
|--|---------|-----|
| DP ops (`|P|×|R|×K`) | ~30k | ~150k |
| Wrap sweep ops (`|P|×W²×K`) | — | ~450k  ← 100×900×5 |
| Insertion re-sweep (`|P|×|R|×K`) | — | ~150k  ← 100×300×5 |
| **Total** | **~30k** | **~750k** |
| Relative cost | 1× | **~25×** |

v2 is ~25× the algorithmic cost of the current DP per segment. The wrap sweep (`|P|×W²×K`) dominates over the DP itself. The `cy_align_wraparound` Cython implementation (see §Cython implementation above) recovers the same 10-20× speedup as the existing `cy_align_with_word_boundaries`, keeping the wall-clock overhead manageable (~2-3× the current Cython time per segment, not 25×).

The K=0 short-circuit (see Future Extensions) would further recover near-current speed for the ~98% of segments with no repetition by dispatching to the existing `cy_align_with_word_boundaries` when k=0 gives a confident match, and only falling through to `cy_align_wraparound` for ambiguous segments.

---

## Existing Config Parameters: What Changes

### Unchanged — same meaning, same values

| Parameter | v1 meaning | v2 meaning |
|-----------|-----------|-----------|
| `LOOKBACK_WORDS` (30) | Search window left extent | Same — defines R window |
| `LOOKAHEAD_WORDS` (10) | Search window right extent | Same |
| `RETRY_LOOKBACK_WORDS` (70) | Expanded window for retries | Same |
| `RETRY_LOOKAHEAD_WORDS` (40) | Expanded window for retries | Same |
| `MAX_EDIT_DISTANCE` (0.25) | Quality floor for valid match | Same — v2 `norm_dist` excludes wrap penalty (phoneme cost only), threshold applies unchanged |
| `MAX_EDIT_DISTANCE_RELAXED` (0.45) | Retry tier 2 threshold | Same |
| `COST_SUBSTITUTION` (1.0) | Phoneme sub cost | Same |
| `COST_DELETION` (0.8) | Delete P phoneme | Same |
| `COST_INSERTION` (1.0) | Insert R phoneme | Same |
| `START_PRIOR_WEIGHT` (0.005) | Penalty per word from expected | Same — applies to the overall match start |

### Not needed (v1 plan params, never implemented)

These parameters were planned for the v1 repetition pipeline but were **never added to `config.py`**. They are not present in the current codebase and are not needed in v2 either:

| Parameter | Why not needed |
|-----------|---------------|
| `REPETITION_MIN_EXCESS_PHONES` (8) | The v1 pre-filter gate; v2 uses wrap penalty as a continuous gate instead |
| `REPETITION_MAX_NORM_DIST` (0.25) | Subsumed by `MAX_EDIT_DISTANCE` — the existing threshold applies directly to v2's norm_dist |

### New

| Parameter | Suggested default | Role |
|-----------|------------------|------|
| `WRAP_PENALTY` | `2.0` | Cost of one wrap transition. In the same unit as the edit costs. Must be > typical deletion cost of a few phonemes (so noise doesn't trigger wraps) but < cost of absorbing one word as deletions (~4–5 × 0.8 = 3.2–4.0 for a 4-5 phoneme word). Starting range: 1.5–3.0. |
| `MAX_WRAPS` | `5` | Upper bound on wraps per segment. Data shows max 5 in practice (4:23 with minshawy_murattal). Caps the 3rd DP dimension. |

### `START_PRIOR_WEIGHT` — nuance

In v1, the prior penalizes being far from the `expected_word` at the **start** of the match. In v2, this still applies to the overall start (first word of the first pass). However, the prior does not apply to the wrap-back positions — those are determined by the phoneme evidence, not the sequential position expectation. This is the correct behavior: we expect the match to start near `expected_word`, but where the reciter wraps to is entirely data-driven.

### `align_config.py` overlay

The batch pipeline (`extract_segments.py`) imports `config.py` then overlays `align_config.py` attributes for tighter alignment windows. Any new parameters (`WRAP_PENALTY`, `MAX_WRAPS`) must also be set in `align_config.py` if batch-mode behavior should differ from the interactive Gradio app. If omitted, `align_config.py` inherits the `config.py` defaults.

---

## What is Unaffected

- **Special segment detection** (`special_segments.py`) — Basmala, Isti'adha, transition markers, Tahmeed — all run before `align_segment()` and are unchanged
- **N-gram anchor voting** (`phoneme_anchor.py`) — determines chapter/verse anchor; runs upstream and passes `expected_word` to the aligner unchanged
- **Retry tiers and re-anchoring** (`alignment_pipeline.py`) — if `norm_dist > MAX_EDIT_DISTANCE`, retry logic fires the same way. v2's `norm_dist` is comparable to v1's (same formula, `phoneme_cost / max(|P|, ref_len)`); for k=0 paths it is identical, for wrapped paths `ref_len` is the unique span which is slightly more conservative (see Risk §4)
- **Output schema** — `segments.json` and `detailed.json` gain additive repetition fields; existing readers unaffected
- **Inspector / validators** — consume existing fields unchanged; repetition-aware rendering deferred
- **Existing Cython DP** (`_dp_core.pyx`) — `cy_align_with_word_boundaries` is untouched. v2 adds `cy_align_wraparound` as a new function in the same module; `align_wraparound()` dispatches to it when Cython is compiled (same pattern as the existing function)

---

## Potential Risks and Edge Cases

### 1. Wrap penalty tuning sensitivity

The `WRAP_PENALTY` is the only new knob but it's load-bearing. Too low → false positive wraps on normal segments with noisy ASR. Too high → misses genuine short repetitions (1-word repeats, which the data shows are common).

**Mitigation:** The 472 labeled repetition verses from Minshawy provide a direct test set. Tune `WRAP_PENALTY` by sweeping values and measuring precision/recall on this ground truth. The 1-word overlap cases (46 occurrences) are the hardest — they sit at the detection boundary.

### 2. Textual repetitions (Surah 55 refrain)

Surah 55 repeats `فَبِأَىِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ` 31 times. If the reciter reads a segment containing one verse followed by the next, both P and R are long and `|P| ≈ |R|`. The wrap should not fire.

However, if the reciter says verse N's refrain AND verse N+1's content in one segment, the R window may include adjacent verses. The DP might find a wrap from one refrain back to the previous refrain as slightly cheaper than a no-wrap path.

**Mitigation:** The position prior (`START_PRIOR_WEIGHT`) penalizes matching far from the expected position, which includes wrapping back across verse boundaries. Monitor false positive rate on Surah 55 specifically during testing.

### 3. Wrap propagation correctness

After a wrap transition in row `i`, the insertion propagation sweep (j_start → j_end) must be complete before processing row `i+1`. If a wrap opens a j_start position whose downstream insertions weren't re-swept, some optimal paths are missed (false negatives, not false positives — the DP is still correct, just suboptimal).

**Mitigation:** The single left-to-right re-sweep after each wrap batch is sufficient in practice (insertions don't cascade across word boundaries). Verify with the worked example: the final cost should match manual calculation.

### 4. `norm_dist` normalization and comparability

**Decision: exclude wrap penalty from `norm_dist`.**

`norm_dist = (total_cost - n_wraps × WRAP_PENALTY) / max(|P|, ref_len)`

This keeps `norm_dist` as a pure phoneme-quality measure. `n_wraps` and the raw `total_cost` are returned separately so callers can inspect them. `MAX_EDIT_DISTANCE = 0.25` applies without adjustment.

The alternative (include wrap penalty in norm_dist) would force a threshold change and make `norm_dist` harder to interpret as alignment quality. It is rejected.

**`ref_len` — unique span via `max_j` tracking.** The DP tracks `max_j` — the furthest-right R position ever reached on each path — via rolling arrays parallel to `prev_start`/`curr_start`. Within a single k-layer, R is monotonically increasing so `max_j = j`. But after a wrap from `j_end` back to `j_start`, the current `j` resets to `j_start` while the path previously reached `j_end`. Without tracking, `ref_len = j - j_start` would underestimate the unique span (it gives the gap between the original start and the *current* position, not the *furthest* position).

With `max_j` tracking: `ref_len = max(max_j, j) - j_start`, which correctly gives the unique R span (first position to furthest-right position). For example, if the path starts at j=0, reaches j=31, wraps to j=14, and ends at j=31, `ref_len = max(31, 31) - 0 = 31`. If instead it ends at j=20, `ref_len = max(31, 20) - 0 = 31` — still the correct unique span, not the misleading `20 - 0 = 20`.

For k=0 paths, `max_j = j` always, so `ref_len = j - j_start` — identical to v1. For k>0 paths, `ref_len` reflects the true unique span. This makes `denom = max(|P|, ref_len)` correct in both cases.

`norm_dist` is **not identical** to v1 for wrapped segments — it is only identical for k=0 paths. For wrapped paths, `ref_len` is the unique span (not the total consumed across passes), so `denom` does not double-count re-traversed phonemes. Threshold semantics are preserved (same direction, same scale).

**Confidence is algorithm-only.** `confidence = 1.0 - norm_dist` reflects phoneme alignment quality exclusively — wrap penalty is excluded. A segment with high phoneme quality and many wraps will have high confidence. Repetition metadata (`n_wraps`, `has_repetition`, `repetition_ranges`) is carried in separate schema fields. How to combine confidence and repetition state for downstream display (e.g., Inspector color badges) is a presentation-layer decision deferred to a later iteration.

### 5. Very long segments with many wraps

For k=5 (as in 4:23, 7 segments), if VAD missed all pauses and delivered the full 108-second verse as one segment, `|P|` could be 600+ phonemes and `|R|` 300+ phonemes. The 3D DP would be 600 × 300 × 6 ≈ 1.1M states — manageable in Python, but significantly slower than normal.

**Mitigation:** `MAX_WRAPS=5` caps this. For extreme cases, the retry tier's expanded window (`RETRY_LOOKBACK_WORDS=70`) provides a larger R, which helps the DP find the correct long-range match.

### 6. Wrap-to-self (degenerate wrap)

A wrap from j_end back to j_start where `j_start == 0` (start of R) is valid — it means the reciter repeated the entire verse from the beginning. This is a legitimate case and the DP handles it correctly.

### 7. Basmala prefix interaction

**Note — deferred to a later iteration.** When `alignment_pipeline.py` prepends Basmala phonemes (sentinel `word_index = -1`), they occupy the first positions of R. A wrap targeting those positions would be semantically wrong (the reciter isn't repeating the Basmala mid-verse). In practice this is a narrow edge case: the Basmala sentinel causes all its phonemes to share one word-index value (`-1`), so no internal word boundaries exist within the prefix — the only vulnerable wrap target is position 0 (start of Basmala). Since wrap targets must satisfy `j_start < j_end` and the DP penalty economics strongly disfavour wrapping to a prefix that doesn't match the repeated phonemes, false positives are unlikely. If observed, add `basmala_prefix_len` filtering to restrict wrap targets to `j >= basmala_prefix_len`.

### 8. Backward wraps (resolved — guarded in best-match selection)

A wrap can target any `j_start < j_end`, including positions **before** the k=0 start. If a reciter reads words 5–7 then backs up to words 2–4, the k=0 path starts at word 5 and the wrap goes to word 2. The final `best_j` could land before `best_j_start`, producing `ref_len = best_j - best_j_start < 0`. This inverts `start_word_idx > end_word_idx`, which would cause empty `get_matched_text()`, inverted `matched_ref` strings, and backward pointer updates in `alignment_pipeline.py`.

**Resolution:** The best-match selection loop now skips candidates where `ref_len <= 0`. If the only k>0 path is backward, the k=0 path (which cannot be backward by construction of the substring DP) is selected instead. The DP still computes all paths including backward wraps — they are simply never chosen as the result.

This guard is present in both the Python `align_wraparound()` and the Cython `cy_align_wraparound` best-match selection sections.

### 9. Retry tier cost amplification

The pipeline's retry tiers (`alignment_pipeline.py`) call `align_segment()` with expanded windows (`RETRY_LOOKBACK_WORDS=70`, `RETRY_LOOKAHEAD_WORDS=40`), yielding R ≈ 700 phonemes. With W ≈ 110 word boundaries, the wrap sweep becomes `|P| × W² × K ≈ |P| × 12,100 × K` per call. Combined with up to 3 calls per failed segment (initial + tier1 + tier2), retry segments take the full cost. This is acceptable — retry segments are rare (typically <5% of a recording) — but worth monitoring wall-clock time during testing. If retries dominate, consider reducing `MAX_WRAPS` to 2 for retry-tier calls.

### 10. Chained wraps within a single P row

The wrap loop iterates `k = 0, 1, ..., K-1` sequentially within each P row. After k=0→k=1 wraps populate the k=1 layer, k=1→k=2 wraps can immediately read those values — meaning multiple wraps fire without consuming any P phonemes between them. Semantically, this corresponds to the R pointer jumping back twice at the same P position. Each jump pays `WRAP_PENALTY`, so the DP economics make this path very expensive (2+ penalties for zero phoneme benefit). In practice it never wins, but it exists as a valid DP state. No mitigation needed — flagged for awareness.

---

## Future Extensions

### Accuracy improvements (if false negatives observed)

**Adaptive wrap penalty by segment length.** Shorter segments (fewer words) genuinely need a lower wrap penalty to detect small repeats. Longer segments can tolerate a higher penalty. `WRAP_PENALTY = base × (1 + len(R) / scale)` — or simply two separate thresholds for short/long.

**Cost profile pre-check (from literature review Tier 2).** Before running the full 3D DP, compute a per-window alignment cost profile of P against R. If the profile is uniformly low (no cost spike), skip the wrap dimension entirely (`max_wraps=0`). This restores v1 speed for the clear non-repetition majority while keeping full v2 power for suspicious segments.

**Colinear chaining to constrain wrap targets (Tier 1 §2).** Instead of allowing wraps to any word boundary, run a fast n-gram chain to find the most likely wrap target(s) first, then restrict the DP wrap transitions to those candidates. Reduces `W²` wrap combinations to a small constant. Uses existing `phoneme_anchor.py` infrastructure.

### Accuracy improvements (if false positives observed)

**Explicit split penalty scaling with k.** Currently `WRAP_PENALTY` is fixed per wrap. Could scale: `WRAP_PENALTY × (1 + 0.5 × k)` — second wrap costs more than first. Implements Occam's razor more aggressively, making k=3+ less likely to win over k=2 on ambiguous segments. **Note:** if implemented, the `phoneme_cost = dist - k * wrap_penalty` subtraction in the final selection must change to `dist - Σ WRAP_PENALTY × (1 + 0.5 × i)` — the current constant-penalty subtraction would give wrong phoneme costs.

**Textual repetition whitelist.** Pre-detect verses with known textual repetition (Surah 55, Surah 77's `وَيْلٌ يَوْمَئِذٍ لِّلْمُكَذِّبِينَ`, etc.) and disable wrap for those verses. Simple lookup against `surah_info.json`.

### Performance improvements

**K=0 short-circuit (essential, deferred).** ~98% of segments have no repetition. Running the full 3D DP for every segment is wasteful. The planned optimization: run k=0 only first (via existing Cython `cy_align_with_word_boundaries`); if `norm_dist < 0.04` (confidence ≥ 0.96), accept the k=0 result and skip higher-k computation entirely. Only segments that fail the k=0 threshold fall through to `cy_align_wraparound`. This recovers near-v1 speed for clean segments while preserving full v2 detection for ambiguous ones. The threshold (0.04/0.96) is a starting point — tune against labeled data. Implementation requires restructuring `align_segment()` to dispatch conditionally. Deferred to after initial v2 validation, but essential before production deployment on large batches. Note that the current algorithm already computes k=0 as its first step — the short-circuit is a restructuring to exit early, not a fundamentally different approach.

---

## Implementation Order

The following order avoids performance regressions and broken intermediate states:

1. **Add `WRAP_PENALTY` and `MAX_WRAPS` to `config.py`** (and `align_config.py` if batch-mode values differ).

2. **Write `cy_align_wraparound` in `_dp_core.pyx`** alongside the existing `cy_align_with_word_boundaries`. Update `setup.py` if needed. Verify compilation and matching semantics against the pure-Python version on the test dataset.

3. **Add `align_wraparound()` to `phoneme_matcher.py`** with Cython dispatch. At this point both functions exist; `align_segment()` still calls `align_with_word_boundaries()`. No behavior change.

4. **Add `n_wraps` and `wrap_positions` fields to `AlignmentResult`** (default 0 / empty). No behavior change — existing code ignores the new fields.

5. **Implement the K=0 short-circuit in `align_segment()`**: call `align_with_word_boundaries()` first (same Cython dispatch as today); if `norm_dist < SHORT_CIRCUIT_THRESHOLD` (starting point: 0.04, i.e. confidence >= 0.96), return immediately with k=0 result. Otherwise, fall through to `align_wraparound()`. This is the performance-critical gate — ~98% of segments exit at k=0 with zero overhead.

6. **Switch `align_segment()` call site** to use the short-circuit path from step 5. Deploy. Validate on labeled test set.

7. **Implement `wrap_positions` traceback** (requires full parent-pointer array or Cython-side traceback storage). Then wire `repetition_ranges` computation from `wrap_positions` through to output JSON.

**Do NOT skip step 2 or step 5.** Switching `align_segment()` to `align_wraparound()` without the Cython path and short-circuit would cause a ~25× performance regression (pure Python) or a production timeout on HF Space (`ZEROGPU_MAX_DURATION = 120s`).

---

## Testing

### Test dataset

The HF dataset [`hetchyy/quranic-universal-ayahs`](https://huggingface.co/datasets/hetchyy/quranic-universal-ayahs) (config `hafs_an_asim`) contains verse-level audio clips with segment-level alignment metadata for two reciters. The `segments` column encodes reading order — when consecutive segments have overlapping word ranges (`curr_from <= prev_to`, inclusive), the reciter repeated words. This gives us ground-truth decompositions to test against.

#### Repetition prevalence

| Reciter | Total verses | Verses with reps | % | Max reps/verse |
|---------|-------------|-------------------|---|----------------|
| Ali Jaber | 6,235 | 133 | 2.1% | 2 |
| Minshawy Murattal | 6,236 | 472 | 7.6% | 5 |

Minshawy's murattal style produces 3.6x more repetitions — consistent with slower recitation and more breathing pauses.

#### Repetitions per verse

| Reps | Ali Jaber | Minshawy |
|------|-----------|----------|
| 1 | 123 | 413 |
| 2 | 10 | 48 |
| 3 | — | 6 |
| 4 | — | 4 |
| 5 | — | 1 (4:23) |

k=2 covers ~90% of cases. k=3 is necessary (59 Minshawy verses have 2+ reps). k=4+ exists but is rare — 4:23 has 5 repetitions across 7 segments: `w1-w11 → w10-w17 → w15-w23 → w20-w33 → w29-w41 → w37-w49 → w50-w54`.

Note: these repetition counts are per-verse across segment boundaries. The detection algorithm operates on individual segments, so a verse with 2 reps across 3 segments means each segment boundary has at most 1 overlap. Higher-k cases arise when VAD fails to detect a pause and merges multiple segments.

#### Overlap width distribution

| Width (words) | Ali Jaber | Minshawy |
|---------------|-----------|----------|
| 1 | 8 | 46 |
| 2 | 18 | 109 |
| 3 | 26 | 125 |
| 4 | 24 | 78 |
| 5 | 24 | 78 |
| 6 | 14 | 53 |
| 7 | 12 | 25 |
| 8+ | 16 | 34 |

Peak at 2–5 words. The 1-word overlaps are borderline. Most overlaps are <50% of the preceding segment width (reciter repeats the tail portion before continuing).

### ASR phoneme test set

`data/repetition_test_set_base.json` and `data/repetition_test_set_large.json` contain ASR phoneme transcriptions of all verses with repetitions, generated by running the Base (`hetchyy/r15_95m`) and Large (`hetchyy/r7`) models on the verse audio.

#### Schema

```json
{
  "_meta": {
    "description": "ASR phonemes for verses with repetitions",
    "source_dataset": "hetchyy/quranic-universal-ayahs",
    "config": "hafs_an_asim",
    "asr_model": "hetchyy/r15_95m",
    "generated_at": "2026-03-31T..."
  },
  "ali_jaber": {
    "2:33": {
      "segments": [[1, 4, 0, 4910], [5, 11, 5200, 12300], [8, 22, 13100, 28500]],
      "repetitions": [
        {"seg_idx": 2, "overlap_words": 4, "overlap_range": [8, 11]}
      ],
      "num_reps": 1,
      "text": "...",
      "word_timestamps": [[1, 0, 450], [2, 450, 900], ...],
      "asr_phonemes": ["b", "i", "s", "m", "i", ...],
      "asr_phoneme_count": 187,
      "audio_duration_s": 28.5,
      "audio_sr": 16000
    }
  },
  "minshawy_murattal": { ... }
}
```

Each verse entry provides:
- **`segments`** — ground-truth word ranges with timing (`[word_from, word_to, time_from_ms, time_to_ms]`). Overlapping consecutive segments = reciter repetition.
- **`repetitions`** — pre-computed overlap metadata: which segment index, how many words overlap, the overlapping word range.
- **`word_timestamps`** — MFA word-level timestamps (`[word_idx, start_ms, end_ms]`), for correlating phoneme positions with word boundaries.
- **`asr_phonemes`** — raw CTC-decoded phoneme sequence (P) from the full verse audio. This is the input to the repetition detection algorithm.
- **`text`** — Arabic verse text, for constructing the reference phoneme sequence (R) via `quranic-phonemizer`.

Two model variants allow comparing detection robustness across ASR quality levels.

### Evaluation metrics

**Test methodology:** Run the full verse ASR phonemes (P) against the full verse reference phonemes (R) from `data/repetition_ref_phonemes.json`. This simulates the under-segmentation case the algorithm is designed for — VAD producing one long segment that contains repeated content.

#### 1. Binary detection (verse-level) — Precision / Recall / F1

Did the algorithm correctly detect that a verse has ≥1 repetition (`n_wraps > 0`)? This is the primary success metric.

- **Precision** = true positives / (true positives + false positives)
- **Recall** = true positives / (true positives + false negatives)
- **F1** = harmonic mean

Reported per-reciter and aggregate. False positives are tested on a sample of non-repetition verses (same reciters).

#### 2. Wrap count accuracy

For true-positive verses (correctly detected as having repetitions):

- **MAE** between predicted `n_wraps` and ground-truth `num_reps`
- **Exact match %** — predicted wraps == ground-truth repetition count

#### 3. Confidence improvement (v1 vs v2)

On repetition verses, compare:

- **v1 confidence** = `1 - norm_dist` from the k=0 path (standard DP, no wraps allowed)
- **v2 confidence** = `1 - norm_dist` from the wraparound DP (wraps allowed, penalty excluded from norm)

Report mean/median/min improvement. Shows how much alignment quality improves when repetition is accounted for.

#### 4. False positive rate

Run on a random sample of non-repetition verses from the same reciters. Measure what % incorrectly get `n_wraps > 0`. Critical for validating that `WRAP_PENALTY` is set correctly.

#### 5. Word range accuracy

For true-positive detections: does the matched `[word_from, word_to]` span match the ground-truth span?

- **IoU** (intersection over union) of predicted vs ground-truth word ranges
- **Exact boundary match %** — both endpoints match exactly

#### 6. Per-call timing

Wall-clock time per call, broken down by:

- Wraparound DP vs standard DP (k=0 only)
- Segment size bucket (phoneme count: <50, 50–100, 100–200, 200+)

Reported as mean and p95. Establishes the performance baseline for later Cython optimization.
