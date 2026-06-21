import json
from dataclasses import asdict
from typing import get_origin, get_args, Literal

from quran_transcript import alphabet as alph
from quran_transcript import SifaOutput

SIFAT_ATTR_TO_ARABIC = {
    "hams": "همس",
    "jahr": "جهر",
    "shadeed": "شديد",
    "between": "بين الشدة والرخاوة",
    "rikhw": "رخو",
    "mofakham": "مفخم",
    "moraqaq": "مرقق",
    "low_mofakham": "أدنى المفخم",
    "monfateh": "منفتح",
    "motbaq": "مطبق",
    "safeer": "صفير",
    "no_safeer": "لا صفير",
    "moqalqal": "مقلقل",
    "not_moqalqal": "لا قلقلة",
    "mokarar": "مكرر",
    "not_mokarar": "لا تكرار",
    "motafashie": "متفشي",
    "not_motafashie": "لا تفشي",
    "mostateel": "مستطيل",
    "not_mostateel": "لا إستطالة",
    "maghnoon": "مغن",
    "not_maghnoon": "لا غنة",
}
SIFAT_ATTR_TO_ARABIC = {k: f"[{v}]" for k, v in SIFAT_ATTR_TO_ARABIC.items()}

PAD_TOKEN = "[PAD]"
PAD_TOKEN_IDX = 0


def build_quran_phoneme_script_vocab(path: str):
    level_to_token_to_idx = {}
    # Phonemes level
    phonemes = list(asdict(alph.phonetics).values())
    level_to_token_to_idx["phonemes"] = {PAD_TOKEN: PAD_TOKEN_IDX}
    idx = 0
    for p in phonemes:
        if idx == PAD_TOKEN_IDX:
            idx += 1
        level_to_token_to_idx["phonemes"][p] = idx
        idx += 1

    for field_name, fieldinfo in SifaOutput.model_fields.items():
        if get_origin(fieldinfo.annotation) == Literal:
            level = field_name
            phonemes = get_args(fieldinfo.annotation)
            phonemes = [SIFAT_ATTR_TO_ARABIC[p] for p in phonemes]
            level_to_token_to_idx[level] = {PAD_TOKEN: PAD_TOKEN_IDX}
            idx = 0
            for p in phonemes:
                if idx == PAD_TOKEN_IDX:
                    idx += 1
                level_to_token_to_idx[level][p] = idx
                idx += 1

    with open(path, "w+", encoding="utf-8") as f:
        json.dump(level_to_token_to_idx, f, ensure_ascii=False, indent=2)
