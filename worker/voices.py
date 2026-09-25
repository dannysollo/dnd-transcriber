"""
voices.py — shared mics and the campaign voice library.

When two people talk into one mic (e.g. both DMs), Craig records them as one
track and every line would go to the track's owner. Right after Whisper has
transcribed each track, and before the tracks are merged into the transcript,
this module works out which segments of a shared track are the other person's
and relabels just those segments. No transcript text is changed.

Declare a shared mic in the campaign config, on the player who has no track of
their own:

    players:
      thatscinerd:
        name: Juno
        role: dm
        shares_mic_with: dannysollo

How it works:
  1. Speaker embeddings (WeSpeaker ResNet34, the official ONNX export) for
     1.5 s windows over every stretch Whisper heard. Mostly-silent windows are
     skipped: Discord gates the mic, so much of a Craig track is silence.
  2. The shared track's windows are clustered into a few voices (one person
     can be several clusters, e.g. a normal voice and NPC voices). Each cluster
     is named from the campaign voice library: it goes to a sharer only if it
     clearly sounds like them rather than the owner.
  3. A segment moves to the sharer when it matches the sharer's clusters better
     than the owner's by a clear margin and has at least two words.
  4. The library (one profile per person, stored on the server) is updated
     from every track that has only one person on it, so it improves each
     session. A sharer's profile is also updated from confidently split segments.

The model (~26 MB, CC-BY-4.0, by WeSpeaker, on Hugging Face) is downloaded once
into the worker's data folder. Dependencies: onnxruntime, plus torchaudio (for
the fbank features) and soundfile, which the worker already uses.
"""
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
MODEL_URL = "https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx"
MODEL_FILE = "voxceleb_resnet34_LM.onnx"
MODEL_ID = "wespeaker-voxceleb-resnet34-LM"
SR = 16000
WIN, HOP = 1.5, 0.5          # seconds
CLUSTERS = 4                 # voices looked for on a shared track
MIN_CLUSTER = 0.025          # clusters under 2.5% of the speech fold into a neighbour
CLUSTER_MIN_SIM = 0.25       # a cluster must be at least this close to the sharer's profile...
CLUSTER_MARGIN = 0.1         # ...and this much closer than to the owner's
SEGMENT_MARGIN = 0.2         # a segment moves only when the sharer's voices win by this much
LIBRARY_SAMPLE = 800         # windows per track used to update the library
LIBRARY_MAX_WEIGHT = 3000    # older sessions fade: a profile never counts more than this many windows

_session = None


# ── Model ────────────────────────────────────────────────────────────────────

def _model_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    root = Path(base) / "DnDTranscriberWorker" if base else Path.home() / ".cache" / "co-dm"
    d = root / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _onnxruntime():
    """
    onnxruntime, installed on first use if the worker doesn't have it yet
    (it isn't in requirements.txt until every worker has the updater that
    installs only changed requirement lines). 1.24+ has no Python 3.10 wheels.
    """
    try:
        import onnxruntime
        return onnxruntime
    except ImportError:
        import subprocess as sp, sys
        spec = "onnxruntime<1.24" if sys.version_info < (3, 11) else "onnxruntime"
        print(f"    Installing {spec} for the voice model...")
        sp.run([sys.executable, "-m", "pip", "install", spec], check=True)
        import importlib
        importlib.invalidate_caches()
        import onnxruntime
        return onnxruntime


def _load_model():
    global _session
    if _session is not None:
        return _session
    ort = _onnxruntime()
    import requests
    path = _model_dir() / MODEL_FILE
    if not path.exists():
        print(f"    Downloading the voice model to {path} ...")
        tmp = path.with_suffix(".part")
        with requests.get(MODEL_URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        tmp.replace(path)
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    _session = ort.InferenceSession(str(path), providers=providers)
    return _session


def embed(windows: np.ndarray) -> np.ndarray:
    """(N, samples) float32 at 16 kHz -> (N, 256) L2-normalised embeddings."""
    import torch
    import torchaudio.compliance.kaldi as kaldi
    sess = _load_model()
    name = sess.get_inputs()[0].name
    out = []
    for i in range(0, len(windows), 64):
        feats = []
        for w in windows[i:i + 64]:
            f = kaldi.fbank(torch.from_numpy(np.ascontiguousarray(w))[None] * (1 << 15), num_mel_bins=80,
                            frame_length=25, frame_shift=10, dither=0.0, sample_frequency=SR,
                            window_type="hamming", use_energy=False)
            feats.append((f - f.mean(0, keepdim=True)).numpy())
        out.append(sess.run(None, {name: np.stack(feats).astype(np.float32)})[0])
    E = np.concatenate(out) if out else np.zeros((0, 256), np.float32)
    return E / (np.linalg.norm(E, axis=1, keepdims=True) + 1e-9)


# ── Audio helpers ────────────────────────────────────────────────────────────

def load_audio(path: Path) -> np.ndarray:
    import soundfile as sf
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "track.wav"
        subprocess.run([FFMPEG_BIN, "-v", "error", "-y", "-i", str(path), "-ac", "1", "-ar", str(SR), str(wav)], check=True)
        a, _ = sf.read(wav, dtype="float32")
    return a


def _voiced(x: np.ndarray) -> float:
    """Fraction of 25 ms frames above -45 dBFS (Discord's gate leaves exact silence)."""
    n = len(x) // 400 * 400
    if n == 0:
        return 0.0
    fr = x[:n].reshape(-1, 400)
    return float((np.sqrt((fr ** 2).mean(1)) > 10 ** (-45 / 20)).mean())


def segment_windows(a: np.ndarray, segments: list[dict]) -> tuple[np.ndarray, list[list[int]]]:
    """Voiced 1.5 s windows inside each segment: (windows, window ids per segment)."""
    n = int(WIN * SR)
    def cut(t):
        x = a[int(t * SR): int(t * SR) + n]
        return np.pad(x, (0, n - len(x)))
    wins, per_seg = [], []
    for s in segments:
        start, end = s["start"], s["end"]
        ts = [max(0.0, (start + end) / 2 - WIN / 2)] if end - start <= WIN else \
             [start + k * HOP for k in range(int((end - start - WIN) / HOP) + 1)]
        ids = []
        for t in ts:
            w = cut(t)
            if _voiced(w) >= 0.5:
                ids.append(len(wins))
                wins.append(w)
        per_seg.append(ids)
    return (np.stack(wins) if wins else np.zeros((0, n), np.float32)), per_seg


def _kmeans(X: np.ndarray, k: int, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    best = None
    rng = np.random.default_rng(seed)
    for _ in range(6):
        C = X[rng.choice(len(X), k, replace=False)]
        for _ in range(50):
            a = (X @ C.T).argmax(1)
            C = np.stack([X[a == j].mean(0) if (a == j).any() else C[j] for j in range(k)])
            C /= np.linalg.norm(C, axis=1, keepdims=True) + 1e-9
        fit = float((X * C[a]).sum(1).mean())
        if best is None or fit > best[0]:
            best = (fit, C, a)
    return best[1], best[2]


def _profile(E: np.ndarray) -> np.ndarray:
    """Mean voice, ignoring the 30% least typical windows (crosstalk, noise)."""
    mu = E.mean(0); mu /= np.linalg.norm(mu) + 1e-9
    keep = E[(E @ mu) >= np.quantile(E @ mu, 0.3)] if len(E) >= 10 else E
    mu = keep.mean(0)
    return mu / (np.linalg.norm(mu) + 1e-9)


# ── Library ──────────────────────────────────────────────────────────────────

def library_vector(library: dict, username: str) -> np.ndarray | None:
    p = (library.get("people") or {}).get(username)
    return np.asarray(p["vector"], np.float32) if p and p.get("vector") else None


def update_library(library: dict, username: str, name: str, E: np.ndarray, session: str) -> None:
    if len(E) < 20:
        return
    new = _profile(E)
    people = library.setdefault("people", {})
    p = people.get(username)
    if p and p.get("vector"):
        w_old = min(p.get("windows", 0), LIBRARY_MAX_WEIGHT)
        v = np.asarray(p["vector"], np.float32) * w_old + new * len(E)
        v /= np.linalg.norm(v) + 1e-9
    else:
        w_old, v = 0, new
    people[username] = {
        "name": name,
        "vector": [round(float(x), 5) for x in v],
        "windows": int(w_old + len(E)),
        "sessions": int((p or {}).get("sessions", 0)) + 1,
        "last_session": session,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    library["model"] = MODEL_ID


# ── The session step ─────────────────────────────────────────────────────────

def _owner(filename: str, players: dict) -> str | None:
    low = filename.lower()
    return next((u for u in players if u.lower() in low), None)


def process_session(tracks: list[tuple[Path, dict]], players: dict, library: dict, session: str,
                    label_for) -> list[str]:
    """
    tracks: [(audio file, its speakers JSON as a dict)]. Splits shared tracks in
    place (sets "speaker" on the moved segments) and updates `library`.
    label_for(username) gives a player's transcript label. Returns log lines.
    """
    log = []
    sharers = {}
    for u, info in players.items():
        if info and info.get("shares_mic_with"):
            sharers.setdefault(str(info["shares_mic_with"]).lower(), []).append(u)

    for audio, data in tracks:
        owner = _owner(audio.name, players)
        segs = data.get("segments") or []
        if not owner or not segs:
            continue
        shared_with = sharers.get(owner.lower(), [])
        a = load_audio(audio)
        W, per_seg = segment_windows(a, segs)
        if len(W) < 30:
            continue
        rng = np.random.default_rng(0)

        if not shared_with:
            sample = W[rng.choice(len(W), min(len(W), LIBRARY_SAMPLE), replace=False)]
            update_library(library, owner, players[owner].get("name", owner), embed(sample), session)
            continue

        # Shared track: every window, clustered into voices, named from the library.
        E = embed(W)
        C, asg = _kmeans(E, min(CLUSTERS, max(2, len(E) // 50)))
        C = C[[j for j in range(len(C)) if (asg == j).mean() >= MIN_CLUSTER]]
        own_v = library_vector(library, owner)
        names = []
        for c in C:
            s_own = float(c @ own_v) if own_v is not None else 0.0
            best = (None, -1.0)
            for u in shared_with:
                v = library_vector(library, u)
                if v is not None and float(c @ v) > best[1]:
                    best = (u, float(c @ v))
            names.append(best[0] if best[0] and best[1] >= CLUSTER_MIN_SIM and best[1] - s_own >= CLUSTER_MARGIN else owner)
        missing = [players[u].get("name", u) for u in shared_with if library_vector(library, u) is None]
        if missing:
            log.append(f"{audio.name}: no voice profile yet for {', '.join(missing)}; their lines stay with "
                       f"{players[owner].get('name', owner)} until they've had their own mic once")
        S = E @ C.T
        moved = {u: 0 for u in shared_with}
        owner_windows, sharer_windows = [], {u: [] for u in shared_with}
        for seg, ids in zip(segs, per_seg):
            if not ids:
                continue
            sims = S[ids].mean(0)
            best_own = max((sims[j] for j, n in enumerate(names) if n == owner), default=-1.0)
            u, best_sh = max(((n, sims[j]) for j, n in enumerate(names) if n != owner), key=lambda x: x[1], default=(None, -1.0))
            if u and best_sh - best_own > SEGMENT_MARGIN and len(seg.get("text", "").split()) >= 2:
                seg["speaker"] = label_for(u)
                moved[u] += 1
                sharer_windows[u].extend(ids)
            else:
                owner_windows.extend(ids)
        for u, n in moved.items():
            if n:
                log.append(f"{audio.name}: moved {n} of {len(segs)} segments to {label_for(u)}")
        # Learn from this session too: the owner from what stayed, sharers from confident moves.
        if owner_windows:
            ids = rng.choice(owner_windows, min(len(owner_windows), LIBRARY_SAMPLE), replace=False)
            update_library(library, owner, players[owner].get("name", owner), E[ids], session)
        for u, ids in sharer_windows.items():
            if len(ids) >= 20:
                update_library(library, u, players[u].get("name", u), E[ids], session)
    return log
