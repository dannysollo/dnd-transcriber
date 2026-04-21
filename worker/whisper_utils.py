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


def _split_at_sentences(seg) -> list[dict]:
    """
    Split a faster-whisper segment at sentence boundaries using its word-level
    timestamps.  Each returned dict has {start, end, text}.

    Without this, Whisper often groups multiple sentences from the same speaker
    into one segment when there's a short pause between them — meaning a 10-second
    gap between "Well, yeah." and "Danny, am I down to do this?" gets collapsed
    into one segment timestamped at the START of both sentences.  This makes
    interleaving with other speakers' lines impossible.

    Word timestamps give us accurate absolute start/end for each sentence so the
    merge step can correctly interleave across speakers.
    """
    import re
    words = getattr(seg, "words", None) or []
    if not words:
        # No word timestamps available — return segment as-is
        return [{"start": seg.start, "end": seg.end, "text": seg.text}]

    sentences = []
    current_words = []

    for word in words:
        current_words.append(word)
        # End a sentence on ., ?, ! (optionally followed by closing quote/bracket)
        if re.search(r'[.?!]["\'\u201d\u00bb]?$', word.word.strip()):
            text = "".join(w.word for w in current_words).strip()
            if text:
                sentences.append({
                    "start": current_words[0].start,
                    "end": word.end,
                    "text": text,
                })
            current_words = []

    # Remaining words (trailing fragment without sentence-ending punctuation)
    if current_words:
        text = "".join(w.word for w in current_words).strip()
        if text:
            sentences.append({
                "start": current_words[0].start,
                "end": current_words[-1].end,
                "text": text,
            })

    return sentences if sentences else [{"start": seg.start, "end": seg.end, "text": seg.text}]


def transcribe_audio(model, wav_path: str, **kwargs) -> dict:
    """
    Thin adapter around faster-whisper's transcribe() that returns the same
    dict format as openai-whisper: {"segments": [{start, end, text}, ...]}

    Hallucination mitigations applied automatically:
    - condition_on_previous_text=False (prevent cascade hallucinations)
    - Segments with no_speech_prob > _NO_SPEECH_THRESHOLD are dropped
    - Known YouTube/podcast hallucination phrases are stripped

    Sentence splitting:
    - word_timestamps=True is always enabled internally
    - Each segment is split at sentence boundaries using word-level timestamps
    - This ensures accurate absolute timestamps per sentence, enabling correct
      multi-speaker interleaving in the merge step
    """
    kwargs.pop("verbose", None)  # faster-whisper doesn't accept this param
    kwargs.pop("word_timestamps", None)  # we force word_timestamps below

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

    # speech_pad_ms: Silero VAD clips aggressively at speech boundaries, causing
    # the first word(s) of a segment to be cut off.  Adding 400ms of padding before
    # and after each detected speech region prevents this.  Default is only 200ms
    # which is often not enough for natural speech onset.
    if kwargs.get("vad_filter"):
        kwargs.setdefault("vad_parameters", {"speech_pad_ms": 400})

    # Always enable word timestamps — used for sentence-boundary splitting.
    # In faster-whisper this is a DTW alignment pass (~30% overhead), much cheaper
    # than the 2x cost it had in openai-whisper.  The accuracy improvement for
    # multi-speaker interleaving is worth it.
    segments_gen, _info = model.transcribe(wav_path, word_timestamps=True, **kwargs)
    segments = []
    dropped = 0
    last_print_pct = -1
    for seg in segments_gen:
        # Drop silent/noise segments (whole-segment check before splitting)
        if seg.no_speech_prob > _NO_SPEECH_THRESHOLD:
            dropped += 1
            continue
        # Drop known hallucination phrases (whole-segment check)
        if seg.text.strip().lower().rstrip("!.,") in _HALLUCINATION_PHRASES or \
                seg.text.strip().lower() in _HALLUCINATION_PHRASES:
            dropped += 1
            continue

        # Split at sentence boundaries using word-level timestamps
        for sentence_seg in _split_at_sentences(seg):
            text = sentence_seg["text"].strip()
            if not text or len(text) < 3:
                continue
            # Per-sentence hallucination phrase check
            if text.lower().rstrip("!.,") in _HALLUCINATION_PHRASES or \
                    text.lower() in _HALLUCINATION_PHRASES:
                continue
            segments.append(sentence_seg)

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
