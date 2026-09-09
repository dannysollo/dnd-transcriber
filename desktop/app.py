"""
desktop/app.py — pywebview entry point for the DnD Transcriber desktop app.

Flow:
  1. If no valid worker.yaml exists yet, the single main window loads the
     local onboarding page (onboarding_ui.html), which leads with a choice:
     "Start a New Campaign" (Discord login -> the window navigates away to
     the site for that, a background watcher in this file detects the
     session cookie appearing and brings the window back to a local
     "create campaign" screen automatically, then creates the campaign and
     generates its worker key via authenticated calls using that cookie —
     no copy/pasting a key at all) or "I Already Have a Campaign" (today's
     paste-a-key form). Both converge on the same final "set up this
     device" screen, which calls Api.run_setup() then Api.finish_onboarding()
     — the latter starts the worker and navigates that SAME window to the
     real site. There is no separate onboarding window to tear down, since
     pywebview only supports starting its GUI event loop once per process
     (webview.start() blocks until every window is destroyed).
  2. Otherwise the main window loads the Fly-hosted site directly.
  3. A tray icon (tray.py) runs alongside in its own thread. Per the user's
     explicit decision: closing the main window minimizes to tray (with a
     toast) as long as the worker is running; if no worker is running,
     closing quits normally.

IMPORTANT pywebview gotcha, hit for real during development: an Api method
that JS is `await`ing must never itself call main_window.load_url() before
returning — pywebview delivers that method's return value by evaluate_js-ing
a callback into the CALLING page, and navigating away destroys that page out
from under it, crashing with a JavascriptException. Every navigation below
either happens as plain client-side `window.location.href = ...` from the
onboarding page's own JS, or is deferred into a background thread that starts
after the triggering Api call has already returned (begin_login_watch,
finish_onboarding).

Verified against pywebview 6.2.1's actual API from this dev environment
(webview.FileDialog.FOLDER, window.events.closing returning False to cancel
a close, webview.start(func=..., gui=..., icon=...)) — but the GUI itself
(WebView2 rendering, native dialogs, tray notifications) has NOT been run on
a real Windows display; that's Milestones 1-2 in the desktop launcher plan.
"""
import sys
import threading
import time

import requests
import webview
import yaml

import onboarding
import paths
import tray as tray_module
from worker_process import WorkerProcess

DEFAULT_SERVER_URL = "https://dnd-transcriber.fly.dev"
ACCESS_TOKEN_COOKIE = "access_token"  # must match auth/jwt.py's COOKIE_NAME
LOGIN_WATCH_TIMEOUT = 300  # 5 minutes to complete the Discord login

worker = WorkerProcess()
tray_icon: tray_module.TrayIcon | None = None
main_window: webview.Window | None = None
# Which screen the onboarding page should show on its NEXT load — read once
# via Api.get_initial_screen() and reset. Not encoded as a URL query string
# on the local file path (e.g. "...onboarding_ui.html?screen=create"): local
# paths get resolved through pywebview's own embedded HTTP server, and
# whether a query string survives that resolution is untested/unconfirmed,
# so this avoids relying on it.
_next_onboarding_screen = "choice"


def _site_url() -> str:
    try:
        cfg = yaml.safe_load(paths.worker_yaml_path().read_text()) or {}
        return cfg.get("server_url") or DEFAULT_SERVER_URL
    except Exception:
        return DEFAULT_SERVER_URL


def _get_access_token() -> str | None:
    """Read the site's session cookie directly from the webview's own
    cookie store (WebView2's native CookieManager, via window.get_cookies())
    rather than JS document.cookie — the auth cookie is httpOnly specifically
    so JS can't read it, but the native cookie manager isn't subject to that
    restriction (confirmed against pywebview's edgechromium.py backend
    source: it calls CoreWebView2.CookieManager.GetCookiesAsync directly).
    This is what lets Python make authenticated calls (create campaign,
    generate a worker key) using the Discord login the user just did in the
    same window, without re-implementing OAuth or scraping the page."""
    try:
        for cookie in main_window.get_cookies():
            if ACCESS_TOKEN_COOKIE in cookie:
                return cookie[ACCESS_TOKEN_COOKIE].value
    except Exception as e:
        print(f"[launcher] Could not read cookies: {e}")
    return None


class Api:
    """Exposed to the onboarding page as window.pywebview.api.*"""

    def default_server_url(self) -> str:
        return DEFAULT_SERVER_URL

    def get_initial_screen(self) -> str:
        """Read once on every onboarding page load; see _next_onboarding_screen."""
        global _next_onboarding_screen
        screen = _next_onboarding_screen
        _next_onboarding_screen = "choice"
        return screen

    def pick_audio_dir(self) -> str:
        result = main_window.create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else ""

    def has_gpu(self) -> bool:
        return onboarding.has_nvidia_gpu()

    def validate_key(self, server_url: str, api_key: str) -> dict:
        return onboarding.validate_api_key(server_url, api_key)

    def run_setup(self, form: dict) -> dict:
        # pywebview API calls are synchronous request/response — there's no
        # channel back to JS mid-call other than reaching back in via
        # evaluate_js, which is how a multi-minute `pip install torch` gets
        # to show live progress instead of the UI just hanging.
        def progress(line: str) -> None:
            escaped = line.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
            try:
                main_window.evaluate_js(f"window.onSetupProgress(`{escaped}`)")
            except Exception:
                pass

        try:
            onboarding.run_worker_setup(progress, include_canary=bool(form.get("include_canary")))
            onboarding.write_worker_yaml(
                server_url=form["server_url"],
                api_key=form["api_key"],
                audio_dir=form["audio_dir"],
                campaign_slug=(form.get("campaign_slug") or None),
            )
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def begin_login_watch(self) -> dict:
        """Called right before the "Start a New Campaign" button navigates
        the window to Discord's OAuth flow (client-side, via
        window.location.href — NOT from here, same load_url-inside-an-
        API-call crash as before applies). Kicks off a background poll for
        the session cookie to appear so we can automatically bring the user
        back to the local "create campaign" screen the moment login
        finishes, with no manual "go back" step."""
        threading.Thread(target=_watch_for_login, daemon=True).start()
        return {"ok": True}

    def create_campaign_and_get_key(self, name: str, slug: str, description: str) -> dict:
        """Uses the session cookie from the Discord login just completed to
        create a campaign (the creator is auto-added as DM — see
        db/crud.py's create_campaign) and immediately generate its worker
        key, so the device-setup step can be pre-filled instead of making
        the user copy/paste anything. Mirrors exactly what a DM would do by
        hand on the site's own Campaign Settings > Worker tab."""
        token = _get_access_token()
        if not token:
            return {"ok": False, "error": "Not logged in — please use \"Start a New Campaign\" again and complete the Discord login first."}
        base = DEFAULT_SERVER_URL
        cookies = {ACCESS_TOKEN_COOKIE: token}
        try:
            r = requests.post(f"{base}/campaigns", json={"slug": slug, "name": name, "description": description or None},
                               cookies=cookies, timeout=15)
            if r.status_code == 400:
                return {"ok": False, "error": r.json().get("detail", f"Campaign slug '{slug}' is already taken — try a different one.")}
            r.raise_for_status()
            campaign = r.json()

            key_r = requests.post(f"{base}/campaigns/{campaign['slug']}/worker-key", cookies=cookies, timeout=15)
            key_r.raise_for_status()
            api_key = key_r.json()["api_key"]

            return {"ok": True, "server_url": base, "campaign_slug": campaign["slug"], "api_key": api_key}
        except requests.RequestException as e:
            return {"ok": False, "error": str(e)}

    def finish_onboarding(self) -> dict:
        # Must NOT call _start_worker_and_load_site() synchronously here:
        # worker.start() can take up to 60s (waiting on the dashboard to come
        # up), which would leave this API call hanging and the onboarding
        # page looking frozen — and worse, _start_worker_and_load_site()
        # ends with main_window.load_url(), which navigates the very page
        # that pywebview still needs to deliver THIS call's return value
        # into (that's exactly what crashed open_campaign_site() with a
        # "callback is not a function" error — the framework tries to run
        # its return-value JS against a page that's already gone). Returning
        # immediately and doing the real work in a background thread avoids
        # both: the return value lands on the still-current onboarding page
        # right away, and by the time the thread gets around to navigating,
        # there's no pending callback left to race.
        threading.Thread(target=_start_worker_and_load_site, daemon=True).start()
        return {"ok": True}


def _watch_for_login() -> None:
    """Polls the webview's cookie store (see _get_access_token) until the
    Discord login the user is presumably in the middle of completes, then
    automatically navigates back to the local onboarding page's "create
    campaign" screen. This itself runs in a background thread — by the time
    it calls load_url(), begin_login_watch()'s own return value has long
    since been delivered, so this doesn't hit the navigate-during-an-API-
    call race that crashed open_campaign_site() before."""
    deadline = time.time() + LOGIN_WATCH_TIMEOUT
    while time.time() < deadline:
        time.sleep(1.5)
        if _get_access_token():
            global _next_onboarding_screen
            _next_onboarding_screen = "create"
            main_window.load_url(str(paths.onboarding_html_path()))
            return
    # Timed out — leave them wherever they are. The tray's "Set Up /
    # Reconfigure Worker" item is still there if they come back later.


def _start_worker_and_load_site() -> None:
    try:
        worker.start()
    except Exception as e:
        # Don't block the user from at least seeing the site — the worker
        # dashboard will just show "unreachable" until they fix whatever
        # went wrong and hit "Restart Worker" from the tray menu.
        print(f"[launcher] Failed to start worker: {e}")
    main_window.load_url(_site_url())


def _on_closing() -> bool:
    """Returning False cancels the close (pywebview convention — see
    webview/event.py's Event.set(): it treats an explicit `False` return
    from any handler as "cancel"). Returning True/None lets it proceed."""
    if worker.is_running():
        main_window.hide()
        if tray_icon:
            tray_icon.notify(
                "DnD Transcriber Worker",
                "Still transcribing in the background. Right-click the tray icon to reopen or quit.",
            )
        return False
    _cleanup()
    return True


def _cleanup() -> None:
    worker.stop()
    if tray_icon:
        tray_icon.stop()


def _tray_open_site() -> None:
    main_window.show()
    main_window.load_url(_site_url())


def _tray_open_dashboard() -> None:
    webview.create_window("Worker Dashboard", "http://127.0.0.1:8788", width=1000, height=700)


def _tray_setup_worker() -> None:
    """Always available, not just on first run — the way back to the local
    setup form after "go get a campaign/key on the site", and also how
    someone re-configures the worker later (new campaign, new audio folder)
    without deleting worker.yaml by hand."""
    main_window.show()
    main_window.load_url(str(paths.onboarding_html_path()))


def _tray_restart_worker() -> None:
    worker.stop()
    try:
        worker.start()
    except Exception as e:
        print(f"[launcher] Failed to restart worker: {e}")


def _tray_quit() -> None:
    _cleanup()
    for w in list(webview.windows):
        w.destroy()


def _on_gui_start() -> None:
    global tray_icon
    tray_icon = tray_module.TrayIcon(
        on_open_site=_tray_open_site,
        on_open_dashboard=_tray_open_dashboard,
        on_setup_worker=_tray_setup_worker,
        on_restart_worker=_tray_restart_worker,
        on_quit=_tray_quit,
    )
    tray_icon.start()

    if not onboarding.needs_onboarding():
        # No setup needed (worker.yaml already exists from a previous run) —
        # start the worker immediately rather than waiting on any UI action.
        threading.Thread(target=_start_worker_and_load_site, daemon=True).start()


def main() -> None:
    global main_window

    if onboarding.needs_onboarding():
        main_window = webview.create_window(
            "DnD Transcriber — Setup",
            url=str(paths.onboarding_html_path()),
            js_api=Api(),
            width=720, height=680,
        )
    else:
        main_window = webview.create_window(
            "DnD Transcriber", url=_site_url(), js_api=Api(),
            width=1200, height=800,
        )

    main_window.events.closing += _on_closing

    icon = paths.icon_path()
    # debug=True enables right-click "Inspect" (WebView2 devtools) — needed
    # right now to actually see JS-side errors during development, since
    # without it there is currently no way to observe a JS failure at all
    # (confirmed: a real failure produced no visible output anywhere).
    # TODO: flip to False (or gate behind an env var) once the desktop app
    # is past active debugging — devtools access isn't something to ship to
    # end users by default.
    webview.start(_on_gui_start, gui="edgechromium", icon=str(icon) if icon else None, debug=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
