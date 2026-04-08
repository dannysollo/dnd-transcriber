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


def transcribe_audio(model, wav_path: str, **kwargs) -> dict:
    """
    Thin adapter around faster-whisper's transcribe() that returns the same
    dict format as openai-whisper: {"segments": [{start, end, text}, ...]}
    """
    kwargs.pop("verbose", None)  # faster-whisper doesn't accept this param
    kwargs.pop("word_timestamps", None)  # unused downstream; doubles processing time

    import soundfile as sf
    try:
        info = sf.info(wav_path)
        duration = info.duration
    except Exception:
        duration = None

    segments_gen, _info = model.transcribe(wav_path, **kwargs)
    segments = []
    last_print_pct = -1
    for seg in segments_gen:
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text})
        if duration and duration > 0:
            pct = int((seg.end / duration) * 100)
            pct = min(pct, 100)
            milestone = (pct // 10) * 10
            if milestone > last_print_pct:
                print(f"      transcription {milestone}% ({seg.end:.0f}s / {duration:.0f}s)")
                last_print_pct = milestone
    return {"segments": segments}
