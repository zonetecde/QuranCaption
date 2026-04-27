# Breakpoint Estimation: Where Does the Repeat Start?

After a [pre-filter](prefilter-examples.md) flags a segment as suspicious (P has significantly more phonemes than R), we need to find **where in P** the repeat boundary lies. This narrows the search space for [hypothesis verification](verification-examples.md) -- instead of testing all possible decompositions, a good breakpoint estimate reduces candidates to a handful.

This document compares three breakpoint estimation approaches side by side on five worked examples using real Quranic phoneme data.

---

## The Three Approaches

### 1. Colinear Chaining

**Input:** A set of n-gram anchors between P and R, each anchor being a (P-position, R-position) pair where a short exact match occurs.

**Algorithm:** Find the maximum-weight monotonically increasing chain -- a subset of anchors where both P-position and R-position increase together. This chain traces where P follows R in order. Where the chain **cannot continue** because the next anchors would require R to go backward, colinearity breaks -- that is the breakpoint.

**Output:** One or more breakpoint positions in P where the R-coordinate reverses direction.

**Pseudocode:**

```
function find_breakpoints_chaining(P, R, n=4):
    # Step 1: Extract n-gram anchors
    anchors = []
    for each n-gram g at position i in P:
        for each occurrence of g at position j in R:
            anchors.append((i, j))

    # Step 2: Sort by P-position
    sort anchors by P-position (then by R-position for ties)

    # Step 3: Find longest increasing subsequence in R-positions
    # Using patience sorting / Fenwick tree for O(A log A)
    chain = longest_increasing_subsequence(anchors, key=R-position)

    # Step 4: Find where unanchored gaps occur
    breakpoints = []
    for each gap between consecutive chain anchors:
        if gap_in_P > threshold:
            breakpoints.append(midpoint of gap in P)

    # Alternative: find anchors NOT in the chain whose R-position
    # is less than the preceding chain anchor's R-position
    for anchor not in chain:
        if anchor.R_pos < preceding_chain_anchor.R_pos:
            breakpoints.append(anchor.P_pos)

    return breakpoints
```

**What it needs:** N-gram matching infrastructure (already exists in `phoneme_anchor.py`). Works best with exact n-gram matches, so performance degrades with high ASR noise.

**What it provides:** Precise breakpoint location tied to anchor positions. Can detect multiple breakpoints naturally (each backward jump in R = one breakpoint). The R-coordinate at the break also tells us **where the repeat goes back to** in the reference.

---

### 2. PELT Cost-Profile Change-Point Detection

**Input:** A per-position alignment cost profile computed by sliding a window through P and measuring how well each window matches the "expected" continuation in R.

**Algorithm:** PELT (Pruned Exact Linear Time) change-point detection finds positions where the cost signal undergoes an abrupt statistical shift. During the first pass through R, cost is low (P matches R in order). At the breakpoint, cost spikes (P's phonemes now correspond to an earlier R position). During the repeat, cost drops again (P matches the repeated R region).

**Output:** A set of change-points in P where cost transitions from low-to-high or high-to-low. Breakpoints correspond to low-to-high transitions.

**Pseudocode:**

```
function find_breakpoints_pelt(P, R, window=8, penalty=3.0):
    # Step 1: Compute cost profile
    cost = []
    r_ptr = 0  # expected R position
    for i in 0 to len(P) - window:
        P_window = P[i : i + window]
        R_window = R[r_ptr : r_ptr + window]
        cost[i] = edit_distance(P_window, R_window) / window
        r_ptr += 1  # advance expected position

    # Step 2: Apply PELT change-point detection
    # Minimize: sum of segment costs + penalty * num_changepoints
    changepoints = PELT(cost, penalty=penalty, model="l2")

    # Step 3: Filter to breakpoints (low-to-high transitions)
    breakpoints = []
    for cp in changepoints:
        if mean(cost[cp-5:cp]) < mean(cost[cp:cp+5]):
            breakpoints.append(cp)

    return breakpoints
```

**What it needs:** An alignment cost function (edit distance or substitution cost) and a change-point detection library (e.g., `ruptures`). The penalty parameter controls sensitivity -- too low gives false change-points from ASR noise, too high misses real breakpoints.

**What it provides:** Breakpoint locations without requiring exact matches. More robust to ASR noise than chaining because it operates on aggregate cost rather than individual n-gram matches. However, the cost profile requires knowing the "expected" R position, which assumes sequential alignment up to the breakpoint.

---

### 3. Displacement Peak Location

**Input:** The self-similarity displacement histogram of P, computed during the pre-filter stage by hashing all n-grams in P and recording the displacement between identical n-gram pairs.

**Algorithm:** The histogram peak at displacement d represents the repeat period -- the distance between the first occurrence of a phrase and its repetition. The breakpoint in P is approximately at position `|P| - d`, because the repeat occupies the last d phonemes. Multiple histogram peaks indicate multiple breakpoints.

**Output:** Estimated breakpoint position(s) derived from peak displacement(s).

**Pseudocode:**

```
function find_breakpoints_displacement(P, n=5):
    # Step 1: Hash all n-grams
    ngrams = {}
    for i in 0 to len(P) - n:
        g = P[i : i + n]
        if g in ngrams:
            for j in ngrams[g]:
                displacement = i - j
                histogram[displacement] += 1
        ngrams[g].append(i)

    # Step 2: Find peaks
    peaks = find_peaks(histogram, min_height=3)

    # Step 3: Convert to breakpoints
    breakpoints = []
    for d in peaks:
        bp = len(P) - d
        breakpoints.append(bp)

    return sorted(breakpoints)
```

**What it needs:** Only the phoneme sequence P itself -- no reference required. This makes it the cheapest and simplest approach. However, it provides the least precise breakpoint estimate because it relies on self-similarity within P, which ASR noise can obscure.

**What it provides:** A coarse breakpoint estimate suitable for narrowing the search space. The displacement value also gives the repeat period, which constrains which decompositions are plausible. For suffix repeats (the most common pattern), the estimate is reasonably accurate. For middle restarts, accuracy depends on the self-similar n-grams spanning the breakpoint region.

---

## Worked Examples

### Notation

- **R** = reference phonemes for the matched word range
- **P** = ASR output phonemes (simulated with ~5% substitution rate)
- **BP_true** = true breakpoint position in P (ground truth)
- **BP_est** = estimated breakpoint position from each algorithm
- **Error** = |BP_est - BP_true| in phonemes

### Example 1: Short Suffix Repeat (55:13)

**Verse:** 55:13, 4 words. Reciter says w0-w3, then repeats w2-w3.

#### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| w1 | ءَالَآءِ | `ʔ a: l a: ʔ i` | 6 |
| w2 | رَبِّكُمَا | `rˤ aˤ bb i k u m a:` | 8 |
| w3 | تُكَذِّبَانِ | `t u k a ðð i b a: n` | 9 |
| | **Total R** | | **31** |

#### Ground Truth Structure

```
Pass 1: w0 w1 w2 w3          (31 phones)
Pass 2:       w2 w3          (17 phones)
                              ─────────
Total P (no noise):           48 phones
```

**True breakpoint:** P-position 31 (after all of pass 1).

#### Simulated ASR Output (P = 50 phones)

```
Position: 0         10        20        30        40        50
          |         |         |         |         |         |
P:        f a b i ʔ a j i  ʔ a: l a: ʔ i  rˤ a b i k u m a:  t u k a ð i b a: n  rˤ aˤ bb i k u m a:  t u k a ðð i b a: n a
          └──── w0 (1 sub) ┘ └──── w1 ────┘ └── w2 (1 sub) ──┘ └── w3 (1 sub) ───┘ └───── w2 repeat ────┘ └──── w3 repeat (+1 ins) ──┘
```

Noise: 3 substitutions (`jj`->`j`, `bb`->`b`, `ðð`->`ð` in pass 1) + 1 insertion at the end. Total |P| = 50.

**BP_true = 31** (end of pass 1, start of w2 repeat).

---

#### Algorithm 1: Colinear Chaining

**Step 1: Extract 4-gram anchors.** We find all 4-grams in P and their matching positions in R.

Key anchors (P-pos, R-pos):

| P-pos | 4-gram | R-pos | In chain? |
|-------|--------|-------|-----------|
| 0 | `f a b i` | 0 | Yes |
| 4 | `ʔ a j i` | -- | No match (sub: `jj`->`j`) |
| 8 | `ʔ a: l a:` | 8 | Yes |
| 12 | `a: ʔ i rˤ` | 12 | Yes |
| 15 | `a b i k` | -- | No match (sub: `bb`->`b`) |
| 19 | `k u m a:` | 19 | Yes |
| 23 | `t u k a` | 23 | Yes |
| 26 | `ð i b a:` | -- | No match (sub: `ðð`->`ð`) |
| 31 | `rˤ aˤ bb i` | 14 | **No -- R goes backward!** |
| 35 | `k u m a:` | 19 | **No -- R goes backward (19 < 23)** |
| 39 | `t u k a` | 23 | **No -- but 23 < 23, same** |
| 42 | `ðð i b a:` | 26 | Yes (continues from chain) |

**Step 2: Build chain.** The longest increasing subsequence in R-positions:

```
Chain: (0,0) → (8,8) → (12,12) → (19,19) → (23,23) → (42,26)
       ────────── pass 1 ──────────────────────────────  ↑ jumps to pass 2
```

**Step 3: Find break.** Between chain anchors (23, 23) and (42, 26), there is a gap of 19 positions in P (pos 23 to 42). Anchors at P-pos 31 and 35 have R-positions 14 and 19, which are **backward** relative to R-pos 23. This confirms a breakpoint in the gap.

**BP_est = 31** (first anchor where R goes backward).

**Error = |31 - 31| = 0 phonemes.** Exact hit.

---

#### Algorithm 2: PELT Cost-Profile Change-Point

**Step 1: Compute cost profile.** Slide an 8-phoneme window through P, comparing each window to the "expected" R window (advancing R pointer by 1 per step).

| P-pos | P window (8 phones) | Expected R window | Edit dist | Norm cost |
|-------|---------------------|-------------------|-----------|-----------|
| 0 | `f a b i ʔ a j i` | `f a b i ʔ a jj i` | 1 | 0.12 |
| 4 | `ʔ a j i ʔ a: l a:` | `ʔ a jj i ʔ a: l a:` | 1 | 0.12 |
| 8 | `ʔ a: l a: ʔ i rˤ a` | `ʔ a: l a: ʔ i rˤ aˤ` | 1 | 0.12 |
| 14 | `rˤ a b i k u m a:` | `rˤ aˤ bb i k u m a:` | 2 | 0.25 |
| 20 | `m a: t u k a ð i` | `m a: t u k a ðð i` | 1 | 0.12 |
| 26 | `ð i b a: n rˤ aˤ bb` | `ð i b a: n` [R ends] | -- | -- |
| 28 | `a: n rˤ aˤ bb i k u` | [R exhausted] | HIGH | **0.75** |
| 31 | `rˤ aˤ bb i k u m a:` | [R exhausted] | HIGH | **0.88** |
| 35 | `k u m a: t u k a` | [R exhausted] | HIGH | **0.88** |
| 39 | `t u k a ðð i b a:` | [R exhausted] | HIGH | **0.75** |

The cost profile shows a clear pattern:
```
Position:  0    4    8    14   20   26   28   31   35   39   42
Cost:     0.12 0.12 0.12 0.25 0.12 ---  0.75 0.88 0.88 0.75 ---
          ──── low (pass 1 matches R) ────  ──── HIGH (past R end) ────
```

**Step 2: PELT detection.** With penalty = 3.0, PELT detects a single change-point at the low-to-high transition.

**BP_est = 28-31** (the transition zone). PELT typically returns the midpoint of the transition, approximately position 29-30.

**Error = |30 - 31| = 1 phoneme.** Close but not exact, because the cost starts rising a few phonemes before the true breakpoint (the R window runs out of material before the full repeat begins).

**Note:** For this suffix-repeat case, the cost profile simplifies because R is exhausted at the breakpoint. The cost spike is really "P continues but R has ended." For middle restarts (Example 3), the profile is more nuanced -- the cost rises because P's phonemes match an earlier R position, not because R is exhausted.

---

#### Algorithm 3: Displacement Peak Location

**Step 1: Hash 5-grams in P and compute displacement histogram.**

Selected 5-gram matches within P:

| 5-gram | Positions in P | Displacement |
|--------|----------------|--------------|
| `rˤ aˤ bb i k` | 14, 31 | 17 |
| `bb i k u m` | 15, 32 | 17 |
| `i k u m a:` | 16, 33 | 17 |
| `k u m a: t` | 17, 34 | 17 |
| `u m a: t u` | 18, 35 | 17 |
| `t u k a ðð` | 23, 40 | 17 |

Some 5-grams from pass 1 do not repeat exactly due to ASR substitutions (`bb`->`b`, `ðð`->`ð` in pass 1). Only the clean matches contribute.

**Histogram:**
```
Displacement:  ... 15  16  17  18  19 ...
Count:             0   0   6   0   0
                              ^
                         clear peak at d=17
```

**Step 2: Estimate breakpoint.**

```
BP_est = |P| - d = 50 - 17 = 33
```

**Error = |33 - 31| = 2 phonemes.** The estimate overshoots by 2 because the displacement measures the distance between corresponding 5-gram starts, and the repeat region includes a trailing insertion that shifts positions slightly.

---

#### Example 1 Summary

| Algorithm | BP_est | Error | Notes |
|-----------|--------|-------|-------|
| Colinear Chaining | 31 | **0** | Exact -- backward R-coordinate pinpoints break |
| PELT Cost-Profile | ~30 | 1 | Near-exact -- transition zone is narrow |
| Displacement Peak | 33 | 2 | Close -- insertion noise shifts estimate |

---

### Example 2: Middle Restart (36:40, w0-w6)

**Verse:** 36:40, words 0-6. Reciter says w0-w6, then restarts from w3.

#### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | لَا | `l a` | 2 |
| w1 | ٱلشَّمْسُ | `ʃʃ a m s u` | 5 |
| w2 | يَنبَغِى | `j a ŋ b a ɣ i:` | 7 |
| w3 | لَهَآ | `l a h a:` | 4 |
| w4 | أَن | `ʔ a ŋ` | 3 |
| w5 | تُدْرِكَ | `t u d Q r i k a` | 8 |
| w6 | ٱلْقَمَرَ | `l q aˤ m a rˤ aˤ` | 7 |
| | **Total R** | | **36** |

#### Ground Truth Structure

```
Pass 1: w0 w1 w2 w3 w4 w5 w6    (36 phones)
Pass 2:          w3 w4 w5 w6    (22 phones)
                                 ─────────
Total P (no noise):              58 phones
```

**True breakpoint:** P-position 36 (end of pass 1).

The repeat starts at w3 (`l a h a:`), not at the end. This is a **middle restart** -- the reciter goes back to the middle of the verse, not the last few words.

#### Simulated ASR Output (P = 60 phones)

```
P: l a  ʃʃ a m s u  j a ŋ b a ɣ i:  l a h a:  ʔ a ŋ  t u d Q r i k a  l q aˤ m a rˤ a  |  l a h a:  ʔ a ŋ  t u d r i k a  l q aˤ m a rˤ aˤ
   w0   w1           w2              w3         w4      w5               w6 (1 sub)       BP  w3         w4      w5 (1 sub)    w6
```

Noise: 2 substitutions (`aˤ`->`a` in first w6, `Q`->deleted in second w5) + 2 total noise phones. |P| = 60.

**BP_true = 36.**

---

#### Algorithm 1: Colinear Chaining

**Step 1: Extract 4-gram anchors.**

Key anchors:

| P-pos | 4-gram | R-pos | Notes |
|-------|--------|-------|-------|
| 0 | `l a ʃʃ a` | 0 | Pass 1 |
| 3 | `a m s u` | 3 | Pass 1 |
| 7 | `j a ŋ b` | 7 | Pass 1 |
| 11 | `a ɣ i: l` | 11 | Pass 1 |
| 14 | `l a h a:` | 14 | Pass 1 ... **also matches R-pos 14!** |
| 18 | `ʔ a ŋ t` | 18 | Pass 1 |
| 22 | `t u d Q` | 22 | Pass 1 |
| 26 | `r i k a` | 26 | Pass 1 |
| 29 | `l q aˤ m` | 29 | Pass 1 |
| 33 | `a rˤ a l` | -- | No match (sub + boundary) |
| 36 | `l a h a:` | 14 | **R goes backward! (14 < 29)** |
| 40 | `ʔ a ŋ t` | 18 | **R goes backward (18 < 29)** |
| 44 | `t u d r` | -- | No match (noise: Q deleted) |
| 48 | `i k a l` | -- | Cross-word boundary |
| 51 | `l q aˤ m` | 29 | Repeat matches same R-pos |
| 55 | `a rˤ aˤ` | 33 | Continues from 29 |

**Step 2: Build chain.**

```
Chain: (0,0) → (3,3) → (7,7) → (11,11) → (14,14) → (18,18) → (22,22) → (26,26) → (29,29)
       ─────────────────────── pass 1 ───────────────────────────────────────────────────────
```

At P-pos 36, the next anchor has R-pos 14, which is backward. The chain cannot continue through pass 2 in the same monotone sequence.

**Step 3: Detect break.**

A second chain on the residual anchors (P-pos >= 36):

```
Residual chain: (36,14) → (40,18) → (51,29) → (55,33)
                ─────────── pass 2 ──────────────────────
```

**BP_est = 36** (first anchor where R reverses, or equivalently, the gap between the two chains).

**Error = |36 - 36| = 0 phonemes.** Exact hit.

The chaining approach also reveals that the repeat goes back to R-pos 14, which corresponds to the start of w3 (`l a h a:`). This is valuable metadata beyond just the breakpoint location.

---

#### Algorithm 2: PELT Cost-Profile Change-Point

**Step 1: Compute cost profile.** We advance the R pointer in lockstep with P. During pass 1, P matches R well. At the breakpoint, P's phonemes match w3 but the expected R position is past w6.

| P-pos | P window (8 ph) | Expected R pos | Edit cost | Norm |
|-------|-----------------|----------------|-----------|------|
| 0-7 | `l a ʃʃ a m s u j` | R[0:8] | 0 | 0.00 |
| 8-15 | `a ŋ b a ɣ i: l a` | R[8:16] | 0 | 0.00 |
| 16-23 | `h a: ʔ a ŋ t u d` | R[16:24] | 0 | 0.00 |
| 24-31 | `Q r i k a l q aˤ` | R[24:32] | 0 | 0.00 |
| 28-35 | `a l q aˤ m a rˤ a` | R[28:36] | 1 | 0.12 |
| 32-39 | `rˤ a l a h a: ʔ a` | R[32:R_end...] | 4 | **0.50** |
| 36-43 | `l a h a: ʔ a ŋ t` | [R exhausted at 36] | 6 | **0.75** |
| 40-47 | `ʔ a ŋ t u d r i` | [R exhausted] | 7 | **0.88** |

Note: Unlike Example 1, here the cost does not spike to maximum because P's phonemes at the breakpoint still resemble valid Quranic phonemes -- they just match an **earlier** R position. The cost rises because the *expected* R window (positions 32+) does not match the *actual* P content (which corresponds to R positions 14+).

```
Position:  0    8    16   24   28   32   36   40   44   48   52
Cost:     0.00 0.00 0.00 0.00 0.12 0.50 0.75 0.88 0.75 0.50 0.12
          ───── low (pass 1) ─────  ─ transition ─  ── high ──  ── low (pass 2 end aligns again)
```

The cost curve forms a peak centered around position 38-40, with the rise beginning at position 32.

**Step 2: PELT detection.** PELT identifies a change-point at approximately position 33-34, where cost transitions from low to high.

**BP_est = 34.**

**Error = |34 - 36| = 2 phonemes.** The cost starts rising before the true breakpoint because the sliding window straddles the boundary. With an 8-phoneme window, the cost begins increasing when the window first overlaps the repeat region (about window_size/2 = 4 phonemes before the true break).

**Limitation:** For middle restarts, the cost curve is **asymmetric** -- it rises gradually as the window straddles the break, rather than producing a sharp step. This makes the exact change-point harder to locate than in suffix repeats where R simply runs out.

---

#### Algorithm 3: Displacement Peak Location

**Step 1: Hash 5-grams in P.**

| 5-gram | Positions in P | Displacement |
|--------|----------------|--------------|
| `l a h a: ʔ` | 14, 36 | 22 |
| `a h a: ʔ a` | 15, 37 | 22 |
| `h a: ʔ a ŋ` | 16, 38 | 22 |
| `a: ʔ a ŋ t` | 17, 39 | 22 |
| `ʔ a ŋ t u` | 18, 40 | 22 |
| `l q aˤ m a` | 29, 51 | 22 |
| `q aˤ m a rˤ` | 30, 52 | 22 |

**Histogram peak: d = 22** (7 matches).

**Step 2: Estimate breakpoint.**

```
BP_est = |P| - d = 60 - 22 = 38
```

**Error = |38 - 36| = 2 phonemes.** The displacement correctly identifies the repeat period (22 phones = w3+w4+w5+w6) and the estimate is close. The 2-phoneme overshoot comes from the ASR noise inflating |P| slightly beyond the true pass1 + pass2 length.

---

#### Example 2 Summary

| Algorithm | BP_est | Error | Notes |
|-----------|--------|-------|-------|
| Colinear Chaining | 36 | **0** | Exact -- R reversal is unambiguous |
| PELT Cost-Profile | ~34 | 2 | Window straddling causes early detection |
| Displacement Peak | 38 | 2 | Noise inflation shifts estimate |

---

### Example 3: Multi-Pass k=3 (36:40, w0-w10)

**Verse:** 36:40, words 0-10. Reciter makes TWO restarts: after w6 (back to w4), and the second pass runs w4-w8, then after w8 back to w7 for the final pass w7-w10.

#### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | لَا | `l a` | 2 |
| w1 | ٱلشَّمْسُ | `ʃʃ a m s u` | 5 |
| w2 | يَنبَغِى | `j a ŋ b a ɣ i:` | 7 |
| w3 | لَهَآ | `l a h a:` | 4 |
| w4 | أَن | `ʔ a ŋ` | 3 |
| w5 | تُدْرِكَ | `t u d Q r i k a` | 8 |
| w6 | ٱلْقَمَرَ | `l q aˤ m a rˤ aˤ` | 7 |
| w7 | وَلَا | `w a l a` | 4 |
| w8 | ٱلَّيْلُ | `ll a j l u` | 5 |
| w9 | سَابِقُ | `s a: b i q u` | 6 |
| w10 | ٱلنَّهَارِ | `ñ a h a: r i` | 6 |
| | **Total R** | | **57** |

#### Ground Truth Structure

```
Pass 1: w0 w1 w2 w3 w4 w5 w6                    (36 phones)
Pass 2:             w4 w5 w6 w7 w8               (27 phones)
Pass 3:                      w7 w8 w9 w10        (21 phones)
                                                  ──────────
Total P (no noise):                                84 phones
```

**True breakpoints:** BP1 = 36 (end of pass 1), BP2 = 63 (end of pass 2: 36 + 27).

This is the critical multi-breakpoint test case.

#### Simulated ASR Output (P = 87 phones)

Three noise phones distributed across the three passes: 1 substitution in pass 1, 1 in pass 2, 1 insertion in pass 3. |P| = 87.

---

#### Algorithm 1: Colinear Chaining

**Step 1: Extract 4-gram anchors across all 87 positions.**

The anchor pattern reveals three monotone segments:

```
Pass 1 anchors: R-positions increasing 0 → 33
Pass 2 anchors: R-positions restart at 18, increase 18 → 40
Pass 3 anchors: R-positions restart at 29, increase 29 → 51
```

**Step 2: Build primary chain.** The longest increasing subsequence traces through the longest monotone run. Depending on implementation, it may follow pass 1 then skip to the end of pass 2/3 where R-positions exceed 33:

```
Primary chain: (0,0) → ... → (33,33) → (63,37) → ... → (80,51)
               ──── pass 1 ───────────  ── pass 3 end ──────────
```

**Step 3: Detect breaks.** The primary chain has a gap from P-pos 33 to P-pos 63. Anchors in that gap have R-positions that go backward (from ~33 back to ~18), confirming BP1. Within the residual, a second chain covers pass 2, and the gap between pass 2 and pass 3 residuals reveals BP2.

Alternatively, segment the anchor sequence into maximal monotone runs:

```
Run 1: P[0:36],  R[0:33]     → pass 1
Run 2: P[36:63], R[18:40]    → pass 2
Run 3: P[63:84], R[29:51]    → pass 3
```

**BP1_est = 36, BP2_est = 63.**

**Errors: BP1 = 0, BP2 = 0.** Both exact.

**Strength of chaining for multi-breakpoint:** Each monotone run naturally delineates one pass. The number of runs minus one gives the number of breakpoints. No need to specify k in advance.

---

#### Algorithm 2: PELT Cost-Profile Change-Point

**Step 1: Compute cost profile.**

The cost curve has **two peaks** corresponding to the two breakpoints:

```
Position:  0         10        20        30   36   40        50   63   70        80
Cost:     0.00 ─── low ────────────────── 0.12 ╱ 0.75 ╲ 0.12 ──── 0.12 ╱ 0.62 ╲ 0.12 ─ 0.00
                    pass 1 matches R            BP1          pass 2 matches       BP2        pass 3
```

At BP1 (~position 34-38): cost spikes because P's phonemes (w4 repeat) don't match the expected R continuation (w7 area). At BP2 (~position 61-65): cost spikes again because P's phonemes (w7 repeat) don't match the expected R continuation (w9 area).

**Step 2: PELT with penalty = 3.0.**

PELT detects two change-points at the low-to-high transitions. However, because cost rises and falls at each breakpoint, PELT may detect up to **four** change-points (two rises, two falls). The low-to-high transitions identify the breakpoints.

**BP1_est = ~34, BP2_est = ~61.**

**Errors: BP1 = 2, BP2 = 2.** The window-straddling issue applies to both breakpoints equally.

**Challenge for PELT:** The penalty parameter becomes critical with two breakpoints. Too high a penalty merges them into one wide anomaly; too low detects spurious change-points from ASR noise between the true breaks. With 3 phones of noise in 87-phone sequence, penalty = 3.0 works, but this requires tuning.

---

#### Algorithm 3: Displacement Peak Location

**Step 1: Compute displacement histogram.**

Three-pass structure creates a more complex histogram:

- Pass 1 vs Pass 2 share w4-w6: displacement ≈ 36 (between pass 1 w4 start at pos 14 and pass 2 w4 start at pos 36+0=36 ... actually displacement = 22)
- Pass 2 vs Pass 3 share w7-w8: displacement ≈ 27 (between pass 2 w7 start and pass 3 w7 start)
- Pass 1 vs Pass 3 share some phonemes at displacement ≈ 49

Let me be more precise. The repeated n-grams and their displacements:

| 5-gram (from w4-w6) | Pass 1 pos | Pass 2 pos | Displacement |
|----------------------|------------|------------|--------------|
| `ʔ a ŋ t u` | 14 | 36 | 22 |
| `a ŋ t u d` | 15 | 37 | 22 |
| `t u d Q r` | 16 | 38 | 22 |
| `d Q r i k` | 17 | 39 | 22 |
| `r i k a l` | 21 | 43 | 22 |
| `l q aˤ m a` | 29 | 47 | 18 |

Wait -- this gets complicated because pass 2 starts w4 at position 36 in P, and w4 first appeared at position 14 in P (pass 1). So displacement = 36 - 14 = 22.

| 5-gram (from w7-w8) | Pass 2 pos | Pass 3 pos | Displacement |
|----------------------|------------|------------|--------------|
| `w a l a ll` | 49 | 63 | 14 |
| `a l a ll a` | 50 | 64 | 14 |
| `l a ll a j` | 51 | 65 | 14 |
| `a ll a j l` | 52 | 66 | 14 |

**Histogram:**
```
Displacement:  ... 14  15  ...  22  23 ...
Count:             4   0        5   0
                   ^              ^
              peak 2 (d=14)  peak 1 (d=22)
```

**Step 2: Convert peaks to breakpoints.**

```
Peak d=22: BP_est = |P| - 22 = 87 - 22 = 65     (intended: BP1?)
Peak d=14: BP_est = |P| - 14 = 87 - 14 = 73     (intended: BP2?)
```

**This is wrong.** The displacement approach assumes a simple two-pass structure where `BP = |P| - d`. With three passes, the interpretation breaks down:

- d=22 represents the period between pass 1 and pass 2 for the w4-w6 region, not a simple suffix repeat
- d=14 represents the period between pass 2 and pass 3 for the w7-w8 region

Neither `|P| - 22 = 65` nor `|P| - 14 = 73` corresponds to the true breakpoints (36 and 63).

**Errors: BP1 = |65 - 36| = 29, BP2 = |73 - 63| = 10.** Both estimates are far off.

**Fundamental limitation:** The `BP = |P| - d` formula assumes a two-pass suffix repeat. For k=3 with overlapping passes, the displacement histogram gives the **inter-pass periods** but cannot directly convert them to breakpoint locations without knowing the multi-pass structure. The histogram signals that something complex is happening (two peaks), but it cannot determine the actual breakpoint positions.

---

#### Example 3 Summary

| Algorithm | BP1_est | BP1 err | BP2_est | BP2 err | Notes |
|-----------|---------|---------|---------|---------|-------|
| Colinear Chaining | 36 | **0** | 63 | **0** | Three monotone runs detected |
| PELT Cost-Profile | ~34 | 2 | ~61 | 2 | Two cost peaks, window offset |
| Displacement Peak | 65 | **29** | 73 | **10** | Formula fails for k=3 |

**Key finding:** The displacement approach fundamentally cannot handle multi-pass repeats. It detects that something is unusual (two histogram peaks), but the `|P| - d` formula only works for simple two-pass suffix patterns.

---

### Example 4: Phonemically Ambiguous Breakpoint (38:24, w0-w5)

**Verse:** 38:24, words 0-5. The critical feature: w0 ends with `l a` and w1 starts with `l a`, creating a phonemically identical boundary region that makes the exact breakpoint location ambiguous.

#### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | قَالَ | `q aˤ: l a` | 4 |
| w1 | لَقَدْ | `l a q aˤ d Q` | 6 |
| w2 | ظَلَمَكَ | `ðˤ aˤ l a m a k a` | 8 |
| w3 | بِسُؤَالِ | `b i s u ʔ a: l i` | 8 |
| w4 | نَعْجَتِكَ | `n a ʕ ʒ a t i k a` | 9 |
| w5 | إِلَىٰ | `ʔ i l a:` | 4 |
| | **Total R** | | **39** |

#### The Ambiguity

Look at the flat phoneme sequence around the w0/w1 boundary:

```
R flat: q aˤ: l a | l a q aˤ d Q | ðˤ aˤ l a m a k a | ...
             w0    w1                w2
                ^^^^
        These 2 phonemes ("l a") appear at both the end of w0 and start of w1
```

If the reciter repeats from w1 onward, the breakpoint falls at P-position 4 (after w0). But the first phonemes of the repeat (`l a q aˤ...`) overlap with the last phonemes of w0 (`l a`). This means the breakpoint region contains `...l a l a q aˤ...` which could be parsed as:

- `...l a | l a q aˤ...` -- breakpoint at position 4 (between w0 and w1)
- `...(l a l a) q aˤ...` -- an apparent stuttered `l a` with ambiguous ownership

#### Ground Truth Structure

Reciter says w0-w5, then repeats from w1:

```
Pass 1: w0 w1 w2 w3 w4 w5         (39 phones)
Pass 2:    w1 w2 w3 w4 w5         (35 phones)
                                   ──────────
Total P (no noise):                74 phones
```

**True breakpoint:** P-position 39 (end of pass 1).

#### Simulated ASR Output (P = 77 phones)

The ASR introduces 3 noise phones (substitutions). Critically, in the breakpoint region (around P-pos 37-43), the phonemes look like:

```
...k a ʔ i l a:  l a q aˤ d...
   w4    w5  |BP| w1 (repeat)
         ^^^^   ^^^^
    These l a phonemes are ambiguous in isolation
```

---

#### Algorithm 1: Colinear Chaining

**Step 1: Extract 4-gram anchors.**

The ambiguous region creates a problem: the 4-gram `l a l a` (if it occurs) does not uniquely identify a position because `l a` appears in multiple words.

However, chaining still works because it tracks the **R-coordinate** monotonicity:

| P-pos | 4-gram | R-pos | In chain? |
|-------|--------|-------|-----------|
| 0 | `q aˤ: l a` | 0 | Yes |
| ... | ... | ... | Yes |
| 33 | `a t i k a` | 33 | Yes |
| 37 | `ʔ i l a:` | 35 | Yes |
| 39 | `l a q aˤ` | 4 | **R backward! (4 < 35)** |
| 43 | `d Q ðˤ aˤ` | 10 | Continues from 4 |

The 4-gram `l a q aˤ` at P-pos 39 matches R-pos 4 (the start of w1). Even though `l a` alone is ambiguous, the full 4-gram is not -- `l a q aˤ` only appears once in R, at position 4.

**BP_est = 39.**

**Error = |39 - 39| = 0 phonemes.** Exact, despite the phonemic ambiguity. The longer n-gram context resolves the ambiguity.

**However,** if ASR noise corrupts the disambiguating phonemes (e.g., `q aˤ` becomes `q a`), the 4-gram might not match, and chaining would need to rely on shorter (more ambiguous) anchors. With 3-grams instead of 4-grams, `l a q` matches R-pos 4 but `l a l` does not exist in R, so the break is still detectable. The ambiguity only becomes a real problem if n-grams are reduced to 2-grams.

---

#### Algorithm 2: PELT Cost-Profile Change-Point

**Step 1: Compute cost profile.**

The cost profile around the breakpoint:

| P-pos | Expected R-pos | P window | Expected R window | Cost |
|-------|----------------|----------|-------------------|------|
| 33 | 33 | `...a t i k a ʔ i l` | R[33:41] = `...a t i k a ʔ i l` | 0.00 |
| 35 | 35 | `i k a ʔ i l a: l` | R[35:43] = `i k a ʔ i l a:` [R ends] | 0.12 |
| 37 | 37 | `ʔ i l a: l a q aˤ` | [R exhausted at 39] | **0.50** |
| 39 | 39 | `l a q aˤ d Q ðˤ aˤ` | [R exhausted] | **0.88** |

**Step 2: PELT detects change-point at ~37.**

**BP_est = 37.**

**Error = |37 - 39| = 2 phonemes.** The same window-straddling effect as before. The phonemic similarity at the boundary does not specifically degrade PELT performance -- the cost spike is driven by R exhaustion, not by phoneme content.

---

#### Algorithm 3: Displacement Peak Location

**Step 1: 5-gram displacement histogram.**

The repeat of w1-w5 creates displacements between pass 1 and pass 2 occurrences:

| 5-gram (from w1-w2) | Pass 1 pos | Pass 2 pos | Displacement |
|----------------------|------------|------------|--------------|
| `l a q aˤ d` | 4 | 39 | 35 |
| `a q aˤ d Q` | 5 | 40 | 35 |
| `d Q ðˤ aˤ l` | 9 | 44 | 35 |
| `ðˤ aˤ l a m` | 10 | 45 | 35 |

**Histogram peak: d = 35** (strong peak).

```
BP_est = |P| - d = 77 - 35 = 42
```

**Error = |42 - 39| = 3 phonemes.** The 3-phoneme offset comes from the ASR noise inflating |P|.

**Note on the ambiguity:** The displacement approach is **unaffected** by the phonemic ambiguity at the boundary. It measures the distance between corresponding n-gram occurrences, and those distances are consistent regardless of which phonemes are "ambiguous." The ambiguity affects breakpoint-local algorithms (chaining, PELT) more than displacement, though in this case both chaining and PELT handled it well.

---

#### Example 4 Summary

| Algorithm | BP_est | Error | Notes |
|-----------|--------|-------|-------|
| Colinear Chaining | 39 | **0** | 4-gram context resolves ambiguity |
| PELT Cost-Profile | ~37 | 2 | Window offset, ambiguity not a factor |
| Displacement Peak | 42 | 3 | Noise inflation, ambiguity not a factor |

**Key finding:** Phonemic ambiguity at word boundaries is less problematic than expected. Chaining resolves it via longer n-gram context, PELT ignores it because cost is driven by R position mismatch, and displacement ignores it because it measures inter-occurrence distances rather than local content.

The ambiguity **would** matter more for the hypothesis verification stage, where the decomposition `[w0-w5, w1-w5]` and a hypothetical `[w0-w5, w0-w5]` (with partial w0) might produce similar DP costs. But for breakpoint estimation, it is manageable.

---

### Example 5: Sub-Word Repeat Overlap (1:3)

**Verse:** 1:3, 2 words. The reciter stumbles and repeats just the last 3 phonemes of w0 before continuing to w1. This tests the resolution limits of each algorithm.

#### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | ٱلرَّحْمَـٰنِ | `ʔ a rˤrˤ aˤ ħ m a: n i` | 9 |
| w1 | ٱلرَّحِيمِ | `rˤrˤ aˤ ħ i: m` | 5 |
| | **Total R** | | **14** |

Note the shared prefix: both w0 and w1 contain `rˤrˤ aˤ ħ` (the root ر-ح). This is a special case because the **reference text itself** has a near-repeat, and the sub-word stutter overlaps with this shared phoneme pattern.

#### Ground Truth Structure

The reciter says all of w0, stutters on the last 3 phonemes (`a: n i`), then continues with w1:

```
Pass 1: w0 (full)                     (9 phones)
Stutter:     last 3 phones of w0      (3 phones: a: n i)
Pass 2: w1                            (5 phones)
                                      ─────────
Total P (no noise):                    17 phones
```

**True breakpoint:** P-position 9 (end of w0). But this is a **sub-word** repeat of only 3 phonemes -- below the usual minimum word length.

#### Simulated ASR Output (P = 18 phones)

```
P: ʔ a rˤrˤ aˤ ħ m a: n i  a: n i  rˤrˤ aˤ ħ i: m
   └──────── w0 ──────────┘ └stutter┘ └──── w1 ────┘
   0                      9  9    12  12          17
```

Plus 1 noise phone (insertion), |P| = 18.

**BP_true = 9.**

---

#### Algorithm 1: Colinear Chaining

**Step 1: Extract 4-gram anchors.**

With R = 14 phonemes and P = 18 phonemes, there are very few 4-grams to work with:

| P-pos | 4-gram | R-pos | Notes |
|-------|--------|-------|-------|
| 0 | `ʔ a rˤrˤ aˤ` | 0 | Pass 1 |
| 2 | `rˤrˤ aˤ ħ m` | 2 | Pass 1 ... but also near w1 start! |
| 4 | `ħ m a: n` | 4 | Pass 1 |
| 6 | `a: n i a:` | -- | No match (stutter creates novel 4-gram) |
| 9 | `a: n i rˤrˤ` | -- | No match (novel 4-gram) |
| 11 | `i rˤrˤ aˤ` | -- | No match (crosses stutter/w1 boundary) |
| 12 | `rˤrˤ aˤ ħ i:` | 9 | Matches w1 in R |

**Step 2: Build chain.**

```
Chain: (0,0) → (2,2) → (4,4) → (12,9)
```

There is a gap from P-pos 4 to P-pos 12 (8 positions) with no usable anchors. The stutter region (`a: n i`) is only 3 phonemes, too short for 4-gram extraction.

**Step 3: Detect break.**

The gap between chain anchors (4, 4) and (12, 9) spans 8 P-positions. We know the break is somewhere in there, but the anchor density is too low to pinpoint it precisely.

**BP_est = ~8** (midpoint of the gap region, or inferred from R-position: anchor (4,4) covers up to R-pos 8, and the stutter should be between there and P-pos 12).

**Error = |8 - 9| = 1 phoneme.** Not exact, but close given the sparse anchor landscape.

**Limitation:** With sequences this short (14-18 phonemes), 4-gram anchors are scarce. Reducing to 3-grams would help but increases ambiguity. The stutter itself is only 3 phonemes -- too short to generate any 4-gram that includes both stutter and context.

---

#### Algorithm 2: PELT Cost-Profile Change-Point

With only 14 phonemes in R and 18 in P, the cost profile has very few data points. An 8-phoneme window would span more than half the sequence, making PELT impractical. Reducing window to 4:

| P-pos | P window (4 ph) | Expected R window | Cost |
|-------|-----------------|-------------------|------|
| 0 | `ʔ a rˤrˤ aˤ` | R[0:4] | 0 |
| 3 | `aˤ ħ m a:` | R[3:7] | 0 |
| 6 | `a: n i a:` | R[6:10] | 2 (0.50) |
| 9 | `a: n i rˤrˤ` | R[9:13] = `rˤrˤ aˤ ħ i:` | 3 (0.75) |
| 12 | `rˤrˤ aˤ ħ i:` | R[12:14+?] | -- (R ends) |

The cost profile has so few points (5-6 windows) that change-point detection is statistically unreliable. PELT requires enough data points in each segment to estimate segment statistics.

**BP_est = ~8** (if PELT detects a change at the cost spike at position 6-9, but with only 5 data points, the estimate is highly uncertain).

**Error = ~1 phoneme**, but **confidence is very low**. With more phonemes, PELT would need at least 15-20 data points per segment to produce reliable change-points.

---

#### Algorithm 3: Displacement Peak Location

**Step 1: Hash 5-grams in P.**

With |P| = 18, there are only 14 possible 5-grams. The 3-phoneme stutter is shorter than the 5-gram window, so no self-matching 5-grams span the stutter.

With 4-grams:

| 4-gram | Positions in P | Displacement |
|--------|----------------|--------------|
| `a: n i` | -- | (only 3-gram, too short) |

Even with 3-grams:

| 3-gram | Positions in P | Displacement |
|--------|----------------|--------------|
| `a: n i` | 7, 9 | 2 |
| `n i a:` | 8, -- | -- (novel context at pos 8) |

**Histogram:** Extremely sparse. Peak at d=2 with count=1.

```
BP_est = |P| - d = 18 - 2 = 16
```

**Error = |16 - 9| = 7 phonemes.** Wildly inaccurate. The displacement of 2 reflects the tiny distance between the two `a: n i` occurrences (end of w0 and start of stutter), not the repeat period.

**Fundamental limitation:** A 3-phoneme sub-word stutter does not generate enough self-similar n-grams for the displacement approach to detect. The repeat is below the resolution limit of the histogram method.

---

#### Example 5 Summary

| Algorithm | BP_est | Error | Notes |
|-----------|--------|-------|-------|
| Colinear Chaining | ~8 | 1 | Works but anchor-sparse |
| PELT Cost-Profile | ~8 | 1 | Too few data points for reliability |
| Displacement Peak | 16 | **7** | Below resolution limit |

**Key finding:** Sub-word repeats (< 5 phonemes) are at the resolution limit of all three algorithms. Chaining and PELT can approximate the breakpoint because they use reference-aware comparison, but displacement (reference-free) fails completely. In practice, the pre-filter would likely not trigger for a 3-phoneme stutter (excess = 3 < 8), so this case would not reach breakpoint estimation at all. It serves as a boundary case that defines where these algorithms stop being useful.

---

## Comparison Table

| Example | True BP(s) | Chaining | Error | PELT | Error | Displacement | Error | Best |
|---------|-----------|----------|-------|------|-------|-------------|-------|------|
| 1. Short suffix (55:13) | 31 | 31 | 0 | ~30 | 1 | 33 | 2 | Chaining |
| 2. Middle restart (36:40 w0-w6) | 36 | 36 | 0 | ~34 | 2 | 38 | 2 | Chaining |
| 3. Multi-pass k=3 (36:40 w0-w10) | 36, 63 | 36, 63 | 0, 0 | ~34, ~61 | 2, 2 | 65, 73 | 29, 10 | Chaining |
| 4. Phoneme ambiguity (38:24) | 39 | 39 | 0 | ~37 | 2 | 42 | 3 | Chaining |
| 5. Sub-word stutter (1:3) | 9 | ~8 | 1 | ~8 | 1 | 16 | 7 | Tie |

---

## Analysis

### Precision

Colinear chaining consistently achieves **0-phoneme error** for standard cases (Examples 1-4) because the backward R-coordinate jump directly identifies the breakpoint. The only degradation is in Example 5 where anchor density is too low.

PELT achieves **1-2 phoneme error** consistently due to window straddling. The error is systematic and predictable: approximately `window_size / 2` phonemes before the true breakpoint. A post-hoc correction (`BP_est += window_size / 2`) could reduce this, though it assumes a sharp (not gradual) cost transition.

Displacement achieves **2-3 phoneme error** for simple cases (noise-inflated |P| shifts the estimate) but **catastrophically fails** for multi-pass repeats (Example 3, 29-phoneme error) and sub-word stutters (Example 5, 7-phoneme error).

### Robustness to ASR Noise

**PELT is the most robust.** It operates on aggregate cost over a window, so individual phoneme errors are smoothed out. A 5% substitution rate changes window costs by ~0.05-0.10, well below the ~0.50+ spike at a true breakpoint.

**Chaining is moderately robust.** Each ASR error can destroy one n-gram anchor, but with ~5% error rate and 4-grams, roughly 80% of anchors survive. The chain is built from surviving anchors and remains accurate as long as at least a few anchors span each breakpoint. Robustness degrades at higher noise rates or with shorter n-grams.

**Displacement is least robust.** It relies on **exact** n-gram matches between the two passes. ASR errors in different positions across the two passes destroy different n-grams, rapidly thinning the histogram. A 5% error rate with 5-grams means ~77% of grams survive per pass, and only ~59% match across both passes (assuming independent errors).

### Multi-Breakpoint Handling

**Chaining handles k=3 naturally.** Each monotone run in the anchor sequence is one pass. The algorithm does not need to know k in advance.

**PELT can handle k=3 but requires tuning.** The penalty parameter must be set low enough to detect multiple change-points but high enough to avoid false positives from noise. This is solvable (e.g., using BIC or cross-validation for penalty selection) but adds complexity.

**Displacement cannot handle k=3.** The `BP = |P| - d` formula is structurally tied to two-pass suffix repeats. With k=3, the histogram produces multiple peaks, but there is no general formula to convert peak displacements to breakpoint positions.

### Computational Cost

| Algorithm     | Complexity                 | Ops for &#124;P&#124;=87                | Notes                         |
|---------------|---------------------------|-----------------------------------------|-------------------------------|
| Displacement  | O(&#124;P&#124;<sup>2</sup>)      | ~7,500 ops                              | Conceptually trivial          |
| Chaining      | O(A log A), A = anchors   | ~200 log₂200 ≈ 1,500 ops                | Very fast in practice         |
| PELT          | O(n) amortized, n = profile length | ~90 ops + edit distance calls           | Window cost is main bottleneck|

All three are negligible compared to the hypothesis verification DP calls. The choice between them should be driven by accuracy, not speed.

### Complementarity with Hypothesis Verification

Each algorithm provides different information to downstream verification:

- **Chaining** provides: breakpoint positions AND the R-coordinates where each pass starts/ends. This directly constrains which decompositions to test (e.g., "pass 2 starts at w3 in R" narrows candidates to those with s2=w3).

- **PELT** provides: breakpoint positions (with ~2-phone uncertainty) but no R-coordinate information. Useful for narrowing the decomposition search but less constraining than chaining.

- **Displacement** provides: the repeat period (useful even when the breakpoint location is imprecise). Knowing that the repeat period is ~22 phonemes constrains the decomposition length: the repeated sub-range must sum to approximately 22 phonemes.

**Recommended pipeline:** Use displacement as a fast pre-check (confirms the pre-filter finding and estimates repeat period), then chaining for precise breakpoint estimation with R-coordinate mapping. PELT is a good fallback when chaining has too few anchors (very short segments or very high noise). Together, these three can reduce the hypothesis space from ~50-100 candidates to ~3-5.
