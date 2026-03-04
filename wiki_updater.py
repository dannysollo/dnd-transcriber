"""
wiki_updater.py
Sends the session transcript to Claude and gets back:
  1. A session summary
  2. Suggested additions to NPC/location/faction wiki pages

Does NOT auto-apply changes — outputs wiki_suggestions.md for your review.
"""
import os
import re
import sys
from pathlib import Path

import anthropic
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
    session = Path(session_dir)
    transcript_file = session / "transcript.md"

    if not transcript_file.exists():
        print("ERROR: transcript.md not found. Run merge.py first.")
        sys.exit(1)

    transcript = transcript_file.read_text(encoding="utf-8")
    vault_path = config["vault_path"]

    print("Scanning vault for mentioned entities...")
    vault_pages = find_vault_pages(vault_path)
    mentioned_pages = find_mentioned_pages(transcript, vault_pages)
    print(f"Found {len(mentioned_pages)} mentioned entities: {', '.join(list(mentioned_pages.keys())[:15])}")

    # Build pages context — limit to avoid exceeding context window
    MAX_PAGES = 20
    MAX_PAGE_CHARS = 2000  # truncate very long pages
    pages_context_parts = []
    for name, content in list(mentioned_pages.items())[:MAX_PAGES]:
        truncated = content[:MAX_PAGE_CHARS]
        if len(content) > MAX_PAGE_CHARS:
            truncated += "\n... [truncated]"
        pages_context_parts.append(f"### {name}\n{truncated}")
    pages_context = "\n\n---\n\n".join(pages_context_parts)

    # Truncate transcript if very long (Claude can handle large context but let's be safe)
    MAX_TRANSCRIPT_CHARS = 80_000
    transcript_snippet = transcript
    if len(transcript) > MAX_TRANSCRIPT_CHARS:
        transcript_snippet = transcript[:MAX_TRANSCRIPT_CHARS] + "\n\n... [transcript truncated]"

    prompt = f"""You are helping maintain a Dungeons & Dragons campaign wiki (an Obsidian vault).

I will give you a session transcript and the current state of relevant wiki pages.
Your job is to:
1. Write a session summary
2. Suggest specific additions to existing wiki pages based on what happened

---

## SESSION TRANSCRIPT

{transcript_snippet}

---

## CURRENT WIKI PAGES (for reference)

{pages_context}

---

## YOUR TASKS

### TASK 1 — SESSION SUMMARY
Write 3–5 paragraphs summarizing what happened this session. Include:
- Key events and decisions
- Important revelations or lore drops
- How relationships changed
- Any cliffhangers or unresolved threads

### TASK 2 — WIKI UPDATE SUGGESTIONS
For each NPC, location, faction, or item that had significant developments:
- Suggest additions to the appropriate section (usually "Notable Actions")
- Use the same bullet-point style as the existing pages
- Only suggest things clearly evidenced in the transcript
- If a completely new entity appeared that doesn't have a page, flag it with: **NEW PAGE NEEDED: [Name]** and give a brief description

Format each suggestion as:

#### [Page Name]
**Section:** Notable Actions
**Add:**
- New bullet here
- Another bullet if needed

---

Important rules:
- Suggest ADDITIONS only — do not rewrite existing content
- Keep bullet style consistent with existing pages
- Be specific — reference names, places, items from the transcript
- If something is ambiguous in the transcript, note it with "(unclear from transcript)"
"""

    api_key = resolve_api_key(config.get("anthropic_api_key"))
    client = anthropic.Anthropic(api_key=api_key)

    print("Sending transcript to Claude...")
    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response = message.content[0].text

    # Split response into summary + suggestions sections
    if "TASK 2" in response or "WIKI UPDATE" in response.upper():
        split_marker = next(
            (m for m in ["### TASK 2", "## TASK 2", "WIKI UPDATE SUGGESTIONS"]
             if m in response),
            None
        )
        if split_marker:
            idx = response.index(split_marker)
            summary_text = response[:idx].strip()
            # Clean up the summary section header
            summary_text = re.sub(r"^#+\s*TASK 1.*\n?|^#+\s*SESSION SUMMARY.*\n?", "",
                                   summary_text, flags=re.MULTILINE).strip()
            wiki_text = response[idx:].strip()
        else:
            summary_text = response
            wiki_text = ""
    else:
        summary_text = response
        wiki_text = ""

    # Save outputs
    summary_file = session / "summary.md"
    suggestions_file = session / "wiki_suggestions.md"

    summary_file.write_text(f"# Session Summary\n\n{summary_text}\n", encoding="utf-8")
    print(f"Summary saved:          {summary_file}")

    if wiki_text:
        suggestions_file.write_text(
            f"# Wiki Update Suggestions\n\n"
            f"> Review these suggestions and apply them manually to your vault.\n\n"
            f"{wiki_text}\n",
            encoding="utf-8"
        )
        print(f"Wiki suggestions saved: {suggestions_file}")
    else:
        print("No wiki suggestions generated (check summary.md for full response).")

    print("\nDone! Review the files above before applying anything to your vault.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python wiki_updater.py <session_dir> [config.yaml]")
        sys.exit(1)

    session_dir = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"

    with open(config_path) as f:
        config = yaml.safe_load(f)

    generate_wiki_updates(session_dir, config)
