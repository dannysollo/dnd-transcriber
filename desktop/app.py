"""
desktop/app.py — pywebview entry point for the DnD Transcriber desktop app.

Flow:
  1. If no valid worker.yaml exists yet, the single main window loads the
     local onboarding form instead of the site. Onboarding's "Continue"
     button calls back into Api.finish_onboarding(), which starts the worker
     and then navigates that SAME window to the real site — there is no
     separate onboarding window to tear down, since pywebview only supports
     starting its GUI event loop once per process (webview.start() blocks
     until every window is destroyed).
  2. Otherwise the main window loads the Fly-hosted site directly.
  3. A tray icon (tray.py) runs alongside in its own thread. Per the user's
     explicit decision: closing the main window minimizes to tray (with a
     toast) as long as the worker is running; if no worker is running,
     closing quits normally.

Verified against pywebview 6.2.1's actual API from this dev environment
(webview.FileDialog.FOLDER, window.events.closing returning False to cancel
a close, webview.start(func=..., gui=..., icon=...)) — but the GUI itself
(WebView2 rendering, native dialogs, tray notifications) has NOT been run on
a real Windows display; that's Milestones 1-2 in the desktop launcher plan.
"""
import sys
import threading

import webview
import yaml

import onboarding
import paths
import tray as tray_module
from worker_process import WorkerProcess

DEFAULT_SERVER_URL = "https://dnd-transcriber.fly.dev"

worker = WorkerProcess()
tray_icon: tray_module.TrayIcon | None = None
main_window: webview.Window | None = None


def _site_url() -> str:
    try:
        cfg = yaml.safe_load(paths.worker_yaml_path().read_text()) or {}
        return cfg.get("server_url") or DEFAULT_SERVER_URL
    except Exception:
        return DEFAULT_SERVER_URL


class Api:
    """Exposed to the onboarding page as window.pywebview.api.*"""

    def default_server_url(self) -> str:
        return DEFAULT_SERVER_URL

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

    def finish_onboarding(self) -> dict:
        _start_worker_and_load_site()
        return {"ok": True}


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
    webview.start(_on_gui_start, gui="edgechromium", icon=str(icon) if icon else None)
    sys.exit(0)


if __name__ == "__main__":
    main()
