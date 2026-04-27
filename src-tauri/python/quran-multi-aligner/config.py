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
URL_DOWNLOAD_DIR = Path("/tmp/url_downloads")  # Audio downloaded from URLs via yt-dlp
DEFAULT_INPUT_MODE = "Upload"                  # "Link", "Upload", or "Record"
DELETE_CACHE_FREQUENCY = 3600*5             # Gradio cache cleanup interval (seconds)
DELETE_CACHE_AGE = 3600*5                   # Delete cached files older than this (seconds)

# =============================================================================
# Session API settings
# =============================================================================

SESSION_DIR = Path("/tmp/aligner_sessions")  # Per-session cached data (audio, VAD, metadata)
SESSION_EXPIRY_SECONDS = 3600*5              # 5 hours — matches DELETE_CACHE_AGE

# =============================================================================
# CPU dispatch strategy — which path runs @gpu_with_fallback funcs when the
# user selects device=CPU (or when GPU quota is exhausted).
# =============================================================================

# Routing:
#   "subprocess" — spawn a local subprocess on the main Space (fast on zero-a10g,
#                  ~10s for 112.mp3 Base; isolates CUDA state). Requires main
#                  Space hardware to be ZeroGPU-capable.
#   "workers"    — dispatch to remote CPU Spaces listed in WORKER_SPACES
#                  (isolates load off main; ~40–80s per request on cpu-basic).
#   "both"       — prefer local subprocess (concurrency 1), overflow to remote.
#                  NOT IMPLEMENTED yet — reserved for future orchestration work.
CPU_STRATEGY = os.environ.get("CPU_STRATEGY", "subprocess").lower()

# Max seconds a subprocess CPU job can run before SIGKILL (used by "subprocess" and "both" strategies).
CPU_SUBPROCESS_TIMEOUT = int(os.environ.get("CPU_SUBPROCESS_TIMEOUT", str(3600 * 2)))

# Max concurrent CPU subprocesses on the main Space.
CPU_SUBPROCESS_CONCURRENCY = int(os.environ.get("CPU_SUBPROCESS_CONCURRENCY", "2"))

# CPU_WORKER_MODE — when CPU_STRATEGY="subprocess", chooses between:
#   "spawn"      — legacy: fork a fresh subprocess per request (cpu_subprocess.py).
#   "persistent" — new: route to a pool of long-lived workers (cpu_worker_pool.py).
# Semaphore capacity stays = CPU_SUBPROCESS_CONCURRENCY either way.
CPU_WORKER_MODE = os.environ.get("CPU_WORKER_MODE", "persistent").lower()

# Whether the persistent pool preloads ASR Large at boot. If False, Large is
# loaded on-demand inside the worker and cached there.
CPU_POOL_PRELOAD_LARGE = os.environ.get("CPU_POOL_PRELOAD_LARGE", "1") == "1"

# Model dtype for CPU inference.
#   "bfloat16" — default. Routes attention through PyTorch's chunked CPU flash
#                kernel (`_scaled_dot_product_flash_attention_for_cpu`), which
#                does NOT materialise the full `(batch, heads, seq, seq)` QK^T
#                tensor per layer. Avoids the L3-cache cliff that fp16 triggers
#                at large batch shapes (observed 24× slowdown on 22 min audio).
#                Measured ~32% faster than fp16 on the same input.
#   "float16"  — fast on CPUs with AVX512_FP16 (zero-a10g host) but CATASTROPHIC
#                on CPUs without it (cpu-basic workers: 10-100× slower) AND
#                hits the cache cliff at large batches even on supported CPUs.
#   "float32"  — safe fallback, ~2× slower than bf16 on modern hosts.
CPU_DTYPE = os.environ.get("CPU_DTYPE", "bfloat16").lower()

# =============================================================================
# CPU worker pool settings (remote dispatch to duplicate CPU Spaces)
# =============================================================================

# Comma-separated HF Space slugs, e.g. "owner/space-a,owner/space-b".
# Empty = no pool (dispatch falls back to local subprocess).
CPU_WORKER_SPACES = os.environ.get("WORKER_SPACES", "").strip()

# Audio encoding on the wire: "float32" | "int16" | "ogg". OGG is ~17x smaller
# than float32 for speech and fastest end-to-end at every tested size.
CPU_WORKER_TRANSPORT_DEFAULT = os.environ.get("CPU_TRANSPORT", "ogg").lower()

# Per-job HTTP read timeout (seconds). Long because CPU pipelines are slow and
# workers may cold-start from sleep.
CPU_WORKER_HTTP_TIMEOUT = int(os.environ.get("CPU_WORKER_TIMEOUT", str(3600 * 2)))

# Max wait for a free worker before failing with PoolExhaustedError. User-facing.
CPU_WORKER_ACQUIRE_TIMEOUT = int(os.environ.get("CPU_WORKER_ACQUIRE_TIMEOUT", "900")) # 15 mins

# Admission control: reject when busy_workers + queued_waiters exceeds this and
# no worker is immediately free. Prevents runaway pile-up under bursty load.
CPU_WORKER_MAX_QUEUE_DEPTH = int(os.environ.get("CPU_WORKER_MAX_QUEUE", "10"))

# Background thread ping interval for unhealthy workers (seconds).
CPU_WORKER_HEALTH_INTERVAL = int(os.environ.get("CPU_WORKER_HEALTH_INTERVAL", "600"))

# Max retry attempts on dispatch failure (retries land on a different worker if available).
CPU_WORKER_MAX_RETRIES = 1

# Idle-read timeout on the SSE stream from a worker. If no bytes arrive within
# this window, either the worker is stuck or the client has disconnected and
# we give the watchdog a chance to abort. Must be > longest silent compute block.
CPU_WORKER_SSE_IDLE_TIMEOUT = int(os.environ.get("CPU_WORKER_SSE_IDLE_TIMEOUT", "120"))

# Client-disconnect poll interval (seconds) for the cancel watchdog thread.
CPU_WORKER_CANCEL_POLL_INTERVAL = float(os.environ.get("CPU_WORKER_CANCEL_POLL_INTERVAL", "2.0"))

# =============================================================================
# Model and data paths
# =============================================================================

# VAD segmenter model
SEGMENTER_MODEL = "obadx/recitation-segmenter-v2"
# Chunks-per-forward for segment_recitations.
SEGMENTER_BATCH_SIZE = 8

# Phoneme ASR models (wav2vec2 CTC)
PHONEME_ASR_MODELS = {
    "Base": "hetchyy/r15_95m",
    "Large": "hetchyy/r7",
}
PHONEME_ASR_MODEL_DEFAULT = "Base"

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
# ZeroGPU Lease Timings
# =============================================================================

ZEROGPU_MAX_DURATION = 120  # Hard cap enforced by HF ZeroGPU
AUDIO_DURATION_WARNING_MINUTES = 300  # Warn user on upload if audio exceeds this (minutes)

def get_vad_duration(minutes):
    """GPU seconds needed for VAD based on audio minutes."""
    VAD_LEASE_BUFFER = 5
    return max(3, 0.28 * minutes + 1.66 + VAD_LEASE_BUFFER)

def get_asr_duration(minutes, model_name="Base"):
    """GPU seconds needed for ASR, scales linearly with audio duration."""
    if model_name == "Large":
        ASR_LEASE_BUFFER = 6.54
        return max(3, 0.0579 * minutes + 1.72 + ASR_LEASE_BUFFER)
    ASR_LEASE_BUFFER = 4.5
    return max(3, 0.0198 * minutes + 0.32 + ASR_LEASE_BUFFER)

# =============================================================================
# Estimations
# =============================================================================

MFA_PROGRESS_SEGMENT_RATE = 0.05  # seconds per segment for progress bar animation

ESTIMATE_GPU_BASE_SLOPE = 0.45
ESTIMATE_GPU_BASE_INTERCEPT = 7.6
ESTIMATE_GPU_LARGE_SLOPE = 0.53
ESTIMATE_GPU_LARGE_INTERCEPT = 7.2
ESTIMATE_CPU_BASE_SLOPE = 11.2
ESTIMATE_CPU_BASE_INTERCEPT = 20.9
ESTIMATE_CPU_LARGE_SLOPE = 25.2
ESTIMATE_CPU_LARGE_INTERCEPT = 24.4

# =============================================================================
# Inference Settings
# =============================================================================

# Batching strategy
BATCHING_STRATEGY = "dynamic"  # "naive" (fixed count) or "dynamic" (seconds + pad waste)

# Naive batching
INFERENCE_BATCH_SIZE = 32      # Fixed segments per batch (used when BATCHING_STRATEGY="naive")

# Dynamic batching constraints
MAX_BATCH_SECONDS = 600      # GPU: max total audio seconds per batch (sum of durations)
MAX_BATCH_SECONDS_CPU = 300  # CPU: tighter cap. SDPA materialises the QK^T tensor per encoder layer
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
COST_DELETION = 1.0                 # Delete phoneme from ASR (P)

# Repetition detection (wraparound DP)
WRAP_PENALTY = 3.5                  # Cost per wrap transition in DP
WRAP_SPAN_WEIGHT = 0.1              # Per-word cost for wrap span width (penalizes wide jumps)
MAX_WRAPS = 5                       # Max wraps for all segments
# Scoring mode for wraparound candidate selection:
#   "no_subtract" — WRAP_PENALTY stays in the raw cost before normalizing, so wraps
#                    are penalized proportionally to segment length. WRAP_SCORE_COST ignored.
#   "additive"    — WRAP_PENALTY is subtracted from cost before normalizing (so it doesn't
#                    inflate the edit distance), then WRAP_SCORE_COST * k is added to the
#                    final score as a flat per-wrap penalty.
#   "subtract"    — WRAP_PENALTY subtracted from cost before normalizing, but nothing
#                    replaces it. Wraps are essentially free after subtraction — useful
#                    as a debug/baseline mode only.
WRAP_SCORING_MODE = "no_subtract"
WRAP_SCORE_COST = 0.005             # Per-wrap additive penalty in scoring (only used with "additive" mode)

# Alignment thresholds (normalized edit distance: 0 = identical, 1 = completely different)
LOOKBACK_WORDS = 30                 # Window words to look back from pointer for starting positions
LOOKAHEAD_WORDS = 10                # Window words to look ahead after expected end position
MAX_EDIT_DISTANCE = 0.25            # Max normalized edit distance for valid ayah match
MAX_SPECIAL_EDIT_DISTANCE = 0.35    # Max normalized edit distance for Basmala/Isti'adha detection
MAX_TRANSITION_EDIT_DISTANCE = 0.45 # Max normalized edit distance for transition segments (Amin/Takbir/Tahmeed)
START_PRIOR_WEIGHT = 0.005          # Penalty per word away from expected position

# Failed Segments — single retry pass (expanded window + relaxed threshold).
# Both MAX_EDIT_DISTANCE and MAX_EDIT_DISTANCE_RELAXED are logged per-row in
# settings.align_config so threshold-tuning analyses can correlate each
# segment's DP norm_dist against the active acceptance thresholds.
RETRY_LOOKBACK_WORDS = 70           # Expanded lookback for the retry pass
RETRY_LOOKAHEAD_WORDS = 40          # Expanded lookahead for the retry pass
MAX_EDIT_DISTANCE_RELAXED = 0.45    # Relaxed threshold for the retry pass
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

# =============================================================================
# MFA forced alignment (word-level timestamps via HF Space)
# =============================================================================

MFA_SPACE_URL = "https://hetchyy-quran-phoneme-mfa.hf.space"
MFA_TIMEOUT = 240
MFA_METHOD = "kalpy"            # "kalpy", "align_one", "python_api", "cli"
MFA_BEAM = 15                   # Viterbi beam width
MFA_RETRY_BEAM = 40             # Retry beam width (used when initial alignment fails)
MFA_SHARED_CMVN = False         # Compute shared CMVN across batch (kalpy only)

# =============================================================================
# Split Segments (post-alignment subdivision using MFA word timestamps)
# =============================================================================

# Max verses per segment
SPLIT_MAX_VERSES_MIN = 1
SPLIT_MAX_VERSES_MAX = 5
SPLIT_MAX_VERSES_DEFAULT = 1

# Max words per segment
SPLIT_MAX_WORDS_MIN  = 5
SPLIT_MAX_WORDS_MAX  = 30
SPLIT_MAX_WORDS_STEP = 1
SPLIT_MAX_WORDS_DEFAULT = SPLIT_MAX_WORDS_MAX

# Max duration per segment (seconds)
SPLIT_MAX_DURATION_MIN  = 5
SPLIT_MAX_DURATION_MAX  = 30
SPLIT_MAX_DURATION_STEP = 1
SPLIT_MAX_DURATION_DEFAULT = SPLIT_MAX_DURATION_MAX

# MFA padding strategy for the silent split-timestamps call.
# See mfa_aligner/README.md §Parameters and Settings: "forward" | "symmetric" | "none".
MFA_SPLIT_PADDING = "symmetric"

# Progress-bar rate (seconds per candidate segment) — mirrors MFA_PROGRESS_SEGMENT_RATE.
SPLIT_PROGRESS_SEGMENT_RATE = 0.15

# Manual split editor layout
MANUAL_SPLIT_TEXT_MIN_HEIGHT_PX = 96
MANUAL_SPLIT_TEXT_MAX_HEIGHT_PX = 480

# =============================================================================
# Usage logging (pushed to HF Hub via ParquetScheduler)
# =============================================================================

# Subset naming: HF config per dataset. Bump on breaking column changes
# (column added / dropped / renamed). Patch-level changes stay in the same
# subset and are filtered at read-time via the row-level `schema_version`.
# Flush cadences default to 60 min on prod; dev Space overrides to 1 via env.

# --- Logs dataset (per-request metadata) ---
USAGE_LOG_LOGS_REPO       = os.environ.get("USAGE_LOG_LOGS_REPO", "hetchyy/quran-aligner-logs")
USAGE_LOG_LOGS_SUBSET     = "v3.1"
USAGE_LOG_SCHEMA_VERSION  = "3.1.6"   # row-level tag; also inherited by audio rows
USAGE_LOG_FLUSH_MINUTES   = int(os.environ.get("USAGE_LOG_FLUSH_MINUTES", "60"))

# --- Audio dataset (source audio, deduped by content hash) ---
USAGE_LOG_AUDIO_REPO          = os.environ.get("USAGE_LOG_AUDIO_REPO", "hetchyy/quran-aligner-audio")
USAGE_LOG_AUDIO_SUBSET        = "v3.0"
USAGE_LOG_AUDIO_FLUSH_MINUTES = int(os.environ.get("USAGE_LOG_AUDIO_FLUSH_MINUTES", str(USAGE_LOG_FLUSH_MINUTES)))

# --- Errors dataset (per-error-event rows) ---
USAGE_LOG_ERRORS_REPO           = os.environ.get("USAGE_LOG_ERRORS_REPO", "hetchyy/quran-aligner-errors")
USAGE_LOG_ERRORS_SUBSET         = "v1.0"
USAGE_LOG_ERRORS_SCHEMA_VERSION = "1.0.0"
USAGE_LOG_ERRORS_FLUSH_MINUTES  = int(os.environ.get("USAGE_LOG_ERRORS_FLUSH_MINUTES", str(USAGE_LOG_FLUSH_MINUTES)))

# --- Telemetry dataset (periodic host + CPU pool samples) ---
USAGE_LOG_TELEMETRY_REPO = os.environ.get("USAGE_LOG_TELEMETRY_REPO", "hetchyy/quran-aligner-telemetry")
USAGE_LOG_TELEMETRY_SUBSET = "v1.0"
TELEMETRY_SCHEMA_VERSION   = "1.0.4"
TELEMETRY_ENABLED          = os.environ.get("TELEMETRY_ENABLED", "1") == "1"
TELEMETRY_SAMPLE_SECONDS   = int(os.environ.get("TELEMETRY_SAMPLE_SECONDS", "60"))
TELEMETRY_FLUSH_MINUTES    = int(os.environ.get("TELEMETRY_FLUSH_MINUTES", "60"))

# Temporary kill-switch for the per-segment DP replay strings. Set to "1" to disable.
USAGE_LOG_DISABLE_DP_DEBUG = os.environ.get("USAGE_LOG_DISABLE_DP_DEBUG", "0") == "1"

# =============================================================================
# UI settings
# =============================================================================

# Main layout column scales
LEFT_COLUMN_SCALE = 4
RIGHT_COLUMN_SCALE = 6

QURAN_TEXT_SIZE_PX = 24  # Size for Quran text in segment cards
ARABIC_WORD_SPACING = "0.2em"  # Word spacing for Arabic text

# =============================================================================
# Animation settings
# =============================================================================

# Animation granularity
ANIM_GRANULARITIES = ["Words", "Characters"]
ANIM_GRANULARITY_DEFAULT = "Characters"

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
