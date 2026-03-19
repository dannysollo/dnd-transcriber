"""
worker/config.py — Load and validate worker.yaml configuration.

campaign_slug is optional — if omitted, the worker will auto-discover it
from the server using the api_key via GET /worker/whoami.
"""
import sys
from pathlib import Path

import requests
import yaml

REQUIRED_FIELDS = ["server_url", "api_key", "audio_dir"]
DEFAULTS = {
    # whisper_model intentionally NOT defaulted here — campaign config controls it.
    # Set whisper_model in worker.yaml only to override the campaign setting (e.g. weaker GPU).
    "poll_interval": 30,
}


def resolve_campaign_slug(config: dict) -> str:
    """
    Auto-discover campaign_slug from the server using the api_key.
    Called when campaign_slug is not set in worker.yaml.
    """
    url = f"{config['server_url']}/worker/whoami"
    headers = {"Authorization": f"Bearer {config['api_key']}"}
    try:
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 403:
            print("ERROR: Invalid API key — server rejected it. Check api_key in worker.yaml.")
            sys.exit(1)
        r.raise_for_status()
        data = r.json()
        slug = data["campaign_slug"]
        name = data.get("campaign_name", slug)
        print(f"  Auto-discovered campaign: {name} (slug: {slug})")
        return slug
    except requests.ConnectionError:
        print(f"ERROR: Could not connect to server at {config['server_url']}")
        print("Check server_url in worker.yaml and ensure the server is running.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to auto-discover campaign slug: {e}")
        print("Set campaign_slug manually in worker.yaml to skip auto-discovery.")
        sys.exit(1)


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

    # Auto-discover campaign_slug if not provided
    if not config.get("campaign_slug"):
        print("  campaign_slug not set — auto-discovering from server...")
        config["campaign_slug"] = resolve_campaign_slug(config)

    return config
