"""
worker/gui_server.py — Local web dashboard for the Co-DM worker.

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
<title>Co-DM Worker</title>
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
  .queue-actions { display: flex; gap: 8px; }
  .queue-kinds { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .queue-kinds:empty { display: none; }
  .queue-note { font-size: 15px; color: var(--ink-faint); margin: 10px 0 0; }
  .btn.danger { background: var(--rubric); color: var(--on-rubric); border-color: var(--rubric); }
  td.act { text-align: right; padding-right: 0; }
  .badge.running { color: var(--moss); font-weight: 600; }
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
  <h1>Co-DM Worker</h1>
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
        <h2>Queue</h2>
        <span class="queue-actions">
          <button class="btn secondary" onclick="loadQueue()">Refresh</button>
          <button class="btn secondary" id="clear-all" onclick="clearAll(this)" hidden>Clear all</button>
        </span>
      </div>
      <div id="queue-kinds" class="queue-kinds"></div>
      <div id="queue-table"><p class="empty">Loading…</p></div>
      <p id="queue-note" class="queue-note" hidden>A job already running finishes even if you remove it; it just won't be tried again.</p>
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

// The worker's queue, from the site (every kind of job waiting for this worker).
const PLURAL = { transcription: 'transcriptions', analysis: 'summaries', continuity: 'continuity checks', wiki: 'wiki generation' };
async function queueCall(method, path) {
  const r = await fetch(path, { method });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || d.detail || r.status);
  return d;
}
function renderQueue(items) {
  const box = document.getElementById('queue-table');
  const kinds = document.getElementById('queue-kinds');
  document.getElementById('clear-all').hidden = !items.length;
  document.getElementById('queue-note').hidden = !items.some(i => i.state === 'running');
  kinds.replaceChildren();
  const byKind = {};
  items.forEach(i => { byKind[i.kind] = (byKind[i.kind] || 0) + 1; });
  if (Object.keys(byKind).length > 1) {
    Object.entries(byKind).forEach(([kind, n]) => {
      const b = document.createElement('button'); b.className = 'btn secondary';
      b.textContent = `Clear ${PLURAL[kind] || kind} (${n})`;
      b.onclick = () => removeJobs(`/api/queue/${kind}`);
      kinds.append(b);
    });
  }
  if (!items.length) { box.innerHTML = '<p class="empty">Nothing waiting for the worker.</p>'; return; }
  const table = document.createElement('table');
  const head = table.insertRow();
  ['Session', 'Job', 'Status', ''].forEach(t => { const th = document.createElement('th'); th.textContent = t; head.append(th); });
  items.forEach(it => {
    const row = table.insertRow();
    row.insertCell().textContent = it.session || '';
    row.insertCell().textContent = it.label;
    const badge = document.createElement('span');
    badge.className = 'badge ' + it.state; badge.textContent = it.state === 'running' ? 'running now' : 'waiting';
    row.insertCell().append(badge);
    const cell = row.insertCell(); cell.className = 'act';
    const b = document.createElement('button'); b.className = 'btn secondary'; b.textContent = 'Remove';
    b.title = it.state === 'running' ? 'Take it off the queue. What already started finishes.' : 'Take it off the queue';
    b.onclick = () => removeJobs(`/api/queue/${it.kind}` + (it.session ? `?session=${encodeURIComponent(it.session)}` : ''));
    cell.append(b);
  });
  box.replaceChildren(table);
}
async function loadQueue() {
  try { renderQueue((await queueCall('GET', '/api/queue')).items || []); }
  catch (e) { document.getElementById('queue-table').innerHTML = '<p class="empty">Could not load the queue. Is the site reachable?</p>'; }
}
async function removeJobs(path) {
  try { renderQueue((await queueCall('DELETE', path)).items || []); }
  catch (e) { alert('Could not remove it: ' + e.message); }
}
async function clearAll(btn) {
  if (!btn.dataset.confirm) {
    btn.dataset.confirm = '1'; btn.textContent = 'Confirm: clear all'; btn.classList.add('danger');
    setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'Clear all'; btn.classList.remove('danger'); }, 4000);
    return;
  }
  delete btn.dataset.confirm; btn.textContent = 'Clear all'; btn.classList.remove('danger');
  await removeJobs('/api/queue');
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
loadQueue();
fetchLogs();
setInterval(fetchStatus, 5000);
setInterval(loadQueue, 15000);
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

    # The worker's queue on the site, with this worker's key (the dashboard is where
    # the worker is managed): list it, remove one job, a kind, or everything.
    def _site(method: str, path: str, params: dict | None = None):
        base = _config.get("server_url", "")
        slug = _config.get("campaign_slug", "")
        if not base or not slug:
            return jsonify({"error": "server_url or campaign_slug not configured", "items": []}), 200
        try:
            r = _requests.request(method, f"{base}/campaigns/{slug}/worker/queue{path}", params=params,
                                  headers={"Authorization": f"Bearer {_config.get('api_key', '')}"}, timeout=15)
            return jsonify(r.json()), r.status_code
        except Exception as e:
            return jsonify({"error": str(e), "items": []}), 200

    @app.route("/api/queue", methods=["GET", "DELETE"])
    def api_queue():
        return _site(request.method, "")

    @app.route("/api/queue/<kind>", methods=["DELETE"])
    def api_queue_remove(kind):
        session = request.args.get("session")
        return _site("DELETE", f"/{kind}", {"session": session} if session else None)

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
