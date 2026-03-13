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
from transcribe import apply_vad, load_whisper_model, run_transcription


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
    print(f"  Model:    {config['whisper_model']}")
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

                    # Lazy-load Whisper model
                    if whisper_model is None:
                        whisper_model = load_whisper_model(config["whisper_model"])

                    # Merge audio
                    with tempfile.NamedTemporaryFile(suffix="_merged.flac", delete=False) as tmp_merged:
                        merged_path = tmp_merged.name

                    print(f"  Merging {len(audio_files)} track(s)...")
                    merge_audio_files(audio_files, merged_path)

                    # Apply VAD
                    with tempfile.NamedTemporaryFile(suffix="_vad.wav", delete=False) as tmp_vad:
                        vad_path = tmp_vad.name

                    print(f"  Applying VAD...")
                    clean_path = apply_vad(merged_path, vad_path)

                    # Transcribe
                    print(f"  Transcribing...")
                    transcript = run_transcription(whisper_model, clean_path, config)

                    # Push transcript
                    print(f"  Pushing transcript...")
                    client.push_transcript(session_name, transcript)

                    # Push merged audio
                    print(f"  Pushing audio...")
                    client.push_audio(session_name, merged_path)

                    print(f"  [DONE] {session_name}")

                    # Cleanup temp files
                    for p in [merged_path, vad_path]:
                        try:
                            Path(p).unlink(missing_ok=True)
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
