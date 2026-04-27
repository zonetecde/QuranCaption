# Plan: Integrate Wraparound DP into Production Pipeline

## Context

The wraparound DP algorithm for repetition detection has been validated on 1,252 verses (605 rep + 647 non-rep) with 99.5% recall, 0% false positives, and 155x Cython speedup. The Cython implementation (`cy_align_wraparound`) already exists in `_dp_core.pyx`. This plan integrates it into the production pipeline, replaces the old standard DP, and adds UI badges for detected repetitions.

## Files to Modify

1. **`config.py`** — Add `WRAP_PENALTY`, `WRAP_SCORE_COST`, `DYNAMIC_K_THRESHOLDS`
2. **`align_config.py`** — Same new params (batch mode values)
3. **`src/alignment/phoneme_matcher.py`** — Replace `align_with_word_boundaries` with `align_wraparound`, delete old function, update `align_segment()`
4. **`src/alignment/_dp_core.pyx`** — Delete `cy_align_with_word_boundaries`
5. **`src/core/segment_types.py`** — Add `has_repeated_words` to `SegmentInfo`, add profiling fields
6. **`src/alignment/alignment_pipeline.py`** — Propagate repetition info from `AlignmentResult`
7. **`src/pipeline.py`** — Map repetition info to `SegmentInfo.has_repeated_words`
8. **`src/ui/segments.py`** — Add "Repeated Words" badge with yellow color
9. **`app.py`** — Log Cython vs Python status at startup

## Step-by-Step

### Step 1: Config (`config.py`, `align_config.py`)

Add after the existing edit cost block:

```python
# Repetition detection (wraparound DP)
WRAP_PENALTY = 2.0              # Cost per wrap transition in DP
WRAP_SCORE_COST = 0.01          # Per-wrap additive penalty in scoring

# Dynamic K: excess phonemes → max wraps (checked in order, first match wins)
# Each tuple is (excess_threshold, max_wraps). Excess <= 0 always yields k=0.
DYNAMIC_K_THRESHOLDS = [
    (5, 1),    # excess < 5  → k=1
    (10, 2),   # excess < 10 → k=2
    (15, 3),   # excess < 15 → k=3
    (20, 4),   # excess < 20 → k=4
]
DYNAMIC_K_DEFAULT = 5           # excess >= 20 → k=5
```

Same values in `align_config.py`.

### Step 2: phoneme_matcher.py — Replace the DP

**Import block**: Replace the Cython import — only import `cy_align_wraparound`:

```python
try:
    from ._dp_core import cy_align_wraparound, init_substitution_matrix
    init_substitution_matrix(_SUBSTITUTION_COSTS, COST_SUBSTITUTION)
    _USE_CYTHON_DP = True
except ImportError:
    _USE_CYTHON_DP = False
```

**`AlignmentResult`** — Add two fields:

```python
n_wraps: int = 0               # Number of wraps (0 = no repetition)
max_j_reached: int = 0         # Furthest R position reached (for word range with wraps)
```

**New `align_wraparound()` pure Python function**: Port from `test_wraparound_dp.py` but use rolling rows (no traceback — traceback stays in the test harness). Cython dispatch at top.

**New `compute_dynamic_k()` helper** using config thresholds:

```python
def compute_dynamic_k(excess: int) -> int:
    if excess <= 0:
        return 0
    for threshold, k in DYNAMIC_K_THRESHOLDS:
        if excess < threshold:
            return k
    return DYNAMIC_K_DEFAULT
```

**`align_segment()`** — Replace the DP call:

```python
# Dynamic K from excess phonemes
excess = m - n  # len(P) - len(R)
dynamic_k = compute_dynamic_k(excess)

# Single unified call — k=0 is equivalent to the old standard DP
best_j, j_start, best_cost, norm_dist, n_wraps, max_j_reached = align_wraparound(
    P, R, R_phone_to_word,
    expected_word=pointer,
    prior_weight=START_PRIOR_WEIGHT,
    wrap_penalty=WRAP_PENALTY,
    max_wraps=dynamic_k,
    scoring_mode="additive",
    wrap_score_cost=WRAP_SCORE_COST,
)
```

Build `AlignmentResult` with the new fields. Use `max_j_reached` for `end_word_idx` when `n_wraps > 0`.

**Delete `align_with_word_boundaries()`** — fully replaced by `align_wraparound`.

### Step 3: _dp_core.pyx — Delete old function

Delete `cy_align_with_word_boundaries`. Only `cy_align_wraparound` remains. Update `init_substitution_matrix` if needed (should be fine — shared infrastructure).

### Step 4: segment_types.py

**`SegmentInfo`** — Add field:

```python
has_repeated_words: bool = False
```

**`ProfilingData`** — Add field:

```python
phoneme_wraps_detected: int = 0    # Segments with n_wraps > 0
```

**Profiling summary** — Update the print block:
- `Phoneme Alignment (Cython):` or `Phoneme Alignment (Python):` — based on `_USE_CYTHON_DP`
- Add `Wraps Detected: N` line in the alignment stats section

### Step 5: alignment_pipeline.py

**`run_phoneme_matching()`** — Track repetition segments:

```python
if alignment:
    ...existing code...
    if alignment.n_wraps > 0:
        repetition_segments.add(idx)
```

Add `repetition_segments` set (parallel to `gap_segments`). Return it as 5th element:

```python
return results, profiling, gap_segments, merged_into, repetition_segments
```

Add `phoneme_wraps_detected` count to profiling dict.

### Step 6: pipeline.py

**Unpack the new return value**:

```python
match_results, match_profiling, gap_segments, merged_into, repetition_segments = run_phoneme_matching(...)
```

**Segment building**: Set the new field:

```python
segments.append(SegmentInfo(
    ...existing fields...,
    has_missing_words=idx in gap_segments,
    has_repeated_words=idx in repetition_segments,
))
```

### Step 7: segments.py — UI Badge

**In `render_segment_card()`** (after the missing words badge):

```python
repeated_badge = ""
if seg.has_repeated_words:
    repeated_badge = '<div class="segment-badge segment-med-badge">Repeated Words</div>'
```

**Confidence override** — yellow for repeated words (not red like missing words):

```python
elif seg.has_repeated_words and confidence_class == "segment-high":
    confidence_class = "segment-med"
```

### Step 8: app.py — Startup Logging

After the Cython build subprocess:

```python
try:
    from src.alignment.phoneme_matcher import _USE_CYTHON_DP
    print(f"Cython DP: {'enabled' if _USE_CYTHON_DP else 'disabled (pure Python fallback)'}")
except ImportError:
    print("Cython DP: disabled (import error)")
```

### Step 9: Profiling Summary Enhancement

In `segment_types.py` profiling print:

```python
f"  Phoneme Alignment ({dp_impl}):          wall {_fmt(self.match_wall_time)}",
```

Where `dp_impl` is `"Cython"` or `"Python"`. Add after DP timing:

```python
f"    Wraps Detected:  {self.phoneme_wraps_detected}",
```

## Verification

1. **Build Cython**: `python3 setup.py build_ext --inplace`
2. **Run locally**: `python3 app.py --dev` — check startup logs say "Cython DP: enabled"
3. **Upload a test audio**: Verify alignment works, profiling summary prints correctly with Cython label
4. **Test with repetition audio**: Use a verse with known repetitions — verify "Repeated Words" badge appears with yellow color
5. **Test without repetition**: Normal verse should show no badge, same confidence as before
6. **Run test harness**: `python3 docs/repetition_detection/test_wraparound_dp.py --scoring additive --wrap-score-cost 0.01 --dynamic-k` — verify 602/605 recall, 0 regressions
