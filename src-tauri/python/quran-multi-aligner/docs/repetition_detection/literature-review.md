# Repetition Detection: Literature Review & Alternative Algorithms

A survey of algorithms from bioinformatics, signal processing, and string matching that address problems structurally similar to our under-segmentation detection. Assessed against our specific problem profile:

- **Known reference R** (Quranic text phonemes, word-boundary-constrained)
- **Noisy query P** (ASR output, ~10-20% phoneme error rate)
- **Short sequences** (50-200 phonemes)
- **1-3 repetitions** (reciter restarts from earlier words in the verse)
- **Word-level granularity** required

Our proposed algorithm (decomposition + DP hypothesis testing, documented in [`repetition-detection-examples.md`](repetition-detection-examples.md)) is validated by this review — it is structurally equivalent to chimera detection and split-read alignment, both well-established in bioinformatics. The algorithms below are either direct alternatives or complementary techniques that could enhance or optimize the approach.

---

## Tier 1: Directly Applicable Algorithms

### 1. Wraparound DP (Noise-Cancelling Repeat Finder)

**Concept:** Instead of generating k separate R_expanded candidates and testing each, build a single DP matrix where the reference can **loop back** to an earlier word boundary when it reaches the end of the matched range. The alignment naturally discovers how many times P traverses R and where the repeat boundaries are.

**How it works:**
1. Run the standard substring Levenshtein DP of P against R
2. At each position where the reference index reaches the end of the matched word range, allow a "wrap" transition back to any earlier word boundary at a small penalty cost
3. The traceback reveals: did the alignment go through R once (no repeat) or multiple times (repeat detected)?

**Relationship to our algorithm:** This is a **single-DP replacement** for our multi-candidate approach. Instead of generating ~50-100 decomposition candidates and running DP on each, one modified DP call handles all possible decompositions simultaneously. The wraparound transitions implicitly test every possible repeat pattern.

**State machine view:** The standard DP is a linear state machine (`w0 → w1 → ... → wN → END`). The wraparound DP adds back-edges from later states to earlier word boundaries, creating cycles. The alignment finds the minimum-cost path through this cyclic graph. This is mathematically equivalent to a profile HMM with tandem repeat states — the Viterbi algorithm on that HMM is the same computation, but using emission probabilities instead of edit costs.

**Trade-offs:**
- *Pro:* O(|P| × |R|) — same as one alignment pass, not k × candidates
- *Pro:* Naturally handles any number of repetitions without specifying k
- *Con:* Requires modifying the DP core (`_dp_core.pyx` / `align_with_word_boundaries`)
- *Con:* Word-boundary constraints make the wrap transition non-trivial — wrap points must align with valid word boundaries
- *Con:* Less modular — our current approach reuses `align_with_word_boundaries` unchanged

**Verdict:** Most promising v2 optimization. If decomposition enumeration proves to be a bottleneck, this collapses the search into a single DP pass. The NCRF paper validates this for noisy sequences (PacBio reads at ~15-20% error) against known motifs — directly analogous to our ASR-noise + known-Quran-text setting.

**Further reading:**
- (a) [NCRF full text (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6853708/) — clearest explanation of the wraparound DP concept: one column of the DP matrix implicitly represents any number of tandem copies
- (b) [Harris et al. 2019 — "Noise-cancelling repeat finder"](https://doi.org/10.1093/bioinformatics/btz484) *Bioinformatics* 35(22):4809-4815 — validates wraparound alignment for noisy reads (PacBio, ~15-20% error) against known motifs
- (c) [makovalab-psu/NoiseCancellingRepeatFinder](https://github.com/makovalab-psu/NoiseCancellingRepeatFinder) — C implementation with Python parsing scripts; available in bioconda

---

### 2. Colinear Chaining (Anchor-Based Breakpoint Detection)

**Concept:** Given a set of short exact matches ("anchors") between P and R, find the maximum-weight ordered subset where positions increase monotonically in both sequences. Where colinearity breaks — the R-coordinate goes backward — that's where the reciter restarted.

**How it works:**
1. Extract all n-gram matches between P and R (we already do this in `phoneme_anchor.py` for voting)
2. Sort anchors by P-position
3. Find the longest/heaviest colinear chain (positions increase in both P and R)
4. P-positions not covered by the chain are the "repeated" region
5. Run a second chain on those residual positions to identify which R-region they match

**Relationship to our algorithm:** This is a **targeted breakpoint finder** that could replace the exhaustive decomposition enumeration. Instead of generating all k=2,3 decompositions, find the breakpoint via chaining, then verify with one or two DP calls. Reduces candidates from ~100 to ~3-5.

**Trade-offs:**
- *Pro:* O(A log A) where A = number of anchors — very fast
- *Pro:* Uses infrastructure we already have (n-gram matching from `phoneme_anchor.py`)
- *Pro:* Directly identifies breakpoints without exhaustive search
- *Con:* Anchors require exact n-gram matches, which ASR noise can disrupt
- *Con:* For very short repeat regions (2-3 words), there may be too few anchors to chain reliably

**Verdict:** Strong complement to our approach. Could serve as a **fast breakpoint estimator** that narrows the decomposition search space before running the full DP verification. Particularly useful if we find that k=3 decomposition generates too many candidates.

**Further reading:**
- (a) [Chaining lecture notes — FU Berlin](https://www.mi.fu-berlin.de/wiki/pub/ABI/GenomeComparisonP4/chaining.pdf) — clear visual explanation of the chaining problem with diagrams
- (b) [Li 2018 — "Minimap2: pairwise alignment for nucleotide sequences"](https://doi.org/10.1093/bioinformatics/bty191) *Bioinformatics* 34(18):3094-3100 — Section 4 covers the practical seed-chain-extend pipeline; [Jain et al. 2022 — "Colinear Chaining with Overlaps and Gap Costs"](https://doi.org/10.1089/cmb.2022.0266) — the overlap-aware variant relevant to our case
- (c) [lh3/minimap2](https://github.com/lh3/minimap2) — canonical long-read aligner, chaining in `chain.c`; [algbio/GraphChainer](https://github.com/algbio/GraphChainer) — colinear chaining on variation graphs

---

### 3. Self-Similarity Displacement Histogram (TideHunter-style)

**Concept:** Analyze P alone — no reference needed. Hash all phoneme n-grams, find identical pairs at different positions, and histogram their displacements. A peak at displacement d ≈ |R| phonemes means P contains a repeated block.

**How it works:**
1. Hash all phoneme n-grams (n=5-8) in P into a lookup table
2. For each n-gram appearing at positions i and j, record displacement d = j - i
3. Build a histogram of all displacements
4. A clear peak at some d indicates the repeat period
5. The peak location also estimates where the repeat starts (position ≈ |P| - d)

**Relationship to our algorithm:** This is a **reference-free pre-filter** that complements our phoneme-excess check. Our current pre-filter catches "P is longer than expected" — this catches "P contains self-similar regions." Together they provide two independent signals before entering the expensive decomposition phase.

**Trade-offs:**
- *Pro:* O(|P|²) but trivial for length 50-200 (~40k comparisons)
- *Pro:* Reference-free — works even before alignment
- *Pro:* Provides the repeat period, which constrains decomposition search
- *Con:* ASR noise can fragment n-gram matches, reducing peak clarity
- *Con:* Textual repeats in the Quran (e.g., Surah 55's refrain) would trigger false positives — still needs reference-based verification

**Verdict:** Low-cost addition as a second pre-filter layer. The displacement histogram gives a fast boolean signal ("likely has repeat") plus an estimated repeat period that could further prune decomposition candidates.

**Further reading:**
- (a) [TideHunter full text (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6612900/) — explains k-mer seeding and displacement histogram clearly; [Tandem Repeats Finder algorithm](https://tandem.bu.edu/trf/desc) — general context on self-alignment dot plots
- (b) [Gao et al. 2019 — "TideHunter: efficient and sensitive tandem repeat detection from noisy long-reads"](https://doi.org/10.1093/bioinformatics/btz376) *Bioinformatics* 35(14):i200-i207 — seed-and-chain approach, 20-100× faster than alignment-based methods
- (c) [yangao07/TideHunter](https://github.com/yangao07/TideHunter) — C implementation, handles PacBio/ONT error rates

---

### 4. UCHIME Chimera Detection

**Concept:** From metagenomics — detect sequences that are artificial concatenations of segments from multiple source organisms. Split the query at candidate breakpoints, match each segment independently against a reference database, and flag sequences where different segments match different (or the same, repeated) references.

**How it works:**
1. Split query P into overlapping windows
2. For each window, find the best-matching reference segment
3. If the best match changes at some point → structural breakpoint
4. Score the breakpoint model vs single-reference model
5. If breakpoint model wins → chimera (or in our case, repetition)

**Relationship to our algorithm:** Our decomposition approach is essentially a generalized UCHIME. Both test "does P explain better as one contiguous match, or as multiple segments matched independently?" The key concept worth borrowing from UCHIME is the **explicit split penalty** — a cost for each additional decomposition pass that prefers simpler explanations. Our algorithm currently has no such penalty; adding one would naturally prefer k=2 over k=3 when both explain P similarly well.

**Trade-offs:**
- *Pro:* Well-validated for noisy biological sequences (>20 years of use)
- *Pro:* The split penalty concept directly applicable to our candidate ranking
- *Con:* Designed for database search (many possible references) — our case is simpler (one known reference range)
- *Con:* UCHIME's breakpoint scoring is heuristic-based, not DP-based

**Verdict:** Conceptual validation of our approach rather than a replacement. The **split penalty** idea is the main takeaway — penalizing decompositions with more passes to avoid overfitting.

**Further reading:**
- (a) [UCHIME algorithm step-by-step (drive5.com)](https://www.drive5.com/usearch/manual6/uchime_algo.html) — concise description of 4-chunk query, 3-way alignment, and scoring; [Chimera filtering tutorial (LearnMetabarcoding)](https://learnmetabarcoding.github.io/LearnMetabarcoding/filtering/chimera_filtering.html) — broader context
- (b) [Edgar et al. 2011 — "UCHIME improves sensitivity and speed of chimera detection"](https://doi.org/10.1093/bioinformatics/btr381) *Bioinformatics* 27(16):2194-2200; [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC3150044/)
- (c) [torognes/vsearch](https://github.com/torognes/vsearch) — open-source reimplementation of UCHIME (de novo and reference-based); the primary actively-maintained implementation

---

### 5. Split-Read / Spliced Alignment

**Concept:** From genomics — when a sequencing read spans a structural variant (deletion, duplication, translocation), parts of the read align to different reference locations. Split-read mappers detect this by identifying poorly-aligned "clipped" regions and re-aligning them independently.

**How it works:**
1. Align full P against R using standard DP
2. Identify soft-clipped regions (parts of P with poor alignment quality)
3. Re-align clipped regions independently against R (without colinearity constraint)
4. Score: sum of alignment scores minus a split penalty
5. If split alignment scores better than single alignment → structural variant (or repetition)

**Relationship to our algorithm:** This is the closest structural analog. Our pipeline already does this implicitly:
- Standard DP alignment = primary alignment
- Pre-filter detecting excess phonemes = soft-clip detection
- Decomposition testing = supplementary alignment of clipped regions

The genomics formalization confirms our approach is sound. Their contribution is the **systematic clip detection** (not just length-based) and the **alignment quality profile** along P that reveals exactly where the primary alignment degrades.

**Trade-offs:**
- *Pro:* Mature, well-understood framework
- *Pro:* Alignment quality profile could replace our blunt length-based pre-filter
- *Con:* Designed for genome-scale problems — overhead of the framework is unnecessary for 50-200 phoneme sequences

**Verdict:** Validates our approach architecturally. The alignment quality profile idea (tracking per-position alignment cost) could enhance our pre-filter in a future version.

**Further reading:**
- (a) [Structural variation — Wikipedia](https://en.wikipedia.org/wiki/Structural_variation) — covers split-read, discordant pairs, and read-depth methods; [GATK: Structural Variants](https://gatk.broadinstitute.org/hc/en-us/articles/9022476791323-Structural-Variants) — three evidence types explained
- (b) [Dobin et al. 2013 — "STAR: ultrafast universal RNA-seq aligner"](https://doi.org/10.1093/bioinformatics/bts635) *Bioinformatics* 29(1):15-21 — Section 2.3 covers chimeric alignment; [Guo et al. 2021 — "ClipSV"](https://doi.org/10.1093/nargab/lqab003) — SV detection via read extension and spliced alignment
- (c) [alexdobin/STAR](https://github.com/alexdobin/STAR) — spliced transcripts alignment; [ChongLab/ClipSV](https://github.com/ChongLab/ClipSV) — Python split-read SV caller

---

## Tier 2: Useful Complementary Techniques

### 6. Partition DP (Optimal Sequence Segmentation)

**Concept:** Given a sequence P and a cost function for aligning any substring P[j:i] to the reference, find the minimum-cost partition of P into contiguous segments. Formulated as:

```
dp[i] = min over all valid j < i of (dp[j] + align_cost(P[j:i], R_window))
```

where j must land on a word boundary.

**How it works:**
1. Define a cost function: for each candidate segment P[j:i], compute the best alignment cost against R
2. Build a 1D DP table where dp[i] = minimum total cost to explain P[0:i]
3. The optimal partition falls out of the traceback
4. Each segment in the partition maps to a contiguous R-region

**Relationship to our algorithm:** This is a **more principled formulation** of the same problem. Our decomposition approach enumerates candidate partitions (k=2, k=3) and tests each. Partition DP finds the optimal partition directly without enumeration. However, the cost function (running a full DP alignment for each candidate segment) is expensive, making the overall complexity O(W² × DP_cost) where W = number of word boundaries in P.

**Could replace decomposition enumeration** if we can make the inner alignment fast enough. The key insight: instead of testing `[w0-w5, w3-w8]` as a decomposition of R, partition DP segments P itself and independently aligns each P-segment to R. Same result, different search strategy.

**Further reading:**
- (a) [Partition DP — The Overthinking Philosopher of DP (Medium)](https://medium.com/@rashminiranjan96/partition-dp-the-overthinking-philosopher-of-dynamic-programming-ff6a83138740) — walkthrough with examples; [Divide and Conquer DP (CP-Algorithms)](https://cp-algorithms.com/dynamic_programming/divide-and-conquer-dp.html) — optimization for the `dp[i] = min(dp[j] + cost(j,i))` recurrence
- (b) [Jackson et al. 2005 — "An Algorithm for Optimal Partitioning of Data on an Interval"](https://arxiv.org/abs/math/0309285) *IEEE Signal Processing Letters* 12(2):105-108 — foundational optimal partitioning paper using DP with penalized cost
- (c) [deepcharles/ruptures](https://github.com/deepcharles/ruptures) — Python library implementing optimal partitioning (`Dynp` class) and PELT for segmentation problems

---

### 7. Cost-Profile Change-Point Detection (PELT)

**Concept:** Compute a running alignment cost as a sliding window moves through P, then detect abrupt changes (change points) where the cost spikes. A spike indicates the phonemes stopped matching the expected R continuation — i.e., the reciter restarted.

**How it works:**
1. For each position i in P, compute cost(P[i:i+w], R_expected[i:i+w]) using a small window w
2. Plot this cost profile along P
3. Apply change-point detection (PELT, binary segmentation) to find abrupt transitions
4. Change points = candidate repeat breakpoints

**Relationship to our algorithm:** This is a **preprocessing step** that identifies where in P the repeat likely starts, without testing any decompositions. It narrows the search space before running the full DP. Related to the colinear chaining approach (Tier 1 §2) in that both find breakpoints, but this operates on alignment cost rather than anchor positions.

The PELT algorithm specifically is attractive because it runs in O(n) under mild conditions (when change points are well-separated) and finds the optimal set of change points for a given penalty.

**Further reading:**
- (a) [A Brief Introduction to Change Point Detection using Python (Tech Rando)](https://techrando.com/2019/08/14/a-brief-introduction-to-change-point-detection-using-python/) — tutorial with code examples; [PELT — ruptures docs](https://centre-borelli.github.io/ruptures-docs/user-guide/detection/pelt/) — API reference
- (b) [Killick et al. 2012 — "Optimal Detection of Changepoints With a Linear Computational Cost"](https://doi.org/10.1080/01621459.2012.737745) *JASA* 107(500):1590-1598; [arXiv:1101.1438](https://arxiv.org/abs/1101.1438)
- (c) [deepcharles/ruptures](https://github.com/deepcharles/ruptures) — mature Python library with PELT + other methods; [ruipgil/changepy](https://github.com/ruipgil/changepy) — minimal pure-Python PELT, good for understanding the algorithm

---

### 8. Bit-Parallel Edit Distance (edlib)

**Concept:** Myers' bit-vector algorithm computes edit distance using bitwise operations on machine words, achieving O(n × m / w) where w = word size (64 bits). For pattern lengths m ≤ 64, this gives O(n) search — effectively free.

**How it works:**
1. Encode the pattern (reference phoneme sequence) as bit vectors — one per alphabet symbol
2. Process the text (ASR phonemes) character by character
3. Use bitwise AND, OR, XOR, and shift operations to update the edit distance state
4. The last row of the DP matrix is maintained implicitly in machine words

**Relationship to our algorithm:** This is a **drop-in acceleration** for the inner DP alignment calls. Each candidate hypothesis test requires one DP alignment of P (~80-200 phonemes) against R_expanded (~100-300 phonemes). Our current DP is O(|P| × |R_expanded|); edlib's semi-global mode (`HW` — find best substring match) could accelerate each call by ~64×.

However, edlib's semi-global mode doesn't support word-boundary constraints or custom substitution costs — it uses unit costs. So it's useful as a **fast pre-screening filter** (quickly reject decompositions where even the best edit distance is too high) but can't replace the full word-boundary-constrained DP.

**Further reading:**
- (a) [edlib homepage](https://martinsos.github.io/edlib/) — overview with examples; [Bit-parallel string matching lecture (FU Berlin, PDF)](https://www.mi.fu-berlin.de/wiki/pub/ABI/RnaSeqP4/myers-bitvector-verification.pdf) — step-by-step diagrams of the bit-vector technique
- (b) [Myers 1999 — "A Fast Bit-Vector Algorithm for Approximate String Matching Based on Dynamic Programming"](https://doi.org/10.1145/316542.316550) *JACM* 46(3):395-415; [Šošić & Šikić 2017 — "Edlib: a C/C++ library for fast, exact sequence alignment"](https://doi.org/10.1093/bioinformatics/btw753)
- (c) [Martinsos/edlib](https://github.com/Martinsos/edlib) — C/C++ with Python bindings (`pip install edlib`); supports global (NW), semi-global (HW), and infix (SHW) modes

---

### 9. Suffix Array + LCP Array (Longest Repeated Substrings)

**Concept:** Build a suffix array (sorted array of all suffixes) and LCP array (longest common prefix between consecutive suffixes) for P. The maximum LCP value gives the longest repeated substring. All repeated substrings of length ≥ k can be enumerated by scanning the LCP array.

**How it works:**
1. Construct suffix array for P in O(n) via SA-IS algorithm
2. Construct LCP array in O(n) via Kasai's algorithm
3. Max(LCP) = length of longest exact repeated substring in P
4. Consecutive entries with LCP ≥ k form groups of suffixes sharing a common prefix of length ≥ k — these are repeated regions

**Relationship to our algorithm:** This is another **reference-free pre-filter**, similar to the displacement histogram (Tier 1 §3). It answers: "does P contain any long repeated substring?" If the longest repeated substring is shorter than a word's worth of phonemes, there's no repeat worth investigating.

For approximate repeats (with ASR noise), the q-gram lemma bridges the gap: if two substrings of length m have edit distance ≤ d, they share at least (m - q + 1 - q·d) common q-grams. So exact q-gram repeats found via suffix array serve as seeds for approximate repeat verification.

The suffix array approach is strictly more powerful than the displacement histogram (it finds all repeated substrings, not just those at a fixed displacement) but also more complex to implement.

**Further reading:**
- (a) [Suffix Array (CP-Algorithms)](https://cp-algorithms.com/string/suffix-array.html) — construction algorithms and applications with pseudocode; [Suffix Array (VisuAlgo)](https://visualgo.net/en/suffixarray) — interactive visualization; [Kasai's Algorithm (GeeksforGeeks)](https://www.geeksforgeeks.org/kasais-algorithm-for-construction-of-lcp-array-from-suffix-array/) — O(n) LCP construction
- (b) [Manber & Myers 1993 — "Suffix arrays: A new method for on-line string searches"](https://doi.org/10.1137/0222058) *SIAM J. Computing* 22(5):935-948 — the original suffix array + LCP paper
- (c) [louisabraham/pydivsufsort](https://github.com/louisabraham/pydivsufsort) — Python bindings to divsufsort (fastest SA construction), includes Kasai's LCP; [dohlee/pysuffixarray](https://github.com/dohlee/pysuffixarray) — pure Python SA with LCP and longest repeated substring

---

## Tier 3: Validated by Comparison

The following algorithm families were investigated but found to be either inapplicable to our problem constraints or strictly inferior to the approaches above:

| Algorithm | Domain | Why not applicable |
|-----------|--------|-------------------|
| **DTW variants** (subsequence, cyclic, FlexDTW) | Speech/music | Cannot represent R-pointer going backward; monotonicity assumption is fundamental |
| **BLAST / seed-and-extend** | Bioinformatics | Sequence length (50-200) too short for seeding advantage |
| **SimHash / MinHash / LSH** | Near-duplicate detection | Too coarse-grained for word-boundary precision |
| **Neural disfluency detection** (ACNN, end-to-end ASR) | NLP/speech | Our structural prior (known reference) is much stronger than learned features |
| **HTK phoneme stuttering detection** | Clinical speech | Targets single-phoneme stutters (b-b-ball), not phrase-level repetition |
| **Edit distance with duplications** | Formal string theory | O(n³–n⁴) complexity; worse than our approach for n=50-200 |
| **Pair HMM with tandem repeat states** | Statistical bioinformatics | Heavy probabilistic machinery for a problem our DP handles directly |
| **WGAC / genome-scale duplication tools** | Comparative genomics | Designed for megabase sequences; massive overhead for our scale |

**Key finding:** Our proposed decomposition + DP hypothesis testing approach is structurally equivalent to **chimera detection** (UCHIME, Tier 1 §4) and **split-read alignment** (STAR, Tier 1 §5) — both mature, well-validated techniques with 10+ years of use in bioinformatics production pipelines. The main difference is that those frameworks operate at genome scale with database search, while ours is optimized for short sequences with a single known reference.

---

## Summary: How the Pieces Fit Together

```
                    ┌─────────────────────────────────┐
                    │         Pre-Filters              │
                    │                                  │
                    │  • Phoneme excess ≥ 8 (current)  │
                    │  • Displacement histogram (§3)   │
                    │  • Suffix array LCP check (§9)   │
                    │  • Cost-profile spike (§7)       │
                    └──────────────┬──────────────────┘
                                   │ suspicious segment
                                   ▼
              ┌────────────────────────────────────────┐
              │       Breakpoint Estimation            │
              │                                        │
              │  • Colinear chaining (§2)              │
              │  • PELT change-point (§7)              │
              │  • Displacement peak location (§3)     │
              └──────────────┬─────────────────────────┘
                             │ candidate breakpoints
                             ▼
         ┌───────────────────────────────────────────────┐
         │          Hypothesis Verification              │
         │                                               │
         │  Current: decomposition enumeration + DP      │
         │  Alt v2:  wraparound DP (§1)                  │
         │  Alt v2:  partition DP (§6)                    │
         │  Speedup: edlib pre-screening (§8)            │
         └───────────────────────────────────────────────┘
```

The current algorithm sits in the "Hypothesis Verification" box. The Tier 1 and Tier 2 techniques offer improvements at each stage:
- **More pre-filters** reduce how often we enter the expensive verification
- **Breakpoint estimation** narrows the decomposition search space
- **Alternative verification** strategies (wraparound DP, partition DP) could replace exhaustive enumeration in v2
