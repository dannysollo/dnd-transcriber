"""
worker/transcribe.py
Per-speaker Whisper transcription for the local worker daemon.

Flow:
  1. Find all audio files in {session_dir}/  (Craig records one file per speaker)
  2. Convert each to WAV, apply VAD, run Whisper → per-speaker JSON in {session_dir}/speakers/
  3. Merge speaker JSONs by timestamp → markdown transcript string

Craig filenames: {recording-id}-{username}.flac (or .ogg, .m4a, etc.)
Players config maps usernames to display names/characters.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import diarize as diarize_module
from whisper_utils import load_whisper_model, transcribe_audio

SAMPLE_RATE = 16000

AUDIO_EXTS = ("*.flac", "*.mp3", "*.ogg", "*.wav", "*.m4a")

HALLUCINATION_PHRASES = {
    "thank you.", "thank you", "thanks.", "thanks",
    "bye.", "bye", "bye bye.", "bye bye",
    "you.", "you", "no.", "no",
    "yeah.", "yeah", "okay.", "okay", "ok.", "ok",
    "hmm.", "hmm", "hm.", "hm",
    "uh.", "uh", "um.", "um",
    "i'll fix that.", "more sultry!", "i'm so happy.",
    "thanks for watching!", "apps and links are in the description!",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def format_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def get_speaker_label(filename: str, players: dict) -> str:
    """Map Craig audio filename to a human-readable speaker label via players config."""
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
    return Path(filename).stem


def convert_to_wav(input_path: Path) -> str:
    """Convert Craig audio (often OGG-encapsulated FLAC/Opus) to a WAV Whisper can read."""
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
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
        f"ffmpeg could not convert {input_path.name}. stderr: {result.stderr.decode()}"
    )


def apply_vad(wav_path: str) -> str:
    """Zero out non-speech portions. Returns path to cleaned temp WAV."""
    import soundfile as sf
    import torch
    import torchaudio
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()
    audio_np, sr = sf.read(wav_path, dtype="float32", always_2d=False)
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
        return wav_path  # nothing detected, pass through unchanged

    mask = torch.zeros_like(wav)
    for ts in speech_timestamps:
        mask[ts["start"]:ts["end"]] = 1.0

    tmp = tempfile.NamedTemporaryFile(suffix="_vad.wav", delete=False)
    tmp.close()
    sf.write(tmp.name, (wav * mask).numpy(), SAMPLE_RATE)
    return tmp.name


# load_whisper_model and transcribe_audio live in whisper_utils.py
# (imported above) to avoid circular imports with diarize.py


# ─── Per-speaker transcription ────────────────────────────────────────────────

def transcribe_session(session_dir: Path, model, config: dict) -> str:
    """
    Transcribe all speaker audio files in session_dir.
    Returns merged markdown transcript string with speaker labels.

    Expected layout:
        session_dir/*.flac   (Craig per-speaker files, flat — no raw/ subfolder needed)

    Writes intermediate per-speaker JSONs to session_dir/speakers/ (kept for debugging).
    """
    players = config.get("players", {})
    vocab_prompt = config.get("vocab_prompt", "")
    use_vad = config.get("vad", True)

    # Find audio files
    audio_files = []
    for ext in AUDIO_EXTS:
        audio_files.extend(session_dir.glob(ext))
    audio_files = sorted(audio_files)

    if not audio_files:
        raise FileNotFoundError(f"No audio files found in {session_dir}")

    speakers_dir = session_dir / "speakers"
    speakers_dir.mkdir(exist_ok=True)

    print(f"  Found {len(audio_files)} speaker track(s)")

    for audio_file in audio_files:
        speaker = get_speaker_label(audio_file.name, players)
        print(f"  Transcribing: {audio_file.name} → {speaker}")

        wav_path = convert_to_wav(audio_file)

        if use_vad:
            print(f"    Applying VAD...")
            vad_path = apply_vad(wav_path)
            Path(wav_path).unlink(missing_ok=True)
            wav_path = vad_path

        # ── Diarization path ──────────────────────────────────────────────────
        print(f"    Checking diarization: should_diarize={diarize_module.should_diarize(audio_file.name, config)}, hf_token={'yes' if config.get('hf_token') else 'missing'}, diarize_tracks={config.get('diarize_tracks')}")
        if diarize_module.should_diarize(audio_file.name, config):
            print(f"    Diarization enabled for this track.")
            try:
                diarized_segments = diarize_module.transcribe_with_diarization(
                    wav_path, model, speaker, config
                )
                Path(wav_path).unlink(missing_ok=True)

                if diarized_segments:
                    # Write one JSON per detected sub-speaker
                    sub_speakers: dict[str, list] = {}
                    for seg in diarized_segments:
                        sub_speakers.setdefault(seg["speaker"], []).append(seg)

                    for sub_label, segs in sub_speakers.items():
                        safe_label = sub_label.replace(" ", "_").replace("/", "-")
                        out_file = speakers_dir / f"{audio_file.stem}_{safe_label}.json"
                        with open(out_file, "w", encoding="utf-8") as f:
                            json.dump(
                                {"speaker": sub_label, "filename": audio_file.name,
                                 "segments": [{"start": s["start"], "end": s["end"],
                                               "text": s["text"]} for s in segs]},
                                f, indent=2, ensure_ascii=False,
                            )
                    print(f"    → {len(diarized_segments)} diarized segments across {len(sub_speakers)} speaker(s)")
                    continue  # skip normal Whisper path for this file
                else:
                    print(f"    Diarization returned no results — falling back to standard transcription.")
            except Exception as e:
                import traceback
                print(f"    Diarization failed: {type(e).__name__}: {e}")
                traceback.print_exc()
                print(f"    Falling back to standard transcription.")
                # wav_path may have been consumed — reconvert
                try:
                    wav_path = convert_to_wav(audio_file)
                except Exception:
                    continue

        # ── Standard single-speaker Whisper path ─────────────────────────────
        result = transcribe_audio(
            model,
            wav_path,
            language="en",
            initial_prompt=vocab_prompt if vocab_prompt else None,
            word_timestamps=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
        )

        Path(wav_path).unlink(missing_ok=True)

        out_file = speakers_dir / f"{audio_file.stem}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(
                {"speaker": speaker, "filename": audio_file.name, "segments": result["segments"]},
                f, indent=2, ensure_ascii=False,
            )
        print(f"    → {len(result['segments'])} segments")

    return merge_speaker_jsons(speakers_dir)


# ─── Merge per-speaker JSONs into markdown ────────────────────────────────────

def merge_speaker_jsons(speakers_dir: Path, min_gap: float = 4.0) -> str:
    """
    Merge all speaker JSON files into a single timestamped markdown transcript,
    sorted by time. Format: **[MM:SS] Speaker:** text

    A new line is started when the speaker changes OR when the same speaker has
    been silent for longer than min_gap seconds (measured per-speaker, so other
    speakers talking in between doesn't reset the clock).
    """
    all_segments = []

    for json_file in sorted(speakers_dir.glob("*.json")):
        with open(json_file, encoding="utf-8") as f:
            data = json.load(f)
        speaker = data["speaker"]
        for seg in data["segments"]:
            text = seg["text"].strip()
            if not text or len(text) < 3:
                continue
            if text.lower() in ("[music]", "[applause]", "[laughter]", "...", "."):
                continue
            if text.lower() in HALLUCINATION_PHRASES:
                continue
            all_segments.append({
                "speaker": speaker,
                "start": seg["start"],
                "end": seg["end"],
                "text": text,
            })

    if not all_segments:
        return "# Session Transcript\n\n*No speech detected.*\n"

    all_segments.sort(key=lambda s: s["start"])

    lines = ["# Session Transcript\n"]
    current_speaker = None
    current_chunks: list[str] = []
    current_start = 0.0
    last_end_per_speaker: dict[str, float] = {}  # track gap per speaker independently

    def flush():
        if current_chunks:
            ts = format_time(current_start)
            text = " ".join(current_chunks)
            lines.append(f"**[{ts}] {current_speaker}:** {text}\n")

    for seg in all_segments:
        speaker = seg["speaker"]
        speaker_changed = speaker != current_speaker
        speaker_last_end = last_end_per_speaker.get(speaker, 0.0)
        long_gap = (seg["start"] - speaker_last_end) > min_gap

        if speaker_changed or (long_gap and current_chunks and current_speaker == speaker):
            flush()
            current_chunks = [seg["text"]]
            current_start = seg["start"]
            current_speaker = speaker
        elif not current_chunks:
            current_chunks = [seg["text"]]
            current_start = seg["start"]
            current_speaker = speaker
        else:
            current_chunks.append(seg["text"])

        last_end_per_speaker[speaker] = seg["end"]

    flush()
    return "\n".join(lines)
