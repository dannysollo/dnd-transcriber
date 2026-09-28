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
  it's deleted in Netlify). Not ported: the old site's relationship graph.
  Generation hasn't had a real run yet (tested with Claude stubbed out).
- **Clean up the As Above, So Below wiki** (the vault's ~124 pages).
  Character pages list nearly everything that ever happened to them; they
  should read like encyclopedia articles: WIKI_FORMAT.md is the target. Most
  "broken links" were [[Folder/Page]] links the Netlify site couldn't
  resolve; the new wiki resolves them (1 truly broken link was left).

## Review

- Keyboard shortcuts in the transcript: j/k between lines, space to
  play/pause, e to edit, / to search.
- Names tab bulk actions: add all suggested rules in one step.

## Notifications and operations


## Name and app

- URL rename, part 2: a custom domain on the existing Fly app (recommended)
  or a new co-dm.fly.dev app with a data migration. Either way the Discord
  OAuth redirect URL needs updating, and everyone logs in again.
