"""QuranReciteToText Package Entry Point & Central Pipeline Coordinator."""

from __future__ import annotations

import os
import sys

# Bootstrap Windows MSVC runtime and console streams before importing C extensions
import data.bin.bootstrap

import gc
import json
import time
from pathlib import Path
from collections import defaultdict
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
    DEFAULT_OUTPUT_DIR,
    ENABLE_SPEECH_RECOVERY,
)
from src.models import (
    PhonemeToken,
    PauseInterval,
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
from src.audio import AudioDecoder, _resample_audio
from src.transcriber import ZipformerONNX, SpeechRecoveryEngine
from src.aligner.ctc_aligner import CtcViterbiAligner, warmup_aligner_jit
from src.matching import (
    QuranWordMatcher,
    MatcherConfig,
    warmup_matching,
    QiraatAyahMapper,
    QuranCountingSystem,
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
        if "ONNX_NUM_THREADS" not in os.environ:
            os.environ["ONNX_NUM_THREADS"] = str(num_threads)

        if self.transcriber is None:
            self.transcriber = ZipformerONNX.get_instance()

        if not self.matcher.is_initialized and os.path.exists(quran_phonemes_path):
            self.matcher.initialize_from_file(
                json_file_path=quran_phonemes_path,
                ref_norm_ph_path=ref_norm_ph_path,
                ph_index_path=ph_index_path,
            )

        # Warm up Numba JIT kernels so runtime Phase 2 and Phase 3 are instant
        try:
            warmup_aligner_jit()
            warmup_matching()
        except Exception:
            pass

    def process_audio_file(
        self,
        audio_file_path: str,
        output_dir: str = ".",
        export_json_files: bool = True,
        on_progress_event: Optional[Callable[[PipelineProgressEvent], None]] = None,
        target_surah: Optional[int] = None,
        start_ayah: Optional[int] = None,
        enable_mfa: bool = False,
        qiraat: str = "hafs",
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
            enable_mfa=enable_mfa,
            qiraat=qiraat,
        )

    def process_directory(
        self,
        input_dir: str,
        output_dir: str = DEFAULT_OUTPUT_DIR,
        live_profile: bool = False,
        json_progress: bool = False,
        on_progress_event: Optional[Callable[[PipelineProgressEvent], None]] = None,
        enable_mfa: bool = False,
        qiraat: str = "hafs",
    ) -> Dict[str, Any]:
        """Transcribes all audio files in a directory recursively, preserving folder hierarchy.

        Outputs <audio_stem>.json for each audio, and an ordered all_surahs.json per subfolder.
        """
        input_root = Path(input_dir).resolve()
        out_root = Path(output_dir).resolve()

        audio_files = sorted(
            [p for p in input_root.rglob("*") if p.is_file() and p.suffix.lower() in AudioDecoder.SUPPORTED_EXTENSIONS]
        )

        total_files = len(audio_files)
        if total_files == 0:
            if live_profile:
                print(f"[!] No audio files found in directory: {input_root}", file=sys.stderr)
            elif json_progress:
                print(json.dumps({"stage": "batch_error", "message": f"No audio files found in: {input_root}"}), flush=True)
            return {"total_files": 0, "succeeded": [], "failed": [], "total_time_seconds": 0.0}

        batch_start = time.time()
        if live_profile:
            print("=" * 65)
            print(f"Batch Processing: {total_files} audio file(s) found in '{input_root}'")
            print(f"Output Directory: '{out_root}'")
            print("=" * 65, flush=True)
        elif json_progress:
            print(json.dumps({
                "stage": "batch_start",
                "total_files": total_files,
                "input_dir": str(input_root),
                "output_dir": str(out_root),
            }), flush=True)

        folder_surahs: Dict[Path, Dict[int, Dict[str, Any]]] = defaultdict(dict)
        folder_files_count: Dict[Path, int] = defaultdict(int)
        succeeded: List[str] = []
        failed: List[Tuple[str, str]] = []

        for idx, audio_file in enumerate(audio_files, 1):
            rel_path = audio_file.relative_to(input_root)
            rel_folder = rel_path.parent
            target_dir = out_root / rel_folder
            target_dir.mkdir(parents=True, exist_ok=True)
            target_json = target_dir / f"{audio_file.stem}.json"
            file_start = time.time()

            if live_profile:
                print(f"[{idx}/{total_files}] Processing: {rel_path} ...", flush=True)
            elif json_progress:
                print(json.dumps({
                    "stage": "batch_file_start",
                    "index": idx,
                    "total": total_files,
                    "file": str(rel_path),
                }), flush=True)

            if on_progress_event:
                on_progress_event(
                    PipelineProgressEvent(
                        stage=PipelineStage.loading,
                        percent=round((idx - 1) / max(1, total_files) * 100.0, 1),
                        elapsed_seconds=time.time() - batch_start,
                        message=f"[{idx}/{total_files}] Processing {rel_path}",
                    )
                )

            audio_pcm = None
            try:
                audio_pcm = AudioDecoder.load_audio_file(str(audio_file))
                result = self.process_pcm(
                    audio_pcm=audio_pcm,
                    output_dir=str(target_dir),
                    export_json_files=False,
                    live_profile=live_profile,
                    json_progress=json_progress,
                    on_progress_event=on_progress_event,
                    enable_mfa=enable_mfa,
                    qiraat=qiraat,
                )
                out_dict = result.to_output_dict()

                with open(target_json, "w", encoding="utf-8") as f:
                    json.dump(out_dict, f, ensure_ascii=False, indent=2)

                for surah_data in out_dict.get("surahs", []):
                    s_num = surah_data.get("surah")
                    if s_num not in folder_surahs[rel_folder]:
                        folder_surahs[rel_folder][s_num] = {
                            "surah": s_num,
                            "ayahs": [],
                        }
                        if surah_data.get("intro"):
                            folder_surahs[rel_folder][s_num]["intro"] = surah_data["intro"]

                    folder_surahs[rel_folder][s_num]["ayahs"].extend(surah_data.get("ayahs", []))
                    if "intro" not in folder_surahs[rel_folder][s_num] and surah_data.get("intro"):
                        folder_surahs[rel_folder][s_num]["intro"] = surah_data["intro"]

                file_elapsed = time.time() - file_start
                succeeded.append(str(rel_path))
                folder_files_count[rel_folder] += 1
                prof = result.profiling

                if live_profile:
                    rtf_str = f", {prof.real_time_factor:.1f}x Real-Time" if prof and prof.real_time_factor > 0 else ""
                    dur_str = f"{prof.audio_duration:.2f}s in " if prof and prof.audio_duration > 0 else ""
                    print(f"[{idx}/{total_files}] -> Saved {target_json.name} ({dur_str}{file_elapsed:.2f}s{rtf_str})", flush=True)
                elif json_progress:
                    print(json.dumps({
                        "stage": "batch_file_done",
                        "index": idx,
                        "total": total_files,
                        "file": str(rel_path),
                        "saved": str(target_json),
                        "elapsed": round(file_elapsed, 2),
                    }), flush=True)

            except Exception as exc:
                failed.append((str(rel_path), str(exc)))
                if live_profile:
                    print(f"[!] Failed to process {rel_path}: {exc}", file=sys.stderr, flush=True)
                elif json_progress:
                    print(json.dumps({
                        "stage": "batch_file_error",
                        "index": idx,
                        "total": total_files,
                        "file": str(rel_path),
                        "error": str(exc),
                    }), flush=True)
            finally:
                del audio_pcm
                gc.collect()

        # Write merged all_surahs.json per folder (only when folder has >= 2 files to merge)
        for rel_folder in sorted(folder_surahs.keys()):
            if folder_files_count[rel_folder] <= 1:
                continue

            folder_target_dir = out_root / rel_folder
            folder_target_dir.mkdir(parents=True, exist_ok=True)
            merged_file = folder_target_dir / "all_surahs.json"

            surahs_dict = folder_surahs[rel_folder]
            for s_num, s_obj in surahs_dict.items():
                s_obj["ayahs"].sort(key=lambda a: a.get("ayah", 0))

            sorted_surahs = [surahs_dict[k] for k in sorted(surahs_dict.keys())]
            merged_doc = {
                "total_surahs": len(sorted_surahs),
                "surahs": sorted_surahs,
            }
            with open(merged_file, "w", encoding="utf-8") as f:
                json.dump(merged_doc, f, ensure_ascii=False, indent=2)

        total_time = time.time() - batch_start
        if live_profile:
            print("=" * 65)
            print(f"Batch Complete: {len(succeeded)}/{total_files} succeeded, {len(failed)} failed.")
            print(f"Total Time    : {total_time:.2f}s")
            if failed:
                print("Failed files:")
                for fpath, err in failed:
                    print(f"  - {fpath}: {err}")
            print("=" * 65, flush=True)
        elif json_progress:
            print(json.dumps({
                "stage": "batch_completed",
                "total_files": total_files,
                "succeeded": len(succeeded),
                "failed": len(failed),
                "total_time": round(total_time, 2),
            }), flush=True)

        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.completed,
                    percent=100.0,
                    elapsed_seconds=total_time,
                    message=f"Batch complete: {len(succeeded)}/{total_files} succeeded",
                )
            )

        return {
            "total_files": total_files,
            "succeeded": succeeded,
            "failed": failed,
            "total_time_seconds": round(total_time, 2),
        }

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
        enable_mfa: bool = False,
        qiraat: str = "hafs",
    ) -> PipelineResult:
        overall_start = time.time()
        audio_duration = len(audio_pcm) / SAMPLE_RATE

        # VAD & Phase 1: ASR Transcription
        asr_start = time.time()
        last_progress_time = [0.0]

        def _on_vad_done(vad_seconds: float) -> None:
            if json_progress:
                sys.stdout.write(json.dumps({"stage": "vad", "elapsed": round(vad_seconds, 2)}) + "\n")
                sys.stdout.flush()
            elif live_profile:
                print(f"VAD & Silence       : {vad_seconds:.2f}s", flush=True)
            if on_progress_event:
                on_progress_event(
                    PipelineProgressEvent(
                        stage=PipelineStage.vad,
                        percent=100.0,
                        elapsed_seconds=vad_seconds,
                        message=f"VAD completed in {vad_seconds:.2f}s",
                    )
                )

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
                    sys.stdout.write(f"\r\033[2KPhase 1 Transcribe  : [{bar}] {pct:3.0f}% ({elp:.1f}s)")
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
            on_vad_done=_on_vad_done if (live_profile or json_progress or on_progress_event) else None,
        )
        raw_phonemes = raw_result.phonemes
        vad_time = getattr(raw_result, "vad_time", 0.0)
        pure_asr_time = max(0.0, (time.time() - asr_start) - vad_time)
        if live_profile:
            sys.stdout.write(f"\r\033[2KPhase 1 Transcribe  : {pure_asr_time:.2f}s\n")
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
                noise_floor_db=getattr(raw_result, "noise_floor_db", None),
            )
            effective_phonemes = rec_res.recovered_phonemes
            recovery_events = rec_res.recovery_events
            recovery_summary = rec_res.recovery_summary
            recovery_time = time.time() - rec_start
            if live_profile:
                print(f"Phase 1.1 Recovery  : {recovery_time:.2f}s", flush=True)

        # Phase 2: CTC Viterbi Trellis Alignment (Acoustic-Neural Hybrid)
        align_start = time.time()
        if json_progress:
            print(json.dumps({"stage": "aligning", "percent": 0.0, "message": "Aligning word timings (CTC)..."}), flush=True)
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.aligning,
                    percent=0.0,
                    elapsed_seconds=time.time() - overall_start,
                    message="Aligning word timings (CTC)...",
                )
            )
        aligned_phonemes = CtcViterbiAligner.align_phonemes(
            target_phonemes=effective_phonemes,
            audio_duration=audio_duration,
            token2id=self.transcriber.token2id,
            logprobs_matrix=raw_result.logprobs_matrix,
            num_frames=raw_result.num_frames,
            custom_blank_id=BLANK_ID,
            pause_intervals=raw_result.pause_intervals,
            audio_pcm=audio_pcm,
        )
        # Retain PCM buffer if MFA is requested; otherwise release immediately
        mfa_audio_buffer = audio_pcm if enable_mfa else None
        audio_pcm = None
        align_time = time.time() - align_start
        if live_profile:
            print(f"Phase 2 CTC Align   : {align_time:.2f}s", flush=True)
        elif json_progress:
            print(json.dumps({"stage": "aligning", "percent": 100.0, "elapsed": round(align_time, 2)}), flush=True)
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.aligning,
                    percent=100.0,
                    elapsed_seconds=time.time() - overall_start,
                    message="Word timings aligned",
                )
            )

        # Release large emission logprobs matrix before Phase 3 to reclaim physical RAM
        raw_result.logprobs_matrix = None
        gc.collect()

        # Phase 3: Quran Text Matcher & Sequencer
        match_start = time.time()
        if json_progress:
            print(json.dumps({"stage": "matching", "percent": 0.0, "message": "Matching verses"}), flush=True)
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.matching,
                    percent=0.0,
                    elapsed_seconds=time.time() - overall_start,
                    message="Matching verses to Medina reference...",
                )
            )
        segments = self.matcher.match_segments(
            aligned_phonemes=aligned_phonemes,
            audio_duration=audio_duration,
            target_surah=target_surah,
            start_ayah=start_ayah,
            pause_timestamps=raw_result.pause_timestamps,
            pause_intervals=raw_result.pause_intervals,
        )
        match_time = time.time() - match_start
        if live_profile:
            print(f"Phase 3 Text Match  : {match_time:.2f}s", flush=True)
        elif json_progress:
            print(json.dumps({"stage": "matching", "percent": 100.0, "elapsed": round(match_time, 2)}), flush=True)
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.matching,
                    percent=100.0,
                    elapsed_seconds=time.time() - overall_start,
                    message="Verses matched successfully",
                )
            )

        # Phase 4: Construct Consolidated Result & JSON Export
        export_start = time.time()
        if on_progress_event:
            on_progress_event(
                PipelineProgressEvent(
                    stage=PipelineStage.exporting,
                    percent=100.0,
                    elapsed_seconds=time.time() - overall_start,
                    message="Building subtitle timeline...",
                )
            )

        # Phase 4.1: Optional Canonical qiraat Ayah Translation (Zero-overhead bypass for Hafs)
        if qiraat and qiraat.strip().lower() != "hafs":
            mapper = QiraatAyahMapper.load(qiraat)
            segments = mapper.remap_segments(segments)

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
            pause_intervals=raw_result.pause_intervals,
        )

        if export_json_files:
            result.export_json(output_dir=output_dir)

        export_time = time.time() - export_start
        if live_profile:
            print(f"Phase 4 JSON Export : {export_time:.2f}s", flush=True)

        # Phase 5: Montreal Forced Alignment (MFA 10ms Phone/Letter Refinement)
        mfa_time = 0.0
        mfa_results = None
        if enable_mfa:
            mfa_start = time.time()
            last_mfa_progress = [0.0]

            def _on_mfa_progress(pct: float, elp: float) -> None:
                now = time.time()
                if (now - last_mfa_progress[0] >= 0.20) or pct >= 100.0:
                    last_mfa_progress[0] = now
                    if json_progress:
                        sys.stdout.write(json.dumps({"stage": "mfa", "percent": round(pct, 1), "elapsed": round(elp, 1)}) + "\n")
                        sys.stdout.flush()
                    elif live_profile:
                        filled = int(20 * pct / 100.0)
                        bar = "=" * filled + " " * (20 - filled)
                        sys.stdout.write(f"\rPhase 5 MFA Align   : [{bar}] {pct:3.0f}% ({elp:.1f}s)")
                        sys.stdout.flush()
                    if on_progress_event:
                        on_progress_event(
                            PipelineProgressEvent(
                                stage=PipelineStage.mfa,
                                percent=pct,
                                elapsed_seconds=elp,
                                message=f"MFA Aligning {pct:.0f}%",
                            )
                        )

            from src.aligner.mfa_aligner import QuranMfaAligner
            mfa_engine = QuranMfaAligner()
            mfa_results = mfa_engine.align_pipeline_result(
                pipeline_result=result,
                audio_pcm=mfa_audio_buffer,
                output_dir=output_dir,
                on_progress=_on_mfa_progress if (live_profile or json_progress or on_progress_event) else None,
            )
            result.mfa_results = mfa_results
            mfa_audio_buffer = None
            mfa_time = time.time() - mfa_start

            if live_profile:
                sys.stdout.write(f"\r\033[2KPhase 5 MFA Align   : {mfa_time:.2f}s\n")
                sys.stdout.flush()
            if json_progress:
                sys.stdout.write(json.dumps({"stage": "mfa", "elapsed": round(mfa_time, 2)}) + "\n")
                sys.stdout.flush()
            if on_progress_event:
                on_progress_event(
                    PipelineProgressEvent(
                        stage=PipelineStage.mfa,
                        percent=100.0,
                        elapsed_seconds=time.time() - overall_start,
                        message="MFA alignment completed",
                    )
                )

        total_time = time.time() - overall_start

        profiling = PipelineProfiling(
            audio_duration=audio_duration,
            load_time=load_time,
            vad_time=vad_time,
            asr_time=pure_asr_time,
            recovery_time=recovery_time,
            alignment_time=align_time,
            match_time=match_time,
            export_time=export_time,
            mfa_time=mfa_time,
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
            pcm = _resample_audio(pcm.astype(np.float32), orig_sr, SAMPLE_RATE)
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
    "QiraatAyahMapper",
    "QuranCountingSystem",
    "PhonemeToken",
    "PauseInterval",
    "QuranWord",
    "QuranSegment",
    "AyahSubSegment",
    "PipelineResult",
    "PipelineProfiling",
    "PipelineStage",
    "PipelineProgressEvent",
]
