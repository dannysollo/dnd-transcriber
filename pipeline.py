"""
pipeline.py — Main orchestrator

Usage:
  python pipeline.py <session-name>          # run full pipeline
  python pipeline.py <session-name> --transcribe-only
  python pipeline.py <session-name> --wiki-only

Session names are just folder names, e.g.: 2026-03-15  or  session-01

Steps:
  1. Extract vocab from vault (proper nouns → Whisper prompt)
  2. Transcribe each Craig audio track with Whisper
  3. Merge tracks into single timestamped transcript
  4. Send to Claude → session summary + wiki suggestions
"""
import argparse
import sys
from pathlib import Path

import yaml


def load_config(config_path: str) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def ensure_session_dir(sessions_dir: Path, session_name: str) -> Path:
    session_dir = sessions_dir / session_name
    raw_dir = session_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    return session_dir


def banner(text: str):
    w = 52
    print("\n" + "=" * w)
    print(f"  {text}")
    print("=" * w)


def run(session_name: str, config_path: str = "config.yaml",
        transcribe_only: bool = False, wiki_only: bool = False):

    config = load_config(config_path)
    sessions_dir = Path(config.get("sessions_dir", "sessions"))
    session_dir = ensure_session_dir(sessions_dir, session_name)

    raw_dir = session_dir / "raw"
    audio_exts = ("*.flac", "*.mp3", "*.ogg", "*.wav", "*.m4a")
    audio_files = []
    for ext in audio_exts:
        audio_files.extend(raw_dir.glob(ext))

    if not wiki_only and not audio_files:
        print(f"\nNo audio files found in: {raw_dir}")
        print("Place your Craig recording files (.flac) there and re-run.\n")
        print("Craig tip: after your session, use /craig:stop in Discord,")
        print("then download the FLAC zip from the bot's DM and extract here.")
        sys.exit(1)

    banner(f"Processing session: {session_name}")

    if not wiki_only:
        # Step 1: Extract vocabulary
        print("\n[1/4] Extracting vocabulary from vault...")
        from vocab_extractor import extract_from_vault
        vocab = extract_from_vault(config["vault_path"])
        print(f"      Vocab prompt: {len(vocab)} chars")

        # Step 2: Transcribe
        print("\n[2/4] Transcribing audio tracks with Whisper...")
        from transcribe import transcribe_tracks
        transcribe_tracks(str(session_dir), config, vocab)

        # Step 3: Merge
        print("\n[3/4] Merging transcripts...")
        from merge import save_transcript
        save_transcript(str(session_dir))

    if transcribe_only:
        banner("Transcription complete")
        print(f"  Transcript: {session_dir}/transcript.md")
        print("\nReview the transcript, then re-run with --wiki-only to generate wiki suggestions.")
        return

    # Step 4: Wiki suggestions
    print("\n[4/4] Generating summary and wiki suggestions via Claude...")
    from wiki_updater import generate_wiki_updates
    generate_wiki_updates(str(session_dir), config)

    banner("All done!")
    print(f"  Session dir:      {session_dir}/")
    print(f"  Transcript:       transcript.md")
    print(f"  Summary:          summary.md")
    print(f"  Wiki suggestions: wiki_suggestions.md")
    print()
    print("Review wiki_suggestions.md and manually apply updates to your vault.")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DnD session transcript pipeline")
    parser.add_argument("session", help="Session name/folder (e.g. 2026-03-15 or session-01)")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--transcribe-only", action="store_true",
                        help="Only run transcription (skip wiki suggestions)")
    parser.add_argument("--wiki-only", action="store_true",
                        help="Only run wiki suggestions (transcript already exists)")
    args = parser.parse_args()

    run(
        session_name=args.session,
        config_path=args.config,
        transcribe_only=args.transcribe_only,
        wiki_only=args.wiki_only,
    )
