"""
desktop/worker_process.py — Subprocess lifecycle for the worker.

Launches `worker/main.py` in its own venv, and stops it gracefully via the
/api/shutdown route added to gui_server.py specifically for this purpose
(main.py's only prior shutdown path was KeyboardInterrupt, which is awkward
to deliver reliably to a windowless Windows child process).

Also guards against spawning a second worker on top of one that's already
running for the same campaign — two pollers would double-claim jobs.
"""
import os
import subprocess
import sys
import time
from typing import Optional

import requests

import paths

DASHBOARD_URL = "http://127.0.0.1:8788"
STATUS_TIMEOUT = 3
SHUTDOWN_POLL_INTERVAL = 0.5
SHUTDOWN_TIMEOUT = 15


class WorkerProcess:
    def __init__(self):
        self._proc: Optional[subprocess.Popen] = None
        self._log_file = None

    # ── Status ────────────────────────────────────────────────────────────

    def is_running(self) -> bool:
        """True if a worker (ours or a pre-existing one on :8788) is alive."""
        if self._proc is not None and self._proc.poll() is None:
            return True
        return self._dashboard_alive()

    def _dashboard_alive(self) -> bool:
        try:
            r = requests.get(f"{DASHBOARD_URL}/api/status", timeout=STATUS_TIMEOUT)
            return r.ok
        except requests.RequestException:
            return False

    def get_status(self) -> Optional[dict]:
        try:
            r = requests.get(f"{DASHBOARD_URL}/api/status", timeout=STATUS_TIMEOUT)
            return r.json() if r.ok else None
        except requests.RequestException:
            return None

    # ── Start ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Spawn the worker, unless one is already running on :8788 — in
        that case this app just attaches to it (single-instance guard)."""
        if self._dashboard_alive():
            print("[launcher] Worker already running on :8788 — attaching instead of spawning a new one.")
            return

        vpy = paths.venv_python()
        if not vpy.exists():
            raise RuntimeError("Worker virtual environment not found — run setup first.")

        env = os.environ.copy()
        ffmpeg = paths.bundled_ffmpeg()
        if ffmpeg:
            env["FFMPEG_BIN"] = str(ffmpeg)

        cmd = [str(vpy), str(paths.worker_src_dir() / "main.py"),
               "--config", str(paths.worker_yaml_path())]

        creationflags = 0
        if os.name == "nt":
            # CREATE_NEW_PROCESS_GROUP is required for send_signal(CTRL_BREAK_EVENT)
            # to work later — without it there's no separate process group to
            # target. We don't actually rely on CTRL_BREAK_EVENT for the normal
            # shutdown path (that's /api/shutdown, an HTTP call — far more
            # reliable against a windowless child than a console signal), but
            # this keeps a Ctrl+Break-style fallback available if HTTP shutdown
            # itself is ever unreachable (e.g. the worker crashed before the
            # dashboard thread came up).
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "CREATE_NO_WINDOW", 0)

        self._log_file = open(paths.worker_log_path(), "a", encoding="utf-8", errors="replace")
        self._log_file.write(f"\n===== launcher starting worker: {cmd} =====\n")
        self._log_file.flush()

        self._proc = subprocess.Popen(
            cmd, env=env, cwd=str(paths.worker_src_dir()),
            stdout=self._log_file, stderr=subprocess.STDOUT,
            creationflags=creationflags,
        )
        print(f"[launcher] Worker spawned, pid={self._proc.pid}. Log: {paths.worker_log_path()}")

        self._wait_for_dashboard(timeout=60)

    def _wait_for_dashboard(self, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self._dashboard_alive():
                return True
            if self._proc is not None and self._proc.poll() is not None:
                raise RuntimeError(
                    f"Worker process exited early (code {self._proc.returncode}) — see {paths.worker_log_path()}"
                )
            time.sleep(1)
        return False

    # ── Stop ──────────────────────────────────────────────────────────────

    def stop(self, timeout: float = SHUTDOWN_TIMEOUT) -> None:
        """Ask the worker to stop via HTTP, then wait, then hard-kill the
        whole process tree if it hasn't exited in time. Safe to call even if
        nothing is running."""
        if not self.is_running():
            return

        try:
            requests.post(f"{DASHBOARD_URL}/api/shutdown", timeout=STATUS_TIMEOUT)
        except requests.RequestException as e:
            print(f"[launcher] /api/shutdown request failed ({e}) — will hard-kill instead.")

        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self._dashboard_alive() and (self._proc is None or self._proc.poll() is not None):
                break
            time.sleep(SHUTDOWN_POLL_INTERVAL)
        else:
            print("[launcher] Worker did not stop gracefully in time — hard-killing.")

        self._hard_kill()

        if self._log_file:
            self._log_file.close()
            self._log_file = None

    def _hard_kill(self) -> None:
        if self._proc is None:
            return
        if self._proc.poll() is not None:
            self._proc = None
            return
        pid = self._proc.pid
        if os.name == "nt":
            # taskkill /T kills the whole process tree (ffmpeg children
            # included) — a plain proc.terminate() only signals the parent
            # and can orphan children.
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True)
        else:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None
