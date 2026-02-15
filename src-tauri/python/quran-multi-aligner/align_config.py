"""
Alignment config overrides for constrained (known-sura) alignment.
Only params that differ from the quran_aligner defaults.
"""

# Window sizes
LOOKBACK_WORDS = 10     
LOOKAHEAD_WORDS = 5    

# Retry windows
RETRY_LOOKBACK_WORDS = 80  
RETRY_LOOKAHEAD_WORDS = 60 

# Debug/profiling -- off for batch CLI
ANCHOR_DEBUG = False
PHONEME_ALIGNMENT_DEBUG = False
PHONEME_ALIGNMENT_PROFILING = False
