"""Regression tests for offline WordTiming bootstrap and multi-surah detection."""

import importlib.metadata
import itertools
from pathlib import Path
import runpy
import ssl
import sys
import types
import unittest
from unittest.mock import Mock, patch


PYTHON_DIR = Path(__file__).resolve().parents[2] / "src-tauri" / "python"
ENGINE_DIR = PYTHON_DIR / "quran_recite_to_text"
sys.path.insert(0, str(ENGINE_DIR))

# Import the detector without running the package's dependency installer.
for name, directory in (("src", ENGINE_DIR / "src"), ("src.matching", ENGINE_DIR / "src" / "matching")):
    package = types.ModuleType(name)
    package.__path__ = [str(directory)]
    sys.modules[name] = package

from src.matching.detector import SurahDetector, SurahSearchResult
from src.models import PhonemeToken


class WordTimingRegressionTests(unittest.TestCase):
    """Exercise certificate validation and short recitation boundaries."""

    def test_bootstrap_preserves_verified_https(self) -> None:
        """Keep default HTTPS certificate and hostname checks in both entrypoints."""
        original_context = ssl._create_default_https_context
        for entrypoint in (
            PYTHON_DIR / "local_word_timing_segmenter.py",
            ENGINE_DIR / "data" / "bin" / "bootstrap.py",
        ):
            with self.subTest(entrypoint=entrypoint.name):
                with patch.object(Path, "is_dir", return_value=False), patch.object(
                    importlib.metadata, "version", return_value="installed"
                ):
                    runpy.run_path(str(entrypoint), run_name="word_timing_test")
                self.assertIs(ssl._create_default_https_context, original_context)
                context = ssl._create_default_https_context()
                self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
                self.assertTrue(context.check_hostname)

    def test_short_recitations_without_basmalah_are_preserved(self) -> None:
        """Retain a one-ayah block at the beginning, end, or middle of recitation."""
        cases = (
            ([(112, 4), (112, 4), (113, 1), (113, 2), (113, 3)], [112, 113]),
            ([(113, 1), (113, 2), (113, 3), (112, 4), (112, 4)], [113, 112]),
            ([(113, 1), (113, 2), (112, 4), (112, 4), (114, 1), (114, 2), (114, 3)], [113, 112, 114]),
        )
        for probes, expected_surahs in cases:
            with self.subTest(expected_surahs=expected_surahs):
                tokens = [
                    PhonemeToken("بت"[index % 2], index / 25, (index + 1) / 25)
                    for index in range(len(probes) * 16)
                ]
                matches = [[SurahSearchResult(surah, ayah, 0)] for surah, ayah in probes]
                detector = SurahDetector()
                detector._phonetic_search.search = Mock(
                    side_effect=itertools.chain(matches, itertools.repeat(matches[-1]))
                )
                with patch("src.matching.detector.find_near_matches", return_value=[]):
                    results = detector.detect_multi_surah(tokens)
                self.assertEqual([result.surah for result in results], expected_surahs)
                self.assertEqual(results[0].token_start_idx, 0)
                self.assertEqual(results[-1].token_end_idx, len(tokens))
                for previous, following in zip(results, results[1:]):
                    self.assertEqual(previous.token_end_idx, following.token_start_idx)


if __name__ == "__main__":
    unittest.main()
