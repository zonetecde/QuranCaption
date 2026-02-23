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
from src.core.zero_gpu import QuotaExhaustedError

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


def _save_segments(audio_id, segments):
    """Persist alignment segments for later MFA use."""
    path = _session_dir(audio_id)
    if not path.exists():
        return
    seg_path = path / "segments.json"
    tmp = path / "segments.tmp"
    with open(tmp, "w") as f:
        json.dump(segments, f)
    os.replace(tmp, seg_path)


def _load_segments(audio_id):
    """Load stored segments. Returns list or None."""
    if not _validate_id(audio_id):
        return None
    path = _session_dir(audio_id)
    seg_path = path / "segments.json"
    if not seg_path.exists():
        return None
    with open(seg_path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Response formatting
# ---------------------------------------------------------------------------

_SESSION_ERROR = {"error": "Session not found or expired", "segments": []}


def _format_response(audio_id, json_output, warning=None):
    """Convert pipeline json_output to the documented API response schema."""
    segments = []
    for seg in json_output.get("segments", []):
        entry = {
            "segment": seg["segment"],
            "time_from": seg["time_from"],
            "time_to": seg["time_to"],
            "ref_from": seg["ref_from"],
            "ref_to": seg["ref_to"],
            "matched_text": seg["matched_text"],
            "confidence": seg["confidence"],
            "has_missing_words": seg.get("has_missing_words", False),
            "error": seg["error"],
        }
        if seg.get("special_type"):
            entry["special_type"] = seg["special_type"]
        segments.append(entry)
    _save_segments(audio_id, segments)
    resp = {"audio_id": audio_id, "segments": segments}
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

    quota_warning = None
    try:
        result = process_audio(
            audio_data, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, device, request=request,
        )
    except QuotaExhaustedError as e:
        reset_msg = f" Resets in {e.reset_time}." if e.reset_time else ""
        quota_warning = f"GPU quota reached — processed on CPU (slower).{reset_msg}"
        result = process_audio(
            audio_data, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, "CPU", request=request,
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
    return _format_response(audio_id, json_output, warning=quota_warning)


def resegment_session(audio_id, min_silence_ms, min_speech_ms, pad_ms,
                       model_name="Base", device="GPU",
                       request: gr.Request = None):
    """Re-clean VAD boundaries with new params and re-run ASR + alignment."""
    session = load_session(audio_id)
    if session is None:
        return _SESSION_ERROR

    from src.pipeline import resegment_audio

    quota_warning = None
    try:
        result = resegment_audio(
            session["speech_intervals"], session["is_complete"],
            session["audio"], 16000,
            int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, device, request=request,
        )
    except QuotaExhaustedError as e:
        reset_msg = f" Resets in {e.reset_time}." if e.reset_time else ""
        quota_warning = f"GPU quota reached — processed on CPU (slower).{reset_msg}"
        result = resegment_audio(
            session["speech_intervals"], session["is_complete"],
            session["audio"], 16000,
            int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, "CPU", request=request,
        )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "No segments with these settings", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output, warning=quota_warning)


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

    quota_warning = None
    try:
        result = retranscribe_audio(
            session["intervals"],
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, device, request=request,
        )
    except QuotaExhaustedError as e:
        reset_msg = f" Resets in {e.reset_time}." if e.reset_time else ""
        quota_warning = f"GPU quota reached — processed on CPU (slower).{reset_msg}"
        result = retranscribe_audio(
            session["intervals"],
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, "CPU", request=request,
        )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "Retranscription failed", "segments": []}

    update_session(audio_id, model_name=model_name)
    return _format_response(audio_id, json_output, warning=quota_warning)


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

    quota_warning = None
    try:
        result = realign_audio(
            intervals,
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, device, request=request,
        )
    except QuotaExhaustedError as e:
        reset_msg = f" Resets in {e.reset_time}." if e.reset_time else ""
        quota_warning = f"GPU quota reached — processed on CPU (slower).{reset_msg}"
        result = realign_audio(
            intervals,
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, "CPU", request=request,
        )
    json_output = result[1]
    if json_output is None:
        return {"audio_id": audio_id, "error": "Alignment failed", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output, warning=quota_warning)


# ---------------------------------------------------------------------------
# MFA timestamp helpers
# ---------------------------------------------------------------------------

def _preprocess_api_audio(audio_data):
    """Convert audio input to 16kHz mono float32 numpy array.

    Handles file path (str) and Gradio numpy tuple (sample_rate, array).
    Returns (audio_np, sample_rate).
    """
    import librosa
    from config import RESAMPLE_TYPE

    if isinstance(audio_data, str):
        audio, sr = librosa.load(audio_data, sr=16000, mono=True, res_type=RESAMPLE_TYPE)
        return audio, 16000

    sample_rate, audio = audio_data
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / 2147483648.0
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)
    if sample_rate != 16000:
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000, res_type=RESAMPLE_TYPE)
        sample_rate = 16000
    return audio, sample_rate


def _create_segment_wavs(audio_np, sample_rate, segments):
    """Slice audio by segment boundaries and write WAV files.

    Returns the temp directory path containing seg_0.wav, seg_1.wav, etc.
    """
    import tempfile
    import soundfile as sf

    seg_dir = tempfile.mkdtemp(prefix="mfa_api_")
    for seg in segments:
        seg_idx = seg.get("segment", 0) - 1
        time_from = seg.get("time_from", 0)
        time_to = seg.get("time_to", 0)
        start_sample = int(time_from * sample_rate)
        end_sample = int(time_to * sample_rate)
        segment_audio = audio_np[start_sample:end_sample]
        wav_path = os.path.join(seg_dir, f"seg_{seg_idx}.wav")
        sf.write(wav_path, segment_audio, sample_rate)
    return seg_dir


# ---------------------------------------------------------------------------
# MFA timestamp helpers
# ---------------------------------------------------------------------------

_SPECIAL_TEXT = {
    "Basmala": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم",
    "Isti'adha": "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم",
    "Amin": "آمِين",
    "Takbir": "اللَّهُ أَكْبَر",
    "Tahmeed": "سَمِعَ اللَّهُ لِمَنْ حَمِدَه",
    "Tasleem": "ٱلسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ ٱللَّه",
    "Sadaqa": "صَدَقَ ٱللَّهُ ٱلْعَظِيم",
}


def _normalize_segments(segments):
    """Fill defaults so callers can pass minimal segment dicts (timestamps + refs).

    Auto-assigns ``segment`` numbers, defaults ``confidence`` to 1.0, and
    derives ``matched_text`` from ``special_type`` for special segments.
    """
    normalized = []
    for i, seg in enumerate(segments):
        entry = dict(seg)
        if "segment" not in entry:
            entry["segment"] = i + 1
        if "confidence" not in entry:
            entry["confidence"] = 1.0
        if "matched_text" not in entry:
            special = entry.get("special_type", "")
            entry["matched_text"] = _SPECIAL_TEXT.get(special, "")
        normalized.append(entry)
    return normalized


# ---------------------------------------------------------------------------
# MFA timestamp endpoints
# ---------------------------------------------------------------------------

def mfa_timestamps_session(audio_id, segments_json=None, granularity="words"):
    """Compute MFA word/letter timestamps using session audio."""
    session = load_session(audio_id)
    if session is None:
        return _SESSION_ERROR

    # Parse segments: use provided or load stored
    if isinstance(segments_json, str):
        segments_json = json.loads(segments_json)

    if segments_json:
        segments = _normalize_segments(segments_json)
    else:
        segments = _load_segments(audio_id)
        if not segments:
            return {"audio_id": audio_id, "error": "No segments found in session", "segments": []}

    # Create segment WAVs from session audio
    try:
        seg_dir = _create_segment_wavs(session["audio"], 16000, segments)
    except Exception as e:
        return {"audio_id": audio_id, "error": f"Failed to create segment audio: {e}", "segments": []}

    from src.mfa import compute_mfa_timestamps_api
    try:
        result = compute_mfa_timestamps_api(segments, seg_dir, granularity or "words")
    except Exception as e:
        return {"audio_id": audio_id, "error": f"MFA alignment failed: {e}", "segments": []}

    result["audio_id"] = audio_id
    return result


def mfa_timestamps_direct(audio_data, segments_json, granularity="words"):
    """Compute MFA word/letter timestamps with provided audio and segments."""
    # Parse segments
    if isinstance(segments_json, str):
        segments_json = json.loads(segments_json)

    if not segments_json:
        return {"error": "No segments provided", "segments": []}

    segments = _normalize_segments(segments_json)

    # Preprocess audio
    try:
        audio_np, sr = _preprocess_api_audio(audio_data)
    except Exception as e:
        return {"error": f"Failed to preprocess audio: {e}", "segments": []}

    # Create segment WAVs
    try:
        seg_dir = _create_segment_wavs(audio_np, sr, segments)
    except Exception as e:
        return {"error": f"Failed to create segment audio: {e}", "segments": []}

    from src.mfa import compute_mfa_timestamps_api
    try:
        result = compute_mfa_timestamps_api(segments, seg_dir, granularity or "words")
    except Exception as e:
        return {"error": f"MFA alignment failed: {e}", "segments": []}

    return result
