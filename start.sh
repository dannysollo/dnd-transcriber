#!/usr/bin/env bash
# start.sh — Launch the DnD Transcriber (dev mode)
# Backend: port 8766  |  Frontend (Vite): port 5174
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if it exists
if [ -d "$SCRIPT_DIR/venv" ]; then
  source "$SCRIPT_DIR/venv/bin/activate"
fi

# Check for fastapi
if ! python -c "import fastapi" 2>/dev/null; then
  echo "FastAPI not found. Run: pip install -r requirements.txt"
  exit 1
fi

echo "Starting DnD Transcriber (dev)..."
echo ""

# Start backend — FRONTEND_URL tells OAuth where to redirect after login
echo "[1/2] Starting FastAPI backend on http://localhost:8766 ..."
FRONTEND_URL=http://localhost:5174 uvicorn server:app --host 0.0.0.0 --port 8766 --reload &
BACKEND_PID=$!

# Start frontend dev server
echo "[2/2] Starting Vite dev server on http://localhost:5174 ..."
cd gui && VITE_API_PORT=8766 npm run dev -- --port 5174 &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8766"
echo "  Frontend: http://localhost:5174  ← open this"
echo ""
echo "Press Ctrl+C to stop both servers."

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait
