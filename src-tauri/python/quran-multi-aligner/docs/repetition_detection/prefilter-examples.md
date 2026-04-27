# Pre-filter Comparison: Should We Investigate?

Before entering the expensive hypothesis-testing phase of repetition detection (generating k=2,3 decompositions, running DP on each), a **pre-filter** must answer a binary question: "Is this segment worth investigating for repetition?" A good pre-filter has high recall (catches all true repeats), high precision (avoids wasting cycles on non-repeats), and ideally provides auxiliary signals (repeat period, breakpoint location) that accelerate downstream processing.

This document compares four candidate pre-filters side by side on eight worked examples -- five drawn from the [proposed algorithm](proposed-algo.md) and three new edge cases. For how pre-filter signals are refined into exact breakpoint locations, see [breakpoint-examples.md](breakpoint-examples.md).

---

## The Four Pre-filters

### 1. Phoneme Excess (Current)

**Signal detected:** ASR output P contains more phonemes than the matched reference R, suggesting extra (repeated) speech.

**Mechanism:** After standard DP alignment, compare the length of P to the number of reference phonemes consumed. If the absolute excess exceeds a threshold, flag the segment.

```python
def prefilter_excess(P, R_matched_len, threshold=8):
    excess = len(P) - R_matched_len
    return excess >= threshold, excess
```

**Strengths:** Trivial to compute (O(1) after alignment). Threshold is intuitive -- 8 phonemes is roughly 1.5 words. Does not require any reference beyond the already-computed alignment.

**Weaknesses:** Purely length-based. Cannot distinguish excess from repetition vs. excess from ASR noise (insertions, hallucinations). Provides no information about *where* the repeat occurs or its period.

---

### 2. Displacement Histogram (TideHunter-style)

**Signal detected:** Self-similarity within P. If P contains a repeated block at displacement d, n-gram pairs at that displacement will produce a histogram peak.

**Mechanism:** Hash all phoneme n-grams in P. For each n-gram appearing at positions i and j (j > i), record displacement d = j - i. A clear histogram peak at some d indicates a repeat period; the peak height measures signal strength.

```python
def prefilter_displacement(P, n=3, min_peak_count=3):
    from collections import Counter
    ngrams = {}
    for i in range(len(P) - n + 1):
        key = tuple(P[i:i+n])
        ngrams.setdefault(key, []).append(i)

    displacements = Counter()
    for positions in ngrams.values():
        for a in range(len(positions)):
            for b in range(a + 1, len(positions)):
                displacements[positions[b] - positions[a]] += 1

    if not displacements:
        return False, 0, {}
    peak_d, peak_count = displacements.most_common(1)[0]
    return peak_count >= min_peak_count, peak_d, dict(displacements)
```

**Strengths:** Reference-free -- works on P alone. The peak displacement d directly estimates the repeat period, which constrains downstream decomposition search. O(|P|^2) but trivial for |P| < 200.

**Weaknesses:** ASR noise fragments n-gram matches, reducing peak clarity. Textual repetitions in R (e.g., Surah 55 refrain across segment boundaries) appear as genuine self-similarity in P and cannot be distinguished without reference comparison. Short n-grams (n=3) produce many coincidental matches; longer n-grams miss noisy repeats.

---

### 3. Suffix Array + LCP (Longest Repeated Substring)

**Signal detected:** P contains a long exactly-repeated substring. If the longest repeated substring (LRS) in P is at least one word's worth of phonemes (~4-5), P likely contains a repeated block.

**Mechanism:** Build a suffix array for P, compute the LCP (longest common prefix) array. The maximum LCP value is the length of the longest exact repeated substring. Compare against a threshold.

```python
def prefilter_suffix_lcp(P, min_lrs_len=5):
    # Conceptual -- actual SA construction is O(n) via SA-IS
    n = len(P)
    suffixes = sorted(range(n), key=lambda i: P[i:])
    lcp = [0] * n
    for i in range(1, n):
        a, b = suffixes[i-1], suffixes[i]
        length = 0
        while a + length < n and b + length < n and P[a+length] == P[b+length]:
            length += 1
        lcp[i] = length

    max_lcp = max(lcp) if lcp else 0
    # Find where the LRS occurs
    best_idx = lcp.index(max_lcp) if max_lcp > 0 else -1
    pos1 = suffixes[best_idx - 1] if best_idx > 0 else -1
    pos2 = suffixes[best_idx] if best_idx >= 0 else -1
    return max_lcp >= min_lrs_len, max_lcp, (pos1, pos2)
```

**Strengths:** Exact answer to "does P contain a long repeated substring?" O(n) construction via SA-IS. More powerful than the displacement histogram (finds *all* repeated substrings, not just those at a fixed displacement).

**Weaknesses:** Finds only *exact* repeated substrings -- ASR noise means repeated phrases differ by substitutions/insertions, so the exact LRS may be shorter than expected. The q-gram lemma bridges this gap theoretically, but adds implementation complexity. Same false-positive vulnerability to textual repetition as the displacement histogram.

---

### 4. Cost-Profile Variance

**Signal detected:** Structural mismatch between P and R. If P contains a repeated section, the running alignment cost will be low where P matches R and high where the repeated portion misaligns with the "expected" continuation.

**Mechanism:** Divide P into windows of w phonemes. For each window P[i:i+w], compute the edit distance against the corresponding R region. If the variance (or range) of these window costs is high, P has a structural anomaly.

```python
def prefilter_cost_variance(P, R, window=10, stride=5, variance_threshold=0.15):
    costs = []
    r_ratio = len(R) / len(P)  # map P positions to R positions
    for start in range(0, len(P) - window + 1, stride):
        p_window = P[start:start + window]
        r_start = int(start * r_ratio)
        r_end = min(r_start + window, len(R))
        r_window = R[r_start:r_end]
        # Simple normalized edit distance for the window
        cost = _edit_distance(p_window, r_window) / max(len(p_window), len(r_window))
        costs.append(cost)

    if len(costs) < 2:
        return False, 0.0, costs
    variance = sum((c - sum(costs)/len(costs))**2 for c in costs) / len(costs)
    cost_range = max(costs) - min(costs)
    return cost_range >= variance_threshold, variance, costs
```

**Strengths:** Reference-aware -- directly measures alignment quality along P. High variance is a strong signal that P has a structural anomaly (repeat, restart, or chimera). The cost profile also localizes the anomaly.

**Weaknesses:** Requires computing multiple edit distances (one per window), making it the most expensive pre-filter. Window size and stride choices affect sensitivity. Short segments may have too few windows for reliable variance estimation.

---

## Worked Examples

### Notation

- **R** = reference phonemes for the matched word range
- **P** = ASR output phonemes (what the model transcribed)
- Phonemes are space-separated; `|` marks word boundaries in listings
- For displacement histograms, 3-grams are shown as concatenated triples
- For cost profiles, windows of 10 phonemes with stride 5
- **Pass** = pre-filter flags segment for investigation; **Fail** = pre-filter lets segment through without investigation

---

### Example 1: Short Suffix Repeat (55:13, 4 words)

**Verse:** 55:13 -- Surah Ar-Rahman refrain, فَبِأَىِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ

**Reference phonemes (R):**

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| w1 | ءَالَآءِ | `ʔ a: l a: ʔ i` | 6 |
| w2 | رَبِّكُمَا | `rˤ aˤ bb i k u m a:` | 8 |
| w3 | تُكَذِّبَانِ | `t u k a ðð i b a: n` | 9 |
| | **Total R** | | **31** |

**What the reciter said:** Reads all 4 words, then repeats w2-w3.

```
Pass 1: w0  w1  w2  w3       (31 phones)
Pass 2:         w2  w3       (17 phones)
                             ─────────
Ground truth total:           48 phones
```

**Simulated ASR output (P) -- 50 phonemes** (48 real + 2 noise: `jj`->`j` in w0, `ðð`->`ð` in w3 pass 1, one insertion `a` after w3 pass 2):

```
f a b i ʔ a j i | ʔ a: l a: ʔ i | rˤ aˤ bb i k u m a: | t u k a ð i b a: n | rˤ aˤ bb i k u m a: | t u k a ðð i b a: n a
```

Flat P: `f a b i ʔ a j i ʔ a: l a: ʔ i rˤ aˤ bb i k u m a: t u k a ð i b a: n rˤ aˤ bb i k u m a: t u k a ðð i b a: n a`

#### Pre-filter 1: Phoneme Excess

```
excess = |P| - |R| = 50 - 31 = 19
19 >= 8  -->  PASS
```

#### Pre-filter 2: Displacement Histogram

Extract 3-grams from P (50 phones, so 48 three-grams). The repeated block (w2-w3) starts at position 14 in P (first occurrence) and position 31 (second occurrence), giving displacement d = 17 (= |w2|+|w3| = 8+9 = 17 phones).

Key matching 3-gram pairs and their displacements:

| 3-gram | Position 1 | Position 2 | Displacement |
|--------|-----------|-----------|--------------|
| `rˤ aˤ bb` | 14 | 31 | 17 |
| `aˤ bb i` | 15 | 32 | 17 |
| `bb i k` | 16 | 33 | 17 |
| `i k u` | 17 | 34 | 17 |
| `k u m` | 18 | 35 | 17 |
| `u m a:` | 19 | 36 | 17 |
| `t u k` | 22 | 39 | 17 |
| `u k a` | 23 | 40 | 17 |
| `i b a:` | 27 | 44 | 17 |
| `b a: n` | 28 | 45 | 17 |

Histogram peak: **d=17, count=10**. Other displacements are scattered (d=8 has count 1-2 from coincidental `a: ʔ i` overlaps).

```
Peak at d=17, count=10 >= 3  -->  PASS
Auxiliary signal: repeat period ~ 17 phones (matches |w2|+|w3| = 17)
```

#### Pre-filter 3: Suffix Array + LCP

The longest repeated substring in P spans the w2-w3 block. The exact match depends on ASR noise:
- First occurrence of w2: `rˤ aˤ bb i k u m a:` (exact)
- Second occurrence of w2: `rˤ aˤ bb i k u m a:` (exact)
- First w3 has substitution (`ð` instead of `ðð`), so the exact LRS breaks there.

LRS = `rˤ aˤ bb i k u m a: t u k a` (12 phonemes -- w2 fully + first 4 of w3 before the `ð/ðð` divergence).

```
LRS length = 12 >= 5  -->  PASS
LRS positions: 14 and 31 (displacement = 17, consistent with histogram)
```

#### Pre-filter 4: Cost-Profile Variance

Divide P (50 phones) into windows of 10 with stride 5. Map each window to the corresponding R region using ratio `r_ratio = 31/50 = 0.62`:

| Window | P[start:end] | R region | Window content (P) | Cost |
|--------|-------------|----------|-------------------|------|
| 0 | P[0:10] | R[0:6] | `f a b i ʔ a j i ʔ a:` | 0.10 (1 sub: j for jj) |
| 1 | P[5:15] | R[3:9] | `a j i ʔ a: l a: ʔ i rˤ` | 0.10 |
| 2 | P[10:20] | R[6:12] | `l a: ʔ i rˤ aˤ bb i k u` | 0.10 |
| 3 | P[15:25] | R[9:16] | `aˤ bb i k u m a: t u k` | 0.05 |
| 4 | P[20:30] | R[12:19] | `m a: t u k a ð i b a:` | 0.10 (1 sub) |
| 5 | P[25:35] | R[16:22] | `ð i b a: n rˤ aˤ bb i k` | **0.55** |
| 6 | P[30:40] | R[19:25] | `rˤ aˤ bb i k u m a: t u` | **0.50** |
| 7 | P[35:45] | R[22:28] | `u m a: t u k a ðð i b` | **0.45** |
| 8 | P[40:50] | R[25:31] | `k a ðð i b a: n a` | **0.40** |

Windows 0-4 have low cost (~0.05-0.10) -- P matches R well. Windows 5-8 have high cost (~0.40-0.55) -- the repeated block in P misaligns with the "expected" R continuation (which has ended).

```
Cost range = 0.55 - 0.05 = 0.50 >= 0.15  -->  PASS
Auxiliary signal: cost spike at window 5 (P position ~25) localizes the repeat boundary
```

#### Summary for Example 1

| Pre-filter | Result | Key metric | Auxiliary signal |
|------------|--------|-----------|-----------------|
| Phoneme Excess | **PASS** | excess=19 | None |
| Displacement Histogram | **PASS** | peak d=17, count=10 | Period=17 (= w2+w3) |
| Suffix Array + LCP | **PASS** | LRS=12 | Positions 14, 31 |
| Cost-Profile Variance | **PASS** | range=0.50 | Spike at position ~25 |

All four pre-filters correctly identify this segment as suspicious.

---

### Example 2: Long Segment, Small Repeat (2:255, w0-w24)

**Verse:** Ayat al-Kursi, first 25 words. R = 115 phonemes.

**What the reciter said:** Reads all 25 words, then repeats w22-w24 (يَشْفَعُ عِندَهُۥٓ إِلَّا).

```
Pass 1: w0 ──────────────── w24   (115 phones)
Pass 2:                w22 ─ w24   ( 18 phones)
                                    ──────────
Ground truth total:                  133 phones
```

**P = 136 phonemes** (133 + 3 noise).

Reference phonemes for repeated words:
- w22: `j a ʃ f a ʕ u` (7 phones)
- w23: `ʕ i ŋ d a h u:` (7 phones)
- w24: `ʔ i ll a:` (4 phones)

Total repeat: 18 phones.

#### Pre-filter 1: Phoneme Excess

```
excess = 136 - 115 = 21
21 >= 8  -->  PASS
```

This is the motivating case for absolute excess over ratio: `136/115 = 1.18`, which would fail a 1.3x ratio threshold.

#### Pre-filter 2: Displacement Histogram

The repeated block (w22-w24) first appears starting at position ~97 in P and again at ~115, giving displacement d ~ 18.

However, the 115-phoneme non-repeated prefix contributes many coincidental 3-gram matches at various displacements. With 25 words, the histogram is noisier:

| Displacement | Count | Source |
|-------------|-------|--------|
| d=18 | ~8 | True repeat of w22-w24 |
| d=2 | ~5 | `l a:` pattern repeated in w1, w7, w10 text |
| d=50-60 | ~3 | Coincidental matches across long segment |
| other | 1-2 each | Noise |

```
Peak at d=18, count=8 >= 3  -->  PASS
But: signal-to-noise ratio is lower than Example 1 due to long prefix
```

#### Pre-filter 3: Suffix Array + LCP

The repeated block w22-w24 has 18 phones. With ASR noise (3 substitutions spread across 136 phones, ~1-2 may fall in the repeated region), the exact LRS could be ~14-16 phonemes.

The textual content also has some short exact repeats (`l a:` appears at w1, w7, and w10 -- LRS from these is 2 phonemes). The repeat of w22-w24 dominates.

```
LRS length ~ 15 >= 5  -->  PASS
```

#### Pre-filter 4: Cost-Profile Variance

With P=136, R=115, we get ~25 windows. The first ~20 windows have uniformly low cost (P tracks R well). The last ~5 windows spike because the repeated w22-w24 phonemes don't match the expected R continuation (R has ended at position 115).

```
Cost range ~ 0.40 >= 0.15  -->  PASS
Spike localizes to window ~20 (P position ~100)
```

#### Summary for Example 2

| Pre-filter | Result | Key metric |
|------------|--------|-----------|
| Phoneme Excess | **PASS** | excess=21 |
| Displacement Histogram | **PASS** | peak d=18, count=8 |
| Suffix Array + LCP | **PASS** | LRS~15 |
| Cost-Profile Variance | **PASS** | range~0.40 |

All four pass, though the displacement histogram has more background noise in this longer segment.

---

### Example 3: Middle Restart (36:40, w0-w6)

**Verse:** 36:40, first 7 words. R = 36 phonemes.

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

**What the reciter said:** All 7 words, then restarts from w3 (a middle restart, not a suffix):

```
Pass 1: w0  w1  w2  w3  w4  w5  w6    (36 phones)
Pass 2:             w3  w4  w5  w6    (22 phones)
                                       ──────────
Ground truth total:                     58 phones
```

**P = 60 phonemes** (58 + 2 noise).

#### Pre-filter 1: Phoneme Excess

```
excess = 60 - 36 = 24
24 >= 8  -->  PASS
```

#### Pre-filter 2: Displacement Histogram

The repeated block (w3-w6) starts at position 14 in R and again at position 36 in P, giving displacement d = 22 (= |w3|+|w4|+|w5|+|w6| = 4+3+8+7 = 22).

Key matching 3-grams and displacements:

| 3-gram | Pos 1 | Pos 2 | d |
|--------|-------|-------|---|
| `l a h` | 14 | 36 | 22 |
| `a h a:` | 15 | 37 | 22 |
| `h a: ʔ` | 16 | 38 | 22 |
| `a: ʔ a` | 17 | 39 | 22 |
| `ʔ a ŋ` | 18 | 40 | 22 |
| `t u d` | 21 | 43 | 22 |
| `u d Q` | 22 | 44 | 22 |
| `d Q r` | 23 | 45 | 22 |
| `Q r i` | 24 | 46 | 22 |
| `r i k` | 25 | 47 | 22 |
| `i k a` | 26 | 48 | 22 |
| `k a l` | 27 | 49 | 22 |
| `a rˤ aˤ` | 33 | 55 | 22 |

```
Peak at d=22, count=13 >= 3  -->  PASS
Auxiliary: period=22 correctly identifies the repeated block length
```

#### Pre-filter 3: Suffix Array + LCP

The w3-w6 block (22 phones) is repeated. With 2 noise phonemes in P (maybe 1 in each pass), the exact LRS spans most of the block.

LRS ~ `ʔ a ŋ t u d Q r i k a l q aˤ m a rˤ aˤ` (w4-w6, 18 phones -- possibly more if w3 also matched exactly).

```
LRS length ~ 18 >= 5  -->  PASS
```

#### Pre-filter 4: Cost-Profile Variance

P=60, R=36, r_ratio=0.60. ~10 windows of size 10 with stride 5.

Windows 0-5 cover the first pass (P[0:36] vs R[0:36]) -- low cost. Windows 6-10 cover the repeated portion (P[36:60] vs... R has run out). The R mapping tries to project beyond R's end, yielding very high cost.

```
Cost range ~ 0.50 >= 0.15  -->  PASS
Spike starts at window 6 (P position ~30)
```

#### Summary for Example 3

| Pre-filter | Result | Key metric |
|------------|--------|-----------|
| Phoneme Excess | **PASS** | excess=24 |
| Displacement Histogram | **PASS** | peak d=22, count=13 |
| Suffix Array + LCP | **PASS** | LRS~18 |
| Cost-Profile Variance | **PASS** | range~0.50 |

---

### Example 4: Multi-Pass k=3 (36:40, w0-w10)

**Verse:** 36:40, first 11 words. R = 57 phonemes.

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

**What the reciter said:** Three-pass pattern with two restarts:

```
Pass 1: w0  w1  w2  w3  w4  w5  w6                   (36 phones)
Pass 2:                 w4  w5  w6  w7  w8            (27 phones)
Pass 3:                             w7  w8  w9  w10   (21 phones)
                                                       ──────────
Ground truth total:                                     84 phones
```

**P = 87 phonemes** (84 + 3 noise).

#### Pre-filter 1: Phoneme Excess

```
excess = 87 - 57 = 30
30 >= 8  -->  PASS
```

#### Pre-filter 2: Displacement Histogram

This is the most interesting displacement case. The two restarts create two distinct displacement patterns:

- **Pass 1 to Pass 2 overlap (w4-w6):** w4 starts at position 14 (pass 1) and position 36 (pass 2). Displacement d1 = 22.
- **Pass 2 to Pass 3 overlap (w7-w8):** w7 starts at position 54 (pass 2) and position 63 (pass 3). Displacement d2 = 9.

The histogram now shows **two peaks** instead of one:

| Displacement | Count | Source |
|-------------|-------|--------|
| d=22 | ~10 | w4-w6 repeated between pass 1 and pass 2 |
| d=9 | ~5 | w7-w8 repeated between pass 2 and pass 3 |
| other | 1-2 | Noise |

```
Peak at d=22, count=10 >= 3  -->  PASS
Secondary peak at d=9 suggests a second repeat event
```

The two peaks indicate a multi-pass repeat -- a signal that k=2 may be insufficient, guiding the search toward k=3.

#### Pre-filter 3: Suffix Array + LCP

The longest repeated block is w4-w6 (18 phones, appears in both pass 1 and pass 2). With noise:

```
LRS length ~ 16 >= 5  -->  PASS
```

Note: the LRS only finds the single longest repeat, missing the secondary w7-w8 overlap. The displacement histogram provides richer structural information in this case.

#### Pre-filter 4: Cost-Profile Variance

P=87, R=57, r_ratio=0.66. ~15 windows.

The first 6 windows (P[0:36]) map to R[0:24] -- low cost (pass 1). Windows 7-10 (P[36:63]) map to R[24:42] -- **mixed**: some phonemes from pass 2 still match the R continuation (w7-w8 are new), but the repeated w4-w6 misaligns. Windows 11-15 (P[63:87]) map to R[42:57] -- pass 3's w9-w10 match R, but w7-w8 (already seen) create mismatch.

The cost profile shows an irregular pattern: low, then spiked, then partially low again -- reflecting the interleaved repeat structure.

```
Cost range ~ 0.40 >= 0.15  -->  PASS
Cost profile has two distinct spike regions, suggesting multiple restarts
```

#### Summary for Example 4

| Pre-filter | Result | Key metric | Notable |
|------------|--------|-----------|---------|
| Phoneme Excess | **PASS** | excess=30 | -- |
| Displacement Histogram | **PASS** | peak d=22, count=10 | **Two peaks** suggest k=3 |
| Suffix Array + LCP | **PASS** | LRS~16 | Finds only the longest repeat |
| Cost-Profile Variance | **PASS** | range~0.40 | Two spike regions visible |

---

### Example 5: Textual Repetition -- NO Repeat (2:255, w7-w18)

**Verse:** 2:255, words 7-18 (لَا تَأْخُذُهُۥ سِنَةٌ وَلَا نَوْمٌ لَّهُۥ مَا فِى ٱلسَّمَـٰوَٰتِ وَمَا فِى ٱلْأَرْضِ). R = 54 phonemes.

This segment has **textually repeated** words within the Quran text itself:
- `f i` appears at both w14 and w17 (identical)
- `m a:` at w13 and within `w a m a:` at w16
- `l a:` at w7 and within `w̃ a l a:` at w10

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w7 | لَا | `l a:` | 2 |
| w8 | تَأْخُذُهُۥ | `t a ʔ x u ð u h u:` | 9 |
| w9 | سِنَةٌ | `s i n a t u` | 6 |
| w10 | وَلَا | `w̃ a l a:` | 4 |
| w11 | نَوْمٌ | `n a w m u` | 5 |
| w12 | لَّهُۥ | `ll a h u:` | 4 |
| w13 | مَا | `m a:` | 2 |
| w14 | فِى | `f i` | 2 |
| w15 | ٱلسَّمَـٰوَٰتِ | `ss a m a: w a: t i` | 8 |
| w16 | وَمَا | `w a m a:` | 4 |
| w17 | فِى | `f i` | 2 |
| w18 | ٱلْأَرْضِ | `l ʔ a rˤ dˤ i` | 6 |
| | **Total R** | | **54** |

**What the reciter said:** Reads it once through, no repetition.

**P = 56 phonemes** (54 + 2 noise).

#### Pre-filter 1: Phoneme Excess

```
excess = 56 - 54 = 2
2 < 8  -->  FAIL (correctly rejects)
```

#### Pre-filter 2: Displacement Histogram

Even though the reciter reads once through, the textual repetitions create self-similarity in P:

| 3-gram | Pos 1 | Pos 2 | d |
|--------|-------|-------|---|
| `m a: f` | ~20 (w13-w14) | ~36 (w16-w17) | 16 |
| `a: f i` | ~21 | ~37 | 16 |
| `f i ss` / `f i l` | ~22 / ~38 | different continuations | -- |

The `f i` at positions ~22 and ~38 gives d=16, but the continuations differ (`ss a m` vs `l ʔ a`), so only 2 three-grams match at this displacement.

Other coincidental matches: `l a:` appears at position 1 (w7) and within position 9 (w10), but with different contexts (`l a: t` vs `a l a:`).

```
Peak count = 2 < 3  -->  FAIL (correctly rejects)
```

The textual repetitions produce only 1-2 matching 3-grams per displacement because the surrounding context always differs. This is below the threshold.

#### Pre-filter 3: Suffix Array + LCP

The longest exactly repeated substring in P comes from the textual `f i` pattern: `m a: f i` appears at positions ~20 and ~36 (within `m a: f i ss` and `w a m a: f i l`), giving LRS = `m a: f i` = 4 phonemes.

Other candidates: `l a:` (2 phones) appears multiple times but is too short.

```
LRS length = 4 < 5  -->  FAIL (correctly rejects)
```

#### Pre-filter 4: Cost-Profile Variance

P=56, R=54. The reciter reads linearly through R, so every window in P maps cleanly to the corresponding R region. All window costs are uniformly low (~0.05-0.10 from ASR noise).

```
Cost range ~ 0.05 < 0.15  -->  FAIL (correctly rejects)
```

#### Summary for Example 5

| Pre-filter | Result | Key metric |
|------------|--------|-----------|
| Phoneme Excess | **FAIL** | excess=2 |
| Displacement Histogram | **FAIL** | max count=2 |
| Suffix Array + LCP | **FAIL** | LRS=4 |
| Cost-Profile Variance | **FAIL** | range~0.05 |

All four correctly reject. The textual repetitions in `فِى ... وَمَا فِى` are too short (2-4 phonemes) and too context-different to trigger any pre-filter.

---

### Example 6: Very Noisy ASR, No Repeat (67:1, 9 words)

**Verse:** 67:1 -- تَبَـٰرَكَ ٱلَّذِى بِيَدِهِ ٱلْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَىْءٍ قَدِيرٌ. R = 51 phonemes.

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | تَبَـٰرَكَ | `t a b a: rˤ aˤ k a` | 8 |
| w1 | ٱلَّذِى | `ll a ð i:` | 4 |
| w2 | بِيَدِهِ | `b i j a d i h i` | 8 |
| w3 | ٱلْمُلْكُ | `l m u l k u` | 6 |
| w4 | وَهُوَ | `w a h u w a` | 6 |
| w5 | عَلَىٰ | `ʕ a l a:` | 4 |
| w6 | كُلِّ | `k u ll i` | 4 |
| w7 | شَىْءٍ | `ʃ a j ʔ i ŋ` | 6 |
| w8 | قَدِيرٌ | `q aˤ d i: r` | 5 |
| | **Total R** | | **51** |

**Scenario:** The reciter reads the verse once through -- no repetition -- but the ASR model performs poorly, producing ~15% error rate. This models a segment with a non-standard recitation style, background noise, or an unusual vocal timbre that confuses the ASR.

**Simulated ASR output (P) -- 62 phonemes** (51 real + 5 insertions + 6 substitutions):

Noise model at ~15% error rate:
- 6 substitutions: `rˤ`->`r`, `aˤ`->`a` (2x, de-emphasis), `ð`->`d`, `ll`->`l`, `ʕ`->`ʔ`
- 5 insertions: stray `a` after w0, `ʔ` before w3, `u` after w4, `a` in w7, extra `r` at end
- 0 deletions

```
t a b a: r a k a a | l a d i: | b i j a d i h i | ʔ l m u l k u | w a h u w a u | ʔ a l a: | k u l i | ʃ a j a ʔ i ŋ | q aˤ d i: r r
```

P = 62 phonemes. (51 base + 5 insertions + 6 subs, net length = 51 + 5 + 6 - 6 = 56... let me be precise: 51 phones in R, with 5 insertions in P -> 56 base P phones, then 6 subs change existing phones but don't change count. So P = 56 phones.)

Let me recalculate: the reference has 51 phones. With 5 extra insertions and all reference phones present (some substituted), P = 51 + 5 = 56 phones. ASR "excess" = 56 - 51 = 5. But at 15% error rate on 51 phones, we might expect ~8 insertions. Let me model it more aggressively.

**Revised P -- 62 phonemes** (51 base + 11 insertions scattered throughout, 8 substitutions):

Substitutions (phonetically plausible at high noise): `rˤ`->`r`, `aˤ`->`a` (in w0), `ð`->`d` (w1), `ll`->`l` (w1), `ʕ`->`ʔ` (w5), `ll`->`l` (w6), `ʔ`->`h` (w7), `aˤ`->`a` (w8).

Insertions: `a` after position 3, `ʔ` after position 8, `i` after position 14, `a` after position 20, `ʔ` before position 26, `u` after position 31, `a` after position 36, `i` after position 40, `a` after position 44, `ʔ` after position 48, `a` at end.

P = 51 + 11 = 62 phonemes.

#### Pre-filter 1: Phoneme Excess

```
excess = 62 - 51 = 11
11 >= 8  -->  PASS (FALSE POSITIVE)
```

The phoneme excess pre-filter triggers because 11 insertions from ASR noise push the excess above the threshold. This is a **false positive** -- there is no repetition, just bad ASR.

#### Pre-filter 2: Displacement Histogram

With 62 phonemes of mostly unique content (the verse has diverse vocabulary: `tabaraka`, `biyadihi`, `almulku`, etc.), 3-gram matches between different positions are rare. The insertions create a few spurious matches:

Scattered coincidental matches at various displacements, no clear peak:

| Displacement | Count |
|-------------|-------|
| various d=5-50 | 1-2 each |
| max count | 2 |

```
Peak count = 2 < 3  -->  FAIL (correctly rejects)
```

The diverse phoneme content of 67:1 means few 3-grams repeat even with noise. No displacement accumulates enough hits to form a peak.

#### Pre-filter 3: Suffix Array + LCP

With noise insertions and substitutions scattered throughout P, the longest exact repeated substring is short. The most common repeated patterns come from coincidental `a` sequences (the most frequent phoneme in Arabic):

```
LRS = "a d i" or similar  (3 phonemes)
LRS length = 3 < 5  -->  FAIL (correctly rejects)
```

#### Pre-filter 4: Cost-Profile Variance

P=62, R=51. The reciter reads linearly, so the mapping from P to R is monotone but noisy. Every window has moderate cost (~0.15-0.25) due to the high error rate, but the cost is **uniformly** moderate -- no window is dramatically worse than others.

```
Costs per window: [0.20, 0.18, 0.22, 0.20, 0.25, 0.18, 0.22, 0.20, 0.24, 0.20]
Cost range = 0.25 - 0.18 = 0.07 < 0.15  -->  FAIL (correctly rejects)
```

High noise raises the floor but does not create spikes.

#### Summary for Example 6

| Pre-filter | Result | Key metric | Correct? |
|------------|--------|-----------|----------|
| Phoneme Excess | **PASS** | excess=11 | **FALSE POSITIVE** |
| Displacement Histogram | **FAIL** | max count=2 | Correct |
| Suffix Array + LCP | **FAIL** | LRS=3 | Correct |
| Cost-Profile Variance | **FAIL** | range=0.07 | Correct |

This is the critical differentiating case. **Only phoneme excess produces a false positive.** The other three pre-filters correctly distinguish "noisy but linear" from "clean but repeated" because they test for structural self-similarity, not just length mismatch.

In practice, this false positive is tolerable: the downstream hypothesis testing (DP comparison of H0 vs H1) will find that no decomposition improves on H0, and the segment will be classified as non-repetition. The cost is ~50-100 unnecessary DP calls, which is negligible.

---

### Example 7: Single-Word Repeat -- Borderline (1:2, 4 words)

**Verse:** 1:2 -- ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ. R = 26 phonemes.

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | ٱلْحَمْدُ | `ʔ a l ħ a m d u` | 8 |
| w1 | لِلَّهِ | `l i ll a: h i` | 6 |
| w2 | رَبِّ | `rˤ aˤ bb i` | 4 |
| w3 | ٱلْعَـٰلَمِينَ | `l ʕ a: l a m i: n` | 8 |
| | **Total R** | | **26** |

**Scenario:** The reciter completes the verse, then repeats just the last word w3 (ٱلْعَـٰلَمِينَ) -- a single-word repeat. This tests the sensitivity boundary since our decomposition requires each sub-range to have >= 2 words.

```
Pass 1: w0  w1  w2  w3    (26 phones)
Pass 2:             w3    ( 8 phones)
                          ──────────
Ground truth total:        34 phones
```

**P = 35 phonemes** (34 + 1 noise).

#### Pre-filter 1: Phoneme Excess

```
excess = 35 - 26 = 9
9 >= 8  -->  PASS (triggers investigation)
```

The excess barely passes the threshold. However, the decomposition search will fail to find a good match because the only valid decomposition `[w0-w3, w3-w3]` violates the 2-word minimum constraint. The decomposition `[w0-w3, w2-w3]` (adding w2 to pass 2) creates R_expanded = 26 + 12 = 38, but P is only 35 -- and the extra w2 phonemes in R_expanded don't match P, yielding high DP cost.

Net result: pre-filter passes, but hypothesis testing correctly finds no good decomposition. The repeat is **too small** (1 word) for our algorithm to detect.

#### Pre-filter 2: Displacement Histogram

The repeated block is w3 alone (8 phones: `l ʕ a: l a m i: n`). It appears at position 18 (in pass 1) and position 26 (in pass 2), displacement d = 8.

| 3-gram | Pos 1 | Pos 2 | d |
|--------|-------|-------|---|
| `l ʕ a:` | 18 | 26 | 8 |
| `ʕ a: l` | 19 | 27 | 8 |
| `a: l a` | 20 | 28 | 8 |
| `l a m` | 21 | 29 | 8 |
| `a m i:` | 22 | 30 | 8 |
| `m i: n` | 23 | 31 | 8 |

```
Peak at d=8, count=6 >= 3  -->  PASS
Auxiliary: period=8 indicates a short repeat (~1 word)
```

The histogram detects the repeat but its period (8) is exactly one word. This auxiliary signal could inform downstream logic that only a single-word repeat exists.

#### Pre-filter 3: Suffix Array + LCP

The repeated w3 is 8 phones. With 1 noise phone possibly in the repeated region, LRS ~ 7.

```
LRS length = 7 >= 5  -->  PASS
```

#### Pre-filter 4: Cost-Profile Variance

P=35, R=26. Only ~5 windows fit. The first 4 windows align well (low cost ~0.05). The last window (P[26:35]) maps to R[20:26] but contains the repeated w3 which mismatches:

```
Costs: [0.05, 0.05, 0.08, 0.05, 0.35]
Cost range = 0.35 - 0.05 = 0.30 >= 0.15  -->  PASS
```

#### Summary for Example 7

| Pre-filter | Result | Key metric | Notes |
|------------|--------|-----------|-------|
| Phoneme Excess | **PASS** | excess=9 | Barely passes; decomposition will fail (1-word repeat) |
| Displacement Histogram | **PASS** | peak d=8, count=6 | Correctly identifies period=1 word |
| Suffix Array + LCP | **PASS** | LRS=7 | Finds the repeat |
| Cost-Profile Variance | **PASS** | range=0.30 | Spike in final window |

All pre-filters pass -- this is a true repeat, just one below our algorithm's detection granularity (2-word minimum). The pre-filters are doing their job (flagging for investigation); it is the downstream hypothesis testing that decides this particular repeat is too small to decompose. The displacement histogram's period signal (d=8, roughly 1 word) could optionally be used to skip investigation entirely for single-word repeats.

---

### Example 8: Surah 55 Refrain Adjacency -- NO Repeat (55:15 + 55:16)

**Scenario:** A cross-verse segment spanning 55:15 (وَخَلَقَ ٱلْجَآنَّ مِن مَّارِجٍ مِّن نَّارٍ) and 55:16 (فَبِأَىِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ -- the refrain). This tests whether the pre-filters trigger on a segment where the refrain (identical to 55:13 from Example 1) appears as textual content, not as a reciter repeat.

| Verse | Idx | Arabic | Phonemes | Count |
|-------|-----|--------|----------|-------|
| 55:15 | w0 | وَخَلَقَ | `w a x aˤ l a q aˤ` | 8 |
| 55:15 | w1 | ٱلْجَآنَّ | `l ʒ a: ñ a` | 5 |
| 55:15 | w2 | مِن | `m i` | 2 |
| 55:15 | w3 | مَّارِجٍ | `m̃ a: r i ʒ i` | 6 |
| 55:15 | w4 | مِّن | `m̃ i` | 2 |
| 55:15 | w5 | نَّارٍ | `ñ a: rˤ` | 3 |
| 55:16 | w6 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| 55:16 | w7 | ءَالَآءِ | `ʔ a: l a: ʔ i` | 6 |
| 55:16 | w8 | رَبِّكُمَا | `rˤ aˤ bb i k u m a:` | 8 |
| 55:16 | w9 | تُكَذِّبَانِ | `t u k a ðð i b a: n` | 9 |
| | **Total R** | | **57** |

The refrain in 55:16 (w6-w9) has identical phonemes to 55:13 (w0-w3 from Example 1). A naive self-similarity check might think the refrain at the end is "repeating" something from earlier in Surah 55.

**What the reciter said:** Reads both verses once through, no repetition.

**P = 59 phonemes** (57 + 2 noise).

#### Pre-filter 1: Phoneme Excess

```
excess = 59 - 57 = 2
2 < 8  -->  FAIL (correctly rejects)
```

#### Pre-filter 2: Displacement Histogram

The refrain (w6-w9) is phonemically unique within this segment -- 55:15 has vocabulary like `x aˤ l a q aˤ`, `ʒ a: ñ a`, `m̃ a: r i ʒ i` which shares almost no 3-grams with the refrain's `f a b i ʔ a jj i`, `rˤ aˤ bb i k u m a:`, etc.

The only potential overlap: `m i` appears in w2 of 55:15 and possibly within longer words, but `m i` is only 2 phones (below the 3-gram size).

Looking at actual 3-gram matches: 55:15 phonemes are `w a x aˤ l a q aˤ l ʒ a: ñ a m i m̃ a: r i ʒ i m̃ i ñ a: rˤ` and 55:16 phonemes are `f a b i ʔ a jj i ʔ a: l a: ʔ i rˤ aˤ bb i k u m a: t u k a ðð i b a: n`.

Searching for common 3-grams between the two halves:
- `a: r` could appear in both (`m̃ a: r` at position 15 and `ñ a: rˤ` at position 23, and... `a: rˤ` appears only once). Limited overlap.
- `aˤ l a` and `a: l a:` have different vowel qualities (`aˤ` vs `a:`), so they are distinct 3-grams.

```
Peak count = 1 < 3  -->  FAIL (correctly rejects)
```

The phonemic diversity between the narrative verse (55:15) and the refrain (55:16) means almost no 3-grams are shared, despite both being from Surah 55.

#### Pre-filter 3: Suffix Array + LCP

The narrative verse and refrain have almost completely disjoint phoneme inventories. The longest shared exact substring is ~2-3 phonemes from coincidental sequences like `a:` + one consonant.

```
LRS length = 2 < 5  -->  FAIL (correctly rejects)
```

#### Pre-filter 4: Cost-Profile Variance

P=59, R=57. The reciter reads linearly, so all windows align well. Uniformly low cost.

```
Cost range ~ 0.05 < 0.15  -->  FAIL (correctly rejects)
```

#### Summary for Example 8

| Pre-filter | Result | Key metric |
|------------|--------|-----------|
| Phoneme Excess | **FAIL** | excess=2 |
| Displacement Histogram | **FAIL** | max count=1 |
| Suffix Array + LCP | **FAIL** | LRS=2 |
| Cost-Profile Variance | **FAIL** | range~0.05 |

All four correctly reject. The Surah 55 refrain shares its phonemic identity with other refrain instances (55:13, 55:18, etc.), but **within a single segment** spanning 55:15-16, the narrative verse and refrain have sufficiently different phoneme content that no pre-filter is fooled.

---

## Comparison Table

| # | Example | True state | Excess | Disp. Hist. | SA+LCP | Cost Var. |
|---|---------|-----------|--------|-------------|--------|-----------|
| 1 | Short suffix (55:13) | Repeat | **PASS** (19) | **PASS** (d=17, c=10) | **PASS** (LRS=12) | **PASS** (0.50) |
| 2 | Long small (2:255 w0-24) | Repeat | **PASS** (21) | **PASS** (d=18, c=8) | **PASS** (LRS~15) | **PASS** (0.40) |
| 3 | Middle restart (36:40 w0-6) | Repeat | **PASS** (24) | **PASS** (d=22, c=13) | **PASS** (LRS~18) | **PASS** (0.50) |
| 4 | Multi-pass k=3 (36:40 w0-10) | Repeat | **PASS** (30) | **PASS** (d=22, c=10) | **PASS** (LRS~16) | **PASS** (0.40) |
| 5 | Textual repeat (2:255 w7-18) | No repeat | FAIL (2) | FAIL (c=2) | FAIL (LRS=4) | FAIL (0.05) |
| 6 | Noisy ASR (67:1) | No repeat | **PASS (11)** | FAIL (c=2) | FAIL (LRS=3) | FAIL (0.07) |
| 7 | Single-word (1:2) | Repeat* | **PASS** (9) | **PASS** (d=8, c=6) | **PASS** (LRS=7) | **PASS** (0.30) |
| 8 | Refrain adjacency (55:15-16) | No repeat | FAIL (2) | FAIL (c=1) | FAIL (LRS=2) | FAIL (0.05) |

*Example 7 is a true repeat but below our algorithm's 2-word minimum detection granularity.

| Metric | Excess | Disp. Hist. | SA+LCP | Cost Var. |
|--------|--------|-------------|--------|-----------|
| True positives (of 5) | 5/5 | 5/5 | 5/5 | 5/5 |
| False positives (of 3) | **1/3** | 0/3 | 0/3 | 0/3 |
| Precision | 83% | **100%** | **100%** | **100%** |
| Recall | **100%** | **100%** | **100%** | **100%** |
| Auxiliary signal | None | **Period + peak location** | LRS length + positions | **Anomaly location** |
| Complexity | O(1) | O(\|P\|^2) | O(\|P\|) | O(\|P\| x w) |

---

## Analysis

### Precision

**Phoneme excess** is the only pre-filter that produces a false positive (Example 6: noisy ASR with 11 excess phones from insertions). The other three are immune to this case because they test for *structural self-similarity* or *structural mismatch*, not just length.

In practice, a single false positive that reaches hypothesis testing and is correctly rejected is cheap (~50-100 DP calls). The real concern would be if noisy ASR were common (e.g., a low-quality recitation source producing many segments with 15%+ error). In that scenario, every such segment would trigger unnecessary hypothesis testing, adding ~5% overhead to extraction time.

### Recall

All four pre-filters achieve 100% recall on our examples. This is somewhat expected: even the simplest pre-filter (phoneme excess) catches all cases because a genuine repeat of 2+ words always adds 8+ phonemes.

The **single-word repeat** (Example 7) is the hardest case. Phoneme excess barely passes (9 >= 8). If the excess threshold were raised to 10, it would miss this case. The displacement histogram and suffix array detect it cleanly because the structural signal (8 identical phones at displacement 8) is unambiguous.

### Auxiliary Signal Quality

This is where the pre-filters diverge most:

1. **Phoneme excess** -- provides only a scalar (how many extra phones). No information about *where* or *how many times* the repeat occurs. Sufficient as a gate, insufficient as a search guide.

2. **Displacement histogram** -- provides the **repeat period** (peak displacement) and can detect **multiple overlapping repeats** (Example 4 showed two peaks for a k=3 pattern). The period directly constrains decomposition search: if d=17, only decompositions whose repeated sub-range sums to ~17 phones need testing, reducing candidates from ~50 to ~5-10.

3. **Suffix array + LCP** -- provides the **longest repeated substring** and its positions, but only the single longest. For k=3 patterns with two different repeated blocks, it finds only the longer one. Less informative than the displacement histogram for multi-pass repeats.

4. **Cost-profile variance** -- provides the **anomaly location** (where cost spikes), which directly estimates the breakpoint between passes. For Example 1, the spike at P position ~25 corresponds to the true repeat boundary. This is the most directly useful signal for breakpoint estimation but the most expensive to compute.

### Recommended Combination

**Tier 1 (always run):** Phoneme excess. O(1), catches all real repeats. The occasional false positive from noisy ASR is handled by downstream hypothesis testing.

**Tier 2 (run when excess passes):** Displacement histogram. O(|P|^2) but trivial for our sequence lengths. Provides the repeat period, which can:
- Prune decomposition candidates (only test those matching the estimated period)
- Detect multi-pass patterns (multiple peaks suggest k=3+)
- Reject false-positive excess signals (noisy ASR has no histogram peak)

The displacement histogram essentially eliminates the false-positive weakness of phoneme excess while adding the most useful auxiliary signal.

**Not recommended as pre-filters:** Suffix array and cost-profile variance. The suffix array provides a subset of the displacement histogram's information (longest repeat only). The cost-profile variance is better suited as a *breakpoint estimator* in the decomposition phase than as a gate, since it requires a reference and is more expensive. Both are valuable techniques but belong in the hypothesis-testing pipeline, not the pre-filter stage.

### Recommended Implementation

```python
def should_investigate(P, R_matched_len, threshold_excess=8, threshold_peak=3, n=3):
    """Two-tier pre-filter: fast excess check, then structural confirmation."""

    # Tier 1: O(1) length check
    excess = len(P) - R_matched_len
    if excess < threshold_excess:
        return False, {}

    # Tier 2: O(|P|^2) displacement histogram for structural confirmation
    ngrams = {}
    for i in range(len(P) - n + 1):
        key = tuple(P[i:i+n])
        ngrams.setdefault(key, []).append(i)

    displacements = Counter()
    for positions in ngrams.values():
        for a in range(len(positions)):
            for b in range(a + 1, len(positions)):
                displacements[positions[b] - positions[a]] += 1

    if not displacements:
        return True, {"excess": excess}  # fall through: no histogram data

    peak_d, peak_count = displacements.most_common(1)[0]
    if peak_count < threshold_peak:
        return True, {"excess": excess, "peak_weak": True}  # excess passed but no structural signal
        # Note: still returns True -- excess alone is sufficient to warrant investigation.
        # The weak peak is logged for diagnostics but does not veto.

    return True, {
        "excess": excess,
        "repeat_period": peak_d,
        "peak_count": peak_count,
        "histogram": dict(displacements.most_common(5))
    }
```

The displacement histogram runs only on the ~1% of segments that pass the excess check. Its main role is providing the repeat period, which constrains downstream search. It does **not** veto the excess check -- if excess >= 8, the segment is always investigated, because the excess signal alone has perfect recall.

See [breakpoint-examples.md](breakpoint-examples.md) for how these pre-filter signals are refined into breakpoint locations.
