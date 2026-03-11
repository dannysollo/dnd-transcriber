#!/usr/bin/env bash
# start.sh — Launch the DnD Transcriber GUI
# Starts both the FastAPI backend (port 8765) and the Vite dev server (port 5173)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate virtual environment if it exists
if [ -d "$SCRIPT_DIR/venv" ]; then
  source "$SCRIPT_DIR/venv/bin/activate"
fi

# Check for fastapi
if ! python -c "import fastapi" 2>/dev/null; then
  echo "FastAPI not found. Run: pip install fastapi uvicorn[standard] websockets python-multipart"
  exit 1
fi

echo "Starting DnD Transcriber GUI..."
echo ""

# Start backend
echo "[1/2] Starting FastAPI backend on http://localhost:8765 ..."
uvicorn server:app --host 0.0.0.0 --port 8765 --reload &
BACKEND_PID=$!

# Start frontend dev server
echo "[2/2] Starting Vite dev server on http://localhost:5173 ..."
cd gui && npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8765"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID 2>/dev/null || true
  kill $FRONTEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

wait
