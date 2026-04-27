"""VAD-only benchmark endpoints (dev Space only).

Two endpoints:
- /bench_prepare: ingest audio (file or URL), preprocess to 16k mono, cache in session, return audio_id.
- /bench_vad: one GPU lease, run `segment_recitations` with a chosen batch_size,
  return wall + peak VRAM + n_intervals + hardware string.

Intentionally minimal — for measuring VAD inference cost only.
"""
from __future__ import annotations

import os
import time

import gradio as gr
import librosa
import numpy as np
import torch

from src.api.session_api import create_session, load_session
from src.core.zero_gpu import gpu_with_fallback


def bench_prepare(audio_data=None, url=None, request: gr.Request = None):
    """Preprocess audio (file upload or URL) to 16k mono, create empty session."""
    if not audio_data and not url:
        return {"error": "Provide audio_data or url"}

    t0 = time.time()
    if url:
        from src.ui.handlers import download_url_audio
        wav_path, _info = download_url_audio(url)
        if not wav_path:
            return {"error": f"URL download failed: {url}"}
        audio_path = wav_path
    else:
        audio_path = audio_data

    audio, _sr = librosa.load(audio_path, sr=16000, mono=True, res_type="soxr_hq")
    audio = audio.astype(np.float32)

    # Empty VAD artifacts — we won't use them.
    audio_id = create_session(
        audio=audio,
        speech_intervals=[],
        is_complete=False,
        intervals=[],
        model_name="Base",
    )
    return {
        "audio_id": audio_id,
        "duration_s": round(len(audio) / 16000, 2),
        "prepare_s": round(time.time() - t0, 3),
    }


def _bench_vad_duration(audio_id, batch_size, *_a, **_k):
    session = load_session(audio_id) if audio_id else None
    if session is None:
        return 60
    dur_min = len(session["audio"]) / 16000 / 60
    # ~10s base + 1s/min of audio, capped at 120
    return int(min(120, max(30, 10 + dur_min * 1.5)))


@gpu_with_fallback(duration=_bench_vad_duration)
def _bench_vad_gpu(audio_id, batch_size, dtype_str="bfloat16"):
    from recitations_segmenter import segment_recitations
    from src.segmenter.segmenter_model import load_segmenter
    from src.segmenter.segmenter_model import ensure_models_on_gpu

    session = load_session(audio_id)
    if session is None:
        return {"error": "session_missing"}
    audio = session["audio"]

    load_segmenter()
    ensure_models_on_gpu()

    model_dtype_map = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}
    target_dtype = model_dtype_map.get(dtype_str, torch.bfloat16)

    from src.segmenter.segmenter_model import _segmenter_cache
    model = _segmenter_cache["model"]
    processor = _segmenter_cache["processor"]

    device = next(model.parameters()).device
    model_dtype = next(model.parameters()).dtype
    # Cast to requested dtype (in-place) if different
    if model_dtype != target_dtype and device.type == "cuda":
        model.to(dtype=target_dtype)
        model_dtype = target_dtype

    audio_tensor = torch.from_numpy(audio).float()

    hw = "unknown"
    if device.type == "cuda":
        try:
            hw = torch.cuda.get_device_name(device)
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
        except Exception:
            pass

    t0 = time.perf_counter()
    outputs = segment_recitations(
        [audio_tensor], model, processor,
        device=device, dtype=model_dtype,
        batch_size=int(batch_size),
    )
    if device.type == "cuda":
        torch.cuda.synchronize()
    wall = time.perf_counter() - t0

    n_intervals = len(outputs[0].speech_intervals) if outputs else 0
    peak_mb = 0.0
    reserved_mb = 0.0
    if device.type == "cuda":
        peak_mb = torch.cuda.max_memory_allocated(device) / (1024 * 1024)
        reserved_mb = torch.cuda.max_memory_reserved(device) / (1024 * 1024)

    return {
        "audio_id": audio_id,
        "batch_size": int(batch_size),
        "dtype": dtype_str,
        "wall_s": round(wall, 4),
        "n_intervals": int(n_intervals),
        "peak_mem_mb": round(peak_mb, 1),
        "reserved_mem_mb": round(reserved_mb, 1),
        "device": str(device),
        "hardware": hw,
        "duration_s": round(len(audio) / 16000, 2),
    }


def bench_vad(audio_id, batch_size=1, dtype="bfloat16",
              request: gr.Request = None):
    """Run VAD once with the given batch_size. One GPU lease per call."""
    if not audio_id:
        return {"error": "audio_id required"}
    try:
        bs = int(batch_size)
    except (TypeError, ValueError):
        return {"error": f"invalid batch_size: {batch_size}"}
    return _bench_vad_gpu(audio_id, bs, str(dtype))
