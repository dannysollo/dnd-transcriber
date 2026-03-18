"""
craig_watcher.py — Watch for Craig bot DMs and auto-trigger transcription.

Runs alongside the existing worker daemon. When Craig sends a DM after a
recording session ends, this script:
  1. Extracts the download URL from the message button (craig.horse/rec/{id}?key={key})
  2. Downloads and unzips the multitrack FLAC recording
  3. Creates the session on the transcriber server (if not already existing)
  4. Queues a transcription job

Setup:
  pip install discord.py-self requests pyyaml
  python worker/craig_watcher.py

Configuration (worker.yaml):
  discord_token: YOUR_DISCORD_TOKEN   # user account token (selfbot)
  craig_channel_filter:               # optional: only process recordings from these guild IDs
    - "1113899568355098775"
  session_name_format: "{date}"       # or "{date}-{channel}" or "{recording_id}"

NOTE: This uses a Discord user token (selfbot) to read DMs.
Discord ToS technically prohibits selfbots for automation, but this is private
personal use only. Alternatively, if you own a bot that Craig is configured to
notify, set discord_token to a bot token and point it at the right channel.
"""

import asyncio
import io
import os
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml

# Allow running as `python worker/craig_watcher.py` from repo root
sys.path.insert(0, str(Path(__file__).parent))

try:
    import discord
except ImportError:
    print("ERROR: discord.py-self not installed.")
    print("Run: pip install discord.py-self")
    sys.exit(1)

# Craig's official Discord user ID
CRAIG_USER_ID = 272937604339466240

# Craig download base URL (multitrack FLAC zip)
# URL format: https://craig.horse/rec/{id}?key={key}&format=flac&container=zip
CRAIG_DOWNLOAD_BASE = "https://craig.horse/rec/{id}?key={key}&format=flac&container=zip"


def load_config(config_path: str) -> dict:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    required = ["server_url", "campaign_slug", "api_key", "audio_dir", "discord_token"]
    for key in required:
        if key not in cfg:
            raise ValueError(f"Missing required config key: {key}")
    return cfg


def extract_craig_url(message: discord.Message) -> str | None:
    """
    Extract the download URL from Craig's DM.
    Craig sends a button with the URL — check all components.
    Falls back to scanning message content for a craig.horse/rec/ URL.
    """
    # Check button components
    for component in message.components:
        # ActionRow
        if hasattr(component, "children"):
            for child in component.children:
                if hasattr(child, "url") and child.url and "craig.horse/rec/" in child.url:
                    return child.url
        # Direct button (less common)
        if hasattr(component, "url") and component.url and "craig.horse/rec/" in component.url:
            return component.url

    # Fallback: scan message content/embeds for URL
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


def extract_recording_id(message: discord.Message) -> str | None:
    """Extract the Recording ID from Craig's DM text."""
    m = re.search(r"\*\*Recording ID:\*\*\s*`([A-Za-z0-9]+)`", message.content or "")
    if m:
        return m.group(1)
    # Fallback: extract from URL
    url = extract_craig_url(message)
    if url:
        m = re.search(r"/rec/([A-Za-z0-9]+)", url)
        if m:
            return m.group(1)
    return None


def extract_guild_id(message: discord.Message) -> str | None:
    """Extract guild ID from Craig's DM text."""
    m = re.search(r"\((\d{17,20})\)", message.content or "")
    if m:
        return m.group(1)
    return None


def make_session_name(config: dict, recording_id: str, message: discord.Message) -> str:
    """Generate a session name from the recording."""
    fmt = config.get("session_name_format", "{date}")
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    # Try to extract channel name from message
    channel_match = re.search(r"\*\*Channel:\*\*.*?\(([^)]+)\)\s*\(", message.content or "")
    channel_name = channel_match.group(1).strip() if channel_match else "session"
    # Sanitize channel name
    channel_name = re.sub(r"[^a-zA-Z0-9_-]", "-", channel_name)[:30].strip("-")

    name = fmt.replace("{date}", date_str)
    name = name.replace("{channel}", channel_name)
    name = name.replace("{recording_id}", recording_id)
    return name


def download_craig_recording(url: str, dest_dir: Path) -> list[Path]:
    """
    Download Craig's multitrack ZIP and extract FLACs to dest_dir.
    Returns list of extracted audio file paths.
    """
    print(f"  Downloading from Craig: {url}")
    dest_dir.mkdir(parents=True, exist_ok=True)

    r = requests.get(url, timeout=300, stream=True)
    if r.status_code == 404:
        raise RuntimeError("Recording not found or expired (404).")
    if r.status_code == 403:
        raise RuntimeError("Access denied — invalid key (403).")
    r.raise_for_status()

    content_type = r.headers.get("content-type", "")
    if "zip" not in content_type and "octet-stream" not in content_type:
        # Might be a webpage (expired link)
        raise RuntimeError(f"Unexpected content type: {content_type}. Link may be expired.")

    zip_data = io.BytesIO(r.content)
    extracted = []

    with zipfile.ZipFile(zip_data) as zf:
        for name in zf.namelist():
            if name.lower().endswith((".flac", ".ogg", ".wav", ".m4a", ".mp3")):
                out_path = dest_dir / Path(name).name
                with zf.open(name) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())
                extracted.append(out_path)
                print(f"  Extracted: {out_path.name}")

    if not extracted:
        raise RuntimeError("ZIP contained no audio files.")

    return extracted


def create_session_and_queue(config: dict, session_name: str) -> None:
    """Create a session on the server and queue a transcription job."""
    base = config["server_url"]
    slug = config["campaign_slug"]
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }

    # Create session (ignore 400 if already exists)
    r = requests.post(
        f"{base}/campaigns/{slug}/sessions",
        headers=headers,
        json={"name": session_name},
        timeout=30,
    )
    if r.status_code not in (200, 201, 400):
        r.raise_for_status()
    if r.status_code == 201:
        print(f"  Created session: {session_name}")
    else:
        print(f"  Session already exists: {session_name}")

    # Queue transcription job
    r = requests.post(
        f"{base}/campaigns/{slug}/sessions/{session_name}/transcribe",
        headers=headers,
        timeout=30,
    )
    if r.status_code == 409:
        print(f"  Transcription already queued for {session_name}.")
    elif r.ok:
        print(f"  Transcription job queued for {session_name}.")
    else:
        print(f"  Warning: Failed to queue transcription: {r.status_code} {r.text}")


class CraigWatcher(discord.Client):
    def __init__(self, config: dict):
        # Use minimal intents — just DMs
        intents = discord.Intents.default()
        intents.message_content = True
        intents.dm_messages = True
        super().__init__(intents=intents)
        self.cfg = config
        self.guild_filter = set(config.get("craig_channel_filter") or [])

    async def on_ready(self):
        print(f"Craig Watcher ready. Logged in as {self.user} ({self.user.id})")
        print(f"Watching for DMs from Craig (ID: {CRAIG_USER_ID})")
        if self.guild_filter:
            print(f"Filtering to guilds: {self.guild_filter}")

    async def on_message(self, message: discord.Message):
        # Only care about DMs from Craig
        if not isinstance(message.channel, discord.DMChannel):
            return
        if message.author.id != CRAIG_USER_ID:
            return

        print(f"\n[Craig DM] {message.created_at.strftime('%Y-%m-%d %H:%M:%S')} UTC")
        print(f"  Content preview: {(message.content or '')[:120]}")

        # Guild filter
        if self.guild_filter:
            guild_id = extract_guild_id(message)
            if guild_id and guild_id not in self.guild_filter:
                print(f"  Skipping — guild {guild_id} not in filter.")
                return

        # Extract recording ID
        recording_id = extract_recording_id(message)
        if not recording_id:
            print("  Could not extract recording ID — skipping.")
            return
        print(f"  Recording ID: {recording_id}")

        # Extract download URL
        url = extract_craig_url(message)
        if not url:
            print("  Could not find download URL in message components or content.")
            print("  Tip: Make sure Craig can send button components in DMs.")
            return
        print(f"  Download URL: {url}")

        # Build session name
        session_name = make_session_name(self.cfg, recording_id, message)
        print(f"  Session name: {session_name}")

        # Download FLACs
        audio_dir = Path(self.cfg["audio_dir"]) / session_name
        try:
            files = await asyncio.to_thread(download_craig_recording, url, audio_dir)
            print(f"  Downloaded {len(files)} audio file(s) to {audio_dir}")
        except Exception as e:
            print(f"  ERROR downloading recording: {e}")
            return

        # Create session + queue job
        try:
            await asyncio.to_thread(create_session_and_queue, self.cfg, session_name)
        except Exception as e:
            print(f"  ERROR creating session/queuing job: {e}")
            return

        print(f"  ✓ Session '{session_name}' ready — transcription queued.")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Watch for Craig DMs and auto-trigger transcription")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "worker.yaml"),
        help="Path to worker.yaml",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    client = CraigWatcher(config)

    print("Starting Craig Watcher...")
    print(f"  Server:   {config['server_url']}")
    print(f"  Campaign: {config['campaign_slug']}")
    print(f"  Audio dir: {config['audio_dir']}")
    client.run(config["discord_token"])


if __name__ == "__main__":
    main()
