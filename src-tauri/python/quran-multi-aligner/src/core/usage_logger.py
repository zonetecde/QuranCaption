"""Usage logger — V3 dual-dataset writer.

Two parallel HF datasets, joined by `audio_id`:
  - `USAGE_LOG_LOGS_REPO`  — all per-request metadata (append-only, one row per run).
  - `USAGE_LOG_AUDIO_REPO` — audio bytes, deduped by `audio_id` (first write wins).

A row in the logs dataset means a completed run. Errors (quota, timeout,
worker crash) write to the local JSONL error log, never to the main parquet.

Scheduler creation is deferred to first use so that background threads don't
interfere with ZeroGPU's startup function scan.
"""

import hashlib
import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4

import numpy as np

# =========================================================================
# Directory setup
# =========================================================================

LOG_DIR = Path("usage_logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)

# =========================================================================
# Dependency gate + config import
# =========================================================================

_HAS_DEPS = False
try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    from huggingface_hub import CommitScheduler
    from config import (
        USAGE_LOG_LOGS_REPO,
        USAGE_LOG_AUDIO_REPO,
        USAGE_LOG_TELEMETRY_REPO,
        USAGE_LOG_ERRORS_REPO,
        USAGE_LOG_FLUSH_MINUTES,
        USAGE_LOG_AUDIO_FLUSH_MINUTES,
        USAGE_LOG_ERRORS_FLUSH_MINUTES,
        USAGE_LOG_SCHEMA_VERSION,
        USAGE_LOG_ERRORS_SCHEMA_VERSION,
        USAGE_LOG_LOGS_SUBSET,
        USAGE_LOG_AUDIO_SUBSET,
        USAGE_LOG_TELEMETRY_SUBSET,
        USAGE_LOG_ERRORS_SUBSET,
        TELEMETRY_FLUSH_MINUTES,
        TELEMETRY_SCHEMA_VERSION,
    )
    _HAS_DEPS = True
except Exception:
    pass

# =========================================================================
# V3 schemas
# =========================================================================

_LOGS_V3_SCHEMA: Dict[str, Dict[str, str]] = {
    # Flat (filterable without JSON unpack)
    "audio_id":         {"_type": "Value", "dtype": "string"},
    "timestamp":        {"_type": "Value", "dtype": "string"},
    "user_id":          {"_type": "Value", "dtype": "string"},
    "endpoint":         {"_type": "Value", "dtype": "string"},
    "schema_version":   {"_type": "Value", "dtype": "string"},
    "audio_duration_s": {"_type": "Value", "dtype": "float64"},
    # JSON detail columns (all stored as string; consumers json.loads())
    # device / asr_model / asr_model_label live inside `settings`;
    # wall_total_s lives inside `timing`.
    "settings":         {"_type": "Value", "dtype": "string"},
    "timing":           {"_type": "Value", "dtype": "string"},
    "asr_batches":      {"_type": "Value", "dtype": "string"},
    "segments":         {"_type": "Value", "dtype": "string"},
    "events":           {"_type": "Value", "dtype": "string"},
    "anchor":           {"_type": "Value", "dtype": "string"},
    "gpu_memory":       {"_type": "Value", "dtype": "string"},
    "results_summary":  {"_type": "Value", "dtype": "string"},
    "reciter_stats":    {"_type": "Value", "dtype": "string"},
    "audio_analytics":  {"_type": "Value", "dtype": "string"},
}

_AUDIO_V3_SCHEMA: Dict[str, Dict[str, str]] = {
    "audio_id":       {"_type": "Value", "dtype": "string"},
    "audio":          {"_type": "Audio"},
    "timestamp":      {"_type": "Value", "dtype": "string"},
    "schema_version": {"_type": "Value", "dtype": "string"},
}

_TELEMETRY_SCHEMA: Dict[str, Dict[str, str]] = {
    "timestamp":      {"_type": "Value", "dtype": "string"},
    "schema_version": {"_type": "Value", "dtype": "string"},
    "space":          {"_type": "Value", "dtype": "string"},  # HF Space slug, or "local"
    # JSON string columns
    "container":      {"_type": "Value", "dtype": "string"},  # cgroup v2 per-Space truth
    "host":           {"_type": "Value", "dtype": "string"},  # physical-host aggregate
    "pool":           {"_type": "Value", "dtype": "string"},  # persistent CPU pool state
}

_ERRORS_V1_SCHEMA: Dict[str, Dict[str, str]] = {
    # Flat
    "timestamp":           {"_type": "Value", "dtype": "string"},
    "schema_version":      {"_type": "Value", "dtype": "string"},
    "audio_id":            {"_type": "Value", "dtype": "string"},  # nullable — pre-session errors
    "user_id":             {"_type": "Value", "dtype": "string"},
    "endpoint":            {"_type": "Value", "dtype": "string"},
    "device":              {"_type": "Value", "dtype": "string"},  # nullable
    "error_code":          {"_type": "Value", "dtype": "string"},  # stable ID
    "exception_type":      {"_type": "Value", "dtype": "string"},  # nullable
    "stage":               {"_type": "Value", "dtype": "string"},  # validate/download/vad/asr/anchor/dp/mfa/dispatch
    "wall_s_before_error": {"_type": "Value", "dtype": "float64"},
    # JSON columns
    "error_detail":        {"_type": "Value", "dtype": "string"},  # {message, traceback?, user_facing}
    "context":             {"_type": "Value", "dtype": "string"},  # {audio_duration_s?, asr_model_label?, settings?, ...}
    "partial_results":     {"_type": "Value", "dtype": "string"},  # {segments_attempted?, segments_failed?, ...}
    "client_hint":         {"_type": "Value", "dtype": "string"},  # {suggested_action?, reset_time?}
}


# =========================================================================
# ParquetScheduler class definition
# =========================================================================

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
            subset: Optional[str] = None,
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
            self._subset = subset

        def append(self, row: Dict[str, Any]) -> None:
            with self.lock:
                self._rows.append(row)

        def push_to_hub(self) -> None:
            with self.lock:
                rows = self._rows
                self._rows = []
            if not rows:
                return

            print(f"[USAGE_LOG] Pushing {len(rows)} row(s) to {self.repo_id}.")

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
                subdir = f"{self._subset}/" if self._subset else ""
                self.api.upload_file(
                    repo_id=self.repo_id,
                    repo_type=self.repo_type,
                    revision=self.revision,
                    path_in_repo=f"{self.path_in_repo}/{subdir}{uuid4()}.parquet",
                    path_or_fileobj=archive.name,
                )
                print(f"[USAGE_LOG] Parquet commit completed: {self.repo_id}.")
            except Exception as e:
                print(f"[USAGE_LOG] Failed to upload parquet to {self.repo_id}: {e}")
            finally:
                if archive:
                    archive.close()
                    Path(archive.name).unlink(missing_ok=True)

            for path in paths_to_cleanup:
                path.unlink(missing_ok=True)

    def _infer_schema(key: str, value: Any) -> Dict[str, str]:
        if "image" in key:
            return {"_type": "Image"}
        if "audio" in key and key != "audio_id":
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

_logs_scheduler = None
_audio_scheduler = None
_telemetry_scheduler = None
_error_scheduler = None
_schedulers_initialized = False
_init_lock = threading.Lock()
_fallback_lock = threading.Lock()


def get_telemetry_scheduler():
    """Return the telemetry ParquetScheduler (or None if not initialized)."""
    _ensure_schedulers()
    return _telemetry_scheduler

# Dedupe set for the audio dataset — first write wins.
_AUDIO_ID_SEEN: set[str] = set()
_audio_seen_lock = threading.Lock()


def _sync_card_features(
    api,
    repo_id: str,
    config_name: str,
    schema: Dict[str, Dict[str, str]],
) -> None:
    """Ensure the HF dataset card features match schema. Idempotent.

    Prevents StreamingRowsError when a new top-level column is added without a
    subset bump — HF casts parquets against the card-registered features, so the
    card must stay in sync with _*_SCHEMA dicts.
    """
    try:
        from huggingface_hub import DatasetCard
        token = getattr(api, "token", None)
        card = DatasetCard.load(repo_id, token=token)
        configs = card.data.get("configs") or []

        desired = [{"name": k, "dtype": v["dtype"]} for k, v in schema.items()
                   if v.get("_type", "Value") == "Value"]

        for cfg in configs:
            if cfg.get("config_name") == config_name:
                if cfg.get("features") == desired:
                    return
                cfg["features"] = desired
                break
        else:
            return  # config not found — don't create it here

        card.data["configs"] = configs
        card.push_to_hub(repo_id, token=token)
        print(f"[USAGE_LOG] Card features synced for {repo_id} config={config_name}.")
    except Exception as e:
        print(f"[USAGE_LOG] Card feature sync skipped for {repo_id} ({type(e).__name__}: {e}).")


def _rehydrate_audio_id_set() -> None:
    """Pull existing `audio_id` values from the audio dataset to seed the dedupe set.

    Best-effort: any exception (empty dataset, auth missing, streaming hiccup)
    leaves the set empty. Duplicate audio rows are content-hashed so harmless.
    Uses streaming + column selection so we never download audio bytes here.
    """
    if not _HAS_DEPS:
        return
    try:
        from datasets import load_dataset
        ds = load_dataset(
            USAGE_LOG_AUDIO_REPO, split="train",
            streaming=True, columns=["audio_id"],
        )
        count = 0
        for row in ds:
            _AUDIO_ID_SEEN.add(row["audio_id"])
            count += 1
        print(f"[USAGE_LOG] Rehydrated {count} audio_id(s) from {USAGE_LOG_AUDIO_REPO}.")
    except Exception as e:
        print(f"[USAGE_LOG] Audio-id rehydration skipped ({type(e).__name__}: {e}). "
              f"Starting empty — duplicate audio uploads are harmless.")


def _ensure_schedulers() -> None:
    global _logs_scheduler, _audio_scheduler, _telemetry_scheduler
    global _error_scheduler, _schedulers_initialized
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
            _logs_scheduler = ParquetScheduler(
                repo_id=USAGE_LOG_LOGS_REPO,
                schema=_LOGS_V3_SCHEMA,
                every=USAGE_LOG_FLUSH_MINUTES,
                path_in_repo="data",
                repo_type="dataset",
                private=True,
                subset=USAGE_LOG_LOGS_SUBSET,
            )
            _audio_scheduler = ParquetScheduler(
                repo_id=USAGE_LOG_AUDIO_REPO,
                schema=_AUDIO_V3_SCHEMA,
                every=USAGE_LOG_AUDIO_FLUSH_MINUTES,
                path_in_repo="data",
                repo_type="dataset",
                private=True,
                subset=USAGE_LOG_AUDIO_SUBSET,
            )
            _telemetry_scheduler = ParquetScheduler(
                repo_id=USAGE_LOG_TELEMETRY_REPO,
                schema=_TELEMETRY_SCHEMA,
                every=TELEMETRY_FLUSH_MINUTES,
                path_in_repo="data",
                repo_type="dataset",
                private=True,
                subset=USAGE_LOG_TELEMETRY_SUBSET,
            )
            _error_scheduler = ParquetScheduler(
                repo_id=USAGE_LOG_ERRORS_REPO,
                schema=_ERRORS_V1_SCHEMA,
                every=USAGE_LOG_ERRORS_FLUSH_MINUTES,
                path_in_repo="data",
                repo_type="dataset",
                private=True,
                subset=USAGE_LOG_ERRORS_SUBSET,
            )
            _rehydrate_audio_id_set()
            _api = _logs_scheduler.api
            _sync_card_features(_api, USAGE_LOG_LOGS_REPO, USAGE_LOG_LOGS_SUBSET, _LOGS_V3_SCHEMA)
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
    """SHA-256 hash (12-char) of client IP from a gr.Request, or 'unknown'."""
    try:
        headers = request.headers
        ip = (
            headers.get("x-forwarded-for", "").split(",")[0].strip()
            or headers.get("x-real-ip", "")
            or ""
        )
        if not ip:
            return "unknown"
        return hashlib.sha256(ip.encode()).hexdigest()[:12]
    except Exception:
        return "unknown"


def _compute_audio_id(audio: np.ndarray) -> str:
    """Deterministic content hash for audio dedupe (16-char sha256).

    V3 change: no timestamp component — audio_id is *purely* content-based so
    the same audio across resegment / retranscribe / restart returns the same
    key. This is the join key between the audio and metadata datasets.
    """
    return hashlib.sha256(audio.tobytes()).hexdigest()[:16]


def _encode_audio_ogg(audio: np.ndarray, sample_rate: int, audio_id: str) -> str:
    """Encode audio to a temp OGG Vorbis file; returns the file path."""
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
    """Re-sync a mutated row into the logs scheduler buffer.

    gr.State may deserialize the dict (creating a copy), and push_to_hub
    detaches rows from the buffer. This helper finds the original row by
    (audio_id, timestamp) and updates it, or re-appends if it was already pushed.
    """
    if _logs_scheduler is None:
        return
    audio_id = row.get("audio_id")
    ts = row.get("timestamp")
    if not audio_id:
        return
    with _logs_scheduler.lock:
        for buffered in _logs_scheduler._rows:
            if (buffered.get("audio_id") == audio_id
                    and buffered.get("timestamp") == ts):
                buffered.update(row)
                return
        _logs_scheduler._rows.append(row)


# =========================================================================
# Public logging API — V3
# =========================================================================


def log_alignment(
    *,
    audio: np.ndarray,
    sample_rate: int,
    request=None,
    # Flat fields (device/asr_model live inside `settings`; wall_total_s inside `timing`)
    audio_duration_s: float,
    endpoint: str,
    # JSON columns (dicts/lists, not yet serialized)
    settings: dict,
    timing: dict,
    asr_batches: list,
    segments: list,
    events: list,
    anchor: dict,
    gpu_memory: Optional[dict],
    results_summary: dict,
    reciter_stats: dict,
    audio_analytics: Optional[dict] = None,
    _async: bool = True,
) -> Optional[Dict[str, Any]]:
    """Append a metadata row to the logs dataset and (if new) an audio row.

    Returns the metadata row dict so the caller can hold it in gr.State and
    later mutate it via update_feedback / update_edited_ref.

    The audio dataset is deduped by content-hashed `audio_id`. Metadata grows
    1:N per audio_id across resegment / retranscribe / realign runs.
    """
    _ensure_schedulers()
    try:
        ts = datetime.now()
        user_id = get_user_id(request) if request else "unknown"
        audio_id = _compute_audio_id(audio)

        # -------- Metadata row (append always) --------
        row: Dict[str, Any] = {
            "audio_id": audio_id,
            "timestamp": ts.isoformat(timespec="seconds"),
            "user_id": user_id,
            "endpoint": endpoint,
            "schema_version": USAGE_LOG_SCHEMA_VERSION,
            "audio_duration_s": float(audio_duration_s),
            "settings":        json.dumps(settings),
            "timing":          json.dumps(timing),
            "asr_batches":     json.dumps(asr_batches),
            "segments":        json.dumps(segments),
            "events":          json.dumps(events),
            "anchor":          json.dumps(anchor),
            "gpu_memory":      json.dumps(gpu_memory) if gpu_memory is not None else None,
            "results_summary": json.dumps(results_summary),
            "reciter_stats":   json.dumps(reciter_stats),
            "audio_analytics": json.dumps(audio_analytics) if audio_analytics is not None else None,
        }
        if _logs_scheduler is not None:
            _logs_scheduler.append(row)
        else:
            _write_fallback(row)

        # -------- Audio row (dedupe by audio_id; first write wins) --------
        with _audio_seen_lock:
            already_seen = audio_id in _AUDIO_ID_SEEN
            if not already_seen:
                _AUDIO_ID_SEEN.add(audio_id)
        if not already_seen:
            def _encode_and_append_audio():
                try:
                    ogg_path = _encode_audio_ogg(audio, sample_rate, audio_id)
                except Exception as e:
                    print(f"[USAGE_LOG] OGG encoding failed for {audio_id}: {e}")
                    with _audio_seen_lock:
                        _AUDIO_ID_SEEN.discard(audio_id)  # allow retry on next run
                    return
                audio_row = {
                    "audio_id": audio_id,
                    "audio": ogg_path,
                    "timestamp": ts.isoformat(timespec="seconds"),
                    "schema_version": USAGE_LOG_SCHEMA_VERSION,
                }
                if _audio_scheduler is not None:
                    _audio_scheduler.append(audio_row)

            if _async:
                threading.Thread(target=_encode_and_append_audio, daemon=True).start()
            else:
                _encode_and_append_audio()

        return row

    except Exception as e:
        print(f"[USAGE_LOG] Failed to log alignment: {e}")
        return None


def update_feedback(
    row: Dict[str, Any],
    segment_idx: int,
    vote: str,
    comment: Optional[str] = None,
) -> None:
    """Add repetition feedback to a segment in the current row's `segments` column.

    V3: segments is a flat list (one row = one run), not list-of-runs. Match
    by `idx`.
    """
    try:
        segs = json.loads(row.get("segments") or "[]")
        for seg in segs:
            if seg.get("idx") == segment_idx:
                fb = {"vote": vote}
                if comment:
                    fb["comment"] = comment
                seg["repetition_feedback"] = fb
                break
        row["segments"] = json.dumps(segs)
        _sync_row_to_scheduler(row)
    except Exception as e:
        print(f"[USAGE_LOG] Failed to update feedback: {e}")


def update_edited_ref(
    row: Dict[str, Any],
    segment_idx: int,
    edited_ref: str,
) -> None:
    """Set edited_ref on a segment in the current row's `segments` column."""
    try:
        segs = json.loads(row.get("segments") or "[]")
        for seg in segs:
            if seg.get("idx") == segment_idx:
                seg["edited_ref"] = edited_ref
                break
        row["segments"] = json.dumps(segs)
        _sync_row_to_scheduler(row)
    except Exception as e:
        print(f"[USAGE_LOG] Failed to update edited ref: {e}")


def _write_fallback(row: Dict[str, Any]) -> None:
    """Local-only fallback: write JSONL when the logs scheduler isn't up."""
    fallback_path = LOG_DIR / "alignments_fallback.jsonl"
    with _fallback_lock:
        with fallback_path.open("a") as f:
            json.dump(row, f)
            f.write("\n")


# =========================================================================
# Stage TLS + log_error() public API
# =========================================================================

_STAGE_TLS = threading.local()


def set_stage(stage: str) -> None:
    """Set current pipeline stage. Read by log_error() when the caller
    omits `stage`. Safe no-op if called from an untracked thread."""
    _STAGE_TLS.stage = stage
    _STAGE_TLS.stage_started_at = datetime.now()


def clear_stage() -> None:
    _STAGE_TLS.stage = None
    _STAGE_TLS.stage_started_at = None


def get_stage() -> Optional[str]:
    return getattr(_STAGE_TLS, "stage", None)


def mark_endpoint_entry() -> None:
    """Reset stage TLS at endpoint entry so stale state doesn't leak."""
    _STAGE_TLS.stage = None
    _STAGE_TLS.stage_started_at = None
    _STAGE_TLS.endpoint_started_at = datetime.now()


def _endpoint_wall_s() -> Optional[float]:
    started = getattr(_STAGE_TLS, "endpoint_started_at", None)
    if started is None:
        return None
    return (datetime.now() - started).total_seconds()


def log_error(
    *,
    error_code: str,
    endpoint: str,
    stage: Optional[str] = None,
    audio_id: Optional[str] = None,
    device: Optional[str] = None,
    exception: Optional[BaseException] = None,
    message: Optional[str] = None,
    wall_s: Optional[float] = None,
    context: Optional[Dict[str, Any]] = None,
    partial: Optional[Dict[str, Any]] = None,
    hint: Optional[Dict[str, Any]] = None,
    user_id: str = "unknown",
    user_facing: bool = True,
    include_traceback: bool = True,
) -> None:
    """Append one row to the errors dataset. Never raises.

    At least one of `exception` or `message` should be provided. Stage
    defaults to the TLS-tracked last stage. Wall-s defaults to time since
    endpoint entry when tracked.
    """
    try:
        _ensure_schedulers()

        if stage is None:
            stage = get_stage()
        if wall_s is None:
            wall_s = _endpoint_wall_s()

        exc_type = type(exception).__name__ if exception is not None else None
        if message is None:
            message = str(exception) if exception is not None else ""

        detail: Dict[str, Any] = {"message": message, "user_facing": user_facing}
        if include_traceback and exception is not None:
            import traceback
            detail["traceback"] = "".join(
                traceback.format_exception(type(exception), exception,
                                           exception.__traceback__)
            )[-4000:]  # truncate: last 4KB

        row: Dict[str, Any] = {
            "timestamp":           datetime.now().isoformat(timespec="seconds"),
            "schema_version":      USAGE_LOG_ERRORS_SCHEMA_VERSION,
            "audio_id":            audio_id,
            "user_id":             user_id,
            "endpoint":            endpoint,
            "device":              device,
            "error_code":          error_code,
            "exception_type":      exc_type,
            "stage":               stage,
            "wall_s_before_error": float(wall_s) if wall_s is not None else None,
            "error_detail":        json.dumps(detail),
            "context":             json.dumps(context) if context else None,
            "partial_results":     json.dumps(partial) if partial else None,
            "client_hint":         json.dumps(hint) if hint else None,
        }

        if _error_scheduler is not None:
            _error_scheduler.append(row)
        else:
            _write_error_fallback(row)

    except Exception as e:
        # Never let error logging itself break a request path.
        print(f"[USAGE_LOG] log_error() itself failed: {e}")


def _write_error_fallback(row: Dict[str, Any]) -> None:
    """Local-only fallback for error rows when scheduler is missing."""
    path = LOG_DIR / "errors_fallback.jsonl"
    with _fallback_lock:
        with path.open("a") as f:
            json.dump(row, f)
            f.write("\n")
