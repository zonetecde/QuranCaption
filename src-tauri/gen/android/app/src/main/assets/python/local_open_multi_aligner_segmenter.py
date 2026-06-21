#!/usr/bin/env python3
"""
Local open Multi-Aligner wrapper.

Runs a fully local Quran segmentation pipeline with open models and returns the
same JSON shape expected by the app. When WBW timestamps are requested, the
script injects local per-word timings directly into the response so the app
does not need cloud MFA enrichment.
"""

import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Optional


if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


SCRIPT_DIR = Path(__file__).parent.absolute()
sys.path.insert(0, str(SCRIPT_DIR))

from local_segmenter import check_dependencies, download_data_files, load_audio


OPEN_MULTI_MODELS = {
    "Base": "FaisaI/tadabur-Whisper-Small",
    "Large": "IJyad/whisper-large-v3-Tarteel",
    "Open-Tadabur-Small": "FaisaI/tadabur-Whisper-Small",
    "Open-DeepDML-Small-Mix": "deepdml/whisper-small-ar-quran-mix",
    "Open-DeepDML-Medium-Mix": "deepdml/whisper-medium-ar-quran-mix-norm",
    "Open-IJyad-Large-V3": "IJyad/whisper-large-v3-Tarteel",
    "Open-Naazim-Large-V3-Turbo": "naazimsnh02/whisper-large-v3-turbo-ar-quran",
    "Open-Legacy-Tiny": "tarteel-ai/whisper-tiny-ar-quran",
    "Open-Legacy-Base": "tarteel-ai/whisper-base-ar-quran",
    "Open-Legacy-Medium": "openai/whisper-medium",
    "Open-Legacy-Large": "IJyad/whisper-large-v3-Tarteel",
}


def emit_status_to_stderr(original_stderr_file, step: str, message: str) -> None:
    """Write a structured status update to the original stderr stream."""
    try:
        status_json = json.dumps({"step": step, "message": message}, ensure_ascii=False)
        original_stderr_file.write(f"STATUS:{status_json}\n")
        original_stderr_file.flush()
    except Exception:
        pass


def parse_bool_arg(raw_value: str) -> bool:
    """Parse a CLI boolean value."""
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def configure_device_env(device: str) -> None:
    """Force CPU execution when requested before torch is imported."""
    if device.upper() == "CPU":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""


def build_quran_word_entry(location: str, word: str, start: float, end: float) -> dict:
    """Create one normalized word-timestamp entry."""
    return {
        "location": location,
        "word": word,
        "start": round(start, 3),
        "end": round(end, 3),
    }


def build_even_word_entries(
    words: list[tuple[str, str]],
    segment_duration_s: float,
) -> list[dict]:
    """Distribute word boundaries evenly across a segment duration."""
    if not words:
        return []

    safe_duration = max(0.0, float(segment_duration_s))
    if safe_duration == 0:
        return [
            build_quran_word_entry(location, word, 0.0, 0.0)
            for location, word in words
        ]

    word_count = len(words)
    step = safe_duration / word_count
    entries: list[dict] = []
    for index, (location, word) in enumerate(words):
        start = step * index
        end = safe_duration if index == word_count - 1 else step * (index + 1)
        entries.append(build_quran_word_entry(location, word, start, end))
    return entries


def build_special_word_entries(
    segment_index: int,
    matched_text: str,
    segment_duration_s: float,
) -> list[dict]:
    """Create synthetic word entries for non-Quran special segments."""
    text_words = [word for word in matched_text.split() if word]
    if not text_words:
        text_words = ["segment"]
    synthetic_words = [
        (f"special:{segment_index}:{word_index + 1}", word)
        for word_index, word in enumerate(text_words)
    ]
    return build_even_word_entries(synthetic_words, segment_duration_s)


def build_quran_range_word_entries(
    ref_from: str,
    ref_to: str,
    segment_duration_s: float,
) -> Optional[list[dict]]:
    """Build canonical Quran word entries for a matched reference range."""
    from segment_core.quran_index import get_quran_index

    normalized_ref = ref_from if ref_from == ref_to or not ref_to else f"{ref_from}-{ref_to}"
    indices = get_quran_index().ref_to_indices(normalized_ref)
    if not indices:
        return None

    start_idx, end_idx = indices
    quran_index = get_quran_index()
    quran_words: list[tuple[str, str]] = []
    for word_info in quran_index.words[start_idx : end_idx + 1]:
        location = f"{word_info.surah}:{word_info.ayah}:{word_info.word}"
        quran_words.append((location, word_info.text))

    return build_even_word_entries(quran_words, segment_duration_s)


def inject_local_word_timestamps(result: dict) -> dict:
    """Populate `words` for each segment using local canonical references."""
    segments = result.get("segments")
    if not isinstance(segments, list):
        return result

    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            continue

        time_from = float(segment.get("time_from", 0.0) or 0.0)
        time_to = float(segment.get("time_to", time_from) or time_from)
        segment_duration_s = max(0.0, time_to - time_from)
        ref_from = str(segment.get("ref_from", "") or "")
        ref_to = str(segment.get("ref_to", "") or "")
        matched_text = str(segment.get("matched_text", "") or "")

        words = build_quran_range_word_entries(ref_from, ref_to, segment_duration_s)
        if words is None:
            words = build_special_word_entries(index, matched_text, segment_duration_s)

        segment["words"] = words

    return result


def main() -> int:
    """Run the open local multi-aligner pipeline and print JSON output."""
    parser = argparse.ArgumentParser(description="Local open Multi-Aligner wrapper")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument(
        "--model-name",
        type=str,
        default="Open-Tadabur-Small",
        choices=list(OPEN_MULTI_MODELS.keys()),
    )
    parser.add_argument("--device", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--include-wbw-timestamps", type=str, default="false")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1

    configure_device_env(args.device)

    if not check_dependencies():
        print(json.dumps({"error": "Missing required Python packages"}))
        return 1

    try:
        download_data_files()
    except Exception as error:
        print(json.dumps({"error": f"Failed to download data files: {str(error)}"}))
        return 1

    from segment_core.segment_processor import process_audio_full

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    original_stderr_fd = os.dup(2)
    original_stderr_file = os.fdopen(original_stderr_fd, "w", encoding="utf-8")

    if not args.verbose:
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        devnull = open(os.devnull, "w")
        old_stdout_fd = os.dup(1)
        old_stderr_fd = os.dup(2)
        os.dup2(devnull.fileno(), 1)
        os.dup2(devnull.fileno(), 2)

    result = None
    error_result = None

    try:
        emit_status_to_stderr(original_stderr_file, "loading", "Loading audio file...")
        audio, sample_rate = load_audio(args.audio_path)

        whisper_model = OPEN_MULTI_MODELS.get(args.model_name, OPEN_MULTI_MODELS["Base"])
        result = process_audio_full(
            audio=audio,
            sample_rate=sample_rate,
            min_silence_ms=args.min_silence_ms,
            min_speech_ms=args.min_speech_ms,
            pad_ms=args.pad_ms,
            whisper_model=whisper_model,
            status_callback=lambda step, message: emit_status_to_stderr(
                original_stderr_file, step, message
            ),
        )

        if parse_bool_arg(args.include_wbw_timestamps):
            emit_status_to_stderr(
                original_stderr_file,
                "wbw",
                "Generating local word-by-word timestamps...",
            )
            result = inject_local_word_timestamps(result)

    except Exception as error:
        import traceback

        error_result = {
            "error": str(error),
            "details": traceback.format_exc(),
        }
    finally:
        if not args.verbose:
            os.dup2(old_stdout_fd, 1)
            os.dup2(old_stderr_fd, 2)
            os.close(old_stdout_fd)
            os.close(old_stderr_fd)
            devnull.close()
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        original_stderr_file.close()

    if error_result:
        print(json.dumps(error_result))
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
