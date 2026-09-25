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

from unknown_words import LINE_RE, VOCAB_MARKER, _english

SPEECH_RATE = 2.7  # words per second (~160 wpm)
RECAP_SECONDS = 600  # speeches starting in the first 10 minutes don't count as records: that's usually the recap
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
        s = speakers.setdefault(key, {"label": key, "name": name or key, "player": player, "lines": 0, "words": 0,
                                      "questions": 0, "exclamations": 0, "laughs": 0, "longest": 0})
        s["lines"] += 1
        s["words"] += words
        s["questions"] += text.count("?")
        s["exclamations"] += text.count("!")
        s["laughs"] += laugh_count(text)
        s["longest"] = max(s["longest"], words)
    duration = last_ts + round(last_words / SPEECH_RATE)
    for s in speakers.values():
        s["seconds"] = round(s["words"] / SPEECH_RATE)
        s["share"] = round(s["words"] / total_words, 4) if total_words else 0
        # words per minute of the session: how much they contribute over the night
        s["words_per_minute"] = round(s["words"] / (duration / 60), 1) if duration > 60 else 0
    return {
        "duration_seconds": duration,
        "lines": lines,
        "words": total_words,
        "words_per_minute": round(total_words / (duration / 60), 1) if duration > 60 else 0,
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


def player_names(config: dict, transcripts=()) -> set[str]:
    """
    Lowercased usernames, names and character names: people, not places or NPCs.
    Also every name used in a speaker label, so a renamed character (an old
    "Vixeena [Sue]" after the config says Vikranth) is still a person here.
    """
    out: set[str] = set()
    for username, info in (config.get("players") or {}).items():
        out.add(username.lower())
        for key in ("name", "character"):
            if info and info.get(key):
                out.add(str(info[key]).lower())
    for t in transcripts:
        for m in map(LINE_RE.match, t.splitlines()):
            if m and m.group(2):
                for part in split_speaker(m.group(2)):
                    if part:
                        out.add(part.lower())
    out.add("dm")
    return out


def campaign_stats(sessions: list[dict], terms: list[str], config: dict) -> dict:
    """
    sessions: [{"name", "created_at", "transcript"}] for every session that
    has a transcript. Returns totals, per-session rows, per-person totals and
    the most-mentioned campaign names (people at the table excluded).
    """
    exclude = player_names(config, [s["transcript"] for s in sessions])
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
            p = people.setdefault(key, {"person": key, "characters": set(), "words": 0, "seconds": 0, "sessions": 0, "session_seconds": 0})
            if sp["player"] and sp["name"]:
                p["characters"].add(sp["name"])
            p["words"] += sp["words"]
            p["seconds"] += sp["seconds"]
            if sess["name"] not in p.setdefault("_seen", set()):
                p["_seen"].add(sess["name"])
                p["sessions"] += 1
                p["session_seconds"] += st["duration_seconds"]
        for term, n in count_mentions(sess["transcript"], terms, exclude).items():
            e = mentions.setdefault(term, {"name": term, "count": 0, "sessions": 0, "first_session": sess["name"]})
            e["count"] += n
            e["sessions"] += 1

    new_names: dict[str, int] = {}
    for e in mentions.values():
        new_names[e["first_session"]] = new_names.get(e["first_session"], 0) + 1
    for r in rows:
        r["new_names"] = new_names.get(r["name"], 0)

    total_words = sum(r["words"] for r in rows)
    people_list = []
    for p in people.values():
        p.pop("_seen", None)
        people_list.append({**p, "characters": sorted(p["characters"]),
                            "share": round(p["words"] / total_words, 4) if total_words else 0,
                            "words_per_minute": round(p["words"] / (p["session_seconds"] / 60), 1) if p["session_seconds"] > 60 else 0})
    people_list.sort(key=lambda p: -p["words"])
    rows.sort(key=lambda r: r.get("created_at") or "")
    return {
        "sessions": len(rows),
        "duration_seconds": sum(r["duration_seconds"] for r in rows),
        "words": total_words,
        "words_per_minute": round(total_words / (sum(r["duration_seconds"] for r in rows) / 60), 1) if sum(r["duration_seconds"] for r in rows) > 60 else 0,
        "per_session": rows,
        "people": people_list,
        "mentions": sorted(mentions.values(), key=lambda e: -e["count"])[:15],
    }


# ─── Deeper campaign stats: records, per-player profiles, quirks ─────────────

LAUGH_RE = re.compile(r"^(?:(?:ha){2,}h?|(?:he){2,}|lol|lmao|lmfao|rofl)$", re.I)
SIG_WORD_RE = re.compile(r"[a-z]{4,}")
WHOLE_WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)*")


def wiki_terms(config: dict, vault_path: Path | None = None) -> list[str]:
    """
    Proper nouns from the campaign wiki only: the vault Index.md wikilinks and
    the vocab prompt's noun list (itself scraped from the index). Correction
    targets are deliberately left out: some are phrases ("Belle will"), not
    names.
    """
    terms: set[str] = set()
    vocab = config.get("vocab_prompt") or ""
    idx = vocab.find(VOCAB_MARKER)
    if idx != -1:
        terms.update(t.strip().rstrip(".") for t in vocab[idx + len(VOCAB_MARKER):].split(","))
    if vault_path and (vault_path / "Index.md").exists():
        index = (vault_path / "Index.md").read_text(encoding="utf-8")
        terms.update(m.strip() for m in re.findall(r"\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]", index))
    return sorted(t for t in terms if t and len(t) > 1)


def parse_lines(transcript: str) -> list[dict]:
    out = []
    for raw in transcript.splitlines():
        m = LINE_RE.match(raw)
        if not m:
            continue
        try:
            start = parse_timestamp(m.group(1))
        except ValueError:
            continue
        name, player = split_speaker(m.group(2))
        text = m.group(3)
        out.append({
            "ts": m.group(1), "start": start, "name": name or (m.group(2) or ""), "player": player,
            "person": player or name or "Unknown", "text": text, "words": len(WORD_RE.findall(text)),
        })
    return out


def _excerpt(text: str, n: int = 28) -> str:
    words = text.split()
    return " ".join(words[:n]) + ("…" if len(words) > n else "")


def campaign_details(sessions: list[dict], terms: list[str], config: dict, quotes: list[dict]) -> dict:
    """
    Records, per-person profiles and trends across all transcribed sessions.
    sessions: [{"name", "created_at", "transcript"}], oldest first.
    """
    exclude = player_names(config, [s["transcript"] for s in sessions])
    _, _, everyday = _english()
    names_lower = {t.lower(): t for t in terms if t.lower() not in exclude}
    name_re = re.compile(r"\b(" + "|".join(re.escape(t) for t in sorted(names_lower.values(), key=len, reverse=True)) + r")\b", re.I) if names_lower else None

    records: dict[str, dict] = {}
    people: dict[str, dict] = {}
    all_pairs: dict[tuple[str, str], int] = {}
    top_speeches: list[dict] = []
    pace: dict[int, dict] = {}
    rules_by_session: list[dict] = []
    nat20s: dict[str, int] = {}
    name_by_session: dict[str, dict[str, int]] = {}
    dm_people: set[str] = set()
    all_word_counts: dict[str, int] = {}
    total_sig_words = 0
    session_order = [s["name"] for s in sessions]

    def person(key: str) -> dict:
        return people.setdefault(key, {
            "person": key, "characters": set(), "sessions": 0, "words": 0, "seconds": 0,
            "shares": {}, "questions": 0, "exclamations": 0, "laughs": 0,
            "names": {}, "word_counts": {}, "word_sessions": {}, "sig_total": 0, "quoted": 0, "mech_words": 0,
        })

    for sess in sessions:
        lines = parse_lines(sess["transcript"])
        if not lines:
            continue
        sess_words = sum(l["words"] for l in lines)
        duration = lines[-1]["start"] + round(lines[-1]["words"] / SPEECH_RATE)
        per_person_words: dict[str, int] = {}
        sess_laughs = 0
        sess_mech = mechanics_words(lines)
        rules_by_session.append({"session": sess["name"], "share": round(sess_mech / sess_words, 4) if sess_words else 0})
        for l in lines:
            if is_mechanics(l["text"]):
                person(l["person"])["mech_words"] += l["words"]
            if NAT20_RE.search(l["text"]):
                nat20s[l["person"]] = nat20s.get(l["person"], 0) + 1
        for pair, n in exchange_pairs(lines).items():
            all_pairs[pair] = all_pairs.get(pair, 0) + n
        for i, words in enumerate(pace_buckets(lines, PACE_BUCKET_CAMPAIGN)):
            b = pace.setdefault(i, {"words": 0, "minutes": 0.0, "sessions": 0})
            b["words"] += words
            b["minutes"] += min(PACE_BUCKET_CAMPAIGN, max(0, duration - i * PACE_BUCKET_CAMPAIGN)) / 60
            b["sessions"] += 1
        for l in lines:
            if l["name"].lower() == "dm":
                dm_people.add(l["person"])

        prev = None
        for l in lines:
            p = person(l["person"])
            if l["player"] and l["name"]:
                p["characters"].add(l["name"])
            per_person_words[l["person"]] = per_person_words.get(l["person"], 0) + l["words"]
            p["questions"] += l["text"].count("?")
            p["exclamations"] += l["text"].count("!")
            laughs = laugh_count(l["text"])
            p["laughs"] += laughs
            sess_laughs += laughs
            for w in SIG_WORD_RE.findall(l["text"].lower()):
                if w in everyday or w in exclude:
                    continue
                p["word_counts"][w] = p["word_counts"].get(w, 0) + 1
                p["word_sessions"].setdefault(w, set()).add(sess["name"])
                p["sig_total"] += 1
                all_word_counts[w] = all_word_counts.get(w, 0) + 1
                total_sig_words += 1
            if name_re:
                for hit in name_re.finditer(l["text"]):
                    key = names_lower[hit.group(1).lower()]
                    p["names"][key] = p["names"].get(key, 0) + 1
                    per_sess = name_by_session.setdefault(key, {})
                    per_sess[sess["name"]] = per_sess.get(sess["name"], 0) + 1

            # Longest single line
            r = records.get("longest_monologue")
            if l["start"] >= RECAP_SECONDS and (not r or l["words"] > r["words"]):
                records["longest_monologue"] = {"person": l["person"], "character": l["name"], "session": sess["name"],
                                                "ts": l["ts"], "words": l["words"], "seconds": round(l["words"] / SPEECH_RATE),
                                                "excerpt": _excerpt(l["text"])}
            # Longest silence (start gap minus the previous line's speaking time)
            if prev:
                gap = l["start"] - prev["start"] - prev["words"] / SPEECH_RATE
                r = records.get("longest_silence")
                if gap > 0 and (not r or gap > r["seconds"]):
                    records["longest_silence"] = {"session": sess["name"], "ts": prev["ts"], "resumed_at": l["ts"], "seconds": round(gap),
                                                  "broken_by": l["person"]}
            prev = l

        for sp in longest_speeches(lines):
            top_speeches.append({"session": sess["name"], **sp})

        live = liveliest_exchange(lines)
        r = records.get("liveliest_exchange")
        if live and (not r or live["turns"] > r["turns"]):
            records["liveliest_exchange"] = {"session": sess["name"], **live}

        r = records.get("funniest_night")
        if sess_laughs and (not r or sess_laughs > r["laughs"]):
            records["funniest_night"] = {"session": sess["name"], "laughs": sess_laughs}

        wpm = sess_words / (duration / 60) if duration > 60 else 0
        r = records.get("chattiest_session")
        if wpm and (not r or wpm > r["words_per_minute"]):
            records["chattiest_session"] = {"session": sess["name"], "words_per_minute": round(wpm), "duration_seconds": duration}

        for key, w in per_person_words.items():
            p = person(key)
            p["sessions"] += 1
            p["words"] += w
            p["seconds"] += round(w / SPEECH_RATE)
            p["shares"][sess["name"]] = round(w / sess_words, 4) if sess_words else 0
            r = records.get("biggest_night")
            if not r or w > r["words"]:
                records["biggest_night"] = {"person": key, "session": sess["name"], "words": w, "seconds": round(w / SPEECH_RATE)}

    # Quotes: who gets quoted most
    for q in quotes:
        name, player = split_speaker(q.get("speaker"))
        key = player or name
        if key in people:
            people[key]["quoted"] += 1

    total_words = sum(p["words"] for p in people.values()) or 1
    profiles = []
    for p in people.values():
        if p["words"] == 0:
            continue
        # Signature words: said far more often than the table's baseline.
        sig = []
        # A signature word has to recur: said in at least 3 sessions, and in at
        # least a fifth of the sessions this person was at. One session's topic
        # (a word said 20 times the night of the Mer tree) doesn't count.
        min_sessions = max(3, -(-p["sessions"] // 5))
        for w, c in p["word_counts"].items():
            if c < 6 or len(p["word_sessions"].get(w, ())) < min_sessions:
                continue
            rate = c / max(1, p["sig_total"])
            base = all_word_counts[w] / max(1, total_sig_words)
            sig.append((rate / base, c, w))
        sig.sort(reverse=True)
        profiles.append({
            "person": p["person"],
            "characters": sorted(p["characters"]),
            "sessions": p["sessions"],
            "words": p["words"],
            "seconds": p["seconds"],
            "share": round(p["words"] / total_words, 4),
            "average_share": round(sum(p["shares"].values()) / len(p["shares"]), 4) if p["shares"] else 0,
            "share_by_session": [{"session": s, "share": p["shares"].get(s)} for s in session_order],
            "questions": p["questions"],
            "exclamations": p["exclamations"],
            "laughs": p["laughs"],
            "quoted": p["quoted"],
            "rules_share": round(p["mech_words"] / p["words"], 4),
            "favorite_names": [{"name": n, "count": c} for n, c in sorted(p["names"].items(), key=lambda kv: -kv[1])[:3]],
            "signature_words": [{"word": w, "count": c} for _, c, w in sig[:5] if _ >= 1.5],
        })
    profiles.sort(key=lambda p: -p["words"])

    # The quietest regular's best night (regular: at least half the sessions).
    regulars = [p for p in profiles if p["sessions"] >= max(1, len(session_order) // 2)]
    if len(regulars) > 1:
        quiet = min(regulars, key=lambda p: p["share"])
        best = max((x for x in quiet["share_by_session"] if x["share"] is not None), key=lambda x: x["share"], default=None)
        if best:
            records["quiet_ones_best_night"] = {"person": quiet["person"], "session": best["session"], "share": best["share"],
                                                "usual_share": quiet["average_share"]}
    most_q = max(profiles, key=lambda p: p["questions"], default=None)
    if most_q and most_q["questions"]:
        records["most_curious"] = {"person": most_q["person"], "questions": most_q["questions"]}
    most_quoted = max(profiles, key=lambda p: p["quoted"], default=None)
    if most_quoted and most_quoted["quoted"]:
        records["most_quoted"] = {"person": most_quoted["person"], "quoted": most_quoted["quoted"]}

    # Name-dropper: most different wiki names mentioned, players only (the DM narrates the world).
    players_only = [p for p in profiles if p["person"] not in dm_people]
    dropper = max(players_only, key=lambda p: len(people[p["person"]]["names"]), default=None)
    if dropper and len(people[dropper["person"]]["names"]) >= 3:
        records["name_dropper"] = {"person": dropper["person"], "names": len(people[dropper["person"]]["names"])}

    if rules_by_session:
        crunch = max(rules_by_session, key=lambda r: r["share"])
        if crunch["share"] > 0:
            avg = sum(r["share"] for r in rules_by_session) / len(rules_by_session)
            records["crunchiest_night"] = {"session": crunch["session"], "share": crunch["share"], "average_share": round(avg, 4)}
    lawyer = max((p for p in players_only if p["words"] >= 2000), key=lambda p: p["rules_share"], default=None)
    if lawyer and lawyer["rules_share"] > 0:
        records["rules_lawyer"] = {"person": lawyer["person"], "share": lawyer["rules_share"]}
    if nat20s:
        caller, n = max(nat20s.items(), key=lambda kv: kv[1])
        records["nat20s"] = {"total": sum(nat20s.values()), "person": caller, "count": n}

    # Names over time: the most-mentioned names, mentions per session, and
    # whether they're coming up more (or less) in the latest third of sessions.
    name_trends = []
    top_names = sorted(name_by_session.items(), key=lambda kv: -sum(kv[1].values()))[:8]
    k = max(1, len(session_order) // 3)
    for name, per in top_names:
        counts = [per.get(s, 0) for s in session_order]
        recent = sum(counts[-k:]) / k
        before = sum(counts[:-k]) / max(1, len(counts) - k)
        trend = None
        if len(session_order) >= 4:
            if recent >= 2 * max(before, 1) and recent >= 5:
                trend = "rising"
            elif before >= 5 and recent <= before / 3:
                trend = "fading"
        name_trends.append({"name": name, "counts": counts, "total": sum(counts), "trend": trend})

    pairs = [{"a": a, "b": b, "count": n} for (a, b), n in sorted(all_pairs.items(), key=lambda kv: -kv[1])[:8]]
    pace_rows = []
    for i in sorted(pace):
        b = pace[i]
        if b["minutes"] < 5:
            continue
        pace_rows.append({"start": i * PACE_BUCKET_CAMPAIGN, "sessions": b["sessions"], "wpm": round(b["words"] / b["minutes"])})
    records.pop("longest_monologue", None)
    return {"records": records, "profiles": profiles, "session_order": session_order,
            "longest_speeches": sorted(top_speeches, key=lambda x: -x["words"])[:3],
            "exchanges": pairs, "pace": pace_rows, "rules_by_session": rules_by_session, "name_trends": name_trends}


# ─── One session in depth ────────────────────────────────────────────────────

PACE_BUCKET_SESSION = 600    # seconds: pace per 10 minutes within a session
PACE_BUCKET_CAMPAIGN = 1800  # seconds: pace per half hour across sessions
BREAK_SECONDS = 180          # a gap this long reads as a break, not a pause


def session_details(transcript: str, terms: list[str], config: dict,
                    earlier: list[str], all_rows: list[dict], other_transcripts: list[str] | None = None) -> dict:
    """
    Moments, pace, breaks, conversation pairs, names and a comparison with the
    rest of the campaign, for the Stats tab of one session.
    earlier: transcripts of sessions added before this one (for first mentions).
    all_rows: campaign_stats()["per_session"] for every session, this one included.
    """
    lines = parse_lines(transcript)
    if not lines:
        return {}
    duration = lines[-1]["start"] + round(lines[-1]["words"] / SPEECH_RATE)
    total_words = sum(l["words"] for l in lines)
    moments: dict[str, dict] = {}

    top_speeches = longest_speeches(lines)
    live = liveliest_exchange(lines)
    if live:
        moments["liveliest_exchange"] = live

    breaks = []
    silence = None
    for prev, l in zip(lines, lines[1:]):
        gap = l["start"] - prev["start"] - prev["words"] / SPEECH_RATE
        if gap >= BREAK_SECONDS:
            breaks.append({"ts": prev["ts"], "resumed_at": l["ts"], "seconds": round(gap), "resumed_by": l["person"]})
        elif gap > 0 and (not silence or gap > silence["seconds"]):
            # Breaks are listed on their own; the silence record is the longest pause mid-play.
            silence = {"ts": prev["ts"], "resumed_at": l["ts"], "seconds": round(gap), "broken_by": l["person"]}
    if silence and silence["seconds"] >= 5:
        moments["longest_silence"] = silence

    # Laughiest minute: most laughs in any 60-second window.
    laughs = [(l["start"], laugh_count(l["text"]), l["ts"]) for l in lines]
    best, j, window = None, 0, 0
    for i, (start, n, ts) in enumerate(laughs):
        window += n
        while laughs[j][0] < start - 60:
            window -= laughs[j][1]
            j += 1
        if n and (not best or window > best["laughs"]):
            best = {"ts": laughs[j][2], "laughs": window}
    if best and best["laughs"] >= 2:
        moments["laughiest_minute"] = best

    asks: dict[str, int] = {}
    for l in lines:
        asks[l["person"]] = asks.get(l["person"], 0) + l["text"].count("?")
    curious = max(asks.items(), key=lambda kv: kv[1], default=None)
    if curious and curious[1]:
        moments["most_curious"] = {"person": curious[0], "questions": curious[1]}

    substantive = [l for l in lines if l["words"] >= 3] or lines
    moments["opening_line"] = {"person": substantive[0]["person"], "character": substantive[0]["name"],
                               "ts": substantive[0]["ts"], "excerpt": _excerpt(substantive[0]["text"])}
    moments["closing_line"] = {"person": substantive[-1]["person"], "character": substantive[-1]["name"],
                               "ts": substantive[-1]["ts"], "excerpt": _excerpt(substantive[-1]["text"])}

    pace = []
    for i, words in enumerate(pace_buckets(lines, PACE_BUCKET_SESSION)):
        minutes = min(PACE_BUCKET_SESSION, duration - i * PACE_BUCKET_SESSION) / 60
        if minutes >= 2:
            pace.append({"start": i * PACE_BUCKET_SESSION, "words": words, "wpm": round(words / minutes)})

    pairs = [{"a": a, "b": b, "count": n} for (a, b), n in sorted(exchange_pairs(lines).items(), key=lambda kv: -kv[1])[:6]]

    # Names from the wiki: how often, first said when, and whether it's the campaign's first time.
    exclude = player_names(config, [transcript, *earlier])
    names = []
    candidates = sorted((t for t in terms if len(t) >= 3 and t.lower() not in exclude), key=len, reverse=True)
    if candidates:
        name_re = re.compile(r"\b(" + "|".join(re.escape(t) for t in candidates) + r")\b", re.I)
        canon = {t.lower(): t for t in candidates}
        seen_before = {canon[h.group(1).lower()] for t in earlier for h in name_re.finditer(t)}
        found: dict[str, dict] = {}
        for l in lines:
            for h in name_re.finditer(l["text"]):
                key = canon[h.group(1).lower()]
                e = found.setdefault(key, {"name": key, "count": 0, "first_ts": l["ts"], "first_by": l["person"],
                                           "new": key not in seen_before})
                e["count"] += 1
        names = sorted(found.values(), key=lambda e: -e["count"])

    comparison = None
    others = [r for r in all_rows if r["duration_seconds"] > 60]
    if len(others) >= 2:
        by_length = sorted(others, key=lambda r: -r["duration_seconds"])
        rank = next((i + 1 for i, r in enumerate(by_length) if r["duration_seconds"] <= duration), len(by_length))
        wpm_all = [r["words"] / (r["duration_seconds"] / 60) for r in others]
        comparison = {
            "rank": rank, "of": len(others),
            "average_duration_seconds": round(sum(r["duration_seconds"] for r in others) / len(others)),
            "wpm": round(total_words / (duration / 60)) if duration > 60 else 0,
            "average_wpm": round(sum(wpm_all) / len(wpm_all)),
        }

    # Rules and dice: this session's share against the campaign's, per speaker, and the nat 20s.
    other_lines = [parse_lines(t) for t in (other_transcripts or [])]
    share = mechanics_words(lines) / total_words if total_words else 0
    other_shares = [mechanics_words(ol) / max(1, sum(l["words"] for l in ol)) for ol in other_lines if ol]
    per_person: dict[str, list[int]] = {}
    for l in lines:
        acc = per_person.setdefault(l["person"], [0, 0])
        acc[1] += l["words"]
        if is_mechanics(l["text"]):
            acc[0] += l["words"]
    rules = {
        "share": round(share, 4),
        "average_share": round(sum(other_shares) / len(other_shares), 4) if other_shares else None,
        "by_person": {p: round(m / w, 4) for p, (m, w) in per_person.items() if w},
        "nat20s": [{"ts": l["ts"], "person": l["person"], "excerpt": _excerpt(l["text"], 16)} for l in lines if NAT20_RE.search(l["text"])],
    }
    skip = player_names(config, [transcript]) | {t.lower() for t in terms}
    words_of_night = distinctive_words(lines, other_lines, skip) if other_lines else []

    return {"moments": moments, "longest_speeches": top_speeches, "pace": pace, "breaks": breaks, "exchanges": pairs,
            "rules": rules, "words_of_night": words_of_night,
            "names": names[:15], "new_names": [n for n in sorted(names, key=lambda n: parse_timestamp(n["first_ts"])) if n["new"]],
            "comparison": comparison}


# ─── Shared counting helpers ─────────────────────────────────────────────────

# Rules and dice talk. The table rolls on a dice bot, so this counts what's
# said about the rules (checks, saves, damage, spell slots), not every roll.
# A line counts if it has one unambiguous term, or two looser ones.
MECH_STRONG = re.compile(
    r"\b(d(?:4|6|8|10|12|20|100)|initiative|(?:dis)?advantage|saving throws?|spell slots?|hit points?|hp|"
    r"armor class|bonus action|cantrips?|proficiency|modifier|nat(?:ural)? ?(?:1|20|one|twenty)|crit(?:ical)?s?|"
    r"roll(?:s|ed|ing)?|perception|stealth|athletics|insight|investigation)\b", re.I)
MECH_WEAK = re.compile(r"\b(saves?|checks?|damage|ac|reaction|concentration|attacks?|dc|plus|minus|hits?|misses)\b", re.I)
NAT20_RE = re.compile(r"\bnat(?:ural)?\s*(?:20|twenty)\b", re.I)


def is_mechanics(text: str) -> bool:
    return bool(MECH_STRONG.search(text)) or len(MECH_WEAK.findall(text)) >= 2


def mechanics_words(lines: list[dict]) -> int:
    return sum(l["words"] for l in lines if is_mechanics(l["text"]))


def distinctive_words(lines: list[dict], others: list[list[dict]], skip: set[str], n: int = 10) -> list[dict]:
    """
    Words that set this session apart: said often here, rarely in the other
    sessions (tf-idf over sessions). Everyday English, the people at the
    table and wiki names are left out, so what's left is the night's jargon,
    running jokes and one-off subjects.
    """
    import math
    _, _, everyday = _english()
    # Speakers' own names (characters and players) are never the night's words.
    skip = skip | {x.lower() for l in lines for x in (l["name"], l["person"]) if x}
    def counts(ls: list[dict]) -> dict[str, int]:
        out: dict[str, int] = {}
        for l in ls:
            for w in WHOLE_WORD_RE.findall(l["text"].lower()):
                if len(w) < 4 or "'" in w:  # contractions ("doesn't") aren't subjects
                    continue
                if w not in everyday and w not in skip and not (w.endswith("s") and w[:-1] in skip):
                    out[w] = out.get(w, 0) + 1
        return out
    here = counts(lines)
    seen_in = [set(counts(o)) for o in others]
    total = len(others) + 1
    scored = []
    for w, c in here.items():
        if c < 4:
            continue
        df = 1 + sum(1 for s in seen_in if w in s)
        scored.append((c * math.log(total / df + 1), c, w))
    scored.sort(reverse=True)
    return [{"word": w, "count": c} for _, c, w in scored[:n]]


INTERJECTION_WORDS = 3     # another person's line this short doesn't end a speech...
INTERJECTION_LINES = 2     # ...nor do two of them in a row...
RESUME_GAP = 6.0           # ...as long as the speaker picks up again within this many seconds


def speeches(lines: list[dict]) -> list[dict]:
    """
    Every stretch one person held the floor: their consecutive lines, carrying
    on through short interjections ("yeah", "wait what") and short pauses.
    A line on its own is a speech too. Seconds are the real span, from the
    first line's start to the estimated end of the last.
    """
    out = []
    i = 0
    while i < len(lines):
        first = lines[i]
        who = first["person"]
        words, texts, heard = first["words"], [first["text"]], 0
        end = first["start"] + first["words"] / SPEECH_RATE
        j = i + 1
        while j < len(lines):
            k, skipped = j, 0
            while k < len(lines) and lines[k]["person"] != who and lines[k]["words"] <= INTERJECTION_WORDS and skipped < INTERJECTION_LINES:
                k += 1; skipped += 1
            if k < len(lines) and lines[k]["person"] == who and lines[k]["start"] - end <= RESUME_GAP:
                words += lines[k]["words"]; texts.append(lines[k]["text"]); heard += skipped
                end = max(end, lines[k]["start"] + lines[k]["words"] / SPEECH_RATE)
                j = k + 1
            else:
                break
        out.append({"person": who, "character": first["name"], "ts": first["ts"], "start": first["start"], "words": words,
                    "seconds": round(end - first["start"]), "interjections": heard, "excerpt": _excerpt(" ".join(texts))})
        i = j if j > i + 1 else i + 1
    return out


def longest_speeches(lines: list[dict], n: int = 3) -> list[dict]:
    """The n longest speeches after the recap (the first RECAP_SECONDS)."""
    return sorted(speeches([l for l in lines if l["start"] >= RECAP_SECONDS]), key=lambda s: -s["words"])[:n]


def longest_overall_speech(lines: list[dict]) -> dict | None:
    top = longest_speeches(lines, 1)
    return top[0] if top else None


def laugh_count(text: str) -> int:
    return sum(1 for tok in WORD_RE.findall(text) if LAUGH_RE.match(tok))


def exchange_pairs(lines: list[dict]) -> dict[tuple[str, str], int]:
    """Back-and-forth between two people: each change of speaker counts once for the pair."""
    out: dict[tuple[str, str], int] = {}
    for prev, l in zip(lines, lines[1:]):
        if prev["person"] != l["person"]:
            pair = tuple(sorted((prev["person"], l["person"])))
            out[pair] = out.get(pair, 0) + 1
    return out


def pace_buckets(lines: list[dict], size: int) -> list[int]:
    """Words spoken in each `size`-second stretch of the session."""
    out: list[int] = []
    for l in lines:
        i = l["start"] // size
        while len(out) <= i:
            out.append(0)
        out[i] += l["words"]
    return out


def liveliest_exchange(lines: list[dict]) -> dict | None:
    """Most speaker changes inside any 60-second window."""
    turns_at = [i for i in range(1, len(lines)) if lines[i]["person"] != lines[i - 1]["person"]]
    best, j = None, 0
    for i, idx in enumerate(turns_at):
        while lines[turns_at[j]]["start"] < lines[idx]["start"] - 60:
            j += 1
        count = i - j + 1
        if not best or count > best["turns"]:
            best = {"ts": lines[turns_at[j]]["ts"], "turns": count,
                    "speakers": len({lines[k]["person"] for k in range(turns_at[j] - 1, idx + 1)})}
    return best
