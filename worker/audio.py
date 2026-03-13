"""
worker/audio.py — Audio file utilities for the worker: finding and merging audio tracks.
"""
import subprocess
import tempfile
from pathlib import Path

AUDIO_EXTENSIONS = {".flac", ".wav", ".mp3", ".m4a", ".ogg"}


def find_audio_files(session_dir) -> list:
    """Find all audio files (.flac/.wav/.mp3/.m4a/.ogg) in a directory."""
    session_dir = Path(session_dir)
    files = []
    for ext in AUDIO_EXTENSIONS:
        files.extend(session_dir.glob(f"*{ext}"))
    return sorted(files)


def merge_audio_files(files: list, output_path) -> str:
    """
    Merge/mix multiple audio tracks into a single file using ffmpeg amix.
    All tracks are assumed to be time-aligned (same start time).
    Returns the output path as a string.
    """
    output_path = str(output_path)
    if len(files) == 1:
        # Single file: just convert to a standard format
        cmd = [
            "ffmpeg", "-y",
            "-i", str(files[0]),
            "-ar", "16000", "-ac", "1",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed to convert {files[0].name}: {result.stderr.decode()}"
            )
        return output_path

    # Multiple files: build amix filter
    inputs = []
    for f in files:
        inputs += ["-i", str(f)]

    filter_str = f"amix=inputs={len(files)}:duration=longest:normalize=0"
    cmd = (
        ["ffmpeg", "-y"]
        + inputs
        + ["-filter_complex", filter_str, "-ar", "16000", "-ac", "1", output_path]
    )
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed to merge audio: {result.stderr.decode()}"
        )
    return output_path
