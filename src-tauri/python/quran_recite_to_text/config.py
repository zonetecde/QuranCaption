"""Global Configuration & Tuning Dashboard for QuranReciteToText.

This is the SINGLE FILE to tune matching parameters, edit costs, repetition penalties,
CTC alignment blank weights, and acoustic silence thresholds across the entire pipeline.
"""

import sys
from pathlib import Path

# ==============================================================================
# 1. BASE DIRECTORIES & RESOURCE PATHS
# ==============================================================================
PROJECT_ROOT = Path(__file__).parent.absolute()
DATA_PATH = PROJECT_ROOT / "data"

ONNX_DIR = DATA_PATH / "onnx"
DEFAULT_MODEL_PATH = str(ONNX_DIR / "zipformer_p_arabic_v3.int8.onnx")
DEFAULT_TOKENS_PATH = str(ONNX_DIR / "tokens.txt")
DEFAULT_QURAN_PHONEMES_PATH = str(DATA_PATH / "ordered_quran_phonemes.json")
DEFAULT_REF_NORM_PH_PATH = str(DATA_PATH / "ref_norm_ph.txt")
DEFAULT_PH_INDEX_PATH = str(DATA_PATH / "ph_index.npy")
DEFAULT_OUTPUT_DIR = str(PROJECT_ROOT / "output")
EXPORT_ALL_ARTIFACTS: bool = False


# ==============================================================================
# 2. AUDIO & ACOUSTIC SPECIFICATIONS
# ==============================================================================
SAMPLE_RATE: int = 16000
BLANK_ID: int = 250
FRAME_RATE: float = 25.0                    # 40ms per encoder frame (25 Hz)
FRAME_STEP: float = 1.0 / FRAME_RATE        # 0.040s
CLIP_AUDIO_PEAKS: bool = True               # Soft guard against clipping > 1.0



# ==============================================================================
# 3. PHASE 3 MATCHING & WRAPAROUND TUNING (TWEAK MATCHING HERE)
# ==============================================================================
# Phonetic Edit Costs
COST_SUBSTITUTION: float = 1.00             # Standard substitution penalty
COST_DELETION: float = 1.00                 # Standard deletion penalty
COST_INSERTION: float = 0.75                # Standard insertion penalty
ACOUSTIC_CONFUSION_COST: float = 0.25       # Cost for acoustically similar pairs (ت/ط, د/ض, Madd vs Harakat)

# Repetition Penalties
WRAP_PENALTY: float = 0.80                  # Regularization penalty to prevent false backward jumps
WRAP_SPAN_WEIGHT: float = 0.05              # Additional cost per word spanned in backward jump


# ==============================================================================
# 4. PHASE 3A SURAH DISCOVERY & DETECTOR TUNING
# ==============================================================================
DETECTOR_ERROR_RATIO: float = 0.20          # Max Myers bit-parallel error tolerance for global detection
DETECTOR_MIN_PHONEMES: int = 12             # Minimum phonemes required to trigger detection probe


# ==============================================================================
# 5. PHASE 2 CTC FORCED ALIGNMENT TUNING
# ==============================================================================
CTC_BLANK_PENALTY: float = 1.8              # Trellis blank prior regularization
LOOKAHEAD_OFFSET_FRAMES: float = 3.0        # -120ms streaming lookahead delay compensation


# ==============================================================================
# 6. PHASE 1 ASR & ACOUSTIC SILENCE SEGMENTATION (VAD)
# ==============================================================================
VAD_MIN_PAUSE_S: float = 0.50               # Natural Waqf pause threshold (seconds; prevents intra-Ayah splits)
VAD_ADAPTIVE: bool = True                   # Dynamic noise-floor adaptation (works on studio & noisy phone audio)
VAD_ONSET_DB: float = -35.0                 # Fallback speech onset energy threshold (dB)
VAD_OFFSET_DB: float = -42.0                # Fallback speech offset energy threshold (dB)
VAD_HANGOVER_S: float = 0.20                # Hangover buffer (protecting soft Madd & Ghunnah tails)
VAD_MAX_PAD_S: float = 0.25                 # Post-roll margin (250ms)
VAD_PREROLL_S: float = 0.20                 # Pre-roll margin (200ms for cold-start priming)
FLUSH_PAD_FRAMES: int = 28                  # Optimal tail flush padding (280ms silence to emit delayed CTC spikes)

# Encoder state reset at Waqf boundaries (prevents repetition skipping / attention saturation)
RESET_ENCODER_ON_SILENCE: bool = True
AGGRESSIVE_MIN_PAUSE_S: float = 0.20        # Sakt & fine pause detection threshold (seconds)


# ==============================================================================
# 7. SPEECH RECOVERY CONTROLS (INTRA-SEGMENT HOLE RE-TRANSCRIPTION)
# ==============================================================================
ENABLE_SPEECH_RECOVERY: bool = False         # Targeted re-transcription of severe deletion holes
SPEECH_RECOVERY_ENERGY_THRESHOLD_DB: float = -31.0
SPEECH_RECOVERY_MIN_HOLE_DURATION_S: float = 0.45
SPEECH_RECOVERY_PADDING_S: float = 0.12
SPEECH_RECOVERY_MIN_PHONEMES_IN_GAP: int = 1


# ==============================================================================
# 8. RUNTIME PERFORMANCE & SYSTEM SETTINGS
# ==============================================================================
DEFAULT_NUM_THREADS: int = 2
NUM_SEGMENT_WORKERS: int = 1
ENABLE_PROFILING: bool = True

# ==============================================================================
# 9. WORD TIMING BRIDGE (VIDEO SYNCHRONIZATION)
# ==============================================================================
ENABLE_WORD_TIMING_BRIDGE: bool = True       # Synthesize continuous timestamps for elided words (video/subtitles)

# ==============================================================================
# 10. ACOUSTIC SILENCE & WAQF PRESERVATION (100% TIMING FIDELITY)
# ==============================================================================
ENABLE_ACOUSTIC_SILENCE_PRESERVATION: bool = True  # Preserve true silence between Ayahs/words
MIN_SILENCE_GAP_FRAMES: int = 12                   # Minimum blank frames (480ms) to constitute a true Waqf pause
PHONEME_ONSET_PAD_FRAMES: float = 7.5              # 300ms lead on speech onset after a breath pause (never start late)
PHONEME_OFFSET_PAD_FRAMES: float = 2.5             # 100ms trail protecting soft Madd/Ghunnah tails

# Backward compatibility alias
PipelineConfig = sys.modules[__name__]

