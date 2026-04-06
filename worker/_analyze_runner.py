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


def call_anthropic_direct(system_prompt: str, message: str, api_key: str) -> str:
    """Call Anthropic Messages API directly. No openclaw agent overhead."""
    payload = json.dumps({
        "model": "claude-opus-4-5",
        "max_tokens": 8192,
        "system": system_prompt,
        "messages": [{"role": "user", "content": message}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read())
        return body["content"][0]["text"]


def call_openclaw_gateway(system_prompt: str, message: str) -> str:
    """Fall back to openclaw gateway if no Anthropic key is available."""
    config_path = Path.home() / ".openclaw" / "openclaw.json"
    token = os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")
    if not token and config_path.exists():
        try:
            cfg = json.loads(config_path.read_text())
            token = cfg.get("gateway", {}).get("auth", {}).get("token", "")
        except Exception:
            pass
    if not token:
        raise RuntimeError("no gateway token found")

    port = int(os.environ.get("OPENCLAW_GATEWAY_PORT", "18789"))
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
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read())
        return body["choices"][0]["message"]["content"]


def main():
    message = sys.stdin.read()
    if not message.strip():
        print("ERROR: empty message on stdin", file=sys.stderr)
        sys.exit(1)

    system_prompt = os.environ.get("OPENCLAW_SYSTEM_PROMPT", "")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    try:
        if api_key:
            print("[analysis] Using Anthropic API directly.", file=sys.stderr)
            content = call_anthropic_direct(system_prompt, message, api_key)
        else:
            print("[analysis] No ANTHROPIC_API_KEY — falling back to openclaw gateway.", file=sys.stderr)
            content = call_openclaw_gateway(system_prompt, message)
        print(content)
        sys.exit(0)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP error {e.code}: {err[:500]}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Analysis request failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
