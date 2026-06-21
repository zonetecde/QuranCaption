"""
Utilities for integrating Hugging Face Spaces ZeroGPU without breaking
local or non-ZeroGPU environments.
"""

import os
import re
import threading
from typing import Callable, TypeVar
from functools import wraps

T = TypeVar("T", bound=Callable)

# Default values in case the spaces package is unavailable (e.g., local runs).
ZERO_GPU_AVAILABLE = False

# WORKER_MODE=cpu marks this process as a pooled CPU worker (see worker_pool.py).
# Workers always run decorated functions directly on CPU — no GPU allocation,
# no subprocess isolation, no further worker-pool dispatch.
WORKER_MODE = os.environ.get("WORKER_MODE", "").lower()
IS_CPU_WORKER = WORKER_MODE == "cpu"


class QuotaExhaustedError(Exception):
    """Raised when ZeroGPU quota is exhausted. Caller should retry with device='CPU'."""
    def __init__(self, message, reset_time=None):
        super().__init__(message)
        self.reset_time = reset_time

# Per-thread (per-request) GPU state so concurrent requests don't interfere
_request_state = threading.local()

# ---------------------------------------------------------------------------
# Shared RLock for model device transitions AND inference.
# RLock because ensure_models_on_gpu() -> move_phoneme_asr_to_gpu() is a
# nested call chain where both acquire the lock.
# Now also held for the ENTIRE GPU lease (inference + cleanup) to prevent
# concurrent threads from moving models mid-inference.
# ---------------------------------------------------------------------------
model_device_lock = threading.RLock()

# ---------------------------------------------------------------------------
# CPU subprocess concurrency gate — limits how many local subprocesses may be
# running at once. Lazily initialized from config when first used to avoid
# importing config at module load.
# ---------------------------------------------------------------------------
_subprocess_semaphore = None
_subprocess_semaphore_lock = threading.Lock()


def _get_subprocess_semaphore():
    global _subprocess_semaphore
    if _subprocess_semaphore is None:
        with _subprocess_semaphore_lock:
            if _subprocess_semaphore is None:
                from config import CPU_SUBPROCESS_CONCURRENCY
                from .cpu_sem import CountedBoundedSemaphore
                _subprocess_semaphore = CountedBoundedSemaphore(
                    max(1, CPU_SUBPROCESS_CONCURRENCY)
                )
    return _subprocess_semaphore


# ---------------------------------------------------------------------------
# Thread-local CPU dispatch stats — populated on every subprocess dispatch
# (local-subprocess path only; worker-pool path has its own _DISPATCH_TLS in
# worker_pool.py). Read by pipeline.py at log-row build time.
# ---------------------------------------------------------------------------
_CPU_STATS_TLS = threading.local()


def get_cpu_stats() -> dict | None:
    """Return this thread's last CPU subprocess dispatch stats, or None."""
    return getattr(_CPU_STATS_TLS, "info", None)


def clear_cpu_stats() -> None:
    """Drop any stashed CPU dispatch stats on this thread. Call at request entry."""
    if hasattr(_CPU_STATS_TLS, "info"):
        del _CPU_STATS_TLS.info

# ---------------------------------------------------------------------------
# GPU lease tracking — lets code know if ANY thread currently holds a lease.
# ---------------------------------------------------------------------------
_lease_lock = threading.Lock()
_active_gpu_leases = 0
_models_stale = False  # Set True at lease end; drained at next lease start


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


# =========================================================================
# GPU lease tracking
# =========================================================================

def _enter_gpu_lease():
    """Mark that a GPU lease is now active in this process."""
    global _active_gpu_leases
    with _lease_lock:
        _active_gpu_leases += 1


def _exit_gpu_lease():
    """Mark that a GPU lease has ended in this process."""
    global _active_gpu_leases
    with _lease_lock:
        _active_gpu_leases = max(0, _active_gpu_leases - 1)


# =========================================================================
# Per-thread state helpers
# =========================================================================

def is_quota_exhausted() -> bool:
    """Check if GPU quota has been exhausted for this request's thread."""
    return getattr(_request_state, 'gpu_quota_exhausted', False)


def is_user_forced_cpu() -> bool:
    """Check if the user manually selected CPU mode for this request."""
    return getattr(_request_state, 'user_forced_cpu', False)


def get_quota_reset_time() -> str | None:
    """Return the quota reset time string (e.g. '13:53:59'), or None."""
    return getattr(_request_state, 'quota_reset_time', None)


def reset_quota_flag():
    """Reset the quota exhausted flag for this request's thread."""
    _request_state.gpu_quota_exhausted = False
    _request_state.quota_reset_time = None
    _request_state.user_forced_cpu = False


def force_cpu_mode():
    """Force GPU-decorated functions to skip GPU and run on CPU for this request.

    Only sets the per-thread flag — does NOT move models. Moving models
    requires CUDA access (to copy from GPU to CPU) which is not safe outside
    a GPU lease and would poison the process.
    """
    _request_state.user_forced_cpu = True


# =========================================================================
# Model cleanup helpers
# =========================================================================

def _check_cuda_fork_state(label: str):
    """Log whether the current process is in a bad-fork CUDA state."""
    try:
        import torch
        bad_fork = torch.cuda._is_in_bad_fork()
        print(f"[CUDA DIAG] {label}: _is_in_bad_fork={bad_fork}")
    except Exception as e:
        print(f"[CUDA DIAG] {label}: check failed: {e}")


def _cleanup_after_gpu():
    """Cleanup that runs at the END of a GPU lease.

    Does NOT perform any CUDA operations (no model.to("cpu"), no
    torch.cuda.empty_cache()). Instead, sets a stale flag so the NEXT
    GPU lease drains old models safely inside a fresh lease context.

    Why: model.to("cpu") at the lease boundary is a CUDA op that can fail
    if the SDK is revoking the GPU, poisoning torch's CUDA runtime state.
    """
    global _models_stale
    with _lease_lock:
        _models_stale = True


def _drain_stale_models():
    """Invalidate stale model caches from a previous GPU lease.

    Must be called INSIDE a GPU lease (after _enter_gpu_lease()) where
    CUDA is safe. Drops cached models so they get reloaded fresh on the
    correct device. gc.collect() triggers CUDA tensor destructors safely
    inside the lease.
    """
    global _models_stale
    with _lease_lock:
        if not _models_stale:
            return
        _models_stale = False
    from ..segmenter.segmenter_model import invalidate_segmenter_cache
    from ..alignment.phoneme_asr import invalidate_asr_cache
    invalidate_segmenter_cache()
    invalidate_asr_cache()
    import gc
    gc.collect()  # CUDA tensor destructors run safely inside lease
    print("[GPU CLEANUP] Drained stale models from previous lease")


# =========================================================================
# GPU decorator with fallback
# =========================================================================

def gpu_with_fallback(duration=60):
    """
    Decorator that wraps a GPU function with quota error detection.

    If ZeroGPU quota is exceeded, raises QuotaExhaustedError so the
    caller (UI handler or API endpoint) can retry the entire pipeline
    with device='CPU'. This avoids running any torch code after a
    failed GPU lease, which would poison CUDA state for the process.

    The model_device_lock is held for the ENTIRE GPU lease (inference +
    cleanup) to prevent concurrent threads from moving models mid-inference.

    Error handling strategy:
    - Quota exhaustion → raise QuotaExhaustedError (caller retries with CPU)
    - Timeout → propagate to caller
    - ZeroGPU worker/CUDA errors → propagate immediately
    - Unknown non-timeout errors → propagate (avoid hiding real bugs)

    Usage:
        @gpu_with_fallback(duration=60)
        def my_gpu_func(data):
            ensure_models_on_gpu()  # Moves to CUDA
            # ... inference using model's current device ...
    """
    def decorator(func: T) -> T:
        # Inner wrapper: runs INSIDE the @spaces.GPU lease.
        # Holds model_device_lock for the full inference + cleanup cycle
        # to prevent concurrent threads from moving models mid-inference.
        @wraps(func)
        def func_with_cleanup(*args, **kwargs):
            _check_cuda_fork_state(f"GPU worker entry ({func.__name__})")
            _enter_gpu_lease()
            with model_device_lock:
                try:
                    _drain_stale_models()
                    return func(*args, **kwargs)
                finally:
                    try:
                        _cleanup_after_gpu()
                    except Exception as e:
                        print(f"[GPU CLEANUP] Error: {e}")
                    _exit_gpu_lease()

        # Create the GPU-wrapped version.
        # Always use func_with_cleanup (which holds the lock, tracks leases,
        # and runs cleanup) — even without ZeroGPU, local CUDA environments
        # need the same protections.
        if ZERO_GPU_AVAILABLE:
            gpu_func = gpu_decorator(duration=duration)(func_with_cleanup)
        else:
            gpu_func = func_with_cleanup

        @wraps(func)
        def wrapper(*args, **kwargs):
            global _models_stale
            # CPU worker Spaces run the decorated function directly on CPU.
            # No GPU allocation, no subprocess isolation, no onward worker dispatch.
            if IS_CPU_WORKER:
                return func(*args, **kwargs)

            # If user explicitly chose CPU mode, route based on CPU_STRATEGY.
            # On local dev (no ZeroGPU), strategy is a no-op — running torch in
            # the main process is fine because there's no GPU lease state to poison.
            if is_user_forced_cpu():
                if not ZERO_GPU_AVAILABLE:
                    print("[CPU] User selected CPU mode (local dev)")
                    return func(*args, **kwargs)

                from config import CPU_STRATEGY

                if CPU_STRATEGY == "subprocess":
                    import time as _time
                    from config import CPU_WORKER_MODE, CPU_DTYPE
                    sem = _get_subprocess_semaphore()
                    _wait, _peers_at_acquire = sem.acquire_with_stats()
                    _compute_start = _time.time()
                    try:
                        _check_cuda_fork_state(f"before CPU subprocess ({func.__name__})")
                        if CPU_WORKER_MODE == "persistent":
                            from .cpu_worker_pool import run_on_persistent_worker, is_started, start_pool
                            if not is_started():
                                # Lazy start fallback — slow first request.
                                from config import CPU_SUBPROCESS_CONCURRENCY, CPU_POOL_PRELOAD_LARGE
                                print("[CPU] Pool not started — lazy-starting now")
                                start_pool(CPU_SUBPROCESS_CONCURRENCY, preload_large=CPU_POOL_PRELOAD_LARGE)
                            print(
                                f"[CPU] Running {func.__name__} on persistent worker "
                                f"(CPU_WORKER_MODE=persistent, queue_wait={_wait:.2f}s, peers_at_acquire={_peers_at_acquire})"
                            )
                            _spawn_s = 0.0  # persistent pool: no spawn cost per request
                            result = run_on_persistent_worker(func, args, kwargs)
                        else:
                            print(
                                f"[CPU] Running {func.__name__} in isolated subprocess "
                                f"(CPU_STRATEGY=subprocess, queue_wait={_wait:.2f}s, peers_at_acquire={_peers_at_acquire})"
                            )
                            from .cpu_subprocess import run_in_cpu_subprocess
                            _t_spawn = _time.time()
                            result = run_in_cpu_subprocess(func, args, kwargs)
                            _spawn_s = _time.time() - _t_spawn  # best-effort: total subprocess wall
                        _check_cuda_fork_state(f"after CPU subprocess ({func.__name__})")
                        return result
                    finally:
                        _compute_s = _time.time() - _compute_start
                        _peers_at_release = sem.release_with_stats()
                        _CPU_STATS_TLS.info = {
                            "strategy": "subprocess",
                            "worker_mode": CPU_WORKER_MODE,
                            "dtype": CPU_DTYPE,
                            "concurrency_cap": sem.capacity,
                            "queue_wait_s": round(_wait, 3),
                            "compute_s": round(_compute_s, 3),
                            "peers_at_acquire": _peers_at_acquire,
                            "peers_at_release": _peers_at_release,
                            "subprocess_spawn_s": round(_spawn_s, 3) if CPU_WORKER_MODE != "persistent" else 0.0,
                        }

                if CPU_STRATEGY == "workers":
                    from .worker_pool import has_workers, run_on_worker_cpu
                    if not has_workers():
                        raise RuntimeError(
                            "CPU_STRATEGY=workers but no worker pool is configured. "
                            "Set WORKER_SPACES to a comma-separated list of CPU worker "
                            "Space slugs, or switch CPU_STRATEGY to 'subprocess'."
                        )
                    print(f"[CPU] Dispatching {func.__name__} to worker pool (CPU_STRATEGY=workers)")
                    # Let PoolQueueFullError / PoolExhaustedError propagate raw —
                    # both the API and UI layers catch them explicitly and produce
                    # their own structured responses.
                    return run_on_worker_cpu(func, args, kwargs)

                if CPU_STRATEGY == "both":
                    raise NotImplementedError(
                        "CPU_STRATEGY=both is reserved for future hybrid orchestration "
                        "(local subprocess primary + remote worker overflow). Use "
                        "'subprocess' or 'workers' for now."
                    )

                raise RuntimeError(
                    f"Unknown CPU_STRATEGY={CPU_STRATEGY!r}. Valid: 'subprocess', 'workers', 'both'."
                )

            # Try GPU
            try:
                return gpu_func(*args, **kwargs)
            except Exception as e:
                err_str = str(e)
                err_lower = err_str.lower()
                err_title = getattr(e, "title", "")

                # Quota exhaustion → CPU fallback (per-user, not process issue)
                is_quota_error = err_title == "ZeroGPU quota exceeded"
                if not is_quota_error:
                    is_quota_error = 'quota' in err_lower and ('exceeded' in err_lower or 'exhausted' in err_lower)

                if is_quota_error:
                    # spaces.zero wraps the quota message in an HTMLString: str(e)
                    # returns the plain-text fallback (daily-quota prompt, no timer),
                    # but the underlying .message holds the HTML that INCLUDES
                    # "Try again in {timedelta}". Regex against the raw message.
                    # "0:00:00" means daily cap (no short-term rate limit) — UI
                    # layer translates that to a "resets at midnight UTC" hint.
                    haystack = getattr(e, "message", None) or err_str
                    print(f"[GPU] Quota exceeded: {e}")
                    # timedelta.__str__ produces "H:MM:SS" or "D day(s), H:MM:SS".
                    match = re.search(
                        r'Try again in ((?:\d+\s*days?,\s*)?\d+:\d{2}:\d{2})',
                        haystack,
                    )
                    reset_time = match.group(1) if match else None
                    raise QuotaExhaustedError(str(e), reset_time=reset_time) from e

                # Timeout → propagate to caller
                is_timeout = (
                    'timeout' in err_lower
                    or 'duration' in err_lower
                    or 'time limit' in err_lower
                )
                if is_timeout:
                    print(f"[GPU] Timeout error in {func.__name__}: {e}")
                    raise

                # Worker/runtime init errors — propagate immediately.
                is_worker_error = (
                    err_title == "ZeroGPU worker error"
                    or "no cuda gpus are available" in err_lower
                    or "gpu task aborted" in err_lower
                )
                if is_worker_error:
                    print(f"[GPU] Worker error in {func.__name__}: {e}")
                    raise

                # CUDA runtime errors (non-timeout, non-quota): mark stale and propagate.
                is_cuda_runtime_error = (
                    "cuda" in err_lower
                    or "cudnn" in err_lower
                    or "nvidia" in err_lower
                    or err_title == "CUDA error"
                )
                if is_cuda_runtime_error:
                    print(f"[GPU] CUDA error in {func.__name__}: {e}")
                    with _lease_lock:
                        _models_stale = True
                    raise

                # Unknown non-timeout errors should propagate so genuine bugs
                # are not silently hidden behind CPU fallback.
                print(f"[GPU] Non-recoverable error in {func.__name__}: {type(e).__name__}: {e}")
                raise

        return wrapper
    return decorator
