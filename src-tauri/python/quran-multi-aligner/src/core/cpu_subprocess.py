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
import sys
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
    # Disable CUDA — guarantees CPU-only execution
    os.environ["CUDA_VISIBLE_DEVICES"] = ""

    try:
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


def run_in_cpu_subprocess(func, args, kwargs, timeout=600):
    """Run a function in an isolated CPU subprocess.

    Uses 'spawn' context to create a clean Python interpreter that does
    not inherit the main process's CUDA state or ZeroGPU monkey patches.

    All args, kwargs, and return values must be picklable (numpy arrays,
    lists, dicts, strings, numbers — no torch tensors or Gradio objects).

    Args:
        func: The function to call. Must be importable by module + name.
        args: Positional arguments tuple.
        kwargs: Keyword arguments dict.
        timeout: Max seconds to wait (default 600 = 10 min).

    Returns:
        The function's return value.

    Raises:
        TimeoutError: If subprocess exceeds timeout.
        RuntimeError: If subprocess fails or exits without result.
    """
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
    p.join(timeout=timeout)

    if p.is_alive():
        p.kill()
        p.join(timeout=5)
        raise TimeoutError(f"CPU subprocess timed out after {timeout}s")

    if result_queue.empty():
        raise RuntimeError(
            f"CPU subprocess exited without result (exit code {p.exitcode})"
        )

    status, payload = result_queue.get_nowait()
    if status == "ok":
        print(f"[CPU SUBPROCESS] {func_name} completed successfully")
        return payload

    exc_type, exc_msg, exc_tb = payload
    print(f"[CPU SUBPROCESS] Error traceback:\n{exc_tb}")
    raise RuntimeError(f"CPU subprocess error ({exc_type}): {exc_msg}")
