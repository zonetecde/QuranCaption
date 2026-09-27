#!/usr/bin/env python3
"""
Local WordTiming segmenter wrapper for QuranCaption.

Runs the offline Zipformer-v3 Quran Recitation alignment engine
and outputs normalized QuranCaption segment JSON with relative word timings to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_DIR = SCRIPT_DIR / "quran_recite_to_text"

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))


def get_hardware_topology() -> Tuple[int, int]:
    """Detects physical and logical CPU cores for optimal parallel execution.

    @returns {Tuple[int, int]} Tuple of (physical_cores, logical_cores).
    """
    try:
        import psutil
        phys = psutil.cpu_count(logical=False) or 4
        log = psutil.cpu_count(logical=True) or 8
    except Exception:
        log = os.cpu_count() or 4
        phys = max(1, log // 2)
    return phys, log


def resolve_concurrency(
    fast: bool,
    user_workers: Optional[int],
    user_threads: Optional[int],
) -> Tuple[int, int]:
    """Resolves optimal (workers, threads) based on hardware topology and CLI flags.

    @param {bool} fast - Whether fast parallel mode is enabled.
    @param {Optional[int]} user_workers - Optional user-specified segment worker count.
    @param {Optional[int]} user_threads - Optional user-specified ONNX thread count.
    @returns {Tuple[int, int]} Tuple of resolved (workers, threads).
    """
    phys, log = get_hardware_topology()
    if fast:
        # Fast mode: scale workers to physical cores (capped at 8), use 2 threads when SMT is available
        opt_workers = min(max(1, phys), 8)
        opt_threads = 2 if log >= (opt_workers * 2) else (2 if phys <= 4 else 1)
        workers = user_workers if user_workers is not None else opt_workers
        threads = user_threads if user_threads is not None else opt_threads
    else:
        workers = user_workers if user_workers is not None else 1
        if user_threads is not None:
            threads = user_threads
        else:
            threads = 2 if workers <= 4 else 1
    return workers, threads


def load_audio_slice(
    file_path: str,
    start_s: float = 0.0,
    duration_s: Optional[float] = None,
    sample_rate: int = 16000,
) -> np.ndarray:
    """Fast-seek audio decoding for timeline slices without decoding entire file.

    @param {str} file_path - Path to the audio file.
    @param {float} start_s - Start offset in seconds.
    @param {Optional[float]} duration_s - Duration in seconds to extract.
    @param {int} sample_rate - Desired audio sampling rate in Hz.
    @returns {np.ndarray} Decoded PCM audio samples as 1D float32 array.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    # 1. Primary: Streaming FFmpeg sub-range decode (~0.05s)
    try:
        import subprocess
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error']
        if start_s > 0:
            cmd.extend(['-ss', f"{start_s:.3f}"])
        if duration_s is not None and duration_s > 0:
            cmd.extend(['-t', f"{duration_s:.3f}"])
        cmd.extend([
            '-i', file_path,
            '-vn', '-sn', '-dn',
            '-f', 'f32le', '-ac', '1', '-ar', str(sample_rate), '-'
        ])
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out, _ = proc.communicate()
        if proc.returncode == 0 and len(out) > 0:
            return np.frombuffer(out, dtype=np.float32)
    except Exception:
        pass

    # 2. Fallback: In-process full decode with numpy slice
    from src.audio import AudioDecoder
    full_audio = AudioDecoder.load_audio_file(file_path, sample_rate=sample_rate)
    start_sample = max(0, int(round(start_s * sample_rate)))
    if duration_s is not None and duration_s > 0:
        end_sample = min(len(full_audio), start_sample + int(round(duration_s * sample_rate)))
    else:
        end_sample = len(full_audio)
    return full_audio[start_sample:end_sample]


def emit_status_to_stderr(
    original_stderr_file,
    step: str,
    message: str,
    progress: Optional[float | int] = None,
) -> None:
    """Write a structured status update to the original stderr stream.

    @param {Any} original_stderr_file - Output file handle for stderr.
    @param {str} step - Step identifier (e.g. 'loading', 'transcribing', 'complete').
    @param {str} message - Human-readable status description.
    @param {Optional[float | int]} progress - Progress percentage between 0 and 100.
    """
    try:
        data: Dict[str, Any] = {"step": step, "message": message}
        if progress is not None:
            data["progress"] = progress
        status_json = json.dumps(data, ensure_ascii=False)
        original_stderr_file.write(f"STATUS:{status_json}\n")
        original_stderr_file.flush()
    except Exception:
        pass


def normalize_word_boundaries(words: List[Dict[str, Any]], segment_duration: float) -> List[Dict[str, Any]]:
    """Aligns word ends to next word starts within the segment duration.

    @param {List[Dict[str, Any]]} words - List of word timestamp dictionaries.
    @param {float} segment_duration - Total duration of the containing segment in seconds.
    @returns {List[Dict[str, Any]]} Normalized word timestamp dictionaries.
    """
    if not words:
        return words

    duration = max(0.0, segment_duration)
    normalized_starts: List[float] = []
    previous_start = 0.0
    for index, word in enumerate(words):
        raw_start = 0.0 if index == 0 else float(word.get("start", 0.0))
        start = max(previous_start, min(duration, raw_start))
        normalized_starts.append(start)
        previous_start = start

    normalized_words: List[Dict[str, Any]] = []
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


def adapt_pipeline_result_to_qurancaption(
    pipeline_result: Any,
    offset_s: float = 0.0,
    start_segment_idx: int = 1,
) -> List[Dict[str, Any]]:
    """Transforms hierarchical Zipformer pipeline results into QuranCaption's
    expected flat segment list with relative word timestamps.

    @param {Any} pipeline_result - PipelineResult instance from AudioPipeline.
    @param {float} offset_s - Global time offset in seconds for regional alignment.
    @param {int} start_segment_idx - Starting index for segment numbering.
    @returns {List[Dict[str, Any]]} List of segment dictionaries matching QuranCaption schema.
    """
    segments: List[Dict[str, Any]] = []
    current_idx = start_segment_idx

    pipeline_segments = getattr(pipeline_result, "segments", [])
    if not pipeline_segments:
        return segments

    # 1. Handle opening intro (Basmala / Isti'adha) if detected
    intro = getattr(pipeline_segments[0], "intro", None)
    if intro and intro.get("words"):
        intro_abs_start = round(float(intro.get("start", 0.0)) + offset_s, 3)
        intro_abs_end = round(float(intro.get("end", 0.0)) + offset_s, 3)
        intro_dur = max(0.0, round(intro_abs_end - intro_abs_start, 3))
        intro_words: List[Dict[str, Any]] = []

        for w in intro["words"]:
            w_dict = w.to_dict() if hasattr(w, "to_dict") else w
            w_raw_s = float(w_dict.get("start") if w_dict.get("start") is not None else intro.get("start", 0.0))
            w_raw_e = float(w_dict.get("end") if w_dict.get("end") is not None else intro.get("end", 0.0))
            w_abs_start = w_raw_s + offset_s
            w_abs_end = w_raw_e + offset_s
            rel_start = max(0.0, round(w_abs_start - intro_abs_start, 3))
            rel_end = max(rel_start, round(w_abs_end - intro_abs_start, 3))
            intro_words.append({
                "word": w_dict.get("word", ""),
                "location": w_dict.get("location", "1:1:1"),
                "start": rel_start,
                "end": rel_end,
                "phonemes": w_dict.get("phonemes", []),
            })

        norm_intro_words = normalize_word_boundaries(intro_words, intro_dur)
        matched_text = " ".join(w["word"] for w in norm_intro_words if w.get("word"))
        is_istiadha = "أَعُوذُ" in matched_text or "اعوذ" in matched_text
        special_name = "Isti'adha" if is_istiadha else "Basmala"

        segments.append({
            "segment": current_idx,
            "time_from": intro_abs_start,
            "time_to": intro_abs_end,
            "ref_from": special_name,
            "ref_to": special_name,
            "special_type": special_name,
            "matched_text": matched_text,
            "confidence": 1.0,
            "error": None,
            "has_missing_words": False,
            "potentially_undersegmented": False,
            "words": norm_intro_words,
        })
        current_idx += 1

    # 2. Handle Ayahs
    for seg in pipeline_segments:
        surah_num = getattr(seg, "surah_number", 1)
        ayah_num = getattr(seg, "ayah", 1)
        raw_start = getattr(seg, "start_time", 0.0)
        raw_end = getattr(seg, "end_time", 0.0)

        # Handle dictionary input if seg is already dict
        if isinstance(seg, dict):
            surah_num = seg.get("surah", surah_num)
            ayah_num = seg.get("ayah", ayah_num)
            raw_start = seg.get("start", raw_start)
            raw_end = seg.get("end", raw_end)

        abs_start = round(float(raw_start) + offset_s, 3)
        abs_end = round(float(raw_end) + offset_s, 3)
        duration = max(0.0, round(abs_end - abs_start, 3))

        # Collect words for this Ayah
        source_words: List[Any] = []
        if hasattr(seg, "words") and seg.words:
            source_words = seg.words
        elif isinstance(seg, dict) and seg.get("words"):
            source_words = seg["words"]
        elif hasattr(seg, "sub_segments") and seg.sub_segments:
            for sub in seg.sub_segments:
                sub_words = getattr(sub, "words", []) if hasattr(sub, "words") else (sub.get("words", []) if isinstance(sub, dict) else [])
                source_words.extend(sub_words)
        elif isinstance(seg, dict) and seg.get("segments"):
            for sub in seg["segments"]:
                source_words.extend(sub.get("words", []))

        words_list: List[Dict[str, Any]] = []
        scores: List[float] = []

        for w_idx, w in enumerate(source_words):
            w_dict = w.to_dict() if hasattr(w, "to_dict") else (w if isinstance(w, dict) else {})
            w_raw_s = float(w_dict.get("start") if w_dict.get("start") is not None else raw_start)
            w_raw_e = float(w_dict.get("end") if w_dict.get("end") is not None else raw_end)

            w_abs_start = w_raw_s + offset_s
            w_abs_end = w_raw_e + offset_s

            # Compute word start/end relative to segment time_from (required by QuranCaption)
            rel_start = max(0.0, round(w_abs_start - abs_start, 3))
            rel_end = max(rel_start, round(w_abs_end - abs_start, 3))

            loc = w_dict.get("location") or f"{surah_num}:{ayah_num}:{w_idx + 1}"
            word_text = w_dict.get("word", "")
            if w_dict.get("score") is not None:
                scores.append(float(w_dict["score"]))

            words_list.append({
                "word": word_text,
                "location": loc,
                "start": rel_start,
                "end": rel_end,
                "phonemes": w_dict.get("phonemes", []),
            })

        if not words_list:
            continue

        normalized_words = normalize_word_boundaries(words_list, duration)
        ref_from = normalized_words[0]["location"]
        ref_to = normalized_words[-1]["location"]
        matched_text = " ".join(w["word"] for w in normalized_words if w.get("word"))
        confidence = round(sum(scores) / max(1, len(scores)), 3) if scores else 1.0

        segments.append({
            "segment": current_idx,
            "time_from": abs_start,
            "time_to": abs_end,
            "ref_from": ref_from,
            "ref_to": ref_to,
            "matched_text": matched_text,
            "confidence": confidence,
            "error": None,
            "has_missing_words": False,
            "potentially_undersegmented": False,
            "words": normalized_words,
        })
        current_idx += 1

    return segments


def main() -> int:
    parser = argparse.ArgumentParser(description="Local WordTiming Quran Segmenter")
    parser.add_argument("audio_path", help="Path to the input audio file")
    parser.add_argument("--fast", action="store_true", default=True, help="Auto-configure top-speed parallel workers and threads for this CPU (default: True)")
    parser.add_argument("--no-fast", dest="fast", action="store_false", help="Disable fast parallel mode")
    parser.add_argument("--threads", type=int, default=None, help="ONNX execution threads (default: auto/2)")
    parser.add_argument("--workers", type=int, default=None, help="Parallel CPU workers count (default: auto in fast mode)")
    parser.add_argument("--min-silence-ms", type=int, default=200, help="Minimum silence pause threshold in ms")
    parser.add_argument("--min-speech-ms", type=int, default=1000, help="Minimum speech duration in ms")
    parser.add_argument("--pad-ms", type=int, default=100, help="Padding in ms")
    parser.add_argument("--timeline-clips-json", help="JSON array of timeline audio clips for in-memory slicing")
    parser.add_argument("--audio-regions-ms", help="JSON timeline regions to align independently")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    workers, threads = resolve_concurrency(
        fast=args.fast,
        user_workers=args.workers,
        user_threads=args.threads,
    )
    os.environ["ONNX_SEGMENT_WORKERS"] = str(workers)
    os.environ["OMP_NUM_THREADS"] = str(threads)
    os.environ["ONNX_NUM_THREADS"] = str(threads)

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1

    original_stderr_fd = os.dup(2)
    original_stderr_file = os.fdopen(original_stderr_fd, "w", encoding="utf-8")

    result = None
    error_result = None

    try:
        emit_status_to_stderr(
            original_stderr_file, "loading", "Initializing Zipformer engine & models...", progress=10
        )

        from src import AudioPipeline
        from src.audio import AudioDecoder
        from src.models import PipelineProgressEvent

        pipeline = AudioPipeline()
        pipeline.initialize(num_threads=threads)

        def make_progress_cb(clip_idx: int, total_clips: int):
            def on_progress(event: PipelineProgressEvent):
                base_pct = (clip_idx / max(1, total_clips)) * 100.0
                span = 100.0 / max(1, total_clips)
                clip_pct = base_pct + (event.percent * span / 100.0)
                overall = min(92, max(18, int(18 + (clip_pct * 0.74))))
                stage_name = event.stage.value if hasattr(event.stage, "value") else str(event.stage)
                emit_status_to_stderr(
                    original_stderr_file,
                    stage_name,
                    event.message or "Transcribing & aligning...",
                    progress=overall,
                )
            return on_progress

        sample_rate = 16000
        all_segments = []

        if args.timeline_clips_json:
            timeline_clips = json.loads(args.timeline_clips_json)
            total_clips = len(timeline_clips)

            for clip_idx, clip in enumerate(timeline_clips):
                source_start_ms = clip.get("sourceStartMs", clip.get("source_start_ms", 0))
                start_ms = clip.get("startMs", clip.get("start_ms", 0))
                end_ms = clip.get("endMs", clip.get("end_ms", 0))
                duration_ms = end_ms - start_ms

                source_start_s = max(0.0, float(source_start_ms) / 1000.0)
                duration_s = max(0.0, float(duration_ms) / 1000.0)
                timeline_offset_s = max(0.0, float(start_ms) / 1000.0)

                clip_path = clip.get("path") or args.audio_path
                emit_status_to_stderr(
                    original_stderr_file,
                    "loading",
                    f"Decoding audio clip {clip_idx + 1}/{total_clips}...",
                    progress=15,
                )
                clip_pcm = load_audio_slice(
                    clip_path,
                    start_s=source_start_s,
                    duration_s=duration_s if duration_s > 0 else None,
                    sample_rate=sample_rate,
                )
                if len(clip_pcm) == 0:
                    continue

                cb = make_progress_cb(clip_idx, total_clips)
                pipeline_res = pipeline.process_pcm(
                    audio_pcm=clip_pcm,
                    export_json_files=False,
                    on_progress_event=cb,
                )
                clip_segs = adapt_pipeline_result_to_qurancaption(
                    pipeline_res,
                    offset_s=timeline_offset_s,
                    start_segment_idx=len(all_segments) + 1,
                )
                all_segments.extend(clip_segs)
        elif args.audio_regions_ms:
            regions = sorted(json.loads(args.audio_regions_ms), key=lambda region: region[0])
            for region_index, (start_ms, end_ms) in enumerate(regions):
                start_s = max(0.0, float(start_ms) / 1000.0)
                duration_s = max(0.0, float(end_ms - start_ms) / 1000.0)
                if duration_s <= 0:
                    continue
                emit_status_to_stderr(
                    original_stderr_file,
                    "loading",
                    f"Decoding audio region {region_index + 1}/{len(regions)}...",
                    progress=15,
                )
                region_pcm = load_audio_slice(
                    args.audio_path,
                    start_s=start_s,
                    duration_s=duration_s,
                    sample_rate=sample_rate,
                )
                if len(region_pcm) == 0:
                    continue
                cb = make_progress_cb(region_index, len(regions))
                pipeline_res = pipeline.process_pcm(
                    audio_pcm=region_pcm,
                    export_json_files=False,
                    on_progress_event=cb,
                )
                offset_s = start_ms / 1000.0
                region_segs = adapt_pipeline_result_to_qurancaption(
                    pipeline_res,
                    offset_s=offset_s,
                    start_segment_idx=len(all_segments) + 1,
                )
                all_segments.extend(region_segs)
        else:
            emit_status_to_stderr(
                original_stderr_file,
                "loading",
                "Decoding audio...",
                progress=15,
            )
            audio_pcm = AudioDecoder.load_audio_file(args.audio_path, sample_rate=sample_rate)
            cb = make_progress_cb(0, 1)
            pipeline_res = pipeline.process_pcm(
                audio_pcm=audio_pcm,
                export_json_files=False,
                on_progress_event=cb,
            )
            all_segments = adapt_pipeline_result_to_qurancaption(pipeline_res, offset_s=0.0, start_segment_idx=1)

        emit_status_to_stderr(original_stderr_file, "formatting", "Formatting word timestamps...", progress=95)
        result = {"segments": all_segments}
        emit_status_to_stderr(original_stderr_file, "complete", "Segmentation complete", progress=100)

    except Exception as error:
        import traceback
        error_result = {
            "error": str(error),
            "details": traceback.format_exc(),
        }
    finally:
        try:
            original_stderr_file.close()
        except Exception:
            pass

    if error_result:
        sys.stdout.write(json.dumps(error_result) + "\n")
        sys.stdout.flush()
        return 1

    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
