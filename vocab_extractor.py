"""
vocab_extractor.py
Scrapes the campaign vault for proper nouns (page names, wikilinks, bold terms)
and builds a Whisper initial_prompt to improve transcription of campaign-specific words.
"""
import re
from pathlib import Path


def extract_from_vault(vault_path: str, max_chars: int = 800) -> str:
    """
    Scan all markdown files in vault, extract:
      - Page filenames (e.g. "Kali", "Aziah")
      - [[wikilinks]]
      - **Bold Capitalized Terms**
    Returns a string suitable for Whisper's initial_prompt parameter.
    """
    vault = Path(vault_path)
    proper_nouns: set[str] = set()

    for md_file in vault.rglob("*.md"):
        # Skip hidden dirs (.obsidian, etc.) — check relative to vault only
        try:
            rel_parts = md_file.relative_to(vault).parts
        except ValueError:
            rel_parts = md_file.parts
        if any(part.startswith(".") for part in rel_parts):
            continue

        try:
            text = md_file.read_text(encoding="utf-8")
        except Exception:
            continue

        # Page title from filename
        name = md_file.stem
        skip_pages = {"index", "readme", "morality system"}
        if len(name) > 2 and name.lower() not in skip_pages:
            proper_nouns.add(name)

        # [[wikilinks]] — handle [[Name|Alias]] format too
        for match in re.findall(r"\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]", text):
            term = match.strip()
            if 2 < len(term) < 50:
                proper_nouns.add(term)

        # **Bold Terms** that start with a capital (likely proper nouns)
        for match in re.findall(r"\*\*([A-Z][^*\n]{1,40}?)\*\*", text):
            term = match.strip()
            # Skip field labels (end with colon), all-caps abbreviations, and obvious non-names
            if 2 < len(term) < 50 and "|" not in term and not term.endswith(":"):
                proper_nouns.add(term)

    # Sort shorter names first (more likely to be recognized correctly)
    sorted_nouns = sorted(proper_nouns, key=lambda x: (len(x), x))

    # Build prompt within character budget
    intro = "Dungeons & Dragons campaign. Proper nouns: "
    budget = max_chars - len(intro)
    noun_str = ", ".join(sorted_nouns)
    if len(noun_str) > budget:
        noun_str = noun_str[:budget].rsplit(", ", 1)[0]

    prompt = intro + noun_str
    return prompt


if __name__ == "__main__":
    import sys
    import yaml

    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    vocab = extract_from_vault(config["vault_path"])
    print(f"Vocab prompt ({len(vocab)} chars):\n")
    print(vocab)
