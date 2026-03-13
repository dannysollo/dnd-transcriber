"""
worker/transcribe.py — Whisper transcription functions for the worker.

Produces a single merged-audio transcript (not per-speaker) since the worker
receives a mixed audio file rather than individual Craig tracks.
"""
import subprocess
import tempfile
from pathlib import Path

SAMPLE_RATE = 16000


def load_whisper_model(model_name: str):
    """Load and return a Whisper model."""
    import whisper
    print(f"Loading Whisper model: {model_name}...")
    model = whisper.load_model(model_name)
    print("Model loaded.")
    return model


def apply_vad(audio_path: str, output_path: str) -> str:
    """
    Apply Silero VAD to zero out non-speech portions of the audio.
    Returns output_path (the cleaned audio file).
    """
    import soundfile as sf
    import torch
    import torchaudio
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()

    audio_np, sr = sf.read(audio_path, dtype="float32", always_2d=False)
    wav = torch.from_numpy(audio_np)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, SAMPLE_RATE)
    if wav.dim() > 1:
        wav = wav.mean(0)

    speech_timestamps = get_speech_timestamps(
        wav, model,
        sampling_rate=SAMPLE_RATE,
        threshold=0.4,
        min_speech_duration_ms=200,
        min_silence_duration_ms=400,
        return_seconds=False,
    )

    if not speech_timestamps:
        return audio_path  # nothing detected, pass through unchanged

    mask = torch.zeros_like(wav)
    for ts in speech_timestamps:
        mask[ts["start"]:ts["end"]] = 1.0

    processed = wav * mask
    sf.write(output_path, processed.numpy(), SAMPLE_RATE)
    return output_path


def _format_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def run_transcription(model, audio_path: str, config: dict) -> str:
    """
    Run Whisper on audio_path and return the transcript as markdown text.

    The returned markdown follows the project format:
      # Session Transcript

      **[MM:SS] Speaker:** Text
    """
    # Build a vocab prompt from config if available
    vocab_prompt = config.get("vocab_prompt", "")

    result = model.transcribe(
        audio_path,
        language="en",
        initial_prompt=vocab_prompt if vocab_prompt else None,
        word_timestamps=True,
        verbose=False,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
    )

    segments = result.get("segments", [])
    if not segments:
        return "# Session Transcript\n\n*No speech detected.*\n"

    # Known Whisper hallucination phrases to skip
    HALLUCINATION_PHRASES = {
        "thank you.", "thank you", "thanks.", "thanks",
        "bye.", "bye", "yeah.", "yeah", "okay.", "okay",
        "ok.", "ok", "hmm.", "hmm", "hm.", "hm",
        "uh.", "uh", "um.", "um", "no.", "no",
    }

    lines = ["# Session Transcript\n"]
    current_chunks: list[str] = []
    current_start: float = 0.0
    last_end: float = 0.0
    MIN_GAP = 1.5

    def flush():
        if current_chunks:
            ts = _format_time(current_start)
            text = " ".join(current_chunks)
            lines.append(f"**[{ts}]** {text}\n")

    for seg in segments:
        text = seg["text"].strip()
        if not text or len(text) < 3:
            continue
        if text.lower() in HALLUCINATION_PHRASES:
            continue

        long_gap = (seg["start"] - last_end) > MIN_GAP

        if long_gap and current_chunks:
            flush()
            current_chunks = [text]
            current_start = seg["start"]
        elif not current_chunks:
            current_chunks = [text]
            current_start = seg["start"]
        else:
            current_chunks.append(text)

        last_end = seg["end"]

    flush()

    return "\n".join(lines)
