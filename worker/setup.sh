#!/usr/bin/env bash
# setup.sh — DnD Transcriber Worker setup (Linux/macOS)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║   DnD Transcriber — Worker Setup         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found. Install Python 3.10+ and try again."
  exit 1
fi
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✓ Python $PY_VER found"

# Check ffmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo ""
  echo "ERROR: ffmpeg not found. Install it first:"
  echo "  Linux:  sudo apt install ffmpeg"
  echo "  macOS:  brew install ffmpeg"
  exit 1
fi
echo "✓ ffmpeg found"

# Create venv
if [ ! -d "venv" ]; then
  echo ""
  echo "Creating virtual environment..."
  python3 -m venv venv
fi
source venv/bin/activate
echo "✓ Virtual environment ready"

# Install deps
echo ""
echo "Installing dependencies (this may take a while — torch + whisper are large)..."
pip install --upgrade pip --quiet

# CUDA check — prefer CUDA torch if nvidia-smi is available
if command -v nvidia-smi &>/dev/null; then
  # PyTorch's CUDA wheel index gets a new cuNNN name periodically as CUDA
  # majors advance, and old ones don't get new Python-version wheels added
  # retroactively — a hardcoded index here (this used to say cu121
  # unconditionally) can go stale for a newer Python version, and with
  # `set -e` above, that fails the whole script rather than falling back.
  # Ask pick_torch_index.py to find a real match instead of trusting a
  # number written down once.
  echo "  NVIDIA GPU detected — looking up the right CUDA wheel index..."
  CUDA_INDEX=$(python pick_torch_index.py 2>/dev/null || true)
  if [ -z "$CUDA_INDEX" ]; then
    echo "  WARNING: Could not find a matching CUDA wheel index for this Python version."
    echo "  Installing CPU-only torch instead — transcription will be much slower."
    echo "  (run 'python pick_torch_index.py' for the specific error)"
    pip install torch torchaudio --quiet
  else
    echo "  Using CUDA wheel index: $CUDA_INDEX"
    # --no-deps: confirmed via a real failure that installing torch's full
    # dependency tree FROM this index breaks. It mirrors common transitive
    # deps (typing_extensions, jinja2, etc.) to be self-contained, but its
    # metadata has package-name casing that newer pip versions reject as a
    # hard mismatch for some of them — the wheel gets discarded, pip falls
    # back to building from source, which needs flit_core as a build
    # dependency, and flit_core isn't on this index at all (a build tool,
    # not anything torch depends on at runtime). "No matching distribution
    # for flit_core" was the actual resulting error.
    pip install torch torchaudio --index-url "$CUDA_INDEX" --no-deps --quiet
    # Torch's actual runtime deps, deliberately from plain PyPI (not the
    # CUDA index --no-deps skipped above) — generic, non-CUDA-specific
    # packages, no reason to route them through PyTorch's index at all.
    pip install filelock typing_extensions sympy networkx jinja2 fsspec setuptools --quiet
  fi
else
  echo "  No NVIDIA GPU detected — installing CPU torch (transcription will be slow)..."
  pip install torch torchaudio --quiet
fi

pip install -r requirements.txt --quiet
echo "✓ Dependencies installed"

# Confirm what actually got installed — catches a silent CPU fallback
# immediately instead of it only surfacing later as "why is this so slow".
python -c "import torch; print('  Torch ' + torch.__version__ + ' — CUDA available: ' + str(torch.cuda.is_available()))" 2>/dev/null || true

# Config setup
if [ -f "worker.yaml" ]; then
  echo ""
  echo "worker.yaml already exists — skipping config setup."
  echo "Edit it manually if you need to change settings."
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Let's set up your worker.yaml"
  echo "You'll need: the site URL, your campaign slug, and the API key from Campaign Settings."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  read -p "Server URL (e.g. https://my-campaign.fly.dev): " SERVER_URL
  read -p "Campaign slug (e.g. as-above-so-below): " CAMPAIGN_SLUG
  read -p "Worker API key (from Campaign Settings → Worker tab): " API_KEY
  read -p "Audio folder path (where Craig drops your .flac files): " AUDIO_DIR

  cat > worker.yaml <<EOF
server_url: ${SERVER_URL%/}
campaign_slug: ${CAMPAIGN_SLUG}
api_key: ${API_KEY}
audio_dir: ${AUDIO_DIR}
poll_interval: 30
# whisper_model: turbo  # Uncomment to override the campaign's model setting
EOF

  echo ""
  echo "✓ worker.yaml created"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Setup complete! To run the worker:"
echo ""
echo "  source venv/bin/activate"
echo "  python main.py"
echo ""
echo "Audio layout: drop Craig files into a subfolder named after the session."
echo "  Example: \$audio_dir/2026-03-15/*.flac"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
