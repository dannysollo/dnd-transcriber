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

    def claim_job(self, session_name: str) -> dict:
        r = requests.post(
            self._url(f"/worker/jobs/{session_name}/claim"),
            headers=self.headers,
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def push_transcript(self, session_name: str, transcript_text: str) -> None:
        r = requests.post(
            self._url(f"/worker/sessions/{session_name}/transcript"),
            headers=self.headers,
            json={"transcript": transcript_text},
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
