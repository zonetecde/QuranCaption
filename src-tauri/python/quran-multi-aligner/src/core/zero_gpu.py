"""
Utilities for integrating Hugging Face Spaces ZeroGPU without breaking
local or non-ZeroGPU environments.
"""

import re
from typing import Callable, TypeVar
from functools import wraps

T = TypeVar("T", bound=Callable)

# Default values in case the spaces package is unavailable (e.g., local runs).
ZERO_GPU_AVAILABLE = False

# Track whether we've fallen back to CPU due to quota exhaustion
_gpu_quota_exhausted = False
_quota_reset_time = None  # e.g. "13:53:59"
_user_forced_cpu = False

try:
    import spaces  # type: ignore

    gpu_decorator = spaces.GPU  # pragma: no cover
    ZERO_GPU_AVAILABLE = True
except Exception:
    def gpu_decorator(*decorator_args, **decorator_kwargs):
        """
        No-op replacement for spaces.GPU so code can run without the package
        or outside of a ZeroGPU Space.
        """

        def wrapper(func: T) -> T:
            return func

        # Support both bare @gpu_decorator and @gpu_decorator(...)
        if decorator_args and callable(decorator_args[0]) and not decorator_kwargs:
            return decorator_args[0]
        return wrapper


def is_quota_exhausted() -> bool:
    """Check if GPU quota has been exhausted this session."""
    return _gpu_quota_exhausted


def is_user_forced_cpu() -> bool:
    """Check if the user manually selected CPU mode."""
    return _user_forced_cpu


def get_quota_reset_time() -> str | None:
    """Return the quota reset time string (e.g. '13:53:59'), or None."""
    return _quota_reset_time


def reset_quota_flag():
    """Reset the quota exhausted flag (e.g., after quota resets)."""
    global _gpu_quota_exhausted, _quota_reset_time, _user_forced_cpu
    _gpu_quota_exhausted = False
    _quota_reset_time = None
    _user_forced_cpu = False


def force_cpu_mode():
    """Force all GPU-decorated functions to skip GPU and run on CPU."""
    global _user_forced_cpu
    _user_forced_cpu = True
    _move_models_to_cpu()


def _move_models_to_cpu():
    """Move all models back to CPU for fallback inference."""
    try:
        from ..segmenter.segmenter_model import ensure_models_on_cpu
        ensure_models_on_cpu()
    except Exception as e:
        print(f"[CPU] Failed to move models to CPU: {e}")


def gpu_with_fallback(duration=60):
    """
    Decorator that wraps a GPU function with automatic CPU fallback.

    If ZeroGPU quota is exceeded, the function runs on CPU instead.
    The decorated function should call ensure_models_on_gpu() internally,
    which checks is_quota_exhausted() to decide whether to move to CUDA.

    Usage:
        @gpu_with_fallback(duration=60)
        def my_gpu_func(data):
            ensure_models_on_gpu()  # Moves to CUDA if quota not exhausted
            # ... inference using model's current device ...
    """
    def decorator(func: T) -> T:
        # Create the GPU-wrapped version
        if ZERO_GPU_AVAILABLE:
            gpu_func = gpu_decorator(duration=duration)(func)
        else:
            gpu_func = func

        @wraps(func)
        def wrapper(*args, **kwargs):
            global _gpu_quota_exhausted, _quota_reset_time

            # If user explicitly chose CPU mode, skip GPU entirely
            if _user_forced_cpu:
                print("[CPU] User selected CPU mode")
                return func(*args, **kwargs)

            # If quota already exhausted, go straight to CPU
            if _gpu_quota_exhausted:
                print("[GPU] Quota exhausted, using CPU fallback")
                _move_models_to_cpu()
                return func(*args, **kwargs)

            # Try GPU first
            try:
                return gpu_func(*args, **kwargs)
            except Exception as e:
                # ZeroGPU raises gradio.Error with title="ZeroGPU quota exceeded"
                is_quota_error = getattr(e, 'title', '') == "ZeroGPU quota exceeded"
                if not is_quota_error:
                    is_quota_error = 'quota' in str(e).lower()

                if is_quota_error:
                    print(f"[GPU] Quota exceeded, falling back to CPU: {e}")
                    _gpu_quota_exhausted = True
                    # Parse reset time from message like "Try again in 13:53:59"
                    match = re.search(r'Try again in (\d+:\d{2}:\d{2})', str(e))
                    if match:
                        _quota_reset_time = match.group(1)
                    # Show immediate toast notification
                    try:
                        import gradio as gr
                        reset_msg = f" Resets in {_quota_reset_time}." if _quota_reset_time else ""
                        gr.Warning(f"GPU quota reached — switching to CPU (slower).{reset_msg}")
                    except Exception:
                        pass  # Not in a Gradio context (e.g., CLI usage)
                    _move_models_to_cpu()
                    return func(*args, **kwargs)
                else:
                    err_lower = str(e).lower()
                    is_timeout = (
                        'timeout' in err_lower
                        or 'duration' in err_lower
                        or 'time limit' in err_lower
                    )
                    if is_timeout:
                        print(f"[GPU] Timeout error in {func.__name__}: {e}")
                    raise

        return wrapper
    return decorator
