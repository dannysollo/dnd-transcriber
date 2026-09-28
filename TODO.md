# TODO

Open work, roughly in priority order. Move items to the commit log when done.

## Bug batch (reported 2026-09-27)

Done 2026-09-27: unsure-word review Keep/Skip/Delete line, flagged-word clips
centred on the word (worker now stores word times), editor throbber, audio
player no longer covering the end of a tab on phones, tab-row edge fades,
back to the same session in the list, chart tooltips kept on screen, longest
speeches note.

"9-26-2026 -- In Another Life" had Marko's and Danny's lines echoed onto
Mihir's track (99 cross-speaker duplicates vs 10-20 in a normal session):
Discord through his speakers, picked up by his mic. The 124 echo lines were
removed (backup: transcript.before-echo-cleanup.md). No worker change: Mihir
is being asked to use headphones or echo cancellation. If it recurs, an
echo filter (a line matching one said just before on another track, and much
quieter on its own) is the fix.

Still open:
- **Hallucinated lines.** Mostly handled: ~100 removed across the Craig
  sessions (stock captions, recited name lists, echoes; backups kept as
  transcript.before-hallucination-sweep.md), and the worker now drops those
  patterns itself. One-offs remain; Delete line in the unsure-word review
  removes them.
- **Names -> transcript jump is laggy on phones.** Possibly a slow train
  connection; recorded for now.

## Speaker attribution

- **(In progress) Voice library in Campaign Settings.** Who has a profile, how
  much audio it's built from, last updated, reset. The worker also learns each
  player's profile from their own Craig track every session (it only learned
  shared-mic players before).
- **(In progress) Legacy reconstruction as a site feature.** Decided
  2026-09-28: upload a single mixed recording on the site ("new session from a
  recording"), pick who was there; the worker downloads it, runs Whisper with
  word times and labels speakers by the library's voice profiles (the manual
  pipeline in `~/dnd-legacy-audio/work`: label.py's method, first-word fix
  included); voices matching no profile become "Unknown voice N", and the
  session shows a "who is this?" panel with short clips of each to assign a
  player or a guest name. The session is marked reconstructed.

## Review

- Keyboard shortcuts in the transcript: j/k between lines, space to
  play/pause, e to edit, / to search.
- Names tab bulk actions: add all suggested rules in one step.

## Notifications and operations

- **(In progress)** Warn when a job is queued while the worker hasn't checked
  in recently.

## Name and app

- URL rename, part 2: a custom domain on the existing Fly app (recommended)
  or a new co-dm.fly.dev app with a data migration. Either way the Discord
  OAuth redirect URL needs updating, and everyone logs in again.
