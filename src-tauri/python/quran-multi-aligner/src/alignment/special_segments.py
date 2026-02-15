"""
Phoneme-based special segment detection for Basmala and Isti'adha.

These are common recitation openers that need special handling:
- Isti'adha: "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم" (I seek refuge in Allah)
- Basmala: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم" (In the name of Allah)

Detection uses phoneme edit distance for robustness against ASR errors.
"""

from __future__ import annotations

from typing import List, Tuple, Optional

# =============================================================================
# Constants
# =============================================================================

from config import MAX_SPECIAL_EDIT_DISTANCE

# Special phoneme sequences
SPECIAL_PHONEMES = {
    "Isti'adha": [
        "ʔ", "a", "ʕ", "u:", "ð", "u", "b", "i", "ll", "a:", "h", "i",
        "m", "i", "n", "a", "ʃʃ", "a", "j", "tˤ", "aˤ:", "n", "i",
        "rˤrˤ", "aˤ", "ʒ", "i:", "m"
    ],
    "Basmala": [
        "b", "i", "s", "m", "i", "ll", "a:", "h", "i", "rˤrˤ", "aˤ",
        "ħ", "m", "a:", "n", "i", "rˤrˤ", "aˤ", "ħ", "i:", "m"
    ],
}

# Combined = Isti'adha + Basmala (for detecting both in one segment)
COMBINED_PHONEMES = SPECIAL_PHONEMES["Isti'adha"] + SPECIAL_PHONEMES["Basmala"]

# Arabic text for display
SPECIAL_TEXT = {
    "Isti'adha": "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم",
    "Basmala": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم",
}


# =============================================================================
# Levenshtein Distance
# =============================================================================

def levenshtein_distance(seq1: List[str], seq2: List[str]) -> int:
    """
    Compute standard Levenshtein edit distance between two sequences.

    Args:
        seq1: First sequence (list of phonemes)
        seq2: Second sequence (list of phonemes)

    Returns:
        Edit distance (number of insertions, deletions, substitutions)
    """
    m, n = len(seq1), len(seq2)

    # Handle edge cases
    if m == 0:
        return n
    if n == 0:
        return m

    # Use two-row optimization for memory efficiency
    prev = list(range(n + 1))
    curr = [0] * (n + 1)

    for i in range(1, m + 1):
        curr[0] = i
        for j in range(1, n + 1):
            if seq1[i - 1] == seq2[j - 1]:
                curr[j] = prev[j - 1]  # No operation needed
            else:
                curr[j] = 1 + min(
                    prev[j],      # Deletion
                    curr[j - 1],  # Insertion
                    prev[j - 1],  # Substitution
                )
        prev, curr = curr, prev

    return prev[n]


def phoneme_edit_distance(asr_phonemes: List[str], ref_phonemes: List[str]) -> float:
    """
    Compute normalized edit distance between two phoneme sequences.

    Args:
        asr_phonemes: ASR output phoneme sequence
        ref_phonemes: Reference phoneme sequence

    Returns:
        Normalized edit distance (0.0 = identical, 1.0 = completely different)
    """
    if not asr_phonemes or not ref_phonemes:
        return 1.0

    edit_dist = levenshtein_distance(asr_phonemes, ref_phonemes)
    max_len = max(len(asr_phonemes), len(ref_phonemes))

    return edit_dist / max_len


# =============================================================================
# Special Segment Detection
# =============================================================================

def detect_special_segments(
    phoneme_texts: List[List[str]],
    vad_segments: List,
    segment_audios: List,
) -> Tuple[List, List, List[Tuple[str, float, str]], int]:
    """
    Detect special segments (Isti'adha/Basmala) using phoneme edit distance.

    Detection order:
    1. Try COMBINED (Isti'adha + Basmala) on segment 0 → split if match
    2. Else try Isti'adha on segment 0 → if match, try Basmala on segment 1
    3. Else try Basmala on segment 0
    4. Else no specials

    Args:
        phoneme_texts: List of phoneme lists from ASR
        vad_segments: List of VadSegment objects
        segment_audios: List of audio arrays

    Returns:
        (updated_vad_segments, updated_audios, special_results, first_quran_idx)

        special_results: List of tuples (matched_text, score, ref) for compatibility
        first_quran_idx: Index where Quran segments start (after specials)
    """
    # Import here to avoid circular imports
    from ..core.segment_types import VadSegment

    if not phoneme_texts or not vad_segments or not segment_audios:
        return vad_segments, segment_audios, [], 0

    special_results: List[Tuple[str, float, str]] = []

    # Segment 0 phonemes (already a list)
    seg0_phonemes = phoneme_texts[0] if phoneme_texts[0] else []

    # ==========================================================================
    # 1. Try COMBINED (Isti'adha + Basmala in one segment)
    # ==========================================================================
    combined_dist = phoneme_edit_distance(seg0_phonemes, COMBINED_PHONEMES)

    if combined_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[SPECIAL] Combined Isti'adha+Basmala detected (dist={combined_dist:.2f})")

        # Split segment 0 by midpoint
        seg = vad_segments[0]
        audio = segment_audios[0]
        mid_time = (seg.start_time + seg.end_time) / 2.0
        mid_sample = max(1, len(audio) // 2)

        # Create two new segments
        new_vads = [
            VadSegment(start_time=seg.start_time, end_time=mid_time, segment_idx=0),
            VadSegment(start_time=mid_time, end_time=seg.end_time, segment_idx=1),
        ]
        new_audios = [
            audio[:mid_sample],
            audio[mid_sample:],
        ]

        # Add remaining segments with reindexed segment_idx
        for i, vs in enumerate(vad_segments[1:], start=2):
            new_vads.append(VadSegment(
                start_time=vs.start_time,
                end_time=vs.end_time,
                segment_idx=i
            ))
        new_audios.extend(segment_audios[1:])

        # Special results for both (confidence = 1 - distance)
        confidence = 1.0 - combined_dist
        special_results = [
            (SPECIAL_TEXT["Isti'adha"], confidence, "Isti'adha"),
            (SPECIAL_TEXT["Basmala"], confidence, "Basmala"),
        ]

        return new_vads, new_audios, special_results, 2

    # ==========================================================================
    # 2. Try Isti'adha on segment 0
    # ==========================================================================
    istiadha_dist = phoneme_edit_distance(seg0_phonemes, SPECIAL_PHONEMES["Isti'adha"])

    if istiadha_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[SPECIAL] Isti'adha detected on segment 0 (dist={istiadha_dist:.2f})")
        special_results.append(
            (SPECIAL_TEXT["Isti'adha"], 1.0 - istiadha_dist, "Isti'adha")
        )

        # Try Basmala on segment 1
        if len(phoneme_texts) >= 2 and phoneme_texts[1]:
            seg1_phonemes = phoneme_texts[1]
            basmala_dist = phoneme_edit_distance(seg1_phonemes, SPECIAL_PHONEMES["Basmala"])

            if basmala_dist <= MAX_SPECIAL_EDIT_DISTANCE:
                print(f"[SPECIAL] Basmala detected on segment 1 (dist={basmala_dist:.2f})")
                special_results.append(
                    (SPECIAL_TEXT["Basmala"], 1.0 - basmala_dist, "Basmala")
                )
                return vad_segments, segment_audios, special_results, 2
            else:
                print(f"[SPECIAL] No Basmala on segment 1 (dist={basmala_dist:.2f})")

        return vad_segments, segment_audios, special_results, 1

    # ==========================================================================
    # 3. Try Basmala on segment 0
    # ==========================================================================
    basmala_dist = phoneme_edit_distance(seg0_phonemes, SPECIAL_PHONEMES["Basmala"])

    if basmala_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[SPECIAL] Basmala detected on segment 0 (dist={basmala_dist:.2f})")
        special_results.append(
            (SPECIAL_TEXT["Basmala"], 1.0 - basmala_dist, "Basmala")
        )
        return vad_segments, segment_audios, special_results, 1

    # ==========================================================================
    # 4. No specials detected
    # ==========================================================================
    print(f"[SPECIAL] No special segments detected "
          f"(istiadha={istiadha_dist:.2f}, basmala={basmala_dist:.2f})")

    return vad_segments, segment_audios, [], 0


def detect_inter_chapter_specials(
    phoneme_texts: List[List[str]],
) -> Tuple[List[Tuple[str, float, str]], int]:
    """
    Detect special segments between chapters (phoneme-only, no audio splitting).

    Same detection order as detect_special_segments:
    1. Try COMBINED on segment 0
    2. Else try Isti'adha on seg 0 -> if match, try Basmala on seg 1
    3. Else try Basmala on seg 0
    4. Else no specials

    Returns:
        (special_results, num_consumed)
        special_results: List of (matched_text, score, ref) tuples
        num_consumed: Number of segments consumed as specials
    """
    if not phoneme_texts or not phoneme_texts[0]:
        return [], 0

    seg0_phonemes = phoneme_texts[0]

    # 1. Try COMBINED (Isti'adha + Basmala in one segment)
    combined_dist = phoneme_edit_distance(seg0_phonemes, COMBINED_PHONEMES)
    if combined_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[INTER-CHAPTER] Combined Isti'adha+Basmala detected (dist={combined_dist:.2f})")
        combined_text = SPECIAL_TEXT["Isti'adha"] + " ۝ " + SPECIAL_TEXT["Basmala"]
        return [(combined_text, 1.0 - combined_dist, "Isti'adha+Basmala")], 1

    # 2. Try Isti'adha on segment 0
    istiadha_dist = phoneme_edit_distance(seg0_phonemes, SPECIAL_PHONEMES["Isti'adha"])
    if istiadha_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[INTER-CHAPTER] Isti'adha detected (dist={istiadha_dist:.2f})")
        results = [(SPECIAL_TEXT["Isti'adha"], 1.0 - istiadha_dist, "Isti'adha")]
        consumed = 1

        # Try Basmala on segment 1
        if len(phoneme_texts) >= 2 and phoneme_texts[1]:
            seg1_phonemes = phoneme_texts[1]
            basmala_dist = phoneme_edit_distance(seg1_phonemes, SPECIAL_PHONEMES["Basmala"])
            if basmala_dist <= MAX_SPECIAL_EDIT_DISTANCE:
                print(f"[INTER-CHAPTER] Basmala detected on next segment (dist={basmala_dist:.2f})")
                results.append((SPECIAL_TEXT["Basmala"], 1.0 - basmala_dist, "Basmala"))
                consumed = 2
            else:
                print(f"[INTER-CHAPTER] No Basmala on next segment (dist={basmala_dist:.2f})")

        return results, consumed

    # 3. Try Basmala on segment 0
    basmala_dist = phoneme_edit_distance(seg0_phonemes, SPECIAL_PHONEMES["Basmala"])
    if basmala_dist <= MAX_SPECIAL_EDIT_DISTANCE:
        print(f"[INTER-CHAPTER] Basmala detected (dist={basmala_dist:.2f})")
        return [(SPECIAL_TEXT["Basmala"], 1.0 - basmala_dist, "Basmala")], 1

    # 4. No specials
    print(f"[INTER-CHAPTER] No special segments detected "
          f"(istiadha={istiadha_dist:.2f}, basmala={basmala_dist:.2f})")
    return [], 0
