# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tabletop RPG groups who record their sessions with the Craig bot on Discord. Several groups use it, each running its own campaign(s): it is a small multi-campaign product, not a single table's private tool.

- **DMs** do most of the work: create sessions (upload audio or paste a Craig link), queue transcription, review and correct transcripts, manage correction rules and the unknown-word list, generate summaries and wiki suggestions, apply wiki updates, and approve player edits.
- **Players** read transcripts and summaries, search past sessions, and submit transcript fixes (which may require DM approval).
- **Spectators** can read only.

Use is mostly on desktop, at a desk, after a session. Phones are occasional.

## Product Purpose

Turn a multi-hour Discord session recording into a searchable, speaker-labelled transcript, a session summary, and suggested updates to the campaign's wiki/vault, so a group has an accurate record of what happened without anyone taking notes at the table. Success means the transcript is trustworthy (names spelled right, speakers right), fast to review, and the campaign record stays current.

## Positioning

Per-speaker transcription of Craig's separate tracks (not one mixed file), run on the group's own GPU through a local worker, combined with campaign-aware review tooling: vocab biasing from the group's own vault, a static correction-rule list that learns from hand edits, and flags for low-confidence words and unrecognized names. The transcript stays a pure ASR artifact. AI only produces derived output (summary, wiki suggestions) and never rewrites transcript text.

## Operating Context

- Recording: Craig bot in Discord, one audio track per speaker.
- Transcription: a Windows desktop worker app (pywebview launcher) on a DM's machine with an NVIDIA GPU. It polls the site for jobs and can fetch audio straight from a Craig link.
- Site: FastAPI + React (Vite) on Fly.io, Discord OAuth login, campaign roles dm / player / spectator, invite links, share links for single sessions.
- Campaign knowledge lives in an Obsidian-style vault (git repo) whose Index.md supplies proper nouns. Wiki suggestions are applied back to it.
- Review happens alongside audio playback; clicking a timestamp seeks the merged session recording.

## Capabilities and Constraints

- Session list per campaign with review status (unreviewed / reviewed / published) and content badges (transcript, summary, wiki).
- Session view tabs: Transcript (search, audio sync, inline edit mode, unsure-word highlighting), Summary, Wiki suggestions (apply/skip), Changes (corrections applied, hallucination flags), Names (unknown words → correction rule or ignore).
- Corrections page (word rules + regex patterns), Edit Queue (player edits awaiting DM approval), Search across sessions, Campaign settings (members, invites, worker key, config), Preferences.
- Transcripts are long (thousands of lines, 3–4 hour sessions). Reading and scanning long text is the core activity.
- A single visual look replaces the current per-user theme picker (confirmed 2026-09-23). Any light/dark variant is a design decision, not a user preference system.

## Brand Commitments

- Product name: "Co-DM" (renamed from "Co-DM" on 2026-09-23). Internal identifiers keep the old name on purpose: the Fly app and URL (`dnd-transcriber`), the GitHub repo, the desktop exe (`dnd-transcriber-worker.exe`), its `%LOCALAPPDATA%\DnDTranscriberWorker` data folder and the installer AppId, so existing installs and links keep working.
- No other binding brand assets, logos, or voice guidelines exist.

## Evidence on Hand

- Real campaign content: `campaigns/as-above-so-below/` (transcripts, summaries, wiki suggestions) for realistic design fixtures. It is private campaign data; don't publish it.
- No testimonials, user counts, or marketing claims exist. Don't fabricate any.

## Product Principles

1. The transcript is the record: never let AI or the UI blur what was actually said with what was inferred.
2. Review speed beats features: every tool should shorten the path from a raw transcript to a trusted one.
3. The group owns its campaign: its vocabulary, its vault, its hardware.
4. Readers and editors share one surface: players reading and DMs correcting use the same transcript view, with editing gated by role.
