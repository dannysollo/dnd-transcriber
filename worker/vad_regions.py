"""
worker/vad_regions.py — Silero speech timestamps for one track, the settings
transcribe.py has always used.

Silero runs on CPU, one 32 ms window at a time (~490k model calls for a
4-hour Craig track), which made it most of a track's time once Whisper is
batched. Two speedups, both giving exactly the same regions (checked on the
9-13 tracks, 2026-10-01):
  - Silero's ONNX build: about 2.3x faster than its TorchScript build. (Not
    the GPU: one tiny call per window makes it 2.7x slower there.)
  - One process per track (start_speech_timestamps): the window loop holds
    Python's GIL, so threads don't help, but separate processes scale with
    cores. A plain subprocess rather than multiprocessing, because spawn
    would re-import the worker's main.py in every child.

Also runnable as `python vad_regions.py in.wav out.json [max_speech_s]`, which is how
start_speech_timestamps uses it.
"""

import json
import os
import subprocess
import sys
import tempfile

SAMPLE_RATE = 16000


def speech_timestamps(wav_path: str, max_speech_s: float = float("inf")) -> list[dict]:
    """[{start, end}] in seconds, unmerged. max_speech_s splits longer speech at its best pause
    (batched Whisper takes at most 30 s per region). Falls back to TorchScript if ONNX won't load."""
    import soundfile as sf
    import torch
    import torchaudio
    from silero_vad import get_speech_timestamps, load_silero_vad

    try:
        model = load_silero_vad(onnx=True)
    except Exception as e:
        print(f"      (Silero ONNX unavailable, using TorchScript: {e})")
        model = load_silero_vad()
    audio_np, sr = sf.read(wav_path, dtype="float32", always_2d=False)
    wav = torch.from_numpy(audio_np)
    if wav.dim() > 1:
        wav = wav.mean(-1)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, SAMPLE_RATE)
    return get_speech_timestamps(
        wav, model,
        sampling_rate=SAMPLE_RATE,
        threshold=0.4,
        min_speech_duration_ms=300,
        min_silence_duration_ms=500,
        speech_pad_ms=400,
        max_speech_duration_s=max_speech_s,
        return_seconds=True,
    )


class PendingTimestamps:
    """Speech timestamps being worked out in a child process; result() waits for them."""

    def __init__(self, wav_path: str, max_speech_s: float = float("inf")):
        self.wav_path, self.max_speech_s = wav_path, max_speech_s
        fd, self.out_path = tempfile.mkstemp(suffix="_vad.json")
        os.close(fd)
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vad_regions.py")
        try:
            self.proc = subprocess.Popen([sys.executable, script, wav_path, self.out_path, str(max_speech_s)],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))  # no console flash on Windows
        except OSError as e:
            print(f"      (couldn't start VAD process, running it here: {e})")
            self.proc = None

    def cancel(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        try:
            os.unlink(self.out_path)
        except OSError:
            pass

    def result(self) -> list[dict]:
        try:
            if self.proc is not None:
                _, err = self.proc.communicate()
                if self.proc.returncode == 0:
                    with open(self.out_path, encoding="utf-8") as f:
                        return json.load(f)
                print(f"      (VAD process failed, running it here: {err.decode(errors='replace')[-300:]})")
            return speech_timestamps(self.wav_path, self.max_speech_s)
        finally:
            try:
                os.unlink(self.out_path)
            except OSError:
                pass


def start_speech_timestamps(wav_path: str, max_speech_s: float = float("inf")) -> PendingTimestamps:
    return PendingTimestamps(wav_path, max_speech_s)


if __name__ == "__main__":
    import torch
    torch.set_num_threads(1)  # one process per track already uses the cores
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(speech_timestamps(sys.argv[1], float(sys.argv[3]) if len(sys.argv) > 3 else float("inf")), f)
