"""
wiki_updater.py
Queues an analysis job by writing an `analysis_pending` flag in the session dir.
The worker picks it up, runs Claude locally via openclaw, and POSTs results back.
"""
import sys
from pathlib import Path

import yaml


def generate_wiki_updates(session_dir: str, config: dict):
    """Queue an analysis job for the worker."""
    session = Path(session_dir).resolve()
    transcript_path = session / "transcript.md"

    if not transcript_path.exists():
        print("ERROR: transcript.md not found. Run merge.py first.")
        sys.exit(1)

    flag_path = session / "analysis_pending"
    flag_path.touch()
    print(f"  ✓ Analysis job queued — worker will pick it up and run Claude locally.")
    print(f"    Results will appear in Summary + Wiki tabs when done.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python wiki_updater.py <session_dir> [config.yaml]")
        sys.exit(1)

    session_dir = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"

    with open(config_path) as f:
        config = yaml.safe_load(f)

    generate_wiki_updates(session_dir, config)
