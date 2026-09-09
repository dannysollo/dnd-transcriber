"""
desktop/paths.py — Path resolution for the desktop launcher.

Has to work in two very different situations, and every other module in this
package should go through here rather than compute paths itself:
  1. Running from source (`python desktop/app.py`) during development.
  2. Running frozen (PyInstaller onedir build, `dnd-transcriber-worker.exe`).

The worker's own venv + worker.yaml live in a per-user, non-admin-writable
location (%LOCALAPPDATA%) — never inside the install directory — because the
installer places the frozen app under Program Files, which standard Windows
user accounts can't write to after install time. See the plan's "shareable
with other players" requirement: onboarding runs as the logged-in user, not
as an installer with elevated rights.
"""
import os
import sys
from pathlib import Path

APP_NAME = "DnDTranscriberWorker"


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def app_dir() -> Path:
    """Directory the running app itself lives in (bundled resources: icon,
    onboarding_ui.html, bundled ffmpeg.exe, bundled worker source)."""
    if is_frozen():
        # PyInstaller onedir: sys.executable sits next to bundled data files.
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def worker_src_dir() -> Path:
    """Where worker/*.py lives — bundled read-only source the installer laid
    down (frozen) or the repo's own worker/ directory (source/dev)."""
    if is_frozen():
        return app_dir() / "worker"
    return app_dir().parent / "worker"


def data_dir() -> Path:
    """Per-user writable install data: the worker's venv + worker.yaml.
    %LOCALAPPDATA%\\DnDTranscriberWorker on Windows; falls back to a dotdir
    under the home directory on other platforms (dev/testing only — this app
    ships for Windows)."""
    base = os.environ.get("LOCALAPPDATA")
    if base:
        d = Path(base) / APP_NAME
    else:
        d = Path.home() / f".{APP_NAME.lower()}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def venv_dir() -> Path:
    return data_dir() / "venv"


def venv_python() -> Path:
    """Path to the worker venv's python executable, once created by onboarding."""
    if os.name == "nt":
        return venv_dir() / "Scripts" / "python.exe"
    return venv_dir() / "bin" / "python"


def venv_pip() -> Path:
    if os.name == "nt":
        return venv_dir() / "Scripts" / "pip.exe"
    return venv_dir() / "bin" / "pip"


def worker_yaml_path() -> Path:
    return data_dir() / "worker.yaml"


def worker_log_path() -> Path:
    """Where the worker subprocess's stdout/stderr gets redirected. The app
    is windowless (no console), so this is the only place to look if
    gui_server.py's own dashboard (:8788) itself failed to start."""
    return data_dir() / "worker.log"


def bundled_ffmpeg() -> Path | None:
    """Path to a bundled ffmpeg.exe, if the installer shipped one. Returns
    None if not present (dev/source runs, or a build without it bundled) —
    callers should fall back to FFMPEG_BIN unset, i.e. today's PATH lookup."""
    candidate = app_dir() / "resources" / "ffmpeg" / (
        "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    )
    return candidate if candidate.exists() else None


def onboarding_html_path() -> Path:
    return app_dir() / "onboarding_ui.html" if is_frozen() else Path(__file__).resolve().parent / "onboarding_ui.html"


def icon_path() -> Path | None:
    candidate = app_dir() / "assets" / "icon.ico" if is_frozen() else Path(__file__).resolve().parent / "assets" / "icon.ico"
    return candidate if candidate.exists() else None
