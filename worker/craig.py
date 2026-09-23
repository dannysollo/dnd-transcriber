"""
worker/craig.py — Fetch a Craig recording straight from its share link.

A Craig link looks like https://craig.horse/rec/<id>?key=<key>. The download
page is backed by a small JSON API (CraigChat/craig, apps/ferret):

  GET  /api/v1/recordings/<id>?key=K        recording info (404/401 on bad link)
  GET  /api/v1/recordings/<id>/job?key=K    latest processing job, if any
  POST /api/v1/recordings/<id>/job?key=K    start one: {"type": "recording",
                                            "options": {"format", "container"}}
  GET  /dl/<outputFileName>                 the finished file

A job goes queued -> running -> complete (or error/cancelled). We ask for
per-speaker FLAC in a zip — the same thing you'd get clicking "FLAC" on the
download page — and unpack the audio into the session's audio dir, so the
rest of the worker can't tell it apart from a hand-dropped Craig export.
"""
import time
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

AUDIO_EXTENSIONS = {".flac", ".wav", ".mp3", ".m4a", ".ogg"}
WANTED_OPTIONS = {"format": "flac", "container": "zip"}


class CraigError(RuntimeError):
    pass


def parse_craig_url(url: str) -> tuple[str, str, str]:
    """Return (base_url, recording_id, key). Raises CraigError if it isn't a Craig link."""
    parsed = urlparse(url.strip())
    parts = [p for p in parsed.path.split("/") if p]
    key = parse_qs(parsed.query).get("key", [""])[0]
    if parsed.scheme not in ("http", "https") or len(parts) != 2 or parts[0] != "rec" or not key:
        raise CraigError(f"Not a Craig recording link (expected https://<host>/rec/<id>?key=<key>): {url}")
    return f"{parsed.scheme}://{parsed.netloc}", parts[1], key


def _api_error(r: requests.Response) -> str:
    try:
        body = r.json()
        return body.get("error") or body.get("message") or r.text[:200]
    except ValueError:
        return r.text[:200]


def _is_wanted(job: dict | None) -> bool:
    if not job or job.get("type") != "recording":
        return False
    options = job.get("options") or {}
    return all(options.get(k) == v for k, v in WANTED_OPTIONS.items()) and not options.get("ignoredTracks")


def download_recording(url: str, dest_dir: Path, poll_interval: float = 5, timeout: float = 3 * 3600) -> list[Path]:
    """
    Have Craig build a per-speaker FLAC zip for the recording at `url`, download
    it, and extract the audio tracks into dest_dir. Returns the extracted paths.
    """
    base, rec_id, key = parse_craig_url(url)
    api = f"{base}/api/v1/recordings/{rec_id}"
    params = {"key": key}

    r = requests.get(api, params=params, timeout=30)
    if r.status_code != 200:
        raise CraigError(f"Craig rejected the link ({r.status_code}): {_api_error(r)}")
    info = r.json()
    if info.get("live"):
        raise CraigError("Craig is still recording this session — stop the recording first.")
    users = info.get("users") or []
    print(f"[craig]  Recording {rec_id}: {len(users)} track(s)")

    def get_job() -> dict | None:
        r = requests.get(f"{api}/job", params=params, timeout=30)
        if r.status_code != 200:
            raise CraigError(f"Craig job lookup failed ({r.status_code}): {_api_error(r)}")
        return r.json().get("job")

    def start_job() -> dict:
        r = requests.post(
            f"{api}/job", params=params, timeout=30,
            json={"type": "recording", "options": WANTED_OPTIONS},
        )
        if r.status_code != 200:
            raise CraigError(f"Craig wouldn't start processing ({r.status_code}): {_api_error(r)}")
        return r.json()["job"]

    deadline = time.monotonic() + timeout
    job = get_job()
    # Reuse a matching job someone already ran (e.g. a FLAC download from the
    # browser). Only one job runs per recording, so a different in-flight one
    # has to finish before ours can start.
    while not (_is_wanted(job) and job.get("status") in ("queued", "running", "complete")):
        if job and job.get("status") in ("queued", "running"):
            print(f"[craig]  Another Craig job is {job['status']} for this recording; waiting for it...")
        else:
            job = start_job()
            print(f"[craig]  Started Craig FLAC job {job.get('id')}")
            break
        if time.monotonic() > deadline:
            raise CraigError("Timed out waiting for Craig's existing job to finish.")
        time.sleep(poll_interval)
        job = get_job()

    last_status = None
    while job.get("status") != "complete":
        status = job.get("status")
        if status in ("error", "cancelled", "idle"):
            raise CraigError(f"Craig processing ended with status '{status}'.")
        if status != last_status:
            print(f"[craig]  Craig job {status}...")
            last_status = status
        if time.monotonic() > deadline:
            raise CraigError("Timed out waiting for Craig to finish processing.")
        time.sleep(poll_interval)
        job = get_job()
        if job is None:
            raise CraigError("Craig's processing job disappeared (expired or cancelled).")

    file_name = job.get("outputFileName")
    if not file_name:
        raise CraigError("Craig finished but didn't report an output file.")

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / f".craig-{rec_id}.zip.part"
    size = job.get("outputSize")
    print(f"[craig]  Downloading {file_name}" + (f" ({size / 1e6:.0f} MB)" if size else "") + "...")
    try:
        with requests.get(f"{base}/dl/{file_name}", stream=True, timeout=60) as r:
            if r.status_code != 200:
                raise CraigError(f"Craig download failed ({r.status_code}).")
            with open(zip_path, "wb") as out:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    out.write(chunk)

        extracted = []
        with zipfile.ZipFile(zip_path) as zf:
            for member in zf.infolist():
                name = Path(member.filename).name
                if member.is_dir() or Path(name).suffix.lower() not in AUDIO_EXTENSIONS:
                    continue
                target = dest_dir / name
                with zf.open(member) as src, open(target, "wb") as out:
                    while chunk := src.read(1 << 20):
                        out.write(chunk)
                extracted.append(target)
    finally:
        zip_path.unlink(missing_ok=True)

    if not extracted:
        raise CraigError("Craig's zip contained no audio tracks.")
    print(f"[craig]  Extracted {len(extracted)} track(s) to {dest_dir}")
    return sorted(extracted)
