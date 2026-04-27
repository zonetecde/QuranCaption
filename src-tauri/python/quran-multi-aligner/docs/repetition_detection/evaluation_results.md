# Wraparound DP Evaluation Results

Tested on 1,252 verses across 2 reciters with real ASR phonemes from the HF dataset `hetchyy/quranic-universal-ayahs`.

## Test Set

| Set | Reciter | Verses | Source |
|-----|---------|--------|--------|
| Repetition (positive) | ali_jaber | 133 | Verses with overlapping segment word ranges |
| Repetition (positive) | minshawy_murattal | 472 | Same detection criteria |
| Non-repetition (negative) | ali_jaber | 323 | Random sample: 174 long (30+ words), 100 medium, 50 short |
| Non-repetition (negative) | minshawy_murattal | 324 | Same sample strategy |

ASR model: Base (`hetchyy/r15_95m`). CTC decoding via `tokenizer.convert_ids_to_tokens()` + collapse (same as production `phoneme_asr.py`).

## Quantitative Results

### Final configuration

- `WRAP_PENALTY = 2.0`
- `WRAP_SCORE_COST = 0.01` (additive scoring mode)
- Dynamic K: excess < 5 → k=1, < 10 → k=2, < 15 → k=3, < 20 → k=4, else k=5
- Full-matrix DP with traceback (Python), rolling-row DP (Cython)

### Detection metrics

| Metric | Value |
|--------|-------|
| **Recall** | 99.5% (602/605) |
| **False positives** | 0% (0/647) |
| **Precision** | 100% |
| **F1** | 0.997 |

### Alignment quality

| Metric | Value |
|--------|-------|
| Wrap count exact match | 100% (602/602) |
| Wrap count MAE | 0.00 |
| Mean confidence improvement (v2 vs v1) | +0.113 |
| v2 worse than v1 | 0/605 |
| Word range IoU | 1.000 |
| Exact boundary match | 99.7% (600/602) |

### Performance

| | Python | Cython | Speedup |
|---|---|---|---|
| Per-verse mean | 752.9ms | 4.8ms | **155x** |
| Per-verse p95 | — | — | — |

Production overhead with dynamic K: ~0% — 89% of non-rep segments have excess ≤ 0 (k=0, identical to old standard DP).

## 3 False Negatives

All caused by ASR collapsing the repetition — P ≈ R despite the reciter repeating words.

| Verse | P | R | Issue |
|-------|---|---|-------|
| 3:1 | 9 | 10 | Single-word verse (الٓمٓ) read twice. ASR produced one reading. |
| 45:4 | 52 | 52 | Full verse read twice. ASR collapsed to exactly R length. |
| 45:11 | 62 | 62 | 1-word overlap (word 8). Too small for CTC to preserve. |

These are undetectable without external evidence (e.g., audio duration 2x expected). The algorithm correctly handles them — no wrap is cheaper than wrapping when P ≈ R.

## Qualitative Findings

### 1. CTC compression naturally gates the algorithm

Non-repetition verses consistently have P ≤ R (CTC compresses ~1-4%). This means `excess = P - R ≤ 0`, so `dynamic_k = 0`, and the wraparound DP degenerates to the standard DP. No separate short-circuit path is needed — the physics of CTC output does the gating.

Repetition verses have P > R because the repeated content adds extra phonemes. The excess directly maps to how many wraps are possible.

| | P/R ratio | Excess | Dynamic K |
|---|---|---|---|
| Non-rep verses | 0.96–1.02 (mean 0.99) | ≤ 0 for 89%, 1–4 for 11% | 0 for 89%, 1 for 11% |
| Rep verses | 1.05–1.50+ | 5–60+ | 1–5 |

### 2. Wrap penalty is fully refunded in scoring — the additive fix

The original scoring formula `phoneme_cost = dist - k * wrap_penalty` subtracts all wrap penalties from the score. Each additional wrap is free from the selection function's perspective — the DP pays the penalty internally, but it's refunded at scoring time.

This caused 14 over-predictions (gt=1 rep, pred=2 wraps) in two patterns:
- **End-of-P spurious wraps**: At the last P row, the DP wraps and immediately ends at a word boundary. Cost = just `WRAP_PENALTY`, fully refunded.
- **Fragmented wraps**: Instead of one wrap covering the full overlap, the DP splits into 2 smaller wraps at adjacent positions.

The additive scoring fix (`score += k * WRAP_SCORE_COST`) adds a small visible cost per wrap. With `WRAP_SCORE_COST = 0.01`, a wrap is only taken when it improves phoneme quality by >1% — real repetitions improve by 5–30%, spurious wraps improve by <1%.

### 3. Dynamic K from excess phonemes

Fixed K=5 for all segments wastes computation. The excess phonemes directly bound possible wraps — you can't have 5 wraps if you only have 4 extra phonemes.

The mapping `excess < 5 → k=1, < 10 → k=2, ...` was validated empirically. No verse in the test set had its wrap count reduced by the dynamic K cap — the thresholds are conservative enough.

### 4. Traceback reveals wrap structure

The full-matrix DP with parent pointers enables traceback: for each wrap, we know (P position, R end position, R start position). This shows exactly which words the reciter repeated.

Example — ali_jaber/2:33 (gt: words 8–11 repeated):
```
wrap 1: P[78], R reached w11 (j=79), jumped back to w8 (j=61)
  repeated: قَالَ أَلَمْ أَقُل لَّكُمْ
```

Traceback is only implemented in the Python test harness (full matrix). The Cython production version uses rolling rows (no traceback) for performance. Traceback can be added to Cython later when `repetition_ranges` output is needed.

### 5. Word range accuracy with wraps

When n_wraps > 0, the final `j` position in the DP has wrapped back and may be earlier than the furthest-right position ever reached. The `max_j` tracking array records the true span. For word range computation:
- k=0: `end_word = R_phone_to_word[j - 1]` (standard)
- k>0: `end_word = R_phone_to_word[max(max_j, j) - 1]` (use furthest reached)

Without `max_j`, 9/602 boundary matches were wrong. With it, 600/602 are exact.

## Things to Watch in Real Alignment

### 1. Basmala prefix interaction

When `alignment_pipeline.py` prepends Basmala phonemes (sentinel `word_index = -1`), they occupy the first positions of R. A wrap targeting position 0 would wrap into the Basmala prefix. In practice this is unlikely — the DP economics disfavour wrapping to a prefix that doesn't match the repeated phonemes. If observed, filter wrap targets to `j >= basmala_prefix_len`.

### 2. Retry tiers with wraparound

The pipeline's retry tiers call `align_segment()` with expanded windows (R grows from ~300 to ~700 phonemes). With W ≈ 110 word boundaries, the wrap sweep cost is `|P| × W² × K`. Combined with 3 retry calls per failed segment, this could be slow. Monitor wall-clock time for retry segments. If retries dominate, consider `MAX_WRAPS=2` for retry-tier calls.

### 3. Textual repetitions (Surah 55, 77)

Surah 55 repeats فَبِأَىِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ 31 times. If a segment spans two consecutive verses, both containing the refrain, the DP might find a wrap from one refrain to the other as slightly cheaper than a no-wrap path. The position prior (`START_PRIOR_WEIGHT`) penalizes this, but monitor Surah 55 specifically for false positive wraps.

### 4. Chapter transitions

When the pointer exceeds chapter end and the pipeline moves to the next chapter, the R window resets. Dynamic K still works — excess is computed per-segment. But if the first segment of a new chapter has high excess (e.g., from inter-chapter silence being transcribed as phonemes), it could trigger spurious wraps. The special segment detection (Basmala/Isti'adha) runs before `align_segment()` and should handle this.

### 5. Very long segments (VAD failures)

If VAD misses all pauses in a 108-second verse (like 4:23 with 5 repetitions), P could be 600+ phonemes. The 3D DP at K=5 is 600 × 300 × 6 ≈ 1.1M states. In Cython this is fine (~5ms). In Python fallback it's ~750ms per segment — not a concern since alignment runs on CPU after the GPU lease is released, with no hard timeout.

### 6. Per-segment vs per-verse detection

The test set evaluates full-verse ASR against full-verse reference. In production, each VAD segment is aligned independently against a windowed reference. A repetition that spans a VAD pause boundary (reciter pauses mid-repeat) would appear as two segments:
- Segment A: words 1–10 (first reading)
- Segment B: words 8–15 (repeats 8–10, continues with 11–15)

Segment B has the overlap. The wraparound DP processes segment B's ASR against the reference window. If B's ASR includes the repeated phonemes (words 8–10 twice), the DP detects the wrap. If VAD splits the repetition further (pause between first and second reading of words 8–10), each sub-segment may have P ≈ R and no wrap is detected — same as the 3 false negatives.

### 7. Confidence semantics

`confidence = 1 - norm_dist` reflects phoneme alignment quality only — wrap penalty is excluded. A segment with high phoneme quality and many wraps has high confidence. Repetition metadata (`n_wraps`, `has_repeated_words`) is carried separately. The "Repeated Words" badge is a distinct signal from confidence color — a segment can be green (high confidence) with a yellow "Repeated Words" badge.

### 8. Test with the Large ASR model

The Large model (`hetchyy/r7`) was tested on the repetition set and produced nearly identical results (99.5% recall, same 3 FNs). However, it had slightly fewer over-predictions (9 vs 14 on the original scoring). The additive fix eliminated over-predictions for both models. The non-repetition test set was only run with the Base model. Running with Large would confirm the dynamic K gating works equally well with higher-quality ASR.
