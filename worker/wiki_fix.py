"""
wiki_fix.py — fix the campaign wiki from what players and the DM reported.

On the wiki, members write what's wrong ("Hypatia's regeneration is Aella
Epsilon's, not hers", "the Saints page mixes up Keh's and the Gardener's"). The
server hands the worker every open report once a day (or when the DM asks),
with the wiki's pages as they are now. Claude gets the reports and the pages
they concern, in one tool-free call, and answers each report with exact
find-and-replace edits, or with why it changed nothing. The server applies an
edit only where its text is found exactly once, commits, and keeps each page's
before/after so the DM can undo.

Pages are picked like the continuity check's (worker/continuity.py): the page a
report was made on, pages named in it, and a cheap first call choosing from the
page list for the rest.

The prompt lives here (not in a .md) so the worker's self-updater, which syncs
worker/*.py, keeps it current.
"""
import re
from pathlib import Path

from continuity import page_gist

PROMPT = """You correct a D&D campaign's wiki (an Obsidian vault) from reports written by the
players and the DM. You get the reports, then the wiki pages they concern; each page
starts with its path. The people at the table know their campaign: take a report as
the truth about the campaign, unless the pages themselves clearly show it's mistaken.

For each report:
- Make the smallest edits that fix what it describes. Fix the same mistake wherever
  it appears in the pages you were given: a power credited to the wrong character is
  often wrong on both characters' pages, and two similarly named things are often
  mixed up on several pages.
- When it asks for new content, add it where it belongs in the page's existing
  structure (the abstract paragraph, a "## Timeline" bullet "- **Mon YYYY** — ...",
  a "## Relationships" bullet, a frontmatter property). Match the page's style: plain,
  brief, encyclopedic, present tense for how things stand now.
- Don't add anything the report and the pages don't support. Don't reword text the
  report isn't about.
- Links are [[Exact Page Title]] or [[Exact Page Title|shown text]], to pages that
  exist. Keep frontmatter values that contain links in double quotes.
- Never edit Index.md.
- If a report is unclear, already fixed, or contradicted by the pages, change nothing
  and say why.

Your edits are suggestions the DM reviews one by one before anything changes, so
make each one stand on its own.

Each edit replaces one exact stretch of a page's current text. "old" must be copied
character for character from the page as given (including markdown, quotes and
dashes) and must appear in that page exactly once: include enough of the surrounding
sentence to make it unique. Keep each "old" as short as that allows. "new" is what
replaces it. To add a line, take the line it should follow as "old" and give that
line plus the new one as "new". A report can need several edits, on several pages.

Output format, parsed by a program. Nothing before or after the reports, and one
<report> per report you were given, in order:

<report id="3" result="fixed">
<note>One or two plain sentences for the person who reported it: what these edits change.</note>
<edit page="Characters/NPCs/Hypatia.md">
<old>exact current text</old>
<new>replacement text</new>
</edit>
</report>

<report id="4" result="no_change">
<note>Why nothing was changed.</note>
</report>
"""

MAX_PAGES = 16
SELECT_PROMPT = """You pick which pages of a D&D campaign wiki some reports of mistakes concern.
You get the reports and the wiki's page list (path, then the page's one-line description).
List every page a report is about or that likely repeats the same mistake (for a power
credited to the wrong character: both characters; for two things mixed up: both, and
pages that mention them), most important first, at most {limit}. Output only the paths,
one per line, exactly as listed. Nothing else."""

REPORT_RE = re.compile(r'<report\s+id="(\d+)"\s+result="(\w+)"\s*>(.*?)</report>', re.S)
NOTE_RE = re.compile(r"<note>(.*?)</note>", re.S)
EDIT_RE = re.compile(r'<edit\s+page="([^"]+)"\s*>\s*<old>(.*?)</old>\s*<new>(.*?)</new>\s*</edit>', re.S)
TITLE_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)


def _title(path: str, text: str) -> str:
    m = TITLE_RE.search(text)
    return m[1].strip() if m else Path(path).stem


def pick_pages(reports: list[dict], pages: list[dict], run_claude, config: dict) -> list[str]:
    """The pages the reports were made on, pages they name, then a small first call's choice."""
    by_path = {p["path"]: p for p in pages if p["path"] != "Index.md"}
    chosen: list[str] = [r["page"] for r in reports if r.get("page") in by_path]
    text = "\n".join(r["text"] for r in reports).lower()
    named = sorted((p for p in by_path if len(_title(p, by_path[p]["text"])) > 2
                    and re.search(r"\b" + re.escape(_title(p, by_path[p]["text"]).lower()) + r"\b", text)),
                   key=lambda p: -len(_title(p, by_path[p]["text"])))
    try:
        index = "\n".join(f"{p} — {page_gist(by_path[p]['text'])}" for p in by_path)
        listed = "\n\n".join(f"[{r['id']}]" + (f" (on {r['page']})" if r.get("page") else "") + f" {r['text']}" for r in reports)
        out = run_claude(SELECT_PROMPT.format(limit=MAX_PAGES), f"## Reports\n\n{listed}\n\n## Pages\n\n{index}",
                         config, tools=None, model="haiku")
        picked = [l.strip().strip("-*` ").strip() for l in out.splitlines()]
    except Exception as e:
        if type(e).__name__ == "UsageLimitError":
            raise
        print(f"[wiki-fix]   page selection failed ({str(e)[:120]}); using the reported and named pages")
        picked = []
    for p in named + picked:
        if p in by_path and p not in chosen:
            chosen.append(p)
    return chosen[:MAX_PAGES]


def parse(out: str) -> list[dict]:
    results = []
    for rid, result, body in REPORT_RE.findall(out):
        note = NOTE_RE.search(body)
        edits = [{"page": page.strip(), "old": old.strip("\n"), "new": new.strip("\n")}
                 for page, old, new in EDIT_RE.findall(body)]
        results.append({"id": int(rid), "result": "fixed" if result.lower() == "fixed" else "no_change",
                        "note": note[1].strip() if note else "", "edits": edits})
    return results


def run_job(job: dict, config: dict, run_claude) -> list[dict]:
    """Answer every report in a job from /worker/wiki-fix-job. main.py passes run_claude in."""
    reports, pages = job.get("reports") or [], job.get("pages") or []
    if not reports:
        return []
    if not pages:
        raise RuntimeError("the server sent no wiki pages")
    chosen = pick_pages(reports, pages, run_claude, config)
    by_path = {p["path"]: p["text"] for p in pages}
    listed = "\n\n".join(
        f"[{r['id']}] from {r.get('by') or 'someone'}" + (f", on the page {r['page']}" if r.get("page") else ", about the wiki in general")
        + f":\n{r['text']}" for r in reports)
    page_text = "\n\n".join(f"===== {p} =====\n{by_path[p]}" for p in chosen)
    message = f"# Reports\n\n{listed}\n\n# Wiki pages\n\n{page_text or '(none found)'}"
    print(f"[wiki-fix]   {len(reports)} report(s), {len(chosen)} pages, ~{(len(PROMPT) + len(message)) // 4:,} tokens: "
          + ", ".join(Path(p).stem for p in chosen))
    out = run_claude(PROMPT, message, config, tools=None, model=config.get("wiki_fix_model", "sonnet"))
    results = parse(out)
    if not results:
        raise RuntimeError(f"couldn't read Claude's answer: {out[:200]}")
    return results
