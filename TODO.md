# TODO

Open work, roughly in priority order. Move items to the commit log when done.

## Bug batch (reported 2026-09-26)

Done 2026-09-26: added lines (real insert, time/speaker/text fields), rule
jump to top, Names "This session only" and snippet fix, corrections sorted by
the correct word, phone bar (Sessions, Search, Corrections, More), header lag,
bottom bar hides on scroll instead of the Edit row, cramped rename list, and
the legacy first-word bug (label.py turn-start fix; all 29 reconstructed
sessions relabelled with hand edits kept).

Still open:
- **Jumping to lines and holding your place on mobile is inconsistent.** Covers
  jumping to a line (from Names, quotes, citations) and switching into edit
  mode. No repro yet; to be reported case by case (which jump, which
  phone/browser, where it lands).

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

## Follow-ups

- Edit-mode scroll jump reported by a player. It couldn't be reproduced, and
  the anchoring was made sturdier. If it's still happening, find out the
  device, whether audio was playing, and whether it happens on Edit or Done.
