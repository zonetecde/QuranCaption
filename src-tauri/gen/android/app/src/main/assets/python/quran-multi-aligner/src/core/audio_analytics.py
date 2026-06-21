"""Audio analytics for usage logging.

Computed synchronously at log-write time, after the pipeline has already
yielded its final result to the caller. Inputs (waveform + VAD speech
intervals) are already in scope, so wall-time impact on the UI is
invisible.

Granularities:
    - whole     : full post-resample waveform
    - speech    : concat of VAD speech intervals (actual recitation)
    - nonspeech : concat of VAD gaps (room tone / noise floor / hum)

SNR is 20*log10(rms_speech / rms_nonspeech). If either region is empty
(e.g. pure-speech clip with no VAD gaps), SNR is null.
"""
from __future__ import annotations

import time
import numpy as np

try:
    from scipy import signal as _sig
    _HAVE_SCIPY = True
except Exception:
    _HAVE_SCIPY = False

_EPS = 1e-12

_HUM_TARGETS = {
    "hum_50hz_db": (50.0, 100.0, 150.0),
    "hum_60hz_db": (60.0, 120.0, 180.0),
}


def _db(x: float) -> float:
    return float(20.0 * np.log10(max(x, _EPS)))


def _rms(a: np.ndarray) -> float:
    if a.size == 0:
        return 0.0
    return float(np.sqrt(np.dot(a, a) / a.size))


def _concat_intervals(audio: np.ndarray, sr: int,
                      intervals_s, invert: bool = False) -> np.ndarray:
    """Concatenate audio from (start_s, end_s) intervals.

    invert=True returns the complement (gaps between the given intervals,
    plus head/tail if the intervals don't cover the full clip).
    """
    if intervals_s is None or len(intervals_s) == 0:
        return audio if invert else np.asarray([], dtype=audio.dtype)
    n = audio.size
    samples = []
    for s, e in intervals_s:
        ss = max(0, int(float(s) * sr))
        ee = min(n, int(float(e) * sr))
        if ee > ss:
            samples.append((ss, ee))
    if not samples:
        return audio if invert else np.asarray([], dtype=audio.dtype)
    # Sort (VAD output already sorted, but be defensive)
    samples.sort()
    if invert:
        gaps = []
        cur = 0
        for s, e in samples:
            if s > cur:
                gaps.append((cur, s))
            cur = e
        if cur < n:
            gaps.append((cur, n))
        samples = gaps
        if not samples:
            return np.asarray([], dtype=audio.dtype)
    parts = [audio[s:e] for s, e in samples]
    return np.concatenate(parts)


def _psd(a: np.ndarray, sr: int):
    """Welch PSD. Returns (freqs, pxx) or (empty, empty) if region too short."""
    if not _HAVE_SCIPY or a.size < 512:
        return np.asarray([]), np.asarray([])
    nperseg = 4096 if a.size >= 4096 else 1 << (a.size.bit_length() - 1)
    f, pxx = _sig.welch(a, fs=sr, nperseg=nperseg)
    return f, pxx


def _spectral_centroid_hz(f, pxx) -> float:
    if f.size == 0:
        return 0.0
    s = pxx.sum()
    if s <= 0:
        return 0.0
    return float((f * pxx).sum() / s)


def _spectral_rolloff_hz(f, pxx, pct: float = 0.85) -> float:
    if f.size == 0:
        return 0.0
    cum = np.cumsum(pxx)
    total = cum[-1]
    if total <= 0:
        return 0.0
    idx = int(np.searchsorted(cum, pct * total))
    idx = min(idx, f.size - 1)
    return float(f[idx])


def _spectral_flatness(pxx) -> float:
    """Wiener entropy: geometric_mean / arithmetic_mean of PSD bins.

    1.0 = white noise (flat spectrum). 0.0 = pure tone. Low flatness on
    non-speech regions hints at hum or tonal interference.
    """
    if pxx.size == 0:
        return 0.0
    p = np.maximum(pxx, _EPS)
    gm = float(np.exp(np.log(p).mean()))
    am = float(p.mean())
    return gm / am if am > 0 else 0.0


def _bandwidth_hz(f, pxx, drop_db: float = 60.0) -> float:
    """Highest freq bin where PSD is within `drop_db` of peak.

    Proxy for recording bandwidth — 8kHz band-limited audio (phone, lossy)
    returns ~3-4kHz; full-band studio returns near Nyquist.
    """
    if f.size == 0:
        return 0.0
    pdb = 10.0 * np.log10(np.maximum(pxx, _EPS))
    threshold = pdb.max() - drop_db
    above = np.where(pdb >= threshold)[0]
    if above.size == 0:
        return 0.0
    return float(f[above[-1]])


def _hum_db(f, pxx, targets: tuple, tol_hz: float = 3.0) -> float:
    """Peak PSD across target freqs ± tol_hz, in dB/Hz."""
    if f.size == 0:
        return -120.0
    best = _EPS
    for t in targets:
        mask = (f >= t - tol_hz) & (f <= t + tol_hz)
        if mask.any():
            peak = float(pxx[mask].max())
            if peak > best:
                best = peak
    return round(10.0 * np.log10(max(best, _EPS)), 2)


def _whole_block(audio: np.ndarray, sr: int) -> dict:
    rms = _rms(audio)
    abs_a = np.abs(audio)
    peak = float(abs_a.max()) if audio.size else 0.0
    dc = float(audio.mean()) if audio.size else 0.0
    p99 = float(np.percentile(abs_a, 99)) if audio.size else 0.0
    p01 = float(np.percentile(abs_a, 1)) if audio.size else 0.0
    crest = (peak / rms) if rms > _EPS else 0.0
    f, pxx = _psd(audio, sr)
    return {
        "rms":          round(rms, 5),
        "rms_db":       round(_db(rms), 2),
        "peak":         round(peak, 5),
        "peak_db":      round(_db(peak), 2),
        "dc_offset":    round(dc, 6),
        "p99":          round(p99, 5),
        "p01":          round(p01, 5),
        "crest":        round(crest, 3),
        "dyn_range_db": round(_db(p99) - _db(max(p01, _EPS)), 2),
        "bandwidth_hz": round(_bandwidth_hz(f, pxx), 1),
        "duration_s":   round(audio.size / sr, 3),
    }


def _speech_block(speech: np.ndarray, sr: int) -> dict:
    rms = _rms(speech)
    f, pxx = _psd(speech, sr)
    return {
        "rms":                  round(rms, 5),
        "rms_db":               round(_db(rms), 2),
        "spectral_centroid_hz": round(_spectral_centroid_hz(f, pxx), 1),
        "spectral_rolloff_hz":  round(_spectral_rolloff_hz(f, pxx), 1),
        "bandwidth_hz":         round(_bandwidth_hz(f, pxx), 1),
        "duration_s":           round(speech.size / sr, 3),
    }


def _nonspeech_block(nonspeech: np.ndarray, sr: int) -> dict:
    rms = _rms(nonspeech)
    f, pxx = _psd(nonspeech, sr)
    out = {
        "rms":                  round(rms, 5),
        "rms_db":               round(_db(rms), 2),
        "spectral_flatness":    round(_spectral_flatness(pxx), 4),
        "spectral_centroid_hz": round(_spectral_centroid_hz(f, pxx), 1),
        "duration_s":           round(nonspeech.size / sr, 3),
    }
    for key, targets in _HUM_TARGETS.items():
        out[key] = _hum_db(f, pxx, targets)
    return out


def compute_audio_analytics(audio: np.ndarray, sr: int,
                            speech_intervals_s) -> dict:
    """Compute whole/speech/nonspeech + SNR analytics.

    Expected runtime ~100-800ms depending on audio length and scipy FFT
    cache warmth. Caller is responsible for choosing when to run (after
    user-visible response has been delivered).

    Returns {} on empty input. Speech/nonspeech blocks may be {} if the
    respective concatenated region is empty (e.g. pure silence, or VAD
    intervals cover the full clip).
    """
    t0 = time.time()
    if audio is None or getattr(audio, "size", 0) == 0:
        return {}
    # Ensure float32 for numerical ops
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32, copy=False)

    whole = _whole_block(audio, sr)
    speech = _concat_intervals(audio, sr, speech_intervals_s, invert=False)
    nonspeech = _concat_intervals(audio, sr, speech_intervals_s, invert=True)
    speech_b = _speech_block(speech, sr) if speech.size else {}
    nonspeech_b = _nonspeech_block(nonspeech, sr) if nonspeech.size else {}

    snr_db = None
    rs = speech_b.get("rms")
    rn = nonspeech_b.get("rms")
    if rs and rn and rs > _EPS and rn > _EPS:
        snr_db = round(20.0 * float(np.log10(rs / rn)), 2)

    return {
        "whole":      whole,
        "speech":     speech_b,
        "nonspeech":  nonspeech_b,
        "snr_db":     snr_db,
        "noise_floor_rms": nonspeech_b.get("rms"),  # convenience for per-segment SNR
        "compute_ms": round((time.time() - t0) * 1000, 1),
    }


def compute_noise_floor_rms(audio: np.ndarray, sr: int,
                            speech_intervals_s) -> float | None:
    """Fast path: RMS of the concatenated non-speech region only.

    Cheap (~10-50ms even on 48-min clips — one concat + one dot product).
    Used sync at log-write time so `segments[*].audio_stats.snr_db` can be
    populated on the response path while the full `audio_analytics` dict
    (with the expensive Welch PSDs) is computed post-yield in a bg thread.

    Returns None if the non-speech concat is empty or audio invalid.
    """
    if audio is None or getattr(audio, "size", 0) == 0:
        return None
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32, copy=False)
    nonspeech = _concat_intervals(audio, sr, speech_intervals_s, invert=True)
    if nonspeech.size == 0:
        return None
    return _rms(nonspeech)


def segment_audio_stats(audio: np.ndarray, sr: int,
                        start_s: float, end_s: float,
                        noise_floor_rms: float | None) -> dict:
    """Per-segment {rms, peak, snr_db}. Cheap — one slice + one dot.

    SNR is relative to the clip-level noise floor (non-speech concat RMS).
    Null if noise floor unavailable or zero.
    """
    n = audio.size
    ss = max(0, int(float(start_s) * sr))
    ee = min(n, int(float(end_s) * sr))
    if ee <= ss:
        return {"rms": 0.0, "peak": 0.0, "snr_db": None}
    slc = audio[ss:ee]
    rms = _rms(slc)
    peak = float(np.abs(slc).max()) if slc.size else 0.0
    snr = None
    if noise_floor_rms and noise_floor_rms > _EPS and rms > _EPS:
        snr = round(20.0 * float(np.log10(rms / noise_floor_rms)), 2)
    return {
        "rms":    round(rms, 5),
        "peak":   round(peak, 5),
        "snr_db": snr,
    }
