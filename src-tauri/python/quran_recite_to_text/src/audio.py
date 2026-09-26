"""Audio loading, decoding, and loudness normalization utilities."""

from __future__ import annotations

import os
import math
import subprocess
from typing import Optional
import numpy as np

from config import SAMPLE_RATE, CLIP_AUDIO_PEAKS


def _miniaudio_decode(file_path: str, sample_rate: int) -> np.ndarray:
    """Fast in-process C decoding via miniaudio (dr_mp3 / dr_wav / dr_flac).
    
    Zero subprocess overhead, zero pipe buffering, zero external dependencies.
    """
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


def _ffmpeg_pipe(source: str | bytes, sample_rate: int) -> np.ndarray:
    """Optimized streaming FFmpeg fallback for complex containers (m4a, aac, opus, etc.)."""
    is_bytes = isinstance(source, bytes)
    cmd = [
        'ffmpeg',
        '-v', 'quiet',
        '-nostdin',
        '-threads', '2',
        '-y',
        '-i', 'pipe:0' if is_bytes else source,
        '-vn', '-sn', '-dn',
        '-f', 'f32le',
        '-ac', '1',
        '-ar', str(sample_rate),
        '-',
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
    def load_audio_slice(
        cls,
        file_path: str,
        start_s: float = 0.0,
        duration_s: Optional[float] = None,
        sample_rate: int = SAMPLE_RATE,
    ) -> np.ndarray:
        """Fast-seek audio decoding for timeline slices without decoding entire file."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        # 1. Primary: Ultra-fast streaming FFmpeg seek (~0.05s)
        try:
            cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error']
            if start_s > 0:
                cmd.extend(['-ss', f"{start_s:.3f}"])
            if duration_s is not None and duration_s > 0:
                cmd.extend(['-t', f"{duration_s:.3f}"])
            cmd.extend([
                '-i', file_path,
                '-vn', '-sn', '-dn',
                '-f', 'f32le', '-ac', '1', '-ar', str(sample_rate), '-'
            ])
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            out, _ = proc.communicate()
            if proc.returncode == 0 and len(out) > 0:
                return np.frombuffer(out, dtype=np.float32)
        except Exception:
            pass

        # 2. Fallback: Full decode and NumPy slice
        full_audio = cls.load_audio_file(file_path, sample_rate=sample_rate)
        start_sample = max(0, int(round(start_s * sample_rate)))
        if duration_s is not None and duration_s > 0:
            end_sample = min(len(full_audio), start_sample + int(round(duration_s * sample_rate)))
        else:
            end_sample = len(full_audio)
        return full_audio[start_sample:end_sample]

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

        # 1. Primary: Ultra-fast in-process C decoding (MP3, WAV, FLAC)
        try:
            audio = _miniaudio_decode(file_path, sample_rate)
        except Exception:
            pass

        # 2. Secondary: Optimized streaming FFmpeg pipe (M4A, AAC, OPUS, etc.)
        if audio is None or len(audio) == 0:
            try:
                audio = _ffmpeg_pipe(file_path, sample_rate)
            except Exception:
                pass

        # 3. Tertiary: Soundfile / Librosa fallback
        if audio is None or len(audio) == 0:
            import soundfile as sf
            try:
                audio, sr = sf.read(file_path, dtype='float32')
                if getattr(audio, "ndim", 1) > 1:
                    audio = audio.mean(1)
                if sr != sample_rate:
                    from scipy.signal import resample_poly
                    import math
                    gcd = math.gcd(sample_rate, sr)
                    audio = resample_poly(audio, sample_rate // gcd, sr // gcd).astype(np.float32)
            except Exception:
                import librosa
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    audio, _ = librosa.load(file_path, sr=sample_rate, mono=True)
                    audio = audio.astype(np.float32)

        if audio is None or len(audio) == 0:
            raise RuntimeError(f"Failed to decode audio file: {file_path}")

        do_clip = CLIP_AUDIO_PEAKS if clip_peaks is None else clip_peaks
        if do_clip and len(audio) > 0:
            min_val = float(np.min(audio))
            max_val = float(np.max(audio))
            peak = max(abs(min_val), abs(max_val))
            if peak > 1.0:
                if audio.flags.writeable:
                    audio /= peak
                else:
                    audio = audio / peak

        return audio.astype(np.float32, copy=False)

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

        # 2. Secondary: Optimized streaming FFmpeg pipe
        if audio is None or len(audio) == 0:
            try:
                audio = _ffmpeg_pipe(audio_bytes, sample_rate)
            except Exception:
                pass

        # 3. Tertiary: Soundfile / Librosa fallback
        if audio is None or len(audio) == 0:
            import io, soundfile as sf
            audio, sr = sf.read(io.BytesIO(audio_bytes), dtype='float32')
            if audio.ndim > 1:
                audio = np.mean(audio, axis=1)
            if sr != sample_rate:
                from scipy.signal import resample_poly
                import math
                gcd = math.gcd(sample_rate, sr)
                audio = resample_poly(audio, sample_rate // gcd, sr // gcd).astype(np.float32)

        if audio is None or len(audio) == 0:
            raise RuntimeError("Failed to decode audio bytes")

        do_clip = CLIP_AUDIO_PEAKS if clip_peaks is None else clip_peaks
        if do_clip and len(audio) > 0:
            min_val = float(np.min(audio))
            max_val = float(np.max(audio))
            peak = max(abs(min_val), abs(max_val))
            if peak > 1.0:
                if audio.flags.writeable:
                    audio /= peak
                else:
                    audio = audio / peak

        return audio.astype(np.float32, copy=False)

