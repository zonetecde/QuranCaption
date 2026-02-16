#!/usr/bin/env python3
"""
Local Quran Audio Segmentation Script

This script processes audio files locally using the same pipeline as the 
HuggingFace Space API (VAD + Whisper + Quran text matching).

Usage:
    python local_segmenter.py <audio_path> [--min-silence-ms 200] [--min-speech-ms 1000] [--pad-ms 50]

Output:
    JSON segments to stdout in the same format as the API.
"""

import sys
import json
import argparse
import os
from pathlib import Path

# Fix Windows console encoding for Arabic text output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

# Add the current directory to path for imports
script_dir = Path(__file__).parent.absolute()
sys.path.insert(0, str(script_dir))


def download_data_files():
    """Download required data files from HuggingFace if not present."""
    from segment_core.config import (
        get_data_path,
        get_quran_script_path,
        get_surah_info_path,
    )
    
    data_path = get_data_path()
    data_path.mkdir(parents=True, exist_ok=True)
    
    quran_script_path = get_quran_script_path()
    surah_info_path = get_surah_info_path()
    
    # URLs for data files from HuggingFace
    BASE_URL = "https://huggingface.co/spaces/hetchyy/quran-segmentation-transcription/resolve/main/data"
    
    files_to_download = []
    
    if not quran_script_path.exists():
        files_to_download.append(("digital_khatt_v2_script.json", quran_script_path, 14832957))  # Expected size
    
    if not surah_info_path.exists():
        files_to_download.append(("surah_info.json", surah_info_path, 425295))

    if files_to_download:
        print("[SETUP] Downloading required data files...", file=sys.stderr)
        
        try:
            import urllib.request
            import shutil
            
            for filename, filepath, expected_size in files_to_download:
                url = f"{BASE_URL}/{filename}"
                print(f"[SETUP] Downloading {filename} (~{expected_size / 1024 / 1024:.1f} MB)...", file=sys.stderr)
                
                # Use chunked download for large files
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=300) as response:
                    with open(filepath, 'wb') as out_file:
                        shutil.copyfileobj(response, out_file, length=1024*1024)  # 1MB chunks
                
                actual_size = filepath.stat().st_size
                print(f"[SETUP] Downloaded {filename} ({actual_size / 1024 / 1024:.1f} MB)", file=sys.stderr)
                
                # Verify file size
                if actual_size < expected_size * 0.95:
                    print(f"[WARNING] File may be incomplete: {actual_size} < {expected_size}", file=sys.stderr)
        
        except Exception as e:
            print(f"[ERROR] Failed to download data files: {e}", file=sys.stderr)
            print("[ERROR] Please download manually from HuggingFace Space", file=sys.stderr)
            sys.exit(1)
    
    return True


def check_dependencies():
    """Check if required Python packages are installed."""
    missing = []
    
    try:
        import torch
    except ImportError:
        missing.append("torch")
    
    try:
        import transformers
    except ImportError:
        missing.append("transformers")
    
    try:
        import librosa
    except ImportError:
        missing.append("librosa")
    
    try:
        import numpy
    except ImportError:
        missing.append("numpy")
    
    try:
        import soundfile
    except ImportError:
        missing.append("soundfile")

    if missing:
        print(f"[ERROR] Missing required packages: {', '.join(missing)}", file=sys.stderr)
        print(f"[ERROR] Please install with: pip install {' '.join(missing)}", file=sys.stderr)
        return False

    try:
        from importlib import metadata

        def major(version: str) -> int:
            try:
                return int(str(version).split(".", 1)[0])
            except Exception:
                return -1

        versions = {
            "transformers": metadata.version("transformers"),
            "numpy": metadata.version("numpy"),
            "librosa": metadata.version("librosa"),
            "soundfile": metadata.version("soundfile"),
            "accelerate": metadata.version("accelerate"),
        }

        incompatible = []
        if major(versions["transformers"]) >= 5:
            incompatible.append(f"transformers={versions['transformers']} (need <5)")
        if major(versions["numpy"]) >= 2:
            incompatible.append(f"numpy={versions['numpy']} (need <2)")
        if not versions["librosa"].startswith("0.10."):
            incompatible.append(f"librosa={versions['librosa']} (need 0.10.x)")
        if not versions["soundfile"].startswith("0.12."):
            incompatible.append(f"soundfile={versions['soundfile']} (need 0.12.x)")
        if major(versions["accelerate"]) >= 1:
            incompatible.append(f"accelerate={versions['accelerate']} (need <1)")

        if incompatible:
            print(
                "[ERROR] Incompatible package versions for legacy local segmentation:",
                file=sys.stderr,
            )
            print(f"[ERROR] {', '.join(incompatible)}", file=sys.stderr)
            print(
                "[ERROR] Reinstall Legacy Whisper dependencies from the app to downgrade to supported versions.",
                file=sys.stderr,
            )
            return False
    except Exception as e:
        print(f"[WARNING] Could not validate package versions: {e}", file=sys.stderr)
    
    return True


def load_audio(audio_path: str):
    """Load audio file using librosa."""
    import librosa
    import numpy as np
    
    # Load audio, resample to 16kHz mono
    audio, sample_rate = librosa.load(audio_path, sr=16000, mono=True)
    
    return audio.astype(np.float32), sample_rate


def main():
    parser = argparse.ArgumentParser(
        description="Local Quran Audio Segmentation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python local_segmenter.py audio.mp3
    python local_segmenter.py audio.wav --min-silence-ms 300 --min-speech-ms 1500
        """
    )
    
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200,
                        help="Minimum silence duration to split segments (ms)")
    parser.add_argument("--min-speech-ms", type=int, default=1000,
                        help="Minimum speech duration for valid segment (ms)")
    parser.add_argument("--pad-ms", type=int, default=50,
                        help="Padding around segments (ms)")
    parser.add_argument("--whisper-model", type=str, default="base",
                        choices=["tiny", "base", "medium", "large"],
                        help="Whisper model size: tiny (~60MB), base (~150MB), medium (~800MB), large (~3GB)")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show verbose output to stderr")
    
    args = parser.parse_args()
    
    # Validate audio file exists
    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        sys.exit(1)
    
    # Check dependencies
    if not check_dependencies():
        print(json.dumps({"error": "Missing required Python packages"}))
        sys.exit(1)
    
    # Download data files if needed
    try:
        download_data_files()
    except Exception as e:
        print(json.dumps({"error": f"Failed to download data files: {str(e)}"}))
        sys.exit(1)
    
    # Suppress verbose output if not requested
    # We need to capture BOTH stdout and stderr because libraries like torch/transformers
    # print to stdout during model loading
    import io
    
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    
    # Save original stderr fd for status messages (before any redirection)
    original_stderr_fd = os.dup(2)
    original_stderr_file = os.fdopen(original_stderr_fd, 'w', encoding='utf-8')
    
    def emit_status_to_stderr(step: str, message: str):
        """Write status in a parsable format to original stderr."""
        try:
            import json
            status_json = json.dumps({"step": step, "message": message}, ensure_ascii=False)
            original_stderr_file.write(f"STATUS:{status_json}\n")
            original_stderr_file.flush()
        except:
            pass
    
    if not args.verbose:
        # Redirect both stdout and stderr to suppress library output
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        # Also suppress low-level file descriptor output
        devnull = open(os.devnull, 'w')
        old_stdout_fd = os.dup(1)
        old_stderr_fd = os.dup(2)
        os.dup2(devnull.fileno(), 1)
        os.dup2(devnull.fileno(), 2)
    
    result = None
    error_result = None
    
    try:
        # Emit loading status
        emit_status_to_stderr("loading", "Loading audio file...")
        
        # Load audio
        audio, sample_rate = load_audio(args.audio_path)
        
        # Run segmentation pipeline
        from segment_core.segment_processor import process_audio_full
        
        result = process_audio_full(
            audio=audio,
            sample_rate=sample_rate,
            min_silence_ms=args.min_silence_ms,
            min_speech_ms=args.min_speech_ms,
            pad_ms=args.pad_ms,
            whisper_model=args.whisper_model,
            status_callback=emit_status_to_stderr
        )
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        error_result = {
            "error": str(e),
            "details": error_details
        }
    
    finally:
        # Restore stdout/stderr BEFORE printing result
        if not args.verbose:
            os.dup2(old_stdout_fd, 1)
            os.dup2(old_stderr_fd, 2)
            os.close(old_stdout_fd)
            os.close(old_stderr_fd)
            devnull.close()
        sys.stdout = old_stdout
        sys.stderr = old_stderr
    
    # Now print the result (with restored stdout)
    if error_result:
        print(json.dumps(error_result))
        sys.exit(1)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
