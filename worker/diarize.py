"""
diarize.py — Speaker diarization using pyannote.audio.

Used when multiple speakers share a single audio track (e.g. two people on the same mic).
Segments the track into per-speaker chunks, then Whisper transcribes each chunk separately.

Requirements:
  pip install pyannote.audio
  A Hugging Face access token with access to:
    - pyannote/speaker-diarization-3.1
    - pyannote/segmentation-3.0
  Accept model conditions at:
    https://huggingface.co/pyannote/speaker-diarization-3.1
    https://huggingface.co/pyannote/segmentation-3.0

Config (worker.yaml):
  hf_token: hf_xxxxxxxxxxxxxxxx   # Your HuggingFace token
  diarize_tracks:                 # Usernames/filenames to diarize (partial match)
    - dannysollo
    - your-username-here
  # OR diarize_all: true          # Diarize every track (slower)
"""

import json
import tempfile
from pathlib import Path

from whisper_utils import transcribe_audio

try:
    import torch
    import torchaudio
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

DIARIZE_AVAILABLE = False
_pipeline = None


def is_available() -> bool:
    """Return True if pyannote.audio is installed and importable."""
    global DIARIZE_AVAILABLE
    if not TORCH_AVAILABLE:
        return False
    try:
        import pyannote.audio  # noqa: F401
        DIARIZE_AVAILABLE = True
        return True
    except ImportError:
        return False


def load_pipeline(hf_token: str):
    """Load the pyannote speaker diarization pipeline (cached after first load)."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    from pyannote.audio import Pipeline
    print("  Loading speaker diarization model (pyannote)...")
    _pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    _pipeline = _pipeline.to(device)
    print(f"  Diarization model loaded on {device}.")
    return _pipeline


def should_diarize(filename: str, config: dict) -> bool:
    """Check whether this track should be diarized based on config."""
    if not is_available():
        return False
    if not config.get("hf_token"):
        return False

    if config.get("diarize_all"):
        return True

    targets = config.get("diarize_tracks") or []
    fn_lower = filename.lower()
    return any(t.lower() in fn_lower for t in targets)


def diarize_and_split(wav_path: str, hf_token: str, min_speakers: int = 2, max_speakers: int = 2) -> list[dict]:
    """
    Run speaker diarization on a WAV file.
    Returns a list of segments: [{speaker: "SPEAKER_00", start: 0.0, end: 1.5}, ...]
    Segments are sorted by start time.
    """
    pipeline = load_pipeline(hf_token)

    import torch
    import soundfile as sf
    import numpy as np

    # Load via soundfile (avoids the torchcodec/FFmpeg shared-lib issue in WSL)
    audio_np, sample_rate = sf.read(wav_path, dtype="float32", always_2d=False)
    if audio_np.ndim == 1:
        audio_np = audio_np[np.newaxis, :]  # (1, time)
    elif audio_np.ndim == 2:
        audio_np = audio_np.T  # (channels, time)
    waveform = torch.from_numpy(audio_np)

    diarization = pipeline(
        {"waveform": waveform, "sample_rate": sample_rate},
        num_speakers=min_speakers if min_speakers == max_speakers else None,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
    )

    # Support both old Annotation return type and new DiarizeOutput dataclass
    annotation = diarization.speaker_diarization if hasattr(diarization, 'speaker_diarization') else diarization

    segments = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segments.append({
            "speaker": speaker,  # e.g. "SPEAKER_00", "SPEAKER_01"
            "start": turn.start,
            "end": turn.end,
        })

    segments.sort(key=lambda s: s["start"])
    return segments


def extract_segment_audio(wav_path: str, start: float, end: float) -> str:
    """Extract a time slice from a WAV file into a temp file. Returns temp path."""
    import subprocess
    tmp = tempfile.NamedTemporaryFile(suffix="_seg.wav", delete=False)
    tmp.close()
    duration = end - start
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-t", str(max(duration, 0.1)),
        "-i", wav_path,
        "-ar", "16000", "-ac", "1",
        tmp.name,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        Path(tmp.name).unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg segment extraction failed: {result.stderr.decode()}")
    return tmp.name


def transcribe_with_diarization(
    wav_path: str,
    whisper_model,
    base_speaker: str,
    config: dict,
) -> list[dict]:
    """
    Diarize a WAV, then transcribe each speaker's segments with Whisper.
    Returns a list of segments compatible with the normal transcription format:
    [{speaker, start, end, text}, ...]

    Speaker labels become "{base_speaker} (A)", "{base_speaker} (B)", etc.
    """
    hf_token = config.get("hf_token", "")
    vocab_prompt = config.get("vocab_prompt", "")

    num_speakers = config.get("diarize_speakers", 2)
    print(f"    Running speaker diarization ({num_speakers} speakers)...")
    diarization_segments = diarize_and_split(wav_path, hf_token, min_speakers=num_speakers, max_speakers=num_speakers)

    if not diarization_segments:
        print(f"    Diarization found no segments — falling back to single speaker.")
        return []

    # Map pyannote speaker IDs to human-friendly letters
    speaker_ids = []
    for seg in diarization_segments:
        if seg["speaker"] not in speaker_ids:
            speaker_ids.append(seg["speaker"])

    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    speaker_map = {spk: f"{base_speaker} ({letters[i]})" for i, spk in enumerate(speaker_ids)}
    print(f"    Detected {len(speaker_ids)} speaker(s): {list(speaker_map.values())}")

    # Group consecutive segments by same speaker (merge short gaps)
    merged = _merge_consecutive(diarization_segments, gap_tolerance=0.5)

    results = []
    for seg in merged:
        label = speaker_map.get(seg["speaker"], base_speaker)
        seg_wav = extract_segment_audio(wav_path, seg["start"], seg["end"])
        try:
            result = transcribe_audio(
                whisper_model,
                seg_wav,
                language="en",
                initial_prompt=vocab_prompt if vocab_prompt else None,
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
                compression_ratio_threshold=2.4,
            )
            for whisper_seg in result["segments"]:
                text = whisper_seg["text"].strip()
                if not text or len(text) < 3:
                    continue
                results.append({
                    "speaker": label,
                    "start": seg["start"] + whisper_seg["start"],
                    "end": seg["start"] + whisper_seg["end"],
                    "text": text,
                })
        finally:
            Path(seg_wav).unlink(missing_ok=True)

    results.sort(key=lambda s: s["start"])
    return results


def _merge_consecutive(segments: list[dict], gap_tolerance: float = 0.5) -> list[dict]:
    """Merge consecutive segments from the same speaker if gap is small."""
    if not segments:
        return []
    merged = [dict(segments[0])]
    for seg in segments[1:]:
        last = merged[-1]
        if seg["speaker"] == last["speaker"] and (seg["start"] - last["end"]) <= gap_tolerance:
            last["end"] = seg["end"]
        else:
            merged.append(dict(seg))
    return merged
