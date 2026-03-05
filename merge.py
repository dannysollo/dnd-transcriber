"""
merge.py
Merges per-speaker Whisper JSON transcripts into a single timestamped
markdown transcript, sorted by time across all speakers.
"""
import json
import re
from pathlib import Path


def format_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def merge_transcripts(session_dir: str, min_gap: float = 1.5) -> str:
    """
    Load all speaker JSONs from {session_dir}/speakers/,
    merge segments sorted by timestamp.

    min_gap: seconds of silence before a speaker gets a new paragraph
             (even if same speaker continues)
    """
    session = Path(session_dir)
    speakers_dir = session / "speakers"

    all_segments = []

    for json_file in sorted(speakers_dir.glob("*.json")):
        with open(json_file, encoding="utf-8") as f:
            data = json.load(f)

        speaker = data["speaker"]
        for seg in data["segments"]:
            text = seg["text"].strip()
            if not text or len(text) < 3:
                continue
            # Skip segments that are just filler/noise
            if text.lower() in ("[music]", "[applause]", "[laughter]", "...", "."):
                continue
            all_segments.append(
                {
                    "speaker": speaker,
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": text,
                }
            )

    if not all_segments:
        return "# Transcript\n\n*No speech detected.*\n"

    # Sort all segments by start time
    all_segments.sort(key=lambda x: x["start"])

    # Build transcript, grouping consecutive same-speaker utterances
    lines = [f"# Session Transcript\n"]
    current_speaker = None
    current_chunks: list[str] = []
    current_start = 0.0
    last_end = 0.0

    def flush():
        if current_speaker and current_chunks:
            ts = format_time(current_start)
            text = " ".join(current_chunks)
            lines.append(f"**[{ts}] {current_speaker}:** {text}\n")

    for seg in all_segments:
        speaker_changed = seg["speaker"] != current_speaker
        long_gap = (seg["start"] - last_end) > min_gap

        if speaker_changed or long_gap:
            flush()
            current_speaker = seg["speaker"]
            current_chunks = [seg["text"]]
            current_start = seg["start"]
        else:
            current_chunks.append(seg["text"])

        last_end = seg["end"]

    flush()  # write last segment

    return "\n".join(lines)


def apply_corrections(text: str, corrections: dict) -> str:
    """
    Apply corrections to transcript text.
    Config supports two forms:
      corrections:           <- simple whole-word replacements
        "Netsak": "Netzach"
      patterns:              <- regex replacements for context-sensitive fixes
        - match: "(?i)\\bChamber Row\\b"
          replace: "Chamber Rho"
    """
    # Simple whole-word replacements
    for wrong, right in corrections.items():
        text = re.sub(r"\b" + re.escape(wrong) + r"\b", right, text)
    return text


def apply_patterns(text: str, patterns: list) -> str:
    """Apply regex pattern replacements (for context-sensitive corrections)."""
    for entry in patterns:
        text = re.sub(entry["match"], entry["replace"], text)
    return text


def save_transcript(session_dir: str, corrections: dict | None = None, patterns: list | None = None) -> str:
    transcript = merge_transcripts(session_dir)
    if corrections:
        transcript = apply_corrections(transcript, corrections)
        print(f"  Applied {len(corrections)} word corrections")
    if patterns:
        transcript = apply_patterns(transcript, patterns)
        print(f"  Applied {len(patterns)} regex patterns")
    out_file = Path(session_dir) / "transcript.md"
    out_file.write_text(transcript, encoding="utf-8")
    line_count = transcript.count("\n")
    print(f"Transcript saved: {out_file}")
    print(f"  {line_count} lines, {len(transcript):,} chars")
    return transcript


if __name__ == "__main__":
    import sys
    import yaml

    if len(sys.argv) < 2:
        print("Usage: python merge.py <session_dir> [config.yaml]")
        sys.exit(1)

    config_path = sys.argv[2] if len(sys.argv) > 2 else "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    save_transcript(sys.argv[1], corrections=config.get("corrections"), patterns=config.get("patterns"))
