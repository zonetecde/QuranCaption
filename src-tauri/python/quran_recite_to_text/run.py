"""Command Line Offline Runner."""

import os
import sys
import time
import argparse
import json
import contextlib
import io
import subprocess
from pathlib import Path

if sys.stdout is not None:
    sys.stdout.reconfigure(encoding='utf-8')

_app_path = Path(__file__).parent.resolve()
sys.path.insert(0, str(_app_path))


def ensure_dependencies():
    """Ensure required packages are installed."""
    try:
        import numpy
        import librosa
        import pyloudnorm
        import onnxruntime
        import kaldi_native_fbank
        import sherpa_onnx
        import qua_sdk
    except ImportError as e:
        req_path = _app_path / "requirements.txt"
        if req_path.exists():
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_path)])
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception as ex:
                sys.exit(1)
        else:
            sys.exit(1)


def preload_caches():
    """Preload Quran index and character matching resources silently."""
    try:
        from qua_sdk.domain import load_chapter_refs, load_ngram_index, load_quran_index, load_sub_costs
        from src.phase2_matching.normalize import get_arabic_resources

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            load_quran_index()
            load_ngram_index("full")
            load_chapter_refs("full")
            load_sub_costs("full")
            get_arabic_resources()
    except Exception:
        pass


def main():
    script_start = time.time()

    from src.core.updater import start_background_update
    start_background_update(_app_path, log_callback=lambda x: None)

    ensure_dependencies()

    parser = argparse.ArgumentParser(description="Quran Alignment Runner")
    parser.add_argument("--audio", type=str, required=True, help="Path to input audio file")
    parser.add_argument("--out", type=str, default="output.json", help="Output JSON path")
    parser.add_argument("--profile", type=str, default="auto", choices=["auto", "fast", "noisy", "clean", "sliding"], help="Transcription profile preset (default: auto)")
    parser.add_argument("--fast", action="store_true", help="Enable parallel transcription")
    parser.add_argument("--workers", type=int, default=None, help="Parallel CPU workers count")

    args = parser.parse_args()

    if args.workers is not None:
        os.environ["ASR_CHUNK_WORKERS"] = str(args.workers)
    elif args.fast:
        os.environ["ASR_CHUNK_WORKERS"] = "4"
    else:
        os.environ["ASR_CHUNK_WORKERS"] = "1"

    if not os.path.exists(args.audio):
        print(f"Error: Input audio file not found at {args.audio}")
        sys.exit(1)

    preload_caches()

    from src.core.main_flow import process_audio

    try:
        json_output, profiling = process_audio(
            audio_data=args.audio,
            model_name="Base",
            profile_name=args.profile,
            return_profiling=True
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(json_output, f, ensure_ascii=False, indent=2)

    total_time = time.time() - script_start
    audio_dur = profiling.audio_duration_s

    print(f"Audio Length: {audio_dur:.2f}s | Transcribing: {profiling.asr_time:.2f}s | Matching: {profiling.match_wall_time:.2f}s | Total Time: {total_time:.2f}s")
    print(f"JSON Output saved to: {args.out}")


if __name__ == "__main__":
    main()
