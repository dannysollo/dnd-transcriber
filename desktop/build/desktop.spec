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
# desktop launcher plan. One real, source-confirmed risk handled below
# (not just a generic warning): pywebview's Windows/WebView2 backend
# (webview/platforms/edgechromium.py) bridges to .NET via pythonnet
# (`import clr`), and loads several bundled DLLs
# (Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll,
# WebBrowserInterop.x64/x86.dll) from a path built at runtime
# (webview.util.interop_dll_path) — a plain string join PyInstaller's static
# import analysis has no way to see, so it will NOT bundle them on its own.
# Worse, for the frozen case that function only checks two locations: next
# to sys.argv[0], or sys._MEIPASS — both FLAT, not the nested `webview/lib/`
# layout the DLLs ship in inside the actual package. So these are added
# explicitly below, copied to the distribution ROOT (not preserving their
# source layout) to match what interop_dll_path() actually looks for once
# frozen. Confirmed present in an installed pywebview 6.2.1 by inspecting
# the package directly; if a different pywebview version changes this
# layout, `python -c "import webview,os; print(os.path.dirname(webview.__file__))"`
# then look under that path's `lib/` folder to re-locate them.

import sys
from pathlib import Path

block_cipher = None

REPO_ROOT = Path(SPECPATH).resolve().parent.parent
DESKTOP_DIR = REPO_ROOT / "desktop"

# Resolve pywebview's bundled WebView2 interop DLLs from whatever venv is
# actually running PyInstaller (NOT hardcoded — this must reflect Danny's
# real venv, which this Linux dev environment has no access to).
try:
    import webview
    _webview_lib_dir = Path(webview.__file__).resolve().parent / "lib"
except ImportError:
    _webview_lib_dir = None
    print("WARNING: could not import webview to locate its bundled WebView2 "
          "interop DLLs — run PyInstaller from the venv these were installed "
          "into (worker\\venv\\Scripts\\pyinstaller.exe, not a system-wide one).")

_webview2_binaries = []
if _webview_lib_dir and _webview_lib_dir.exists():
    for dll_name in (
        "Microsoft.Web.WebView2.Core.dll",
        "Microsoft.Web.WebView2.WinForms.dll",
        "WebBrowserInterop.x64.dll",
        "WebBrowserInterop.x86.dll",
    ):
        dll_path = _webview_lib_dir / dll_name
        if dll_path.exists():
            # ("." = distribution root, matching interop_dll_path()'s frozen
            # lookup of "next to the exe", not the package's nested layout)
            _webview2_binaries.append((str(dll_path), "."))
    # WebView2Loader.dll: standard Microsoft WebView2 SDK deployment
    # convention is for the native loader to sit next to the main exe too.
    loader = _webview_lib_dir / "runtimes" / "win-x64" / "native" / "WebView2Loader.dll"
    if loader.exists():
        _webview2_binaries.append((str(loader), "."))

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
    binaries=_webview2_binaries,
    datas=[
        (str(DESKTOP_DIR / "onboarding_ui.html"), "."),
        (str(DESKTOP_DIR / "assets"), "assets"),
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

# collect_all('pythonnet') pulls in pythonnet's own native CLR bootstrap
# files, which — like the WebView2 DLLs above — are loaded by runtime path
# construction rather than anything PyInstaller's static analysis can trace.
# pythonnet freezing is a known-tricky case; this maximizes the odds of a
# clean first build rather than iterating hidden-imports one crash at a time.
try:
    from PyInstaller.utils.hooks import collect_all
    pn_datas, pn_binaries, pn_hidden = collect_all("pythonnet")
    a.datas += pn_datas
    a.binaries += pn_binaries
    a.hiddenimports += pn_hidden
except Exception as e:
    print(f"WARNING: collect_all('pythonnet') failed ({e}) — pythonnet must "
          f"be installed in the venv running PyInstaller.")

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
