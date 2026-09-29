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
- **Continuity check is very API-expensive** (reported 2026-09-29). Why: each
  check (worker/continuity.py) sends the whole transcript (30-70k tokens) plus
  the vault index (~15k), then Claude reads pages one at a time with the Read
  tool; every read is another turn that resends all of it, so ~8 reads cost
  ~9x the input. It also runs after every analysis. Ways to cut it, biggest
  first:
  1. One turn, no tool loop: pick the pages the session touches on the worker
     (page titles/aliases found in the summary, capped at ~12) and put them in
     the prompt; run `claude -p` with no tools.
  2. Summary, not transcript: the summary already cites timestamps. Send only
     short transcript excerpts around the cited moments, or check a finding
     against the transcript in a second, small call.
  3. Only the relevant parts of each page: its descriptor, key facts, and the
     timeline entries dated to this session's month, not the whole page.
  4. A cheaper model for it (`claude -p --model sonnet`, or haiku for a first pass).
  5. Skip what can't have changed: remember each checked page's hash per
     session and don't re-check a session whose pages and summary are
     unchanged. "Check every session" then only re-runs what's new.
  6. Consider not running it after every analysis (on demand only), or only
     for pages the new wiki suggestions touch.

## Review

- Keyboard shortcuts in the transcript: j/k between lines, space to
  play/pause, e to edit, / to search.
- Names tab bulk actions: add all suggested rules in one step.

## Notifications and operations


## Name and app

- URL rename, part 2: a custom domain on the existing Fly app (recommended)
  or a new co-dm.fly.dev app with a data migration. Either way the Discord
  OAuth redirect URL needs updating, and everyone logs in again.
