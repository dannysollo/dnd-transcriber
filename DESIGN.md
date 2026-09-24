---
name: Co-DM
description: The campaign kept as a bound journal, with a leather cover, laid-paper pages, sepia ink and rubricated speakers, read by daylight or by lamplight.
colors:
  cover-leather: "#2A1E17"
  cover-edge: "#120C09"
  cover-ink: "#E7D5B3"
  cover-ink-soft: "#A89170"
  laid-paper: "#F5F0E6"
  paper-sunk: "#EDE6D8"
  paper-raised: "#FBF8F1"
  hairline-rule: "#D8CCB6"
  rule-strong: "#BFAF93"
  sepia-ink: "#2B2622"
  ink-soft: "#5E5347"
  ink-faint: "#716250"
  rubric-red: "#9E2B25"
  rubric-deep: "#85231E"
  on-rubric: "#FBF5EA"
  gilt: "#B08D57"
  gilt-ink: "#86662F"
  moss: "#46632F"
  ochre: "#8A5B0C"
  highlighter: "rgba(222, 184, 74, 0.5)"
  selection: "rgba(158, 43, 37, 0.16)"
  lamplit-cover-leather: "#120D0A"
  lamplit-cover-edge: "#070504"
  lamplit-cover-ink: "#D9C7A8"
  lamplit-cover-ink-soft: "#9A8465"
  lamplit-paper: "#1F1914"
  lamplit-paper-sunk: "#282019"
  lamplit-paper-raised: "#2C241D"
  lamplit-hairline-rule: "#3E3329"
  lamplit-rule-strong: "#57493B"
  lamplit-ink: "#EAE0CE"
  lamplit-ink-soft: "#BFAF97"
  lamplit-ink-faint: "#9C8C73"
  lamplit-rubric: "#E57A6C"
  lamplit-rubric-hover: "#EE9285"
  lamplit-on-rubric: "#1F1914"
  lamplit-gilt: "#C9A66B"
  lamplit-gilt-ink: "#D2B27A"
  lamplit-moss: "#9DBB7E"
  lamplit-ochre: "#DDAA4B"
  lamplit-highlighter: "rgba(201, 166, 107, 0.32)"
  lamplit-selection: "rgba(229, 122, 108, 0.24)"
typography:
  display:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0.005em"
  headline:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 500
    letterSpacing: "0.04em"
    fontFeature: "small-caps"
  reading:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "oldstyle-nums proportional-nums"
  body:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "oldstyle-nums proportional-nums"
  speaker:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "0.05em"
    fontFeature: "small-caps"
  label:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "16px"
    fontWeight: 400
  figures:
    fontFamily: "'EB Garamond Variable', 'EB Garamond', Garamond, 'Times New Roman', serif"
    fontSize: "15px"
    fontWeight: 400
    fontFeature: "lining-nums tabular-nums"
rounded:
  none: "0"
  hairline: "2px"
  sm: "3px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "28px"
  gutter-mobile: "16px"
  page-x: "48px"
  index-x: "56px"
components:
  button-primary:
    backgroundColor: "{colors.rubric-red}"
    textColor: "{colors.on-rubric}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.rubric-deep}"
    textColor: "{colors.on-rubric}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.rubric-red}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-ghost-hover:
    textColor: "{colors.sepia-ink}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.rubric-red}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-danger-hover:
    backgroundColor: "{colors.rubric-red}"
    textColor: "{colors.on-rubric}"
  cover-link:
    backgroundColor: "transparent"
    textColor: "{colors.cover-ink-soft}"
    typography: "{typography.body}"
    padding: "7px 24px"
  cover-link-active:
    textColor: "{colors.cover-ink}"
  index-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    typography: "{typography.title}"
    padding: "10px 0"
  index-tab-active:
    textColor: "{colors.rubric-red}"
  written-line:
    backgroundColor: "transparent"
    textColor: "{colors.sepia-ink}"
    rounded: "{rounded.none}"
    padding: "6px 2px"
  index-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    padding: "2px 0"
  index-link-active:
    textColor: "{colors.rubric-red}"
  journal-entry:
    backgroundColor: "transparent"
    rounded: "{rounded.none}"
    padding: "16px 20px"
  transcript-timestamp:
    textColor: "{colors.ink-faint}"
    typography: "{typography.figures}"
    width: "78px"
  audio-play:
    backgroundColor: "transparent"
    textColor: "{colors.rubric-red}"
    rounded: "{rounded.round}"
    size: "30px"
  audio-play-hover:
    backgroundColor: "{colors.rubric-red}"
    textColor: "{colors.on-rubric}"
  journal-ribbon:
    backgroundColor: "{colors.rubric-red}"
    textColor: "{colors.on-rubric}"
    padding: "14px 7px 26px"
  entry-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink-faint}"
    rounded: "{rounded.sm}"
    padding: "6px"
---

# Design System: Co-DM

## Overview

**Creative North Star: "The Adventurer's Journal"**

The campaign is kept as a bound book. Navigation lives on a dark tooled-leather cover down the left edge; everything else is a laid-paper page written in sepia ink, with speakers rubricated in red the way a scribe marks names in a manuscript. There are no cards, panels or colored pills: structure comes from hairline rules, measured columns and generous leading. A thin gilt rule marks where you are in the book.

It is one look shown in two lights. **Daylight** is dark ink on warm paper. **Lamplit** is the same book read at night: an umber page, pale ink and a lifted, warmer rubric. The reader picks System, Daylight or Lamplit under Preferences, in a section called "Reading light". The resolved mode is set as `data-theme="light|dark"` on `<html>`, before first paint, by an inline script in `index.html`, then kept in sync by `ThemeContext`. The choice is stored in `localStorage` under the key `dnd-color-mode`. Every token below has a value for both lights, and components use only the tokens, never raw colors.

The density is set for reading: the transcript is the product, so it runs in one column with a maximum width of 70ch, set at 19px with 1.55 leading, a figure column for time and small-caps speaker names. Tools sit in the margins. They are faint upright labels, underlined "written lines" and quiet stroke icons that brighten when you hover them. The only stagecraft is the ribbon bookmark, which drops in once to offer "Continue from 1:23:10", and the dotted "a few moments pass" rule in long silences.

**Key Characteristics:**
- Leather cover for navigation, paper page for content, one serif (EB Garamond) for everything.
- Rubric red used sparingly: speaker names, the active tab, primary actions, and the current state of play and scrub.
- Gilt means "you are here": the active nav link, the current audio line, focus rings.
- Rules instead of borders, entries instead of cards, small caps and faint ink instead of badges.
- Two lights, each with a full token set; the mode is a reader preference, not a separate theme.

## Colors

A warm, low-chroma paper-and-ink palette with two pigments, rubric red and gilt, plus two quiet status inks (moss and ochre). Values for both lights are in the frontmatter; the `lamplit-*` keys are the `:root[data-theme="dark"]` overrides of the same CSS variables.

### Primary
- **Rubric Red** (`--rubric`; lamplit: lifted coral-rubric): speaker names, the active index tab and its 2px underline, primary buttons, the pressed filter link, the play control, the filled part of the scrubber, the ribbon bookmark, the Names count, unsure-word underlines and caret color. `--rubric-hover` deepens it in daylight and lightens it in lamplit. `--on-rubric` is the text on solid rubric: cream in daylight, the umber page color in lamplit.

### Secondary
- **Gilt** (`--gilt`): the place-marker. It is the 3px inset rule on the active cover link, the 2px inset rule and faint gilt wash on the current transcript line, the 2px focus outline, the focused written line's underline, and the ring around the avatar. It is never used for text.
- **Gilt Ink** (`--gilt-ink`): the gilt at text strength. It is used for the active line's timestamp and the insert-line control in edit mode.

### Tertiary
- **Moss** (`--moss`): success and applied states, such as "Applied to the vault", copy-succeeded confirmations, and the corrections-hit count.
- **Ochre** (`--ochre`): pending and warning states, such as an edit sent to the DM for review, a running pipeline, and likely hallucinations.

### Neutral
- **Cover Leather** (`--cover`), **Cover Edge** (`--cover-edge`): the sidebar surface and its 1px right edge. The leather carries a 3px dot grain made from a `radial-gradient` of white at 3.5% opacity.
- **Cover Ink** (`--cover-ink`), **Cover Ink Soft** (`--cover-ink-soft`): text on the cover when active and at rest. `--cover-hover` is a gilt tint (13% in daylight, 10% in lamplit) used for hover and the active background.
- **Laid Paper** (`--page`): the page and body background, and the background of every content surface.
- **Paper Sunk** (`--page-sunk`), **Paper Raised** (`--page-raised`): the only tonal steps. Sunk is used for code and diff wells, skeleton bases and elevated inputs; raised is used for dropdown and overlay surfaces and the skeleton highlight.
- **Hairline Rule** (`--rule`): every divider, including entry separators, the rule under the tabs, the audio bar rule and the rules between settings rows.
- **Rule Strong** (`--rule-strong`): written-line underlines, ghost button borders, the unfilled scrubber track, the scrollbar thumb and the dotted time-passes rule.
- **Sepia Ink** (`--ink`), **Ink Soft** (`--ink-soft`), **Ink Faint** (`--ink-faint`): the three ink weights. Faint is used for timestamps, player names, placeholders and metadata, and still reads on paper in both lights.
- **Highlighter** (`--highlighter`): search hits, drawn as a marker stroke across the lower half of the glyphs, and the flash when you jump to a line.
- **Selection** (`--selection`): a rubric tint for text selection.

Legacy aliases (`--bg-*`, `--text-*`, `--accent*`, `--success`, `--error`, `--warning`, `--danger`) map onto these tokens so older components pick up the journal. New code should use the journal names.

### Named Rules
**The Rubrication Rule.** Red marks names and the current action, nothing else. If a screen has more than one solid rubric button, one of them is wrong.

**The Gilt Marks the Place Rule.** Gilt means "you are here" (the current page, current line or focused field). It never decorates.

**The Two Lights Rule.** Every color is a token with a daylight and a lamplit value. A hard-coded hex or a `rgba()` outside `index.css` breaks lamplit, so don't use one.

## Typography

**Display Font:** EB Garamond Variable, self-hosted through `@fontsource-variable/eb-garamond` upright, plus the italic cut for two uses only: a session's subtitle (its one-line description) and emphasis inside rendered markdown such as summaries, falling back to EB Garamond, Garamond and Times New Roman.
**Body Font:** the same face.
**Label/Mono Font:** there is no display or label face. A system monospace appears only for machine strings (regex rules, worker keys, share URLs, raw markdown editors).

**Character:** one old-style book face doing every job. Small caps give the label voice, faint ink gives the marginal-note voice, and italic is kept for the session subtitle (never for UI chrome), and the two figure styles separate prose from data.

### Hierarchy
- **Display** (500, 34px, 1.15): the page title, used for the session name as a chapter heading, "Sessions" and "Preferences". It shrinks to 28px on phones. A count in faint ink at 20px can sit beside it ("5 entries").
- **Headline** (400, 23–24px, 1.25): entry titles in the journal index and empty-state titles ("The journal is empty").
- **Title** (500–600, 19–20px, small caps with 0.04em tracking): index tabs, fieldset legends such as "Reading light" and in-transcript section headings. It is rubric when active or used as a heading, and faint ink otherwise.
- **Reading** (400, 19px, 1.55, max 70ch): transcript lines. The speaker name is set inline in 600-weight small caps with 0.05em tracking in rubric, followed by the player name in upright faint ink at 0.85em.
- **Body** (400, 17px): UI prose, the base size of `body`, with old-style proportional figures by default.
- **Label** (400, 14–16px, upright, ink-faint or ink-soft): marginal notes such as "Order by", "Campaign", placeholders, the "a few moments pass" note and secondary hints. Never italic: an earlier pass set these in italic, and it read as overdone.
- **Figures** (15–16px, lining tabular): timestamps, audio time and counts. Apply them with `.tnum`, `<time>` or `data-tnum`.
- **Brand** (22px small caps, 0.06em tracking, cover ink): "Co-DM" on the cover.

### Named Rules
**The Small Caps, Never Shouting Rule.** Labels are real small caps (`font-variant: small-caps`, 0.04–0.06em tracking), never uppercase text with wide tracking.

**The Two Figures Rule.** Prose keeps old-style figures. Anything that aligns or is compared, such as time, durations or counts, gets lining tabular figures.

## Layout

The desktop layout is a fixed 232px leather cover at the left, running full height, with the page filling the rest. The session view is a flex column: header (padding 26px 48px 10px), tab row (28px gap, 48px side padding, hairline below), toolbar (padding 12px 48px 8px), audio bar (hairline below) and a scrolling content area (padding 18px 48px). Transcript lines are a two-column grid: a 78px right-aligned time column, an 18px gap, then the text capped at 70ch. The whole transcript sits in a 900px frame so the ribbon can hang at its right edge (it sits flush right below 1180px). Summary, Wiki and Changes are capped at 820px. Index pages (Sessions, Preferences and the like) use 40px 56px padding with a maximum width of 920px (760px for Preferences).

On phones (at 768px and below), the cover becomes a bottom tab bar on the same leather and the brand and campaign blocks are hidden. The session page collapses to a single 16px gutter, the time column narrows to 54px with a 10px gap, timestamps drop to 13px, and the tab row scrolls horizontally with a fade mask at the right edge. The ribbon then lies across the top of the page as a horizontal swallowtail instead of hanging down the edge.

Rhythm: 4px transcript line padding, a 14px toolbar gap, a 28px tab gap and 16–20px entry padding. Sections are separated by hairlines rather than boxes.

## Elevation & Depth

The page is flat, and depth comes from the book's own materials. The cover is the only raised thing. It has an inner shadow at its spine edge and casts onto the page (`inset -10px 0 16px -8px rgba(0,0,0,.45), 6px 0 18px -8px rgba(0,0,0,.35)`). The ribbon bookmark casts `--shadow` because it lies on top of the page. The sticky mini-player casts a soft upward shadow where it overlaps content. Tonal steps (sunk and raised) cover everything else.

### Shadow Vocabulary
- **Cover edge** (`box-shadow: inset -10px 0 16px -8px rgba(0,0,0,0.45), 6px 0 18px -8px rgba(0,0,0,0.35)`): the leather sidebar only.
- **Ribbon** (`--shadow`: daylight `0 10px 30px -12px rgba(42,30,23,0.35)`, lamplit `0 12px 34px -12px rgba(0,0,0,0.7)`): objects lying on the page, meaning the ribbon bookmark and floating menus.
- **Place rules** (`inset 3px 0 0 var(--gilt)` on the active cover link, `inset 2px 0 0 var(--gilt)` on the current line, `inset 0 -2px 0 var(--rubric)` on the active tab): drawn rules, not elevation.

### Named Rules
**The Only the Cover Casts Rule.** Nothing on the page has a drop shadow except objects lying on it (the ribbon, menus and the floating player). Pages, entries, inputs and buttons are flat.

## Shapes

The form language is square and bookish. Buttons, entry actions, code wells and dialogs have 3px corners, just enough to look pressed rather than cut. Entries and written lines have no radius because they are rules, not boxes. Circles are reserved for the play control, the scrubber thumb, avatars and the campaign status dot. The ribbon is the one silhouette: a vertical rubric strip cut with a swallowtail notch (`clip-path: polygon(0 0,100% 0,100% 100%,50% calc(100% - 12px),0 100%)`), which turns into a horizontal pennant on phones. Scrollbars are an 8px cord in rule-strong.

## Components

### Buttons
Inked labels on paper. They are small and set in the book face, not in platform chrome.
- **Shape:** 3px corners, padding 6px 14px, 16px text, line-height 1.25.
- **Primary:** solid rubric with `--on-rubric` text at weight 500. On hover it moves to `--rubric-hover`. Use one per view, for the main action (Run pipeline, Create session, Save).
- **Secondary:** transparent, rubric text, and a border mixing 55% rubric with the rule color. On hover it gains an 8% rubric wash.
- **Ghost:** transparent, ink-soft text and a rule-strong border. On hover the text goes to ink, the border to ink-faint, and it gains a 4% ink wash. Used for Share, Re-merge, Edit transcript and Cancel.
- **Danger:** a rubric outline with rubric text that fills solid rubric on hover.
- **Disabled:** 45% opacity with a not-allowed cursor.
- **Focus:** a 2px gilt outline at 2px offset, shared by every focusable element.
- **Motion:** color, background, border and opacity transitions at 0.15s ease.

### Index tabs
The session view's tabs, read as a book's index.
- **Style:** 19px small caps in faint ink with 10px vertical padding and no box, sitting on the hairline under the header.
- **Active:** rubric at weight 600 with a 2px rubric underline drawn as an inset shadow. The Names tab can carry a rubric lining-figure count.

### Inputs / Fields
- **Written line** (search, new-session name, Craig link): transparent, with only a 1px rule-strong bottom border, 18px ink text and an upright faint placeholder. On focus the underline turns gilt, with no box and no ring.
- **Boxed fields** (textareas, dialogs, rename): a 3px radius and a rule border. On focus the border turns gilt and gains a 1px gilt ring.
- **Select** (audio speed): underline only, ink-soft text, no box.
- **Radios:** native, with `accent-color` set to rubric, laid out in ruled rows (Preferences).

### Navigation (the cover)
- **Style:** a 232px leather column with the brand in small caps, a faint "Campaign" label over the campaign name between gilt-toned hairlines, then nav links.
- **Links:** 18px cover-ink-soft text with a 16px stroke icon at 75% opacity, padding 7px 24px and a 12px gap. On hover the text becomes cover-ink on a gilt tint.
- **Active:** cover-ink text, the gilt tint, a 3px gilt inset rule at the left edge and the icon at full opacity. Shortcut hints ("Ctrl K") are 13px at 70% opacity.
- **Mobile:** the same leather as a bottom bar, with the icon above the label.

### Journal entries (session index)
- **Corner style:** none. Each entry is a block closed by a hairline bottom rule.
- **Content:** a 23px ink title, an optional one-line description (the session subtitle) in italic ink-soft, and an "Added …" date line in faint ink. Sessions carry no content or review-status tags; that feature was removed on request (the list only shows a Craig link icon and live job status).
- **Hover:** a 7% gilt wash. Row actions are 16px stroke icons (`entry-action`) at 55% opacity that rise to full opacity when you hover or focus the entry. Danger actions turn rubric on hover.
- **Order by:** `index-link` text links (name, date added, last changed), 17px ink-soft. When pressed (`aria-pressed`) they turn rubric with a 1px underline at a 4px offset. There is no status filter row.

### Transcript line
- A two-column grid with the time on the left (`transcript-ts`: 15px lining tabular figures in faint ink, right-aligned; when clickable, it turns rubric and underlined on hover and seeks the audio). The text follows on the right: rubric small-caps speaker, faint upright player, then the words.
- **Current line:** a gilt wash that fades out by 70% across the line, a 2px gilt inset rule, and the timestamp in gilt ink. The background transition takes 0.4s.
- **Search hit:** the highlighter drawn across the lower 48% of the glyph box.
- **Unsure words:** a 1px wavy underline at 45% rubric with a 4px offset, full rubric when strong, and a help cursor.
- **Time passes:** for silences of 12s or more, a centered upright "a few moments pass" note in faint ink between two dotted rule-strong lines, aligned to the text column.

### Audio bar
Hairline controls in the page's own ink.
- **Play:** a 30px circle with a rubric outline and a rubric glyph that fills solid on hover.
- **Scrubber:** a 2px track, rubric up to the playhead and rule-strong after it, with an 11px rubric thumb ringed by 2px of page color.
- **Time:** 16px lining tabular figures in ink, "0:00 / 12:00".
- **Speed:** an underline-only select.

### Ribbon bookmark (signature)
When a reader comes back to a session, a rubric ribbon with vertical text ("Continue from 09:41") hangs from the top right of the page and drops in once (`translateY(-100%)` to `0` over 0.7s with `cubic-bezier(0.16, 1, 0.3, 1)`). A small faint × below it dismisses it. On phones it lies horizontally above the transcript.

### Disclosures
A stroke chevron at 11px with a 2.5px stroke points right when closed and rotates 90° when open (0.2s). It is followed by a plain label and a faint secondary note ("6 speakers, rename who's who").

### Loading
- **Skeletons** are sunk/raised gradient bars with a 2px radius that shimmer over 1.6s.
- **Spinners** are a single stroke arc turning linearly over 1s.
- Both stop under `prefers-reduced-motion`, which also cuts every transition to 0.01ms.

### Iconography
Custom inline SVG stroke icons (`Icons.tsx`) on a 24px grid with a 2px stroke, round caps and joins, and `currentColor`. They default to 14px (16px in the cover). The icons are close, pencil, check, alert, info, play, pause, chevron, copy, trash and spinner, with the same hand used in the cover nav. The one filled glyph is the play triangle.

## Do's and Don'ts

### Do:
- **Do** use the journal tokens (`--page`, `--ink`, `--rubric`, `--gilt`, `--rule` and the rest) for every color, so both lights come for free.
- **Do** separate content with 1px `--rule` hairlines and whitespace, and let lists be ruled entries.
- **Do** set speaker and section labels in real small caps (0.04–0.06em tracking) and marginal notes in upright faint ink.
- **Do** put lining tabular figures on every timestamp, duration and count.
- **Do** keep reading text at 19px/1.55 in a column no wider than 70ch.
- **Do** mark "you are here" with a gilt inset rule and focus with a 2px gilt outline at 2px offset.
- **Do** draw new icons in the `Icons.tsx` hand: 24px grid, 2px stroke, round caps, `currentColor`.
- **Do** gate every animation behind `prefers-reduced-motion`.

### Don't:
- **Don't** wrap content in cards, panels or bordered boxes with rounded corners. Entries are ruled, not boxed.
- **Don't** use colored pills, per-speaker color chips, or italic for UI labels (italic is only for session subtitles and content emphasis). Speakers are rubric small caps, and states are a plain word in moss, ochre or ink.
- **Don't** add drop shadows to page content. Only the cover and objects lying on the page (ribbon, menus, floating player) cast.
- **Don't** introduce a second typeface for display or UI. A system monospace is allowed only for machine strings (regex, keys, URLs, raw markdown).
- **Don't** set labels in uppercase with wide tracking. Use small caps.
- **Don't** use more than one solid rubric button in a view, or use rubric decoratively.
- **Don't** add parchment textures, burnt edges, stains or fantasy display faces. The only texture is the cover's faint dot grain.
- **Don't** hard-code hex or `rgba()` colors in components. They break lamplit.
- **Don't** use emoji as icons.

## Additions (2026-09-23): charts, quotes, walkthrough

- **Charts** (`gui/src/Charts.tsx`, `BarList`): single-series horizontal bars only. One hue per light, `--chart-bar` (#9E2B25 daylight, #DC6A5B lamplit). Both were validated with the dataviz six checks against their page colors; the lamplit rubric itself is too light for filled marks. Bars are 14px thick, square at the baseline with a 4px rounded data end, and scaled within the track minus room for the value label. Values sit at the tip in ink-soft tabular figures, never in the bar color. Every bar row is focusable and shows a tooltip (value first) on hover and focus, and every chart has a "show as table" view. Headline totals are a written sentence (`.stats-sentence`), not number tiles.
- **Quotes**: saved lines are upright 22px ink in rubric curly quotes (`.quote-entry blockquote`), with speaker small caps, a source link (`session, time`), the round rubric play button, download and remove as `entry-action` icons.
- **Unsure-word walkthrough** (`.walkthrough`): a raised slip over the page (page-raised, rule-strong border, 3px rubric top rule, the shared shadow). Its layout is a counter and confidence line, the line with the word under the highlighter, then a written-line input, an "also save as a rule" checkbox and Back / Play again / Keep-or-Fix buttons.
- **Summary citations** (`.citation`): `[1:15:57]` in a summary renders as a small rubric underlined timestamp that opens the transcript at that line and plays.

## Brand: the gilt-stamped title (2026-09-23)

`gui/src/Brand.tsx`. The mark is a d20 (icosahedron) drawn in single gilt strokes (`BrandMark`). The name "Co-DM" is set in EB Garamond in `--gilt-foil` (#D8BC85 daylight, #CFAE72 lamplit), always on the leather, with a 1px dark text-shadow so it reads as pressed into the cover.
- **Cover** (`CoverWordmark`): a 30px mark beside the name at 27px/600, over "campaign journal" in 14px small caps (cover-ink-soft).
- **Front cover** (`FrontCover`, used by the landing and login pages): full-bleed leather, a gilt double-tooled inset frame (1px border plus an outline at 6px offset), and centered: a 64px mark, the name at clamp(56px, 9vw, 88px)/500, "a campaign journal for the whole table" in small caps, then `GiltRule` (a double rule with a center lozenge), the tagline and the Discord button. There's one entrance: the title block rises 8px and fades in over 0.7s (skipped under reduced motion).
- The Discord button keeps Discord's own blurple (#5865f2) with 3px corners; it's a third-party mark, not a rubric action.
