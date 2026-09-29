"""
worker/client.py — HTTP client for communicating with the dnd-transcriber server.
"""
from pathlib import Path

import requests


class WorkerClient:
    def __init__(self, config: dict):
        self.base_url = config["server_url"]
        self.slug = config["campaign_slug"]
        self.headers = {"Authorization": f"Bearer {config['api_key']}"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}/campaigns/{self.slug}{path}"

    def get_pending_jobs(self) -> list:
        r = requests.get(self._url("/worker/jobs"), headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def claim_job(self, session_name: str) -> dict | None:
        """Returns job dict, or None if job was cancelled/not found before we could claim it."""
        r = requests.post(
            self._url(f"/worker/jobs/{session_name}/claim"),
            headers=self.headers,
            timeout=30,
        )
        if r.status_code in (404, 409):
            return None  # Job was cancelled or already claimed by someone else
        r.raise_for_status()
        return r.json()

    def push_transcript(self, session_name: str, transcript_text: str, confidence: dict | None = None) -> None:
        r = requests.post(
            self._url(f"/worker/sessions/{session_name}/transcript"),
            headers=self.headers,
            json={"transcript": transcript_text, "confidence": confidence},
            timeout=60,
        )
        r.raise_for_status()

    def push_audio(self, session_name: str, audio_path) -> None:
        audio_path = Path(audio_path)
        with open(audio_path, "rb") as f:
            r = requests.post(
                self._url(f"/worker/sessions/{session_name}/audio"),
                headers=self.headers,
                files={"file": (audio_path.name, f)},
                timeout=300,
            )
        r.raise_for_status()

    def report_error(self, session_name: str, error: str) -> None:
        r = requests.post(
            self._url(f"/worker/jobs/{session_name}/error"),
            headers=self.headers,
            json={"error": error},
            timeout=30,
        )
        r.raise_for_status()

    def heartbeat(self) -> None:
        r = requests.post(
            self._url("/worker/heartbeat"),
            headers=self.headers,
            timeout=30,
        )
        r.raise_for_status()

    def get_campaign_config(self) -> dict:
        """Fetch campaign config (players, vocab, vad, etc.) from the server."""
        r = requests.get(self._url("/worker/config"), headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def get_pending_analysis_jobs(self) -> list:
        """Return sessions with a pending analysis flag."""
        r = requests.get(self._url("/worker/analysis-jobs"), headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def push_analysis_result(self, session_name: str, summary: str, wiki: str, description: str = "", wiki_only: bool = False) -> None:
        r = requests.post(
            self._url(f"/worker/sessions/{session_name}/analysis-result"),
            headers=self.headers,
            json={"summary": summary, "wiki": wiki, "description": description, "wiki_only": wiki_only},
            timeout=60,
        )
        r.raise_for_status()

    def get_continuity_job(self) -> dict | None:
        """The next session waiting for a continuity check (worker/continuity.py), or None."""
        r = requests.get(self._url("/worker/continuity-job"), headers=self.headers, timeout=60)
        if r.status_code == 404:
            return None  # a server from before continuity checks
        r.raise_for_status()
        return r.json().get("job")

    def push_continuity_result(self, session_name: str, items: list[dict], error: str | None = None) -> None:
        r = requests.post(self._url(f"/worker/sessions/{session_name}/continuity-result"),
                          headers=self.headers, json={"items": items, "error": error}, timeout=60)
        r.raise_for_status()

    def download_recording(self, session_name: str, dest_dir) -> "Path":
        """The uploaded recording for a reconstruction job, streamed to dest_dir."""
        from pathlib import Path
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        with requests.get(self._url(f"/worker/sessions/{session_name}/recording"), headers=self.headers,
                          stream=True, timeout=(30, 600)) as r:
            r.raise_for_status()
            name = r.headers.get("content-disposition", "").split("filename=")[-1].strip('"; ') or "recording.mp3"
            dest = dest_dir / name
            with open(dest, "wb") as f:
                for chunk in r.iter_content(1024 * 1024):
                    f.write(chunk)
        return dest

    def push_unknown_voices(self, session_name: str, data: dict) -> None:
        r = requests.post(self._url(f"/worker/sessions/{session_name}/unknown-voices"),
                          headers=self.headers, json=data, timeout=30)
        r.raise_for_status()

    def get_wiki_job(self) -> dict | None:
        r = requests.get(self._url("/worker/wiki-job"), headers=self.headers, timeout=60)
        r.raise_for_status()
        return r.json().get("job")

    def push_wiki_pages(self, pages: list[dict]) -> None:
        r = requests.post(self._url("/worker/wiki-pages"), headers=self.headers, json={"pages": pages}, timeout=60)
        r.raise_for_status()

    def wiki_status(self, state: str, done: int, total: int, message: str) -> None:
        r = requests.post(self._url("/worker/wiki-status"), headers=self.headers,
                          json={"state": state, "done": done, "total": total, "message": message}, timeout=60)
        r.raise_for_status()

    def get_voice_library(self) -> dict:
        """The campaign's voice profiles (worker/voices.py)."""
        r = requests.get(self._url("/worker/voices"), headers=self.headers, timeout=30)
        r.raise_for_status()
        return r.json()

    def put_voice_library(self, library: dict) -> None:
        r = requests.put(self._url("/worker/voices"), headers=self.headers, json=library, timeout=60)
        r.raise_for_status()
