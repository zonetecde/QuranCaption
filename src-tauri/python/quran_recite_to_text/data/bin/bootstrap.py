"""Runtime bootstrap coordinator for QuranReciteToText.

Handles Windows console streams, auto-installs missing dependencies on first run,
and preloads bundled MSVC runtime DLLs.
"""

from __future__ import annotations

import os
import sys

# Silence pip and Python launcher background update checks
os.environ["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
os.environ["PYLAUNCH_NO_UPDATE_CHECK"] = "1"

import ctypes
import shutil
import subprocess
import importlib.util
from pathlib import Path

_BIN_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BIN_DIR.parent if (_BIN_DIR.parent / "config.py").is_file() else _BIN_DIR.parent.parent


def fix_windows_console() -> None:
    """Ensures UTF-8 console output is visible on Windows."""
    if sys.platform != "win32":
        return

    if sys.stdout is None or sys.stderr is None or "pythonw" in sys.executable.lower():
        try:
            if ctypes.windll.kernel32.AttachConsole(-1) != 0:
                sys.stdout = sys.stdout or open("CONOUT$", "w", encoding="utf-8")
                sys.stderr = sys.stderr or open("CONOUT$", "w", encoding="utf-8")
        except Exception:
            pass

    for stream in (sys.stdout, sys.stderr):
        if stream is not None:
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass


def _is_package_installed(pkg_name: str) -> bool:
    """Checks if a distribution package or module is installed in the current environment."""
    try:
        import importlib.metadata
        importlib.metadata.version(pkg_name)
        return True
    except Exception:
        return importlib.util.find_spec(pkg_name.replace("-", "_")) is not None


def ensure_pip_dependencies() -> None:
    """Installs missing CPU pipeline requirements via pip on first run."""
    base_required = ("numpy", "onnxruntime", "numba", "miniaudio", "scipy")
    missing_base = [pkg for pkg in base_required if not _is_package_installed(pkg)]

    pip_cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location"]

    if missing_base:
        print("=" * 60, file=sys.stderr)
        print(f"[*] Missing base dependencies: {', '.join(missing_base)}", file=sys.stderr)
        print("[*] Installing base requirements via pip. Please wait...", file=sys.stderr)
        print("=" * 60, file=sys.stderr, flush=True)
        try:
            subprocess.check_call([*pip_cmd, *missing_base])
            print("[*] Base dependencies installed successfully!\n", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[!] Failed to install base dependencies: {exc}", file=sys.stderr)
            print("[!] Please run manually: pip install -r requirements.txt", file=sys.stderr)
            sys.exit(1)


def load_msvc_runtime() -> None:
    """Preloads bundled Visual C++ runtime DLLs for onnxruntime."""
    if sys.platform != "win32" or not _BIN_DIR.is_dir():
        return

    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(_BIN_DIR))
        except Exception:
            pass

    dll_names = (
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "msvcp140.dll",
        "msvcp140_1.dll",
        "msvcp140_2.dll",
        "msvcp140_codecvt_ids.dll",
        "vcomp140.dll",
    )

    for name in dll_names:
        dll_file = _BIN_DIR / name
        if dll_file.is_file():
            try:
                ctypes.CDLL(str(dll_file))
            except Exception:
                pass

    # Copy DLLs into onnxruntime/capi if present so onnxruntime always finds them
    try:
        ort_spec = importlib.util.find_spec("onnxruntime")
        if ort_spec and ort_spec.submodule_search_locations:
            capi_dir = Path(list(ort_spec.submodule_search_locations)[0]) / "capi"
            if capi_dir.is_dir():
                for name in dll_names:
                    src = _BIN_DIR / name
                    dst = capi_dir / name
                    if src.is_file() and not dst.is_file():
                        try:
                            shutil.copy2(str(src), str(dst))
                        except Exception:
                            pass
    except Exception:
        pass


def bootstrap() -> None:
    """Executes environment bootstrap."""
    fix_windows_console()
    ensure_pip_dependencies()
    load_msvc_runtime()


# Execute automatically on import
bootstrap()
