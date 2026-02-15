"""Model lifecycle and device management for the VAD segmenter."""

import torch

from config import SEGMENTER_MODEL, DTYPE, IS_HF_SPACE, TORCH_COMPILE
from ..core.zero_gpu import ZERO_GPU_AVAILABLE, is_quota_exhausted, is_user_forced_cpu


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

        print(f"[ENV] torch={torch.__version__} cuda={torch.version.cuda} cudnn={torch.backends.cudnn.version() if torch.backends.cudnn.is_available() else 'none'}")
        print(f"[ENV] transformers={_ver('transformers')} recitations_segmenter={_ver('recitations_segmenter')}")
        if torch.cuda.is_available():
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

    if is_user_forced_cpu() or is_quota_exhausted() or not torch.cuda.is_available():
        return 0.0

    device = torch.device("cuda")
    dtype = _TORCH_DTYPE
    move_start = time.time()

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

    return time.time() - move_start


def ensure_models_on_cpu():
    """
    Move all models back to CPU. Called when GPU lease fails or quota
    is exhausted so that CPU fallback inference can proceed.

    Idempotent: checks current device before moving.
    """
    from ..alignment.phoneme_asr import move_phoneme_asr_to_cpu

    device = torch.device("cpu")
    dtype = _TORCH_DTYPE

    # Move segmenter to CPU
    if _segmenter_cache["loaded"] and _segmenter_cache["model"] is not None:
        model = _segmenter_cache["model"]
        if next(model.parameters()).device.type != "cpu":
            print("[CPU] Moving segmenter to CPU...")
            model.to(device, dtype=dtype)
            _segmenter_cache["model"] = model
            _segmenter_cache["device"] = "cpu"
            print("[CPU] Segmenter on CPU")

    # Move phoneme ASR to CPU
    move_phoneme_asr_to_cpu()


def load_segmenter():
    """Load the VAD segmenter model on CPU. Returns (model, processor, load_time).

    Models are loaded once and cached. Use ensure_models_on_gpu()
    inside GPU-decorated functions to move to CUDA.
    """
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
