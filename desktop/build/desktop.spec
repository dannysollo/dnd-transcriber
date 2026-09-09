# desktop/build/desktop.spec — PyInstaller spec for the desktop launcher shell.
#
# Builds `onedir` (not `onefile`) — see the desktop launcher plan for why:
# faster startup (no self-extract-to-temp on every launch) and the app needs
# stable on-disk paths relative to its own install location (bundled
# ffmpeg.exe, worker source tree, per-user venv) which onefile's per-run temp
# dir makes fragile. Inno Setup wraps this onedir output into a single
# installer anyway.
#
# Build from the repo root with:
#   pyinstaller desktop/build/desktop.spec --distpath desktop/build/dist --workpath desktop/build/work
#
# NOT YET VALIDATED on a real Windows build — this is Milestone 4 in the
# desktop launcher plan. An earlier version of this spec manually bundled
# pywebview's WebView2 interop DLLs and pythonnet's CLR bootstrap files,
# reasoning (correctly, per pywebview's own source) that PyInstaller's
# static analysis can't trace runtime-constructed DLL paths on its own.
# Turned out unnecessary AND actively broken: a real build showed pywebview
# 6.2.1 and pythonnet both ship their own first-party PyInstaller hooks
# (webview/__pyinstaller/hook-webview.py, pythonnet/_pyinstaller/hook-clr.py)
# that already handle this correctly and get auto-discovered — and the
# manual version crashed COLLECT() besides, because it appended raw 2-tuples
# onto a.binaries/a.datas *after* Analysis() had already normalized them to
# 3-tuples internally. Removed in favor of just trusting the real hooks,
# which the successful build up through EXE construction confirmed work.

import sys
from pathlib import Path

block_cipher = None

REPO_ROOT = Path(SPECPATH).resolve().parent.parent
DESKTOP_DIR = REPO_ROOT / "desktop"

# Worker source is bundled as data (not frozen code) — it's run by a
# separate venv's python.exe, not by this frozen interpreter. See
# paths.worker_src_dir() and the "don't freeze CUDA torch" decision.
#
# Deliberately NOT `(str(REPO_ROOT / "worker"), "worker")` (the whole
# directory) — worker/ also contains worker/venv/ (Danny's real, multi-GB,
# machine-specific CUDA venv) and worker/worker.yaml (his real API key and
# other secrets, in plaintext). Bundling those into a shareable exe would be
# both a multi-GB bloat and a real credential leak. Only top-level source
# files are picked up; venv/, worker.yaml, worker.log, __pycache__/, and
# .claude/ are all subdirectories or specific files a flat glob never
# touches, so nothing needs to explicitly exclude them.
_worker_datas = []
for pattern in ("*.py", "*.txt", "*.bat", "*.sh", "*.example"):
    for f in (REPO_ROOT / "worker").glob(pattern):
        _worker_datas.append((str(f), "worker"))

a = Analysis(
    [str(DESKTOP_DIR / "app.py")],
    pathex=[str(DESKTOP_DIR)],
    binaries=[],
    datas=[
        (str(DESKTOP_DIR / "onboarding_ui.html"), "."),
        # assets/ only currently holds a .gitkeep placeholder (no real
        # icon.ico yet) — PyInstaller errors on a missing/nonexistent
        # source path, so guard rather than assume it's there.
        *([(str(DESKTOP_DIR / "assets"), "assets")] if (DESKTOP_DIR / "assets").exists() else []),
        *_worker_datas,
    ],
    hiddenimports=[
        # pywebview picks its backend at runtime based on the `gui=` kwarg
        # passed to webview.start() (we pass "edgechromium" explicitly) —
        # PyInstaller's static analysis can miss that dynamic import.
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        # pywebview's edgechromium backend needs this for `import clr` to
        # work at all — not a declared pywebview dependency (it's installed
        # conditionally on Windows only, invisible to static analysis here).
        "clr",
        # pystray likewise resolves its backend implementation dynamically.
        "pystray._win32",
        "PIL._tkinter_finder",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Explicitly exclude the worker's own heavy deps in case anything
        # under worker/ gets picked up by static analysis just from being
        # bundled as a data dir — they must NOT be frozen in (see plan).
        "torch", "torchaudio", "faster_whisper", "ctranslate2", "nemo",
        "nemo_toolkit", "silero_vad", "pyannote",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="dnd-transcriber-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # TEMPORARY: True (shows a console with stdout/stderr) for this first
    # build specifically, since a windowless exe that fails on startup would
    # otherwise just silently vanish with no way to see why — this is a real
    # possibility given how much of this (WebView2 DLL placement, pythonnet
    # freezing) is unverified until it's actually run. Flip to False once a
    # build is confirmed working end-to-end.
    console=True,
    icon=str(DESKTOP_DIR / "assets" / "icon.ico") if (DESKTOP_DIR / "assets" / "icon.ico").exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="dnd-transcriber-worker",
)
