import os
import gradio as gr
from config import MFA_SPACE_URL, MFA_TIMEOUT, MFA_PROGRESS_SEGMENT_RATE


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

    # Build refs and audio paths from structured JSON output
    segments = json_output.get("segments", []) if json_output else []
    print(f"[MFA_TS] {len(segments)} segments in JSON")
    refs = []
    audio_paths = []
    seg_to_result_idx = {}  # Maps segment index (0-based) → result index

    _BASMALA_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم"
    _ISTIATHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم"
    _COMBINED_PREFIX = _ISTIATHA_TEXT + " ۝ " + _BASMALA_TEXT

    for seg in segments:
        ref_from = seg.get("ref_from", "")
        ref_to = seg.get("ref_to", "")
        seg_idx = seg.get("segment", 0) - 1  # 0-indexed
        confidence = seg.get("confidence", 0)

        if not ref_from or confidence <= 0:
            continue

        # Build MFA ref
        if ref_from == ref_to:
            mfa_ref = ref_from
        else:
            mfa_ref = f"{ref_from}-{ref_to}"

        # Detect fused special prefix and build compound ref
        # (skip when the ref itself is already a special like "Basmala")
        _is_special_ref = ref_from.strip().lower() in {"basmala", "isti'adha"}
        if not _is_special_ref:
            matched_text = seg.get("matched_text", "")
            if matched_text.startswith(_COMBINED_PREFIX):
                mfa_ref = f"Isti'adha+Basmala+{mfa_ref}"
            elif matched_text.startswith(_ISTIATHA_TEXT):
                mfa_ref = f"Isti'adha+{mfa_ref}"
            elif matched_text.startswith(_BASMALA_TEXT):
                mfa_ref = f"Basmala+{mfa_ref}"

        # Check audio file exists
        audio_path = os.path.join(segment_dir, f"seg_{seg_idx}.wav") if segment_dir else None
        if not audio_path or not os.path.exists(audio_path):
            print(f"[MFA_TS] Skipping seg {seg_idx}: audio not found at {audio_path}")
            continue

        # Track mapping from segment index to result index
        seg_to_result_idx[seg_idx] = len(refs)
        refs.append(mfa_ref)
        audio_paths.append(audio_path)

    print(f"[MFA_TS] {len(refs)} refs to align: {refs[:5]}{'...' if len(refs) > 5 else ''}")

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

    # Build lookup: "result_idx:location" → (start, end) from all successful results
    # Using result_idx prefix ensures each segment has its own timestamps even for shared words
    _SPECIAL_REFS = {"basmala", "isti'adha"}
    word_timestamps = {}  # "result_idx:location" → (start, end)
    letter_timestamps = {}  # "result_idx:location" → list of letter dicts with group_id
    word_to_all_results = {}  # word_pos → [result_idx, ...] (all occurrences)

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
                "group_id": f"{word_location}:{group_id}",  # Unique across words
            })
        return result

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
                if is_special:
                    base_key = f"{ref}:{loc}"
                elif is_fused and loc.startswith("0:0:"):
                    base_key = f"{ref}:{loc}"
                else:
                    base_key = loc
                key = f"{result_idx}:{base_key}"  # Prefix with result index
                word_timestamps[key] = (word["start"], word["end"])
                # Extract letter timestamps if available
                letters = word.get("letters")
                if letters:
                    letter_timestamps[key] = _assign_letter_groups(letters, loc)
                # Track word→result_idx mapping for lookup (regular words only)
                if not is_special and not (is_fused and loc.startswith("0:0:")):
                    if loc not in word_to_all_results:
                        word_to_all_results[loc] = []
                    word_to_all_results[loc].append(result_idx)

    print(f"[MFA_TS] {len(word_timestamps)} word timestamps collected, {len(letter_timestamps)} with letter-level data")

    # Build cross-word overlap groups for simultaneous highlighting
    def _build_crossword_groups(results_list, letter_ts_dict):
        """
        Build mapping of (key, letter_idx) -> cross-word group_id.
        Only checks word boundaries: last letter(s) of word N vs first letter(s) of word N+1.
        """
        crossword_groups = {}  # (key, idx) -> group_id

        for result_idx, result in enumerate(results_list):
            if result.get("status") != "ok":
                continue
            ref = result.get("ref", "")
            is_special = ref.strip().lower() in _SPECIAL_REFS
            is_fused = "+" in ref
            words = result.get("words", [])

            # Iterate through consecutive word pairs
            for word_i in range(len(words) - 1):
                word_a = words[word_i]
                word_b = words[word_i + 1]

                loc_a = word_a.get("location", "")
                loc_b = word_b.get("location", "")
                if not loc_a or not loc_b:
                    continue

                # Build keys for letter_timestamps lookup
                def make_key(loc):
                    if is_special:
                        base_key = f"{ref}:{loc}"
                    elif is_fused and loc.startswith("0:0:"):
                        base_key = f"{ref}:{loc}"
                    else:
                        base_key = loc
                    return f"{result_idx}:{base_key}"

                key_a = make_key(loc_a)
                key_b = make_key(loc_b)
                letters_a = letter_ts_dict.get(key_a, [])
                letters_b = letter_ts_dict.get(key_b, [])

                if not letters_a or not letters_b:
                    continue

                # Compare last letter(s) of word A with first letter(s) of word B
                # Check last few letters of A against first few letters of B
                for idx_a in range(len(letters_a) - 1, max(len(letters_a) - 3, -1), -1):
                    letter_a = letters_a[idx_a]
                    if letter_a.get("start") is None or letter_a.get("end") is None:
                        continue
                    for idx_b in range(min(3, len(letters_b))):
                        letter_b = letters_b[idx_b]
                        if letter_b.get("start") is None or letter_b.get("end") is None:
                            continue
                        # Check for exact timestamp match (MFA marks simultaneous letters identically)
                        if letter_a["start"] == letter_b["start"] and letter_a["end"] == letter_b["end"]:
                            group_id = f"xword-{result_idx}-{word_i}"
                            crossword_groups[(key_a, idx_a)] = group_id
                            crossword_groups[(key_b, idx_b)] = group_id

        if crossword_groups:
            print(f"[MFA_TS] Found {len(crossword_groups)} cross-word overlapping letters")

        return crossword_groups

    crossword_groups = _build_crossword_groups(results, letter_timestamps)

    # Post-process: extend each word's end to the start of the next word
    # so words don't disappear between timestamps during animation.
    import wave
    for seg in segments:
        ref_from = seg.get("ref_from", "")
        ref_to = seg.get("ref_to", "")
        seg_idx = seg.get("segment", 0) - 1
        confidence = seg.get("confidence", 0)
        if not ref_from or confidence <= 0:
            continue
        # Get result_idx for this segment (may not exist if segment was skipped)
        result_idx = seg_to_result_idx.get(seg_idx)
        if result_idx is None:
            continue
        # Find the matching MFA result and collect word locations in order
        ref_key = f"{ref_from}-{ref_to}" if ref_from != ref_to else ref_from
        is_special = ref_from.strip().lower() in _SPECIAL_REFS
        # Reconstruct compound ref for fused segments
        # (skip when the ref itself is already a special like "Basmala")
        if not is_special:
            matched_text = seg.get("matched_text", "")
            if matched_text.startswith(_COMBINED_PREFIX):
                ref_key = f"Isti'adha+Basmala+{ref_key}"
            elif matched_text.startswith(_ISTIATHA_TEXT):
                ref_key = f"Isti'adha+{ref_key}"
            elif matched_text.startswith(_BASMALA_TEXT):
                ref_key = f"Basmala+{ref_key}"
        is_fused = "+" in ref_key
        seg_word_locs = []
        for result in results:
            if result.get("ref") == ref_key and result.get("status") == "ok":
                for w in result.get("words", []):
                    loc = w.get("location", "")
                    if loc:
                        if is_special:
                            base_key = f"{ref_key}:{loc}"
                        elif is_fused and loc.startswith("0:0:"):
                            base_key = f"{ref_key}:{loc}"
                        else:
                            base_key = loc
                        key = f"{result_idx}:{base_key}"  # Use result_idx prefix
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

    # Inject timestamps into word spans, using segment boundaries to determine result_idx
    # Step 1: Find all segment boundaries (position → seg_idx)
    seg_boundaries = []  # [(position, seg_idx), ...]
    for m in re.finditer(r'data-segment-idx="(\d+)"', current_html):
        seg_boundaries.append((m.start(), int(m.group(1))))
    seg_boundaries.sort(key=lambda x: x[0])

    # Build segment offset lookup: seg_idx → time_from (for absolute timestamp conversion)
    seg_offset_map = {}  # seg_idx (0-based) → time_from
    for seg in segments:
        idx = seg.get("segment", 0) - 1  # Convert to 0-based
        seg_offset_map[idx] = seg.get("time_from", 0)

    # Step 2: For each word span, find which segment it belongs to
    def _get_seg_idx_at_pos(pos):
        """Find the segment index for a position in the HTML."""
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
        # Find which segment this word belongs to
        seg_idx = _get_seg_idx_at_pos(m.start())
        if seg_idx is None:
            return orig
        # Get expected result_idx for this segment
        expected_result_idx = seg_to_result_idx.get(seg_idx)
        # For regular words, use word-based mapping to find correct result_idx
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
        # Use result_idx prefix to get segment-specific timestamp
        key = f"{result_idx}:{pos}"
        ts = word_timestamps.get(key)
        if not ts:
            return orig
        # Convert relative timestamps to absolute by adding segment offset
        seg_offset = seg_offset_map.get(seg_idx, 0)
        abs_start = ts[0] + seg_offset
        abs_end = ts[1] + seg_offset
        # Include result_idx so char-level injection can find letter timestamps
        return orig[:-1] + f' data-result-idx="{result_idx}" data-start="{abs_start:.4f}" data-end="{abs_end:.4f}">'

    html = re.sub(word_open_re, _inject_word_ts, current_html)

    # Enable per-segment animate buttons
    html = re.sub(r'(<button class="animate-btn"[^>]*?)\s+disabled(?:="[^"]*")?', r'\1', html)

    # Stamp char spans with MFA letter timestamps
    import unicodedata

    def _stamp_chars_with_mfa(word_m):
        word_open = word_m.group(1)
        word_abs_start = float(word_m.group(2))  # data-start (already correctly injected)
        inner = word_m.group(4)

        # Extract data-pos from word tag
        pos_m = re.search(r'data-pos="([^"]+)"', word_open)
        word_pos = pos_m.group(1) if pos_m else None

        # Find result_idx from word tag's data-result-idx if available, else use mapping
        result_idx_m = re.search(r'data-result-idx="(\d+)"', word_open)
        if result_idx_m:
            result_idx = int(result_idx_m.group(1))
        else:
            # Fallback: use word-based mapping to find correct result_idx
            result_idx = None
            if word_pos and not word_pos.startswith("0:0:"):
                candidates = word_to_all_results.get(word_pos, [])
                if candidates:
                    if len(candidates) == 1:
                        result_idx = candidates[0]
                    else:
                        # Without position info, just take the first candidate
                        result_idx = candidates[0]

        key = f"{result_idx}:{word_pos}" if result_idx is not None and word_pos else None

        # Look up word's relative start from MFA to calculate offset
        word_ts = word_timestamps.get(key) if key else None
        mfa_letters = letter_timestamps.get(key) if key else None
        if not mfa_letters or not word_ts:
            return word_m.group(0)

        word_rel_start = word_ts[0]  # Word's relative start from MFA

        char_matches = list(re.finditer(r'<span class="char">([^<]*)</span>', inner))
        if not char_matches:
            return word_m.group(0)

        # Match MFA letters to HTML chars
        mfa_chars = [unicodedata.normalize("NFC", l["char"]) for l in mfa_letters]
        html_chars = [unicodedata.normalize("NFC", m.group(1)) for m in char_matches]

        # Allowed character mappings (MFA char → HTML char)
        # ى (alef maksura) ↔ ي (ya) are visually similar and interchangeable
        CHAR_EQUIVALENTS = {
            'ى': 'ي',  # alef maksura → ya
            'ي': 'ى',  # ya → alef maksura
        }

        def chars_match(mfa_c, html_c, log_substitution=False):
            """Check if MFA char matches HTML char, including allowed equivalents."""
            if mfa_c == html_c or html_c in mfa_c or mfa_c in html_c:
                return True
            # Check allowed equivalents
            if CHAR_EQUIVALENTS.get(mfa_c) == html_c:
                if log_substitution:
                    print(f"[MFA_TS] Char substitution: MFA '{mfa_c}' → HTML '{html_c}' (key={key})")
                return True
            return False

        mfa_idx = 0
        char_replacements = []
        for html_idx, cm in enumerate(char_matches):
            html_char = html_chars[html_idx]
            if mfa_idx < len(mfa_letters):
                mfa_char = mfa_chars[mfa_idx]
                if chars_match(mfa_char, html_char, log_substitution=True):
                    letter = mfa_letters[mfa_idx]
                    # Skip letters without valid timestamps
                    if letter["start"] is None or letter["end"] is None:
                        print(f"[MFA_TS] Skipping letter with missing timestamp: char='{letter.get('char')}' key={key} mfa_idx={mfa_idx}")
                        if chars_match(mfa_char, html_char) or len(html_char) >= len(mfa_char):
                            mfa_idx += 1
                        continue
                    # Convert letter timestamps using word anchor
                    # word_abs_start is already correct from word-level injection
                    # letter times are relative to segment, so offset by (letter_start - word_rel_start)
                    abs_start = word_abs_start + (letter["start"] - word_rel_start)
                    abs_end = word_abs_start + (letter["end"] - word_rel_start)
                    # Determine group_id: prefer cross-word group if exists, else use MFA's
                    crossword_gid = crossword_groups.get((key, mfa_idx), "")
                    final_group_id = crossword_gid or letter.get("group_id", "")
                    char_replacements.append((
                        cm.start(), cm.end(),
                        f'<span class="char" data-start="{abs_start:.4f}" data-end="{abs_end:.4f}" data-group-id="{final_group_id}">{cm.group(1)}</span>'
                    ))
                    if chars_match(mfa_char, html_char) or len(html_char) >= len(mfa_char):
                        mfa_idx += 1

        # Apply replacements in reverse order
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
                # Collect char-level timestamps
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

    # Build enriched JSON with word/letter timestamps (relative to segment)
    from src.core.quran_index import get_quran_index
    index = get_quran_index()

    def _get_word_text(location: str) -> str:
        """Look up word text from Quran index by location (surah:ayah:word)."""
        if not location or location.startswith("0:0:"):
            return ""  # Special segments (Basmala/Isti'adha) use 0:0:N
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

        segment_data = dict(seg)  # Copy original segment data

        if result_idx is not None:
            # For special segments (Basmala/Isti'adha), get words from matched_text
            is_special = seg.get("ref_from", "").lower() in {"basmala", "isti'adha"}
            special_words = seg.get("matched_text", "").split() if is_special else []

            # Find matching MFA result for this segment
            for i, result in enumerate(results):
                if i != result_idx or result.get("status") != "ok":
                    continue
                words_with_ts = []
                for word_idx, word in enumerate(result.get("words", [])):
                    if word.get("start") is None or word.get("end") is None:
                        continue

                    location = word.get("location", "")

                    # Get word text: from matched_text for special, from index for regular
                    if is_special or location.startswith("0:0:"):
                        word_text = special_words[word_idx] if word_idx < len(special_words) else ""
                    else:
                        word_text = _get_word_text(location)

                    word_data = {
                        "word": word_text,
                        "location": location,
                        "start": round(word["start"], 4),  # Relative to segment
                        "end": round(word["end"], 4),
                    }
                    # Add letter timestamps if available
                    if word.get("letters"):
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

    enriched_json = {"segments": enriched_segments}

    # Final yield: updated HTML, hide progress bar, show Animate All, enriched JSON
    animate_all_btn_html = '<button class="animate-all-btn">Animate All</button>'
    yield (
        html,
        gr.update(visible=False),
        gr.update(value=animate_all_btn_html, visible=True),
        gr.update(visible=False),
        enriched_json,
    )
