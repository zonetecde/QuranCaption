"""Phase 5 (Optional): Montreal Forced Aligner (MFA) Integration Engine.

Provides high-precision 10ms phone-level and letter-level acoustic forced alignment
using the Hafs riwaya acoustic model and pronunciation dictionary.
Operates as an independent, non-intrusive add-on module.
"""

from __future__ import annotations

import os
import re
import sys
import time
import math
import json
import shutil
import logging
import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict
from typing import Optional, List, Dict, Any, Tuple, Callable
import numpy as np
import scipy.io.wavfile as wavfile

import config

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. DATA MODELS FOR MFA ALIGNMENT
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass(slots=True)
class MfaPhone:
    """Individual phone/letter timing produced by Montreal Forced Aligner."""
    phone: str
    start: float
    end: float
    duration: float
    rule: Optional[str] = None
    golden_len: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "phone": self.phone,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.duration, 3),
        }
        if self.rule is not None:
            d["rule"] = self.rule
        if self.golden_len is not None:
            d["golden_len"] = self.golden_len
        return d


@dataclass(slots=True)
class MfaWord:
    """Word-level timing and constituent phones from MFA TextGrid."""
    word: str
    start: float
    end: float
    duration: float
    phones: List[MfaPhone] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "word": self.word,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "duration": round(self.duration, 3),
            "phones": [p.to_dict() for p in self.phones],
            "phonemes": [
                {
                    "phoneme": p.phone,
                    "start": round(p.start, 3),
                    "end": round(p.end, 3),
                    **({"rule": p.rule} if p.rule else {}),
                    **({"golden_len": p.golden_len} if p.golden_len else {}),
                }
                for p in self.phones
            ],
        }


@dataclass(slots=True)
class MfaAyahResult:
    """Aligned Ayah result with words, letters, and Tajweed rule annotations."""
    surah: int
    ayah: int
    start_time: float
    end_time: float
    words: List[MfaWord] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ayah": self.ayah,
            "surah": self.surah,
            "start": round(self.start_time, 3),
            "end": round(self.end_time, 3),
            "duration": round(self.end_time - self.start_time, 3),
            "segments": [
                {
                    "segment": 1,
                    "start": round(self.start_time, 3),
                    "end": round(self.end_time, 3),
                    "words": [w.to_dict() for w in self.words],
                }
            ],
            "words": [w.to_dict() for w in self.words],
        }


# ═══════════════════════════════════════════════════════════════════════════════
# 2. ZERO-DEPENDENCY PRAAT TEXTGRID PARSER
# ═══════════════════════════════════════════════════════════════════════════════

def parse_praat_textgrid(filepath: str) -> Dict[str, List[Tuple[float, float, str]]]:
    """Lightweight, robust parser for Praat IntervalTiers without third-party dependencies."""
    tiers: Dict[str, List[Tuple[float, float, str]]] = {}
    if not os.path.exists(filepath):
        return tiers

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        lines = [line.strip() for line in f]

    current_tier_name = None
    in_interval = False
    cur_xmin: Optional[float] = None
    cur_xmax: Optional[float] = None
    cur_text: Optional[str] = None

    i = 0
    num_lines = len(lines)
    while i < num_lines:
        line = lines[i]
        if line.startswith('class = "IntervalTier"'):
            # Next line usually contains name
            i += 1
            if i < num_lines and lines[i].startswith('name ='):
                current_tier_name = lines[i].split("=")[-1].strip().strip('"')
                tiers[current_tier_name] = []
        elif current_tier_name and line.startswith("intervals ["):
            in_interval = True
            cur_xmin, cur_xmax, cur_text = None, None, None
        elif in_interval:
            if line.startswith("xmin ="):
                try:
                    cur_xmin = float(line.split("=")[-1].strip())
                except ValueError:
                    pass
            elif line.startswith("xmax ="):
                try:
                    cur_xmax = float(line.split("=")[-1].strip())
                except ValueError:
                    pass
            elif line.startswith("text ="):
                raw_text = line[line.find("=") + 1:].strip().strip('"')
                cur_text = raw_text
                if cur_xmin is not None and cur_xmax is not None:
                    # Ignore silence intervals labeled "", "<eps>", or "sil"
                    if cur_text not in ("", "<eps>", "sil", "sp"):
                        tiers[current_tier_name].append((cur_xmin, cur_xmax, cur_text))
                in_interval = False
        i += 1

    return tiers


# ═══════════════════════════════════════════════════════════════════════════════
# 3. RULE INDEX LOADER
# ═══════════════════════════════════════════════════════════════════════════════

def load_tajweed_rule_index(rule_index_path: str) -> Dict[Tuple[int, int], List[Dict[str, Any]]]:
    """Loads per-ayah Tajweed rule annotations from rule_index.jsonl."""
    rule_map: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}
    if not os.path.exists(rule_index_path):
        logger.warning(f"Tajweed rule index not found at: {rule_index_path}")
        return rule_map

    with open(rule_index_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                s = entry.get("surah")
                a = entry.get("ayah")
                phones = entry.get("phones", [])
                if s is not None and a is not None:
                    rule_map[(s, a)] = phones
            except Exception:
                continue

    return rule_map


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MFA ALIGNMENT ENGINE & ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════════

class QuranMfaAligner:
    """Independent Montreal Forced Aligner interface for high-precision phoneme timing."""

    def __init__(
        self,
        mfa_dir: Optional[str] = None,
        acoustic_model_path: Optional[str] = None,
        dict_path: Optional[str] = None,
        rule_index_path: Optional[str] = None,
    ):
        base_dir = mfa_dir or getattr(
            config,
            "DEFAULT_MFA_DIR",
            Path(getattr(config, "DATA_PATH", "data")) / "mfa",
        )
        self.acoustic_model = acoustic_model_path or getattr(
            config, "DEFAULT_MFA_ACOUSTIC_PATH", str(Path(base_dir) / "quran_hafs_acoustic.zip")
        )
        self.dictionary = dict_path or getattr(
            config, "DEFAULT_MFA_DICT_PATH", str(Path(base_dir) / "quran_hafs.dict")
        )
        self.rule_index_path = rule_index_path or getattr(
            config, "DEFAULT_MFA_RULES_PATH", str(Path(base_dir) / "rule_index.jsonl")
        )
        self._rule_cache: Optional[Dict[Tuple[int, int], List[Dict[str, Any]]]] = None

    @classmethod
    def find_micromamba_executable(cls) -> Optional[str]:
        """Locates the 'micromamba' executable in PATH, project data/bin, WinGet, or standard app dirs."""
        which_m = shutil.which("micromamba") or shutil.which("micromamba.exe")
        if which_m:
            return which_m

        # 1. Check project-local data/bin directory (self-contained with repo)
        data_bin = Path(config.DATA_PATH) / "bin"
        local_project_exe = data_bin / ("micromamba.exe" if sys.platform == "win32" else "micromamba")
        if local_project_exe.is_file():
            return str(local_project_exe)

        # 2. Check WinGet package directories (Windows 10/11)
        local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
        winget_dir = local_app_data / "Microsoft" / "WinGet" / "Packages"
        if winget_dir.exists():
            for p in winget_dir.rglob("micromamba.exe"):
                if p.is_file():
                    return str(p)

        windows_apps = local_app_data / "Microsoft" / "WindowsApps" / "micromamba.exe"
        if windows_apps.is_file():
            return str(windows_apps)

        # 3. Check configured MFA directory
        base_dir = getattr(
            config,
            "DEFAULT_MFA_DIR",
            Path(getattr(config, "DATA_PATH", "data")) / "mfa",
        )
        exe_name = "micromamba.exe" if sys.platform == "win32" else "micromamba"
        local_exe = Path(base_dir) / "bin" / exe_name
        if local_exe.is_file():
            return str(local_exe)

        # 4. Check user home directories (~/.local/bin, ~/bin, ~/micromamba)
        home = Path.home()
        for cand in [
            home / ".local" / "bin" / exe_name,
            home / "bin" / exe_name,
            home / "micromamba" / exe_name,
            Path(os.environ.get("APPDATA", "")) / "mamba" / exe_name,
            local_app_data / "micromamba" / exe_name,
        ]:
            if cand.is_file():
                return str(cand)

        return None

    @classmethod
    def bootstrap_micromamba(cls) -> Optional[str]:
        """Downloads official standalone micromamba (~4.5MB compressed archive) and unpacks the binary.

        Requires ZERO external dependencies; uses Python's built-in urllib and tarfile.
        """
        import io
        import tarfile
        import platform
        import urllib.request

        # Determine target executable location in project data/bin
        target_dir = Path(config.DATA_PATH) / "bin"
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            target_dir = Path.home() / ".local" / "bin"
            target_dir.mkdir(parents=True, exist_ok=True)

        exe_name = "micromamba.exe" if sys.platform == "win32" else "micromamba"
        target_exe = target_dir / exe_name

        if target_exe.is_file():
            return str(target_exe)

        # Detect operating system architecture for official micro.mamba.pm API
        mach = platform.machine().lower()
        if sys.platform == "win32":
            arch_tag = "win-64"
        elif sys.platform == "darwin":
            arch_tag = "osx-arm64" if "arm" in mach else "osx-64"
        else:
            arch_tag = "linux-aarch64" if ("arm" in mach or "aarch64" in mach) else "linux-64"

        url = f"https://micro.mamba.pm/api/micromamba/{arch_tag}/latest"
        print(f"[*] Downloading standalone Micromamba binary (~4.5MB) from {url}...", flush=True)

        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (QuranReciteToText/1.0; Automator)"},
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                archive_bytes = resp.read()

            with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:bz2") as tf:
                members = tf.getmembers()
                match = [m for m in members if m.name.endswith(exe_name)]
                if not match:
                    raise RuntimeError(f"Could not find '{exe_name}' inside micromamba archive.")
                extracted = tf.extractfile(match[0])
                if extracted is None:
                    raise RuntimeError(f"Failed to read '{match[0].name}' from archive.")
                with open(target_exe, "wb") as f_out:
                    f_out.write(extracted.read())

            if sys.platform != "win32":
                target_exe.chmod(0o755)

            print(f"[+] Micromamba standalone binary ready at: {target_exe}", flush=True)
            return str(target_exe)
        except Exception as e:
            logger.error(f"Failed to auto-download micromamba: {e}")
            print(f"[!] Failed to auto-download micromamba: {e}")
            return None

    @classmethod
    def find_mfa_executable(cls) -> Optional[str]:
        """Locates the 'mfa' executable in PATH, custom env vars, or standard Conda/Micromamba envs."""
        # 1. Check custom environment variable
        custom = os.environ.get("MFA_PATH") or os.environ.get("MFA_EXECUTABLE")
        if custom and os.path.isfile(custom):
            return custom

        # 2. Check current system PATH
        which_mfa = shutil.which("mfa") or shutil.which("mfa.exe")
        if which_mfa:
            return which_mfa

        # 3. Check custom or default MAMBA_ROOT_PREFIX
        candidates: List[Path] = []
        root_prefix = os.environ.get("MAMBA_ROOT_PREFIX")
        if root_prefix:
            rp = Path(root_prefix)
            candidates.extend([
                rp / "envs" / "aligner" / "Scripts" / "mfa.exe",
                rp / "envs" / "aligner" / "bin" / "mfa",
                rp / "envs" / "aligner" / "mfa.exe",
            ])

        # 4. Check standard Conda / Micromamba / Miniforge environments
        home = Path.home()
        appdata = Path(os.environ.get("APPDATA", ""))
        localappdata = Path(os.environ.get("LOCALAPPDATA", ""))
        programdata = Path(os.environ.get("PROGRAMDATA", ""))

        candidates.extend([
            # Micromamba default Windows prefix (%APPDATA%\mamba\envs\aligner)
            appdata / "mamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            appdata / "mamba" / "envs" / "aligner" / "bin" / "mfa",
            appdata / "micromamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            localappdata / "mamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            localappdata / "micromamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / "micromamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / "micromamba" / "envs" / "aligner" / "bin" / "mfa",
            home / "mamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / "mamba" / "envs" / "aligner" / "bin" / "mfa",
            home / ".local" / "share" / "mamba" / "envs" / "aligner" / "bin" / "mfa",
            home / "miniforge3" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / "miniforge3" / "envs" / "aligner" / "bin" / "mfa",
            home / "miniconda3" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / "miniconda3" / "envs" / "aligner" / "bin" / "mfa",
            home / "anaconda3" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / ".conda" / "envs" / "aligner" / "Scripts" / "mfa.exe",
            home / ".conda" / "envs" / "aligner" / "bin" / "mfa",
            programdata / "micromamba" / "envs" / "aligner" / "Scripts" / "mfa.exe",
        ])
        for c in candidates:
            if c.is_file():
                return str(c)
        return None

    @classmethod
    def is_mfa_installed(cls) -> bool:
        """Checks if the `mfa` executable or micromamba aligner environment is found and functional."""
        if cls.find_mfa_executable() is not None:
            return True

        # Secondary check: verify if micromamba can run 'mfa' in aligner environment
        mamba = cls.find_micromamba_executable()
        if mamba:
            try:
                env_vars = os.environ.copy()
                if "MAMBA_ROOT_PREFIX" not in env_vars:
                    default_root = (
                        os.path.join(os.environ.get("APPDATA", str(Path.home())), "mamba")
                        if sys.platform == "win32"
                        else os.path.expanduser("~/.local/share/mamba")
                    )
                    env_vars["MAMBA_ROOT_PREFIX"] = default_root

                res = subprocess.run(
                    [mamba, "run", "-n", "aligner", "mfa", "version"],
                    capture_output=True,
                    text=True,
                    env=env_vars,
                    timeout=5,
                )
                if res.returncode == 0:
                    return True
            except Exception:
                pass

        return False

    @classmethod
    def ensure_mfa_installed(cls, auto_install: bool = True) -> bool:
        """Verifies MFA is installed, or automatically bootstraps and configures it if needed.

        Uses the exact minimal CPU-only specification:
          kaldi=*=cpu*  blas=*=openblas
        Downloading only ~300MB total instead of the bloated 2GB CUDA/GPU packages.
        """
        if cls.is_mfa_installed():
            return True

        if not auto_install:
            return False

        print("\n" + "=" * 70)
        print("[*] Montreal Forced Aligner ('mfa') environment not found.")
        print("[*] Automatically configuring lightweight CPU-only environment (~300MB)...")
        print("    (One-time setup: Kaldi CPU + OpenBLAS + MFA. Zero CUDA/GPU bloat).")
        print("    (All future runs will start instantly with zero download).")
        print("=" * 70 + "\n", flush=True)

        mamba_exe = cls.find_micromamba_executable()
        conda_exe = shutil.which("conda") or shutil.which("mamba")

        if not mamba_exe and not conda_exe:
            mamba_exe = cls.bootstrap_micromamba()

        env_vars = os.environ.copy()
        if "MAMBA_ROOT_PREFIX" not in env_vars:
            if sys.platform == "win32":
                default_root = os.path.join(os.environ.get("APPDATA", str(Path.home())), "mamba")
            else:
                default_root = os.path.expanduser("~/.local/share/mamba")
            env_vars["MAMBA_ROOT_PREFIX"] = default_root

        installer_cmd: List[str] = []
        if mamba_exe:
            installer_cmd = [
                mamba_exe, "create", "-n", "aligner",
                "-c", "conda-forge",
                "montreal-forced-aligner",
                "kaldi=*=cpu*",
                "blas=*=openblas",
                "-y",
            ]
        elif conda_exe:
            installer_cmd = [
                conda_exe, "create", "-n", "aligner",
                "-c", "conda-forge",
                "montreal-forced-aligner",
                "kaldi=*=cpu*",
                "blas=*=openblas",
                "-y",
            ]

        if not installer_cmd:
            print("[!] Could not initialize a package installer.")
            return False

        print(f"[*] Executing automated environment setup: {' '.join(installer_cmd[:6])}...", flush=True)
        try:
            process = subprocess.Popen(
                installer_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env_vars,
            )
            if process.stdout:
                for line in process.stdout:
                    clean_line = line.strip()
                    if clean_line and any(
                        k in clean_line
                        for k in (
                            "Downloading",
                            "Extracting",
                            "Linking",
                            "Transaction",
                            "Done",
                            "Package",
                            "Install:",
                            "critical",
                            "error",
                            "warning",
                        )
                    ):
                        print(f"    {clean_line}", flush=True)
            process.wait()
            if process.returncode != 0:
                print(f"[!] Automated MFA setup exited with code {process.returncode}.")
                return False

            print("\n[+] Montreal Forced Aligner environment configured successfully!\n", flush=True)
            return cls.is_mfa_installed()
        except KeyboardInterrupt:
            print("\n[!] Setup interrupted by user. Continuing pipeline without MFA.")
            return False
        except Exception as e:
            print(f"[!] Error during automated MFA setup: {e}")
            return False

    def _get_rules(self) -> Dict[Tuple[int, int], List[Dict[str, Any]]]:
        if self._rule_cache is None:
            self._rule_cache = load_tajweed_rule_index(self.rule_index_path)
        return self._rule_cache

    @staticmethod
    def _split_into_monotonic_utterances(words: List[Any]) -> List[List[Any]]:
        """Partitions words into strictly forward-monotonic chronological utterances.

        DOES NOT rely on 'is_repetition: true'.
        Instead, detects acoustic restarts, pauses, and resets based directly on:
          1. Timestamp backward jump: w[i].start < w[i-1].start - 0.05
          2. Severe overlap / restart: w[i].start < w[i-1].end - 0.25
          3. Location index reset: e.g. location '55:1:1' following '55:1:3'
        """
        if not words:
            return []

        chunks: List[List[Any]] = []
        cur_chunk: List[Any] = []

        for w in words:
            if not cur_chunk:
                cur_chunk.append(w)
                continue

            prev_w = cur_chunk[-1]
            p_s = getattr(prev_w, "start", None) or 0.0
            p_e = getattr(prev_w, "end", None) or 0.0
            c_s = getattr(w, "start", None) or 0.0

            # Acoustic reset: current word starts before previous word started or overlaps heavily
            time_reset = (c_s < p_s - 0.05) or (c_s < p_e - 0.25)

            # Location index reset (e.g. reciter restarts Ayah from beginning)
            loc_reset = False
            prev_loc = getattr(prev_w, "location", None)
            curr_loc = getattr(w, "location", None)
            if prev_loc and curr_loc:
                try:
                    p_parts = [int(x) for x in str(prev_loc).split(":")]
                    c_parts = [int(x) for x in str(curr_loc).split(":")]
                    if c_parts <= p_parts:
                        loc_reset = True
                except Exception:
                    pass

            if time_reset or loc_reset:
                chunks.append(cur_chunk)
                cur_chunk = [w]
            else:
                cur_chunk.append(w)

        if cur_chunk:
            chunks.append(cur_chunk)

        return chunks

    @staticmethod
    def _clean_lab_word(text: str) -> str:
        """Strips decorative Quranic pause/sajda marks not present in the pronunciation dictionary."""
        if not text:
            return ""
        cleaned = re.sub(r"[\u06D6-\u06DB\u06DE\u06E9]", "", text).strip()
        return cleaned or text

    def prepare_corpus(
        self,
        segments: List[Any],
        audio_pcm: np.ndarray,
        corpus_dir: str,
        sample_rate: int = 16000,
    ) -> List[Tuple[str, int, int, int, float, List[Any]]]:
        """Slices audio into strictly monotonic, linear WAV and LAB files ready for MFA.

        CRITICAL DESIGN RULE:
        Does NOT rely on 'is_repetition: true'. Every acoustic utterance (whether sub-segment,
        repetition, or pause-delimited pass) is treated as a standalone monotonic audio clip.
        This guarantees Montreal Forced Aligner never sees non-linear jumps.
        """
        os.makedirs(corpus_dir, exist_ok=True)
        ayah_clips: List[Tuple[str, int, int, int, float, List[Any]]] = []

        for seg in segments:
            surah = getattr(seg, "surah_number", 1)
            ayah = getattr(seg, "ayah", 1)
            subs = getattr(seg, "sub_segments", None)

            # Collect candidate word sequences: prefer sub_segments if present, else seg.words
            candidate_units: List[List[Any]] = []
            if subs:
                for sub in subs:
                    sub_words = getattr(sub, "words", [])
                    if sub_words:
                        candidate_units.append(sub_words)
            else:
                seg_words = getattr(seg, "words", [])
                if seg_words:
                    candidate_units.append(seg_words)

            # Split any internally non-monotonic chunks (e.g. restarts without sub_segment tags)
            linear_units: List[List[Any]] = []
            for unit_words in candidate_units:
                monotonic_chunks = self._split_into_monotonic_utterances(unit_words)
                linear_units.extend(monotonic_chunks)

            clip_idx = 1
            for chunk_words in linear_units:
                uthmani_words = [
                    self._clean_lab_word(w.word)
                    for w in chunk_words
                    if getattr(w, "word", None)
                ]
                uthmani_words = [w for w in uthmani_words if w]
                if not uthmani_words:
                    continue

                valid_starts = [w.start for w in chunk_words if getattr(w, "start", None) is not None]
                valid_ends = [w.end for w in chunk_words if getattr(w, "end", None) is not None]
                if not valid_starts or not valid_ends:
                    continue

                w_start = min(valid_starts)
                w_end = max(valid_ends)

                # Add 200ms safety margins clamped to total audio duration for clean silence modeling
                total_duration = len(audio_pcm) / sample_rate
                s_time = max(0.0, w_start - 0.20)
                e_time = min(total_duration, w_end + 0.20)

                if e_time <= s_time:
                    continue

                base_name = f"s{surah:03d}_a{ayah:03d}_c{clip_idx:02d}"
                clip_idx += 1

                lab_path = os.path.join(corpus_dir, f"{base_name}.lab")
                wav_path = os.path.join(corpus_dir, f"{base_name}.wav")

                # Write LAB text file containing ONLY the words actually uttered in this pass
                with open(lab_path, "w", encoding="utf-8") as f:
                    f.write(" ".join(uthmani_words) + "\n")

                # Slice and save 16kHz mono PCM audio
                s_idx = max(0, int(round(s_time * sample_rate)))
                e_idx = min(len(audio_pcm), int(round(e_time * sample_rate)))
                slice_pcm = audio_pcm[s_idx:e_idx]

                if slice_pcm.dtype in (np.float32, np.float64):
                    slice_int16 = (np.clip(slice_pcm, -1.0, 1.0) * 32767).astype(np.int16)
                else:
                    slice_int16 = slice_pcm.astype(np.int16)

                wavfile.write(wav_path, sample_rate, slice_int16)
                ayah_clips.append((base_name, surah, ayah, clip_idx - 1, s_time, chunk_words))

        return ayah_clips

    def run_alignment(
        self,
        corpus_dir: str,
        output_dir: str,
        temp_dir: Optional[str] = None,
        beam: Optional[int] = None,
        retry_beam: Optional[int] = None,
        num_jobs: Optional[int] = None,
        on_progress: Optional[Callable[[float, float], None]] = None,
        start_time: Optional[float] = None,
        est_duration: float = 35.0,
    ) -> bool:
        """Executes Montreal Forced Aligner command-line subprocess in fast single-speaker mode."""
        micromamba_exe = self.find_micromamba_executable()
        mfa_exe = self.find_mfa_executable()
        if not mfa_exe and not micromamba_exe:
            logger.error("MFA executable 'mfa' not found in PATH or standard environment locations.")
            return False

        if not os.path.exists(self.acoustic_model):
            logger.error(f"MFA acoustic model not found at: {self.acoustic_model}")
            return False

        if not os.path.exists(self.dictionary):
            logger.error(f"MFA dictionary not found at: {self.dictionary}")
            return False

        eff_beam = beam if beam is not None else getattr(config, "MFA_BEAM", 40)
        eff_retry_beam = retry_beam if retry_beam is not None else getattr(config, "MFA_RETRY_BEAM", 160)
        eff_num_jobs = num_jobs if num_jobs is not None else getattr(config, "MFA_NUM_JOBS", 2)

        align_args = [
            "align",
            corpus_dir,
            self.dictionary,
            self.acoustic_model,
            output_dir,
            "--clean",
            "--overwrite",
            "--use_threading",
            "--no_textgrid_cleanup",
            "--num_jobs", str(eff_num_jobs),
            "--beam", str(eff_beam),
            "--retry_beam", str(eff_retry_beam),
            "--quiet",
        ]

        if temp_dir:
            align_args.extend(["--temporary_directory", temp_dir])

        if micromamba_exe:
            cmd = [micromamba_exe, "run", "-n", "aligner", "mfa"] + align_args
        else:
            cmd = [mfa_exe] + align_args

        # Ensure environment PATH contains Kaldi/OpenFST libraries
        env_vars = os.environ.copy()
        if mfa_exe:
            exe_path = Path(mfa_exe)
            env_dir = exe_path.parent.parent if exe_path.parent.name.lower() in ("scripts", "bin") else exe_path.parent
            lib_bin = env_dir / "Library" / "bin"
            scripts_dir = env_dir / "Scripts"
            env_vars["PATH"] = f"{lib_bin};{scripts_dir};{env_dir};{env_vars.get('PATH', '')}"

        align_start = start_time if start_time is not None else time.time()
        logger.info(f"Running MFA alignment: {' '.join(cmd)}")
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env_vars,
            )
            while process.poll() is None:
                if on_progress:
                    elp = max(0.0, time.time() - align_start)
                    ratio = elp / max(5.0, est_duration)
                    pct = 5.0 + 87.0 * (1.0 - math.exp(-1.8 * ratio))
                    on_progress(min(92.0, max(5.0, pct)), elp)
                time.sleep(0.20)

            stdout, stderr = process.communicate()
            if process.returncode != 0:
                logger.error(f"MFA execution failed with exit code {process.returncode}: {stderr}")
                return False

            logger.info("MFA alignment completed successfully.")
            return True
        except Exception as e:
            logger.error(f"MFA execution error: {e}")
            return False

    @staticmethod
    def _align_words_to_chunk(
        chunk_words: List[Any],
        words_raw: List[Tuple[float, float, str]],
    ) -> List[Tuple[Any, Optional[Tuple[float, float, str]]]]:
        """Aligns Praat TextGrid words to chunk QuranWord objects using sequence edit distance.

        Guarantees that missing or dropped MFA intervals NEVER shift indices for subsequent words.
        """
        if not chunk_words:
            return []
        if not words_raw:
            return [(qw, None) for qw in chunk_words]

        tashkeel_re = re.compile(r"[\u0617-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]")

        def norm_text(t: str) -> str:
            if not t:
                return ""
            t = tashkeel_re.sub("", t)
            t = t.replace("ٱ", "ا").replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").replace("ـٰ", "").replace(" ", "")
            return t

        ref_keys = [norm_text(getattr(qw, "word", "")) for qw in chunk_words]
        hyp_keys = [norm_text(t) for _, _, t in words_raw]

        n, m = len(ref_keys), len(hyp_keys)
        dp = [[0] * (m + 1) for _ in range(n + 1)]
        for i in range(n + 1):
            dp[i][0] = i
        for j in range(m + 1):
            dp[0][j] = j

        for i in range(1, n + 1):
            for j in range(1, m + 1):
                match_cost = 0 if ref_keys[i - 1] == hyp_keys[j - 1] else 2
                dp[i][j] = min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + match_cost,
                )

        i, j = n, m
        pairs: List[Tuple[int, Optional[int]]] = []
        while i > 0 or j > 0:
            if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (0 if ref_keys[i - 1] == hyp_keys[j - 1] else 2):
                pairs.append((i - 1, j - 1))
                i -= 1
                j -= 1
            elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
                pairs.append((i - 1, None))
                i -= 1
            else:
                j -= 1

        pairs.reverse()
        return [(chunk_words[r], words_raw[h] if h is not None else None) for r, h in pairs]

    def parse_aligned_outputs(
        self,
        output_dir: str,
        ayah_clips: List[Tuple[str, int, int, int, float, List[Any]]],
    ) -> List[MfaAyahResult]:
        """Parses output TextGrid files and applies global audio time offsets and Tajweed rules."""
        results: List[MfaAyahResult] = []
        rules = self._get_rules()

        ayah_groups: Dict[Tuple[int, int], List[MfaWord]] = {}

        for base_name, surah, ayah, clip_num, global_offset, chunk_words in ayah_clips:
            tg_path = os.path.join(output_dir, f"{base_name}.TextGrid")
            words_raw: List[Tuple[float, float, str]] = []
            phones_raw: List[Tuple[float, float, str]] = []
            if os.path.exists(tg_path):
                tiers = parse_praat_textgrid(tg_path)
                words_raw = tiers.get("words", [])
                phones_raw = tiers.get("phones", [])

            ayah_rules = rules.get((surah, ayah), [])
            rules_by_word_idx: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
            for r in ayah_rules:
                w_pos = r.get("word")
                if w_pos is not None and r.get("rule"):
                    rules_by_word_idx[w_pos].append(r)

            # Robust alignment: pair each QuranWord in chunk_words to its TextGrid word interval (or None)
            matched_pairs = self._align_words_to_chunk(chunk_words, words_raw)
            mfa_words: List[MfaWord] = []

            for target_qword, w_interval in matched_pairs:
                ctc_s = getattr(target_qword, "start", 0.0)
                ctc_e = getattr(target_qword, "end", 0.0)
                if ctc_e <= ctc_s:
                    ctc_e = ctc_s + 0.10

                final_w_s = round(ctc_s, 3)
                final_w_e = round(ctc_e, 3)
                final_w_dur = round(final_w_e - final_w_s, 3)

                cur_phones: List[MfaPhone] = []
                if w_interval is not None:
                    w_s, w_e, _ = w_interval
                    # Collect phones whose midpoint lies inside the word's acoustic interval
                    for p_s, p_e, p_text in phones_raw:
                        p_mid = (p_s + p_e) / 2.0
                        if (w_s - 0.005) <= p_mid <= (w_e + 0.005):
                            p_glob_s = round(p_s + global_offset, 3)
                            p_glob_e = round(p_e + global_offset, 3)
                            cur_phones.append(
                                MfaPhone(
                                    phone=p_text,
                                    start=p_glob_s,
                                    end=p_glob_e,
                                    duration=round(p_glob_e - p_glob_s, 3),
                                )
                            )

                # Fetch Tajweed rules for this word if available
                loc = getattr(target_qword, "location", "")
                parts = loc.split(":")
                w_pos_0idx = int(parts[-1]) - 1 if len(parts) >= 3 and parts[-1].isdigit() else -1
                w_rules = rules_by_word_idx.get(w_pos_0idx, [])

                # If MFA produced valid constituent phones, use pure 10ms MFA acoustic boundaries
                if cur_phones:
                    mfa_w_s = cur_phones[0].start
                    mfa_w_e = cur_phones[-1].end
                    mfa_w_dur = round(mfa_w_e - mfa_w_s, 3)

                    # Attach Tajweed rule annotations directly to the 10ms physical phones
                    refined_phones: List[MfaPhone] = []
                    for p in cur_phones:
                        r_match = next(
                            (r for r in w_rules if r.get("base") == p.phone or r.get("symbol", "").startswith(p.phone)),
                            None,
                        )
                        if r_match:
                            p.rule = r_match.get("rule")
                            p.golden_len = r_match.get("golden_len")
                        refined_phones.append(p)

                    m_word = MfaWord(
                        word=target_qword.word,
                        start=mfa_w_s,
                        end=mfa_w_e,
                        duration=mfa_w_dur,
                        phones=refined_phones,
                    )
                    mfa_words.append(m_word)

                    # Update in-memory QuranWord with true 10ms MFA timestamps
                    target_qword.start = mfa_w_s
                    target_qword.end = mfa_w_e
                    target_qword.phonemes = [
                        {
                            "phoneme": p.phone,
                            "start": p.start,
                            "end": p.end,
                            **({"rule": p.rule} if p.rule else {}),
                            **({"golden_len": p.golden_len} if p.golden_len else {}),
                        }
                        for p in refined_phones
                    ]
                else:
                    # Graceful Fallback: keep CTC boundaries and CTC phonemes so NO words or phones are lost!
                    existing_phones = getattr(target_qword, "phonemes", []) or []
                    fallback_phones = [
                        MfaPhone(
                            phone=ep.get("phoneme", ""),
                            start=ep.get("start", final_w_s),
                            end=ep.get("end", final_w_e),
                            duration=round(ep.get("end", final_w_e) - ep.get("start", final_w_s), 3),
                        )
                        for ep in existing_phones
                    ]
                    m_word = MfaWord(
                        word=target_qword.word,
                        start=final_w_s,
                        end=final_w_e,
                        duration=final_w_dur,
                        phones=fallback_phones,
                    )
                    mfa_words.append(m_word)

            key = (surah, ayah)
            if key not in ayah_groups:
                ayah_groups[key] = []
            ayah_groups[key].extend(mfa_words)

        for (s, a), all_w in ayah_groups.items():
            if all_w:
                results.append(
                    MfaAyahResult(
                        surah=s,
                        ayah=a,
                        start_time=all_w[0].start,
                        end_time=all_w[-1].end,
                        words=all_w,
                    )
                )

        return results

    def align_pipeline_result(
        self,
        pipeline_result: Any,
        audio_pcm: np.ndarray,
        output_dir: str = ".",
        on_progress: Optional[Callable[[float, float], None]] = None,
    ) -> Optional[List[MfaAyahResult]]:
        """Main end-to-end interface to run MFA refinement on an existing PipelineResult."""
        start_t = time.time()
        if on_progress:
            on_progress(1.0, 0.0)

        if not self.is_mfa_installed():
            print("\n" + "=" * 70)
            print("[*] Montreal Forced Aligner ('mfa') requested via --mfa.")
            print("[*] Environment not detected. Initiating automated setup (~300MB CPU-only)...")
            print("=" * 70 + "\n", flush=True)
            success = self.ensure_mfa_installed(auto_install=True)
            if not success:
                print("\n[!] Automatic MFA setup could not be completed.")
                print("    Continuing pipeline with baseline transcription & alignment (Phases 1-4).\n", flush=True)
                return None

        segments = getattr(pipeline_result, "segments", [])
        if not segments:
            logger.warning("No matched Ayah segments available to align with MFA.")
            return None

        work_dir = os.path.join(output_dir, "mfa_workspace")
        corpus_dir = os.path.join(work_dir, "corpus")
        mfa_out_dir = os.path.join(work_dir, "aligned_textgrids")
        temp_dir = os.path.join(work_dir, "mfa_temp")

        # Ensure a clean workspace with no leftover files from previous recitations
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)
        os.makedirs(work_dir, exist_ok=True)
        os.makedirs(temp_dir, exist_ok=True)

        logger.info("Preparing Ayah audio clips for MFA alignment...")
        clips = self.prepare_corpus(segments, audio_pcm, corpus_dir)
        if not clips:
            logger.warning("No valid Ayah clips could be prepared for MFA.")
            return None

        if on_progress:
            on_progress(5.0, time.time() - start_t)

        audio_dur = getattr(pipeline_result, "audio_duration_seconds", None)
        if not audio_dur and audio_pcm is not None:
            audio_dur = len(audio_pcm) / getattr(config, "SAMPLE_RATE", 16000)
        audio_dur = audio_dur or 300.0
        est_mfa_time = max(5.0, audio_dur / 13.0)

        logger.info(f"Running MFA on {len(clips)} Ayah clips (10ms resolution)...")
        success = self.run_alignment(
            corpus_dir,
            mfa_out_dir,
            temp_dir=temp_dir,
            on_progress=on_progress,
            start_time=start_t,
            est_duration=est_mfa_time,
        )
        if not success:
            if getattr(config, "CLEANUP_MFA_WORKSPACE", True):
                shutil.rmtree(work_dir, ignore_errors=True)
            return None

        if on_progress:
            on_progress(94.0, time.time() - start_t)

        logger.info("Parsing MFA Praat TextGrids & Tajweed rules...")
        mfa_results = self.parse_aligned_outputs(mfa_out_dir, clips)

        if on_progress:
            on_progress(97.0, time.time() - start_t)

        # Discard temporary intermediate WAV/TextGrid files once parsed into memory
        if getattr(config, "CLEANUP_MFA_WORKSPACE", True):
            shutil.rmtree(work_dir, ignore_errors=True)

        # Export canonical MFA JSON artifacts
        mfa_export = {
            "total_ayahs": len(mfa_results),
            "ayahs": [r.to_dict() for r in mfa_results],
        }

        mfa_json_path = os.path.join(output_dir, "mfa_output.json")
        with open(mfa_json_path, "w", encoding="utf-8") as f:
            json.dump(mfa_export, f, ensure_ascii=False, indent=2)

        # Also export flat phone-level timeline
        flat_phones = []
        p_idx = 1
        for a in mfa_results:
            for w in a.words:
                for p in w.phones:
                    flat_phones.append({
                        "index": p_idx,
                        "surah": a.surah,
                        "ayah": a.ayah,
                        "word": w.word,
                        **p.to_dict(),
                    })
                    p_idx += 1

        flat_json_path = os.path.join(output_dir, "mfa_aligned_phones.json")
        with open(flat_json_path, "w", encoding="utf-8") as f:
            json.dump({"total_phones": len(flat_phones), "phones": flat_phones}, f, ensure_ascii=False, indent=2)

        # Synchronize segment and subsegment boundaries with refined words
        for seg in getattr(pipeline_result, "segments", []) or []:
            if seg.words:
                seg.start_time = seg.words[0].start
                seg.end_time = seg.words[-1].end
            for sub in getattr(seg, "sub_segments", []) or []:
                if sub.words:
                    sub.start_time = sub.words[0].start
                    sub.end_time = sub.words[-1].end

        # Re-export output.json with updated MFA letter-level timings
        if hasattr(pipeline_result, "export_json"):
            pipeline_result.export_json(output_dir=output_dir)

        logger.info(
            f"MFA Alignment complete! Artifacts saved: {mfa_json_path}, {flat_json_path}, and synced with output.json"
        )

        if on_progress:
            on_progress(100.0, time.time() - start_t)

        return mfa_results
