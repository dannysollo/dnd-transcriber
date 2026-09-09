"""
worker/main.py — DnD Transcriber worker daemon.

Runs the transcription poll loop and the analysis poll loop as background
threads, blocking the main thread until stopped.

Usage:
    python worker/main.py
    python worker/main.py --config /path/to/worker.yaml
"""
import argparse
import collections
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path

WORKER_VERSION = "1.0.0"

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
                # Merge local-only keys (worker machine credentials/settings) into job config.
                # use_hotwords is here (not on the campaign config server-side) because
                # /worker/config only forwards a fixed whitelist of fields (server.py
                # worker_get_config) — adding it there would need a server deploy. It's a
                # worker-side transcription-strategy detail anyway, same category as
                # whisper_model, which is already overridden locally for this reason.
                LOCAL_KEYS = ("whisper_model", "use_hotwords", "hf_token", "diarize_tracks", "diarize_all", "diarize_speakers")
                job_config = {**campaign_config, **{
                    k: config[k] for k in LOCAL_KEYS if k in config
                }}

                model_name = job_config.get("whisper_model", "turbo")
                if whisper_model is None or getattr(whisper_model, "_model_name", None) != model_name:
                    if model_name in ("canary-1b-flash", "canary-1b"):
                        from canary_utils import load_canary_model
                        whisper_model = load_canary_model(model_name)
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

ANALYZE_SESSION_MD = Path(__file__).parent.parent / "ANALYZE_SESSION.md"
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
    header_re = re.compile(r'^#{2,}\s+(.+)', re.MULTILINE)
    vault_pages = []
    subsections: list[tuple[str, str]] = []  # (display_name, relative_path)
    for p in sorted(CAMPAIGN_VAULT.rglob("*.md")):
        if "campaign-site" in p.parts or p.name == "README.md":
            continue
        rel = p.relative_to(CAMPAIGN_VAULT)
        vault_pages.append((p.stem, rel))
        # Scan section headers to catch subsection names (e.g. "## Shilu (Undercity)")
        try:
            text = p.read_text(encoding="utf-8")
            for m in header_re.finditer(text):
                raw = m.group(1).strip()
                # Strip markdown formatting and grab the name before any parenthetical
                clean = re.sub(r'[*_`\[\]]', '', raw).strip()
                name = re.split(r'\s*[\(\|]', clean)[0].strip()
                if name and name != p.stem:
                    subsections.append((name, str(rel)))
        except Exception:
            pass

    vault_index_block = (
        "\n## Existing Vault Pages\n\n"
        "**CRITICAL: The following pages already exist in the vault. "
        "You MUST NOT suggest `NEW PAGE` for any entity whose name matches a page or subsection below. "
        "If a character, location, or item you want to write about appears here, "
        "use `Page: <path>` for a regular update instead.**\n\n"
    )
    vault_index_block += "\n".join(f"- **{stem}** → {rel}" for stem, rel in vault_pages)
    if subsections:
        vault_index_block += (
            "\n\n**Known subsections within existing pages "
            "(do NOT create a NEW PAGE for any of these — update the parent page instead):**\n"
        )
        vault_index_block += "\n".join(
            f"- **{name}** → (section in {path})" for name, path in sorted(subsections)
        )
    vault_index_block += (
        "\n\n**Match by the bold name. "
        "If the name appears in either list above, it is already documented — do NOT use NEW PAGE for it.**"
    )
    system_prompt = system_prompt + "\n\n" + vault_index_block

    if wiki_only:
        system_prompt = system_prompt + "\n\n" + WIKI_ONLY_PROMPT_OVERRIDE

    message = transcript
    if notes and notes.strip():
        message = f"## DM Notes for this session\n{notes.strip()}\n\n---\n\n{transcript}"

    print(f"[analysis] system prompt: {len(system_prompt)} chars, message: {len(message)} chars")
    result = subprocess.run(
        ["claude", "-p",
         "--system-prompt", system_prompt,
         "--no-session-persistence",
         "--allowedTools", "Read",
         "--output-format", "text"],
        input=message,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,  # capture so we can include in error messages
        text=True,
        timeout=1200,
        cwd="/tmp",
    )

    if result.stderr:
        print(f"[analysis] claude stderr:\n{result.stderr.strip()}")
    if result.stdout and result.returncode != 0:
        print(f"[analysis] claude stdout (on error):\n{result.stdout[:500]}")

    if result.returncode != 0:
        stderr_snippet = (result.stderr or "").strip()[-1000:] if result.stderr else "(empty)"
        stdout_snippet = (result.stdout or "").strip()[:200] if result.stdout else "(empty)"
        raise RuntimeError(
            f"claude -p failed (code {result.returncode})\n"
            f"  stderr: {stderr_snippet}\n"
            f"  stdout: {stdout_snippet}"
        )

    full_text = result.stdout.strip()
    if not full_text:
        raise RuntimeError("claude -p returned empty output")

    # Strip any conversational preamble before the real content starts.
    # Full analysis starts with "**TL;DR**" (not a ## heading, since the summary
    # section never uses one) — anchoring on the first ## heading here would
    # treat "## Wiki Update Suggestions" itself as the start and delete the
    # entire summary whenever Claude doesn't add its own extra heading above it.
    if wiki_only:
        first_marker = re.search(r'^##', full_text, re.MULTILINE)
    else:
        first_marker = re.search(r'^\*\*TL;DR\*\*', full_text, re.MULTILINE)
        if not first_marker:
            first_marker = re.search(r'^##', full_text, re.MULTILINE)
    if first_marker and first_marker.start() > 0:
        full_text = full_text[first_marker.start():].strip()

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


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DnD Transcriber Worker")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "worker.yaml"),
        help="Path to worker.yaml",
    )
    parser.add_argument(
        "--push-audio",
        metavar="SESSION_NAME",
        help="Re-push audio for a session without re-transcribing. Merges raw files and uploads.",
    )
    args = parser.parse_args()

    # ── Set up log ring buffer + tee stdout ──────────────────────────────────
    start_time = time.time()
    log_ring = LogRingBuffer(maxlen=500)
    sys.stdout = TeeStream(sys.__stdout__, log_ring)
    sys.stderr = TeeStream(sys.__stderr__, log_ring)

    config = load_config(args.config)

    # ── One-shot audio push mode ─────────────────────────────────────────────
    if args.push_audio:
        session_name = args.push_audio
        session_dir = Path(config["audio_dir"]) / session_name
        print(f"[worker] --push-audio: {session_name}")
        if not session_dir.exists():
            print(f"[worker] [ERROR] Session directory not found: {session_dir}")
            sys.exit(1)
        audio_files = find_audio_files(session_dir)
        if not audio_files:
            print(f"[worker] [ERROR] No audio files found in {session_dir}")
            sys.exit(1)
        print(f"[worker] {len(audio_files)} audio file(s) found.")
        client = WorkerClient(config)
        with tempfile.NamedTemporaryFile(suffix="_merged.mp3", delete=False) as tmp:
            merged_path = tmp.name
        try:
            print("[worker] Merging audio...")
            merge_audio_files(audio_files, merged_path)
            print("[worker] Pushing audio...")
            client.push_audio(session_name, merged_path)
            print(f"[worker] [DONE] Audio pushed for {session_name}")
        finally:
            Path(merged_path).unlink(missing_ok=True)
        return

    # Set HF_TOKEN from config so faster-whisper can download models
    if config.get("hf_token"):
        os.environ.setdefault("HF_TOKEN", config["hf_token"])

    print("=" * 60)
    print(f"DnD Transcriber Worker  v{WORKER_VERSION}")
    print(f"  Server:   {config['server_url']}")
    print(f"  Campaign: {config['campaign_slug']}")
    print(f"  Audio:    {config['audio_dir']}")
    print(f"  Model:    {config.get('whisper_model', '(from campaign settings)')}")
    print(f"  Poll:     every {config['poll_interval']}s")
    print("=" * 60)

    # stop_event is created before the GUI server starts so gui_server.init()
    # can be given it up front: it's what /api/shutdown uses to request a
    # graceful stop (used by e.g. a desktop launcher managing this as a
    # subprocess, which can't cleanly deliver a Ctrl+C-style KeyboardInterrupt
    # to a console-less Windows child).
    stop_event = threading.Event()

    # Everything below is wrapped so callers spawning this as a subprocess
    # (e.g. a desktop launcher) can tell a clean stop apart from a crash by
    # exit code, without having to parse stdout.
    try:
        # ── Start GUI server ─────────────────────────────────────────────
        try:
            import gui_server
            gui_server.init(log_ring, config, args.config, start_time, stop_event)
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

        # Start transcription poll loop in background thread
        poll_thread = threading.Thread(target=poll_loop, args=(config, stop_event), daemon=True)
        poll_thread.start()

        # Start analysis poll loop in background thread
        analysis_thread = threading.Thread(target=analysis_poll_loop, args=(config, stop_event), daemon=True)
        analysis_thread.start()

        # Block the main thread until stopped (Ctrl+C, or /api/shutdown
        # setting stop_event from another thread).
        try:
            while not stop_event.is_set():
                time.sleep(1)
        except KeyboardInterrupt:
            stop_event.set()

        poll_thread.join(timeout=5)
        print("Worker stopped.")
    except Exception:
        print("[worker] Fatal error:")
        traceback.print_exc()
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
