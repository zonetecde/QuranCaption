"""Segment rendering and text formatting helpers."""
import json
import time
import unicodedata

from config import (
    CONFIDENCE_HIGH, CONFIDENCE_MED,
    REVIEW_SUMMARY_MAX_SEGMENTS,
    SURAH_INFO_PATH,
)
from src.core.segment_types import SegmentInfo
from src.alignment.special_segments import ALL_SPECIAL_REFS

_ANIMATABLE_SPECIALS = {"Basmala", "Isti'adha"}


def format_timestamp(seconds: float) -> str:
    """Format seconds as MM:SS.ms"""
    minutes = int(seconds // 60)
    secs = seconds % 60
    return f"{minutes}:{secs:04.1f}"


def get_confidence_class(score: float) -> str:
    """Get CSS class based on confidence score."""
    if score >= CONFIDENCE_HIGH:
        return "segment-high"
    elif score >= CONFIDENCE_MED:
        return "segment-med"
    else:
        return "segment-low"


def get_segment_word_stats(matched_ref: str) -> tuple[int, int]:
    """Return (word_count, ayah_span) for a matched ref. (0, 1) if unparseable."""
    if not matched_ref or "-" not in matched_ref:
        return 0, 1
    try:
        start_ref, end_ref = matched_ref.split("-", 1)
        start_parts = start_ref.split(":")
        end_parts = end_ref.split(":")
        if len(start_parts) < 3 or len(end_parts) < 3:
            return 0, 1

        # Ayah span
        start_ayah = (int(start_parts[0]), int(start_parts[1]))
        end_ayah = (int(end_parts[0]), int(end_parts[1]))
        ayah_span = 1
        if start_ayah != end_ayah:
            ayah_span = abs(end_ayah[1] - start_ayah[1]) + 1 if start_ayah[0] == end_ayah[0] else 2

        # Word count via index
        word_count = 0
        from src.core.quran_index import get_quran_index
        index = get_quran_index()
        indices = index.ref_to_indices(matched_ref)
        if indices:
            word_count = indices[1] - indices[0] + 1

        return word_count, ayah_span
    except Exception:
        return 0, 1



# Arabic-Indic digits for verse markers
ARABIC_DIGITS = {
    '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤',
    '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩',
}

def to_arabic_numeral(number: int) -> str:
    """Convert an integer to Arabic-Indic numerals."""
    return ''.join(ARABIC_DIGITS[d] for d in str(number))


def format_verse_marker(verse_num: int) -> str:
    """
    Format a verse number as an Arabic verse marker.
    Uses U+06DD (Arabic End of Ayah) which renders as a decorated marker
    in DigitalKhatt (combines U+06DD + digit into a single glyph).
    """
    numeral = to_arabic_numeral(verse_num)
    end_of_ayah = '\u06DD'
    return f'{end_of_ayah}{numeral}'


# Cached verse word counts from surah_info.json
_verse_word_counts_cache: dict[int, dict[int, int]] | None = None


def _load_verse_word_counts() -> dict[int, dict[int, int]]:
    """Load and cache verse word counts from surah_info.json."""
    global _verse_word_counts_cache
    if _verse_word_counts_cache is not None:
        return _verse_word_counts_cache

    with open(SURAH_INFO_PATH, 'r', encoding='utf-8') as f:
        surah_info = json.load(f)

    _verse_word_counts_cache = {}
    for surah_num, data in surah_info.items():
        surah_int = int(surah_num)
        _verse_word_counts_cache[surah_int] = {}
        for verse_data in data.get('verses', []):
            verse_num = verse_data.get('verse')
            num_words = verse_data.get('num_words', 0)
            if verse_num:
                _verse_word_counts_cache[surah_int][verse_num] = num_words

    return _verse_word_counts_cache


def _parse_ref_endpoints(matched_ref: str):
    """Parse ref like '2:255:1-2:255:5' into (surah, ayah, word_from, word_to).

    Returns None for cross-verse refs or unparseable strings.
    """
    if not matched_ref or "-" not in matched_ref:
        return None
    try:
        start_ref, end_ref = matched_ref.split("-", 1)
        sp = start_ref.split(":")
        ep = end_ref.split(":")
        if len(sp) < 3 or len(ep) < 3:
            return None
        s_surah, s_ayah, s_word = int(sp[0]), int(sp[1]), int(sp[2])
        e_surah, e_ayah, e_word = int(ep[0]), int(ep[1]), int(ep[2])
        # Only handle same-verse refs
        if s_surah != e_surah or s_ayah != e_ayah:
            return None
        return (s_surah, s_ayah, s_word, e_word)
    except (ValueError, IndexError):
        return None


def _parse_ref_verse_ranges(matched_ref: str) -> list[tuple[int, int, int, int]]:
    """Decompose a ref into per-verse (surah, ayah, word_from, word_to) ranges.

    Handles same-verse refs like '2:255:1-2:255:5' and cross-verse refs
    like '76:1:11-76:2:7'. Returns empty list for special/unparseable refs.
    """
    if not matched_ref or "-" not in matched_ref:
        return []
    try:
        start_ref, end_ref = matched_ref.split("-", 1)
        sp = start_ref.split(":")
        ep = end_ref.split(":")
        if len(sp) < 3 or len(ep) < 3:
            return []
        s_surah, s_ayah, s_word = int(sp[0]), int(sp[1]), int(sp[2])
        e_surah, e_ayah, e_word = int(ep[0]), int(ep[1]), int(ep[2])
    except (ValueError, IndexError):
        return []

    if s_surah != e_surah:
        return []  # cross-surah not expected

    surah = s_surah
    if s_ayah == e_ayah:
        return [(surah, s_ayah, s_word, e_word)]

    # Cross-verse: decompose into per-verse ranges
    verse_wc = _load_verse_word_counts()
    ranges = []
    for ayah in range(s_ayah, e_ayah + 1):
        expected = verse_wc.get(surah, {}).get(ayah, 0)
        if expected == 0:
            continue
        if ayah == s_ayah:
            ranges.append((surah, ayah, s_word, expected))
        elif ayah == e_ayah:
            ranges.append((surah, ayah, 1, e_word))
        else:
            ranges.append((surah, ayah, 1, expected))
    return ranges


def recompute_missing_words(segments: list) -> None:
    """Recompute has_missing_words flags for all segments based on word gaps.

    Uses coverage-based analysis: decomposes all refs (including cross-verse)
    into per-verse word ranges, then checks each verse for uncovered words.
    """
    verse_wc = _load_verse_word_counts()

    # Reset all flags
    for seg in segments:
        seg.has_missing_words = False

    # Build per-verse coverage: {(surah, ayah): [(word_from, word_to, seg_idx), ...]}
    coverage: dict[tuple[int, int], list[tuple[int, int, int]]] = {}
    for i, seg in enumerate(segments):
        for surah, ayah, wf, wt in _parse_ref_verse_ranges(seg.matched_ref):
            coverage.setdefault((surah, ayah), []).append((wf, wt, i))

    # Check each verse for gaps
    for (surah, ayah), entries in coverage.items():
        expected = verse_wc.get(surah, {}).get(ayah, 0)
        if expected == 0:
            continue

        entries.sort()  # sort by word_from

        # Gap at start of verse
        if entries[0][0] > 1:
            segments[entries[0][2]].has_missing_words = True

        # Gaps between consecutive coverage entries
        for j in range(len(entries) - 1):
            wf_j, wt_j, idx_j = entries[j]
            wf_k, wt_k, idx_k = entries[j + 1]
            if wf_k > wt_j + 1:
                segments[idx_j].has_missing_words = True
                segments[idx_k].has_missing_words = True

        # Gap at end of verse
        if entries[-1][1] < expected:
            segments[entries[-1][2]].has_missing_words = True

    # Check for whole-verse gaps between consecutive covered verses
    by_surah: dict[int, list[int]] = {}
    for (surah, ayah) in coverage:
        by_surah.setdefault(surah, []).append(ayah)

    for surah, ayahs in by_surah.items():
        ayahs_sorted = sorted(set(ayahs))
        for k in range(len(ayahs_sorted) - 1):
            if ayahs_sorted[k + 1] > ayahs_sorted[k] + 1:
                # Whole verse(s) missing between these two covered verses
                prev_entries = coverage[(surah, ayahs_sorted[k])]
                next_entries = coverage[(surah, ayahs_sorted[k + 1])]
                last_in_prev = max(prev_entries, key=lambda e: e[1])[2]
                first_in_next = min(next_entries, key=lambda e: e[0])[2]
                segments[last_in_prev].has_missing_words = True
                segments[first_in_next].has_missing_words = True


def resolve_ref_text(matched_ref: str) -> str:
    """Return the matched_text for a given ref (display text from QuranIndex or special text)."""
    from src.alignment.special_segments import ALL_SPECIAL_REFS, TRANSITION_TEXT

    BASMALA_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم"
    ISTIATHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم"

    if matched_ref in ALL_SPECIAL_REFS:
        if matched_ref == "Basmala":
            return BASMALA_TEXT
        elif matched_ref == "Isti'adha":
            return ISTIATHA_TEXT
        return TRANSITION_TEXT.get(matched_ref, matched_ref)

    from src.core.quran_index import get_quran_index
    index = get_quran_index()
    indices = index.ref_to_indices(matched_ref)
    if not indices:
        return ""
    return " ".join(w.display_text for w in index.words[indices[0]:indices[1] + 1])


def _split_display_words(text: str) -> list[str]:
    """Split display text into words, dropping verse markers."""
    if not text:
        return []
    return text.replace(" \u06dd ", " ").split()


def is_partial_special_segment(seg: SegmentInfo) -> bool:
    """True when a special card already represents only part of the full phrase."""
    if seg.matched_ref not in _ANIMATABLE_SPECIALS:
        return False
    full_words = _split_display_words(resolve_ref_text(seg.matched_ref))
    current_words = _split_display_words(seg.matched_text or "")
    return bool(full_words and current_words and len(current_words) < len(full_words))


def can_manual_split_segment(seg: SegmentInfo) -> bool:
    """Whether the Split button should be shown for this segment."""
    from src.alignment.segment_splitter import manual_split_supported
    return manual_split_supported(seg)


def split_into_char_groups(text):
    """Split text into groups of base character + following combining marks.

    Each group is one visible "letter" — a base character followed by any
    diacritics (tashkeel) or other combining marks attached to it.
    Tatweel (U+0640) and Word Joiner (U+2060) are folded into the current
    group as zero-width visual extensions.
    Hamza above/below (U+0654/U+0655) start their own group so MFA can
    assign them separate timestamps.
    """
    groups = []
    current = ""
    for ch in text:
        if ch in ('\u0640', '\u2060'):
            current += ch  # Tatweel / Word Joiner fold into current group
        elif ch in ('\u0654', '\u0655'):
            # Hamza above/below: start own group (MFA gives separate timestamps)
            if current:
                groups.append(current)
            current = ch
        elif unicodedata.category(ch).startswith('M') and ch != '\u0670':
            current += ch
        else:
            if current:
                groups.append(current)
            current = ch
    if current:
        groups.append(current)
    return groups


ZWSP = '\u2060'  # Word Joiner: zero-width non-breaking (avoids mid-word line breaks)
DAGGER_ALEF = '\u0670'

def _wrap_word(word_text, pos=None):
    """Wrap a word in <span class="word">. Char spans are deferred to MFA timestamp injection."""
    pos_attr = f' data-pos="{pos}"' if pos else ''
    return f'<span class="word"{pos_attr}>{word_text}</span>'


_BASMALA_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم"
_ISTIATHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم"


def build_segment_text_html(seg) -> str:
    """Return the inner HTML for a segment's .segment-text (word spans w/ data-pos)."""
    def _wrap_plain(text):
        return " ".join(_wrap_word(w) for w in text.split())

    if seg.matched_ref:
        text_html = get_text_with_markers(seg.matched_ref)
        if text_html and seg.matched_text:
            for _sp_name, _sp in [("Isti'adha", _ISTIATHA_TEXT),
                                   ("Basmala", _BASMALA_TEXT)]:
                if seg.matched_text.startswith(_sp):
                    mfa_prefix = f"{_sp_name}+{seg.matched_ref}"
                    words = _sp.replace(" ۝ ", " ").split()
                    prefix_html = " ".join(
                        _wrap_word(w, pos=f"{mfa_prefix}:0:0:{i+1}")
                        for i, w in enumerate(words)
                    )
                    text_html = prefix_html + " " + text_html
                    break
        elif not text_html:
            if seg.matched_text:
                words = seg.matched_text.replace(" \u06dd ", " ").split()
                text_html = " ".join(
                    _wrap_word(w, pos=f"{seg.matched_ref}:0:0:{i+1}")
                    for i, w in enumerate(words)
                )
            else:
                text_html = seg.matched_text or ""
    elif seg.matched_text:
        text_html = _wrap_plain(seg.matched_text)
    else:
        text_html = ""

    if getattr(seg, "repeated_ranges", None):
        sections = []
        for sec_from, sec_to in seg.repeated_ranges:
            sec = get_text_with_markers(f"{sec_from}-{sec_to}")
            if sec:
                sections.append(sec)
        if sections:
            text_html = '<div class="repeat-divider"></div>'.join(sections)
    return text_html


def get_text_with_markers(matched_ref: str) -> str | None:
    """
    Generate matched text with verse markers inserted at verse boundaries.

    Uses position-based detection: iterates words and inserts an HTML marker
    after the last word of each verse (matching recitation_app approach).

    Args:
        matched_ref: Reference like "2:255:1-2:255:5"

    Returns:
        Text with verse markers, or None if ref is invalid
    """
    if not matched_ref:
        return None

    from src.core.quran_index import get_quran_index
    index = get_quran_index()

    indices = index.ref_to_indices(matched_ref)
    if not indices:
        return None

    start_idx, end_idx = indices
    verse_word_counts = _load_verse_word_counts()

    parts = []
    for w in index.words[start_idx:end_idx + 1]:
        parts.append(_wrap_word(w.display_text, pos=f"{w.surah}:{w.ayah}:{w.word}"))
        # Check if this is the last word of its verse
        num_words = verse_word_counts.get(w.surah, {}).get(w.ayah, 0)
        if num_words > 0 and w.word == num_words:
            parts.append(format_verse_marker(w.ayah))

    return " ".join(parts)


def simplify_ref(ref: str) -> str:
    """Simplify a matched_ref like '84:9:1-84:9:4' to '84:9:1-4' when same verse."""
    if not ref or "-" not in ref:
        return ref
    parts = ref.split("-")
    if len(parts) != 2:
        return ref
    start, end = parts
    start_parts = start.split(":")
    end_parts = end.split(":")
    if len(start_parts) == 3 and len(end_parts) == 3:
        if start_parts[0] == end_parts[0] and start_parts[1] == end_parts[1]:
            return f"{start}-{end_parts[2]}"
    return ref


def render_segment_card(seg: SegmentInfo, idx: int, full_audio_url: str = "", render_key: str = "", segment_dir: str = "", in_missing_pair: bool = False) -> str:
    """Render a single segment as an HTML card with optional audio player."""
    def _with_cache_bust(url: str) -> str:
        if not render_key:
            return url
        if "#" in url:
            base, frag = url.split("#", 1)
            sep = "&" if "?" in base else "?"
            return f"{base}{sep}v={render_key}#{frag}"
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}v={render_key}"

    is_special = seg.matched_ref in ALL_SPECIAL_REFS
    confidence_class = get_confidence_class(seg.match_score)
    confidence_badge_class = confidence_class  # preserve original for badge color

    # Detect multi-verse span once — drives both the badge and card color.
    is_multiverse = False
    if not is_special and seg.matched_ref and "-" in seg.matched_ref:
        _verse_ranges = _parse_ref_verse_ranges(seg.matched_ref)
        is_multiverse = len(_verse_ranges) >= 2

    if is_special:
        confidence_class = "segment-special"
    elif seg.has_repeated_words:
        confidence_class = "segment-med"
    elif seg.has_missing_words and not in_missing_pair:
        confidence_class = "segment-low"
    elif is_multiverse:
        # Multi-verse overrides the confidence color when no error flags apply.
        confidence_class = "segment-multiverse"

    timestamp = f"{format_timestamp(seg.start_time)} - {format_timestamp(seg.end_time)}"
    duration = seg.end_time - seg.start_time

    # Format reference (simplify same-verse refs)
    ref_display = simplify_ref(seg.matched_ref) if seg.matched_ref else ""

    # Confidence percentage with label
    confidence_pct = f"Confidence: {seg.match_score:.0%}"

    # Missing words badge (only for single-segment cases; pairs use a group wrapper)
    missing_badge = ""
    if seg.has_missing_words and not in_missing_pair:
        missing_badge = '<div class="segment-badge segment-low-badge">Missing Words</div>'

    # Multi-verse badge — segment spans 2+ distinct verses. Skipped for specials.
    multiverse_badge = ""
    if is_multiverse:
        multiverse_badge = f'<div class="segment-badge segment-multiverse-badge">{len(_verse_ranges)} verses</div>'

    # Repeated words badge with feedback buttons
    repeated_badge = ""
    if seg.has_repeated_words:
        repeated_badge = (
            f'<div class="repeat-feedback-group" data-segment-idx="{idx}">'
            '<button class="repeat-fb-btn repeat-fb-up" title="Correct">&#x2713;</button>'
            '<button class="repeat-fb-btn repeat-fb-down" title="Incorrect">&#x2717;</button>'
            '<div class="segment-badge segment-repeated-badge">Repeated Words</div>'
            '</div>'
        )

    # Error display
    error_html = ""
    if seg.error:
        error_html = f'<div class="segment-error">{seg.error}</div>'

    can_manual_split = can_manual_split_segment(seg)
    can_animate = bool(
        seg.matched_ref and (
            seg.matched_ref not in ALL_SPECIAL_REFS
            or (seg.matched_ref in _ANIMATABLE_SPECIALS and not is_partial_special_segment(seg))
        )
    )

    # Audio player HTML — per-segment WAV (preferred) or media fragment fallback
    audio_html = ""
    if segment_dir or full_audio_url:
        if segment_dir:
            audio_src = _with_cache_bust(f"/gradio_api/file={segment_dir}/seg_{idx}.wav")
        else:
            audio_src = _with_cache_bust(f"{full_audio_url}#t={seg.start_time:.3f},{seg.end_time:.3f}")
        split_btn = f'<button class="manual-split-btn" data-segment="{idx}">Split</button>' if can_manual_split else ""
        animate_btn = f'<button class="animate-btn" data-segment="{idx}">Animate</button>' if can_animate else ""
        audio_html = f'''
        <div class="segment-audio">
            <audio data-src="{audio_src}" preload="none"
                   style="display:none; width: 100%; height: 32px;">
            </audio>
            <button class="play-btn">&#9654;</button>
            {split_btn}
            {animate_btn}
        </div>
        <div class="segment-split-controls">
            <button class="split-confirm-btn" data-segment="{idx}" disabled>Confirm</button>
            <button class="split-cancel-btn" data-segment="{idx}">Cancel</button>
            <div class="split-hint">Hint: Click on target words to subdivide.</div>
        </div>
        '''

    text_html = build_segment_text_html(seg)

    if is_special:
        confidence_badge = f'<div class="segment-badge segment-special-badge">{seg.matched_ref}</div>'
    else:
        confidence_badge = f'<div class="segment-badge {confidence_badge_class}-badge">{confidence_pct}</div>'

    # Build inline header: Segment N | ref | duration | time range
    header_parts = [f"Segment {idx + 1}"]
    if ref_display:
        full_ref = seg.matched_ref or ""
        header_parts.append(
            f'<span class="ref-editable" data-segment-idx="{idx}" data-full-ref="{full_ref}">{ref_display}</span>'
        )
    header_parts.append(f"{duration:.1f}s")
    header_parts.append(timestamp)
    header_text = " | ".join(header_parts)

    html = f'''
    <div class="segment-card {confidence_class}" data-duration="{duration:.3f}" data-segment-idx="{idx}" data-matched-ref="{seg.matched_ref or ''}" data-confidence-class="{confidence_badge_class}" data-start-time="{seg.start_time:.4f}" data-end-time="{seg.end_time:.4f}">
        <div class="segment-header">
            <div class="segment-title">{header_text}</div>
            <div class="segment-badges">
                {repeated_badge}
                {missing_badge}
                {multiverse_badge}
                {confidence_badge}
            </div>
        </div>

        {audio_html}

        <div class="segment-text">
            {text_html}
        </div>

        {error_html}
    </div>
    '''
    return html


def render_segments(segments: list, full_audio_url: str = "", segment_dir: str = "",
                    split_report: dict | None = None) -> str:
    """Render all segments as HTML with optional audio players.

    Args:
        segments: List of SegmentInfo objects
        full_audio_url: URL to full audio WAV (used by mega card / Animate All)
        segment_dir: Path to segment directory containing per-segment WAV files
        split_report: Optional report dict from the latest split action.
            Only used for transient failure messaging; the split summary is
            derived from the current segments state so it remains cumulative.
    """
    if not segments:
        return '<div class="no-segments">No segments detected</div>'

    # Generate unique key for this render to prevent audio caching
    render_key = str(int(time.time() * 1000))

    # Categorize segments by confidence level (1-indexed for display), excluding specials
    med_segments = [i + 1 for i, s in enumerate(segments)
                    if CONFIDENCE_MED <= s.match_score < CONFIDENCE_HIGH and s.matched_ref not in ALL_SPECIAL_REFS]
    low_segments = [i + 1 for i, s in enumerate(segments)
                    if s.match_score < CONFIDENCE_MED and s.matched_ref not in ALL_SPECIAL_REFS]

    # Build header with confidence summary
    header_parts = []

    header_parts.append(f'<div class="segments-header">Found {len(segments)} segments</div>')

    # Combined review summary: merge medium and low confidence segments into one color-coded list
    low_set = set(low_segments)
    all_review = sorted(set(med_segments) | low_set)
    if all_review:
        def _span(n: int) -> str:
            css = "segment-low-text" if n in low_set else "segment-med-text"
            return f'<span class="{css}">{n}</span>'

        if len(all_review) <= REVIEW_SUMMARY_MAX_SEGMENTS:
            seg_html = ", ".join(_span(n) for n in all_review)
        else:
            seg_html = ", ".join(_span(n) for n in all_review[:REVIEW_SUMMARY_MAX_SEGMENTS])
            remaining = len(all_review) - REVIEW_SUMMARY_MAX_SEGMENTS
            seg_html += f" ... and {remaining} more"

        header_parts.append(
            f'<div class="segments-review-summary">'
            f'Needs review: {len(all_review)} (segments {seg_html})'
            f'</div>'
        )

    missing_segments = [i + 1 for i, s in enumerate(segments) if s.has_missing_words]
    if missing_segments:
        # Group consecutive segment numbers into pairs (only if same verse)
        missing_pairs = []
        i = 0
        while i < len(missing_segments):
            if i + 1 < len(missing_segments) and missing_segments[i + 1] == missing_segments[i] + 1:
                idx_a = missing_segments[i] - 1  # 0-based
                idx_b = missing_segments[i + 1] - 1
                ref_a = _parse_ref_endpoints(segments[idx_a].matched_ref)
                ref_b = _parse_ref_endpoints(segments[idx_b].matched_ref)
                if ref_a and ref_b and (ref_a[0], ref_a[1]) == (ref_b[0], ref_b[1]):
                    missing_pairs.append(f"{missing_segments[i]}/{missing_segments[i + 1]}")
                    i += 2
                    continue
            missing_pairs.append(str(missing_segments[i]))
            i += 1

        if len(missing_pairs) <= REVIEW_SUMMARY_MAX_SEGMENTS:
            pairs_display = ", ".join(missing_pairs)
        else:
            pairs_display = ", ".join(missing_pairs[:REVIEW_SUMMARY_MAX_SEGMENTS])
            remaining = len(missing_pairs) - REVIEW_SUMMARY_MAX_SEGMENTS
            pairs_display += f" ... and {remaining} more"

        header_parts.append(
            f'<div class="segments-review-summary">'
            f'Segments with missing words: <span class="segment-low-text">{len(missing_pairs)} (segments {pairs_display})</span>'
            f'</div>'
        )

    repeated_segments = [i + 1 for i, s in enumerate(segments) if s.has_repeated_words]
    if repeated_segments:
        if len(repeated_segments) <= REVIEW_SUMMARY_MAX_SEGMENTS:
            rep_display = ", ".join(str(n) for n in repeated_segments)
        else:
            rep_display = ", ".join(str(n) for n in repeated_segments[:REVIEW_SUMMARY_MAX_SEGMENTS])
            remaining = len(repeated_segments) - REVIEW_SUMMARY_MAX_SEGMENTS
            rep_display += f" ... and {remaining} more"

        header_parts.append(
            f'<div class="segments-review-summary">'
            f'Segments with repeated words: <span class="segment-med-text">{len(repeated_segments)} (segments {rep_display})</span>'
            f'</div>'
        )

    # Current split summary — derived from persisted split_group_id state so it
    # stays cumulative across mixed batch/manual split actions.
    split_group_ranges = []
    j = 0
    while j < len(segments):
        gid = segments[j].split_group_id
        if not gid:
            j += 1
            continue
        k = j
        while k + 1 < len(segments) and segments[k + 1].split_group_id == gid:
            k += 1
        if k > j:
            lo = j + 1  # 1-based for display
            hi = k + 1
            split_group_ranges.append(f"{lo}-{hi}" if hi > lo else f"{lo}")
        j = k + 1

    if split_group_ranges:
        split_group_ranges.sort(key=lambda s: int(s.split('-')[0]))
        if len(split_group_ranges) <= REVIEW_SUMMARY_MAX_SEGMENTS:
            ranges_display = ", ".join(split_group_ranges)
        else:
            ranges_display = ", ".join(split_group_ranges[:REVIEW_SUMMARY_MAX_SEGMENTS])
            remaining = len(split_group_ranges) - REVIEW_SUMMARY_MAX_SEGMENTS
            ranges_display += f" ... and {remaining} more"
        header_parts.append(
            f'<div class="segments-review-summary">'
            f'Split segments: <span class="segment-multiverse-text">{len(split_group_ranges)} groups ({ranges_display})</span>'
            f'</div>'
        )

    if split_report:
        failed_count = len(split_report.get("failed", []) or [])
        if failed_count:
            header_parts.append(
                f'<div class="segments-review-summary">'
                f'<span class="segment-low-text">{failed_count} segment(s) failed to split (MFA error)</span>'
                f'</div>'
            )

    html_parts = [
        f'<div class="segments-container" data-render-key="{render_key}" data-full-audio="{full_audio_url}">',
        "\n".join(header_parts),
    ]

    # Classify missing-word segments into pairs vs singles
    # Only pair consecutive segments if they share the same verse (same surah:ayah)
    missing_indices = [i for i, s in enumerate(segments) if s.has_missing_words]
    missing_in_pair = set()
    visited = set()
    for j in range(len(missing_indices)):
        idx = missing_indices[j]
        if idx in visited:
            continue
        if j + 1 < len(missing_indices) and missing_indices[j + 1] == idx + 1:
            ref_a = _parse_ref_endpoints(segments[idx].matched_ref)
            ref_b = _parse_ref_endpoints(segments[idx + 1].matched_ref)
            if ref_a and ref_b and (ref_a[0], ref_a[1]) == (ref_b[0], ref_b[1]):
                missing_in_pair.add(idx)
                missing_in_pair.add(idx + 1)
                visited.add(idx)
                visited.add(idx + 1)
                continue
        visited.add(idx)

    t_cards = time.time()

    # Precompute split-group runs: consecutive segments sharing the same
    # non-null split_group_id. {first_idx_of_run: last_idx_of_run, gid}
    split_group_runs = {}  # first_idx -> (last_idx, group_id)
    j = 0
    while j < len(segments):
        gid = segments[j].split_group_id
        if gid:
            k = j
            while k + 1 < len(segments) and segments[k + 1].split_group_id == gid:
                k += 1
            if k > j:
                split_group_runs[j] = (k, gid)
            j = k + 1
        else:
            j += 1

    skip_until = -1
    for idx, seg in enumerate(segments):
        if idx <= skip_until:
            continue

        # 1) Split-group run (rendered first — encloses the whole group).
        if idx in split_group_runs:
            last_idx, _gid = split_group_runs[idx]
            html_parts.append(f'<div class="split-group" data-split-group-id="{_gid}" data-split-group-start="{idx}">')
            html_parts.append(
                '<div class="split-group-header">'
                '<div class="split-group-tag">Split</div>'
                f'<button class="undo-split-btn" data-segment="{idx}" data-split-group-id="{_gid}">Undo split</button>'
                '</div>'
            )
            for k in range(idx, last_idx + 1):
                in_pair = k in missing_in_pair and (k + 1) in missing_in_pair
                html_parts.append(render_segment_card(segments[k], k,
                                                      full_audio_url, render_key, segment_dir,
                                                      in_missing_pair=in_pair))
            html_parts.append('</div>')
            skip_until = last_idx
            continue

        # 2) Missing-words pair
        if idx in missing_in_pair and (idx + 1) in missing_in_pair:
            seg_b = segments[idx + 1]
            html_parts.append('<div class="missing-words-group">')
            html_parts.append('<div class="missing-words-group-tag">Missing Words</div>')
            html_parts.append(render_segment_card(seg, idx, full_audio_url, render_key, segment_dir, in_missing_pair=True))
            html_parts.append(render_segment_card(seg_b, idx + 1, full_audio_url, render_key, segment_dir, in_missing_pair=True))
            html_parts.append('</div>')
            skip_until = idx + 1
            continue

        # 3) Regular card
        html_parts.append(render_segment_card(seg, idx, full_audio_url, render_key, segment_dir))

    html_parts.append('</div>')
    print(f"[PROFILE] Segment cards: {time.time() - t_cards:.3f}s ({len(segments)} cards, HTML only)")

    return "\n".join(html_parts)



def is_end_of_verse(matched_ref: str) -> bool:
    """
    Check if a reference ends at the last word of a verse.
    Expects formats like "2:255:1-2:255:5" or "2:255:5".
    """
    if not matched_ref or ":" not in matched_ref:
        return False

    try:
        # Take the end part of the range (or the single ref)
        end_ref = matched_ref.split("-")[-1]
        parts = end_ref.split(":")
        if len(parts) < 3:
            return False

        surah = int(parts[0])
        ayah = int(parts[1])
        word = int(parts[2])

        verse_word_counts = _load_verse_word_counts()
        if surah not in verse_word_counts:
            return False

        num_words = verse_word_counts[surah].get(ayah, 0)
        return word >= num_words
    except Exception as e:
        print(f"Error checking end of verse: {e}")

    return False
