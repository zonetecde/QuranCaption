"""Zipformer2 Arabic Phoneme CTC Transcriber & Speech Recovery Engine.

Implements pure silence-chunked model feeding with Tajweed-aware acoustic
segmentation, gap-clamped padding, and intra-segment speech recovery.
"""

from __future__ import annotations

import os
import sys
import math
import time
import urllib.request
import logging
from typing import Optional, List, Dict, Tuple, Callable
import queue
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
try:
    import kaldi_native_fbank as knf
except ImportError:
    knf = None
import onnxruntime as ort

import config
from config import (
    SAMPLE_RATE,
    BLANK_ID,
    DEFAULT_MODEL_PATH,
    DEFAULT_TOKENS_PATH,
    FLUSH_PAD_FRAMES,
    RESET_ENCODER_ON_SILENCE,
)
from src.models import (
    PhonemeToken,
    RawTranscriptionResult,
    RecoveryEvent,
    RecoverySummary,
    SpeechRecoveryResult,
)
from src.vad import QuranSilenceVAD

logger = logging.getLogger(__name__)

FRAME_TIME_STEP = 0.04  # 10ms fbank hop x 4 subsampling = 40ms per encoder frame (25 Hz)
CHUNK_LEN = 48         # decode chunk length in fbank frames (480ms)
T_LEN = 61             # total chunk window including right context in fbank frames (610ms)


def _get_kaldi_mel_banks(
    num_bins: int = 80,
    n_fft: int = 512,
    sample_rate: int = 16000,
    low_freq: float = 20.0,
    high_freq: float = -400.0,
) -> np.ndarray:
    """Precomputes triangular Mel filterbank matrix matching Daniel Povey's Kaldi C++ implementation."""
    nyquist = 0.5 * sample_rate
    if high_freq <= 0.0:
        high_freq += nyquist
    num_fft_bins = n_fft // 2
    fft_bin_width = sample_rate / n_fft

    mel_low = 1127.0 * math.log(1.0 + low_freq / 700.0)
    mel_high = 1127.0 * math.log(1.0 + high_freq / 700.0)
    mel_delta = (mel_high - mel_low) / (num_bins + 1)

    bins = np.zeros((num_bins, num_fft_bins), dtype=np.float32)
    for bin_idx in range(num_bins):
        left_mel = mel_low + bin_idx * mel_delta
        center_mel = mel_low + (bin_idx + 1) * mel_delta
        right_mel = mel_low + (bin_idx + 2) * mel_delta

        for i in range(num_fft_bins):
            freq = i * fft_bin_width
            mel = 1127.0 * math.log(1.0 + freq / 700.0)
            if left_mel < mel < center_mel:
                bins[bin_idx, i] = (mel - left_mel) / (center_mel - left_mel)
            elif center_mel <= mel < right_mel:
                bins[bin_idx, i] = (right_mel - mel) / (right_mel - center_mel)

    return bins


_CACHED_KALDI_MEL_BANKS_T: Optional[np.ndarray] = None
_CACHED_POVEY_WINDOW: Optional[np.ndarray] = None


def _numpy_kaldi_fbank(
    waveform: np.ndarray,
    sample_rate: int = 16000,
    frame_length_ms: float = 25.0,
    frame_shift_ms: float = 10.0,
    num_mel_bins: int = 80,
    preemphasis: float = 0.97,
    povey_power: float = 0.85,
) -> np.ndarray:
    """High-performance vectorized pure NumPy implementation of Daniel Povey's Kaldi Mel filterbank."""
    global _CACHED_KALDI_MEL_BANKS_T, _CACHED_POVEY_WINDOW
    if _CACHED_KALDI_MEL_BANKS_T is None:
        mel_banks = _get_kaldi_mel_banks(num_bins=num_mel_bins, sample_rate=sample_rate)
        _CACHED_KALDI_MEL_BANKS_T = np.ascontiguousarray(mel_banks.T, dtype=np.float32)

    frame_len = int(round(sample_rate * frame_length_ms / 1000.0))
    frame_shift = int(round(sample_rate * frame_shift_ms / 1000.0))
    n_fft = 512

    if _CACHED_POVEY_WINDOW is None or len(_CACHED_POVEY_WINDOW) != frame_len:
        n = np.arange(frame_len, dtype=np.float32)
        _CACHED_POVEY_WINDOW = ((0.5 - 0.5 * np.cos(2 * np.pi * n / (frame_len - 1))) ** povey_power).astype(np.float32)

    num_samples = len(waveform)
    num_frames = (num_samples + frame_shift // 2) // frame_shift
    if num_frames == 0:
        return np.empty((0, num_mel_bins), dtype=np.float32)

    half_diff = (frame_len - frame_shift) // 2
    padded_wave = np.pad(waveform, (half_diff, frame_len), mode="reflect")

    shape = (num_frames, frame_len)
    strides = (padded_wave.strides[0] * frame_shift, padded_wave.strides[0])
    frames = np.lib.stride_tricks.as_strided(padded_wave, shape=shape, strides=strides).copy()

    frames -= np.mean(frames, axis=1, keepdims=True)
    frames[:, 1:] -= preemphasis * frames[:, :-1]
    frames[:, 0] -= preemphasis * frames[:, 0]
    frames *= _CACHED_POVEY_WINDOW

    fft_vals = np.fft.rfft(frames, n=n_fft, axis=1)
    power_spectrum = (fft_vals[:, : n_fft // 2].real ** 2 + fft_vals[:, : n_fft // 2].imag ** 2)

    mel_energies = np.dot(power_spectrum, _CACHED_KALDI_MEL_BANKS_T)
    mel_energies = np.maximum(mel_energies, np.finfo(np.float32).eps)
    return np.log(mel_energies).astype(np.float32)


class ZipformerONNX:
    """Streaming INT8 Zipformer Arabic Phoneme CTC model runner."""
    _instance: Optional[ZipformerONNX] = None

    def __init__(self, device: str = "cpu"):
        self.device = device
        self.session: Optional[ort.InferenceSession] = None
        self.vocab: List[str] = []
        self.id2token: Dict[int, str] = {}
        self.token2id: Dict[str, int] = {}
        self._load_model()

    @classmethod
    def get_instance(cls, device: str = "cpu") -> ZipformerONNX:
        if cls._instance is None:
            cls._instance = ZipformerONNX(device=device)
        return cls._instance

    def _load_model(self):
        candidate_paths = [
            DEFAULT_MODEL_PATH,
            os.path.join(getattr(config, "ONNX_DIR", "data/onnx"), "zipformer_p_arabic_v3.int8.onnx"),
            os.path.join(getattr(config, "DATA_PATH", "data"), "onnx", "zipformer_p_arabic_v3.int8.onnx"),
        ]
        resolved_model_path = None
        for p in candidate_paths:
            if p and os.path.exists(p) and os.path.getsize(p) > 10_000_000:
                resolved_model_path = p
                break

        if not resolved_model_path:
            resolved_model_path = DEFAULT_MODEL_PATH
            os.makedirs(os.path.dirname(resolved_model_path), exist_ok=True)
            url = "https://github.com/Iam-Muslim/Natlu/releases/download/models-latest/zipformer_p_arabic_v3.int8.onnx"
            logger.info(f"Downloading Zipformer ONNX model from {url}...")
            print("[*] Downloading Zipformer ONNX acoustic model (~72 MB)...", file=sys.stderr, flush=True)
            try:
                urllib.request.urlretrieve(url, resolved_model_path)
            except Exception:
                import shutil
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req) as resp, open(resolved_model_path, "wb") as out:
                    shutil.copyfileobj(resp, out)
            logger.info("Zipformer ONNX model downloaded successfully.")
            print("[*] Zipformer ONNX model downloaded successfully.", file=sys.stderr, flush=True)

        sess_opts = ort.SessionOptions()
        sess_opts.log_severity_level = 3
        sess_opts.enable_cpu_mem_arena = os.environ.get("ONNX_ENABLE_ARENA", "1") == "1"
        num_workers = int(os.environ.get("ONNX_SEGMENT_WORKERS", getattr(config, "NUM_SEGMENT_WORKERS", 1)))
        default_threads = 1 if num_workers > 1 else 2
        num_threads = int(os.environ.get("ONNX_NUM_THREADS", str(default_threads)))
        sess_opts.intra_op_num_threads = num_threads
        sess_opts.inter_op_num_threads = 1

        opt_model_path = os.path.splitext(resolved_model_path)[0] + ".opt.onnx"
        if os.path.exists(opt_model_path):
            sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            self.session = ort.InferenceSession(
                opt_model_path,
                sess_opts,
                providers=['CPUExecutionProvider']
            )
        else:
            try:
                sess_opts.optimized_model_filepath = opt_model_path
                self.session = ort.InferenceSession(
                    resolved_model_path,
                    sess_opts,
                    providers=['CPUExecutionProvider']
                )
            except Exception:
                sess_opts.optimized_model_filepath = ""
                self.session = ort.InferenceSession(
                    resolved_model_path,
                    sess_opts,
                    providers=['CPUExecutionProvider']
                )

        self.vocab = []
        self.id2token = {}
        self.token2id = {}
        if os.path.exists(DEFAULT_TOKENS_PATH):
            with open(DEFAULT_TOKENS_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip("\r\n")
                    if not line:
                        continue
                    parts = line.rsplit(" ", 1)
                    if len(parts) == 2:
                        tok, idx = parts[0], int(parts[1])
                        self.id2token[idx] = tok
                        self.token2id[tok] = idx
            max_id = max(self.id2token.keys()) if self.id2token else 250
            self.vocab = [self.id2token.get(i, "<blank>") for i in range(max_id + 1)]

        # Pre-allocate reusable in-place state buffers to eliminate per-segment heap allocations
        self._input_names = [inp.name for inp in self.session.get_inputs()]
        self._state_names = [name for name in self._input_names if name != 'x']
        self._state_specs = [
            (inp.name, [1 if dim == 'N' else dim for dim in inp.shape], np.float32 if inp.type == 'tensor(float)' else np.int64)
            for inp in self.session.get_inputs()
        ]
        self._state_buffers = self._create_initial_states()

    def _create_initial_states(self) -> dict:
        states = {name: np.zeros(shape, dtype=dt) for name, shape, dt in self._state_specs}
        states['processed_lens'] = np.array([0], dtype=np.int64)
        return states

    def _reset_states(self, target_buffers: Optional[dict] = None) -> None:
        """In-place zeroing of recurrent state buffers (zero memory allocation overhead)."""
        target = self._state_buffers if target_buffers is None else target_buffers
        for k in self._state_names:
            target[k].fill(0)
        target['processed_lens'].fill(0)

    def _extract_fbank(self, audio: np.ndarray) -> np.ndarray:
        if not audio.flags.c_contiguous or audio.dtype != np.float32:
            audio = np.ascontiguousarray(audio, dtype=np.float32)

        # 1. Primary: C++ kaldi-native-fbank (top speed)
        if knf is not None:
            opts = knf.FbankOptions()
            opts.frame_opts.samp_freq = SAMPLE_RATE
            opts.mel_opts.num_bins = 80
            opts.frame_opts.dither = 0.0
            opts.frame_opts.snip_edges = False
            opts.frame_opts.window_type = "povey"
            opts.frame_opts.remove_dc_offset = True
            opts.frame_opts.preemph_coeff = 0.97
            opts.mel_opts.low_freq = 20.0
            opts.mel_opts.high_freq = -400.0
            opts.frame_opts.frame_shift_ms = 10.0
            opts.frame_opts.frame_length_ms = 25.0

            fbank = knf.OnlineFbank(opts)
            chunk_samples = SAMPLE_RATE * 30
            for pos in range(0, len(audio), chunk_samples):
                fbank.accept_waveform(SAMPLE_RATE, audio[pos:pos + chunk_samples])
            fbank.input_finished()

            num_frames = fbank.num_frames_ready
            if num_frames == 0:
                return np.empty((0, 80), dtype=np.float32)

            feats = np.empty((num_frames, 80), dtype=np.float32)
            get_frame = fbank.get_frame
            for i in range(num_frames):
                feats[i] = get_frame(i)

            del fbank
            return feats

        # 2. Fallback: Vectorised pure NumPy Kaldi fbank (100% token-equivalent, 0 compiler dependencies)
        return _numpy_kaldi_fbank(audio, sample_rate=SAMPLE_RATE)

    def _transcribe_fbank_segment(
        self,
        feats: np.ndarray,
        silence_pad_frames: Optional[int] = None,
        reset_states: bool = True,
        state_buffers: Optional[dict] = None,
    ) -> Tuple[np.ndarray, List[PhonemeToken]]:
        """Core streaming neural chunk loop on a pre-extracted Fbank feature slice."""
        if self.session is None or len(feats) == 0:
            return np.empty((0, len(self.vocab)), dtype=np.float32), []

        # Flush padding: append silence frames (default 96 frames = 960ms) to ensure all
        # internal Zipformer downsampling activations exit through the CTC head.
        flush_frames = FLUSH_PAD_FRAMES if silence_pad_frames is None else silence_pad_frames
        num_chunks = int(math.ceil((len(feats) + flush_frames) / CHUNK_LEN))
        required_len = max(T_LEN, (num_chunks - 1) * CHUNK_LEN + T_LEN)
        pad_len = max(0, required_len - len(feats))
        if pad_len > 0:
            padded_feats = np.zeros((required_len, 80), dtype=np.float32)
            padded_feats[:len(feats)] = feats
        else:
            padded_feats = feats

        states = state_buffers if state_buffers is not None else self._state_buffers
        # Fast in-place zero state reset only when explicitly requested (e.g. at Waqf boundaries)
        if reset_states:
            self._reset_states(states)

        num_frames = len(padded_feats)
        chunk_logprobs = []
        pos = 0
        while pos + T_LEN <= num_frames:
            states['x'] = padded_feats[pos:pos + T_LEN][None, :]
            outs = self.session.run(None, states)
            states.update(zip(self._state_names, outs[1:]))
            chunk_logprobs.append(outs[0][0])
            pos += CHUNK_LEN

        if not chunk_logprobs:
            return np.empty((0, len(self.vocab)), dtype=np.float32), []

        # Full logprobs without premature truncation, capturing all delayed trailing CTC spikes.
        # Trailing flush frames naturally emit pure CTC blank (BLANK_ID=250), which greedy decoding collapses.
        valid_logprobs = np.concatenate(chunk_logprobs, axis=0)

        # Greedy decoding to extract local phonemes
        pred_idx = np.argmax(valid_logprobs, axis=-1)
        phonemes: List[PhonemeToken] = []

        prev_idx = -1
        current_run_frames = []
        current_tok_idx = -1

        def _flush_run():
            if not current_run_frames or current_tok_idx == BLANK_ID or current_tok_idx == -1:
                return
            start_f = current_run_frames[0]
            end_f = current_run_frames[-1] + 1
            tok_str = self.id2token.get(current_tok_idx, "")
            if tok_str and tok_str != "<blank>":
                # Peak frame within emitted run
                pk_rel = int(np.argmax(valid_logprobs[current_run_frames, current_tok_idx]))
                pk_frame = current_run_frames[pk_rel]

                # Softmax at peak frame to compute true probability margin in [0, 1]
                # (matching decode_with_confidence.py in model/)
                peak_logits = valid_logprobs[pk_frame]
                peak_exp = np.exp(peak_logits - np.max(peak_logits))
                peak_probs = peak_exp / np.sum(peak_exp)
                pk_sorted = np.sort(peak_probs)[::-1]
                margin_pk = float(pk_sorted[0] - pk_sorted[1]) if len(pk_sorted) > 1 else 1.0

                start_sec = round(start_f * FRAME_TIME_STEP, 4)
                end_sec = round(end_f * FRAME_TIME_STEP, 4)
                pk_time = round(pk_frame * FRAME_TIME_STEP, 4)

                token_obj = PhonemeToken(
                    phoneme=tok_str,
                    start=start_sec,
                    end=end_sec,
                    confidence=round(margin_pk, 4),
                    is_recovered=False,
                    start_frame=start_f,
                    end_frame=end_f,
                    peak_frame=pk_frame,
                    peak_timestamp=pk_time,
                )
                phonemes.append(token_obj)

        for f_idx, idx in enumerate(pred_idx):
            if idx == prev_idx:
                if idx != BLANK_ID:
                    current_run_frames.append(f_idx)
                continue
            _flush_run()
            current_run_frames = [] if idx == BLANK_ID else [f_idx]
            current_tok_idx = idx
            prev_idx = idx

        _flush_run()
        return valid_logprobs, phonemes

    def transcribe_segment(
        self,
        segment_pcm: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
        silence_pad_frames: Optional[int] = None,
    ) -> Tuple[np.ndarray, List[PhonemeToken]]:
        """Transcribes a standalone audio slice (used by SpeechRecoveryEngine)."""
        if self.session is None or len(segment_pcm) == 0:
            return np.empty((0, len(self.vocab)), dtype=np.float32), []
        feats = self._extract_fbank(segment_pcm.astype(np.float32))
        if len(feats) == 0:
            return np.empty((0, len(self.vocab)), dtype=np.float32), []
        return self._transcribe_fbank_segment(feats, silence_pad_frames=silence_pad_frames, reset_states=True)

    def transcribe_audio(
        self,
        audio: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
        silence_pad_frames: Optional[int] = None,
        on_progress=None,
        on_vad_done=None,
        reset_on_silence: Optional[bool] = None,
    ) -> RawTranscriptionResult:
        """Transcribes audio using global Fbank caching, Tajweed pause segmentation & zero-drift segment feeding."""
        if self.session is None or len(audio) == 0:
            return RawTranscriptionResult(vocab_size=len(self.vocab))

        audio_pcm = audio.astype(np.float32, copy=False)
        audio_duration = len(audio_pcm) / sample_rate

        # 1. Unified Tajweed pause & silence detection
        vad_start = time.time()
        vad = QuranSilenceVAD(sample_rate=sample_rate)
        segments, pause_intervals, pause_timestamps = vad.detect_speech_and_pauses(audio_pcm)
        vad_time = max(0.0, time.time() - vad_start)

        if on_vad_done is not None:
            on_vad_done(vad_time)

        # 2. Extract Mel Filterbank ONCE globally across entire audio (blazing fast vectorized NumPy)
        global_feats = self._extract_fbank(audio_pcm)
        total_fbank_frames = len(global_feats)
        if total_fbank_frames == 0:
            return RawTranscriptionResult(vocab_size=len(self.vocab), vad_time=vad_time)

        del audio_pcm

        total_frames = int(math.ceil(audio_duration / FRAME_TIME_STEP))
        vocab_size = len(self.vocab)

        # 3. Global CTC emission matrix: pre-filled with 100% CTC Blank in pauses
        global_logprobs = np.full((total_frames, vocab_size), -50.0, dtype=np.float32)
        global_logprobs[:, BLANK_ID] = 0.0

        global_phonemes: List[PhonemeToken] = []
        global_raw_tokens: List[str] = []
        global_raw_timestamps: List[float] = []

        # Reset recurrent state buffers once at the start of the audio file (preserves memory across segments)
        self._reset_states()

        start_time = time.time()
        num_segments = len(segments)
        do_reset_on_silence = getattr(config, "RESET_ENCODER_ON_SILENCE", True) if reset_on_silence is None else reset_on_silence

        num_workers = int(os.environ.get("ONNX_SEGMENT_WORKERS", getattr(config, "NUM_SEGMENT_WORKERS", 1)))
        use_parallel = (num_workers > 1) and (num_segments > 2) and do_reset_on_silence

        results_by_idx: List[Optional[Tuple[np.ndarray, List[PhonemeToken]]]] = [None] * num_segments

        def _transcribe_single_segment(s_idx: int, states: Optional[dict] = None) -> Tuple[int, np.ndarray, List[PhonemeToken]]:
            seg = segments[s_idx]
            s_fb = max(0, int(round(seg.padded_start_sec * 100.0)))
            e_fb = min(total_fbank_frames, int(round(seg.padded_end_sec * 100.0)))
            seg_feats = global_feats[s_fb:e_fb]
            if len(seg_feats) == 0:
                return s_idx, np.empty((0, vocab_size), dtype=np.float32), []
            seg_lp, seg_phonemes = self._transcribe_fbank_segment(
                seg_feats,
                silence_pad_frames=silence_pad_frames,
                reset_states=do_reset_on_silence,
                state_buffers=states,
            )
            return s_idx, seg_lp, seg_phonemes

        if use_parallel:
            completed_dur = 0.0
            # Pre-allocate exactly one state buffer per worker thread (saves ~10.5s of heap allocations)
            buffer_pool = queue.SimpleQueue()
            for _ in range(num_workers):
                buffer_pool.put(self._create_initial_states())

            def _worker_task(s_idx: int) -> Tuple[int, np.ndarray, List[PhonemeToken]]:
                buf = buffer_pool.get()
                try:
                    return _transcribe_single_segment(s_idx, buf)
                finally:
                    buffer_pool.put(buf)

            with ThreadPoolExecutor(max_workers=num_workers) as executor:
                # LPT scheduling: dispatch longest segments first so short segments pack the tail with zero idle waiting
                sorted_indices = sorted(range(num_segments), key=lambda i: (segments[i].padded_end_sec - segments[i].padded_start_sec), reverse=True)
                futures = [executor.submit(_worker_task, i) for i in sorted_indices]
                for fut in as_completed(futures):
                    s_idx, seg_lp, seg_phonemes = fut.result()
                    results_by_idx[s_idx] = (seg_lp, seg_phonemes)
                    if on_progress is not None:
                        completed_dur += segments[s_idx].duration_sec
                        pct = min(100.0, (completed_dur / max(0.001, audio_duration)) * 100.0)
                        elp = max(0.001, time.time() - start_time)
                        spd = completed_dur / elp
                        on_progress(pct, spd, elp)
        else:
            # Single-worker mode: 100% zero extra heap allocation with in-place buffer reuse
            for s_idx in range(num_segments):
                _, seg_lp, seg_phonemes = _transcribe_single_segment(s_idx, None)
                results_by_idx[s_idx] = (seg_lp, seg_phonemes)
                if on_progress is not None:
                    pct = min(100.0, ((s_idx + 1) / max(1, num_segments)) * 100.0)
                    elp = max(0.001, time.time() - start_time)
                    spd = (segments[s_idx].padded_end_sec) / elp
                    on_progress(pct, spd, elp)

        # Deterministic chronological re-assembly into global timeline
        for s_idx in range(num_segments):
            seg = segments[s_idx]
            seg_data = results_by_idx[s_idx]
            if seg_data is None:
                continue
            seg_lp, seg_phonemes = seg_data

            if len(seg_lp) > 0:
                start_frame = int(round(seg.padded_start_sec / FRAME_TIME_STEP))
                if s_idx < num_segments - 1:
                    next_start_frame = int(round(segments[s_idx + 1].padded_start_sec / FRAME_TIME_STEP))
                    end_frame = min(total_frames, next_start_frame, start_frame + len(seg_lp))
                else:
                    end_frame = min(total_frames, start_frame + len(seg_lp))
                frames_to_copy = end_frame - start_frame

                if frames_to_copy > 0:
                    global_logprobs[start_frame:end_frame] = seg_lp[:frames_to_copy]

                # Map local segment phonemes into global timeline
                for p in seg_phonemes:
                    if p.start > (seg.duration_sec + 0.40):
                        continue

                    g_start = round(seg.padded_start_sec + p.start, 3)
                    g_end = min(round(audio_duration, 3), round(seg.padded_start_sec + p.end, 3))
                    g_pk = round(seg.padded_start_sec + p.peak_timestamp, 3) if p.peak_timestamp else round((g_start + g_end) / 2, 3)
                    g_pk = min(round(audio_duration, 3), g_pk)

                    shifted_token = PhonemeToken(
                        phoneme=p.phoneme,
                        start=g_start,
                        end=g_end,
                        confidence=p.confidence,
                        is_recovered=p.is_recovered,
                        start_frame=start_frame + (p.start_frame or 0),
                        end_frame=start_frame + (p.end_frame or 0),
                        peak_frame=start_frame + (p.peak_frame or 0),
                        peak_timestamp=g_pk,
                    )
                    global_phonemes.append(shifted_token)
                    global_raw_tokens.append(p.phoneme)
                    global_raw_timestamps.append(g_pk)

        global_phonemes.sort(key=lambda p: p.start)

        return RawTranscriptionResult(
            phonemes=global_phonemes,
            raw_tokens=global_raw_tokens,
            raw_timestamps=global_raw_timestamps,
            logprobs_matrix=global_logprobs,
            num_frames=total_frames,
            vocab_size=vocab_size,
            pause_timestamps=pause_timestamps,
            pause_intervals=pause_intervals,
            vad_time=vad_time,
        )


class SpeechRecoveryEngine:
    """Scans untranscribed acoustic gaps inside speech regions and recovers deleted phonemes.

    Guarantees:
      1. Boundary phoneme deduplication (prevents duplicating adjacent word edge tokens).
      2. Edge phoneme preservation (pre-roll padding + soft peak inclusion).
      3. Anti-glitch filtering (rejects single-token noise spikes).
      4. Trellis integrity (direct emission logprobs patching inside the gap).
    """

    @classmethod
    def recover_speech(
        cls,
        audio_pcm: np.ndarray,
        initial_phonemes: List[PhonemeToken],
        audio_duration: float,
        transcriber: ZipformerONNX,
        logprobs_matrix: Optional[np.ndarray] = None,
        min_hole_duration_s: Optional[float] = None,
        sample_rate: int = SAMPLE_RATE,
        on_progress: Optional[Callable[[float, float], None]] = None,
    ) -> SpeechRecoveryResult:
        start_time = time.time()

        min_hole_dur = min_hole_duration_s if min_hole_duration_s is not None else getattr(config, "SPEECH_RECOVERY_MIN_HOLE_DURATION_S", 1.40)
        pad_pre_s = getattr(config, "SPEECH_RECOVERY_PADDING_PRE_S", 0.16)
        pad_post_s = getattr(config, "SPEECH_RECOVERY_PADDING_POST_S", 0.24)
        min_tokens = getattr(config, "SPEECH_RECOVERY_MIN_PHONEMES_IN_GAP", 2)

        candidate_gaps: List[Tuple[Optional[PhonemeToken], Optional[PhonemeToken], float, float]] = []

        # Null-safe gap extraction (handling start, interior, and tail of audio)
        if not initial_phonemes:
            if audio_duration >= min_hole_dur:
                candidate_gaps.append((None, None, 0.0, audio_duration))
        else:
            if initial_phonemes[0].start >= min_hole_dur:
                candidate_gaps.append((None, initial_phonemes[0], 0.0, initial_phonemes[0].start))

            for i in range(len(initial_phonemes) - 1):
                p_prev = initial_phonemes[i]
                p_next = initial_phonemes[i + 1]
                g_dur = p_next.start - p_prev.end
                if g_dur >= min_hole_dur:
                    candidate_gaps.append((p_prev, p_next, p_prev.end, p_next.start))

            if audio_duration - initial_phonemes[-1].end >= min_hole_dur:
                candidate_gaps.append((initial_phonemes[-1], None, initial_phonemes[-1].end, audio_duration))

        recovery_events: List[RecoveryEvent] = []
        new_phonemes_to_insert: List[PhonemeToken] = []
        speech_holes_detected = 0

        for g_idx, (prev_tok, next_tok, g_s, g_e) in enumerate(candidate_gaps):
            gap_dur = g_e - g_s
            s_samp = max(0, int(round(g_s * sample_rate)))
            e_samp = min(len(audio_pcm), int(round(g_e * sample_rate)))
            gap_audio = audio_pcm[s_samp:e_samp]
            if len(gap_audio) == 0:
                continue

            # Digital silence check: skip dead digital silence buffers (< -55 dB)
            rms = np.sqrt(np.mean(gap_audio**2) + 1e-12)
            edb = float(20.0 * np.log10(max(rms, 1e-5)))
            if edb < -55.0:
                continue

            # Padded audio slicing with clean causal convolutional pre-roll & tail flush
            p_start = max(0.0, g_s - pad_pre_s)
            p_end = min(audio_duration, g_e + pad_post_s)
            slice_pcm = audio_pcm[int(round(p_start * sample_rate)):int(round(p_end * sample_rate))]
            if len(slice_pcm) == 0:
                continue

            feats = transcriber._extract_fbank(slice_pcm)
            slice_lp, raw_ph = transcriber._transcribe_fbank_segment(feats, reset_states=True)
            if not raw_ph:
                continue

            # Soft peak-based timestamp inclusion (protects onset & coda consonants from edge clipping)
            slice_tokens: List[PhonemeToken] = []
            for sp in raw_ph:
                r_start = round(p_start + sp.start, 3)
                r_end = round(p_start + sp.end, 3)
                r_pk = round(p_start + (sp.peak_timestamp if sp.peak_timestamp else (sp.start + sp.end) / 2), 3)

                if (g_s - 0.08) <= r_pk <= (g_e + 0.08):
                    slice_tokens.append(
                        PhonemeToken(
                            phoneme=sp.phoneme,
                            start=r_start,
                            end=r_end,
                            confidence=sp.confidence,
                            is_recovered=True,
                            start_frame=int(round(r_start / FRAME_TIME_STEP)),
                            end_frame=int(round(r_end / FRAME_TIME_STEP)),
                            peak_frame=int(round(r_pk / FRAME_TIME_STEP)),
                            peak_timestamp=r_pk,
                        )
                    )

            if not slice_tokens:
                continue

            # Strict 1-token seam deduplication: prune only if adjacent word border token matches exactly in time
            if prev_tok is not None and slice_tokens:
                if slice_tokens[0].phoneme == prev_tok.phoneme and abs(slice_tokens[0].start - prev_tok.start) < 0.20:
                    slice_tokens.pop(0)

            if next_tok is not None and slice_tokens:
                if slice_tokens[-1].phoneme == next_tok.phoneme and abs(slice_tokens[-1].end - next_tok.end) < 0.20:
                    slice_tokens.pop(-1)

            # Minimum length filter: reject single-token acoustic glitches
            if len(slice_tokens) < min_tokens:
                continue

            speech_holes_detected += 1

            # Boundary & sequence monotonicity clamping
            clamped_tokens: List[PhonemeToken] = []
            prev_end_time = prev_tok.end if prev_tok is not None else 0.0

            for k, tok in enumerate(slice_tokens):
                c_start = max(tok.start, prev_end_time)
                c_end = max(c_start + 0.02, tok.end)

                if next_tok is not None and k == len(slice_tokens) - 1:
                    c_end = min(c_end, next_tok.start)
                    c_start = min(c_start, c_end - 0.02)

                tok.start = round(c_start, 3)
                tok.end = round(c_end, 3)
                prev_end_time = tok.end
                clamped_tokens.append(tok)

            event = RecoveryEvent(
                event_id=len(recovery_events) + 1,
                gap_start=g_s,
                gap_end=g_e,
                gap_duration=gap_dur,
                padded_start=p_start,
                padded_end=p_end,
                energy_db=edb,
                recovered_text="".join(p.phoneme for p in clamped_tokens),
                recovered_phonemes=clamped_tokens,
            )
            recovery_events.append(event)
            new_phonemes_to_insert.extend(clamped_tokens)

            # Direct patch of global CTC emission matrix inside gap frames (restores true probabilities without blank peak)
            if logprobs_matrix is not None and len(slice_lp) > 0:
                s_frame = int(round(g_s / FRAME_TIME_STEP))
                e_frame = min(logprobs_matrix.shape[0], int(round(g_e / FRAME_TIME_STEP)))
                local_s = int(round((g_s - p_start) / FRAME_TIME_STEP))
                local_e = local_s + (e_frame - s_frame)
                if local_e <= len(slice_lp) and e_frame > s_frame:
                    logprobs_matrix[s_frame:e_frame] = slice_lp[local_s:local_e]

            if on_progress:
                on_progress(((g_idx + 1) / max(1, len(candidate_gaps))) * 100.0, time.time() - start_time)

        # Merge and sort all phonemes chronologically
        all_phonemes = list(initial_phonemes) + new_phonemes_to_insert
        all_phonemes.sort(key=lambda p: p.start)

        summary = RecoverySummary(
            recovery_time_seconds=time.time() - start_time,
            scanned_gaps_count=len(candidate_gaps),
            speech_holes_detected=speech_holes_detected,
            recovered_events_count=len(recovery_events),
            recovered_phonemes_count=len(new_phonemes_to_insert),
            energy_threshold_db=-55.0,
            min_hole_duration_s=min_hole_dur,
        )

        return SpeechRecoveryResult(
            recovered_phonemes=all_phonemes,
            recovery_events=recovery_events,
            recovery_summary=summary,
        )

