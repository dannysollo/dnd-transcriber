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
    Merge/mix multiple audio tracks into a single MP3 using ffmpeg amix.
    All tracks are assumed to be time-aligned (same start time).
    Output is always MP3 128kbps stereo — lightweight for web playback.
    Returns the output path as a string.
    """
    output_path = str(output_path)

    # Common output flags: MP3 128kbps, stereo
    encode_flags = ["-codec:a", "libmp3lame", "-b:a", "128k", "-ac", "2"]

    if len(files) == 1:
        cmd = ["ffmpeg", "-y", "-i", str(files[0])] + encode_flags + [output_path]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")
        return output_path

    inputs = []
    for f in files:
        inputs += ["-i", str(f)]

    filter_str = f"amix=inputs={len(files)}:duration=longest:normalize=0"
    cmd = (
        ["ffmpeg", "-y"]
        + inputs
        + ["-filter_complex", filter_str]
        + encode_flags
        + [output_path]
    )
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to merge audio: {result.stderr.decode()}")
    return output_path
