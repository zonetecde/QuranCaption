"""
quran_db.py
───────────
Diacritized Quran reference database.

Bundled data: data/quran_diacritized.json
  Format: {"001001": "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ", ...}
  Keys:   SSSAAA  — 3-digit surah + 3-digit ayah, e.g. "001001"
  Source: Minshawi recitation dataset, Husary diacritized transcriptions
  Total:  6,236 ayat

Usage:
    from quran_db import QuranDB
    db = QuranDB()
    text = db.get(surah=1, ayah=1)
    # → "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ"
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_DATA_FILE = Path(__file__).parent / "data" / "quran_diacritized.json"


class QuranDB:
    def __init__(self, json_path: Optional[Path] = None):
        path = Path(json_path) if json_path else _DATA_FILE
        self._db: dict[str, str] = {}
        self._load(path)

    def _load(self, path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(
                f"Quran data not found at {path}\n"
                "Make sure data/quran_diacritized.json is present."
            )
        with open(path, encoding="utf-8") as f:
            self._db = json.load(f)
        logger.info("QuranDB loaded %d ayat from %s", len(self._db), path)

    def _key(self, surah: int, ayah: int) -> str:
        return f"{surah:03d}{ayah:03d}"

    def get(self, surah: int, ayah: int) -> Optional[str]:
        """Return diacritized text for surah:ayah, or None if not found."""
        return self._db.get(self._key(surah, ayah))

    def get_surah(self, surah: int) -> list[tuple[int, str]]:
        """Return all ayat of a surah as [(ayah_num, text), ...]."""
        prefix = f"{surah:03d}"
        return [
            (int(k[3:]), v)
            for k, v in sorted(self._db.items())
            if k.startswith(prefix)
        ]

    def search(self, fragment: str) -> list[tuple[int, int, str]]:
        """Search ayat containing a text fragment. Returns [(surah, ayah, text)]."""
        return [
            (int(k[:3]), int(k[3:]), v)
            for k, v in self._db.items()
            if fragment in v
        ]

    def __len__(self) -> int:
        return len(self._db)

    def __contains__(self, item) -> bool:
        if isinstance(item, tuple) and len(item) == 2:
            return self._key(*item) in self._db
        return item in self._db


_instance: Optional[QuranDB] = None

def get_db() -> QuranDB:
    global _instance
    if _instance is None:
        _instance = QuranDB()
    return _instance
