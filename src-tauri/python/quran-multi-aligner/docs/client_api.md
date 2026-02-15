# Client API Reference

## Quick Start

```python
from gradio_client import Client

client = Client("https://your-space.hf.space")

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

# Re-segment with different params (reuses cached audio + VAD)
result = client.predict(audio_id, 600, 1500, 300, "Base", "GPU", api_name="/resegment_session")

# Re-transcribe with a different model (reuses cached segments)
result = client.predict(audio_id, "Large", "GPU", api_name="/retranscribe_session")

# Realign with custom timestamps
result = client.predict(
    audio_id,
    [{"start": 0.5, "end": 3.2}, {"start": 3.8, "end": 7.1}],
    "Base", "GPU",
    api_name="/realign_from_timestamps"
)
```

---

## Sessions

The first call returns an `audio_id` (32-character hex string). Pass it to subsequent calls to skip re-uploading and reprocessing audio. Sessions expire after **5 hours**.

**What the server caches per session:**

| Data | Storage | Mutates on follow-up calls? |
|---|---|---|
| Preprocessed audio (16kHz float32) | Disk | No |
| Raw VAD speech intervals | Memory | No |
| Cleaned segment boundaries | Memory | Yes (resegment / realign) |
| Model name | Memory | Yes (retranscribe) |
| Latest alignment results | Memory | Yes (all follow-up calls) |

If `audio_id` is missing, expired, or invalid:
```json
{"error": "Session not found or expired", "segments": []}
```

---

## Endpoints

### `POST /process_audio_session`

Full pipeline: preprocess → VAD → ASR → alignment. Creates a server-side session.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio` | file | required | Audio file (any format, converted to 16kHz mono) |
| `min_silence_ms` | int | 200 | Minimum silence gap to split segments |
| `min_speech_ms` | int | 1000 | Minimum speech duration to keep a segment |
| `pad_ms` | int | 100 | Padding added to each side of a segment |
| `model_name` | str | `"Base"` | `"Base"` (95M, faster) or `"Large"` (1B, more accurate, slower) |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

If GPU quota is exhausted, automatically falls back to CPU processing rather than throwing an error. When this happens, a `"warning"` field is included in the response (see [GPU Fallback Warning](#gpu-fallback-warning) below).

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
      "ref_from": "112:2:1",
      "ref_to": "112:2:2",
      "matched_text": "ٱللَّهُ ٱلصَّمَدُ",
      "confidence": 0.883,
      "has_missing_words": false,
      "error": null
    }
  ]
}
```

**Segment fields:**

| Field | Type | Description |
|---|---|---|
| `segment` | int | 1-indexed segment number |
| `time_from` | float | Start time in seconds |
| `time_to` | float | End time in seconds |
| `ref_from` | str | First matched word as `"surah:ayah:word"` |
| `ref_to` | str | Last matched word as `"surah:ayah:word"` |
| `matched_text` | str | Quran text for the matched range |
| `confidence` | float | 0.0–1.0 (3 decimal places) |
| `has_missing_words` | bool | True if the alignment detected skipped/missing words in the recitation |
| `error` | str? | Error message if alignment failed, else `null` |

---

## GPU Fallback Warning

When GPU quota is exhausted and the server falls back to CPU, all endpoints include a `"warning"` field in the response:

```json
{
  "audio_id": "...",
  "warning": "GPU quota reached — processed on CPU (slower). Resets in 13:53:59.",
  "segments": [...]
}
```

The `"warning"` key is **absent** (not `null`) when processing ran on GPU normally. Clients should check `if "warning" in result` rather than checking for `null`.

---

## Error Responses

All errors follow the same shape: `{"error": "...", "segments": []}`. Endpoints that have an active session also include `audio_id`.

| Condition | Error message | `audio_id` present? |
|---|---|---|
| Session not found or expired | `"Session not found or expired"` | No |
| No speech detected (process) | `"No speech detected in audio"` | No (no session created) |
| No segments after resegment | `"No segments with these settings"` | Yes |
| Retranscribe with same model | `"Model and boundaries unchanged. Change model_name or call /resegment_session first."` | Yes |
| Retranscription failed | `"Retranscription failed"` | Yes |
| Realignment failed | `"Alignment failed"` | Yes |

---

### `POST /resegment_session`

Re-cleans VAD boundaries with new segmentation parameters and re-runs ASR. Skips audio upload, preprocessing, and VAD inference.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `min_silence_ms` | int | 200 | New minimum silence gap |
| `min_speech_ms` | int | 1000 | New minimum speech duration |
| `pad_ms` | int | 100 | New padding |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Response:** Same shape as `/process_audio_session`. Session boundaries are updated.

---

### `POST /retranscribe_session`

Re-runs ASR with a different model on the current segment boundaries. Skips audio upload, preprocessing, VAD, and segmentation.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` |
| `device` | str | `"GPU"` | `"GPU"` or `"CPU"` |

**Response:** Same shape as `/process_audio_session`. Session model and results are updated.

> **Note:** Returns an error if `model_name` is the same as the current session's model. To re-run with the same model on different boundaries, use `/resegment_session` or `/realign_from_timestamps` instead (they already include ASR + alignment).

---

### `POST /realign_from_timestamps`

Accepts arbitrary `(start, end)` timestamp pairs and runs ASR + alignment on each slice. The client defines segment boundaries directly — use this for manual splitting, merging, or dragging boundaries in a timeline editor.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `audio_id` | str | required | Session ID from a previous call |
| `timestamps` | list | required | Array of `{"start": float, "end": float}` in seconds |
| `model_name` | str | `"Base"` | `"Base"` or `"Large"` |
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

This endpoint subsumes split, merge, and boundary adjustment — the client computes the desired timestamps locally and sends them in one call.
