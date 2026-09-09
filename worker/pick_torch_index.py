"""
worker/pick_torch_index.py — Find a working CUDA torch/torchaudio wheel index
for the current Python + platform.

PyTorch's CUDA wheel index (download.pytorch.org/whl/cuNNN) gets a new NNN
periodically as CUDA majors advance, and old indices don't get new Python-
version wheels added retroactively. Both worker/setup.bat and
desktop/onboarding.py used to hardcode cu121 — verified stale (2026-09):
cu121 has no cp313-win_amd64 torch wheel at all, and cu132 (the newest at
time of writing) has torch but dropped torchaudio entirely (matches
torchaudio's real upstream deprecation). Hardcoding any specific cuNNN
value will go stale again the same way — this queries the index live and
picks the newest cuNNN that actually has a matching torch AND torchaudio
wheel for the running interpreter + OS, instead of trusting a number
written down at some point in the past.

Usage: python pick_torch_index.py
Prints the index URL (e.g. https://download.pytorch.org/whl/cu130) to
stdout and exits 0 on success; exits 1 with nothing on stdout if no match
was found (callers should fall back to CPU-only torch in that case).
"""
import re
import sys
import sysconfig
import urllib.request

BASE = "https://download.pytorch.org/whl/"


def _fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def _platform_tag() -> str:
    plat = sysconfig.get_platform()
    if plat.startswith("win"):
        return "win_amd64"
    if plat.startswith("linux"):
        return "linux_x86_64"
    return plat.replace("-", "_")


def _python_tag() -> str:
    return f"cp{sys.version_info.major}{sys.version_info.minor}"


def find_cuda_index(python_tag: str | None = None, platform_tag: str | None = None) -> str | None:
    """python_tag/platform_tag are overridable for testing; real callers
    should leave them as None so this reflects the actual interpreter it's
    running under (which for both setup.bat and onboarding.py is always the
    worker's own venv python, so the tags are accurate for the real target)."""
    py_tag = python_tag or _python_tag()
    plat_tag = platform_tag or _platform_tag()

    try:
        listing = _fetch(BASE)
    except Exception as e:
        print(f"Could not reach {BASE}: {e}", file=sys.stderr)
        return None

    # Only plain "cuNNN" directories — not "-full" (bundles cuDNN etc, much
    # larger, separate track) or "-pypi-cudnn" variants.
    candidates = sorted(
        {int(m) for m in re.findall(r'href="cu(\d+)/"', listing)},
        reverse=True,
    )

    def wheel_pattern(pkg: str) -> re.Pattern:
        # Matches both literal "+" and its URL-encoded "%2B" form (both
        # appear in the index HTML depending on how a given release was
        # published).
        return re.compile(
            rf'{pkg}-[\d.]+(?:\+|%2[bB])cu\d+-{py_tag}-{py_tag}[a-z]*-{plat_tag}\.whl'
        )

    for cu in candidates:
        idx_url = f"{BASE}cu{cu}/"
        try:
            torch_listing = _fetch(f"{idx_url}torch/")
            audio_listing = _fetch(f"{idx_url}torchaudio/")
        except Exception:
            continue
        if wheel_pattern("torch").search(torch_listing) and wheel_pattern("torchaudio").search(audio_listing):
            return idx_url

    return None


if __name__ == "__main__":
    result = find_cuda_index()
    if result:
        print(result)
        sys.exit(0)
    print("No matching CUDA torch+torchaudio index found for this Python/platform.", file=sys.stderr)
    sys.exit(1)
