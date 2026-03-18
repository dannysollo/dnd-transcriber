# DnD Transcriber — Worker

The worker runs on your local machine and uses your GPU to transcribe Craig recordings. It polls the campaign site for pending jobs, processes audio locally, and pushes the transcript + merged audio back to the server.

**You only need this if you're the designated transcription machine for your campaign.** Everyone else just uses the website.

---

## Requirements

- Python 3.10+
- ffmpeg
- An NVIDIA GPU with CUDA (strongly recommended — CPU transcription is very slow)
- A DnD Transcriber account and campaign membership

---

## Setup

### Linux / macOS

```bash
cd worker/
chmod +x setup.sh
./setup.sh
```

### Windows

Double-click `setup.bat` or run it from Command Prompt.

The script will:
1. Create a Python virtual environment
2. Install PyTorch (CUDA if you have an NVIDIA GPU, CPU otherwise)
3. Install all other dependencies
4. Walk you through creating `worker.yaml`

---

## Getting your API key

1. Go to the campaign site and log in
2. Open **Campaign Settings** → **Worker** tab
3. Click **Generate Key** (only DMs can do this)
4. Copy the key — paste it into the setup prompt or `worker.yaml`

---

## Audio layout

The worker looks for Craig audio files in subfolders of your configured `audio_dir`.
The subfolder name must match the session name exactly as it appears on the site.

```
audio_dir/
├── 2026-03-15/          ← session name
│   ├── 12345-dannysollo.flac
│   └── 12345-thatscinerd.flac
└── 2026-03-22/
    └── ...
```

Craig names files like `{recording-id}-{discord-username}.flac`. Just drop the whole zip extract into the session subfolder.

---

## Running

```bash
# Linux/macOS
source venv/bin/activate
python main.py

# Windows
venv\Scripts\activate
python main.py
```

The worker will print a heartbeat, then poll every 30 seconds for pending jobs. When a DM clicks **🎙️ Transcribe** on the site, the worker picks it up automatically.

---

## worker.yaml options

| Key | Required | Description |
|-----|----------|-------------|
| `server_url` | ✅ | URL of the campaign site |
| `campaign_slug` | ✅ | Campaign identifier (from the URL) |
| `api_key` | ✅ | API key from Campaign Settings → Worker |
| `audio_dir` | ✅ | Local folder where Craig files live |
| `poll_interval` | — | Seconds between job checks (default: 30) |
| `whisper_model` | — | Override the campaign's model setting (e.g. `turbo` if your GPU is weaker) |
| `discord_token` | — | Your Discord user token — enables Craig Watcher (see below) |
| `session_name_format` | — | Session naming pattern: `{date}`, `{date}-{channel}`, `{recording_id}` |
| `craig_channel_filter` | — | List of guild IDs to process (omit to process all guilds) |

---

## Craig Watcher (auto-download)

The Craig Watcher is an optional add-on that watches your Discord DMs for messages from Craig. When Craig DMs you after a recording ends, the watcher automatically:

1. Extracts the download link from Craig's message
2. Downloads and unzips the multitrack FLAC recording
3. Creates the session on the site
4. Queues a transcription job

**Zero manual steps** — just run a session and your transcript appears.

### Setup

Add these to your `worker.yaml`:

```yaml
discord_token: YOUR_DISCORD_USER_TOKEN
session_name_format: "{date}"   # or "{date}-{channel}" for more detail
```

To find your Discord token: open Discord in the browser → DevTools → Network tab → filter for requests to `discord.com/api` → look for `Authorization` header. Keep this private.

### Running

Run the watcher alongside the main worker (in a separate terminal):

```bash
source venv/bin/activate
python craig_watcher.py
```

Or run both at once:

```bash
source venv/bin/activate
python main.py &
python craig_watcher.py
```

### Session naming

| Format | Example |
|--------|---------|
| `{date}` | `2026-03-18` |
| `{date}-{channel}` | `2026-03-18-yapping` |
| `{recording_id}` | `HYmYp2AEuIN7` |

---

## Troubleshooting

**"No audio files found"** — Check that your `audio_dir` has a subfolder matching the session name exactly.

**Slow transcription** — You're probably on CPU. Check that CUDA is available: `python -c "import torch; print(torch.cuda.is_available())"`. If False, reinstall torch with CUDA support.

**"Invalid worker API key"** — The DM needs to regenerate the key in Campaign Settings and give you the new one.

**Job stuck as "🔄 Transcribing"** — If the worker crashed mid-job, click the 🔁 button on the session to reset it.
