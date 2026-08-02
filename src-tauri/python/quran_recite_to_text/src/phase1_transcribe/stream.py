"""ASR Runtime — Orchestrates acoustic inference on CPU using Munajjam PR #65 Adaptive Engine."""

import time
import subprocess
import json
import numpy as np
import os
import sys
import librosa
import concurrent.futures

os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

from qua_sdk.schemas import Audio, Region, Regions, Emissions
from src.phase2_matching.normalize import normalize_arabic
from src.phase1_transcribe.fastconformer import FastConformerONNX
from src.phase1_transcribe.silence import detect_acoustic_silences, detect_non_silent_chunks


def run_asr_cpu(
    audio_input,
    sample_rate: int = 16000,
    model_name: str = "Base",
    profile_name: str = "auto",
    progress_callback=None,
    min_silence_ms: int = 1200,
    pad_ms: int = 600,
):
    """Phase 1 Acoustic Inference using Munajjam PR #65 Adaptive Silence Detection Engine."""
    audio_dur = 0.0

    # Load audio array or handle file path
    if isinstance(audio_input, str):
        probe_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audio_input]
        try:
            audio_dur = float(subprocess.check_output(probe_cmd).decode('utf-8').strip())
        except Exception:
            audio_dur = 0.0

        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            audio_pcm, _ = librosa.load(audio_input, sr=sample_rate, mono=True)
    else:
        audio_pcm = audio_input.astype(np.float32)
        audio_dur = len(audio_pcm) / sample_rate

    fc = FastConformerONNX.get_instance(device="cpu")

    # Step 1: Detect non-silent speech chunks using non-neural gentle engine
    expected_chunks = max(1, int(audio_dur / 25.0))
    chunk_ms_list = detect_non_silent_chunks(
        audio_pcm,
        min_silence_len=min_silence_ms,
        silence_thresh=-45,
        adaptive=False,
        expected_chunks=expected_chunks,
        sample_rate=sample_rate
    )
    silence_intervals = detect_acoustic_silences(
        audio_pcm,
        min_silence_len_ms=min_silence_ms,
        sample_rate=sample_rate,
    )

    regions_list = []
    tokens = []
    raw_transcriptions = []
    asr_words_list = []
    logprobs_list = []

    t_asr_start = time.time()
    max_workers = int(os.environ.get("ASR_CHUNK_WORKERS", 4))
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
    futures = []

    # --- Gap-clamped adaptive padding ---
    # Fixed 600ms padding caused fake repeats: when two chunks are close together,
    # their padded audio ranges overlapped, so FastConformer transcribed boundary
    # words twice. We now clamp each side to at most half the actual silence gap
    # between adjacent chunks, guaranteeing zero audio overlap.
    MAX_PAD_MS = pad_ms  # maximum padding per side (ms)
    n_chunks = len(chunk_ms_list)

    preroll_samples_list = []
    postroll_samples_list = []
    for idx, (start_ms, end_ms) in enumerate(chunk_ms_list):
        # Gap to previous chunk
        if idx > 0:
            prev_end_ms = chunk_ms_list[idx - 1][1]
            gap_before_ms = start_ms - prev_end_ms  # silence before this chunk
        else:
            gap_before_ms = MAX_PAD_MS * 2  # no previous → full pad allowed

        # Gap to next chunk
        if idx < n_chunks - 1:
            next_start_ms = chunk_ms_list[idx + 1][0]
            gap_after_ms = next_start_ms - end_ms  # silence after this chunk
        else:
            gap_after_ms = MAX_PAD_MS * 2  # no next → full pad allowed

        # Clamp each side to half the available silence (prevents overlap)
        preroll_ms  = min(MAX_PAD_MS, gap_before_ms // 2)
        postroll_ms = min(MAX_PAD_MS, gap_after_ms  // 2)
        preroll_samples_list.append(int((preroll_ms  / 1000.0) * sample_rate))
        postroll_samples_list.append(int((postroll_ms / 1000.0) * sample_rate))

    sys.stdout.write("\rTranscribing:   0.0%")
    sys.stdout.flush()

    def transcribe_chunk_task(chunk_audio, start_sec, idx):
        text, word_timestamps, logprobs = fc.transcribe(chunk_audio, orig_sr=sample_rate, safe_lufs=True)
        return (text, word_timestamps, logprobs, start_sec, idx)

    for idx, (start_ms, end_ms) in enumerate(chunk_ms_list):
        preroll  = preroll_samples_list[idx]
        postroll = postroll_samples_list[idx]
        start_sample = max(0, int((start_ms / 1000.0) * sample_rate) - preroll)
        end_sample   = min(len(audio_pcm), int((end_ms / 1000.0) * sample_rate) + postroll)
        actual_start_sec = start_sample / sample_rate

        chunk_audio = audio_pcm[start_sample:end_sample]
        
        # Intro split fix: For the first chunk (start_sample == 0), scan the first 10 seconds
        # to find the quietest RMS frame (the pause between intro title and actual recitation).
        # Split the chunk there so intro is isolated and the real Basmala+Ayah1 is a clean chunk.
        if start_sample == 0 and len(chunk_audio) > 0:
            scan_end = min(len(chunk_audio), int(10.0 * sample_rate))  # scan first 10s
            frame_hop = int(0.05 * sample_rate)  # 50ms frames
            min_rms = float('inf')
            split_sample = -1
            for f_start in range(int(1.0 * sample_rate), scan_end - frame_hop, frame_hop):
                frame = chunk_audio[f_start:f_start + frame_hop]
                rms = float(np.sqrt(np.mean(np.square(frame))))
                if rms < min_rms:
                    min_rms = rms
                    split_sample = f_start
            # Only split if we found a meaningful dip (the dip is < 10% of chunk mean RMS)
            chunk_mean_rms = float(np.sqrt(np.mean(np.square(chunk_audio[:scan_end]))))
            if split_sample > 0 and min_rms < chunk_mean_rms * 0.10:
                # Submit intro as its own tiny chunk (will fail matching — expected)
                intro_audio = chunk_audio[:split_sample]
                if len(intro_audio) > 0:
                    fut_intro = executor.submit(transcribe_chunk_task, intro_audio, actual_start_sec, idx)
                    futures.append(fut_intro)
                # Main recitation chunk starts after the split
                recite_start_sec = split_sample / sample_rate
                chunk_audio = chunk_audio[split_sample:]
                actual_start_sec = recite_start_sec

        if len(chunk_audio) > 0:
            fut = executor.submit(transcribe_chunk_task, chunk_audio, actual_start_sec, idx)
            futures.append(fut)

    for i, fut in enumerate(futures):
        text, word_timestamps, logprobs, start_sec, idx = fut.result()

        pct = min(100.0, ((i + 1) / max(1, len(futures))) * 100.0)
        sys.stdout.write(f"\rTranscribing: {pct:5.1f}%")
        sys.stdout.flush()
        if progress_callback:
            try:
                progress_callback(pct, f"Transcribing audio: {pct:.1f}%")
            except Exception:
                pass

        raw_transcriptions.append({
            "chunk": idx + 1,
            "chunk_start_time_seconds": start_sec,
            "raw_text": text,
        })

        if word_timestamps:
            for w in word_timestamps:
                w['start'] = max(0.0, w['start'] + start_sec)
                w['end'] = max(0.0, w['end'] + start_sec)

            chunk_text = " ".join([w['word'] for w in word_timestamps])
            abs_start_time = word_timestamps[0]['start']
            abs_end_time = word_timestamps[-1]['end']

            regions_list.append(Region(start_s=abs_start_time, end_s=abs_end_time))
            norm_text = normalize_arabic(chunk_text)
            tokens.append(list(norm_text) + [' '])
            asr_words_list.append((word_timestamps, start_sec))
            logprobs_list.append((logprobs, max(0.0, start_sec)))

    executor.shutdown(wait=True)
    sys.stdout.write("\rTranscribing: 100.0%\n")
    sys.stdout.flush()

    asr_time = time.time() - t_asr_start
    regions = Regions(regions=regions_list, audio_duration_s=audio_dur)
    emissions = Emissions(tokens=tokens)

    # with open("raw_transcription.json", "w", encoding="utf-8") as f:
    #     json.dump({"absolute_raw_transcriptions": raw_transcriptions}, f, ensure_ascii=False, indent=2)

    stage_metrics = {
        "segmentation": {},
        "recognition": {},
        "asr_words": asr_words_list,
        "logprobs": logprobs_list,
        "silence_intervals": silence_intervals,
    }
    return (regions, emissions, stage_metrics, asr_time)
