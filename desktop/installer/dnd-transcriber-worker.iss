; desktop/installer/dnd-transcriber-worker.iss — Inno Setup script.
;
; NOT YET VALIDATED — this is Milestone 5 in the desktop launcher plan, and
; depends on Milestone 4's PyInstaller output existing first. Two source
; files this script expects are NOT included in this repo (nobody on this
; side has a Windows machine to produce them):
;   - desktop\build\dist\dnd-transcriber-worker\  (PyInstaller onedir output —
;     build it first: see desktop/build/desktop.spec)
;   - desktop\resources\ffmpeg\ffmpeg.exe  (a static LGPL Windows ffmpeg build,
;     optional — if absent the app falls back to a system-PATH ffmpeg, same
;     as worker/setup.bat's current behavior; see paths.bundled_ffmpeg())
;
; Build with: iscc desktop\installer\dnd-transcriber-worker.iss

#define MyAppName "DnD Transcriber Worker"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "dannysollo"
#define MyAppExeName "dnd-transcriber-worker.exe"

[Setup]
AppId={{6E2F9C2E-6E5C-4A6B-9C2C-DND-TRANSCRIBER}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Multi-GB payload (bundled PyInstaller shell is small; the actual size cost
; is the worker's venv, which onboarding installs to %LOCALAPPDATA% at first
; run, not here — see the "don't freeze CUDA torch" decision).
OutputBaseFilename=dnd-transcriber-worker-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Standard users can install to Program Files via the elevation prompt Inno
; already shows; the app itself never needs to write there post-install —
; worker.yaml/venv live in %LOCALAPPDATA% (see desktop/paths.py).
PrivilegesRequired=admin

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
Source: "..\resources\ffmpeg\ffmpeg.exe"; DestDir: "{app}\resources\ffmpeg"; Flags: ignoreversion skipifsourcedoesntexist

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
