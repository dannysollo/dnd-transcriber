"""
worker/updater.py — keep an installed desktop worker's code current.

The desktop launcher runs the worker from plain source files in its install
folder (worker/*.py etc., plus ANALYZE_SESSION.md one level up). On launch,
before any other worker module is imported, main.py calls run_with_update():

  1. Ask GitHub for the latest commit on master. If it matches the version
     recorded in worker/.worker_version, carry on in-process: no overhead.
  2. Otherwise download that commit's tarball and stage the worker files. If
     requirements.txt changed, pip-install it first; if that fails, keep the
     current code rather than run new code against old dependencies.
  3. Swap the files in (each one atomically), record the version, then run the
     updated worker as a child process and exit with its exit code. The
     launcher's stop paths still work: /api/shutdown reaches the child's
     dashboard, and its hard-kill uses taskkill /T (the whole process tree).

Skipped entirely when: running from a git checkout (a dev tree, updated with
git instead), `auto_update: false` in worker.yaml, or GitHub is unreachable.
"""
import fnmatch
import io
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import requests

REPO = "dannysollo/dnd-transcriber"
BRANCH = "master"
# The same files desktop/build/desktop.spec bundles from worker/.
WORKER_GLOBS = ("*.py", "*.txt", "*.bat", "*.sh", "*.example")
ROOT_FILES = ("ANALYZE_SESSION.md",)
WORKER_DIR = Path(__file__).resolve().parent
VERSION_FILE = WORKER_DIR / ".worker_version"
CHILD_ENV = "DND_WORKER_UPDATED"


def _log(msg: str) -> None:
    print(f"[updater] {msg}", flush=True)


def _auto_update_enabled(argv: list[str]) -> bool:
    """Read auto_update from the --config worker.yaml without the full config loader."""
    path = None
    if "--config" in argv:
        i = argv.index("--config")
        if i + 1 < len(argv):
            path = argv[i + 1]
    path = path or str(WORKER_DIR / "worker.yaml")
    try:
        import yaml
        with open(path, encoding="utf-8") as f:
            return (yaml.safe_load(f) or {}).get("auto_update", True) is not False
    except Exception:
        return True


def latest_commit() -> str | None:
    r = requests.get(
        f"https://api.github.com/repos/{REPO}/commits/{BRANCH}",
        headers={"Accept": "application/vnd.github.sha"},
        timeout=10,
    )
    r.raise_for_status()
    sha = r.text.strip()
    return sha if len(sha) == 40 else None


def _stage(sha: str) -> dict[str, bytes]:
    """Download the commit tarball; return {relative target path: file bytes}."""
    r = requests.get(f"https://codeload.github.com/{REPO}/tar.gz/{sha}", timeout=120)
    r.raise_for_status()
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            parts = member.name.split("/", 1)  # "<repo>-<sha>/<path>"
            if len(parts) != 2:
                continue
            rel = parts[1]
            if rel.startswith("worker/") and rel.count("/") == 1:
                name = rel.split("/", 1)[1]
                if any(fnmatch.fnmatch(name, g) for g in WORKER_GLOBS):
                    files[f"worker/{name}"] = tar.extractfile(member).read()
            elif rel in ROOT_FILES:
                files[rel] = tar.extractfile(member).read()
    if "worker/main.py" not in files:
        raise RuntimeError("tarball had no worker/main.py; refusing to update")
    return files


def _install_requirements(new_reqs: bytes) -> None:
    with tempfile.NamedTemporaryFile("wb", suffix="-requirements.txt", delete=False) as f:
        f.write(new_reqs)
        path = f.name
    try:
        _log("requirements.txt changed; installing new dependencies…")
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", path], check=True)
    finally:
        os.unlink(path)


def _swap_in(files: dict[str, bytes]) -> None:
    root = WORKER_DIR.parent
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".update-tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)  # atomic per file


def update_if_needed() -> bool:
    """Returns True when new code was installed (the caller should restart)."""
    if (WORKER_DIR.parent / ".git").exists():
        return False  # a git checkout: update with git, never overwrite a dev tree
    current = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else None
    sha = latest_commit()
    if not sha or sha == current:
        return False
    _log(f"updating worker {current[:7] if current else '(unversioned)'} -> {sha[:7]}")
    files = _stage(sha)
    old_reqs = (WORKER_DIR / "requirements.txt").read_bytes() if (WORKER_DIR / "requirements.txt").exists() else b""
    new_reqs = files.get("worker/requirements.txt", b"")
    if new_reqs and new_reqs.replace(b"\r", b"") != old_reqs.replace(b"\r", b""):
        _install_requirements(new_reqs)
    _swap_in(files)
    VERSION_FILE.write_text(sha + "\n")
    _log(f"updated {len(files)} files")
    return True


def run_with_update() -> None:
    """Called first thing from main.py. May run the updated worker as a child and exit."""
    if os.environ.get(CHILD_ENV) or not _auto_update_enabled(sys.argv):
        return
    try:
        updated = update_if_needed()
    except Exception as e:  # offline, rate-limited, pip failure: keep the current code
        _log(f"skipped ({type(e).__name__}: {e}); running the current version")
        return
    if not updated:
        return
    env = {**os.environ, CHILD_ENV: "1"}
    rc = subprocess.call([sys.executable] + sys.argv, env=env)
    sys.exit(rc)
