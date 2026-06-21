"""CPU worker pool — dispatches CPU execution to duplicate HF Spaces.

CPU execution runs on dedicated CPU Spaces. Each worker runs the same
codebase with WORKER_MODE=cpu; the main Space acts as an orchestrator
and dispatches any @gpu_with_fallback function here when a user selects
device=CPU.

Transport: HTTP + Gradio SSE (same pattern as mfa.py). No gradio_client
dep required; requests is already in requirements.txt.

All tunables live in config.py (CPU_WORKER_*). This module reads them once
at import time.
"""

import base64
import json
import os
import pickle
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    CPU_WORKER_ACQUIRE_TIMEOUT,
    CPU_WORKER_HEALTH_INTERVAL,
    CPU_WORKER_HTTP_TIMEOUT,
    CPU_WORKER_MAX_QUEUE_DEPTH,
    CPU_WORKER_MAX_RETRIES,
    CPU_WORKER_SPACES,
    CPU_WORKER_SSE_IDLE_TIMEOUT,
    CPU_WORKER_TRANSPORT_DEFAULT,
)
from .cancel_ctx import ClientDisconnectedError, get_cancel_event


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class PoolExhaustedError(RuntimeError):
    """All workers busy and the acquire timeout elapsed before one freed up."""


class PoolQueueFullError(RuntimeError):
    """Admission control rejected the request — too many already queued."""


# ---------------------------------------------------------------------------
# Dispatch-info thread-local stash — read by src/pipeline.py at log-row time.
# ---------------------------------------------------------------------------

_DISPATCH_TLS = threading.local()


def get_last_dispatch_info() -> Optional[dict]:
    """Return the current thread's last dispatch info, or None."""
    return getattr(_DISPATCH_TLS, "info", None)


def clear_last_dispatch_info():
    """Drop any stashed dispatch info on this thread. Call at request entry."""
    if hasattr(_DISPATCH_TLS, "info"):
        del _DISPATCH_TLS.info


# ---------------------------------------------------------------------------
# Worker state
# ---------------------------------------------------------------------------

@dataclass
class Worker:
    slug: str
    base_url: str
    busy: bool = False
    unhealthy_since: Optional[float] = None
    total_jobs: int = 0
    last_duration: float = 0.0
    last_error: Optional[str] = None
    # Lazy-initialized per-worker HTTP session for connection reuse.
    session: Any = field(default=None, repr=False)


def _slug_to_base_url(slug: str) -> str:
    """Convert 'owner/space-name' to 'https://owner-space-name.hf.space'."""
    return "https://" + slug.replace("/", "-").lower() + ".hf.space"


def _parse_worker_spaces(raw: str) -> List[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


def _ensure_session(w: Worker) -> requests.Session:
    """Lazy per-worker HTTP session with stale-connection recovery.

    HF Space boundaries and idle timeouts often drop pooled connections.
    A first request after idle would otherwise fail with RemoteDisconnected
    before any worker-side logic runs. Retry once on connect errors and
    treat 502/503/504 as retryable.
    """
    if w.session is None:
        s = requests.Session()
        retry = Retry(
            total=2,
            connect=2,
            read=0,
            backoff_factor=0.3,
            allowed_methods=frozenset(["GET", "POST"]),
            status_forcelist=[502, 503, 504],
            respect_retry_after_header=False,
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        w.session = s
    return w.session


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------

class WorkerPool:
    def __init__(self, slugs: List[str]):
        self._workers: List[Worker] = [
            Worker(slug=s, base_url=_slug_to_base_url(s)) for s in slugs
        ]
        self._cv = threading.Condition()
        self._waiters = 0

    def has_workers(self) -> bool:
        return len(self._workers) > 0

    def status(self) -> List[dict]:
        with self._cv:
            return [
                {
                    "slug": w.slug,
                    "busy": w.busy,
                    "unhealthy": w.unhealthy_since is not None,
                    "total_jobs": w.total_jobs,
                    "last_duration": round(w.last_duration, 2),
                    "last_error": w.last_error,
                }
                for w in self._workers
            ]

    def queue_info(self) -> dict:
        with self._cv:
            busy = sum(1 for w in self._workers if w.busy)
            return {
                "busy_workers": busy,
                "total_workers": len(self._workers),
                "waiters": self._waiters,
            }

    def acquire(self, timeout_s: float = CPU_WORKER_ACQUIRE_TIMEOUT) -> Worker:
        """Block until a healthy, idle worker is available. Marks it busy.

        Raises:
          PoolQueueFullError: admission control rejects the request because the
            pool is saturated and would add to an already-long waiting line.
          PoolExhaustedError: no worker freed up within the timeout.
        """
        deadline = time.time() + timeout_s
        with self._cv:
            # Fast-path: is there an idle healthy worker right now?
            healthy_idle = [
                w for w in self._workers
                if not w.busy and w.unhealthy_since is None
            ]
            if healthy_idle:
                w = min(healthy_idle, key=lambda w: w.total_jobs)
                w.busy = True
                return w

            # No worker available immediately — apply admission control before queueing.
            busy_count = sum(1 for w in self._workers if w.busy)
            if busy_count + self._waiters >= CPU_WORKER_MAX_QUEUE_DEPTH:
                raise PoolQueueFullError(
                    f"Pool saturated: {busy_count} busy, {self._waiters} already waiting "
                    f"(max {CPU_WORKER_MAX_QUEUE_DEPTH}). Try again in a minute."
                )

            self._waiters += 1
            try:
                while True:
                    healthy_idle = [
                        w for w in self._workers
                        if not w.busy and w.unhealthy_since is None
                    ]
                    if healthy_idle:
                        w = min(healthy_idle, key=lambda w: w.total_jobs)
                        w.busy = True
                        return w
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        raise PoolExhaustedError(
                            f"No worker available within {timeout_s}s "
                            f"(pool status: {self.status()})"
                        )
                    self._cv.wait(timeout=min(remaining, 30))
            finally:
                self._waiters -= 1

    def release(self, w: Worker, duration: float = 0.0, error: Optional[str] = None):
        with self._cv:
            w.busy = False
            w.total_jobs += 1
            w.last_duration = duration
            if error:
                w.last_error = error
                w.unhealthy_since = time.time()
            else:
                w.last_error = None
            self._cv.notify()

    def mark_healthy(self, w: Worker):
        with self._cv:
            w.unhealthy_since = None
            self._cv.notify()

    def unhealthy_workers(self) -> List[Worker]:
        with self._cv:
            return [w for w in self._workers if w.unhealthy_since is not None]


# Module-level singleton. Instantiated at import time.
POOL = WorkerPool(_parse_worker_spaces(CPU_WORKER_SPACES))


def has_workers() -> bool:
    return POOL.has_workers()


# ---------------------------------------------------------------------------
# Transport — HTTP + Gradio SSE
# ---------------------------------------------------------------------------

def _call_cpu_exec(worker: Worker, hf_token: str, func_module: str,
                    func_name: str, args_b64: str, kwargs_b64: str,
                    meta_json: str = "",
                    cancel_event: Optional[Any] = None) -> tuple:
    """Invoke the worker's /cpu_exec endpoint.

    Returns (result_b64, worker_timings, submit_s, sse_s). Mirrors the SSE
    pattern in mfa.py. `submit_s` covers the enqueue POST; `sse_s` covers the
    full SSE stream until the `complete` event.

    If `cancel_event` is a threading.Event, the SSE loop aborts as soon as it
    is set (client disconnect) or after a ReadTimeout when no worker bytes
    have arrived within CPU_WORKER_SSE_IDLE_TIMEOUT.
    """
    session = _ensure_session(worker)
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}
    base = worker.base_url

    # Submit
    t_submit = time.time()
    submit_resp = session.post(
        f"{base}/gradio_api/call/cpu_exec",
        headers={**headers, "Content-Type": "application/json"},
        json={"data": [hf_token, func_module, func_name, args_b64, kwargs_b64, meta_json]},
        timeout=60,
    )
    submit_resp.raise_for_status()
    ct = submit_resp.headers.get("content-type", "")
    if "application/json" not in ct:
        raise RuntimeError(
            f"Worker {worker.slug} returned non-JSON on submit "
            f"(content-type={ct}, body[:200]={submit_resp.text[:200]!r}). "
            "Space may be sleeping, restarting, or misconfigured."
        )
    event_id = submit_resp.json()["event_id"]
    submit_s = time.time() - t_submit

    # Poll SSE. Use a generous read timeout for the socket — Gradio's event
    # stream stays silent while the worker is computing. A separate watcher
    # thread closes the response if the client disconnects, which unblocks
    # iter_lines() with a connection-closed exception the main thread catches.
    t_sse = time.time()
    sse_resp = session.get(
        f"{base}/gradio_api/call/cpu_exec/{event_id}",
        headers=headers,
        stream=True,
        timeout=(10, CPU_WORKER_HTTP_TIMEOUT),
    )
    sse_resp.raise_for_status()

    watcher_done = threading.Event()
    was_cancelled = {"flag": False}

    def _cancel_watcher():
        while not watcher_done.is_set():
            if cancel_event is not None and cancel_event.is_set():
                was_cancelled["flag"] = True
                try:
                    sse_resp.close()
                except Exception:
                    pass
                return
            watcher_done.wait(timeout=CPU_WORKER_SSE_IDLE_TIMEOUT)

    watcher_thread = None
    if cancel_event is not None:
        watcher_thread = threading.Thread(
            target=_cancel_watcher, daemon=True, name=f"sse-cancel-{worker.slug}",
        )
        watcher_thread.start()

    result_data = None
    current_event = None
    try:
        for line in sse_resp.iter_lines(decode_unicode=True):
            if line and line.startswith("event: "):
                current_event = line[7:]
            elif line and line.startswith("data: "):
                data_str = line[6:]
                if current_event == "complete":
                    result_data = data_str
                elif current_event == "error":
                    if data_str.strip() in ("null", ""):
                        raise RuntimeError(
                            f"Worker {worker.slug} returned null error "
                            "(likely internal crash; check Space logs)"
                        )
                    raise RuntimeError(f"Worker {worker.slug} error: {data_str}")
    except (requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ConnectionError,
            requests.exceptions.StreamConsumedError) as e:
        # Watcher closed the stream → translate into a clear cancel signal.
        if was_cancelled["flag"]:
            raise ClientDisconnectedError(
                f"Client disconnected; aborted {worker.slug} SSE stream"
            ) from e
        raise
    finally:
        watcher_done.set()
        try:
            sse_resp.close()
        except Exception:
            pass

    if was_cancelled["flag"] and result_data is None:
        raise ClientDisconnectedError(
            f"Client disconnected; aborted {worker.slug} SSE stream"
        )
    sse_s = time.time() - t_sse

    if result_data is None:
        raise RuntimeError(f"Worker {worker.slug} closed stream without result")

    parsed = json.loads(result_data)
    # Gradio wraps single return in a list
    if isinstance(parsed, list) and len(parsed) == 1:
        parsed = parsed[0]

    if not isinstance(parsed, dict):
        raise RuntimeError(
            f"Worker {worker.slug} returned non-dict result: {type(parsed).__name__}"
        )
    if parsed.get("status") != "ok":
        raise RuntimeError(
            f"Worker {worker.slug} returned status={parsed.get('status')}: "
            f"{parsed.get('error', 'no error message')}"
        )
    return parsed["result_b64"], parsed.get("worker_timings", {}), submit_s, sse_s


# ---------------------------------------------------------------------------
# Health-check recovery thread
# ---------------------------------------------------------------------------

def _health_probe_payload() -> tuple:
    """Pickle+b64 an empty args/kwargs pair for the health probe."""
    empty_args_b64 = base64.b64encode(pickle.dumps(())).decode()
    empty_kwargs_b64 = base64.b64encode(pickle.dumps({})).decode()
    return empty_args_b64, empty_kwargs_b64


def _health_check_loop():
    """Periodically ping unhealthy workers; clear the flag on success."""
    empty_args_b64, empty_kwargs_b64 = _health_probe_payload()
    while True:
        time.sleep(CPU_WORKER_HEALTH_INTERVAL)
        hf_token = os.environ.get("HF_TOKEN", "")
        if not hf_token:
            continue  # can't probe without a token
        for w in POOL.unhealthy_workers():
            try:
                # Probe only — we don't care about timings here.
                _call_cpu_exec(
                    w, hf_token,
                    "src.core.zero_gpu", "is_user_forced_cpu",
                    empty_args_b64, empty_kwargs_b64, "",
                )
                POOL.mark_healthy(w)
                print(f"[CPU WORKER] {w.slug} recovered via health check")
            except Exception:
                # Still unhealthy — leave as-is, try again next tick.
                pass


def _start_health_check_thread():
    if not POOL.has_workers():
        return
    t = threading.Thread(
        target=_health_check_loop, daemon=True, name="worker-health",
    )
    t.start()


_start_health_check_thread()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_on_worker_cpu(func: Callable, args: tuple, kwargs: dict,
                       transport: Optional[str] = None) -> Any:
    """Execute `func(*args, **kwargs)` on a pooled CPU worker Space.

    Args, kwargs, and return value must be picklable (no torch tensors on
    GPU, no Gradio components, no file handles).

    Args:
        func: Function to execute (unwrapped on worker).
        args, kwargs: Forwarded to func.
        transport: "float32", "int16", or "ogg". Defaults to
                   config.CPU_WORKER_TRANSPORT_DEFAULT. Only affects audio
                   encoding on the wire.

    Raises:
        PoolQueueFullError: admission control rejected the request.
        PoolExhaustedError: no worker became available within the acquire timeout.
        RuntimeError: worker crashed, returned non-ok status, or all retries failed.
    """
    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        raise RuntimeError(
            "HF_TOKEN not set — cannot authenticate to worker Spaces. "
            "Set it in the main Space's secrets."
        )

    from .audio_transport import encode_args_for_transport
    transport = (transport or CPU_WORKER_TRANSPORT_DEFAULT).lower()

    # --- Encode audio per transport ---
    t_enc = time.time()
    encoded_args, meta = encode_args_for_transport(args, transport)
    args_b64 = base64.b64encode(pickle.dumps(encoded_args)).decode()
    kwargs_b64 = base64.b64encode(pickle.dumps(kwargs)).decode()
    meta_json = json.dumps(meta)
    encode_time = time.time() - t_enc
    body_bytes = len(args_b64) + len(kwargs_b64) + len(meta_json)

    func_module = func.__module__
    func_name = func.__qualname__

    cancel_event = get_cancel_event()

    last_err = None
    last_worker_slug = None
    for attempt in range(CPU_WORKER_MAX_RETRIES + 1):
        t_acquire = time.time()
        w = POOL.acquire()
        queue_wait_s = time.time() - t_acquire
        last_worker_slug = w.slug
        start = time.time()
        print(
            f"[CPU WORKER] Dispatching {func_module}.{func_name} to {w.slug} "
            f"(transport={transport}, body={body_bytes/1e6:.2f} MB, "
            f"encode={encode_time:.2f}s, queue_wait={queue_wait_s:.2f}s, "
            f"attempt {attempt + 1})"
        )
        try:
            result_b64, worker_timings, submit_s, sse_s = _call_cpu_exec(
                w, hf_token, func_module, func_name, args_b64, kwargs_b64, meta_json,
                cancel_event=cancel_event,
            )
            duration = time.time() - start

            # --- Decode result ---
            t_dec = time.time()
            result = pickle.loads(base64.b64decode(result_b64))
            decode_time = time.time() - t_dec

            POOL.release(w, duration=duration)

            # Stash full dispatch info for pipeline.py log-row assembly.
            _DISPATCH_TLS.info = {
                "used": True,
                "worker_slug": w.slug,
                "transport": transport,
                "attempts": attempt + 1,
                "queue_wait_s": round(queue_wait_s, 3),
                "main_encode_s": round(encode_time, 3),
                "main_upload_submit_s": round(submit_s, 3),
                "sse_total_s": round(sse_s, 3),
                "main_decode_s": round(decode_time, 3),
                "req_body_mb": round(body_bytes / 1e6, 3),
                "resp_b64_mb": round(len(result_b64) / 1e6, 3),
                "worker_timings": worker_timings,
            }

            print(
                f"[CPU WORKER] {w.slug} completed {func_name} in {duration:.1f}s "
                f"(main_decode={decode_time:.2f}s, resp_b64={len(result_b64)/1e6:.2f} MB, "
                f"worker_timings={worker_timings})"
            )
            print(
                f"[TRANSPORT STATS] {func_name} transport={transport} "
                f"req_body_mb={body_bytes/1e6:.2f} resp_b64_mb={len(result_b64)/1e6:.2f} "
                f"main_encode_s={encode_time:.2f} main_decode_s={decode_time:.2f} "
                f"submit_s={submit_s:.2f} sse_s={sse_s:.2f} "
                f"queue_wait_s={queue_wait_s:.2f} worker={worker_timings}"
            )
            return result
        except ClientDisconnectedError as e:
            # Client is gone — don't retry, don't mark worker unhealthy.
            # The worker is still healthy; we just stopped listening. It will
            # finish its current job and become available again on its own.
            duration = time.time() - start
            POOL.release(w, duration=duration)
            print(
                f"[CPU WORKER] {w.slug} dispatch cancelled by client after "
                f"{duration:.1f}s (worker still running its job server-side)"
            )
            _DISPATCH_TLS.info = {
                "used": True,
                "worker_slug": w.slug,
                "transport": transport,
                "attempts": attempt + 1,
                "cancelled": True,
            }
            raise
        except Exception as e:
            duration = time.time() - start
            last_err = e
            # If the client has already disconnected, any error here is a
            # side-effect of the aborted connection. Don't mark the worker
            # unhealthy and don't retry — the user is gone.
            if cancel_event is not None and cancel_event.is_set():
                POOL.release(w, duration=duration)
                print(
                    f"[CPU WORKER] {w.slug} dispatch aborted ({type(e).__name__}) "
                    "because client disconnected"
                )
                _DISPATCH_TLS.info = {
                    "used": True,
                    "worker_slug": w.slug,
                    "transport": transport,
                    "attempts": attempt + 1,
                    "cancelled": True,
                }
                raise ClientDisconnectedError(str(e)) from e
            POOL.release(w, duration=duration, error=str(e))
            print(
                f"[CPU WORKER] {w.slug} failed {func_name} after {duration:.1f}s: {e}"
            )
            # Retry on a different worker
            if attempt < CPU_WORKER_MAX_RETRIES:
                continue
            # Leave a forensic trail on final failure too.
            _DISPATCH_TLS.info = {
                "used": True,
                "worker_slug": last_worker_slug,
                "transport": transport,
                "attempts": attempt + 1,
                "error": str(last_err),
            }
            raise RuntimeError(
                f"All worker attempts failed for {func_module}.{func_name}. "
                f"Last error: {last_err}"
            ) from last_err
