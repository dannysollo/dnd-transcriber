"""
worker/main.py — DnD Transcriber worker daemon.

Runs both the transcription poll loop and the Craig Watcher in a single process.
The Discord client owns the async event loop; the poll loop runs in a background thread.

Usage:
    python worker/main.py
    python worker/main.py --config /path/to/worker.yaml

Craig Watcher is enabled automatically when `discord_token` is present in worker.yaml.
"""
import argparse
import asyncio
import collections
import io
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zipfile
from pathlib import Path


# ─── Log ring buffer & stdout tee ────────────────────────────────────────────

class LogRingBuffer:
    """Thread-safe ring buffer for log lines."""

    def __init__(self, maxlen: int = 500):
        self._buf: collections.deque = collections.deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def append(self, line: str):
        with self._lock:
            self._buf.append(line)

    def __iter__(self):
        with self._lock:
            return iter(list(self._buf))

    def __len__(self):
        with self._lock:
            return len(self._buf)


class TeeStream:
    """Write to both real stdout and a LogRingBuffer, line by line."""

    def __init__(self, real_stream, ring_buffer: LogRingBuffer):
        self._real = real_stream
        self._ring = ring_buffer
        self._partial = ""
        self.encoding = getattr(real_stream, "encoding", "utf-8")
        self.errors = getattr(real_stream, "errors", "replace")

    def write(self, text: str):
        self._real.write(text)
        self._partial += text
        while "\n" in self._partial:
            line, self._partial = self._partial.split("\n", 1)
            ts = time.strftime("%H:%M:%S")
            self._ring.append(f"[{ts}] {line}")

    def flush(self):
        self._real.flush()

    def fileno(self):
        return self._real.fileno()

    def isatty(self):
        return getattr(self._real, "isatty", lambda: False)()

# Allow running as `python worker/main.py` from repo root
sys.path.insert(0, str(Path(__file__).parent))

from client import WorkerClient
from config import load_config
from audio import find_audio_files, merge_audio_files
from transcribe import load_whisper_model, transcribe_session

import requests

# ─── Craig Watcher constants ──────────────────────────────────────────────────

CRAIG_USER_ID = 272937604339466240


# ─── Poll loop (runs in a background thread) ─────────────────────────────────

def poll_loop(config: dict, stop_event: threading.Event):
    """Synchronous transcription poll loop — runs in a background thread."""
    client = WorkerClient(config)
    whisper_model = None
    heartbeat_counter = 0

    try:
        client.heartbeat()
        print("[worker] Heartbeat sent.")
    except Exception as e:
        print(f"[worker] Warning: initial heartbeat failed: {e}")

    while not stop_event.is_set():
        try:
            jobs = client.get_pending_jobs()
        except Exception as e:
            print(f"[worker] Error fetching jobs: {e}")
            stop_event.wait(config["poll_interval"])
            continue

        for job in jobs:
            if stop_event.is_set():
                break
            session_name = job["session_name"]
            session_dir = Path(config["audio_dir"]) / session_name

            print(f"\n[worker] [JOB] {session_name}")

            try:
                claimed = client.claim_job(session_name)
                if claimed is None:
                    print(f"[worker]   Job for {session_name} was cancelled or already claimed — skipping.")
                    continue
                print(f"[worker]   Claimed job.")

                if not session_dir.exists():
                    client.report_error(session_name, f"Session directory not found: {session_dir}")
                    print(f"[worker]   [ERROR] Session dir not found: {session_dir}")
                    continue

                audio_files = find_audio_files(session_dir)
                if not audio_files:
                    client.report_error(session_name, f"No audio files found in {session_dir}")
                    print(f"[worker]   [ERROR] No audio files in {session_dir}")
                    continue

                print(f"[worker]   {len(audio_files)} audio file(s) found.")

                campaign_config = client.get_campaign_config()
                # Merge local-only keys (worker machine credentials/settings) into job config
                LOCAL_KEYS = ("whisper_model", "hf_token", "diarize_tracks", "diarize_all", "diarize_speakers")
                job_config = {**campaign_config, **{
                    k: config[k] for k in LOCAL_KEYS if k in config
                }}

                model_name = job_config.get("whisper_model", "turbo")
                if whisper_model is None or getattr(whisper_model, "_model_name", None) != model_name:
                    if model_name == "parakeet":
                        from parakeet_utils import load_parakeet_model
                        whisper_model = load_parakeet_model()
                    else:
                        whisper_model = load_whisper_model(model_name)
                    whisper_model._model_name = model_name

                transcript = transcribe_session(session_dir, whisper_model, job_config)

                print(f"[worker]   Pushing transcript...")
                client.push_transcript(session_name, transcript)

                with tempfile.NamedTemporaryFile(suffix="_merged.mp3", delete=False) as tmp:
                    merged_path = tmp.name
                print(f"[worker]   Merging audio...")
                merge_audio_files(audio_files, merged_path)
                print(f"[worker]   Pushing audio...")
                client.push_audio(session_name, merged_path)
                Path(merged_path).unlink(missing_ok=True)

                print(f"[worker]   [DONE] {session_name}")

            except Exception as e:
                print(f"[worker]   [ERROR] {session_name}: {e}")
                print(traceback.format_exc())
                try:
                    client.report_error(session_name, str(e))
                except Exception as report_err:
                    print(f"[worker]   Failed to report error: {report_err}")
                # Free any stale CUDA allocations so the next job can load the model clean
                try:
                    import gc, torch
                    whisper_model = None
                    gc.collect()
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                        torch.cuda.synchronize()
                        print(f"[worker]   CUDA cache cleared after error.")
                except Exception:
                    pass

        heartbeat_counter += 1
        if heartbeat_counter >= 5:
            try:
                client.heartbeat()
            except Exception as e:
                print(f"[worker] Heartbeat failed: {e}")
            heartbeat_counter = 0

        stop_event.wait(config["poll_interval"])

    print("[worker] Poll loop stopped.")


# ─── Analysis poll loop ──────────────────────────────────────────────────────

ANALYZE_SESSION_MD = Path.home() / ".openclaw" / "workspace" / "ANALYZE_SESSION.md"
CAMPAIGN_VAULT = Path.home() / ".openclaw" / "workspace" / "campaign-vault"

WIKI_ONLY_PROMPT_OVERRIDE = """
**WIKI-ONLY RUN**: Skip sections 0 (Blurb), 1 (Session Summary), and any proper noun corrections.
Output ONLY sections 2 (Wiki Update Suggestions), 3 (Index Update), and 4 (Proper Noun Corrections).
Start your response directly with ## [1] for the first wiki suggestion.
"""


def run_analysis(transcript: str, config: dict, notes: str = "", wiki_only: bool = False) -> tuple[str, str, str]:
    """
    Run analysis via `claude -p` with ANALYZE_SESSION.md as the system prompt.
    Runs from /tmp so no CLAUDE.md is auto-loaded. Vault path passed explicitly.
    Returns (summary, wiki, blurb) strings. When wiki_only=True, summary and blurb are empty.
    """
    if not ANALYZE_SESSION_MD.exists():
        raise RuntimeError(f"ANALYZE_SESSION.md not found at {ANALYZE_SESSION_MD}")

    system_prompt = ANALYZE_SESSION_MD.read_text(encoding="utf-8")
    # Patch the vault path reference so the agent can find it by absolute path
    system_prompt = system_prompt.replace(
        "../campaign-vault/", str(CAMPAIGN_VAULT) + "/"
    )

    # Inject existing vault page index so Claude knows exactly what already exists
    # and doesn't suggest NEW PAGE for pages that are already there.
    vault_pages = sorted(
        p.relative_to(CAMPAIGN_VAULT)
        for p in CAMPAIGN_VAULT.rglob("*.md")
        if "campaign-site" not in p.parts and p.name != "README.md"
    )
    vault_index_block = "\n## Existing Vault Pages\n\nThe following pages already exist in the vault. " \
        "Use their exact paths for wiki update suggestions — do NOT suggest NEW PAGE for any of these:\n\n"
    vault_index_block += "\n".join(f"- {p}" for p in vault_pages)
    system_prompt = system_prompt + "\n\n" + vault_index_block

    if wiki_only:
        system_prompt = system_prompt + "\n\n" + WIKI_ONLY_PROMPT_OVERRIDE

    message = transcript
    if notes and notes.strip():
        message = f"## DM Notes for this session\n{notes.strip()}\n\n---\n\n{transcript}"

    result = subprocess.run(
        ["claude", "-p",
         "--system-prompt", system_prompt,
         "--no-session-persistence",
         "--allowedTools", "Read",
         "--output-format", "text"],
        input=message,
        stdout=subprocess.PIPE,
        stderr=None,  # let stderr flow to worker's console so errors are visible
        text=True,
        timeout=600,
        cwd="/tmp",
    )

    if result.returncode != 0:
        raise RuntimeError(f"claude -p failed (code {result.returncode})")

    full_text = result.stdout.strip()
    if not full_text:
        raise RuntimeError("claude -p returned empty output")

    # Strip any conversational preamble before the first ## heading
    first_heading = re.search(r'^##', full_text, re.MULTILINE)
    if first_heading and first_heading.start() > 0:
        full_text = full_text[first_heading.start():].strip()

    # Extract blurb block
    blurb = ""
    blurb_match = re.search(r'BLURB_START\s*(.*?)\s*BLURB_END', full_text, re.DOTALL)
    if blurb_match:
        blurb = blurb_match.group(1).strip()
        # Remove blurb block from full_text before splitting summary/wiki
        full_text = (full_text[:blurb_match.start()] + full_text[blurb_match.end():]).strip()

    # Split on first ## [1] wiki block
    wiki_marker = re.search(r'^## \[1\]', full_text, re.MULTILINE)
    if wiki_marker:
        summary = full_text[:wiki_marker.start()].strip()
        wiki = full_text[wiki_marker.start():].strip()
    else:
        summary = full_text.strip()
        wiki = ""

    return summary, wiki, blurb


def analysis_poll_loop(config: dict, stop_event: threading.Event):
    """Poll for pending analysis jobs and run them via openclaw agent --local."""
    client = WorkerClient(config)
    poll_interval = config.get("analysis_poll_interval", config.get("poll_interval", 30))

    print("[analysis] Poll loop started.")

    while not stop_event.is_set():
        try:
            jobs = client.get_pending_analysis_jobs()
        except Exception as e:
            print(f"[analysis] Error fetching jobs: {e}")
            stop_event.wait(poll_interval)
            continue

        for job in jobs:
            if stop_event.is_set():
                break

            session_name = job["session_name"]
            transcript = job.get("transcript", "")

            if not transcript.strip():
                print(f"[analysis] {session_name}: empty transcript — skipping.")
                continue

            notes = job.get("notes", "")
            wiki_only = job.get("wiki_only", False)
            mode_label = " (wiki only)" if wiki_only else (" (with notes)" if notes.strip() else "")
            print(f"\n[analysis] [JOB] {session_name}{mode_label}")
            try:
                summary, wiki, blurb = run_analysis(transcript, config, notes, wiki_only=wiki_only)
                client.push_analysis_result(session_name, summary, wiki, blurb, wiki_only=wiki_only)
                parts = []
                if blurb and not wiki_only: parts.append("blurb")
                if summary and not wiki_only: parts.append("summary")
                if wiki: parts.append("wiki")
                print(f"[analysis]   [DONE] {session_name} — wrote: {', '.join(parts) or 'nothing'}")
            except Exception as e:
                print(f"[analysis]   [ERROR] {session_name}: {e}")
                # Don't leave flag in place — remove so it doesn't loop forever
                # (user can re-trigger from the UI)
                try:
                    client.push_analysis_result(session_name, "", "", "")
                except Exception:
                    pass

        stop_event.wait(poll_interval)

    print("[analysis] Poll loop stopped.")


# ─── Craig Watcher helpers ────────────────────────────────────────────────────

def extract_craig_url(message) -> str | None:
    """Extract download URL from Craig's DM button components or message content."""
    for component in message.components:
        children = getattr(component, "children", [component])
        for child in children:
            url = getattr(child, "url", None)
            if url and ("craig.horse/rec/" in url or "craig.chat/rec/" in url):
                return url

    patterns = [
        r"https://craig\.horse/rec/[A-Za-z0-9]+\?key=[A-Za-z0-9]+",
        r"https://craig\.chat/rec/[A-Za-z0-9]+\?key=[A-Za-z0-9]+",
    ]
    for pattern in patterns:
        m = re.search(pattern, message.content or "")
        if m:
            return m.group(0)
        for embed in message.embeds:
            text = (embed.description or "") + (embed.title or "")
            m = re.search(pattern, text)
            if m:
                return m.group(0)
    return None


def extract_recording_id(message) -> str | None:
    """Extract Recording ID from Craig's DM text."""
    m = re.search(r"\*\*Recording ID:\*\*\s*`([A-Za-z0-9]+)`", message.content or "")
    if m:
        return m.group(1)
    url = extract_craig_url(message)
    if url:
        m = re.search(r"/rec/([A-Za-z0-9]+)", url)
        if m:
            return m.group(1)
    return None


def extract_guild_id(message) -> str | None:
    m = re.search(r"\((\d{17,20})\)", message.content or "")
    return m.group(1) if m else None


def make_session_name(config: dict, recording_id: str, message) -> str:
    fmt = config.get("session_name_format", "{date}")
    from datetime import datetime, timezone
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    channel_match = re.search(r"\*\*Channel:\*\*.*?\(([^)]+)\)\s*\(", message.content or "")
    channel_raw = channel_match.group(1).strip() if channel_match else "session"
    channel_name = re.sub(r"[^a-zA-Z0-9_-]", "-", channel_raw)[:30].strip("-")
    return (fmt
            .replace("{date}", date_str)
            .replace("{channel}", channel_name)
            .replace("{recording_id}", recording_id))


def download_and_queue(config: dict, url: str, session_name: str):
    """Download Craig zip, extract FLACs, create session, queue job."""
    audio_dir = Path(config["audio_dir"]) / session_name
    audio_dir.mkdir(parents=True, exist_ok=True)

    # Build FLAC zip download URL
    # Craig's download page URL has ?key=... — append format/container params
    if "?" in url:
        dl_url = url + "&format=flac&container=zip"
    else:
        dl_url = url + "?format=flac&container=zip"

    print(f"[craig] Downloading: {dl_url}")
    r = requests.get(dl_url, timeout=300, stream=True)
    if r.status_code == 404:
        raise RuntimeError("Recording not found or expired (404).")
    if r.status_code == 403:
        raise RuntimeError("Access denied — invalid key (403).")
    r.raise_for_status()

    content_type = r.headers.get("content-type", "")
    if "zip" not in content_type and "octet-stream" not in content_type:
        raise RuntimeError(f"Unexpected content type: {content_type} — link may be expired or format unsupported.")

    extracted = []
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        for name in zf.namelist():
            if name.lower().endswith((".flac", ".ogg", ".wav", ".m4a", ".mp3")):
                out_path = audio_dir / Path(name).name
                with zf.open(name) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())
                extracted.append(out_path)
                print(f"[craig]   Extracted: {out_path.name}")

    if not extracted:
        raise RuntimeError("ZIP contained no audio files.")

    # Create session + queue transcription
    base = config["server_url"]
    slug = config["campaign_slug"]
    headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}

    r = requests.post(f"{base}/campaigns/{slug}/sessions", headers=headers,
                      json={"name": session_name}, timeout=30)
    if r.status_code == 201:
        print(f"[craig]   Created session: {session_name}")
    elif r.status_code == 400:
        print(f"[craig]   Session already exists: {session_name}")
    else:
        r.raise_for_status()

    r = requests.post(f"{base}/campaigns/{slug}/sessions/{session_name}/transcribe",
                      headers=headers, timeout=30)
    if r.status_code == 409:
        print(f"[craig]   Transcription already queued.")
    elif r.ok:
        print(f"[craig]   Transcription job queued.")
    else:
        print(f"[craig]   Warning: failed to queue transcription: {r.status_code}")


# ─── Discord client (Craig Watcher) ──────────────────────────────────────────

def build_discord_client(config: dict, stop_event: threading.Event):
    try:
        import discord
    except ImportError:
        print("[craig] discord.py-self not installed — Craig Watcher disabled.")
        print("[craig] Run: pip install discord.py-self")
        return None

    guild_filter = set(config.get("craig_channel_filter") or [])

    client = discord.Client()

    @client.event
    async def on_ready():
        print(f"[craig] Watcher ready. Logged in as {client.user}")
        print(f"[craig] Watching for DMs from Craig (ID: {CRAIG_USER_ID})")
        if guild_filter:
            print(f"[craig] Guild filter: {guild_filter}")

    @client.event
    async def on_message(message):
        if not isinstance(message.channel, discord.DMChannel):
            return
        if message.author.id != CRAIG_USER_ID:
            return

        print(f"\n[craig] DM received at {message.created_at.strftime('%H:%M:%S')} UTC")

        if guild_filter:
            guild_id = extract_guild_id(message)
            if guild_id and guild_id not in guild_filter:
                print(f"[craig] Skipping — guild {guild_id} not in filter.")
                return

        recording_id = extract_recording_id(message)
        if not recording_id:
            print("[craig] Could not extract recording ID — skipping.")
            return

        url = extract_craig_url(message)
        if not url:
            print("[craig] Could not find download URL in message components.")
            print("[craig] Tip: ensure Craig can send interactive components in DMs.")
            return

        session_name = make_session_name(config, recording_id, message)
        print(f"[craig] Recording ID: {recording_id} → session: {session_name}")

        try:
            await asyncio.to_thread(download_and_queue, config, url, session_name)
            print(f"[craig] ✓ Done — '{session_name}' queued for transcription.")
        except Exception as e:
            print(f"[craig] ERROR: {e}")

    return client


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DnD Transcriber Worker")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "worker.yaml"),
        help="Path to worker.yaml",
    )
    args = parser.parse_args()

    # ── Set up log ring buffer + tee stdout ──────────────────────────────────
    start_time = time.time()
    log_ring = LogRingBuffer(maxlen=500)
    sys.stdout = TeeStream(sys.__stdout__, log_ring)
    sys.stderr = TeeStream(sys.__stderr__, log_ring)

    config = load_config(args.config)

    # Set HF_TOKEN from config so faster-whisper can download models
    if config.get("hf_token"):
        os.environ.setdefault("HF_TOKEN", config["hf_token"])

    print("=" * 60)
    print("DnD Transcriber Worker")
    print(f"  Server:   {config['server_url']}")
    print(f"  Campaign: {config['campaign_slug']}")
    print(f"  Audio:    {config['audio_dir']}")
    print(f"  Model:    {config.get('whisper_model', '(from campaign settings)')}")
    print(f"  Poll:     every {config['poll_interval']}s")
    craig_enabled = bool(config.get("discord_token"))
    print(f"  Craig Watcher: {'enabled' if craig_enabled else 'disabled (no discord_token)'}")
    print("=" * 60)

    # ── Start GUI server ─────────────────────────────────────────────────────
    try:
        import gui_server
        gui_server.init(log_ring, config, args.config, start_time)
        gui_thread = threading.Thread(
            target=gui_server.run_server,
            kwargs={"port": 8788},
            daemon=True,
            name="gui-server",
        )
        gui_thread.start()
        print("[gui] Dashboard at http://localhost:8788")
    except ImportError as e:
        print(f"[gui] Warning: could not start GUI server (Flask missing?): {e}")
    except Exception as e:
        print(f"[gui] Warning: GUI server failed to start: {e}")

    stop_event = threading.Event()

    # Start transcription poll loop in background thread
    poll_thread = threading.Thread(target=poll_loop, args=(config, stop_event), daemon=True)
    poll_thread.start()

    # Start analysis poll loop in background thread
    analysis_thread = threading.Thread(target=analysis_poll_loop, args=(config, stop_event), daemon=True)
    analysis_thread.start()

    if craig_enabled:
        # Discord client owns the main thread's event loop
        discord_client = build_discord_client(config, stop_event)
        if discord_client:
            try:
                discord_client.run(config["discord_token"])
            except KeyboardInterrupt:
                pass
            finally:
                stop_event.set()
        else:
            # discord.py-self not installed — just run poll loop in foreground
            _run_poll_only(stop_event)
    else:
        # No Discord token — run poll loop in foreground
        _run_poll_only(stop_event)

    poll_thread.join(timeout=5)
    print("Worker stopped.")


def _run_poll_only(stop_event: threading.Event):
    """Block the main thread until Ctrl+C when Craig Watcher is disabled."""
    try:
        while not stop_event.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        stop_event.set()


if __name__ == "__main__":
    main()
