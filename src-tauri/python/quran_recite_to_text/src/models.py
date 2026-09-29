"""Unified Data Models for Transcription, CTC Alignment, and Quran Output Segments."""

from __future__ import annotations

import os
import json
from collections import defaultdict
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
import numpy as np


@dataclass(slots=True)
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
    raw_start: Optional[float] = None
    raw_end: Optional[float] = None

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


@dataclass(slots=True)
class PauseInterval:
    """Continuous acoustic silence interval with duration and Tajweed pause classification."""
    start_sec: float
    end_sec: float
    duration_sec: float
    pause_type: str = "waqf"  # "waqf" (>= 0.45s) or "sakt" (0.20s - 0.45s)
    min_energy_db: Optional[float] = None
    cut_point: Optional[float] = None

    @property
    def optimal_cut_point(self) -> float:
        """Exact click-free acoustic cut point or midpoint of silence interval."""
        if self.cut_point is not None:
            return round(self.cut_point, 3)
        return round((self.start_sec + self.end_sec) / 2.0, 3)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "start": round(self.start_sec, 3),
            "end": round(self.end_sec, 3),
            "duration": round(self.duration_sec, 3),
            "type": self.pause_type,
            "cut_point": self.optimal_cut_point,
        }
        if self.min_energy_db is not None:
            d["min_energy_db"] = round(self.min_energy_db, 1)
        return d


@dataclass(slots=True)
class RawTranscriptionResult:
    """Consolidated result of Phase 1 pure ONNX Zipformer CTC transcription."""
    phonemes: List[PhonemeToken] = field(default_factory=list)
    raw_tokens: List[str] = field(default_factory=list)
    raw_timestamps: List[float] = field(default_factory=list)
    logprobs_matrix: Optional[np.ndarray] = None
    num_frames: int = 0
    vocab_size: int = 251
    pause_timestamps: List[float] = field(default_factory=list)
    pause_intervals: List[PauseInterval] = field(default_factory=list)
    vad_time: float = 0.0

    @property
    def raw_text(self) -> str:
        return " ".join(self.raw_tokens)


@dataclass(slots=True)
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


@dataclass(slots=True)
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


@dataclass(slots=True)
class SpeechRecoveryResult:
    """Consolidated result of speech recovery."""
    recovered_phonemes: List[PhonemeToken]
    recovery_events: List[RecoveryEvent]
    recovery_summary: RecoverySummary


@dataclass(slots=True)
class QuranWord:
    """Word-level timing entry aligned to the Medina Mushaf."""
    word: str
    location: Optional[str] = None
    ref: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None
    score: Optional[float] = None
    phonemes: Optional[List[Dict[str, Any]]] = None
    raw_start: Optional[float] = None
    raw_end: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "word": self.word,
            "location": self.location,
            "ref": self.ref,
            "start": round(self.start, 2) if self.start is not None else None,
            "end": round(self.end, 2) if self.end is not None else None,
            "score": round(self.score, 2) if self.score is not None else 0.0,
            "phonemes": self.phonemes if self.phonemes is not None else [],
        }


def enforce_word_phoneme_monotonicity(word: 'QuranWord') -> None:
    """Cascades boundary adjustments through all phonemes in a word to ensure contiguity and prevent internal overlaps.

    Inside a single word, continuous speech dictates that phonemes are strictly contiguous:
    phoneme[i].start == phoneme[i-1].end, perfectly bridging [word.start, word.end] with NO gaps.
    """
    if not word.phonemes or len(word.phonemes) < 2:
        return
    w_start = word.start if word.start is not None else 0.0
    w_end = word.end if word.end is not None else word.phonemes[-1].get("end", 0.0)

    # Pin first phoneme to word start
    word.phonemes[0]["start"] = round(w_start, 2)
    if word.phonemes[0]["end"] <= word.phonemes[0]["start"]:
        word.phonemes[0]["end"] = round(word.phonemes[0]["start"] + 0.060, 2)

    # Forward pass: ensure contiguity within the word
    for i in range(1, len(word.phonemes)):
        # Bridge any internal gap or resolve overlap
        word.phonemes[i]["start"] = word.phonemes[i - 1]["end"]
        if word.phonemes[i]["end"] <= word.phonemes[i]["start"]:
            word.phonemes[i]["end"] = round(word.phonemes[i]["start"] + 0.060, 2)

    # Pin last phoneme to word end if word.end is set and greater than last start
    if word.phonemes[-1]["end"] != round(w_end, 2) and round(w_end, 2) > word.phonemes[-1]["start"]:
        word.phonemes[-1]["end"] = round(w_end, 2)

    # Backward pass: resolve if end was clamped below start
    for i in range(len(word.phonemes) - 2, -1, -1):
        if word.phonemes[i]["end"] > word.phonemes[i + 1]["start"]:
            word.phonemes[i]["end"] = word.phonemes[i + 1]["start"]
        if word.phonemes[i]["start"] >= word.phonemes[i]["end"]:
            prev_end = word.phonemes[i - 1]["end"] if i > 0 else round(w_start, 2)
            word.phonemes[i]["start"] = round(max(prev_end, word.phonemes[i]["end"] - 0.060), 2)
            if i > 0:
                word.phonemes[i - 1]["end"] = word.phonemes[i]["start"]


@dataclass(slots=True)
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


@dataclass(slots=True)
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


@dataclass(slots=True)
class PipelineProfiling:
    """Profiling breakdown for all pipeline stages."""
    audio_duration: float = 0.0
    load_time: float = 0.0
    vad_time: float = 0.0
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


@dataclass(slots=True)
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
    pause_intervals: List[PauseInterval] = field(default_factory=list)

    def to_output_dict(self) -> Dict[str, Any]:
        return {"total_ayahs": len(self.segments), "ayahs": [s.to_dict() for s in self.segments]}

    def to_qurancaption_response(
        self,
        offset_s: float = 0.0,
        start_segment_idx: int = 1,
    ) -> List[Dict[str, Any]]:
        """Direct native export to QuranCaption timeline segment format.

        Extracts intro segments (Isti'adha/Basmala) and transforms each Ayah's
        sub-segments into individual timeline segments with normalized relative word timings.
        """
        def _normalize_words(words: List[Dict[str, Any]], duration: float) -> List[Dict[str, Any]]:
            if not words:
                return []
            dur = max(0.0, duration)
            prev = 0.0
            starts = []
            for idx, w in enumerate(words):
                s = 0.0 if idx == 0 else float(w.get("start", 0.0))
                clamped = max(prev, min(dur, s))
                starts.append(clamped)
                prev = clamped

            return [
                {
                    "word": str(w.get("word", "")),
                    "location": str(w.get("location", "")),
                    "start": round(starts[idx], 3),
                    "end": round(max(starts[idx], starts[idx + 1] if idx < len(words) - 1 else dur), 3),
                }
                for idx, w in enumerate(words)
            ]

        raw_segments: List[Dict[str, Any]] = []

        # 1. Opening Intro (Isti'adha / Basmalah)
        if self.segments:
            intro = getattr(self.segments[0], "intro", None)
            if intro and intro.get("words"):
                raw_intro_words = intro["words"]
                ist_words = [
                    w for w in raw_intro_words
                    if str(w.get("location", "") if isinstance(w, dict) else getattr(w, "location", "")).startswith("0:1:")
                ]
                bas_words = [
                    w for w in raw_intro_words
                    if not str(w.get("location", "") if isinstance(w, dict) else getattr(w, "location", "")).startswith("0:1:")
                ]

                groups_to_process = []
                if ist_words and bas_words:
                    groups_to_process.append(("Isti'adha", ist_words))
                    groups_to_process.append(("Basmala", bas_words))
                elif raw_intro_words:
                    text_peek = " ".join(
                        str(w.get("word", "") if isinstance(w, dict) else getattr(w, "word", ""))
                        for w in raw_intro_words
                    )
                    spec = "Isti'adha" if any(x in text_peek for x in ("أَعوذُ", "اعوذ", "أعوذ")) else "Basmala"
                    groups_to_process.append((spec, raw_intro_words))

                for spec_type, g_words in groups_to_process:
                    g_raw_starts = [
                        float(w.get("start", intro.get("start", 0.0)) if isinstance(w, dict) else getattr(w, "start", 0.0))
                        for w in g_words
                    ]
                    g_raw_ends = [
                        float(w.get("end", intro.get("end", 0.0)) if isinstance(w, dict) else getattr(w, "end", 0.0))
                        for w in g_words
                    ]
                    g_abs_s = round(min(g_raw_starts) + offset_s, 3)
                    g_abs_e = round(max(g_raw_ends) + offset_s, 3)
                    if g_abs_e <= g_abs_s:
                        g_abs_e = round(g_abs_s + 0.1, 3)
                    g_dur = max(0.0, round(g_abs_e - g_abs_s, 3))

                    w_list = []
                    for w in g_words:
                        w_d = w if isinstance(w, dict) else (w.to_dict() if hasattr(w, "to_dict") else vars(w))
                        ws = float(w_d.get("start", g_abs_s)) + offset_s
                        we = float(w_d.get("end", g_abs_e)) + offset_s
                        w_list.append({
                            "word": str(w_d.get("word", "")),
                            "location": str(w_d.get("location", "1:1:1")),
                            "start": max(0.0, round(ws - g_abs_s, 3)),
                            "end": min(g_dur, max(0.0, round(we - g_abs_s, 3))),
                        })

                    norm_words = _normalize_words(w_list, g_dur)
                    text = " ".join(w["word"] for w in norm_words if w.get("word"))
                    raw_segments.append({
                        "segment": 0,
                        "time_from": g_abs_s,
                        "time_to": g_abs_e,
                        "ref_from": spec_type,
                        "ref_to": spec_type,
                        "special_type": spec_type,
                        "matched_text": text,
                        "confidence": 1.0,
                        "error": None,
                        "has_missing_words": False,
                        "potentially_undersegmented": False,
                        "words": norm_words,
                    })

        # 2. Extract Ayahs and Sub-segments
        for seg in self.segments:
            sub_segments = seg.sub_segments or [
                AyahSubSegment(
                    sub_segment_number=1,
                    start_time=seg.start_time,
                    end_time=seg.end_time,
                    text=" ".join(w.word for w in seg.words),
                    words_range=seg.matched_ref,
                    words=seg.words,
                )
            ]

            for sub in sub_segments:
                sub_abs_s = round(float(sub.start_time) + offset_s, 3)
                sub_abs_e = round(float(sub.end_time) + offset_s, 3)
                if sub_abs_e <= sub_abs_s:
                    sub_abs_e = round(sub_abs_s + 0.1, 3)
                sub_dur = max(0.0, round(sub_abs_e - sub_abs_s, 3))

                words_list: List[Dict[str, Any]] = []
                scores: List[float] = []

                for w in sub.words:
                    w_s = float(w.start if w.start is not None else sub.start_time) + offset_s
                    w_e = float(w.end if w.end is not None else sub.end_time) + offset_s
                    if w.score is not None:
                        scores.append(float(w.score))
                    words_list.append({
                        "word": str(w.word or ""),
                        "location": str(w.location or f"{seg.surah_number}:{seg.ayah}:1"),
                        "start": max(0.0, round(w_s - sub_abs_s, 3)),
                        "end": min(sub_dur, max(0.0, round(w_e - sub_abs_s, 3))),
                    })

                norm_words = _normalize_words(words_list, sub_dur)

                if norm_words and norm_words[0].get("location") and norm_words[-1].get("location"):
                    ref_from = norm_words[0]["location"]
                    ref_to = norm_words[-1]["location"]
                    matched_text = " ".join(w["word"] for w in norm_words if w.get("word"))
                elif sub.words_range:
                    wr = str(sub.words_range)
                    ref_from, ref_to = wr.split("-", 1) if "-" in wr else (wr, wr)
                    matched_text = " ".join(w["word"] for w in norm_words if w.get("word")) or sub.text
                else:
                    ref_str = str(seg.matched_ref or f"{seg.surah_number}:{seg.ayah}:1")
                    ref_from, ref_to = ref_str.split("-", 1) if "-" in ref_str else (ref_str, ref_str)
                    matched_text = " ".join(w["word"] for w in norm_words if w.get("word")) or sub.text

                conf = round(sum(scores) / max(1, len(scores)), 3) if scores else 1.0

                raw_segments.append({
                    "segment": 0,
                    "time_from": sub_abs_s,
                    "time_to": sub_abs_e,
                    "ref_from": ref_from,
                    "ref_to": ref_to,
                    "matched_text": matched_text,
                    "confidence": conf,
                    "error": None,
                    "has_missing_words": False,
                    "potentially_undersegmented": False,
                    "words": norm_words,
                })

        # 3. Sort segments by time_from and eliminate overlaps
        raw_segments.sort(key=lambda s: s["time_from"])

        for i in range(len(raw_segments) - 1):
            curr_seg = raw_segments[i]
            next_seg = raw_segments[i + 1]
            if curr_seg["time_to"] > next_seg["time_from"]:
                curr_seg["time_to"] = next_seg["time_from"]
                dur = max(0.0, round(curr_seg["time_to"] - curr_seg["time_from"], 3))
                if curr_seg.get("words"):
                    curr_seg["words"] = _normalize_words(curr_seg["words"], dur)

        # 4. Filter out any zero duration segments & re-index 1-based
        raw_segments = [s for s in raw_segments if s["time_to"] > s["time_from"]]
        for idx, seg in enumerate(raw_segments, start=start_segment_idx):
            seg["segment"] = idx

        return raw_segments

    def export_json(self, output_dir: str = ".") -> Dict[str, str]:
        """Exports all canonical JSON artifacts into the specified directory."""
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
                "pause_intervals": [p.to_dict() for p in self.pause_intervals],
                "pause_timestamps": self.pause_timestamps,
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
            "qurancaption_segments.json": {
                "segments": self.to_qurancaption_response(),
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
    vad = "vad"
    transcribing = "transcribing"
    recovering = "recovering"
    aligning = "aligning"
    matching = "matching"
    exporting = "exporting"
    completed = "completed"
    error = "error"


@dataclass(slots=True)
class PipelineProgressEvent:
    """Typed real-time progress update emitted during pipeline execution."""
    stage: PipelineStage
    percent: float
    elapsed_seconds: float
    speed_x: Optional[float] = None
    message: str = ""
