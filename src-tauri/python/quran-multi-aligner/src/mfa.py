import os
import gradio as gr
from config import MFA_SPACE_URL, MFA_TIMEOUT, MFA_PROGRESS_SEGMENT_RATE

# Lowercase special ref names for case-insensitive matching
_SPECIAL_REFS = {"basmala", "isti'adha", "isti'adha+basmala"}

_BASMALA_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم"
_ISTIATHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم"
_COMBINED_PREFIX = _ISTIATHA_TEXT + " ۝ " + _BASMALA_TEXT


def _mfa_upload_and_submit(refs, audio_paths):
    """Upload audio files and submit alignment batch to the MFA Space.

    Returns (event_id, headers, base_url) so the caller can yield a progress
    update before blocking on the SSE result stream.
    """
    import requests

    hf_token = os.environ.get("HF_TOKEN", "")
    headers = {}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
    print(f"[MFA_TS] HF_TOKEN={'set' if hf_token else 'NOT SET'}")

    base = MFA_SPACE_URL
    print(f"[MFA_TS] MFA base URL: {base}")

    # Upload all audio files in a single batched request
    files_payload = []
    open_handles = []
    for path in audio_paths:
        fh = open(path, "rb")
        open_handles.append(fh)
        files_payload.append(("files", (os.path.basename(path), fh, "audio/wav")))
    try:
        resp = requests.post(
            f"{base}/gradio_api/upload",
            headers=headers,
            files=files_payload,
            timeout=MFA_TIMEOUT,
        )
        resp.raise_for_status()
        uploaded_paths = resp.json()
    finally:
        for fh in open_handles:
            fh.close()

    # Build FileData objects
    file_data_list = [
        {"path": p, "meta": {"_type": "gradio.FileData"}}
        for p in uploaded_paths
    ]

    # Submit batch alignment
    submit_resp = requests.post(
        f"{base}/gradio_api/call/align_batch",
        headers={**headers, "Content-Type": "application/json"},
        json={"data": [refs, file_data_list]},
        timeout=MFA_TIMEOUT,
    )
    submit_resp.raise_for_status()
    event_id = submit_resp.json()["event_id"]
    print(f"[MFA_TS] Submitted batch, event_id={event_id}")

    return event_id, headers, base


def _mfa_wait_result(event_id, headers, base):
    """Wait for the MFA SSE stream and return parsed results list."""
    import requests
    import json

    sse_resp = requests.get(
        f"{base}/gradio_api/call/align_batch/{event_id}",
        headers=headers,
        stream=True,
        timeout=MFA_TIMEOUT,
    )
    sse_resp.raise_for_status()

    result_data = None
    for line in sse_resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            result_data = line[6:]  # strip "data: " prefix

    if result_data is None:
        raise RuntimeError("No data received from MFA align_batch SSE stream")

    parsed = json.loads(result_data)
    # Gradio wraps the return value in a list
    if isinstance(parsed, list) and len(parsed) == 1:
        parsed = parsed[0]

    if parsed.get("status") != "ok":
        raise RuntimeError(f"MFA align_batch failed: {parsed.get('error', parsed)}")

    return parsed["results"]


# ---------------------------------------------------------------------------
# Reusable helpers (shared by UI generator and API function)
# ---------------------------------------------------------------------------

def _make_ts_key(result_idx, ref, loc):
    """Build the composite key used in word/letter timestamp dicts."""
    is_special = ref.strip().lower() in _SPECIAL_REFS
    is_fused = "+" in ref
    if is_special:
        base_key = f"{ref}:{loc}"
    elif is_fused and loc.startswith("0:0:"):
        base_key = f"{ref}:{loc}"
    else:
        base_key = loc
    return f"{result_idx}:{base_key}"


def _build_mfa_ref(seg):
    """Build the MFA ref string for a single segment. Returns None to skip."""
    ref_from = seg.get("ref_from", "")
    ref_to = seg.get("ref_to", "")
    confidence = seg.get("confidence", 0)

    if not ref_from:
        ref_from = seg.get("special_type", "")
        ref_to = ref_from
    if not ref_from or confidence <= 0:
        return None

    if ref_from == ref_to:
        mfa_ref = ref_from
    else:
        mfa_ref = f"{ref_from}-{ref_to}"

    _is_special_ref = ref_from.strip().lower() in _SPECIAL_REFS
    if not _is_special_ref:
        matched_text = seg.get("matched_text", "")
        if matched_text.startswith(_COMBINED_PREFIX):
            mfa_ref = f"Isti'adha+Basmala+{mfa_ref}"
        elif matched_text.startswith(_ISTIATHA_TEXT):
            mfa_ref = f"Isti'adha+{mfa_ref}"
        elif matched_text.startswith(_BASMALA_TEXT):
            mfa_ref = f"Basmala+{mfa_ref}"

    return mfa_ref


def _build_mfa_refs(segments, segment_dir):
    """Build MFA refs and audio paths from segments.

    Returns (refs, audio_paths, seg_to_result_idx).
    """
    refs = []
    audio_paths = []
    seg_to_result_idx = {}

    for seg in segments:
        seg_idx = seg.get("segment", 0) - 1
        mfa_ref = _build_mfa_ref(seg)
        if mfa_ref is None:
            continue

        audio_path = os.path.join(segment_dir, f"seg_{seg_idx}.wav") if segment_dir else None
        if not audio_path or not os.path.exists(audio_path):
            print(f"[MFA_TS] Skipping seg {seg_idx}: audio not found at {audio_path}")
            continue

        seg_to_result_idx[seg_idx] = len(refs)
        refs.append(mfa_ref)
        audio_paths.append(audio_path)

    print(f"[MFA_TS] {len(refs)} refs to align: {refs[:5]}{'...' if len(refs) > 5 else ''}")
    return refs, audio_paths, seg_to_result_idx


def _assign_letter_groups(letters, word_location):
    """Assign group_id to letters sharing identical (start, end) timestamps."""
    if not letters:
        return []
    result = []
    group_id = 0
    prev_ts = None
    for letter in letters:
        ts = (letter.get("start"), letter.get("end"))
        if ts != prev_ts:
            group_id += 1
            prev_ts = ts
        result.append({
            "char": letter.get("char", ""),
            "start": letter.get("start"),
            "end": letter.get("end"),
            "group_id": f"{word_location}:{group_id}",
        })
    return result


def _build_timestamp_lookups(results):
    """Build timestamp lookup dicts from MFA results.

    Returns (word_timestamps, letter_timestamps, word_to_all_results).
    """
    word_timestamps = {}
    letter_timestamps = {}
    word_to_all_results = {}

    for result_idx, result in enumerate(results):
        if result.get("status") != "ok":
            print(f"[MFA_TS] Segment failed: ref={result.get('ref')} error={result.get('error')}")
            continue
        ref = result.get("ref", "")
        is_special = ref.strip().lower() in _SPECIAL_REFS
        is_fused = "+" in ref
        for word in result.get("words", []):
            loc = word.get("location", "")
            if loc:
                key = _make_ts_key(result_idx, ref, loc)
                word_timestamps[key] = (word["start"], word["end"])
                letters = word.get("letters")
                if letters:
                    letter_timestamps[key] = _assign_letter_groups(letters, loc)
                if not is_special and not (is_fused and loc.startswith("0:0:")):
                    if loc not in word_to_all_results:
                        word_to_all_results[loc] = []
                    word_to_all_results[loc].append(result_idx)

    print(f"[MFA_TS] {len(word_timestamps)} word timestamps collected, {len(letter_timestamps)} with letter-level data")
    return word_timestamps, letter_timestamps, word_to_all_results


def _build_crossword_groups(results, letter_ts_dict):
    """Build mapping of (key, letter_idx) -> cross-word group_id.

    Only checks word boundaries: last letter(s) of word N vs first
    letter(s) of word N+1.
    """
    crossword_groups = {}

    for result_idx, result in enumerate(results):
        if result.get("status") != "ok":
            continue
        ref = result.get("ref", "")
        words = result.get("words", [])

        for word_i in range(len(words) - 1):
            word_a = words[word_i]
            word_b = words[word_i + 1]

            loc_a = word_a.get("location", "")
            loc_b = word_b.get("location", "")
            if not loc_a or not loc_b:
                continue

            key_a = _make_ts_key(result_idx, ref, loc_a)
            key_b = _make_ts_key(result_idx, ref, loc_b)
            letters_a = letter_ts_dict.get(key_a, [])
            letters_b = letter_ts_dict.get(key_b, [])

            if not letters_a or not letters_b:
                continue

            for idx_a in range(len(letters_a) - 1, max(len(letters_a) - 3, -1), -1):
                letter_a = letters_a[idx_a]
                if letter_a.get("start") is None or letter_a.get("end") is None:
                    continue
                for idx_b in range(min(3, len(letters_b))):
                    letter_b = letters_b[idx_b]
                    if letter_b.get("start") is None or letter_b.get("end") is None:
                        continue
                    if letter_a["start"] == letter_b["start"] and letter_a["end"] == letter_b["end"]:
                        group_id = f"xword-{result_idx}-{word_i}"
                        crossword_groups[(key_a, idx_a)] = group_id
                        crossword_groups[(key_b, idx_b)] = group_id

    if crossword_groups:
        print(f"[MFA_TS] Found {len(crossword_groups)} cross-word overlapping letters")

    return crossword_groups


def _reconstruct_ref_key(seg):
    """Reconstruct the MFA ref key for a segment (for result matching)."""
    ref_from = seg.get("ref_from", "")
    ref_to = seg.get("ref_to", "")
    if not ref_from:
        ref_from = seg.get("special_type", "")
        ref_to = ref_from
    ref_key = f"{ref_from}-{ref_to}" if ref_from != ref_to else ref_from
    is_special = ref_from.strip().lower() in _SPECIAL_REFS
    if not is_special:
        matched_text = seg.get("matched_text", "")
        if matched_text.startswith(_COMBINED_PREFIX):
            ref_key = f"Isti'adha+Basmala+{ref_key}"
        elif matched_text.startswith(_ISTIATHA_TEXT):
            ref_key = f"Isti'adha+{ref_key}"
        elif matched_text.startswith(_BASMALA_TEXT):
            ref_key = f"Basmala+{ref_key}"
    return ref_key


def _extend_word_timestamps(word_timestamps, segments, seg_to_result_idx,
                             results, segment_dir):
    """Extend word ends to fill gaps between consecutive words.

    Mutates word_timestamps in place.
    """
    import wave
    for seg in segments:
        ref_from = seg.get("ref_from", "")
        confidence = seg.get("confidence", 0)
        if not ref_from:
            ref_from = seg.get("special_type", "")
        if not ref_from or confidence <= 0:
            continue
        seg_idx = seg.get("segment", 0) - 1
        result_idx = seg_to_result_idx.get(seg_idx)
        if result_idx is None:
            continue
        ref_key = _reconstruct_ref_key(seg)
        seg_word_locs = []
        for result in results:
            if result.get("ref") == ref_key and result.get("status") == "ok":
                for w in result.get("words", []):
                    loc = w.get("location", "")
                    if loc:
                        key = _make_ts_key(result_idx, ref_key, loc)
                        if key in word_timestamps:
                            seg_word_locs.append(key)
                break
        if not seg_word_locs:
            continue
        # Extend each word's end to the next word's start
        for i in range(len(seg_word_locs) - 1):
            cur_start, cur_end = word_timestamps[seg_word_locs[i]]
            nxt_start, _ = word_timestamps[seg_word_locs[i + 1]]
            if nxt_start > cur_end:
                word_timestamps[seg_word_locs[i]] = (cur_start, nxt_start)
        # Extend first word back to time 0 so highlight starts immediately
        first_loc = seg_word_locs[0]
        first_start, first_end = word_timestamps[first_loc]
        if first_start > 0:
            word_timestamps[first_loc] = (0, first_end)
        # Extend last word to segment audio duration
        last_loc = seg_word_locs[-1]
        last_start, last_end = word_timestamps[last_loc]
        audio_path = os.path.join(segment_dir, f"seg_{seg_idx}.wav") if segment_dir else None
        if audio_path and os.path.exists(audio_path):
            with wave.open(audio_path, 'rb') as wf:
                seg_duration = wf.getnframes() / wf.getframerate()
            if seg_duration > last_end:
                word_timestamps[last_loc] = (last_start, seg_duration)

    print(f"[MFA_TS] Post-processed timestamps: extended word ends to fill gaps")


def _build_enriched_json(segments, results, seg_to_result_idx,
                          word_timestamps, letter_timestamps, granularity,
                          *, minimal=False):
    """Build enriched segments with word (and optionally letter) timestamps.

    When *minimal* is True (API path), each segment only contains
    ``segment`` number + ``words`` array.  When False (UI path), all
    original segment fields are preserved.

    Returns dict with "segments" key.
    """
    from src.core.quran_index import get_quran_index
    index = get_quran_index()
    include_letters = (granularity == "words+chars")

    def _get_word_text(location):
        if not location or location.startswith("0:0:"):
            return ""
        try:
            parts = location.split(":")
            if len(parts) >= 3:
                key = (int(parts[0]), int(parts[1]), int(parts[2]))
                idx = index.word_lookup.get(key)
                if idx is not None:
                    return index.words[idx].display_text
        except (ValueError, IndexError):
            pass
        return ""

    enriched_segments = []
    for seg in segments:
        seg_idx = seg.get("segment", 0) - 1
        result_idx = seg_to_result_idx.get(seg_idx)

        if minimal:
            segment_data = {"segment": seg.get("segment", 0)}
        else:
            segment_data = dict(seg)

        if result_idx is not None:
            _ref = seg.get("ref_from", "") or seg.get("special_type", "")
            is_special = _ref.lower() in _SPECIAL_REFS
            special_words = seg.get("matched_text", "").replace(" \u06dd ", " ").split() if is_special else []

            for i, result in enumerate(results):
                if i != result_idx or result.get("status") != "ok":
                    continue
                words_with_ts = []
                for word_idx, word in enumerate(result.get("words", [])):
                    if word.get("start") is None or word.get("end") is None:
                        continue

                    location = word.get("location", "")

                    if minimal:
                        # API: compact — [location, start, end] or [location, start, end, letters]
                        word_entry = [location, round(word["start"], 4), round(word["end"], 4)]
                        if include_letters and word.get("letters"):
                            word_entry.append([
                                [lt.get("char", ""), round(lt["start"], 4), round(lt["end"], 4)]
                                for lt in word.get("letters", [])
                                if lt.get("start") is not None
                            ])
                        words_with_ts.append(word_entry)
                    else:
                        # UI: keyed objects with display text
                        if is_special or location.startswith("0:0:"):
                            word_text = special_words[word_idx] if word_idx < len(special_words) else ""
                        else:
                            word_text = _get_word_text(location)

                        word_data = {
                            "word": word_text,
                            "location": location,
                            "start": round(word["start"], 4),
                            "end": round(word["end"], 4),
                        }
                        if include_letters and word.get("letters"):
                            word_data["letters"] = [
                                {
                                    "char": lt.get("char", ""),
                                    "start": round(lt["start"], 4),
                                    "end": round(lt["end"], 4),
                                }
                                for lt in word.get("letters", [])
                                if lt.get("start") is not None
                            ]
                        words_with_ts.append(word_data)

                if words_with_ts:
                    segment_data["words"] = words_with_ts
                break

        enriched_segments.append(segment_data)

    return {"segments": enriched_segments}


# ---------------------------------------------------------------------------
# Synchronous API function
# ---------------------------------------------------------------------------

def compute_mfa_timestamps_api(segments, segment_dir, granularity="words"):
    """Run MFA forced alignment and return enriched segments (no UI/HTML).

    Args:
        segments: List of segment dicts (same format as alignment response).
        segment_dir: Path to directory containing per-segment WAV files.
        granularity: "words" or "words+chars".

    Returns:
        Dict with "segments" key containing enriched segment data.
    """
    if not granularity or granularity not in ("words", "words+chars"):
        granularity = "words"

    refs, audio_paths, seg_to_result_idx = _build_mfa_refs(segments, segment_dir)
    if not refs:
        return {"segments": segments}

    event_id, headers, base = _mfa_upload_and_submit(refs, audio_paths)
    results = _mfa_wait_result(event_id, headers, base)
    print(f"[MFA_TS] Got {len(results)} results from MFA API")

    word_ts, letter_ts, _ = _build_timestamp_lookups(results)
    _build_crossword_groups(results, letter_ts)
    _extend_word_timestamps(word_ts, segments, seg_to_result_idx, results, segment_dir)
    return _build_enriched_json(segments, results, seg_to_result_idx,
                                word_ts, letter_ts, granularity, minimal=True)


# ---------------------------------------------------------------------------
# UI progress bar
# ---------------------------------------------------------------------------

def _ts_progress_bar_html(total_segments, rate, animated=True):
    """Return HTML for a progress bar showing Segment x/N.

    When *animated* is False the bar is static at 0 %. When True the CSS fill
    animation runs and an img-onerror trick drives the text counter (since
    Gradio innerHTML doesn't execute <script> tags).
    """
    import random
    duration = total_segments * rate
    uid = f"tspb{random.randint(0, 999999)}"

    fill_anim = f"animation:{uid}-grow {duration}s linear forwards;" if animated else ""
    keyframes = f"""<style>
            @keyframes {uid}-grow {{
                from {{ width:0%; }}
                to   {{ width:100%; }}
            }}
        </style>""" if animated else ""

    # img onerror executes JS even when injected via innerHTML
    counter_js = f'''<img src="data:," style="display:none"
        onerror="(function(){{
            var t={total_segments},r={rate * 1000},c=0,
                el=document.getElementById('{uid}-text');
            if(!el)return;
            var iv=setInterval(function(){{
                c++;
                if(c>t+1){{clearInterval(iv);return;}}
                if(c>t){{el.textContent='Almost Done...';}}
                else{{el.textContent='Segment '+c+'/'+t;}}
            }},r);
        }})()" />''' if animated else ""

    return f'''<div id="{uid}" style="
        position:relative; width:100%; height:40px;
        background:#e5e7eb; border-radius:8px; overflow:hidden;
        font-family:system-ui,sans-serif; font-size:14px;
    ">
        <div id="{uid}-fill" style="
            position:absolute; top:0; left:0; height:100%;
            width:0%; background:linear-gradient(90deg,#3b82f6,#2563eb);
            border-radius:8px; {fill_anim}
        "></div>
        <span id="{uid}-text" style="
            position:absolute; inset:0; display:flex;
            align-items:center; justify-content:center;
            color:#1f2937; font-weight:600; z-index:1;
            text-shadow:0 0 4px rgba(255,255,255,0.8);
        ">{'Preparing Alignment...' if not animated else f'Segment 0/{total_segments}'}</span>
        {keyframes}
        {counter_js}
    </div>'''


# ---------------------------------------------------------------------------
# UI generator (Gradio — yields progress, injects HTML timestamps)
# ---------------------------------------------------------------------------

def compute_mfa_timestamps(current_html, json_output, segment_dir, cached_log_row=None):
    """Compute word-level timestamps via MFA forced alignment and inject into HTML.

    Generator that yields (output_html, compute_ts_btn, animate_all_html, progress_bar, json_output)
    tuples. First yield shows the animated progress bar; final yield contains results with enriched JSON
    including word/letter timestamps.
    """
    import re
    import traceback

    print("[MFA_TS] compute_mfa_timestamps called")
    print(f"[MFA_TS]   segment_dir={segment_dir}")
    print(f"[MFA_TS]   json_output keys={list(json_output.keys()) if json_output else None}")
    print(f"[MFA_TS]   html length={len(current_html) if current_html else 0}")

    if not current_html or '<span class="word"' not in current_html:
        print("[MFA_TS] Early return: no HTML or no word spans")
        yield current_html, gr.update(), gr.update(), gr.update(), gr.update()
        return

    # Build refs and audio paths using shared helper
    segments = json_output.get("segments", []) if json_output else []
    print(f"[MFA_TS] {len(segments)} segments in JSON")

    refs, audio_paths, seg_to_result_idx = _build_mfa_refs(segments, segment_dir)

    if not refs:
        print("[MFA_TS] Early return: no valid refs/audio pairs")
        yield current_html, gr.update(), gr.update(), gr.update(), gr.update()
        return

    # Yield 1: hide button, show static progress bar at 0/N
    total_segments = len(refs)
    static_bar = _ts_progress_bar_html(total_segments, MFA_PROGRESS_SEGMENT_RATE, animated=False)
    yield (
        gr.update(),
        gr.update(visible=False),
        gr.update(),
        gr.update(value=static_bar, visible=True),
        gr.update(),
    )

    # Upload files and submit batch (blocking — bar stays at 0/N)
    try:
        event_id, mfa_headers, mfa_base = _mfa_upload_and_submit(refs, audio_paths)
    except Exception as e:
        print(f"[MFA_TS] ERROR uploading/submitting: {e}")
        traceback.print_exc()
        yield (
            gr.update(),
            gr.update(visible=True, interactive=True, variant="primary"),
            gr.update(),
            gr.update(visible=False),
            gr.update(),
        )
        raise

    # Yield 2: switch to animated bar (counter starts now)
    animated_bar = _ts_progress_bar_html(total_segments, MFA_PROGRESS_SEGMENT_RATE, animated=True)
    yield (
        gr.update(),
        gr.update(),
        gr.update(),
        gr.update(value=animated_bar),
        gr.update(),
    )

    # Wait for MFA result (blocking — animation runs client-side)
    try:
        results = _mfa_wait_result(event_id, mfa_headers, mfa_base)
        print(f"[MFA_TS] Got {len(results)} results from MFA API")
    except Exception as e:
        print(f"[MFA_TS] ERROR waiting for MFA result: {e}")
        traceback.print_exc()
        yield (
            gr.update(),
            gr.update(visible=True, interactive=True, variant="primary"),
            gr.update(),
            gr.update(visible=False),
            gr.update(),
        )
        raise

    # Build timestamp lookups using shared helper
    word_timestamps, letter_timestamps, word_to_all_results = _build_timestamp_lookups(results)

    # Build cross-word groups using shared helper
    crossword_groups = _build_crossword_groups(results, letter_timestamps)

    # Extend word timestamps using shared helper
    _extend_word_timestamps(word_timestamps, segments, seg_to_result_idx, results, segment_dir)

    # --- HTML injection (UI-only, not shared with API) ---

    # Inject timestamps into word spans, using segment boundaries to determine result_idx
    seg_boundaries = []
    for m in re.finditer(r'data-segment-idx="(\d+)"', current_html):
        seg_boundaries.append((m.start(), int(m.group(1))))
    seg_boundaries.sort(key=lambda x: x[0])

    seg_offset_map = {}
    for seg in segments:
        idx = seg.get("segment", 0) - 1
        seg_offset_map[idx] = seg.get("time_from", 0)

    def _get_seg_idx_at_pos(pos):
        seg_idx = None
        for boundary_pos, idx in seg_boundaries:
            if boundary_pos > pos:
                break
            seg_idx = idx
        return seg_idx

    word_open_re = r'<span class="word"[^>]*>'

    def _inject_word_ts(m):
        orig = m.group(0)
        pos_m = re.search(r'data-pos="([^"]+)"', orig)
        if not pos_m:
            return orig
        pos = pos_m.group(1)
        seg_idx = _get_seg_idx_at_pos(m.start())
        if seg_idx is None:
            return orig
        expected_result_idx = seg_to_result_idx.get(seg_idx)
        result_idx = None
        if pos and not pos.startswith("0:0:"):
            candidates = word_to_all_results.get(pos, [])
            if candidates:
                if len(candidates) == 1:
                    result_idx = candidates[0]
                elif expected_result_idx in candidates:
                    result_idx = expected_result_idx
                else:
                    result_idx = min(candidates, key=lambda r: abs(r - (expected_result_idx or 0)))
        if result_idx is None:
            result_idx = expected_result_idx
        if result_idx is None:
            return orig
        key = f"{result_idx}:{pos}"
        ts = word_timestamps.get(key)
        if not ts:
            return orig
        seg_offset = seg_offset_map.get(seg_idx, 0)
        abs_start = ts[0] + seg_offset
        abs_end = ts[1] + seg_offset
        return orig[:-1] + f' data-result-idx="{result_idx}" data-start="{abs_start:.4f}" data-end="{abs_end:.4f}">'

    html = re.sub(word_open_re, _inject_word_ts, current_html)

    # Enable per-segment animate buttons
    html = re.sub(r'(<button class="animate-btn"[^>]*?)\s+disabled(?:="[^"]*")?', r'\1', html)

    # Stamp char spans with MFA letter timestamps
    import unicodedata

    def _stamp_chars_with_mfa(word_m):
        word_open = word_m.group(1)
        word_abs_start = float(word_m.group(2))
        inner = word_m.group(4)

        pos_m = re.search(r'data-pos="([^"]+)"', word_open)
        word_pos = pos_m.group(1) if pos_m else None

        result_idx_m = re.search(r'data-result-idx="(\d+)"', word_open)
        if result_idx_m:
            result_idx = int(result_idx_m.group(1))
        else:
            result_idx = None
            if word_pos and not word_pos.startswith("0:0:"):
                candidates = word_to_all_results.get(word_pos, [])
                if candidates:
                    if len(candidates) == 1:
                        result_idx = candidates[0]
                    else:
                        result_idx = candidates[0]

        key = f"{result_idx}:{word_pos}" if result_idx is not None and word_pos else None

        word_ts = word_timestamps.get(key) if key else None
        mfa_letters = letter_timestamps.get(key) if key else None
        if not mfa_letters or not word_ts:
            return word_m.group(0)

        word_rel_start = word_ts[0]

        char_matches = list(re.finditer(r'<span class="char">([^<]*)</span>', inner))
        if not char_matches:
            return word_m.group(0)

        mfa_chars = [l["char"] for l in mfa_letters]
        html_chars = [m.group(1).replace('\u0640', '') for m in char_matches]

        CHAR_EQUIVALENTS = {
            'ى': 'ي',
            'ي': 'ى',
        }

        def _first_base(s):
            for c in unicodedata.normalize("NFD", s):
                if not unicodedata.category(c).startswith('M'):
                    return c
            return s[0] if s else ''

        def chars_match(mfa_c, html_c, log_substitution=False):
            if mfa_c == html_c or html_c in mfa_c or mfa_c in html_c:
                return True
            if CHAR_EQUIVALENTS.get(mfa_c) == html_c:
                if log_substitution:
                    print(f"[MFA_TS] Char substitution: MFA '{mfa_c}' → HTML '{html_c}' (key={key})")
                return True
            mb, hb = _first_base(mfa_c), _first_base(html_c)
            if mb and hb and (mb == hb or CHAR_EQUIVALENTS.get(mb) == hb):
                if log_substitution:
                    print(f"[MFA_TS] Base-char match: MFA '{mfa_c}' → HTML '{html_c}' (base='{mb}' key={key})")
                return True
            return False

        mfa_idx = 0
        char_replacements = []
        stamped_html = set()
        for html_idx, cm in enumerate(char_matches):
            if html_idx in stamped_html:
                continue
            html_char = html_chars[html_idx]
            if mfa_idx < len(mfa_letters):
                mfa_char = mfa_chars[mfa_idx]
                if chars_match(mfa_char, html_char, log_substitution=True):
                    letter = mfa_letters[mfa_idx]
                    if letter["start"] is None or letter["end"] is None:
                        print(f"[MFA_TS] Skipping letter with missing timestamp: char='{letter.get('char')}' key={key} mfa_idx={mfa_idx}")
                        if chars_match(mfa_char, html_char) or len(html_char) >= len(mfa_char):
                            mfa_idx += 1
                        continue
                    abs_start = word_abs_start + (letter["start"] - word_rel_start)
                    abs_end = word_abs_start + (letter["end"] - word_rel_start)
                    crossword_gid = crossword_groups.get((key, mfa_idx), "")
                    final_group_id = crossword_gid or letter.get("group_id", "")
                    char_replacements.append((
                        cm.start(), cm.end(),
                        f'<span class="char" data-start="{abs_start:.4f}" data-end="{abs_end:.4f}" data-group-id="{final_group_id}">{cm.group(1)}</span>'
                    ))
                    mfa_nfd = unicodedata.normalize("NFD", letter["char"])
                    peek = html_idx + 1
                    while peek < len(char_matches):
                        peek_raw = char_matches[peek].group(1).replace('\u0640', '')
                        if not peek_raw or not all(unicodedata.category(c).startswith('M') for c in peek_raw):
                            break
                        if not any(c in mfa_nfd for c in peek_raw):
                            break
                        char_replacements.append((
                            char_matches[peek].start(), char_matches[peek].end(),
                            f'<span class="char" data-start="{abs_start:.4f}" data-end="{abs_end:.4f}" data-group-id="{final_group_id}">{char_matches[peek].group(1)}</span>'
                        ))
                        stamped_html.add(peek)
                        peek += 1
                    if chars_match(mfa_char, html_char) or len(html_char) >= len(mfa_char):
                        mfa_idx += 1

        stamped_inner = inner
        for start, end, replacement in reversed(char_replacements):
            stamped_inner = stamped_inner[:start] + replacement + stamped_inner[end:]

        return f'{word_open}{stamped_inner}</span>'

    html = re.sub(
        r'(<span class="word"(?:\s+data-pos="[^"]*")?(?:\s+data-result-idx="\d+")?\s+data-start="([\d.]+)"\s+data-end="([\d.]+)">)((?:<span class="char">.*?</span>)+)</span>',
        _stamp_chars_with_mfa,
        html,
    )

    print(f"[MFA_TS] Done — injected timestamps for {len(word_timestamps)} words")

    # Log word and char timestamps to usage logger
    if cached_log_row is not None:
        try:
            import json as _json
            from src.core.usage_logger import update_word_timestamps
            _ts_log = []
            _char_ts_log = []
            for result in results:
                if result.get("status") != "ok":
                    continue
                _ts_log.append({
                    "ref": result.get("ref", ""),
                    "words": [
                        {"word": w.get("word", ""), "start": round(w["start"], 4), "end": round(w["end"], 4)}
                        for w in result.get("words", []) if w.get("start") is not None and w.get("end") is not None
                    ],
                })
                _char_ts_log.append({
                    "ref": result.get("ref", ""),
                    "words": [
                        {
                            "word": w.get("word", ""),
                            "location": w.get("location", ""),
                            "letters": [
                                {"char": lt.get("char", ""), "start": round(lt["start"], 4), "end": round(lt["end"], 4)}
                                for lt in w.get("letters", []) if lt.get("start") is not None and lt.get("end") is not None
                            ],
                        }
                        for w in result.get("words", []) if w.get("letters")
                    ],
                })
            update_word_timestamps(
                cached_log_row,
                _json.dumps(_ts_log),
                _json.dumps(_char_ts_log) if any(entry["words"] for entry in _char_ts_log) else None,
            )
        except Exception as e:
            print(f"[USAGE_LOG] Failed to log word timestamps: {e}")

    # Build enriched JSON using shared helper (UI always includes letters)
    enriched_json = _build_enriched_json(
        segments, results, seg_to_result_idx,
        word_timestamps, letter_timestamps, "words+chars",
    )

    # Final yield: updated HTML, hide progress bar, show Animate All, enriched JSON
    animate_all_btn_html = '<button class="animate-all-btn">Animate All</button>'
    yield (
        html,
        gr.update(visible=False),
        gr.update(value=animate_all_btn_html, visible=True),
        gr.update(visible=False),
        enriched_json,
    )
