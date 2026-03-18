@echo off
REM setup.bat — DnD Transcriber Worker setup (Windows)
setlocal enabledelayedexpansion

echo.
echo  DnD Transcriber -- Worker Setup
echo ==========================================
echo.

cd /d "%~dp0"

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from https://python.org
    echo Make sure to check "Add to PATH" during installation.
    pause & exit /b 1
)
echo [OK] Python found

REM Check ffmpeg
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: ffmpeg not found. Install it:
    echo   1. Download from https://ffmpeg.org/download.html
    echo   2. Extract and add the bin/ folder to your PATH
    echo   Or use: winget install ffmpeg
    pause & exit /b 1
)
echo [OK] ffmpeg found

REM Create venv
if not exist venv (
    echo.
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat
echo [OK] Virtual environment ready

REM Install deps
echo.
echo Installing dependencies (torch + whisper are large, this takes a few minutes)...
python -m pip install --upgrade pip --quiet

REM CUDA check via nvidia-smi
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo   No NVIDIA GPU detected -- installing CPU torch (transcription will be slow^)...
    pip install torch torchaudio --quiet
) else (
    echo   NVIDIA GPU detected -- installing CUDA-enabled torch...
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 --quiet
)

pip install -r requirements.txt --quiet
echo [OK] Dependencies installed

REM Config setup
if exist worker.yaml (
    echo.
    echo worker.yaml already exists -- skipping config setup.
    goto done
)

echo.
echo ==========================================
echo Let's set up your worker.yaml
echo You'll need: the site URL, your campaign slug,
echo and the API key from Campaign Settings.
echo ==========================================
echo.

set /p SERVER_URL="Server URL (e.g. https://my-campaign.fly.dev): "
set /p CAMPAIGN_SLUG="Campaign slug (e.g. as-above-so-below): "
set /p API_KEY="Worker API key (from Campaign Settings > Worker tab): "
set /p AUDIO_DIR="Audio folder path (where Craig drops your .flac files): "

(
echo server_url: !SERVER_URL!
echo campaign_slug: !CAMPAIGN_SLUG!
echo api_key: !API_KEY!
echo audio_dir: !AUDIO_DIR!
echo poll_interval: 30
echo # whisper_model: turbo  # Uncomment to override the campaign's model setting
) > worker.yaml

echo [OK] worker.yaml created

:done
echo.
echo ==========================================
echo Setup complete! To run the worker:
echo.
echo   venv\Scripts\activate
echo   python main.py
echo.
echo Audio layout: drop Craig files into a subfolder named after the session.
echo   Example: %%audio_dir%%\2026-03-15\*.flac
echo ==========================================
pause
