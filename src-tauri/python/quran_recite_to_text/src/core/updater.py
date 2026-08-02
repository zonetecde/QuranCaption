"""Auto-updater using GitHub Releases API."""

import os
import sys
import json
import urllib.request
import urllib.error
import zipfile
import shutil
import tempfile
import threading
import socket
from pathlib import Path


def check_and_update(app_path: Path, log_callback=print):
    """Checks local version against GitHub Release tag and auto-updates if newer release exists."""
    try:
        from config import ENABLE_AUTO_UPDATE
        if not ENABLE_AUTO_UPDATE:
            return
    except Exception:
        pass

    try:
        version_file = app_path / "version.json"
        local_version = "v0.0.0"

        if version_file.exists():
            try:
                with open(version_file, "r", encoding="utf-8") as f:
                    local_version = json.load(f).get("version", "v0.0.0")
            except Exception:
                pass

        api_url = "https://api.github.com/repos/Iam-Muslim/QuranReciteToText/releases/latest"
        req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})

        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                release_data = json.loads(response.read().decode('utf-8'))
                latest_version = release_data.get("tag_name", local_version)
                zipball_url = release_data.get("zipball_url")

                if latest_version != local_version and zipball_url:
                    log_callback(f"[*] Found new version {latest_version} (Current: {local_version}). Updating...")

                    with tempfile.TemporaryDirectory() as tmpdir:
                        tmp_dir_path = Path(tmpdir)
                        zip_path = tmp_dir_path / "update.zip"

                        req_zip = urllib.request.Request(zipball_url, headers={'User-Agent': 'Mozilla/5.0'})
                        with urllib.request.urlopen(req_zip, timeout=60) as r_zip, open(zip_path, 'wb') as f:
                            shutil.copyfileobj(r_zip, f)

                        extract_path = tmp_dir_path / "extracted"
                        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                            zip_ref.extractall(extract_path)

                        extracted_folders = [f for f in extract_path.iterdir() if f.is_dir()]
                        if extracted_folders:
                            repo_folder = extracted_folders[0]
                            shutil.copytree(repo_folder, app_path, dirs_exist_ok=True)

                            with open(version_file, "w", encoding="utf-8") as f:
                                json.dump({"version": latest_version}, f)

                            req_path = app_path / "requirements.txt"
                            if req_path.exists():
                                import subprocess
                                try:
                                    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_path)])
                                except Exception as e:
                                    log_callback(f"[*] Dependency sync warning: {e}")

                            log_callback("[*] Update complete! Restarting...")
                            os.execv(sys.executable, [sys.executable] + sys.argv)
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError):
        # Network timeout or offline, skip silently without delay
        pass
    except Exception as e:
        log_callback(f"[*] Auto-update check bypassed: {e}")


def start_background_update(app_path: Path, log_callback=print) -> threading.Thread | None:
    """Launches check_and_update in a background non-blocking daemon thread."""
    try:
        from config import ENABLE_AUTO_UPDATE
        if not ENABLE_AUTO_UPDATE:
            return None
    except Exception:
        pass

    thread = threading.Thread(
        target=check_and_update,
        args=(app_path, log_callback),
        daemon=True,
        name="AutoUpdaterThread"
    )
    thread.start()
    return thread

