"""
continuity.py — check the campaign wiki against one session.

After a session is analysed (or when the DM asks), Claude reads the session's
summary and transcript next to the vault pages it touches and lists where the
wiki disagrees with what happened: the wiki's account of this session's events,
a fact that can't have changed since (what an item is, who someone's parent
is), or a timeline entry dated to the wrong month. Nothing is changed; the DM
gets a short "check these" list on the session and on the wiki pages.

The prompt lives here (not in a .md) so the worker's self-updater, which syncs
worker/*.py, keeps it current.
"""
import re

PROMPT = """You check a D&D campaign's wiki for continuity errors against one session.

You get the session's date, its summary and its transcript. The wiki is an Obsidian
vault; its page index is below, and you can Read any page by its path under
{vault}/.

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
- anything you can't point to in both the page and the transcript.

Work like this: pick the pages this session's main events and people would appear on,
Read them, and compare. Read a page before reporting anything about it, and quote it
exactly. Prefer a few certain findings over many doubtful ones: at most 8.

Output format, parsed by a program. No preamble, nothing else:

## [1] Short title of the problem
Page: relative/path/from/vault/root.md
Kind: contradiction | date | spelling
Wiki: the page's current wording, quoted exactly (one sentence or bullet)
Session: what actually happened, in one or two plain sentences, ending with the transcript timestamp in brackets, e.g. [1:15:57]
Fix: the corrected wording for the page, as a drop-in replacement for the quoted text

If you find nothing, output exactly: NONE
"""

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


def run_job(job: dict, config: dict, vault, vault_index_block, run_claude) -> list[dict]:
    """Check one session (a job from /worker/continuity-jobs) against the vault
    at `vault`. main.py passes its prompt helpers in. Returns the items."""
    if not vault.is_dir():
        raise RuntimeError(f"vault not found at {vault}: set vault_path in worker.yaml")
    date, month = session_date(job["session_name"])
    system_prompt = PROMPT.format(vault=vault.as_posix(), date=date or "unknown", month=month or "the session's month")
    system_prompt += "\n\n" + vault_index_block(vault)
    message = (
        f"# Session: {job['session_name']} ({date or 'date unknown'})\n\n"
        f"## Summary\n\n{job.get('summary') or '(no summary)'}\n\n"
        f"## Transcript\n\n{job.get('transcript', '')}"
    )
    out = run_claude(system_prompt, message, config)
    return [] if out.strip().upper().startswith("NONE") else parse(out)
