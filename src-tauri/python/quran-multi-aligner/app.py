"""Quran Aligner — Automatic Quran recitation segmentation and alignment."""
import os
import sys
from pathlib import Path

# Suppress HF model download progress bars (hundreds of lines on cold start)
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

# Load .env file for local dev (HF_TOKEN for private model access)
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _val = _line.split("=", 1)
            os.environ.setdefault(_key.strip(), _val.strip())

# Add paths for imports BEFORE importing anything else
_app_path = Path(__file__).parent.resolve()
sys.path.insert(0, str(_app_path))

# Build Cython extensions in-place (falls back to pure Python if it fails)
import subprocess
subprocess.run(
    [sys.executable, str(_app_path / "setup.py"), "build_ext", "--inplace"],
    cwd=str(_app_path),
    capture_output=True,
)

from src.ui.interface import build_interface

# =============================================================================
# Module-level demo for Gradio hot-reload (`gradio app.py`)
# =============================================================================
demo = build_interface()

# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    import argparse
    import numpy as np
    import librosa
    from config import PORT, IS_HF_SPACE, RESAMPLE_TYPE
    from src.core.zero_gpu import ZERO_GPU_AVAILABLE
    from src.segmenter.segmenter_model import load_segmenter
    from src.segmenter.segmenter_aoti import apply_aoti_compiled
    from src.pipeline import test_aoti_compilation_gpu
    from src.alignment.phoneme_asr import load_phoneme_asr
    from src.alignment.ngram_index import get_ngram_index
    from src.alignment.phoneme_matcher_cache import preload_all_chapters

    parser = argparse.ArgumentParser()
    parser.add_argument("--share", action="store_true", help="Create public link")
    parser.add_argument("--port", type=int, default=PORT, help="Port to run on")
    args = parser.parse_args()

    port = 7860

    print(f"ZeroGPU available: {ZERO_GPU_AVAILABLE}")
    print(f"Launching Gradio on port {port}")

    # Preload models and caches at startup so first request is fast
    print("Preloading models...")
    load_segmenter()
    load_phoneme_asr("Base")
    load_phoneme_asr("Large")
    print("Models preloaded.")
    print("Preloading caches...")
    get_ngram_index()
    preload_all_chapters()
    print("Caches preloaded.")

    # Warm up soxr resampler so first request doesn't pay initialization cost
    _dummy = librosa.resample(np.zeros(1600, dtype=np.float32),
                              orig_sr=44100, target_sr=16000, res_type=RESAMPLE_TYPE)
    del _dummy
    print("Resampler warmed up.")

    # AoT compilation for VAD model (requires GPU lease)
    if IS_HF_SPACE and ZERO_GPU_AVAILABLE:
        print("Running AoT compilation for VAD model...")
        try:
            aoti_result = test_aoti_compilation_gpu()
            print(f"AoT compile result: {aoti_result}")
            # Apply compiled model OUTSIDE GPU lease (critical for persistence)
            if aoti_result.get("compiled"):
                apply_aoti_compiled(aoti_result["compiled"])
        except Exception as e:
            print(f"AoT compilation failed (non-fatal): {e}")

    demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        share=args.share,
        allowed_paths=["/tmp"],
    )
