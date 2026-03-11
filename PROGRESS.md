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
| 8 | Settings page + dev launcher | ⏳ Pending |

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
- `GET /config/corrections` — read corrections dict
- `PUT /config/corrections` — write corrections dict
- `GET /config/patterns` — read patterns list
- `PUT /config/patterns` — write patterns list
- `POST /config/test-correction` — test corrections against sample text
- `GET /config/vocab` — extract vocab from vault
- `POST /pipeline/run` — launch pipeline in background thread
- `GET /pipeline/status` — check running state
- `WS /ws/progress` — live log streaming via WebSocket

---

## Phases 2 & 3 — Pipeline runner + WebSocket + Config API ✅

Included in server.py (all in one file).

---

## Phase 4 — React frontend scaffold ✅

**Files created:**
- `gui/` — Vite + React + TypeScript project
- `gui/vite.config.ts` — Tailwind CSS v4 plugin + dev proxy to :8765
- `gui/src/index.css` — dark theme global styles
- `gui/src/App.tsx` — sidebar nav + React Router routes
- `gui/src/App.css` — spin keyframe animation

**Pages stubbed:**
- SessionsPage, SessionView, PipelinePage, CorrectionsPage, SettingsPage

---

## Phase 5 — Sessions page + Session View ✅

**`SessionsPage.tsx`:**
- Lists all sessions with status badges (complete/transcribed/raw/empty)
- File presence badges (transcript/summary/wiki)
- Create new session form

**`SessionView.tsx`:**
- Tabs: Transcript, Summary, Wiki
- Transcript: speaker color-coded chips, timestamp, searchable
- Summary/Wiki: rendered markdown
- Re-merge button

---

## Phase 6 — Pipeline Runner page ✅

**`PipelinePage.tsx`:**
- Session dropdown, step selector (full/transcribe-only/wiki-only)
- Run button with loading spinner
- Live WebSocket log stream with color coding and auto-scroll
- Exit code display

---

## Phase 7 — Corrections Editor page ✅

**`CorrectionsPage.tsx`:**
- Two-panel layout: editor + live preview
- Corrections tab: sorted list, add/edit/delete
- Patterns tab: regex patterns, add/delete
- Test panel: paste text → apply all corrections → show diff

---

## Phase 8 — Settings page + dev launcher ⏳

**`SettingsPage.tsx`:** ✅ Done (bundled with phases 4-7 commit)
- Whisper model dropdown
- VAD toggle
- Sessions dir + vault path
- Notify Claude toggle + OpenClaw session ID
- Players table (add/edit/remove)
- Vocab prompt preview

**`start.sh`:** ⏳ Pending
