"""
transcribe.py
Runs Whisper on each Craig audio track (one per player/DM),
producing a timestamped JSON file per speaker.

Craig outputs time-aligned tracks — each file starts at t=0 (recording start),
so timestamps are directly comparable across files.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


SAMPLE_RATE = 16000


def convert_to_wav(input_path: Path) -> str:
    """
    Convert Craig's audio (often OGG-encapsulated FLAC/Opus) to a standard WAV
    that Whisper can reliably read. Returns path to temp WAV file.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()

    # Try standard conversion first, then fall back to forcing OGG demuxer
    for extra_args in [[], ["-f", "ogg"]]:
        cmd = (
            ["ffmpeg", "-y"]
            + extra_args
            + ["-i", str(input_path), "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "wav", tmp.name]
        )
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode == 0:
            return tmp.name

    raise RuntimeError(
        f"ffmpeg could not convert {input_path.name}. "
        f"stderr: {result.stderr.decode()}"
    )


def apply_vad(wav_path: str) -> str:
    """
    Apply Silero VAD to zero out non-speech portions of the audio.
    Returns path to a new temp WAV with silence masked out.
    Preserves original timestamps so Whisper output stays aligned.
    """
    import torch
    import torchaudio
    import soundfile as sf
    from silero_vad import load_silero_vad, get_speech_timestamps

    model = load_silero_vad()

    audio_np, sr = sf.read(wav_path, dtype="float32", always_2d=False)
    wav = torch.from_numpy(audio_np)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, SAMPLE_RATE)
    if wav.dim() > 1:
        wav = wav.mean(0)  # stereo → mono

    speech_timestamps = get_speech_timestamps(
        wav, model,
        sampling_rate=SAMPLE_RATE,
        threshold=0.4,               # sensitivity — lower catches more speech
        min_speech_duration_ms=200,  # ignore very short blips
        min_silence_duration_ms=400, # merge speech separated by <400ms silence
        return_seconds=False,        # want sample indices, not seconds
    )

    if not speech_timestamps:
        return wav_path  # nothing detected, pass through unchanged

    # Build a binary mask: 1 = speech, 0 = silence
    mask = torch.zeros_like(wav)
    for ts in speech_timestamps:
        mask[ts["start"]:ts["end"]] = 1.0

    processed = wav * mask

    tmp = tempfile.NamedTemporaryFile(suffix="_vad.wav", delete=False)
    tmp.close()
    sf.write(tmp.name, processed.numpy(), SAMPLE_RATE)
    return tmp.name


def get_speaker_label(filename: str, players: dict) -> str:
    """
    Map a Craig audio filename fragment to a human-readable speaker label.
    Craig filenames look like: {recording-id}-{username}.flac
    We match against the username keys in config.
    """
    filename_lower = filename.lower()
    for username, info in players.items():
        if username.lower() in filename_lower:
            role = info.get("role", "player")
            name = info.get("name", username)
            char = info.get("character")
            if role == "dm":
                return f"DM ({name})"
            elif char:
                return f"{char} [{name}]"
            else:
                return name
    # Fallback: use stem of filename
    return Path(filename).stem


def transcribe_tracks(session_dir: str, config: dict, vocab_prompt: str):
    """
    Transcribe all audio files in {session_dir}/raw/.
    Outputs per-speaker JSON to {session_dir}/speakers/.
    """
    import whisper  # imported here so the script is importable without whisper installed

    session = Path(session_dir)
    raw_dir = session / "raw"
    out_dir = session / "speakers"
    out_dir.mkdir(exist_ok=True)

    model_name = config.get("whisper_model", "large-v3")
    print(f"Loading Whisper model: {model_name} (this may take a moment on first run)...")
    model = whisper.load_model(model_name)
    print("Model loaded.")

    audio_exts = ("*.flac", "*.mp3", "*.ogg", "*.wav", "*.m4a")
    audio_files = []
    for ext in audio_exts:
        audio_files.extend(raw_dir.glob(ext))

    if not audio_files:
        print(f"ERROR: No audio files found in {raw_dir}")
        print("Download your Craig recording and place the .flac files there.")
        sys.exit(1)

    print(f"Found {len(audio_files)} audio track(s)\n")

    for audio_file in sorted(audio_files):
        speaker = get_speaker_label(audio_file.name, config.get("players", {}))
        print(f"Transcribing: {audio_file.name}")
        print(f"  Speaker:    {speaker}")

        # Pre-convert to WAV — handles Craig's OGG-encapsulated FLAC/Opus format
        print(f"  Converting to WAV...")
        wav_path = convert_to_wav(audio_file)

        # Apply VAD to suppress hallucinations on silence
        use_vad = config.get("vad", True)
        if use_vad:
            print(f"  Applying VAD...")
            vad_path = apply_vad(wav_path)
            Path(wav_path).unlink(missing_ok=True)
            wav_path = vad_path

        result = model.transcribe(
            wav_path,
            language="en",
            initial_prompt=vocab_prompt,
            word_timestamps=True,
            verbose=False,
            condition_on_previous_text=False,  # prevents hallucination loops on silence
            no_speech_threshold=0.6,           # skip segments with low speech probability
            compression_ratio_threshold=2.4,   # discard repetitive/looping output
        )

        out_file = out_dir / f"{audio_file.stem}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "speaker": speaker,
                    "filename": audio_file.name,
                    "segments": result["segments"],
                },
                f,
                indent=2,
                ensure_ascii=False,
            )

        # Clean up temp WAV (covers both original and VAD-processed file)
        Path(wav_path).unlink(missing_ok=True)

        seg_count = len(result["segments"])
        duration = result["segments"][-1]["end"] if result["segments"] else 0
        print(f"  → {out_file.name} ({seg_count} segments, {duration/60:.1f} min)\n")

    print("Transcription complete.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <session_dir> [config.yaml]")
        sys.exit(1)

    session_dir = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"

    with open(config_path) as f:
        config = yaml.safe_load(f)

    from vocab_extractor import extract_from_vault
    vocab = extract_from_vault(config["vault_path"])
    print(f"Vocab prompt: {len(vocab)} chars\n")

    transcribe_tracks(session_dir, config, vocab)
