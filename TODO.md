# TODO

Open work, roughly in priority order. Move items to the commit log when done.

## Speaker attribution

- **onnxruntime in requirements.txt.** Add `onnxruntime<1.24; python_version < "3.11"`
  plus `onnxruntime; python_version >= "3.11"` once every worker has the
  updater that installs only changed requirement lines (commit after
  2026-09-25). Until then worker/voices.py installs it on first use. The old
  updater `pip install -r`'d the whole file, which would pull nemo_toolkit.
- **Voice library UI.** The library (`voices.json`) is built and used by the
  worker; the site could show who has a profile and when it was last updated,
  and offer a reset. Flag voices that match no profile as Unknown (needed for
  legacy reconstruction).
- **Legacy session reconstruction.** Transcripts for sessions recorded before
  Craig, from a single mixed audio track (plus video when it's available).
  - Whisper with word timestamps, then voice-profile labelling. This scored 97%
    of words right against Craig on two sessions, and 96% with voice only,
    using profiles borrowed from another session.
  - Discord speaking-ring detection from video (grid-tile top/bottom edges, or
    side edges for the old pop-out strip) seeds profiles and breaks ties.
    Optional.
  - UI: a one-time "who is this?" step per unknown voice or display name
    (listen to a few clips, pick a player).
  - Mark these transcripts as reconstructed.

## Mobile

- **Mobile UI redesign.** Reported as very cluttered. The session header
  stacks the title, action buttons, tabs, search, the unsure-words
  controls, speakers and the audio bar before any transcript shows, and
  reading/scrolling through speaker names in the transcript is hard. Likely
  needs a proper mobile layout, not tweaks: collapse secondary controls, a
  compact header that hides on scroll, and a transcript line layout made for
  narrow screens.

## Corrections

- **"Apply corrections to all sessions" is very slow and often fails.** It
  runs every rule over every session's transcript, summary and wiki
  suggestions in one synchronous request (45 sessions now, including the
  big reconstructed ones), which can outlast the request timeout on the small
  Fly machine. Make it a background job with progress (like the old
  WebSocket merge log), precompile the rules into one pass per file, and
  report which sessions changed as they finish.

## Review

- Keyboard shortcuts in the transcript: j/k between lines, space to
  play/pause, e to edit, / to search.
- Names tab bulk actions: add all suggested rules in one step.

## Notifications and operations

- Discord notification when a transcript or summary finishes (the campaign
  settings already have a webhook field).
- Warn when a job is queued while the worker hasn't checked in recently.

## Name and app

- URL rename, part 2: a custom domain on the existing Fly app (recommended)
  or a new co-dm.fly.dev app with a data migration. Either way the Discord
  OAuth redirect URL needs updating, and everyone logs in again.
- Desktop: d20 favicon and tray icon, and an installer rebuild so the window
  title and tray say Co-DM (Windows only).

## Follow-ups

- Edit-mode scroll jump reported by a player. It couldn't be reproduced, and
  the anchoring was made sturdier. If it's still happening, find out the
  device, whether audio was playing, and whether it happens on Edit or Done.
