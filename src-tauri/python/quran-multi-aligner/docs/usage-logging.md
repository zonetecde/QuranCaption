# Usage Logging

## Part 1 — Reference: `recitation_app` Logging

Documents the recitation logging system used in `recitation_app` to collect anonymised analysis data on HuggingFace Hub. Included here as a reference for the quran_aligner schema below.

### Dataset

| Property | Value |
|----------|-------|
| Repo | `hetchyy/recitation-logs` (private) |
| Type | HuggingFace Dataset |
| Format | Parquet files in `data/` |
| Push interval | 1 minute |

Configured in `config.py`:

```python
USAGE_LOG_DATASET_REPO = "hetchyy/recitation-logs"
USAGE_LOG_PUSH_INTERVAL_MINUTES = 1
USAGE_LOG_AUDIO = False  # toggleable at runtime
```

### Schema

Defined in `utils/usage_logger.py` as `_RECITATION_SCHEMA`:

| Field | HF Type | Description |
|-------|---------|-------------|
| `audio` | `Audio` | Optional FLAC-encoded audio bytes embedded in parquet |
| `timestamp` | `Value(string)` | ISO 8601 datetime of the analysis |
| `user_id` | `Value(string)` | SHA-256 hash (12-char) of username or IP+UA |
| `verse_ref` | `Value(string)` | Quranic reference, e.g. `"1:1"` |
| `canonical_text` | `Value(string)` | Arabic text of the verse |
| `segments` | `Value(string)` | JSON array of segment results (see below) |
| `multi_model` | `Value(bool)` | Whether multiple ASR models were used |
| `settings` | `Value(string)` | JSON dict of Tajweed settings |
| `vad_timestamps` | `Value(string)` | JSON list of VAD segment boundaries |

#### Segment object (inside `segments` JSON)

```json
{
  "segment_ref": "1:1",
  "canonical_phonemes": "b i s m i ...",
  "detected_phonemes": "b i s m i ..."
}
```

#### Settings object (inside `settings` JSON)

```json
{
  "tolerance": 0.15,
  "iqlab_sound": "m",
  "ghunnah_length": 2,
  "jaiz_length": 4,
  "wajib_length": 4,
  "arid_length": 2,
  "leen_length": 2
}
```

### ParquetScheduler

Custom subclass of `huggingface_hub.CommitScheduler` (`utils/usage_logger.py`).

#### How it works

1. **Buffer** — Rows accumulate in an in-memory list via `.append(row)`. Access is protected by a threading lock.
2. **Flush** — On each scheduler tick (every `USAGE_LOG_PUSH_INTERVAL_MINUTES`):
   - Lock the buffer, swap it out, release the lock.
   - For any `audio` field containing a file path, read the file and convert to `{"path": filename, "bytes": binary_data}`.
   - Build a PyArrow table from the rows.
   - Embed the HF feature schema in parquet metadata:
     ```python
     table.replace_schema_metadata(
         {"huggingface": json.dumps({"info": {"features": schema}})}
     )
     ```
   - Write to a temp parquet file, then upload via `api.upload_file()` to `data/{uuid4()}.parquet`.
   - Clean up temp audio files.

#### Audio encoding

When `USAGE_LOG_AUDIO` is enabled:

```python
sf.write(filepath, audio_array, sample_rate, format="FLAC")
row["audio"] = str(filepath)  # ParquetScheduler reads and embeds the bytes
```

The audio is 16kHz mono, encoded as FLAC, and stored as embedded bytes inside the parquet file.

### Lazy Initialisation

Schedulers are **not** created at import time. They are initialised on first call to `_ensure_schedulers()` using double-checked locking:

```python
_recitation_scheduler = None
_schedulers_initialized = False
_init_lock = threading.Lock()

def _ensure_schedulers():
    global _recitation_scheduler, _schedulers_initialized
    if _schedulers_initialized:
        return
    with _init_lock:
        if _schedulers_initialized:
            return
        _schedulers_initialized = True
        _recitation_scheduler = ParquetScheduler(
            repo_id=USAGE_LOG_DATASET_REPO,
            schema=_RECITATION_SCHEMA,
            every=USAGE_LOG_PUSH_INTERVAL_MINUTES,
            path_in_repo="data",
            repo_type="dataset",
            private=True,
        )
```

This avoids interfering with ZeroGPU, which is sensitive to early network calls.

### Error Logging

Errors use a separate `CommitScheduler` (not `ParquetScheduler`) that watches a local directory:

- Local path: `/usage_logs/errors/error_log-{uuid4()}.jsonl`
- Remote path: `data/errors/`
- Format: JSONL with fields `timestamp`, `user_id`, `verse_ref`, `error_message`

Errors are appended to the JSONL file under a file lock. The `CommitScheduler` syncs the directory to Hub periodically.

### User Anonymisation

```python
def get_user_id(request) -> str:
    username = getattr(request, "username", None)
    if username:
        return hashlib.sha256(username.encode()).hexdigest()[:12]
    ip = headers.get("x-forwarded-for", "").split(",")[0].strip()
    ua = headers.get("user-agent", "")
    return hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:12]
```

- Logged-in HF users: hash of username
- Anonymous users: hash of IP + User-Agent
- Always truncated to 12 hex characters

### Fallback

If the scheduler fails to initialise (no HF token, network issues), rows are written to a local JSONL file at `usage_logs/recitations_fallback.jsonl` (without audio).

### Integration Point

Logging is called from the audio processing handler (`ui/handlers/audio_processing.py`) after each analysis completes:

```python
log_analysis(
    user_id, ref, text, segments,
    multi_model=bool(use_multi),
    settings=_settings,
    audio=audio_for_log,       # tuple of (sample_rate, np.ndarray) or None
    vad_timestamps=vad_ts,     # list of [start, end] pairs
)
```

Errors are logged separately:

```python
log_error(user_id, ref, "Audio loading failed")
```

### Dependencies

- `huggingface_hub` — `CommitScheduler` base class and Hub API
- `pyarrow` — Parquet table creation and schema metadata
- `soundfile` — FLAC audio encoding

---

## Part 2 — `quran_aligner` Logging Schema

Schema for logging alignment runs from this project. One row per audio upload. The row is mutated in-place while it sits in the `ParquetScheduler` buffer (before the next push-to-Hub tick). Run-level fields (profiling, reciter stats, quality stats, settings) are **overwritten** to reflect the latest run. Segment results are **appended** so every setting combination is preserved.

### Run-level fields

#### Identity

| Field | HF Type | Description |
|-------|---------|-------------|
| `audio` | `Audio` | FLAC-encoded audio (16kHz mono) |
| `audio_id` | `Value(string)` | `{sha256(audio_bytes)[:16]}:{timestamp}`, e.g. `a3f7b2c91e04d8f2:20260203T141532` |
| `timestamp` | `Value(string)` | ISO 8601 datetime truncated to seconds, e.g. `2026-02-03T01:50:45` |
| `user_id` | `Value(string)` | SHA-256 hash (12-char) of IP+UA |

The `audio_id` hash prefix enables grouping/deduplication of the same recording across runs; the timestamp suffix makes each run unique. Cost is ~90ms for a 5-minute recording.

#### Input metadata

| Field | HF Type | Description |
|-------|---------|-------------|
| `audio_duration_s` | `Value(float64)` | Total audio duration in seconds |
| `num_segments` | `Value(int32)` | Number of VAD segments |
| `surah` | `Value(int32)` | Detected surah (1-114) |

#### Segmentation settings

| Field | HF Type | Description |
|-------|---------|-------------|
| `min_silence_ms` | `Value(int32)` | Minimum silence duration to split |
| `min_speech_ms` | `Value(int32)` | Minimum speech duration for a valid segment |
| `pad_ms` | `Value(int32)` | Padding around speech segments |
| `asr_model` | `Value(string)` | `"Base"` (`hetchyy/r15_95m`) or `"Large"` (`hetchyy/r7`) |
| `device` | `Value(string)` | `"GPU"` or `"CPU"` |

#### Profiling (seconds)

| Field | HF Type | Description |
|-------|---------|-------------|
| `total_time` | `Value(float64)` | End-to-end pipeline wall time |
| `vad_queue_time` | `Value(float64)` | VAD queue wait time |
| `vad_gpu_time` | `Value(float64)` | VAD actual GPU execution |
| `asr_gpu_time` | `Value(float64)` | ASR actual GPU execution |
| `dp_total_time` | `Value(float64)` | Total DP alignment across all segments |

#### Quality & retry stats

| Field | HF Type | Description |
|-------|---------|-------------|
| `segments_passed` | `Value(int32)` | Segments with confidence > 0 |
| `segments_failed` | `Value(int32)` | Segments with confidence <= 0 |
| `mean_confidence` | `Value(float64)` | Average confidence across all segments |
| `tier1_retries` | `Value(int32)` | Expanded-window retry attempts |
| `tier1_passed` | `Value(int32)` | Successful tier 1 retries |
| `tier2_retries` | `Value(int32)` | Relaxed-threshold retry attempts |
| `tier2_passed` | `Value(int32)` | Successful tier 2 retries |
| `reanchors` | `Value(int32)` | Re-anchor events (after consecutive failures) |
| `special_merges` | `Value(int32)` | Basmala-fused segments |

#### Reciter stats

Computed from matched segments (those with `word_count > 0`). Already calculated in `app.py:877-922` for console output.

| Field | HF Type | Description |
|-------|---------|-------------|
| `words_per_minute` | `Value(float64)` | `total_words / (total_speech_s / 60)` |
| `phonemes_per_second` | `Value(float64)` | `total_phonemes / total_speech_s` |
| `avg_segment_duration` | `Value(float64)` | Mean duration of matched segments |
| `std_segment_duration` | `Value(float64)` | Std dev of matched segment durations |
| `avg_pause_duration` | `Value(float64)` | Mean inter-segment silence gap |
| `std_pause_duration` | `Value(float64)` | Std dev of pause durations |

#### Session flags

| Field | HF Type | Description |
|-------|---------|-------------|
| `resegmented` | `Value(bool)` | User resegmented with different VAD settings |
| `retranscribed` | `Value(bool)` | User retranscribed with a different ASR model |

#### Segments, timestamps & error

| Field | HF Type | Description |
|-------|---------|-------------|
| `segments` | `Value(string)` | JSON array of run objects (see below) — **appended** on resegment/retranscribe |
| `word_timestamps` | `Value(string)` | JSON array of per-segment MFA word timings (see below), null until computed |
| `error` | `Value(string)` | Top-level error message if the pipeline failed |

### Segment runs (inside `segments` JSON)

Each run with different settings appends a new run object. The array preserves the full history so every setting combination is available.

```json
[
  {
    "min_silence_ms": 200,
    "min_speech_ms": 1000,
    "pad_ms": 100,
    "asr_model": "Base",
    "segments": [
      {
        "idx": 1,
        "start": 0.512,
        "end": 3.841,
        "duration": 3.329,
        "ref": "2:255:1-2:255:5",
        "confidence": 0.87,
        "word_count": 5,
        "ayah_span": 1,
        "phoneme_count": 42,
        "undersegmented": false,
        "missing_words": false,
        "special_type": null,
        "error": null
      }
    ]
  },
  {
    "min_silence_ms": 600,
    "min_speech_ms": 1500,
    "pad_ms": 300,
    "asr_model": "Base",
    "segments": [...]
  }
]
```

#### Run object

| Field | Type | Description |
|-------|------|-------------|
| `min_silence_ms` | int | Silence setting used for this run |
| `min_speech_ms` | int | Speech setting used for this run |
| `pad_ms` | int | Pad setting used for this run |
| `asr_model` | string | `"Base"` or `"Large"` |
| `segments` | array | Per-segment objects for this run |

#### Per-segment object

| Field | Type | Description |
|-------|------|-------------|
| `idx` | int | 1-indexed segment number |
| `start` | float | Segment start time in seconds |
| `end` | float | Segment end time in seconds |
| `duration` | float | `end - start` |
| `ref` | string | Matched reference `"S:A:W1-S:A:W2"`, empty if failed |
| `confidence` | float | Alignment confidence [0.0, 1.0] |
| `word_count` | int | Number of words matched |
| `ayah_span` | int | Number of ayahs spanned |
| `phoneme_count` | int | Length of ASR phoneme sequence |
| `undersegmented` | bool | Flagged if word_count >= 20 or ayah_span >= 2 and duration >= 15s |
| `missing_words` | bool | Gaps detected in word alignment |
| `special_type` | string\|null | `"Basmala"`, `"Isti'adha"`, `"Isti'adha+Basmala"`, or null |
| `error` | string\|null | Per-segment error message |

### Word timestamps (inside `word_timestamps` JSON)

Populated when the user computes MFA timestamps. Array of per-segment word timing arrays:

```json
[
  {
    "segment_idx": 1,
    "ref": "2:255:1-2:255:5",
    "words": [
      {"word": "ٱللَّهُ", "start": 0.512, "end": 0.841},
      {"word": "لَآ", "start": 0.870, "end": 1.023}
    ]
  }
]
```

### In-place mutation

The row dict is appended to `ParquetScheduler` on the initial run, and a reference is stored in `gr.State`. Subsequent actions (resegment, retranscribe, compute timestamps) mutate the dict in-place before the next push-to-Hub tick (every 1 minute).

- **Overwritten on each run:** profiling, quality/retry stats, reciter stats, run-level settings (`min_silence_ms`, `asr_model`, etc.), `num_segments`, `surah`.
- **Appended on each run:** `segments` JSON array gains a new run object with its settings and per-segment results.
- **Set once:** `word_timestamps` is populated when the user computes MFA timestamps (null until then).
- **If the push already fired** before a subsequent action, the mutation is a no-op on the already-uploaded row. The new results are lost for that row — acceptable since the initial run is always captured.

### Design rationale

- **Settings are denormalised** into each row so config changes can be correlated with quality without joins.
- **Profiling fields are flat columns**, not nested JSON, so they are directly queryable in the HF dataset viewer and pandas.
- **Segments are an array of run objects** — each run includes its settings alongside the per-segment results, so different setting combinations are preserved even though run-level fields reflect the latest state.
- **`mean_confidence` is pre-computed** at the run level for easy filtering and sorting without parsing the segments array.
- **Audio is always uploaded** as the first column so every run is reproducible and the dataset is playable in the HF viewer.
- **`audio_id`** combines a content hash with a timestamp — the hash prefix groups re-runs of the same recording, the suffix makes each row unique.
- **All sources are from existing objects** — `ProfilingData` (segment_processor.py), `SegmentInfo` (segment_processor.py), and `config.py` values. No new computation is required beyond assembling the row.
