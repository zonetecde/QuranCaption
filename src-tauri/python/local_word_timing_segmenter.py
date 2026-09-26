#!/usr/bin/env python3
"""
Local WordTiming segmenter wrapper for QuranCaption.

Runs the offline Zipformer-v3 Quran Recitation alignment engine
and outputs normalized QuranCaption segment JSON with relative word timings to stdout.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.absolute()
ENGINE_DIR = SCRIPT_DIR / "quran_recite_to_text"

if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))


def emit_status_to_stderr(
    original_stderr_file,
    step: str,
    message: str,
    progress: Optional[float | int] = None,
) -> None:
    """
    Write a structured status update to the original stderr stream.

    :param original_stderr_file: Output file handle for stderr.
    :param step: Step identifier (e.g. 'loading', 'transcribing', 'complete').
    :param message: Human-readable status description.
    :param progress: Progress percentage between 0 and 100.
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


def adapt_pipeline_result_to_qurancaption(
    pipeline_result: Any,
    offset_s: float = 0.0,
    start_segment_idx: int = 1,
) -> List[Dict[str, Any]]:
    """
    Transforms hierarchical Zipformer pipeline results into QuranCaption's
    expected flat segment list with relative word timestamps.

    :param pipeline_result: PipelineResult instance from AudioPipeline.
    :param offset_s: Global time offset in seconds for regional alignment.
    :param start_segment_idx: Starting index for segment numbering.
    :return: List of segment dictionaries matching QuranCaption schema.
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
        intro_words: List[Dict[str, Any]] = []

        for w in intro["words"]:
            w_abs_start = float(w.get("start") or 0.0) + offset_s
            w_abs_end = float(w.get("end") or (w_abs_start + 0.1)) + offset_s
            # Compute timing relative to segment start (required by QuranCaption)
            rel_start = max(0.0, round(w_abs_start - intro_abs_start, 3))
            rel_end = max(rel_start, round(w_abs_end - intro_abs_start, 3))
            intro_words.append({
                "word": w.get("word", ""),
                "location": w.get("location", "1:1:1"),
                "start": rel_start,
                "end": rel_end,
                "phonemes": w.get("phonemes", []),
            })

        matched_text = " ".join(w["word"] for w in intro_words if w.get("word"))
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
            "words": intro_words,
        })
        current_idx += 1

    # 2. Handle Ayahs and their segments
    for seg in pipeline_segments:
        surah_num = getattr(seg, "surah_number", 1)
        if callable(getattr(seg, "to_dict", None)):
            seg_dict = seg.to_dict()
        elif isinstance(seg, dict):
            seg_dict = seg
        else:
            sub_segs = getattr(seg, "sub_segments", None)
            if sub_segs:
                seg_list = [
                    {
                        "segment": idx + 1,
                        "start": getattr(s, "start_time", s.get("start", 0.0) if isinstance(s, dict) else 0.0),
                        "end": getattr(s, "end_time", s.get("end", 0.0) if isinstance(s, dict) else 0.0),
                        "words": getattr(s, "words", s.get("words", []) if isinstance(s, dict) else []),
                    }
                    for idx, s in enumerate(sub_segs)
                ]
            else:
                seg_list = [
                    {
                        "segment": 1,
                        "start": getattr(seg, "start_time", 0.0),
                        "end": getattr(seg, "end_time", 0.0),
                        "words": getattr(seg, "words", []),
                    }
                ]
            seg_dict = {
                "ayah": getattr(seg, "ayah", 1),
                "segments": seg_list,
            }

        ayah_num = seg_dict.get("ayah", 1)
        ayah_segments = seg_dict.get("segments") or []

        for sub_seg in ayah_segments:
            sub_abs_start = round(float(sub_seg.get("start", 0.0)) + offset_s, 3)
            sub_abs_end = round(float(sub_seg.get("end", 0.0)) + offset_s, 3)
            source_words = sub_seg.get("words", [])

            words_list: List[Dict[str, Any]] = []
            scores: List[float] = []

            for w in source_words:
                w_dict = w.to_dict() if hasattr(w, "to_dict") else w
                raw_start = w_dict.get("start")
                raw_end = w_dict.get("end")

                w_abs_start = (float(raw_start) if raw_start is not None else sub_abs_start) + offset_s
                w_abs_end = (float(raw_end) if raw_end is not None else (w_abs_start + 0.1)) + offset_s

                # Compute word start/end relative to segment time_from (required by QuranCaption)
                rel_start = max(0.0, round(w_abs_start - sub_abs_start, 3))
                rel_end = max(rel_start, round(w_abs_end - sub_abs_start, 3))

                loc = w_dict.get("location") or f"{surah_num}:{ayah_num}:1"
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

            ref_from = words_list[0]["location"]
            ref_to = words_list[-1]["location"]
            matched_text = " ".join(w["word"] for w in words_list if w.get("word"))
            confidence = round(sum(scores) / max(1, len(scores)), 3) if scores else 1.0

            segments.append({
                "segment": current_idx,
                "time_from": sub_abs_start,
                "time_to": sub_abs_end,
                "ref_from": ref_from,
                "ref_to": ref_to,
                "matched_text": matched_text,
                "confidence": confidence,
                "words": words_list,
            })
            current_idx += 1

    return segments


def main() -> int:
    parser = argparse.ArgumentParser(description="Local WordTiming Quran Segmenter")
    parser.add_argument("audio_path", help="Path to the input audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--fast", action="store_true", help="Enable parallel transcription")
    parser.add_argument("--workers", type=int, default=None, help="Parallel CPU workers count")
    parser.add_argument("--timeline-clips-json", help="JSON array of timeline audio clips for in-memory slicing")
    parser.add_argument("--audio-regions-ms", help="JSON timeline regions to align independently")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    workers = args.workers if args.workers is not None else 1
    threads = 1 if workers > 1 else 2
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
                clip_pcm = AudioDecoder.load_audio_slice(
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
                region_pcm = AudioDecoder.load_audio_slice(
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

