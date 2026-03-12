# DnD Session Transcriber

Turns Craig bot Discord recordings into speaker-labeled transcripts, session summaries, and Obsidian wiki update suggestions — with a full web GUI for review and editing.

## Pipeline

```
Craig records session (per-user .flac files)
  → Whisper transcribes each track (with campaign vocab prompt)
  → Merge into timestamped transcript
  → Claude generates summary + wiki suggestions
  → Review, edit, and apply updates via the web GUI (or CLI)
```

---

## Quick Start (GUI)

```bash
cd dnd-transcriber
./start.sh
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8765

### First-time setup

```bash
# 1. Python environment
python -m venv venv
source venv/bin/activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt

# 2. Frontend
cd gui && npm install && cd ..

# 3. Configure
cp config.yaml.example config.yaml  # edit as needed
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Prerequisites

- NVIDIA GPU with CUDA (recommended — CPU works but is slow)
- ffmpeg: `sudo apt install ffmpeg`
- Node.js 18+

---

## Web GUI

The GUI wraps the full pipeline in a browser interface:

| Page | What it does |
|------|-------------|
| **Sessions** | Create sessions, upload Craig zip or individual FLACs via drag-and-drop, rename/delete |
| **Session View** | Tabs: Transcript (speaker colors, audio sync, edit mode) · Summary · Wiki suggestions · Changes (diff + hallucination flags) |
| **Pipeline** | Run full pipeline or individual steps with live log stream |
| **Corrections** | Add/edit/delete word replacements and regex patterns with live preview diff |
| **Settings** | Whisper model, VAD, players list, vocab prompt, notification config |

### Transcript features
- Speaker color-coding with audio track auto-switch on timestamp click
- Merged audio playback (ffmpeg-mixed, served from backend)
- Inline edit mode — click any line to correct it
- Speaker rename panel — reassign display names without editing files
- Side-by-side diff vs raw Whisper output

### Wiki suggestions
- Structured suggestion cards (page, section, bullets)
- Per-card Apply / Skip buttons
- Apply All → runs `apply_updates.py` to write directly to vault
- Import Corrections → pulls proper noun corrections from suggestions into config

---

## CLI Usage

```bash
# Full pipeline
python pipeline.py sessions/session-01

# Transcription only
python pipeline.py sessions/session-01 --transcribe-only

# Wiki suggestions only (transcript already exists)
python pipeline.py sessions/session-01 --wiki-only

# Re-merge with updated corrections (no re-transcribe)
python merge.py sessions/session-01 config.yaml

# Apply approved wiki suggestions
python apply_updates.py sessions/session-01 --all
python apply_updates.py sessions/session-01 --apply 1,3,5
python apply_updates.py sessions/session-01 --skip 2
```

---

## Recording with Craig

1. Invite Craig: https://craig.horse
2. `/join` at session start, `/stop` at end
3. Download the **FLAC** zip (not the mixed track)
4. Drag-and-drop the zip onto the session card in the GUI — it auto-extracts

---

## Configuration

Edit `config.yaml`:

```yaml
whisper_model: turbo        # tiny / base / medium / large-v3 / turbo
vad: true                   # Voice Activity Detection (removes silence)
sessions_dir: sessions
vault_path: ../campaign-vault

players:
  - username: dannysollo
    name: Danny
    character: DM
    role: dm

corrections:                # Whisper mis-transcriptions to fix
  "Tehom": "Tehom"
  "Tajom": "Tehom"

patterns:                   # Regex corrections
  - match: "(?i)\\bTehom\\b"
    replace: "Tehom"
```

---

## File Structure

```
dnd-transcriber/
  pipeline.py            ← Main CLI entry point
  server.py              ← FastAPI backend (GUI)
  merge.py               ← Merges tracks into transcript, applies corrections
  transcribe.py          ← Runs Whisper on audio tracks
  wiki_updater.py        ← Claude integration for summaries + wiki suggestions
  apply_updates.py       ← Applies approved suggestions to Obsidian vault
  vocab_extractor.py     ← Scrapes vault for proper nouns → Whisper prompt
  config.yaml            ← Your configuration
  start.sh               ← Dev launcher (backend + frontend)
  requirements.txt
  ANALYZE_SESSION.md     ← Instructions for Claude session analysis
  gui/                   ← React + Vite frontend
    src/
      pages/             ← SessionsPage, SessionView, PipelinePage, etc.
      components/
    package.json
  sessions/              ← Session data (audio gitignored, transcripts tracked)
    session-01/
      raw/               ← Craig .flac files (gitignored)
      speakers/          ← Intermediate Whisper JSON (gitignored)
      transcript.md      ← Labeled transcript ✓ committed
      summary.md         ← Session summary ✓ committed
      wiki_suggestions.md ← Suggested vault updates ✓ committed
```

---

## Tips

- **Speed:** `turbo` model is ~3x faster than `large-v3` with minor quality tradeoff. On a 4060 Ti, a 4hr session takes ~20 min with turbo.
- **Proper nouns:** If a name is being mangled, add its page to your Obsidian vault — `vocab_extractor.py` picks it up automatically next run.
- **Corrections:** Use the GUI corrections editor to add/test fixes. Hit "Re-merge All" to apply across all sessions at once.
- **Wiki review:** Always read `wiki_suggestions.md` before hitting Apply All — suggestions are additions only, never rewrites.
