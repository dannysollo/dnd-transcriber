"""
whisper_utils.py — Shared faster-whisper helpers.

Extracted into a standalone module to avoid circular imports between
transcribe.py (which imports diarize) and diarize.py (which needs these helpers).
"""


def _resolve_model_path(model_name: str) -> str:
    """
    Resolve a faster-whisper model name to its local HuggingFace cache path.

    WhisperModel(model_name) makes a network request to HuggingFace even when
    the model is already cached, which hangs in restricted-network environments
    (e.g. WSL2 with blocked outbound connections).  By walking the cache
    directory directly we get the snapshot path instantly with zero I/O.
    """
    import os
    import glob

    hf_cache = os.path.expanduser("~/.cache/huggingface/hub")

    # faster-whisper stores models as Systran/faster-whisper-<name>
    # distil models are Systran/faster-distil-whisper-<suffix>
    candidates = [
        f"models--Systran--faster-whisper-{model_name}",
        f"models--Systran--faster-{model_name}",
    ]

    for candidate in candidates:
        snapshots_dir = os.path.join(hf_cache, candidate, "snapshots")
        if os.path.isdir(snapshots_dir):
            snaps = sorted(os.listdir(snapshots_dir))
            if snaps:
                resolved = os.path.join(snapshots_dir, snaps[-1])
                print(f"  resolved {model_name!r} → {resolved}")
                return resolved

    # Model not in cache — return the name and let faster-whisper download it
    print(f"  {model_name!r} not found in cache, will download")
    return model_name


def load_whisper_model(model_name: str):
    from faster_whisper import WhisperModel
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "int8_float16" if device == "cuda" else "int8"
    print(f"Loading Whisper model: {model_name} on {device} ({compute_type})...")
    model_path = _resolve_model_path(model_name)
    model = WhisperModel(model_path, device=device, compute_type=compute_type, cpu_threads=4, num_workers=1)
    print("Model loaded.")
    return model



# Known Whisper hallucination phrases (YouTube/podcast training artifacts).
# Segments whose stripped text exactly matches one of these are silently dropped.
_HALLUCINATION_PHRASES = {
    "thank you for watching",
    "thanks for watching",
    "thank you for watching!",
    "thanks for watching!",
    "please like and subscribe",
    "don't forget to subscribe",
    "subscribe to the channel",
    "like and subscribe",
    "see you in the next video",
    "see you next time",
    "thanks for listening",
    "thank you for listening",
}

# Segments where faster-whisper's no_speech_prob exceeds this threshold are
# dropped as likely silence/noise rather than real speech.
# 0.85 = only drop near-certain silence; lower values were too aggressive for
# quiet speech (pauses, soft-spoken players, thinking mid-sentence).
_NO_SPEECH_THRESHOLD = 0.85


def transcribe_audio(model, wav_path: str, **kwargs) -> dict:
    """
    Thin adapter around faster-whisper's transcribe() that returns the same
    dict format as openai-whisper: {"segments": [{start, end, text}, ...]}

    Hallucination mitigations applied automatically:
    - condition_on_previous_text=False (prevent cascade hallucinations)
    - Segments with no_speech_prob > _NO_SPEECH_THRESHOLD are dropped
    - Known YouTube/podcast hallucination phrases are stripped
    """
    kwargs.pop("verbose", None)  # faster-whisper doesn't accept this param
    kwargs.pop("word_timestamps", None)  # unused downstream; doubles processing time

    # Disable previous-text conditioning by default — this stops one hallucination
    # from priming the next chunk to hallucinate too.
    kwargs.setdefault("condition_on_previous_text", False)

    import soundfile as sf
    try:
        info = sf.info(wav_path)
        duration = info.duration
    except Exception:
        duration = None

    # vad_filter: faster-whisper's internal Silero VAD gives much more accurate
    # timestamps than relying on segment boundaries alone.  Critical for correct
    # multi-speaker interleaving — without it, timestamps can drift 5-10 seconds.
    kwargs.setdefault("vad_filter", True)

    segments_gen, _info = model.transcribe(wav_path, **kwargs)
    segments = []
    dropped = 0
    last_print_pct = -1
    for seg in segments_gen:
        # Drop silent/noise segments
        if seg.no_speech_prob > _NO_SPEECH_THRESHOLD:
            dropped += 1
            continue
        # Drop known hallucination phrases
        if seg.text.strip().lower().rstrip("!.,") in _HALLUCINATION_PHRASES or \
                seg.text.strip().lower() in _HALLUCINATION_PHRASES:
            dropped += 1
            continue
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text})
        if duration and duration > 0:
            pct = int((seg.end / duration) * 100)
            pct = min(pct, 100)
            milestone = (pct // 10) * 10
            if milestone > last_print_pct:
                print(f"      transcription {milestone}% ({seg.end:.0f}s / {duration:.0f}s)")
                last_print_pct = milestone
    if dropped:
        print(f"      dropped {dropped} hallucinated/silent segment(s)")

    # Sort by start time — faster-whisper's overlapping 30s chunks can produce
    # minor out-of-order segments at chunk boundaries.
    segments.sort(key=lambda s: s["start"])

    return {"segments": segments}
