# TODO

Open work, roughly in priority order. Move items to the commit log when done.

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
