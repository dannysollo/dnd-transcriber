"""
server.py — FastAPI backend for the DnD Transcriber GUI
"""
import asyncio
from datetime import datetime
import io
import json
import os
import queue
import difflib
import re
import shutil
import subprocess
import sys
import threading
import zipfile
from pathlib import Path
from typing import Optional

import yaml
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import discord as discord_auth
from auth.jwt import COOKIE_NAME, create_access_token
from auth.middleware import AUTH_ENABLED, get_current_user, require_campaign_member, require_user, require_worker_key
from db import crud
from db.database import get_db, init_db
from db.models import SessionShare, TranscriptEdit, TranscriptionJob, User

APP_DIR = Path(__file__).parent
CONFIG_PATH = APP_DIR / "config.yaml"
DATA_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR)))
# DATA_DIR: where campaigns/, sessions/, and the DB live.
# Defaults to APP_DIR (dev), override to /data (production/fly.io)
BASE_DIR = Path(os.getenv("DATA_DIR", str(APP_DIR)))

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

def load_config(campaign_slug: Optional[str] = None) -> dict:
    if campaign_slug:
        path = BASE_DIR / "campaigns" / campaign_slug / "config.yaml"
        if path.exists():
            with open(path) as f:
                return yaml.safe_load(f) or {}
        # Campaign exists but has no config yet — return empty defaults, never fall back to global
        return {}
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def save_config(config: dict, campaign_slug: Optional[str] = None):
    if campaign_slug:
        path = BASE_DIR / "campaigns" / campaign_slug / "config.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
        return
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def get_sessions_dir(campaign_slug: Optional[str] = None) -> Path:
    if campaign_slug:
        return BASE_DIR / "campaigns" / campaign_slug / "sessions"
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
                "has_wiki": (d / "wiki_suggestions.md").exists() or (d / "wiki.md").exists(),
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
    session_dir = sessions_dir / name
    # Prefer wiki_suggestions.md, fall back to wiki.md
    for filename in ("wiki_suggestions.md", "wiki.md"):
        path = session_dir / filename
        if path.exists():
            return {"content": path.read_text(encoding="utf-8")}
    raise HTTPException(404, "Wiki not found")


class ApplyWikiBody(BaseModel):
    mode: str  # "all" | "apply" | "skip"
    ids: list[int] = []


@app.post("/sessions/{name}/apply-wiki")
def apply_wiki(name: str, body: ApplyWikiBody):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")

    cmd = [sys.executable, str(BASE_DIR / "apply_updates.py"), str(session_dir),
           "--config", str(CONFIG_PATH)]

    if body.mode == "all":
        cmd.append("--all")
    elif body.mode == "apply":
        if not body.ids:
            raise HTTPException(400, "mode=apply requires ids")
        cmd.extend(["--apply", ",".join(str(i) for i in body.ids)])
    elif body.mode == "skip":
        cmd.append("--all")
        if body.ids:
            cmd.extend(["--skip", ",".join(str(i) for i in body.ids)])
    else:
        raise HTTPException(400, f"Invalid mode: {body.mode}")

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    output = result.stdout + (result.stderr if result.stderr else "")
    return {"output": output, "applied": body.ids}


@app.get("/sessions/{name}/wiki-suggestions-parsed")
def get_wiki_suggestions_parsed(name: str):
    sessions_dir = get_sessions_dir()
    suggestions_file = sessions_dir / name / "wiki_suggestions.md"
    if not suggestions_file.exists():
        raise HTTPException(404, "wiki_suggestions.md not found")

    from apply_updates import parse_suggestions
    suggestions = parse_suggestions(suggestions_file)

    result = []
    for num, s in sorted(suggestions.items()):
        result.append({
            "id": num,
            "title": s["title"],
            "page": s["page"],
            "section": s["section"],
            "bullets": s["bullets"],
            "new_page": s["new_page"],
            "description": s.get("description"),
        })
    return result


@app.get("/sessions/{name}/raw-transcript")
def get_raw_transcript(name: str):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")
    try:
        from merge import merge_transcripts
        raw_text = merge_transcripts(str(session_dir))
        return {"content": raw_text}
    except Exception as e:
        raise HTTPException(500, str(e))


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
    audio_files = [
        f for f in sorted(raw_dir.iterdir())
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS 
    ]
    result = []
    if len(audio_files) >= 1:
        result.append({
            "filename": "_merged",
            "label": "All tracks (merged)",
            "url": f"/sessions/{name}/audio/merged",
        })
    for f in audio_files:
        result.append({
            "filename": f.name,
            "label": f.name,
            "url": f"/sessions/{name}/audio/{f.name}",
        })
    return {"files": result}


@app.get("/sessions/{name}/audio/merged")
def get_merged_audio(name: str):
    sessions_dir = get_sessions_dir()
    raw_dir = sessions_dir / name / "raw"
    if not raw_dir.exists():
        raise HTTPException(404, "No audio directory found")
    audio_files = [
        f for f in sorted(raw_dir.iterdir())
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS and f.name != "_merged.mp3"
    ]
    if not audio_files:
        raise HTTPException(404, "No audio files found")
    if len(audio_files) == 1:
        return RedirectResponse(url=f"/sessions/{name}/audio/{audio_files[0].name}")
    merged_path = raw_dir / "_merged.mp3"
    if merged_path.exists():
        return FileResponse(str(merged_path), media_type="audio/mpeg")
    inputs: list[str] = []
    for f in audio_files:
        inputs.extend(["-i", str(f)])
    n = len(audio_files)
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", f"amix=inputs={n}:duration=longest:normalize=0",
        str(merged_path),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise HTTPException(500, f"ffmpeg failed: {proc.stderr.decode()}")
    return FileResponse(str(merged_path), media_type="audio/mpeg")


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


# ─── Import corrections from wiki suggestions ─────────────────────────────────

@app.post("/sessions/{name}/import-corrections")
def import_corrections_from_wiki(name: str):
    sessions_dir = get_sessions_dir()
    wiki_path = sessions_dir / name / "wiki_suggestions.md"
    if not wiki_path.exists():
        raise HTTPException(404, "wiki_suggestions.md not found")

    content = wiki_path.read_text(encoding="utf-8")
    lines = content.splitlines()
    in_section = False
    found: list[tuple[str, str]] = []

    for line in lines:
        if re.match(r'^#+\s+.*[Pp]roper\s+[Nn]oun\s+[Cc]orrections', line):
            in_section = True
            continue
        if in_section and re.match(r'^#', line):
            break
        if in_section:
            # Match: - "wrong" → "Correct"  (arrow may be → or ->)
            m = re.match(r'^-\s+"([^"]+)"\s+(?:→|->)\s+"([^"]+)"', line)
            if m:
                found.append((m.group(1), m.group(2)))

    config = load_config()
    corrections = dict(config.get("corrections") or {})

    imported = []
    skipped = []
    for wrong, right in found:
        if wrong in corrections:
            skipped.append({"from": wrong, "to": right})
        else:
            corrections[wrong] = right
            imported.append({"from": wrong, "to": right})

    if imported:
        config["corrections"] = corrections
        save_config(config)

    return {"imported": imported, "skipped": skipped}


# ─── Batch re-merge all sessions ──────────────────────────────────────────────

def _merge_all_thread(campaign_slug: Optional[str] = None):
    global pipeline_state
    pipeline_state["running"] = True
    pipeline_state["log"] = []

    sessions_dir = get_sessions_dir(campaign_slug)
    config = load_config(campaign_slug)

    sessions_to_process = []
    for d in sorted(sessions_dir.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            speakers_dir = d / "speakers"
            if speakers_dir.exists() and any(speakers_dir.glob("*.json")):
                sessions_to_process.append(d.name)

    log_queue.put(f"Re-merging {len(sessions_to_process)} session(s) with current corrections...")

    processed = []
    failed = []
    for session_name in sessions_to_process:
        log_queue.put(f"  [{session_name}] merging...")
        try:
            from merge import save_transcript
            save_transcript(
                str(sessions_dir / session_name),
                corrections=config.get("corrections"),
                patterns=config.get("patterns"),
            )
            processed.append(session_name)
            log_queue.put(f"  ✓ {session_name}")
        except Exception as e:
            failed.append(session_name)
            log_queue.put(f"  ✗ {session_name}: {e}")

    log_queue.put("")
    log_queue.put(f"Complete: {len(processed)} merged, {len(failed)} failed")
    if failed:
        log_queue.put(f"Failed sessions: {', '.join(failed)}")
    log_queue.put("__EXIT__0")
    pipeline_state["running"] = False


@app.post("/merge/all")
def merge_all():
    if pipeline_state["running"]:
        raise HTTPException(409, "Pipeline already running")
    pipeline_state["running"] = True
    pipeline_state["session"] = None
    pipeline_state["log"] = []
    t = threading.Thread(target=_merge_all_thread, daemon=True)
    t.start()
    return {"ok": True}


# ─── Speakers ─────────────────────────────────────────────────────────────────

@app.get("/sessions/{name}/speakers")
def get_speakers(name: str):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")

    content = path.read_text(encoding="utf-8")
    line_re = re.compile(r'^\*\*\[[^\]]+\] ([^:]+):\*\*')
    speaker_counts: dict[str, int] = {}
    for line in content.splitlines():
        m = line_re.match(line)
        if m:
            speaker = m.group(1).strip()
            speaker_counts[speaker] = speaker_counts.get(speaker, 0) + 1

    speakers = [
        {"name": spk, "line_count": cnt}
        for spk, cnt in sorted(speaker_counts.items(), key=lambda x: -x[1])
    ]
    return {"speakers": speakers}


class RenameSpeakerBody(BaseModel):
    old_name: str
    new_name: str


@app.post("/sessions/{name}/rename-speaker")
def rename_speaker(name: str, body: RenameSpeakerBody):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")

    content = path.read_text(encoding="utf-8")
    old_escaped = re.escape(body.old_name)
    pattern = r'(\*\*\[[^\]]+\] )' + old_escaped + r'(:\*\*)'
    new_name_str = body.new_name
    new_content, count = re.subn(
        pattern,
        lambda m: m.group(1) + new_name_str + m.group(2),
        content,
    )
    path.write_text(new_content, encoding="utf-8")
    return {"replacements": count}


# ─── Transcript editing ────────────────────────────────────────────────────────

class TranscriptContentBody(BaseModel):
    content: str


@app.put("/sessions/{name}/transcript")
def put_transcript(name: str, body: TranscriptContentBody):
    sessions_dir = get_sessions_dir()
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")
    path = session_dir / "transcript.md"
    path.write_text(body.content, encoding="utf-8")
    return {"lines": body.content.count("\n")}


@app.get("/sessions/{name}/transcript/line/{line_number}")
def get_transcript_line(name: str, line_number: int):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    lines = path.read_text(encoding="utf-8").splitlines()
    if line_number < 1 or line_number > len(lines):
        raise HTTPException(404, f"Line {line_number} not found (total: {len(lines)})")
    return {"line": lines[line_number - 1], "line_number": line_number}


class TranscriptLineBody(BaseModel):
    content: str


@app.put("/sessions/{name}/transcript/line/{line_number}")
def put_transcript_line(name: str, line_number: int, body: TranscriptLineBody):
    sessions_dir = get_sessions_dir()
    path = sessions_dir / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    lines = path.read_text(encoding="utf-8").splitlines()
    if line_number < 1 or line_number > len(lines):
        raise HTTPException(404, f"Line {line_number} not found (total: {len(lines)})")
    lines[line_number - 1] = body.content
    path.write_text("\n".join(lines), encoding="utf-8")
    return {"line_number": line_number, "content": body.content}


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


def _pipeline_thread(session: str, transcribe_only: bool, wiki_only: bool,
                     campaign_slug: Optional[str] = None):
    global pipeline_state
    pipeline_state["running"] = True
    pipeline_state["session"] = session
    pipeline_state["log"] = []

    cmd = [sys.executable, str(BASE_DIR / "pipeline.py"), session]
    if transcribe_only:
        cmd.append("--transcribe-only")
    if wiki_only:
        cmd.append("--wiki-only")
    if campaign_slug:
        cmd.extend(["--campaign", campaign_slug])

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
    init_db()
    asyncio.create_task(broadcast_logs())
    # Auto-migrate flat sessions/ → campaigns/{slug}/sessions/ if needed
    sessions_dir = BASE_DIR / "sessions"
    campaigns_dir = BASE_DIR / "campaigns"
    if sessions_dir.exists() and not campaigns_dir.exists():
        print("Detected sessions/ without campaigns/ — running auto-migration...")
        try:
            from migrate import run_migration
            run_migration(verbose=True)
        except Exception as e:
            print(f"Auto-migration warning: {e}")


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


# ─── Auth routes ──────────────────────────────────────────────────────────────

@app.get("/auth/discord")
def auth_discord_redirect():
    """Redirect user to Discord OAuth2 login page."""
    url = discord_auth.get_authorization_url()
    return RedirectResponse(url)


@app.get("/auth/discord/callback")
async def auth_discord_callback(
    code: Optional[str] = None,
    error: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Handle Discord OAuth2 callback: create/update user, set JWT cookie, redirect to /."""
    if error or not code:
        raise HTTPException(400, f"Discord OAuth error: {error or 'no code'}")

    token_data = await discord_auth.exchange_code(code)
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(400, "Failed to get access token from Discord")

    user_info = await discord_auth.get_user_info(access_token)
    user = crud.create_or_update_user(
        db,
        discord_id=user_info["id"],
        username=user_info["username"],
        discriminator=user_info["discriminator"],
        avatar=user_info["avatar"],
        email=user_info["email"],
    )

    jwt_token = create_access_token(user.id)
    frontend_url = os.getenv("FRONTEND_URL", "")
    response = RedirectResponse(url=f"{frontend_url}/")
    response.set_cookie(
        key=COOKIE_NAME,
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,  # 30 days
    )
    return response


@app.get("/auth/me")
def auth_me(user: Optional[User] = Depends(get_current_user)):
    """Return current user info, or null if not authenticated."""
    if user is None:
        return JSONResponse({"user": None, "auth_enabled": AUTH_ENABLED})
    return {
        "user": {
            "id": user.id,
            "discord_id": user.discord_id,
            "username": user.username,
            "discriminator": user.discriminator,
            "avatar": user.avatar,
            "email": user.email,
            "is_admin": user.is_admin,
        },
        "auth_enabled": AUTH_ENABLED,
    }


@app.post("/auth/logout")
def auth_logout(response: Response):
    """Clear the JWT cookie."""
    response.delete_cookie(key=COOKIE_NAME, httponly=True, samesite="lax")
    return {"ok": True}


# ─── Campaign routes ───────────────────────────────────────────────────────────

class CreateCampaignBody(BaseModel):
    slug: str
    name: str
    description: Optional[str] = None


@app.get("/campaigns")
def list_campaigns(
    user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not AUTH_ENABLED or user is None:
        return []
    campaigns = crud.get_user_campaigns(db, user.id)
    result = []
    for c in campaigns:
        member = crud.get_member(db, c.id, user.id) if user else None
        sessions_dir = get_sessions_dir(c.slug)
        session_count = sum(1 for d in sessions_dir.iterdir() if d.is_dir() and not d.name.startswith(".")) if sessions_dir.exists() else 0
        member_count = len(crud.get_campaign_members(db, c.id))
        result.append({
            "id": c.id,
            "slug": c.slug,
            "name": c.name,
            "description": c.description,
            "owner_id": c.owner_id,
            "data_path": c.data_path,
            "settings": c.settings,
            "created_at": c.created_at.isoformat(),
            "role": member.role if member else "unknown",
            "session_count": session_count,
            "member_count": member_count,
        })
    return result


@app.post("/campaigns", status_code=201)
def create_campaign(
    body: CreateCampaignBody,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if AUTH_ENABLED and user is None:
        raise HTTPException(401, "Not authenticated")
    if crud.get_campaign_by_slug(db, body.slug):
        raise HTTPException(400, f"Campaign slug '{body.slug}' already exists")
    data_path = f"campaigns/{body.slug}"
    campaign = crud.create_campaign(
        db,
        slug=body.slug,
        name=body.name,
        description=body.description,
        owner_id=user.id if user else 0,
        data_path=data_path,
    )
    return {
        "id": campaign.id,
        "slug": campaign.slug,
        "name": campaign.name,
        "description": campaign.description,
        "owner_id": campaign.owner_id,
        "data_path": campaign.data_path,
        "settings": campaign.settings,
        "created_at": campaign.created_at.isoformat(),
    }


@app.get("/campaigns/{slug}")
def get_campaign(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return {
        "id": campaign.id,
        "slug": campaign.slug,
        "name": campaign.name,
        "description": campaign.description,
        "owner_id": campaign.owner_id,
        "data_path": campaign.data_path,
        "settings": campaign.settings,
        "created_at": campaign.created_at.isoformat(),
    }


class UpdateCampaignBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[dict] = None


@app.patch("/campaigns/{slug}")
def patch_campaign(
    slug: str,
    body: UpdateCampaignBody,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    campaign = crud.update_campaign(db, campaign, **kwargs)
    return {
        "id": campaign.id,
        "slug": campaign.slug,
        "name": campaign.name,
        "description": campaign.description,
        "settings": campaign.settings,
    }


@app.get("/campaigns/{slug}/members")
def list_members(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    members = crud.get_campaign_members(db, campaign.id)
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "username": m.user.username,
            "discord_id": m.user.discord_id,
            "avatar": m.user.avatar,
            "role": m.role,
            "joined_at": m.joined_at.isoformat(),
        }
        for m in members
    ]


class UpdateMemberBody(BaseModel):
    role: str


@app.patch("/campaigns/{slug}/members/{user_id}")
def update_member(
    slug: str,
    user_id: int,
    body: UpdateMemberBody,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    member = crud.get_member(db, campaign.id, user_id)
    if not member:
        raise HTTPException(404, "Member not found")
    if body.role not in ("dm", "player", "spectator"):
        raise HTTPException(400, "Invalid role")
    member = crud.update_member_role(db, member, body.role)
    return {"user_id": member.user_id, "role": member.role}


@app.delete("/campaigns/{slug}/members/{user_id}", status_code=204)
def remove_member(
    slug: str,
    user_id: int,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    member = crud.get_member(db, campaign.id, user_id)
    if not member:
        raise HTTPException(404, "Member not found")
    crud.remove_member(db, member)


class CreateInviteBody(BaseModel):
    role: str = "player"
    expires_in_days: Optional[int] = None
    max_uses: Optional[int] = None


@app.post("/campaigns/{slug}/invites", status_code=201)
def create_invite(
    slug: str,
    body: CreateInviteBody,
    user: Optional[User] = Depends(get_current_user),
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    if body.role not in ("dm", "player", "spectator"):
        raise HTTPException(400, "Invalid role")
    invite = crud.create_invite(
        db,
        campaign_id=campaign.id,
        created_by=user.id if user else 0,
        role=body.role,
        expires_in_days=body.expires_in_days,
        max_uses=body.max_uses,
    )
    return {
        "id": invite.id,
        "token": invite.token,
        "role": invite.role,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "max_uses": invite.max_uses,
        "use_count": invite.use_count,
        "created_at": invite.created_at.isoformat(),
    }


@app.get("/campaigns/{slug}/invites")
def list_invites(
    slug: str,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    invites = crud.get_campaign_invites(db, campaign.id)
    return [
        {
            "id": i.id,
            "token": i.token,
            "role": i.role,
            "expires_at": i.expires_at.isoformat() if i.expires_at else None,
            "max_uses": i.max_uses,
            "use_count": i.use_count,
            "created_at": i.created_at.isoformat(),
        }
        for i in invites
    ]


@app.post("/invites/{token}/use")
def use_invite(
    token: str,
    user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept an invite — the authenticated user joins the campaign."""
    if AUTH_ENABLED and user is None:
        raise HTTPException(401, "Not authenticated")
    invite = crud.get_invite_by_token(db, token)
    if not invite:
        raise HTTPException(404, "Invite not found")

    from datetime import datetime
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(410, "Invite has expired")
    if invite.max_uses and invite.use_count >= invite.max_uses:
        raise HTTPException(410, "Invite has reached max uses")

    if user:
        existing = crud.get_member(db, invite.campaign_id, user.id)
        if existing:
            raise HTTPException(409, "Already a member of this campaign")
        member = crud.use_invite(db, invite, user.id)
        return {"campaign_id": member.campaign_id, "role": member.role}
    return {"ok": True}


@app.get("/invites/{token}")
def get_invite_info(token: str, db: Session = Depends(get_db)):
    """Public endpoint: return invite details (campaign name, role) without auth."""
    invite = crud.get_invite_by_token(db, token)
    if not invite:
        raise HTTPException(404, "Invite not found")

    from datetime import datetime
    expired = bool(invite.expires_at and invite.expires_at < datetime.utcnow())
    maxed = bool(invite.max_uses and invite.use_count >= invite.max_uses)

    return {
        "token": invite.token,
        "campaign_name": invite.campaign.name,
        "campaign_slug": invite.campaign.slug,
        "role": invite.role,
        "expired": expired,
        "maxed": maxed,
        "valid": not expired and not maxed,
    }


# ─── Public share endpoint ────────────────────────────────────────────────────

@app.get("/share/{token}")
def get_shared_session(token: str, db: Session = Depends(get_db)):
    """Public read-only view of a shared session — no auth required."""
    share = crud.get_share_by_token(db, token)
    if not share:
        raise HTTPException(404, "Share link not found or expired")

    # Check expiry
    if share.expires_at and share.expires_at < datetime.utcnow():
        raise HTTPException(410, "This share link has expired")

    session_dir = get_sessions_dir(share.campaign.slug) / share.session_name

    def read_file(filename: str) -> str | None:
        p = session_dir / filename
        return p.read_text(encoding="utf-8") if p.exists() else None

    return {
        "session_name": share.session_name,
        "campaign_name": share.campaign.name,
        "show_transcript": share.show_transcript,
        "show_summary": share.show_summary,
        "show_wiki": share.show_wiki,
        "transcript": read_file("transcript.md") if share.show_transcript else None,
        "summary": read_file("summary.md") if share.show_summary else None,
        "wiki": read_file("wiki.md") if share.show_wiki else None,
        "created_at": share.created_at.isoformat(),
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
    }


# ─── Campaign-scoped routes ───────────────────────────────────────────────────
# All /sessions/*, /config/*, /pipeline/run, /merge/all mirrored under
# /campaigns/{slug}/ with membership auth enforcement.
# Auth: members (spectator+) can read; DMs can write. AUTH_ENABLED=false skips.

# ── Sessions ──────────────────────────────────────────────────────────────────

@app.get("/campaigns/{slug}/sessions")
def campaign_list_sessions(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
):
    sessions_dir = get_sessions_dir(slug)
    sessions_dir.mkdir(parents=True, exist_ok=True)
    sessions = []
    for d in sorted(sessions_dir.iterdir(), reverse=True):
        if d.is_dir() and not d.name.startswith("."):
            stat = d.stat()
            sessions.append({
                "name": d.name,
                "status": session_status(d),
                "has_transcript": (d / "transcript.md").exists(),
                "has_summary": (d / "summary.md").exists(),
                "has_wiki": (d / "wiki_suggestions.md").exists() or (d / "wiki.md").exists(),
                "created_at": datetime.utcfromtimestamp(stat.st_ctime).isoformat(),
                "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat(),
            })
    return sessions


@app.get("/campaigns/{slug}/search")
def campaign_search(
    slug: str,
    q: str,
    _member=Depends(require_campaign_member("spectator")),
):
    """Full-text search across all session transcripts, summaries, and wikis in a campaign."""
    if not q or len(q.strip()) < 2:
        raise HTTPException(400, "Query must be at least 2 characters")

    query = q.strip().lower()
    sessions_dir = get_sessions_dir(slug)
    results = []

    SEARCH_FILES = [
        ("transcript", "transcript.md"),
        ("summary", "summary.md"),
        ("wiki", "wiki.md"),
    ]

    for session_dir in sorted(sessions_dir.iterdir(), reverse=True):
        if not session_dir.is_dir() or session_dir.name.startswith("."):
            continue

        session_hits = []
        for source_type, filename in SEARCH_FILES:
            file_path = session_dir / filename
            if not file_path.exists():
                continue
            lines = file_path.read_text(encoding="utf-8").splitlines()
            for i, line in enumerate(lines):
                if query in line.lower():
                    # Include one line of context before and after
                    snippet_start = max(0, i - 1)
                    snippet_end = min(len(lines), i + 2)
                    session_hits.append({
                        "source": source_type,
                        "line_number": i + 1,
                        "line": line,
                        "context": lines[snippet_start:snippet_end],
                    })

        if session_hits:
            results.append({
                "session": session_dir.name,
                "hits": session_hits,
                "hit_count": len(session_hits),
            })

    return {"query": q, "results": results, "total_sessions": len(results)}


@app.post("/campaigns/{slug}/sessions")
def campaign_create_session(
    slug: str,
    body: CreateSessionBody,
    _member=Depends(require_campaign_member("dm")),
):
    sessions_dir = get_sessions_dir(slug)
    session_dir = sessions_dir / body.name
    if session_dir.exists():
        raise HTTPException(400, f"Session '{body.name}' already exists")
    (session_dir / "raw").mkdir(parents=True)
    return {"name": body.name, "status": "empty"}


@app.post("/campaigns/{slug}/sessions/{name}/upload")
async def campaign_upload_audio(
    slug: str,
    name: str,
    files: list[UploadFile] = File(...),
    _member=Depends(require_campaign_member("dm")),
):
    sessions_dir = get_sessions_dir(slug)
    raw_dir = sessions_dir / name / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        dest = raw_dir / f.filename
        content = await f.read()
        dest.write_bytes(content)
        saved.append(f.filename)
    return {"saved": saved}


@app.patch("/campaigns/{slug}/sessions/{name}")
def campaign_rename_session(
    slug: str,
    name: str,
    body: RenameSessionBody,
    _member=Depends(require_campaign_member("dm")),
):
    sessions_dir = get_sessions_dir(slug)
    old_path = sessions_dir / name
    new_path = sessions_dir / body.new_name
    if not old_path.exists():
        raise HTTPException(404, f"Session '{name}' not found")
    if new_path.exists():
        raise HTTPException(400, f"Session '{body.new_name}' already exists")
    old_path.rename(new_path)
    return {"name": body.new_name, "status": session_status(new_path)}


@app.delete("/campaigns/{slug}/sessions/{name}", status_code=204)
def campaign_delete_session(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("dm")),
):
    sessions_dir = get_sessions_dir(slug)
    session_dir = sessions_dir / name
    if not session_dir.exists():
        raise HTTPException(404, f"Session '{name}' not found")
    shutil.rmtree(session_dir)


@app.get("/campaigns/{slug}/sessions/{name}/transcript")
def campaign_get_transcript(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    path = get_sessions_dir(slug) / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.put("/campaigns/{slug}/sessions/{name}/transcript")
def campaign_put_transcript(
    slug: str,
    name: str,
    body: TranscriptContentBody,
    _member=Depends(require_campaign_member("dm")),
):
    session_dir = get_sessions_dir(slug) / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")
    path = session_dir / "transcript.md"
    path.write_text(body.content, encoding="utf-8")
    return {"lines": body.content.count("\n")}


@app.get("/campaigns/{slug}/sessions/{name}/transcript/line/{line_number}")
def campaign_get_transcript_line(
    slug: str,
    name: str,
    line_number: int,
    _member=Depends(require_campaign_member("spectator")),
):
    path = get_sessions_dir(slug) / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    lines = path.read_text(encoding="utf-8").splitlines()
    if line_number < 1 or line_number > len(lines):
        raise HTTPException(404, f"Line {line_number} not found")
    return {"line": lines[line_number - 1], "line_number": line_number}


@app.put("/campaigns/{slug}/sessions/{name}/transcript/line/{line_number}")
def campaign_put_transcript_line(
    slug: str,
    name: str,
    line_number: int,
    body: TranscriptLineBody,
    member=Depends(require_campaign_member("player")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    path = get_sessions_dir(slug) / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    lines = path.read_text(encoding="utf-8").splitlines()
    if line_number < 1 or line_number > len(lines):
        raise HTTPException(404, f"Line {line_number} not found")

    original = lines[line_number - 1]

    # Determine if approval is needed
    is_dm = (not AUTH_ENABLED) or (member is not None and member.role == "dm")
    needs_approval = False
    if AUTH_ENABLED and not is_dm:
        campaign = crud.get_campaign_by_slug(db, slug)
        if campaign and campaign.settings.get("require_edit_approval"):
            needs_approval = True

    if needs_approval and current_user is not None:
        campaign = crud.get_campaign_by_slug(db, slug)
        edit = crud.create_transcript_edit(
            db,
            campaign_id=campaign.id,
            session_name=name,
            user_id=current_user.id,
            line_number=line_number,
            original_text=original,
            proposed_text=body.content,
        )
        return JSONResponse(
            status_code=202,
            content={
                "status": "pending",
                "edit_id": edit.id,
                "line_number": line_number,
            },
        )

    lines[line_number - 1] = body.content
    path.write_text("\n".join(lines), encoding="utf-8")
    return {"status": "applied", "line_number": line_number, "content": body.content}


@app.get("/campaigns/{slug}/sessions/{name}/summary")
def campaign_get_summary(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    path = get_sessions_dir(slug) / name / "summary.md"
    if not path.exists():
        raise HTTPException(404, "Summary not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.get("/campaigns/{slug}/sessions/{name}/wiki")
def campaign_get_wiki(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    session_dir = get_sessions_dir(slug) / name
    for filename in ("wiki_suggestions.md", "wiki.md"):
        path = session_dir / filename
        if path.exists():
            return {"content": path.read_text(encoding="utf-8")}
    raise HTTPException(404, "Wiki not found")


@app.put("/campaigns/{slug}/sessions/{name}/summary")
def campaign_put_summary(
    slug: str,
    name: str,
    body: TranscriptLineBody,
    member=Depends(require_campaign_member("player")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    path = get_sessions_dir(slug) / name / "summary.md"
    if not path.exists():
        raise HTTPException(404, "Summary not found")
    is_dm = (not AUTH_ENABLED) or (member is not None and member.role == "dm")
    needs_approval = False
    if AUTH_ENABLED and not is_dm:
        campaign = crud.get_campaign_by_slug(db, slug)
        if campaign and campaign.settings.get("require_edit_approval"):
            needs_approval = True
    if needs_approval and current_user is not None:
        campaign = crud.get_campaign_by_slug(db, slug)
        edit = crud.create_transcript_edit(
            db,
            campaign_id=campaign.id,
            session_name=name,
            user_id=current_user.id,
            line_number=-2,  # sentinel: -2 = full summary replacement
            original_text=path.read_text(encoding="utf-8"),
            proposed_text=body.content,
        )
        return JSONResponse(status_code=202, content={"status": "pending", "edit_id": edit.id})
    path.write_text(body.content, encoding="utf-8")
    return {"status": "applied"}


@app.put("/campaigns/{slug}/sessions/{name}/wiki")
def campaign_put_wiki(
    slug: str,
    name: str,
    body: TranscriptLineBody,
    member=Depends(require_campaign_member("player")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session_dir = get_sessions_dir(slug) / name
    # Determine which file exists
    path = None
    for filename in ("wiki_suggestions.md", "wiki.md"):
        candidate = session_dir / filename
        if candidate.exists():
            path = candidate
            break
    if path is None:
        raise HTTPException(404, "Wiki not found")
    is_dm = (not AUTH_ENABLED) or (member is not None and member.role == "dm")
    needs_approval = False
    if AUTH_ENABLED and not is_dm:
        campaign = crud.get_campaign_by_slug(db, slug)
        if campaign and campaign.settings.get("require_edit_approval"):
            needs_approval = True
    if needs_approval and current_user is not None:
        campaign = crud.get_campaign_by_slug(db, slug)
        edit = crud.create_transcript_edit(
            db,
            campaign_id=campaign.id,
            session_name=name,
            user_id=current_user.id,
            line_number=-3,  # sentinel: -3 = full wiki replacement
            original_text=path.read_text(encoding="utf-8"),
            proposed_text=body.content,
        )
        return JSONResponse(status_code=202, content={"status": "pending", "edit_id": edit.id})
    path.write_text(body.content, encoding="utf-8")
    return {"status": "applied"}


@app.get("/campaigns/{slug}/sessions/{name}/wiki-suggestions-parsed")
def campaign_get_wiki_suggestions_parsed(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    suggestions_file = get_sessions_dir(slug) / name / "wiki_suggestions.md"
    if not suggestions_file.exists():
        raise HTTPException(404, "wiki_suggestions.md not found")
    from apply_updates import parse_suggestions
    suggestions = parse_suggestions(suggestions_file)
    result = []
    for num, s in sorted(suggestions.items()):
        result.append({
            "id": num,
            "title": s["title"],
            "page": s["page"],
            "section": s["section"],
            "bullets": s["bullets"],
            "new_page": s["new_page"],
            "description": s.get("description"),
        })
    return result


@app.post("/campaigns/{slug}/sessions/{name}/apply-wiki")
def campaign_apply_wiki(
    slug: str,
    name: str,
    body: ApplyWikiBody,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    session_dir = get_sessions_dir(slug) / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")

    # ── Vault sync: clone or pull repo if vault_repo_url is set ───────────
    campaign = crud.get_campaign_by_slug(db, slug)
    vault_repo_url = (campaign.settings or {}).get("vault_repo_url") if campaign else None
    github_token = os.environ.get("GITHUB_TOKEN")

    if vault_repo_url:
        # Inject token into HTTPS URL for auth
        if github_token and vault_repo_url.startswith("https://"):
            authed_url = vault_repo_url.replace("https://", f"https://{github_token}@")
        else:
            authed_url = vault_repo_url

        vault_dir = BASE_DIR / "vaults" / slug
        vault_dir.mkdir(parents=True, exist_ok=True)

        if (vault_dir / ".git").exists():
            pull = subprocess.run(["git", "pull"], cwd=vault_dir, capture_output=True, text=True)
            if pull.returncode != 0:
                raise HTTPException(500, f"Git pull failed: {pull.stderr.strip()}")
        else:
            clone = subprocess.run(
                ["git", "clone", authed_url, str(vault_dir)],
                capture_output=True, text=True
            )
            if clone.returncode != 0:
                raise HTTPException(500, f"Git clone failed: {clone.stderr.strip()}")

        # Write a temp config pointing to the synced vault
        import tempfile
        campaign_config = load_config(slug)
        campaign_config["vault_path"] = str(vault_dir)
        tmp_config = tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False)
        import yaml as _yaml
        _yaml.dump(campaign_config, tmp_config)
        tmp_config.close()
        config_path = Path(tmp_config.name)
    else:
        config_path = BASE_DIR / "campaigns" / slug / "config.yaml"
        if not config_path.exists():
            config_path = CONFIG_PATH
        vault_dir = None

    cmd = [sys.executable, str(BASE_DIR / "apply_updates.py"), str(session_dir),
           "--config", str(config_path)]
    if body.mode == "all":
        cmd.append("--all")
    elif body.mode == "apply":
        if not body.ids:
            raise HTTPException(400, "mode=apply requires ids")
        cmd.extend(["--apply", ",".join(str(i) for i in body.ids)])
    elif body.mode == "skip":
        cmd.append("--all")
        if body.ids:
            cmd.extend(["--skip", ",".join(str(i) for i in body.ids)])
    else:
        raise HTTPException(400, f"Invalid mode: {body.mode}")

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    output = result.stdout + (result.stderr if result.stderr else "")

    # ── Push vault changes back to GitHub ─────────────────────────────────
    if vault_repo_url and vault_dir and (vault_dir / ".git").exists() and github_token:
        # Set remote URL with token for push
        subprocess.run(
            ["git", "remote", "set-url", "origin", authed_url],
            cwd=vault_dir, capture_output=True
        )
        push = subprocess.run(
            ["git", "push"],
            cwd=vault_dir, capture_output=True, text=True
        )
        if push.returncode == 0:
            output += "\n✓ Vault pushed to GitHub."
        else:
            output += f"\n⚠ Git push failed: {push.stderr.strip()}"

    return {"output": output, "applied": body.ids}


@app.get("/campaigns/{slug}/sessions/{name}/raw-transcript")
def campaign_get_raw_transcript(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    session_dir = get_sessions_dir(slug) / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")
    try:
        from merge import merge_transcripts
        raw_text = merge_transcripts(str(session_dir))
        return {"content": raw_text}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/campaigns/{slug}/sessions/{name}/corrections-report")
def campaign_corrections_report(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    sessions_dir = get_sessions_dir(slug)
    session_dir = sessions_dir / name
    transcript_path = session_dir / "transcript.md"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found")
    config = load_config(slug)
    corrections = config.get("corrections") or {}
    patterns = config.get("patterns") or []
    from merge import merge_transcripts
    raw_text = merge_transcripts(str(session_dir))
    corrected_text = transcript_path.read_text(encoding="utf-8")
    raw_lines = raw_text.splitlines()

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
                        examples.append(f"{raw_line[:120]} → {corr_line[:120]}")
            except re.error:
                pass
        corrections_applied.append({
            "original": wrong, "replacement": right,
            "hit_count": hit_count, "examples": examples,
        })
    corrections_applied.sort(key=lambda x: x["hit_count"], reverse=True)

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
                        examples.append(f"{raw_line[:120]} → {corr_line[:120]}")
            except re.error:
                pass
        patterns_applied.append({
            "original": match_pat, "replacement": replace,
            "hit_count": hit_count, "examples": examples,
        })
    patterns_applied.sort(key=lambda x: x["hit_count"], reverse=True)

    total_hits = (
        sum(c["hit_count"] for c in corrections_applied)
        + sum(p["hit_count"] for p in patterns_applied)
    )
    return {
        "corrections_applied": corrections_applied,
        "patterns_applied": patterns_applied,
        "hallucinations": [],
        "stats": {
            "total_corrections": len(corrections_applied) + len(patterns_applied),
            "total_hits": total_hits,
            "hallucination_count": 0,
        },
    }


@app.get("/campaigns/{slug}/sessions/{name}/speakers")
def campaign_get_speakers(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    path = get_sessions_dir(slug) / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    content = path.read_text(encoding="utf-8")
    line_re = re.compile(r'^\*\*\[[^\]]+\] ([^:]+):\*\*')
    speaker_counts: dict[str, int] = {}
    for line in content.splitlines():
        m = line_re.match(line)
        if m:
            spk = m.group(1).strip()
            speaker_counts[spk] = speaker_counts.get(spk, 0) + 1
    return {"speakers": [
        {"name": spk, "line_count": cnt}
        for spk, cnt in sorted(speaker_counts.items(), key=lambda x: -x[1])
    ]}


@app.post("/campaigns/{slug}/sessions/{name}/rename-speaker")
def campaign_rename_speaker(
    slug: str,
    name: str,
    body: RenameSpeakerBody,
    _member=Depends(require_campaign_member("dm")),
):
    path = get_sessions_dir(slug) / name / "transcript.md"
    if not path.exists():
        raise HTTPException(404, "Transcript not found")
    content = path.read_text(encoding="utf-8")
    old_escaped = re.escape(body.old_name)
    pattern = r'(\*\*\[[^\]]+\] )' + old_escaped + r'(:\*\*)'
    new_content, count = re.subn(
        pattern,
        lambda m: m.group(1) + body.new_name + m.group(2),
        content,
    )
    path.write_text(new_content, encoding="utf-8")
    return {"replacements": count}


@app.post("/campaigns/{slug}/sessions/{name}/merge")
def campaign_merge_session(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("dm")),
):
    session_dir = get_sessions_dir(slug) / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")
    config = load_config(slug)
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


@app.post("/campaigns/{slug}/sessions/{name}/import-corrections")
def campaign_import_corrections(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("dm")),
):
    wiki_path = get_sessions_dir(slug) / name / "wiki_suggestions.md"
    if not wiki_path.exists():
        raise HTTPException(404, "wiki_suggestions.md not found")
    content = wiki_path.read_text(encoding="utf-8")
    lines = content.splitlines()
    in_section = False
    found: list[tuple[str, str]] = []
    for line in lines:
        if re.match(r'^#+\s+.*[Pp]roper\s+[Nn]oun\s+[Cc]orrections', line):
            in_section = True
            continue
        if in_section and re.match(r'^#', line):
            break
        if in_section:
            m = re.match(r'^-\s+"([^"]+)"\s+(?:→|->)\s+"([^"]+)"', line)
            if m:
                found.append((m.group(1), m.group(2)))
    config = load_config(slug)
    corrections = dict(config.get("corrections") or {})
    imported = []
    skipped = []
    for wrong, right in found:
        if wrong in corrections:
            skipped.append({"from": wrong, "to": right})
        else:
            corrections[wrong] = right
            imported.append({"from": wrong, "to": right})
    if imported:
        config["corrections"] = corrections
        save_config(config, slug)
    return {"imported": imported, "skipped": skipped}


@app.post("/campaigns/{slug}/sessions/{name}/import-zip")
async def campaign_import_zip(
    slug: str,
    name: str,
    file: UploadFile = File(...),
    _member=Depends(require_campaign_member("dm")),
):
    sessions_dir = get_sessions_dir(slug)
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


@app.get("/campaigns/{slug}/sessions/{name}/audio-files")
def campaign_get_audio_files(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    session_dir = get_sessions_dir(slug) / name
    merged = session_dir / "merged.mp3"
    if merged.exists():
        return {"files": [{"filename": "merged.mp3", "label": "Session audio", "url": f"/campaigns/{slug}/sessions/{name}/merged-audio"}]}
    return {"files": []}


@app.get("/campaigns/{slug}/sessions/{name}/merged-audio")
def campaign_get_merged_audio(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    path = get_sessions_dir(slug) / name / "merged.mp3"
    if not path.exists():
        raise HTTPException(404, "No merged audio available")
    return FileResponse(str(path), media_type="audio/mpeg")


@app.get("/campaigns/{slug}/sessions/{name}/audio/merged")
def campaign_get_merged_audio(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
):
    raw_dir = get_sessions_dir(slug) / name / "raw"
    if not raw_dir.exists():
        raise HTTPException(404, "No audio directory found")
    audio_files = [
        f for f in sorted(raw_dir.iterdir())
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS and f.name != "_merged.mp3"
    ]
    if not audio_files:
        raise HTTPException(404, "No audio files found")
    if len(audio_files) == 1:
        return RedirectResponse(url=f"/campaigns/{slug}/sessions/{name}/audio/{audio_files[0].name}")
    merged_path = raw_dir / "_merged.mp3"
    if merged_path.exists():
        return FileResponse(str(merged_path), media_type="audio/mpeg")
    inputs: list[str] = []
    for f in audio_files:
        inputs.extend(["-i", str(f)])
    n = len(audio_files)
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", f"amix=inputs={n}:duration=longest:normalize=0",
        str(merged_path),
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise HTTPException(500, f"ffmpeg failed: {proc.stderr.decode()}")
    return FileResponse(str(merged_path), media_type="audio/mpeg")


@app.get("/campaigns/{slug}/sessions/{name}/audio/{filename}")
def campaign_get_audio_file(
    slug: str,
    name: str,
    filename: str,
    _member=Depends(require_campaign_member("spectator")),
):
    safe_filename = Path(filename).name
    path = get_sessions_dir(slug) / name / "raw" / safe_filename
    if not path.exists() or path.suffix.lower() not in AUDIO_EXTENSIONS:
        raise HTTPException(404, "Audio file not found")
    media_type = AUDIO_MIME.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(str(path), media_type=media_type)


# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/campaigns/{slug}/config")
def campaign_get_config(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
):
    return load_config(slug)


@app.put("/campaigns/{slug}/config")
def campaign_put_config(
    slug: str,
    body: ConfigBody,
    _member=Depends(require_campaign_member("dm")),
):
    save_config(body.config, slug)
    return {"ok": True}


@app.get("/campaigns/{slug}/config/corrections")
def campaign_get_corrections(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
):
    config = load_config(slug)
    return {"corrections": config.get("corrections", {})}


@app.put("/campaigns/{slug}/config/corrections")
def campaign_put_corrections(
    slug: str,
    body: CorrectionsBody,
    _member=Depends(require_campaign_member("dm")),
):
    config = load_config(slug)
    config["corrections"] = body.corrections
    save_config(config, slug)
    return {"ok": True}


@app.get("/campaigns/{slug}/config/patterns")
def campaign_get_patterns(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
):
    config = load_config(slug)
    return {"patterns": config.get("patterns", [])}


@app.put("/campaigns/{slug}/config/patterns")
def campaign_put_patterns(
    slug: str,
    body: PatternsBody,
    _member=Depends(require_campaign_member("dm")),
):
    config = load_config(slug)
    config["patterns"] = body.patterns
    save_config(config, slug)
    return {"ok": True}


@app.post("/campaigns/{slug}/config/test-correction")
def campaign_test_correction(
    slug: str,
    body: TestCorrectionBody,
    _member=Depends(require_campaign_member("spectator")),
):
    from merge import apply_corrections, apply_patterns
    original = body.text
    result = original
    if body.corrections:
        result = apply_corrections(result, body.corrections)
    if body.patterns:
        result = apply_patterns(result, body.patterns)
    if result == original:
        return {"changed": False, "result": result, "diffs": []}
    diffs = []
    orig_lines = original.splitlines()
    res_lines = result.splitlines()
    for i, (o, r) in enumerate(zip(orig_lines, res_lines)):
        if o != r:
            diffs.append({"line": i + 1, "before": o, "after": r})
    return {"changed": True, "result": result, "diffs": diffs}


@app.get("/campaigns/{slug}/config/vocab")
def campaign_get_vocab(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
):
    config = load_config(slug)
    try:
        from vocab_extractor import extract_from_vault
        vocab = extract_from_vault(config["vault_path"])
        return {"vocab": vocab}
    except Exception as e:
        return {"vocab": "", "error": str(e)}


# ── Pipeline ──────────────────────────────────────────────────────────────────

@app.post("/campaigns/{slug}/pipeline/run")
def campaign_pipeline_run(
    slug: str,
    body: PipelineRunBody,
    _member=Depends(require_campaign_member("dm")),
):
    if pipeline_state["running"]:
        raise HTTPException(409, "Pipeline already running")
    t = threading.Thread(
        target=_pipeline_thread,
        args=(body.session, body.transcribe_only, body.wiki_only, slug),
        daemon=True,
    )
    t.start()
    return {"ok": True, "session": body.session}


# ── Merge all ─────────────────────────────────────────────────────────────────

@app.post("/campaigns/{slug}/merge/all")
def campaign_merge_all(
    slug: str,
    _member=Depends(require_campaign_member("dm")),
):
    if pipeline_state["running"]:
        raise HTTPException(409, "Pipeline already running")
    pipeline_state["running"] = True
    pipeline_state["session"] = None
    pipeline_state["log"] = []
    t = threading.Thread(target=_merge_all_thread, args=(slug,), daemon=True)
    t.start()
    return {"ok": True}


# ── Edit approval queue ───────────────────────────────────────────────────────

class RejectEditBody(BaseModel):
    note: Optional[str] = None


@app.get("/campaigns/{slug}/edits")
def campaign_list_edits(
    slug: str,
    count: bool = False,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    if count:
        return {"count": crud.get_pending_edit_count(db, campaign.id)}
    edits = crud.get_pending_edits(db, campaign.id)
    return [
        {
            "id": e.id,
            "session_name": e.session_name,
            "line_number": e.line_number,
            "edit_type": "summary" if e.line_number == -2 else "wiki" if e.line_number == -3 else "transcript",
            "original_text": e.original_text,
            "proposed_text": e.proposed_text,
            "status": e.status,
            "submitted_at": e.submitted_at.isoformat(),
            "submitter_username": e.submitter.username if e.submitter else None,
            "submitter_id": e.user_id,
        }
        for e in edits
    ]


@app.post("/campaigns/{slug}/edits/{edit_id}/approve")
def campaign_approve_edit(
    slug: str,
    edit_id: int,
    _member=Depends(require_campaign_member("dm")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    edit = crud.get_transcript_edit(db, edit_id)
    if not edit or edit.campaign_id != campaign.id:
        raise HTTPException(404, "Edit not found")
    if edit.status != "pending":
        raise HTTPException(400, f"Edit is already {edit.status}")

    # Apply the edit — dispatch on line_number sentinel
    session_dir = get_sessions_dir(slug) / edit.session_name
    n = edit.line_number

    def apply_full_doc_edit(path: Path) -> None:
        """3-way merge: patch(original→proposed) applied to current file content."""
        current = path.read_text(encoding="utf-8") if path.exists() else ""
        original_lines = edit.original_text.splitlines(keepends=True)
        proposed_lines = edit.proposed_text.splitlines(keepends=True)
        current_lines = current.splitlines(keepends=True)
        # Build opcodes: what changed between original and proposed
        matcher = difflib.SequenceMatcher(None, original_lines, proposed_lines)
        result = list(current_lines)
        offset = 0
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            # Find these original lines in current (may have shifted due to prior edits)
            # Simple strategy: apply the diff relative to current, best-effort
            if tag == "replace":
                result[i1 + offset:i2 + offset] = proposed_lines[j1:j2]
                offset += (j2 - j1) - (i2 - i1)
            elif tag == "insert":
                result[i1 + offset:i1 + offset] = proposed_lines[j1:j2]
                offset += j2 - j1
            elif tag == "delete":
                del result[i1 + offset:i2 + offset]
                offset -= i2 - i1
        path.write_text("".join(result), encoding="utf-8")

    if n == -2:
        path = session_dir / "summary.md"
        if path.exists():
            apply_full_doc_edit(path)
    elif n == -3:
        path = None
        for filename in ("wiki_suggestions.md", "wiki.md"):
            candidate = session_dir / filename
            if candidate.exists():
                path = candidate
                break
        if path:
            apply_full_doc_edit(path)
    else:
        # Transcript line edit
        path = session_dir / "transcript.md"
        if not path.exists():
            raise HTTPException(404, "Transcript not found")
        lines = path.read_text(encoding="utf-8").splitlines()
        if 1 <= n <= len(lines):
            lines[n - 1] = edit.proposed_text
            path.write_text("\n".join(lines), encoding="utf-8")

    reviewer_id = current_user.id if current_user else 0
    edit = crud.approve_edit(db, edit, reviewer_id)
    return {"id": edit.id, "status": edit.status}


@app.post("/campaigns/{slug}/edits/{edit_id}/reject")
def campaign_reject_edit(
    slug: str,
    edit_id: int,
    body: RejectEditBody,
    _member=Depends(require_campaign_member("dm")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    edit = crud.get_transcript_edit(db, edit_id)
    if not edit or edit.campaign_id != campaign.id:
        raise HTTPException(404, "Edit not found")
    if edit.status != "pending":
        raise HTTPException(400, f"Edit is already {edit.status}")
    reviewer_id = current_user.id if current_user else 0
    edit = crud.reject_edit(db, edit, reviewer_id, body.note)
    return {"id": edit.id, "status": edit.status}


# ─── Worker / Transcription Jobs ──────────────────────────────────────────────

def _job_dict(job: TranscriptionJob) -> dict:
    return {
        "session_name": job.session_name,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "claimed_at": job.claimed_at.isoformat() if job.claimed_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }


@app.post("/campaigns/{slug}/sessions/{name}/transcribe")
def request_transcription(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("player")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    job = crud.get_job(db, campaign.id, name)
    if job:
        if job.status in ("done", "error", "claimed"):
            job = crud.reset_job(db, job)
        else:
            raise HTTPException(409, {"detail": "job already pending", "status": job.status})
    else:
        created_by = current_user.id if current_user else 0
        job = crud.create_transcription_job(db, campaign.id, name, created_by)
    return _job_dict(job)


@app.get("/campaigns/{slug}/sessions/{name}/transcribe")
def get_transcription_status(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("spectator")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    job = crud.get_job(db, campaign.id, name)
    return {"job": _job_dict(job) if job else None}


@app.get("/campaigns/{slug}/worker/jobs/all")
def get_all_jobs(
    slug: str,
    _member=Depends(require_campaign_member("spectator")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    jobs = crud.get_all_jobs(db, campaign.id)
    return [_job_dict(j) for j in jobs]


@app.get("/worker/whoami")
def worker_whoami(request: Request, db: Session = Depends(get_db)):
    """
    Identify which campaign an API key belongs to.
    Allows workers to omit campaign_slug from worker.yaml — just provide the api_key.
    Returns: {campaign_slug, campaign_name}
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing worker API key")
    token = auth_header[7:]
    # Search all campaigns for a matching worker_api_key
    from db.models import Campaign
    campaigns = db.query(Campaign).all()
    for campaign in campaigns:
        stored_key = (campaign.settings or {}).get("worker_api_key")
        if stored_key and token == stored_key:
            return {"campaign_slug": campaign.slug, "campaign_name": campaign.name}
    raise HTTPException(403, "Invalid worker API key — no campaign found for this key")


@app.post("/campaigns/{slug}/worker-key")
def generate_worker_key(
    slug: str,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    import secrets as _secrets
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    key = _secrets.token_urlsafe(32)
    crud.update_campaign_settings(db, campaign, {"worker_api_key": key})
    return {"api_key": key}


@app.get("/campaigns/{slug}/worker-key")
def get_worker_key(
    slug: str,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    settings = campaign.settings or {}
    key = settings.get("worker_api_key")
    last_seen = settings.get("worker_last_seen")
    return {"api_key": key, "last_seen": last_seen}


# Worker-facing endpoints (API key auth)

@app.get("/campaigns/{slug}/worker/jobs")
def worker_list_pending_jobs(slug: str, db: Session = Depends(get_db), request: Request = None):
    campaign = require_worker_key(slug)(request, db)
    jobs = crud.get_pending_jobs(db, campaign.id)
    return [_job_dict(j) for j in jobs]


@app.post("/campaigns/{slug}/worker/jobs/{session_name}/claim")
def worker_claim_job(slug: str, session_name: str, db: Session = Depends(get_db), request: Request = None):
    campaign = require_worker_key(slug)(request, db)
    job = crud.get_job(db, campaign.id, session_name)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "pending":
        raise HTTPException(409, f"Job is {job.status}, not pending")
    job = crud.claim_job(db, job)
    return _job_dict(job)


class TranscriptUploadBody(BaseModel):
    transcript: str


@app.post("/campaigns/{slug}/worker/sessions/{session_name}/transcript")
def worker_push_transcript(
    slug: str, session_name: str, body: TranscriptUploadBody,
    db: Session = Depends(get_db), request: Request = None,
):
    campaign = require_worker_key(slug)(request, db)
    session_dir = BASE_DIR / "campaigns" / slug / "sessions" / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "transcript.md").write_text(body.transcript, encoding="utf-8")
    job = crud.get_job(db, campaign.id, session_name)
    if job:
        crud.complete_job(db, job)
    return {"ok": True}


@app.post("/campaigns/{slug}/worker/sessions/{session_name}/audio")
async def worker_push_audio(
    slug: str, session_name: str, file: UploadFile = File(...),
    db: Session = Depends(get_db), request: Request = None,
):
    require_worker_key(slug)(request, db)
    session_dir = BASE_DIR / "campaigns" / slug / "sessions" / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    # Always store as merged.mp3 regardless of uploaded filename
    dest = session_dir / "merged.mp3"
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True}


class WorkerErrorBody(BaseModel):
    error: str


@app.post("/campaigns/{slug}/worker/jobs/{session_name}/error")
def worker_report_error(
    slug: str, session_name: str, body: WorkerErrorBody,
    db: Session = Depends(get_db), request: Request = None,
):
    campaign = require_worker_key(slug)(request, db)
    job = crud.get_job(db, campaign.id, session_name)
    if not job:
        raise HTTPException(404, "Job not found")
    crud.fail_job(db, job, body.error)
    return {"ok": True}


@app.post("/campaigns/{slug}/worker/heartbeat")
def worker_heartbeat(slug: str, db: Session = Depends(get_db), request: Request = None):
    from datetime import datetime as dt, timezone
    campaign = require_worker_key(slug)(request, db)
    now = dt.now(timezone.utc).isoformat()
    crud.update_campaign_settings(db, campaign, {"worker_last_seen": now})
    return {"ok": True}


@app.get("/campaigns/{slug}/worker/config")
def worker_get_config(slug: str, db: Session = Depends(get_db), request: Request = None):
    """Return campaign config (players, corrections, vocab prompt, vad setting) for the worker."""
    require_worker_key(slug)(request, db)
    config = load_config(slug)
    return {
        "players": config.get("players", {}),
        "corrections": config.get("corrections", {}),
        "patterns": config.get("patterns", []),
        "vocab_prompt": config.get("vocab_prompt", ""),
        "vad": config.get("vad", True),
        "whisper_model": config.get("whisper_model", "turbo"),
    }


# ─── Session sharing ──────────────────────────────────────────────────────────

class CreateShareBody(BaseModel):
    show_transcript: bool = True
    show_summary: bool = True
    show_wiki: bool = True
    expires_hours: Optional[int] = None  # None = never expires


@app.post("/campaigns/{slug}/sessions/{name}/shares", status_code=201)
def create_share(
    slug: str,
    name: str,
    body: CreateShareBody,
    member=Depends(require_campaign_member("dm")),
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    session_dir = get_sessions_dir(slug) / name
    if not session_dir.exists():
        raise HTTPException(404, "Session not found")

    expires_at = None
    if body.expires_hours:
        from datetime import timedelta
        expires_at = datetime.utcnow() + timedelta(hours=body.expires_hours)

    user_id = current_user.id if current_user else member.user_id if member else 0
    share = crud.create_session_share(
        db,
        campaign_id=campaign.id,
        session_name=name,
        created_by=user_id,
        show_transcript=body.show_transcript,
        show_summary=body.show_summary,
        show_wiki=body.show_wiki,
        expires_at=expires_at,
    )
    return {
        "token": share.token,
        "url": f"/share/{share.token}",
        "created_at": share.created_at.isoformat(),
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        "show_transcript": share.show_transcript,
        "show_summary": share.show_summary,
        "show_wiki": share.show_wiki,
    }


@app.get("/campaigns/{slug}/sessions/{name}/shares")
def list_shares(
    slug: str,
    name: str,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    campaign = crud.get_campaign_by_slug(db, slug)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    shares = crud.get_session_shares(db, campaign.id, name)
    now = datetime.utcnow()
    return [
        {
            "token": s.token,
            "url": f"/share/{s.token}",
            "created_at": s.created_at.isoformat(),
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "expired": bool(s.expires_at and s.expires_at < now),
            "show_transcript": s.show_transcript,
            "show_summary": s.show_summary,
            "show_wiki": s.show_wiki,
        }
        for s in shares
    ]


@app.delete("/campaigns/{slug}/sessions/{name}/shares/{token}", status_code=204)
def delete_share(
    slug: str,
    name: str,
    token: str,
    _member=Depends(require_campaign_member("dm")),
    db: Session = Depends(get_db),
):
    share = crud.get_share_by_token(db, token)
    if not share or share.session_name != name:
        raise HTTPException(404, "Share not found")
    crud.delete_share(db, share)


# ─── Static frontend (SPA catch-all) ─────────────────────────────────────────
# Serves built React app. Any path not matched by API routes returns index.html
# so that client-side routing (e.g. /sessions/foo, /campaigns/bar) works on reload.

gui_dist = APP_DIR / "gui" / "dist"

if gui_dist.exists():
    # Mount static assets (JS/CSS/images) under /assets explicitly
    app.mount("/assets", StaticFiles(directory=str(gui_dist / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        # Serve exact file if it exists (favicon, manifest, etc.)
        candidate = gui_dist / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        # Fall back to index.html for all client-side routes
        return FileResponse(str(gui_dist / "index.html"))
