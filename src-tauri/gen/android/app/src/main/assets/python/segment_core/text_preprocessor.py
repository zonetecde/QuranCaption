"""
Text preprocessing module for Arabic Quran text normalization.

Provides Unicode-aware normalization for matching ASR output to Quranic text.
Produces a consonant skeleton for fuzzy matching.
"""

from __future__ import annotations

import re
from typing import Set

# Basic Arabic letters
ALEF = '\u0627'              # ا
ALEF_MADDA = '\u0622'        # آ
ALEF_HAMZA_ABOVE = '\u0623'  # أ
ALEF_HAMZA_BELOW = '\u0625'  # إ
ALEF_WASLA = '\u0671'        # ٱ 

WAW = '\u0648'            # و
YA = '\u064A'             # ي
ALEF_MAKSURA = '\u0649'   # ى
WAW_HAMZA = '\u0624'      # ؤ
YA_HAMZA = '\u0626'       # ئ

# Quran-specific extensions (small letters)
DAGGER_ALEF = '\u0670'    # ٰ 
MINI_WAW = '\u06E5'       # ۥ 
MINI_YA = '\u06E6'        # ۦ 
SMALL_HIGH_YEH = '\u06E7'  # ۧ

# Other
TATWEEL = '\u0640'
PARTIAL_ALEF_MAKSURA = '\u066E'

# =============================================================================
FATHA = '\u064E'          # َ
KASRA = '\u0650'          # ِ
DAMMA = '\u064F'          # ُ
SUKUN = '\u0652'          # ْ
SHADDA = '\u0651'         # ّ

# Tanween
FATHATAN = '\u064B'       # ً
KASRATAN = '\u064D'       # ٍ
DAMMATAN = '\u064C'       # ٌ

# Other diacritics
SUPERSCRIPT_ALEF = '\u0670'  # ٰ (also dagger alef)
MADDAH = '\u0653'         # ٓ
HAMZA_ABOVE = '\u0654'    # ٔ
HAMZA_BELOW = '\u0655'    # ٕ

# Standard Arabic diacritics
DIACRITICS: Set[str] = {
    FATHA, KASRA, DAMMA, SUKUN, SHADDA,
    FATHATAN, KASRATAN, DAMMATAN,
    SUPERSCRIPT_ALEF, MADDAH,
    HAMZA_ABOVE, HAMZA_BELOW,
}

# These include small letter marks, vowel signs, etc.
EXTENDED_DIACRITICS: Set[str] = {chr(c) for c in range(0x08D4, 0x0900)}
DIACRITICS = DIACRITICS | EXTENDED_DIACRITICS

# =============================================================================
STOP_SIGNS: Set[str] = {
    '\u06D6',  # ۖ - SMALL HIGH LIGATURE SAD WITH LAM WITH ALEF MAKSURA
    '\u06D7',  # ۗ - SMALL HIGH LIGATURE QAF WITH LAM WITH ALEF MAKSURA
    '\u06D8',  # ۘ - SMALL HIGH MEEM INITIAL FORM
    '\u06D9',  # ۙ - SMALL HIGH LAM ALEF
    '\u06DA',  # ۚ - SMALL HIGH JEEM
    '\u06DB',  # ۛ - SMALL HIGH THREE DOTS
    '\u06DC',  # ۜ - SMALL HIGH SEEN
    '\u06DD',  # ۝ - END OF AYAH (verse number circle)
    '\u06DE',  # ۞ - START OF RUB EL HIZB
    '\u06DF',  # ۟ - SMALL HIGH ROUNDED ZERO
    '\u06E0',  # ۠ - SMALL HIGH UPRIGHT RECTANGULAR ZERO
    '\u06E1',  # ۡ - SMALL HIGH DOTLESS HEAD OF KHAH
    '\u06E2',  # ۢ - SMALL HIGH MEEM ISOLATED FORM
    '\u06E3',  # ۣ - SMALL LOW SEEN
    '\u06E4',  # ۤ - SMALL HIGH MADDA
    '\u06E9',  # ۩ - PLACE OF SAJDAH
    '\u06EA',  # ۪ - EMPTY CENTRE LOW STOP
    '\u06EB',  # ۫ - EMPTY CENTRE HIGH STOP
    '\u06EC',  # ۬ - ROUNDED HIGH STOP WITH FILLED CENTRE
    '\u06ED',  # ۭ - SMALL LOW MEEM
}

# Symbols to remove during preprocessing
SYMBOLS_TO_REMOVE: Set[str] = {
    TATWEEL,
    PARTIAL_ALEF_MAKSURA,
    MINI_WAW,
    MINI_YA,
} | STOP_SIGNS | DIACRITICS

# Normalize Quranic orthography variants to standard forms
CHAR_REPLACEMENTS = {
    # Alef variants → standard Alef
    ALEF_WASLA: ALEF,         # ٱ → ا
    ALEF_MADDA: ALEF,         # آ → ا
    ALEF_HAMZA_ABOVE: ALEF,   # أ → ا
    ALEF_HAMZA_BELOW: ALEF,   # إ → ا

    # Extension letters → base letters
    DAGGER_ALEF: ALEF,        # ٰ → ا
    SMALL_HIGH_YEH: YA,       # ۧ → ي
}


# =============================================================================
def normalize_arabic(text: str) -> str:
    """
    Normalize Arabic text to consonant skeleton for matching.

    Steps:
    1. Apply character replacements (alef variants, extensions, etc.)
    2. Remove diacritics, stop signs, tatweel, and other symbols
    """
    result = text

    # Normalize combining hamza above/below on waw/ya to precomposed forms.
    result = result.replace(WAW + HAMZA_ABOVE, WAW_HAMZA)
    result = result.replace(WAW + HAMZA_BELOW, WAW_HAMZA)
    result = result.replace(YA + HAMZA_ABOVE, YA_HAMZA)
    result = result.replace(YA + HAMZA_BELOW, YA_HAMZA)
    # Drop dagger alef after alif maksura or waw (keep base letters as-is).
    result = result.replace(ALEF_MAKSURA + DAGGER_ALEF, ALEF_MAKSURA)
    result = result.replace(WAW + DAGGER_ALEF, WAW)

    # Step 1: Apply character replacements
    for old_char, new_char in CHAR_REPLACEMENTS.items():
        result = result.replace(old_char, new_char)

    # Step 2: Remove unwanted symbols
    result = ''.join(c for c in result if c not in SYMBOLS_TO_REMOVE)

    # Step 3: Collapse vocatives: any "يا <word>" -> "يا<word>"
    result = re.sub(r"\bيا\s+(\S+)", r"يا\1", result)

    return result.strip()


def split_words(text: str) -> list[str]:
    """Split normalized text into words."""
    return [w.strip() for w in text.split() if w.strip()]


def preprocess_for_matching(text: str) -> tuple[str, list[str]]:
    """Full preprocessing pipeline for text matching."""
    normalized = normalize_arabic(text)
    words = split_words(normalized)
    return normalized, words
