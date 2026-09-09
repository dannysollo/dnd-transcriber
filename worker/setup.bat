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
    REM PyTorch's CUDA wheel index gets a new cuNNN name periodically as CUDA
    REM majors advance, and old ones don't get new Python-version wheels
    REM added retroactively -- a hardcoded index here (this used to say
    REM cu121 unconditionally) can go stale silently: the pip install below
    REM just fails to find a match, and with no errorlevel check afterward,
    REM execution fell straight through to `pip install -r requirements.txt`,
    REM whose unpinned `torch` line then quietly installed a CPU-only build
    REM from plain PyPI with no visible error at all. Ask pick_torch_index.py
    REM to find a real match instead of trusting a number written down once.
    echo   NVIDIA GPU detected -- looking up the right CUDA wheel index...
    set CUDA_INDEX=
    for /f "delims=" %%i in ('python pick_torch_index.py 2^>nul') do set CUDA_INDEX=%%i
    if "!CUDA_INDEX!"=="" (
        echo   WARNING: Could not find a matching CUDA wheel index for this Python version.
        echo   Installing CPU-only torch instead -- transcription will be much slower.
        echo   ^(run "python pick_torch_index.py" for the specific error^)
        pip install torch torchaudio --quiet
    ) else (
        echo   Using CUDA wheel index: !CUDA_INDEX!
        pip install torch torchaudio --index-url !CUDA_INDEX! --quiet
        if errorlevel 1 (
            echo   ERROR: CUDA torch install failed even with a matching index found.
            echo   Falling back to CPU-only torch -- transcription will be much slower.
            pip install torch torchaudio --quiet
        )
    )
)

pip install -r requirements.txt --quiet
echo [OK] Dependencies installed

REM Confirm what actually got installed -- this is the check that would
REM have caught the silent-CPU-fallback bug immediately instead of it only
REM surfacing later, mid-transcription, as "why is this so slow".
python -c "import torch; print('  Torch ' + torch.__version__ + ' -- CUDA available: ' + str(torch.cuda.is_available()))" 2>nul

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
