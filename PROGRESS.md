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
| **Multi-campaign Phase 1** | **Auth + DB foundation** | **✅ Done** |
| **Multi-campaign Phase 2** | **File structure migration + campaign-scoped routes + frontend** | **✅ Done** |

---

## Multi-campaign Phase 2 — File Structure Migration + Scoped Routes ✅

Branch: `feature/multi-campaign`

### What was added

**`migrate.py`:**
- Idempotent migration: `sessions/*` → `campaigns/as-above-so-below/sessions/`
- Copies `config.yaml` → `campaigns/as-above-so-below/config.yaml`
- Creates `Campaign` DB record (slug=`as-above-so-below`, name=`As Above, So Below`)
- Auto-runs on server startup when `sessions/` exists but `campaigns/` does not

**New file layout:**
```
campaigns/{slug}/config.yaml
campaigns/{slug}/sessions/{session-name}/raw/  speakers/  transcript.md  summary.md  wiki_suggestions.md
```

**`server.py` — helper updates:**
- `load_config(campaign_slug=None)` — loads from `campaigns/{slug}/config.yaml` when slug given, falls back to root `config.yaml`
- `save_config(config, campaign_slug=None)` — saves to campaign-scoped path
- `get_sessions_dir(campaign_slug=None)` — returns `campaigns/{slug}/sessions/` or legacy `sessions/`
- Startup auto-migration if `sessions/` exists but `campaigns/` does not
- `_pipeline_thread` and `_merge_all_thread` accept optional `campaign_slug`
- `/campaigns` list endpoint now includes `role` field for the requesting user

**`server.py` — new campaign-scoped routes:**
All existing session/config/pipeline routes mirrored under `/campaigns/{slug}/`:
```
GET/POST  /campaigns/{slug}/sessions
GET/PUT   /campaigns/{slug}/sessions/{name}/transcript
GET/PUT   /campaigns/{slug}/sessions/{name}/transcript/line/{n}
GET       /campaigns/{slug}/sessions/{name}/summary
GET       /campaigns/{slug}/sessions/{name}/wiki
GET       /campaigns/{slug}/sessions/{name}/wiki-suggestions-parsed
POST      /campaigns/{slug}/sessions/{name}/apply-wiki
GET       /campaigns/{slug}/sessions/{name}/raw-transcript
GET       /campaigns/{slug}/sessions/{name}/corrections-report
GET       /campaigns/{slug}/sessions/{name}/speakers
POST      /campaigns/{slug}/sessions/{name}/rename-speaker
POST      /campaigns/{slug}/sessions/{name}/merge
POST      /campaigns/{slug}/sessions/{name}/import-corrections
POST      /campaigns/{slug}/sessions/{name}/import-zip
POST      /campaigns/{slug}/sessions/{name}/upload
PATCH     /campaigns/{slug}/sessions/{name}
DELETE    /campaigns/{slug}/sessions/{name}
GET       /campaigns/{slug}/sessions/{name}/audio-files
GET       /campaigns/{slug}/sessions/{name}/audio/merged
GET       /campaigns/{slug}/sessions/{name}/audio/{filename}
GET/PUT   /campaigns/{slug}/config
GET/PUT   /campaigns/{slug}/config/corrections
GET/PUT   /campaigns/{slug}/config/patterns
POST      /campaigns/{slug}/config/test-correction
GET       /campaigns/{slug}/config/vocab
POST      /campaigns/{slug}/pipeline/run
POST      /campaigns/{slug}/merge/all
```
Auth: spectator+ for reads, dm+ for writes. `AUTH_ENABLED=false` skips all checks.
Un-prefixed routes kept as backward-compat aliases (use root `sessions/` + `config.yaml`).

**Frontend:**
- `CampaignContext.tsx` — `Campaign` interface, `CampaignProvider`, `useCampaign()`, `useApiUrl()` hook
- `main.tsx` — wrapped in `CampaignProvider`
- `App.tsx` — campaign selector dropdown in sidebar (shows active campaign name, switches when multiple campaigns)
- `SessionsPage`, `SessionView`, `CorrectionsPage`, `PipelinePage`, `SettingsPage` — use `useApiUrl()` for all fetch calls; auto-prefixes `/campaigns/{slug}/` when an active campaign is set; falls back to legacy routes when no campaign

**`pipeline.py`:**
- Added `--campaign` flag: loads config and sessions from `campaigns/{slug}/`
- Example: `python pipeline.py 2026-03-15 --campaign as-above-so-below`
- Backward compat: omit flag for original behavior

---

## Multi-campaign Phase 1 — Auth + DB Foundation ✅

Branch: `feature/multi-campaign`

### What was added

**Backend (Python):**
- `db/models.py` — SQLAlchemy ORM models: `User`, `Campaign`, `CampaignMember`, `CampaignInvite`
- `db/database.py` — Engine setup, `SessionLocal`, `get_db()` FastAPI dependency, `init_db()`
- `db/crud.py` — Full CRUD for all models
- `auth/discord.py` — Discord OAuth2: `get_authorization_url()`, `exchange_code()`, `get_user_info()`
- `auth/jwt.py` — JWT creation/verification, 30-day expiry, httpOnly cookie
- `auth/middleware.py` — `get_current_user`, `require_user`, `require_campaign_member(min_role)` deps
- `server.py` — New routes: `/auth/*`, `/campaigns/*`, `/invites/*`
- `requirements.txt` — Added: `sqlalchemy`, `authlib`, `httpx`, `python-jose[cryptography]`, `passlib`

**Frontend (React/TypeScript):**
- `AuthContext.tsx` — `AuthProvider`, `useAuth()` hook, `avatarUrl()` helper
- `pages/LoginPage.tsx` — Discord login button, auto-redirect if already logged in
- `pages/CampaignsPage.tsx` — List + create campaigns
- `pages/CampaignSettingsPage.tsx` — Settings / Members / Invites tabs
- `pages/InvitePage.tsx` — `/invite/:token` accept-invite page
- `App.tsx` — New routes, sidebar user avatar + logout, dev-mode badge
- `main.tsx` — Wrapped in `AuthProvider`

### Auth behavior

| Environment | Behavior |
|-------------|----------|
| `AUTH_ENABLED=false` (default) | All routes accessible; "Dev Mode" badge in sidebar; `/auth/me` returns `auth_enabled: false` |
| `AUTH_ENABLED=true` | Discord OAuth required; JWT httpOnly cookie set on login; role-based access enforced |

### New API endpoints

```
GET  /auth/discord              → redirect to Discord OAuth
GET  /auth/discord/callback     → handle callback, set cookie, redirect /
GET  /auth/me                   → {user, auth_enabled}
POST /auth/logout               → clear cookie

GET  /campaigns                 → user's campaigns
POST /campaigns                 → create campaign
GET  /campaigns/{slug}          → campaign details
PATCH /campaigns/{slug}         → update settings (dm+)
GET  /campaigns/{slug}/members  → member list
PATCH /campaigns/{slug}/members/{user_id} → change role (dm+)
DELETE /campaigns/{slug}/members/{user_id} → remove member (dm+)
POST /campaigns/{slug}/invites  → create invite link (dm+)
GET  /campaigns/{slug}/invites  → list invites (dm+)
GET  /invites/{token}           → public invite info (no auth required)
POST /invites/{token}/use       → accept invite
```

### Environment variables (for auth)

```
AUTH_ENABLED=true
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=http://localhost:8765/auth/discord/callback
SECRET_KEY=...             # JWT signing key (random per-restart if unset — dev only)
DATABASE_URL=sqlite:///./transcriber.db   # default
```

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
