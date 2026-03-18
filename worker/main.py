"""
worker/main.py — DnD Transcriber worker daemon.

Usage:
    python worker/main.py
    python worker/main.py --config /path/to/worker.yaml
"""
import argparse
import sys
import tempfile
import time
import traceback
from pathlib import Path

# Allow running as `python worker/main.py` from repo root
sys.path.insert(0, str(Path(__file__).parent))

from client import WorkerClient
from config import load_config
from audio import find_audio_files, merge_audio_files
from transcribe import load_whisper_model, transcribe_session


def main():
    parser = argparse.ArgumentParser(description="DnD Transcriber Worker")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).parent / "worker.yaml"),
        help="Path to worker.yaml (default: worker.yaml in this directory)",
    )
    args = parser.parse_args()

    config = load_config(args.config)

    print("=" * 60)
    print("DnD Transcriber Worker")
    print(f"  Server:   {config['server_url']}")
    print(f"  Campaign: {config['campaign_slug']}")
    print(f"  Audio:    {config['audio_dir']}")
    print(f"  Model:    {config.get('whisper_model', '(from campaign settings)')}")
    print(f"  Poll:     every {config['poll_interval']}s")
    print("=" * 60)

    client = WorkerClient(config)
    whisper_model = None  # lazy-load on first use

    # Initial heartbeat
    try:
        client.heartbeat()
        print("Heartbeat sent.")
    except Exception as e:
        print(f"Warning: heartbeat failed: {e}")

    heartbeat_counter = 0

    try:
        while True:
            try:
                jobs = client.get_pending_jobs()
            except Exception as e:
                print(f"Error fetching jobs: {e}")
                time.sleep(config["poll_interval"])
                continue

            for job in jobs:
                session_name = job["session_name"]
                session_dir = Path(config["audio_dir"]) / session_name

                if not session_dir.exists():
                    print(f"[SKIP] Session dir not found: {session_dir}")
                    continue

                audio_files = find_audio_files(session_dir)
                if not audio_files:
                    print(f"[SKIP] No audio files in {session_dir}")
                    continue

                print(f"\n[JOB] {session_name} — {len(audio_files)} audio file(s)")

                try:
                    # Claim the job
                    client.claim_job(session_name)
                    print(f"  Claimed job.")

                    # Fetch campaign config (players, vocab, vad) from server
                    campaign_config = client.get_campaign_config()
                    # Local config overrides: whisper_model, poll_interval (worker-specific)
                    job_config = {**campaign_config, **{
                        k: config[k] for k in ("whisper_model",) if k in config
                    }}

                    # Lazy-load Whisper model (reload if model name changed)
                    model_name = job_config.get("whisper_model", "turbo")
                    if whisper_model is None or getattr(whisper_model, "_model_name", None) != model_name:
                        whisper_model = load_whisper_model(model_name)
                        whisper_model._model_name = model_name

                    # Transcribe each speaker track individually, merge by timestamp
                    transcript = transcribe_session(session_dir, whisper_model, job_config)

                    # Push transcript
                    print(f"  Pushing transcript...")
                    client.push_transcript(session_name, transcript)

                    # Merge audio tracks and push for web playback
                    with tempfile.NamedTemporaryFile(suffix="_merged.mp3", delete=False) as tmp_merged:
                        merged_path = tmp_merged.name
                    print(f"  Merging audio for web playback...")
                    merge_audio_files(audio_files, merged_path)
                    print(f"  Pushing audio...")
                    client.push_audio(session_name, merged_path)

                    print(f"  [DONE] {session_name}")

                    # Cleanup merged audio temp file (speaker JSONs kept in session_dir/speakers/)
                    try:
                        Path(merged_path).unlink(missing_ok=True)
                    except Exception:
                        pass

                except Exception as e:
                    error_msg = traceback.format_exc()
                    print(f"  [ERROR] {session_name}: {e}")
                    print(error_msg)
                    try:
                        client.report_error(session_name, str(e))
                    except Exception as report_err:
                        print(f"  Failed to report error: {report_err}")
                    continue

            heartbeat_counter += 1
            if heartbeat_counter >= 5:
                try:
                    client.heartbeat()
                except Exception as e:
                    print(f"Heartbeat failed: {e}")
                heartbeat_counter = 0

            time.sleep(config["poll_interval"])

    except KeyboardInterrupt:
        print("\nWorker stopped.")


if __name__ == "__main__":
    main()
