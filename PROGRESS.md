# DnD Transcriber GUI — Build Progress

## Status Overview

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Backend skeleton + Session API | ✅ Done |
| 2 | Pipeline runner + WebSocket | ✅ Done |
| 3 | Config API | ✅ Done |
| 4 | React frontend scaffold | ✅ Done |
| 5 | Sessions page + Session View | ✅ Done |
| 6 | Pipeline Runner page | ✅ Done |
| 7 | Corrections Editor page | ✅ Done |
| 8 | Settings page + dev launcher | ✅ Done |

**ALL PHASES COMPLETE** 🎉

---

## How to run

```bash
./start.sh
```

- Backend: http://localhost:8765 (FastAPI + uvicorn, auto-reload)
- Frontend: http://localhost:5173 (Vite dev server, HMR)

Or run individually:
```bash
# Backend
uvicorn server:app --port 8765 --reload

# Frontend
cd gui && npm run dev
```

To build for production:
```bash
cd gui && npm run build
# Serves from /gui/dist/ via FastAPI static files at http://localhost:8765
```

---

## Phase 1 — Backend skeleton + Session API ✅

**Files created/modified:**
- `server.py` — FastAPI app with full Session, Config, Pipeline and WebSocket API
- `requirements.txt` — Added fastapi, uvicorn, websockets, python-multipart

**Endpoints implemented:**
- `GET /sessions` — list all sessions with status
- `POST /sessions` — create new session directory
- `GET /sessions/{name}/transcript` — read transcript.md
- `GET /sessions/{name}/summary` — read summary.md
- `GET /sessions/{name}/wiki` — read wiki.md
- `POST /sessions/{name}/merge` — re-run merge step
- `GET /config` — read full config.yaml
- `PUT /config` — write full config.yaml

---

## Phases 2 & 3 — Pipeline runner + WebSocket + Config API ✅

**Endpoints:**
- `POST /pipeline/run` — launch pipeline in background thread
- `GET /pipeline/status` — check running state
- `WS /ws/progress` — live log streaming via WebSocket
- `GET /config/corrections`, `PUT /config/corrections`
- `GET /config/patterns`, `PUT /config/patterns`
- `POST /config/test-correction` — test corrections with diff output
- `GET /config/vocab` — extract vocab from vault

---

## Phase 4 — React frontend scaffold ✅

- Vite + React + TypeScript in `gui/`
- Tailwind CSS v4 via `@tailwindcss/vite` plugin
- react-router-dom + react-markdown
- Dark theme: `#0f1117` background
- `App.tsx` sidebar nav → Sessions / Pipeline / Corrections / Settings
- Dev proxy: Vite → FastAPI on :8765

---

## Phase 5 — Sessions page + Session View ✅

**`SessionsPage.tsx`:**
- Lists sessions with status badges (complete/transcribed/raw/empty)
- File presence badges (transcript/summary/wiki)
- Create new session form

**`SessionView.tsx`:**
- Tabs: Transcript, Summary, Wiki
- Transcript: speaker color-coded chips, timestamp, full-text search with highlight
- Summary/Wiki: rendered markdown via react-markdown
- Re-merge button (calls `POST /sessions/{name}/merge`)

---

## Phase 6 — Pipeline Runner page ✅

**`PipelinePage.tsx`:**
- Session dropdown selector
- Step selector: Full pipeline / Transcribe only / Wiki only
- Run button with animated spinner
- Live WebSocket log stream (auto-scroll, color-coded output)
- Exit code display (green ✓ / red ✗)

---

## Phase 7 — Corrections Editor page ✅

**`CorrectionsPage.tsx`:**
- Two tabs: Corrections (word pairs) + Patterns (regex)
- Corrections: sorted list, add/inline-edit/delete, auto-save
- Patterns: regex + replacement, add/delete, auto-save
- Live preview panel: paste text → apply corrections → show unified diff

---

## Phase 8 — Settings page + dev launcher ✅

**`SettingsPage.tsx`:**
- Whisper model dropdown (tiny → turbo)
- VAD toggle with description
- Sessions dir + vault path text fields
- Notify Claude toggle + OpenClaw session ID
- Players table: add/edit name,character,role/remove
- Vocab prompt preview (read from vault via API)

**`start.sh`:**
- Activates venv if present
- Starts uvicorn on :8765 (backend, --reload)
- Starts Vite dev server on :5173 (frontend)
- Graceful Ctrl+C shutdown of both processes
