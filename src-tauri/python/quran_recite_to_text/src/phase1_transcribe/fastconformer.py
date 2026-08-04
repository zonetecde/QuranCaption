"""Acoustic Model Wrapper (ONNXRuntime)."""

import os
import urllib.request
from pathlib import Path
import numpy as np
import librosa
import pyloudnorm as pyln
import onnxruntime as ort
import kaldi_native_fbank as knf

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "onnx"
FASTCONFORMER_ONNX_PATH = str(MODEL_DIR / "qurankarim-fastconformer-mixed.onnx")
FASTCONFORMER_TOKENS_PATH = str(MODEL_DIR / "tokens.txt")

FC_SAMPLE_RATE = 16000
BLANK_ID = 1024
FRAME_TIME_STEP = 0.08


class FastConformerONNX:
    """Singleton wrapper for FastConformer ONNX model."""
    _instance = None

    def __init__(self, device='cpu'):
        self.device = device
        self.session = None
        self.vocab = []
        self._load_model()

    @classmethod
    def get_instance(cls, device='cpu'):
        if cls._instance is None:
            cls._instance = FastConformerONNX(device=device)
        return cls._instance

    def _load_model(self):
        if not os.path.exists(FASTCONFORMER_ONNX_PATH):
            os.makedirs(os.path.dirname(FASTCONFORMER_ONNX_PATH), exist_ok=True)
            url = "https://github.com/Iam-Muslim/QuranReciteToText/releases/download/model/qurankarim-fastconformer-mixed.onnx"
            urllib.request.urlretrieve(url, FASTCONFORMER_ONNX_PATH)

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = 2
        sess_opts.inter_op_num_threads = 2

        self.session = ort.InferenceSession(
            FASTCONFORMER_ONNX_PATH,
            sess_opts,
            providers=['CPUExecutionProvider']
        )

        with open(FASTCONFORMER_TOKENS_PATH, "r", encoding="utf-8") as f:
            self.vocab = [line.strip("\r\n").rsplit(" ", 1)[0] for line in f if line.strip("\r\n")]

    def transcribe(self, audio: np.ndarray, orig_sr: int = 16000, safe_lufs: bool = True):
        """Transcribes a single chunk of audio and returns text, word_timestamps, logprobs."""
        if self.session is None or len(audio) == 0:
            return "", [], None

        clean_audio = audio.astype(np.float32)

        if orig_sr != FC_SAMPLE_RATE:
            clean_audio = librosa.resample(clean_audio, orig_sr=orig_sr, target_sr=FC_SAMPLE_RATE)

        # Check RMS power to prevent amplifying quiet noise floor / silence
        rms = np.sqrt(np.mean(np.square(clean_audio))) if len(clean_audio) > 0 else 0.0
        should_normalize = True
        if safe_lufs and rms < 1e-3:  # RMS noise floor gate (~ -60 dB)
            should_normalize = False

        if should_normalize:
            try:
                meter = pyln.Meter(FC_SAMPLE_RATE)
                loudness = meter.integrated_loudness(clean_audio)
                if np.isfinite(loudness) and loudness < 0:
                    clean_audio = pyln.normalize.loudness(clean_audio, loudness, -23.0)
            except Exception:
                pass

        peak = np.max(np.abs(clean_audio)) if len(clean_audio) > 0 else 0.0
        if peak > 1.0:
            clean_audio = clean_audio / peak

        opts = knf.FbankOptions()
        opts.frame_opts.samp_freq = FC_SAMPLE_RATE
        opts.mel_opts.num_bins = 80
        opts.frame_opts.dither = 0.0
        opts.frame_opts.snip_edges = False
        opts.frame_opts.remove_dc_offset = False
        opts.frame_opts.window_type = "hann"
        opts.mel_opts.low_freq = 0.0
        opts.mel_opts.high_freq = 0.0
        opts.frame_opts.preemph_coeff = 0.0
        opts.frame_opts.frame_shift_ms = 10.0
        opts.frame_opts.frame_length_ms = 25.0
        opts.mel_opts.is_librosa = True

        fbank = knf.OnlineFbank(opts)
        fbank.accept_waveform(FC_SAMPLE_RATE, clean_audio.tolist())
        fbank.input_finished()

        feats = [fbank.get_frame(i) for i in range(fbank.num_frames_ready)]
        feats = np.array(feats)
        if feats.shape[0] == 0:
            return "", [], None

        mean = np.mean(feats, axis=0, keepdims=True)
        mean_sq = np.mean(np.square(feats), axis=0, keepdims=True)
        var = np.maximum(mean_sq - np.square(mean), 0.0)
        inv_std = 1.0 / (np.sqrt(var) + 1e-5)
        feats_norm = (feats - mean) * inv_std

        feats_in = np.expand_dims(feats_norm.T, axis=0)
        seq_len = np.array([feats_in.shape[2]], dtype=np.int64)

        inputs = {
            "audio_signal": feats_in.astype(np.float32),
            "length": seq_len
        }
        outputs = self.session.run(["logprobs"], inputs)
        logprobs = outputs[0]

        pred_idx = np.argmax(logprobs[0], axis=-1)
        subword_tokens, subword_times = [], []
        prev_idx = -1

        for frame_idx, idx in enumerate(pred_idx):
            if idx != BLANK_ID and idx != prev_idx:
                subword_tokens.append(self.vocab[idx])
                subword_times.append(frame_idx * FRAME_TIME_STEP)
            prev_idx = idx

        words_timestamps = []
        current_word_subwords = []
        word_start_time = None
        word_end_time = None

        for tok, t in zip(subword_tokens, subword_times):
            is_new_word = tok.startswith('▁') or tok.startswith(' ')

            if is_new_word and current_word_subwords:
                full_word = "".join(current_word_subwords).replace('▁', '').replace(' ', '').strip()
                if full_word:
                    words_timestamps.append({
                        "word": full_word,
                        "start": word_start_time,
                        "end": word_end_time
                    })
                current_word_subwords = []
                word_start_time = t

            if not current_word_subwords:
                word_start_time = t

            current_word_subwords.append(tok)
            word_end_time = t + FRAME_TIME_STEP

        if current_word_subwords:
            full_word = "".join(current_word_subwords).replace('▁', '').replace(' ', '').strip()
            if full_word:
                words_timestamps.append({
                    "word": full_word,
                    "start": word_start_time,
                    "end": word_end_time
                })

        full_text = " ".join([w['word'] for w in words_timestamps])
        return full_text, words_timestamps, logprobs
