"""
desktop/onboarding.py — First-run setup: validate the API key, create the
worker's venv, install its dependencies, and write worker.yaml.

Deliberately mirrors worker/setup.bat's own logic (GPU detection via
nvidia-smi -> cu121 torch or CPU torch, then `pip install -r requirements.txt`)
rather than inventing a new install strategy — that script is the
already-proven install path; this just drives the same steps from Python
with streamed progress instead of console prompts, for the onboarding UI.

Nothing here talks to pywebview directly — app.py's JS-API bridge calls into
this module and pushes progress into the page itself. Keeping this UI-toolkit
agnostic makes it easy to unit-test without a display, which is important
since the assistant developing this doesn't have a Windows display to test on.
"""
import shutil
import subprocess
import sys
import venv
from pathlib import Path
from typing import Callable, Optional

import requests
import yaml

import paths

ProgressFn = Callable[[str], None]

REQUIRED_FIELDS = ("server_url", "api_key", "audio_dir")


def _noop(_line: str) -> None:
    pass


def needs_onboarding() -> bool:
    """True if there's no usable worker.yaml yet — checked on every launch."""
    p = paths.worker_yaml_path()
    if not p.exists():
        return True
    try:
        cfg = yaml.safe_load(p.read_text()) or {}
    except Exception:
        return True
    return not all(cfg.get(f) for f in REQUIRED_FIELDS)


def validate_api_key(server_url: str, api_key: str) -> dict:
    """
    Hits the same /worker/whoami endpoint worker/config.py's
    resolve_campaign_slug() already uses in production — reusing it here
    (rather than inventing a separate validation call) means onboarding's
    "is this key good?" check and the worker's own runtime auto-discovery
    can never silently drift apart.

    Returns {"ok": True, "campaign_slug": ..., "campaign_name": ...} or
    {"ok": False, "error": "..."} — never raises, since this is called
    directly from the onboarding UI's "Validate" button.
    """
    server_url = server_url.rstrip("/")
    try:
        r = requests.get(
            f"{server_url}/worker/whoami",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
    except requests.ConnectionError:
        return {"ok": False, "error": f"Could not connect to {server_url}"}
    except requests.Timeout:
        return {"ok": False, "error": "Server took too long to respond."}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    if r.status_code == 403:
        return {"ok": False, "error": "Server rejected this API key."}
    if not r.ok:
        return {"ok": False, "error": f"Server returned HTTP {r.status_code}."}

    try:
        data = r.json()
    except Exception:
        return {"ok": False, "error": "Server returned an unexpected response."}

    return {
        "ok": True,
        "campaign_slug": data.get("campaign_slug"),
        "campaign_name": data.get("campaign_name", data.get("campaign_slug")),
    }


def has_nvidia_gpu() -> bool:
    return shutil.which("nvidia-smi") is not None and _run_ok(["nvidia-smi"])


def _run_ok(cmd: list) -> bool:
    try:
        return subprocess.run(cmd, capture_output=True, timeout=15).returncode == 0
    except Exception:
        return False


def _stream_subprocess(cmd: list, progress: ProgressFn, cwd: Optional[Path] = None) -> int:
    """Run a subprocess, feeding each output line to `progress` as it
    arrives (not buffered to the end) so the onboarding UI's progress log
    updates live instead of jumping at the very end of a multi-minute
    `pip install torch`."""
    progress(f"$ {' '.join(str(c) for c in cmd)}")
    proc = subprocess.Popen(
        cmd, cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    for line in proc.stdout:
        progress(line.rstrip("\n"))
    return proc.wait()


def run_worker_setup(progress: ProgressFn = _noop, include_canary: bool = False) -> None:
    """
    Create the worker's venv (if missing) and install dependencies into it.
    Raises RuntimeError with a human-readable message on failure — the caller
    (app.py's JS-API bridge) is expected to surface that directly in the
    onboarding UI.

    include_canary: whether to also install nemo_toolkit[asr] (NVIDIA Canary
    support). Off by default — per the desktop-launcher plan, Canary/NeMo is
    optional/best-effort for v1 (unverified on native Windows, ~2GB extra,
    and not on the app's critical path since production actually runs
    large-v3+hotwords via faster-whisper, not Canary).
    """
    vpy = paths.venv_python()
    src = paths.worker_src_dir()
    requirements = src / "requirements.txt"
    if not requirements.exists():
        raise RuntimeError(f"requirements.txt not found at {requirements} — bundled worker source is incomplete.")

    if not vpy.exists():
        progress("Creating virtual environment...")
        venv.EnvBuilder(with_pip=True).create(str(paths.venv_dir()))
        if not vpy.exists():
            raise RuntimeError("Virtual environment creation appeared to succeed but python.exe is missing.")
    else:
        progress("Virtual environment already exists — reusing it.")

    gpu = has_nvidia_gpu()
    progress(f"NVIDIA GPU detected: {gpu}")

    progress("Installing PyTorch (this is the largest download, several GB)...")
    if gpu:
        torch_cmd = [str(vpy), "-m", "pip", "install", "torch", "torchaudio",
                     "--index-url", "https://download.pytorch.org/whl/cu121"]
    else:
        torch_cmd = [str(vpy), "-m", "pip", "install", "torch", "torchaudio"]
    rc = _stream_subprocess(torch_cmd, progress)
    if rc != 0:
        raise RuntimeError(f"PyTorch install failed (exit code {rc}). See the log above for details.")

    # Install everything except nemo_toolkit up front — it's the one line in
    # requirements.txt that's both huge (~2GB) and unverified on native
    # Windows, so it's handled as its own optional, skippable step rather
    # than silently failing the whole install if it doesn't work out here.
    progress("Installing worker dependencies...")
    reqs = [
        line.strip() for line in requirements.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#") and not line.strip().startswith("nemo_toolkit")
    ]
    rc = _stream_subprocess([str(vpy), "-m", "pip", "install", *reqs], progress)
    if rc != 0:
        raise RuntimeError(f"Dependency install failed (exit code {rc}). See the log above for details.")

    if include_canary:
        progress("Installing NVIDIA NeMo (Canary engine, optional) — this is untested on native Windows, "
                  "so failures here don't block setup.")
        rc = _stream_subprocess([str(vpy), "-m", "pip", "install", "nemo_toolkit[asr]"], progress)
        if rc != 0:
            progress(f"NeMo install failed (exit code {rc}) — continuing without Canary support. "
                      f"faster-whisper (the default engine) is unaffected.")

    progress("Worker environment ready.")


def write_worker_yaml(server_url: str, api_key: str, audio_dir: str, campaign_slug: Optional[str] = None) -> Path:
    """
    Writes worker.yaml. campaign_slug is intentionally optional — if it's
    None, worker/config.py's own resolve_campaign_slug() auto-discovers it
    from the api_key at worker startup, the same as it already does for
    console-based setups. Not duplicating that logic here avoids the two
    paths drifting apart.
    """
    config = {
        "server_url": server_url.rstrip("/"),
        "api_key": api_key,
        "audio_dir": audio_dir,
        "poll_interval": 30,
    }
    if campaign_slug:
        config["campaign_slug"] = campaign_slug

    path = paths.worker_yaml_path()
    with open(path, "w") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return path
