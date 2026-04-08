"""
whisper_utils.py — Shared faster-whisper helpers.

Extracted into a standalone module to avoid circular imports between
transcribe.py (which imports diarize) and diarize.py (which needs these helpers).
"""


def load_whisper_model(model_name: str):
    from faster_whisper import WhisperModel
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    print(f"Loading Whisper model: {model_name} on {device} ({compute_type})...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
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
