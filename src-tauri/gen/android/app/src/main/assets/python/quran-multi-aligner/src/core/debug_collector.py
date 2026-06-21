"""Thread-local debug data collector for the hidden debug API.

When active, pipeline stages append structured debug data to the collector
instead of (or in addition to) printing to stdout. The collector is the
single source of truth for the debug endpoint response.
"""

import threading

_ctx = threading.local()


class DebugCollector:
    """Accumulates structured debug data from all pipeline stages."""

    __slots__ = ("vad", "asr", "anchor", "specials", "alignment", "events", "_profiling")

    def __init__(self):
        self._profiling = None  # ProfilingData set by pipeline after completion
        self.vad = {}           # raw/cleaned intervals, counts, params
        self.asr = {}           # per-segment phonemes, model info
        self.anchor = {}        # voting results, surah ranking, best run
        self.specials = {       # special segment detection
            "candidates_tested": [],
            "detected": [],
            "first_quran_idx": 0,
        }
        self.alignment = []     # per-segment DP results
        self.events = []        # reanchors, chapter transitions, retries, gaps, etc.

    def add_event(self, event_type, **kwargs):
        """Append a pipeline event (gap, retry, reanchor, transition, etc.)."""
        self.events.append({"type": event_type, **kwargs})

    def add_special_candidate(self, segment_idx, candidate_type, edit_distance,
                              threshold, matched):
        """Record a special/transition detection attempt."""
        self.specials["candidates_tested"].append({
            "segment_idx": segment_idx,
            "type": candidate_type,
            "edit_distance": round(edit_distance, 4),
            "threshold": threshold,
            "matched": matched,
        })

    def add_special_detected(self, segment_idx, special_type, confidence):
        """Record a confirmed special segment detection."""
        self.specials["detected"].append({
            "segment_idx": segment_idx,
            "type": special_type,
            "confidence": round(confidence, 4),
        })

    def add_alignment_result(self, segment_idx, asr_phonemes, window,
                             expected_pointer, result=None, timing=None,
                             retry_tier=None, failed_reason=None,
                             R=None, R_phone_to_word=None,
                             j_start=None, best_j=None,
                             win_start=None, win_end=None,
                             basmala_consumed=False):
        """Record a per-segment alignment result.

        Extra kwargs (`R`, `R_phone_to_word`, `j_start`, `best_j`, `win_start`,
        `win_end`, `basmala_consumed`) are stored raw so `to_dp_debug(idx)` can
        lazily render the `|`-separated P / R-window / R-locked strings at log
        time. Avoids string-join cost on non-success retry paths.
        """
        entry = {
            "segment_idx": segment_idx,
            "asr_phonemes": " ".join(asr_phonemes[:60]) + ("..." if len(asr_phonemes) > 60 else ""),
            "asr_phoneme_count": len(asr_phonemes),
            "window": window,
            "expected_pointer": expected_pointer,
            "retry_tier": retry_tier,
        }
        if result is not None:
            entry["result"] = result
        if timing is not None:
            entry["timing"] = {
                "window_setup_ms": round(timing.get("window_setup_time", 0) * 1000, 3),
                "dp_ms": round(timing.get("dp_time", 0) * 1000, 3),
                "result_build_ms": round(timing.get("result_build_time", 0) * 1000, 3),
            }
        if failed_reason is not None:
            entry["failed_reason"] = failed_reason
        # Raw DP state kept under a private key (not in the public debug API
        # response — serialized via to_dp_debug() only when building log rows).
        # Prefer explicit kwargs, fall back to `timing['dp_trace']` populated
        # by align_segment() for zero-touch call sites.
        trace = None
        if R is not None:
            trace = {
                "R": list(R),
                "R_phone_to_word": list(R_phone_to_word) if R_phone_to_word is not None else None,
                "j_start": j_start,
                "best_j": best_j,
                "win_start": win_start,
                "win_end": win_end,
                "basmala_consumed": basmala_consumed,
            }
        elif isinstance(timing, dict) and timing.get("dp_trace"):
            trace = dict(timing["dp_trace"])
        if trace is not None:
            trace["asr_phonemes_full"] = list(asr_phonemes)
            entry["_dp_raw"] = trace
        self.alignment.append(entry)

    def to_dp_debug(self, segment_idx: int) -> dict | None:
        """Render `|`-separated DP strings for a segment (for log rows).

        Returns None if no raw DP state was recorded for this segment (e.g.
        failed-retry paths that never called `add_alignment_result` with R).
        """
        raw = None
        for entry in self.alignment:
            if entry.get("segment_idx") == segment_idx and "_dp_raw" in entry:
                raw = entry["_dp_raw"]
                break
        if raw is None:
            return None

        R = raw["R"]
        R_phone_to_word = raw["R_phone_to_word"] or []
        j_start = raw.get("j_start")
        best_j = raw.get("best_j")
        basmala_consumed = raw.get("basmala_consumed", False)

        def _boundary_render(phonemes: list, phone_to_word: list) -> str:
            """Emit phonemes space-separated with `|` at each word boundary.

            The Basmala sentinel (-1) renders as a single `B` token. Consecutive
            Basmala positions collapse into one `B` segment.
            """
            if not phonemes:
                return ""
            out = []
            prev_word = None
            for i, ph in enumerate(phonemes):
                w = phone_to_word[i] if i < len(phone_to_word) else None
                if prev_word is None:
                    pass  # first token — no leading separator
                elif w != prev_word:
                    out.append("|")
                if w == -1:  # Basmala sentinel
                    # Collapse run of sentinel phones into a single "B"
                    if not out or out[-1] != "B":
                        out.append("B")
                else:
                    out.append(ph)
                prev_word = w
            return " ".join(out)

        r_window = _boundary_render(R, R_phone_to_word)
        if j_start is not None and best_j is not None:
            r_locked = _boundary_render(R[j_start:best_j], R_phone_to_word[j_start:best_j])
        else:
            r_locked = ""
        asr_p = " ".join(raw["asr_phonemes_full"])

        nd = raw.get("norm_dist")
        out = {
            "asr_p": asr_p,
            "r_window": r_window,
            "r_locked": r_locked,
            "r_window_word_range": [raw.get("win_start"), raw.get("win_end")],
            "basmala_consumed": basmala_consumed,
        }
        # DP outcomes — populated by align_segment on all paths (success +
        # both failure modes). Lets retry-exhausted segments log their best
        # candidate instead of the conf=0 sentinel being the only signal.
        if nd is not None:
            out["norm_dist"] = round(float(nd), 4)
            out["best_conf"] = round(1.0 - float(nd), 4)
        if raw.get("best_cost") is not None:
            out["best_cost"] = round(float(raw["best_cost"]), 4)
        if raw.get("n_wraps"):
            out["n_wraps"] = int(raw["n_wraps"])
        if raw.get("max_j_reached"):
            out["max_j_reached"] = int(raw["max_j_reached"])
        if raw.get("threshold") is not None:
            out["threshold"] = round(float(raw["threshold"]), 4)
        if raw.get("threshold_failed"):
            out["threshold_failed"] = True
        return out

    def to_dict(self):
        """Serialize collector to JSON-safe dict."""
        return {
            "vad": self.vad,
            "asr": self.asr,
            "anchor": self.anchor,
            "specials": self.specials,
            "alignment_detail": self.alignment,
            "events": self.events,
        }


def start_debug_collection():
    """Activate a DebugCollector for the current thread."""
    _ctx.collector = DebugCollector()


def get_debug_collector():
    """Return the active collector, or None if not in debug mode."""
    return getattr(_ctx, "collector", None)


def ensure_collector() -> "DebugCollector":
    """Return the active collector, starting one if none exists on this thread.

    Called at request entry so v3 log rows always carry `events` / `anchor`
    / per-segment `dp_debug` — not only `/debug_process` debug runs.
    """
    c = getattr(_ctx, "collector", None)
    if c is None:
        c = DebugCollector()
        _ctx.collector = c
    return c


def stop_debug_collection():
    """Deactivate and return the collector for the current thread."""
    c = getattr(_ctx, "collector", None)
    _ctx.collector = None
    return c
