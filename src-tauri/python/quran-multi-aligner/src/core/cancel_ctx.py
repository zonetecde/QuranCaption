"""Client-disconnect cancel propagation.

Wrap an endpoint body in `with watch_disconnect(request):` to spawn a
daemon watchdog that polls `request.is_disconnected()` asynchronously.
On disconnect, the watchdog sets a `threading.Event` exposed via a
contextvar so downstream code (the CPU worker dispatcher in
`src/core/worker_pool.py`) can abort mid-flight and free the worker slot.

The watchdog is safe to use with `request=None` (local dev, tests — becomes
a no-op). It only ever observes the request; it never mutates it.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import threading
from typing import Optional

from config import CPU_WORKER_CANCEL_POLL_INTERVAL


class ClientDisconnectedError(RuntimeError):
    """Raised by worker dispatch when the client has disconnected."""


_cancel_event_var: contextvars.ContextVar[Optional[threading.Event]] = \
    contextvars.ContextVar("cancel_event", default=None)


def get_cancel_event() -> Optional[threading.Event]:
    """Return the current context's cancel event, or None outside a watch."""
    return _cancel_event_var.get()


def _watchdog_loop(request, cancel_event: threading.Event,
                    stop_event: threading.Event, poll_interval: float):
    """Run until stop_event is set or client disconnects.

    Requires 2 consecutive positive `is_disconnected()` reads before firing
    cancel_event. This suppresses a false positive seen on the Gradio
    `/gradio_api/call/<name>` API flow, where the POST request briefly
    reports disconnected between the POST returning an event_id and the
    client opening the SSE GET stream. A real disconnect will still be
    caught within 2× poll_interval.
    """
    loop = asyncio.new_event_loop()
    consecutive = 0
    try:
        # Brief initial grace so we don't poll at t=0 before the SSE stream opens.
        stop_event.wait(timeout=poll_interval)
        while not stop_event.is_set():
            try:
                disconnected = loop.run_until_complete(request.is_disconnected())
            except Exception:
                # Never let a probe error kill the request — just retry next tick.
                disconnected = False
            if disconnected:
                consecutive += 1
                if consecutive >= 2:
                    cancel_event.set()
                    return
            else:
                consecutive = 0
            stop_event.wait(timeout=poll_interval)
    finally:
        loop.close()


@contextlib.contextmanager
def watch_disconnect(request, poll_interval: float = CPU_WORKER_CANCEL_POLL_INTERVAL):
    """Context manager that polls `request.is_disconnected()` in the background.

    Yields a `threading.Event` that downstream code can check (or None if
    request is None — the no-op path). The event is also exposed via
    contextvar so downstream functions don't need to plumb it explicitly.
    """
    if request is None:
        token = _cancel_event_var.set(None)
        try:
            yield None
        finally:
            _cancel_event_var.reset(token)
        return

    cancel_event = threading.Event()
    stop_event = threading.Event()

    t = threading.Thread(
        target=_watchdog_loop,
        args=(request, cancel_event, stop_event, poll_interval),
        daemon=True,
        name="cancel-watchdog",
    )
    t.start()

    token = _cancel_event_var.set(cancel_event)
    try:
        yield cancel_event
    finally:
        stop_event.set()
        _cancel_event_var.reset(token)
