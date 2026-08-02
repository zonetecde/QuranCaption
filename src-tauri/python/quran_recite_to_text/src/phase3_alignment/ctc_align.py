"""Phase 3: CTC Forced Alignment — Per-Word Timestamp Extraction."""

from __future__ import annotations
import re
from typing import Optional
import numpy as np

BLANK_ID = 1024
FRAME_RATE = 12.5
FRAME_STEP = 1.0 / FRAME_RATE

_DIAC_RE = re.compile(r'[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed]')


def _find_unmatched_affixes(transcribed_text: str, matched_text: str) -> tuple[list[str], list[str]]:
    """Finds prefix and suffix words from transcribed_text not aligned to matched_text."""
    if not transcribed_text or not matched_text:
        return [], []

    t_words = transcribed_text.split()
    m_words = matched_text.split()

    from src.phase2_matching.normalize import normalize_arabic
    t_norm = [normalize_arabic(w) for w in t_words]
    m_norm = [normalize_arabic(w) for w in m_words]

    import difflib
    sm = difflib.SequenceMatcher(None, t_norm, m_norm)
    opcodes = sm.get_opcodes()

    prefix, suffix = [], []
    if opcodes:
        tag, i1, i2, j1, j2 = opcodes[0]
        if tag == 'delete' and j1 == 0 and j2 == 0:
            prefix = t_words[i1:i2]

        tag, i1, i2, j1, j2 = opcodes[-1]
        if tag == 'delete' and j1 == len(m_norm) and j2 == len(m_norm):
            suffix = t_words[i1:i2]

    return prefix, suffix


def _map_asr_words_to_reference(
    asr_words: list[dict], ref_words: list[str]
) -> tuple[dict[int, dict], set[int]]:
    """Maps ASR words to canonical indices and returns unambiguously missing indices."""
    if not asr_words or not ref_words:
        return {}, set()

    from src.phase2_matching.normalize import normalize_arabic
    import difflib

    asr_norm = [normalize_arabic(word.get("word", "")) for word in asr_words]
    ref_norm = [normalize_arabic(word) for word in ref_words]
    mapping: dict[int, dict] = {}
    missing: set[int] = set()

    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, asr_norm, ref_norm, autojunk=False
    ).get_opcodes():
        if tag == "insert":
            missing.update(range(j1, j2))
        elif tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for asr_index, ref_index in zip(range(i1, i2), range(j1, j2)):
                mapping[ref_index] = asr_words[asr_index]

    return mapping, missing


def _strip_diacritics(text: str) -> str:
    return _DIAC_RE.sub('', text)


def _load_vocab(tokens_path: str) -> list[str]:
    vocab = []
    with open(tokens_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\r\n')
            if line:
                vocab.append(line.rsplit(' ', 1)[0])
    return vocab


def _build_char_to_id(vocab: list[str]) -> dict[str, int]:
    return {tok: idx for idx, tok in enumerate(vocab)}


def _tokenize_word(word: str, vocab: list[str], char_to_id: dict[str, int]) -> list[int]:
    plain = _strip_diacritics(word)
    if not plain:
        return []

    ids = []
    pos = 0
    first = True

    while pos < len(plain):
        best_len = 0
        best_id = -1

        for length in range(len(plain) - pos, 0, -1):
            candidate = plain[pos:pos + length]
            if first:
                tok_with_marker = '▁' + candidate
                if tok_with_marker in char_to_id:
                    best_len = length
                    best_id = char_to_id[tok_with_marker]
                    break
            if candidate in char_to_id:
                best_len = length
                best_id = char_to_id[candidate]
                break

        if best_id == -1:
            pos += 1
            continue

        ids.append(best_id)
        pos += best_len
        first = False

    return ids


def _forced_align_chunk(log_probs_np: np.ndarray, token_ids: list[int]) -> tuple[np.ndarray, np.ndarray]:
    lp = np.array(log_probs_np, dtype=np.float32)
    if lp.ndim == 3:
        lp = lp[0]
    T, V = lp.shape
    N = len(token_ids)

    if N == 0 or T < N:
        return np.zeros(T, dtype=np.int64), np.zeros(T, dtype=np.float32)

    L = 2 * N + 1
    S = np.full(L, BLANK_ID, dtype=np.int64)
    S[1::2] = token_ids

    skip_mask = np.zeros(L, dtype=bool)
    for s in range(2, L):
        if S[s] != BLANK_ID and S[s] != S[s - 2]:
            skip_mask[s] = True

    V_trellis = np.full((T, L), -np.inf, dtype=np.float32)
    B = np.zeros((T, L), dtype=np.int32)

    V_trellis[0, 0] = lp[0, BLANK_ID]
    if L > 1:
        V_trellis[0, 1] = lp[0, S[1]]

    for t in range(1, T):
        prev = V_trellis[t - 1]
        v0 = prev
        v1 = np.empty_like(prev)
        v1[0] = -np.inf
        v1[1:] = prev[:-1]

        v2 = np.empty_like(prev)
        v2[:2] = -np.inf
        v2[2:] = prev[:-2]
        v2 = np.where(skip_mask, v2, -np.inf)

        stacked = np.stack([v0, v1, v2], axis=0)
        max_v = np.max(stacked, axis=0)
        idx_max = np.argmax(stacked, axis=0)

        B[t] = idx_max
        V_trellis[t] = max_v + lp[t, S]

    curr_s = L - 1 if V_trellis[T - 1, L - 1] > V_trellis[T - 1, L - 2] else L - 2
    path = np.zeros(T, dtype=np.int64)
    scores = np.zeros(T, dtype=np.float32)

    for t in range(T - 1, -1, -1):
        path[t] = S[curr_s]
        scores[t] = lp[t, S[curr_s]]
        curr_s = curr_s - B[t, curr_s]

    return path, scores


def _frames_to_word_times(
    alignments: np.ndarray,
    scores: np.ndarray,
    token_ids: list[int],
    word_token_counts: list[int],
    chunk_start_sec: float,
    seg_start_time: float,
) -> list[dict]:
    T = len(alignments)
    N = len(token_ids)

    token_frames = [[] for _ in range(N)]
    target_idx = 0
    prev_label = BLANK_ID

    for t in range(T):
        label = alignments[t]
        if label == BLANK_ID:
            prev_label = BLANK_ID
            continue
        if label == prev_label:
            if target_idx < N:
                token_frames[target_idx].append(t)
        else:
            if target_idx < N and len(token_frames[target_idx]) > 0:
                target_idx += 1
            if target_idx < N:
                token_frames[target_idx].append(t)
            prev_label = label

    token_starts_f, token_ends_f = [], []
    for i in range(N):
        if len(token_frames[i]) == 0:
            approx = int(i * T / max(N, 1))
            token_starts_f.append(approx)
            token_ends_f.append(approx)
        else:
            token_starts_f.append(token_frames[i][0])
            token_ends_f.append(token_frames[i][-1])

    MAX_EXPAND = 2
    actual_starts_f, actual_ends_f = [], []

    for i in range(N):
        core_start, core_end = token_starts_f[i], token_ends_f[i]
        if i == 0:
            start_f = max(0, core_start - MAX_EXPAND)
        else:
            prev_end = token_ends_f[i - 1]
            gap = core_start - prev_end - 1
            start_f = core_start - min(gap // 2, MAX_EXPAND) if gap > 0 else core_start

        if i == N - 1:
            end_f = min(T - 1, core_end + MAX_EXPAND)
        else:
            next_start = token_starts_f[i + 1]
            gap = next_start - core_end - 1
            end_f = core_end + min(gap - (gap // 2), MAX_EXPAND) if gap > 0 else core_end

        actual_starts_f.append(start_f)
        actual_ends_f.append(end_f)

    word_times: list[dict] = []
    tok_offset = 0

    for count in word_token_counts:
        if tok_offset >= N:
            break
        ws_f = actual_starts_f[tok_offset]
        we_f = actual_ends_f[tok_offset + count - 1]

        abs_ws = (ws_f * FRAME_STEP) + chunk_start_sec
        abs_we = ((we_f + 1) * FRAME_STEP) + chunk_start_sec
        if abs_we < abs_ws:
            abs_ws, abs_we = abs_we, abs_ws

        rel_ws = max(0.0, abs_ws - seg_start_time)
        rel_we = max(0.0, abs_we - seg_start_time)

        word_times.append({"_start": rel_ws, "_end": rel_we})
        tok_offset += count

    return word_times


def run_ctc_alignment(
    segments: list,
    stage_metrics: dict,
    vocab_path: str,
) -> None:
    """Fills seg.words for every segment using CTC forced alignment."""
    vocab = _load_vocab(vocab_path)
    char_to_id = _build_char_to_id(vocab)
    logprobs_list = stage_metrics.get("logprobs", [])
    asr_words_list = stage_metrics.get("asr_words", [])
    silence_intervals = stage_metrics.get("silence_intervals", [])

    if not logprobs_list:
        return

    n = min(len(segments), len(logprobs_list))

    for i in range(n):
        seg = segments[i]
        matched_text = seg.matched_text or ""
        transcribed_text = seg.transcribed_text or ""
        if not matched_text.strip():
            continue

        logprobs_entry = logprobs_list[i]
        if isinstance(logprobs_entry, tuple):
            logprobs_np, chunk_start_sec = logprobs_entry
        else:
            logprobs_np, chunk_start_sec = logprobs_entry, seg.start_time

        if logprobs_np is None:
            continue

        prefix_words, suffix_words = _find_unmatched_affixes(transcribed_text, matched_text)
        ref_words = matched_text.split()
        asr_words_entry = asr_words_list[i] if i < len(asr_words_list) else None
        asr_words = asr_words_entry[0] if isinstance(asr_words_entry, tuple) else asr_words_entry
        asr_word_mapping, missing_word_indices = _map_asr_words_to_reference(
            asr_words or [], ref_words
        )
        full_words = prefix_words + ref_words + suffix_words

        token_ids: list[int] = []
        word_token_counts: list[int] = []

        for word in full_words:
            ids = _tokenize_word(word, vocab, char_to_id) or [0]
            token_ids.extend(ids)
            word_token_counts.append(len(ids))

        if not token_ids:
            continue

        try:
            alignments, scores = _forced_align_chunk(logprobs_np, token_ids)
        except Exception:
            continue

        full_word_times = _frames_to_word_times(
            alignments, scores, token_ids, word_token_counts, chunk_start_sec, seg.start_time
        )
        start_idx = len(prefix_words)
        end_idx = len(prefix_words) + len(ref_words)

        word_times = full_word_times[start_idx:end_idx]
        while len(word_times) < len(ref_words):
            word_times.append({"_start": None, "_end": None})

        existing_locs: list[Optional[str]] = [w.get("location") for w in seg.words] if seg.words else []

        if not any(existing_locs):
            from qua_sdk.domain import SPECIAL_NAMES as ALL_SPECIAL_REFS
            if seg.matched_ref in ALL_SPECIAL_REFS:
                existing_locs = [f"0:0:{k+1}" for k in range(len(ref_words))]

        if not any(existing_locs) and seg.matched_ref and ":" in seg.matched_ref and "+" not in seg.matched_ref:
            from src.core.quran_index import get_quran_index
            from qua_sdk.domain import SPECIAL_TEXT, SPECIAL_NAMES as ALL_SPECIAL_REFS
            qi = get_quran_index()

            prefix_locs = []
            if seg.matched_ref not in ALL_SPECIAL_REFS and seg.matched_text:
                _BASMALA_TEXT = SPECIAL_TEXT["Basmala"]
                _ISTIATHA_TEXT = SPECIAL_TEXT["Isti'adha"]
                _COMBINED_TEXT = _ISTIATHA_TEXT + " ۝ " + _BASMALA_TEXT
                if seg.matched_text.startswith(_COMBINED_TEXT):
                    prefix_locs = [f"0:0:{k+1}" for k in range(len(_COMBINED_TEXT.split()))]
                elif seg.matched_text.startswith(_ISTIATHA_TEXT):
                    prefix_locs = [f"0:0:{k+1}" for k in range(len(_ISTIATHA_TEXT.split()))]
                elif seg.matched_text.startswith(_BASMALA_TEXT):
                    prefix_locs = [f"0:0:{k+1}" for k in range(len(_BASMALA_TEXT.split()))]

            def _get_locs(ref_from, ref_to):
                indices = qi.ref_to_indices(f"{ref_from}-{ref_to}")
                if not indices:
                    return []
                s, e = indices
                return [f"{qi.words[gi].surah}:{qi.words[gi].ayah}:{qi.words[gi].word}" for gi in range(s, e + 1)]

            if seg.wrap_word_ranges:
                parts = seg.matched_ref.split("-")
                ref_from, ref_to = parts[0], parts[1] if len(parts) > 1 else parts[0]
                sections = []
                if len(seg.wrap_word_ranges[0]) >= 3:
                    sections.append([ref_from, seg.wrap_word_ranges[0][1]])
                    for wr in seg.wrap_word_ranges:
                        sections.append([wr[0], wr[2]])
                else:
                    sections.append([ref_from, seg.wrap_word_ranges[0][1]])
                    for i_wr in range(len(seg.wrap_word_ranges) - 1):
                        sections.append([seg.wrap_word_ranges[i_wr][0], seg.wrap_word_ranges[i_wr + 1][1]])
                    sections.append([seg.wrap_word_ranges[-1][0], ref_to])

                seq_locs = []
                for s_ref, e_ref in sections:
                    seq_locs.extend(_get_locs(s_ref, e_ref))

                q_idx = 0
                aligned_locs = list(prefix_locs)
                for w in ref_words[len(prefix_locs):]:
                    if w in ["۞", "۩"] or w.startswith("۞") or w.startswith("۩"):
                        aligned_locs.append(None)
                    elif q_idx < len(seq_locs):
                        aligned_locs.append(seq_locs[q_idx])
                        q_idx += 1
                    else:
                        aligned_locs.append(None)
                existing_locs = aligned_locs
            else:
                indices = qi.ref_to_indices(seg.matched_ref)
                if indices:
                    s, e = indices
                    seq_locs = [f"{qi.words[gi].surah}:{qi.words[gi].ayah}:{qi.words[gi].word}" for gi in range(s, e + 1)]
                    q_idx = 0
                    aligned_locs = list(prefix_locs)
                    for w in ref_words[len(prefix_locs):]:
                        if w in ["۞", "۩"] or w.startswith("۞") or w.startswith("۩"):
                            aligned_locs.append(None)
                        elif q_idx < len(seq_locs):
                            aligned_locs.append(seq_locs[q_idx])
                            q_idx += 1
                        else:
                            aligned_locs.append(None)
                    existing_locs = aligned_locs

        while len(existing_locs) < len(ref_words):
            existing_locs.append(None)

        new_words = []
        mapped_asr_words = []
        for j, (word, wt) in enumerate(zip(ref_words, word_times)):
            if j in missing_word_indices:
                continue
            if word in ["۞", "۩"] or word.startswith("۞") or word.startswith("۩"):
                continue
            entry: dict = {"word": word}
            loc = existing_locs[j] if j < len(existing_locs) else None
            if loc:
                entry["location"] = loc
            s, e = wt.get("_start"), wt.get("_end")
            entry["start"] = round(s, 4) if s is not None else None
            entry["end"] = round(e, 4) if e is not None else None
            new_words.append(entry)
            mapped_asr_words.append(asr_word_mapping.get(j))

        seg.words = new_words
        if stage_metrics.get("multi_chapter") and new_words:
            first_asr_word = asr_word_mapping.get(0)
            prefix_duration = (
                first_asr_word["start"] - seg.start_time
                if first_asr_word
                else new_words[0].get("start")
            )
            if prefix_duration is not None and prefix_duration > 0:
                seg.start_time = round(seg.start_time + prefix_duration, 3)
                for word in new_words:
                    if word.get("start") is not None:
                        word["start"] = round(max(0.0, word["start"] - prefix_duration), 4)
                    if word.get("end") is not None:
                        word["end"] = round(max(0.0, word["end"] - prefix_duration), 4)
        seg._asr_word_gaps = [None]
        seg._acoustic_word_gaps = [None]
        for previous_asr_word, current_asr_word in zip(
            mapped_asr_words, mapped_asr_words[1:]
        ):
            if previous_asr_word and current_asr_word:
                previous_end = previous_asr_word["end"]
                current_start = current_asr_word["start"]
                seg._asr_word_gaps.append(max(0.0, current_start - previous_end))
                seg._acoustic_word_gaps.append(
                    max(
                        (
                            max(
                                0.0,
                                min(current_start, silence_end)
                                - max(previous_end, silence_start),
                            )
                            for silence_start, silence_end in silence_intervals
                        ),
                        default=0.0,
                    )
                )
            else:
                seg._asr_word_gaps.append(None)
                seg._acoustic_word_gaps.append(None)
