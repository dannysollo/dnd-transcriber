"""
transcribe.py
Runs Whisper on each Craig audio track (one per player/DM),
producing a timestamped JSON file per speaker.

Craig outputs time-aligned tracks — each file starts at t=0 (recording start),
so timestamps are directly comparable across files.
"""
import json
import sys
from pathlib import Path

import yaml


def get_speaker_label(filename: str, players: dict) -> str:
    """
    Map a Craig audio filename fragment to a human-readable speaker label.
    Craig filenames look like: {recording-id}-{username}.flac
    We match against the username keys in config.
    """
    filename_lower = filename.lower()
    for username, info in players.items():
        if username.lower() in filename_lower:
            role = info.get("role", "player")
            name = info.get("name", username)
            char = info.get("character")
            if role == "dm":
                return f"DM ({name})"
            elif char:
                return f"{char} [{name}]"
            else:
                return name
    # Fallback: use stem of filename
    return Path(filename).stem


def transcribe_tracks(session_dir: str, config: dict, vocab_prompt: str):
    """
    Transcribe all audio files in {session_dir}/raw/.
    Outputs per-speaker JSON to {session_dir}/speakers/.
    """
    import whisper  # imported here so the script is importable without whisper installed

    session = Path(session_dir)
    raw_dir = session / "raw"
    out_dir = session / "speakers"
    out_dir.mkdir(exist_ok=True)

    model_name = config.get("whisper_model", "large-v3")
    print(f"Loading Whisper model: {model_name} (this may take a moment on first run)...")
    model = whisper.load_model(model_name)
    print("Model loaded.")

    audio_exts = ("*.flac", "*.mp3", "*.ogg", "*.wav", "*.m4a")
    audio_files = []
    for ext in audio_exts:
        audio_files.extend(raw_dir.glob(ext))

    if not audio_files:
        print(f"ERROR: No audio files found in {raw_dir}")
        print("Download your Craig recording and place the .flac files there.")
        sys.exit(1)

    print(f"Found {len(audio_files)} audio track(s)\n")

    for audio_file in sorted(audio_files):
        speaker = get_speaker_label(audio_file.name, config.get("players", {}))
        print(f"Transcribing: {audio_file.name}")
        print(f"  Speaker:    {speaker}")

        result = model.transcribe(
            str(audio_file),
            language="en",
            initial_prompt=vocab_prompt,
            word_timestamps=True,
            verbose=False,
        )

        out_file = out_dir / f"{audio_file.stem}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "speaker": speaker,
                    "filename": audio_file.name,
                    "segments": result["segments"],
                },
                f,
                indent=2,
                ensure_ascii=False,
            )

        seg_count = len(result["segments"])
        duration = result["segments"][-1]["end"] if result["segments"] else 0
        print(f"  → {out_file.name} ({seg_count} segments, {duration/60:.1f} min)\n")

    print("Transcription complete.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <session_dir> [config.yaml]")
        sys.exit(1)

    session_dir = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"

    with open(config_path) as f:
        config = yaml.safe_load(f)

    from vocab_extractor import extract_from_vault
    vocab = extract_from_vault(config["vault_path"])
    print(f"Vocab prompt: {len(vocab)} chars\n")

    transcribe_tracks(session_dir, config, vocab)
