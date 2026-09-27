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
- **Hallucinated lines.** Whisper occasionally invents a line, e.g. 04:40:01
  Aella in the same session ("Bay, The Death, Correct, Holly Grayfield...").
  Not rampant; collecting more examples. Delete line in the unsure-word
  review now removes one.
- **Names -> transcript jump is laggy on phones.** Possibly a slow train
  connection; recorded for now.

## Speaker attribution

- **Voice library UI.** The library (`voices.json`) is built and used by the
  worker; the site could show who has a profile and when it was last updated,
  and offer a reset. Flag voices that match no profile as Unknown (needed for
  legacy reconstruction).
- **Legacy reconstruction as a site feature.** It's a manual pipeline for now
  (`~/dnd-legacy-audio/work`: asr.py, label.py, upload.py; 30 sessions done,
  first-word fix included). As a feature: upload a mixed recording, pick who
  was there (guests too), label by voice profiles, then a one-time "who is
  this?" step for unknown voices. Discord ring detection from video is an
  optional tiebreaker.

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
