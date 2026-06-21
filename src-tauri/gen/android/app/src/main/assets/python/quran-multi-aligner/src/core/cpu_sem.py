"""Counted bounded semaphore — exposes peer counts for usage logging.

`threading.BoundedSemaphore` has no public API for "how many holders are
currently inside the critical section". We need that number to log
`peers_at_acquire` / `peers_at_release` for CPU subprocess dispatch, and
relying on the private `sem._value` breaks across Python minor versions.

This subclass maintains its own holder count under the semaphore's internal
condition variable. Peers-at-acquire and peers-at-release are captured as
snapshots — `peak_peers_during_run` is deliberately deferred to a later
version (pairwise-join analysis over the two snapshots covers most
"what concurrency am I running at?" questions already).
"""

import threading
import time
from typing import Tuple


class CountedBoundedSemaphore(threading.BoundedSemaphore):
    """BoundedSemaphore that tracks live holder count alongside each acquire/release."""

    def __init__(self, value: int = 1):
        super().__init__(value)
        self._capacity = value
        self._holders = 0

    def acquire_with_stats(self, blocking: bool = True, timeout: float | None = None
                           ) -> Tuple[float, int]:
        """Acquire a token; return (wait_seconds, peers_at_acquire).

        `peers_at_acquire` is the number of holders OTHER than this caller
        currently inside the critical section at the moment we obtained our
        slot — 0 when we ran solo, N when N peers were active.
        """
        t0 = time.monotonic()
        super().acquire(blocking=blocking, timeout=timeout)
        with self._cond:
            peers_before_self = self._holders
            self._holders += 1
        wait_s = time.monotonic() - t0
        return wait_s, peers_before_self

    def release_with_stats(self) -> int:
        """Release a token; return peers_at_release (excluding self).

        Captured before decrementing, so matches the semantics of
        peers_at_acquire.
        """
        with self._cond:
            peers_before_release = max(0, self._holders - 1)
            self._holders -= 1
        super().release()
        return peers_before_release

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def current_holders(self) -> int:
        """Snapshot read; not used for precision but handy for debug logging."""
        with self._cond:
            return self._holders
