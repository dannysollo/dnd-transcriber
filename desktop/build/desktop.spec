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
# desktop launcher plan. Expect to need hidden-import/binary-collection
# iteration once actually run through PyInstaller (this is the single most
# likely source of "the frozen exe doesn't behave like the source run" bugs,
# per the plan's own risk callout).

import sys
from pathlib import Path

block_cipher = None

REPO_ROOT = Path(SPECPATH).resolve().parent.parent
DESKTOP_DIR = REPO_ROOT / "desktop"

a = Analysis(
    [str(DESKTOP_DIR / "app.py")],
    pathex=[str(DESKTOP_DIR)],
    binaries=[],
    datas=[
        (str(DESKTOP_DIR / "onboarding_ui.html"), "."),
        (str(DESKTOP_DIR / "assets"), "assets"),
        # Worker source is bundled as data (not frozen code) — it's run by a
        # separate venv's python.exe, not by this frozen interpreter. See
        # paths.worker_src_dir() and the "don't freeze CUDA torch" decision.
        (str(REPO_ROOT / "worker"), "worker"),
    ],
    hiddenimports=[
        # pywebview picks its backend at runtime based on the `gui=` kwarg
        # passed to webview.start() (we pass "edgechromium" explicitly) —
        # PyInstaller's static analysis can miss that dynamic import.
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
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
    console=False,  # windowless — the worker's own console output goes to
                     # worker.log (see paths.worker_log_path()) and to the
                     # gui_server.py dashboard, not a visible terminal.
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
