"""Quran Aligner — Automatic Quran recitation segmentation and alignment.
Copyright 2026 Wider Community. Licensed under Apache 2.0.
See LICENSE in the repository root."""
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

# Log Cython DP status
try:
    from src.alignment.phoneme_matcher import _USE_CYTHON_DP
    print(f"Cython DP: {'enabled' if _USE_CYTHON_DP else 'disabled (pure Python fallback)'}")
except ImportError:
    print("Cython DP: disabled (import error)")

# Start YouTube PO token server (needed for yt-dlp on datacenter IPs)
_pot_server_dir = _app_path / ".pot-server"
_pot_main = _pot_server_dir / "server" / "build" / "main.js"
if not _pot_main.exists():
    print("Setting up PO token server...")
    subprocess.run(["git", "clone", "--depth=1", "--single-branch",
                    "https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git",
                    str(_pot_server_dir)], capture_output=True)
    subprocess.run(["npm", "ci"], cwd=str(_pot_server_dir / "server"), capture_output=True)
    subprocess.run(["npx", "tsc"], cwd=str(_pot_server_dir / "server"), capture_output=True)
if _pot_main.exists():
    subprocess.Popen(["node", str(_pot_main)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("PO token server started on port 4416")
else:
    print("PO token server setup failed (YouTube downloads may not work)")

from src.ui.interface import build_interface

# =============================================================================
# Module-level demo for Gradio hot-reload (`gradio app.py`)
# =============================================================================
demo = build_interface()

# Concurrency: main Space serves many parallel requests (GPU requests funnel into
# ZeroGPU's own queue; CPU-dispatches are cheap I/O to worker Spaces). Worker Spaces
# run single-threaded — 2 vCPUs would thrash under concurrent ML inference.
from src.core.zero_gpu import IS_CPU_WORKER
demo.queue(default_concurrency_limit=1 if IS_CPU_WORKER else 20)

# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()

    # =============================================================================
    # Persistent CPU worker pool — spawn BEFORE any GPU use if enabled.
    # Must be inside __main__ guard: spawn re-imports app.py as __mp_main__ during
    # worker bootstrap; without the guard, module-level Process.start() would be
    # called inside a spawned child, triggering the "bootstrapping phase" error.
    # =============================================================================
    try:
        from config import (
            CPU_STRATEGY as _CPU_STRATEGY,
            CPU_WORKER_MODE as _CPU_WORKER_MODE,
            CPU_SUBPROCESS_CONCURRENCY as _CPU_SUBPROCESS_CONCURRENCY,
            CPU_POOL_PRELOAD_LARGE as _CPU_POOL_PRELOAD_LARGE,
        )
        from src.core.zero_gpu import IS_CPU_WORKER as _IS_CPU_WORKER
        if (
            _CPU_STRATEGY == "subprocess"
            and _CPU_WORKER_MODE == "persistent"
            and not _IS_CPU_WORKER
        ):
            print(f"[APP] Bootstrapping persistent CPU pool: {_CPU_SUBPROCESS_CONCURRENCY} worker(s), preload_large={_CPU_POOL_PRELOAD_LARGE}")
            from src.core.cpu_worker_pool import start_pool as _start_pool
            _start_pool(_CPU_SUBPROCESS_CONCURRENCY, preload_large=_CPU_POOL_PRELOAD_LARGE)
    except Exception as _e:
        print(f"[APP] Persistent CPU pool bootstrap failed (non-fatal): {_e}")

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
    parser.add_argument("--dev", action="store_true", help="Dev mode: skip model preloading for fast startup")
    args = parser.parse_args()

    port = 7860

    print(f"ZeroGPU available: {ZERO_GPU_AVAILABLE}")
    print(f"Launching Gradio on port {port}")

    if args.dev:
        print("Dev mode: skipping model preloading (models load on first request)")
    else:
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

    # Telemetry sampler — daemon thread samples host + CPU pool every N seconds
    # and flushes to the telemetry dataset. Skip on CPU workers (they have no
    # pool of their own and don't host the main Space's schedulers).
    from src.core.zero_gpu import IS_CPU_WORKER as _IS_CPU_WORKER_TEL
    if not _IS_CPU_WORKER_TEL:
        try:
            from src.core.telemetry_sampler import start_sampler
            start_sampler()
        except Exception as _e:
            print(f"[APP] Telemetry sampler start failed (non-fatal): {_e}")

    # AoT compilation for VAD model (requires GPU lease — skip on CPU workers)
    from src.core.zero_gpu import IS_CPU_WORKER
    if IS_HF_SPACE and ZERO_GPU_AVAILABLE and not IS_CPU_WORKER:
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
        ssr_mode=False,  # Gradio 6.5.1 SSR probes localhost; fails on some HF container restarts
    )
