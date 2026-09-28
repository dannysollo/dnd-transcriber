"""
worker/reconstruct.py: a transcript from one mixed recording (no Craig tracks).

For sessions recorded some other way (an OBS capture, a YouTube upload). The
DM uploads the recording and says who was there; this:

  1. transcribes it with Whisper, with word timings;
  2. cuts 1.5 s voice windows over the speech and embeds them (voices.py);
  3. matches them to the voice library's profiles of the people who were
     there, each profile adapted to how that person sounds in this recording;
  4. clusters the speech that matches no one into "Unknown voice N" (as many
     as there were guests without a profile, plus one if a lot is left over);
  5. labels every word by the voice around it, smoothed so the speaker only
     changes where the evidence is clear (cheaper at a pause or a new Whisper
     segment), and groups the words into lines.

Returns the transcript markdown, the low-confidence map the site uses, and
short clips of each unknown voice for the site's "who is this?" step.

The method was worked out on 30 old sessions, scored against Craig
transcripts of the same nights: about 97% of words to the right person.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import numpy as np

import voices
from transcribe import get_speaker_label, looks_hallucinated, vocab_phrases

MATCH_MIN = 0.35        # a window this close to a profile counts as that person
MATCH_MARGIN = 0.08     # ...and this much closer than to anyone else (for adaptation)
UNMATCHED_SHARE = 0.15  # more speech than this matching no one gets an extra unknown voice
MAX_UNKNOWN = 4
SWITCH_COST = 0.2       # Viterbi: changing speaker between words
LINE_GAP = 1.5          # seconds of silence that end a line
LOW_CONF = 0.6
STRETCH = 0.45          # Whisper stretches a word after a pause back into the silence
END_WINDOW = 0.3        # judge a word's speaker from its end


def fmt_ts(t: float) -> str:
    t = int(t)
    h, m, s = t // 3600, t % 3600 // 60, t % 60
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def transcribe_words(model, audio_path: str, vocab_prompt: str) -> list[dict]:
    """Whisper segments with word timings: [{start, end, text, words: [{s, e, w, p}]}]."""
    segs, _info = model.transcribe(
        audio_path, language="en", word_timestamps=True, vad_filter=True,
        initial_prompt=(vocab_prompt or "")[:800] or None, condition_on_previous_text=False,
    )
    out = []
    for s in segs:
        words = [{"s": w.start, "e": w.end, "w": w.word, "p": float(w.probability)} for w in (s.words or [])]
        if words:
            out.append({"start": s.start, "end": s.end, "text": s.text.strip(), "words": words})
        if len(out) % 500 == 0 and out:
            print(f"    transcribed {len(out)} segments, {fmt_ts(s.end)}", flush=True)
    return out


def _windows(a: np.ndarray, segs: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Voiced windows over the speech: (start times, embeddings), in time order."""
    n = int(voices.WIN * voices.SR)
    starts, wins = [], []
    for s in segs:
        st, en = s["start"], s["end"]
        ts = ([max(0.0, (st + en) / 2 - voices.WIN / 2)] if en - st <= voices.WIN else
              [st + k * voices.HOP for k in range(int((en - st - voices.WIN) / voices.HOP) + 1)])
        for t in ts:
            x = a[int(t * voices.SR): int(t * voices.SR) + n]
            x = np.pad(x, (0, n - len(x)))
            if voices._voiced(x) >= 0.5:
                starts.append(t)
                wins.append(x)
    if not wins:
        return np.zeros(0), np.zeros((0, 256), np.float32)
    order = np.argsort(starts)
    print(f"    embedding {len(wins)} voice windows...", flush=True)
    return np.asarray(starts)[order], voices.embed(np.stack(wins)[order])


def reconstruct(recording: Path, model, library: dict, request: dict, vocab_prompt: str = "") -> tuple[str, dict, dict]:
    players = request.get("players") or {}
    people = library.get("people", {})
    # Who can be speaking: attendees with a profile, then unknown voices.
    labels, vectors = [], []
    for key in request.get("attendees", []):
        p = people.get(key)
        if not p or not p.get("vector"):
            continue
        label = get_speaker_label(key, players) if key in players else (p.get("name") or key.split(":", 1)[-1])
        v = np.asarray(p["vector"], np.float32)
        labels.append(label)
        vectors.append(v / (np.linalg.norm(v) + 1e-9))
    no_profile = [k for k in request.get("attendees", []) if not (people.get(k) or {}).get("vector")]
    n_unknown_expected = len(request.get("guests", [])) + len(no_profile)

    print("  Reconstruct: transcribing...", flush=True)
    wav = voices.load_audio(recording)
    segs = transcribe_words(model, str(recording), vocab_prompt)
    vocab = vocab_phrases(vocab_prompt)
    segs = [s for s in segs if not looks_hallucinated(s["text"], vocab)]
    if not segs:
        return "# Session Transcript\n\n*No speech detected.*\n", {"version": 1, "lines": []}, {"voices": []}

    starts, E = _windows(wav, segs)
    del wav
    if len(E) == 0:
        raise RuntimeError("No voiced speech found in the recording")

    M = np.stack(vectors) if vectors else np.zeros((0, E.shape[1]), np.float32)
    if len(M):
        # Adapt each profile to this recording from the windows it clearly owns.
        S = E @ M.T
        order = np.sort(S, 1)
        best = S.argmax(1)
        conf = order[:, -1] >= MATCH_MIN
        if S.shape[1] > 1:
            conf &= (order[:, -1] - order[:, -2]) >= MATCH_MARGIN
        for j in range(len(M)):
            sel = E[conf & (best == j)]
            if len(sel) >= 30:
                v = sel.mean(0)
                M[j] = v / (np.linalg.norm(v) + 1e-9)
        unmatched = (E @ M.T).max(1) < MATCH_MIN
    else:
        unmatched = np.ones(len(E), bool)

    # Speech that matches no one: cluster it into unknown voices.
    k = n_unknown_expected + (1 if unmatched.mean() > UNMATCHED_SHARE else 0)
    k = min(MAX_UNKNOWN, k, int(unmatched.sum()) // 40)
    unknown_labels = []
    if k > 0:
        C, _ = voices._kmeans(E[unmatched], k)
        for c in C:
            unknown_labels.append(f"Unknown voice {len(unknown_labels) + 1}")
            M = np.vstack([M, c / (np.linalg.norm(c) + 1e-9)])
    labels = labels + unknown_labels
    if not labels:
        raise RuntimeError("No voice profiles for anyone who was there, and not enough speech to tell voices apart")
    print(f"  Reconstruct: {len(labels) - len(unknown_labels)} known voice(s), {len(unknown_labels)} unknown", flush=True)
    S = E @ M.T

    # Per-word evidence: the windows around the end of each word.
    words = []
    for si, s in enumerate(segs):
        for j, w in enumerate(s["words"]):
            w = dict(w, seg_start=(j == 0))
            if w["e"] - w["s"] > STRETCH:
                w["s"] = w["e"] - STRETCH
            words.append(w)
    X = np.zeros((len(words), len(labels)), np.float32)
    for i, w in enumerate(words):
        t = (max(w["s"], w["e"] - END_WINDOW) + w["e"]) / 2
        a0, b0 = np.searchsorted(starts, t - voices.WIN), np.searchsorted(starts, t, side="right")
        X[i] = S[a0:b0].mean(0) if b0 > a0 else (X[i - 1] if i else 0)

    # Viterbi over words: a speaker change costs SWITCH_COST (less at a pause
    # or where Whisper started a new segment).
    n = len(labels)
    score = X[0].copy()
    back = np.zeros((len(words), n), np.int32)
    for i in range(1, len(words)):
        p = SWITCH_COST * (1 if words[i]["s"] - words[i - 1]["e"] < LINE_GAP else 0.3)
        if words[i]["seg_start"]:
            p *= 0.5
        cand = score[:, None] - p * (1 - np.eye(n, dtype=np.float32))
        back[i] = cand.argmax(0)
        score = cand.max(0) + X[i]
    path = [int(score.argmax())]
    for i in range(len(words) - 1, 0, -1):
        path.append(int(back[i][path[-1]]))
    who = [labels[j] for j in path[::-1]]

    # Words into lines.
    lines, cur = [], None
    for w, lab in zip(words, who):
        if cur and (lab != cur["label"] or w["s"] - cur["end"] > LINE_GAP):
            lines.append(cur)
            cur = None
        if not cur:
            cur = {"label": lab, "start": w["s"], "end": w["e"], "text": "", "low": []}
        cur["text"] += w["w"]
        cur["end"] = w["e"]
        clean = w["w"].strip().strip(".,!?;:\"()…-")
        if clean and w["p"] < LOW_CONF:
            cur["low"].append({"word": clean, "prob": round(w["p"], 3), "t": round(w["s"], 2)})
    if cur:
        lines.append(cur)
    lines = [l for l in lines if l["text"].strip()]

    md = ["# Session Transcript", ""]
    confidence = []
    for l in lines:
        ts = fmt_ts(l["start"])
        md += [f"**[{ts}] {l['label']}:** {l['text'].strip()}", ""]
        if l["low"]:
            confidence.append({"ts": ts, "speaker": l["label"], "words": l["low"]})

    # Clips of each unknown voice: its longer lines, spread across the session.
    unknown = []
    for lab in unknown_labels:
        mine = [l for l in lines if l["label"] == lab and len(l["text"].split()) >= 4]
        if not mine:
            continue
        mine.sort(key=lambda l: l["start"])
        if len(mine) > 4:  # four spread evenly from first to last
            mine = [mine[round(i * (len(mine) - 1) / 3)] for i in range(4)]
        unknown.append({
            "label": lab,
            "clips": [{"start": round(l["start"], 2), "end": round(min(l["end"], l["start"] + 8), 2),
                       "ts": fmt_ts(l["start"]), "text": l["text"].strip()[:140]} for l in mine],
        })
    counts = Counter(who)
    print("  Reconstruct: " + ", ".join(f"{lab} {c / len(who):.0%}" for lab, c in counts.most_common()), flush=True)
    return "\n".join(md) + "\n", {"version": 1, "lines": confidence}, {"voices": unknown}
