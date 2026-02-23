"""Segment rendering and text formatting helpers."""
import json
import time
import wave
import io
import base64
import unicodedata
from pathlib import Path

import numpy as np

from config import (
    CONFIDENCE_HIGH, CONFIDENCE_MED,
    UNDERSEG_MIN_WORDS, UNDERSEG_MIN_AYAH_SPAN, UNDERSEG_MIN_DURATION,
    REVIEW_SUMMARY_MAX_SEGMENTS, AUDIO_PRELOAD_COUNT,
    SURAH_INFO_PATH,
)
from src.core.segment_types import SegmentInfo
from src.alignment.special_segments import ALL_SPECIAL_REFS


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


def check_undersegmented(matched_ref: str, duration: float) -> bool:
    """Check if a segment is potentially undersegmented.

    Criteria: (word_count >= threshold OR ayah_span >= threshold) AND duration >= threshold.
    """
    if duration < UNDERSEG_MIN_DURATION:
        return False
    word_count, ayah_span = get_segment_word_stats(matched_ref)
    return word_count >= UNDERSEG_MIN_WORDS or ayah_span >= UNDERSEG_MIN_AYAH_SPAN


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

def _wrap_word_with_chars(word_text, pos=None):
    """Wrap a word in <span class="word"> with nested <span class="char"> per letter group."""
    # Insert ZWSP before dagger alef so it can be highlighted independently
    spans = []
    for g in split_into_char_groups(word_text):
        if g.startswith(DAGGER_ALEF):
            spans.append(f'<span class="char">{ZWSP}{g}</span>')
        else:
            spans.append(f'<span class="char">{g}</span>')
    char_spans = "".join(spans)
    pos_attr = f' data-pos="{pos}"' if pos else ''
    return f'<span class="word"{pos_attr}>{char_spans}</span>'


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
        parts.append(_wrap_word_with_chars(w.display_text, pos=f"{w.surah}:{w.ayah}:{w.word}"))
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


def render_segment_card(seg: SegmentInfo, idx: int, audio_int16: np.ndarray = None, sample_rate: int = 0, render_key: str = "", segment_dir: Path = None, audio_preload: str = "metadata", audio_inline: bool = False) -> str:
    """Render a single segment as an HTML card with optional audio player.

    Args:
        seg: Segment info
        idx: Segment index
        audio_int16: Full audio as int16 array for writing per-segment WAV files
        sample_rate: Audio sample rate in Hz
        render_key: Unique key to prevent browser caching between renders
        segment_dir: Directory to write segment WAV files into
    """
    is_special = seg.matched_ref in ALL_SPECIAL_REFS
    confidence_class = get_confidence_class(seg.match_score)
    confidence_badge_class = confidence_class  # preserve original for badge color
    if is_special:
        confidence_class = "segment-special"
    elif seg.has_missing_words:
        confidence_class = "segment-low"
    elif seg.potentially_undersegmented and confidence_class != "segment-low":
        confidence_class = "segment-underseg"

    timestamp = f"{format_timestamp(seg.start_time)} - {format_timestamp(seg.end_time)}"
    duration = seg.end_time - seg.start_time

    # Format reference (simplify same-verse refs)
    ref_display = simplify_ref(seg.matched_ref) if seg.matched_ref else ""

    # Confidence percentage with label
    confidence_pct = f"Confidence: {seg.match_score:.0%}"

    # Undersegmented badge
    underseg_badge = ""
    if seg.potentially_undersegmented:
        underseg_badge = '<div class="segment-badge segment-underseg-badge">Potentially Undersegmented</div>'

    # Missing words badge
    missing_badge = ""
    if seg.has_missing_words:
        missing_badge = '<div class="segment-badge segment-low-badge">Missing Words</div>'

    # Error display
    error_html = ""
    if seg.error:
        error_html = f'<div class="segment-error">{seg.error}</div>'

    # Audio player HTML — each segment gets its own WAV file served by Gradio.
    audio_html = ""
    if audio_int16 is not None and sample_rate > 0 and segment_dir is not None:
        audio_src = encode_segment_audio(audio_int16, sample_rate, seg.start_time, seg.end_time, segment_dir, idx, inline=audio_inline)
        # Add animate button only if segment has a Quran verse ref (word spans for animation).
        # Basmala/Isti'adha get animate because they have indexed word spans for MFA.
        # Transition segments (Amin, Takbir, Tahmeed) don't.
        animate_btn = ""
        _ANIMATABLE_SPECIALS = {"Basmala", "Isti'adha"}
        if seg.matched_ref and (seg.matched_ref not in ALL_SPECIAL_REFS or seg.matched_ref in _ANIMATABLE_SPECIALS):
            animate_btn = f'<button class="animate-btn" data-segment="{idx}" disabled>Animate</button>'
        audio_html = f'''
        <div class="segment-audio">
            <audio data-src="{audio_src}" preload="none"
                   style="display:none; width: 100%; height: 32px;">
            </audio>
            <button class="play-btn">&#9654;</button>
            {animate_btn}
        </div>
        '''

    # Build matched text with verse markers at all verse boundaries
    BASMALA_TEXT = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم"
    ISTIATHA_TEXT = "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم"
    _SPECIAL_PREFIXES = [ISTIATHA_TEXT, BASMALA_TEXT]

    # Helper to wrap words in spans
    def wrap_words_in_spans(text):
        return " ".join(_wrap_word_with_chars(w) for w in text.split())

    if seg.matched_ref:
        # Generate text with markers from the index
        text_html = get_text_with_markers(seg.matched_ref)
        if text_html and seg.matched_text:
            # Check for any special prefix (fused or forward-merged)
            for _sp_name, _sp in [("Isti'adha", ISTIATHA_TEXT),
                                   ("Basmala", BASMALA_TEXT)]:
                if seg.matched_text.startswith(_sp):
                    mfa_prefix = f"{_sp_name}+{seg.matched_ref}"
                    words = _sp.replace(" ۝ ", " ").split()
                    prefix_html = " ".join(
                        _wrap_word_with_chars(w, pos=f"{mfa_prefix}:0:0:{i+1}")
                        for i, w in enumerate(words)
                    )
                    text_html = prefix_html + " " + text_html
                    break
        elif not text_html:
            # Special ref (Basmala/Isti'adha): wrap words with indexed data-pos
            # so MFA timestamps can be injected later
            if seg.matched_ref and seg.matched_text:
                words = seg.matched_text.replace(" \u06dd ", " ").split()
                text_html = " ".join(
                    _wrap_word_with_chars(w, pos=f"{seg.matched_ref}:0:0:{i+1}")
                    for i, w in enumerate(words)
                )
            else:
                text_html = seg.matched_text or ""
    elif seg.matched_text:
        # Special segments (Basmala/Isti'adha) have text but no ref
        text_html = wrap_words_in_spans(seg.matched_text)
    else:
        text_html = ""

    if is_special:
        confidence_badge = f'<div class="segment-badge segment-special-badge">{seg.matched_ref}</div>'
    elif seg.has_missing_words:
        confidence_badge = ""
    else:
        confidence_badge = f'<div class="segment-badge {confidence_badge_class}-badge">{confidence_pct}</div>'

    # Build inline header: Segment N | ref | duration | time range
    header_parts = [f"Segment {idx + 1}"]
    if ref_display:
        header_parts.append(ref_display)
    header_parts.append(f"{duration:.1f}s")
    header_parts.append(timestamp)
    header_text = " | ".join(header_parts)

    html = f'''
    <div class="segment-card {confidence_class}" data-duration="{duration:.3f}" data-segment-idx="{idx}" data-matched-ref="{seg.matched_ref or ''}" data-start-time="{seg.start_time:.4f}" data-end-time="{seg.end_time:.4f}">
        <div class="segment-header">
            <div class="segment-title">{header_text}</div>
            <div class="segment-badges">
                {underseg_badge}
                {confidence_badge}
                {missing_badge}
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


def render_segments(segments: list, audio_int16: np.ndarray = None, sample_rate: int = 0, segment_dir: Path = None, skip_full_audio: bool = False) -> str:
    """Render all segments as HTML with optional audio players.

    Args:
        segments: List of SegmentInfo objects
        audio_int16: Full audio as int16 array for writing per-segment WAV files
        sample_rate: Audio sample rate in Hz
        segment_dir: Directory containing per-segment WAV files
    """
    if not segments:
        return '<div class="no-segments">No segments detected</div>'

    # Generate unique key for this render to prevent audio caching
    render_key = str(int(time.time() * 1000))

    # Write full audio file for unified megacard playback
    full_audio_url = ""
    if audio_int16 is not None and sample_rate > 0 and segment_dir and not skip_full_audio:
        full_path = segment_dir / "full.wav"
        with wave.open(str(full_path), 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(audio_int16.tobytes())
        full_audio_url = f"/gradio_api/file={full_path}"

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
        # Group consecutive segment numbers into pairs (gaps always flag both neighbors)
        missing_pairs = []
        i = 0
        while i < len(missing_segments):
            if i + 1 < len(missing_segments) and missing_segments[i + 1] == missing_segments[i] + 1:
                missing_pairs.append(f"{missing_segments[i]}/{missing_segments[i + 1]}")
                i += 2
            else:
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

    underseg_segments = [i + 1 for i, s in enumerate(segments) if s.potentially_undersegmented]
    if underseg_segments:
        if len(underseg_segments) <= REVIEW_SUMMARY_MAX_SEGMENTS:
            underseg_display = ", ".join(str(n) for n in underseg_segments)
        else:
            underseg_display = ", ".join(str(n) for n in underseg_segments[:REVIEW_SUMMARY_MAX_SEGMENTS])
            remaining = len(underseg_segments) - REVIEW_SUMMARY_MAX_SEGMENTS
            underseg_display += f" ... and {remaining} more"

        header_parts.append(
            f'<div class="segments-review-summary">'
            f'Potentially undersegmented: <span class="segment-underseg-text">{len(underseg_segments)} (segments {underseg_display})</span>'
            f'</div>'
        )

    html_parts = [
        f'<div class="segments-container" data-render-key="{render_key}" data-full-audio="{full_audio_url}">',
        "\n".join(header_parts),
    ]

    for idx, seg in enumerate(segments):
        inline = idx < AUDIO_PRELOAD_COUNT
        preload = "auto" if inline else "metadata"
        html_parts.append(render_segment_card(seg, idx, audio_int16, sample_rate, render_key, segment_dir, audio_preload=preload, audio_inline=inline))

    html_parts.append('</div>')

    return "\n".join(html_parts)


def encode_segment_audio(
    audio_int16: np.ndarray, sample_rate: int,
    start_time: float, end_time: float,
    segment_dir: Path, segment_idx: int,
    inline: bool = False,
) -> str:
    """Write a segment's audio slice as a WAV file and return a src URL.

    Args:
        audio_int16: Full audio already converted to int16 (avoids per-segment conversion).
        sample_rate: Sample rate in Hz.
        start_time: Segment start in seconds.
        end_time: Segment end in seconds.
        segment_dir: Directory to write the WAV file into.
        segment_idx: Segment index (used for filename).
        inline: If True, return a base64 data URI instead of a file URL.

    Returns a ``data:`` URI (inline) or ``/gradio_api/file=`` URL.
    """
    start_sample = int(start_time * sample_rate)
    end_sample = int(end_time * sample_rate)
    segment_audio = audio_int16[start_sample:end_sample]

    # Always write WAV to disk (needed by MFA timestamp computation)
    path = segment_dir / f"seg_{segment_idx}.wav"
    with wave.open(str(path), 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(segment_audio.tobytes())

    if inline:
        with open(path, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
        return f"data:audio/wav;base64,{b64}"

    return f"/gradio_api/file={path}"


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
