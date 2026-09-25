# TODO

Open work, roughly in priority order. Move items to the commit log when done.

## Speaker attribution

- **Split shared mic.** A session action for when two people shared one Craig
  track (e.g. both DMs on one mic). It runs speaker embeddings over that track,
  finds the voices (ignoring Discord's gated silence), names them from the
  campaign voice library, and relabels or splits lines at sentence boundaries.
  A sentence moves to the second voice only on a clear similarity margin.
  Transcript text is never changed. Keep a backup of the previous transcript
  and show the changed lines for review before applying. Done by hand for
  9-13-2026 (works; the backup is `transcript.pre-juno-split.md`).
- **Campaign voice library.** Per-person speaker-embedding profiles pooled
  across sessions (Craig tracks are the cleanest source). This is shared by
  shared-mic splitting and legacy reconstruction. Flag voices that match no
  profile well as Unknown rather than forcing a match.
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
