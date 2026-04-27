## 23/04/2026 — Split Segments ✂️

- New "Split Segments" action — break long or multi-verse segments into smaller pieces
  - Batch mode:
    - Three criteria you can customise independently: max verses per segment, max words per segment, max duration (seconds)
    - Can additionally enforce splits at stop signs only
    - Segments produced from the same parent are grouped with a "Split" border so you can see what came from where
  - Full flexibility in single segment mode — interactively select words to split on
  - Results are saved and updated in the JSON output — you can undo at any time

## 13/04/2026 — GPU Quota ⚠️ + Performance Improvements ⏭️

- Daily GPU quota exhaustion:
  - No longer automatically falls back to CPU when quota is exceeded
  - Instead, returns an error message with quota status and a prompt to retry with CPU for better transparency and more accurate estimates
- CPU performance and reliability:
  - Fixed bug causing CPU processing to be unusually slow or hang indefinitely, especially on long audio 
  - Significantly faster and more stable! Benchmarks (base model):
    - ~1–2 compute minutes per 5 minutes of audio
    - Al-Baqarah (2+ hrs) in ~20–25 minutes
  - Additional CPU optimizations and concurrency improvements to ensure smooth user experience during heavy/busy request periods

## 03/04/2026 — Dynamic Editing ✍️ + Repetition Detection 🔁

- Inline reference editing — click any segment's reference to edit it directly
  - Supports full refs (2:255:1-2:255:5), short forms (2:255:1-5), whole verses (2:255), verse ranges (2:255-2:256), and special keywords (Basmala, Isti'adha, Amin, Takbir, Tahmeed, Tasleem, Sadaqa)
  - Can convert between segment types — e.g. re-label a misidentified segment as a special keyword or vice versa
  - Automatically updates "Missing Words" flags on neighbouring segments when a reference changes
  - Changes are saved and reflected in the JSON output
- Repetition detection — single segments where the reciter repeated words  are now automatically detected and flagged with a "Repeated Words" badge
  - Accounts for segmentation failures and undetected pauses. If you see many repetitions, try re-segmenting with a lower silence threshold to split them out
  - Each repeated section is shown on its own line, and repetition data is included in the JSON output
  - Provide feedback with the ✓ / ✗ buttons to help improve the feature and its accuracy

## 29/03/2026

- Settings panels now auto-collapse after extraction to reduce clutter, and re-expand when new audio is loaded
- Fixed crash on very long recordings (few hours), added warning message upon upload
- Added URL input mode — paste a link to download audio directly
- API calls are faster — skipped unnecessary audio processing for JSON-only responses
