"""Global Configuration & Path Definitions."""

import os
from pathlib import Path

# Base directories
PROJECT_ROOT = Path(__file__).parent.absolute()
DATA_PATH = PROJECT_ROOT / "data"

# Quran Uthmani Script Reference
QURAN_SCRIPT_PATH_COMPUTE = DATA_PATH / "qpc_hafs.json"

# Pipeline Directives
AUTO_MERGE_GROUP_PREFIX = "merge-auto-"
AUDIO_CACHE_MAX_ENTRIES = int(os.environ.get("AUDIO_CACHE_MAX_ENTRIES", "32"))

# Auto-Updater Settings
ENABLE_AUTO_UPDATE = os.environ.get("ENABLE_AUTO_UPDATE", "true").lower() in ("true", "1", "yes")

# Word Timestamp Tuning Controls
ENABLE_WORD_SMOOTHING = True
WORD_SMOOTHING_MAX_STRETCH_S = 2.0
ENABLE_MISSING_WORD_INJECTION = False
ENABLE_SAME_AYAH_FUSION = False
FILTER_OUT_OF_ORDER_REPEATS = False
