"""
server.py — FastAPI backend for the DnD Transcriber GUI
"""
import asyncio
import io
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import zipfile
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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


AUDIO_EXTS = ("*.flac", "*.mp3", "*.ogg", "*.wav", "*.m4a")
AUDIO_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav", ".m4a"}
AUDIO_MIME = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
}

def has_audio(session_path: Path) -> bool:
    raw = session_path / "raw"
    if not raw.exists():
        return False
    return any(f for ext in AUDIO_EXTS for f in raw.glob(ext))

def session_status(session_path: Path) -> str:
    """Determine rough status of a session based on present files."""
    has_transcript = (session_path / "transcript.md").exists()
    has_summary = (session_path / "summary.md").exists()
    has_speakers = (session_path / "speakers").exists() and any((session_path / "speakers").glob("*.json"))

    if has_transcript and has_summary:
        return "complete"
    if has_transcript:
        return "has_transcript"
    if has_speakers:
        return "transcribed"
    if has_audio(session_path):
        return "has_audio"
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


@app.post("/sessions/{name}/upload")
async def upload_audio(name: str, files: list[UploadFile] = File(...)):
    sessions_dir = get_sessions_dir()
    raw_dir = sessions_dir / name / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        dest = raw_dir / f.filename
        content = await f.read()
        dest.write_bytes(content)
        saved.append(f.filename)
    return {"saved": saved}


class RenameSessionBody(BaseModel):
    new_name: str


@app.patch("/sessions/{name}")
def rename_session(name: str, body: RenameSessionBody):
    sessions_dir = get_sessions_dir()
    old_path = sessions_dir / name
    new_path = sessions_dir / body.new_name
    if not old_path.exists():
        raise HTTPException(404, f"Session '{name}' not found")
    if new_path.exists():
        raise HTTPException(400, f"Session '{body.new_name}' already exists")
    old_path.rename(new_path)
    return {"name": body.new_name, "status": session_status(new_path)}


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


@app.get("/sessions/{name}/corrections-report")
def corrections_report(name: str):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    transcript_path = session_dir / "transcript.md"

    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found")

    config = load_config()
    corrections = config.get("corrections") or {}
    patterns = config.get("patterns") or []

    from merge import merge_transcripts

    # Raw text: merge without any corrections applied
    raw_text = merge_transcripts(str(session_dir))
    corrected_text = transcript_path.read_text(encoding="utf-8")

    raw_lines = raw_text.splitlines()

    # ── Corrections ──────────────────────────────────────────────────────────
    corrections_applied = []
    for wrong, right in corrections.items():
        try:
            pat = r"\b" + re.escape(wrong) + r"\b"
            hits = re.findall(pat, raw_text, flags=re.IGNORECASE)
            hit_count = len(hits)
        except re.error:
            hit_count = 0

        examples = []
        if hit_count > 0:
            try:
                corr_lines = re.sub(
                    r"\b" + re.escape(wrong) + r"\b", right, raw_text, flags=re.IGNORECASE
                ).splitlines()
                for raw_line, corr_line in zip(raw_lines, corr_lines):
                    if raw_line != corr_line and len(examples) < 3:
                        # Trim long lines for display
                        r_snip = raw_line[:120] if len(raw_line) > 120 else raw_line
                        c_snip = corr_line[:120] if len(corr_line) > 120 else corr_line
                        examples.append(f"{r_snip} → {c_snip}")
            except re.error:
                pass

        corrections_applied.append({
            "original": wrong,
            "replacement": right,
            "hit_count": hit_count,
            "examples": examples,
        })

    corrections_applied.sort(key=lambda x: x["hit_count"], reverse=True)

    # ── Patterns ─────────────────────────────────────────────────────────────
    patterns_applied = []
    for entry in patterns:
        match_pat = entry.get("match", "")
        replace = entry.get("replace", "")
        try:
            hits = re.findall(match_pat, raw_text)
            hit_count = len(hits) if isinstance(hits[0], str) else len(hits) if hits else 0
        except (re.error, IndexError, TypeError):
            hit_count = 0

        examples = []
        if hit_count > 0:
            try:
                corr_lines = re.sub(match_pat, replace, raw_text).splitlines()
                for raw_line, corr_line in zip(raw_lines, corr_lines):
                    if raw_line != corr_line and len(examples) < 3:
                        r_snip = raw_line[:120] if len(raw_line) > 120 else raw_line
                        c_snip = corr_line[:120] if len(corr_line) > 120 else corr_line
                        examples.append(f"{r_snip} → {c_snip}")
            except re.error:
                pass

        patterns_applied.append({
            "original": match_pat,
            "replacement": replace,
            "hit_count": hit_count,
            "examples": examples,
        })

    patterns_applied.sort(key=lambda x: x["hit_count"], reverse=True)

    # ── Hallucination detection ───────────────────────────────────────────────
    HALLUCINATION_PHRASES = {
        "thank you", "thanks for watching", "you", ".", "...", "bye", "bye bye",
        "see you", "subscribe", "like and subscribe", "subtitles by", "transcribed by",
        "www.", ".com",
    }

    # Load all speaker segments keyed by start time for duration checks
    speakers_dir = session_dir / "speakers"
    seg_by_start: dict[float, dict] = {}
    if speakers_dir.exists():
        for jf in speakers_dir.glob("*.json"):
            try:
                with open(jf, encoding="utf-8") as f:
                    data = json.load(f)
                for seg in data.get("segments", []):
                    seg_by_start[float(seg["start"])] = seg
            except Exception:
                pass

    line_re = re.compile(r'^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$')
    corr_lines_list = corrected_text.splitlines()

    # Count exact text occurrences for duplicate detection
    text_counts: dict[str, int] = {}
    for raw_line in corr_lines_list:
        m = line_re.match(raw_line)
        if m:
            txt = m.group(3).strip()
            text_counts[txt] = text_counts.get(txt, 0) + 1

    hallucinations = []
    for line_num, raw_line in enumerate(corr_lines_list, 1):
        m = line_re.match(raw_line)
        if not m:
            continue
        timestamp = m.group(1)
        speaker = m.group(2).strip()
        text = m.group(3).strip()
        text_lower = text.lower().rstrip(".")

        reason: str | None = None

        # Known hallucination phrase match
        if text_lower in HALLUCINATION_PHRASES or text.lower() in HALLUCINATION_PHRASES:
            reason = "known whisper artifact"

        # Repeated single-word pattern (e.g. "hello hello hello")
        if reason is None:
            words = text_lower.split()
            if len(words) >= 3 and len(set(words)) == 1:
                reason = "repeated word artifact"

        # Short text + short segment duration
        if reason is None and seg_by_start:
            parts = timestamp.split(":")
            try:
                if len(parts) == 2:
                    ts_sec = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 3:
                    ts_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                else:
                    ts_sec = -1
            except ValueError:
                ts_sec = -1

            if ts_sec >= 0 and len(text.split()) < 4:
                for seg_start, seg in seg_by_start.items():
                    if abs(seg_start - ts_sec) < 5:
                        duration = float(seg.get("end", seg_start)) - seg_start
                        if duration < 2.0:
                            reason = f"short segment ({duration:.1f}s, {len(text.split())} words)"
                        break

        # 3+ duplicate lines
        if reason is None and text_counts.get(text, 0) >= 3:
            reason = f"duplicate line ({text_counts[text]} occurrences)"

        if reason:
            hallucinations.append({
                "line": line_num,
                "timestamp": timestamp,
                "speaker": speaker,
                "text": text,
                "reason": reason,
            })

    total_hits = (
        sum(c["hit_count"] for c in corrections_applied)
        + sum(p["hit_count"] for p in patterns_applied)
    )

    return {
        "corrections_applied": corrections_applied,
        "patterns_applied": patterns_applied,
        "hallucinations": hallucinations,
        "stats": {
            "total_corrections": len(corrections_applied) + len(patterns_applied),
            "total_hits": total_hits,
            "hallucination_count": len(hallucinations),
        },
    }


# ─── Delete session ───────────────────────────────────────────────────────────

@app.delete("/sessions/{name}", status_code=204)
def delete_session(name: str):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, f"Session '{name}' not found")
    shutil.rmtree(session_dir)


# ─── Zip import ───────────────────────────────────────────────────────────────

@app.post("/sessions/{name}/import-zip")
async def import_zip(name: str, file: UploadFile = File(...)):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, f"Session '{name}' not found")
    raw_dir = session_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    extracted = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for member in zf.namelist():
            ext = Path(member).suffix.lower()
            if ext in AUDIO_EXTENSIONS:
                filename = Path(member).name
                if filename:
                    dest = raw_dir / filename
                    dest.write_bytes(zf.read(member))
                    extracted.append(filename)
    return {"extracted": extracted}


# ─── Audio files ──────────────────────────────────────────────────────────────

@app.get("/sessions/{name}/audio-files")
def get_audio_files(name: str):
    sessions_dir = get_sessions_dir()
    raw_dir = sessions_dir / name / "raw"
    if not raw_dir.exists():
        return {"files": []}
    files = [
        f.name for f in sorted(raw_dir.iterdir())
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
    ]
    return {"files": files}


@app.get("/sessions/{name}/audio/{filename}")
def get_audio_file(name: str, filename: str):
    sessions_dir = get_sessions_dir()
    safe_filename = Path(filename).name
    path = sessions_dir / name / "raw" / safe_filename
    if not path.exists() or path.suffix.lower() not in AUDIO_EXTENSIONS:
        raise HTTPException(404, "Audio file not found")
    media_type = AUDIO_MIME.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type)


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
