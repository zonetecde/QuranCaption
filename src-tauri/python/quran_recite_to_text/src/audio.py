"""Audio loading, decoding, and loudness normalization utilities."""

from __future__ import annotations

import os
import math
import subprocess
import warnings
from typing import Optional
import numpy as np

from config import SAMPLE_RATE, CLIP_AUDIO_PEAKS


def _miniaudio_decode(file_path: str, sample_rate: int) -> np.ndarray:
    """Fast in-process C decoding via miniaudio (dr_mp3 / dr_wav / dr_flac)."""
    import miniaudio
    decoded = miniaudio.decode_file(
        file_path,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=1,
        sample_rate=sample_rate,
    )
    return np.frombuffer(decoded.samples, dtype=np.float32)


def _miniaudio_decode_bytes(audio_bytes: bytes, sample_rate: int) -> np.ndarray:
    """Fast in-process C decoding from in-memory bytes via miniaudio."""
    import miniaudio
    decoded = miniaudio.decode(
        audio_bytes,
        output_format=miniaudio.SampleFormat.FLOAT32,
        nchannels=1,
        sample_rate=sample_rate,
    )
    return np.frombuffer(decoded.samples, dtype=np.float32)


def _resolve_ffmpeg_bin() -> str:
    """Finds ffmpeg binary from PATH or app's bundled binary directories."""
    import shutil
    found = shutil.which("ffmpeg")
    if found:
        return found
    from pathlib import Path
    curr = Path(__file__).resolve()
    for parent in list(curr.parents)[:5]:
        for sub in ("binaries/ffmpeg.exe", "resources/binaries/ffmpeg.exe", "binaries/ffmpeg", "resources/binaries/ffmpeg"):
            cand = parent / sub
            if cand.is_file():
                return str(cand)
    return "ffmpeg"


def _ffmpeg_pipe(source: str | bytes, sample_rate: int) -> np.ndarray:
    """Optimized streaming FFmpeg fallback for complex containers (m4a, aac, opus, etc.)."""
    is_bytes = isinstance(source, bytes)
    cmd = [
        _resolve_ffmpeg_bin(), "-v", "quiet", "-nostdin", "-threads", "2", "-y",
        "-i", "pipe:0" if is_bytes else source,
        "-vn", "-sn", "-dn", "-f", "f32le", "-ac", "1",
        "-ar", str(sample_rate), "-",
    ]
    pipe = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE if is_bytes else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=2 * 1024 * 1024,
    )
    raw, _ = pipe.communicate(input=source if is_bytes else None)
    if pipe.returncode == 0 and len(raw) > 0:
        return np.frombuffer(raw, dtype=np.float32)
    raise RuntimeError("FFmpeg pipe produced empty output")


def _resample_audio(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Resamples audio array to target sample rate using rational polyphase filtering."""
    if orig_sr != target_sr:
        from scipy.signal import resample_poly
        gcd = math.gcd(target_sr, orig_sr)
        return resample_poly(audio, target_sr // gcd, orig_sr // gcd).astype(np.float32)
    return audio.astype(np.float32, copy=False)


def _normalize_peaks(audio: np.ndarray, clip_peaks: Optional[bool] = None) -> np.ndarray:
    """Soft guard against clipping > 1.0."""
    if (CLIP_AUDIO_PEAKS if clip_peaks is None else clip_peaks) and len(audio) > 0:
        peak = float(np.max(np.abs(audio)))
        if peak > 1.0:
            if audio.flags.writeable:
                audio /= peak
            else:
                audio = audio / peak
    return audio.astype(np.float32, copy=False)


class AudioDecoder:
    """High-speed in-process audio loading with optimized fallback cascade."""
    target_sample_rate: int = SAMPLE_RATE

    @staticmethod
    def calculate_energy_db(samples: np.ndarray, start_idx: int = 0, end_idx: Optional[int] = None) -> float:
        end = len(samples) if end_idx is None else end_idx
        if (end - start_idx) <= 0 or len(samples) == 0:
            return -100.0
        rms = math.sqrt(max(0.0, float(np.mean(np.square(samples[start_idx:end])))))
        return float(20.0 * math.log10(max(rms, 1e-8)))

    @classmethod
    def load_audio_file(
        cls,
        file_path: str,
        sample_rate: int = SAMPLE_RATE,
        clip_peaks: Optional[bool] = None,
    ) -> np.ndarray:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        audio = None

        # 1. Primary: In-process C decoding (MP3, WAV, FLAC)
        try:
            audio = _miniaudio_decode(file_path, sample_rate)
        except Exception:
            pass

        # 2. Secondary: Streaming FFmpeg pipe (M4A, AAC, OPUS, etc.)
        if audio is None or len(audio) == 0:
            try:
                audio = _ffmpeg_pipe(file_path, sample_rate)
            except Exception:
                pass

        # 3. Tertiary: Optional Soundfile fallback if available in environment
        if audio is None or len(audio) == 0:
            try:
                import soundfile as sf
                audio, sr = sf.read(file_path, dtype="float32")
                if getattr(audio, "ndim", 1) > 1:
                    audio = audio.mean(axis=1)
                audio = _resample_audio(audio, sr, sample_rate)
            except Exception:
                pass

        if audio is None or len(audio) == 0:
            raise RuntimeError(f"Failed to decode audio file: {file_path}")

        return _normalize_peaks(audio, clip_peaks)

    @classmethod
    def decode_bytes(
        cls,
        audio_bytes: bytes,
        sample_rate: int = SAMPLE_RATE,
        clip_peaks: Optional[bool] = None,
    ) -> np.ndarray:
        audio = None

        # 1. Primary: In-process C decoding from bytes
        try:
            audio = _miniaudio_decode_bytes(audio_bytes, sample_rate)
        except Exception:
            pass

        # 2. Secondary: Streaming FFmpeg pipe
        if audio is None or len(audio) == 0:
            try:
                audio = _ffmpeg_pipe(audio_bytes, sample_rate)
            except Exception:
                pass

        # 3. Tertiary: Optional Soundfile fallback if installed
        if audio is None or len(audio) == 0:
            try:
                import io, soundfile as sf
                audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
                if getattr(audio, "ndim", 1) > 1:
                    audio = audio.mean(axis=1)
                audio = _resample_audio(audio, sr, sample_rate)
            except Exception:
                pass

        if audio is None or len(audio) == 0:
            raise RuntimeError("Failed to decode audio bytes")

        return _normalize_peaks(audio, clip_peaks)


