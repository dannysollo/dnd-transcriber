; desktop/installer/dnd-transcriber-worker.iss — Inno Setup script.
;
; Confirmed working end-to-end through a real build + install (v0.1.0).
; ffmpeg and a bundled Python 3.10 are now included too (desktop\resources\
; ffmpeg\ and desktop\resources\python\ — fetched via GitHub's API from
; BtbN/FFmpeg-Builds and astral-sh/python-build-standalone respectively,
; not committed to this repo — see .gitignore), closing the two remaining
; "friend needs X preinstalled" gaps from v0.1.0's release notes. Both
; entries below use skipifsourcedoesntexist regardless, so a build missing
; either resource still works, just falls back to requiring it on PATH.
;
; desktop\resources\MicrosoftEdgeWebview2Setup.exe (still not bundled) is
; the one remaining optional [Run] entry below — not needed on the real
; target machine (Windows 11 already had WebView2, zero prompts during
; actual testing), only matters for a stripped/LTSC Windows image that
; might lack it. Cheap, purely defensive inclusion for wider sharing later.
;
; This requires the Inno Setup Compiler (iscc) installed on Windows —
; https://jrsoftware.org/isdl.php — not part of the Python venv/PyInstaller
; toolchain already set up.
;
; Build with: iscc desktop\installer\dnd-transcriber-worker.iss

#define MyAppName "DnD Transcriber Worker"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "dannysollo"
#define MyAppExeName "dnd-transcriber-worker.exe"

[Setup]
; Was previously "6E2F9C2E-6E5C-4A6B-9C2C-DND-TRANSCRIBER" — not a valid GUID
; (the last group has non-hex characters), which would have hard-failed the
; Inno Setup compile the first time anyone actually ran iscc on this. Never
; caught until now since nothing on this side can run iscc to find out.
AppId={{D836C81D-B261-477B-85F2-A9158B8424E7}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install (%LOCALAPPDATA%\Programs\...), not Program Files — no
; admin/UAC prompt required. Deliberate given the "seamless to send to
; friends" goal: nothing here actually needs elevated install rights
; (worker.yaml/venv already live in %LOCALAPPDATA% regardless — see
; desktop/paths.py), so requiring admin would just be friction for a
; friend on a machine where they aren't one, for no real benefit. Same
; pattern most consumer Windows apps (VS Code, Discord, etc.) use.
DefaultDirName={localappdata}\Programs\{#MyAppName}
PrivilegesRequired=lowest
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Multi-GB payload (bundled PyInstaller shell is small; the actual size cost
; is the worker's venv, which onboarding installs to %LOCALAPPDATA% at first
; run, not here — see the "don't freeze CUDA torch" decision).
OutputBaseFilename=dnd-transcriber-worker-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; PyInstaller onedir output — see desktop/build/desktop.spec. This already
; includes the bundled worker/ source tree (added there as `datas`), so it
; is NOT copied separately here.
Source: "..\build\dist\dnd-transcriber-worker\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Optional bundled ffmpeg — skipped entirely if not present at build time.
; A static LGPL Windows build (BtbN/FFmpeg-Builds) — paths.bundled_ffmpeg()
; and worker_process.py's FFMPEG_BIN wiring already expect exactly this
; path, added when that plumbing was first built.
Source: "..\resources\ffmpeg\ffmpeg.exe"; DestDir: "{app}\resources\ffmpeg"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\resources\ffmpeg\LICENSE.txt"; DestDir: "{app}\resources\ffmpeg"; Flags: ignoreversion skipifsourcedoesntexist

; Optional bundled Python 3.10 (a python-build-standalone CPython
; distribution, not the stripped python.org "embeddable" package, which
; doesn't support venv properly) — skipped entirely if not present at build
; time, same as ffmpeg above. paths.bundled_python() looks for exactly this
; path; onboarding.find_system_python() prefers it over anything on the
; target machine's own PATH, so a friend with no Python installed at all
; still gets a working first run.
Source: "..\resources\python\*"; DestDir: "{app}\resources\python"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist

; Optional WebView2 Evergreen Bootstrapper — only needed if Milestone 1
; (bare pywebview shell smoke test) shows a target machine is missing it.
; Download: https://developer.microsoft.com/microsoft-edge/webview2/
Source: "..\resources\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: skipifsourcedoesntexist deleteafterinstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Only actually runs if the bootstrapper file was present at build time
; (see [Files] above) — /silent /install matches Microsoft's documented
; Evergreen Bootstrapper CLI flags.
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing WebView2 Runtime..."; Flags: skipifdoesntexist waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
