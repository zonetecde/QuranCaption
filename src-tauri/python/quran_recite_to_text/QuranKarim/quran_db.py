"""
quran_db.py

Provides the QuranDB class for parsing, querying, and searching the canonical 
Uthmani text. Uses Levenshtein partial ratio matching to automatically detect 
the recited Surah and Ayah range from a raw ASR transcription.
"""

import json
from pathlib import Path
from QuranKarim.normalizer import normalize_arabic
from Levenshtein import ratio

DATA_PATH = Path(__file__).parent.parent / "data" / "quran.json"

_BSM_CLEAN = normalize_arabic("بسم الله الرحمن الرحيم")

def partial_ratio(short: str, long_str: str) -> float:
    if not short or not long_str:
        return 0.0
    if len(short) > len(long_str):
        short, long_str = long_str, short
    window = len(short)
    best = 0.0
    for i in range(max(0, len(long_str) - window) + 1):
        r = ratio(short, long_str[i:i + window])
        if r > best:
            best = r
            if best == 1.0:
                break
    return best

class QuranDB:
    def __init__(self, path: Path = DATA_PATH):
        with open(path, encoding="utf-8") as f:
            self.verses = json.load(f)
            
        self._by_ref = {}
        self._by_surah = {}
        
        for v in self.verses:
            self._by_ref[f"{v['surah']}:{v['ayah']}"] = v
            self._by_surah.setdefault(v['surah'], []).append(v)
            
            # Pre-compute bismillah-stripped text for verse 1 of each surah
            if v['ayah'] == 1 and v['surah'] not in (1, 9) and v['text_clean'].startswith(_BSM_CLEAN):
                stripped = v['text_clean'][len(_BSM_CLEAN):].strip()
                v['text_clean_no_bsm'] = stripped if stripped else None
            else:
                v['text_clean_no_bsm'] = None

    @property
    def total_verses(self) -> int:
        return len(self.verses)
        
    @property
    def surah_count(self) -> int:
        return len(self._by_surah)

    def get_verse(self, surah: int, ayah: int) -> dict:
        return self._by_ref.get(f"{surah}:{ayah}")

    def get_surah(self, surah: int) -> list:
        return self._by_surah.get(surah, [])

    def get_next_verse(self, surah: int, ayah: int) -> dict:
        verses = self._by_surah.get(surah, [])
        for i, v in enumerate(verses):
            if v['ayah'] == ayah:
                if i + 1 < len(verses):
                    return verses[i + 1]
                next_surah = self._by_surah.get(surah + 1, [])
                if next_surah:
                    return next_surah[0]
                break
        return None

    def search(self, text: str, top_k: int = 5) -> list:
        text = normalize_arabic(text)
        scored = []
        for v in self.verses:
            score = ratio(text, v['text_clean'])
            v_copy = dict(v)
            v_copy['score'] = score
            scored.append(v_copy)
        scored.sort(key=lambda x: x['score'], reverse=True)
        return scored[:top_k]

    def _continuation_bonuses(self, hint: tuple) -> dict:
        bonuses = {}
        if not hint:
            return bonuses
            
        h_surah, h_ayah = hint
        nv = self._by_ref.get(f"{h_surah}:{h_ayah + 1}")
        if nv:
            bonuses[f"{h_surah}:{h_ayah + 1}"] = 0.22
            if f"{h_surah}:{h_ayah + 2}" in self._by_ref:
                bonuses[f"{h_surah}:{h_ayah + 2}"] = 0.12
            if f"{h_surah}:{h_ayah + 3}" in self._by_ref:
                bonuses[f"{h_surah}:{h_ayah + 3}"] = 0.06
        else:
            next_verses = self._by_surah.get(h_surah + 1, [])
            bonus_values = [0.22, 0.12, 0.06]
            for i in range(min(len(next_verses), 3)):
                bonuses[f"{next_verses[i]['surah']}:{next_verses[i]['ayah']}"] = bonus_values[i]
        return bonuses

    @staticmethod
    def _suffix_prefix_score(text: str, verse_text: str) -> float:
        words_t = text.split(" ")
        words_v = verse_text.split(" ")
        if len(words_t) < 2 or len(words_v) < 2:
            return 0.0
            
        best = 0.0
        max_trim = min(len(words_t) // 2, 4)
        for trim in range(1, max_trim + 1):
            suffix = " ".join(words_t[trim:])
            n = len(words_t) - trim
            prefix = " ".join(words_v[:min(n, len(words_v))])
            best = max(best, ratio(suffix, prefix))
        return best

    def match_verse(self, text: str, threshold: float = 0.3, max_span: int = 3, hint: tuple = None, return_top_k: int = 0) -> dict:
        text = normalize_arabic(text)
        if not text.strip():
            return None
            
        bonuses = self._continuation_bonuses(hint)
        
        scored = []
        for v in self.verses:
            raw = ratio(text, v['text_clean'])
            if v['text_clean_no_bsm']:
                raw = max(raw, ratio(text, v['text_clean_no_bsm']))
                
            bonus = bonuses.get(f"{v['surah']}:{v['ayah']}", 0.0)
            if bonus > 0:
                sp = self._suffix_prefix_score(text, v['text_clean'])
                raw = max(raw, sp)
                
            total = min(raw + bonus, 1.0)
            scored.append((v, raw, bonus, total))
            
        scored.sort(key=lambda x: x[3], reverse=True)
        
        best_v, best_raw, best_bonus, best_score_init = scored[0]
        best_score = best_score_init
        best = dict(best_v)
        best.update({
            "score": best_score,
            "raw_score": best_raw,
            "bonus": best_bonus
        })
        
        top_singles = []
        for v, raw, bon, total in scored[:max(return_top_k, 5)]:
            top_singles.append({
                "surah": v['surah'],
                "ayah": v['ayah'],
                "raw_score": round(raw, 3),
                "bonus": round(bon, 3),
                "score": round(total, 3),
                "text_clean": v['text_clean'][:60]
            })
            
        seen_surahs = set()
        for idx in range(min(len(scored), 20)):
            v = scored[idx][0]
            s = v['surah']
            if s in seen_surahs:
                continue
            seen_surahs.add(s)
            
            verses = self._by_surah[s]
            for i in range(len(verses)):
                for span in range(2, max_span + 1):
                    if i + span > len(verses):
                        break
                    chunk = verses[i:i + span]
                    first_text = chunk[0]['text_clean_no_bsm'] if chunk[0]['text_clean_no_bsm'] else chunk[0]['text_clean']
                    combined = first_text + " " + " ".join(c['text_clean'] for c in chunk[1:])
                    
                    raw = ratio(text, combined)
                    bonus = bonuses.get(f"{chunk[0]['surah']}:{chunk[0]['ayah']}", 0.0)
                    score = min(raw + bonus, 1.0)
                    
                    if score > best_score:
                        best_score = score
                        best = {
                            "surah": s,
                            "ayah": chunk[0]['ayah'],
                            "ayah_end": chunk[-1]['ayah'],
                            "text": " ".join(c.get('text_uthmani', '') for c in chunk),
                            "text_clean": combined,
                            "score": score,
                            "raw_score": raw,
                            "bonus": bonus
                        }
                        best["ayahs_list"] = chunk

        if best_score >= threshold:
            if "ayahs_list" not in best:
                original_v = self._by_ref.get(f"{best['surah']}:{best['ayah']}")
                if original_v:
                    best["ayahs_list"] = [original_v]
            if return_top_k > 0:
                best['runners_up'] = top_singles[:return_top_k]
            return best
            
        return None

    def find_best_ayah_range(self, text: str) -> dict:
        text = normalize_arabic(text)
        words = text.split()
        if not words:
            return None
            
        num_words = min(25, len(words))
        start_query = " ".join(words[:num_words])
        end_query = " ".join(words[-num_words:])
        
        best_surah = None
        best_start_ayah_idx = 0
        best_start_score = -1
        
        # 1. Find Start Ayah (Scan all Ayahs across the Quran)
        for s, verses in self._by_surah.items():
            for i in range(len(verses)):
                chunk_words = []
                # First, check if we should try without Bismillah for the first ayah
                if i == 0 and verses[i].get('text_clean_no_bsm'):
                    chunk_words.extend(verses[i]['text_clean_no_bsm'].split())
                    start_idx_for_rest = 1
                else:
                    start_idx_for_rest = i
                    
                for v in verses[start_idx_for_rest:]:
                    chunk_words.extend(v['text_clean'].split())
                    if len(chunk_words) >= num_words + 10:
                        break
                
                chunk_text = " ".join(chunk_words[:num_words + 10])
                score = ratio(start_query, chunk_text)
                
                if score > best_start_score:
                    best_start_score = score
                    best_surah = s
                    best_start_ayah_idx = i
                    
        if not best_surah:
            return None
            
        # --- NEW FALLBACK FOR MUQATTA'AT ---
        MUQATTA_SURAHS = {2, 3, 7, 10, 11, 12, 13, 14, 15, 19, 20, 26, 27, 28, 29, 30, 31, 32, 36, 38, 40, 41, 42, 43, 44, 45, 46, 50, 68}
        if best_surah in MUQATTA_SURAHS and best_start_ayah_idx == 1:
            best_start_ayah_idx = 0
        # -----------------------------------
            
        # 2. Find End Ayah (Scan from Start Ayah onwards in the matched Surah)
        verses = self._by_surah[best_surah]
        best_end_ayah_idx = best_start_ayah_idx
        best_end_score = -1
        
        for i in range(best_start_ayah_idx, len(verses)):
            chunk_words = []
            for v in reversed(verses[best_start_ayah_idx:i+1]):
                # if it's the very first ayah of the surah and it has no_bsm, use that to match end query too
                if v['ayah'] == 1 and v.get('text_clean_no_bsm'):
                    chunk_words = v['text_clean_no_bsm'].split() + chunk_words
                else:
                    chunk_words = v['text_clean'].split() + chunk_words
                
                if len(chunk_words) >= num_words + 10:
                    break
            
            chunk_text = " ".join(chunk_words[-(num_words + 10):])
            score = ratio(end_query, chunk_text)
            
            if score > best_end_score:
                best_end_score = score
                best_end_ayah_idx = i
                
        # 3. Build and return the result
        best_span = verses[best_start_ayah_idx:best_end_ayah_idx + 1]
        span_text = " ".join(v['text_clean'] for v in best_span)
        
        return {
            "surah": best_surah,
            "ayah": best_span[0]['ayah'],
            "ayah_end": best_span[-1]['ayah'],
            "text": " ".join(c.get('text_uthmani', '') for c in best_span),
            "text_clean": span_text,
            "score": round(best_start_score, 3),
            "ayahs_list": best_span
        }

    def find_multiple_ayah_ranges(self, text: str) -> dict:
        """
        Dynamically handles multiple Surahs by processing overlapping chunks of transcription.
        Returns a combined best_match object spanning multiple Surahs.
        """
        text = normalize_arabic(text)
        words = text.split()
        if not words:
            return None
            
        chunk_size = 20
        overlap = 5
        
        collected_verses = []
        seen_keys = set()
        last_hint = None
        
        i = 0
        while i < len(words):
            chunk = " ".join(words[i:i+chunk_size])
            # High threshold to avoid false positives on short chunks
            res = self.match_verse(chunk, threshold=0.35, max_span=4, hint=last_hint)
            
            if res and "ayahs_list" in res:
                for v in res["ayahs_list"]:
                    k = f"{v['surah']}:{v['ayah']}"
                    if k not in seen_keys:
                        collected_verses.append(v)
                        seen_keys.add(k)
                last_hint = (res["ayahs_list"][-1]['surah'], res["ayahs_list"][-1]['ayah'])
            else:
                last_hint = None  # Lost the anchor
                
            i += (chunk_size - overlap)
            
        if not collected_verses:
            return None
            
        # --- FILL GAPS TO PREVENT ALIGNMENT DRIFT ---
        filled_verses = []
        for v in collected_verses:
            if filled_verses:
                last_v = filled_verses[-1]
                if v['surah'] == last_v['surah']:
                    if v['ayah'] > last_v['ayah'] + 1:
                        # Fill internal gap within the same Surah (up to 15 ayahs max to prevent massive false fills)
                        if (v['ayah'] - last_v['ayah']) <= 15:
                            for missing_ayah in range(last_v['ayah'] + 1, v['ayah']):
                                missing_v = self._by_ref.get(f"{v['surah']}:{missing_ayah}")
                                if missing_v:
                                    filled_verses.append(missing_v)
                else:
                    # Jumped to a new Surah midway through the audio. 
                    # If the first matched Ayah is near the beginning (<= 10), they almost certainly started from Ayah 1
                    # but the ASR was noisy during the transition (e.g. saying 'Allahu Akbar' or taking a deep breath).
                    if v['ayah'] > 1 and v['ayah'] <= 10: 
                        for missing_ayah in range(1, v['ayah']):
                            missing_v = self._by_ref.get(f"{v['surah']}:{missing_ayah}")
                            if missing_v:
                                filled_verses.append(missing_v)
            else:
                # First verse in the whole file. We do NOT fill backwards because they could have started anywhere!
                pass
                            
            filled_verses.append(v)
            
        collected_verses = filled_verses
        # --------------------------------------------
            
        return {
            "surah": "Multiple",
            "ayah": "Mixed",
            "ayah_end": "Mixed",
            "text": " ".join(v.get('text_uthmani', '') for v in collected_verses),
            "text_clean": " ".join(v['text_clean'] for v in collected_verses),
            "score": 1.0,
            "ayahs_list": collected_verses
        }
