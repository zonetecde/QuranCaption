---
title: Quranic Universal Aligner
emoji: 🎯
colorFrom: blue
colorTo: green
sdk: gradio
sdk_version: 6.5.1
app_file: app.py
pinned: false
short_description: Segment recitations and extract text and word timestamps
license: mit
thumbnail: >-
  https://cdn-uploads.huggingface.co/production/uploads/684abe5b6327ae8863d106d2/O-S42Itgk6PbM-xaxgxcD.png
---

# Quranic Universal Aligner

Automatic forced alignment for Quran recitations. Upload an audio recording of any surah and get word-level timestamps aligned to the Quranic text.

## What it does

1. **Voice Activity Detection** — Detects speech regions in the audio using a custom VAD model
2. **Phoneme ASR** — Recognizes phonemes from each speech segment using wav2vec2 CTC models
3. **Anchor Detection** — Identifies which chapter/verse the recitation starts from using n-gram voting
4. **DP Alignment** — Matches recognized phonemes against the known Quranic text using substring Levenshtein dynamic programming with word-boundary constraints
5. **Special Segment Detection** — Identifies Basmala and Isti'adha segments that precede surahs
6. **Word Timestamps** (optional) — Submits aligned segments to an external MFA service for precise word-level, letter-level, and phoneme-level timing

## Models

| Model | Purpose |
|-------|---------|
| [obadx/recitation-segmenter-v2](https://huggingface.co/obadx/recitation-segmenter-v2) | Voice activity detection |
| [hetchyy/r15_95m](https://huggingface.co/hetchyy/r15_95m) | Phoneme ASR (Base — 95M params, faster) |
| [hetchyy/r7](https://huggingface.co/hetchyy/r7) | Phoneme ASR (Large — higher accuracy) |
| [hetchyy/Quran-phoneme-mfa](https://huggingface.co/spaces/hetchyy/Quran-phoneme-mfa) | MFA forced alignment (external Space) |

## How it works

### Alignment algorithm

The core alignment uses **substring Levenshtein DP** with word-boundary constraints:

- A sliding window of reference words constrains the search space around the expected position
- DP start positions must align with word boundaries; only word-end positions are evaluated as match candidates
- A position prior biases toward sequential matching, penalizing jumps
- Custom phoneme substitution costs account for phonetically similar sounds
- Confidence = 1 − normalized edit distance (green ≥ 80%, yellow 60–79%, red < 60%)

### Retry and recovery

When alignment fails for a segment:
- **Tier 1:** Expanded search window
- **Tier 2:** Expanded window + relaxed confidence threshold (0.45)
- **Re-anchoring:** After 2 consecutive failures, n-gram voting re-localizes position within the surah

### Animation

Two playback modes with real-time word highlighting:
- **Per-segment** — Animate a single aligned segment with word/character-level karaoke
- **Mega card** — Unified text flow across all segments with click-to-seek and configurable opacity windowing (Reveal, Fade, Spotlight, Isolate, Consume modes)