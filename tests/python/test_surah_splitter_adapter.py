import importlib.util
from pathlib import Path
import unittest


WRAPPER_PATH = Path(__file__).parents[2] / "src-tauri" / "python" / "local_surah_splitter_segmenter.py"
SPEC = importlib.util.spec_from_file_location("local_surah_splitter_segmenter", WRAPPER_PATH)
wrapper = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(wrapper)


class SurahSplitterAdapterTest(unittest.TestCase):
    def test_converts_caption_segments_and_repetitions(self):
        raw_segments = [
            {
                "surah": 1,
                "ayah": 1,
                "segment": 1,
                "text": "بسم الله الرحمن الرحيم",
                "words": [
                    {"word": "بسم", "canonical_idx": 0, "start": 0.0, "end": 0.4, "score": 1.0},
                    {"word": "الله", "canonical_idx": 1, "start": 0.4, "end": 0.8, "score": 1.0},
                    {"word": "الرحمن", "canonical_idx": 2, "start": 0.8, "end": 1.2, "score": 1.0},
                    {"word": "الرحيم", "canonical_idx": 3, "start": 1.2, "end": 1.6, "score": 1.0},
                ],
            },
            {
                "surah": 1,
                "ayah": 1,
                "segment": 2,
                "text": "الرحمن الرحيم",
                "words": [
                    {"word": "الرحمن", "canonical_idx": 2, "start": 2.0, "end": 2.4, "score": 0.0},
                    {"word": "الرحيم", "canonical_idx": 3, "start": 2.4, "end": 2.8, "score": 1.0},
                ],
            },
        ]

        result = wrapper.convert_caption_segments(
            raw_segments,
            {(1, 1): ["بسم", "الله", "الرحمن", "الرحيم"]},
        )

        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(result["segments"][0]["ref_from"], "1:1:1")
        self.assertEqual(result["segments"][0]["ref_to"], "1:1:4")
        self.assertEqual(result["segments"][1]["ref_from"], "1:1:3")
        self.assertEqual(result["segments"][1]["ref_to"], "1:1:4")
        self.assertTrue(result["segments"][1]["has_missing_words"])
        self.assertEqual(result["segments"][1]["words"][0]["start"], 0.0)
        self.assertEqual(result["segments"][1]["words"][1]["end"], 0.8)

    def test_rejects_unordered_timestamps(self):
        with self.assertRaises(ValueError):
            wrapper.convert_caption_segments(
                [
                    {
                        "surah": 1,
                        "ayah": 1,
                        "segment": 1,
                        "text": "بسم الله",
                        "words": [
                            {
                                "word": "الله",
                                "canonical_idx": 1,
                                "start": 1.0,
                                "end": 1.2,
                                "score": 1.0,
                            },
                            {
                                "word": "بسم",
                                "canonical_idx": 0,
                                "start": 0.5,
                                "end": 0.8,
                                "score": 1.0,
                            },
                        ],
                    }
                ],
                {(1, 1): ["بسم", "الله"]},
            )

    def test_normalizes_wbw_boundaries_and_subtitle_overlap(self):
        result = wrapper.convert_caption_segments(
            [
                {
                    "surah": 1,
                    "ayah": 1,
                    "segment": 1,
                    "text": "بسم الله",
                    "words": [
                        {
                            "word": "بسم",
                            "canonical_idx": 0,
                            "start": 0.0,
                            "end": 0.2,
                            "score": 1.0,
                        },
                        {
                            "word": "الله",
                            "canonical_idx": 1,
                            "start": 0.5,
                            "end": 1.0,
                            "score": 1.0,
                        },
                    ],
                },
                {
                    "surah": 1,
                    "ayah": 2,
                    "segment": 2,
                    "text": "الحمد لله",
                    "words": [
                        {
                            "word": "الحمد",
                            "canonical_idx": 0,
                            "start": 0.8,
                            "end": 1.2,
                            "score": 1.0,
                        },
                        {
                            "word": "لله",
                            "canonical_idx": 1,
                            "start": 1.4,
                            "end": 1.8,
                            "score": 1.0,
                        },
                    ],
                },
            ],
            {
                (1, 1): ["بسم", "الله"],
                (1, 2): ["الحمد", "لله"],
            },
        )

        first, second = result["segments"]
        self.assertEqual(first["words"][0]["end"], first["words"][1]["start"])
        self.assertEqual(first["words"][1]["end"], first["time_to"] - first["time_from"])
        self.assertEqual(first["time_to"], second["time_from"])
        self.assertEqual(second["words"][0]["start"], 0.0)
        self.assertEqual(second["words"][0]["end"], second["words"][1]["start"])

    def test_drops_previous_subtitle_when_overlap_makes_it_empty(self):
        result = wrapper.convert_caption_segments(
            [
                {
                    "surah": 1,
                    "ayah": 2,
                    "segment": 1,
                    "text": "الحمد لله",
                    "words": [
                        {
                            "word": "الحمد",
                            "canonical_idx": 0,
                            "start": 1.0,
                            "end": 1.5,
                            "score": 1.0,
                        }
                    ],
                },
                {
                    "surah": 1,
                    "ayah": 1,
                    "segment": 2,
                    "text": "بسم",
                    "words": [
                        {
                            "word": "بسم",
                            "canonical_idx": 0,
                            "start": 0.5,
                            "end": 0.8,
                            "score": 1.0,
                        }
                    ],
                },
            ],
            {
                (1, 1): ["بسم"],
                (1, 2): ["الحمد", "لله"],
            },
        )

        self.assertEqual(len(result["segments"]), 1)
        self.assertEqual(result["segments"][0]["ref_from"], "1:1:1")


if __name__ == "__main__":
    unittest.main()
