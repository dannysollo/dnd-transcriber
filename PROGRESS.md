# DnD Transcriber GUI — Build Progress

## Status Overview

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Backend skeleton + Session API | ✅ Done |
| 2 | Pipeline runner + WebSocket | 🔄 In Progress |
| 3 | Config API | ⏳ Pending |
| 4 | React frontend scaffold | ⏳ Pending |
| 5 | Sessions page + Session View | ⏳ Pending |
| 6 | Pipeline Runner page | ⏳ Pending |
| 7 | Corrections Editor page | ⏳ Pending |
| 8 | Settings page + dev launcher | ⏳ Pending |

---

## Phase 1 — Backend skeleton + Session API ✅

**Files created/modified:**
- `server.py` — FastAPI app with full Session and Config API
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

---

## Phase 2 — Pipeline runner + WebSocket ✅

**Endpoints implemented:**
- `POST /pipeline/run` — launch pipeline in background thread
- `GET /pipeline/status` — check running state
- `WS /ws/progress` — live log streaming via WebSocket

---

## Phase 3 — Config API ✅

Included in Phase 1 server.py (corrections, patterns, test-correction, vocab endpoints).

---

## Phase 4 — React frontend scaffold ⏳

Not started.

---

## Phase 5 — Sessions page + Session View ⏳

Not started.

---

## Phase 6 — Pipeline Runner page ⏳

Not started.

---

## Phase 7 — Corrections Editor page ⏳

Not started.

---

## Phase 8 — Settings page + dev launcher ⏳

Not started.
