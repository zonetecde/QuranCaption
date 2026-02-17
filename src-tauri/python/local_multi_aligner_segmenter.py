#!/usr/bin/env python3
"""
Local wrapper for Quran Multi-Aligner.

Runs the Multi-Aligner pipeline from a local checkout and returns JSON only.
Status updates are emitted to stderr as: STATUS:{"step":"...","message":"..."}
"""

import argparse
import io
import json
import os
import sys
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


SCRIPT_DIR = Path(__file__).parent.absolute()
MULTI_ALIGNER_ROOT = SCRIPT_DIR / "quran-multi-aligner"
sys.path.insert(0, str(MULTI_ALIGNER_ROOT))
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
DATA_FILE_URLS = {
    "phoneme_cache.pkl": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_cache.pkl?download=true",
    "phoneme_ngram_index_5.pkl": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_ngram_index_5.pkl?download=true",
    "qpc_hafs.json": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/qpc_hafs.json?download=true",
    "surah_info.json": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/surah_info.json?download=true",
    "digital_khatt_v2_script.json": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/digital_khatt_v2_script.json?download=true",
    "phoneme_sub_costs.json": "https://huggingface.co/spaces/hetchyy/Quran-multi-aligner/resolve/main/data/phoneme_sub_costs.json?download=true",
}


def emit_status(original_stderr, step: str, message: str) -> None:
    try:
        payload = json.dumps({"step": step, "message": message}, ensure_ascii=False)
        original_stderr.write(f"STATUS:{payload}\n")
        original_stderr.flush()
    except Exception:
        pass


def load_audio(audio_path: str):
    import librosa
    import numpy as np

    audio, sample_rate = librosa.load(audio_path, sr=16000, mono=True)
    return sample_rate, audio.astype(np.float32)


def resolve_hf_token(cli_token: str) -> str:
    return (
        (cli_token or "").strip()
        or (os.environ.get("HF_TOKEN", "").strip())
        or (os.environ.get("HF_HUB_TOKEN", "").strip())
        or (os.environ.get("HUGGING_FACE_HUB_TOKEN", "").strip())
    )


def apply_hf_token_env(token: str) -> None:
    if not token:
        return
    os.environ["HF_TOKEN"] = token
    os.environ["HF_HUB_TOKEN"] = token
    os.environ["HUGGING_FACE_HUB_TOKEN"] = token


def validate_hf_model_access(token: str) -> Optional[str]:
    if not token:
        return (
            "HF token is missing. Local Multi-Aligner needs access to private models "
            "hetchyy/r15_95m and hetchyy/r7."
        )

    private_models = ["hetchyy/r15_95m", "hetchyy/r7"]
    headers = {"Authorization": f"Bearer {token}"}

    for model_id in private_models:
        request = urllib.request.Request(
            f"https://huggingface.co/api/models/{model_id}",
            headers=headers,
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status != 200:
                    return (
                        f"HF token cannot access {model_id} (HTTP {response.status}). "
                        "Use a token with Read permission and model access."
                    )
        except urllib.error.HTTPError as error:
            if error.code in (401, 403, 404):
                return (
                    f"HF token cannot access private model {model_id} (HTTP {error.code}). "
                    "Use a token with Read permission and ensure your account has access."
                )
            return f"Failed to validate access to {model_id}: HTTP {error.code}"
        except Exception as error:
            return f"Failed to validate access to {model_id}: {error}"

    return None


def validate_local_data_pickles(status_writer=None) -> Optional[str]:
    data_dir = MULTI_ALIGNER_ROOT / "data"
    required_pickles = ["phoneme_cache.pkl", "phoneme_ngram_index_5.pkl"]
    required_json = [
        "qpc_hafs.json",
        "surah_info.json",
        "digital_khatt_v2_script.json",
        "phoneme_sub_costs.json",
    ]

    def emit(step: str, message: str) -> None:
        if callable(status_writer):
            try:
                status_writer(step, message)
            except Exception:
                pass

    def download_data_file(file_name: str, file_path: Path) -> Optional[str]:
        url = DATA_FILE_URLS.get(file_name)
        if not url:
            return f"No download URL configured for data file: {file_name}"

        try:
            emit("data", f"Repairing local data file: {file_name}...")
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "QuranCaption/3"},
                method="GET",
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
            if not payload:
                return f"Downloaded empty payload for: {file_name}"
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(payload)
            return None
        except Exception as error:
            return f"Failed to download {file_name}: {error}"

    for file_name in required_pickles:
        file_path = data_dir / file_name
        if not file_path.exists():
            download_error = download_data_file(file_name, file_path)
            if download_error:
                return f"Missing required data file: {file_path} ({download_error})"

        try:
            with open(file_path, "rb") as f:
                head = f.read(80)
            if head.startswith(LFS_POINTER_PREFIX):
                download_error = download_data_file(file_name, file_path)
                if download_error:
                    return (
                        f"Invalid data file (Git LFS pointer): {file_path}. "
                        f"Auto-repair failed: {download_error}"
                    )
                with open(file_path, "rb") as f:
                    head = f.read(80)
                if head.startswith(LFS_POINTER_PREFIX):
                    return (
                        f"Invalid data file (Git LFS pointer): {file_path}. "
                        "This file must be real binary content, not a Git LFS pointer."
                    )
            if not head or head[0] != 0x80:
                download_error = download_data_file(file_name, file_path)
                if download_error:
                    return (
                        f"Invalid pickle header for data file: {file_path}. "
                        f"Auto-repair failed: {download_error}"
                    )
                with open(file_path, "rb") as f:
                    head = f.read(80)
                if not head or head[0] != 0x80:
                    return (
                        f"Invalid pickle header for data file: {file_path}. "
                        "Expected a binary pickle file."
                    )
        except Exception as error:
            return f"Failed to validate data file {file_path}: {error}"

    for file_name in required_json:
        file_path = data_dir / file_name
        if not file_path.exists():
            download_error = download_data_file(file_name, file_path)
            if download_error:
                return f"Missing required data file: {file_path} ({download_error})"

        try:
            with open(file_path, "rb") as f:
                head = f.read(256)
            if head.startswith(LFS_POINTER_PREFIX):
                download_error = download_data_file(file_name, file_path)
                if download_error:
                    return (
                        f"Invalid data file (Git LFS pointer): {file_path}. "
                        f"Auto-repair failed: {download_error}"
                    )
                with open(file_path, "rb") as f:
                    head = f.read(256)
                if head.startswith(LFS_POINTER_PREFIX):
                    return (
                        f"Invalid data file (Git LFS pointer): {file_path}. "
                        "This file must be real JSON content, not a Git LFS pointer."
                    )
            if not head.strip().startswith((b"{", b"[")):
                download_error = download_data_file(file_name, file_path)
                if download_error:
                    return (
                        f"Invalid JSON header for data file: {file_path}. "
                        f"Auto-repair failed: {download_error}"
                    )
                with open(file_path, "rb") as f:
                    head = f.read(256)
                if not head.strip().startswith((b"{", b"[")):
                    return (
                        f"Invalid JSON header for data file: {file_path}. "
                        "Expected a JSON file."
                    )
            with open(file_path, "r", encoding="utf-8") as f:
                json.load(f)
        except json.JSONDecodeError as error:
            download_error = download_data_file(file_name, file_path)
            if download_error:
                return f"Invalid JSON data file {file_path}: {error} (auto-repair failed: {download_error})"
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    json.load(f)
            except Exception as second_error:
                return f"Invalid JSON data file {file_path}: {second_error}"
        except Exception as error:
            return f"Failed to validate data file {file_path}: {error}"

    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Local Quran Multi-Aligner wrapper")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("--min-silence-ms", type=int, default=200)
    parser.add_argument("--min-speech-ms", type=int, default=1000)
    parser.add_argument("--pad-ms", type=int, default=100)
    parser.add_argument("--model-name", type=str, default="Base", choices=["Base", "Large"])
    parser.add_argument("--device", type=str, default="GPU", choices=["GPU", "CPU"])
    parser.add_argument("--hf-token", type=str, default="")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"Audio file not found: {args.audio_path}"}))
        return 1

    if not MULTI_ALIGNER_ROOT.exists():
        print(
            json.dumps(
                {
                    "error": (
                        "quran-multi-aligner source folder not found. "
                        "Expected: src-tauri/python/quran-multi-aligner"
                    )
                }
            )
        )
        return 1

    token = resolve_hf_token(args.hf_token)
    apply_hf_token_env(token)

    old_stdout = sys.stdout
    old_stderr = sys.stderr
    original_stderr_fd = os.dup(2)
    original_stderr = os.fdopen(original_stderr_fd, "w", encoding="utf-8")

    if not args.verbose:
        sys.stdout = io.StringIO()
        sys.stderr = io.StringIO()
        devnull = open(os.devnull, "w")
        old_stdout_fd = os.dup(1)
        old_stderr_fd = os.dup(2)
        os.dup2(devnull.fileno(), 1)
        os.dup2(devnull.fileno(), 2)
    else:
        devnull = None
        old_stdout_fd = None
        old_stderr_fd = None

    result_payload = None
    error_payload = None

    try:
        emit_status(original_stderr, "auth", "Validating Hugging Face token...")
        token_error = validate_hf_model_access(token)
        if token_error:
            error_payload = {"error": token_error}
        else:
            emit_status(original_stderr, "data", "Validating local Multi-Aligner data files...")
            data_error = validate_local_data_pickles(
                lambda step, message: emit_status(original_stderr, step, message)
            )
            if data_error:
                error_payload = {"error": data_error}
                raise RuntimeError(data_error)

            emit_status(original_stderr, "loading", "Loading audio file...")
            sample_rate, audio = load_audio(args.audio_path)

            emit_status(original_stderr, "pipeline", "Running local Multi-Aligner pipeline...")
            from src.pipeline import process_audio

            result = process_audio(
                (sample_rate, audio),
                int(args.min_silence_ms),
                int(args.min_speech_ms),
                int(args.pad_ms),
                args.model_name,
                args.device,
            )

            if not isinstance(result, tuple) or len(result) < 2:
                error_payload = {"error": "Unexpected pipeline output format"}
            else:
                json_output = result[1]
                if not isinstance(json_output, dict):
                    error_payload = {"error": "Pipeline returned no JSON output"}
                else:
                    result_payload = json_output
    except json.JSONDecodeError as exc:
        error_payload = {
            "error": (
                f"Invalid JSON content detected ({exc}). "
                "A local Multi-Aligner data file is likely corrupted or still a Git LFS pointer. "
                "Reinstall Multi-Aligner local dependencies from the app."
            ),
            "details": traceback.format_exc(),
        }
    except Exception as exc:
        error_payload = {"error": str(exc), "details": traceback.format_exc()}
    finally:
        if not args.verbose and devnull is not None:
            os.dup2(old_stdout_fd, 1)
            os.dup2(old_stderr_fd, 2)
            os.close(old_stdout_fd)
            os.close(old_stderr_fd)
            devnull.close()
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        original_stderr.close()

    if error_payload is not None:
        print(json.dumps(error_payload, ensure_ascii=False))
        return 1

    print(json.dumps(result_payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
