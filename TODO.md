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

- Voice library in Campaign Settings and site-based reconstruction are done
  (2026-09-28). Untested end to end with a real upload: the first real
  reconstruction is the test. Profiles fill in as Craig sessions come in (Sue
  had none yet); guests are learned too.

## Wiki

- Wiki inside the transcriber and wiki generation: done 2026-09-28. The
  Netlify deploy action is disabled (the old site stays up, frozen, until
  it's deleted in Netlify). The relationship graph and the Index.md front page
  were ported too.
  Generation hasn't had a real run yet (tested with Claude stubbed out).
- As Above, So Below wiki cleanup: done 2026-09-28. All 123 pages follow
  WIKI_FORMAT.md (properties for key facts, abstract, timeline by story arc,
  relationships); ~66k words down to ~18k; no broken links. The two Malkuth
  pages were merged, and The Gardener got a page. Worth a read-through by the
  DMs for anything misremembered.
- **Continuity check cost**: done 2026-09-29 (1-3 and 6 below). It's on demand
  only now (a session's Wiki tab, or "Check N unchecked sessions" on the wiki,
  which skips sessions already checked), and one check is two tool-free calls:
  Haiku picks the pages from the summary and a page index (descriptor + lead,
  ~7k tokens), then the check gets the summary, transcript excerpts around the
  cited moments and those pages (~16k tokens). Was the whole transcript plus a
  Read turn per page (each resending ~80k tokens). Usage limits now leave jobs
  queued (the worker pauses 30 min) instead of failing them: 40 of a 43-session
  run had failed that way. The page pick varies run to run (Haiku), so a page a
  session only describes ("the smith") can be missed. The check itself runs on
  Sonnet since 2026-09-30 (the catch-up run over every session was done on the
  default model). Still open:
  - Re-check only what changed: remember the pages' hashes per session.

## Review

- Keyboard shortcuts in the transcript: j/k between lines, space to
  play/pause, e to edit, / to search.
- Names tab bulk actions: add all suggested rules in one step.

## Notifications and operations


## Name and app

- URL rename, part 2: a custom domain on the existing Fly app (recommended)
  or a new co-dm.fly.dev app with a data migration. Either way the Discord
  OAuth redirect URL needs updating, and everyone logs in again.
