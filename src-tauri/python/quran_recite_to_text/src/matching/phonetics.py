"""Fixed Arabic, Tajweed, and Phonetic Linguistic Rules & Cost Functions.

Defines immutable linguistic constants and phonetic cost rules
for Arabic recitation, including Tajweed marker handling, Hamza variants,
Tashkeel classifications, and acoustic confusion lookups.
"""

from __future__ import annotations

from typing import Dict
import numpy as np

try:
    from numba import njit
except ImportError:
    def njit(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


# ═══════════════════════════════════════════════════════════════════════════════
# 1. FIXED ARABIC & TAJWEED CHARSETS (IMMUTABLE)
# ═══════════════════════════════════════════════════════════════════════════════

# Zero-cost Tajweed pause/stop marks and elongation fillers (ڇ, ۜ, ؙ, ۪, ـ)
ZERO_COST_MARKERS: frozenset[int] = frozenset({0x0686, 0x06DC, 0x0619, 0x06EA, 0x0640})

# Hamza orthographic variants (ء, آ, أ, إ, ٲ)
HAMZA_VARIANTS: frozenset[int] = frozenset({0x0621, 0x0622, 0x0623, 0x0625, 0x0672})

# Madd long vowels and Quranic superscript vowels (ا, و, ي, ۥ, ۦ)
MADD_VOWEL_CODES: frozenset[int] = frozenset({0x0627, 0x0648, 0x064A, 0x06E5, 0x06E6})

# Normalization core characters for fast phonetic search
CORE_CHARS_SET: frozenset[str] = frozenset("ءبتثجحخدذرزسشصضطظعغفقكلمنهوياۥۦ۾ںـٲ")


def normalize_phoneme_query(query: str) -> str:
    """Normalizes an Arabic phoneme string by collapsing consecutive core consonants."""
    parts: list[str] = []
    prev = ""
    for c in query:
        if c in CORE_CHARS_SET:
            if c != prev:
                parts.append(c)
                prev = c
    return "".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# 2. PHONETIC & ACOUSTIC SUBSTITUTION COST KERNEL (JIT ACCELERATED)
# ═══════════════════════════════════════════════════════════════════════════════

@njit(fastmath=True, cache=True)
def _sub_cost_fast(a: int, b: int, confusion_cost: float = 0.25) -> float:
    """Computes exact substitution cost matching Arabic Tajweed and acoustic variance."""
    if a == b:
        return 0.0
    mn, mx = (a, b) if a < b else (b, a)

    # 1. Hamza variants (cost = 0.0)
    if (a in (0x0621, 0x0622, 0x0623, 0x0625, 0x0672)) and (b in (0x0621, 0x0622, 0x0623, 0x0625, 0x0672)):
        return 0.0

    # 2. Interchangeable Quranic Glyphs (cost = 0.0)
    if (mn == 0x0645 and mx == 0x06FE) or \
       (mn == 0x0646 and mx == 0x06BA) or \
       (mn == 0x0648 and mx == 0x06E5) or \
       (mn == 0x064A and mx == 0x06E6) or \
       (mn == 0x0629 and mx == 0x0647) or \
       (mn == 0x062A and mx == 0x0629):
        return 0.0

    # 3. Model Acoustic Confusion & Tajweed Rules
    # Waqf stopping: Harakat vs Sukoon (ْ 0x0652, ۡ 0x06E1) -> cost = 0.0
    if ((a in (0x0652, 0x06E1)) and (b in (0x064E, 0x064F, 0x0650))) or \
       ((b in (0x0652, 0x06E1)) and (a in (0x064E, 0x064F, 0x0650))):
        return 0.0

    # Tajweed Tanween vs Noon Sakinah (ً 0x064B, ٌ 0x064C, ٍ 0x064D vs ن 0x0646) -> cost = 0.0
    if (a in (0x064B, 0x064C, 0x064D) and b == 0x0646) or (b in (0x064B, 0x064C, 0x064D) and a == 0x0646):
        return 0.0

    # Vowels vs Harakat & Consonants (cost = confusion_cost):
    if (mn == 0x0627 and mx == 0x064E) or \
       (mn == 0x0648 and mx == 0x064F) or \
       (mn == 0x064F and mx == 0x06E5) or \
       (mn == 0x064A and mx == 0x0650) or \
       (mn == 0x0650 and mx == 0x06E6) or \
       (mn == 0x062A and mx == 0x0637) or \
       (mn == 0x062C and mx == 0x0632) or \
       (mn == 0x062E and mx == 0x063A) or \
       (mn == 0x062F and mx == 0x0636) or \
       (mn == 0x0630 and (mx == 0x0632 or mx == 0x0638)) or \
       (mn == 0x0633 and mx == 0x0635) or \
       (mn == 0x0642 and mx == 0x0643) or \
       (mn == 0x0621 and mx == 0x0644):
        return confusion_cost

    # 4. Strict Harakat Penalty
    if (a in (0x064E, 0x064F, 0x0650)) or (b in (0x064E, 0x064F, 0x0650)):
        return 1.0

    return 1.0


@njit(cache=True)
def _fill_sub_cost_table(table: np.ndarray, confusion_cost: float) -> None:
    for a in range(0x0600, 0x0700):
        for b in range(0x0600, 0x0700):
            table[a, b] = _sub_cost_fast(a, b, confusion_cost)


_SUB_COST_TABLES: Dict[float, np.ndarray] = {}


def get_sub_cost_table(confusion_cost: float = 0.25) -> np.ndarray:
    """Returns a precomputed 2048x2048 float64 lookup table filled directly by _sub_cost_fast."""
    key = round(float(confusion_cost), 4)
    if key in _SUB_COST_TABLES:
        return _SUB_COST_TABLES[key]

    table = np.ones((2048, 2048), dtype=np.float64)
    np.fill_diagonal(table, 0.0)
    _fill_sub_cost_table(table, float(confusion_cost))

    _SUB_COST_TABLES[key] = table
    return table


# ═══════════════════════════════════════════════════════════════════════════════
# 3. JIT VECTORIZED EDIT COST EVALUATORS
# ═══════════════════════════════════════════════════════════════════════════════

@njit(fastmath=True, cache=True)
def _compute_insertion_costs_fast(
    p_codes: np.ndarray, standard_cost: float, confusion_cost: float
) -> np.ndarray:
    m = len(p_codes)
    costs = np.full(m, standard_cost, dtype=np.float64)
    for i in range(m):
        code = p_codes[i]
        if code in (0x0686, 0x06DC, 0x0619, 0x06EA, 0x0640):
            costs[i] = 0.0
        elif i > 0 and code == p_codes[i - 1]:
            if code in (0x0627, 0x0648, 0x064A, 0x06E5, 0x06E6):
                costs[i] = confusion_cost
    return costs


@njit(fastmath=True, cache=True)
def _compute_deletion_costs_fast(
    r_codes: np.ndarray, standard_cost: float, confusion_cost: float
) -> np.ndarray:
    n = len(r_codes)
    costs = np.full(n, standard_cost, dtype=np.float64)
    for j in range(n):
        code = r_codes[j]
        if code in (0x0686, 0x06DC, 0x0619, 0x06EA, 0x0640):
            costs[j] = 0.0
        elif code in (0x0621, 0x0622, 0x0623, 0x0625, 0x0672):
            costs[j] = confusion_cost
        elif j > 0 and code == r_codes[j - 1]:
            costs[j] = confusion_cost
    return costs
