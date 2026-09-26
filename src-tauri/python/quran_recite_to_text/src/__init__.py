"""QuranReciteToText Package Entry Point & Central Pipeline Coordinator."""

from __future__ import annotations

import os
import sys
import gc
import json
import time
import threading
from typing import Optional, Callable, Dict, Any, List, Union, Tuple
import numpy as np

import config
from config import (
    SAMPLE_RATE,
    BLANK_ID,
    DEFAULT_MODEL_PATH,
    DEFAULT_TOKENS_PATH,
    DEFAULT_QURAN_PHONEMES_PATH,
    DEFAULT_REF_NORM_PH_PATH,
    DEFAULT_PH_INDEX_PATH,
    ENABLE_SPEECH_RECOVERY,
)
from src.models import (
    PhonemeToken,
    RawTranscriptionResult,
    RecoveryEvent,
    RecoverySummary,
    SpeechRecoveryResult,
    QuranWord,
    AyahSubSegment,
    QuranSegment,
    PipelineProfiling,
    PipelineResult,
    PipelineStage,
    PipelineProgressEvent,
)
from src.audio import AudioDecoder
from src.transcriber import ZipformerONNX, SpeechRecoveryEngine
from src.aligner import CtcViterbiAligner, warmup_aligner_jit
from src.matching import (
    QuranWordMatcher,
    MatcherConfig,
    warmup_matcher_jit,
    warmup_detector_jit,
)


class AudioPipeline:
    """Central 4-phase audio transcription and Quran alignment coordinator."""

    def __init__(self):
        self.transcriber = None
        self.matcher = QuranWordMatcher()

    def initialize(
        self,
        model_path: str = DEFAULT_MODEL_PATH,
        tokens_path: str = DEFAULT_TOKENS_PATH,
        quran_phonemes_path: str = DEFAULT_QURAN_PHONEMES_PATH,
        ref_norm_ph_path: str = DEFAULT_REF_NORM_PH_PATH,
        ph_index_path: str = DEFAULT_PH_INDEX_PATH,
        num_threads: int = 2,
    ) -> None:
        if self.transcriber is None:
            self.transcriber = ZipformerONNX.get_instance()

        if not self.matcher.is_initialized and os.path.exists(quran_phonemes_path):
            self.matcher.initialize_from_file(
                json_file_path=quran_phonemes_path,
                ref_norm_ph_path=ref_norm_ph_path,
                ph_index_path=ph_index_path,
            )




    def process_audio_file(
        self,
        audio_file_path: str,
        output_dir: str = ".",
        export_json_files: bool = True,
        on_progress_event: Optional[Callable[[PipelineProgressEvent], None]] = None,
        target_surah: Optional[int] = None,
        start_ayah: Optional[int] = None,
    ) -> PipelineResult:
        load_start = time.time()
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(stage=PipelineStage.loading, percent=0.0, elapsed_seconds=0.0, message="Loading audio...")
            )

        audio_pcm = AudioDecoder.load_audio_file(audio_file_path)
        load_time = time.time() - load_start

        return self.process_pcm(
            audio_pcm=audio_pcm,
            load_time=load_time,
            output_dir=output_dir,
            export_json_files=export_json_files,
            on_progress_event=on_progress_event,
            target_surah=target_surah,
            start_ayah=start_ayah,
        )

    def process_pcm(
        self,
        audio_pcm: np.ndarray,
        load_time: float = 0.0,
        output_dir: str = ".",
        export_json_files: bool = True,
        on_progress_event: Optional[Callable[[PipelineProgressEvent], None]] = None,
        live_profile: bool = False,
        json_progress: bool = False,
        target_surah: Optional[int] = None,
        start_ayah: Optional[int] = None,
    ) -> PipelineResult:
        overall_start = time.time()
        audio_duration = len(audio_pcm) / SAMPLE_RATE

        # Phase 1: ASR Transcription
        asr_start = time.time()
        last_progress_time = [0.0]

        def _on_asr_progress(pct: float, spd: float, elp: float) -> None:
            now = time.time()
            if (now - last_progress_time[0] >= 0.25) or pct >= 100.0:
                last_progress_time[0] = now
                if json_progress:
                    sys.stdout.write(json.dumps({"stage": "transcribing", "percent": round(pct, 1), "elapsed": round(elp, 1), "speed_x": round(spd, 1)}) + "\n")
                    sys.stdout.flush()
                elif live_profile:
                    filled = int(20 * pct / 100.0)
                    bar = "=" * filled + " " * (20 - filled)
                    sys.stdout.write(f"\rPhase 1 Transcribe  : [{bar}] {pct:3.0f}% ({elp:.1f}s)")
                    sys.stdout.flush()
                if on_progress_event:
                    on_progress_event(
                        PipelineProgressEvent(
                            stage=PipelineStage.transcribing,
                            percent=pct,
                            elapsed_seconds=elp,
                            speed_x=spd,
                            message=f"Transcribing {pct:.0f}%",
                        )
                    )

        raw_result = self.transcriber.transcribe_audio(
            audio=audio_pcm,
            sample_rate=SAMPLE_RATE,
            on_progress=_on_asr_progress if (live_profile or json_progress or on_progress_event) else None,
        )
        raw_phonemes = raw_result.phonemes
        asr_time = time.time() - asr_start
        if live_profile:
            sys.stdout.write("\r" + " " * 75 + f"\rPhase 1 Transcribe  : {asr_time:.2f}s\n")
            sys.stdout.flush()

        # Phase 1.1: Speech Recovery (if enabled)
        effective_phonemes = raw_phonemes
        recovery_events: List[RecoveryEvent] = []
        recovery_summary = RecoverySummary(0.0, 0, 0, 0, 0)
        recovery_time = 0.0

        if getattr(config, "ENABLE_SPEECH_RECOVERY", ENABLE_SPEECH_RECOVERY):
            rec_start = time.time()
            rec_res = SpeechRecoveryEngine.recover_speech(
                audio_pcm=audio_pcm,
                initial_phonemes=raw_phonemes,
                audio_duration=audio_duration,
                transcriber=self.transcriber,
                logprobs_matrix=raw_result.logprobs_matrix,
            )
            effective_phonemes = rec_res.recovered_phonemes
            recovery_events = rec_res.recovery_events
            recovery_summary = rec_res.recovery_summary
            recovery_time = time.time() - rec_start
            if live_profile:
                print(f"Phase 1.1 Recovery  : {recovery_time:.2f}s", flush=True)

        # Release raw PCM audio buffer to reclaim memory before Phase 2 CTC Alignment
        audio_pcm = None

        # Phase 2: CTC Viterbi Trellis Alignment
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.matching,
                    percent=70.0,
                    elapsed_seconds=round(time.time() - overall_start, 2),
                    message="Aligning phonemes (CTC Trellis)...",
                )
            )
        align_start = time.time()
        aligned_phonemes = CtcViterbiAligner.align_phonemes(
            target_phonemes=effective_phonemes,
            audio_duration=audio_duration,
            token2id=self.transcriber.token2id,
            logprobs_matrix=raw_result.logprobs_matrix,
            num_frames=raw_result.num_frames,
            custom_blank_id=BLANK_ID,
            pause_timestamps=raw_result.pause_timestamps,
        )
        align_time = time.time() - align_start
        if live_profile:
            print(f"Phase 2 CTC Align   : {align_time:.2f}s", flush=True)

        # Release large emission logprobs matrix before Phase 3 to reclaim physical RAM
        raw_result.logprobs_matrix = None
        gc.collect()

        # Phase 3: Quran Text Matcher & Sequencer
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.matching,
                    percent=85.0,
                    elapsed_seconds=round(time.time() - overall_start, 2),
                    message="Matching Quran verses...",
                )
            )
        match_start = time.time()
        segments = self.matcher.match_segments(
            aligned_phonemes=aligned_phonemes,
            audio_duration=audio_duration,
            target_surah=target_surah,
            start_ayah=start_ayah,
            pause_timestamps=raw_result.pause_timestamps,
        )
        match_time = time.time() - match_start
        if live_profile:
            print(f"Phase 3 Text Match  : {match_time:.2f}s", flush=True)

        # Phase 4: Construct Consolidated Result & JSON Export
        export_start = time.time()
        for seg in segments:
            if not seg.sub_segments:
                seg.sub_segments = None
            else:
                for idx, sub in enumerate(seg.sub_segments):
                    sub.sub_segment_number = idx + 1

        result = PipelineResult(
            audio_duration_seconds=audio_duration,
            raw_phonemes=raw_phonemes,
            recovered_phonemes=effective_phonemes,
            recovery_events=recovery_events,
            recovery_summary=recovery_summary,
            ctc_aligned_phonemes=aligned_phonemes,
            segments=segments,
            pause_timestamps=raw_result.pause_timestamps,
        )

        if export_json_files:
            result.export_json(output_dir=output_dir)

        export_time = time.time() - export_start
        if live_profile:
            print(f"Phase 4 JSON Export : {export_time:.2f}s", flush=True)
        total_time = time.time() - overall_start

        profiling = PipelineProfiling(
            audio_duration=audio_duration,
            load_time=load_time,
            asr_time=asr_time,
            recovery_time=recovery_time,
            alignment_time=align_time,
            match_time=match_time,
            export_time=export_time,
            total_time=total_time,
        )
        result.total_processing_time_seconds = total_time
        result.profiling = profiling

        return result


_shared_pipeline: Optional[AudioPipeline] = None


def get_shared_pipeline() -> AudioPipeline:
    global _shared_pipeline
    if _shared_pipeline is None:
        _shared_pipeline = AudioPipeline()
        _shared_pipeline.initialize()
    return _shared_pipeline


def process_audio(
    audio_data: Union[str, np.ndarray, Tuple[int, np.ndarray]],
    output_dir: str = ".",
    export_json_files: bool = False,
    return_profiling: bool = False,
) -> Union[List[Dict[str, Any]], Tuple[List[Dict[str, Any]], PipelineProfiling]]:
    """Functional one-line runner for audio alignment."""
    pipeline = get_shared_pipeline()
    if isinstance(audio_data, str):
        result = pipeline.process_audio_file(
            audio_file_path=audio_data,
            output_dir=output_dir,
            export_json_files=export_json_files,
        )
    elif isinstance(audio_data, tuple):
        orig_sr, pcm = audio_data
        if orig_sr != SAMPLE_RATE:
            import librosa
            pcm = librosa.resample(pcm.astype(np.float32), orig_sr=orig_sr, target_sr=SAMPLE_RATE)
        result = pipeline.process_pcm(
            audio_pcm=pcm.astype(np.float32),
            output_dir=output_dir,
            export_json_files=export_json_files,
        )
    else:
        result = pipeline.process_pcm(
            audio_pcm=audio_data.astype(np.float32),
            output_dir=output_dir,
            export_json_files=export_json_files,
        )

    segments_dicts = [s.to_dict() for s in result.segments]
    if return_profiling:
        return segments_dicts, result.profiling
    return segments_dicts


__all__ = [
    "AudioPipeline",
    "process_audio",
    "get_shared_pipeline",
    "AudioDecoder",
    "ZipformerONNX",
    "SpeechRecoveryEngine",
    "CtcViterbiAligner",
    "QuranWordMatcher",
    "MatcherConfig",
    "PhonemeToken",
    "QuranWord",
    "QuranSegment",
    "AyahSubSegment",
    "PipelineResult",
    "PipelineProfiling",
    "PipelineStage",
    "PipelineProgressEvent",
]
