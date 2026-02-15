"""
Configuration for local Quran audio segmentation.
Matches the HuggingFace Space config for consistent results.
"""

from pathlib import Path
import os

# Get project root directory
PROJECT_ROOT = Path(__file__).parent.absolute()
DATA_PATH = PROJECT_ROOT / "data"


def get_data_path():
    """Get the data path, either local or from AppData."""
    if DATA_PATH.exists():
        return DATA_PATH

    # Fallback to AppData
    appdata = os.environ.get('APPDATA', os.path.expanduser('~'))
    return Path(appdata) / 'QuranCaption' / 'segmentation_data'


# Port for local development
PORT = 6902

# =============================================================================
# Model paths
# =============================================================================

# VAD segmenter model
SEGMENTER_MODEL = "obadx/recitation-segmenter-v2"

# Whisper model for Arabic ASR
WHISPER_MODEL = "tarteel-ai/whisper-base-ar-quran"

# =============================================================================
# Data paths (local to segments_app)
# =============================================================================

SURAH_INFO_PATH = get_data_path() / "surah_info.json"

# =============================================================================
# ZeroGPU settings
# =============================================================================


def get_gpu_duration(audio, sample_rate, min_silence_ms, min_speech_ms, pad_ms):
    """Dynamic GPU duration."""
    duration_seconds = len(audio) / sample_rate
    if duration_seconds > 5400:       # > 1.5 hours
        return 150
    elif duration_seconds > 3600:     # > 1 hour
        return 120
    elif duration_seconds > 1800:     # > 30 minutes
        return 90
    else:                             # < 30 minutes
        return 60


# Batch processing
INFERENCE_BATCH_SIZE = 512

# Maximum segments to embed audio players
MAX_AUDIO_EMBEDS = 500

# =============================================================================
# Text matching settings
# =============================================================================

# Special segments (Basmala/Isti'adha) - displayed with their own labels
SPECIAL_SEGMENTS = {
    "Basmala": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم",
    "Isti'adha": "أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم",
}
SPECIAL_MATCH_SCORE = 0.7           # Minimum F1 score for special segment match
SPECIAL_WORD_THRESHOLD = 0.55       # Word similarity threshold for special segments

ANCHOR_SEGMENTS = 5                 # Global search for first N segments
ANCHOR_MIN_SCORE = 0.7              # Minimum confidence to trust an anchor candidate
ANCHOR_TOP_K = 50                   # Max candidates per anchor segment
ANCHOR_ALIGN_SLACK = 1              # Allow small shift from anchor word position

MIN_MATCH_SCORE = 0.5               # Minimum overall confidence for accepting a match
WORD_MATCH_THRESHOLD = 0.45         # Fuzzy word similarity threshold
LOOKBACK_WORDS = 25                 # Words to look back from pointer for starting positions
LOOKAHEAD_WORDS = 15                # Words to look ahead for starting positions
WORD_SLACK = 5                      # +/- for ASR word count variance

MAX_CONSECUTIVE_FAILURES = 2        # Re-anchor after this many failures

# Debug/profiling
TEXT_MATCH_DEBUG = True             # Enable detailed text matching logging

# =============================================================================
# Segmentation slider settings
# =============================================================================

# Min silence duration (ms) - pause between segments
MIN_SILENCE_DEFAULT = 200
MIN_SILENCE_MIN = 20
MIN_SILENCE_MAX = 1000
MIN_SILENCE_STEP = 50

# Min speech duration (ms) - minimum segment length
MIN_SPEECH_DEFAULT = 1000
MIN_SPEECH_MIN = 500
MIN_SPEECH_MAX = 3000
MIN_SPEECH_STEP = 250

# Padding (ms) - added before/after timestamps
PAD_DEFAULT = 50
PAD_MIN = 0
PAD_MAX = 300
PAD_STEP = 25

# =============================================================================
# Confidence thresholds for color coding
# =============================================================================

CONFIDENCE_HIGH = 0.85   # >= this: Green
CONFIDENCE_MED = 0.7     # >= this: Yellow, below: Red

REVIEW_SUMMARY_MAX_SEGMENTS = 10  # Max segment numbers to list before truncating

# =============================================================================
# UI settings
# =============================================================================

# Arabic font stack
ARABIC_FONT_STACK = "'DigitalKhatt', 'Traditional Arabic', 'Scheherazade', 'Amiri', 'Noto Naskh Arabic', sans-serif"

QURAN_TEXT_SIZE_PX = 22  # Size for Quran text in segment cards
ARABIC_WORD_SPACING = "0.2em"  # Word spacing for Arabic text

# Paths for data files
def get_surah_info_path():
    return get_data_path() / "surah_info.json"


def get_quran_script_path():
    return get_data_path() / "digital_khatt_v2_script.json"
