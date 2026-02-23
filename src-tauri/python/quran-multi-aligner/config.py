"""
Configuration settings for the Segments App.
"""
import os
from pathlib import Path

# HF Spaces detection
IS_HF_SPACE = os.environ.get("SPACE_ID") is not None
DEV_TAB_VISIBLE = not IS_HF_SPACE

# Get project root directory
PROJECT_ROOT = Path(__file__).parent.absolute()

# Port for local development
PORT = 6902

# =============================================================================
# Audio settings
# =============================================================================

RESAMPLE_TYPE = "soxr_lq"
SEGMENT_AUDIO_DIR = Path("/tmp/segments")   # WAV files written here per request
AUDIO_PRELOAD_COUNT = 5                     # First N segments use preload="auto"
DELETE_CACHE_FREQUENCY = 3600*5             # Gradio cache cleanup interval (seconds)
DELETE_CACHE_AGE = 3600*5                   # Delete cached files older than this (seconds)

# =============================================================================
# Session API settings
# =============================================================================

SESSION_DIR = Path("/tmp/aligner_sessions")  # Per-session cached data (audio, VAD, metadata)
SESSION_EXPIRY_SECONDS = 3600*5              # 5 hours — matches DELETE_CACHE_AGE

# =============================================================================
# Model and data paths
# =============================================================================

# VAD segmenter model
SEGMENTER_MODEL = "obadx/recitation-segmenter-v2"

# Phoneme ASR models (wav2vec2 CTC)
PHONEME_ASR_MODELS = {
    "Base": "hetchyy/r15_95m",
    "Large": "hetchyy/r7",
}
PHONEME_ASR_MODEL_DEFAULT = "Base"  
PHONEME_ASR_MODEL = PHONEME_ASR_MODELS[PHONEME_ASR_MODEL_DEFAULT]

DATA_PATH = PROJECT_ROOT / "data"
SURAH_INFO_PATH = DATA_PATH / "surah_info.json"

# Quran script paths
QURAN_SCRIPT_PATH_COMPUTE = DATA_PATH / "qpc_hafs.json"
QURAN_SCRIPT_PATH_DISPLAY = DATA_PATH / "digital_khatt_v2_script.json"

# Pre-built phoneme cache (all 114 chapters)
PHONEME_CACHE_PATH = DATA_PATH / "phoneme_cache.pkl"

# Phoneme n-gram index for anchor detection
NGRAM_SIZE = 5
NGRAM_INDEX_PATH = DATA_PATH / f"phoneme_ngram_index_{NGRAM_SIZE}.pkl"

# =============================================================================
# Inference settings
# =============================================================================

def get_vad_duration(minutes):
    """GPU seconds needed for VAD based on audio minutes.

    VAD GPU time scales linearly at ~0.28s per audio minute.
    Tuned from 50-run log analysis (Feb 2026): previous leases were tight
    at 30-60 min (15s lease vs 17s actual) and 60-120 min (25s vs 26s).
    """
    if minutes > 180:
        return 60
    elif minutes > 120:
        return 45      # was 40 — 137 min audio hit 38.3s (95% of old lease)
    elif minutes > 60:
        return 30      # was 25 — 89 min audio hit 25.8s (exceeded old lease)
    elif minutes > 30:
        return 20      # was 15 — 58 min audio hit 17s (exceeded old lease)
    elif minutes > 15:
        return 10
    else:
        return 5

def get_asr_duration(minutes, model_name="Base"):
    """GPU seconds needed for ASR.

    ASR GPU time is nearly constant regardless of audio length due to batch
    processing — no range tiers needed.  Tuned from 50-run log analysis
    (Feb 2026): Base uses 0.2-2.5s (warm), Large uses 0.8-5.6s (warm).
    """
    if model_name == "Large":
        return 10      # max warm 5.6s, cold start 10.4s
    return 3           # max warm 2.5s, cold start 5.6s

# Batching strategy
BATCHING_STRATEGY = "dynamic"  # "naive" (fixed count) or "dynamic" (seconds + pad waste)

# Naive batching
INFERENCE_BATCH_SIZE = 32      # Fixed segments per batch (used when BATCHING_STRATEGY="naive")

# Dynamic batching constraints
MAX_BATCH_SECONDS = 600      # Max total audio seconds per batch (sum of durations)
MAX_PAD_WASTE = 0.2          # Max fraction of padded tensor that is wasted (0=no waste, 1=all waste)
MIN_BATCH_SIZE = 8           # Minimum segments per batch (prevents underutilization)

# Model precision
DTYPE = "float16"
TORCH_COMPILE = True  # Apply torch.compile() to GPU models (reduce-overhead mode)

# AOTInductor compilation (ZeroGPU optimization)
AOTI_ENABLED = True            # Enable AOT compilation for VAD model on HF Space
AOTI_MIN_AUDIO_MINUTES = 15    # Min audio duration for dynamic shapes
AOTI_MAX_AUDIO_MINUTES = 90    # Max audio duration for dynamic shapes
AOTI_HUB_ENABLED = True        # Enable Hub persistence (upload/download compiled models)
AOTI_HUB_REPO = "hetchyy/quran-aligner-aoti"  # Hub repo for compiled model cache

# =============================================================================
# Phoneme-based alignment settings
# =============================================================================

ANCHOR_SEGMENTS = 5                 # N-gram voting uses first N Quran segments
ANCHOR_RARITY_WEIGHTING = True      # Weight votes by 1/count (rarity); False = equal weight
ANCHOR_RUN_TRIM_RATIO = 0.2         # Trim leading/trailing ayahs whose weight < ratio * max weight in run
ANCHOR_TOP_CANDIDATES = 20          # Evaluate top N surahs by total weight for contiguous run comparison

# Edit operation costs (Levenshtein hyperparameters)
COST_SUBSTITUTION = 1.0             # Default phoneme substitution cost
COST_INSERTION = 1.0                # Insert phoneme from reference (R)
COST_DELETION = 0.8                 # Delete phoneme from ASR (P)

# Alignment thresholds (normalized edit distance: 0 = identical, 1 = completely different)
LOOKBACK_WORDS = 30                 # Window words to look back from pointer for starting positions
LOOKAHEAD_WORDS = 10                # Window words to look ahead after expected end position
MAX_EDIT_DISTANCE = 0.25            # Max normalized edit distance for valid ayah match
MAX_SPECIAL_EDIT_DISTANCE = 0.35    # Max normalized edit distance for Basmala/Isti'adha detection
MAX_TRANSITION_EDIT_DISTANCE = 0.45 # Max normalized edit distance for transition segments (Amin/Takbir/Tahmeed)
START_PRIOR_WEIGHT = 0.005          # Penalty per word away from expected position

# Failed Segments
RETRY_LOOKBACK_WORDS = 70           # Expanded lookback for retry tier 1+2
RETRY_LOOKAHEAD_WORDS = 40          # Expanded lookahead for retry tier 1+2
MAX_EDIT_DISTANCE_RELAXED = 0.5     # Relaxed threshold for retry tier 2
MAX_CONSECUTIVE_FAILURES = 2        # Re-anchor within surah after this many DP failures

# Debug output
ANCHOR_DEBUG = False                # Show detailed n-gram voting info (votes, top candidates)
PHONEME_ALIGNMENT_DEBUG = False     # Show detailed alignment info (R, P, edit costs)
PHONEME_ALIGNMENT_PROFILING = True  # Track and log timing breakdown (DP, window setup, etc.)

# =============================================================================
# Segmentation slider settings
# =============================================================================

# Segmentation presets: (min_silence_ms, min_speech_ms, pad_ms)
PRESET_MUJAWWAD = (600, 1500, 300)   # Slow / Mujawwad recitation
PRESET_MURATTAL = (200, 750, 100)    # Normal pace (default)
PRESET_FAST     = (75, 750, 40)     # Fast recitation

# Slider ranges (defaults come from PRESET_MURATTAL)
MIN_SILENCE_MIN = 25
MIN_SILENCE_MAX = 1000
MIN_SILENCE_STEP = 25

MIN_SPEECH_MIN = 500
MIN_SPEECH_MAX = 2000
MIN_SPEECH_STEP = 250

PAD_MIN = 0
PAD_MAX = 300
PAD_STEP = 25

# =============================================================================
# Confidence thresholds for color coding
# =============================================================================

CONFIDENCE_HIGH = 0.8    # >= this: Green
CONFIDENCE_MED = 0.6     # >= this: Yellow, below: Red
REVIEW_SUMMARY_MAX_SEGMENTS = 15  # Max segment numbers to list before truncating

# Undersegmentation detection thresholds
# Flagged when (word_count >= MIN_WORDS OR ayah_span >= MIN_AYAH_SPAN) AND duration >= MIN_DURATION
UNDERSEG_MIN_WORDS = 25         # Word count threshold
UNDERSEG_MIN_AYAH_SPAN = 2      # Ayah span threshold (segment crosses ayah boundary)
UNDERSEG_MIN_DURATION = 15      # Duration gate (seconds)

# =============================================================================
# MFA forced alignment (word-level timestamps via HF Space)
# =============================================================================

MFA_SPACE_URL = "https://hetchyy-quran-phoneme-mfa.hf.space"
MFA_TIMEOUT = 180

# =============================================================================
# Usage logging (pushed to HF Hub via ParquetScheduler)
# =============================================================================

USAGE_LOG_DATASET_REPO = "hetchyy/quran-aligner-logs"
USAGE_LOG_PUSH_INTERVAL_MINUTES = 240

# =============================================================================
# Progress bar settings
# =============================================================================

PROGRESS_PROCESS_AUDIO = {
    "preparing":        (0.00, "Preparing audio..."),
    "resampling":       (0.00, "Loading audio..."),
    "vad_asr":          (0.05, "Segmenting and transcribing..."),
    "asr":              (0.15, "Running ASR..."),
    "special_segments": (0.50, "Detecting special segments..."),
    "anchor":           (0.60, "Anchor detection..."),
    "matching":         (0.80, "Text matching..."),
    "building":         (0.90, "Building results..."),
    "done":             (1.00, "Done!"),
}

PROGRESS_RESEGMENT = {
    "resegment":        (0.00, "Resegmenting..."),
    "asr":              (0.15, "Running ASR..."),
    "special_segments": (0.50, "Detecting special segments..."),
    "anchor":           (0.60, "Anchor detection..."),
    "matching":         (0.80, "Text matching..."),
    "building":         (0.90, "Building results..."),
    "done":             (1.00, "Done!"),
}

PROGRESS_RETRANSCRIBE = {
    "retranscribe":     (0.00, "Retranscribing with {model} model..."),
    "asr":              (0.15, "Running ASR..."),
    "special_segments": (0.50, "Detecting special segments..."),
    "anchor":           (0.60, "Anchor detection..."),
    "matching":         (0.80, "Text matching..."),
    "building":         (0.90, "Building results..."),
    "done":             (1.00, "Done!"),
}

MFA_PROGRESS_SEGMENT_RATE = 0.05  # seconds per segment for progress bar animation

# =============================================================================
# UI settings
# =============================================================================

# Main layout column scales
LEFT_COLUMN_SCALE = 4
RIGHT_COLUMN_SCALE = 6

# Arabic font stack
ARABIC_FONT_STACK = "'DigitalKhatt', 'Traditional Arabic'"

QURAN_TEXT_SIZE_PX = 24  # Size for Quran text in segment cards
ARABIC_WORD_SPACING = "0.2em"  # Word spacing for Arabic text

# =============================================================================
# Animation settings
# =============================================================================

# Animation granularity
ANIM_GRANULARITIES = ["Words", "Characters"]
ANIM_GRANULARITY_DEFAULT = "Words"

ANIM_WORD_COLOR = "#49c3b3"                # Green highlight for active word
ANIM_STYLE_ROW_SCALES = (2, 6, 1, 1)       # Granularity, Style, Verse Only, Color

ANIM_OPACITY_PREV_DEFAULT = 0.3            # Default "before" opacity
ANIM_OPACITY_AFTER_DEFAULT = 0.3           # Default "after" opacity
ANIM_OPACITY_STEP = 0.1                    # Opacity slider step size

# Mega-card text styling sliders
MEGA_WORD_SPACING_MIN = 0.0
MEGA_WORD_SPACING_MAX = 1.0
MEGA_WORD_SPACING_STEP = 0.05
MEGA_WORD_SPACING_DEFAULT = 0.2            # matches ARABIC_WORD_SPACING

MEGA_TEXT_SIZE_MIN = 12
MEGA_TEXT_SIZE_MAX = 60
MEGA_TEXT_SIZE_STEP = 2
MEGA_TEXT_SIZE_DEFAULT = 30                # matches QURAN_TEXT_SIZE_PX
MEGA_SURAH_LIGATURE_SIZE = 2               # em — surah name ligature font size in megacard

MEGA_LINE_SPACING_MIN = 1.5
MEGA_LINE_SPACING_MAX = 3.0
MEGA_LINE_SPACING_STEP = 0.1
MEGA_LINE_SPACING_DEFAULT = 2              # matches mega-card line-height

# Window engine settings (all modes use the window engine internally)
ANIM_WINDOW_PREV_DEFAULT = 4               # Default number of visible previous words/chars
ANIM_WINDOW_AFTER_DEFAULT = 4              # Default number of visible after words/chars
ANIM_WINDOW_PREV_MIN = 0
ANIM_WINDOW_AFTER_MIN = 0
ANIM_WINDOW_PREV_MAX = 15
ANIM_WINDOW_AFTER_MAX = 15

# Presets map mode names to window engine parameter values
ANIM_DISPLAY_MODE_DEFAULT = "Reveal"
ANIM_DISPLAY_MODES = ["Reveal", "Fade", "Spotlight", "Isolate", "Consume", "Custom"]
ANIM_PRESETS = {
    "Reveal":    {
        "prev_opacity": 1.0,
        "prev_words": ANIM_WINDOW_PREV_MAX,
        "after_opacity": 0.0,
        "after_words": 0,
    },
    "Fade":      {
        "prev_opacity": 1.0,
        "prev_words": ANIM_WINDOW_PREV_MAX,
        "after_opacity": 0.3,
        "after_words": ANIM_WINDOW_AFTER_MAX,
    },
    "Spotlight": {
        "prev_opacity": 0.3,
        "prev_words": ANIM_WINDOW_PREV_MAX,
        "after_opacity": 0.3,
        "after_words": ANIM_WINDOW_AFTER_MAX,
    },
    "Isolate": {
        "prev_opacity": 0,
        "prev_words": 0,
        "after_opacity": 0,
        "after_words": 0,
    },
    "Consume": {
        "prev_opacity": 0,
        "prev_words": 0,
        "after_opacity": 0.3,
        "after_words": ANIM_WINDOW_AFTER_MAX,
    }
}