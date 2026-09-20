#!/usr/bin/env python3
"""Local ASR, WhisperX alignment and pyannote worker for Minbar Studio.

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
QWEN_MODEL_OPTION = "qwen3-asr-1.7b"
QWEN_MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
ASR_CHUNK_MAX_GAP_SECONDS = 3.0
AUDIO_SAMPLE_RATE = 16_000

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
    parser.add_argument("--model", default=QWEN_MODEL_OPTION)
    parser.add_argument("--language", default="ar")
    parser.add_argument("--device", choices=("AUTO", "GPU", "CPU"), default="AUTO")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--min-speakers", type=int)
    parser.add_argument("--max-speakers", type=int)
    parser.add_argument("--align-segments-json")
    parser.add_argument("--clip-only", action="store_true")
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


def serialize_transcript_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Serialize ASR timing blocks without deciding final subtitle boundaries."""
    output: list[dict[str, Any]] = []
    for segment in segments:
        words = normalize_words(segment)
        item = serialize_group(words)
        if item is not None:
            output.append(item)
            continue
        start = finite_number(segment.get("start"))
        end = finite_number(segment.get("end"))
        text = str(segment.get("text") or "").strip()
        if start is not None and end is not None and end > start and text:
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
    return sorted(output, key=lambda item: (item["start"], item["end"]))


def release_device_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def resolve_cpu_thread_count() -> int:
    """Return PyTorch's hardware-aware CPU thread count for Whisper inference."""
    import torch

    return max(1, torch.get_num_threads())


def should_run_diarization(min_speakers: int | None, max_speakers: int | None) -> bool:
    """Return whether the requested speaker range requires voice diarization."""
    return any(value is not None and value > 1 for value in (min_speakers, max_speakers))


def build_fixed_audio_chunks(
    audio_duration: float, max_duration: float = 30.0
) -> list[tuple[float, float]]:
    """Split audio into bounded chunks when speaker diarization is disabled."""
    chunks: list[tuple[float, float]] = []
    start = 0.0
    while start < audio_duration:
        end = min(audio_duration, start + max_duration)
        chunks.append((start, end))
        start = end
    return chunks


def assign_single_speaker(aligned: dict[str, Any]) -> dict[str, Any]:
    """Assign the default speaker to aligned segments and words in place."""
    for segment in aligned.get("segments") or []:
        if not isinstance(segment, dict):
            continue
        segment["speaker"] = "SPEAKER_00"
        for word in segment.get("words") or []:
            if isinstance(word, dict):
                word["speaker"] = "SPEAKER_00"
    return aligned


def build_diarization_chunks(
    diarized_segments: Any,
    audio_duration: float,
    max_gap: float,
    max_duration: float = 30.0,
) -> list[tuple[float, float]]:
    """Merge pyannote speech turns into stable ASR-sized audio chunks."""
    turns: list[tuple[float, float]] = []
    for _, row in diarized_segments.iterrows():
        start = finite_number(row.get("start"))
        end = finite_number(row.get("end"))
        if start is None or end is None or end <= start:
            continue
        turns.append((max(0.0, start), min(audio_duration, end)))

    chunks: list[list[float]] = []
    for start, end in sorted(turns):
        if end <= start:
            continue
        if not chunks:
            chunks.append([start, end])
            continue

        previous = chunks[-1]
        merged_end = max(previous[1], end)
        if start - previous[1] <= max_gap and merged_end - previous[0] <= max_duration:
            previous[1] = merged_end
        else:
            chunks.append([start, end])

    return [(start, end) for start, end in chunks]


def transcribe_qwen_chunks(
    args: argparse.Namespace,
    audio: Any,
    chunks: list[tuple[float, float]],
    selected_device: str,
) -> list[dict[str, Any]]:
    """Transcribe Arabic speech chunks with Qwen3-ASR and preserve their absolute bounds."""
    import torch
    from qwen_asr import Qwen3ASRModel

    if args.language.lower() not in ("auto", "ar"):
        raise RuntimeError("Qwen3-ASR is currently integrated for Arabic transcription only.")

    if selected_device == "cuda":
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        device_map = "cuda:0"
        inference_batch_size = max(1, min(args.batch_size, 4))
    else:
        dtype = torch.float32
        device_map = "cpu"
        inference_batch_size = 1

    emit_status("Loading Qwen3-ASR 1.7B...", 34)
    model = Qwen3ASRModel.from_pretrained(
        QWEN_MODEL_ID,
        dtype=dtype,
        device_map=device_map,
        max_inference_batch_size=inference_batch_size,
        max_new_tokens=512,
    )

    output: list[dict[str, Any]] = []
    prepared: list[tuple[float, float, Any]] = []
    for start, end in chunks:
        start_index = max(0, round(start * AUDIO_SAMPLE_RATE))
        end_index = min(len(audio), round(end * AUDIO_SAMPLE_RATE))
        if end_index - start_index < AUDIO_SAMPLE_RATE // 10:
            continue
        prepared.append((start, end, audio[start_index:end_index]))

    if not prepared:
        raise RuntimeError("pyannote did not detect any transcribable Arabic speech regions.")

    for offset in range(0, len(prepared), inference_batch_size):
        batch = prepared[offset : offset + inference_batch_size]
        results = model.transcribe(
            audio=[(clip, AUDIO_SAMPLE_RATE) for _, _, clip in batch],
            language=["Arabic"] * len(batch),
        )
        if not isinstance(results, (list, tuple)):
            results = [results]
        if len(results) != len(batch):
            raise RuntimeError("Qwen3-ASR returned an unexpected number of transcription results.")

        for (start, end, _), result in zip(batch, results):
            text = result.get("text") if isinstance(result, dict) else getattr(result, "text", "")
            normalized_text = str(text or "").strip()
            if normalized_text:
                output.append({"start": start, "end": end, "text": normalized_text})

        completed = min(len(prepared), offset + len(batch))
        emit_status(
            "Transcribing Arabic with Qwen3-ASR...",
            38 + (completed / len(prepared) * 17),
        )

    del model
    release_device_memory()
    if not output:
        raise RuntimeError("Qwen3-ASR did not detect any transcribable Arabic speech.")
    return output


def run_pipeline(args: argparse.Namespace, selected_device: str, token: str) -> dict[str, Any]:
    import whisperx
    from whisperx.diarize import DiarizationPipeline

    compute_type = "float16" if selected_device == "cuda" else "int8"
    language = "ar"
    batch_size = max(1, args.batch_size)
    use_qwen = args.model == QWEN_MODEL_OPTION
    run_diarization = should_run_diarization(args.min_speakers, args.max_speakers)
    audio = whisperx.load_audio(args.audio_path)

    diarization_kwargs: dict[str, int] = {}
    if args.min_speakers and args.min_speakers > 0:
        diarization_kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers and args.max_speakers > 0:
        diarization_kwargs["max_speakers"] = args.max_speakers

    diarized_segments = None
    if use_qwen and run_diarization:
        emit_status("Detecting speech regions and speaker voices...", 8)
        diarization = DiarizationPipeline(token=token, device=selected_device)
        diarized_segments = diarization(
            audio,
            progress_callback=lambda value: emit_status(
                "Detecting speech regions and speaker voices...", 8 + (float(value) * 0.22)
            ),
            **diarization_kwargs,
        )
        del diarization
        release_device_memory()

    if use_qwen:
        audio_duration = len(audio) / AUDIO_SAMPLE_RATE
        chunks = (
            build_diarization_chunks(
                diarized_segments,
                audio_duration,
                max_gap=ASR_CHUNK_MAX_GAP_SECONDS,
            )
            if diarized_segments is not None
            else build_fixed_audio_chunks(audio_duration)
        )
        result = {
            "segments": transcribe_qwen_chunks(args, audio, chunks, selected_device),
        }
        detected_language = "ar"
    else:
        emit_status(f"Loading WhisperX model {args.model} on {selected_device}...", 8)
        model = whisperx.load_model(
            args.model,
            selected_device,
            compute_type=compute_type,
            language=language,
            threads=resolve_cpu_thread_count() if selected_device == "cpu" else 4,
        )

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

    if run_diarization and diarized_segments is None:
        emit_status("Detecting and matching speaker voices...", 72)
        diarization = DiarizationPipeline(token=token, device=selected_device)
        diarized_segments = diarization(
            audio,
            progress_callback=lambda value: emit_status(
                "Detecting and matching speaker voices...", 72 + (float(value) * 0.18)
            ),
            **diarization_kwargs,
        )
        del diarization
        release_device_memory()
    elif diarized_segments is not None:
        emit_status("Matching aligned words to detected voices...", 89)

    with_speakers = (
        whisperx.assign_word_speakers(diarized_segments, aligned, fill_nearest=True)
        if diarized_segments is not None
        else assign_single_speaker(aligned)
    )

    emit_status("Transcription completed.", 91)
    transcript_segments = serialize_transcript_segments(
        [item for item in with_speakers.get("segments") or [] if isinstance(item, dict)]
    )
    speakers = sorted(
        {
            str(speaker)
            for item in transcript_segments
            for speaker in [item.get("speaker"), *(word.get("speaker") for word in item.get("words") or [])]
            if speaker
        }
    )

    emit_status("Transcription completed.", 100)
    return {
        "language": detected_language,
        "device": selected_device,
        "model": args.model,
        "segments": transcript_segments,
        "speakers": speakers,
        "wordTimestampsAvailable": any(item.get("words") for item in transcript_segments),
        "alignmentWarning": alignment_warning,
    }


def run_clip_transcription(args: argparse.Namespace, selected_device: str) -> dict[str, Any]:
    """Transcribe one bounded subtitle clip without diarization or word alignment."""
    import whisperx

    audio = whisperx.load_audio(args.audio_path)
    if len(audio) < AUDIO_SAMPLE_RATE // 10:
        raise RuntimeError("The subtitle audio range is too short to transcribe.")

    language = args.language.lower()
    if args.model == QWEN_MODEL_OPTION:
        segments = transcribe_qwen_chunks(
            args,
            audio,
            [(0.0, len(audio) / AUDIO_SAMPLE_RATE)],
            selected_device,
        )
        detected_language = "ar"
    else:
        compute_type = "float16" if selected_device == "cuda" else "int8"
        emit_status(f"Loading WhisperX model {args.model} on {selected_device}...", 12)
        model = whisperx.load_model(
            args.model,
            selected_device,
            compute_type=compute_type,
            language=None if language == "auto" else language,
            threads=resolve_cpu_thread_count() if selected_device == "cpu" else 4,
        )
        emit_status("Retranscribing subtitle audio...", 45)
        result = model.transcribe(audio, batch_size=max(1, args.batch_size))
        segments = [item for item in result.get("segments") or [] if isinstance(item, dict)]
        detected_language = str(result.get("language") or language or "unknown")
        del model
        release_device_memory()

    text = " ".join(str(item.get("text") or "").strip() for item in segments).strip()
    if not text:
        raise RuntimeError("The speech recognition model did not detect any text in this subtitle.")

    emit_status("Subtitle retranscription completed.", 100)
    return {
        "text": text,
        "language": detected_language,
        "device": selected_device,
        "model": args.model,
    }


def run_forced_alignment(args: argparse.Namespace, selected_device: str) -> dict[str, Any]:
    """Align caller-provided transcript segments without running ASR or diarization."""
    import whisperx

    requested_segments = json.loads(args.align_segments_json or "[]")
    if not isinstance(requested_segments, list) or not requested_segments:
        raise RuntimeError("At least one transcript segment is required for alignment.")

    audio = whisperx.load_audio(args.audio_path)
    duration = len(audio) / AUDIO_SAMPLE_RATE
    language = args.language.lower()
    if language == "auto":
        language = "ar"

    source_segments: list[dict[str, Any]] = []
    normalized_requests: list[dict[str, Any]] = []
    for index, item in enumerate(requested_segments):
        if not isinstance(item, dict):
            continue
        start = finite_number(item.get("time_from"))
        end = finite_number(item.get("time_to"))
        text = str(item.get("matched_text") or "").strip()
        if start is None or end is None or end <= start or not text:
            continue
        start = max(0.0, min(duration, start))
        end = max(start, min(duration, end))
        if end <= start:
            continue
        normalized_requests.append({**item, "segment": item.get("segment", index)})
        source_segments.append({"start": start, "end": end, "text": text})

    if not source_segments:
        raise RuntimeError("No valid transcript segment was provided for alignment.")

    emit_status(f"Aligning {language} transcript words...", 20)
    align_model, align_metadata = whisperx.load_align_model(
        language_code=language,
        device=selected_device,
    )
    aligned = whisperx.align(
        source_segments,
        align_model,
        align_metadata,
        audio,
        selected_device,
        return_char_alignments=False,
        progress_callback=lambda value: emit_status(
            f"Aligning {language} transcript words...", 20 + (float(value) * 0.75)
        ),
    )
    del align_model
    release_device_memory()

    aligned_segments = aligned.get("segments") or []
    output_segments: list[dict[str, Any]] = []
    for index, request in enumerate(normalized_requests):
        source = source_segments[index]
        aligned_segment = aligned_segments[index] if index < len(aligned_segments) else {}
        words: list[dict[str, Any]] = []
        for word_index, raw_word in enumerate(aligned_segment.get("words") or []):
            if not isinstance(raw_word, dict):
                continue
            text = str(raw_word.get("word") or "").strip()
            start = finite_number(raw_word.get("start"))
            end = finite_number(raw_word.get("end"))
            if not text or start is None or end is None or end <= start:
                continue
            words.append(
                {
                    "location": f"transcript:{request['segment']}:{word_index + 1}",
                    "word": text,
                    "start": round(max(0.0, start - source["start"]), 6),
                    "end": round(max(0.0, end - source["start"]), 6),
                }
            )
        output_segments.append({**request, "words": words})

    emit_status("Transcript word alignment completed.", 100)
    return {"language": language, "device": selected_device, "segments": output_segments}


def run_requested_operation(
    args: argparse.Namespace, selected_device: str, token: str
) -> dict[str, Any]:
    """Run the transcription operation selected by the command-line arguments."""
    if args.align_segments_json:
        return run_forced_alignment(args, selected_device)
    if args.clip_only:
        return run_clip_transcription(args, selected_device)
    return run_pipeline(args, selected_device, token)


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
    if (
        not token
        and not args.align_segments_json
        and not args.clip_only
        and should_run_diarization(args.min_speakers, args.max_speakers)
    ):
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
                output = run_requested_operation(args, selected_device, token)
            except Exception as first_error:
                if requested in ("AUTO", "GPU") and selected_device == "cuda":
                    emit_status("GPU processing failed; retrying automatically on CPU...", 3)
                    release_device_memory()
                    output = run_requested_operation(args, "cpu", token)
                    output["gpuFallbackReason"] = str(first_error)
                else:
                    raise
        payload = json.dumps(output, ensure_ascii=True)
        print(f"{RESULT_PREFIX}{payload}", flush=True)
    except Exception as error:
        fail(str(error))


if __name__ == "__main__":
    main()
