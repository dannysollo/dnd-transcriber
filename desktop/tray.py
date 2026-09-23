"""
desktop/tray.py — System tray icon.

Per the user's explicit decision: closing the main window minimizes to tray
(with a toast notification) as long as the worker is running; if no worker
is running, closing just quits normally. This module only builds the icon
and menu — app.py owns the actual close-vs-minimize decision and calls into
here to show/notify/quit.
"""
import io
import threading
from typing import Callable, Optional

import pystray
from PIL import Image, ImageDraw

import paths


def _load_icon_image() -> Image.Image:
    ico = paths.icon_path()
    if ico:
        try:
            return Image.open(ico)
        except Exception:
            pass
    # Fallback: synthesize a simple placeholder icon so the app still runs
    # if assets/icon.ico hasn't been dropped in yet. Purple circle, matches
    # the accent color already used in gui_server.py's dashboard theme.
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((4, 4, size - 4, size - 4), fill=(124, 106, 247, 255))
    return img


class TrayIcon:
    def __init__(
        self,
        on_open_site: Callable[[], None],
        on_open_dashboard: Callable[[], None],
        on_setup_worker: Callable[[], None],
        on_restart_worker: Callable[[], None],
        on_quit: Callable[[], None],
    ):
        self._icon = pystray.Icon(
            "dnd_transcriber_worker",
            icon=_load_icon_image(),
            title="DnD Transcriber Worker",
            menu=pystray.Menu(
                pystray.MenuItem("Open Site", on_open_site, default=True),
                pystray.MenuItem("Open Worker Dashboard", on_open_dashboard),
                # Always present, regardless of whether onboarding has
                # already run — this is the way back to the local setup
                # form after the "go get a campaign/key on the site" step,
                # and also how someone re-configures the worker later
                # (new campaign, new audio folder, etc.) without deleting
                # worker.yaml by hand.
                pystray.MenuItem("Set Up / Reconfigure Worker", on_setup_worker),
                pystray.MenuItem("Restart Worker", on_restart_worker),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit", on_quit),
            ),
        )
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """pystray's run() blocks, so it needs its own thread — the main
        thread is owned by pywebview's webview.start() event loop."""
        self._thread = threading.Thread(target=self._icon.run, daemon=True, name="tray-icon")
        self._thread.start()

    def stop(self) -> None:
        try:
            self._icon.stop()
        except Exception:
            pass

    def notify(self, title: str, message: str) -> None:
        """Best-effort — pystray's notification support varies by backend,
        and this app is windowless so there's no other way to surface
        "still running in the background" to the user on window close."""
        try:
            self._icon.notify(message, title)
        except Exception as e:
            print(f"[launcher] Tray notification failed (non-fatal): {e}")
