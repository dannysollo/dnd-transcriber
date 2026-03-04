# DnD Session Transcriber

Turns Craig bot Discord recordings into speaker-labeled transcripts, session summaries, and Obsidian wiki update suggestions.

## Pipeline

```
Craig records session (per-user .flac files)
  → Whisper transcribes each track (with campaign vocab prompt)
  → Merge into timestamped transcript
  → Claude generates summary + wiki suggestions
  → You review and apply updates to the vault
```

---

## Setup

### 1. Prerequisites (WSL2)

Make sure you have NVIDIA drivers on Windows and CUDA in WSL:
```bash
nvidia-smi  # should show your 4060 Ti if CUDA is working in WSL
```

If `nvidia-smi` fails in WSL, see: https://docs.nvidia.com/cuda/wsl-user-guide/

Install ffmpeg (required by Whisper):
```bash
sudo apt update && sudo apt install ffmpeg
```

### 2. Python environment

```bash
cd dnd-transcriber
python -m venv venv
source venv/bin/activate

# Install PyTorch with CUDA 12.x first (check your CUDA version with: nvcc --version)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Then install the rest
pip install -r requirements.txt
```

### 3. Configure

Edit `config.yaml`:
- Replace `DISCORD_USERNAME_*` keys with actual Discord usernames
- Set correct character/player names
- Set `whisper_model` (default: `large-v3`, or `turbo` for faster results)
- Set `ANTHROPIC_API_KEY` env variable (or paste key directly in config)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Recording with Craig

Craig bot is free and made for TTRPGs. It records each user on a separate track.

1. Invite Craig to your server: https://craig.horse
2. At session start: `/join` in your voice channel
3. At session end: `/stop` (Craig will DM you a download link)
4. Download the **FLAC** zip (not the mixed track)
5. Extract the zip — you'll get one `.flac` file per person

---

## Running a Session

### Step 1: Set up session folder

```bash
python pipeline.py session-01
```

If the session folder doesn't exist yet, it will be created. This also prints the path where Craig files should go.

### Step 2: Add Craig files

Copy the extracted Craig `.flac` files into:
```
sessions/session-01/raw/
```

The filenames will contain the Discord usernames, e.g.:
```
sessions/session-01/raw/
  12345678-dannysollo.flac
  12345678-playeruser.flac
  ...
```

### Step 3: Run the pipeline

```bash
# Full pipeline (transcribe + wiki suggestions)
python pipeline.py session-01

# Transcription only (to review before sending to Claude)
python pipeline.py session-01 --transcribe-only

# Wiki suggestions only (if transcript already exists)
python pipeline.py session-01 --wiki-only
```

### Step 4: Review outputs

```
sessions/session-01/
  raw/                     ← Craig audio files
  speakers/                ← Per-speaker Whisper JSON (intermediate)
  transcript.md            ← Full labeled transcript ← review this
  summary.md               ← Session summary
  wiki_suggestions.md      ← Suggested vault updates ← review before applying
```

Open `wiki_suggestions.md`, review the suggested additions, and manually copy them into your Obsidian vault.

---

## Proper Noun Handling

The `vocab_extractor.py` script scans your entire vault and builds a Whisper prompt seeded with:
- All page names (character names, locations, factions, items)
- `[[wikilinks]]` found in notes
- **Bold capitalized terms** (often proper nouns)

This dramatically improves recognition of campaign-specific words. As you add more pages to your vault, the vocabulary automatically improves on the next run.

---

## Tips

- **First run**: Whisper downloads the model (~3GB for large-v3). Be patient.
- **Speed**: large-v3 on a 4060 Ti processes ~10min of audio per minute. A 3hr session takes ~18 min.
- **Quality vs Speed**: Use `turbo` model in config for ~3x speedup with minor quality tradeoff.
- **Transcript review**: Always check `transcript.md` before running wiki suggestions — fix obvious errors first if needed.
- **Proper nouns**: If a character/place name is still being mangled, add it as a page in your vault. It'll get picked up automatically.

---

## File Structure

```
dnd-transcriber/
  pipeline.py          ← Main entry point
  vocab_extractor.py   ← Scrapes vault for proper nouns
  transcribe.py        ← Runs Whisper on audio tracks
  merge.py             ← Merges tracks into single transcript
  wiki_updater.py      ← Claude integration for summaries + wiki suggestions
  config.yaml          ← Your configuration
  requirements.txt
  sessions/            ← Session data (gitignore if private)
    session-01/
      raw/             ← Craig .flac files go here
      speakers/        ← Intermediate Whisper output
      transcript.md
      summary.md
      wiki_suggestions.md
```
