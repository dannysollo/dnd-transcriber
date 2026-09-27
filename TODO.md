# TODO

Open work, roughly in priority order. Move items to the commit log when done.

## Bug batch (reported 2026-09-27)

Player reports from Juno. Working through them one at a time.

Bugs:
- **Wrong speaker and a phantom line (Craig session).** "9-26-2026 -- In Another
  Life", 01:05:36-01:05:42: "It might have been The Growning" is shown as Belle
  (Mihir) but Marko said it, and Marko's own line at 01:05:36 ("Uh, it might've
  been Negroni") isn't something he said. Likely mic bleed or a Whisper
  hallucination on one track; needs the per-track audio.
- **Hallucinated line.** Same session, 04:40:01, Aella: "Bay, The Death,
  Correct, Holly Grayfield, Taylor, Coles, Herbal Club." Not rampant; more
  examples to come.
- **Flagged-word audio misses the word.** In Names and the unsure-word review,
  the clip starts at the line's timestamp, so in a long line the word can come
  after the clip ends, even though the text preview shows it.
- **Audio controls cover the end of the summary** on phones (the mini player
  sits over the last lines).
- **Stats: the share-of-talk tooltip goes off screen** for the last sessions
  (right edge).

Improvements:
- **Loading indicator (throbber) in the transcript** instead of a frozen page
  when you scroll past the lines rendered so far.
- **Unsure-word review: add Skip and Delete line** next to Back, Play again and
  Keep.
- **Tab row fades:** hide the right fade when scrolled all the way right; show a
  left fade when not scrolled all the way left.
- **Back from a session returns to that session in the list**, not the top.
- **Longest speeches: allow more than two interjections** (it already does) and
  fix the note that says "up to two".
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
