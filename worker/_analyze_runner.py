"""
_analyze_runner.py
Reads transcript from stdin, sends to OpenClaw gateway via OpenAI-compatible
/v1/chat/completions endpoint. No ARG_MAX limits.

Usage: python _analyze_runner.py
Env:   OPENCLAW_SYSTEM_PROMPT   — system prompt for the analysis
       OPENCLAW_GATEWAY_PORT    — gateway port (default 18789)
       OPENCLAW_GATEWAY_TOKEN   — gateway bearer token (auto-read from config if unset)
"""
import json
import os
import sys
import urllib.request
from pathlib import Path


def get_gateway_token() -> str:
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
    if token:
        return token
    config_path = Path.home() / ".openclaw" / "openclaw.json"
    if config_path.exists():
        try:
            cfg = json.loads(config_path.read_text())
            return cfg.get("gateway", {}).get("auth", {}).get("token", "")
        except Exception:
            pass
    return ""


def main():
    message = sys.stdin.read()
    if not message.strip():
        print("ERROR: empty message on stdin", file=sys.stderr)
        sys.exit(1)

    system_prompt = os.environ.get("OPENCLAW_SYSTEM_PROMPT", "")
    gateway_port = int(os.environ.get("OPENCLAW_GATEWAY_PORT", "18789"))
    token = get_gateway_token()

    if not token:
        print("ERROR: no gateway token found", file=sys.stderr)
        sys.exit(1)

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": message})

    payload = json.dumps({
        "model": "openclaw:main",
        "messages": messages,
        "stream": False,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"http://127.0.0.1:{gateway_port}/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read())
            content = body["choices"][0]["message"]["content"]
            print(content)
            sys.exit(0)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"Gateway HTTP error {e.code}: {err[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Gateway request failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
