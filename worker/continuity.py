"""
continuity.py — check the campaign wiki against one session (on demand).

The DM asks for it (a session's Wiki tab, or "Check sessions" on the wiki).
Claude gets the session's summary, short transcript excerpts around the moments
the summary cites, and the wiki pages the session touches, all in one prompt,
and lists where the wiki disagrees with what happened: the wiki's account of
this session's events, a fact that can't have changed since (what an item is,
who someone's parent is), or a timeline entry dated to the wrong month. Nothing
is changed; the DM gets a short "check these" list on the session and on the
wiki pages.

Kept cheap on purpose: one turn with no tools (letting Claude open pages itself
resent the whole context on every read), the summary instead of the whole
transcript, and only the pages the summary names. ~20-30k tokens a session
instead of several hundred thousand.

The prompt lives here (not in a .md) so the worker's self-updater, which syncs
worker/*.py, keeps it current.
"""
import re
from pathlib import Path

PROMPT = """You check a D&D campaign's wiki for continuity errors against one session.

You get the session's date, its summary, short transcript excerpts around the moments
the summary cites, and the wiki pages this session touches (an Obsidian vault; each
page starts with its path). Judge only from what's given here.

Find places where a wiki page states something this session contradicts:
- the wiki's account of an event that happens in this session is wrong (who did it,
  what it was, how it went),
- a fact that can't have changed later is wrong (what an item is or where it came
  from, who someone is, a family tie, a name's spelling),
- a timeline entry for an event in this session carries the wrong date. Timeline
  entries are labelled by the month of the session they happen in ("{month}" for this
  session, which is on {date}); "Early 2025" / "Before 2025" mean before the first
  recorded session.

Do NOT report:
- things the wiki doesn't mention yet (a separate step suggests additions),
- current states that later sessions may have changed (someone alive then, dead now;
  an item held then, lost now). The wiki describes the campaign as of today, and
  many sessions come after this one,
- differences in wording, emphasis or detail that aren't actual contradictions,
- anything the summary or excerpts don't clearly support. The summary can be
  loose; when it and an excerpt disagree, the excerpt wins.

Quote the page exactly. Prefer a few certain findings over many doubtful ones: at most 8.

Output format, parsed by a program. No preamble, nothing else:

## [1] Short title of the problem
Page: relative/path/from/vault/root.md
Kind: contradiction | date | spelling
Wiki: the page's current wording, quoted exactly (one sentence or bullet)
Session: what actually happened, in one or two plain sentences, ending with the transcript timestamp in brackets, e.g. [1:15:57]
Fix: the corrected wording for the page, as a drop-in replacement for the quoted text

If you find nothing, output exactly: NONE
"""

MAX_PAGES = 18          # the most relevant pages
PAGE_CHARS = 3500       # longer pages keep their head and this session's timeline entries
EXCERPT_BEFORE, EXCERPT_AFTER = 20, 100   # seconds of transcript around each cited moment
EXCERPTS_CHARS = 24000

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ITEM_RE = re.compile(r"^## \[(\d+)\]\s*(.+?)\s*$", re.MULTILINE)
FIELD_RE = re.compile(r"^(Page|Kind|Wiki|Session|Fix):\s*(.*)$")
TS_RE = re.compile(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*\.?\s*$")


def session_date(name: str) -> tuple[str, str]:
    """("2026-09-26", "Sep 2026") from "9-26-2026 -- In Another Life"; blanks if unparseable."""
    m = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})", name)
    if not m:
        return "", ""
    mo, d, y = int(m[1]), int(m[2]), int(m[3])
    return f"{y}-{mo:02d}-{d:02d}", f"{MONTHS[mo - 1]} {y}"


def parse(text: str) -> list[dict]:
    """The items in Claude's output, or [] for NONE / nothing parseable."""
    items = []
    heads = list(ITEM_RE.finditer(text))
    for i, h in enumerate(heads):
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        fields: dict[str, str] = {}
        last = None
        for line in body.strip().splitlines():
            m = FIELD_RE.match(line.strip())
            if m:
                last = m[1].lower()
                fields[last] = m[2].strip()
            elif last and line.strip():
                fields[last] += " " + line.strip()  # a field wrapped onto the next line
        if not fields.get("page") or not fields.get("wiki") or not fields.get("session"):
            continue
        session = fields["session"]
        ts = TS_RE.search(session)
        kind = fields.get("kind", "contradiction").split("|")[0].strip().lower()
        items.append({
            "title": h[2].strip(),
            "page": fields["page"].strip().strip("`"),
            "kind": kind if kind in ("contradiction", "date", "spelling") else "contradiction",
            "wiki": fields["wiki"].strip().strip('"'),
            "session": TS_RE.sub("", session).strip(),
            "ts": ts[1] if ts else None,
            "fix": fields.get("fix", "").strip().strip('"') or None,
        })
    return items



# ── What goes in the prompt ──────────────────────────────────────────────────

FRONT_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
ALIASES_RE = re.compile(r"^aliases:\s*\[(.*?)\]\s*$", re.M)
TIMELINE_RE = re.compile(r"^## Timeline\n(.*?)(?=^## |\Z)", re.S | re.M)
LINE_RE = re.compile(r"^\*\*\[([^\]]+)\] [^:]+:\*\* ")
CITE_RE = re.compile(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]")


def _secs(ts: str) -> int:
    s = 0
    for x in ts.split(":"):
        s = s * 60 + int(x)
    return s


def vault_pages(vault: Path) -> list[tuple[str, list[str], str]]:
    """(relative path, names it goes by, text) for every page but the index."""
    out = []
    for p in sorted(vault.rglob("*.md")):
        if "campaign-site" in p.parts or ".git" in p.parts or p.name in ("README.md", "Index.md"):
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        # "Faerun & Bethesda" also answers to "Faerun" and "Bethesda".
        names = [p.stem] + ([x.strip() for x in re.split(r"\s+&\s+|\s+and\s+", p.stem)] if " & " in p.stem or " and " in p.stem else [])
        front = FRONT_RE.match(text)
        if front:
            m = ALIASES_RE.search(front[1])
            if m:
                names += [a.strip().strip("\"'") for a in m[1].split(",") if a.strip()]
        out.append((p.relative_to(vault).as_posix(), names, text))
    return out


def pick_pages(summary: str, pages: list, suggested: set[str] = frozenset(), excerpt: str = "",
               limit: int = MAX_PAGES) -> list:
    """The pages this session touches, most relevant first: the ones its wiki
    suggestions name, then by how often the summary (and, less, the transcript
    excerpts) name them by title or alias."""
    def count(name: str, text: str) -> int:
        return len(re.findall(r"(?<![\w'])" + re.escape(name) + r"(?![\w])", text, re.I)) if len(name) >= 3 else 0
    # Pages linked from the suggested ones: the summary may call them something
    # else ("the smith", "the hilt"), and their page is where a mix-up would sit.
    by_name = {nm.lower(): rel for rel, names, _ in pages for nm in names}
    linked = {by_name[t.split("|")[0].strip().lower()] for rel, _, text in pages if rel in suggested
              for t in re.findall(r"\[\[([^\]]+)\]\]", text) if t.split("|")[0].strip().lower() in by_name}
    scored = []
    for rel, names, text in pages:
        # Mentions count up to a point: a name repeated all through the summary
        # shouldn't crowd out a page this session is actually about.
        n = (6 if rel in suggested else 0) + (3 if rel in linked else 0) \
            + min(3, sum(count(nm, summary) for nm in names)) + min(1.5, 0.5 * sum(count(nm, excerpt) for nm in names))
        if n:
            scored.append((n, rel, names, text))
    scored.sort(key=lambda x: -x[0])
    return [(rel, names, text) for _, rel, names, text in scored[:limit]]


def trim_page(text: str, month: str) -> str:
    """A long page: its head (properties, title, lead) and the timeline entries for
    this session's month; the rest is left out."""
    if len(text) <= PAGE_CHARS:
        return text
    tl = TIMELINE_RE.search(text)
    head = text[:tl.start()] if tl else text
    head = head[:PAGE_CHARS - 600] + ("\n[…]\n" if len(head) > PAGE_CHARS - 600 else "")
    entries = [l for l in (tl[1].splitlines() if tl else []) if month and f"**{month}**" in l]
    return head + ("\n## Timeline (this session's month only)\n" + "\n".join(entries) + "\n" if entries else "")


def excerpts(summary: str, transcript: str) -> str:
    """Transcript lines around each moment the summary cites."""
    lines = []
    for l in transcript.splitlines():
        m = LINE_RE.match(l)
        if m:
            lines.append((_secs(m[1]), l))
    cited = sorted({_secs(t) for t in CITE_RE.findall(summary)})
    keep: list[int] = []
    for t in cited:
        keep += [i for i, (s, _) in enumerate(lines) if t - EXCERPT_BEFORE <= s <= t + EXCERPT_AFTER]
    out, last, size = [], None, 0
    for i in sorted(set(keep)):
        if last is not None and i != last + 1:
            out.append("…")
        out.append(lines[i][1])
        size += len(lines[i][1])
        last = i
        if size > EXCERPTS_CHARS:
            out.append("… (excerpts cut here)")
            break
    return "\n".join(out)


SELECT_PROMPT = """You pick which pages of a D&D campaign wiki a session touches.
You get the session's summary and the wiki's page list (path, then the page's one-line
description). List the pages whose subject takes part in or is changed by this
session's events, most important first, at most {limit}. The summary may describe
someone instead of naming them ("the smith", "the hilt"): use the descriptions.
Output only the paths, one per line, exactly as listed. Nothing else."""
DESCRIPTOR_RE = re.compile(r"^\*([^*\n]+)\*\s*$", re.M)


def page_gist(text: str, lead_chars: int = 160) -> str:
    """A page's one-line description and the start of its first paragraph."""
    m = DESCRIPTOR_RE.search(text)
    desc = m[1].strip() if m else ""
    body = text[m.end():] if m else FRONT_RE.sub("", text)
    lead = next((l.strip() for l in body.splitlines() if l.strip() and not l.startswith(("#", "-", "|", "*"))), "")
    lead = re.sub(r"\[\[([^\]|]+\|)?([^\]]+)\]\]", r"\2", lead)
    return f"{desc}. {lead[:lead_chars]}" if lead else desc


def select_pages(summary: str, pages: list, run_claude, config: dict, limit: int = MAX_PAGES) -> list[str]:
    """A small first call (the cheapest model): which pages this session touches,
    from the summary and the page list with each page's one-line description."""
    index = "\n".join(f"{rel} — {page_gist(text)}" for rel, _, text in pages)
    out = run_claude(SELECT_PROMPT.format(limit=limit), f"## Summary\n\n{summary}\n\n## Pages\n\n{index}",
                     config, tools=None, model="haiku")
    known = {rel for rel, _, _ in pages}
    picked = []
    for line in out.splitlines():
        rel = line.strip().strip("-*` ").strip()
        if rel in known and rel not in picked:
            picked.append(rel)
    return picked[:limit]


def build_prompt(job: dict, vault: Path, run_claude=None, config: dict | None = None) -> tuple[str, str, list[str]]:
    """(system prompt, message, page paths included). With run_claude, the pages
    are picked by a small first call; otherwise (or if that fails) by counting
    names, the wiki suggestions and links."""
    date, month = session_date(job["session_name"])
    summary = job.get("summary") or ""
    ex = excerpts(summary, job.get("transcript", ""))
    suggested = set(re.findall(r"^Page:\s*(.+?\.md)\s*$", job.get("wiki") or "", re.M))
    pages = vault_pages(vault)
    by_rel = {rel: (rel, names, text) for rel, names, text in pages}
    guessed = pick_pages(summary, pages, suggested, ex)
    picked: list[str] = []
    if run_claude:
        try:
            picked = select_pages(summary, pages, run_claude, config or {})
        except Exception as e:
            if type(e).__name__ == "UsageLimitError":
                raise
            print(f"[continuity]   page selection failed ({str(e)[:120]}); picking by names instead")
    # The suggested pages always; then the selection; then the name count fills any room.
    order = [r for r in suggested if r in by_rel] + picked + [rel for rel, _, _ in guessed]
    chosen = []
    for rel in order:
        if rel not in chosen:
            chosen.append(rel)
    chosen = [by_rel[r] for r in chosen[:MAX_PAGES]]
    pages = "\n\n".join(f"===== {rel} =====\n{trim_page(text, month)}" for rel, _, text in chosen)
    system = PROMPT.format(date=date or "unknown", month=month or "the session's month")
    message = (
        f"# Session: {job['session_name']} ({date or 'date unknown'})\n\n"
        f"## Summary\n\n{summary or '(no summary)'}\n\n"
        f"## Transcript excerpts (around the moments the summary cites)\n\n{ex or '(none)'}\n\n"
        f"## Wiki pages this session touches\n\n{pages or '(none found)'}"
    )
    return system, message, [rel for rel, _, _ in chosen]


def run_job(job: dict, config: dict, vault: Path, run_claude) -> list[dict]:
    """Check one session (a job from /worker/continuity-jobs) against the vault at
    `vault`, in one tool-free call. main.py passes run_claude in. Returns the items."""
    if not vault.is_dir():
        raise RuntimeError(f"vault not found at {vault}: set vault_path in worker.yaml")
    if not (job.get("summary") or "").strip():
        return []  # nothing to check against: the session hasn't been analysed
    system, message, pages = build_prompt(job, vault, run_claude, config)
    print(f"[continuity]   {len(pages)} pages, ~{(len(system) + len(message)) // 4:,} tokens: "
          + ", ".join(Path(r).stem for r in pages))
    out = run_claude(system, message, config, tools=None)
    return [] if out.strip().upper().startswith("NONE") else parse(out)
