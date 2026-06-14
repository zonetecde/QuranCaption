#!/usr/bin/env python3
"""Local QuranCaption wrapper for AbdAllah's ONNX Surah Splitter."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_DIR = SCRIPT_DIR / "surah_splitter"
BUNDLED_DATA_DIR = ENGINE_DIR / "data"
RUN_SCRIPT = ENGINE_DIR / "src" / "run.py"
QURAN_JSON = BUNDLED_DATA_DIR / "quran.json"
REQUIRED_MODULES = ("onnxruntime", "numpy", "pydub", "audioop", "Levenshtein", "numba")


def emit_status(step: str, message: str, progress: float | None = None) -> None:
    """Emit a structured status update consumed by the Tauri runner."""
    payload: dict[str, Any] = {"step": step, "message": message}
    if progress is not None:
        payload["progress"] = progress
    print(f"STATUS:{json.dumps(payload, ensure_ascii=False)}", file=sys.stderr, flush=True)


def check_dependencies() -> bool:
    """Return true when every runtime Python dependency is importable."""
    missing = [module for module in REQUIRED_MODULES if importlib.util.find_spec(module) is None]
    if missing:
        print(f"[ERROR] Missing required packages: {', '.join(missing)}", file=sys.stderr)
        return False
    return True


def copy_static_data(data_dir: Path) -> None:
    """Copy bundled static JSON files beside the cached ONNX model when needed."""
    data_dir.mkdir(parents=True, exist_ok=True)
    for file_name in ("vocab.json", "quran.json"):
        source = BUNDLED_DATA_DIR / file_name
        destination = data_dir / file_name
        if not destination.exists():
            shutil.copy2(source, destination)


def load_quran_words(quran_path: Path) -> dict[tuple[int, int], list[str]]:
    """Load Uthmani Quran words keyed by ``(surah, ayah)``."""
    with quran_path.open("r", encoding="utf-8") as file:
        verses = json.load(file)

    words_by_ref: dict[tuple[int, int], list[str]] = {}
    for verse in verses:
        if not isinstance(verse, dict):
            continue
        surah = int(verse.get("surah", 0))
        ayah = int(verse.get("ayah", 0))
        text = str(verse.get("text_uthmani") or verse.get("text_standard") or "").strip()
        if surah > 0 and ayah > 0 and text:
            words_by_ref[(surah, ayah)] = text.split()
    return words_by_ref


def parse_bool_arg(raw_value: str) -> bool:
    """Convert a textual CLI value to a boolean."""
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def finite_number(value: Any, field_name: str) -> float:
    """Parse and validate one finite numeric JSON field."""
    number = float(value)
    if not (number == number and abs(number) != float("inf")):
        raise ValueError(f"Invalid non-finite {field_name}.")
    return number


def validate_word(raw_word: Any, index: int) -> dict[str, Any]:
    """Validate one AbdAllah word entry from ``segmented.json``."""
    if not isinstance(raw_word, dict):
        raise ValueError(f"Invalid word at index {index}: expected object.")

    text = str(raw_word.get("word", "")).strip()
    if not text:
        raise ValueError(f"Invalid word at index {index}: empty word.")

    start = finite_number(raw_word.get("start"), "word.start")
    end = finite_number(raw_word.get("end"), "word.end")
    if start < 0 or end < start:
        raise ValueError(f"Invalid word at index {index}: bad timestamps.")
    canonical_idx = raw_word.get("canonical_idx")
    if not isinstance(canonical_idx, int) or canonical_idx < 0:
        raise ValueError(f"Invalid word at index {index}: missing canonical_idx.")

    return {"word": text, "start": start, "end": end, "canonical_idx": canonical_idx}


def normalize_word_boundaries(
    words: list[dict[str, Any]], segment_duration: float
) -> list[dict[str, Any]]:
    """Normalize WBW timings so words are contiguous within one subtitle."""
    if not words:
        return words

    duration = max(0.0, segment_duration)
    normalized_starts: list[float] = []
    previous_start = 0.0
    for index, word in enumerate(words):
        raw_start = 0.0 if index == 0 else float(word.get("start", 0.0))
        start = max(previous_start, min(duration, raw_start))
        normalized_starts.append(start)
        previous_start = start

    normalized_words: list[dict[str, Any]] = []
    for index, word in enumerate(words):
        start = normalized_starts[index]
        end = normalized_starts[index + 1] if index < len(words) - 1 else duration
        normalized_words.append(
            {
                **word,
                "start": round(start, 3),
                "end": round(max(start, end), 3),
            }
        )
    return normalized_words


def trim_overlapping_previous_segments(segments: list[dict[str, Any]], next_start: float) -> None:
    """Trim or remove previous subtitles that overlap the next subtitle start."""
    while segments and float(segments[-1]["time_to"]) > next_start:
        previous = segments[-1]
        previous_start = float(previous["time_from"])
        if next_start > previous_start:
            previous["time_to"] = round(next_start, 3)
            if previous.get("words"):
                previous["words"] = normalize_word_boundaries(
                    previous["words"], next_start - previous_start
                )
            return
        segments.pop()


def convert_caption_segments(
    raw_segments: Any,
    quran_words: dict[tuple[int, int], list[str]],
    include_wbw_timestamps: bool = True,
) -> dict[str, Any]:
    """Convert AbdAllah caption segments into QuranCaption's segmentation response."""
    if not isinstance(raw_segments, list):
        raise ValueError("Invalid segmented.json: expected a JSON array.")

    converted: list[dict[str, Any]] = []
    for output_index, raw_segment in enumerate(raw_segments, start=1):
        if not isinstance(raw_segment, dict):
            raise ValueError(f"Invalid segment {output_index}: expected object.")

        surah = int(raw_segment.get("surah", 0))
        ayah = int(raw_segment.get("ayah", 0))
        if not (1 <= surah <= 114) or ayah <= 0:
            raise ValueError(f"Invalid segment {output_index}: bad surah/ayah.")

        raw_words = raw_segment.get("words")
        if not isinstance(raw_words, list) or not raw_words:
            raise ValueError(f"Invalid segment {output_index}: words array is empty.")

        words = [validate_word(word, word_index) for word_index, word in enumerate(raw_words)]
        if any(words[index]["start"] < words[index - 1]["start"] for index in range(1, len(words))):
            raise ValueError(f"Invalid segment {output_index}: timestamps are not ordered.")
        raw_time_from = words[0]["start"]
        raw_time_to = max(raw_time_from, words[-1]["end"])
        time_from = raw_time_from
        time_to = raw_time_to
        trim_overlapping_previous_segments(converted, time_from)

        canonical_positions = [word["canonical_idx"] + 1 for word in words]
        first_position = min(canonical_positions)
        last_position = max(canonical_positions)
        verse_words = quran_words.get((surah, ayah), [])
        if verse_words and last_position > len(verse_words):
            raise ValueError(f"Invalid segment {output_index}: word reference is out of range.")

        relative_words = []
        for word in words:
            word_position = word["canonical_idx"] + 1
            relative_words.append(
                {
                    "location": f"{surah}:{ayah}:{word_position}",
                    "word": word["word"],
                    "start": max(0.0, word["start"] - time_from),
                    "end": max(0.0, word["end"] - time_from),
                }
            )
        relative_words = normalize_word_boundaries(relative_words, time_to - time_from)

        converted.append(
            {
                "confidence": 0.86,
                "error": None,
                "has_missing_words": any(
                    finite_number(word.get("score", 1.0), "word.score") <= 0.0
                    for word in raw_words
                    if isinstance(word, dict)
                ),
                "potentially_undersegmented": False,
                "matched_text": str(raw_segment.get("text", "")).strip(),
                "ref_from": f"{surah}:{ayah}:{first_position}",
                "ref_to": f"{surah}:{ayah}:{last_position}",
                "segment": output_index,
                "time_from": round(time_from, 3),
                "time_to": round(time_to, 3),
                "words": relative_words if include_wbw_timestamps else [],
            }
        )

    if not converted:
        raise ValueError("No caption segments were generated.")
    return {
        "segments": converted,
        "warning": (
            "Surah Splitter auto-detected the Quran span. Audio containing multiple surahs may need review."
        ),
    }


def run_abdallah_engine(audio_path: Path, data_dir: Path, output_dir: Path) -> None:
    """Run AbdAllah's ONNX pipeline in caption mode."""
    env = os.environ.copy()
    env["QURANCAPTION_SURAH_SPLITTER_DATA_DIR"] = str(data_dir)
    env["QURANCAPTION_SURAH_SPLITTER_OUTPUT_DIR"] = str(output_dir)
    env["QURANCAPTION_SURAH_SPLITTER_QURAN_JSON"] = str(data_dir / "quran.json")
    env["QURANCAPTION_SURAH_SPLITTER_DEVICE"] = os.environ.get(
        "QURANCAPTION_SURAH_SPLITTER_DEVICE", "GPU"
    )

    command = [sys.executable, str(RUN_SCRIPT), str(audio_path), "--caption"]
    process = subprocess.Popen(
        command,
        cwd=str(RUN_SCRIPT.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    stdout, stderr = process.communicate()
    if process.returncode != 0:
        details = "\n".join(part.strip() for part in (stdout, stderr) if part.strip())
        raise RuntimeError(details or f"Surah Splitter failed with exit code {process.returncode}.")


def main() -> int:
    """Parse CLI arguments, run the engine, and print QuranCaption JSON."""
    parser = argparse.ArgumentParser(description="QuranCaption ONNX Surah Splitter wrapper")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--model-name", type=str, default="SurahSplitter-Base-Quran")
    parser.add_argument("--device", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--surah", type=int, default=0)
    parser.add_argument("--include-wbw-timestamps", type=str, default="true")
    parser.add_argument("--data-dir", type=str, default="")
    args = parser.parse_args()

    audio_path = Path(args.audio_path)
    if not audio_path.exists():
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}))
        return 1
    if not RUN_SCRIPT.exists():
        print(json.dumps({"error": f"Surah Splitter source not found: {RUN_SCRIPT}"}))
        return 1
    if not check_dependencies():
        print(json.dumps({"error": "Missing required Python packages"}))
        return 1

    data_dir = Path(args.data_dir) if args.data_dir else BUNDLED_DATA_DIR
    try:
        os.environ["QURANCAPTION_SURAH_SPLITTER_DEVICE"] = args.device
        emit_status("preparing", "Preparing ONNX Surah Splitter data...")
        copy_static_data(data_dir)
        if not (data_dir / "model.onnx").exists():
            raise FileNotFoundError(f"Missing model file: {data_dir / 'model.onnx'}")

        temp_dir = Path(tempfile.mkdtemp(prefix="qurancaption-surah-splitter-"))
        try:
            output_dir = temp_dir / "outputs"
            emit_status("transcribing", "Transcribing Quran audio with local ONNX FastConformer...")
            run_abdallah_engine(audio_path, data_dir, output_dir)

            segmented_json = output_dir / "segmented.json"
            if not segmented_json.exists():
                raise FileNotFoundError(f"Missing segmentation output: {segmented_json}")

            emit_status("converting", "Converting Surah Splitter captions...")
            with segmented_json.open("r", encoding="utf-8") as file:
                raw_segments = json.load(file)
            result = convert_caption_segments(
                raw_segments,
                load_quran_words(data_dir / "quran.json"),
                parse_bool_arg(args.include_wbw_timestamps),
            )
        except Exception as error:
            raise RuntimeError(f"{error} Diagnostic folder: {temp_dir}") from error
        else:
            shutil.rmtree(temp_dir, ignore_errors=True)

        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
