"""Fixed Quran Reference Data Structures & Medina Mushaf Indexer.

Defines the indexed representation of Surahs, verses, words,
and phoneme sequences for recitation alignment.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from collections import defaultdict
from typing import List, Dict, Any
import numpy as np


@dataclass(slots=True)
class RefWord:
    """Individual word entry in the Medina Mushaf reference text."""
    global_index: int
    surah: int
    ayah: int
    word_in_ayah: int
    uthmani: str
    phoneme: str
    location: str


class SurahReferenceData:
    """Indexed reference representation for a single Surah."""

    def __init__(self, surah: int, verses_dict: Dict[str, Any]):
        self.surah = surah
        self.words: List[RefWord] = []
        self.ayah_to_words: Dict[int, List[RefWord]] = defaultdict(list)
        self.ayah_start_word_index: Dict[int, int] = {}

        a = 1
        while f"{surah}:{a}" in verses_dict:
            v_data = verses_dict[f"{surah}:{a}"]
            ayah_text = v_data.get("aya_text", "").strip()
            ph_words = v_data.get("aya_phonemes_list", [])
            text_words = [w for w in re.split(r"\s+", ayah_text) if w]

            if ph_words:
                self.ayah_start_word_index[a] = len(self.words)
                for i, ph_w in enumerate(ph_words):
                    txt = text_words[i] if i < len(text_words) else str(ph_w)
                    w = RefWord(
                        global_index=len(self.words),
                        surah=surah,
                        ayah=a,
                        word_in_ayah=i + 1,
                        uthmani=txt,
                        phoneme=str(ph_w),
                        location=f"{surah}:{a}:{i + 1}",
                    )
                    self.words.append(w)
                    self.ayah_to_words[a].append(w)
            a += 1

        self.num_words = len(self.words)
        self.word_boundaries = [0]
        for w in self.words:
            self.word_boundaries.append(self.word_boundaries[-1] + len(w.phoneme))
        self.full_phonemes = "".join(w.phoneme for w in self.words)

        self.flat_phone_to_word = np.zeros(len(self.full_phonemes), dtype=np.int32)
        for w_idx, w in enumerate(self.words):
            s = self.word_boundaries[w_idx]
            e = self.word_boundaries[w_idx + 1]
            self.flat_phone_to_word[s:e] = w_idx
