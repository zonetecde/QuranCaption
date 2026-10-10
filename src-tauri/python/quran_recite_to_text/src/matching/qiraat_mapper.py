"""QiraatAyahMapper: Canonical Cross-qiraat Verse Translation & Alignment Engine.

Translates Hafs (Kufi: 6,236 Ayahs) recitation coordinates into any of the 6 canonical
verse-counting traditions (مدارس عد الآي) and 20 Rawis, supporting verse renumbering,
verse splits (e.g. Al-Fatiha 6 & 7 in Madani), and verse merges (e.g. Al-Baqarah 1).

Zero-overhead, zero-mutation identity bypass for standard Hafs ('an 'Asim).
"""

from __future__ import annotations

import os
import copy
import json
import logging
from pathlib import Path
from collections import defaultdict
from typing import Optional, List, Dict, Any, Tuple

from src.models import QuranSegment, QuranWord, AyahSubSegment

logger = logging.getLogger(__name__)

# Base path for mapping tables
_CURRENT_DIR = Path(__file__).resolve().parent
DEFAULT_MAPPINGS_DIR = _CURRENT_DIR.parent.parent / "data" / "mappings"
DEFAULT_SURAH_INFO_PATH = _CURRENT_DIR.parent.parent / "data" / "surah_info.json"


class QuranCountingSystem:
    """Supported canonical Quranic verse-numbering traditions (مدارس عد الآي)."""
    KUFI = "kufi"                  # الكوفي (6,236 verses) - Hafs, Shu'bah, Hamza, Al-Kisa'i, Khalaf
    MADANI_LAST = "madani-last"    # المدني الأخير (6,214 verses) - Warsh, Qalun
    MADANI_FIRST = "madani-first"  # المدني الأول (6,214 verses) - Abu Ja'far (Ibn Wardan, Ibn Jammaz)
    MAKKI = "makki"                # المكي (6,219 verses) - Ibn Kathir (Al-Bazzi, Qunbul)
    BASRI = "basri"                # البصري (6,204 verses) - Abu 'Amr (Al-Duri, Al-Susi), Ya'qub
    DIMASHQI = "dimashqi"          # الدمشقي / الشامي (6,226 verses) - Ibn 'Amir (Hisham, Ibn Dhakwan)

    TOTAL_AYAHS: Dict[str, int] = {
        KUFI: 6236,
        MADANI_LAST: 6214,
        MADANI_FIRST: 6214,
        MAKKI: 6219,
        BASRI: 6204,
        DIMASHQI: 6226,
    }


# Canonical registry mapping Rawi identifier to (CountingSystem, MappingFilePrefix)
RAWI_REGISTRY: Dict[str, Tuple[str, str]] = {
    # ── 1. Kufi (Identity - no mapping table needed, 1:1 with reference) ──
    "hafs": (QuranCountingSystem.KUFI, "hafs"),
    "shubah": (QuranCountingSystem.KUFI, "hafs"),
    "shuba": (QuranCountingSystem.KUFI, "hafs"),
    "asim": (QuranCountingSystem.KUFI, "hafs"),
    "hamza": (QuranCountingSystem.KUFI, "hafs"),
    "khalaf": (QuranCountingSystem.KUFI, "hafs"),
    "khallad": (QuranCountingSystem.KUFI, "hafs"),
    "kisai": (QuranCountingSystem.KUFI, "hafs"),
    "abu_al_harith": (QuranCountingSystem.KUFI, "hafs"),
    "duri_kisai": (QuranCountingSystem.KUFI, "hafs"),
    "ishaq": (QuranCountingSystem.KUFI, "hafs"),
    "idris": (QuranCountingSystem.KUFI, "hafs"),
    "khalaf_al_ashir": (QuranCountingSystem.KUFI, "hafs"),

    # ── 2. Nafi' (Madani Last) ──
    "warsh": (QuranCountingSystem.MADANI_LAST, "warsh-to-hafs"),
    "qaloon": (QuranCountingSystem.MADANI_LAST, "qaloon-to-hafs"),
    "qalun": (QuranCountingSystem.MADANI_LAST, "qalun-to-hafs"),
    "nafi": (QuranCountingSystem.MADANI_LAST, "warsh-to-hafs"),

    # ── 3. Abu Ja'far (Madani First) ──
    "ibn_wardan": (QuranCountingSystem.MADANI_FIRST, "madani-first-to-hafs"),
    "wardan": (QuranCountingSystem.MADANI_FIRST, "madani-first-to-hafs"),
    "ibn_jammaz": (QuranCountingSystem.MADANI_FIRST, "madani-first-to-hafs"),
    "jammaz": (QuranCountingSystem.MADANI_FIRST, "madani-first-to-hafs"),
    "abu_jafar": (QuranCountingSystem.MADANI_FIRST, "madani-first-to-hafs"),

    # ── 4. Ibn Kathir (Makki) ──
    "bazzi": (QuranCountingSystem.MAKKI, "bazzi-to-hafs"),
    "qunbul": (QuranCountingSystem.MAKKI, "qunbul-to-hafs"),
    "ibn_kathir": (QuranCountingSystem.MAKKI, "bazzi-to-hafs"),

    # ── 5. Abu 'Amr & Ya'qub (Basri) ──
    "duri": (QuranCountingSystem.BASRI, "duri-to-hafs"),
    "duri_abu_amr": (QuranCountingSystem.BASRI, "duri-to-hafs"),
    "susi": (QuranCountingSystem.BASRI, "susi-to-hafs"),
    "abu_amr": (QuranCountingSystem.BASRI, "duri-to-hafs"),
    "ruways": (QuranCountingSystem.BASRI, "duri-to-hafs"),
    "rawh": (QuranCountingSystem.BASRI, "duri-to-hafs"),
    "yaqub": (QuranCountingSystem.BASRI, "duri-to-hafs"),

    # ── 6. Ibn 'Amir (Dimashqi) ──
    "hisham": (QuranCountingSystem.DIMASHQI, "dimashqi-to-hafs"),
    "ibn_dhakwan": (QuranCountingSystem.DIMASHQI, "dimashqi-to-hafs"),
    "dhakwan": (QuranCountingSystem.DIMASHQI, "dimashqi-to-hafs"),
    "ibn_amir": (QuranCountingSystem.DIMASHQI, "dimashqi-to-hafs"),
}

# Arabic name alias resolution
ARABIC_ALIASES: Dict[str, str] = {
    "حفص": "hafs",
    "حفص عن عاصم": "hafs",
    "عاصم": "hafs",
    "شعبة": "shubah",
    "ورش": "warsh",
    "ورش عن نافع": "warsh",
    "نافع": "warsh",
    "قالون": "qaloon",
    "قالون عن نافع": "qaloon",
    "الدوري": "duri",
    "الدوري عن أبي عمرو": "duri",
    "أبو عمرو": "duri",
    "السوسي": "susi",
    "السوسي عن أبي عمرو": "susi",
    "البزي": "bazzi",
    "البزي عن ابن كثير": "bazzi",
    "ابن كثير": "bazzi",
    "قنبل": "qunbul",
    "قنبل عن ابن كثير": "qunbul",
    "هشام": "hisham",
    "هشام عن ابن عامر": "hisham",
    "ابن عامر": "hisham",
    "ابن ذكوان": "ibn_dhakwan",
    "ابن وردان": "ibn_wardan",
    "أبو جعفر": "ibn_wardan",
    "ابن جماز": "ibn_jammaz",
    "رويس": "ruways",
    "يعقوب": "ruways",
    "روح": "rawh",
    "حمزة": "hafs",
    "خلف": "hafs",
    "خلاد": "hafs",
    "الكسائي": "hafs",
}


def normalize_qiraat_name(name: str) -> str:
    """Normalizes any qiraat identifier (English or Arabic) into a canonical key."""
    if not name:
        return "hafs"
    raw = name.strip()
    if raw in ARABIC_ALIASES:
        return ARABIC_ALIASES[raw]
    for k, v in ARABIC_ALIASES.items():
        if k in raw:
            return v
    clean = raw.lower().replace("-", "_").replace("'", "").replace(" ", "_")
    if clean in RAWI_REGISTRY:
        return clean
    for k in RAWI_REGISTRY:
        if k in clean:
            return k
    return "hafs"


class QiraatAyahMapper:
    """Translates Hafs (Kufi) verse coordinates to any canonical counting tradition and Rawi."""

    _cache: Dict[str, QiraatAyahMapper] = {}

    def __init__(
        self,
        qiraat: str = "hafs",
        system: str = QuranCountingSystem.KUFI,
        mapping_data: Optional[Dict[str, Any]] = None,
    ):
        self.qiraat = qiraat
        self.system = system
        self.counting_system = system
        self.is_identity = (system == QuranCountingSystem.KUFI)
        self._data = mapping_data

        # Indexed translation maps
        self.source_counts: Dict[int, int] = {}
        self.hafs_counts: Dict[int, int] = {}
        self.source_to_hafs: Dict[int, Dict[int, List[int]]] = defaultdict(dict)
        self.hafs_to_source: Dict[int, Dict[int, List[int]]] = defaultdict(lambda: defaultdict(list))
        self.status_map: Dict[int, Dict[int, str]] = defaultdict(dict)
        self.hafs_word_counts: Dict[Tuple[int, int], int] = {}
        self.hafs_to_target_offset: Dict[Tuple[int, int], int] = {}
        self.hafs_to_target_ayah: Dict[Tuple[int, int], int] = {}

        if self._data and not self.is_identity:
            self._init_data()

    def _init_data(self) -> None:
        if DEFAULT_SURAH_INFO_PATH.exists():
            try:
                with open(DEFAULT_SURAH_INFO_PATH, "r", encoding="utf-8") as fp:
                    s_info = json.load(fp)
                for s_str, s_obj in s_info.items():
                    s_num = int(s_str)
                    for v_obj in s_obj.get("verses", []):
                        self.hafs_word_counts[(s_num, v_obj.get("verse", 0))] = v_obj.get("num_words", 0)
            except Exception as e:
                logger.warning(f"Could not load surah_info.json for word offsets: {e}")

        surahs = self._data.get("surahs", {})
        for s_str, s_data in surahs.items():
            s = int(s_str)
            self.source_counts[s] = s_data.get("source_ayah_count", 0)
            self.hafs_counts[s] = s_data.get("hafs_ayah_count", 0)

            for src_a_str, a_data in s_data.get("ayahs", {}).items():
                src_a = int(src_a_str)
                status = a_data.get("status", "mapped")
                self.status_map[s][src_a] = status

                h_list: List[int] = []
                if "hafs_ayahs" in a_data:
                    h_list = [int(x) for x in a_data["hafs_ayahs"]]
                elif "hafs_ayah" in a_data:
                    h_list = [int(a_data["hafs_ayah"])]

                self.source_to_hafs[s][src_a] = h_list
                for idx, h in enumerate(h_list):
                    self.hafs_to_source[s][h].append(src_a)
                    if (s, h) not in self.hafs_to_target_ayah:
                        self.hafs_to_target_ayah[(s, h)] = src_a
                        # Offset inside target ayah equals sum of words in preceding Hafs ayahs
                        offset = sum(self.hafs_word_counts.get((s, prev_h), 0) for prev_h in h_list[:idx])
                        self.hafs_to_target_offset[(s, h)] = offset

    @classmethod
    def load(cls, qiraat: str = "hafs", mappings_dir: Optional[Path | str] = None) -> QiraatAyahMapper:
        """Loads and caches the mapper instance for the requested qiraat."""
        norm_key = normalize_qiraat_name(qiraat)
        if norm_key in cls._cache:
            return cls._cache[norm_key]

        reg_info = RAWI_REGISTRY.get(norm_key, (QuranCountingSystem.KUFI, "hafs"))
        system, file_prefix = reg_info

        # Kufi identity bypass: immediate return without loading any files
        if system == QuranCountingSystem.KUFI:
            inst = cls(qiraat=norm_key, system=QuranCountingSystem.KUFI)
            cls._cache[norm_key] = inst
            return inst

        mdir = Path(mappings_dir) if mappings_dir else DEFAULT_MAPPINGS_DIR
        json_file = mdir / f"{file_prefix}.json"
        if not json_file.exists():
            cand = mdir / f"{file_prefix.replace('-to-hafs', '')}-to-hafs.json"
            if cand.exists():
                json_file = cand

        if not json_file.exists():
            raise FileNotFoundError(
                f"Mapping file for qiraat '{norm_key}' not found at: {json_file}. "
                f"Please ensure mapping JSON fixtures are placed in: {mdir}"
            )

        with open(json_file, "r", encoding="utf-8") as fp:
            data = json.load(fp)

        inst = cls(qiraat=norm_key, system=system, mapping_data=data)
        cls._cache[norm_key] = inst
        return inst

    def get_hafs_ayahs(self, surah: int, source_ayah: int) -> List[int]:
        """Returns the Hafs Ayah number(s) corresponding to a source qiraat Ayah."""
        if self.is_identity:
            return [source_ayah]
        return self.source_to_hafs.get(surah, {}).get(source_ayah, [source_ayah])

    def get_source_ayahs(self, surah: int, hafs_ayah: int) -> List[int]:
        """Returns the source qiraat Ayah number(s) corresponding to a Hafs Ayah."""
        if self.is_identity:
            return [hafs_ayah]
        return self.hafs_to_source.get(surah, {}).get(hafs_ayah, [hafs_ayah])

    def get_primary_source_ayah(self, surah: int, hafs_ayah: int) -> int:
        """Returns the primary source Ayah number for a given Hafs Ayah."""
        if self.is_identity:
            return hafs_ayah
        s_list = self.get_source_ayahs(surah, hafs_ayah)
        return s_list[0] if s_list else hafs_ayah

    def get_source_ayah_count(self, surah: int) -> int:
        """Returns total verse count for a surah in this qiraat's tradition."""
        if self.is_identity:
            return self.hafs_counts.get(surah, 0)
        return self.source_counts.get(surah, 0)

    def remap_segments(self, segments: List[QuranSegment]) -> List[QuranSegment]:
        """Translates a list of QuranSegments from Hafs coordinates to target qiraat coordinates.

        For Hafs: Immediately returns the original segments with 0 overhead and 0 modification.
        For other Riwayat:
          1. Remaps Ayah numbers according to verified counting table and calculates accurate word offsets.
          2. Handles verse splits (e.g. Al-Fatiha 6 & 7 in Madani / Basri).
          3. Merges contiguous segments that belong to the same merged target Ayah (e.g. Al-Baqarah 1 in Warsh).
          4. Updates word locations (surah:ayah:word) with cumulative word offsets so indices never collide.
        """
        if self.is_identity or not segments:
            return segments

        remapped: List[QuranSegment] = []
        for seg in segments:
            surah = seg.surah_number
            hafs_ay = seg.ayah

            # Special case: Surah 1 (Al-Fatiha) in Madani & Basri traditions
            if surah == 1 and (
                self.system in (QuranCountingSystem.MADANI_LAST, QuranCountingSystem.MADANI_FIRST, QuranCountingSystem.BASRI)
            ):
                new_segs = self._remap_fatiha_segment(seg)
                remapped.extend(new_segs)
                continue

            # Standard lookup with cumulative word offset calculation
            target_ay = self.hafs_to_target_ayah.get((surah, hafs_ay))
            offset = self.hafs_to_target_offset.get((surah, hafs_ay), 0)
            if target_ay is None:
                src_ayahs = self.get_source_ayahs(surah, hafs_ay)
                target_ay = src_ayahs[0] if src_ayahs else hafs_ay

            self._update_segment_ayah(seg, surah, target_ay, word_offset=offset)
            remapped.append(seg)

        # Merge adjacent segments that mapped to the same target Ayah (e.g. Al-Baqarah 1 in Warsh)
        merged_segs = self._merge_adjacent_same_ayah(remapped)

        # Re-number segment_number 1-based
        for idx, s in enumerate(merged_segs, 1):
            s.segment_number = idx

        return merged_segs

    def _update_segment_ayah(self, seg: QuranSegment, surah: int, target_ay: int, word_offset: int = 0) -> None:
        """Updates segment ayah and cascades accurate offset locations to all words and subsegments."""
        seg.ayah = target_ay
        if seg.words:
            for w_idx, w in enumerate(seg.words, 1):
                loc = w.location
                if loc and ":" in loc:
                    parts = loc.split(":")
                    try:
                        base_num = int(parts[2]) if len(parts) >= 3 else w_idx
                    except ValueError:
                        base_num = w_idx
                    target_w_num = base_num + word_offset
                    w.location = f"{surah}:{target_ay}:{target_w_num}"
                else:
                    w.location = f"{surah}:{target_ay}:{w_idx + word_offset}"

            w_first = seg.words[0].location.split(":")[2]
            w_last = seg.words[-1].location.split(":")[2]
            seg.matched_ref = f"{surah}:{target_ay}:{w_first}-{surah}:{target_ay}:{w_last}"
        else:
            seg.matched_ref = f"{surah}:{target_ay}:1"

        if seg.sub_segments:
            for sub in seg.sub_segments:
                if sub.words:
                    for w_idx, w in enumerate(sub.words, 1):
                        loc = w.location
                        if loc and ":" in loc:
                            parts = loc.split(":")
                            try:
                                base_num = int(parts[2]) if len(parts) >= 3 else w_idx
                            except ValueError:
                                base_num = w_idx
                            if parts[1] != str(target_ay):
                                w.location = f"{surah}:{target_ay}:{base_num + word_offset}"
                    sw_first = sub.words[0].location.split(":")[2]
                    sw_last = sub.words[-1].location.split(":")[2]
                    sub.words_range = f"{surah}:{target_ay}:{sw_first}-{surah}:{target_ay}:{sw_last}"

    def _remap_fatiha_segment(self, seg: QuranSegment) -> List[QuranSegment]:
        """Handles the canonical division of Surah Al-Fatiha in Madani / Basri traditions."""
        hafs_ay = seg.ayah
        # In Madani/Basri traditions, Basmalah (Hafs 1) is not an Ayah of Al-Fatiha; it is opening intro
        if hafs_ay == 1:
            seg.ayah = 0
            if seg.words:
                for idx, w in enumerate(seg.words, 1):
                    w.location = f"1:0:{idx}"
                seg.matched_ref = f"1:0:1-1:0:{len(seg.words)}"
            if seg.sub_segments:
                for sub in seg.sub_segments:
                    if sub.words:
                        sub.words_range = f"1:0:{sub.words[0].location.split(':')[2]}-1:0:{sub.words[-1].location.split(':')[2]}"
            return [seg]

        # Ayahs 2 to 6 map directly to Ayahs 1 to 5
        if 2 <= hafs_ay <= 6:
            target_ay = hafs_ay - 1
            self._update_segment_ayah(seg, 1, target_ay, word_offset=0)
            return [seg]

        # Hafs Ayah 7 splits into Warsh Ayah 6 and 7
        if hafs_ay == 7 and seg.words:
            words = seg.words
            if len(words) <= 4:
                # Reciter only recited the first half (صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ)
                self._update_segment_ayah(seg, 1, 6, word_offset=0)
                return [seg]
            elif all(int(getattr(w, "location", "1:7:1").split(":")[2]) > 4 for w in words):
                # Reciter only recited the second half (غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ)
                for idx, w in enumerate(words, 1):
                    w.location = f"1:7:{idx}"
                seg.ayah = 7
                seg.matched_ref = f"1:7:1-1:7:{len(words)}"
                if seg.sub_segments:
                    for sub in seg.sub_segments:
                        if sub.words:
                            sub.words_range = f"1:7:{sub.words[0].location.split(':')[2]}-1:7:{sub.words[-1].location.split(':')[2]}"
                return [seg]
            else:
                # Spans both halves: Split into two segments
                w_first = [w for w in words if int(getattr(w, "location", "1:7:1").split(":")[2]) <= 4]
                w_second = [w for w in words if int(getattr(w, "location", "1:7:5").split(":")[2]) > 4]

                res: List[QuranSegment] = []
                if w_first:
                    s1 = copy.deepcopy(seg)
                    s1.ayah = 6
                    s1.words = w_first
                    s1.start_time = w_first[0].start if w_first[0].start is not None else seg.start_time
                    s1.end_time = w_first[-1].end if w_first[-1].end is not None else seg.end_time
                    for idx, w in enumerate(w_first, 1):
                        w.location = f"1:6:{idx}"
                    s1.matched_ref = f"1:6:1-1:6:{len(w_first)}"
                    if s1.sub_segments:
                        for sub in s1.sub_segments:
                            sub.words = [w for w in sub.words if int(getattr(w, "location", "1:7:1").split(":")[2]) <= 4]
                            for idx, w in enumerate(sub.words, 1):
                                w.location = f"1:6:{idx}"
                            if sub.words:
                                sub.words_range = f"1:6:1-1:6:{len(sub.words)}"
                    res.append(s1)

                if w_second:
                    s2 = copy.deepcopy(seg)
                    s2.ayah = 7
                    s2.words = w_second
                    s2.start_time = w_second[0].start if w_second[0].start is not None else seg.start_time
                    s2.end_time = w_second[-1].end if w_second[-1].end is not None else seg.end_time
                    for idx, w in enumerate(w_second, 1):
                        w.location = f"1:7:{idx}"
                    s2.matched_ref = f"1:7:1-1:7:{len(w_second)}"
                    if s2.sub_segments:
                        for sub in s2.sub_segments:
                            sub.words = [w for w in sub.words if int(getattr(w, "location", "1:7:5").split(":")[2]) > 4]
                            for idx, w in enumerate(sub.words, 1):
                                w.location = f"1:7:{idx}"
                            if sub.words:
                                sub.words_range = f"1:7:1-1:7:{len(sub.words)}"
                    res.append(s2)

                return res if res else [seg]

        return [seg]

    def _merge_adjacent_same_ayah(self, segments: List[QuranSegment]) -> List[QuranSegment]:
        """Merges adjacent segments that belong to the same merged Ayah (e.g. Al-Baqarah 1 in Warsh)."""
        if len(segments) <= 1:
            return segments

        merged: List[QuranSegment] = []
        i = 0
        while i < len(segments):
            curr = segments[i]
            while i + 1 < len(segments) and (
                segments[i + 1].surah_number == curr.surah_number and segments[i + 1].ayah == curr.ayah
            ):
                nxt = segments[i + 1]
                curr.end_time = max(curr.end_time, nxt.end_time)
                if curr.words and nxt.words:
                    curr.words.extend(nxt.words)
                elif not curr.words and nxt.words:
                    curr.words = list(nxt.words)

                if curr.words:
                    w_first = curr.words[0].location.split(":")[2]
                    w_last = curr.words[-1].location.split(":")[2]
                    curr.matched_ref = f"{curr.surah_number}:{curr.ayah}:{w_first}-{curr.surah_number}:{curr.ayah}:{w_last}"

                if curr.sub_segments and nxt.sub_segments:
                    curr.sub_segments.extend(nxt.sub_segments)
                elif not curr.sub_segments and nxt.sub_segments:
                    curr.sub_segments = list(nxt.sub_segments)
                i += 1
            merged.append(curr)
            i += 1
        return merged
