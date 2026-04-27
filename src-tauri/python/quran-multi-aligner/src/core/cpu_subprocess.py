"""Subprocess-isolated CPU inference to prevent CUDA state poisoning.

On HuggingFace Spaces with ZeroGPU, the main Gradio process has PyTorch
monkey-patched (TorchFunctionMode, fake CUDA availability). Running torch
operations in the main process can trigger C-level CUDA runtime queries
that partially initialize CUDA state. Since ZeroGPU uses fork() for GPU
workers, this corrupted state is inherited by ALL future workers, causing
permanent "No CUDA GPUs are available" errors.

Solution: run CPU inference in a spawn-context subprocess. spawn creates
a clean Python interpreter without inherited CUDA state or ZeroGPU patches.
"""

import importlib
import multiprocessing
import os
import queue as queue_mod
import sys
import time
import traceback


def _cpu_worker(func_module, func_name, extra_paths, args, kwargs, result_queue):
    """Worker function for CPU subprocess. Runs in a clean process.

    Disables ZeroGPU and CUDA so the function runs in a plain CPU PyTorch
    environment with no monkey patches.
    """
    # Add parent's sys.path entries so we can find src/, config, etc.
    for p in extra_paths:
        if p and p not in sys.path:
            sys.path.insert(0, p)

    # Disable ZeroGPU — prevents spaces package from patching torch
    os.environ["SPACES_ZERO_GPU"] = ""
    # Disable CUDA — guarantees CPU-only execution.
    # NOTE: an EMPTY string does NOT hide the GPU on modern CUDA runtimes —
    # it is treated as "unset" and all devices remain visible. The supported
    # sentinels for "no devices" are "-1" or any non-numeric token. We use
    # "-1" (NVIDIA's documented way). Without this, the spawned process picks
    # up the parent's GPU even though it has no ZeroGPU lease, then deadlocks
    # the first time it tries an actual CUDA op (e.g. `model.to("cuda")`
    # succeeds, then `model(input_values, ...)` hangs forever).
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

    try:
        # Force CPU inside the subprocess at the torch level. The env vars
        # above are best-effort (`SPACES_ZERO_GPU=""` prevents the spaces
        # package from re-patching torch, `CUDA_VISIBLE_DEVICES=-1` is meant
        # to hide the GPU) but in practice torch.cuda can still report
        # `is_available() == True` in the spawned interpreter — either
        # because a parent process imported torch before the env var was
        # set, or because CUDA's device enumeration ignores the hider in
        # some runtime configurations. When that happens
        # `ensure_models_on_gpu()` moves the model to CUDA INSIDE the
        # subprocess (which has no ZeroGPU lease) and the first actual
        # inference call hangs forever waiting on a GPU it doesn't own.
        #
        # The app already has an official "force CPU" switch that makes the
        # GPU-aware helpers bail out (`is_user_forced_cpu()` — checked in
        # `ensure_models_on_gpu`, `move_phoneme_asr_to_gpu`, and
        # `transcribe_batch`). Flip it on here so the subprocess runs the
        # exact same CPU path the UI's "device=CPU" selection would.
        try:
            from src.core.zero_gpu import force_cpu_mode
            force_cpu_mode()
        except Exception as _e:
            print(f"[CPU SUBPROCESS] Could not call force_cpu_mode(): {_e}")

        module = importlib.import_module(func_module)
        func = getattr(module, func_name)
        # Unwrap @gpu_with_fallback decorator to call the raw function.
        # functools.wraps sets __wrapped__ on each wrapper layer.
        while hasattr(func, "__wrapped__"):
            func = func.__wrapped__
        result = func(*args, **kwargs)
        result_queue.put(("ok", result))
    except Exception as e:
        tb = traceback.format_exc()
        result_queue.put(("error", (type(e).__name__, str(e), tb)))


def run_in_cpu_subprocess(func, args, kwargs, timeout=None):
    """Run a function in an isolated CPU subprocess.

    Uses 'spawn' context to create a clean Python interpreter that does
    not inherit the main process's CUDA state or ZeroGPU monkey patches.

    All args, kwargs, and return values must be picklable (numpy arrays,
    lists, dicts, strings, numbers — no torch tensors or Gradio objects).

    Args:
        func: The function to call. Must be importable by module + name.
        args: Positional arguments tuple.
        kwargs: Keyword arguments dict.
        timeout: Max seconds to wait (default: config.CPU_SUBPROCESS_TIMEOUT).

    Returns:
        The function's return value.

    Raises:
        TimeoutError: If subprocess exceeds timeout.
        RuntimeError: If subprocess fails or exits without result.
    """
    if timeout is None:
        from config import CPU_SUBPROCESS_TIMEOUT
        timeout = CPU_SUBPROCESS_TIMEOUT

    ctx = multiprocessing.get_context("spawn")
    result_queue = ctx.Queue()

    func_module = func.__module__
    func_name = func.__qualname__
    # Pass sys.path so the subprocess can find all modules (app dir, etc.)
    extra_paths = list(sys.path)

    print(f"[CPU SUBPROCESS] Spawning for {func_module}.{func_name}")

    p = ctx.Process(
        target=_cpu_worker,
        args=(func_module, func_name, extra_paths, args, kwargs, result_queue),
        daemon=True,
    )
    p.start()

    # IMPORTANT: read the queue BEFORE joining, not after.
    # multiprocessing.Queue is backed by an OS pipe with a small buffer
    # (~64 KB on Linux). When the return value is larger than the buffer
    # `queue.put()` in the child blocks on write waiting for the parent to
    # read. If the parent is sitting in `p.join()` it never reads, and
    # because `p.join()` waits for the child to exit we get a textbook
    # deadlock: child stuck in `_feed` thread flushing to the pipe, parent
    # stuck waiting for child. That is exactly the symptom we saw on the
    # 22 minute m4a — the subprocess printed "[PHONEME ASR] 151 segments
    # in 4 batches" (last log from the inference step) and then never
    # completed. The pickled tuple (intervals + 151 phoneme lists +
    # batch_profiling + raw_speech_intervals numpy array + etc.) just
    # happens to exceed the pipe buffer for this file.
    #
    # Use `result_queue.get(timeout=...)` to drain the pipe as the child
    # writes, then join. This is the canonical multiprocessing pattern.
    t0 = time.time()
    status = None
    payload = None
    try:
        status, payload = result_queue.get(timeout=timeout)
    except queue_mod.Empty:
        # Nothing was queued within the timeout — the child is still alive
        # and genuinely stuck. Kill it and surface a timeout.
        if p.is_alive():
            p.kill()
            p.join(timeout=5)
        raise TimeoutError(f"CPU subprocess timed out after {timeout}s")

    # Once we have the payload the child should be about to exit. Give it
    # a short grace period, then force-kill if it lingers (e.g. a hung
    # atexit / cleanup handler shouldn't block the caller).
    remaining = max(5.0, timeout - (time.time() - t0))
    p.join(timeout=min(remaining, 30.0))
    if p.is_alive():
        p.kill()
        p.join(timeout=5)

    if status == "ok":
        print(f"[CPU SUBPROCESS] {func_name} completed successfully")
        return payload

    exc_type, exc_msg, exc_tb = payload
    print(f"[CPU SUBPROCESS] Error traceback:\n{exc_tb}")
    raise RuntimeError(f"CPU subprocess error ({exc_type}): {exc_msg}")
