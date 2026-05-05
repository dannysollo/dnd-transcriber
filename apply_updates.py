"""
apply_updates.py
Applies approved wiki suggestions from wiki_suggestions.md to vault pages.

Usage:
  python apply_updates.py <session_dir> --all
  python apply_updates.py <session_dir> --apply 1,2,4
  python apply_updates.py <session_dir> --skip 3

Called automatically by Claude after you approve in Discord,
or run manually from the command line.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

import yaml


# ── Parsing ──────────────────────────────────────────────────────────────────

def parse_suggestions(suggestions_file: Path) -> dict[int, dict]:
    """
    Parse wiki_suggestions.md into structured suggestion objects.

    Expected format per suggestion:
        ## [1] PageName — Section Name
        Page: relative/path/to/page.md
        Section: Notable Actions
        - Bullet one
        - Bullet two
    """
    text = suggestions_file.read_text(encoding="utf-8")
    suggestions = {}

    # Split on ## [N] markers
    blocks = re.split(r'\n(?=## \[\d+\])', text)

    for block in blocks:
        header_match = re.match(r'## \[(\d+)\]\s+(.+)', block)
        if not header_match:
            continue

        num = int(header_match.group(1))
        title = header_match.group(2).strip()

        # Truncate block at any new ## section (e.g. ## Proper Noun Corrections)
        # so trailing sections don't bleed into this suggestion's bullets
        body_match = re.search(r'\n##\s+(?!\[\d+\])', block)
        body = block[:body_match.start()] if body_match else block

        # Extract fields
        page_match = re.search(r'^Page:\s*(.+)$', body, re.MULTILINE)
        section_match = re.search(r'^Section:\s*(.+)$', body, re.MULTILINE)
        # Exclude lines that look like corrections (contain →)
        bullets = [b for b in re.findall(r'^- .+$', body, re.MULTILINE) if '→' not in b]

        is_new_page = title.startswith("NEW PAGE:")
        desc_match = re.search(r'^Description:\s*(.+)$', body, re.MULTILINE)

        suggestions[num] = {
            "title": title,
            "page": page_match.group(1).strip() if page_match else None,
            "section": section_match.group(1).strip() if section_match else "Notable Actions",
            "bullets": bullets,
            "new_page": is_new_page,
            "description": desc_match.group(1).strip() if desc_match else None,
        }

    return suggestions


# ── Applying ──────────────────────────────────────────────────────────────────

def insert_bullets(content: str, section: str, bullets: list[str]) -> tuple[str, bool]:
    """
    Insert bullets into the named section of a markdown page.
    Returns (new_content, changed).
    """
    # Find the section heading (any # level)
    section_re = re.compile(
        r'^(#{1,4})\s+' + re.escape(section) + r'\s*$', re.MULTILINE
    )
    match = section_re.search(content)

    if not match:
        # Section doesn't exist — append a new one at the end
        new_section = f"\n\n## {section}\n" + "\n".join(bullets) + "\n"
        return content.rstrip() + new_section, True

    heading_level = len(match.group(1))
    section_body_start = match.end()

    # Find where this section ends (next heading of same or higher level)
    next_heading_re = re.compile(
        r'^#{1,' + str(heading_level) + r'}\s', re.MULTILINE
    )
    next_match = next_heading_re.search(content, section_body_start)
    section_end = next_match.start() if next_match else len(content)

    section_body = content[section_body_start:section_end]

    # Find the last bullet in this section to insert after
    bullet_matches = list(re.finditer(r'^- .+$', section_body, re.MULTILINE))

    new_bullets_str = "\n".join(bullets)

    if bullet_matches:
        insert_pos = section_body_start + bullet_matches[-1].end()
        new_content = content[:insert_pos] + "\n" + new_bullets_str + content[insert_pos:]
    else:
        # No existing bullets — insert after section header with spacing
        insert_pos = section_body_start
        stripped_body = section_body.lstrip("\n")
        new_content = (
            content[:insert_pos]
            + "\n"
            + new_bullets_str
            + "\n"
            + stripped_body
            + content[section_end:]
        )

    return new_content, new_content != content


def create_new_page(vault_path: Path, title: str, description: str, bullets: list[str]) -> Path:
    """Create a stub page for a newly discovered entity."""
    # Guess folder from title context — default to Characters/NPCs
    page_path = vault_path / "Characters" / "NPCs" / f"{title}.md"
    page_path.parent.mkdir(parents=True, exist_ok=True)

    content = f"# {title}\n\n{description}\n\n## Notable Actions\n"
    if bullets:
        content += "\n".join(bullets) + "\n"

    page_path.write_text(content, encoding="utf-8")
    return page_path


def find_existing_page(vault_path: Path, entity_name: str) -> Path | None:
    """Search the vault for an existing page matching entity_name (case-insensitive stem match)."""
    entity_lower = entity_name.lower()
    for md in vault_path.rglob("*.md"):
        if "campaign-site" in md.parts:
            continue
        if md.stem.lower() == entity_lower:
            return md
    return None


def apply_suggestion(vault_path: Path, suggestion: dict) -> bool:
    """Apply a single suggestion to the vault. Returns True if successful."""
    if suggestion["new_page"]:
        name = suggestion["title"].replace("NEW PAGE:", "").strip()

        # Guard: check if a page for this entity already exists before creating a new one
        existing = find_existing_page(vault_path, name)
        if existing:
            print(f"  ⚠ '{name}' already exists at {existing.relative_to(vault_path)} — inserting bullets there instead of creating duplicate")
            content = existing.read_text(encoding="utf-8")
            section = suggestion.get("section", "Notable Actions")
            new_content, changed = insert_bullets(content, section, suggestion["bullets"])
            if changed:
                existing.write_text(new_content, encoding="utf-8")
                print(f"  ✓ {existing.name} — added {len(suggestion['bullets'])} bullet(s) to '{section}'")
                return True
            else:
                print(f"  ⚠ No changes made (duplicate bullets?)")
                return False

        path = create_new_page(
            vault_path, name,
            suggestion.get("description", ""),
            suggestion["bullets"]
        )
        print(f"  ✓ Created new page: {path.relative_to(vault_path)}")
        return True

    if not suggestion["page"]:
        print(f"  ✗ No page path for suggestion: {suggestion['title']}")
        return False

    page_path = vault_path / suggestion["page"]
    if not page_path.exists():
        # Auto-create a stub rather than failing
        page_path.parent.mkdir(parents=True, exist_ok=True)
        title = page_path.stem
        page_path.write_text(f"# {title}\n\n", encoding="utf-8")
        print(f"  ✦ Created stub: {suggestion['page']}")

    content = page_path.read_text(encoding="utf-8")
    new_content, changed = insert_bullets(content, suggestion["section"], suggestion["bullets"])

    if not changed:
        print(f"  ⚠ No changes made to {page_path.name} (duplicate or section mismatch)")
        return False

    page_path.write_text(new_content, encoding="utf-8")
    print(f"  ✓ {page_path.name} — added {len(suggestion['bullets'])} bullet(s) to '{suggestion['section']}'")
    return True


# ── Index.md updater ─────────────────────────────────────────────────────────

# Maps category name → the line prefix to append to in Index.md
INDEX_CATEGORY_MAP = {
    "NPCs":       "- **NPCs:**",
    "PCs":        "- **Player Characters:**",
    "Sephirot":   "- **Sephirot:**",
    "Locations":  "[[Malkuth]]",  # first item on the locations line
    "Items":      "### Items & Artifacts",
    "Factions":   "### Factions",
    "Events":     "### Events",
    "Mechanics":  "### Core Mechanics",
}

def add_to_index(index_path: Path, title: str, category: str, dry_run: bool = False) -> bool:
    """Add [[title]] to the right line in Index.md. Returns True if changed."""
    if not index_path.exists():
        print(f"  ⚠ Index.md not found at {index_path}")
        return False

    content = index_path.read_text(encoding="utf-8")
    wikilink = f"[[{title}]]"

    if wikilink in content:
        print(f"  ⚠ {wikilink} already in Index.md")
        return False

    marker = INDEX_CATEGORY_MAP.get(category)
    if not marker:
        print(f"  ⚠ Unknown category '{category}' — not adding to index")
        return False

    lines = content.split("\n")
    for i, line in enumerate(lines):
        if line.startswith(marker) or (category in ("Locations", "Items", "Factions", "Events", "Mechanics") and marker in line):
            # For bullet-list categories (NPCs, PCs, Sephirot): append to the line
            if category in ("NPCs", "PCs", "Sephirot"):
                lines[i] = line.rstrip() + f" · {wikilink}"
            else:
                # For section-header categories: append after the line
                lines[i] = line + f" · {wikilink}"
            new_content = "\n".join(lines)
            if not dry_run:
                index_path.write_text(new_content, encoding="utf-8")
            print(f"  ✓ Added {wikilink} to Index.md [{category}]")
            return True

    print(f"  ⚠ Could not find marker for '{category}' in Index.md")
    return False


def parse_index_update(suggestions_file: Path) -> tuple[list[tuple[str, str, str]], str]:
    """
    Parse ## Index Update section from wiki_suggestions.md.
    Returns (new_pages, current_state_text) where:
      new_pages = list of (path, category, display_name)
      current_state_text = replacement text for Current State block (or "")
    """
    text = suggestions_file.read_text(encoding="utf-8")

    # Find ## Index Update section
    section_match = re.search(r'^## Index Update\s*$', text, re.MULTILINE)
    if not section_match:
        return [], ""

    section_text = text[section_match.end():]
    # Stop at next ## section
    next_section = re.search(r'^##\s+', section_text, re.MULTILINE)
    if next_section:
        section_text = section_text[:next_section.start()]

    new_pages = []
    for line in section_text.splitlines():
        line = line.strip()
        if line.startswith("NEW:"):
            parts = [p.strip() for p in line[4:].split("|")]
            if len(parts) >= 3:
                new_pages.append((parts[0], parts[1], parts[2]))

    # Extract CURRENT_STATE block
    cs_match = re.search(r'CURRENT_STATE_START\n(.*?)CURRENT_STATE_END', section_text, re.DOTALL)
    current_state = cs_match.group(1).strip() if cs_match else ""

    return new_pages, current_state


def apply_index_update(vault_path: Path, suggestions_file: Path, dry_run: bool = False):
    """Apply Index Update section: add new page links + update Current State."""
    new_pages, current_state = parse_index_update(suggestions_file)
    index_path = vault_path / "Index.md"
    changed = False

    if new_pages:
        print("\nUpdating Index.md with new pages...")
        for page_path, category, display_name in new_pages:
            if add_to_index(index_path, display_name, category, dry_run):
                changed = True

    if current_state:
        print("\nUpdating Current State in Index.md...")
        if index_path.exists():
            content = index_path.read_text(encoding="utf-8")
            # Replace everything from ## 🧭 Current State onward
            cs_section = re.search(r'^## 🧭 Current State.*', content, re.MULTILINE | re.DOTALL)
            if cs_section:
                new_block = f"## 🧭 Current State (End of Known Notes)\n{current_state}\n"
                new_content = content[:cs_section.start()] + new_block
                if not dry_run:
                    index_path.write_text(new_content, encoding="utf-8")
                print(f"  ✓ Updated Current State block")
                changed = True
            else:
                print("  ⚠ Could not find Current State section in Index.md")

    return changed


# ── Main ─────────────────────────────────────────────────────────────────────

def run(session_dir: str, apply_ids: list[int] | None, skip_ids: list[int],
        config_path: str = "config.yaml", dry_run: bool = False):

    session = Path(session_dir)
    suggestions_file = session / "wiki_suggestions.md"

    if not suggestions_file.exists():
        print(f"No wiki_suggestions.md found in {session}")
        sys.exit(1)

    with open(config_path) as f:
        config = yaml.safe_load(f)

    vault_path = (Path(config_path).parent / config["vault_path"]).resolve()
    suggestions = parse_suggestions(suggestions_file)

    if not suggestions:
        print("No suggestions found in wiki_suggestions.md")
        sys.exit(0)

    # Determine which IDs to apply
    if apply_ids is None:
        # --all: apply everything except skipped
        to_apply = [n for n in sorted(suggestions) if n not in skip_ids]
    else:
        to_apply = [n for n in apply_ids if n not in skip_ids]

    if not to_apply:
        print("Nothing to apply.")
        sys.exit(0)

    print(f"\nApplying suggestions: {to_apply}")
    if dry_run:
        print("(DRY RUN — no files will be changed)\n")

    applied = []
    for num in to_apply:
        if num not in suggestions:
            print(f"  ✗ Suggestion #{num} not found")
            continue
        s = suggestions[num]
        print(f"\n[{num}] {s['title']}")
        if not dry_run:
            if apply_suggestion(vault_path, s):
                applied.append(num)
        else:
            print(f"  Would apply to: {s.get('page', 'new page')} — {s['section']}")
            for b in s["bullets"]:
                print(f"    {b}")

    if applied and not dry_run:
        # Git commit the changes
        print(f"\nCommitting {len(applied)} update(s) to vault...")
        session_name = session.name
        commit_msg = f"Session notes ({session_name}): applied wiki updates {applied}"
        # Ensure git identity is set (required in containerised environments)
        subprocess.run(["git", "config", "user.email", "deploy@dnd-transcriber"], cwd=vault_path, capture_output=True)
        subprocess.run(["git", "config", "user.name", "DnD Transcriber"], cwd=vault_path, capture_output=True)
        subprocess.run(["git", "add", "-A"], cwd=vault_path, capture_output=True)
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=vault_path, capture_output=True, text=True
        )
        if result.returncode == 0:
            print(f"  ✓ Committed: {commit_msg}")
        else:
            print(f"  ⚠ Git commit failed: {result.stderr.strip()}")

    # Apply Index.md updates (new page links + current state)
    apply_index_update(vault_path, suggestions_file, dry_run)

    print(f"\nDone. Applied: {applied}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Apply approved wiki suggestions to vault")
    parser.add_argument("session", help="Session directory (e.g. sessions/2026-03-15)")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--all", action="store_true", dest="apply_all",
                        help="Apply all suggestions")
    parser.add_argument("--apply", type=str,
                        help="Comma-separated suggestion IDs to apply (e.g. 1,2,4)")
    parser.add_argument("--skip", type=str, default="",
                        help="Comma-separated suggestion IDs to skip")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without writing files")
    args = parser.parse_args()

    apply_ids = None
    if args.apply:
        apply_ids = [int(x.strip()) for x in args.apply.split(",")]
    elif not args.apply_all:
        parser.error("Specify --all or --apply <ids>")

    skip_ids = [int(x.strip()) for x in args.skip.split(",") if x.strip()]

    run(args.session, apply_ids, skip_ids, args.config, args.dry_run)
