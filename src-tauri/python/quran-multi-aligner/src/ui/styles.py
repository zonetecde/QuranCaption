"""CSS styles for the Quran Aligner Gradio interface."""

from config import (
    ANIM_WORD_COLOR,
    QURAN_TEXT_SIZE_PX, ARABIC_WORD_SPACING,
    MEGA_TEXT_SIZE_DEFAULT, MEGA_LINE_SPACING_DEFAULT,
    MEGA_WORD_SPACING_DEFAULT, MEGA_SURAH_LIGATURE_SIZE,
)
from data.font_data import DIGITAL_KHATT_FONT_B64, SURAH_NAME_FONT_B64


def build_css() -> str:
    """Return the complete CSS string for the Gradio interface."""
    return f"""
    /* Font faces */
    @font-face {{
        font-family: 'DigitalKhatt';
        src: url(data:font/otf;base64,{DIGITAL_KHATT_FONT_B64}) format('opentype');
        font-weight: normal;
        font-style: normal;
    }}
    @font-face {{
        font-family: 'SurahName';
        src: url(data:font/truetype;base64,{SURAH_NAME_FONT_B64}) format('truetype');
        font-weight: normal;
        font-style: normal;
    }}

    .arabic-text {{
        font-family: 'DigitalKhatt', 'Traditional Arabic', sans-serif;
        direction: rtl;
        text-align: right;
    }}

    /* Prevent output area from being in a scrolling box */
    .gradio-container .prose {{
        max-height: none !important;
    }}
    .output-html {{
        max-height: none !important;
        overflow: visible !important;
    }}

    /* Segment cards - theme adaptive */
    .segment-card {{
        border-radius: 8px;
        padding: 12px 16px;
        margin-bottom: 12px;
        border: 2px solid;
    }}
    .segment-header {{
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }}
    .segment-title {{
        font-size: 13px;
        opacity: 0.9;
    }}
    .segment-badges {{
        display: flex;
        gap: 6px;
        align-items: center;
    }}
    .segment-badge {{
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: bold;
    }}
    .segment-audio {{
        margin: 8px 0;
        display: flex;
        align-items: center;
        gap: 8px;
    }}
    .segment-audio audio {{
        flex: 1;
        height: 32px;
        border-radius: 4px;
    }}

    /* Lazy play button (replaces <audio controls> until clicked) */
    .play-btn {{
        flex: 1;
        height: 32px;
        border-radius: 4px;
        border: 1px solid var(--border-color-primary, #ddd);
        background: var(--block-background-fill, #f7f7f7);
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
    }}
    .play-btn:hover {{ background: var(--block-background-fill-secondary, #eee); }}

    /* Make color picker popup overlay instead of pushing content down */
    .gradio-container .color-picker {{
        position: relative;
        overflow: visible !important;
    }}
    .gradio-container .color-picker .overflow-hidden,
    .gradio-container .color-picker > div:last-child:not(:first-child) {{
        position: absolute;
        z-index: 100;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border-radius: 8px;
        overflow: visible !important;
        max-height: none !important;
    }}
    .gradio-container .color-picker .overflow-hidden {{
        overflow: visible !important;
    }}
    .gradio-container .color-picker *,
    .gradio-container .color-picker div {{
        overflow: visible !important;
        max-height: none !important;
        scrollbar-width: none !important;
    }}
    .gradio-container .color-picker *::-webkit-scrollbar {{
        display: none !important;
    }}
    /* Ensure all color-picker ancestors allow overflow for absolute popup */
    #anim-settings-accordion,
    #anim-settings-accordion > *,
    #anim-style-row,
    #anim-style-row > * {{
        overflow: visible !important;
    }}


    /* Animate button */
    .animate-btn {{
        background: #4a90d9 !important;
        color: white !important;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        white-space: nowrap;
    }}
    .animate-btn:hover:not(:disabled) {{ background: #357abd !important; }}
    .animate-btn.active {{ background: #dc3545 !important; }}
    .animate-btn:disabled {{ background: #888 !important; cursor: not-allowed; opacity: 0.5; }}

    /* Make the HTML wrapper inside ts-row match the Gradio Button wrapper */
    #ts-row > .gr-html {{
        padding: 0;
        margin: 0;
        min-width: 0;
        flex: 1 1 0%;
    }}
    #ts-row > div:has(> .animate-all-btn) {{
        padding: 0;
        margin: 0;
        min-width: 0;
        flex: 1 1 0%;
    }}

    /* Animate All button — matches Gradio lg button sizing */
    .animate-all-btn {{
        display: block;
        width: 100%;
        background: var(--button-primary-background-fill, #f97316) !important;
        color: var(--button-primary-text-color, white) !important;
        border: var(--button-primary-border, none);
        padding: var(--size-2, 0.5rem) var(--size-4, 1rem);
        border-radius: var(--button-large-radius, var(--radius-lg, 8px));
        cursor: pointer;
        font-size: var(--button-large-text-size, var(--text-lg, 1.125rem));
        font-weight: var(--button-large-text-weight, 600);
        box-sizing: border-box;
        line-height: var(--line-md, 1.5);
        min-height: var(--size-10, 40px);
    }}
    .animate-all-btn:hover:not(:disabled) {{ background: var(--button-primary-background-fill-hover, #ea6c10) !important; }}
    .animate-all-btn.active {{ background: #dc3545 !important; }}
    .animate-all-btn:disabled {{ background: #888 !important; cursor: not-allowed; opacity: 0.5; }}

    /* Mega card for Animate All */
    .mega-card {{
        font-family: 'DigitalKhatt', 'Traditional Arabic', sans-serif;
        font-size: {MEGA_TEXT_SIZE_DEFAULT}px;
        direction: rtl;
        text-align: justify;
        line-height: {MEGA_LINE_SPACING_DEFAULT};
        word-spacing: {MEGA_WORD_SPACING_DEFAULT}em;
        padding: 16px;
        border-radius: 8px;
        background: var(--block-background-fill);
        max-height: 70vh;
        overflow-y: auto;
        scrollbar-color: rgba(255,255,255,0.2) transparent;
    }}
    .mega-card::-webkit-scrollbar {{ width: 8px; }}
    .mega-card::-webkit-scrollbar-track {{ background: transparent; }}
    .mega-card::-webkit-scrollbar-thumb {{ background: rgba(255,255,255,0.2); border-radius: 4px; }}
    .mega-card::-webkit-scrollbar-thumb:hover {{ background: rgba(255,255,255,0.35); }}
    .mega-text-flow {{
        display: inline;
    }}
    .mega-special-line {{
        display: block;
        text-align: center;
        margin: 8px 0;
        opacity: 0.7;
        font-size: 0.85em;
    }}
    .mega-surah-separator {{
        display: block;
        text-align: center;
        margin: 8px 0 2px;
        padding: 4px 0 0;
        border-top: 1px solid rgba(255,255,255,0.1);
        opacity: 0.8;
        font-family: 'SurahName', sans-serif;
        font-feature-settings: "liga" 1;
        font-size: {MEGA_SURAH_LIGATURE_SIZE}em;
        line-height: 1.2;
        letter-spacing: normal;
    }}
    .segment-card.hidden-for-mega {{ display: none; }}

    .mega-top-bar {{
        display: flex; justify-content: center; gap: 8px;
        margin-top: 12px; margin-bottom: 8px;
    }}
    .mega-top-bar .animate-all-btn {{
        width: auto; min-width: 0; min-height: auto;
        padding: 4px 12px;
        font-size: 12px; font-weight: bold;
        border-radius: 4px;
        line-height: normal;
        box-sizing: border-box;
        border: none;
        height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }}
    .mega-exit-btn {{
        background: #6c757d;
        color: white;
        border: none;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        min-width: 0; min-height: auto;
        line-height: normal;
        box-sizing: border-box;
        height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }}
    .mega-exit-btn:hover {{ background: #5a6268; }}
    .mega-speed-select {{
        /* Use Gradio's theme-aware variables */
        background: var(--input-background-fill) !important;
        color: var(--body-text-color) !important;
        border: var(--input-border-width) solid var(--input-border-color) !important;
        border-radius: var(--input-radius) !important;
        /* Typography from Gradio */
        font-size: var(--input-text-size) !important;
        font-family: var(--font) !important;
        /* Layout */
        padding: var(--input-padding) !important;
        height: 48px !important;
        min-width: 70px;
        box-sizing: border-box;
        /* Dropdown styling */
        cursor: pointer;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        /* Custom dropdown arrow using theme color */
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill='%236b7280' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E") !important;
        background-repeat: no-repeat !important;
        background-position: right 6px center !important;
        background-size: 16px !important;
        padding-right: 28px !important;
    }}
    .mega-speed-select:hover {{
        border-color: var(--input-border-color-hover) !important;
    }}
    .mega-speed-select:focus {{
        border-color: var(--input-border-color-focus) !important;
        outline: none;
        box-shadow: var(--input-shadow-focus);
    }}
    .mega-speed-select option {{
        background: var(--input-background-fill);
        color: var(--body-text-color);
    }}
    .mega-tip {{
        text-align: center; color: #b0b0b0; font-size: 0.95em;
        padding: 8px 16px; margin-bottom: 6px;
        background: rgba(255,255,255,0.05); border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.08);
        width: fit-content; margin-left: auto; margin-right: auto;
    }}

    /* Word/char animation coloring — all modes use the window engine (JS-driven inline opacity) */
    :root {{ --anim-word-color: {ANIM_WORD_COLOR}; }}
    .word, .char {{
        color: inherit;
    }}
    .word.active, .char.active, .word.active .char {{
        color: var(--anim-word-color);
    }}
    /* Window engine: all hidden by default; JS sets inline opacity for visible window */
    .anim-window .word {{ opacity: 0; }}
    .anim-window .word.active {{ opacity: 1; }}
    /* Character-level Window */
    .anim-chars.anim-window .word {{ opacity: 1 !important; }}
    .anim-chars.anim-window .char {{ opacity: 0; }}
    .anim-chars.anim-window .char.active {{ opacity: 1; }}
    /* Clickable words and verse markers in mega card */
    .mega-text-flow .word {{ cursor: pointer; }}
    .mega-text-flow .verse-marker {{ cursor: pointer; }}

    /* Allow "All" hint below slider track to be visible */
    #anim-window-prev, #anim-window-after {{ overflow: visible !important; padding-bottom: 1.2em; }}
    #anim-window-prev *, #anim-window-after * {{ overflow: visible !important; }}
    #anim-settings-accordion .block {{ border: none; }}
    #anim-settings-accordion .color-picker {{ border: none !important; }}
    #anim-settings-accordion .color-picker .block {{ border: none !important; }}

    /* Merge style/granularity/color into one unified row */
    #anim-style-row {{
        gap: 0 !important;
        border: 1px solid var(--border-color-primary, #ddd);
        border-radius: var(--radius-lg, 8px);
        overflow: visible;
    }}
    #anim-style-row > div {{
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
    }}
    /* Side-by-side label + controls for animation settings */
    #anim-style-row fieldset,
    #anim-style-row > div:has(> .dialog-button) {{
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 8px;
    }}
    #anim-style-row .block-title,
    #anim-style-row fieldset > span:first-child {{
        white-space: nowrap;
        min-width: fit-content;
        margin: 0 !important;
        font-size: 0.9em;
    }}

    .segment-text {{
        font-family: 'DigitalKhatt', 'Traditional Arabic', sans-serif;
        font-size: {QURAN_TEXT_SIZE_PX}px;
        direction: rtl;
        text-align: right;
        line-height: 1.8;
        word-spacing: {ARABIC_WORD_SPACING};
        padding: 8px;
        border-radius: 4px;
        background: var(--block-background-fill);
    }}
    .segment-error {{
        font-size: 12px;
        margin-top: 4px;
        color: var(--error-text-color, #dc3545);
    }}
    .no-match {{
        opacity: 0.5;
    }}
    .no-segments {{
        text-align: center;
        opacity: 0.6;
        padding: 40px;
    }}
    .segments-header {{
        font-weight: bold;
        margin-bottom: 16px;
    }}


    /* Confidence colors - light mode */
    .segment-high {{ background: #d4edda; border-color: #28a745; }}
    .segment-med {{ background: #fff3cd; border-color: #ffc107; }}
    .segment-low {{ background: #f8d7da; border-color: #dc3545; }}
    .segment-high-badge {{ background: #28a745; }}
    .segment-med-badge {{ background: #ffc107; color: #333 !important; }}
    .segment-low-badge {{ background: #dc3545; }}
    .segment-underseg {{ background: #ffe5cc; border-color: #ff8c00; }}
    .segment-underseg-badge {{ background: #ff8c00; }}
    .segment-special {{ background: #e8eaf6; border-color: #5c6bc0; border-style: dashed; }}
    .segment-special-badge {{ background: #5c6bc0; }}

    /* Review summary text colors */
    .segments-review-summary {{ margin-bottom: 8px; font-size: 14px; }}
    .segment-med-text {{ color: #856404; }}
    .segment-low-text {{ color: #721c24; }}
    .segment-underseg-text {{ color: #b35900; }}
    @media (prefers-color-scheme: dark) {{
        .segment-med-text {{ color: #ffc107; }}
        .segment-low-text {{ color: #f8d7da; }}
        .segment-underseg-text {{ color: #ff8c00; }}
    }}
    .dark .segment-med-text {{ color: #ffc107; }}
    .dark .segment-low-text {{ color: #f8d7da; }}
    .dark .segment-underseg-text {{ color: #ff8c00; }}

    /* Confidence colors - dark mode */
    @media (prefers-color-scheme: dark) {{
        .segment-high {{ background: rgba(40, 167, 69, 0.2); border-color: #28a745; }}
        .segment-med {{ background: rgba(255, 193, 7, 0.2); border-color: #ffc107; }}
        .segment-low {{ background: rgba(220, 53, 69, 0.2); border-color: #dc3545; }}
        .segment-underseg {{ background: rgba(255, 140, 0, 0.2); border-color: #ff8c00; }}
        .segment-special {{ background: rgba(92, 107, 192, 0.2); border-color: #5c6bc0; border-style: dashed; }}
    }}
    /* Also support Gradio's dark class */
    .dark .segment-high {{ background: rgba(40, 167, 69, 0.2); border-color: #28a745; }}
    .dark .segment-med {{ background: rgba(255, 193, 7, 0.2); border-color: #ffc107; }}
    .dark .segment-low {{ background: rgba(220, 53, 69, 0.2); border-color: #dc3545; }}
    .dark .segment-underseg {{ background: rgba(255, 140, 0, 0.2); border-color: #ff8c00; }}
    .dark .segment-special {{ background: rgba(92, 107, 192, 0.2); border-color: #5c6bc0; border-style: dashed; }}

    """
