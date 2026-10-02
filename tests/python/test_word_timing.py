"""Regression tests for offline WordTiming detection, timing, and matching memory."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src-tauri/python/quran_recite_to_text"))

from src.aligner import CtcViterbiAligner
from src.matching.detector import SurahDetector, SurahSearchResult
from src.matching.kernels import _global_viterbi_fast
from src.models import PauseInterval, PhonemeToken


def matching_args(predicted: list[int], reference: list[int]) -> tuple:
    """Builds matching inputs with two phonemes per reference word."""
    size = max(predicted + reference) + 1
    costs = np.ones((size, size), dtype=np.float64)
    np.fill_diagonal(costs, 0.0)
    starts = np.arange(len(reference) + 1) % 2 == 0
    ends = starts.copy()
    ends[0] = False
    return (
        np.array(predicted, dtype=np.int32),
        np.array(reference, dtype=np.int32),
        np.arange(len(reference), dtype=np.int32) // 2,
        starts,
        ends,
        np.ones(len(reference), dtype=np.float64),
        np.full(len(predicted), 0.75, dtype=np.float64),
        costs,
        0.8,
        0.05,
    )


class WordTimingRegressionTests(unittest.TestCase):
    """Exercises the three regressions without downloading or running acoustic models."""

    def test_filterbank_runs_without_native_kaldi(self) -> None:
        """Extracts acoustic features when the optional native module is unavailable."""
        with patch.dict(sys.modules, {"kaldi_native_fbank": None}):
            from src.transcriber import ZipformerONNX

            transcriber = object.__new__(ZipformerONNX)
            audio = np.sin(np.arange(16000) * 0.1).astype(np.float32)
            features = transcriber._extract_fbank(audio)
        self.assertEqual(features.shape, (100, 80))
        self.assertEqual(features.dtype, np.float32)
        self.assertTrue(np.isfinite(features).all())

    def test_repeated_surahs_remain_in_timeline(self) -> None:
        """Keeps intervening chapters when a prayer returns to an earlier chapter."""
        for sequence in ([1, 112, 1, 113], [2, 3, 2]):
            with self.subTest(sequence=sequence):
                markers = {s: chr(0x628 + i) for i, s in enumerate(dict.fromkeys(sequence))}
                chapters = {c: s for s, c in markers.items()}
                tokens = [
                    PhonemeToken(
                        phoneme=markers[surah] + "\u0641\u0642\u0643\u0644\u0645\u0646\u0647",
                        start=(block * 180 + i) * 0.15,
                        end=(block * 180 + i + 1) * 0.15,
                    )
                    for block, surah in enumerate(sequence)
                    for i in range(180)
                ]

                def search(query: str, error_ratio: float = 0.2) -> list[SurahSearchResult]:
                    """Provides unambiguous chapter hits to isolate temporal grouping."""
                    surah = chapters[query[0]]
                    return [SurahSearchResult(surah, 2 if surah == 1 else 1, 0)]

                detector = SurahDetector()
                with patch.object(detector._phonetic_search, "search", side_effect=search):
                    sections = detector.detect_multi_surah(tokens)
                self.assertEqual([section.surah for section in sections], list(sequence))
                self.assertEqual(sections[0].token_start_idx, 0)
                self.assertEqual(sections[-1].token_end_idx, len(tokens))
                for left, right in zip(sections, sections[1:]):
                    self.assertEqual(left.token_end_idx, right.token_start_idx)

    def test_fast_phonemes_keep_positive_acoustic_times(self) -> None:
        """Preserves fast speech at the beginning and near the end of an audio file."""
        for count, offset in ((20, 0), (25, 0), (20, 5), (20, 100)):
            with self.subTest(count=count, offset=offset):
                frames = 25 + offset
                lp = np.full((frames, 251), -20.0, dtype=np.float32)
                lp[:, 250] = 0.0
                tokens = []
                for i in range(count):
                    frame = offset + i
                    lp[frame, 250] = -10.0
                    lp[frame, i % 2] = 0.0
                    tokens.append(PhonemeToken(
                        phoneme="a" if i % 2 == 0 else "b",
                        start=frame * 0.04,
                        end=(frame + 1) * 0.04,
                        peak_frame=frame,
                        peak_timestamp=frame * 0.04,
                    ))
                result = CtcViterbiAligner.align_phonemes(
                    tokens, frames * 0.04, {"a": 0, "b": 1}, lp,
                )
                self.assertEqual(len(result), count)
                for i, phoneme in enumerate(result):
                    self.assertLess(phoneme.start, phoneme.end)
                    self.assertAlmostEqual(phoneme.start, (offset + i) * 0.04, places=3)
                    self.assertLessEqual(phoneme.end, frames * 0.04)
                for left, right in zip(result, result[1:]):
                    self.assertLessEqual(left.end, right.start)

    def test_fast_phonemes_preserve_vad_pause(self) -> None:
        """Keeps a confirmed pause between two groups of fast phonemes."""
        frames = list(range(6)) + list(range(30, 36))
        lp = np.full((40, 251), -20.0, dtype=np.float32)
        lp[:, 250] = 0.0
        tokens = []
        for i, frame in enumerate(frames):
            lp[frame, 250] = -10.0
            lp[frame, i % 2] = 0.0
            tokens.append(PhonemeToken(
                phoneme="a" if i % 2 == 0 else "b",
                start=frame * 0.04,
                end=(frame + 1) * 0.04,
                peak_frame=frame,
                peak_timestamp=frame * 0.04,
            ))
        pause = PauseInterval(0.24, 1.2, 0.96)
        result = CtcViterbiAligner.align_phonemes(
            tokens, 1.6, {"a": 0, "b": 1}, lp, pause_intervals=[pause],
        )
        self.assertEqual(len(result), len(tokens))
        self.assertLessEqual(result[5].end, pause.start_sec)
        self.assertGreaterEqual(result[6].start, pause.end_sec)
        self.assertTrue(all(phoneme.end > phoneme.start for phoneme in result))

    def test_matching_preserves_repetitions_and_edit_costs(self) -> None:
        """Keeps word repetitions, insertions, and deletions across traceback blocks."""
        cases = (
            ([1, 2, 3, 4], 0.0, [0, 0, 1, 1]),
            ([1, 2, 3, 4, 1, 2, 3, 4], 0.85, [0, 0, 1, 1, 0, 0, 1, 1]),
            ([1, 2, 9, 3, 4], 0.75, [0, 0, 0, 1, 1]),
            ([1, 3, 4], 1.0, [0, 1, 1]),
        )
        for predicted, score, words in cases:
            with self.subTest(predicted=predicted):
                result = _global_viterbi_fast(*matching_args(predicted, [1, 2, 3, 4]))
                self.assertAlmostEqual(result[2], score)
                np.testing.assert_array_equal(result[3], words)

    def test_long_matching_uses_bounded_allocations(self) -> None:
        """Matches a long reference without allocating a full traceback matrix."""
        _global_viterbi_fast(*matching_args([1, 2], [1, 2]))
        reference = [1, 2, 3, 4] * 1000
        original_zeros = np.zeros

        def bounded_zeros(shape: tuple, *args, **kwargs) -> np.ndarray:
            """Rejects traceback allocations exceeding four MiB."""
            dtype = kwargs.get("dtype", float)
            size = int(np.prod(shape)) * np.dtype(dtype).itemsize
            self.assertLessEqual(size, 4 * 1024 * 1024)
            return original_zeros(shape, *args, **kwargs)

        kernel = getattr(_global_viterbi_fast, "py_func", _global_viterbi_fast)
        with patch("src.matching.kernels.np.zeros", side_effect=bounded_zeros):
            result = kernel(*matching_args(reference, reference))
        self.assertEqual(result[2], 0.0)
        np.testing.assert_array_equal(result[3], np.arange(len(reference)) // 2)
        np.testing.assert_array_equal(result[4], np.arange(len(reference)))


if __name__ == "__main__":
    unittest.main()
