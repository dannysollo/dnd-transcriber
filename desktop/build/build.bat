@echo off
rem Build the Windows installer. Run from a copy of the repo on a Windows drive
rem (PyInstaller and Inno Setup are Windows-only):
rem   desktop\build\build.bat
rem Needs Python 3.13 (py launcher) and Inno Setup 7. Output:
rem   desktop\installer\Output\dnd-transcriber-worker-setup.exe
cd /d %~dp0\..\..
py -3.13 -m venv .buildvenv || exit /b 1
.buildvenv\Scripts\python -m pip install -q --upgrade pip || exit /b 1
.buildvenv\Scripts\python -m pip install -q -r desktop\requirements-desktop.txt || exit /b 1
.buildvenv\Scripts\python -m PyInstaller --noconfirm desktop\build\desktop.spec --distpath desktop\build\dist --workpath desktop\build\work || exit /b 1
"C:\Program Files\Inno Setup 7\ISCC.exe" /Q desktop\installer\dnd-transcriber-worker.iss || exit /b 1
echo BUILD OK
