#!/usr/bin/env python3
"""Pipeline locale Surah Splitter pour la segmentation QuranCaption."""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import sys
from pathlib import Path
from typing import Callable, Optional

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
SURAH_SPLITTER_SRC = SCRIPT_DIR / "surah-splitter" / "src"
sys.path.insert(0, str(SURAH_SPLITTER_SRC))

MODEL_IDS = {
    "SurahSplitter-Base-Quran": "OdyAsh/faster-whisper-base-ar-quran",
}
_MUSHAF_WORDS_CACHE: dict[int, dict[int, list[str]]] = {}


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


def configure_device_env(device: str) -> None:
    """Force l'exécution CPU avant l'import de torch quand demandé."""
    if device.upper() == "CPU":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""


def check_dependencies() -> bool:
    """Vérifie que les dépendances Python nécessaires à Surah Splitter sont installées."""
    missing: list[str] = []
    for module_name in (
        "torch",
        "torchaudio",
        "whisperx",
        "huggingface_hub",
        "numpy",
        "loguru",
        "rich",
        "pydub",
        "surah_splitter",
    ):
        if importlib.util.find_spec(module_name) is None:
            missing.append(module_name)

    if missing:
        print(f"[ERROR] Missing required packages: {', '.join(missing)}", file=sys.stderr)
        return False
    return True


def resolve_model_id(model_name: str) -> str:
    """Retourne l'identifiant Hugging Face ou WhisperX associé au choix UI."""
    return MODEL_IDS.get(model_name, MODEL_IDS["SurahSplitter-Base-Quran"])


def resolve_device(device: str) -> str:
    """Retourne le device attendu par WhisperX selon la disponibilité CUDA."""
    if device.upper() != "GPU":
        return "cpu"

    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def clean_reference_words(matcher, text: str) -> list[str]:
    """Découpe un verset de référence en mots nettoyés comme Surah Splitter."""
    return [cleaned for word in text.split() if (cleaned := matcher._clean_word(word))]


def build_reference_words(matcher, reference_ayahs: list[str], ayah_numbers: Optional[list[int]]) -> list:
    """Reconstruit la liste des mots de référence avec leurs positions QuranCaption."""
    return matcher._extract_reference_words(reference_ayahs, ayah_numbers)


def resolve_mushaf_quran_dir() -> Optional[Path]:
    """Trouve le dossier local contenant les fichiers Quran 1.json a 114.json."""
    candidates = [
        SCRIPT_DIR.parent.parent / "static" / "quran",
        SCRIPT_DIR.parent / "static" / "quran",
        Path.cwd() / "static" / "quran",
    ]
    for candidate in candidates:
        if (candidate / "1.json").exists():
            return candidate
    return None


def load_mushaf_words(surah_number: int) -> dict[int, list[str]]:
    """Charge les mots vocalises du mushaf local pour une sourate."""
    if surah_number in _MUSHAF_WORDS_CACHE:
        return _MUSHAF_WORDS_CACHE[surah_number]

    quran_dir = resolve_mushaf_quran_dir()
    if quran_dir is None:
        _MUSHAF_WORDS_CACHE[surah_number] = {}
        return {}

    surah_path = quran_dir / f"{surah_number}.json"
    try:
        with surah_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        _MUSHAF_WORDS_CACHE[surah_number] = {}
        return {}

    words_by_ayah: dict[int, list[str]] = {}
    for ayah_key, ayah_data in data.items():
        raw_words = ayah_data.get("w", []) if isinstance(ayah_data, dict) else []
        words_by_ayah[int(ayah_key)] = [
            str(word.get("c", "")).strip()
            for word in raw_words
            if isinstance(word, dict) and str(word.get("c", "")).strip()
        ]

    _MUSHAF_WORDS_CACHE[surah_number] = words_by_ayah
    return words_by_ayah


def get_mushaf_word(surah_number: int, ayah_number: int, word_position: int, fallback: str) -> str:
    """Retourne le mot vocalise du mushaf local, ou le fallback si indisponible."""
    words = load_mushaf_words(surah_number).get(ayah_number, [])
    index = word_position - 1
    if 0 <= index < len(words):
        return words[index]
    return fallback


def normalize_word_boundaries(words: list[dict], segment_duration: float) -> list[dict]:
    """Aligne chaque fin de mot sur le debut du mot suivant dans le segment."""
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

    normalized_words: list[dict] = []
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


def build_segments(
    surah_number: int,
    ayah_numbers: Optional[list[int]],
    reference_ayahs: list[str],
    matching_result: dict,
    reference_words: list,
    include_wbw_timestamps: bool,
    matcher,
) -> list[dict]:
    """Transforme le résultat Surah Splitter en segments compatibles QuranCaption."""
    word_spans = matching_result.get("word_spans", [])
    ayah_order = ayah_numbers or list(range(1, len(reference_ayahs) + 1))
    text_by_ayah = dict(zip(ayah_order, reference_ayahs))
    word_count_by_ayah = {
        ayah_number: len(clean_reference_words(matcher, text))
        for ayah_number, text in text_by_ayah.items()
    }

    segments: list[dict] = []
    for index, timestamp in enumerate(matching_result.get("ayah_timestamps", []), start=1):
        ayah_number = int(timestamp["ayah_number"])
        start_time = float(timestamp["start_time"])
        end_time = float(timestamp["end_time"])
        word_count = max(1, word_count_by_ayah.get(ayah_number, 1))

        words: list[dict] = []
        if include_wbw_timestamps:
            for span in word_spans:
                reference_index = int(span.get("reference_index_start", -1))
                if reference_index < 0 or reference_index >= len(reference_words):
                    continue

                reference_word = reference_words[reference_index]
                if reference_word.ayah_number != ayah_number:
                    continue

                start = max(0.0, float(span.get("start", 0.0)) - start_time)
                end = max(start, float(span.get("end", 0.0)) - start_time)
                word_position = int(reference_word.position_wrt_ayah)
                fallback_word = span.get("reference_words_segment", reference_word.word)
                words.append(
                    {
                        "location": f"{surah_number}:{ayah_number}:{word_position}",
                        "word": get_mushaf_word(surah_number, ayah_number, word_position, fallback_word),
                        "start": round(start, 3),
                        "end": round(end, 3),
                    }
                )
            words = normalize_word_boundaries(words, end_time - start_time)

        segments.append(
            {
                "confidence": 0.86,
                "error": None,
                "has_missing_words": False,
                "potentially_undersegmented": False,
                "matched_text": text_by_ayah.get(ayah_number, timestamp.get("text", "")),
                "ref_from": f"{surah_number}:{ayah_number}:1",
                "ref_to": f"{surah_number}:{ayah_number}:{word_count}",
                "segment": index,
                "time_from": round(start_time, 3),
                "time_to": round(end_time, 3),
                "words": words,
            }
        )

    return segments


def process_audio_full(
    audio_path: str,
    model_name: str,
    device: str,
    surah_number: Optional[int],
    include_wbw_timestamps: bool,
    status_callback: Callable[[str, str], None],
) -> dict:
    """Lance Surah Splitter et retourne une réponse JSON compatible avec l'application."""
    from surah_splitter.services.ayah_matching_service import AyahMatchingService
    from surah_splitter.services.quran_metadata_service import QuranMetadataService
    from surah_splitter.services.transcription_service import TranscriptionService

    status_callback("loading", "Loading Surah Splitter models...")
    transcription_service = TranscriptionService()
    transcription_service.initialize(
        model_name=resolve_model_id(model_name),
        device=resolve_device(device),
    )

    status_callback("transcribing", "Transcribing Quran audio with WhisperX...")
    transcription_result = transcription_service.transcribe_and_align(Path(audio_path))

    status_callback("detecting", "Detecting surah and ayah range...")
    quran_service = QuranMetadataService()
    resolved_surah, resolved_ayahs, reference_ayahs = quran_service.get_ayahs(
        surah_number=surah_number,
        ayah_numbers=None,
        transcription=transcription_result.get("transcription"),
    )

    status_callback("matching", "Matching transcription to Quran ayahs...")
    matcher = AyahMatchingService()
    matching_result = matcher.match_ayahs(
        transcription_result=transcription_result,
        reference_ayahs=reference_ayahs,
        ayah_numbers=resolved_ayahs,
    )
    reference_words = build_reference_words(matcher, reference_ayahs, resolved_ayahs)
    segments = build_segments(
        surah_number=resolved_surah,
        ayah_numbers=resolved_ayahs,
        reference_ayahs=reference_ayahs,
        matching_result=matching_result,
        reference_words=reference_words,
        include_wbw_timestamps=include_wbw_timestamps,
        matcher=matcher,
    )

    warning = None
    if surah_number is None:
        warning = (
            f"Surah Splitter auto-detected surah {resolved_surah}. "
            "Selecting the surah manually can improve precision."
        )

    return {"segments": segments, "warning": warning}


def main() -> int:
    """Point d'entrée CLI du wrapper local Surah Splitter."""
    parser = argparse.ArgumentParser(description="Local Surah Splitter Quran segmentation")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--model-name", type=str, default="SurahSplitter-Base-Quran", choices=MODEL_IDS.keys())
    parser.add_argument("--device", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--surah", type=int, default=0)
    parser.add_argument("--include-wbw-timestamps", type=str, default="true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1

    configure_device_env(args.device)
    if not SURAH_SPLITTER_SRC.exists():
        print(json.dumps({"error": f"Surah Splitter source not found: {SURAH_SPLITTER_SRC}"}))
        return 1
    if not check_dependencies():
        print(json.dumps({"error": "Missing required Python packages"}))
        return 1

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
        result = process_audio_full(
            audio_path=args.audio_path,
            model_name=args.model_name,
            device=args.device,
            surah_number=args.surah if args.surah > 0 else None,
            include_wbw_timestamps=parse_bool_arg(args.include_wbw_timestamps),
            status_callback=lambda step, message: emit_status_to_stderr(
                original_stderr_file, step, message
            ),
        )
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
