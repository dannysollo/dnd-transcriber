"""
worker/config.py — Load and validate worker.yaml configuration.
"""
import sys
from pathlib import Path

import yaml

REQUIRED_FIELDS = ["server_url", "campaign_slug", "api_key", "audio_dir"]
DEFAULTS = {
    # whisper_model intentionally NOT defaulted here — campaign config controls it.
    # Set whisper_model in worker.yaml only to override the campaign setting (e.g. weaker GPU).
    "poll_interval": 30,
}


def load_config(config_path: str) -> dict:
    path = Path(config_path)
    if not path.exists():
        print(f"ERROR: Config file not found: {config_path}")
        print("Copy worker.yaml.example to worker.yaml and fill in your settings.")
        sys.exit(1)

    with open(path) as f:
        config = yaml.safe_load(f) or {}

    missing = [field for field in REQUIRED_FIELDS if not config.get(field)]
    if missing:
        print(f"ERROR: Missing required fields in {config_path}:")
        for field in missing:
            print(f"  - {field}")
        sys.exit(1)

    # Apply defaults for optional fields
    for key, default in DEFAULTS.items():
        config.setdefault(key, default)

    # Normalize server_url (strip trailing slash)
    config["server_url"] = config["server_url"].rstrip("/")

    return config
