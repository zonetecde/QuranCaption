# Under-Segmentation Detection via DP Repetition Analysis

## Context

When a reciter pauses (undetected by VAD) and repeats earlier words, the ASR phonemes for that segment contain the original phrase + the repeated portion. The current DP finds the best contiguous word match and absorbs the extra phonemes as edit cost — reporting contiguous words (e.g. 1-9) when the reciter actually said 1-5, 3-7, 6-9. Confidence can still be high (0.75-0.85) because deletion cost is low (0.8/phoneme).

**Goal:** Detect this during alignment by comparing hypotheses using the full word-boundary-constrained DP:
- **H0 (standard):** P aligns to R[start:end] with cost C₀
- **H1 (repetition):** P aligns to R_expanded (reference with repeated sub-ranges) with cost C₁
- Whichever hypothesis has the lowest normalized edit distance wins

## Algorithm

### Step 1: Pre-filter (after standard DP succeeds)

```python
excess = len(P) - ref_len   # phonemes consumed from R in the match
if excess < REPETITION_MIN_EXCESS_PHONES:  # default 8
    return result  # skip — P isn't suspiciously long
```

The pre-filter is the only gate. It establishes "this segment has unexplained phonemes" — after that, we let the DP decide which hypothesis best explains the data.

### Step 2: Generate all repetition hypotheses

Generate all valid k-pass decompositions for k=2 and k=3 together (and optionally k=4) of the matched word range `[start_word_idx, end_word_idx]`.

For each candidate, construct `R_expanded` by concatenating reference phonemes for each sub-range. Also construct `R_expanded_phone_to_word` — the word-index mapping for each phoneme in R_expanded. Repeated phonemes map to the **same** word indices as the original (they ARE the same words).

Run `align_with_word_boundaries(P, R_expanded, R_expanded_phone_to_word, expected_word=start_word_idx, prior_weight=0.0)` — **zero position prior** since we're testing a hypothesis, not seeking a sequential match.

### Step 3: Best hypothesis wins

```python
# Pre-filter passed — generate ALL candidates across k=2 and k=3
candidates = generate_k2(a, b, word_phones, len_P) + generate_k3(a, b, word_phones, len_P)

best = H0_result  # baseline: standard match, no repetition
for candidate in candidates:
    result = dp_align(P, expand(candidate))
    if result.norm_dist < best.norm_dist:
        best = result

# Quality floor: even the best must be reasonable
if best.norm_dist > REPETITION_MAX_NORM_DIST:
    return H0_result  # something else is wrong, not a clean repeat

# If a decomposition won, flag it
if best is not H0_result:
    has_repetition = True
    repetition_ranges = best.decomposition
    confidence_with_repeat = 1.0 - best.norm_dist
```

No improvement threshold, no escalation logic. The DP itself is the judge — whichever hypothesis explains P best wins. This is simpler and more robust:

- **If H0 genuinely fits well**, no decomposition will beat it (wrong decompositions have ordering mismatches that increase cost)
- **If there's a real repeat**, the correct decomposition will have near-zero norm_dist and naturally win
- **No edge cases** around improvement thresholds failing for high-H0-confidence segments with small repeats

### Why this works

- **Same DP, same cost model** — uses `align_with_word_boundaries()` with word boundary constraints and substitution cost table
- **Exact word boundaries** — R_expanded is constructed from `ChapterReference` per-word phoneme data; no approximation
- **Handles ASR noise** — edit distance absorbs phoneme errors naturally
- **Textual repetitions filtered** — when the Quran text itself repeats, H0 already fits well (P length ≈ R length, low C₀), so the pre-filter rejects immediately
- **Reciter repetitions caught** — H0 has high C₀ (extra phonemes as deletions), H1 fits much better
- **Phoneme ordering matters** — wrong decompositions produce R_expanded with mismatched phoneme order, causing high DP cost even when length matches

### Performance

Pre-filter eliminates ~99% of segments (P not significantly longer than R). For the ~1% that pass, all k=2 and k=3 candidates are tested together:
- k=2: ~W² raw candidates, ~15-30 after length filtering
- k=3: ~W⁴ raw, ~40-80 after length filtering (pruned during generation)
- Combined: ~50-100 filtered candidates per suspicious segment
- Each hypothesis: one DP call of O(|P| × |R_expanded|) ≈ O(80 × 120) = ~10k ops
- Total: ~500k-1M ops per suspicious segment — negligible (<1% of extraction time)

## Config Constants

```python
# Repetition detection (under-segmentation)
REPETITION_MIN_EXCESS_PHONES = 8       # P must have this many more phones than R_matched
REPETITION_MAX_NORM_DIST = 0.25        # Best hypothesis must meet this quality floor
```

Only two constants. The pre-filter gates entry; the quality floor catches degenerate cases. No improvement threshold or escalation threshold needed — the DP picks the best hypothesis directly.

## Files to Modify

### 1. `quranic_universal_aligner/config.py` — New constants

Add the two config constants above.

### 2. `quranic_universal_aligner/src/alignment/phoneme_matcher.py`

**Extend `AlignmentResult`** with new fields:
```python
has_repetition: bool = False
repetition_ranges: list = None            # [(s1,e1), (s2,e2), ...] decomposition
confidence_with_repeat: float = -1.0      # confidence accounting for repetition
```

**New function `check_repetition(P, chapter_ref, result)`:**
- Pre-filter by absolute phoneme excess
- Generate all valid k=2 and k=3 decompositions with length pruning
- Run DP on each candidate, track best across all candidates
- If best candidate beats H0 (lower norm_dist) and passes quality floor, populate repetition fields

**Modify `align_segment()`:** Call `check_repetition()` after building the result, before return. ~3 lines.

### 3. `quranic_universal_aligner/src/alignment/alignment_pipeline.py`

**Extend result tuple** from `(matched_text, confidence, matched_ref)` to `(matched_text, confidence, matched_ref, repetition_info)`.

`repetition_info` is `None` for non-repetition segments (specials, failures, normal matches), or a dict:
```python
{"has_repetition": True, "repetition_ranges": [[0,3],[2,3]], "confidence_with_repeat": 0.94}
```

All places that build result tuples need the 4th element added (`None` for specials/failures/transitions, the dict for successful alignments with repetition).

### 4. `extract_segments.py`

**In `align_sura()`:** Unpack 4th tuple element, write to segment dict:
```python
"has_repetition": rep_info.get("has_repetition", False) if rep_info else False,
"repetition_ranges": rep_info.get("repetition_ranges") if rep_info else None,
```

**In `write_results()`:** Include `has_repetition` and `repetition_ranges` in the detailed.json output segment.

**In `align_verse()`:** Same pattern — extend tuple unpacking.

### 5. `inspector/server.py`

**In `/api/seg/validate/<reciter>` and `_chapter_validation_counts`:** Read `has_repetition` field from segment data instead of calling `detect_phoneme_repetition()`. Replace the n-gram detection logic with a simple field check:
```python
if seg.get("has_repetition") and confidence < 1.0:
    undersegmented.append(...)
```

Remove the `_detect_phoneme_repetition` import (no longer needed).

### 6. `validators/validate_segments.py`

Keep `detect_phoneme_repetition()` as a **fallback** for legacy detailed.json files without the `has_repetition` field.

### 7. `inspector/static/segments.js` — Already done

Frontend changes (destructuring `undersegmented`, accordion category, chapter filter) remain unchanged.

## Verification

1. Add a synthetic test: manually construct P with repeated phonemes, run through `check_repetition()`, verify detection
2. Run extraction on a test chapter with known textual repetitions (e.g., Surah 55) and verify those are NOT flagged
3. Start inspector, confirm "Detected Repetitions" accordion works with the new detection
4. Measure extraction time before/after on a full reciter — should be <1% overhead

---

# Worked Examples with Real Phoneme Data

The following examples use real phoneme data from the Quranic Phonemizer to show the algorithm working end-to-end.

## Algorithm Summary

**Goal:** Detect when a reciter pauses (undetected by VAD) and repeats earlier words within a single segment.

**Approach:**
1. **Pre-filter** — Check if ASR output (P) has significantly more phonemes than the matched reference (R). Uses **absolute phoneme excess**, not ratio.
2. **Candidate generation** — Decompose the matched word range into k sub-ranges (k = 2, 3, 4) whose union is contiguous. Each decomposition produces an R_expanded by concatenating the reference phonemes for each sub-range.
3. **Hypothesis testing** — Run the existing word-boundary-constrained DP on each candidate. The decomposition whose R_expanded best explains P (lowest normalized edit distance) wins.
4. **Decision** — If the best decomposition is significantly better than the standard match, flag as repetition.

**Key change from v1:** R_expanded is no longer limited to suffix repetitions `[a,b] + [k,b]`. It can be any valid decomposition: `[a,e₁], [s₂,e₂], ..., [sₖ,b]` where each sub-range is contiguous, the union covers `[a,b]` with no gaps, and each sub-range has ≥ 2 words.

---

## Pre-filter: Absolute Excess vs Ratio

The pre-filter gates which segments enter hypothesis testing. A pure ratio threshold fails for long segments with small repeats:

| Scenario | Words | R (phones) | Repeated | Excess | Ratio | Detected @ 1.3? | Detected @ excess ≥ 8? |
|----------|-------|-----------|----------|--------|-------|-----------------|------------------------|
| Short segment, big repeat | 4 | 31 | 2 words (17 ph) | 17 | 1.55 | Yes | Yes |
| Medium segment, 3-word repeat | 7 | 36 | 3 words (22 ph) | 22 | 1.61 | Yes | Yes |
| Long segment, 3-word repeat | 25 | 115 | 3 words (18 ph) | 18 | 1.16 | **No** | Yes |
| Long segment, 2-word repeat | 25 | 115 | 2 words (11 ph) | 11 | 1.10 | **No** | Yes |
| No repeat (just ASR noise) | 10 | 57 | 0 | ~3 | 1.05 | No | No |

**Proposed threshold:**
```python
REPETITION_MIN_EXCESS_PHONES = 8   # ~1.5 words of extra phonemes
```

This catches 2+ word repeats in any segment length while filtering out normal ASR noise (typically 2-4 extra phones).

---

## Notation

- **R** = reference phonemes for the standard DP match (words `[a, b]`)
- **P** = ASR output phonemes (what the model transcribed from audio)
- **R_expanded** = concatenated reference phonemes for a candidate decomposition
- **H0** = standard hypothesis (no repetition)
- **H1** = best repetition hypothesis
- **norm** = normalized edit distance = `total_cost / len(P)`
- **conf** = `1 - norm`
- ASR noise modeled as ~5% substitution rate; deletion cost = 0.8, sub cost ≈ 0.5

---

## Example 1: Short Segment — Suffix Repeat

**Verse:** 55:13 (Surah Ar-Rahman refrain, 4 words)

### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | فَبِأَىِّ | `f a b i ʔ a jj i` | 8 |
| w1 | ءَالَآءِ | `ʔ aː l aː ʔ i` | 6 |
| w2 | رَبِّكُمَا | `rˤ aˤ bb i k u m aː` | 8 |
| w3 | تُكَذِّبَانِ | `t u k a ðð i b aː n` | 9 |
| | **Total R** | | **31** |

### What the reciter said

The reciter pauses after word 3, then repeats words 2-3 before the next segment starts.

```
Pass 1: w0  w1  w2  w3       (31 phones)
Pass 2:         w2  w3       (17 phones)
                             ─────────
Ground truth total:           48 phones
```

### ASR output (P)

P ≈ 50 phonemes (48 real + 2 from ASR noise/insertions):
```
f a b i ʔ a j i | ʔ aː l aː ʔ i | rˤ a b i k u m aː | t u k a ð i b aː n | rˤ aˤ bb i k u m aː | t u k a ðð i b aː n a
└─── w0 (1 sub) ─┘ └──── w1 ─────┘ └── w2 (1 sub) ───┘ └── w3 (1 sub) ────┘ └───── w2 repeat ─────┘ └──── w3 repeat (+1 ins) ──┘
```

### Step 1: Pre-filter

```
R = 31 phones,  P = 50 phones
excess = 50 - 31 = 19  ≥  8  →  PROCEED to hypothesis testing
```

### Step 2: Standard DP (H0)

The DP matches P against R[w0:w3] (31 phones). The 19 extra P phonemes become deletions:

```
H0 cost  = 19 × 0.8 (deletions) + 3 × 0.5 (ASR subs) = 15.2 + 1.5 = 16.7
H0 norm  = 16.7 / 50 = 0.33
H0 conf  = 0.67
H0 match = w0–w3
```

### Step 3: Candidate generation (k=2)

Generate all valid 2-pass decompositions of [w0, w3]:

| #  | Decomposition         | R_exp phones   | \|P\| diff | Length filter      |
|----|----------------------|----------------|-----------|-------------------|
| 1  | [w0–w1, w0–w3]       | 14 + 31 = 45   | 5         | Pass              |
| 2  | [w0–w1, w1–w3]       | 14 + 23 = 37   | 13        | Fail (>20%)       |
| 3  | [w0–w2, w0–w3]       | 22 + 31 = 53   | 3         | Pass              |
| 4  | [w0–w2, w1–w3]       | 22 + 23 = 45   | 5         | Pass              |
| 5  | [w0–w2, w2–w3]       | 22 + 17 = 39   | 11        | Fail              |
| 6  | [w0–w3, w0–w3]       | 31 + 31 = 62   | 12        | Fail              |
| 7  | [w0–w3, w1–w3]       | 31 + 23 = 54   | 4         | Pass              |
| 8  | [w0–w3, w2–w3]       | 31 + 17 = 48   | 2         | Pass              |

**5 candidates pass the length filter.** Each is tested with full DP alignment.

### Step 4: Best hypothesis

**Winner: Candidate 8 — [w0-w3, w2-w3]**

R_expanded = `[w0 w1 w2 w3 | w2 w3]` = 48 phones. P = 50 phones.

The 48 R_expanded phonemes align nearly 1:1 with the 48 "real" phonemes in P. Only ASR noise contributes to cost:

```
H1 cost  = 2 × 0.8 (extra P phones) + 3 × 0.5 (ASR subs) = 1.6 + 1.5 = 3.1
H1 norm  = 3.1 / 50 = 0.06
H1 conf  = 0.94
```

### Step 5: Best hypothesis wins

```
H0 norm = 0.33,  H1 norm = 0.06
H1 norm < H0 norm                     →  H1 wins
H1 norm (0.06) ≤ MAX_NORM_DIST (0.25) →  quality floor passed
→  REPETITION DETECTED
```

### Result

| Metric | H0 (standard) | H1 (best) |
|--------|---------------|-----------|
| Matched words | w0–w3 | w0–w3 |
| Confidence | 0.67 | **0.94** |
| Repetition ranges | — | **[w0-w3, w2-w3]** |
| Interpretation | "4 words, mediocre confidence" | "4 words + repeat of last 2" |

---

## Example 2: Long Segment — Small Repeat (Ratio Fails, Absolute Catches)

**Verse:** 2:255 Ayat al-Kursi, first 25 words (w0–w24)

### Word-Level Phoneme Data

| Idx | Arabic | Phones | Idx | Arabic | Phones |
|-----|--------|--------|-----|--------|--------|
| w0 | ٱللَّهُ | 6 | w13 | مَا | 2 |
| w1 | لَآ | 2 | w14 | فِى | 2 |
| w2 | إِلَـٰهَ | 6 | w15 | ٱلسَّمَـٰوَٰتِ | 8 |
| w3 | إِلَّا | 4 | w16 | وَمَا | 4 |
| w4 | هُوَ | 4 | w17 | فِى | 2 |
| w5 | ٱلْحَىُّ | 5 | w18 | ٱلْأَرْضِ | 6 |
| w6 | ٱلْقَيُّومُ | 7 | w19 | مَن | 3 |
| w7 | لَا | 2 | w20 | ذَا | 2 |
| w8 | تَأْخُذُهُۥ | 9 | w21 | ٱلَّذِى | 4 |
| w9 | سِنَةٌ | 6 | w22 | يَشْفَعُ | 7 |
| w10 | وَلَا | 4 | w23 | عِندَهُۥٓ | 7 |
| w11 | نَوْمٌ | 5 | w24 | إِلَّا | 4 |
| w12 | لَّهُۥ | 4 | | **Total R** | **115** |

### What the reciter said

After word 24 (إِلَّا), the reciter hesitates and repeats from word 22 (يَشْفَعُ):

```
Pass 1: w0 ──────────────────────── w24    (115 phones)
Pass 2:                        w22 ─ w24    ( 18 phones)
                                            ──────────
Ground truth total:                          133 phones
```

### ASR output (P)

P ≈ 136 phonemes (133 + 3 noise)

### Pre-filter: Ratio vs Absolute

```
excess = 136 - 115 = 21 phones

Ratio check:    136 / 115 = 1.18  <  1.30  →  WOULD MISS with ratio threshold
Absolute check: 21  ≥  8                    →  DETECTED with absolute threshold
```

**This is the motivating case for absolute excess over ratio.** A 3-word repeat in a 25-word segment has a small ratio but a clear absolute excess.

### Standard DP (H0)

```
H0 cost  = 18 × 0.8 (deletions for repeated phones) + 5 × 0.5 (ASR subs) = 14.4 + 2.5 = 16.9
H0 norm  = 16.9 / 136 = 0.12
H0 conf  = 0.88
```

Note: H0 confidence is 0.88 — looks "acceptable" but the segment boundary is wrong (includes repeated audio).

### Best hypothesis (k=2)

**Winner: [w0-w24, w22-w24]**

```
R_expanded = 115 + 18 = 133 phones,  P = 136 phones

H1 cost  = 3 × 0.8 (excess) + 5 × 0.5 (ASR subs) = 2.4 + 2.5 = 4.9
H1 norm  = 4.9 / 136 = 0.036
H1 conf  = 0.96
```

### Decision

```
H0 norm = 0.12,  H1 norm = 0.036
H1 norm < H0 norm                      →  H1 wins
H1 norm (0.036) ≤ MAX_NORM_DIST (0.25) →  quality floor passed
→  REPETITION DETECTED
```

### Result

| Metric | H0 (standard) | H1 (best) |
|--------|---------------|-----------|
| Confidence | 0.88 | **0.96** |
| Repetition ranges | — | **[w0-w24, w22-w24]** |
| Interpretation | "25 words, good conf" | "25 words + repeat of يَشْفَعُ عِندَهُۥٓ إِلَّا" |

Without absolute excess, this segment would pass QA at 0.88 confidence with misaligned boundaries. Note: under the old improvement-threshold approach (0.3), this would still pass (70% improvement). But with the simplified "best wins" strategy, there's no threshold to worry about — H1 simply has lower norm_dist and wins automatically.

---

## Example 3: Medium Segment — Middle Restart (Non-Suffix Pattern)

**Verse:** 36:40, words 0–6

### Word-Level Phoneme Data

| Idx | Arabic    | Phonemes                 | Count |
|-----|-----------|-------------------------|-------|
| w0  | لَا       | `l aː`                  | 2     |
| w1  | ٱلشَّمْسُ  | `ʔ a ʃ ʃ a m s u`        | 7     |
| w2  | يَنبَغِى    | `j a n b a ɣ iː`          | 7     |
| w3  | لَهَآ     | `l a h aː`              | 4     |
| w4  | أَن       | `ʔ a n`                 | 3     |
| w5  | تُدْرِكَ    | `t u d r i k a`            | 7     |
| w6  | ٱلْقَمَرَ  | `ʔ a l q a m a r`           | 7     |
|     | **Total R** |                         | **37**|


### What the reciter said

The reciter completes all 7 words, then restarts from word 3 (لَهَآ) — a **middle restart**, not a suffix:

```
Pass 1: w0  w1  w2  w3  w4  w5  w6    (36 phones)
Pass 2:             w3  w4  w5  w6    (22 phones)
                                       ──────────
Ground truth total:                     58 phones
```

### ASR output (P)

P ≈ 60 phonemes (58 + 2 noise)

### Pre-filter

```
excess = 60 - 36 = 24  ≥  8  →  PROCEED
```

### Standard DP (H0)

```
H0 cost  = 22 × 0.8 + 2 × 0.5 = 17.6 + 1.0 = 18.6
H0 norm  = 18.6 / 60 = 0.31
H0 conf  = 0.69
```

### Candidate generation (k=2)

Key candidates after length filter (P=60, tolerance ±20%):

| #  | Decomposition         | R<sub>exp</sub>      | \|P−R\| | DP norm | Conf  |
|----|----------------------|----------------------|---------|---------|-------|
| 1  | [w0–w3, w0–w6]       | 14 + 36 = 50         | 10      | 0.18    | 0.82  |
| 2  | [w0–w4, w2–w6]       | 22 + 29 = 51         | 9       | 0.16    | 0.84  |
| 3  | [w0–w5, w3–w6]       | 29 + 22 = 51         | 9       | 0.15    | 0.85  |
| **4** | **[w0–w6, w3–w6]**   | **36 + 22 = 58**     | **2**   | **0.05** | **0.95** |
| 5  | [w0–w6, w4–w6]       | 36 + 18 = 54         | 6       | 0.10    | 0.90  |
| 6  | [w0–w6, w5–w6]       | 36 + 15 = 51         | 9       | 0.15    | 0.85  |

**Candidate 4 wins** — its R_expanded (58 phones) most closely matches P (60 phones), and the phoneme *ordering* matches the ASR output exactly.

Note: Candidate 6 `[w0-w6, w5-w6]` (suffix repeat) has worse confidence than candidate 4 `[w0-w6, w3-w6]` (middle restart). **The v1 algorithm only tried suffix patterns and would have missed the correct decomposition.**

### Best hypothesis wins

```
H1 cost  = 2 × 0.8 + 2 × 0.5 = 1.6 + 1.0 = 2.6
H1 norm  = 2.6 / 60 = 0.04
H1 conf  = 0.96

H0 norm = 0.31,  H1 norm = 0.04  →  H1 wins  →  REPETITION DETECTED
```

### Result

| Metric | H0 (standard) | H1 (best) |
|--------|---------------|-----------|
| Confidence | 0.69 | **0.96** |
| Repetition ranges | — | **[w0-w6, w3-w6]** |
| Key insight | Suffix-only would find [w0-w6, w5-w6] at 0.90 | Full search finds the true restart point |

---

## Example 4: Multi-Pass Complex Repeat (k=3 Required)

**Verse:** 36:40, words 0–10

### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count |
|-----|--------|----------|-------|
| w0 | لَا | `l a` | 2 |
| w1 | ٱلشَّمْسُ | `ʃʃ a m s u` | 5 |
| w2 | يَنبَغِى | `j a ŋ b a ɣ iː` | 7 |
| w3 | لَهَآ | `l a h aː` | 4 |
| w4 | أَن | `ʔ a ŋ` | 3 |
| w5 | تُدْرِكَ | `t u d Q r i k a` | 8 |
| w6 | ٱلْقَمَرَ | `l q aˤ m a rˤ aˤ` | 7 |
| w7 | وَلَا | `w a l a` | 4 |
| w8 | ٱلَّيْلُ | `ll a j l u` | 5 |
| w9 | سَابِقُ | `s aː b i q u` | 6 |
| w10 | ٱلنَّهَارِ | `ñ a h aː r i` | 6 |
| | **Total R** | | **57** |

### What the reciter said

Complex 3-pass pattern — the reciter restarts twice:

```
Pass 1: w0  w1  w2  w3  w4  w5  w6                   (36 phones)
Pass 2:                 w4  w5  w6  w7  w8            (27 phones)
Pass 3:                             w7  w8  w9  w10   (21 phones)
                                                       ──────────
Ground truth total:                                     84 phones
```

Coverage check: Pass 1 covers w0–w6, Pass 2 covers w4–w8 (overlap w4–w6, extends to w8), Pass 3 covers w7–w10 (overlap w7–w8, extends to w10). Union = w0–w10. Contiguous, no gaps.

### ASR output (P)

P ≈ 87 phonemes (84 + 3 noise)

### Pre-filter

```
excess = 87 - 57 = 30  ≥  8  →  PROCEED
```

### Standard DP (H0)

```
H0 cost  = 27 × 0.8 + 4 × 0.5 = 21.6 + 2.0 = 23.6
H0 norm  = 23.6 / 87 = 0.27
H0 conf  = 0.73
```

### k=2 candidates (tested alongside k=3)

All k=2 and k=3 candidates are generated and tested together. Recall the constraints: `s₁ = a` (starts at w0), `eₖ = b` (last sub-range ends at w10), contiguous, ≥2 words per sub-range. The best k=2 candidates:

| Decomposition | R_exp | P diff | Issue |
|--------------|-------|--------|-------|
| [w0-w6, w4-w10] | 36+39=75 | 12 | Too short — misses the w7-w8 overlap |
| [w0-w8, w7-w10] | 45+21=66 | 21 | Too short — misses the w4-w6 repeat |
| [w0-w6, w0-w10] | 36+57=93 | 6 | Close length but wrong ordering — first pass ends at w6 then full restart doesn't match P |

No k=2 candidate can produce an R_expanded whose phoneme ordering matches P's 3-pass structure. The best k=2 candidates achieve partial alignment but always have ordering mismatches in the middle.

```
k=2 best norm  ≈ 0.13
k=2 best conf  ≈ 0.87
```

### k=3: Correct decomposition found (wins overall)

**Winner: [w0-w6, w4-w8, w7-w10]**

```
R_expanded = [w0 w1 w2 w3 w4 w5 w6 | w4 w5 w6 w7 w8 | w7 w8 w9 w10]
           =  36  +  27  +  21  =  84 phones

P (ASR)    = [w0 w1 w2 w3 w4 w5 w6 | w4 w5 w6 w7 w8 | w7 w8 w9 w10] + noise
           ≈  87 phones
```

Phoneme orderings match perfectly. Only ASR noise contributes to cost:

```
H1 cost  = 3 × 0.8 + 3 × 0.5 = 2.4 + 1.5 = 3.9
H1 norm  = 3.9 / 87 = 0.045
H1 conf  = 0.96

H0 norm = 0.27,  k=2 best norm = 0.13,  k=3 best norm = 0.045
k=3 [w0-w6, w4-w8, w7-w10] wins overall  →  REPETITION DETECTED
```

### Candidate counts

All k=2 and k=3 candidates tested together. With 11 words (w0–w10):

- **k=2**: ~90 raw → ~15 after length filter
- **k=3**: ~800 raw → ~40 after length filter (pruned during generation)
- **Combined**: ~55 filtered candidates, each DP call ≈ O(87 × 84) ≈ 7k ops
- **Total**: ~400k ops — negligible

### Result

| Metric | H0 | k=2 best | k=3 best (winner) |
|--------|-----|----------|----------|
| Confidence | 0.73 | 0.87 | **0.96** |
| Ranges | w0–w10 | [w0-w10, w4-w8] | **[w0-w6, w4-w8, w7-w10]** |
| Interpretation | Low conf, unexplained phonemes | Better but imperfect | True decomposition found |

**Key insight:** Since all candidates are tested together, the k=3 decomposition naturally wins by having the lowest norm_dist. No escalation logic needed — the DP picks the best explanation regardless of k.

---

## Example 5: Textual Repetition — NOT Flagged

**Verse:** 2:255 Ayat al-Kursi, words 7–18

This segment has multiple **textually repeated** words/phrases within the Quran text itself.

### Word-Level Phoneme Data

| Idx | Arabic | Phonemes | Count | Repeated? |
|-----|--------|----------|-------|-----------|
| w7 | لَا | `l aː` | 2 | Similar to w10 |
| w8 | تَأْخُذُهُۥ | `t a ʔ x u ð u h uː` | 9 | |
| w9 | سِنَةٌ | `s i n a t u` | 6 | |
| w10 | وَلَا | `w̃ a l aː` | 4 | Similar to w7 |
| w11 | نَوْمٌ | `n a w m u` | 5 | |
| w12 | لَّهُۥ | `ll a h uː` | 4 | |
| w13 | مَا | `m aː` | 2 | Same root as w16 |
| w14 | فِى | `f i` | 2 | **Identical to w17** |
| w15 | ٱلسَّمَـٰوَٰتِ | `ss a m aː w aː t i` | 8 | |
| w16 | وَمَا | `w a m aː` | 4 | Same root as w13 |
| w17 | فِى | `f i` | 2 | **Identical to w14** |
| w18 | ٱلْأَرْضِ | `l ʔ a rˤ dˤ i` | 6 | |
| | **Total R** | | **54** | |

Repeated phoneme patterns in the text:
- `l aː` appears at w7 and within w10 (`w̃ a l aː`)
- `m aː` appears at w13 and within w16 (`w a m aː`)
- `f i` appears at both w14 and w17 (identical!)

### What the reciter said

The reciter reads it **once through** — no repetition:

```
Pass 1: w7  w8  w9  w10  w11  w12  w13  w14  w15  w16  w17  w18    (54 phones)
```

### ASR output (P)

P ≈ 56 phonemes (54 + 2 noise)

### Pre-filter

```
excess = 56 - 54 = 2  <  8  →  STOP. No hypothesis testing needed.
```

**The pre-filter immediately rejects this segment.** Despite the text having repeated phoneme patterns (فِى appears twice, مَا/وَمَا share phonemes), the reciter said each word exactly once, so P length matches R length. No excess phonemes means no repetition to detect.

### Why textual repetition doesn't cause false positives

The repetition detection isn't triggered by repeated *patterns* in the reference — it's triggered by the ASR output being **longer than expected**. When text has internal repetition but the reciter reads it once:

| Condition | Reciter repeat | Textual repeat |
|-----------|---------------|----------------|
| P length | >> R length | ≈ R length |
| Excess phonemes | 10-30+ | 0-3 (noise only) |
| Pre-filter | PASS | **REJECT** |
| False positive risk | N/A | **None** |

Even if the pre-filter somehow passed (e.g., noisy ASR adding 8+ phones), the hypothesis testing would find that no decomposition with repeated sub-ranges fits better than the standard match, because the phoneme *ordering* in P matches R[w7:w18] linearly — there's no restart point where R_expanded would improve the alignment.

---

## Candidate Generation Algorithm

### Valid decomposition constraints

A k-pass decomposition `[(s₁,e₁), (s₂,e₂), ..., (sₖ,eₖ)]` of word range `[a, b]` must satisfy:

1. `s₁ = a` — starts at the matched start
2. `eₖ = b` — ends at the matched end
3. `sᵢ₊₁ ≤ eᵢ` — contiguity (no gap between consecutive passes)
4. `eᵢ - sᵢ ≥ 1` — each sub-range covers ≥ 2 words
5. `|R_expanded| ∈ [|P| × 0.8, |P| × 1.2]` — length filter

### Generation pseudocode

```python
def check_repetition(P, chapter_ref, result):
    """Test all k=2 and k=3 decompositions, pick best overall."""

    excess = len(P) - result.ref_len
    if excess < REPETITION_MIN_EXCESS_PHONES:
        return result  # pre-filter: not suspicious

    a, b = result.start_word_idx, result.end_word_idx
    word_phones = [len(chapter_ref.word_phonemes[i]) for i in range(a, b + 1)]
    target_len = len(P)
    min_len = target_len * 0.8
    max_len = target_len * 1.2

    # Generate ALL k=2 and k=3 candidates together
    candidates = list(_decompose(a, b, 2, word_phones, 0, max_len))
    candidates += list(_decompose(a, b, 3, word_phones, 0, max_len))
    valid = [c for c in candidates if min_len <= phones_for(c) <= max_len]

    # Test each with full DP, track best
    best_norm = result.norm_dist  # H0 baseline
    best_decomposition = None
    for candidate in valid:
        r_exp = expand(candidate, chapter_ref)
        res = dp_align(P, r_exp, prior_weight=0.0)
        if res.norm_dist < best_norm:
            best_norm = res.norm_dist
            best_decomposition = candidate

    # Quality floor + winner check
    if best_decomposition and best_norm <= REPETITION_MAX_NORM_DIST:
        result.has_repetition = True
        result.repetition_ranges = best_decomposition
        result.confidence_with_repeat = 1.0 - best_norm

    return result


def _decompose(a, b, k, word_phones, accumulated, max_len):
    """Recursive candidate generation with length pruning."""
    if accumulated > max_len:
        return  # prune: already too long

    if k == 1:
        sub_len = sum(word_phones[a:b+1])
        if a + 1 <= b and accumulated + sub_len <= max_len:
            yield [(a, b)]
        return

    for e1 in range(a + 1, b):           # first sub-range end (≥2 words, not all words)
        sub_len = sum(word_phones[a:e1+1])
        for restart in range(a, e1 + 1):  # next sub-range start (≤ e1 for contiguity)
            yield from (
                [(a, e1)] + rest
                for rest in _decompose(restart, b, k-1, word_phones,
                                        accumulated + sub_len, max_len)
            )
```

### Estimated candidate counts

| Words | k=2 (raw) | k=3 (raw) | Combined (filtered) |
|-------|-----------|-----------|---------------------|
| 4 | 8 | 4 | ~7 |
| 7 | 30 | ~120 | ~23 |
| 11 | 90 | ~800 | ~55 |
| 25 | 550 | ~10k | ~110 |

All k=2 and k=3 candidates are tested together — no escalation logic. With Cython DP and segments pre-filtered to ~1% of total, the computational cost is negligible — well under 1% of total extraction time even for 25-word segments.

---

## Summary Table

| Example | Words | Pattern | Excess | H0 Conf | Best Conf | Winner | Detected? |
|---------|-------|---------|--------|---------|-----------|--------|-----------|
| 1. Short suffix | 4 | [w0-w3, w2-w3] | 19 | 0.67 | 0.94 | k=2 | Yes |
| 2. Long small | 25 | [w0-w24, w22-w24] | 21 | 0.88 | 0.96 | k=2 | Yes |
| 3. Middle restart | 7 | [w0-w6, w3-w6] | 24 | 0.69 | 0.96 | k=2 | Yes |
| 4. Multi-pass | 11 | [w0-w6, w4-w8, w7-w10] | 30 | 0.73 | 0.96 | k=3 | Yes |
| 5. Textual repeat | 12 | None (read once) | 2 | 0.96 | — | H0 | **No** (correct) |

Key observations:
- **Confidence with repetition is consistently 0.94–0.96** — the correct decomposition explains nearly all phonemes, leaving only ASR noise
- **Absolute excess threshold catches all real repeats** including Example 2 where ratio would fail
- **Textual repetitions never trigger** because P ≈ R when read once
- **Generalized decomposition beats suffix-only** — Example 3 shows a 6% confidence gain from finding the true restart point
- **No improvement threshold needed** — the DP naturally picks the best hypothesis; the pre-filter (excess ≥ 8) is the only gate
