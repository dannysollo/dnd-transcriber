---
version: 1
slug: "gui-src-app-tsx"
primary_target: "gui/src/App.tsx"
related_targets: ["gui/src/pages/SessionView.tsx","gui/src/pages/SessionsPage.tsx","gui/src/index.css"]
---

# Surface brief: DnD Transcriber web app (all routes)

Scope: the whole React app in gui/src (app shell, Sessions, Session view with all tabs, Corrections, Edit Queue, Search, Campaigns, Campaign settings, Preferences, Login/Invite/Share). Mode: Operate (the transcript tab is Operate + Read). Desktop first; phones must still work.

Audience/job: DMs reviewing and correcting long transcripts after a session; players reading and searching. Success: a 4-hour transcript is comfortable to read and fast to correct, and the app feels like the party's campaign journal, not a SaaS dashboard.

Constraints: one look replaces the per-user theme picker; light ("daylight") and dark ("lamplit") are both required, with a user toggle (system / light / dark). Every existing function, route, role gate and the review tooling (unsure words, Names, rule suggestions, Craig links) must keep working. No burnt edges, stains, parchment textures or fantasy display faces.

## Direction contract

THESIS: The campaign kept as a bound journal: leather cover, laid-paper pages, entries in sepia ink with speakers rubricated in red. It refuses the category default of dark charcoal panels, colored pills and card grids.

OWN-WORLD: Dark tooled-leather cover (#2A1E17) for navigation. Warm laid-paper page (#F5F0E6) with hairline rules (#D8CCB6). Sepia-black ink (#2B2622). Rubric red (#9E2B25) for speaker names, the active tab and primary actions. A thin gilt rule (#B08D57) marks the current place. Lamplit mode is the same book by lamplight: umber page, pale ink, lifted rubric. EB Garamond throughout, with small caps for names and section labels and tabular figures for time. Pages instead of cards, rules instead of borders, nothing with a drop shadow except the cover's edge.

STORY: A reader opens the journal to a session entry, finds a moment by time, name or word, hears it, and fixes it in red. A DM leaves with a trusted record and new correction rules.

FIRST VIEWPORT: The session view. The leather cover runs full height at the left (brand, campaign, nav). The page to its right has the entry title set as a chapter heading (about 34px), small-caps index tabs under a hairline, a search line and toggles, and a hairline audio bar. The transcript runs in one measured column (max ~70ch): a time column at the left, the rubricated speaker in small caps with the player in italic faint ink, and the text. The current audio line gets the gilt rule.

FORM: The Adventurer's Journal, candidate 1 of the safer-register hand (my grounded list: leather journal with rubrication, derived from candidate 5 plus the brief), seed key 036c6c09 (reroll 1, safer). Signature interaction: the ribbon bookmark. The journal remembers where each reader stopped in each session; on return a ribbon at the page edge offers "Continue from 1:23:10", and it drops in once. Silences of 12s or more open a dotted "a few moments pass" rule.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
