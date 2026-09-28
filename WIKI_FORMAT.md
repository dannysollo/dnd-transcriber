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
# Page Title
*One line: what this is.*

Abstract: 2-4 sentences. Who or what it is, why it matters to the story,
and where things stand now. Someone who reads only this should know enough.

- **Key fact:** value
- **Key fact:** value

## Timeline
- **Session date** — one significant thing that happened. [[Links]] to who and where.

## Relationships
- [[Other Page]] — how they relate, in a few words.

## Appearances
[[Session name]], [[Session name]] (or plain dates when sessions aren't pages)
```

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

| Kind | Facts to lead with |
| --- | --- |
| Player character | Player, Race, Class, Affiliation, Status |
| NPC | Role, Affiliation, Status, First met |
| Location | Region, Ruled by, Notable for |
| Faction | Leader, Base, Aims |
| Event | When, Where, Who |
| Item | Type, Held by, Powers |
| Mechanic | Where it shows up |

Leave out a fact the sessions don't establish; don't write "unknown".
