"""Session-based API: persistence layer + endpoint wrappers.

Sessions store preprocessed audio and VAD data in /tmp so that
follow-up calls (resegment, retranscribe, realign) skip expensive
re-uploads and re-inference.
"""

import hashlib
import json
import math
import os
import pickle
import re
import shutil
import time
import uuid

import gradio as gr
import numpy as np

from config import SESSION_DIR, SESSION_EXPIRY_SECONDS, PHONEME_ASR_MODELS
from src.core.zero_gpu import QuotaExhaustedError
from src.core.worker_pool import PoolExhaustedError, PoolQueueFullError
from src.core.usage_logger import (
    log_error,
    mark_endpoint_entry,
    set_stage,
    get_user_id,
)

# ---------------------------------------------------------------------------
# Session manager
# ---------------------------------------------------------------------------

_last_cleanup_time = 0.0
_CLEANUP_INTERVAL = 1800  # sweep at most every 30 min

_VALID_ID = re.compile(r"^[0-9a-f]{32}$")
_VALID_MODELS = set(PHONEME_ASR_MODELS.keys())


def _validate_model_name(model_name, *, endpoint=None, audio_id=None, device=None,
                         request=None):
    """Return an error dict if model_name is invalid, else None.

    When `endpoint` is provided, also append a row to the errors dataset.
    """
    if model_name not in _VALID_MODELS:
        valid = ", ".join(sorted(_VALID_MODELS))
        msg = f"Invalid model_name '{model_name}'. Must be one of: {valid}"
        if endpoint:
            log_error(
                error_code="invalid_model",
                endpoint=endpoint,
                stage="validate",
                audio_id=audio_id,
                device=device,
                user_id=get_user_id(request) if request else "unknown",
                message=msg,
                context={"model_name": model_name},
            )
        return {"error": msg, "segments": []}


def _log_session_expired(*, endpoint: str, audio_id, request=None):
    """Log a session-expired hit. Caller still returns `_SESSION_ERROR`."""
    log_error(
        error_code="session_expired",
        endpoint=endpoint,
        stage="validate",
        audio_id=audio_id if isinstance(audio_id, str) else None,
        user_id=get_user_id(request) if request else "unknown",
        message="Session not found or expired",
    )


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
        "audio_duration_s": round(len(audio) / 16000, 2),
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


def _quota_error_response(exc: QuotaExhaustedError, audio_id=None, *,
                          endpoint: str = None, request=None) -> dict:
    """Build the standard quota-exhausted rejection. No auto-fallback to CPU.

    Caller is expected to retry with device='CPU'. No log row is written.

    ZeroGPU's real error strings (verified from Space logs, Apr 2026):
      * anonymous: "Unlogged user is runnning out of daily ZeroGPU quotas.
                    Signup for free on .../join or login on .../login ..."
      * logged:    "User is runnning out of daily ZeroGPU quotas.
                    Visit .../subscribe/pro ..."

    Neither string contains a reset timer — ZeroGPU doesn't give us one for
    either tier. `reset_time` remains None until ZeroGPU adds it upstream.
    """
    raw_lower = str(exc).lower()
    # ZeroGPU emits "0:00:00" when the daily cap is blown (vs. short-term
    # rate-limit where it emits a real wait). Translate that to a daily hint
    # since "Resets in 0:00:00" is confusing to users.
    # ZeroGPU emits a non-zero `wait` only for short-term rate-limits (rare).
    # For the far-more-common daily-cap case it emits "0:00:00" — HF does not
    # expose the actual daily-reset timestamp anywhere (huggingface_hub#2842).
    # Daily quota rolls 24h from the user's first GPU use of the day.
    if exc.reset_time and exc.reset_time != "0:00:00":
        reset_suffix = f" Resets in {exc.reset_time}."
    elif exc.reset_time == "0:00:00":
        reset_suffix = " Daily limit — resets ~24h after your first GPU use today."
    else:
        reset_suffix = ""
    if "unlogged user" in raw_lower or "signup for free" in raw_lower:
        resp = {
            "error": (
                f"Anonymous GPU quota exhausted for this IP.{reset_suffix} "
                "Sign in at https://huggingface.co/login for more quota, "
                "or retry with device=CPU."
            ),
            "error_code": "gpu_quota_anonymous",
            "reset_time": exc.reset_time,
            "segments": [],
        }
    else:
        resp = {
            "error": (
                f"GPU quota exhausted for your account.{reset_suffix} "
                "Upgrade at https://huggingface.co/subscribe/pro for more quota, "
                "or retry with device=CPU."
            ),
            "error_code": "gpu_quota_exhausted",
            "reset_time": exc.reset_time,
            "segments": [],
        }
    if audio_id is not None:
        resp["audio_id"] = audio_id
    log_error(
        error_code=resp["error_code"],
        endpoint=endpoint or "unknown",
        stage="dispatch",
        audio_id=audio_id,
        device="GPU",
        exception=exc,
        user_id=get_user_id(request) if request else "unknown",
        message=resp["error"],
        hint={
            "suggested_action": "retry_with_cpu_or_wait",
            "reset_time": exc.reset_time,
        },
    )
    return resp


def _pool_error_response(exc, audio_id=None, *,
                         endpoint: str = None, request=None) -> dict:
    """Structured rejection for CPU worker pool failures.

    Mirrors the quota transparency pattern: distinct `error_code` per failure
    mode so clients can react appropriately. No log row is written.
    """
    from src.core.worker_pool import PoolExhaustedError, PoolQueueFullError
    if isinstance(exc, PoolQueueFullError):
        resp = {
            "error": "CPU workers are at capacity — too many users already queued. Retry in about a minute.",
            "error_code": "cpu_pool_queue_full",
            "segments": [],
        }
    elif isinstance(exc, PoolExhaustedError):
        resp = {
            "error": "CPU workers busy — no slot opened up within the wait limit. Retry in about a minute.",
            "error_code": "cpu_pool_exhausted",
            "segments": [],
        }
    else:
        # Generic worker-call failure (network, crash, pickle, etc.) after all retries.
        resp = {
            "error": f"CPU worker call failed: {exc}",
            "error_code": "cpu_worker_failed",
            "segments": [],
        }
    if audio_id is not None:
        resp["audio_id"] = audio_id
    log_error(
        error_code=resp["error_code"],
        endpoint=endpoint or "unknown",
        stage="dispatch",
        audio_id=audio_id,
        device="CPU",
        exception=exc,
        user_id=get_user_id(request) if request else "unknown",
        message=resp["error"],
        hint={"suggested_action": "retry"},
    )
    return resp


# ---------------------------------------------------------------------------
# Duration estimation
# ---------------------------------------------------------------------------

_ESTIMABLE_ENDPOINTS = {
    "process_audio_session",
    "process_url_session",
    "resegment",
    "retranscribe",
    "realign_from_timestamps",
    "timestamps",
    "timestamps_direct",
    "split_segments",
}

_MFA_ENDPOINTS = {"timestamps", "timestamps_direct", "split_segments"}
_VAD_ENDPOINTS = {"process_audio_session", "process_url_session"}


def _load_session_metadata(audio_id):
    """Load only metadata.json (no audio/VAD). Returns dict or None."""
    if not _validate_id(audio_id):
        return None
    path = _session_dir(audio_id)
    meta_path = path / "metadata.json"
    if not meta_path.exists():
        return None
    ts_file = path / "created_at"
    if not ts_file.exists() or _is_expired(float(ts_file.read_text())):
        return None
    with open(meta_path) as f:
        return json.load(f)


def estimate_duration(endpoint, audio_duration_s=None, audio_id=None,
                      model_name="Base", device="GPU"):
    """Estimate processing duration for a given endpoint.

    Uses direct wall-time regression (not sum of lease components) fitted on
    257 runs from hetchyy/quran-aligner-logs v1 dataset.
    """
    from config import (
        ESTIMATE_GPU_BASE_SLOPE, ESTIMATE_GPU_BASE_INTERCEPT,
        ESTIMATE_GPU_LARGE_SLOPE, ESTIMATE_GPU_LARGE_INTERCEPT,
        ESTIMATE_CPU_BASE_SLOPE, ESTIMATE_CPU_BASE_INTERCEPT,
        ESTIMATE_CPU_LARGE_SLOPE, ESTIMATE_CPU_LARGE_INTERCEPT,
        MFA_PROGRESS_SEGMENT_RATE,
    )

    _error = {"estimated_duration_s": None}

    if endpoint not in _ESTIMABLE_ENDPOINTS:
        _error["error"] = (
            f"Unknown endpoint '{endpoint}'. "
            f"Valid: {', '.join(sorted(_ESTIMABLE_ENDPOINTS))}"
        )
        return _error

    # --- Resolve audio duration ---
    meta = None
    if audio_id:
        meta = _load_session_metadata(audio_id)

    if audio_duration_s is not None and audio_duration_s > 0:
        duration_s = float(audio_duration_s)
    elif meta and meta.get("audio_duration_s"):
        duration_s = meta["audio_duration_s"]
    else:
        _error["error"] = (
            "audio_duration_s is required (or provide audio_id with an existing session)"
        )
        return _error

    minutes = duration_s / 60.0

    # --- MFA endpoints require session with stored segments ---
    if endpoint in _MFA_ENDPOINTS:
        if not audio_id:
            _error["error"] = "MFA estimation requires audio_id with existing segments"
            return _error
        segments = _load_segments(audio_id)
        if not segments:
            _error["error"] = "No segments found in session — run an alignment endpoint first"
            return _error
        num_segments = len(segments)
        estimate = MFA_PROGRESS_SEGMENT_RATE * num_segments
    else:
        # --- Pipeline endpoints: direct wall-time regression ---
        device_upper = (device or "GPU").upper()
        is_large = model_name == "Large"

        if device_upper == "CPU":
            if is_large:
                estimate = ESTIMATE_CPU_LARGE_SLOPE * minutes + ESTIMATE_CPU_LARGE_INTERCEPT
            else:
                estimate = ESTIMATE_CPU_BASE_SLOPE * minutes + ESTIMATE_CPU_BASE_INTERCEPT
        else:
            if is_large:
                estimate = ESTIMATE_GPU_LARGE_SLOPE * minutes + ESTIMATE_GPU_LARGE_INTERCEPT
            else:
                estimate = ESTIMATE_GPU_BASE_SLOPE * minutes + ESTIMATE_GPU_BASE_INTERCEPT

        # Retranscribe/realign skip VAD — scale down by ~50% (ASR+DP only)
        if endpoint not in _VAD_ENDPOINTS:
            estimate *= 0.5

    rounded = max(5, math.ceil(estimate / 5) * 5)

    return {
        "endpoint": endpoint,
        "estimated_duration_s": rounded,
        "estimate_formula_s": round(float(estimate), 3),
        "device": device,
        "model_name": model_name,
    }


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
            "has_repeated_words": seg.get("has_repeated_words", False),
            "error": seg["error"],
        }
        if seg.get("special_type"):
            entry["special_type"] = seg["special_type"]
        if seg.get("repeated_ranges"):
            entry["repeated_ranges"] = seg["repeated_ranges"]
            entry["repeated_text"] = seg["repeated_text"]
        if seg.get("split_group_id"):
            entry["split_group_id"] = seg["split_group_id"]
        segments.append(entry)
    _save_segments(audio_id, segments)
    resp = {"audio_id": audio_id, "segments": segments}
    if warning:
        resp["warning"] = warning
    return resp


# ---------------------------------------------------------------------------
# Endpoint wrappers
# ---------------------------------------------------------------------------

def _estimate_wall_for_log(endpoint: str, audio_duration_s: float | None,
                           model_name: str, device: str) -> tuple[float | None, float | None]:
    """Best-effort wall-time estimate for logging.

    Returns `(estimate_given_s, estimate_formula_s)`:
    - `estimate_given_s`: ceil-to-5 value handed to the user (`timing.estimate_given_s`).
    - `estimate_formula_s`: raw formula output pre-ceil (`timing.estimate_formula_s`).

    Both populate log fields used for residual/estimator drift analysis. Never
    raises; returns `(None, None)` if inputs are insufficient.
    """
    if not audio_duration_s or audio_duration_s <= 0:
        return (None, None)
    try:
        r = estimate_duration(endpoint, audio_duration_s=float(audio_duration_s),
                              model_name=model_name, device=device)
        return (r.get("estimated_duration_s"), r.get("estimate_formula_s"))
    except Exception:
        return (None, None)


def process_audio_session(audio_data, min_silence_ms, min_speech_ms, pad_ms,
                          model_name="Base", device="GPU",
                          request: gr.Request = None):
    """Full pipeline: preprocess -> VAD -> ASR -> alignment. Creates session."""
    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="process_audio_session",
                               device=device, request=request)
    if err:
        return err
    from src.pipeline import process_audio

    # Probe audio duration for the log-row `estimate_given_s` field. Best-effort:
    # if the probe fails, estimate_given_s stays None.
    _audio_dur = None
    try:
        if isinstance(audio_data, str):
            import librosa as _lr
            _audio_dur = float(_lr.get_duration(path=audio_data))
        elif isinstance(audio_data, tuple) and len(audio_data) == 2:
            _sr, _arr = audio_data
            _audio_dur = float(len(_arr) / _sr) if _sr else None
    except Exception:
        _audio_dur = None
    _est, _est_formula = _estimate_wall_for_log("process_audio_session", _audio_dur, model_name, device)

    try:
        result = process_audio(
            audio_data, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, device, request=request, endpoint="process",
            estimated_wall_s=_est, estimate_formula_s=_est_formula,
        )
    except QuotaExhaustedError as e:
        return _quota_error_response(e, endpoint="process_audio_session", request=request)
    except (PoolQueueFullError, PoolExhaustedError) as e:
        return _pool_error_response(e, endpoint="process_audio_session", request=request)
    except Exception as e:
        _code = "no_speech" if "NoSpeechIntervals" in str(e) else "pipeline_exception"
        log_error(error_code=_code, endpoint="process_audio_session",
                  stage="vad" if _code == "no_speech" else None,
                  audio_id=None, device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"audio_duration_s": _audio_dur, "model_name": model_name})
        raise
    # result is a 9-tuple:
    # (html, json_output, speech_intervals, is_complete, audio, sr, intervals, seg_dir, log_row)
    json_output = result[1]
    if json_output is None:
        log_error(error_code="no_speech", endpoint="process_audio_session",
                  stage="vad", device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="No speech detected in audio",
                  context={"audio_duration_s": _audio_dur})
        return {"error": "No speech detected in audio", "segments": []}

    speech_intervals = result[2]
    is_complete = result[3]
    audio_ref = result[4]
    intervals = result[6]

    # Resolve audio from pipeline cache (result[4] is now a cache key, not array)
    from src.pipeline import _load_audio
    audio, _ = _load_audio(audio_ref)

    audio_id = create_session(
        audio, speech_intervals, is_complete, intervals, model_name,
    )
    return _format_response(audio_id, json_output)


def process_url_session(url, min_silence_ms, min_speech_ms, pad_ms,
                        model_name="Base", device="GPU",
                        request: gr.Request = None):
    """Full pipeline from URL: download -> preprocess -> VAD -> ASR -> alignment.

    Downloads audio via yt-dlp, then runs the same pipeline as
    process_audio_session. Returns the same response format with an
    additional url_metadata field.
    """
    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="process_url_session",
                               device=device, request=request)
    if err:
        return err

    if not url or not isinstance(url, str) or not url.strip():
        log_error(error_code="empty_url", endpoint="process_url_session",
                  stage="validate",
                  user_id=get_user_id(request) if request else "unknown",
                  message="URL is required")
        return {"error": "URL is required", "segments": []}

    url = url.strip()

    # Download audio
    set_stage("download")
    try:
        from src.ui.handlers import _download_url_core
        wav_path, url_meta = _download_url_core(url)
    except Exception as e:
        msg = f"Download failed: {e}"
        msg_l = msg.lower()
        if "playlist" in msg_l:
            code = "playlist_rejected"
        else:
            code = "download_failed"
        log_error(error_code=code, endpoint="process_url_session",
                  stage="download", device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  message=msg, context={"url": url})
        return {"error": msg, "segments": []}

    # Run the standard pipeline with the downloaded WAV path
    from src.pipeline import process_audio

    _audio_dur = None
    try:
        import librosa as _lr
        _audio_dur = float(_lr.get_duration(path=wav_path))
    except Exception:
        _audio_dur = url_meta.get("duration")
    _est, _est_formula = _estimate_wall_for_log("process_url_session", _audio_dur, model_name, device)

    try:
        result = process_audio(
            wav_path, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, device, request=request, endpoint="process_url",
            estimated_wall_s=_est, estimate_formula_s=_est_formula,
            url_source=url,
        )
    except QuotaExhaustedError as e:
        try:
            os.remove(wav_path)
        except OSError:
            pass
        return _quota_error_response(e, endpoint="process_url_session", request=request)
    except (PoolQueueFullError, PoolExhaustedError) as e:
        try:
            os.remove(wav_path)
        except OSError:
            pass
        return _pool_error_response(e, endpoint="process_url_session", request=request)
    except Exception as e:
        _code = "no_speech" if "NoSpeechIntervals" in str(e) else "pipeline_exception"
        log_error(error_code=_code, endpoint="process_url_session",
                  stage="vad" if _code == "no_speech" else None,
                  device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"audio_duration_s": _audio_dur, "model_name": model_name,
                           "url": url})
        try:
            os.remove(wav_path)
        except OSError:
            pass
        raise

    json_output = result[1]
    if json_output is None:
        log_error(error_code="no_speech", endpoint="process_url_session",
                  stage="vad", device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="No speech detected in audio",
                  context={"audio_duration_s": _audio_dur, "url": url})
        return {"error": "No speech detected in audio", "segments": []}

    speech_intervals = result[2]
    is_complete = result[3]
    audio_ref = result[4]
    intervals = result[6]

    from src.pipeline import _load_audio
    audio, _ = _load_audio(audio_ref)

    audio_id = create_session(
        audio, speech_intervals, is_complete, intervals, model_name,
    )

    response = _format_response(audio_id, json_output)
    response["url_metadata"] = {
        "title": url_meta.get("title"),
        "duration": url_meta.get("duration"),
        "source_url": url_meta.get("source_url"),
    }

    # Clean up downloaded WAV (audio is now cached in session)
    try:
        os.remove(wav_path)
    except OSError:
        pass

    return response


def resegment(audio_id, min_silence_ms, min_speech_ms, pad_ms,
                       model_name="Base", device="GPU",
                       request: gr.Request = None):
    """Re-clean VAD boundaries with new params and re-run ASR + alignment."""
    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="resegment",
                               audio_id=audio_id, device=device, request=request)
    if err:
        err["audio_id"] = audio_id
        return err
    session = load_session(audio_id)
    if session is None:
        _log_session_expired(endpoint="resegment", audio_id=audio_id, request=request)
        return _SESSION_ERROR

    from src.pipeline import resegment_audio

    _audio_dur = float(len(session["audio"]) / 16000)
    _est, _est_formula = _estimate_wall_for_log("resegment", _audio_dur, model_name, device)

    try:
        result = resegment_audio(
            session["speech_intervals"], session["is_complete"],
            session["audio"], 16000,
            int(min_silence_ms), int(min_speech_ms), int(pad_ms),
            model_name, device, request=request, endpoint="resegment",
            estimated_wall_s=_est, estimate_formula_s=_est_formula,
        )
    except QuotaExhaustedError as e:
        return _quota_error_response(e, audio_id=audio_id, endpoint="resegment",
                                     request=request)
    except (PoolQueueFullError, PoolExhaustedError) as e:
        return _pool_error_response(e, audio_id=audio_id, endpoint="resegment",
                                    request=request)
    except Exception as e:
        log_error(error_code="pipeline_exception", endpoint="resegment",
                  audio_id=audio_id, device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"audio_duration_s": _audio_dur, "model_name": model_name})
        raise
    json_output = result[1]
    if json_output is None:
        log_error(error_code="no_segments_after_resegment", endpoint="resegment",
                  stage="vad", audio_id=audio_id, device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="No segments with these settings",
                  context={"min_silence_ms": int(min_silence_ms),
                           "min_speech_ms": int(min_speech_ms),
                           "pad_ms": int(pad_ms)})
        return {"audio_id": audio_id, "error": "No segments with these settings", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output)


def retranscribe(audio_id, model_name="Base", device="GPU",
                          request: gr.Request = None):
    """Re-run ASR with a different model on current segment boundaries."""
    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="retranscribe",
                               audio_id=audio_id, device=device, request=request)
    if err:
        err["audio_id"] = audio_id
        return err
    session = load_session(audio_id)
    if session is None:
        _log_session_expired(endpoint="retranscribe", audio_id=audio_id, request=request)
        return _SESSION_ERROR

    # Guard: reject if model and boundaries unchanged
    if (model_name == session["model_name"]
            and _intervals_hash(session["intervals"]) == session["intervals_hash"]):
        msg = "Model and boundaries unchanged. Change model_name or call /resegment first."
        log_error(error_code="model_unchanged", endpoint="retranscribe",
                  stage="validate", audio_id=audio_id, device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message=msg, context={"model_name": model_name})
        return {
            "audio_id": audio_id,
            "error": msg,
            "segments": [],
        }

    from src.pipeline import retranscribe_audio

    _audio_dur = float(len(session["audio"]) / 16000)
    _est, _est_formula = _estimate_wall_for_log("retranscribe", _audio_dur, model_name, device)

    try:
        result = retranscribe_audio(
            session["intervals"],
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, device, request=request, endpoint="retranscribe",
            estimated_wall_s=_est, estimate_formula_s=_est_formula,
        )
    except QuotaExhaustedError as e:
        return _quota_error_response(e, audio_id=audio_id, endpoint="retranscribe",
                                     request=request)
    except (PoolQueueFullError, PoolExhaustedError) as e:
        return _pool_error_response(e, audio_id=audio_id, endpoint="retranscribe",
                                    request=request)
    except Exception as e:
        log_error(error_code="pipeline_exception", endpoint="retranscribe",
                  audio_id=audio_id, device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"audio_duration_s": _audio_dur, "model_name": model_name})
        raise
    json_output = result[1]
    if json_output is None:
        log_error(error_code="retranscription_failed", endpoint="retranscribe",
                  stage="asr", audio_id=audio_id, device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="Retranscription failed",
                  context={"model_name": model_name})
        return {"audio_id": audio_id, "error": "Retranscription failed", "segments": []}

    update_session(audio_id, model_name=model_name)
    return _format_response(audio_id, json_output)


def split_segments(audio_id, max_verses=1, max_words=None, max_duration=None,
                   require_stop_sign=False,
                   request: gr.Request = None):
    """Subdivide current segments by verse/word/duration limits using MFA.

    Args:
        max_verses:   int 1..5. 5 (or None/0) disables the verse criterion.
        max_words:    int 10..50. 50 (or None/0) disables the word criterion.
        max_duration: float seconds 3..30. 30 (or None/0) disables the
                      duration criterion.
        require_stop_sign: if True, skip segments without a waqf mark
                      instead of equal-word splitting. Verse pass unaffected.

    Returns: {"audio_id": ..., "segments": [...]}
    """
    from config import SPLIT_MAX_VERSES_MAX, SPLIT_MAX_WORDS_MAX
    from src.core.segment_types import SegmentInfo

    mark_endpoint_entry()
    set_stage("validate")
    session = load_session(audio_id)
    if session is None:
        _log_session_expired(endpoint="split_segments", audio_id=audio_id, request=request)
        return _SESSION_ERROR

    saved = _load_segments(audio_id)
    if not saved:
        msg = "No segments stored for this session. Run /process_audio_session first."
        log_error(error_code="no_segments_for_split", endpoint="split_segments",
                  stage="validate", audio_id=audio_id,
                  user_id=get_user_id(request) if request else "unknown",
                  message=msg)
        return {"audio_id": audio_id, "error": msg, "segments": []}

    # Reconstruct SegmentInfo list from persisted dicts
    segments = [SegmentInfo.from_json_dict(d, index=i) for i, d in enumerate(saved)]

    from src.pipeline import split_segments_audio

    try:
        result = split_segments_audio(
            segments,
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            session["intervals"],
            max_verses, max_words, max_duration,
            require_stop_sign=bool(require_stop_sign),
            cached_segment_dir=None,
            request=request, endpoint="split_segments",
        )
    except Exception as e:
        log_error(error_code="pipeline_exception", endpoint="split_segments",
                  audio_id=audio_id, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"max_verses": max_verses, "max_words": max_words,
                           "max_duration": max_duration,
                           "require_stop_sign": bool(require_stop_sign)})
        raise

    new_segments = result[1]
    if new_segments is None:
        return {"audio_id": audio_id, "error": "Split failed", "segments": []}

    # Convert List[SegmentInfo] → JSON dict for _format_response
    from src.core.segment_types import segments_to_json
    json_output = segments_to_json(new_segments) if isinstance(new_segments, list) else new_segments
    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals)
    return _format_response(audio_id, json_output)


def realign_from_timestamps(audio_id, timestamps, model_name="Base", device="GPU",
                             request: gr.Request = None):
    """Run ASR + alignment on caller-provided timestamp intervals."""
    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="realign_from_timestamps",
                               audio_id=audio_id, device=device, request=request)
    if err:
        err["audio_id"] = audio_id
        return err
    session = load_session(audio_id)
    if session is None:
        _log_session_expired(endpoint="realign_from_timestamps", audio_id=audio_id,
                             request=request)
        return _SESSION_ERROR

    # Parse timestamps: accept list of {"start": f, "end": f} dicts
    if isinstance(timestamps, str):
        timestamps = json.loads(timestamps)

    intervals = [(ts["start"], ts["end"]) for ts in timestamps]

    from src.pipeline import realign_audio

    _audio_dur = float(len(session["audio"]) / 16000)
    _est, _est_formula = _estimate_wall_for_log("realign_from_timestamps", _audio_dur, model_name, device)

    try:
        result = realign_audio(
            intervals,
            session["audio"], 16000,
            session["speech_intervals"], session["is_complete"],
            model_name, device, request=request, endpoint="realign",
            estimated_wall_s=_est, estimate_formula_s=_est_formula,
        )
    except QuotaExhaustedError as e:
        return _quota_error_response(e, audio_id=audio_id,
                                     endpoint="realign_from_timestamps",
                                     request=request)
    except (PoolQueueFullError, PoolExhaustedError) as e:
        return _pool_error_response(e, audio_id=audio_id,
                                    endpoint="realign_from_timestamps",
                                    request=request)
    except Exception as e:
        log_error(error_code="pipeline_exception", endpoint="realign_from_timestamps",
                  audio_id=audio_id, device=device, exception=e,
                  user_id=get_user_id(request) if request else "unknown",
                  context={"audio_duration_s": _audio_dur, "model_name": model_name,
                           "n_intervals": len(intervals)})
        raise
    json_output = result[1]
    if json_output is None:
        log_error(error_code="alignment_failed", endpoint="realign_from_timestamps",
                  stage="dp", audio_id=audio_id, device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="Alignment failed",
                  context={"model_name": model_name, "n_intervals": len(intervals)})
        return {"audio_id": audio_id, "error": "Alignment failed", "segments": []}

    new_intervals = result[6]
    update_session(audio_id, intervals=new_intervals, model_name=model_name)
    return _format_response(audio_id, json_output)


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

def timestamps(audio_id, segments_json=None, granularity="words"):
    """Compute MFA word/letter timestamps using session audio."""
    mark_endpoint_entry()
    set_stage("validate")
    if granularity == "words+chars":
        msg = "chars granularity is currently disabled via API"
        log_error(error_code="unsupported_granularity", endpoint="timestamps",
                  stage="validate", audio_id=audio_id,
                  message=msg, context={"granularity": granularity})
        return {"audio_id": audio_id, "error": msg, "segments": []}

    session = load_session(audio_id)
    if session is None:
        _log_session_expired(endpoint="timestamps", audio_id=audio_id)
        return _SESSION_ERROR

    # Parse segments: use provided or load stored
    if isinstance(segments_json, str):
        segments_json = json.loads(segments_json)

    if segments_json:
        segments = _normalize_segments(segments_json)
    else:
        segments = _load_segments(audio_id)
        if not segments:
            log_error(error_code="no_segments_in_session", endpoint="timestamps",
                      stage="validate", audio_id=audio_id,
                      message="No segments found in session")
            return {"audio_id": audio_id, "error": "No segments found in session", "segments": []}

    # Create segment WAVs from session audio
    set_stage("mfa")
    try:
        seg_dir = _create_segment_wavs(session["audio"], 16000, segments)
    except Exception as e:
        log_error(error_code="segment_wav_failed", endpoint="timestamps",
                  stage="mfa", audio_id=audio_id, exception=e,
                  message=f"Failed to create segment audio: {e}",
                  context={"n_segments": len(segments)})
        return {"audio_id": audio_id, "error": f"Failed to create segment audio: {e}", "segments": []}

    from src.mfa import compute_mfa_timestamps_api
    try:
        result = compute_mfa_timestamps_api(segments, seg_dir, granularity or "words")
    except Exception as e:
        log_error(error_code="mfa_failed", endpoint="timestamps",
                  stage="mfa", audio_id=audio_id, exception=e,
                  message=f"MFA alignment failed: {e}",
                  context={"n_segments": len(segments), "granularity": granularity})
        return {"audio_id": audio_id, "error": f"MFA alignment failed: {e}", "segments": []}

    result["audio_id"] = audio_id
    return result


def timestamps_direct(audio_data, segments_json, granularity="words"):
    """Compute MFA word/letter timestamps with provided audio and segments."""
    mark_endpoint_entry()
    set_stage("validate")
    if granularity == "words+chars":
        msg = "chars granularity is currently disabled via API"
        log_error(error_code="unsupported_granularity", endpoint="timestamps_direct",
                  stage="validate", message=msg,
                  context={"granularity": granularity})
        return {"error": msg, "segments": []}

    # Parse segments
    if isinstance(segments_json, str):
        segments_json = json.loads(segments_json)

    if not segments_json:
        log_error(error_code="no_segments_provided", endpoint="timestamps_direct",
                  stage="validate", message="No segments provided")
        return {"error": "No segments provided", "segments": []}

    segments = _normalize_segments(segments_json)

    # Preprocess audio
    set_stage("preprocess")
    try:
        audio_np, sr = _preprocess_api_audio(audio_data)
    except Exception as e:
        log_error(error_code="preprocess_failed", endpoint="timestamps_direct",
                  stage="preprocess", exception=e,
                  message=f"Failed to preprocess audio: {e}")
        return {"error": f"Failed to preprocess audio: {e}", "segments": []}

    # Create segment WAVs
    set_stage("mfa")
    try:
        seg_dir = _create_segment_wavs(audio_np, sr, segments)
    except Exception as e:
        log_error(error_code="segment_wav_failed", endpoint="timestamps_direct",
                  stage="mfa", exception=e,
                  message=f"Failed to create segment audio: {e}",
                  context={"n_segments": len(segments)})
        return {"error": f"Failed to create segment audio: {e}", "segments": []}

    from src.mfa import compute_mfa_timestamps_api
    try:
        result = compute_mfa_timestamps_api(segments, seg_dir, granularity or "words")
    except Exception as e:
        log_error(error_code="mfa_failed", endpoint="timestamps_direct",
                  stage="mfa", exception=e,
                  message=f"MFA alignment failed: {e}",
                  context={"n_segments": len(segments), "granularity": granularity})
        return {"error": f"MFA alignment failed: {e}", "segments": []}

    return result


# ---------------------------------------------------------------------------
# CPU worker endpoint (invoked by main Space's worker_pool dispatcher)
# ---------------------------------------------------------------------------

def cpu_exec(hf_token, func_module, func_name, args_b64, kwargs_b64, meta_json=""):
    """Execute a single GPU-decorated function on this worker's CPU.

    Only enabled when WORKER_MODE=cpu. Called by the main Space over HTTP via
    the worker_pool dispatcher.

    Args, kwargs, and return value are pickled and base64-encoded. When
    meta_json specifies a non-float32 transport, audio inside args is
    decoded back to float32 before calling func.

    Security:
      - WORKER_MODE=cpu env gate (endpoint is inert on non-worker deploys).
      - HF_TOKEN match against the Space secret.
      - func_module must start with 'src.' (no stdlib / arbitrary imports).

    Returns:
      {"status": "ok", "result_b64": ..., "worker_timings": {...}} on success.
      {"status": "error", "error": <message>} on failure.
    """
    import base64
    import importlib
    import json as _json
    import pickle
    import time
    import traceback

    if os.environ.get("WORKER_MODE", "").lower() != "cpu":
        return {"status": "error", "error": "cpu_exec is disabled (WORKER_MODE != cpu)"}

    space_token = os.environ.get("HF_TOKEN", "")
    if not hf_token or (space_token and hf_token != space_token):
        return {"status": "error", "error": "Unauthorized"}

    if not isinstance(func_module, str) or not func_module.startswith("src."):
        return {"status": "error", "error": f"func_module '{func_module}' not in src.* namespace"}

    req_body_mb = (len(args_b64) + len(kwargs_b64) + len(meta_json)) / 1e6
    print(f"[cpu_exec] RECV {func_module}.{func_name} (body={req_body_mb:.2f} MB, meta={meta_json[:120]})")
    t_total = time.time()

    timings = {}

    try:
        t0 = time.time()
        args = pickle.loads(base64.b64decode(args_b64))
        kwargs = pickle.loads(base64.b64decode(kwargs_b64))
        timings["unpickle_s"] = round(time.time() - t0, 3)
    except Exception as e:
        return {"status": "error", "error": f"Failed to unpickle args/kwargs: {e}"}

    # Decode transport (e.g. int16 → float32)
    try:
        t0 = time.time()
        meta = _json.loads(meta_json) if meta_json else {"transport": "float32"}
        from src.core.audio_transport import decode_args_for_transport
        args = decode_args_for_transport(args, meta)
        timings["audio_decode_s"] = round(time.time() - t0, 3)
        timings["transport"] = meta.get("transport", "float32")
    except Exception as e:
        tb = traceback.format_exc()
        return {"status": "error", "error": f"Transport decode failed: {e}", "traceback": tb}

    try:
        module = importlib.import_module(func_module)
        func = getattr(module, func_name)
    except Exception as e:
        return {"status": "error", "error": f"Failed to resolve {func_module}.{func_name}: {e}"}

    # Unwrap @gpu_with_fallback so we run the raw function directly.
    # On a CPU worker, WORKER_MODE=cpu already makes the wrapper a pass-through,
    # but unwrapping removes the dead decorator frame from the traceback.
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__

    try:
        t0 = time.time()
        result = func(*args, **kwargs)
        timings["compute_s"] = round(time.time() - t0, 3)

        t0 = time.time()
        result_b64 = base64.b64encode(pickle.dumps(result)).decode()
        timings["result_encode_s"] = round(time.time() - t0, 3)
        timings["result_bytes"] = len(result_b64)

        print(
            f"[cpu_exec] DONE {func_name} total={time.time() - t_total:.1f}s "
            f"compute={timings['compute_s']:.1f}s resp={len(result_b64)/1e6:.2f} MB "
            f"timings={timings}"
        )
        return {"status": "ok", "result_b64": result_b64, "worker_timings": timings}
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[cpu_exec] {func_module}.{func_name} failed:\n{tb}")
        return {"status": "error", "error": f"{type(e).__name__}: {e}", "traceback": tb}


def pool_status(hf_token):
    """Return per-worker state + pool config. HF-token-gated.

    On Spaces without a configured pool (worker Spaces or dev), returns an
    empty workers list with a note.
    """
    space_token = os.environ.get("HF_TOKEN", "")
    if not hf_token or (space_token and hf_token != space_token):
        return {"error": "Unauthorized"}

    from config import (
        CPU_WORKER_ACQUIRE_TIMEOUT,
        CPU_WORKER_HEALTH_INTERVAL,
        CPU_WORKER_MAX_QUEUE_DEPTH,
        CPU_WORKER_TRANSPORT_DEFAULT,
    )
    from src.core.worker_pool import POOL

    config_block = {
        "transport_default": CPU_WORKER_TRANSPORT_DEFAULT,
        "max_queue_depth": CPU_WORKER_MAX_QUEUE_DEPTH,
        "acquire_timeout_s": CPU_WORKER_ACQUIRE_TIMEOUT,
        "health_interval_s": CPU_WORKER_HEALTH_INTERVAL,
    }

    if not POOL.has_workers():
        return {
            "workers": [],
            "queue": {"busy_workers": 0, "total_workers": 0, "waiters": 0},
            "config": config_block,
            "note": "no workers configured on this Space",
        }

    return {
        "workers": POOL.status(),
        "queue": POOL.queue_info(),
        "config": config_block,
    }


def cpu_pool_kill(hf_token, worker_id):
    """Kill a persistent worker for crash-recovery testing. HF-token-gated."""
    space_token = os.environ.get("HF_TOKEN", "")
    if not hf_token or (space_token and hf_token != space_token):
        return {"error": "Unauthorized"}
    try:
        from src.core.cpu_worker_pool import _get_pool
        import signal as _signal
        import time as _time
        p = _get_pool()
        wid = int(worker_id)
        h = p.workers[wid]
        pid = h.pid
        was_alive = h.process is not None and h.process.is_alive()
        try:
            os.kill(pid, _signal.SIGKILL)
            sent = True
            send_err = None
        except Exception as ke:
            sent = False
            send_err = str(ke)
        # give OS a moment to reap
        _time.sleep(0.3)
        alive_after = h.process is not None and h.process.is_alive()
        return {
            "worker_id": wid,
            "pid": pid,
            "was_alive": was_alive,
            "kill_sent": sent,
            "send_err": send_err,
            "alive_after": alive_after,
        }
    except Exception as e:
        return {"error": str(e)}


def cpu_pool_status(hf_token):
    """Return persistent CPU worker pool state. HF-token-gated.

    Prototype diagnostic: shows per-worker boot snapshots, load times, pids,
    live RSS, and job counts. Safe to call on Spaces where CPU_WORKER_MODE
    is not 'persistent' — just returns `started=False`.
    """
    space_token = os.environ.get("HF_TOKEN", "")
    if not hf_token or (space_token and hf_token != space_token):
        return {"error": "Unauthorized"}

    try:
        from src.core.cpu_worker_pool import is_started, stats as pool_stats, probe_rss
    except Exception as e:
        return {"error": f"pool import failed: {e}"}

    if not is_started():
        return {"started": False, "note": "CPU_WORKER_MODE != persistent or pool not yet bootstrapped"}

    s = pool_stats()
    # Augment with live RSS probe per worker
    for w in s.get("workers", []):
        try:
            w["rss_now"] = probe_rss(w["id"])
        except Exception as e:
            w["rss_now_error"] = str(e)
    # Include main process RSS
    try:
        import psutil as _ps
        s["main_rss"] = _ps.Process(os.getpid()).memory_info().rss
        vm = _ps.virtual_memory()
        s["host_mem"] = {"total": vm.total, "available": vm.available, "used": vm.used, "percent": vm.percent}
    except Exception as e:
        s["main_rss_error"] = str(e)
    # Probe cgroup (container) memory limit — authoritative Space budget.
    cgroup = {}
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path) as _f:
                cgroup[path] = _f.read().strip()
        except Exception as e:
            cgroup[path] = f"err: {e}"
    try:
        with open("/sys/fs/cgroup/memory.current") as _f:
            cgroup["memory.current"] = _f.read().strip()
    except Exception:
        pass
    s["cgroup"] = cgroup
    return s


# ---------------------------------------------------------------------------
# Hidden debug endpoint
# ---------------------------------------------------------------------------

import dataclasses
import threading
from datetime import datetime, timezone

_debug_lock = threading.Lock()


def debug_process(audio_data, min_silence_ms, min_speech_ms, pad_ms,
                  model_name="Base", device="GPU", hf_token="",
                  request: gr.Request = None):
    """Hidden debug endpoint: full pipeline with comprehensive debug output.

    Authenticated via HF token comparison against the Space secret.
    Returns structured debug data from every pipeline stage.
    """
    # --- Auth ---
    space_token = os.environ.get("HF_TOKEN", "")
    if not hf_token or (space_token and hf_token != space_token):
        return {"error": "Unauthorized"}

    mark_endpoint_entry()
    set_stage("validate")
    err = _validate_model_name(model_name, endpoint="debug_process",
                               device=device, request=request)
    if err:
        return err

    from src.core.debug_collector import start_debug_collection, stop_debug_collection
    from src.pipeline import process_audio

    with _debug_lock:
        try:
            start_debug_collection()

            result = process_audio(
                audio_data, int(min_silence_ms), int(min_speech_ms), int(pad_ms),
                model_name, device, request=request, endpoint="process",
            )

            collector = stop_debug_collection()
        except QuotaExhaustedError as e:
            stop_debug_collection()
            return _quota_error_response(e, endpoint="debug_process", request=request)
        except (PoolQueueFullError, PoolExhaustedError) as e:
            stop_debug_collection()
            return _pool_error_response(e, endpoint="debug_process", request=request)
        except Exception as e:
            stop_debug_collection()
            log_error(error_code="pipeline_exception", endpoint="debug_process",
                      device=device, exception=e,
                      user_id=get_user_id(request) if request else "unknown",
                      message=f"Pipeline failed: {e}",
                      context={"model_name": model_name})
            return {"error": f"Pipeline failed: {e}"}

    # --- Assemble response ---
    json_output = result[1]
    if json_output is None:
        log_error(error_code="no_speech", endpoint="debug_process",
                  stage="vad", device=device,
                  user_id=get_user_id(request) if request else "unknown",
                  message="No speech detected in audio")
        return {"error": "No speech detected in audio", "segments": []}

    # Extract profiling from collector (stored by _run_post_vad_pipeline)
    profiling_dict = {}
    if collector and collector._profiling is not None:
        p = collector._profiling
        profiling_dict = dataclasses.asdict(p)
        # Add computed fields
        profiling_dict["phoneme_dp_avg_time"] = p.phoneme_dp_avg_time
        profiling_dict["summary_text"] = p.summary()

    # Format segments (same as _format_response but without session)
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
            "has_repeated_words": seg.get("has_repeated_words", False),
            "error": seg["error"],
        }
        if seg.get("special_type"):
            entry["special_type"] = seg["special_type"]
        if seg.get("repeated_ranges"):
            entry["repeated_ranges"] = seg["repeated_ranges"]
            entry["repeated_text"] = seg["repeated_text"]
        if seg.get("split_group_id"):
            entry["split_group_id"] = seg["split_group_id"]
        segments.append(entry)

    # Surface CPU-worker dispatch info (from thread-local) on debug responses.
    try:
        from src.core.worker_pool import get_last_dispatch_info
        worker_dispatch = get_last_dispatch_info()
    except Exception:
        worker_dispatch = None

    # Build final response
    response = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "profiling": profiling_dict,
        "worker_dispatch": worker_dispatch,
        "segments": segments,
    }

    # Merge collector sections
    if collector:
        debug_data = collector.to_dict()
        response["vad"] = debug_data["vad"]
        response["asr"] = debug_data["asr"]
        response["anchor"] = debug_data["anchor"]
        response["specials"] = debug_data["specials"]
        response["alignment_detail"] = debug_data["alignment_detail"]
        response["events"] = debug_data["events"]

    return response
