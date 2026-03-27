"""
worker/gui_server.py — Local web dashboard for the DnD Transcriber worker.

Runs on http://localhost:8788 as a daemon thread inside the worker process.
"""
import json
import time
from pathlib import Path

import requests as _requests
import yaml

# ─── Module-level shared state (set by main.py before starting the thread) ──

_log_buffer = None   # collections.deque — set by main.py
_config = None       # dict — set by main.py (live reference)
_config_path = None  # Path — set by main.py
_start_time = None   # float — set by main.py

SENSITIVE_FIELDS = {"api_key", "hf_token", "discord_token"}
EDITABLE_FIELDS = {"poll_interval", "diarize_speakers", "whisper_model", "audio_dir"}


def init(log_buffer, config: dict, config_path, start_time: float):
    global _log_buffer, _config, _config_path, _start_time
    _log_buffer = log_buffer
    _config = config
    _config_path = Path(config_path)
    _start_time = start_time


def _mask(key: str, value) -> str:
    if key in SENSITIVE_FIELDS and isinstance(value, str) and len(value) > 6:
        return value[:6] + "***"
    return value


def _sanitized_config() -> dict:
    return {k: _mask(k, v) for k, v in _config.items()}


# ─── HTML Dashboard ───────────────────────────────────────────────────────────

DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DnD Transcriber Worker</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117;
    --panel: #1e2130;
    --panel2: #252840;
    --border: #2e3350;
    --accent: #7c6af7;
    --accent2: #5db0f7;
    --text: #d4d8f0;
    --muted: #8890b0;
    --ok: #4caf82;
    --warn: #f5c543;
    --err: #e05c68;
    --font: 'Segoe UI', system-ui, sans-serif;
    --mono: 'Consolas', 'Fira Mono', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.5; }
  header {
    background: var(--panel); border-bottom: 1px solid var(--border);
    padding: 14px 24px; display: flex; align-items: center; gap: 16px;
  }
  header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
  header .meta { color: var(--muted); font-size: 12px; margin-left: auto; text-align: right; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px 24px; display: grid; gap: 20px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px 20px; }
  .card h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 14px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  /* Config */
  .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field label { font-size: 11px; color: var(--muted); }
  .field .val { color: var(--text); background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 13px; }
  .field input, .field select { background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; color: var(--text); font-size: 13px; outline: none; }
  .field input:focus, .field select:focus { border-color: var(--accent); }
  .btn { background: var(--accent); color: #fff; border: none; border-radius: 5px; padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn:hover { opacity: .85; }
  .btn.secondary { background: var(--panel2); color: var(--text); border: 1px solid var(--border); }
  .btn.secondary:hover { border-color: var(--accent); color: var(--accent); }
  .save-row { margin-top: 12px; display: flex; align-items: center; gap: 10px; }
  #save-msg { font-size: 12px; color: var(--ok); }
  /* Sessions table */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 6px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.03); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge.pending { background: rgba(245,197,67,.15); color: var(--warn); }
  .badge.done, .badge.complete, .badge.transcribed { background: rgba(76,175,130,.15); color: var(--ok); }
  .badge.error, .badge.failed { background: rgba(224,92,104,.15); color: var(--err); }
  .badge.processing, .badge.claimed { background: rgba(93,176,247,.15); color: var(--accent2); }
  .tbl-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  /* Logs */
  #log-panel {
    background: #0a0c12; border: 1px solid var(--border); border-radius: 5px;
    font-family: var(--mono); font-size: 12px; color: #9fa8d4;
    height: 260px; overflow-y: auto; padding: 10px 12px;
    white-space: pre-wrap; word-break: break-all;
  }
  .log-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  #autoscroll-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--muted); }
  /* Status dot */
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); display: inline-block; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .empty { color: var(--muted); font-style: italic; text-align: center; padding: 20px; }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>DnD Transcriber Worker</h1>
  <div class="meta">
    <div>Uptime: <span id="uptime">…</span></div>
    <div id="server-url" style="color:var(--accent2)">…</div>
  </div>
</header>

<div class="container">
  <div class="grid2">
    <!-- Config card -->
    <div class="card">
      <h2>Configuration</h2>
      <div class="config-grid" id="config-display"></div>
      <hr style="border-color:var(--border);margin:16px 0">
      <h2>Edit Settings</h2>
      <div class="config-grid">
        <div class="field">
          <label>Poll Interval (s)</label>
          <input type="number" id="ed-poll_interval" min="5" max="3600">
        </div>
        <div class="field">
          <label>Diarize Speakers</label>
          <select id="ed-diarize_speakers">
            <option value="">— (not set)</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
          </select>
        </div>
        <div class="field">
          <label>Whisper Model</label>
          <select id="ed-whisper_model">
            <option value="">— (from campaign)</option>
            <option value="tiny">tiny</option>
            <option value="base">base</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
            <option value="turbo">turbo</option>
          </select>
        </div>
      </div>
      <div class="save-row">
        <button class="btn" onclick="saveConfig()">Save</button>
        <span id="save-msg"></span>
      </div>
    </div>

    <!-- Sessions card -->
    <div class="card">
      <div class="tbl-header">
        <h2 style="margin-bottom:0">Sessions</h2>
        <button class="btn secondary" onclick="loadJobs()">↺ Refresh</button>
      </div>
      <div id="sessions-table"><p class="empty">Loading…</p></div>
    </div>
  </div>

  <!-- Logs card -->
  <div class="card">
    <div class="log-controls">
      <h2 style="margin-bottom:0">Live Logs</h2>
      <label id="autoscroll-toggle">
        <input type="checkbox" id="autoscroll" checked> Auto-scroll
      </label>
    </div>
    <div id="log-panel"></div>
  </div>
</div>

<script>
let statusData = {};

async function fetchStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    statusData = d;
    renderStatus(d);
  } catch(e) { console.warn('status error', e); }
}

function fmtUptime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  return h>0 ? `${h}h ${m}m ${sec}s` : m>0 ? `${m}m ${sec}s` : `${sec}s`;
}

function renderStatus(d) {
  document.getElementById('uptime').textContent = fmtUptime(d.worker_uptime || 0);
  const cfg = d.config || {};
  document.getElementById('server-url').textContent = cfg.server_url || '';

  const display = document.getElementById('config-display');
  const SHOW = ['server_url','campaign_slug','audio_dir','poll_interval','whisper_model','diarize_speakers','api_key','hf_token','discord_token'];
  display.innerHTML = SHOW.filter(k => cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '').map(k =>
    `<div class="field"><label>${k}</label><div class="val">${cfg[k]}</div></div>`
  ).join('');

  // Pre-fill editable fields
  ['poll_interval','diarize_speakers','whisper_model'].forEach(k => {
    const el = document.getElementById('ed-'+k);
    if (el && !el._userEdited) el.value = cfg[k] ?? '';
  });
}

async function loadJobs() {
  const tbody = document.getElementById('sessions-table');
  tbody.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const r = await fetch('/api/jobs');
    const d = await r.json();
    const sessions = d.sessions || d;
    if (!sessions.length) { tbody.innerHTML = '<p class="empty">No sessions found.</p>'; return; }
    tbody.innerHTML = `<table>
      <tr><th>Session</th><th>Status</th><th>Created</th></tr>
      ${sessions.map(s => {
        const st = (s.status||'').toLowerCase();
        const dt = s.created_at ? new Date(s.created_at).toLocaleString() : '—';
        return `<tr><td>${s.name||s.session_name||'—'}</td><td><span class="badge ${st}">${s.status||'—'}</span></td><td>${dt}</td></tr>`;
      }).join('')}
    </table>`;
  } catch(e) {
    tbody.innerHTML = `<p class="empty">Error: ${e.message}</p>`;
  }
}

let logLines = [];
async function fetchLogs() {
  try {
    const r = await fetch('/api/logs');
    const lines = await r.json();
    logLines = lines;
    const panel = document.getElementById('log-panel');
    panel.textContent = lines.join('\n');
    if (document.getElementById('autoscroll').checked) {
      panel.scrollTop = panel.scrollHeight;
    }
  } catch(e) { console.warn('logs error', e); }
}

async function saveConfig() {
  const payload = {};
  const fields = ['poll_interval','diarize_speakers','whisper_model'];
  fields.forEach(k => {
    const el = document.getElementById('ed-'+k);
    if (!el) return;
    const v = el.value.trim();
    if (v === '') return;
    if (k === 'poll_interval') payload[k] = parseInt(v, 10);
    else if (k === 'diarize_speakers') payload[k] = parseInt(v, 10);
    else payload[k] = v;
  });

  const msg = document.getElementById('save-msg');
  msg.textContent = 'Saving…';
  try {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    msg.textContent = d.ok ? '✓ Saved' : ('Error: ' + (d.error||'unknown'));
    msg.style.color = d.ok ? 'var(--ok)' : 'var(--err)';
    if (d.ok) fetchStatus();
    setTimeout(() => msg.textContent = '', 3000);
  } catch(e) {
    msg.textContent = 'Error: ' + e.message;
    msg.style.color = 'var(--err)';
  }
}

// Mark field as user-edited so we don't overwrite while typing
['poll_interval','diarize_speakers','whisper_model'].forEach(k => {
  const el = document.getElementById('ed-'+k);
  if (el) el.addEventListener('change', () => el._userEdited = true);
});

// Init
fetchStatus();
loadJobs();
fetchLogs();
setInterval(fetchStatus, 5000);
setInterval(fetchLogs, 3000);
</script>
</body>
</html>
"""


# ─── Flask app ────────────────────────────────────────────────────────────────

def create_app():
    from flask import Flask, jsonify, request, Response

    app = Flask(__name__)
    app.logger.disabled = True

    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)  # suppress request logs in terminal

    @app.route("/")
    def index():
        return Response(DASHBOARD_HTML, content_type="text/html")

    @app.route("/api/status")
    def api_status():
        uptime = time.time() - _start_time if _start_time else 0
        last_jobs = list(_log_buffer)[-20:] if _log_buffer else []
        return jsonify({
            "config": _sanitized_config(),
            "last_jobs": last_jobs,
            "worker_uptime": round(uptime, 1),
        })

    @app.route("/api/logs")
    def api_logs():
        logs = list(_log_buffer)[-200:] if _log_buffer else []
        return jsonify(logs)

    @app.route("/api/jobs")
    def api_jobs():
        try:
            base = _config.get("server_url", "")
            slug = _config.get("campaign_slug", "")
            key = _config.get("api_key", "")
            if not base or not slug:
                return jsonify({"error": "server_url or campaign_slug not configured", "sessions": []}), 200
            url = f"{base}/campaigns/{slug}/sessions?limit=20"
            headers = {"Authorization": f"Bearer {key}"}
            r = _requests.get(url, headers=headers, timeout=10)
            return jsonify(r.json()), r.status_code
        except Exception as e:
            return jsonify({"error": str(e), "sessions": []}), 200

    @app.route("/api/config", methods=["POST"])
    def api_config():
        try:
            data = request.get_json(force=True) or {}
            updates = {}
            for key, val in data.items():
                if key not in EDITABLE_FIELDS:
                    continue  # silently skip non-editable/sensitive fields
                updates[key] = val

            if not updates:
                return jsonify({"ok": True, "updated": []})

            # Update in-memory config
            for key, val in updates.items():
                _config[key] = val

            # Write back to YAML
            if _config_path and _config_path.exists():
                with open(_config_path) as f:
                    raw = yaml.safe_load(f) or {}
                raw.update(updates)
                with open(_config_path, "w") as f:
                    yaml.dump(raw, f, default_flow_style=False, allow_unicode=True)

            return jsonify({"ok": True, "updated": list(updates.keys())})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    return app


def run_server(port: int = 8788):
    """Entry point called from the daemon thread."""
    app = create_app()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
