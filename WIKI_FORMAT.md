# Wiki page format

The standard shape for every page of a campaign wiki. The wiki generator
writes pages this way (worker/wiki_gen.py), and cleanups of older pages aim
for it. Pages read like short encyclopedia articles: what someone is, the
few things that matter, and where to read more. They are not a log of
everything that ever happened.

## Folders

| Folder | What goes there |
| --- | --- |
| `Characters/PCs` | The player characters |
| `Characters/NPCs` | Everyone else with a name who matters |
| `Locations` | Places: regions, cities, buildings, planes |
| `Factions` | Groups: orders, guilds, courts, families, armies |
| `Events` | Things that happened and are referred back to (battles, rituals, disasters) |
| `Items` | Named objects: artefacts, weapons, relics |
| `Mechanics` | How the world works: magic, rules the table invented, lore systems |

`Index.md` at the top lists every page by folder.

## Every page

```markdown
---
kind: Player character
played-by: Christina
race: Half-elf
class: Artificer
chord: "[[Hod]]"
family: "[[Alexander Nouveau]] (grandfather), [[Nico]] (brother)"
status: Alive, back with the party
aliases: [The Scion]
---
# Page Title
*One line: what this is.*

Abstract: 2-4 sentences. Who or what it is, why it matters to the story,
and where things stand now. Someone who reads only this should know enough.

## Timeline
- **Mar 2026** — one significant thing that happened. [[Links]] to who and where.

## Relationships
- [[Other Page]] — how they relate, in a few words.

## Appearances
Plain prose: how many sessions, first and latest, or the sessions by name.
```

**Properties** (the YAML between the `---` lines, Obsidian's Properties panel)
hold the key facts. The site shows them as a band under the title, in the
order written, with the key as the label (`played-by` shows as "Played by").

- `status` shows beside the title with a dot: moss when fine, ochre for
  missing/captured/unknown/cursed, rubric for dead/destroyed. Always include it
  for characters, factions and items.
- `kind` and `aliases` aren't shown. `aliases` lets `[[Other Name]]` links reach
  the page, as in Obsidian.
- **Quote any value with a `[[link]]`** (`chord: "[[Hod]]"`); unquoted, YAML
  reads it as a list.
- Keep values short (a few words). Anything needing a sentence belongs in the
  abstract.

The one-line italic descriptor under the title shows in the page header.
Timeline entries start with a bold date (`**Mar 2026**` or a session date),
then ` — `, then the event; the site puts the dates in their own column.

Rules:

- **Brief.** A character page is usually 150-400 words. Leave out moment-to-moment
  detail; that lives in the session summaries.
- **Timeline, not a diary.** Only turning points: first meeting, betrayals, deaths,
  revelations, changes of allegiance, items gained or lost. Five to ten entries is
  plenty for a major character. Newest last.
- **Link generously, but only to real pages.** `[[Exact Page Title]]` or
  `[[Exact Page Title|shown text]]`. Link a name the first time it appears in a
  section. Don't link to pages that don't exist.
- **Current state first.** The abstract says where things stand as of the latest
  session (alive, dead, missing, allied, hostile).
- **No speculation as fact.** If the table only suspects something, say "suspected".
- **Spoilers:** players read the wiki. Nothing the players haven't learned at the
  table.

## Key facts by kind

| Kind (`kind:`) | Properties to lead with |
| --- | --- |
| Player character | played-by, race, class, affiliation, status |
| NPC | role, affiliation, first-met, status |
| Location | region, ruled-by, notable-for |
| Faction | leader, base, aims, status |
| Event | when, where, who |
| Item | type, held-by, powers, status |
| Mechanic | where-it-shows-up |

Leave out a property the sessions don't establish; don't write "unknown".
