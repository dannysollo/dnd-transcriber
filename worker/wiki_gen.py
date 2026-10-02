"""
worker/wiki_gen.py: write a campaign wiki from its sessions.

Runs when a DM asks for it on the site (server: POST /campaigns/{slug}/wiki/generate).
Two passes with Claude (the same `claude -p` the summaries use):

  1. Entities: read every session summary and list what deserves a page:
     characters, places, factions, events, items, mechanics, each with a
     folder and the other names it goes by. The player characters always get
     one.
  2. Pages: for each entity, the summary paragraphs and wiki-suggestion
     blocks that mention it, turned into one page in the standard format
     (WIKI_FORMAT.md): an abstract, key facts, a timeline of turning points,
     relationships, appearances.

The page list goes back to the site first and the DM picks which to write
(state "review"); the job then comes back with "entities" set and only those
pages are written. Pages go back to the server in small batches, with progress,
so the site can show it filling in. "fill" mode skips anything the wiki already has.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

FOLDERS = ["Characters/PCs", "Characters/NPCs", "Locations", "Factions", "Events", "Items", "Mechanics"]
MAX_PAGES = 150
PARALLEL = 3
CONTEXT_CHARS = 45000      # per page: the relevant excerpts, most recent kept if it's more


def ask_claude(system: str, message: str, scratch_base: str | None = None, timeout: int = 900) -> str:
    """One `claude -p` call (as the summaries do), text out."""
    scratch = tempfile.mkdtemp(prefix="dnd-transcriber-wiki-", dir=scratch_base)
    try:
        prompt = Path(scratch) / "system_prompt.txt"
        prompt.write_text(system, encoding="utf-8")
        r = subprocess.run(
            # No tools: with them, Claude sometimes tried to write the page to a file
            # and answered with a request for permission instead of the page.
            ["claude", "-p", "--system-prompt-file", str(prompt), "--no-session-persistence",
             "--tools", "", "--output-format", "text"],
            input=message, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            encoding="utf-8", timeout=timeout, cwd=scratch,
        )
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError(f"claude -p failed ({r.returncode}): {(r.stderr or r.stdout)[-400:]}")
    return r.stdout.strip()


def _pc_entities(players: dict) -> list[dict]:
    out = []
    for username, info in (players or {}).items():
        info = info or {}
        if info.get("role") == "dm" or not info.get("character"):
            continue
        out.append({"title": info["character"], "folder": "Characters/PCs", "aliases": [],
                    "note": f"Player character, played by {info.get('name', username)}"})
    return out


ENTITY_SYSTEM = """You build the page list for a tabletop campaign's wiki from its session summaries.
Output ONLY a JSON array, no prose. Each item: {"title": ..., "folder": ..., "aliases": [...], "note": ...}
- title: the name as the table uses it (proper noun, no "the" unless it's part of the name).
- folder: one of %s
- aliases: other names or spellings used for the same thing (can be empty).
- note: a few words on what it is.
Include only things that recur or matter to the story: named characters, places, factions, notable
events the table refers back to, named items, and world mechanics. Skip one-off mentions.
At most %d items. Player characters are already covered: don't include them."""


def find_entities(sessions: list[dict], players: dict, scratch: str | None) -> list[dict]:
    corpus = "\n\n".join(f"## {s['name']} ({s['date']})\n{s['summary']}" for s in sessions if s["summary"])
    pcs = _pc_entities(players)
    msg = ("Player characters (already have pages): " + ", ".join(p["title"] for p in pcs) +
           "\n\nSession summaries, oldest first:\n\n" + corpus)
    raw = ask_claude(ENTITY_SYSTEM % (", ".join(FOLDERS), MAX_PAGES), msg, scratch)
    m = re.search(r"\[.*\]", raw, re.S)
    items = json.loads(m.group(0)) if m else []
    seen = {p["title"].lower() for p in pcs}
    out = list(pcs)
    for it in items:
        t = str(it.get("title", "")).strip()
        if not t or t.lower() in seen or any(c in t for c in '/\\:*?"<>|#[]'):
            continue
        folder = it.get("folder") if it.get("folder") in FOLDERS else "Characters/NPCs"
        out.append({"title": t, "folder": folder, "aliases": [str(a) for a in it.get("aliases", []) if a],
                    "note": str(it.get("note", ""))})
        seen.add(t.lower())
    return out[:MAX_PAGES]


def _mentions(text: str, names: list[str]) -> bool:
    low = text.lower()
    return any(re.search(r"\b" + re.escape(n.lower()) + r"\b", low) for n in names if len(n) >= 3)


def context_for(entity: dict, sessions: list[dict]) -> str:
    """The summary paragraphs and wiki-suggestion blocks that mention this entity, by session."""
    names = [entity["title"], *entity["aliases"]]
    parts = []
    for s in sessions:
        paras = [p for p in re.split(r"\n\s*\n", s["summary"]) if _mentions(p, names)]
        blocks = [b for b in re.split(r"\n(?=## )", s["wiki"]) if _mentions(b, names)]
        if paras or blocks:
            parts.append(f"## {s['name']} ({s['date']})\n" + "\n\n".join(paras + blocks))
    text = "\n\n".join(parts)
    return text if len(text) <= CONTEXT_CHARS else "…\n" + text[-CONTEXT_CHARS:]


PAGE_SYSTEM = """You write one page of a tabletop campaign's wiki, following this format guide exactly:

%s

Output ONLY the page's markdown, starting with its properties block ("---" lines) and then "# Title".
Use only facts from the notes you're given.
Link other pages with [[Exact Title]] only when the title is in the list of pages provided."""


def write_page(entity: dict, sessions: list[dict], titles: list[str], fmt: str, scratch: str | None) -> dict | None:
    ctx = context_for(entity, sessions)
    if not ctx and entity["folder"] != "Characters/PCs":
        return None
    msg = (f"Page: {entity['title']}\nFolder: {entity['folder']}\nAlso called: {', '.join(entity['aliases']) or '-'}\n"
           f"What it is: {entity['note'] or '-'}\n\nPages that exist (link only to these):\n"
           + ", ".join(titles) + "\n\nNotes from the sessions that mention it, oldest first:\n\n" + (ctx or "(none yet)"))
    md = ask_claude(PAGE_SYSTEM % fmt, msg, scratch)
    # The page itself, if it came wrapped in explanation and a code fence.
    fenced = re.search(r"```(?:markdown)?\s*\n(.*?)\n```", md, re.S)
    md = (fenced[1] if fenced and not md.lstrip().startswith(("#", "---")) else md).strip()
    md = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", md)
    # Links only to pages that exist (or are being written): others, such as
    # session titles, become plain text rather than broken links.
    known = {t.lower() for t in titles}
    def unlink(m: re.Match) -> str:
        target, _, shown = m[1].partition("|")
        return m[0] if target.strip().lower() in known else (shown or target)
    md = re.sub(r"\[\[([^\]\n]+)\]\]", unlink, md)
    if not md.startswith(("#", "---")):
        md = f"# {entity['title']}\n\n{md}"
    return {"title": entity["title"], "section": entity["folder"], "markdown": md}


def name_keys(name: str) -> set[str]:
    """Loose forms of a page name, so "The Tehom", "Tehom", "Conduit"/"Conduits",
    "Magic 8-Ball"/"The Magic 8 Ball" and "Faerun" (of "Faerun & Bethesda") match."""
    def key(n: str) -> str:
        n = re.sub(r"\s*\(.*?\)", "", n.lower())       # "Canaan Labs (Faction)"
        n = re.sub(r"^the\s+", "", n.strip())
        n = re.sub(r"[^a-z0-9]", "", n)
        return n[:-1] if n.endswith("s") and len(n) > 4 else n
    parts = [name, *re.split(r"\s+&\s+|\s+and\s+", name)] if re.search(r"\s(&|and)\s", name) else [name]
    return {k for k in map(key, parts) if k}


def generate(job: dict, client, config: dict) -> None:
    scratch = config.get("audio_dir") or None
    sessions = sorted(job["sessions"], key=lambda s: s["date"] or s["name"])
    try:
        entities = job.get("entities")
        if entities is None:
            client.wiki_status("running", 0, 0, "Finding who and what deserves a page")
            entities = find_entities(sessions, job.get("players") or {}, scratch)
            if job.get("mode") == "fill":
                # Skip anything an existing page already covers, under any of its names.
                have = {k for n in job.get("existing_names") or job.get("existing", []) for k in name_keys(n)}
                entities = [e for e in entities if not any(k in have for n in [e["title"], *e["aliases"]] for k in name_keys(n))]
            # And no two new pages for the same thing.
            seen, unique = set(), []
            for e in entities:
                keys = {k for n in [e["title"], *e["aliases"]] for k in name_keys(n)}
                if not keys & seen:
                    unique.append(e)
                seen |= keys
            # The DM picks which of these to write; the job comes back with them.
            print(f"[wiki] {len(unique)} pages proposed, waiting for the DM", flush=True)
            client.wiki_status("review", 0, len(unique), f"{len(unique)} page{'' if len(unique) == 1 else 's'} to look over", proposed=unique)
            return
        titles = sorted({*job.get("existing", []), *(e["title"] for e in entities)})
        total = len(entities)
        print(f"[wiki] {total} pages to write", flush=True)
        client.wiki_status("running", 0, total, f"Writing {total} pages")
        done, batch = 0, []
        with ThreadPoolExecutor(PARALLEL) as pool:
            futures = {pool.submit(write_page, e, sessions, titles, job.get("format", ""), scratch): e for e in entities}
            for f in as_completed(futures):
                e = futures[f]
                try:
                    page = f.result()
                    if page:
                        batch.append(page)
                except Exception as ex:
                    print(f"[wiki]   {e['title']}: {ex}", flush=True)
                done += 1
                if len(batch) >= 5 or done == total:
                    if batch:
                        client.push_wiki_pages(batch)
                        batch = []
                    client.wiki_status("running", done, total, f"Written {done} of {total}")
        client.wiki_status("done", done, total, f"Wrote {total} page{'' if total == 1 else 's'}")
        print("[wiki] done", flush=True)
    except Exception as e:
        print(f"[wiki] failed: {e}", flush=True)
        client.wiki_status("error", 0, 0, str(e)[:300])
