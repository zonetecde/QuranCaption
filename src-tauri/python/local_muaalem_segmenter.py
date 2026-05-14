#!/usr/bin/env python3
"""Local Muaalem Quran segmentation pipeline.

This script replaces the previous fully local open workflow with a Quran-specific
pipeline built around:
- obadx/recitation-segmenter-v2 for waqf segmentation
- obadx/muaalem-model-v3_2 for phonetic speech recognition
- quran-transcript PhoneticSearch for Quran passage retrieval
- alignment_quran_recitation for true local word-by-word timestamps
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import os
import shutil
import sys
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Callable, Optional

import numpy as np

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
sys.path.insert(0, str(SCRIPT_DIR))

from local_segmenter import download_data_files, load_audio
from local_open_multi_aligner_segmenter import (
    OPEN_MULTI_MODELS,
    inject_local_word_timestamps,
)
from segment_core.quran_index import get_quran_index

SEGMENTER_MODEL_ID = "obadx/recitation-segmenter-v2"
STT_MODEL_ID = "obadx/muaalem-model-v3_2"
ALIGNER_MODEL_ID = "nvidia/stt_ar_fastconformer_hybrid_large_pcd_v1.0"
DEFAULT_ERROR_RATIO = 0.22
MUAALEM_MODEL_CHOICES = ["Muaalem-v3.2", *OPEN_MULTI_MODELS.keys()]

_SEGMENTER_CACHE: tuple[object, object] | None = None
_STT_CACHE: tuple[object, object, object] | None = None
_ALIGNER_CACHE: object | None = None
_PHONETIC_SEARCH_CACHE: object | None = None
_MOSHAF_ATTRIBUTES_CACHE: object | None = None


@dataclass
class SegmentInterval:
    """Represents one cleaned local speech interval."""

    start_sample: int
    end_sample: int
    start_s: float
    end_s: float


@dataclass
class ResolvedMatch:
    """Resolved Quran match for one recognized segment."""

    start_idx: int
    end_idx: int
    ref_from: str
    ref_to: str
    matched_text: str
    confidence: float
    has_missing_words: bool
    potentially_undersegmented: bool


@dataclass
class DeviceContext:
    """Stores the effective torch device configuration."""

    name: str
    torch_device: str
    is_gpu: bool


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


def ensure_quran_transcript_data_files() -> None:
    """Copy bundled quran-transcript data files into the installed package when they are missing."""
    package_spec = importlib.util.find_spec("quran_transcript")
    if package_spec is None or package_spec.origin is None:
        return

    package_dir = Path(package_spec.origin).parent
    source_dir = SCRIPT_DIR / "quran_transcript_data" / "quran-script"
    target_dir = package_dir / "quran-script"

    if not source_dir.exists():
        return

    target_dir.mkdir(parents=True, exist_ok=True)
    for source_file in source_dir.iterdir():
        if source_file.is_file():
            target_file = target_dir / source_file.name
            if not target_file.exists():
                shutil.copy2(source_file, target_file)


def check_dependencies() -> bool:
    """Validate that the Python packages required by the Muaalem pipeline are installed."""
    ensure_quran_transcript_data_files()

    missing: list[str] = []
    for module_name in (
        "torch",
        "torchaudio",
        "transformers",
        "librosa",
        "numpy",
        "soundfile",
        "recitations_segmenter",
        "quran_transcript",
        "fuzzysearch",
        "Levenshtein",
        "nemo",
    ):
        if importlib.util.find_spec(module_name) is None:
            missing.append(module_name)

    if missing:
        print(f"[ERROR] Missing required packages: {', '.join(missing)}", file=sys.stderr)
        return False
    return True


def resolve_device(device: str) -> DeviceContext:
    """Resolve the effective torch device from the requested device label."""
    import torch

    requested = device.upper()
    if requested == "GPU" and torch.cuda.is_available():
        return DeviceContext(name="GPU", torch_device="cuda", is_gpu=True)
    return DeviceContext(name="CPU", torch_device="cpu", is_gpu=False)


def get_moshaf_attributes():
    """Return the default Quran phonetic configuration used by quran-transcript."""
    global _MOSHAF_ATTRIBUTES_CACHE
    if _MOSHAF_ATTRIBUTES_CACHE is None:
        from quran_transcript import MoshafAttributes

        _MOSHAF_ATTRIBUTES_CACHE = MoshafAttributes(
            rewaya="hafs",
            madd_monfasel_len=4,
            madd_mottasel_len=4,
            madd_mottasel_waqf=4,
            madd_aared_len=4,
        )
    return _MOSHAF_ATTRIBUTES_CACHE


def normalize_phonetic_query(query: str) -> str:
    """Normalize a phonetic query the same way quran-transcript indexes phonemes."""
    from quran_transcript import chunck_phonemes

    groups = chunck_phonemes(query)
    return "".join(group[0] for group in groups if group)


def canonical_text_to_phonetic(text: str) -> str:
    """Convert canonical Quran text to the comparable phonetic representation."""
    from quran_transcript import quran_phonetizer

    normalized_text = unicodedata.normalize("NFC", text)
    phonemes = quran_phonetizer(
        normalized_text, get_moshaf_attributes(), remove_spaces=True
    ).phonemes
    return normalize_phonetic_query(phonemes)


def compute_match_confidence(query: str, matched_text: str, results_count: int = 1) -> float:
    """Compute a confidence score between the recognized query and the matched Quran text."""
    query_norm = normalize_phonetic_query(query)
    if not query_norm:
        return 0.0

    try:
        reference_norm = canonical_text_to_phonetic(matched_text)
    except Exception:
        reference_norm = ""

    if not reference_norm:
        query_len = len(query_norm)
        if query_len >= 18:
            base_confidence = 0.9
        elif query_len >= 12:
            base_confidence = 0.86
        elif query_len >= 8:
            base_confidence = 0.82
        else:
            base_confidence = 0.76

        ambiguity_penalty = min(0.18, max(0, results_count - 1) * 0.03)
        return round(max(0.55, base_confidence - ambiguity_penalty), 3)

    return round(SequenceMatcher(None, query_norm, reference_norm).ratio(), 3)


def get_phonetic_search():
    """Load and cache the Quran phonetic search index."""
    global _PHONETIC_SEARCH_CACHE
    if _PHONETIC_SEARCH_CACHE is None:
        from quran_transcript import PhoneticSearch

        _PHONETIC_SEARCH_CACHE = PhoneticSearch()
    return _PHONETIC_SEARCH_CACHE


def get_segmenter_models(device_context: DeviceContext, status_callback: Callable[[str, str], None]):
    """Load and cache the recitation segmenter model and processor."""
    global _SEGMENTER_CACHE
    if _SEGMENTER_CACHE is None:
        status_callback("segmenter", "Loading recitation segmenter...")
        from transformers import AutoFeatureExtractor
        from transformers.models.wav2vec2_bert import Wav2Vec2BertForAudioFrameClassification

        model = Wav2Vec2BertForAudioFrameClassification.from_pretrained(SEGMENTER_MODEL_ID)
        model = model.to(device_context.torch_device)
        processor = AutoFeatureExtractor.from_pretrained(SEGMENTER_MODEL_ID)
        _SEGMENTER_CACHE = (model, processor)
    return _SEGMENTER_CACHE


def get_stt_models(device_context: DeviceContext, status_callback: Callable[[str, str], None]):
    """Load and cache the Muaalem speech recognition stack."""
    global _STT_CACHE
    if _STT_CACHE is None:
        status_callback("stt", "Loading Muaalem speech model...")
        import torch
        from transformers import AutoFeatureExtractor

        from muaalem_modeling.modeling_multi_level_ctc import Wav2Vec2BertForMultilevelCTC
        from muaalem_modeling.multi_level_tokenizer import MultiLevelTokenizer

        model = Wav2Vec2BertForMultilevelCTC.from_pretrained(STT_MODEL_ID)
        model = model.to(device_context.torch_device)
        model.eval()
        feature_extractor = AutoFeatureExtractor.from_pretrained(STT_MODEL_ID)
        tokenizer = MultiLevelTokenizer(STT_MODEL_ID)
        _STT_CACHE = (model, feature_extractor, tokenizer)
    return _STT_CACHE


def get_forced_aligner(device_context: DeviceContext, status_callback: Callable[[str, str], None]):
    """Load and cache the forced aligner used for real word-by-word timings."""
    global _ALIGNER_CACHE
    if _ALIGNER_CACHE is None:
        status_callback("aligner", "Loading word alignment model...")
        from nemo.collections.asr.models import EncDecHybridRNNTCTCBPEModel

        from alignment_quran_recitation.ctc_aligner import CTCAligner

        model = EncDecHybridRNNTCTCBPEModel.from_pretrained(ALIGNER_MODEL_ID)
        model = model.to(device_context.torch_device)
        model.eval()
        _ALIGNER_CACHE = CTCAligner(model)
    return _ALIGNER_CACHE


def detect_intervals(
    audio: np.ndarray,
    sample_rate: int,
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int,
    device_context: DeviceContext,
    status_callback: Callable[[str, str], None],
) -> list[SegmentInterval]:
    """Detect cleaned speech intervals with the Quran recitation segmenter."""
    import torch
    from recitations_segmenter import clean_speech_intervals, segment_recitations

    model, processor = get_segmenter_models(device_context, status_callback)
    status_callback("segmenting", "Segmenting recitation by waqf...")

    wave_tensor = torch.tensor(audio, dtype=torch.float32)
    raw_outputs = segment_recitations(
        [wave_tensor],
        model=model,
        processor=processor,
        batch_size=16,
        device=torch.device(device_context.torch_device),
        dtype=torch.float32,
    )
    cleaned = clean_speech_intervals(
        raw_outputs[0].speech_intervals,
        raw_outputs[0].is_complete,
        min_silence_duration_ms=min_silence_ms,
        min_speech_duration_ms=min_speech_ms,
        pad_duration_ms=pad_ms,
        sample_rate=sample_rate,
    )

    intervals: list[SegmentInterval] = []
    for start_sample, end_sample in cleaned.clean_speech_intervals.tolist():
        start_value = max(0, int(start_sample))
        end_value = min(len(audio), max(start_value, int(end_sample)))
        intervals.append(
            SegmentInterval(
                start_sample=start_value,
                end_sample=end_value,
                start_s=round(start_value / sample_rate, 3),
                end_s=round(end_value / sample_rate, 3),
            )
        )
    return intervals


def decode_phonetic_transcript(
    segment_audio: np.ndarray,
    sample_rate: int,
    device_context: DeviceContext,
    status_callback: Callable[[str, str], None],
) -> str:
    """Transcribe one segment to the Muaalem phonetic script."""
    import torch

    model, feature_extractor, tokenizer = get_stt_models(device_context, status_callback)
    status_callback("transcribing", "Transcribing segments with Muaalem...")

    features = feature_extractor(segment_audio, sampling_rate=sample_rate, return_tensors="pt")
    features = {
        key: value.to(device_context.torch_device, dtype=torch.float32)
        for key, value in features.items()
    }

    with torch.no_grad():
        outputs = model(**features, return_dict=False)[0]

    level_to_pred_ids = {level: torch.argmax(logits, dim=-1).cpu() for level, logits in outputs.items()}
    decoded = tokenizer.decode(level_to_pred_ids, place_zeros_in_between=False)
    phonemes = decoded.get("phonemes", [""])[0]
    return "".join(phonemes.split())


def build_ref_string(surah: int, ayah: int, word_index_zero_based: int) -> str:
    """Build the app reference format from a Quran span component."""
    return f"{surah}:{ayah}:{word_index_zero_based + 1}"


def resolve_result_to_indices(result) -> Optional[tuple[int, int]]:
    """Convert a phonetic search result into Quran index boundaries."""
    quran_index = get_quran_index()
    start_key = (
        int(result.start.sura_idx),
        int(result.start.aya_idx),
        int(result.start.uthmani_word_idx) + 1,
    )
    end_key = (
        int(result.end.sura_idx),
        int(result.end.aya_idx),
        int(result.end.uthmani_word_idx) + 1,
    )
    start_idx = quran_index.word_lookup.get(start_key)
    end_idx = quran_index.word_lookup.get(end_key)
    if start_idx is None or end_idx is None or end_idx < start_idx:
        return None
    return start_idx, end_idx


def choose_monotonic_candidate(results: list, previous_end_idx: Optional[int]):
    """Choose the best Quran candidate while preferring forward monotonic progression."""
    candidates: list[tuple[float, int, object, int, int]] = []
    for result in results:
        indices = resolve_result_to_indices(result)
        if indices is None:
            continue
        start_idx, end_idx = indices
        if previous_end_idx is None:
            penalty = float(start_idx)
        else:
            gap = start_idx - previous_end_idx
            backward_penalty = abs(min(gap, 0)) * 8
            forward_penalty = max(gap, 0)
            penalty = backward_penalty + forward_penalty
        candidates.append((penalty, end_idx - start_idx, result, start_idx, end_idx))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1], item[3]))
    _, _, chosen_result, start_idx, end_idx = candidates[0]
    return chosen_result, start_idx, end_idx


def resolve_match(query: str, previous_end_idx: Optional[int]) -> Optional[ResolvedMatch]:
    """Resolve one phonetic transcript to the most plausible Quran span."""
    from quran_transcript import NoPhonemesSearchResult

    phonetic_search = get_phonetic_search()
    try:
        results = phonetic_search.search(query, error_ratio=DEFAULT_ERROR_RATIO)
    except NoPhonemesSearchResult:
        return None

    chosen = choose_monotonic_candidate(results, previous_end_idx)
    if chosen is None:
        return None

    chosen_result, start_idx, end_idx = chosen
    quran_index = get_quran_index()
    matched_text = quran_index.get_original_text(start_idx, end_idx)
    confidence = compute_match_confidence(query, matched_text, len(results))
    has_missing_words = previous_end_idx is not None and start_idx > previous_end_idx + 1
    potentially_undersegmented = confidence < 0.6 or len(results) > 5

    return ResolvedMatch(
        start_idx=start_idx,
        end_idx=end_idx,
        ref_from=build_ref_string(
            int(chosen_result.start.sura_idx),
            int(chosen_result.start.aya_idx),
            int(chosen_result.start.uthmani_word_idx),
        ),
        ref_to=build_ref_string(
            int(chosen_result.end.sura_idx),
            int(chosen_result.end.aya_idx),
            int(chosen_result.end.uthmani_word_idx),
        ),
        matched_text=matched_text,
        confidence=confidence,
        has_missing_words=has_missing_words,
        potentially_undersegmented=potentially_undersegmented,
    )


def build_word_entries(match: ResolvedMatch, interval: SegmentInterval, alignment_words: list[dict]) -> list[dict]:
    """Build the app-compatible word timestamp payload from alignment output."""
    quran_words = get_quran_index().words[match.start_idx : match.end_idx + 1]
    words: list[dict] = []
    for word_info, alignment_word in zip(quran_words, alignment_words):
        words.append(
            {
                "location": f"{word_info.surah}:{word_info.ayah}:{word_info.word}",
                "word": word_info.text,
                "start": round(interval.start_s + float(alignment_word.get("start_s", 0.0)), 3),
                "end": round(interval.start_s + float(alignment_word.get("end_s", 0.0)), 3),
            }
        )
    return words


def align_segment_words(
    segment_audio: np.ndarray,
    match: ResolvedMatch,
    interval: SegmentInterval,
    device_context: DeviceContext,
    status_callback: Callable[[str, str], None],
) -> tuple[list[dict], Optional[str], bool]:
    """Align one matched Quran segment against audio and return word timestamps."""
    status_callback("aligning", "Aligning matched Quran text word-by-word...")
    quran_index = get_quran_index()
    reference_text = quran_index.get_original_text(match.start_idx, match.end_idx)

    try:
        aligner = get_forced_aligner(device_context, status_callback)
        alignment_result = aligner.align(segment_audio, reference_text)
    except Exception as error:
        return [], f"Word alignment failed: {error}", True

    if alignment_result.get("error"):
        return [], str(alignment_result["error"]), True

    alignment_words = alignment_result.get("words", [])
    expected_words = match.end_idx - match.start_idx + 1
    if not alignment_words or len(alignment_words) != expected_words:
        return [], "Word alignment returned an incomplete word list.", True

    return build_word_entries(match, interval, alignment_words), None, False


def process_audio_full(
    audio: np.ndarray,
    sample_rate: int,
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int,
    model_name: str,
    device: str,
    include_wbw_timestamps: bool,
    status_callback: Callable[[str, str], None],
) -> dict:
    """Run the full local Muaalem pipeline and return app-compatible JSON."""
    if model_name != "Muaalem-v3.2":
        from segment_core.segment_processor import process_audio_full as process_open_audio_full

        whisper_model = OPEN_MULTI_MODELS.get(model_name, OPEN_MULTI_MODELS["Open-Tadabur-Small"])
        result = process_open_audio_full(
            audio=audio,
            sample_rate=sample_rate,
            min_silence_ms=min_silence_ms,
            min_speech_ms=min_speech_ms,
            pad_ms=pad_ms,
            whisper_model=whisper_model,
            status_callback=status_callback,
        )
        if include_wbw_timestamps:
            status_callback("wbw", "Generating local word-by-word timestamps...")
            result = inject_local_word_timestamps(result)
        return result

    device_context = resolve_device(device)
    intervals = detect_intervals(
        audio,
        sample_rate,
        min_silence_ms,
        min_speech_ms,
        pad_ms,
        device_context,
        status_callback,
    )

    segments: list[dict] = []
    previous_end_idx: Optional[int] = None
    for segment_number, interval in enumerate(intervals, start=1):
        segment_audio = audio[interval.start_sample : interval.end_sample]
        if segment_audio.size == 0:
            continue

        query = decode_phonetic_transcript(segment_audio, sample_rate, device_context, status_callback)
        if not query:
            continue

        status_callback("retrieving", "Matching the recitation to Quran passages...")
        match = resolve_match(query, previous_end_idx)
        if match is None:
            segments.append(
                {
                    "confidence": 0.0,
                    "error": "No Quran match found for this segment.",
                    "has_missing_words": False,
                    "potentially_undersegmented": True,
                    "matched_text": "",
                    "ref_from": "",
                    "ref_to": "",
                    "segment": segment_number,
                    "time_from": interval.start_s,
                    "time_to": interval.end_s,
                    "words": [],
                }
            )
            continue

        words: list[dict] = []
        align_error: Optional[str] = None
        undersegmented = match.potentially_undersegmented
        if include_wbw_timestamps:
            words, align_error, alignment_undersegmented = align_segment_words(
                segment_audio,
                match,
                interval,
                device_context,
                status_callback,
            )
            undersegmented = undersegmented or alignment_undersegmented

        segments.append(
            {
                "confidence": match.confidence,
                "error": align_error,
                "has_missing_words": match.has_missing_words,
                "potentially_undersegmented": undersegmented,
                "matched_text": match.matched_text,
                "ref_from": match.ref_from,
                "ref_to": match.ref_to,
                "segment": segment_number,
                "time_from": interval.start_s,
                "time_to": interval.end_s,
                "words": words,
            }
        )
        previous_end_idx = match.end_idx

    return {"segments": segments}


def main() -> int:
    """Run the local Muaalem pipeline and print the JSON response."""
    parser = argparse.ArgumentParser(description="Local Muaalem Quran segmentation")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--model-name", type=str, default="Muaalem-v3.2", choices=MUAALEM_MODEL_CHOICES)
    parser.add_argument("--device", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--include-wbw-timestamps", type=str, default="true")
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
        print(json.dumps({"error": f"Failed to download required Quran data: {error}"}))
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
        emit_status_to_stderr(original_stderr_file, "loading", "Loading audio file...")
        audio, sample_rate = load_audio(args.audio_path)
        result = process_audio_full(
            audio=audio,
            sample_rate=sample_rate,
            min_silence_ms=args.min_silence_ms,
            min_speech_ms=args.min_speech_ms,
            pad_ms=args.pad_ms,
            model_name=args.model_name,
            device=args.device,
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
