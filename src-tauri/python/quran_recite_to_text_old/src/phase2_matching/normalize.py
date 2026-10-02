"""Text Normalization & Resource Initialization (Phase 2 Matcher)."""

import re
from collections import defaultdict
from functools import lru_cache
from qua_sdk.domain.chapter_refs import ChapterReference, RefWord, _assemble
from qua_sdk.domain.anchor_index import PhonemeNgramIndex
from qua_sdk.domain.sub_costs import SubCostTable
from qua_sdk.components.matching.lib.specials import SpecialTemplates
from qua_sdk.components.matching.runtimes.sequencer import MatchingResources
from src.core.quran_index import get_quran_index


def normalize_arabic(text: str) -> str:
    """Strips diacritics and normalizes orthography for robust sequence matching."""
    text = re.sub(r'[\u064B-\u065F\u0670\u06D6-\u06E9\u06EA-\u06ED٠-٩0-9]', '', text)
    text = re.sub(r'[إأآٱ]', 'ا', text)
    text = re.sub(r'[ىي]', 'ي', text)
    text = re.sub(r'ة', 'ه', text)
    return re.sub(r'ـ', '', text)


@lru_cache(maxsize=1)
def get_arabic_resources() -> MatchingResources:
    """Builds and caches MatchingResources (character-level N-Gram index & Quran references).

    Cached as a global singleton to avoid rebuilding 77,000+ Quranic word structures
    on every transcription pass.
    """
    q_index = get_quran_index()
    surah_words: dict[int, list[RefWord]] = defaultdict(list)

    for w in q_index.words:
        norm_text = normalize_arabic(w.text)
        surah_words[w.surah].append(RefWord(
            text=w.text,
            phonemes=list(norm_text) + [' '],
            surah=w.surah,
            ayah=w.ayah,
            word_num=w.word,
        ))

    chapter_refs = {s: _assemble(s, surah_words[s]) for s in sorted(surah_words)}

    ngram_positions = defaultdict(list)
    total_ngrams = 0

    for surah, ref in chapter_refs.items():
        verse_chars = defaultdict(list)
        for w in ref.words:
            verse_chars[w.ayah].extend(w.phonemes)

        for ayah, chars in verse_chars.items():
            if len(chars) < 10:
                continue
            for i in range(len(chars) - 9):
                ng = tuple(chars[i:i + 10])
                ngram_positions[ng].append((surah, ayah))
                total_ngrams += 1

    ngram_index = PhonemeNgramIndex(
        ngram_positions=dict(ngram_positions),
        ngram_counts={ng: len(pos) for ng, pos in ngram_positions.items()},
        ngram_size=10,
        total_ngrams=total_ngrams,
    )

    sub_table = SubCostTable(mode="arabic", default=1.0, pairs={})
    templates = SpecialTemplates(
        mode="arabic",
        special={
            "Basmala": list(normalize_arabic("بسم الله الرحمن الرحيم")) + [' '],
            "Isti'adha": list(normalize_arabic("اعوذ بالله من الشيطان الرجيم")) + [' '],
        },
        transition={"Tahmeed": list(normalize_arabic("سمع الله لمن حمده")) + [' ']},
        combined=list(normalize_arabic("اعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم")) + [' ']
    )

    return MatchingResources(
        mode="arabic",
        chapter_refs=chapter_refs,
        ngram_index=ngram_index,
        sub_table=sub_table,
        templates=templates,
    )
