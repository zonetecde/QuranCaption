#!/usr/bin/env python3
"""
Local WordTiming segmenter wrapper for QuranCaption.

Runs the offline FastConformer Quran Recitation alignment engine
and outputs normalized Quran Multi-Aligner JSON to stdout.
"""

import argparse
import contextlib
import io
import json
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_DIR = SCRIPT_DIR / "quran_recite_to_text"

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))


def emit_status_to_stderr(original_stderr_file, step: str, message: str, progress: float | int | None = None) -> None:
    """Write a structured status update to the original stderr stream."""
    try:
        data = {"step": step, "message": message}
        if progress is not None:
            data["progress"] = progress
        status_json = json.dumps(data, ensure_ascii=False)
        original_stderr_file.write(f"STATUS:{status_json}\n")
        original_stderr_file.flush()
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Local WordTiming Quran Segmenter")
    parser.add_argument("audio_path", help="Path to the input audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--fast", action="store_true", help="Enable parallel transcription")
    parser.add_argument("--workers", type=int, default=None, help="Parallel CPU workers count")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if args.workers is not None:
        os.environ["ASR_CHUNK_WORKERS"] = str(args.workers)
    elif args.fast:
        os.environ["ASR_CHUNK_WORKERS"] = "4"
    else:
        os.environ["ASR_CHUNK_WORKERS"] = "1"

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1

    original_stderr_fd = os.dup(2)
    original_stderr_file = os.fdopen(original_stderr_fd, "w", encoding="utf-8")

    result = None
    error_result = None

    try:
        emit_status_to_stderr(original_stderr_file, "loading", "Initializing WordTiming engine & dependencies...", progress=15)

        from run import ensure_dependencies
        ensure_dependencies()

        from src.core.main_flow import process_audio
        from src.phase4_splitting.export import build_segment_export

        def progress_cb(pct: float, msg: str):
            overall = min(85, max(20, int(20 + (pct * 0.65))))
            emit_status_to_stderr(original_stderr_file, "transcribing", msg, progress=overall)

        if not args.verbose:
            with open(os.devnull, "w", encoding="utf-8") as null_file:
                with contextlib.redirect_stdout(null_file), contextlib.redirect_stderr(null_file):
                    payload = process_audio(args.audio_path, model_name="Base", progress_callback=progress_cb)
        else:
            payload = process_audio(args.audio_path, model_name="Base", progress_callback=progress_cb)

        emit_status_to_stderr(original_stderr_file, "formatting", "Formatting word timestamps...", progress=90)
        result = build_segment_export(payload, include_words=True)
        emit_status_to_stderr(original_stderr_file, "complete", "Segmentation complete", progress=100)

    except Exception as error:
        import traceback
        error_result = {
            "error": str(error),
            "details": traceback.format_exc()
        }
    finally:
        try:
            original_stderr_file.close()
        except Exception:
            pass

    if error_result:
        sys.stdout.write(json.dumps(error_result) + "\n")
        sys.stdout.flush()
        return 1

    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
