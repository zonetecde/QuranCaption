#!/usr/bin/env python3
"""Adaptateur local Offline Tarteel ONNX pour QuranCaption."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_DIR = SCRIPT_DIR / "quran_recite_to_text"
ENGINE_SCRIPT = ENGINE_DIR / "run.py"
ENGINE_OUTPUTS_DIR = ENGINE_DIR / "outputs"
QC_OUTPUT_PATH = ENGINE_OUTPUTS_DIR / "qc_subtitles.json"
MODEL_PATH = ENGINE_DIR / "data" / "model.onnx"


def emit_status_to_stderr(original_stderr_file, step: str, message: str) -> None:
    """Écrit une mise à jour de statut structurée vers le flux stderr original."""
    try:
        status_json = json.dumps({"step": step, "message": message}, ensure_ascii=False)
        original_stderr_file.write(f"STATUS:{status_json}\n")
        original_stderr_file.flush()
    except Exception:
        pass


def parse_bool_arg(raw_value: str) -> bool:
    """Convertit une valeur CLI textuelle en booléen."""
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def check_dependencies() -> bool:
    """Vérifie que les dépendances Python nécessaires au moteur ONNX sont installées."""
    missing: list[str] = []
    for module_name in ("numpy", "onnxruntime", "pydub", "Levenshtein", "numba", "tqdm"):
        try:
            __import__(module_name)
        except Exception:
            missing.append(module_name)

    if missing:
        print(f"[ERROR] Missing required packages: {', '.join(missing)}", file=sys.stderr)
        return False
    return True


def prepare_engine_output() -> None:
    """Nettoie les sorties précédentes et supprime un éventuel pointeur LFS du modèle."""
    if QC_OUTPUT_PATH.exists():
        QC_OUTPUT_PATH.unlink()

    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size < 1_000_000:
        MODEL_PATH.unlink()


def run_engine(audio_path: str, multiple_surahs: bool, original_stderr_file) -> None:
    """Lance le moteur externe et relaie ses logs comme statuts QuranCaption."""
    prepare_engine_output()

    args = [sys.executable, str(ENGINE_SCRIPT), audio_path]
    if multiple_surahs:
        args.append("--multiple")

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"

    emit_status_to_stderr(original_stderr_file, "loading", "Starting Offline Tarteel ONNX...")
    process = subprocess.Popen(
        args,
        cwd=str(ENGINE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )

    output_lines: list[str] = []
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.strip()
        if not line:
            continue
        output_lines.append(line)
        if len(output_lines) > 80:
            output_lines = output_lines[-80:]
        emit_status_to_stderr(original_stderr_file, "processing", line)

    exit_code = process.wait()
    if exit_code != 0:
        raise RuntimeError("\n".join(output_lines[-20:]) or f"Engine exited with code {exit_code}")

    if not QC_OUTPUT_PATH.exists():
        raise RuntimeError("Offline Tarteel ONNX did not produce qc_subtitles.json.")


def normalize_word_index(raw_word: dict[str, Any], fallback_index: int) -> int:
    """Retourne l'index zéro-based du mot dans le verset."""
    raw_index = raw_word.get("word_idx")
    if isinstance(raw_index, int):
        return max(0, raw_index)
    if isinstance(raw_index, str) and raw_index.isdigit():
        return max(0, int(raw_index))
    return fallback_index


def build_segment_words(
    raw_words: list[dict[str, Any]],
    surah: int,
    ayah: int,
) -> list[dict[str, Any]]:
    """Convertit les mots du moteur en timestamps word-by-word compatibles QC."""
    words: list[dict[str, Any]] = []
    for fallback_index, raw_word in enumerate(raw_words):
        word_index = normalize_word_index(raw_word, fallback_index)
        start = float(raw_word.get("start", 0.0))
        end = float(raw_word.get("end", start))
        words.append(
            {
                "location": f"{surah}:{ayah}:{word_index + 1}",
                "word": str(raw_word.get("word", "")),
                "start": round(start, 3),
                "end": round(max(start, end), 3),
            }
        )
    return words


def build_predefined_words(raw_words: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    """Convertit les mots d'un sous-titre prédéfini pour éviter un enrichissement MFA inutile."""
    words: list[dict[str, Any]] = []
    for fallback_index, raw_word in enumerate(raw_words):
        word_index = normalize_word_index(raw_word, fallback_index)
        start = float(raw_word.get("start", 0.0))
        end = float(raw_word.get("end", start))
        words.append(
            {
                "location": f"{label}:{word_index + 1}",
                "word": str(raw_word.get("word", "")),
                "start": round(start, 3),
                "end": round(max(start, end), 3),
            }
        )
    return words


def convert_qc_subtitles_to_segments(raw_subtitles: list[dict[str, Any]]) -> dict[str, Any]:
    """Transforme qc_subtitles.json en réponse de segmentation attendue par QuranCaption."""
    segments: list[dict[str, Any]] = []

    for index, subtitle in enumerate(raw_subtitles, start=1):
        surah = int(subtitle.get("surah", 0) or 0)
        ayah = int(subtitle.get("ayah", 0) or 0)
        start = float(subtitle.get("start", 0.0) or 0.0)
        end = float(subtitle.get("end", start) or start)
        raw_words = subtitle.get("words", [])
        raw_words = raw_words if isinstance(raw_words, list) else []

        if ayah == 0:
            segments.append(
                {
                    "confidence": 0.9,
                    "error": None,
                    "has_missing_words": False,
                    "potentially_undersegmented": False,
                    "matched_text": str(subtitle.get("text", "")),
                    "special_type": "Basmala",
                    "ref_from": "Basmala",
                    "ref_to": "Basmala",
                    "segment": int(subtitle.get("subtitle_index", index) or index),
                    "time_from": round(start, 3),
                    "time_to": round(max(start, end), 3),
                    "words": build_predefined_words(raw_words, "Basmala"),
                }
            )
            continue

        segment_words = build_segment_words(raw_words, surah, ayah)
        word_indices = [
            normalize_word_index(raw_word, fallback_index)
            for fallback_index, raw_word in enumerate(raw_words)
        ]
        first_word = min(word_indices) + 1 if word_indices else 1
        last_word = max(word_indices) + 1 if word_indices else 1

        segment = {
            "confidence": 0.9,
            "error": None,
            "has_missing_words": False,
            "potentially_undersegmented": False,
            "matched_text": str(subtitle.get("text", "")),
            "ref_from": f"{surah}:{ayah}:{first_word}",
            "ref_to": f"{surah}:{ayah}:{last_word}",
            "segment": int(subtitle.get("subtitle_index", index) or index),
            "time_from": round(start, 3),
            "time_to": round(max(start, end), 3),
            "words": segment_words,
        }
        segments.append(segment)

    return {"segments": segments}


def read_engine_result() -> dict[str, Any]:
    """Lit la sortie du moteur et retourne une réponse de segmentation QC."""
    with QC_OUTPUT_PATH.open("r", encoding="utf-8") as file:
        raw_payload = json.load(file)
    if not isinstance(raw_payload, list):
        raise RuntimeError("qc_subtitles.json must contain a subtitle array.")
    return convert_qc_subtitles_to_segments(raw_payload)


def main() -> int:
    """Point d'entrée CLI du wrapper Offline Tarteel ONNX."""
    parser = argparse.ArgumentParser(description="Local Offline Tarteel ONNX Quran segmentation")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--model-name", type=str, default="Muaalem-v3.2")
    parser.add_argument("--device", type=str, default="CPU")
    parser.add_argument("--include-wbw-timestamps", type=str, default="true")
    parser.add_argument("--multiple", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1
    if not ENGINE_SCRIPT.exists():
        print(json.dumps({"error": f"Offline Tarteel engine not found: {ENGINE_SCRIPT}"}))
        return 1
    if not shutil.which("ffmpeg"):
        print(json.dumps({"error": "ffmpeg is required by Offline Tarteel ONNX."}))
        return 1
    if not check_dependencies():
        print(json.dumps({"error": "Missing required Python packages"}))
        return 1

    original_stderr_fd = os.dup(2)
    original_stderr_file = os.fdopen(original_stderr_fd, "w", encoding="utf-8")

    try:
        run_engine(
            audio_path=args.audio_path,
            multiple_surahs=args.multiple,
            original_stderr_file=original_stderr_file,
        )
        result = read_engine_result()
    except Exception as error:
        import traceback

        result = {
            "error": str(error),
            "details": traceback.format_exc(),
        }
    finally:
        original_stderr_file.close()

    if result.get("error"):
        print(json.dumps(result, ensure_ascii=False))
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
