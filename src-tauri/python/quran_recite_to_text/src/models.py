"""Unified Data Models for Transcription, CTC Alignment, and Quran Output Segments."""

from __future__ import annotations

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
import numpy as np


@dataclass
class PhonemeToken:
    """Individual acoustic phoneme token with timestamps and confidence."""
    phoneme: str
    start: float
    end: float
    confidence: float = 1.0
    is_recovered: bool = False
    start_frame: Optional[int] = None
    end_frame: Optional[int] = None
    peak_frame: Optional[int] = None
    peak_timestamp: Optional[float] = None

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> Dict[str, Any]:
        d = {"phoneme": self.phoneme, "start": round(self.start, 2), "end": round(self.end, 2)}
        if self.is_recovered: d["is_recovered"] = True
        return d

    def to_raw_dict(self, index: int) -> Dict[str, Any]:
        d = {"index": index, "phoneme": self.phoneme, "start": round(self.start, 3), "end": round(self.end, 3), "duration": round(self.duration, 3), "confidence": round(self.confidence, 2)}
        for k in ("start_frame", "end_frame", "peak_frame"):
            v = getattr(self, k)
            if v is not None: d[k] = v
        if self.peak_timestamp is not None: d["peak_timestamp"] = round(self.peak_timestamp, 3)
        if self.is_recovered: d["is_recovered"] = True
        return d

    def to_aligned_dict(self, index: int) -> Dict[str, Any]:
        d = {"index": index, "phoneme": self.phoneme, "start_seconds": round(self.start, 3), "end_seconds": round(self.end, 3), "duration_seconds": round(self.duration, 3), "confidence": round(self.confidence, 2), "is_recovered": self.is_recovered}
        if self.start_frame is not None: d["start_frame"] = self.start_frame
        if self.end_frame is not None: d["end_frame"] = self.end_frame
        return d


@dataclass
class RawTranscriptionResult:
    """Consolidated result of Phase 1 pure ONNX Zipformer CTC transcription."""
    phonemes: List[PhonemeToken] = field(default_factory=list)
    raw_tokens: List[str] = field(default_factory=list)
    raw_timestamps: List[float] = field(default_factory=list)
    logprobs_matrix: Optional[np.ndarray] = None
    num_frames: int = 0
    vocab_size: int = 251
    pause_timestamps: List[float] = field(default_factory=list)

    @property
    def raw_text(self) -> str:
        return " ".join(self.raw_tokens)


@dataclass
class RecoveryEvent:
    """Recovered speech event from an untranscribed deletion hole."""
    event_id: int
    gap_start: float
    gap_end: float
    gap_duration: float
    padded_start: float
    padded_end: float
    energy_db: float
    recovered_text: str
    recovered_phonemes: List[PhonemeToken] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "gap_start": round(self.gap_start, 3), "gap_end": round(self.gap_end, 3),
            "gap_duration": round(self.gap_duration, 3), "padded_start": round(self.padded_start, 3),
            "padded_end": round(self.padded_end, 3), "energy_db": round(self.energy_db, 1),
            "recovered_text": self.recovered_text, "phoneme_count": len(self.recovered_phonemes),
            "recovered_phonemes": [
                {"phoneme": p.phoneme, "start": round(p.start, 3), "end": round(p.end, 3), "duration": round(p.duration, 3), "confidence": round(p.confidence, 2)}
                for p in self.recovered_phonemes
            ],
        }


@dataclass
class RecoverySummary:
    """Statistical summary of the speech recovery pass."""
    recovery_time_seconds: float
    scanned_gaps_count: int
    speech_holes_detected: int
    recovered_events_count: int
    recovered_phonemes_count: int
    energy_threshold_db: float = -35.0
    min_hole_duration_s: float = 0.40

    def to_dict(self) -> Dict[str, Any]:
        return {
            "recovery_time_seconds": round(self.recovery_time_seconds, 3),
            "scanned_gaps_count": self.scanned_gaps_count,
            "speech_holes_detected": self.speech_holes_detected,
            "recovered_events_count": self.recovered_events_count,
            "recovered_phonemes_count": self.recovered_phonemes_count,
            "energy_threshold_db": self.energy_threshold_db,
            "min_hole_duration_s": self.min_hole_duration_s,
        }


@dataclass
class SpeechRecoveryResult:
    """Consolidated result of speech recovery."""
    recovered_phonemes: List[PhonemeToken]
    recovery_events: List[RecoveryEvent]
    recovery_summary: RecoverySummary


@dataclass
class QuranWord:
    """Word-level timing entry aligned to the Medina Mushaf."""
    word: str
    location: Optional[str] = None
    ref: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None
    score: Optional[float] = None
    phonemes: Optional[List[Dict[str, Any]]] = None
    all_passes: Optional[List[Dict[str, Any]]] = None
    is_interpolated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "word": self.word,
            "location": self.location,
            "ref": self.ref,
            "start": round(self.start, 2) if self.start is not None else None,
            "end": round(self.end, 2) if self.end is not None else None,
            "score": round(self.score, 2) if self.score is not None else 0.0,
            "phonemes": self.phonemes if self.phonemes is not None else [],
        }
        if self.is_interpolated:
            d["is_interpolated"] = True
        if self.all_passes:
            d["all_passes"] = self.all_passes
        return d


@dataclass
class AyahSubSegment:
    """Ayah sub-segment (e.g. for repetition or contiguous phrase tracking)."""
    sub_segment_number: int
    start_time: float
    end_time: float
    text: str
    words_range: str
    is_repetition: bool = False
    words: List[QuranWord] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "segment": self.sub_segment_number,
            "start": round(self.start_time, 2),
            "end": round(self.end_time, 2),
            "transcribed_text": self.text,
            "words": [w.to_dict() for w in self.words],
        }
        if self.words_range:
            d["words_range"] = self.words_range
        if self.is_repetition:
            d["is_repetition"] = True
        return d


@dataclass
class QuranSegment:
    """Canonical 1-Ayah segment containing aligned words, subsegments, and metadata."""
    segment_number: int
    ayah: int = 1
    surah_number: int = 1
    start_time: float = 0.0
    end_time: float = 0.0
    matched_ref: str = ""
    words: List[QuranWord] = field(default_factory=list)
    repeated_ranges: Optional[List[Any]] = None
    repeated_text: Optional[List[str]] = None
    sub_segments: Optional[List[AyahSubSegment]] = None
    intro: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        real_ayah = self.ayah if self.ayah is not None else self.segment_number
        if self.matched_ref and ":" in self.matched_ref:
            try:
                real_ayah = int(self.matched_ref.split(":")[1])
            except Exception:
                pass

        d: Dict[str, Any] = {
            "ayah": real_ayah,
            "start": round(self.start_time, 2),
            "end": round(self.end_time, 2),
            "matched_ref": self.matched_ref,
        }
        if self.repeated_ranges:
            d["repeated_ranges"] = self.repeated_ranges
        if self.repeated_text:
            d["repeated_text"] = self.repeated_text

        if self.sub_segments:
            d["segments"] = [s.to_dict() for s in self.sub_segments]
        else:
            seg_asr = " ".join("".join(p.get("phoneme", "") for p in (w.phonemes or [])) for w in self.words if w.phonemes)
            d["segments"] = [
                {
                    "segment": 1,
                    "start": round(self.start_time, 2),
                    "end": round(self.end_time, 2),
                    "transcribed_text": seg_asr,
                    "words": [w.to_dict() for w in self.words],
                }
            ]
        return d


@dataclass
class PipelineProfiling:
    """Profiling breakdown for all pipeline stages."""
    audio_duration: float = 0.0
    load_time: float = 0.0
    asr_time: float = 0.0
    recovery_time: float = 0.0
    alignment_time: float = 0.0
    match_time: float = 0.0
    export_time: float = 0.0
    total_time: float = 0.0

    @property
    def real_time_factor(self) -> float:
        return (self.audio_duration / self.total_time) if self.total_time > 0 else 0.0

    @property
    def asr_real_time_factor(self) -> float:
        return (self.audio_duration / self.asr_time) if self.asr_time > 0 else 0.0


@dataclass
class PipelineResult:
    """Consolidated result of the entire pipeline execution."""
    audio_duration_seconds: float
    raw_phonemes: List[PhonemeToken]
    recovered_phonemes: List[PhonemeToken]
    recovery_events: List[RecoveryEvent]
    recovery_summary: RecoverySummary
    ctc_aligned_phonemes: List[PhonemeToken]
    segments: List[QuranSegment] = field(default_factory=list)
    total_processing_time_seconds: float = 0.0
    profiling: Optional[PipelineProfiling] = None
    pause_timestamps: List[float] = field(default_factory=list)

    def to_output_dict(self) -> Dict[str, Any]:
        return {"total_ayahs": len(self.segments), "ayahs": [s.to_dict() for s in self.segments]}

    def export_json(self, output_dir: str = ".") -> Dict[str, str]:
        """Exports all 4 canonical JSON artifacts into the specified directory."""
        import os
        import json
        from collections import defaultdict

        os.makedirs(output_dir, exist_ok=True)
        dur = round(self.audio_duration_seconds, 3)
        by_surah: Dict[int, List[QuranSegment]] = defaultdict(list)
        for s in self.segments:
            by_surah[s.surah_number].append(s)

        artifacts = {
            "raw_transcription.json": {
                "audio_duration_seconds": dur,
                "total_tokens": len(self.raw_phonemes),
                "raw_text": "".join(p.phoneme for p in self.raw_phonemes),
                "phoneme_tokens": [p.to_raw_dict(i + 1) for i, p in enumerate(self.raw_phonemes)],
            },
            "recovered_speech.json": {
                "audio_duration_seconds": dur,
                "recovery_summary": self.recovery_summary.to_dict() if self.recovery_summary is not None else {},
                "recovery_events": [e.to_dict() for e in self.recovery_events] if self.recovery_events else [],
            },
            "ctc_aligned_phonemes.json": {
                "audio_duration_seconds": dur,
                "total_phonemes": len(self.ctc_aligned_phonemes),
                "raw_text": "".join(p.phoneme for p in self.ctc_aligned_phonemes),
                "aligned_phonemes": [p.to_aligned_dict(i + 1) for i, p in enumerate(self.ctc_aligned_phonemes)],
            },
            "output.json": {
                "total_surahs": len(by_surah),
                "surahs": [
                    {
                        "surah": k,
                        **({"intro": v[0].intro} if v and getattr(v[0], "intro", None) else {}),
                        "ayahs": [s.to_dict() for s in v],
                    }
                    for k, v in by_surah.items()
                ],
            },
        }
        paths = {}
        for fname, data in artifacts.items():
            fpath = os.path.join(output_dir, fname)
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            paths[fname] = fpath
        return paths


class PipelineStage(str, Enum):
    """Processing stages for progress callbacks."""
    idle = "idle"
    loading = "loading"
    transcribing = "transcribing"
    recovering = "recovering"
    aligning = "aligning"
    matching = "matching"
    exporting = "exporting"
    completed = "completed"
    error = "error"


@dataclass
class PipelineProgressEvent:
    """Typed real-time progress update emitted during pipeline execution."""
    stage: PipelineStage
    percent: float
    elapsed_seconds: float
    speed_x: Optional[float] = None
    message: str = ""
