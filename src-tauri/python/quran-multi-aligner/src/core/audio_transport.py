"""Audio transport encodings for CPU worker dispatch.

When main Space dispatches a pipeline function to a worker, the audio
numpy array dominates the HTTP payload. These encodings let the transport
layer trade CPU-time (encode/decode) for bytes-on-wire.

Transports
----------
- float32  : baseline, no conversion
- int16    : cast float32 audio (values in [-1, 1]) to int16 PCM → 2x smaller
- ogg      : Vorbis-encoded OGG via soundfile → ~10-30x smaller for speech

All transports work inside the existing pickle-base64-JSON envelope. They
differ only in what bytes represent the audio array in `args`.

Encoding contract
-----------------
The first numpy.ndarray with dtype float32 and ndim == 1 in `args` is
treated as the audio. That matches the calling convention of
run_vad_and_asr_gpu / run_phoneme_asr_gpu / etc. Non-audio args pass
through untouched.

`encode_args_for_transport` and `decode_args_for_transport` are inverse
functions; worker runs decode, gets back a structurally-equivalent args
tuple with float32 audio at the original index.
"""

import io
from typing import Any, Tuple

import numpy as np


# --- Helpers ---------------------------------------------------------------

def _find_audio_index(args: tuple) -> int:
    """Return index of the first float32 1-D numpy array in args, or -1."""
    for i, a in enumerate(args):
        if isinstance(a, np.ndarray) and a.ndim == 1 and a.dtype == np.float32:
            return i
    return -1


def _replace_at(args: tuple, idx: int, value: Any) -> tuple:
    new = list(args)
    new[idx] = value
    return tuple(new)


# --- int16 -----------------------------------------------------------------

def _encode_int16(audio: np.ndarray) -> np.ndarray:
    """Cast float32 audio (nominally [-1, 1]) to int16 PCM with clipping."""
    return np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)


def _decode_int16(audio_int16: np.ndarray) -> np.ndarray:
    return audio_int16.astype(np.float32) / 32767.0


# --- OGG Vorbis ------------------------------------------------------------
# libsndfile 1.2.2 (ships with soundfile 0.13) segfaults when writing OGG Vorbis
# for large buffers (~15M+ samples). ffmpeg is ~1 MB smaller output than libsndfile
# on speech, doesn't crash at any length, and is pre-installed on HF Spaces.
# We keep soundfile for *reading* OGG (works fine for all sizes we've tested).

def _encode_ogg(audio: np.ndarray, sample_rate: int = 16000) -> bytes:
    """Encode float32 audio to OGG Vorbis bytes via ffmpeg."""
    import subprocess
    # Input to ffmpeg is s16le (smaller than f32le, same audio fidelity after MP3 source)
    audio_int16 = np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
         "-c:a", "libvorbis", "-f", "ogg", "pipe:1"],
        input=audio_int16.tobytes(), capture_output=True, check=True,
    )
    return p.stdout


def _decode_ogg(ogg_bytes: bytes) -> np.ndarray:
    import soundfile as sf
    buf = io.BytesIO(ogg_bytes)
    audio, _ = sf.read(buf, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio.astype(np.float32)


# --- Public API ------------------------------------------------------------

VALID_TRANSPORTS = ("float32", "int16", "ogg")


def encode_args_for_transport(args: tuple, transport: str) -> Tuple[tuple, dict]:
    """Return (encoded_args, meta). `meta` is pickled alongside.

    meta always contains `transport`. For OGG and int16, also contains
    `audio_idx` so decode knows where to restore the audio.
    """
    if transport not in VALID_TRANSPORTS:
        raise ValueError(f"Unknown transport '{transport}'; valid: {VALID_TRANSPORTS}")

    if transport == "float32":
        return args, {"transport": "float32"}

    idx = _find_audio_index(args)
    if idx < 0:
        # No audio detected — pass through
        return args, {"transport": transport, "audio_idx": -1}

    audio = args[idx]
    if transport == "int16":
        encoded = _encode_int16(audio)
    elif transport == "ogg":
        encoded = _encode_ogg(audio)

    return _replace_at(args, idx, encoded), {
        "transport": transport,
        "audio_idx": idx,
        "orig_len": int(len(audio)),
    }


def decode_args_for_transport(args: tuple, meta: dict) -> tuple:
    transport = meta.get("transport", "float32")
    if transport == "float32":
        return args

    idx = meta.get("audio_idx", -1)
    if idx < 0 or idx >= len(args):
        return args

    encoded = args[idx]
    if transport == "int16":
        audio = _decode_int16(encoded)
    elif transport == "ogg":
        audio = _decode_ogg(encoded)
    else:
        return args

    return _replace_at(args, idx, audio)
