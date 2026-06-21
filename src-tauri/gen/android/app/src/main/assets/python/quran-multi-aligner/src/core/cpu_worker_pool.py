"""Persistent CPU worker pool — prototype.

Replaces the spawn-per-request path (cpu_subprocess.py) with long-lived
workers that preload VAD + ASR (Base) once and stay ready. ASR Large is
loaded on-demand in each worker (and cached there) so steady-state RAM
stays predictable.

Gated behind env var CPU_WORKER_MODE=persistent. CPU_WORKER_MODE=spawn
(default) keeps the existing spawn-per-request behavior.

Semaphore capacity = CPU_SUBPROCESS_CONCURRENCY (shared with spawn path).
A free-worker queue gives O(1) idle-worker pickup and guarantees at most
one concurrent job per worker.
"""

from __future__ import annotations

import importlib
import multiprocessing as mp
import os
import queue as queue_mod
import signal
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Worker side
# ---------------------------------------------------------------------------


def _worker_loop(
    worker_id: int,
    extra_paths: list,
    req_q: mp.Queue,
    res_q: mp.Queue,
    ready_ev,
    preload_large: bool,
):
    """Long-lived worker body. Runs in a spawn-context process.

    Steps:
      1. Env hygiene — hide CUDA, disable ZeroGPU patches.
      2. Import project modules, call force_cpu_mode().
      3. Preload VAD + ASR Base (Large optional).
      4. Signal `ready_ev`.
      5. Loop: pull task → execute → push result.

    Tasks are pickled tuples: (task_id, kind, payload)
      kind="run":    payload=(func_module, func_name, args, kwargs)
      kind="rss":    payload=None     (return rss bytes)
      kind="load_large": payload=None (preload ASR Large if not cached)
      kind="shutdown": payload=None   (exit loop)
    """
    # ---- Env hygiene BEFORE any torch import ----------------------------
    os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
    os.environ["SPACES_ZERO_GPU"] = ""
    # Suppress the HF download progress bars — the parent app sets this but
    # the spawned child inherits only env, not module state.
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

    # Restore sys.path from parent so src/ is importable
    for p in extra_paths:
        if p and p not in sys.path:
            sys.path.insert(0, p)

    # Helpful process label for ps/htop
    try:
        import setproctitle  # type: ignore
        setproctitle.setproctitle(f"cpu-worker-{worker_id}")
    except Exception:
        pass

    log = lambda msg: print(f"[CPU-POOL/W{worker_id}] {msg}", flush=True)

    # ---- RSS probe ------------------------------------------------------
    def _rss_bytes() -> int:
        try:
            import psutil  # type: ignore
            return psutil.Process(os.getpid()).memory_info().rss
        except Exception:
            try:
                with open(f"/proc/{os.getpid()}/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            return int(line.split()[1]) * 1024
            except Exception:
                return 0
            return 0

    snapshots = {"start": _rss_bytes()}
    t0 = time.time()
    log(f"booted pid={os.getpid()} rss={snapshots['start']/1e6:.1f}MB")

    # ---- Imports + force CPU mode --------------------------------------
    try:
        from src.core.zero_gpu import force_cpu_mode
        force_cpu_mode()
        snapshots["after_imports"] = _rss_bytes()
        log(f"imports done +{(time.time()-t0):.1f}s rss={snapshots['after_imports']/1e6:.1f}MB")
    except Exception as e:
        log(f"FATAL imports: {e}\n{traceback.format_exc()}")
        res_q.put(("__boot_error__", "error", (type(e).__name__, str(e), traceback.format_exc())))
        return

    load_times = {}

    # ---- Preload VAD ---------------------------------------------------
    try:
        t = time.time()
        from src.segmenter.segmenter_model import load_segmenter
        load_segmenter()
        load_times["vad"] = time.time() - t
        snapshots["after_vad"] = _rss_bytes()
        log(f"VAD loaded in {load_times['vad']:.2f}s rss={snapshots['after_vad']/1e6:.1f}MB")
    except Exception as e:
        log(f"VAD load failed: {e}")
        res_q.put(("__boot_error__", "error", (type(e).__name__, str(e), traceback.format_exc())))
        return

    # ---- Preload ASR Base ---------------------------------------------
    try:
        t = time.time()
        from src.alignment.phoneme_asr import load_phoneme_asr
        load_phoneme_asr("Base")
        load_times["asr_base"] = time.time() - t
        snapshots["after_asr_base"] = _rss_bytes()
        log(f"ASR Base loaded in {load_times['asr_base']:.2f}s rss={snapshots['after_asr_base']/1e6:.1f}MB")
    except Exception as e:
        log(f"ASR Base load failed: {e}")
        res_q.put(("__boot_error__", "error", (type(e).__name__, str(e), traceback.format_exc())))
        return

    # ---- Preload caches (ngram index, phoneme chapters) ----------------
    try:
        t = time.time()
        from src.alignment.ngram_index import get_ngram_index
        from src.alignment.phoneme_matcher_cache import preload_all_chapters
        get_ngram_index()
        preload_all_chapters()
        load_times["caches"] = time.time() - t
        snapshots["after_caches"] = _rss_bytes()
        log(f"caches loaded in {load_times['caches']:.2f}s rss={snapshots['after_caches']/1e6:.1f}MB")
    except Exception as e:
        log(f"caches load failed (non-fatal): {e}")

    # ---- Optionally preload ASR Large ---------------------------------
    if preload_large:
        try:
            t = time.time()
            from src.alignment.phoneme_asr import load_phoneme_asr
            load_phoneme_asr("Large")
            load_times["asr_large"] = time.time() - t
            snapshots["after_asr_large"] = _rss_bytes()
            log(f"ASR Large loaded in {load_times['asr_large']:.2f}s rss={snapshots['after_asr_large']/1e6:.1f}MB")
        except Exception as e:
            log(f"ASR Large preload failed: {e}")

    # ---- Warm up resampler --------------------------------------------
    try:
        import numpy as np, librosa
        from config import RESAMPLE_TYPE
        _ = librosa.resample(np.zeros(1600, dtype=np.float32),
                             orig_sr=44100, target_sr=16000, res_type=RESAMPLE_TYPE)
    except Exception:
        pass

    snapshots["ready"] = _rss_bytes()
    total_boot = time.time() - t0
    log(f"READY in {total_boot:.2f}s, final rss={snapshots['ready']/1e6:.1f}MB")

    # Signal parent that this worker booted successfully
    res_q.put(("__ready__", "ok", {
        "worker_id": worker_id,
        "pid": os.getpid(),
        "snapshots": snapshots,
        "load_times": load_times,
        "boot_time": total_boot,
    }))
    ready_ev.set()

    # ---- Main loop -----------------------------------------------------
    while True:
        try:
            item = req_q.get()
        except (EOFError, OSError, KeyboardInterrupt):
            break
        if item is None:
            break
        task_id, kind, payload = item
        try:
            if kind == "shutdown":
                break
            elif kind == "rss":
                res_q.put((task_id, "ok", _rss_bytes()))
                continue
            elif kind == "load_large":
                try:
                    from src.alignment.phoneme_asr import load_phoneme_asr
                    t = time.time()
                    load_phoneme_asr("Large")
                    res_q.put((task_id, "ok", {"load_time": time.time() - t, "rss": _rss_bytes()}))
                except Exception as e:
                    res_q.put((task_id, "error", (type(e).__name__, str(e), traceback.format_exc())))
                continue
            elif kind == "run":
                func_module, func_name, args, kwargs = payload
                try:
                    module = importlib.import_module(func_module)
                    func = getattr(module, func_name)
                    while hasattr(func, "__wrapped__"):
                        func = func.__wrapped__
                    result = func(*args, **kwargs)
                    res_q.put((task_id, "ok", result))
                except Exception as e:
                    res_q.put((task_id, "error", (type(e).__name__, str(e), traceback.format_exc())))
                continue
            else:
                res_q.put((task_id, "error", ("ValueError", f"unknown kind {kind!r}", "")))
        except Exception as e:
            # Catch-all so the loop survives
            res_q.put((task_id, "error", (type(e).__name__, str(e), traceback.format_exc())))

    log("exiting cleanly")


# ---------------------------------------------------------------------------
# Parent side
# ---------------------------------------------------------------------------


@dataclass
class _WorkerHandle:
    worker_id: int
    process: Optional[Any] = None
    req_q: Optional[Any] = None
    res_q: Optional[Any] = None
    ready_ev: Optional[Any] = None
    snapshots: dict = field(default_factory=dict)
    load_times: dict = field(default_factory=dict)
    boot_time: float = 0.0
    pid: Optional[int] = None
    total_jobs: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)


class _Pool:
    def __init__(self):
        self.ctx = mp.get_context("spawn")
        self.workers: list[_WorkerHandle] = []
        self.free_q: "queue_mod.Queue[int]" = queue_mod.Queue()
        self._started = False
        self._lock = threading.Lock()
        self._task_counter = 0
        self._respawn_count = 0
        self._preload_large = False
        self._extra_paths: list[str] = []

    # ---- lifecycle -------------------------------------------------------

    def start(self, n_workers: int, preload_large: bool = False, boot_timeout: float = 600.0):
        with self._lock:
            if self._started:
                return
            self._started = True
            self._preload_large = preload_large
            self._extra_paths = list(sys.path)
            print(f"[CPU-POOL] Starting {n_workers} persistent worker(s) preload_large={preload_large}")
            for i in range(n_workers):
                h = self._spawn_worker(i)
                self.workers.append(h)
            # Wait for ready signal from each (serial — avoids RAM spike)
            for h in self.workers:
                self._wait_ready(h, timeout=boot_timeout)
                self.free_q.put(h.worker_id)
            print(f"[CPU-POOL] All {n_workers} workers READY")

    def _spawn_worker(self, worker_id: int) -> _WorkerHandle:
        req_q = self.ctx.Queue()
        res_q = self.ctx.Queue()
        ready_ev = self.ctx.Event()
        p = self.ctx.Process(
            target=_worker_loop,
            args=(worker_id, self._extra_paths, req_q, res_q, ready_ev, self._preload_large),
            daemon=True,
            name=f"cpu-worker-{worker_id}",
        )
        p.start()
        return _WorkerHandle(
            worker_id=worker_id,
            process=p,
            req_q=req_q,
            res_q=res_q,
            ready_ev=ready_ev,
            pid=p.pid,
        )

    def _wait_ready(self, h: _WorkerHandle, timeout: float):
        """Drain res_q until we see the __ready__ tag or a __boot_error__."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                tag, status, payload = h.res_q.get(timeout=min(10.0, deadline - time.time()))
            except queue_mod.Empty:
                if h.process is not None and not h.process.is_alive():
                    raise RuntimeError(f"Worker {h.worker_id} died during boot (exit={h.process.exitcode})")
                continue
            if tag == "__ready__":
                h.snapshots = payload.get("snapshots", {})
                h.load_times = payload.get("load_times", {})
                h.boot_time = payload.get("boot_time", 0.0)
                h.pid = payload.get("pid", h.pid)
                return
            if tag == "__boot_error__":
                exc_type, exc_msg, tb = payload
                raise RuntimeError(f"Worker {h.worker_id} boot failed: {exc_type}: {exc_msg}\n{tb}")
            # Unexpected tag during boot — ignore and keep waiting.
        raise TimeoutError(f"Worker {h.worker_id} did not become ready within {timeout}s")

    def shutdown(self, timeout: float = 5.0):
        with self._lock:
            if not self._started:
                return
            for h in self.workers:
                try:
                    h.req_q.put((0, "shutdown", None))
                except Exception:
                    pass
            for h in self.workers:
                try:
                    if h.process is not None:
                        h.process.join(timeout=timeout)
                        if h.process.is_alive():
                            h.process.kill()
                            h.process.join(timeout=2)
                except Exception:
                    pass
            self.workers.clear()
            self._started = False

    # ---- task dispatch ---------------------------------------------------

    def _next_task_id(self) -> int:
        with self._lock:
            self._task_counter += 1
            return self._task_counter

    def _acquire_worker(self, timeout: Optional[float] = None) -> _WorkerHandle:
        wid = self.free_q.get(timeout=timeout)
        # Validate the worker is still alive; if not, respawn in-place.
        h = self.workers[wid]
        if h.process is None or not h.process.is_alive():
            print(f"[CPU-POOL] Worker {wid} dead on acquire — respawning")
            self._respawn_worker(wid)
            h = self.workers[wid]
        return h

    def _release_worker(self, h: _WorkerHandle):
        self.free_q.put(h.worker_id)

    def _respawn_worker(self, worker_id: int):
        """Replace a dead worker in-place. Blocks until ready."""
        t0 = time.time()
        new_h = self._spawn_worker(worker_id)
        self._wait_ready(new_h, timeout=600.0)
        self.workers[worker_id] = new_h
        self._respawn_count += 1
        print(f"[CPU-POOL] Worker {worker_id} respawned in {time.time()-t0:.1f}s (new pid={new_h.pid})")

    def run(self, func, args, kwargs, timeout: Optional[float] = None) -> Any:
        if not self._started:
            raise RuntimeError("Pool not started")

        h = self._acquire_worker(timeout=timeout)
        try:
            task_id = self._next_task_id()
            func_module = func.__module__
            func_name = func.__qualname__
            print(f"[CPU-POOL] dispatch task#{task_id} {func_module}.{func_name} -> W{h.worker_id} (pid={h.pid})")
            t0 = time.time()
            h.req_q.put((task_id, "run", (func_module, func_name, args, kwargs)))

            # Drain res_q; tolerate process death.
            deadline = time.time() + (timeout or 3600 * 4)
            while True:
                try:
                    tag, status, payload = h.res_q.get(timeout=min(30.0, max(1.0, deadline - time.time())))
                except queue_mod.Empty:
                    if not h.process.is_alive():
                        # worker died mid-task. respawn and raise so caller can retry.
                        print(f"[CPU-POOL] Worker {h.worker_id} died mid-task (exit={h.process.exitcode})")
                        self._respawn_worker(h.worker_id)
                        raise RuntimeError(f"Worker {h.worker_id} died mid-task")
                    if time.time() >= deadline:
                        raise TimeoutError(f"CPU pool task timed out after {timeout}s")
                    continue

                if tag == task_id:
                    break
                # stray message (e.g. leftover rss reply). Drop.
                print(f"[CPU-POOL] W{h.worker_id} stray message tag={tag!r}, ignoring")

            h.total_jobs += 1
            dt = time.time() - t0
            if status == "ok":
                print(f"[CPU-POOL] task#{task_id} ok in {dt:.2f}s on W{h.worker_id}")
                return payload
            exc_type, exc_msg, tb = payload
            print(f"[CPU-POOL] task#{task_id} error on W{h.worker_id}: {exc_type}: {exc_msg}\n{tb}")
            raise RuntimeError(f"Worker error ({exc_type}): {exc_msg}")
        finally:
            # If the worker died we may have respawned it inside _run. In that
            # case it's already in workers[] but not in free_q. Add it back.
            if h.process is not None and not h.process.is_alive():
                # respawn already put nothing back on free_q; add the *new* handle
                new_h = self.workers[h.worker_id]
                if new_h is not h:
                    self.free_q.put(new_h.worker_id)
                else:
                    # lost — dead and not replaced. Try a respawn now.
                    try:
                        self._respawn_worker(h.worker_id)
                        self.free_q.put(h.worker_id)
                    except Exception as e:
                        print(f"[CPU-POOL] could not respawn W{h.worker_id}: {e}")
            else:
                self._release_worker(h)

    # ---- diagnostics -----------------------------------------------------

    def probe_rss(self, worker_id: int, timeout: float = 10.0) -> int:
        h = self.workers[worker_id]
        task_id = self._next_task_id()
        h.req_q.put((task_id, "rss", None))
        deadline = time.time() + timeout
        while time.time() < deadline:
            tag, status, payload = h.res_q.get(timeout=deadline - time.time())
            if tag == task_id:
                return int(payload)
        raise TimeoutError("rss probe timed out")

    def load_large(self, worker_id: int, timeout: float = 300.0) -> dict:
        h = self.workers[worker_id]
        task_id = self._next_task_id()
        h.req_q.put((task_id, "load_large", None))
        deadline = time.time() + timeout
        while time.time() < deadline:
            tag, status, payload = h.res_q.get(timeout=deadline - time.time())
            if tag == task_id:
                if status == "ok":
                    return payload
                raise RuntimeError(f"load_large failed: {payload}")
        raise TimeoutError("load_large timed out")

    def stats(self) -> dict:
        # Peek free_q without popping — derives per-worker is_busy. Queue.queue
        # is a private-but-stable deque attribute; the read is best-effort and
        # transient mismatches during pickup/release are acceptable for the
        # telemetry sampler (periodic, non-critical).
        try:
            free_ids = set(list(self.free_q.queue))
        except Exception:
            free_ids = set()
        return {
            "started": self._started,
            "n_workers": len(self.workers),
            "free_count": self.free_q.qsize(),
            "busy_count": max(0, len(self.workers) - self.free_q.qsize()),
            "respawn_count": self._respawn_count,
            "workers": [
                {
                    "id": h.worker_id,
                    "pid": h.pid,
                    "alive": h.process is not None and h.process.is_alive(),
                    "is_busy": h.worker_id not in free_ids,
                    "total_jobs": h.total_jobs,
                    "boot_time": h.boot_time,
                    "snapshots": {k: v for k, v in h.snapshots.items()},
                    "load_times": h.load_times,
                }
                for h in self.workers
            ],
        }


# ---------------------------------------------------------------------------
# Module-level singleton API
# ---------------------------------------------------------------------------

_POOL: Optional[_Pool] = None
_START_LOCK = threading.Lock()


def _get_pool() -> _Pool:
    global _POOL
    if _POOL is None:
        with _START_LOCK:
            if _POOL is None:
                _POOL = _Pool()
    return _POOL


def start_pool(n_workers: int, preload_large: bool = False):
    """Spawn the persistent worker pool. Idempotent."""
    _get_pool().start(n_workers, preload_large=preload_large)


def is_started() -> bool:
    return _POOL is not None and _POOL._started


def stats() -> dict:
    return _get_pool().stats()


def probe_rss(worker_id: int) -> int:
    return _get_pool().probe_rss(worker_id)


def load_large(worker_id: int) -> dict:
    return _get_pool().load_large(worker_id)


def shutdown():
    if _POOL is not None:
        _POOL.shutdown()


def run_on_persistent_worker(func, args, kwargs, timeout: Optional[float] = None):
    """Run a function on a free persistent worker. Blocks until done.

    Caller is responsible for concurrency gating (the wrapper in zero_gpu.py
    uses the same semaphore as the spawn path).
    """
    return _get_pool().run(func, args, kwargs, timeout=timeout)
