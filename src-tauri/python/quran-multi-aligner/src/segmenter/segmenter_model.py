"""Model lifecycle and device management for the VAD segmenter."""

import torch

from config import SEGMENTER_MODEL, DTYPE, IS_HF_SPACE, TORCH_COMPILE
from ..core.zero_gpu import ZERO_GPU_AVAILABLE, is_user_forced_cpu, model_device_lock


# =============================================================================
# Model caches
# =============================================================================

_segmenter_cache = {"model": None, "processor": None, "loaded": False, "load_time": 0.0, "device": None}
_env_logged = False


def _log_env_once():
    """Log library and GPU versions once for debugging HF Space mismatches."""
    global _env_logged
    if _env_logged:
        return
    _env_logged = True
    try:
        import importlib.metadata as _im

        def _ver(pkg: str) -> str:
            try:
                return _im.version(pkg)
            except Exception:
                return "unknown"

        cudnn_ver = torch.version.cudnn or "none"
        print(f"[ENV] torch={torch.__version__} cuda={torch.version.cuda} cudnn={cudnn_ver}")
        print(f"[ENV] transformers={_ver('transformers')} recitations_segmenter={_ver('recitations_segmenter')}")
        # On ZeroGPU, don't query GPU name — it triggers CUDA init outside lease
        if not ZERO_GPU_AVAILABLE and torch.cuda.is_available():
            print(f"[ENV] GPU={torch.cuda.get_device_name(0)}")
    except Exception as e:
        print(f"[ENV] Failed to log env: {e}")


_TORCH_DTYPE = torch.float16 if DTYPE == "float16" else torch.float32


def _get_device_and_dtype():
    """Get the best available device and dtype."""
    if IS_HF_SPACE or ZERO_GPU_AVAILABLE:
        return torch.device("cpu"), _TORCH_DTYPE
    if torch.cuda.is_available():
        return torch.device("cuda"), _TORCH_DTYPE
    return torch.device("cpu"), _TORCH_DTYPE


def ensure_models_on_gpu(asr_model_name=None):
    """
    Move models to GPU. Call this INSIDE a GPU-decorated function
    after ZeroGPU lease is acquired.

    Args:
        asr_model_name: If provided, move only this ASR model to GPU.
            If None, skip ASR model movement (e.g. during VAD-only lease).

    Skips if quota exhausted or CUDA unavailable.
    Idempotent: checks current device before moving.

    Returns:
        float: Time in seconds spent moving models to GPU.
    """
    import time
    from ..alignment.phoneme_asr import move_phoneme_asr_to_gpu

    if is_user_forced_cpu() or not torch.cuda.is_available():
        return 0.0

    device = torch.device("cuda")
    dtype = _TORCH_DTYPE
    move_start = time.time()

    with model_device_lock:
        try:
            # Move segmenter to GPU
            if _segmenter_cache["loaded"] and _segmenter_cache["model"] is not None:
                model = _segmenter_cache["model"]
                if next(model.parameters()).device.type != "cuda":
                    print("[GPU] Moving segmenter to CUDA...")
                    model.to(device, dtype=dtype)
                    _segmenter_cache["model"] = model
                    _segmenter_cache["device"] = "cuda"
                    print("[GPU] Segmenter on CUDA")

            # Move phoneme ASR to GPU (only the requested model)
            if asr_model_name is not None:
                move_phoneme_asr_to_gpu(asr_model_name)
        except RuntimeError as e:
            # Prevent CUDA init outside GPU context from poisoning the process
            print(f"[GPU] CUDA move failed, staying on CPU: {e}")
            return 0.0

    return time.time() - move_start


def invalidate_segmenter_cache():
    """Drop cached segmenter model so the next load_segmenter() creates a fresh one.

    Called from _drain_stale_models() inside a GPU lease. No CUDA ops —
    just sets references to None and lets GC reclaim tensors.
    """
    if _segmenter_cache["model"] is not None:
        _segmenter_cache["model"] = None
        _segmenter_cache["processor"] = None
        _segmenter_cache["loaded"] = False
        _segmenter_cache["device"] = None
        from .segmenter_aoti import _aoti_cache
        _aoti_cache["applied"] = False
        _aoti_cache["compiled"] = None
        _aoti_cache["exported"] = None
        _aoti_cache["tested"] = False
        print("[SEGMENTER] Cache invalidated")


def load_segmenter():
    """Load the VAD segmenter model on CPU. Returns (model, processor, load_time).

    Models are loaded once and cached. Use ensure_models_on_gpu()
    inside GPU-decorated functions to move to CUDA.
    Thread-safe: uses model_device_lock with double-checked locking.
    """
    if _segmenter_cache["loaded"]:
        return _segmenter_cache["model"], _segmenter_cache["processor"], 0.0

    with model_device_lock:
        # Re-check after acquiring lock — another thread may have loaded it
        if _segmenter_cache["loaded"]:
            return _segmenter_cache["model"], _segmenter_cache["processor"], 0.0

        import time
        start_time = time.time()

        try:
            from transformers import AutoModelForAudioFrameClassification, AutoFeatureExtractor

            print(f"Loading segmenter: {SEGMENTER_MODEL}")
            device, dtype = _get_device_and_dtype()

            model = AutoModelForAudioFrameClassification.from_pretrained(SEGMENTER_MODEL)
            model.to(device, dtype=dtype)
            model.eval()
            if TORCH_COMPILE and not (IS_HF_SPACE or ZERO_GPU_AVAILABLE):
                model = torch.compile(model, mode="reduce-overhead")

            processor = AutoFeatureExtractor.from_pretrained(SEGMENTER_MODEL)

            load_time = time.time() - start_time
            _segmenter_cache["model"] = model
            _segmenter_cache["processor"] = processor
            _segmenter_cache["loaded"] = True
            _segmenter_cache["load_time"] = load_time
            _segmenter_cache["device"] = device.type

            print(f"Segmenter loaded on {device} in {load_time:.2f}s")
            return model, processor, load_time

        except Exception as e:
            print(f"Failed to load segmenter: {e}")
            return None, None, 0.0
