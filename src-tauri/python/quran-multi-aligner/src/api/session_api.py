"""Session-based API: persistence layer + endpoint wrappers.

Sessions store preprocessed audio and VAD data in /tmp so that
follow-up calls (resegment, retranscribe, realign) skip expensive
re-uploads and re-inference.
"""

import hashlib
import json
import os
import pickle
import re
import shutil
import time
import uuid

import gradio as gr
import numpy as np

from config import SESSION_DIR, SESSION_EXPIRY_SECONDS
from src.core.zero_gpu import is_quota_exhausted, get_quota_reset_time

# ---------------------------------------------------------------------------
# Session manager
# ---------------------------------------------------------------------------

_last_cleanup_time = 0.0
_CLEANUP_INTERVAL = 1800  # sweep at most every 30 min

_VALID_ID = re.compile(r"^[0-9a-f]{32}$")


def _session_dir(audio_id: str):
    return SESSION_DIR / audio_id


def _validate_id(audio_id: str) -> bool:
    return isinstance(audio_id, str) and bool(_VALID_ID.match(audio_id))


def _is_expired(created_at: float) -> bool:
    return (time.time() - created_at) > SESSION_EXPIRY_SECONDS


def _sweep_expired():
    """Delete expired session directories (runs at most every 30 min)."""
    global _last_cleanup_time
    now = time.time()
    if now - _last_cleanup_time < _CLEANUP_INTERVAL:
        return
    _last_cleanup_time = now
    if not SESSION_DIR.exists():
        return
    for entry in SESSION_DIR.iterdir():
        if not entry.is_dir():
            continue
        ts_file = entry / "created_at"
        if not ts_file.exists() or _is_expired(float(ts_file.read_text())):
            shutil.rmtree(entry, ignore_errors=True)


def _intervals_hash(intervals) -> str:
    return hashlib.md5(json.dumps(intervals).encode()).hexdigest()


def create_session(audio, speech_intervals, is_complete, intervals, model_name):
    """Persist session data and return audio_id (32-char hex UUID).

    Uses pickle for VAD artifacts (speech_intervals, is_complete) to
    preserve exact types (torch.Tensor etc.) expected by the segmenter.
    Uses np.save for the audio array (large, always float32 numpy).
    """
    _sweep_expired()
    audio_id = uuid.uuid4().hex
    path = _session_dir(audio_id)
    path.mkdir(parents=True, exist_ok=True)

    # Audio is always a float32 numpy array after preprocessing
    np.save(path / "audio.npy", audio)

    # VAD artifacts: preserve original types via pickle
    with open(path / "vad.pkl", "wb") as f:
        pickle.dump({"speech_intervals": speech_intervals,
                      "is_complete": is_complete}, f)

    # Lightweight metadata (JSON-safe types only)
    meta = {
        "intervals": intervals,
        "model_name": model_name,
        "intervals_hash": _intervals_hash(intervals),
    }
    with open(path / "metadata.json", "w") as f:
        json.dump(meta, f)

    # Timestamp file for cheap expiry checks during sweep
    (path / "created_at").write_text(str(time.time()))

    return audio_id


def load_session(audio_id):
    """Load session data. Returns dict or None if missing/expired/invalid."""
    if not _validate_id(audio_id):
        return None
    path = _session_dir(audio_id)
    if not path.exists():
        return None

    ts_file = path / "created_at"
    if not ts_file.exists() or _is_expired(float(ts_file.read_text())):
        shutil.rmtree(path, ignore_errors=True)
        return None

    audio = np.load(path / "audio.npy")

    with open(path / "vad.pkl", "rb") as f:
        vad = pickle.load(f)

    with open(path / "metadata.json") as f:
        meta = json.load(f)

    return {
        "audio": audio,
        "speech_intervals": vad["speech_intervals"],
        "is_complete": vad["is_complete"],
        "intervals": meta["intervals"],
        "model_name": meta["model_name"],
        "intervals_hash": meta.get("intervals_hash", ""),
        "audio_id": audio_id,
    }


def update_session(audio_id, *, intervals=None, model_name=None):
    """Update mutable session fields (intervals, model_name)."""
    path = _session_dir(audio_id)
    meta_path = path / "metadata.json"
    if not meta_path.exists():
        return
    with open(meta_path) as f:
        meta = json.load(f)
    if intervals is not None:
        meta["intervals"] = intervals
        meta["intervals_hash"] = _intervals_hash(intervals)
    if model_name is not None:
        meta["model_name"] = model_name
    tmp = path / "metadata.tmp"
    with open(tmp, "w") as f:
        json.dump(meta, f)
    os.replace(tmp, meta_path)


# ---------------------------------------------------------------------------
# Response formatting
# ---------------------------------------------------------------------------

_SESSION_ERROR = {"error": "Session not found or expired", "segments": []}


def _gpu_fallback_warning() -> str | None:
    """Return a warning string if GPU quota was exhausted, else None."""
    if not is_quota_exhausted():
        return None
    reset_time = get_quota_reset_time()
    msg = "GPU quota reached — processed on CPU (slower)."
    if reset_time:
        msg += f" Resets in {reset_time}."
    return msg


def _format_response(audio_id, json_output):
    """Convert pipeline json_output to the documented API response schema."""
    segments = []
    for seg in json_output.get("segments", []):
        segments.append({
            "segment": seg["segment"],
            "time_from": seg["time_from"],
            "time_to": seg["time_to"],
            "ref_from": seg["ref_from"],
            "ref_to": seg["ref_to"],
            "matched_text": seg["matched_text"],
            "confidence": seg["confidence"],
            "has_missing_words": seg.get("has_missing_words", False),
            "error": seg["error"],
        })
    resp = {"audio_id": audio_id, "segments": segments}
    warning = _gpu_fallback_warning()
    if warning:
        resp["warning"] = warning
    return resp


# ---------------------------------------------------------------------------
# Endpoint wrappers
# ---------------------------------------------------------------------------

def process_audio_session(audio_data, min_silence_ms, min_speech_ms, pad_ms,
                          model_name="Base", device="GPU",
                          request: gr.Request = None):
    """Full pipeline: preprocess -> VAD -> ASR -> alignment. Creates session."""
    from src.pipeline import process_audio

    result = process_audio(
        audio_data, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
        model_name, device, request=request,
    )
    # result is a 9-tuple:
    # (html, json_output, speech_intervals, is_complete, audio, sr, intervals, seg_dir, log_row)
    json_output = result[1]
    if json_output is None:
        return {"error": "No speech detected in audio", "segments": []}

    speech_intervals = result[2]
    is_complete = result[3]
    audio = result[4]
    intervals = result[6]

    audio_id = create_session(
        audio, speech_intervals, is_complete, intervals, model_name,
    )
    return _format_response(audio_id, json_output)


def resegment_session(audio_id, min_silence_ms, min_speech_ms, pad_ms,
                       model_name="Base", device="GPU",
                       request: gr.Request = None):
    """Re-clean VAD boundaries with new params and re-run ASR + alignment."""
    session = load_session(audio_id)
    if session is None:
        return _SESSION_ERROR

    from src.pipeline import resegment_audio

    result = resegment_audio(
        session["speech_intervals"], session["is_complete"],
        session["audio"], 16000,
        int(min_silence_ms), int(min_speech_ms), int(pad_ms),
        model_name, device, request=request,
    )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "No segments with these settings", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output)


def retranscribe_session(audio_id, model_name="Base", device="GPU",
                          request: gr.Request = None):
    """Re-run ASR with a different model on current segment boundaries."""
    session = load_session(audio_id)
    if session is None:
        return _SESSION_ERROR

    # Guard: reject if model and boundaries unchanged
    if (model_name == session["model_name"]
            and _intervals_hash(session["intervals"]) == session["intervals_hash"]):
        return {
            "audio_id": audio_id,
            "error": "Model and boundaries unchanged. Change model_name or call /resegment_session first.",
            "segments": [],
        }

    from src.pipeline import retranscribe_audio

    result = retranscribe_audio(
        session["intervals"],
        session["audio"], 16000,
        session["speech_intervals"], session["is_complete"],
        model_name, device, request=request,
    )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "Retranscription failed", "segments": []}

    update_session(audio_id, model_name=model_name)
    return _format_response(audio_id, json_output)


def realign_from_timestamps(audio_id, timestamps, model_name="Base", device="GPU",
                             request: gr.Request = None):
    """Run ASR + alignment on caller-provided timestamp intervals."""
    session = load_session(audio_id)
    if session is None:
        return _SESSION_ERROR

    # Parse timestamps: accept list of {"start": f, "end": f} dicts
    if isinstance(timestamps, str):
        timestamps = json.loads(timestamps)

    intervals = [(ts["start"], ts["end"]) for ts in timestamps]

    from src.pipeline import realign_audio

    result = realign_audio(
        intervals,
        session["audio"], 16000,
        session["speech_intervals"], session["is_complete"],
        model_name, device, request=request,
    )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "Alignment failed", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output)
