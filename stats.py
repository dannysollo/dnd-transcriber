"""
stats.py
Talk-time and campaign statistics computed from finished transcripts.

Everything here is derived by counting: no LLM, and the transcript text is
only read. Talk time is an estimate. The server only has each line's start
time (per-segment end times live on the worker), so a speaker's time is
words spoken / SPEECH_RATE, which is typical conversational pace.
"""
import re
from pathlib import Path

from unknown_words import LINE_RE

SPEECH_RATE = 2.7  # words per second (~160 wpm)
WORD_RE = re.compile(r"[A-Za-z0-9']+")


def parse_timestamp(ts: str) -> int:
    parts = [int(p) for p in ts.split(":")]
    return parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3 else parts[0] * 60 + parts[1]


def split_speaker(label: str | None) -> tuple[str, str]:
    """"Kali [Marko]" -> ("Kali", "Marko"); "DM (Danny)" -> ("DM", "Danny"); else (label, "")."""
    if not label:
        return "", ""
    m = re.match(r"^(.*?)\s*[\[(]([^\])]+)[\])]\s*$", label)
    return (m.group(1).strip(), m.group(2).strip()) if m else (label.strip(), "")


def session_stats(transcript: str) -> dict:
    speakers: dict[str, dict] = {}
    last_ts = 0
    last_words = 0
    total_words = 0
    lines = 0
    for raw in transcript.splitlines():
        m = LINE_RE.match(raw)
        if not m:
            continue
        ts, label, text = m.group(1), m.group(2), m.group(3)
        try:
            start = parse_timestamp(ts)
        except ValueError:
            continue
        words = len(WORD_RE.findall(text))
        lines += 1
        total_words += words
        if start >= last_ts:
            last_ts, last_words = start, words
        name, player = split_speaker(label)
        key = label or "Unknown"
        s = speakers.setdefault(key, {"label": key, "name": name or key, "player": player, "lines": 0, "words": 0})
        s["lines"] += 1
        s["words"] += words
    for s in speakers.values():
        s["seconds"] = round(s["words"] / SPEECH_RATE)
        s["share"] = round(s["words"] / total_words, 4) if total_words else 0
    duration = last_ts + round(last_words / SPEECH_RATE)
    return {
        "duration_seconds": duration,
        "lines": lines,
        "words": total_words,
        "speakers": sorted(speakers.values(), key=lambda s: -s["words"]),
    }


def count_mentions(transcript: str, terms: list[str], exclude: set[str]) -> dict[str, int]:
    """Whole-word, case-insensitive mentions of each known term in the spoken text."""
    candidates = [t for t in terms if len(t) >= 3 and t.lower() not in exclude]
    if not candidates:
        return {}
    # Longest first so "Canaan Labs" wins over "Canaan" at the same position.
    candidates.sort(key=len, reverse=True)
    canon = {t.lower(): t for t in candidates}
    pattern = re.compile(r"\b(" + "|".join(re.escape(t) for t in candidates) + r")\b", re.IGNORECASE)
    spoken = "\n".join(m.group(3) for m in map(LINE_RE.match, transcript.splitlines()) if m)
    counts: dict[str, int] = {}
    for hit in pattern.finditer(spoken):
        key = canon[hit.group(1).lower()]
        counts[key] = counts.get(key, 0) + 1
    return counts


def player_names(config: dict) -> set[str]:
    """Lowercased usernames, names and character names: people, not places or NPCs."""
    out: set[str] = set()
    for username, info in (config.get("players") or {}).items():
        out.add(username.lower())
        for key in ("name", "character"):
            if info and info.get(key):
                out.add(str(info[key]).lower())
    out.add("dm")
    return out


def campaign_stats(sessions: list[dict], terms: list[str], config: dict) -> dict:
    """
    sessions: [{"name", "created_at", "transcript"}] for every session that
    has a transcript. Returns totals, per-session rows, per-person totals and
    the most-mentioned campaign names (people at the table excluded).
    """
    exclude = player_names(config)
    rows = []
    people: dict[str, dict] = {}
    mentions: dict[str, dict] = {}
    for sess in sessions:
        st = session_stats(sess["transcript"])
        rows.append({
            "name": sess["name"],
            "created_at": sess.get("created_at"),
            "duration_seconds": st["duration_seconds"],
            "words": st["words"],
            "lines": st["lines"],
            "speakers": len(st["speakers"]),
        })
        for sp in st["speakers"]:
            # Group by the person at the table when the label names one.
            key = sp["player"] or sp["name"]
            p = people.setdefault(key, {"person": key, "characters": set(), "words": 0, "seconds": 0, "sessions": 0})
            if sp["player"] and sp["name"]:
                p["characters"].add(sp["name"])
            p["words"] += sp["words"]
            p["seconds"] += sp["seconds"]
            p["sessions"] += 1
        for term, n in count_mentions(sess["transcript"], terms, exclude).items():
            e = mentions.setdefault(term, {"name": term, "count": 0, "sessions": 0})
            e["count"] += n
            e["sessions"] += 1

    total_words = sum(r["words"] for r in rows)
    people_list = []
    for p in people.values():
        people_list.append({**p, "characters": sorted(p["characters"]),
                            "share": round(p["words"] / total_words, 4) if total_words else 0})
    people_list.sort(key=lambda p: -p["words"])
    rows.sort(key=lambda r: r.get("created_at") or "")
    return {
        "sessions": len(rows),
        "duration_seconds": sum(r["duration_seconds"] for r in rows),
        "words": total_words,
        "per_session": rows,
        "people": people_list,
        "mentions": sorted(mentions.values(), key=lambda e: -e["count"])[:15],
    }
