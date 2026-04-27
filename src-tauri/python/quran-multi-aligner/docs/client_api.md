# Client API Reference

- [Quick Start](#quick-start)
- [Sessions](#sessions)
- [Alignment Endpoints](#alignment-endpoints)
  - [Fresh Sessions](#fresh-sessions) — `/process_audio_session`, `/process_url_session`
  - [Follow-up Endpoints](#follow-up-endpoints) — `/resegment`, `/retranscribe`, `/realign_from_timestamps`, `/split_segments`
- [Word Timestamps](#word-timestamps) — `/timestamps`, `/timestamps_direct`
- [Utilities](#utilities) — `/estimate_duration`
- [Response Reference](#response-reference) — segment fields, special types, word arrays, errors

## API Changelog

**23/04/2026**
- New `/split_segments` endpoint: subdivides existing aligned segments that exceed `max_verses`, `max_words`, or `max_duration` limits. Adds optional `split_group_id` field to segment objects, stamping siblings that came from the same parent.

**13/04/2026**
- **Breaking:** GPU quota is no longer auto-routed to CPU. Requests now return a structured error and the caller decides whether to retry with `device="CPU"`. New `error_code` values: `gpu_quota_exhausted` (logged user), `gpu_quota_anonymous` (unlogged/IP-limited). The old `"warning"` field on successful responses is no longer emitted.

**04/04/2026**
- New fields on segment objects: `has_repeated_words`, `repeated_ranges`, `repeated_text` — surfaces repetition detection data when a reciter re-reads a portion of text

**30/03/2026**
- New `/process_url_session` endpoint: pass a URL (YouTube, SoundCloud, MP3Quran, etc.) instead of uploading audio

**29/03/2026**
- API calls now skip HTML rendering and audio file I/O, returning JSON faster


---

## GPU Usage & Access

- **Free Tier:** Every user receives **free daily GPU quota**. Once your daily quota is exhausted, GPU requests return an error — call the same endpoint again with `device="CPU"` to continue.
- **Unlimited GPU Access:** If you need unlimited GPU access (e.g., high-volume or production use), please get in touch to arrange a payment plan and higher limits.
- **CPU:** Always available and unlimited, but slower. You choose when to use it — there is no silent fallback.

## Quick Start

```python
from gradio_client import Client

client = Client("https://hetchyy-quranic-universal-aligner.hf.space")

# Or pass your HF token to use your own account's ZeroGPU quota
client = Client("https://hetchyy-quranic-universal-aligner.hf.space", token="hf_...")

# Full pipeline
result = client.predict(
    "recitation.mp3",   # audio file path
    200,                # min_silence_ms
    1000,               # min_speech_ms
    100,                # pad_ms
    "Base",             # model_name
    "GPU",              # device
    api_name="/process_audio_session"
)
audio_id = result["audio_id"]

# Re-segment with different params (reuses cached audio)
result = client.predict(audio_id, 600, 1500, 300, "Base", "GPU", api_name="/resegment")

# Re-transcribe with a different model (reuses cached segments)
result = client.predict(audio_id, "Large", "GPU", api_name="/retranscribe")

# Realign with custom timestamps
result = client.predict(
    audio_id,
    [{"start": 0.5, "end": 3.2}, {"start": 3.8, "end": 7.1}],
    "Base", "GPU",
    api_name="/realign_from_timestamps"
)

# Subdivide long segments at word boundaries
result = client.predict(audio_id, 1, 15, None, False, api_name="/split_segments")

# Get word-level timestamps (uses stored session segments)
ts = client.predict(audio_id, None, "words", api_name="/timestamps")

# Get timestamps without a session (standalone)
ts = client.predict("recitation.mp3", result["segments"], "words", api_name="/timestamps_direct")

# From URL (YouTube, SoundCloud, MP3Quran, etc.)
result = client.predict(
    "https://server8.mp3quran.net/afs/112.mp3",
    200, 1000, 100, "Base", "GPU",
    api_name="/process_url_session"
)
print(result["url_metadata"]["title"])  # Source metadata
# All follow-up calls work the same as with /process_audio_session
```

---

## Sessions

The first call returns an `audio_id` (32-character hex string). Pass it to subsequent calls to skip re-uploading and reprocessing audio. Sessions expire after **5 hours**.

**What the server caches per session:**

| Data | Updated by |
|---|---|
| Preprocessed audio | — |
| Detected speech intervals | — |
| Cleaned segment boundaries | `/resegment`, `/realign_from_timestamps`, `/split_segments` |
| Model name | `/retranscribe` |
| Alignment segments | Any alignment call |

If `audio_id` is missing, expired, or invalid:
```json
{"error": "Session not found or expired", "segments": []}
```

---

## Alignment Endpoints

### Fresh Sessions

### `POST /process_audio_session`

Processes a recitation audio file: detects speech segments, recognizes text, and aligns with the Quran. Creates a session for follow-up calls.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio` | file | required | Audio file (any common format) |
| `min_silence_ms` | int | 200 | Minimum silence gap to split segments |
| `min_speech_ms` | int | 1000 | Minimum speech duration to keep a segment |
| `pad_ms` | int | 100 | Padding added to each side of a segment |
| `model_name` | str | `"Base"` | `"Base"` (faster) or `"Large"` (more accurate). **Only these two values are accepted** — any other value will cause an error |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

If GPU quota is exhausted, the response is an error with `error_code` `gpu_quota_exhausted` or `gpu_quota_anonymous`. Re-issue the same request with `device="CPU"` to continue. See [Errors](#errors) for the full shape.

**Segmentation presets:**

| Style | min_silence_ms | min_speech_ms | pad_ms |
|---|---|---|---|
| Mujawwad (slow) | 600 | 1500 | 300 |
| Murattal (normal) | 200 | 1000 | 100 |
| Fast | 75 | 750 | 40 |

**Response:**
```json
{
  "audio_id": "a1b2c3d4e5f67890a1b2c3d4e5f67890",
  "segments": [
    {
      "segment": 1,
      "time_from": 0.480,
      "time_to": 2.880,
      "ref_from": "112:1:1",
      "ref_to": "112:1:4",
      "matched_text": "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
      "confidence": 0.921,
      "has_missing_words": false,
      "error": null
    },
    {
      "segment": 2,
      "time_from": 4.320,
      "time_to": 6.540,
      "ref_from": "",
      "ref_to": "",
      "matched_text": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم",
      "confidence": 0.952,
      "has_missing_words": false,
      "special_type": "Basmala",
      "error": null
    }
  ]
}
```

See [Segment Object](#segment-object) for field descriptions. See [Special Segment Types](#special-segment-types) for non-Quranic segments.

---

### `POST /process_url_session`

Downloads audio from a URL, then runs the same pipeline as `/process_audio_session`. Supports YouTube, SoundCloud, MP3Quran, TikTok, and [500+ sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) via yt-dlp.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | str | required | URL to download audio from |
| `min_silence_ms` | int | 200 | Minimum silence gap to split segments |
| `min_speech_ms` | int | 1000 | Minimum speech duration to keep a segment |
| `pad_ms` | int | 100 | Padding added to each side of a segment |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` only |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Response:** Same as `/process_audio_session`, plus a `url_metadata` field:
```json
{
  "audio_id": "a1b2c3d4e5f67890a1b2c3d4e5f67890",
  "url_metadata": {
    "title": "Surah Al-Ikhlas - Sheikh Mishary",
    "duration": 45.0,
    "source_url": "https://..."
  },
  "segments": [...]
}
```

**Notes:**
- Playlists are rejected — pass a single video/audio URL.
- Some sites (YouTube, Facebook, Instagram) may not work from the server due to IP restrictions. If a download fails, download the audio locally and use `/process_audio_session` instead.
- After the session is created, all follow-up endpoints (`/resegment`, `/retranscribe`, etc.) work identically.

---

### Follow-up Endpoints

### `POST /resegment`

Re-splits the audio into segments using different silence/speech settings, then re-aligns. Reuses the uploaded audio.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `min_silence_ms` | int | 200 | New minimum silence gap |
| `min_speech_ms` | int | 1000 | New minimum speech duration |
| `pad_ms` | int | 100 | New padding |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` only |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Response:** Same shape as `/process_audio_session`. Session boundaries are updated.

---

### `POST /retranscribe`

Re-recognizes text using a different model on the same segments, then re-aligns.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` only |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Response:** Same shape as `/process_audio_session`. Session model and results are updated.

> **Note:** Returns an error if `model_name` is the same as the current session's model. To re-run with the same model on different boundaries, use `/resegment` or `/realign_from_timestamps` instead (they already include recognition + alignment).

---

### `POST /realign_from_timestamps`

Aligns audio using custom time boundaries you provide. Useful for manually adjusting where segments start and end.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `timestamps` | list | required | Array of `{"start": float, "end": float}` in seconds |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` only |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Example request body:**
```json
{
  "audio_id": "a1b2c3d4e5f67890a1b2c3d4e5f67890",
  "timestamps": [
    {"start": 0.5, "end": 3.2},
    {"start": 3.8, "end": 5.1},
    {"start": 5.1, "end": 7.4}
  ],
  "model_name": "Base",
  "device": "GPU"
}
```

**Response:** Same shape as `/process_audio_session`. Session boundaries are replaced with the provided timestamps.

---

### `POST /split_segments`

Subdivides existing aligned segments that exceed one or more of three limits, using word-level timestamps to find precise word-boundary cuts.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `max_verses` | int | 1 | Max distinct verses a segment may span (1–4). Pass `5`, `0`, or `null` to disable |
| `max_words` | int | `null` | Max Quran words per segment (5–29, step 1). Pass `30`, `0`, or `null` to disable |
| `max_duration` | float | `null` | Max segment duration in seconds (5–29, step 1). Pass `30`, `0`, or `null` to disable |
| `require_stop_sign` | bool | `false` | When `true`, the word/duration pass only splits at a waqf mark — segments with no stop sign stay as-is even if they exceed the limit. Does not affect verse boundary cuts |

**How the criteria interact:** `max_verses` and `max_words`/`max_duration` are independent — enable any combination.

- **`max_verses` only** — cuts at verse boundaries, grouping up to `max_verses` verses per segment.
- **`max_words`/`max_duration` only** — for each violating segment, cuts at verse boundaries first, then waqf stop-signs (preferred_stop ۗ → optional_stop ۚ → preferred_continue ۖ, closest to middle), then equal-word fallback.
- **Both enabled** — `max_verses` pass runs first; the word/duration pass then handles remaining violations (and re-checks verse boundaries for multi-verse segments the first pass didn't cut).

**Response:** Same shape as `/process_audio_session`. New sub-segments share a `split_group_id` string so clients can visually group them. Session boundaries are replaced with the new split boundaries. If splitting fails for a segment, it is kept unsplit and `error` is set to `"split_failed"`.

---

## Word Timestamps

### `POST /timestamps`

Gets precise word-level (and optionally letter-level) timing for each word in the aligned segments.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous alignment call |
| `segments` | list? | `None` (JSON `null`) | Segment list to align. `None` uses stored segments from the session |
| `granularity` | str | `"words"` | Only `"words"` is supported. `"words+chars"` is currently disabled via API and returns an error |

**Example — using stored segments:**
```python
result = client.predict(
    "a1b2c3d4e5f67890a1b2c3d4e5f67890",  # audio_id
    None,                                # segments (null = use stored)
    "words",                             # granularity
    api_name="/timestamps",
)
```

**Example — with segments override (minimal):**
```python
result = client.predict(
    "a1b2c3d4e5f67890a1b2c3d4e5f67890",
    [   # segments override
        {"time_from": 0.48, "time_to": 2.88, "ref_from": "112:1:1", "ref_to": "112:1:4"},
        {"time_from": 3.12, "time_to": 5.44, "ref_from": "112:2:1", "ref_to": "112:2:3"},
    ],
    "words",
    api_name="/timestamps",
)
```

**Example — special segment (Basmala):**
```python
# Special segments use empty ref_from/ref_to and carry a special_type field
{"time_from": 0.0, "time_to": 2.1, "ref_from": "", "ref_to": "", "special_type": "Basmala"}
```

**Segment input fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `time_from` | float | yes | Start time in seconds |
| `time_to` | float | yes | End time in seconds |
| `ref_from` | str | yes | First word as `"surah:ayah:word"`. Empty for special segments |
| `ref_to` | str | yes | Last word as `"surah:ayah:word"`. Empty for special segments |
| `segment` | int | no | 1-indexed segment number. Auto-assigned from position if omitted |
| `confidence` | float | no | Defaults to 1.0. Segments with confidence ≤ 0 are skipped |
| `special_type` | str | no | Only for special segments (`"Basmala"`, `"Isti'adha"`, etc.) |

**Response:**
```json
{
  "audio_id": "a1b2c3d4e5f67890a1b2c3d4e5f67890",
  "segments": [
    {
      "segment": 1,
      "words": [
        ["112:1:1", 0.0, 0.32],
        ["112:1:2", 0.32, 0.58],
        ["112:1:3", 0.58, 1.12],
        ["112:1:4", 1.12, 1.68]
      ]
    }
  ]
}
```

See [Word Timestamp Arrays](#word-timestamp-arrays) for field details.

---

### `POST /timestamps_direct`

Same as `/timestamps` but accepts an audio file directly — no session needed.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio` | file | required | Audio file (any common format) |
| `segments` | list | required | Segment list with `time_from`/`time_to` boundaries |
| `granularity` | str | `"words"` | Only `"words"` is supported. `"words+chars"` is currently disabled via API and returns an error |

**Response:** Same shape as `/timestamps` but without `audio_id`.

**Example (minimal):**
```python
result = client.predict(
    "recitation.mp3",
    [
        {"time_from": 0.48, "time_to": 2.88, "ref_from": "112:1:1", "ref_to": "112:1:4"},
        {"time_from": 3.12, "time_to": 5.44, "ref_from": "112:2:1", "ref_to": "112:2:3"},
    ],
    "words",
    api_name="/timestamps_direct",
)
```

Segment input format is the same as for `/timestamps` — see above.

---

## Utilities

### `POST /estimate_duration`

Estimate processing time before starting a request.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `endpoint` | str | required | Target endpoint name (e.g. `"process_audio_session"`) |
| `audio_duration_s` | float | `None` | Audio length in seconds. Required if no `audio_id` |
| `audio_id` | str | `None` | Session ID — looks up audio duration from the session |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` only |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Example — before first processing call:**
```python
est = client.predict(
    "process_audio_session",  # endpoint
    60.0,                     # audio_duration_s (seconds)
    None,                     # audio_id (not yet available)
    "Base",                   # model_name
    "GPU",                    # device
    api_name="/estimate_duration",
)
print(f"Estimated time: {est['estimated_duration_s']}s")
```

**Example — with existing session (e.g. before getting timestamps):**
```python
est = client.predict(
    "timestamps",              # endpoint
    None,                      # audio_duration_s (looked up from session)
    audio_id,                  # audio_id
    "Base",                    # model_name
    "GPU",                     # device
    api_name="/estimate_duration",
)
```

**Response:**
```json
{
  "endpoint": "process_audio_session",
  "estimated_duration_s": 28.0,
  "device": "GPU",
  "model_name": "Base"
}
```

---

## Response Reference

### Segment Object

Returned by all alignment endpoints (`/process_audio_session`, `/resegment`, `/retranscribe`, `/realign_from_timestamps`).

| Field | Type | Description |
|---|---|---|
| `segment` | int | 1-indexed segment number |
| `time_from` | float | Start time in seconds |
| `time_to` | float | End time in seconds |
| `ref_from` | str | First matched word as `"surah:ayah:word"`. Empty string for special segments |
| `ref_to` | str | Last matched word as `"surah:ayah:word"`. Empty string for special segments |
| `matched_text` | str | Quran text for the matched range (or special segment text) |
| `confidence` | float | 0.0–1.0 — how well the segment matched the Quran text |
| `has_missing_words` | bool | Whether some expected words were not found in the audio |
| `has_repeated_words` | bool | Whether the reciter repeated words within this segment |
| `repeated_ranges` | array | Only present when `has_repeated_words` is true. Array of `[ref_from, ref_to]` pairs showing the full reading sequence in recitation order |
| `repeated_text` | array | Only present when `has_repeated_words` is true. Array of text strings parallel to `repeated_ranges`, each containing the Arabic text for that reading pass |
| `special_type` | str | Only present for special (non-Quranic) segments — see below. Absent for normal segments |
| `split_group_id` | str? | Only present on sub-segments produced by `/split_segments`. Same value across siblings from the same pre-split parent |
| `error` | str? | Error message if alignment failed, else `null` |

### Special Segment Types

Non-Quranic segments detected within recitations. When `special_type` is present, `ref_from` and `ref_to` are empty strings.

| `special_type` | Arabic Text |
|----------------|-------------|
| `Basmala` | بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم |
| `Isti'adha` | أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم |
| `Amin` | آمِين |
| `Takbir` | اللَّهُ أَكْبَر |
| `Tahmeed` | سَمِعَ اللَّهُ لِمَنْ حَمِدَه |
| `Tasleem` | ٱلسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ ٱللَّه |
| `Sadaqa` | صَدَقَ ٱللَّهُ ٱلْعَظِيم |

### Word Timestamp Arrays

Returned by `/timestamps` and `/timestamps_direct`. Each word is an array: `[location, start, end]` or `[location, start, end, letters]`.

| Index | Type | Description |
|---|---|---|
| 0 | str | Word position as `"surah:ayah:word"` |
| 1 | float | Start time relative to segment (seconds) |
| 2 | float | End time relative to segment (seconds) |

> **Note:** `"words+chars"` granularity (letter-level timestamps) is currently disabled via API. Only word-level timestamps are returned.

### Errors

All errors share the same base shape: `{"error": "...", "segments": []}`. Endpoints with an active session also include `audio_id`.

For capacity/quota errors, the response adds a stable `error_code` (and `reset_time` for GPU quota) so clients can react programmatically:

```json
{
  "error": "GPU quota exhausted for your account. Resets in 0:14:23. Upgrade at https://huggingface.co/subscribe/pro for more quota, or retry with device=CPU.",
  "error_code": "gpu_quota_exhausted",
  "reset_time": "0:14:23",
  "segments": []
}
```

`reset_time` is a `"H:MM:SS"` string when ZeroGPU provides one, else `null`.

| `error_code` | When | Suggested client action |
|---|---|---|
| `gpu_quota_exhausted` | Your logged account is out of daily GPU quota | Retry with `device="CPU"`, or upgrade to Pro |
| `gpu_quota_anonymous` | Anonymous/IP-based GPU quota is out | Sign in for more quota, or retry with `device="CPU"` |

Other error conditions (no `error_code`):

| Condition | Error message | `audio_id` present? |
|---|---|---|
| Session not found or expired | `"Session not found or expired"` | No |
| No speech detected (process) | `"No speech detected in audio"` | No (no session created) |
| No segments after resegment | `"No segments with these settings"` | Yes |
| Invalid model name | `"Invalid model_name '...'. Must be one of: Base, Large"` | Depends on endpoint |
| Retranscribe with same model | `"Model and boundaries unchanged. Change model_name or call /resegment first."` | Yes |
| Retranscription failed | `"Retranscription failed"` | Yes |
| Realignment failed | `"Alignment failed"` | Yes |
| No segments in session (timestamps) | `"No segments found in session"` | Yes |
| Timestamp alignment failed | `"Alignment failed: ..."` | Yes (session) / No (direct) |
| No segments provided (timestamps direct) | `"No segments provided"` | No |
| URL is empty (process_url) | `"URL is required"` | No |
| URL download failed (process_url) | `"Download failed: ..."` | No |
