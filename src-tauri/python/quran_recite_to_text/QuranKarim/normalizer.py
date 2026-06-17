"""
normalizer.py

Provides Arabic text normalization utilities.
Removes all diacritics (Tashkeel, Tajweed marks) and standardizes 
various character forms (e.g. Alif Madda, Alif Maqsura, Taa Marbuta)
into a common baseline text to enable robust string matching.
"""

import re

DIACRITICS_RE = re.compile(r'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DE\u06DF-\u06E4\u06E7-\u06E9\u06EA-\u06ED\u0640]')

NORM_MAP = {
    "\u0623": "\u0627", # أ -> ا
    "\u0625": "\u0627", # إ -> ا
    "\u0622": "\u0627", # آ -> ا
    "\u0671": "\u0627", # ٱ -> ا
    "\u0629": "\u0647", # ة -> ه
    "\u0649": "\u064A", # ى -> ي
}

def normalize_arabic(text: str) -> str:
    text = DIACRITICS_RE.sub('', text)
    text = ''.join(NORM_MAP.get(ch, ch) for ch in text)
    text = ' '.join(text.split())
    return text
