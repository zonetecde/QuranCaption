"""Phoneme ASR using wav2vec2 CTC model."""

import os
import time
import torch
import numpy as np
from typing import List, Dict, Any

from config import (
    PHONEME_ASR_MODELS, PHONEME_ASR_MODEL_DEFAULT, DTYPE, IS_HF_SPACE, TORCH_COMPILE,
    BATCHING_STRATEGY, INFERENCE_BATCH_SIZE,
    MAX_BATCH_SECONDS, MAX_PAD_WASTE, MIN_BATCH_SIZE,
)
from ..core.zero_gpu import ZERO_GPU_AVAILABLE, is_quota_exhausted


_cache = {}  # model_name -> {"model": Model, "processor": Processor, "device": str}

_TORCH_DTYPE = torch.float16 if DTYPE == "float16" else torch.float32


def _get_hf_token():
    """Get HF token from env var or stored login."""
    token = os.environ.get("HF_TOKEN")
    if not token:
        try:
            from huggingface_hub import HfFolder
            token = HfFolder.get_token()
        except Exception:
            pass
    return token


def _get_device_and_dtype():
    """Get the best available device and dtype.

    On HF Spaces with ZeroGPU, returns CPU to defer CUDA init
    until inside a @gpu_decorator function.
    """
    if IS_HF_SPACE or ZERO_GPU_AVAILABLE:
        return torch.device("cpu"), _TORCH_DTYPE
    if torch.cuda.is_available():
        return torch.device("cuda"), _TORCH_DTYPE
    return torch.device("cpu"), _TORCH_DTYPE


def load_phoneme_asr(model_name=PHONEME_ASR_MODEL_DEFAULT):
    """Load phoneme ASR model on CPU. Returns (model, processor).

    Models are loaded once and cached per model_name. Both base and large
    can be cached simultaneously. Use move_phoneme_asr_to_gpu() inside
    GPU-decorated functions to move to CUDA.
    """
    if model_name in _cache:
        entry = _cache[model_name]
        return entry["model"], entry["processor"]

    import logging
    from transformers import AutoModelForCTC, AutoProcessor

    # Suppress verbose transformers logging during load
    logging.getLogger("transformers").setLevel(logging.WARNING)

    model_path = PHONEME_ASR_MODELS[model_name]
    print(f"Loading phoneme ASR: {model_path} ({model_name})")

    # Use HF_TOKEN for private model access
    hf_token = _get_hf_token()

    device, dtype = _get_device_and_dtype()

    model = AutoModelForCTC.from_pretrained(
        model_path, token=hf_token, attn_implementation="sdpa"
    )
    model.to(device, dtype=dtype)
    model.eval()
    if TORCH_COMPILE and not (IS_HF_SPACE or ZERO_GPU_AVAILABLE):
        model = torch.compile(model, mode="reduce-overhead")

    processor = AutoProcessor.from_pretrained(model_path, token=hf_token)

    _cache[model_name] = {
        "model": model,
        "processor": processor,
        "device": device.type,
    }

    print(f"Phoneme ASR ({model_name}) loaded on {device}")
    return model, processor


def move_phoneme_asr_to_gpu(model_name=None):
    """Move cached phoneme ASR model(s) to GPU.

    Args:
        model_name: Move only this model. If None, move all cached models.

    Call this inside @gpu_decorator functions on HF Spaces.
    Idempotent: checks current device before moving.
    Skips if quota exhausted or CUDA unavailable.
    """
    if is_quota_exhausted() or not torch.cuda.is_available():
        return

    names = [model_name] if model_name else list(_cache.keys())
    device = torch.device("cuda")

    for name in names:
        if name not in _cache:
            continue
        entry = _cache[name]
        model = entry["model"]
        if next(model.parameters()).device.type != "cuda":
            entry["model"] = model.to(device, dtype=_TORCH_DTYPE)
            entry["device"] = "cuda"
            print(f"[PHONEME ASR] Moved '{name}' to CUDA")


def move_phoneme_asr_to_cpu(model_name=None):
    """Move cached phoneme ASR model(s) back to CPU.

    Args:
        model_name: Move only this model. If None, move all cached models.

    Called when GPU lease fails or quota is exhausted so that
    CPU fallback inference can proceed.
    Idempotent: checks current device before moving.
    """
    names = [model_name] if model_name else list(_cache.keys())
    device = torch.device("cpu")

    for name in names:
        if name not in _cache:
            continue
        entry = _cache[name]
        model = entry["model"]
        if next(model.parameters()).device.type != "cpu":
            entry["model"] = model.to(device, dtype=_TORCH_DTYPE)
            entry["device"] = "cpu"
            print(f"[PHONEME ASR] Moved '{name}' to CPU")


def ids_to_phoneme_list(ids: List[int], tokenizer, pad_id: int) -> List[str]:
    """
    Convert token IDs to phoneme list with CTC collapse.

    CTC decoding:
    1. Remove pad/blank tokens
    2. Collapse consecutive duplicates
    3. Filter out word delimiter "|"
    """
    # Convert all IDs to tokens first (do not skip any yet)
    toks = tokenizer.convert_ids_to_tokens(ids)

    if not toks:
        return []

    # Get the actual token string for pad
    pad_tok = tokenizer.convert_ids_to_tokens([pad_id])[0] if pad_id is not None else "[PAD]"

    # CTC collapse: remove consecutive duplicates and special tokens
    collapsed: List[str] = []
    prev = None
    for t in toks:
        # Skip pad/blank token
        if t == pad_tok:
            prev = t
            continue
        # Skip word delimiter
        if t == "|":
            prev = t
            continue
        # Skip consecutive duplicates (CTC collapse)
        if t == prev:
            continue
        collapsed.append(t)
        prev = t

    return collapsed


def build_batches_naive(sorted_indices: List[int], batch_size: int) -> List[List[int]]:
    """Fixed-count batching (original behavior)."""
    return [sorted_indices[i:i + batch_size]
            for i in range(0, len(sorted_indices), batch_size)]


def build_batches(sorted_indices: List[int], durations: List[float]) -> List[List[int]]:
    """Build dynamic batches from duration-sorted indices.

    Constraints:
        - sum(durations) per batch <= MAX_BATCH_SECONDS
        - pad waste fraction <= MAX_PAD_WASTE  (1 - sum/[n*max], measures wasted tensor compute)
        - batch won't be cut below MIN_BATCH_SIZE (avoids underutilization)
    """
    batches: List[List[int]] = []
    current: List[int] = []
    current_seconds = 0.0

    for i in sorted_indices:
        dur = durations[i]

        if not current:
            current.append(i)
            current_seconds = dur
            continue

        max_dur = dur                      # candidate is the new longest (sorted ascending)
        new_seconds = current_seconds + dur
        new_size = len(current) + 1
        pad_waste = 1.0 - new_seconds / (new_size * max_dur) if max_dur > 0 else 0.0

        seconds_exceeded = new_seconds > MAX_BATCH_SECONDS
        waste_exceeded = pad_waste > MAX_PAD_WASTE

        if (seconds_exceeded or waste_exceeded) and len(current) >= MIN_BATCH_SIZE:
            batches.append(current)
            current = [i]
            current_seconds = dur
        else:
            current.append(i)
            current_seconds = new_seconds

    if current:
        batches.append(current)

    return batches


def _transcribe_batch_pytorch(
    segment_audios: List[np.ndarray],
    durations: List[float],
    batches: List[List[int]],
    model,
    processor,
    tokenizer,
    pad_id: int,
    device: torch.device,
    dtype: torch.dtype,
) -> tuple:
    """PyTorch inference path (GPU or CPU fallback)."""
    results: List[List[str]] = [[] for _ in segment_audios]
    batch_profiling = []

    for batch_num_idx, batch_idx in enumerate(batches):
        batch_audios = [segment_audios[i] for i in batch_idx]
        batch_durations = [durations[i] for i in batch_idx]

        batch_num = batch_num_idx + 1
        t0 = time.time()

        # Feature extraction + GPU transfer
        t_feat_start = time.time()
        inputs = processor(
            batch_audios,
            sampling_rate=16000,
            return_tensors="pt",
            padding=True,
        )
        input_values = inputs.input_values.to(device=device, dtype=dtype)
        attention_mask = inputs.get("attention_mask")
        if attention_mask is not None:
            attention_mask = attention_mask.to(device=device)
        feat_time = time.time() - t_feat_start

        # Model inference
        t_infer_start = time.time()
        with torch.no_grad():
            outputs = model(input_values, attention_mask=attention_mask)
            logits = outputs.logits
        if device.type == "cuda":
            torch.cuda.synchronize()
        infer_time = time.time() - t_infer_start

        # CTC greedy decode
        t_decode_start = time.time()
        predicted_ids = torch.argmax(logits, dim=-1)

        for j in range(predicted_ids.shape[0]):
            ids_list = predicted_ids[j].cpu().tolist()
            phoneme_list = ids_to_phoneme_list(ids_list, tokenizer, pad_id)
            results[batch_idx[j]] = phoneme_list
        decode_time = time.time() - t_decode_start

        del input_values, attention_mask, outputs, logits, predicted_ids

        batch_time = time.time() - t0

        batch_profiling.append({
            "batch_num": batch_num,
            "size": len(batch_audios),
            "time": batch_time,
            "feat_time": feat_time,
            "infer_time": infer_time,
            "decode_time": decode_time,
            "min_dur": min(batch_durations),
            "max_dur": max(batch_durations),
            "avg_dur": sum(batch_durations) / len(batch_durations),
            "total_seconds": sum(batch_durations),
            "pad_waste": 1.0 - sum(batch_durations) / (len(batch_durations) * max(batch_durations)) if max(batch_durations) > 0 else 0.0,
        })

    return results, batch_profiling


def transcribe_batch(segment_audios: List[np.ndarray], sample_rate: int, model_name: str = PHONEME_ASR_MODEL_DEFAULT) -> tuple:
    """Transcribe audio segments to phoneme lists, sorted by duration for efficiency.

    Args:
        segment_audios: List of audio arrays
        sample_rate: Audio sample rate
        model_name: Which ASR model to use ("base" or "large")

    Returns:
        (results, batch_profiling) where results is List[List[str]] and
        batch_profiling is a list of dicts with per-batch timing and duration stats.
    """
    if not segment_audios:
        return [], [], 0.0, 0.0

    model, processor = load_phoneme_asr(model_name)
    if model is None:
        return [[] for _ in segment_audios], [], 0.0, 0.0

    device = next(model.parameters()).device
    dtype = next(model.parameters()).dtype
    tokenizer = processor.tokenizer
    pad_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else 0

    # Compute durations (audio assumed to be 16kHz — resampled at source)
    durations = [len(audio) / 16000.0 for audio in segment_audios]

    # Sort indices by duration, then build dynamic batches
    t_sort = time.time()
    sorted_indices = sorted(range(len(segment_audios)), key=lambda i: durations[i])
    sorting_time = time.time() - t_sort

    t_batch_build = time.time()
    if BATCHING_STRATEGY == "dynamic":
        batches = build_batches(sorted_indices, durations)
    else:
        batches = build_batches_naive(sorted_indices, INFERENCE_BATCH_SIZE)
    batch_build_time = time.time() - t_batch_build

    backend = "PyTorch" + (f" ({device.type})" if device.type != "cpu" else " (CPU)")
    print(f"[PHONEME ASR] Using {backend}")
    results, batch_profiling = _transcribe_batch_pytorch(
        segment_audios, durations, batches,
        model, processor, tokenizer, pad_id, device, dtype,
    )

    sizes = [p["size"] for p in batch_profiling]
    print(f"[PHONEME ASR] {len(segment_audios)} segments in {len(batch_profiling)} batches "
          f"(sizes: {min(sizes)}-{max(sizes)}, sort: {sorting_time:.3f}s, batch build: {batch_build_time:.3f}s)")
    return results, batch_profiling, sorting_time, batch_build_time
