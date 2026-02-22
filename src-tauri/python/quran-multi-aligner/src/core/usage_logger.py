"""
Usage logger that pushes alignment runs to a HF Dataset repo.

Uses a ParquetScheduler (subclass of CommitScheduler) to buffer rows in memory
and periodically write+upload parquet files with embedded audio to the Hub.
Error logs use a separate CommitScheduler with JSONL files.
Falls back to local-only logging if schedulers can't initialize.

Scheduler creation is deferred to first use so that background threads don't
interfere with ZeroGPU's startup function scan.
"""

import hashlib
import io
import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import uuid4

import numpy as np

# =========================================================================
# Directory setup
# =========================================================================

LOG_DIR = Path("usage_logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)

ERROR_DIR = LOG_DIR / "errors"
ERROR_DIR.mkdir(parents=True, exist_ok=True)

ERROR_LOG_PATH = ERROR_DIR / f"error_log-{uuid4()}.jsonl"

# =========================================================================
# ParquetScheduler class definition (no instances created at import time)
# =========================================================================

_HAS_DEPS = False
try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    from huggingface_hub import CommitScheduler
    from config import USAGE_LOG_DATASET_REPO, USAGE_LOG_PUSH_INTERVAL_MINUTES

    _HAS_DEPS = True
except Exception:
    pass

# HF features schema (column order matters — audio first for HF viewer widget)
_ALIGNER_SCHEMA: Dict[str, Dict[str, str]] = {
    # Identity
    "audio": {"_type": "Audio"},
    "audio_id": {"_type": "Value", "dtype": "string"},
    "timestamp": {"_type": "Value", "dtype": "string"},
    "user_id": {"_type": "Value", "dtype": "string"},
    # Input metadata
    "audio_duration_s": {"_type": "Value", "dtype": "float64"},
    "num_segments": {"_type": "Value", "dtype": "int32"},
    "surah": {"_type": "Value", "dtype": "int32"},
    # Segmentation settings
    "min_silence_ms": {"_type": "Value", "dtype": "int32"},
    "min_speech_ms": {"_type": "Value", "dtype": "int32"},
    "pad_ms": {"_type": "Value", "dtype": "int32"},
    "asr_model": {"_type": "Value", "dtype": "string"},
    "device": {"_type": "Value", "dtype": "string"},
    # Profiling
    "total_time": {"_type": "Value", "dtype": "float64"},
    "vad_queue_time": {"_type": "Value", "dtype": "float64"},
    "vad_gpu_time": {"_type": "Value", "dtype": "float64"},
    "asr_gpu_time": {"_type": "Value", "dtype": "float64"},
    "dp_total_time": {"_type": "Value", "dtype": "float64"},
    # Quality & retry
    "segments_passed": {"_type": "Value", "dtype": "int32"},
    "segments_failed": {"_type": "Value", "dtype": "int32"},
    "mean_confidence": {"_type": "Value", "dtype": "float64"},
    "tier1_retries": {"_type": "Value", "dtype": "int32"},
    "tier1_passed": {"_type": "Value", "dtype": "int32"},
    "tier2_retries": {"_type": "Value", "dtype": "int32"},
    "tier2_passed": {"_type": "Value", "dtype": "int32"},
    "reanchors": {"_type": "Value", "dtype": "int32"},
    "special_merges": {"_type": "Value", "dtype": "int32"},
    # Reciter stats
    "words_per_minute": {"_type": "Value", "dtype": "float64"},
    "phonemes_per_second": {"_type": "Value", "dtype": "float64"},
    "avg_segment_duration": {"_type": "Value", "dtype": "float64"},
    "std_segment_duration": {"_type": "Value", "dtype": "float64"},
    "avg_pause_duration": {"_type": "Value", "dtype": "float64"},
    "std_pause_duration": {"_type": "Value", "dtype": "float64"},
    # Session flags
    "resegmented": {"_type": "Value", "dtype": "bool"},
    "retranscribed": {"_type": "Value", "dtype": "bool"},
    # Segments, timestamps & error
    "segments": {"_type": "Value", "dtype": "string"},
    "word_timestamps": {"_type": "Value", "dtype": "string"},
    "char_timestamps": {"_type": "Value", "dtype": "string"},
    "error": {"_type": "Value", "dtype": "string"},
}

if _HAS_DEPS:
    class ParquetScheduler(CommitScheduler):
        """Buffers rows in memory and uploads a parquet file each interval.

        Audio values are stored as file paths in the row dict; on push they are
        read as bytes and embedded in the parquet using the HF Audio struct.
        """

        def __init__(
            self,
            *,
            repo_id: str,
            schema: Optional[Dict[str, Dict[str, str]]] = None,
            every: Union[int, float] = 5,
            path_in_repo: Optional[str] = "data",
            repo_type: Optional[str] = "dataset",
            private: bool = False,
        ) -> None:
            super().__init__(
                repo_id=repo_id,
                folder_path="dummy",  # not used — we upload directly
                every=every,
                path_in_repo=path_in_repo,
                repo_type=repo_type,
                private=private,
            )
            self._rows: List[Dict[str, Any]] = []
            self._schema = schema

        def append(self, row: Dict[str, Any]) -> None:
            with self.lock:
                self._rows.append(row)

        def push_to_hub(self) -> None:
            with self.lock:
                rows = self._rows
                self._rows = []
            if not rows:
                return

            print(f"[USAGE_LOG] Pushing {len(rows)} alignment row(s) to Hub.")

            schema: Dict[str, Dict] = dict(self._schema) if self._schema else {}
            paths_to_cleanup: List[Path] = []

            for row in rows:
                for key, value in row.items():
                    if key not in schema:
                        schema[key] = _infer_schema(key, value)

                    if value is not None and schema[key].get("_type") in ("Image", "Audio"):
                        file_path = Path(value)
                        if file_path.is_file():
                            row[key] = {
                                "path": file_path.name,
                                "bytes": file_path.read_bytes(),
                            }
                            paths_to_cleanup.append(file_path)
                        else:
                            row[key] = None

            for row in rows:
                for feature in schema:
                    if feature not in row:
                        row[feature] = None

            table = pa.Table.from_pylist(rows)

            # Cast null-typed columns to string so all parquet shards share
            # the same Arrow schema (prevents HF viewer concat errors).
            for i, field in enumerate(table.schema):
                if pa.types.is_null(field.type):
                    table = table.set_column(
                        i, field.name,
                        pa.array([None] * len(table), type=pa.string()),
                    )

            table = table.replace_schema_metadata(
                {"huggingface": json.dumps({"info": {"features": schema}})}
            )

            archive = None
            try:
                import tempfile
                archive = tempfile.NamedTemporaryFile(suffix=".parquet", delete=False)
                pq.write_table(
                    table,
                    archive.name,
                    row_group_size=1,
                    write_page_index=True,
                )
                self.api.upload_file(
                    repo_id=self.repo_id,
                    repo_type=self.repo_type,
                    revision=self.revision,
                    path_in_repo=f"{self.path_in_repo}/{uuid4()}.parquet",
                    path_or_fileobj=archive.name,
                )
                print("[USAGE_LOG] Parquet commit completed.")
            except Exception as e:
                print(f"[USAGE_LOG] Failed to upload parquet: {e}")
            finally:
                if archive:
                    archive.close()
                    Path(archive.name).unlink(missing_ok=True)

            for path in paths_to_cleanup:
                path.unlink(missing_ok=True)

    def _infer_schema(key: str, value: Any) -> Dict[str, str]:
        if "image" in key:
            return {"_type": "Image"}
        if "audio" in key:
            return {"_type": "Audio"}
        if isinstance(value, bool):
            return {"_type": "Value", "dtype": "bool"}
        if isinstance(value, int):
            return {"_type": "Value", "dtype": "int64"}
        if isinstance(value, float):
            return {"_type": "Value", "dtype": "float64"}
        if isinstance(value, bytes):
            return {"_type": "Value", "dtype": "binary"}
        return {"_type": "Value", "dtype": "string"}


# =========================================================================
# Lazy scheduler initialization (deferred to first use)
# =========================================================================

_aligner_scheduler = None
_error_scheduler = None
_schedulers_initialized = False
_init_lock = threading.Lock()
_fallback_lock = threading.Lock()


def _ensure_schedulers() -> None:
    global _aligner_scheduler, _error_scheduler, _schedulers_initialized
    if _schedulers_initialized:
        return
    with _init_lock:
        if _schedulers_initialized:
            return
        _schedulers_initialized = True
        if not _HAS_DEPS:
            print("[USAGE_LOG] Dependencies missing (local-only mode).")
            return
        try:
            _aligner_scheduler = ParquetScheduler(
                repo_id=USAGE_LOG_DATASET_REPO,
                schema=_ALIGNER_SCHEMA,
                every=USAGE_LOG_PUSH_INTERVAL_MINUTES,
                path_in_repo="data",
                repo_type="dataset",
                private=True,
            )
            _error_scheduler = CommitScheduler(
                repo_id=USAGE_LOG_DATASET_REPO,
                repo_type="dataset",
                folder_path=ERROR_DIR,
                path_in_repo="data/errors",
                private=True,
                every=USAGE_LOG_PUSH_INTERVAL_MINUTES,
            )
        except Exception as e:
            print(f"[USAGE_LOG] Scheduler init failed (local-only mode): {e}")


# =========================================================================
# Helpers
# =========================================================================


def _get_error_lock():
    _ensure_schedulers()
    if _error_scheduler is not None:
        return _error_scheduler.lock
    return _fallback_lock


def get_user_id(request) -> str:
    """SHA-256 hash (12-char) of IP+UA from a gr.Request, or 'unknown'."""
    try:
        headers = request.headers
        ip = (
            headers.get("x-forwarded-for", "").split(",")[0].strip()
            or headers.get("x-real-ip", "")
            or ""
        )
        ua = headers.get("user-agent", "")
        return hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:12]
    except Exception:
        return "unknown"


def _compute_audio_id(audio: np.ndarray, ts: datetime) -> str:
    """Content hash (16-char) + compact timestamp."""
    audio_hash = hashlib.sha256(audio.tobytes()).hexdigest()[:16]
    return f"{audio_hash}:{ts.strftime('%Y%m%dT%H%M%S')}"


def _encode_audio_ogg(audio: np.ndarray, sample_rate: int, audio_id: str) -> str:
    """Encode audio to a temp OGG Vorbis file; returns the file path.

    Uses Vorbis instead of Opus because libsndfile (used by the HF dataset
    viewer) has buggy Opus support and crashes on many valid Opus files.
    """
    import soundfile as sf
    import subprocess

    tmp_dir = LOG_DIR / "tmp_audio"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_id = audio_id.replace(":", "-")

    wav_path = tmp_dir / f"{safe_id}.wav"
    ogg_path = tmp_dir / f"{safe_id}.ogg"
    sf.write(str(wav_path), audio, sample_rate, format="WAV")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path),
             "-c:a", "libvorbis", "-q:a", "2",
             "-ar", "16000", "-ac", "1",
             str(ogg_path)],
            capture_output=True, check=True,
        )
    finally:
        wav_path.unlink(missing_ok=True)
    return str(ogg_path)


def _sync_row_to_scheduler(row: Dict[str, Any]) -> None:
    """Ensure *row* is represented in the scheduler buffer.

    gr.State may deserialize the dict (creating a copy), and push_to_hub
    detaches rows from the buffer.  This helper finds the original row by
    audio_id and updates it, or re-appends if it was already pushed.
    """
    if _aligner_scheduler is None:
        return
    audio_id = row.get("audio_id")
    if not audio_id:
        return
    with _aligner_scheduler.lock:
        for buffered in _aligner_scheduler._rows:
            if buffered.get("audio_id") == audio_id:
                # Update the buffered row in-place (handles gr.State copies)
                buffered.update(row)
                return
        # Row was already pushed — re-append (audio file may be gone, that's ok)
        _aligner_scheduler._rows.append(row)


# =========================================================================
# Public logging API
# =========================================================================


def log_alignment(
    *,
    audio: np.ndarray,
    sample_rate: int,
    request=None,
    # Input metadata
    audio_duration_s: float,
    num_segments: int,
    surah: int,
    # Settings
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int,
    asr_model: str,
    device: str,
    # Profiling
    total_time: float,
    vad_queue_time: float,
    vad_gpu_time: float,
    asr_gpu_time: float,
    dp_total_time: float,
    # Quality & retry
    segments_passed: int,
    segments_failed: int,
    mean_confidence: float,
    tier1_retries: int,
    tier1_passed: int,
    tier2_retries: int,
    tier2_passed: int,
    reanchors: int,
    special_merges: int,
    # Reciter stats
    words_per_minute: float,
    phonemes_per_second: float,
    avg_segment_duration: float,
    std_segment_duration: float,
    avg_pause_duration: float,
    std_pause_duration: float,
    # Segments
    log_segments: List[dict],
    _async: bool = False,
) -> Optional[Dict[str, Any]]:
    """Log an alignment run. Returns the row dict reference for in-place mutation.

    The returned dict can be stored in gr.State and mutated on
    resegment/retranscribe/timestamps before the scheduler pushes.

    When _async=True, the expensive FLAC encoding and SHA256 hash run in a
    background daemon thread.  The row is appended to the scheduler
    immediately (with audio=None) and updated in-place once the thread
    finishes.
    """
    _ensure_schedulers()
    try:
        ts = datetime.now()
        user_id = get_user_id(request) if request else "unknown"

        # Build the segments JSON: array of run objects
        segments_runs = [{
            "min_silence_ms": int(min_silence_ms),
            "min_speech_ms": int(min_speech_ms),
            "pad_ms": int(pad_ms),
            "asr_model": asr_model,
            "segments": log_segments,
        }]

        if _async:
            # Fast path: UUID-based audio_id avoids blocking SHA256
            audio_id = f"{uuid4().hex[:16]}:{ts.strftime('%Y%m%dT%H%M%S')}"
        else:
            audio_id = _compute_audio_id(audio, ts)

        row: Dict[str, Any] = {
            "audio": None,  # filled by FLAC encode (sync or async)
            "audio_id": audio_id,
            "timestamp": ts.isoformat(timespec="seconds"),
            "user_id": user_id,
            # Input metadata
            "audio_duration_s": audio_duration_s,
            "num_segments": num_segments,
            "surah": surah,
            # Settings (latest)
            "min_silence_ms": int(min_silence_ms),
            "min_speech_ms": int(min_speech_ms),
            "pad_ms": int(pad_ms),
            "asr_model": asr_model,
            "device": device,
            # Profiling
            "total_time": total_time,
            "vad_queue_time": vad_queue_time,
            "vad_gpu_time": vad_gpu_time,
            "asr_gpu_time": asr_gpu_time,
            "dp_total_time": dp_total_time,
            # Quality & retry
            "segments_passed": segments_passed,
            "segments_failed": segments_failed,
            "mean_confidence": mean_confidence,
            "tier1_retries": tier1_retries,
            "tier1_passed": tier1_passed,
            "tier2_retries": tier2_retries,
            "tier2_passed": tier2_passed,
            "reanchors": reanchors,
            "special_merges": special_merges,
            # Reciter stats
            "words_per_minute": words_per_minute,
            "phonemes_per_second": phonemes_per_second,
            "avg_segment_duration": avg_segment_duration,
            "std_segment_duration": std_segment_duration,
            "avg_pause_duration": avg_pause_duration,
            "std_pause_duration": std_pause_duration,
            # Session flags
            "resegmented": False,
            "retranscribed": False,
            # Segments & error
            "segments": json.dumps(segments_runs),
            "word_timestamps": None,
            "char_timestamps": None,
            "error": None,
        }

        def _encode_and_append():
            """Encode FLAC and register row with scheduler/fallback."""
            try:
                row["audio"] = _encode_audio_ogg(audio, sample_rate, audio_id)
            except Exception as e:
                print(f"[USAGE_LOG] FLAC encoding failed: {e}")
            if _aligner_scheduler is None:
                _write_fallback(row)

        if _async:
            # Append row immediately so _sync_row_to_scheduler can find it;
            # background thread fills in row["audio"] in-place.
            if _aligner_scheduler is not None:
                _aligner_scheduler.append(row)
            threading.Thread(target=_encode_and_append, daemon=True).start()
        else:
            _encode_and_append()
            if _aligner_scheduler is not None:
                _aligner_scheduler.append(row)

        return row

    except Exception as e:
        print(f"[USAGE_LOG] Failed to log alignment: {e}")
        return None


def update_alignment_row(
    row: Dict[str, Any],
    *,
    action: str,
    # Input metadata (overwritten)
    audio_duration_s: float,
    num_segments: int,
    surah: int,
    # Settings for this run
    min_silence_ms: int,
    min_speech_ms: int,
    pad_ms: int,
    asr_model: str,
    device: str,
    # Profiling
    total_time: float,
    vad_queue_time: float,
    vad_gpu_time: float,
    asr_gpu_time: float,
    dp_total_time: float,
    # Quality & retry
    segments_passed: int,
    segments_failed: int,
    mean_confidence: float,
    tier1_retries: int,
    tier1_passed: int,
    tier2_retries: int,
    tier2_passed: int,
    reanchors: int,
    special_merges: int,
    # Reciter stats
    words_per_minute: float,
    phonemes_per_second: float,
    avg_segment_duration: float,
    std_segment_duration: float,
    avg_pause_duration: float,
    std_pause_duration: float,
    # Segments
    log_segments: List[dict],
) -> None:
    """Mutate an existing row dict in-place and ensure it's in the scheduler buffer.

    After mutation, syncs the row into the scheduler's buffer so the update
    is captured even if gr.State returned a deserialized copy or if the
    original row was already pushed to Hub.

    Args:
        row: The dict returned by log_alignment(), stored in gr.State.
        action: "resegment" or "retranscribe".
    """
    try:
        # Overwrite run-level fields
        row["audio_duration_s"] = audio_duration_s
        row["num_segments"] = num_segments
        row["surah"] = surah
        row["min_silence_ms"] = int(min_silence_ms)
        row["min_speech_ms"] = int(min_speech_ms)
        row["pad_ms"] = int(pad_ms)
        row["asr_model"] = asr_model
        row["device"] = device
        row["total_time"] = total_time
        row["vad_queue_time"] = vad_queue_time
        row["vad_gpu_time"] = vad_gpu_time
        row["asr_gpu_time"] = asr_gpu_time
        row["dp_total_time"] = dp_total_time
        row["segments_passed"] = segments_passed
        row["segments_failed"] = segments_failed
        row["mean_confidence"] = mean_confidence
        row["tier1_retries"] = tier1_retries
        row["tier1_passed"] = tier1_passed
        row["tier2_retries"] = tier2_retries
        row["tier2_passed"] = tier2_passed
        row["reanchors"] = reanchors
        row["special_merges"] = special_merges
        row["words_per_minute"] = words_per_minute
        row["phonemes_per_second"] = phonemes_per_second
        row["avg_segment_duration"] = avg_segment_duration
        row["std_segment_duration"] = std_segment_duration
        row["avg_pause_duration"] = avg_pause_duration
        row["std_pause_duration"] = std_pause_duration

        # Set session flag
        if action == "resegment":
            row["resegmented"] = True
        elif action == "retranscribe":
            row["retranscribed"] = True

        # Append new run to segments array
        segments_runs = json.loads(row.get("segments") or "[]")
        segments_runs.append({
            "min_silence_ms": int(min_silence_ms),
            "min_speech_ms": int(min_speech_ms),
            "pad_ms": int(pad_ms),
            "asr_model": asr_model,
            "segments": log_segments,
        })
        row["segments"] = json.dumps(segments_runs)

        # Sync with scheduler buffer — the row from gr.State may be a
        # deserialized copy, or the original may have already been pushed.
        _sync_row_to_scheduler(row)

    except Exception as e:
        print(f"[USAGE_LOG] Failed to update alignment row: {e}")


def update_word_timestamps(
    row: Dict[str, Any],
    word_timestamps_json: str,
    char_timestamps_json: Optional[str] = None,
) -> None:
    """Set word and char timestamps fields on an existing row and sync to scheduler."""
    try:
        row["word_timestamps"] = word_timestamps_json
        if char_timestamps_json is not None:
            row["char_timestamps"] = char_timestamps_json
        _sync_row_to_scheduler(row)
    except Exception as e:
        print(f"[USAGE_LOG] Failed to update word timestamps: {e}")


def log_error(user_id: str, error_message: str) -> None:
    """Log a pipeline error to JSONL."""
    try:
        with _get_error_lock():
            with ERROR_LOG_PATH.open("a") as f:
                json.dump({
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "user_id": user_id,
                    "error_message": error_message or "",
                }, f)
                f.write("\n")
    except Exception:
        pass


def _write_fallback(row: Dict[str, Any]) -> None:
    """Local-only fallback: write JSONL (without audio)."""
    fallback_path = LOG_DIR / "alignments_fallback.jsonl"
    with _fallback_lock:
        with fallback_path.open("a") as f:
            fallback_row = {k: v for k, v in row.items() if k != "audio"}
            json.dump(fallback_row, f)
            f.write("\n")
