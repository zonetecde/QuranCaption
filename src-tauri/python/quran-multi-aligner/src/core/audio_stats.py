"""Audio amplitude stats for usage logging (detect clipping / very-quiet recordings)."""

import numpy as np


def audio_rms_peak(audio: np.ndarray) -> tuple[float, float]:
    """Return (rms, peak_abs) for a mono float32 waveform.

    Single-pass: one dot product for sum-of-squares, one min/max pair for peak.
    Benchmark: 2.4ms on 5-min audio, 63ms on 48-min audio. See
    docs/usage-logging-v3-planning.md §audio_rms for method comparison.
    """
    if audio is None or audio.size == 0:
        return 0.0, 0.0
    mn = float(np.min(audio))
    mx = float(np.max(audio))
    peak = max(abs(mn), abs(mx))
    rms = float(np.sqrt(np.dot(audio, audio) / audio.size))
    return rms, peak
