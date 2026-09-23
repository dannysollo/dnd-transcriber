"""
unknown_words.py
Deterministic helpers for keeping the `corrections` list up to date — no LLM
involved, the transcript text is never rewritten here. Two entry points:

  find_unknown_words(transcript, ...)  words in a finished transcript that look
      like misheard proper nouns: not ordinary English, not a known campaign
      term. Each comes with a suggested correction target when it's close to
      a known term, so the reviewer can turn it into a rule in one click.

  suggest_rules_from_edit(old, new)    when someone hand-fixes a line, the
      word-level substitutions they made, as candidate `corrections` entries.
"""
import difflib
import gzip
import re
from functools import lru_cache
from pathlib import Path

WORD_RE = re.compile(r"[A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z]")
LINE_RE = re.compile(r"^\*\*\[([^\]]+)\](?: ([^:]+))?:?\*\* (.*)$")
VOCAB_MARKER = "Campaign proper nouns include: "
ENGLISH_WORDS_PATH = Path(__file__).parent / "english_words.tsv.gz"
# Zipf frequency (wordfreq scale: ~1 = one per billion words, ~6 = "the") at
# or above which a word counts as everyday English. Below it but still in the
# list (>= 1.5) it's a real-but-rare word: kudzu, golem, prestidigitation.
COMMON_ZIPF = 3.0
# Words this frequent ("here", "center", "session") are never treated as a
# misheard name even when capitalized oddly — Whisper gets them right far more
# often than a campaign name happens to sound like one. "Canon" (4.1) and
# "Nicole" (4.0) sit below it, so those mishearings still get caught.
EVERYDAY_ZIPF = 4.5


@lru_cache(maxsize=1)
def _english() -> tuple[frozenset[str], frozenset[str], frozenset[str]]:
    """(all real words, common words, everyday words) — lazy, since it's ~170k entries."""
    real, common, everyday = set(), set(), set()
    with gzip.open(ENGLISH_WORDS_PATH, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            word, zipf = line.rstrip("\n").split("\t")
            real.add(word)
            if float(zipf) >= COMMON_ZIPF:
                common.add(word)
            if float(zipf) >= EVERYDAY_ZIPF:
                everyday.add(word)
    return frozenset(real), frozenset(common), frozenset(everyday)


def _in(words: frozenset[str], w: str) -> bool:
    return w in words or (w.endswith("s") and w[:-1] in words)


def _norm(word: str) -> str:
    w = word.lower()
    return w[:-2] if w.endswith("'s") else w


def known_terms(config: dict, vault_path: Path | None = None) -> list[str]:
    """
    Campaign proper nouns we already know how to spell: the vocab prompt's
    noun list, the vault Index.md wikilinks (uncapped, unlike vocab_prompt),
    correction targets, and player/character names.
    """
    terms: set[str] = set()
    vocab = config.get("vocab_prompt") or ""
    idx = vocab.find(VOCAB_MARKER)
    if idx != -1:
        vocab = vocab[idx + len(VOCAB_MARKER):]
    terms.update(t.strip().rstrip(".") for t in vocab.split(","))

    if vault_path and (vault_path / "Index.md").exists():
        index = (vault_path / "Index.md").read_text(encoding="utf-8")
        terms.update(m.strip() for m in re.findall(r"\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]", index))

    terms.update(str(v) for v in (config.get("corrections") or {}).values())
    for username, info in (config.get("players") or {}).items():
        terms.add(username)
        for key in ("name", "character"):
            if info and info.get(key):
                terms.add(str(info[key]))
    return sorted(t for t in terms if t and len(t) > 1)


def _sound_initial(w: str) -> str:
    """First letter, folding the usual ASR swaps (Canaan/Kanaan, Phoebe/Febe)."""
    if w.startswith("ph"):
        return "f"
    return {"c": "k", "q": "k", "z": "s"}.get(w[0], w[0])


def _suggest(word: str, targets: dict[str, str], cutoff: float, strict: bool = False) -> str | None:
    """
    Closest spelling-target term, or None. strict (used when `word` is itself
    a real English word) also requires the same leading sound and a target of
    4+ letters — short names like "Pei" otherwise pull in "Pepsi".
    """
    for match in difflib.get_close_matches(word, list(targets), n=3, cutoff=cutoff):
        if not strict or (len(match) >= 4 and _sound_initial(match) == _sound_initial(word)):
            return targets[match]
    return None


def find_unknown_words(
    transcript: str,
    terms: list[str],
    ignored: list[str] | None = None,
    confidence: dict | None = None,
    max_examples: int = 3,
) -> list[dict]:
    """
    Returns [{word, count, low_conf_count, suggestion, examples: [{line, ts, text}]}],
    most actionable first.

    A word is flagged when it's either
      - not a real English word (even a rare one) and not part of a known term, or
      - capitalized mid-sentence and a near-miss of a known term (catches
        mishearings that happen to be real words: "Canon" for "Canaan").
    """
    real, common, everyday = _english()
    known = {t.lower() for t in terms}
    for t in terms:
        known.update(w.lower() for w in WORD_RE.findall(t))
    # Suggestion targets: single-word terms as-is (names like "Nico" or
    # "Canaan" are targets even though they're also English words), plus the
    # distinctive words of multi-word terms — ordinary words inside those
    # ("Trading" in "Trading Post") would make every capitalized "Training"
    # look like a near miss.
    targets = {}
    for t in terms:
        words = WORD_RE.findall(t)
        for w in words:
            if len(w) >= 3 and (len(words) == 1 or not _in(common, w.lower())):
                targets.setdefault(w.lower(), w)
    ignored_set = {w.lower() for w in (ignored or [])}

    low_conf_by_ts: dict[str, set[str]] = {}
    for entry in (confidence or {}).get("lines", []):
        bucket = low_conf_by_ts.setdefault(entry.get("ts", ""), set())
        bucket.update(_norm(w["word"].strip(".,!?;:\"")) for w in entry.get("words", []))

    found: dict[str, dict] = {}
    for line_no, raw in enumerate(transcript.splitlines(), start=1):
        m = LINE_RE.match(raw)
        if not m:
            continue
        ts, speaker, text = m.group(1), m.group(2), m.group(3)
        low_conf_here = low_conf_by_ts.get(ts, set())
        for wm in WORD_RE.finditer(text):
            word = wm.group(0)
            key = _norm(word)
            if len(key) < 3 or key in ignored_set or key in known:
                continue
            if _in(real, key):
                # A real word — only interesting as a mishearing of a known
                # name: capitalized mid-sentence (Whisper thought it was a
                # name too) and close to one. "Canon" -> "Canaan".
                before = text[:wm.start()].rstrip()
                if not word[0].isupper() or not before or before[-1] in ".?!\"…":
                    continue
                if len(key) < 4 or _in(everyday, key):
                    continue
                suggestion = _suggest(key, targets, cutoff=0.72, strict=True)
                if not suggestion:
                    continue
            else:
                suggestion = _suggest(key, targets, cutoff=0.7)

            entry = found.get(key)
            if entry is None:
                entry = found[key] = {
                    "word": word if word[0].isupper() else key,
                    "count": 0, "low_conf_count": 0,
                    "suggestion": suggestion, "examples": [],
                }
            entry["count"] += 1
            if key in low_conf_here:
                entry["low_conf_count"] += 1
            if len(entry["examples"]) < max_examples:
                entry["examples"].append({"line": line_no, "ts": ts, "speaker": speaker, "text": text})

    results = list(found.values())
    # Near-misses of known terms first (most likely real errors, and one click
    # to fix), then anything Whisper itself was unsure of, then by frequency.
    results.sort(key=lambda e: (e["suggestion"] is None, -e["low_conf_count"], -e["count"], e["word"].lower()))
    return results


def suggest_rules_from_edit(old_line: str, new_line: str, max_words: int = 3) -> list[dict]:
    """
    Word-level substitutions between a line before and after a hand edit, as
    candidate correction rules: [{wrong, right, common_word}].

    Only short replacements (<= max_words on each side) that actually change
    letters are offered — punctuation/whitespace-only tweaks and rewrites of
    whole phrases aren't useful as global find/replace rules. common_word flags
    rules whose `wrong` side is ordinary English (e.g. "Canon"), since a
    campaign-wide whole-word replace of it could misfire elsewhere.
    """
    def body(line: str) -> str:
        m = LINE_RE.match(line)
        return m.group(3) if m else line

    old_words = WORD_RE.findall(body(old_line))
    new_words = WORD_RE.findall(body(new_line))
    _, common, _ = _english()
    rules = []
    matcher = difflib.SequenceMatcher(None, [w.lower() for w in old_words], [w.lower() for w in new_words], autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "replace":
            continue
        if (i2 - i1) > max_words or (j2 - j1) > max_words:
            continue
        wrong = " ".join(old_words[i1:i2])
        right = " ".join(new_words[j1:j2])
        if wrong.lower() == right.lower():
            continue
        rules.append({
            "wrong": wrong,
            "right": right,
            "common_word": all(_in(common, _norm(w)) for w in old_words[i1:i2]),
        })
    return rules
