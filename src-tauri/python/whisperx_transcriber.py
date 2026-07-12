#!/usr/bin/env python3
"""WhisperX + pyannote transcription worker for Minbar Studio.

The process writes progress events to stderr as `STATUS:<json>` and emits one
JSON result to stdout. All timestamps in the result are absolute seconds on the
prepared project timeline audio.
"""

from __future__ import annotations

import argparse
import contextlib
import gc
import json
import os
import sys
import warnings
from dataclasses import dataclass
from typing import Any, Iterable


def configure_utf8_streams() -> None:
    """Force UTF-8 for Windows consoles and Tauri pipe output."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):
            pass


configure_utf8_streams()

RESULT_PREFIX = "MINBAR_RESULT:"
ERROR_PREFIX = "MINBAR_ERROR:"

# WhisperX gives pyannote an in-memory waveform, so its optional TorchCodec
# decoder is not used by this worker even when the package emits this warning.
warnings.filterwarnings(
    "ignore",
    message=r"(?s).*torchcodec is not installed correctly.*",
    category=UserWarning,
)


def emit_status(message: str, progress: float | None = None) -> None:
    payload: dict[str, Any] = {"message": message}
    if progress is not None:
        payload["progress"] = max(0.0, min(100.0, float(progress)))
    print(f"STATUS:{json.dumps(payload, ensure_ascii=True)}", file=sys.stderr, flush=True)


def fail(message: str) -> None:
    payload = json.dumps({"error": message}, ensure_ascii=True)
    print(f"{ERROR_PREFIX}{payload}", flush=True)
    raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe and diarize audio for Minbar Studio")
    parser.add_argument("audio_path")
    parser.add_argument("--model", default="medium")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", choices=("AUTO", "GPU", "CPU"), default="AUTO")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("--max-words", type=int, default=14)
    parser.add_argument("--max-chars", type=int, default=90)
    parser.add_argument("--max-gap", type=float, default=1.2)
    return parser.parse_args()


@dataclass(slots=True)
class Word:
    text: str
    start: float
    end: float
    confidence: float | None
    speaker: str


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def normalize_speaker(value: Any) -> str:
    text = str(value or "").strip()
    return text if text else "UNKNOWN_SPEAKER"


def normalize_words(segment: dict[str, Any]) -> list[Word]:
    normalized: list[Word] = []
    segment_speaker = normalize_speaker(segment.get("speaker"))
    for raw in segment.get("words") or []:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("word") or "").strip()
        start = finite_number(raw.get("start"))
        end = finite_number(raw.get("end"))
        if not text or start is None or end is None or end <= start:
            continue
        confidence = finite_number(raw.get("score"))
        normalized.append(
            Word(
                text=text,
                start=max(0.0, start),
                end=max(start, end),
                confidence=confidence,
                speaker=normalize_speaker(raw.get("speaker") or segment_speaker),
            )
        )
    return normalized


def join_words(words: Iterable[Word]) -> str:
    return " ".join(word.text for word in words).strip()


def average_confidence(words: list[Word]) -> float | None:
    scores = [word.confidence for word in words if word.confidence is not None]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 6)


def serialize_group(words: list[Word]) -> dict[str, Any] | None:
    if not words:
        return None
    text = join_words(words)
    if not text:
        return None
    start = words[0].start
    end = max(word.end for word in words)
    if end <= start:
        return None
    return {
        "start": round(start, 6),
        "end": round(end, 6),
        "text": text,
        "speaker": words[0].speaker,
        "confidence": average_confidence(words),
        "words": [
            {
                "word": word.text,
                "start": round(word.start, 6),
                "end": round(word.end, 6),
                "confidence": word.confidence,
                "speaker": word.speaker,
            }
            for word in words
        ],
    }


def split_words_into_subtitles(
    segments: list[dict[str, Any]],
    max_words: int,
    max_chars: int,
    max_gap: float,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    current: list[Word] = []

    def flush() -> None:
        nonlocal current
        item = serialize_group(current)
        if item is not None:
            output.append(item)
        current = []

    for segment in segments:
        words = normalize_words(segment)
        if not words:
            start = finite_number(segment.get("start"))
            end = finite_number(segment.get("end"))
            text = str(segment.get("text") or "").strip()
            if start is not None and end is not None and end > start and text:
                flush()
                output.append(
                    {
                        "start": round(max(0.0, start), 6),
                        "end": round(max(start, end), 6),
                        "text": text,
                        "speaker": normalize_speaker(segment.get("speaker")),
                        "confidence": None,
                        "words": [],
                    }
                )
            continue

        for word in words:
            if current:
                candidate_text = join_words([*current, word])
                speaker_changed = word.speaker != current[-1].speaker
                long_gap = word.start - current[-1].end > max_gap
                too_many_words = len(current) >= max_words
                too_many_chars = len(candidate_text) > max_chars
                if speaker_changed or long_gap or too_many_words or too_many_chars:
                    flush()
            current.append(word)

            # Prefer sentence-like breaks once the subtitle is already substantial.
            if len(current) >= 6 and word.text.rstrip().endswith((".", "!", "?", "؟", "؛")):
                flush()

    flush()
    return sorted(output, key=lambda item: (item["start"], item["end"]))


def release_device_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def run_pipeline(args: argparse.Namespace, selected_device: str, token: str) -> dict[str, Any]:
    import torch
    import whisperx
    from whisperx.diarize import DiarizationPipeline

    compute_type = "float16" if selected_device == "cuda" else "int8"
    language = None if args.language.lower() == "auto" else args.language.lower()
    batch_size = max(1, args.batch_size)

    emit_status(f"Loading WhisperX model {args.model} on {selected_device}...", 8)
    model = whisperx.load_model(
        args.model,
        selected_device,
        compute_type=compute_type,
        language=language,
    )
    audio = whisperx.load_audio(args.audio_path)

    emit_status("Transcribing speech...", 22)
    result = model.transcribe(
        audio,
        batch_size=batch_size,
        progress_callback=lambda value: emit_status(
            "Transcribing speech...", 22 + (float(value) * 0.32)
        ),
    )
    detected_language = str(result.get("language") or language or "unknown")
    del model
    release_device_memory()
    if not result.get("segments"):
        raise RuntimeError("WhisperX did not detect any transcribable speech in the project audio.")

    emit_status(f"Aligning {detected_language} words...", 56)
    alignment_warning: str | None = None
    try:
        align_model, align_metadata = whisperx.load_align_model(
            language_code=detected_language,
            device=selected_device,
        )
        aligned = whisperx.align(
            result.get("segments") or [],
            align_model,
            align_metadata,
            audio,
            selected_device,
            return_char_alignments=False,
            progress_callback=lambda value: emit_status(
                f"Aligning {detected_language} words...", 56 + (float(value) * 0.14)
            ),
        )
        del align_model
        release_device_memory()
    except Exception as alignment_error:
        alignment_warning = str(alignment_error)
        emit_status(
            "Word alignment is unavailable for this audio; continuing with segment timestamps...",
            70,
        )
        aligned = {
            "segments": result.get("segments") or [],
            "word_segments": [],
        }
        release_device_memory()

    emit_status("Detecting and matching speaker voices...", 72)
    diarization = DiarizationPipeline(token=token, device=selected_device)
    diarization_kwargs: dict[str, int] = {}
    if args.min_speakers and args.min_speakers > 0:
        diarization_kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers and args.max_speakers > 0:
        diarization_kwargs["max_speakers"] = args.max_speakers
    diarized_segments = diarization(
        audio,
        progress_callback=lambda value: emit_status(
            "Detecting and matching speaker voices...", 72 + (float(value) * 0.18)
        ),
        **diarization_kwargs,
    )
    with_speakers = whisperx.assign_word_speakers(diarized_segments, aligned, fill_nearest=True)
    del diarization
    release_device_memory()

    emit_status("Creating subtitle-sized transcript segments...", 91)
    subtitles = split_words_into_subtitles(
        [item for item in with_speakers.get("segments") or [] if isinstance(item, dict)],
        max_words=max(2, args.max_words),
        max_chars=max(20, args.max_chars),
        max_gap=max(0.1, args.max_gap),
    )
    speakers = sorted({str(item["speaker"]) for item in subtitles if item.get("speaker")})

    emit_status("Transcription completed.", 100)
    return {
        "language": detected_language,
        "device": selected_device,
        "model": args.model,
        "segments": subtitles,
        "speakers": speakers,
        "wordTimestampsAvailable": any(item.get("words") for item in subtitles),
        "alignmentWarning": alignment_warning,
    }


def main() -> None:
    args = parse_args()
    if not os.path.isfile(args.audio_path):
        fail(f"Audio file not found: {args.audio_path}")

    token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HF_HUB_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or ""
    ).strip()
    if not token:
        fail(
            "A Hugging Face read token is required for pyannote speaker diarization. "
            "Accept the pyannote/speaker-diarization-community-1 conditions first."
        )

    try:
        import torch

        requested = args.device.upper()
        selected_device = "cuda" if requested in ("AUTO", "GPU") and torch.cuda.is_available() else "cpu"
        if requested == "GPU" and selected_device != "cuda":
            emit_status("GPU is unavailable; continuing on CPU.", 2)

        # Third-party libraries occasionally write progress bars or checkpoint
        # notices to stdout. Keep stdout reserved for the machine-readable result
        # and forward all incidental output to stderr.
        with contextlib.redirect_stdout(sys.stderr):
            try:
                output = run_pipeline(args, selected_device, token)
            except Exception as first_error:
                if requested in ("AUTO", "GPU") and selected_device == "cuda":
                    emit_status("GPU transcription failed; retrying automatically on CPU...", 3)
                    release_device_memory()
                    output = run_pipeline(args, "cpu", token)
                    output["gpuFallbackReason"] = str(first_error)
                else:
                    raise
        payload = json.dumps(output, ensure_ascii=True)
        print(f"{RESULT_PREFIX}{payload}", flush=True)
    except Exception as error:
        fail(str(error))


if __name__ == "__main__":
    main()
