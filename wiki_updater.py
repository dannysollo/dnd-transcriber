"""
wiki_updater.py
Notifies Claude via OpenClaw to analyze the session transcript.
Claude reads ANALYZE_SESSION.md for instructions and posts the analysis to Discord.

Does NOT call Anthropic directly — routes through OpenClaw.
"""
import re
import subprocess
import sys
from pathlib import Path

import yaml


def resolve_api_key(raw: str | None) -> str:
    """Resolve API key — supports ${ENV_VAR} syntax or literal key."""
    if not raw:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise ValueError(
                "No Anthropic API key found. Set ANTHROPIC_API_KEY env var "
                "or set anthropic_api_key in config.yaml."
            )
        return key
    if raw.startswith("${") and raw.endswith("}"):
        env_var = raw[2:-1]
        key = os.environ.get(env_var, "")
        if not key:
            raise ValueError(f"Environment variable {env_var} is not set.")
        return key
    return raw


def find_vault_pages(vault_path: str) -> dict[str, Path]:
    """Return a dict of {page_name_lower: path} for all vault pages."""
    vault = Path(vault_path)
    pages = {}
    for md_file in vault.rglob("*.md"):
        try:
            rel_parts = md_file.relative_to(vault).parts
        except ValueError:
            rel_parts = md_file.parts
        if any(p.startswith(".") for p in rel_parts):
            continue
        pages[md_file.stem.lower()] = md_file
    return pages


def find_mentioned_pages(transcript: str, vault_pages: dict[str, Path]) -> dict[str, str]:
    """
    Find vault pages whose names appear in the transcript.
    Returns {page_name: page_content} for the top matches.
    """
    transcript_lower = transcript.lower()
    mentioned: dict[str, str] = {}

    skip = {"index", "readme", "morality system"}

    for name_lower, path in vault_pages.items():
        if name_lower in skip:
            continue
        # Only include if the name appears as a whole word-ish match
        if re.search(r"\b" + re.escape(name_lower) + r"\b", transcript_lower):
            try:
                content = path.read_text(encoding="utf-8")
                mentioned[path.stem] = content
            except Exception:
                pass

    return mentioned


def generate_wiki_updates(session_dir: str, config: dict):
    """Notify Claude via OpenClaw to analyze the transcript and post to Discord."""
    session = Path(session_dir)
    transcript_path = session.resolve() / "transcript.md"
    context_path = Path(__file__).parent.resolve() / "ANALYZE_SESSION.md"
    session_id = config.get("openclaw_session_id", "agent:main:discord:direct:235848101569626122")

    if not transcript_path.exists():
        print("ERROR: transcript.md not found. Run merge.py first.")
        sys.exit(1)

    message = (
        f"D&D session transcript is ready for analysis. "
        f"Please read {context_path} for instructions, "
        f"then analyze the transcript at {transcript_path}."
    )

    print(f"  Sending to Claude via OpenClaw (session: {session_id})...")
    result = subprocess.run(
        [
            "openclaw", "agent",
            "--session-id", session_id,
            "--message", message,
            "--deliver",
            "--reply-channel", "discord",
            "--reply-to", "channel:1475874124869013710",
        ],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print("  ✓ Claude notified — analysis will appear in Discord shortly.")
    else:
        print(f"  ✗ OpenClaw notify failed: {result.stderr.strip()}")
        raise RuntimeError(f"openclaw agent command failed: {result.stderr.strip()}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python wiki_updater.py <session_dir> [config.yaml]")
        sys.exit(1)

    session_dir = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"

    with open(config_path) as f:
        config = yaml.safe_load(f)

    generate_wiki_updates(session_dir, config)
