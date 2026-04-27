# Hypothesis Verification: What Best Explains P?

After pre-filtering identifies segments with unexplained excess phonemes, and (optionally) breakpoint estimation narrows the search, the **verification stage** determines the definitive answer: is there a repetition, and if so, what is the decomposition?

This document compares three hypothesis verification algorithms side by side, using real phoneme data from the Quranic Phonemizer and simulated ASR output. Pre-filter and breakpoint estimation stages are documented in [prefilter-examples.md](prefilter-examples.md) and [breakpoint-examples.md](breakpoint-examples.md).

---

## The Three Approaches

### 1. Decomposition Enumeration (Current)

**Strategy:** Generate all valid k=2 and k=3 decompositions of the matched word range on the R-side. For each, build R_expanded by concatenating reference phonemes. Run the existing `align_with_word_boundaries()` on each. The candidate with the lowest normalized edit distance wins.

**Pseudocode:**

```python
def verify_enumeration(P, R_words, a, b):
    candidates = generate_k2(a, b) + generate_k3(a, b)
    valid = [c for c in candidates
             if 0.8 * len(P) <= phones_for(c) <= 1.2 * len(P)]

    best_norm = H0_norm_dist  # baseline: single-pass alignment
    best_decomp = None
    for candidate in valid:
        R_exp = concatenate_phones(candidate)
        result = align_with_word_boundaries(P, R_exp, prior_weight=0.0)
        if result.norm_dist < best_norm:
            best_norm = result.norm_dist
            best_decomp = candidate

    return best_decomp, best_norm
```

**Traceback information:** The winning candidate gives the decomposition directly (e.g., `[w0-w3, w2-w3]`). The DP traceback for that candidate gives the alignment path through R_expanded.

**Strengths:**
- Reuses `align_with_word_boundaries()` completely unchanged
- Modular -- verification is a wrapper around existing infrastructure
- Easy to debug: each candidate is an independent, inspectable DP call

**Cost:** O(C x |P| x |R_exp|), where C = number of filtered candidates (typically 20-110)

---

### 2. Wraparound DP (NCRF-style)

**Strategy:** Build a single modified DP matrix where the reference R can **loop back** to an earlier word boundary when P still has unaligned phonemes after reaching the end of R. The alignment discovers the optimal number of passes and wrap points in one call.

**Key mechanics:**
- Standard DP matrix: P (rows, 0...|P|) x R (columns, 0...|R|)
- At column positions corresponding to word boundaries at or near the end of R, allow a **wrap transition**: the next column index jumps back to any earlier word boundary column
- Each wrap incurs a small penalty `WRAP_COST` (e.g., 2.0) to prefer simpler explanations
- P is consumed linearly (row index always increases) -- only R wraps
- Word-boundary constraints still apply: wraps only occur at valid word boundary positions

**Pseudocode:**

```python
def verify_wraparound(P, R_phones, word_boundaries, wrap_cost=2.0):
    """
    R_phones: flat phoneme array for R[a:b]
    word_boundaries: set of indices in R_phones where words start
    """
    m, n = len(P), len(R_phones)
    INF = float('inf')

    # dp[i][j] = min cost to align P[0:i] consuming R up to position j
    # j can exceed n via wrapping: j % n gives the R-position,
    # j // n gives the pass number
    # But we implement it differently: at j == n, allow wrap transitions

    # Practical implementation: dp[i][j] for j in 0..n
    # At j == n (end of R), for each valid wrap target w in word_boundaries:
    #   dp[i][w] = min(dp[i][w], dp[i][n] + wrap_cost)
    # Then continue filling the matrix for the next pass

    MAX_PASSES = 4
    # Extended matrix: columns 0..n*MAX_PASSES
    cols = n * MAX_PASSES
    dp = [[INF] * (cols + 1) for _ in range(m + 1)]
    dp[0][0] = 0.0
    bt = [[None] * (cols + 1) for _ in range(m + 1)]  # traceback

    for i in range(m + 1):
        for j_ext in range(cols + 1):
            j = j_ext % n  # position within R
            pass_num = j_ext // n

            if dp[i][j_ext] == INF:
                continue

            # Standard transitions: match/sub, insert, delete
            if i < m and j_ext < cols:
                # Match or substitution
                cost = 0.0 if P[i] == R_phones[j] else sub_cost(P[i], R_phones[j])
                if dp[i][j_ext] + cost < dp[i+1][j_ext+1]:
                    dp[i+1][j_ext+1] = dp[i][j_ext] + cost
                    bt[i+1][j_ext+1] = ('M', i, j_ext)

            if i < m:
                # Insertion (consume P[i], stay in R)
                ins = 1.0
                if dp[i][j_ext] + ins < dp[i+1][j_ext]:
                    dp[i+1][j_ext] = dp[i][j_ext] + ins
                    bt[i+1][j_ext] = ('I', i, j_ext)

            if j_ext < cols:
                # Deletion (skip R[j], stay in P)
                dele = DEL_COST  # 0.8
                if dp[i][j_ext] + dele < dp[i][j_ext+1]:
                    dp[i][j_ext+1] = dp[i][j_ext] + dele
                    bt[i][j_ext+1] = ('D', i, j_ext)

            # WRAP TRANSITION: at end-of-R boundary, jump back
            if j == 0 and pass_num > 0 and j_ext > 0:
                # This column is a wrap target -- already handled by source
                pass
            if j == n - 1 or (j in word_boundaries and j >= n - max_tail):
                # Allow wrap to any earlier word boundary in next pass
                for w in word_boundaries:
                    if w <= j:  # wrap to earlier or same position
                        target = (pass_num + 1) * n + w
                        if target <= cols:
                            if dp[i][j_ext] + wrap_cost < dp[i][target]:
                                dp[i][target] = dp[i][j_ext] + wrap_cost
                                bt[i][target] = ('W', i, j_ext)  # wrap

    # Find best endpoint: scan last row for minimum
    best_j = min(range(cols + 1), key=lambda j: dp[m][j])
    total_cost = dp[m][best_j]
    norm_dist = total_cost / m

    # Traceback reveals wrap points --> decomposition
    wraps = extract_wraps(bt, m, best_j, n)
    return wraps, norm_dist
```

**Traceback information:** The backtrace path through the extended matrix reveals each wrap transition: "at P-position X, the DP wrapped from R-position Y (end of word W_i) back to R-position Z (start of word W_j)." The set of wrap points directly encodes the decomposition.

**Strengths:**
- Single DP call replaces 20-110 candidate tests
- Naturally handles any number of repetitions without specifying k
- The wrap penalty provides a built-in Occam's razor (prefers fewer passes)

**Cost:** O(|P| x |R| x K_max) where K_max = maximum passes allowed (typically 3-4). The wrap transitions add O(W) per boundary check, where W = number of word boundaries.

---

### 3. Partition DP

**Strategy:** Instead of decomposing R (the reference), segment P (the ASR output) directly. A 1D DP finds the minimum-cost partition of P into contiguous segments, where each segment independently aligns to the best-fitting window of R.

**Pseudocode:**

```python
def verify_partition(P, R_phones, word_boundaries, segment_penalty=2.0):
    """
    Partition P into segments, each aligning to a contiguous R-window.
    word_boundaries: positions in P that are plausible segment breaks
    """
    n = len(P)
    INF = float('inf')

    # Estimate plausible break points in P based on R word lengths
    # For simplicity, allow breaks every ~word_length phonemes
    break_candidates = estimate_P_breaks(P, R_phones, word_boundaries)

    # dp[i] = minimum cost to explain P[0:i]
    dp = [INF] * (n + 1)
    dp[0] = 0.0
    parent = [None] * (n + 1)  # traceback: which j produced dp[i]
    seg_map = [None] * (n + 1)  # which R-window each segment maps to

    for i in break_candidates + [n]:
        for j in [0] + [b for b in break_candidates if b < i]:
            if dp[j] == INF:
                continue
            if i - j < MIN_SEGMENT_PHONES:  # minimum segment size
                continue

            # Align P[j:i] against R, find best-matching R-window
            segment = P[j:i]
            best_window, align_cost = best_R_window(segment, R_phones,
                                                     word_boundaries)
            norm_cost = align_cost / len(segment)

            # Add segment penalty for each additional segment beyond the first
            penalty = segment_penalty if j > 0 else 0.0
            total = dp[j] + align_cost + penalty

            if total < dp[i]:
                dp[i] = total
                parent[i] = j
                seg_map[i] = best_window

    # Traceback: reconstruct partition
    partition = []
    i = n
    while i > 0:
        j = parent[i]
        partition.append((j, i, seg_map[i]))  # P[j:i] -> R_window
        i = j
    partition.reverse()

    norm_dist = dp[n] / n
    return partition, norm_dist


def best_R_window(segment, R_phones, word_boundaries):
    """Find the contiguous R sub-range that best aligns with segment."""
    best_cost = float('inf')
    best_window = None
    # Try all contiguous word-boundary-delimited windows of R
    wb = sorted(word_boundaries)
    for start_idx, start_pos in enumerate(wb):
        for end_pos in wb[start_idx + 1:]:
            R_window = R_phones[start_pos:end_pos]
            cost = align_with_word_boundaries(segment, R_window)
            if cost < best_cost:
                best_cost = cost
                best_window = (start_pos, end_pos)
    return best_window, best_cost
```

**Traceback information:** The partition directly gives which P-segments map to which R-windows: "P[0:32] aligns to R[w0-w3], P[32:50] aligns to R[w2-w3]." The R-windows define the decomposition.

**Strengths:**
- Finds the optimal partition of P without enumerating R-side decompositions
- Naturally handles variable numbers of segments
- The segment penalty (like UCHIME's split penalty) resists over-segmentation

**Cost:** O(B^2 x DP_cost) where B = number of candidate break points in P. Each `best_R_window` call is itself O(W^2 x |seg| x |R_win|), making total cost potentially high for long segments.

---

## Worked Examples

### Notation

- **R** = reference phonemes for the standard DP match (words [a, b])
- **P** = ASR output phonemes (simulated with ~5% substitution rate)
- **norm** = normalized edit distance = total_cost / |P|
- **conf** = 1 - norm
- Deletion cost = 0.8, substitution cost ~ 0.5, insertion cost = 1.0
- Wrap penalty (wraparound DP) = 2.0
- Segment penalty (partition DP) = 2.0

Phoneme data is from the Quranic Phonemizer (real IPA output for each verse).

---

### Example 1: Short Suffix Repeat (55:13)

**Verse:** 55:13, 4 words (Surah Ar-Rahman refrain)

#### Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| w1 | ءَالَآءِ | `ʔ aː l aː ʔ i` | 6 |
| w2 | رَبِّكُمَا | `rˤ aˤ bb i k u m aː` | 8 |
| w3 | تُكَذِّبَانِ | `t u k a ðð i b aː n` | 9 |
| | **Total R** | | **31** |

**Ground truth:** Reciter says w0-w3, then repeats w2-w3.

```
Pass 1: w0  w1  w2  w3       (31 phones)
Pass 2:         w2  w3       (17 phones)
                             ─────────
Total:                        48 phones
```

**P** (ASR output) = 50 phonemes (48 + 2 noise). Excess = 50 - 31 = 19 >= 8: proceed.

**H0 baseline:** norm = 0.33, conf = 0.67 (19 excess phones absorbed as deletions).

---

#### Algorithm 1: Decomposition Enumeration

(Full derivation in [proposed-algo.md](proposed-algo.md), Example 1.)

**Candidates generated:** 8 raw k=2 candidates, 5 pass length filter.

**Winner:** `[w0-w3, w2-w3]`, R_exp = 31 + 17 = 48 phones.

```
H1 cost  = 2 x 0.8 (excess) + 3 x 0.5 (ASR subs) = 3.1
H1 norm  = 3.1 / 50 = 0.06
H1 conf  = 0.94
```

**Computational cost:** 5 DP calls x O(50 x 48) = 5 x 2,400 = **12,000 ops**

---

#### Algorithm 2: Wraparound DP

The DP matrix has P on rows (0..50) and R on columns (0..31), with wrap transitions at word boundaries near the end of R.

**Matrix structure (condensed):**

```
             R columns (31 phones)
             w0(8)    w1(6)    w2(8)    w3(9)     WRAP targets
             0──7     8──13    14──21   22──30     →w0(0) →w1(8) →w2(14)
P rows:
  0..7       ██ match w0: cost ~0.5 (1 sub: jj→j)
  8..13      ──────── match w1: cost 0
  14..21     ──────────────── match w2: cost 0.5 (1 sub: bb→b)
  22..30     ──────────────────────── match w3: cost 0.5 (1 sub: ðð→ð)
  ───── end of first pass through R ─────
  At P=30, R=30: dp[30][30] = 1.5 (3 subs)
  Option A: STOP here. Remaining P[31..49] = 20 phones as insertions → cost += 20
  Option B: WRAP from R=30 back to R=14 (start of w2), cost += 2.0 (wrap penalty)

  WRAP TAKEN: dp[30][14'] = 1.5 + 2.0 = 3.5  (14' = column 14 in pass 2)

  31..38     ──────── match w2 again: cost ~0 (clean repeat)
  39..48     ──────────────── match w3 again: cost 0.5 (1 noise insertion)
  ───── end of second pass (partial) ─────
  At P=50: dp[50][30'] = 3.5 + 0.5 = 4.0
```

**Key decision point at P=30, R=30:**

| Option | Next state | Cost to complete | Total |
|--------|-----------|-----------------|-------|
| No wrap (stop) | P[31:50] as insertions | 1.5 + 20 x 1.0 = 21.5 | 21.5 |
| Wrap to w0 (col 0) | Align P[31:50] vs full R (31 ph) | 1.5 + 2.0 + ~12.0 = 15.5 | 15.5 |
| Wrap to w1 (col 8) | Align P[31:50] vs R[w1:w3] (23 ph) | 1.5 + 2.0 + ~4.0 = 7.5 | 7.5 |
| **Wrap to w2 (col 14)** | **Align P[31:50] vs R[w2:w3] (17 ph)** | **1.5 + 2.0 + 0.5 = 4.0** | **4.0** |
| Wrap to w3 (col 22) | Align P[31:50] vs R[w3] (9 ph) | 1.5 + 2.0 + ~11.0 = 14.5 | 14.5 |

The DP selects wrap to w2 because the remaining P phonemes (P[31:50]) are a near-perfect match for R[w2:w3].

**Traceback:** "At P-position 30, the DP wrapped from R-position 30 (end of w3) back to R-position 14 (start of w2)."

This encodes decomposition: **[w0-w3, w2-w3]** -- matching the ground truth.

```
Wraparound cost  = 1.5 (3 subs) + 2.0 (wrap) + 0.5 (noise) = 4.0
Wraparound norm  = 4.0 / 50 = 0.08
Wraparound conf  = 0.92
```

Note: The wrap penalty (2.0) slightly increases norm_dist compared to decomposition enumeration (0.08 vs 0.06). This is intentional -- the penalty serves as Occam's razor, preferring no-wrap when evidence is marginal.

**Computational cost:** 1 DP call x O(50 x 31 x 2 passes) = **3,100 ops**

---

#### Algorithm 3: Partition DP

The partition DP segments P directly, finding where to split P so each piece aligns well to some R-window.

**Break point candidates in P:** Based on R word lengths, plausible break points cluster around P-positions 28-34 (where first pass ends and second begins). Using word-boundary-aware estimation: B = {0, 8, 14, 22, 31, 39, 50} (roughly word-aligned positions).

**1D DP table (key entries):**

| i | Best j | Segment | R-window | align_cost | penalty | dp[i] |
|---|--------|---------|----------|------------|---------|-------|
| 0 | - | - | - | - | - | 0.0 |
| 31 | 0 | P[0:31] | R[w0-w3] | 1.5 | 0.0 | 1.5 |
| 39 | 0 | P[0:39] | R[w0-w3] | 7.4 | 0.0 | 7.4 |
| 39 | 31 | P[31:39] | R[w2] | 0.3 | 2.0 | 1.5 + 0.3 + 2.0 = **3.8** |
| **50** | 31 | P[31:50] | R[w2-w3] | 0.5 | 2.0 | 1.5 + 0.5 + 2.0 = **4.0** |
| 50 | 39 | P[39:50] | R[w3] | 1.2 | 2.0 | 3.8 + 1.2 + 2.0 = 7.0 |
| 50 | 0 | P[0:50] | R[w0-w3] | 16.7 | 0.0 | 16.7 |

**Winner:** dp[50] = 4.0, via partition P[0:31] -> R[w0-w3], P[31:50] -> R[w2-w3].

**Traceback:** "Optimal partition is P[0:31] -> R[w0-w3], P[31:50] -> R[w2-w3]."

This encodes decomposition: **[w0-w3, w2-w3]** -- matching the ground truth.

```
Partition cost  = 4.0
Partition norm  = 4.0 / 50 = 0.08
Partition conf  = 0.92
```

**Computational cost:** |B|^2 candidate transitions x W^2 R-windows x DP per window. With |B|=7, W=5 (word boundaries): 7^2 x 5^2 x avg_dp = 49 x 25 x ~200 = **~245,000 ops**

However, many transitions are pruned (segment too short, R-window too far from segment length), bringing effective cost to ~**50,000 ops**.

---

#### Example 1 Comparison

| Metric | Decomp Enum | Wraparound DP | Partition DP |
|--------|-------------|---------------|-------------|
| **Result** | [w0-w3, w2-w3] | [w0-w3, w2-w3] | [w0-w3, w2-w3] |
| **norm_dist** | 0.06 | 0.08 | 0.08 |
| **Confidence** | 0.94 | 0.92 | 0.92 |
| **Cost (ops)** | 12,000 | 3,100 | ~50,000 |
| **DP calls** | 5 | 1 | ~30 (inner alignments) |

All three find the correct decomposition. Wraparound DP is cheapest. Decomposition enumeration has marginally better norm_dist (no wrap/segment penalty). Partition DP is most expensive due to the inner alignment calls.

---

### Example 2: Long Segment, Small Repeat (2:255, w0-w24)

**Verse:** 2:255 (Ayat al-Kursi), first 25 words. R = 115 phones.

#### Phoneme Data

| Idx | Phonemes | Ct | Idx | Phonemes | Ct |
|-----|----------|-----|-----|----------|-----|
| w0 | `ʔ a lˤlˤ aˤː h u` | 6 | w13 | `m aː` | 2 |
| w1 | `l aː` | 2 | w14 | `f i` | 2 |
| w2 | `ʔ i l aː h a` | 6 | w15 | `ss a m aː w aː t i` | 8 |
| w3 | `ʔ i ll aː` | 4 | w16 | `w a m aː` | 4 |
| w4 | `h u w a` | 4 | w17 | `f i` | 2 |
| w5 | `l ħ a jj u` | 5 | w18 | `l ʔ a rˤ dˤ i` | 6 |
| w6 | `l q aˤ jj uː m u` | 7 | w19 | `m a ŋ` | 3 |
| w7 | `l aː` | 2 | w20 | `ð a` | 2 |
| w8 | `t a ʔ x u ð u h uː` | 9 | w21 | `ll a ð iː` | 4 |
| w9 | `s i n a t u` | 6 | w22 | `j a ʃ f a ʕ u` | 7 |
| w10 | `w̃ a l aː` | 4 | w23 | `ʕ i ŋ d a h uː` | 7 |
| w11 | `n a w m u` | 5 | w24 | `ʔ i ll aː` | 4 |
| w12 | `ll a h uː` | 4 | | **Total R** | **115** |

**Ground truth:** Reciter hesitates after w24 and repeats w22-w24.

```
Pass 1: w0 ──── w24    (115 phones)
Pass 2:    w22 ─ w24   ( 18 phones)
                        ──────────
Total:                   133 phones
```

P = 136 phones (133 + 3 noise). Excess = 21. Ratio = 1.18 (would miss at 1.3 threshold).

H0: norm = 0.12, conf = 0.88.

---

#### Algorithm 1: Decomposition Enumeration

With 25 words, k=2 generates ~550 raw candidates, ~35 after length filter. k=3 adds ~10k raw, ~75 after filter. Combined: **~110 candidates**.

**Winner:** `[w0-w24, w22-w24]`, R_exp = 115 + 18 = 133 phones.

```
H1 norm  = 4.9 / 136 = 0.036,  conf = 0.96
```

**Cost:** 110 DP calls x O(136 x 133) = 110 x 18,088 = **~2M ops**

---

#### Algorithm 2: Wraparound DP

Matrix: 136 rows x 115 columns, with wrap transitions.

The DP aligns P[0:115] cleanly against R (5 subs ~ cost 2.5). At P=115, R=114 (end of w24), the critical decision:

| Option | Wrap target | Remaining P | Cost to complete | Total |
|--------|------------|-------------|-----------------|-------|
| No wrap | - | 21 phones as insertions | 2.5 + 21 = 23.5 | 23.5 |
| Wrap to w22 (col 97) | R[w22-w24] | 18 phones, near-perfect | 2.5 + 2.0 + 1.0 = 5.5 | **5.5** |
| Wrap to w21 (col 93) | R[w21-w24] | 22 phones vs 18 avail | 2.5 + 2.0 + 3.5 = 8.0 | 8.0 |
| Wrap to w23 (col 104) | R[w23-w24] | 11 phones vs 18 P | 2.5 + 2.0 + 8.0 = 12.5 | 12.5 |

**Traceback:** "At P=115, wrap from R=114 (end w24) back to R=97 (start w22)."

```
Wraparound norm  = 5.5 / 136 = 0.040,  conf = 0.96
```

**Cost:** 1 DP call x O(136 x 115 x 2) = **31,280 ops**

---

#### Algorithm 3: Partition DP

Break candidates in P cluster around position 115 (end of first pass). The DP explores splits near P[112-118].

**Winner:** P[0:115] -> R[w0-w24], P[115:136] -> R[w22-w24].

```
Partition norm  = (2.5 + 1.0 + 2.0) / 136 = 0.040,  conf = 0.96
```

**Cost:** With 25 word boundaries in P, B ~ 25. Inner alignment calls dominate: ~**600k ops**

---

#### Example 2 Comparison

| Metric | Decomp Enum | Wraparound DP | Partition DP |
|--------|-------------|---------------|-------------|
| **Result** | [w0-w24, w22-w24] | [w0-w24, w22-w24] | [w0-w24, w22-w24] |
| **norm_dist** | 0.036 | 0.040 | 0.040 |
| **Cost (ops)** | ~2,000,000 | ~31,000 | ~600,000 |

This is the key scalability example. At 25 words, decomposition enumeration generates 110 candidates and costs 2M ops -- still negligible in absolute terms, but **64x more** than wraparound DP. The gap widens further with longer segments.

---

### Example 3: Middle Restart (36:40, w0-w6)

**Verse:** 36:40, first 7 words. R = 36 phones.

#### Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | لَا | `l a` | 2 |
| w1 | ٱلشَّمْسُ | `ʃʃ a m s u` | 5 |
| w2 | يَنبَغِى | `j a ŋ b a ɣ iː` | 7 |
| w3 | لَهَآ | `l a h aː` | 4 |
| w4 | أَن | `ʔ a ŋ` | 3 |
| w5 | تُدْرِكَ | `t u d Q r i k a` | 8 |
| w6 | ٱلْقَمَرَ | `l q aˤ m a rˤ aˤ` | 7 |
| | **Total R** | | **36** |

**Ground truth:** Reciter completes w0-w6, restarts from w3 (middle restart).

```
Pass 1: w0  w1  w2  w3  w4  w5  w6    (36 phones)
Pass 2:             w3  w4  w5  w6    (22 phones)
                                       ──────────
Total:                                  58 phones
```

P = 60 phones. H0: norm = 0.31, conf = 0.69.

---

#### Algorithm 1: Decomposition Enumeration

30 raw k=2 candidates, ~8 pass length filter. (See [proposed-algo.md](proposed-algo.md), Example 3 for full table.)

**Winner:** `[w0-w6, w3-w6]`, R_exp = 36 + 22 = 58. norm = 0.04, conf = 0.96.

**Key insight:** The suffix-only pattern `[w0-w6, w5-w6]` gives conf = 0.85. Full enumeration finds the true middle restart at w3, gaining 11% confidence.

**Cost:** 8 DP calls x O(60 x 58) = **27,840 ops**

---

#### Algorithm 2: Wraparound DP

At P=36 (end of first pass through R), the DP evaluates wrap options:

| Wrap target | R-window in pass 2 | Cost to complete |
|------------|-------------------|-----------------|
| **w3 (col 14)** | **R[w3-w6] = 22 ph** | **2.0 + 0.5 = 2.5** |
| w4 (col 18) | R[w4-w6] = 18 ph | 2.0 + 3.5 = 5.5 |
| w5 (col 21) | R[w5-w6] = 15 ph | 2.0 + 6.0 = 8.0 |
| w0 (col 0) | R[w0-w6] = 36 ph | 2.0 + 14.0 = 16.0 |

**Traceback:** Wrap at P=36 from R=35 (end w6) to R=14 (start w3).

Result: **[w0-w6, w3-w6]**. norm = 0.06, conf = 0.94.

**Cost:** O(60 x 36 x 2) = **4,320 ops**

---

#### Algorithm 3: Partition DP

Break candidates near P=36. Best split at P=36:

- P[0:36] -> R[w0-w6], cost = 1.0
- P[36:60] -> R[w3-w6], cost = 0.5 + 2.0 (penalty) = 2.5

Result: **[w0-w6, w3-w6]**. norm = 3.5 / 60 = 0.06, conf = 0.94.

**Cost:** ~**40,000 ops**

---

#### Example 3 Comparison

All three algorithms correctly identify the middle restart at w3, outperforming a suffix-only approach.

| Metric | Decomp Enum | Wraparound DP | Partition DP |
|--------|-------------|---------------|-------------|
| **Result** | [w0-w6, w3-w6] | [w0-w6, w3-w6] | [w0-w6, w3-w6] |
| **norm_dist** | 0.04 | 0.06 | 0.06 |
| **Cost (ops)** | 27,840 | 4,320 | ~40,000 |

---

### Example 4: Multi-Pass k=3 (36:40, w0-w10)

**Verse:** 36:40, first 11 words. R = 57 phones.

#### Phoneme Data

| Idx | Phonemes | Ct | Idx | Phonemes | Ct |
|-----|----------|-----|-----|----------|-----|
| w0 | `l a` | 2 | w6 | `l q aˤ m a rˤ aˤ` | 7 |
| w1 | `ʃʃ a m s u` | 5 | w7 | `w a l a` | 4 |
| w2 | `j a ŋ b a ɣ iː` | 7 | w8 | `ll a j l u` | 5 |
| w3 | `l a h aː` | 4 | w9 | `s aː b i q u` | 6 |
| w4 | `ʔ a ŋ` | 3 | w10 | `ñ a h aː r i` | 6 |
| w5 | `t u d Q r i k a` | 8 | | **Total R** | **57** |

**Ground truth:** Three-pass pattern with overlapping restarts.

```
Pass 1: w0-w6    (36 phones)
Pass 2: w4-w8    (27 phones)
Pass 3: w7-w10   (21 phones)
                  ──────────
Total:             84 phones
```

P = 87 phones. H0: norm = 0.27, conf = 0.73.

---

#### Algorithm 1: Decomposition Enumeration

k=2 (~15 filtered) + k=3 (~40 filtered) = **55 candidates** tested together.

Best k=2: norm ~ 0.13 (can't match the 3-pass ordering).

**Winner (k=3):** `[w0-w6, w4-w8, w7-w10]`, R_exp = 36 + 27 + 21 = 84 phones.

```
H1 norm  = 3.9 / 87 = 0.045,  conf = 0.96
```

**Cost:** 55 DP calls x O(87 x 84) = 55 x 7,308 = **~400k ops**

---

#### Algorithm 2: Wraparound DP

The DP discovers the 3-pass structure via two wrap transitions:

**Wrap 1:** At P=36 (end of first pass), wrap from R=35 (end w6) to R=18 (start w4).

```
Pass 2: P[37:63] aligns against R[w4-w8] (27 phones)
```

**Wrap 2:** At P=63 (end of second pass through w8), wrap from R=44 (end w8) to R=38 (start w7).

```
Pass 3: P[64:87] aligns against R[w7-w10] (21 phones)
```

**Traceback reveals two wraps:**
1. P=36: R=35 -> R=18 (wrap to w4)
2. P=63: R=44 -> R=38 (wrap to w7)

This encodes decomposition: **[w0-w6, w4-w8, w7-w10]**.

```
Wraparound cost  = 1.5 (subs) + 2 x 2.0 (wraps) + 1.5 (noise) = 7.0
Wraparound norm  = 7.0 / 87 = 0.08
Wraparound conf  = 0.92
```

The two wrap penalties (2 x 2.0 = 4.0) increase the cost relative to decomposition enumeration, but the result still clearly beats H0 (0.08 vs 0.27).

**Cost:** O(87 x 57 x 3) = **~14,900 ops**

---

#### Algorithm 3: Partition DP

The 1D DP finds three segments:

| Segment | P range | R window | align_cost | penalty |
|---------|---------|----------|------------|---------|
| 1 | P[0:36] | R[w0-w6] | 1.0 | 0.0 |
| 2 | P[36:63] | R[w4-w8] | 0.5 | 2.0 |
| 3 | P[63:87] | R[w7-w10] | 0.5 | 2.0 |

```
Partition cost  = 1.0 + 0.5 + 2.0 + 0.5 + 2.0 = 6.0
Partition norm  = 6.0 / 87 = 0.07
Partition conf  = 0.93
```

**Cost:** With B ~ 11 break candidates, ~**120k ops**

---

#### Example 4 Comparison

| Metric | Decomp Enum | Wraparound DP | Partition DP |
|--------|-------------|---------------|-------------|
| **Result** | [w0-w6, w4-w8, w7-w10] | [w0-w6, w4-w8, w7-w10] | [w0-w6, w4-w8, w7-w10] |
| **norm_dist** | 0.045 | 0.08 | 0.07 |
| **Cost (ops)** | ~400,000 | ~14,900 | ~120,000 |

All three find the k=3 decomposition. Wraparound DP pays a higher norm_dist (two wrap penalties) but is 27x cheaper than enumeration.

---

### Example 5: Ambiguous Decomposition

**Verse:** 2:286, words 6-11

This verse has a notable phonemic parallelism: w7/w10 are near-identical (`m aː` vs `m a`) and w8/w11 share the root k-s-b (`k a s a b a t` vs `k t a s a b a t`). This means two different decompositions could explain P almost equally well.

#### Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w6 | لَهَا | `l a h aː` | 4 |
| w7 | مَا | `m aː` | 2 |
| w8 | كَسَبَتْ | `k a s a b a t` | 7 |
| w9 | وَعَلَيْهَا | `w a ʕ a l a j h aː` | 9 |
| w10 | مَا | `m a` | 2 |
| w11 | ٱكْتَسَبَتْ | `k t a s a b a t` | 8 |
| | **Total R** | | **32** |

**Ground truth:** Reciter says w6-w11, then repeats from w9.

```
Pass 1: w6  w7  w8  w9  w10  w11    (32 phones)
Pass 2:             w9  w10  w11    (19 phones)
                                     ──────────
Total:                                51 phones
```

P = 53 phones (51 + 2 noise). Excess = 53 - 32 = 21 >= 8: proceed.

H0: norm = 0.31, conf = 0.69.

**The ambiguity:** Two decompositions are close:

| Decomposition | R_exp | Phoneme match quality |
|--------------|-------|----------------------|
| **A: [w6-w11, w9-w11]** | 32 + 19 = 51 | **Near-perfect** (true answer) |
| B: [w6-w11, w10-w11] | 32 + 10 = 42 | 11 excess P phones, but w10-w11 phonemes overlap with w7-w8 |

The key question: can each algorithm distinguish A from B?

---

#### Algorithm 1: Decomposition Enumeration

Both candidates are generated and tested independently.

**Candidate A: [w6-w11, w9-w11]**
```
R_exp = 51 phones, P = 53 phones
cost = 2 x 0.8 + 2 x 0.5 = 2.6
norm = 2.6 / 53 = 0.049
```

**Candidate B: [w6-w11, w10-w11]**
```
R_exp = 42 phones, P = 53 phones
11 excess P phones absorbed as insertions
cost = 11 x 1.0 + 2 x 0.5 = 12.0
norm = 12.0 / 53 = 0.226
```

**Gap: 0.049 vs 0.226 -- not ambiguous at all.** Despite the phonemic similarity of w7-w8 and w10-w11, the 11-phone length mismatch in candidate B creates a clear cost difference. The DP easily separates them.

Result: **[w6-w11, w9-w11]**, norm = 0.049, conf = 0.95.

**Cost:** ~10 filtered candidates x O(53 x 51) = **~27,000 ops**

---

#### Algorithm 2: Wraparound DP

At P=32 (end of first pass), wrap decision:

| Wrap target | R-window | Remaining P (21 ph) | Cost |
|------------|----------|---------------------|------|
| **w9 (col 22)** | **R[w9-w11] = 19 ph** | **2 excess + 2 subs = 2.6** | **1.0 + 2.0 + 2.6 = 5.6** |
| w10 (col 30) | R[w10-w11] = 10 ph | 11 excess = 11.0 | 1.0 + 2.0 + 11.0 = 14.0 |

The length mismatch makes the decision clear. Wrap to w9.

Result: **[w6-w11, w9-w11]**, norm = 5.6 / 53 = 0.106, conf = 0.89.

**Cost:** O(53 x 32 x 2) = **~3,400 ops**

---

#### Algorithm 3: Partition DP

Best split at P=32: P[0:32] -> R[w6-w11], P[32:53] -> R[w9-w11].

Result: **[w6-w11, w9-w11]**, norm = (1.0 + 1.6 + 2.0) / 53 = 0.087, conf = 0.91.

**Cost:** ~**35,000 ops**

---

#### Example 5 Analysis

Despite the phonemic parallelism between w7-w8 and w10-w11 (`m aː / k a s a b a t` vs `m a / k t a s a b a t`), the length constraint resolves the ambiguity easily. A true ambiguity would require two decompositions with **both** matching phoneme order **and** matching length -- which is extremely rare given the diversity of Quranic vocabulary.

**Takeaway:** Phonemic similarity between words is a necessary but not sufficient condition for ambiguity. Length mismatch is usually the decisive factor, and all three algorithms exploit it.

---

### Example 6: Over-Decomposition Trap

**Verse:** 36:40, words 0-6 (same as Example 3, but with different ground truth)

This example tests whether each algorithm resists overfitting when k=3 has slightly better raw norm_dist than k=2 but k=2 is the true explanation.

#### Setup

**Ground truth:** Reciter says w0-w6, then repeats w5-w6 (a simple 2-word suffix repeat).

```
Pass 1: w0  w1  w2  w3  w4  w5  w6    (36 phones)
Pass 2:                     w5  w6    (15 phones)
                                       ──────────
Total:                                  51 phones
```

P = 53 phones (51 + 2 noise). Excess = 53 - 36 = 17 >= 8: proceed.

H0: norm = 0.27, conf = 0.73.

#### The trap

**True decomposition (k=2):** `[w0-w6, w5-w6]`, R_exp = 36 + 15 = 51 phones.
```
k=2 cost  = 2 x 0.8 + 2 x 0.5 = 2.6
k=2 norm  = 2.6 / 53 = 0.049
```

**Overfitting decomposition (k=3):** `[w0-w5, w4-w6, w5-w6]`, R_exp = 29 + 18 + 15 = 62 phones.

This k=3 decomposition claims three passes: w0-w5, then restart at w4 through w6, then restart at w5 through w6. It has 9 more R_exp phones than P (62 vs 53), which the DP absorbs as deletions. But because the extra R phonemes happen to partially match ASR noise insertions in P, the raw alignment cost can be slightly lower:

```
k=3 cost  = 7 x 0.8 (some R deletions) + 1 x 0.5 (fewer P subs) = 6.1
k=3 norm  = 6.1 / 53 = 0.115
```

In this case, k=2 actually has better norm_dist (0.049 vs 0.115), so there is no trap. But consider a noisier P (say 5 substitutions and 3 insertions) where the extra R phonemes in k=3 happen to absorb the noise:

```
Noisy scenario:
k=2 norm  = 0.085   (5 subs + 2 excess = 4.1 / 53)
k=3 norm  = 0.079   (3 subs + 1 excess + 3 deletions = 4.2 / 53)
```

The k=3 norm is marginally better (0.079 vs 0.085) because the extra R phonemes in the third pass absorb ASR insertions that k=2 must pay for. But k=2 is the true explanation.

---

#### Algorithm 1: Decomposition Enumeration

With no split penalty, decomposition enumeration picks k=3 (norm = 0.079) over k=2 (norm = 0.085). **This is the wrong answer** -- the 0.006 improvement comes from overfitting to noise, not from a real third pass.

The algorithm has no mechanism to prefer simpler decompositions. Adding a UCHIME-style split penalty (e.g., adding 0.02 per additional pass to norm_dist) would fix this:

```
k=2 penalized norm = 0.085 + 0.02 x 1 = 0.105
k=3 penalized norm = 0.079 + 0.02 x 2 = 0.119
k=2 wins (correct)
```

**Without a split penalty, decomposition enumeration is vulnerable to over-decomposition.**

---

#### Algorithm 2: Wraparound DP

The wrap penalty naturally handles this. Each wrap costs 2.0 points:

```
k=2 path: 1 wrap x 2.0 = 2.0 penalty
k=3 path: 2 wraps x 2.0 = 4.0 penalty
```

Total costs (noisy scenario):
```
k=2: 4.1 (alignment) + 2.0 (wrap) = 6.1  →  norm = 6.1/53 = 0.115
k=3: 4.2 (alignment) + 4.0 (wraps) = 8.2  →  norm = 8.2/53 = 0.155
k=2 wins (correct)
```

**The wrap penalty provides a built-in Occam's razor.** The k=3 path must save more than 2.0 cost units per additional wrap to justify the extra complexity. A marginal 0.3-point improvement in alignment cost is overwhelmed by the 2.0 wrap penalty.

---

#### Algorithm 3: Partition DP

The segment penalty similarly resists over-decomposition:

```
k=2: 4.1 (alignment) + 2.0 (1 extra segment) = 6.1
k=3: 4.2 (alignment) + 4.0 (2 extra segments) = 8.2
k=2 wins (correct)
```

**Same mechanism as wraparound DP** -- the segment penalty and wrap penalty serve identical roles.

---

#### Example 6 Analysis

| Algorithm | k=2 cost | k=3 cost | Winner | Correct? |
|-----------|---------|---------|--------|----------|
| Decomp Enum (no penalty) | 4.1 | 4.2 (lower norm) | k=3 | **No** |
| Decomp Enum (with 0.02/pass) | 0.105 | 0.119 | k=2 | Yes |
| Wraparound DP (wrap=2.0) | 6.1 | 8.2 | k=2 | **Yes** |
| Partition DP (seg=2.0) | 6.1 | 8.2 | k=2 | **Yes** |

**Key finding:** Decomposition enumeration needs an explicit split penalty (borrowed from UCHIME -- see [literature-review.md](literature-review.md), Section 4) to resist over-decomposition. Wraparound DP and Partition DP have this built in via their wrap/segment penalties.

This motivates adding a `REPETITION_PASS_PENALTY` constant to the enumeration approach:
```python
penalized_norm = norm_dist + REPETITION_PASS_PENALTY * (k - 1)
```

---

## Comparison Table

| Example | Ground Truth | Enum | Wrap | Partition | Enum Cost | Wrap Cost | Part Cost |
|---------|-------------|------|------|-----------|-----------|-----------|-----------|
| 1. Short suffix (4w) | [w0-w3, w2-w3] | Correct | Correct | Correct | 12k | 3.1k | 50k |
| 2. Long small (25w) | [w0-w24, w22-w24] | Correct | Correct | Correct | 2M | 31k | 600k |
| 3. Middle restart (7w) | [w0-w6, w3-w6] | Correct | Correct | Correct | 28k | 4.3k | 40k |
| 4. Multi-pass k=3 (11w) | [w0-w6, w4-w8, w7-w10] | Correct | Correct | Correct | 400k | 15k | 120k |
| 5. Ambiguous (6w) | [w6-w11, w9-w11] | Correct | Correct | Correct | 27k | 3.4k | 35k |
| 6. Over-decomp (7w, noisy) | k=2 [w0-w6, w5-w6] | **Wrong** (k=3) | Correct | Correct | 28k | 4.3k | 40k |

---

## Analysis

### Accuracy

For clean cases (Examples 1-5), all three algorithms find the correct decomposition. The differences emerge in edge cases:

- **Over-decomposition (Example 6):** Decomposition enumeration without a split penalty picks the overfitting k=3 decomposition. This is the only accuracy failure across all examples, and it is fixed by adding a per-pass penalty term.
- **Ambiguous cases (Example 5):** All three handle this well because length constraints dominate phonemic similarity.

### Computational Cost

| Algorithm | Best case (4w) | Worst case (25w) | Scaling |
|-----------|---------------|-----------------|---------|
| Decomp Enum | 12k | 2M | O(W^4 x |P| x |R|) -- candidate count grows as W^4 for k=3 |
| Wraparound DP | 3.1k | 31k | O(|P| x |R| x K) -- linear in max passes |
| Partition DP | 50k | 600k | O(B^2 x W^2 x DP) -- quadratic in break points |

Wraparound DP is consistently 4-64x cheaper than decomposition enumeration and 10-20x cheaper than partition DP. The gap grows with word count because candidate enumeration scales combinatorially while wraparound DP scales linearly.

### Scalability at 25+ Words

At W=25, decomposition enumeration generates ~550 k=2 + ~10k k=3 raw candidates. After filtering, ~110 remain. At W=40 (long verses), k=3 raw candidates would exceed 50k, with ~300+ after filtering. Each DP call at this scale is O(200 x 250) = 50k ops, giving ~15M total ops per suspicious segment.

Wraparound DP at W=40: one DP call of O(200 x 180 x 3) = ~108k ops. **139x cheaper.**

Partition DP at W=40: B ~ 40 break candidates, ~**3M ops**. Still 5x cheaper than enumeration.

### Implementation Complexity

| Algorithm | Lines of new code | Modifies existing DP? | New data structures? |
|-----------|------------------|----------------------|---------------------|
| Decomp Enum | ~80 (candidate gen + wrapper) | No | None |
| Wraparound DP | ~150 (modified DP + traceback) | **Yes** (`_dp_core.pyx`) | Extended matrix |
| Partition DP | ~120 (1D DP + inner alignment) | No | 1D DP table |

Decomposition enumeration is the simplest to implement -- it wraps the existing DP without modification. Wraparound DP requires changes to the Cython-accelerated DP core, which is the most sensitive code in the pipeline. Partition DP is intermediate -- new code but no changes to existing infrastructure.

### Graceful Degradation

How does each algorithm behave with very noisy ASR (15-20% error rate)?

- **Decomp Enum:** More noise means worse norm_dist for all candidates, but the relative ranking is preserved. The quality floor (`REPETITION_MAX_NORM_DIST = 0.25`) rejects degenerate cases. Robust.
- **Wraparound DP:** Noise increases the base alignment cost, but wrap decisions are relative (wrap vs no-wrap), so the DP still finds wraps when they reduce cost. The wrap penalty might cause a missed detection if noise is so high that the wrap savings barely exceed the penalty. Slightly less robust for marginal cases.
- **Partition DP:** The inner alignment calls each independently handle noise. The segment penalty might cause under-segmentation in high-noise scenarios. Similar to wraparound DP in robustness.

### Recommendation

**v1: Decomposition Enumeration** with an added per-pass penalty (from Example 6).
- Simplest implementation -- wraps existing infrastructure
- ~80 lines of new code, zero changes to `_dp_core.pyx`
- Computational cost is acceptable: ~50-100 candidates per suspicious segment, ~500k-2M ops, well under 1% of extraction time
- The per-pass penalty (`REPETITION_PASS_PENALTY = 0.02`) fixes the over-decomposition vulnerability

**v2: Wraparound DP** if enumeration proves to be a bottleneck at scale.
- 4-64x computational savings
- Built-in Occam's razor via wrap penalty
- Requires modifying the Cython DP core -- higher implementation risk
- Best suited for a dedicated effort after the v1 approach is validated on real data

**Partition DP** is not recommended as a primary approach. It is more expensive than wraparound DP, requires more inner alignment calls, and offers no accuracy advantage. Its main value is as a conceptual validation that P-side segmentation and R-side decomposition converge to the same answer.
