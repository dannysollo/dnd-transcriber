"""
vocab_extractor.py
Scrapes the campaign vault for proper nouns (page names, wikilinks, bold terms)
and builds a Whisper initial_prompt to improve transcription of campaign-specific words.
"""
import re
from pathlib import Path


def extract_from_vault(vault_path: str, max_chars: int = 800) -> str:
    """
    Extract proper nouns from Index.md only — the curated master index is a
    much cleaner source than scraping all pages.

    Returns a Whisper initial_prompt formatted as a fake transcript opening line.
    Whisper treats initial_prompt as preceding audio context, so natural sentence
    structure works far better than a raw word list.
    """
    vault = Path(vault_path)
    index_file = vault / "Index.md"

    if not index_file.exists():
        raise FileNotFoundError(f"Index.md not found at {index_file}")

    text = index_file.read_text(encoding="utf-8")

    # Extract all [[wikilinks]] from the index
    proper_nouns: set[str] = set()
    for match in re.findall(r"\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]", text):
        term = match.strip()
        if len(term) > 1:
            proper_nouns.add(term)

    # Sort shorter/simpler names first
    sorted_nouns = sorted(proper_nouns, key=lambda x: (len(x), x))

    # Format as a fake transcript opening — much better signal for Whisper
    intro = "[00:00] DM: This session of our D&D campaign features characters Kali, Aella, Vixeena (also called Vix), and Belle, with DMs Danny and Juno. Campaign proper nouns include: "
    budget = max_chars - len(intro) - 1
    noun_str = ", ".join(sorted_nouns)
    if len(noun_str) > budget:
        noun_str = noun_str[:budget].rsplit(", ", 1)[0]

    return intro + noun_str + "."


if __name__ == "__main__":
    import sys
    import yaml

    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    vocab = extract_from_vault(config["vault_path"])
    print(f"Vocab prompt ({len(vocab)} chars):\n")
    print(vocab)
