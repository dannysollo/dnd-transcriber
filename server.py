"""
server.py — FastAPI backend for the DnD Transcriber GUI
"""
import asyncio
import json
import os
import queue
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

CONFIG_PATH = Path(__file__).parent / "config.yaml"
BASE_DIR = Path(__file__).parent

app = FastAPI(title="DnD Transcriber", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── State ────────────────────────────────────────────────────────────────────

pipeline_state = {
    "running": False,
    "session": None,
    "step": None,
    "log": [],
}

log_queue: queue.Queue = queue.Queue()
ws_clients: list[WebSocket] = []


# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def save_config(config: dict):
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def get_sessions_dir() -> Path:
    config = load_config()
    return BASE_DIR / config.get("sessions_dir", "sessions")


def session_status(session_path: Path) -> str:
    """Determine rough status of a session based on present files."""
    if (session_path / "transcript.md").exists():
        return "complete"
    speakers = list((session_path / "speakers").glob("*.json")) if (session_path / "speakers").exists() else []
    if speakers:
        return "transcribed"
    raw = session_path / "raw"
    if raw.exists() and any(raw.glob("*.flac")) or any(raw.glob("*.mp3")):
        return "raw"
    return "empty"


# ─── Sessions ─────────────────────────────────────────────────────────────────

@app.get("/sessions")
def list_sessions():
    sessions_dir = get_sessions_dir()
    sessions_dir.mkdir(parents=True, exist_ok=True)
    sessions = []
    for d in sorted(sessions_dir.iterdir(), reverse=True):
        if d.is_dir() and not d.name.startswith("."):
            sessions.append({
                "name": d.name,
                "status": session_status(d),
                "has_transcript": (d / "transcript.md").exists(),
                "has_summary": (d / "summary.md").exists(),
                "has_wiki": (d / "wiki.md").exists(),
            })
    return sessions


class CreateSessionBody(BaseModel):
    name: str


@app.post("/sessions")
def create_session(body: CreateSessionBody):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / body.name
    if session_dir.exists():
        raise HTTPException(400, f"Session '{body.name}' already exists")
    (session_dir / "raw").mkdir(parents=True)
    return {"name": body.name, "status": "empty"}


@app.get("/sessions/{name}/transcript")
def get_transcript(name: str):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.get("/sessions/{name}/summary")
def get_summary(name: str):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "summary.md"
    if not path.exists():
        raise HTTPException(404, "Summary not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.get("/sessions/{name}/wiki")
def get_wiki(name: str):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "wiki.md"
    if not path.exists():
        raise HTTPException(404, "Wiki not found")
    return {"content": path.read_text(encoding="utf-8")}


# ─── Merge (re-run merge step on existing speakers) ───────────────────────────

@app.post("/sessions/{name}/merge")
def merge_session(name: str):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")

    config = load_config()
    try:
        from merge import save_transcript
        result = save_transcript(
            str(session_dir),
            corrections=config.get("corrections"),
            patterns=config.get("patterns"),
        )
        return {"lines": result.count("\n"), "chars": len(result)}
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── Config ───────────────────────────────────────────────────────────────────

@app.get("/config")
def get_config():
    return load_config()


class ConfigBody(BaseModel):
    config: dict


@app.put("/config")
def put_config(body: ConfigBody):
    save_config(body.config)
    return {"ok": True}


@app.get("/config/corrections")
def get_corrections():
    config = load_config()
    return {"corrections": config.get("corrections", {})}


class CorrectionsBody(BaseModel):
    corrections: dict


@app.put("/config/corrections")
def put_corrections(body: CorrectionsBody):
    config = load_config()
    config["corrections"] = body.corrections
    save_config(config)
    return {"ok": True}


@app.get("/config/patterns")
def get_patterns():
    config = load_config()
    return {"patterns": config.get("patterns", [])}


class PatternsBody(BaseModel):
    patterns: list


@app.put("/config/patterns")
def put_patterns(body: PatternsBody):
    config = load_config()
    config["patterns"] = body.patterns
    save_config(config)
    return {"ok": True}


class TestCorrectionBody(BaseModel):
    text: str
    corrections: Optional[dict] = None
    patterns: Optional[list] = None


@app.post("/config/test-correction")
def test_correction(body: TestCorrectionBody):
    from merge import apply_corrections, apply_patterns
    original = body.text
    result = original
    if body.corrections:
        result = apply_corrections(result, body.corrections)
    if body.patterns:
        result = apply_patterns(result, body.patterns)

    # Build a simple diff
    if result == original:
        return {"changed": False, "result": result, "diffs": []}

    diffs = []
    orig_lines = original.splitlines()
    res_lines = result.splitlines()
    for i, (o, r) in enumerate(zip(orig_lines, res_lines)):
        if o != r:
            diffs.append({"line": i + 1, "before": o, "after": r})
    return {"changed": True, "result": result, "diffs": diffs}


@app.get("/config/vocab")
def get_vocab():
    config = load_config()
    try:
        from vocab_extractor import extract_from_vault
        vocab = extract_from_vault(config["vault_path"])
        return {"vocab": vocab}
    except Exception as e:
        return {"vocab": "", "error": str(e)}


# ─── Pipeline ─────────────────────────────────────────────────────────────────

class PipelineRunBody(BaseModel):
    session: str
    transcribe_only: bool = False
    wiki_only: bool = False


def _pipeline_thread(session: str, transcribe_only: bool, wiki_only: bool):
    global pipeline_state
    pipeline_state["running"] = True
    pipeline_state["session"] = session
    pipeline_state["log"] = []

    cmd = [sys.executable, str(BASE_DIR / "pipeline.py"), session]
    if transcribe_only:
        cmd.append("--transcribe-only")
    if wiki_only:
        cmd.append("--wiki-only")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(BASE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for line in proc.stdout:
            line = line.rstrip()
            pipeline_state["log"].append(line)
            log_queue.put(line)
        proc.wait()
        log_queue.put(f"__EXIT__{proc.returncode}")
    except Exception as e:
        log_queue.put(f"ERROR: {e}")
        log_queue.put("__EXIT__1")
    finally:
        pipeline_state["running"] = False


@app.post("/pipeline/run")
def pipeline_run(body: PipelineRunBody):
    if pipeline_state["running"]:
        raise HTTPException(409, "Pipeline already running")
    t = threading.Thread(
        target=_pipeline_thread,
        args=(body.session, body.transcribe_only, body.wiki_only),
        daemon=True,
    )
    t.start()
    return {"ok": True, "session": body.session}


@app.get("/pipeline/status")
def pipeline_status():
    return {
        "running": pipeline_state["running"],
        "session": pipeline_state["session"],
        "log_lines": len(pipeline_state["log"]),
    }


# ─── WebSocket ────────────────────────────────────────────────────────────────

async def broadcast_logs():
    """Background task: drain log_queue and send to all WS clients."""
    while True:
        try:
            line = log_queue.get_nowait()
        except queue.Empty:
            await asyncio.sleep(0.1)
            continue

        dead = []
        for ws in ws_clients:
            try:
                await ws.send_text(json.dumps({"type": "log", "line": line}))
            except Exception:
                dead.append(ws)
        for ws in dead:
            ws_clients.remove(ws)


@app.on_event("startup")
async def startup():
    asyncio.create_task(broadcast_logs())


@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    await websocket.accept()
    ws_clients.append(websocket)
    # Send backlog
    for line in pipeline_state["log"]:
        await websocket.send_text(json.dumps({"type": "log", "line": line}))
    await websocket.send_text(json.dumps({
        "type": "status",
        "running": pipeline_state["running"],
        "session": pipeline_state["session"],
    }))
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        if websocket in ws_clients:
            ws_clients.remove(websocket)


# ─── Static frontend ──────────────────────────────────────────────────────────

gui_dist = BASE_DIR / "gui" / "dist"
if gui_dist.exists():
    app.mount("/", StaticFiles(directory=str(gui_dist), html=True), name="static")
