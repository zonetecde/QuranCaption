"""Periodic host + CPU-worker-pool telemetry sampler.

V3.1 scope: persistent subprocess pool only. Spawn mode + remote worker
dispatch are deferred — this sampler reads from `cpu_worker_pool.stats()`
directly and skips if the pool isn't started.

A background daemon thread wakes every `TELEMETRY_SAMPLE_SECONDS`, reads:
  - host: CPU%, load_1m, memory, swap (via psutil)
  - pool: active/free counts, per-worker CPU%/RSS/is_busy/total_jobs
and appends a row to the telemetry Parquet scheduler. The scheduler pushes
every `TELEMETRY_FLUSH_MINUTES`.

Rows are independent of per-request log rows — analysts join by timestamp
window (for each request row in `-logs` dataset, telemetry rows with
`timestamp ∈ [request.timestamp, request.timestamp + request.wall_total_s]`
describe what the host was doing during that run).
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import Any, Optional


# ----------------------------------------------------------------------------
# psutil lazy init — the first `cpu_percent()` call always returns 0.0 (it
# measures the delta since the previous call). Prime process-level probes on
# startup so the first telemetry sample reports a meaningful number.
# ----------------------------------------------------------------------------

_psutil = None  # imported lazily

# Per-pid blocking sample interval for `Process.cpu_percent`. The `interval=None`
# path would require priming each pid with a prior call AND enough wall time
# before the next call to accumulate a meaningful delta — neither holds inside
# a single sampler tick. `interval=0.1` blocks 100ms per worker to measure %
# directly. At cap=2 that's ~200ms per sample cycle — well within the 15-30s
# sample interval budget.
_PROC_CPU_SAMPLE_INTERVAL_S = 0.1


def _get_psutil():
    global _psutil
    if _psutil is None:
        import psutil  # type: ignore
        _psutil = psutil
        # Prime system-level cpu_percent — first call returns 0.0, subsequent
        # calls return the real % over the interval since last call.
        _psutil.cpu_percent(interval=None)
    return _psutil


# ----------------------------------------------------------------------------
# Sample builders
# ----------------------------------------------------------------------------


def _read_cgroup_int(path: str) -> int | None:
    """Read an integer cgroup file (bytes or usec). Returns None if missing."""
    try:
        with open(path) as f:
            v = f.read().strip()
        return int(v) if v.isdigit() else None
    except Exception:
        return None


# Module state — last cpu.stat usage_usec so we can compute delta % per sample.
_last_cpu_usec: int | None = None
_last_sample_mono: float | None = None


def _sample_container() -> dict:
    """Per-container CPU + memory from cgroup v2. Reflects THIS Space only.

    On HF Spaces (cgroup v2, unified hierarchy):
      - `memory.current` / `memory.max` / `memory.peak` = this container's
        memory usage / limit / high-water-mark.
      - `cpu.max` = `"<quota_usec> <period_usec>"` — quota is the per-period
        CPU budget, so `quota / period` = number of cores we're entitled to.
      - `cpu.stat::usage_usec` is a monotonic CPU-microseconds-used counter.
        Delta between samples / (sample_interval * quota_cores) = % of quota.
    """
    global _last_cpu_usec, _last_sample_mono
    out: dict = {}

    # Memory (from cgroup v2)
    mem_current = _read_cgroup_int("/sys/fs/cgroup/memory.current")
    mem_max     = _read_cgroup_int("/sys/fs/cgroup/memory.max")
    mem_peak    = _read_cgroup_int("/sys/fs/cgroup/memory.peak")
    if mem_current is not None:
        out["mem_current_mb"] = round(mem_current / (1024 * 1024), 1)
        if mem_max:
            out["mem_max_mb"]   = round(mem_max / (1024 * 1024), 1)
            out["mem_used_pct"] = round(100.0 * mem_current / mem_max, 1)
        if mem_peak is not None:
            out["mem_peak_mb"] = round(mem_peak / (1024 * 1024), 1)

    # CPU quota (cores) from cpu.max
    try:
        with open("/sys/fs/cgroup/cpu.max") as f:
            parts = f.read().strip().split()
        quota_us = int(parts[0]) if parts[0].isdigit() else None
        period_us = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 100_000
        if quota_us:
            out["cpu_quota_cores"] = round(quota_us / period_us, 2)
    except Exception:
        quota_us = None
        period_us = 100_000

    # CPU usage delta — requires two samples
    cur_usec = None
    try:
        with open("/sys/fs/cgroup/cpu.stat") as f:
            for line in f:
                if line.startswith("usage_usec"):
                    cur_usec = int(line.split()[1])
                    break
    except Exception:
        pass

    import time as _t
    now_mono = _t.monotonic()
    if cur_usec is not None and _last_cpu_usec is not None and _last_sample_mono is not None:
        dt_s = max(0.001, now_mono - _last_sample_mono)
        d_usec = max(0, cur_usec - _last_cpu_usec)
        out["cpu_used_usec_delta"] = d_usec
        if quota_us:
            quota_cores = quota_us / period_us
            # % of OUR quota used over the sample interval
            out["cpu_used_pct_of_quota"] = round(
                100.0 * (d_usec / 1e6) / (dt_s * quota_cores), 1
            )
    _last_cpu_usec = cur_usec
    _last_sample_mono = now_mono

    return out


def _sample_host() -> dict:
    """Physical-HOST global stats (shared across all tenants on the box).

    These are NOT about this Space — on ZeroGPU the physical host has ~192
    vCPU / 2 TB RAM shared among many tenants. Useful only as noisy-neighbor
    context. Per-container truth lives in `container`.
    """
    try:
        ps = _get_psutil()
        load_1m = None
        try:
            load_1m = os.getloadavg()[0]
        except (AttributeError, OSError):
            pass
        return {
            "cpu_percent_global": round(float(ps.cpu_percent(interval=None)), 1),
            "load_1m_global":     round(load_1m, 2) if load_1m is not None else None,
        }
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def _sample_pool() -> Optional[dict]:
    """Persistent-pool snapshot. Returns None if pool isn't started."""
    try:
        from .cpu_worker_pool import is_started, stats
    except Exception:
        return None
    if not is_started():
        return None

    try:
        s = stats()
    except Exception as e:
        return {"error": f"stats failed: {type(e).__name__}: {e}"}

    ps = _get_psutil()
    workers = []
    for w in s.get("workers", []):
        pid = w.get("pid")
        cpu_pct = 0.0
        rss_mb = 0.0
        if pid:
            try:
                proc = ps.Process(pid)
                cpu_pct = round(float(proc.cpu_percent(interval=_PROC_CPU_SAMPLE_INTERVAL_S)), 1)
                rss_mb = round(proc.memory_info().rss / (1024 * 1024), 1)
            except Exception:
                pass
        workers.append({
            "worker_id":   w.get("id"),
            "pid":         pid,
            "cpu_percent": cpu_pct,
            "rss_mb":      rss_mb,
            "is_busy":     bool(w.get("is_busy")),
            "alive":       bool(w.get("alive")),
            "total_jobs":  int(w.get("total_jobs", 0)),
        })

    # Semaphore info (capacity + current holders). Best-effort.
    cap = len(s.get("workers", []))
    try:
        from .zero_gpu import _get_subprocess_semaphore
        sem = _get_subprocess_semaphore()
        cap = getattr(sem, "capacity", cap)
    except Exception:
        pass

    return {
        "mode":            "persistent",
        "concurrency_cap": cap,
        "active_workers":  s.get("busy_count", 0),
        "free_workers":    s.get("free_count", 0),
        "n_workers":       s.get("n_workers", 0),
        "respawn_count":   int(s.get("respawn_count", 0)),
        "workers":         workers,
    }


def build_sample() -> dict:
    """Produce one telemetry row dict. Pure function — no side effects.

    Side note: `_sample_container()` mutates module state (`_last_cpu_usec`)
    to compute CPU delta across samples. It's re-entrant for a single sampler
    thread; do not call concurrently.
    """
    from config import TELEMETRY_SCHEMA_VERSION
    return {
        "timestamp":      datetime.now().isoformat(timespec="seconds"),
        "schema_version": TELEMETRY_SCHEMA_VERSION,
        "space":          os.environ.get("SPACE_ID", "local"),
        "container":      _sample_container(),
        "host":           _sample_host(),
        "pool":           _sample_pool(),
    }


# ----------------------------------------------------------------------------
# Sampler thread
# ----------------------------------------------------------------------------

_sampler_thread: Optional[threading.Thread] = None
_sampler_stop = threading.Event()


def _sampler_loop(sample_every_s: int) -> None:
    """Daemon loop: sample → serialize → append to scheduler."""
    import json
    from .usage_logger import _ensure_schedulers, _telemetry_scheduler  # lazy

    # Prime host-level cpu_percent so first real sample isn't 0.0
    _get_psutil()
    time.sleep(1.0)

    while not _sampler_stop.is_set():
        t0 = time.monotonic()
        try:
            _ensure_schedulers()
            row_obj = build_sample()
            # Flatten JSON sub-dicts to strings (match the parquet schema)
            row = {
                "timestamp":      row_obj["timestamp"],
                "schema_version": row_obj["schema_version"],
                "space":          row_obj["space"],
                "container":      json.dumps(row_obj["container"]),
                "host":           json.dumps(row_obj["host"]),
                "pool":           json.dumps(row_obj["pool"]) if row_obj["pool"] is not None else None,
            }
            from .usage_logger import get_telemetry_scheduler
            sch = get_telemetry_scheduler()
            if sch is not None:
                sch.append(row)
        except Exception as e:
            print(f"[TELEMETRY] sample failed: {type(e).__name__}: {e}")

        # Sleep the remainder of the interval (tolerate slow samples)
        elapsed = time.monotonic() - t0
        remaining = max(0.0, sample_every_s - elapsed)
        _sampler_stop.wait(timeout=remaining)


def start_sampler() -> None:
    """Start the telemetry daemon thread. Idempotent."""
    global _sampler_thread
    if _sampler_thread is not None and _sampler_thread.is_alive():
        return
    try:
        from config import TELEMETRY_ENABLED, TELEMETRY_SAMPLE_SECONDS
    except Exception as e:
        print(f"[TELEMETRY] config import failed: {e}")
        return
    if not TELEMETRY_ENABLED:
        print("[TELEMETRY] disabled via TELEMETRY_ENABLED=0")
        return

    _sampler_stop.clear()
    _sampler_thread = threading.Thread(
        target=_sampler_loop, args=(TELEMETRY_SAMPLE_SECONDS,),
        name="telemetry-sampler", daemon=True,
    )
    _sampler_thread.start()
    print(f"[TELEMETRY] sampler started (sample_every={TELEMETRY_SAMPLE_SECONDS}s)")


def stop_sampler() -> None:
    """Signal the sampler to stop at its next tick. Best-effort."""
    _sampler_stop.set()
