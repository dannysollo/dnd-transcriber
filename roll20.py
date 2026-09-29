"""
roll20.py — dice rolls from a Roll20 chat archive, placed in the session recordings.

Import: the DM saves the campaign's Chat Archive ("Show on One Page", then save the
page as HTML) and uploads it. Every message has a Firebase push ID, whose first 8
characters encode when it was sent (ms since the epoch), so each roll has an exact
time even where the page shows none. Imports merge by message ID, so re-uploading a
newer archive only adds what's new.

Placement: a session's recording doesn't know its wall-clock start, so it's found
from the rolls themselves. For each candidate start time, count the rolls whose total
(or natural d20) someone says out loud within a few seconds to 45 s after the roll.
The best start wins; it's trusted when it clearly beats the best one more than five
minutes away. Checked against seven OBS recordings with a known start: within 2-39 s,
about 20 s early on average (corrected below).
"""
import html
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
TZ = ZoneInfo("America/Chicago")   # which evening a roll belongs to (sessions run past midnight)
SAID_BEFORE, SAID_AFTER = 10, 45   # a number said this long before/after a roll counts as it
BIAS = 20                          # measured: the best offset comes out ~20 s early
MIN_SCORE, MIN_RATIO = 4.0, 1.8    # trusted when it clearly beats the runner-up


def push_ms(message_id: str) -> int:
    ms = 0
    for c in message_id[:8]:
        ms = ms * 64 + PUSH_CHARS.index(c)
    return ms


# ── Parsing the archive ──────────────────────────────────────────────────────

def parse_archive(text: str) -> list[dict]:
    """Rolls and chat messages from a saved Chat Archive page, oldest first."""
    out, last_by = [], {}
    for chunk in text.split('<div class="message ')[1:]:
        cls = chunk[:chunk.index('"')] if '"' in chunk else ""
        mid = re.search(r'data-messageid="([^"]+)"', chunk)
        if not mid:
            continue
        pid_m = re.search(r'data-playerid="([^"]+)"', chunk)
        pid = pid_m[1] if pid_m else None
        by = re.search(r'<span class="by">([^<]*)</span>', chunk)
        if by:
            last_by[pid] = html.unescape(by[1]).strip().rstrip(":").strip()
        kind = cls.split()[0] if cls else ""
        if kind != "rollresult":
            continue  # chat text isn't kept, only rolls
        try:
            ms = push_ms(mid[1])
        except ValueError:
            continue
        formula = re.search(r'<div class="formula" [^>]*>rolling ([^<]*)</div>', chunk)
        total = re.search(r'<div class="rolled">([^<]*)</div>', chunk)
        dice = [(int(d), int(v)) for d, v in
                re.findall(r'class="diceroll d(\d+)[^"]*"><div class="dicon"><div class="didroll">(\d+)</div>', chunk)]
        out.append({
            "id": mid[1], "ms": ms, "player": pid, "by": last_by.get(pid),
            "private": " private" in f" {cls} ",
            "formula": html.unescape(formula[1]).strip() if formula else None,
            "total": total[1].strip() if total else None,
            "dice": dice,
        })
    return sorted(out, key=lambda r: r["ms"])


# ── Who rolled ───────────────────────────────────────────────────────────────

def guess_players(rolls: list[dict], players: dict) -> dict:
    """Roll20 player id -> campaign username, from the names they rolled under
    (their own, or their character's: "Marko K.", "Aella", "Junoooo (GM)")."""
    names: dict[str, set] = {}
    for r in rolls:
        if r.get("player") and r.get("by"):
            names.setdefault(r["player"], set()).add(r["by"])
    def word(s):
        return re.sub(r"[^a-z]", "", (s or "").lower().split("(")[0].split()[0] if (s or "").strip() else "")
    out = {}
    for pid, ns in names.items():
        for u, info in players.items():
            keys = {word((info or {}).get("name")), word((info or {}).get("character"))} - {""}
            # A prefix counts both ways ("Junoooo"/"Juno", "Bell"/"Belle"), but not from a lone initial ("M L.").
            if any(len(w) >= 3 and any(w == k or (len(k) >= 4 and (w.startswith(k) or k.startswith(w))) for k in keys)
                   for w in map(word, ns)):
                out[pid] = u
                break
    return out


# ── Placing a session's rolls ────────────────────────────────────────────────

WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen twenty".split())}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
LINE_RE = re.compile(r"^\*\*\[([^\]]+)\] ([^:]+):\*\* (.*)$")


def _secs(ts: str) -> int:
    s = 0
    for x in ts.split(":"):
        s = s * 60 + int(x)
    return s


def spoken_numbers(text: str) -> set[int]:
    t = text.lower().replace("-", " ")
    out = {int(x) for x in re.findall(r"\b\d{1,3}\b", t)}
    toks = re.findall(r"[a-z]+", t)
    for i, w in enumerate(toks):
        if w in TENS:
            nxt = WORDS.get(toks[i + 1], 0) if i + 1 < len(toks) else 0
            out.add(TENS[w] + (nxt if 0 < nxt < 10 else 0))
        elif w in WORDS and not (i > 0 and toks[i - 1] in TENS):
            out.add(WORDS[w])
    return out


def transcript_lines(transcript: str) -> list[tuple[int, str, str]]:
    """(seconds, timestamp, speaker) per speech line, with each line's spoken numbers kept alongside."""
    out = []
    for l in transcript.splitlines():
        m = LINE_RE.match(l)
        if m:
            out.append((_secs(m[1]), m[1], m[2], spoken_numbers(m[3])))
    return out


def values(r: dict) -> set[int]:
    v = set()
    try:
        v.add(int(r["total"]))
    except (TypeError, ValueError):
        pass
    v.update(val for d, val in r.get("dice", []) if d == 20)
    return v


def session_date(name: str):
    m = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})", name)
    return datetime(int(m[3]), int(m[1]), int(m[2])) if m else None


def session_rolls(all_rolls: list[dict], name: str) -> list[dict]:
    """The rolls of the session's evening: noon on its date to noon the next day."""
    d = session_date(name)
    if not d:
        return []
    start = datetime(d.year, d.month, d.day, 12, tzinfo=TZ)
    a, b = start.timestamp() * 1000, (start + timedelta(days=1)).timestamp() * 1000
    return [r for r in all_rolls if a <= r["ms"] < b]


def align(lines: list, rolls: list[dict]) -> dict | None:
    """The recording's wall-clock start (epoch seconds) and how sure that is."""
    if not rolls or not lines:
        return None
    dur = lines[-1][0]
    times = [r["ms"] / 1000 for r in rolls]
    lo, hi = int(min(times) - dur - 600), int(max(times) + 600)
    size = hi - lo + 2
    diff = [0.0] * (size + 1)          # a difference array: += w over each roll's intervals
    by_num: dict[int, list[int]] = {}
    for t, _, _, nums in lines:
        for n in nums:
            by_num.setdefault(n, []).append(t)
    for r, rt in zip(rolls, times):
        vals = values(r)
        if not vals:
            continue
        w = sum(1.0 if v >= 5 else 0.3 for v in vals) / len(vals)
        spans = sorted((max(int(rt - m - SAID_AFTER) - lo, 0), min(int(rt - m + SAID_BEFORE) - lo, size))
                       for v in vals for m in by_num.get(v, []))
        merged = []
        for a, b in spans:
            if b <= a:
                continue
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        for a, b in merged:            # each roll counts once however many lines say its number
            diff[a] += w
            diff[b] -= w
    grid, acc = [], 0.0
    for x in diff[:size]:
        acc += x
        grid.append(acc)
    best = max(grid)
    k = grid.index(best)
    j = k
    while j + 1 < size and grid[j + 1] == best:
        j += 1
    runner = max((g for i, g in enumerate(grid) if abs(i - k) > 300), default=0.0)
    t0 = lo + (k + j) / 2 + BIAS
    return {"start": t0, "score": round(best, 1), "runner_up": round(runner, 1),
            "trusted": best >= MIN_SCORE and best >= MIN_RATIO * max(runner, 1.0)}


def place(lines: list, rolls: list[dict], start: float) -> list[dict]:
    """Each roll's second in the recording and the line it goes with: the line
    right after it that says its number, when there is one, else the line playing then."""
    by_num: dict[int, list[int]] = {}
    for i, (t, _, _, nums) in enumerate(lines):
        for n in nums:
            by_num.setdefault(n, []).append(i)
    out = []
    for r in rolls:
        at = r["ms"] / 1000 - start
        said = [i for v in values(r) for i in by_num.get(v, []) if at - SAID_BEFORE <= lines[i][0] <= at + SAID_AFTER]
        if said:
            idx = min(said, key=lambda i: abs(lines[i][0] - (at + 5)))
        else:
            idx = max((i for i, l in enumerate(lines) if l[0] <= at), default=0)
        out.append({**r, "at": round(at, 1), "line_ts": lines[idx][1] if lines else None, "said": bool(said)})
    return out


# ── Storage ──────────────────────────────────────────────────────────────────

def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"rolls": [], "players": {}}


def merge(existing: dict, new_rolls: list[dict]) -> tuple[dict, int]:
    have = {r["id"] for r in existing.get("rolls", [])}
    added = [r for r in new_rolls if r["id"] not in have]
    existing["rolls"] = sorted(existing.get("rolls", []) + added, key=lambda r: r["ms"])
    return existing, len(added)
