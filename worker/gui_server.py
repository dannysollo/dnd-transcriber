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
_stop_event = None   # threading.Event — set by main.py (optional, for /api/shutdown)

# discord_token stays masked here even though Craig Watcher (the feature
# that used it) has been removed — harmless defensively, in case a stale
# worker.yaml from before the removal still has one sitting in it.
SENSITIVE_FIELDS = {"api_key", "hf_token", "discord_token"}
EDITABLE_FIELDS = {"poll_interval", "diarize_speakers", "whisper_model", "audio_dir", "use_hotwords"}


def init(log_buffer, config: dict, config_path, start_time: float, stop_event=None):
    global _log_buffer, _config, _config_path, _start_time, _stop_event
    _log_buffer = log_buffer
    _config = config
    _config_path = Path(config_path)
    _start_time = start_time
    _stop_event = stop_event


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
<meta name="color-scheme" content="light dark">
<title>DnD Transcriber Worker</title>
<style>
  /* The site's journal look (see DESIGN.md): laid paper and ink by day, the
     same page by lamplight when the system is in dark mode. */
  @font-face {
    font-family: 'EB Garamond Worker';
    src: url('/font/eb-garamond.woff2') format('woff2');
    font-weight: 400 800;
    font-display: swap;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    color-scheme: light;
    --cover: #2A1E17; --cover-ink: #E7D5B3; --gilt: #B08D57;
    --page: #F5F0E6; --sunk: #EDE6D8; --rule: #D8CCB6; --rule-strong: #BFAF93;
    --ink: #2B2622; --ink-soft: #5E5347; --ink-faint: #716250;
    --rubric: #9E2B25; --rubric-hover: #85231E; --on-rubric: #FBF5EA;
    --moss: #46632F; --ochre: #8A5B0C;
    --font: 'EB Garamond Worker', 'EB Garamond', Garamond, 'Times New Roman', serif;
    --mono: 'Consolas', 'Fira Mono', monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --cover: #120D0A; --cover-ink: #D9C7A8; --gilt: #C9A66B;
      --page: #1F1914; --sunk: #282019; --rule: #3E3329; --rule-strong: #57493B;
      --ink: #EAE0CE; --ink-soft: #BFAF97; --ink-faint: #9C8C73;
      --rubric: #E57A6C; --rubric-hover: #EE9285; --on-rubric: #1F1914;
      --moss: #9DBB7E; --ochre: #DDAA4B;
    }
  }
  body { background: var(--page); color: var(--ink); font-family: var(--font); font-size: 17px; line-height: 1.5; font-variant-numeric: lining-nums; }
  ::selection { background: color-mix(in srgb, var(--rubric) 18%, transparent); }
  :focus-visible { outline: 2px solid var(--gilt); outline-offset: 2px; }
  header {
    background: var(--cover); color: var(--cover-ink);
    padding: 16px 32px; display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid var(--gilt);
  }
  header h1 { font-size: 22px; font-weight: 500; font-variant: small-caps; letter-spacing: .06em; }
  header .meta { font-size: 15px; margin-left: auto; text-align: right; opacity: .8; }
  .container { max-width: 1100px; margin: 0 auto; padding: 28px 32px 40px; display: grid; gap: 36px; }
  .card h2 { font-size: 19px; font-weight: 600; font-variant: small-caps; letter-spacing: .04em; color: var(--rubric);
             border-bottom: 1px solid var(--rule); padding-bottom: 4px; margin-bottom: 14px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }
  /* Config */
  .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; }
  .field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .field label { font-size: 15px; color: var(--ink-soft); }
  .field .val { color: var(--ink); font-size: 17px; overflow-wrap: anywhere; }
  .field input, .field select {
    background: transparent; border: none; border-bottom: 1px solid var(--rule-strong); border-radius: 0;
    padding: 4px 2px; color: var(--ink); font: inherit; font-size: 17px; outline: none;
  }
  .field input:focus, .field select:focus { border-bottom-color: var(--gilt); }
  .btn { background: var(--rubric); color: var(--on-rubric); border: 1px solid var(--rubric); border-radius: 3px;
         padding: 5px 16px; font: inherit; font-size: 16px; cursor: pointer; }
  .btn:hover { background: var(--rubric-hover); border-color: var(--rubric-hover); }
  .btn.secondary { background: transparent; color: var(--ink-soft); border-color: var(--rule-strong); }
  .btn.secondary:hover { color: var(--ink); border-color: var(--ink-faint); }
  .save-row { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  #save-msg { font-size: 16px; color: var(--moss); }
  .sub { margin: 24px 0 12px; }
  /* Sessions table */
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 4px 8px 6px 0; font-size: 15px; font-weight: 600; color: var(--ink-soft); border-bottom: 1px solid var(--rule-strong); }
  td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--rule); font-size: 16px; }
  tr:hover td { background: color-mix(in srgb, var(--gilt) 7%, transparent); }
  .badge { font-size: 16px; color: var(--ink-soft); }
  .badge.pending { color: var(--ochre); }
  .badge.done, .badge.complete, .badge.transcribed { color: var(--moss); }
  .badge.error, .badge.failed { color: var(--rubric); }
  .badge.processing, .badge.claimed { color: var(--ink); font-weight: 600; }
  .tbl-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
  .tbl-header h2 { border: none; padding: 0; }
  /* Logs: machine output, so monospace on a sunk panel */
  #log-panel {
    background: var(--sunk); border: 1px solid var(--rule); border-radius: 3px;
    font-family: var(--mono); font-size: 12.5px; color: var(--ink-soft); line-height: 1.55;
    height: 300px; overflow-y: auto; padding: 10px 12px;
    white-space: pre-wrap; word-break: break-all;
  }
  .log-controls { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
  .log-controls h2 { border: none; padding: 0; margin: 0; }
  #autoscroll-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 15px; color: var(--ink-soft); }
  #autoscroll-toggle input { accent-color: var(--rubric); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #9DBB7E; display: inline-block; }
  .empty { color: var(--ink-faint); text-align: center; padding: 20px; }
  * { scrollbar-width: thin; scrollbar-color: var(--rule-strong) transparent; }
</style>
</head>
<body>
<header>
  <span class="dot" title="Worker running"></span>
  <h1>DnD Transcriber Worker</h1>
  <div class="meta">
    <div>Running for <span id="uptime">…</span></div>
    <div id="server-url">…</div>
  </div>
</header>

<div class="container">
  <div class="grid2">
    <section class="card">
      <h2>Configuration</h2>
      <div class="config-grid" id="config-display"></div>
      <h2 class="sub">Change settings</h2>
      <div class="config-grid">
        <div class="field">
          <label for="ed-poll_interval">Check for jobs every (seconds)</label>
          <input type="number" id="ed-poll_interval" min="5" max="3600">
        </div>
        <div class="field">
          <label for="ed-diarize_speakers">Speakers per shared mic</label>
          <select id="ed-diarize_speakers">
            <option value="">Not set</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
          </select>
        </div>
        <div class="field">
          <label for="ed-whisper_model">Transcription model</label>
          <select id="ed-whisper_model">
            <option value="">Campaign default</option>
            <option value="tiny">tiny</option>
            <option value="base">base</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
            <option value="turbo">turbo</option>
          </select>
        </div>
        <div class="field">
          <label for="ed-use_hotwords">Name biasing (hotwords)</label>
          <select id="ed-use_hotwords">
            <option value="">Campaign default</option>
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        </div>
      </div>
      <div class="save-row">
        <button class="btn" onclick="saveConfig()">Save settings</button>
        <span id="save-msg"></span>
      </div>
    </section>

    <section class="card">
      <div class="tbl-header">
        <h2>Sessions</h2>
        <button class="btn secondary" onclick="loadJobs()">Refresh</button>
      </div>
      <div id="sessions-table"><p class="empty">Loading…</p></div>
    </section>
  </div>

  <section class="card">
    <div class="log-controls">
      <h2>Live log</h2>
      <label id="autoscroll-toggle">
        <input type="checkbox" id="autoscroll" checked> Follow new lines
      </label>
    </div>
    <div id="log-panel"></div>
  </section>
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
  const SHOW = {
    server_url: 'Site', campaign_slug: 'Campaign', audio_dir: 'Audio folder',
    poll_interval: 'Checks every (s)', whisper_model: 'Model', use_hotwords: 'Name biasing',
    diarize_speakers: 'Speakers per shared mic', api_key: 'Worker key', hf_token: 'Hugging Face token',
    auto_update: 'Auto-update',
  };
  display.replaceChildren(...Object.entries(SHOW)
    .filter(([k]) => cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '')
    .map(([k, label]) => {
      const f = document.createElement('div'); f.className = 'field';
      const l = document.createElement('label'); l.textContent = label;
      const v = document.createElement('div'); v.className = 'val'; v.textContent = cfg[k] === true ? 'On' : cfg[k] === false ? 'Off' : String(cfg[k]);
      f.append(l, v); return f;
    }));

  // Pre-fill editable fields
  ['poll_interval','diarize_speakers','whisper_model','use_hotwords'].forEach(k => {
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
    const LABEL = { pending: 'queued', claimed: 'transcribing', processing: 'transcribing', done: 'done', error: 'failed' };
    const table = document.createElement('table');
    const head = table.insertRow();
    ['Session', 'Status', 'Queued'].forEach(t => { const th = document.createElement('th'); th.textContent = t; head.append(th); });
    sessions.forEach(s => {
      const st = (s.status || '').toLowerCase();
      const row = table.insertRow();
      row.insertCell().textContent = s.name || s.session_name || '';
      const badge = document.createElement('span');
      badge.className = 'badge ' + st; badge.textContent = LABEL[st] || s.status || '';
      row.insertCell().append(badge);
      row.insertCell().textContent = s.created_at ? new Date(s.created_at).toLocaleString() : '';
    });
    tbody.replaceChildren(table);
  } catch(e) {
    tbody.innerHTML = '<p class="empty">Could not load sessions. Is the site reachable?</p>';
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
  const fields = ['poll_interval','diarize_speakers','whisper_model','use_hotwords'];
  fields.forEach(k => {
    const el = document.getElementById('ed-'+k);
    if (!el) return;
    const v = el.value.trim();
    if (v === '') return;
    if (k === 'poll_interval') payload[k] = parseInt(v, 10);
    else if (k === 'diarize_speakers') payload[k] = parseInt(v, 10);
    else if (k === 'use_hotwords') payload[k] = (v === 'true');
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
    msg.textContent = d.ok ? 'Saved' : ('Not saved: ' + (d.error||'unknown error'));
    msg.style.color = d.ok ? 'var(--moss)' : 'var(--rubric)';
    if (d.ok) fetchStatus();
    setTimeout(() => msg.textContent = '', 3000);
  } catch(e) {
    msg.textContent = 'Not saved: ' + e.message;
    msg.style.color = 'var(--rubric)';
  }
}

// Mark field as user-edited so we don't overwrite while typing
['poll_interval','diarize_speakers','whisper_model','use_hotwords'].forEach(k => {
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

    @app.route("/font/eb-garamond.woff2")
    def dashboard_font():
        from journal_font import EB_GARAMOND_WOFF2
        return Response(EB_GARAMOND_WOFF2, content_type="font/woff2",
                        headers={"Cache-Control": "public, max-age=604800"})

    @app.route("/")
    def index():
        # Reported directly: after the login-persistence fix made the
        # desktop app's WebView2 profile persistent across restarts (see
        # desktop/app.py's private_mode=False), this page started getting
        # served from that same persistent cache too — a new toggle added
        # here didn't show up even after a full app restart, and the
        # WebView2 window doesn't support a hard-refresh shortcut to bypass
        # it manually. No-store forces a fresh fetch every load instead.
        return Response(
            DASHBOARD_HTML, content_type="text/html",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )

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

    @app.route("/api/shutdown", methods=["POST"])
    def api_shutdown():
        """Request a graceful stop. Used by the desktop launcher instead of
        relying on KeyboardInterrupt, which is awkward to deliver to a
        console-less Windows subprocess. Unblocks main()'s wait loop via
        stop_event directly."""
        if _stop_event is None:
            return jsonify({"ok": False, "error": "shutdown not supported by this worker instance"}), 501
        _stop_event.set()
        return jsonify({"ok": True})

    return app


def run_server(port: int = 8788):
    """Entry point called from the daemon thread."""
    app = create_app()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
