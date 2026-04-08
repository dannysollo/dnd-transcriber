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
    dict format as openai-whisper: {"segments": [{start, end, text, words?}, ...]}
    """
    kwargs.pop("verbose", None)  # faster-whisper doesn't accept this param

    segments_gen, _info = model.transcribe(wav_path, **kwargs)
    segments = []
    for seg in segments_gen:
        seg_dict = {"start": seg.start, "end": seg.end, "text": seg.text}
        if seg.words:
            seg_dict["words"] = [
                {"start": w.start, "end": w.end, "word": w.word}
                for w in seg.words
            ]
        segments.append(seg_dict)
    return {"segments": segments}
