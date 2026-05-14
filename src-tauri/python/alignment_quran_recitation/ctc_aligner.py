"""
ctc_aligner.py
──────────────
CTC forced alignment using the FastConformer model's CTC branch.

Pipeline:
  raw audio (16kHz mono float32)
    → preprocessor (mel spectrogram, 80 bins, 10ms hop)
    → encoder (ConformerEncoder, 8× downsampling → ~12.5 frames/sec)
    → ctc_decoder Conv1d (512 → 1025)
    → log_softmax → log_probs (T, 1025)
    → torchaudio.functional.forced_align (Viterbi)
    → per-token boundaries + scores
    → group into words → per-word result

blank_id = 1024  (vocab_size, last index)
Frame rate after encoder: 16000 / (160 * 8) = 12.5 fps  →  80ms per frame
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import torch
import torch.nn.functional as F
import torchaudio

# ─────────────────────────────────── constants ──────────────────────────────
BLANK_ID = 1024          # vocab_size — CTC blank is always the last class
FRAME_RATE = 12.5        # encoder output frames per second (16000 / 8 / 160)
SCORE_THRESHOLD = 0.55   # below this → flag as potential error

# Arabic diacritic Unicode ranges for stripping
_DIACRITICS = (
    '\u0610', '\u061a',   # extended Arabic supplement
    '\u064b', '\u065f',   # harakat, sukun, shadda, maddah
    '\u0670',             # superscript alef
    '\u06d6', '\u06dc',   # Quranic annotation signs
    '\u06df', '\u06e4',
    '\u06e7', '\u06e8',
    '\u06ea', '\u06ed',
)

def strip_diacritics(text: str) -> str:
    """Remove all Arabic harakat / diacritics from text."""
    import re
    pattern = (
        '[\u0610-\u061a'
        '\u064b-\u065f'
        '\u0670'
        '\u06d6-\u06dc'
        '\u06df-\u06e4'
        '\u06e7\u06e8'
        '\u06ea-\u06ed]'
    )
    return re.sub(pattern, '', text)


# ─────────────────────────────────── data classes ───────────────────────────
@dataclass
class TokenAlignment:
    token_id: int
    token_text: str
    start_frame: int
    end_frame: int
    start_s: float
    end_s: float
    score: float          # mean log-prob (negative; closer to 0 = better)
    score_norm: float     # 0–1 normalized (1 = best)


@dataclass
class WordAlignment:
    word: str             # diacritized reference word
    word_plain: str       # stripped version
    start_s: float
    end_s: float
    score: float          # 0–1 normalized
    status: str           # "correct" | "warning" | "error"
    tokens: List[TokenAlignment] = field(default_factory=list)
    note: str = ""


# ─────────────────────────────────── main class ─────────────────────────────
class CTCAligner:
    """
    Wraps the NeMo FastConformer model and exposes CTC forced alignment.
    The model instance is passed in (shared with the STT server to avoid
    loading the 900 MB weights twice).
    """

    def __init__(self, model):
        self.model = model
        self.tokenizer = model.tokenizer
        self._ctc_layer = model.ctc_decoder.decoder_layers[0]  # Conv1d(512,1025,k=1)

    # ── internal: run audio through preprocessor + encoder + CTC head ────────
    @torch.no_grad()
    def _get_log_probs(self, wav: torch.Tensor) -> tuple[torch.Tensor, int]:
        """
        wav: (1, T_samples) float32 on GPU
        Returns:
          log_probs: (T_frames, V+1) float32
          T_frames: int
        """
        device = next(self.model.parameters()).device
        wav = wav.to(device)
        length = torch.tensor([wav.shape[1]], device=device)

        # Step 1: mel spectrogram
        features, feat_len = self.model.preprocessor(
            input_signal=wav, length=length
        )
        # features: (1, 80, T_mel)

        # Step 2: conformer encoder
        enc_out, enc_len = self.model.encoder(
            audio_signal=features, length=feat_len
        )
        # enc_out: (1, 512, T_enc)

        # Step 3: CTC Conv1d projection — expects (B, C_in, T)
        logits = self._ctc_layer(enc_out)          # (1, 1025, T_enc)
        logits = logits.transpose(1, 2)            # (1, T_enc, 1025)
        log_probs = F.log_softmax(logits, dim=-1)  # (1, T_enc, 1025)

        T = enc_len.item()
        return log_probs[0, :T, :], T   # (T, 1025)

    # ── tokenize reference text ───────────────────────────────────────────────
    def _tokenize_reference(
        self, reference: str
    ) -> tuple[list[int], list[str], list[int]]:
        """
        Tokenize diacritized reference using PLAIN tokens word-by-word.
        Returns (token_ids, token_texts, word_token_counts).

        word_token_counts[i] = number of subword tokens for word i.
        This lets us reconstruct word boundaries from the flat token sequence.

        Why plain? The model was trained on non-diacritized Arabic — CTC
        probabilities are highest for plain tokens.
        Why word-by-word? Arabic SentencePiece doesn't use ▁ word markers,
        so we track boundaries explicitly.
        """
        plain = strip_diacritics(reference)
        words = plain.split()
        all_ids: list[int]   = []
        all_texts: list[str] = []
        counts: list[int]    = []

        for word in words:
            ids = self.tokenizer.text_to_ids(word)
            texts = [self.tokenizer.ids_to_text([i]) for i in ids]
            all_ids.extend(ids)
            all_texts.extend(texts)
            counts.append(len(ids))

        return all_ids, all_texts, counts

    # ── torchaudio forced_align ───────────────────────────────────────────────
    def _forced_align(
        self,
        log_probs: torch.Tensor,   # (T, V+1)
        token_ids: list[int],
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """
        Run torchaudio.functional.forced_align.
        Returns (alignments, scores) each shape (T,).
        """
        T, V = log_probs.shape
        N = len(token_ids)

        targets = torch.tensor(token_ids, dtype=torch.int32)
        input_lengths = torch.tensor([T], dtype=torch.int32)
        target_lengths = torch.tensor([N], dtype=torch.int32)

        # forced_align expects (1, T, V) on CPU
        lp_cpu = log_probs.cpu().unsqueeze(0).float()

        alignments, scores = torchaudio.functional.forced_align(
            log_probs=lp_cpu,
            targets=targets.unsqueeze(0),
            input_lengths=input_lengths,
            target_lengths=target_lengths,
            blank=BLANK_ID,
        )
        # alignments: (1, T), scores: (1, T)
        return alignments[0], scores[0]   # (T,), (T,)

    # ── convert frame-level to token-level boundaries ────────────────────────
    def _frame_to_tokens(
        self,
        alignments: torch.Tensor,   # (T,) int — state index in CTC state seq
        scores: torch.Tensor,       # (T,) float — log prob per frame
        token_ids: list[int],
        token_texts: list[str],
    ) -> list[TokenAlignment]:
        """
        CTC state sequence: [blank, t0, blank, t1, blank, ..., tN, blank]
        State s → token_ids[(s-1)//2] if s%2==1 (non-blank), else blank.
        Collect frames belonging to each non-blank token state.
        """
        aligns_np = alignments.numpy()
        scores_np = scores.numpy()
        T = len(aligns_np)
        N = len(token_ids)
        token_aligns: list[TokenAlignment] = []

        for tok_idx in range(N):
            state = 2 * tok_idx + 1   # odd states are the actual tokens
            frames = np.where(aligns_np == state)[0]

            if len(frames) == 0:
                # No frames assigned to this token — estimate position
                # by spreading tokens evenly across the audio
                approx = int(tok_idx * T / max(N, 1))
                frames = np.array([min(approx, T - 1)])

            start_f = int(frames[0])
            end_f   = int(frames[-1])
            # Guard against inverted range (shouldn't happen, but be safe)
            if end_f < start_f:
                end_f = start_f

            mean_log_prob = float(scores_np[frames].mean())
            score_norm = float(np.clip(np.exp(mean_log_prob), 0.0, 1.0))

            token_aligns.append(TokenAlignment(
                token_id   = token_ids[tok_idx],
                token_text = token_texts[tok_idx],
                start_frame= start_f,
                end_frame  = end_f,
                start_s    = round(start_f / FRAME_RATE, 3),
                end_s      = round((end_f + 1) / FRAME_RATE, 3),
                score      = mean_log_prob,
                score_norm = score_norm,
            ))

        return token_aligns

    # ── group tokens → words ─────────────────────────────────────────────────
    def _group_into_words(
        self,
        token_aligns: list[TokenAlignment],
        reference_words: list[str],   # diacritized words
        plain_words: list[str],       # plain words
        word_token_counts: list[int], # how many tokens per word (from _tokenize_reference)
    ) -> list[WordAlignment]:
        """
        Group tokens into words using word_token_counts (explicit boundaries).
        Arabic SentencePiece doesn't use ▁ markers, so we track word→token
        counts explicitly when tokenizing word-by-word.
        """
        if not token_aligns or not word_token_counts:
            return []

        word_aligns: list[WordAlignment] = []
        tok_offset = 0
        n_words = min(len(word_token_counts), len(reference_words))

        for i in range(n_words):
            count = word_token_counts[i]
            group = token_aligns[tok_offset: tok_offset + count]
            tok_offset += count

            if not group:
                continue

            avg_score = float(np.mean([t.score_norm for t in group]))
            start_s = group[0].start_s
            end_s   = group[-1].end_s
            # Guard inverted times
            if end_s < start_s:
                start_s, end_s = end_s, start_s

            if avg_score >= SCORE_THRESHOLD:
                status, note = "correct", ""
            elif avg_score >= 0.30:
                status, note = "warning", "possible mispronunciation"
            else:
                status, note = "error", "likely mispronounced"

            word_aligns.append(WordAlignment(
                word       = reference_words[i],
                word_plain = plain_words[i],
                start_s    = start_s,
                end_s      = end_s,
                score      = round(avg_score, 3),
                status     = status,
                tokens     = group,
                note       = note,
            ))

        return word_aligns

    # ── public entry point ────────────────────────────────────────────────────
    def align(
        self,
        wav_numpy: np.ndarray,    # float32 1D, 16kHz
        reference: str,           # diacritized Arabic reference text
    ) -> dict:
        """
        Main alignment function.

        Args:
            wav_numpy: float32 numpy array of audio samples at 16kHz
            reference: fully diacritized Arabic text (e.g. from Quran DB)

        Returns:
            dict with overall_score, passed, words (list), mistakes (list)
        """
        # --- Prepare audio tensor ---
        wav_t = torch.tensor(wav_numpy, dtype=torch.float32).unsqueeze(0)

        # --- Get CTC log probs ---
        log_probs, T = self._get_log_probs(wav_t)

        # --- Tokenize reference (plain for alignment) ---
        token_ids, token_texts, word_token_counts = self._tokenize_reference(reference)

        if not token_ids:
            return {"error": "Could not tokenize reference text"}

        # --- Split reference into diacritized / plain words ---
        ref_words_diac  = reference.split()
        ref_words_plain = strip_diacritics(reference).split()

        # --- Forced alignment (Viterbi) ---
        try:
            alignments, scores = self._forced_align(log_probs, token_ids)
        except Exception as e:
            return {"error": f"Forced alignment failed: {e}"}

        # --- Token-level results ---
        token_aligns = self._frame_to_tokens(
            alignments, scores, token_ids, token_texts
        )

        # --- Word-level results ---
        word_aligns = self._group_into_words(
            token_aligns, ref_words_diac, ref_words_plain, word_token_counts
        )

        # --- Aggregate ---
        if word_aligns:
            overall = float(np.mean([w.score for w in word_aligns]))
        else:
            overall = 0.0

        mistakes = [
            f"{w.word} at {w.start_s}s (score: {w.score})"
            for w in word_aligns if w.status in ("error", "warning")
        ]

        # Build plain transcription from token texts
        transcription = "".join(t.token_text for t in token_aligns).replace('▁', ' ').strip()

        return {
            "overall_score": round(overall, 3),
            "passed": overall >= SCORE_THRESHOLD and len([w for w in word_aligns if w.status == "error"]) == 0,
            "words": [
                {
                    "word":       w.word,
                    "word_plain": w.word_plain,
                    "start_s":    w.start_s,
                    "end_s":      w.end_s,
                    "score":      w.score,
                    "status":     w.status,
                    "note":       w.note,
                }
                for w in word_aligns
            ],
            "mistakes":       mistakes,
            "transcription":  transcription,
            "num_frames":     T,
            "duration_s":     round(T / FRAME_RATE, 2),
        }
