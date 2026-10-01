"""
wiki.py: a campaign's wiki, read from its vault (an Obsidian-style folder of
markdown pages linked with [[wikilinks]]).

Replaces the Netlify site's generator (campaign-vault/campaign-site/build.js):
page list by section, [[link]] resolution, backlinks, broken links, search.
Page slugs match that generator's, so old links map across.
"""
from __future__ import annotations

import datetime
import re
from dataclasses import dataclass, field
from pathlib import Path

# Folders in a vault that aren't wiki pages.
SKIP_DIRS = {".git", ".github", ".obsidian", ".trash", "campaign-site", "node_modules", "templates", "Templates"}
LINK_RE = re.compile(r"\[\[([^\]\n]+)\]\]")

# The standard sections, in the order the wiki shows them (others follow, A-Z).
SECTION_ORDER = ["Characters", "Locations", "Factions", "Events", "Items", "Mechanics"]
SUBSECTION_ORDER = ["PCs", "NPCs"]  # player characters first


def slugify(title: str) -> str:
    """Same as build.js's slugify, so the Netlify site's page URLs carry over."""
    s = title.lower().replace("'", "")
    s = re.sub(r"[^\w\s-]", "-", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def link_target(inner: str) -> tuple[str, str]:
    """[[Folder/Page#Heading|shown text]] -> ("Page", "shown text")."""
    target, _, shown = inner.partition("|")
    target = target.split("#", 1)[0].strip()
    name = target.rsplit("/", 1)[-1].strip()
    return name, (shown.strip() or target.split("#", 1)[0].strip())


FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
# Properties that aren't key facts: Obsidian's own, and ones the page shows elsewhere.
HIDDEN_PROPS = {"aliases", "alias", "tags", "tag", "cssclasses", "cssclass", "kind", "publish"}


def _prop_text(v) -> str:
    """A property's value as one line of markdown. Unquoted [[Link]] in YAML
    parses as a nested list, so turn that back into the link."""
    if v is None:
        return ""
    if isinstance(v, list):
        if len(v) == 1 and isinstance(v[0], list) and len(v[0]) == 1 and isinstance(v[0][0], str):
            return f"[[{v[0][0]}]]"
        return ", ".join(t for t in (_prop_text(x) for x in v) if t)
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return ", ".join(f"{k}: {_prop_text(x)}" for k, x in v.items())
    return str(v).strip()


def split_frontmatter(text: str) -> tuple[dict, str]:
    """Obsidian properties (YAML between --- lines at the top) and the rest of the page."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        import yaml
        props = yaml.safe_load(m.group(1)) or {}
    except Exception:
        props = {}
    return (props if isinstance(props, dict) else {}), text[m.end():]


@dataclass
class Page:
    title: str
    slug: str
    section: str          # "Characters/PCs"
    path: str             # relative to the vault
    text: str
    links: list[str] = field(default_factory=list)      # slugs this page links to
    broken: list[str] = field(default_factory=list)     # link targets with no page
    props: dict = field(default_factory=dict)           # frontmatter properties
    body: str = ""                                      # the text after them

    def __post_init__(self):
        self.props, self.body = split_frontmatter(self.text)

    @property
    def aliases(self) -> list[str]:
        a = self.props.get("aliases") or self.props.get("alias") or []
        return [str(x).strip() for x in (a if isinstance(a, list) else [a]) if str(x).strip()]

    def facts(self) -> list[tuple[str, str]]:
        """Key facts, in the file's order: (label, markdown value). Status is shown apart."""
        out = []
        for k, v in self.props.items():
            key = str(k).strip()
            if key.lower() in HIDDEN_PROPS or key.lower() == "status":
                continue
            t = _prop_text(v)
            if t:
                label = re.sub(r"[-_]+", " ", key).strip()
                out.append((label[:1].upper() + label[1:], t))
        return out

    @property
    def status(self) -> str:
        return _prop_text(self.props.get("status") or self.props.get("Status"))


@dataclass
class WikiIndex:
    pages: dict[str, Page]                 # slug -> page
    by_title: dict[str, str]               # lowercased title -> slug
    backlinks: dict[str, list[str]]        # slug -> slugs linking to it

    def resolve(self, name: str) -> str | None:
        return self.by_title.get(name.lower())

    def summary(self) -> list[dict]:
        def section_key(p: Page):
            parts = p.section.split("/") if p.section else [""]
            top, sub = parts[0], "/".join(parts[1:])
            return (SECTION_ORDER.index(top) if top in SECTION_ORDER else len(SECTION_ORDER),
                    SUBSECTION_ORDER.index(sub) if sub in SUBSECTION_ORDER else len(SUBSECTION_ORDER),
                    p.section, p.title.lower())
        return [{"title": p.title, "slug": p.slug, "section": p.section, "excerpt": excerpt(p.body),
                 "backlinks": len(self.backlinks.get(p.slug, [])), "broken": len(p.broken), "aliases": p.aliases}
                for p in sorted(self.pages.values(), key=section_key)]

    def search(self, q: str, limit: int = 20) -> list[dict]:
        q = q.strip().lower()
        if not q:
            return []
        hits = []
        for p in self.pages.values():
            in_title = q in p.title.lower()
            at = p.text.lower().find(q)
            if not in_title and at < 0:
                continue
            snippet = ""
            if at >= 0:
                s = max(0, at - 60)
                snippet = ("…" if s else "") + re.sub(r"\s+", " ", p.text[s:at + len(q) + 80]).strip() + "…"
            hits.append((0 if in_title else 1, -p.text.lower().count(q), {"title": p.title, "slug": p.slug, "section": p.section, "snippet": snippet}))
        hits.sort(key=lambda h: (h[0], h[1]))
        return [h[2] for h in hits[:limit]]


def excerpt(text: str, n: int = 180) -> str:
    """The first real paragraph, markdown stripped, for page lists and link previews."""
    for block in re.split(r"\n\s*\n", text):
        b = block.strip()
        if not b or b.startswith(("#", "---", "|", "- ", "* ", ">")) or (b.startswith("*") and b.endswith("*") and len(b) < 80):
            continue
        b = LINK_RE.sub(lambda m: link_target(m.group(1))[1], b)
        b = re.sub(r"[*_`]", "", b)
        b = re.sub(r"\s+", " ", b)
        return b if len(b) <= n else b[:n].rsplit(" ", 1)[0] + "…"
    return ""


def scan(vault: Path) -> WikiIndex:
    pages: dict[str, Page] = {}
    for f in sorted(vault.rglob("*.md")):
        rel = f.relative_to(vault)
        if any(part in SKIP_DIRS for part in rel.parts[:-1]) or rel.name.lower() == "readme.md":
            continue
        title = f.stem
        slug = slugify(title)
        if slug in pages:  # two files with one name: keep the first, like Obsidian's shortest-path rule
            continue
        section = "/".join(rel.parts[:-1])
        pages[slug] = Page(title, slug, section, str(rel).replace("\\", "/"), f.read_text(encoding="utf-8", errors="replace"))
    by_title = {p.title.lower(): p.slug for p in pages.values()}
    for p in pages.values():  # Obsidian resolves [[Alias]] to the page that lists it
        for a in p.aliases:
            by_title.setdefault(a.lower(), p.slug)
    backlinks: dict[str, list[str]] = {}
    for p in pages.values():
        for m in LINK_RE.finditer(p.text):
            name, _ = link_target(m.group(1))
            target = by_title.get(name.lower())
            if target:
                if target not in p.links:
                    p.links.append(target)
                if target != p.slug and p.slug not in backlinks.setdefault(target, []):
                    backlinks[target].append(p.slug)
            elif name and name not in p.broken:
                p.broken.append(name)
    return WikiIndex(pages, by_title, backlinks)


PARTY = "_party"   # player characters, and what they carry


def factions(idx: WikiIndex) -> dict[str, str]:
    """The faction each page belongs with, for grouping the graph (slug -> faction
    slug, or PARTY); pages with none are left out.

    A faction is itself. Player characters are the party. Other characters go by
    their `affiliation`, then by leading a faction, then by their `base`; items by
    who holds them (`held-by`); places by who rules them (`ruled-by`). A link to a
    place counts when it's the base of exactly one faction (Canaan Labs, not a
    region several share)."""
    def prop_links(page: Page, key: str) -> list[str]:
        out = []
        for inner in LINK_RE.findall(_prop_text(page.props.get(key))):
            slug = idx.resolve(link_target(inner)[0])
            if slug and slug not in out:
                out.append(slug)
        return out

    faction_pages = [p for p in idx.pages.values() if p.section == "Factions"]
    based: dict[str, set[str]] = {}
    led: dict[str, str] = {}
    for f in faction_pages:
        first = prop_links(f, "base")[:1]
        for place in first:
            based.setdefault(place, set()).add(f.slug)
        for person in prop_links(f, "leader"):
            led.setdefault(person, f.slug)
    home_of = {place: next(iter(fs)) for place, fs in based.items() if len(fs) == 1}

    memo: dict[str, str | None] = {}

    def of(slug: str, depth: int = 0) -> str | None:
        if slug in memo:
            return memo[slug]
        p = idx.pages[slug]
        top = p.section.split("/")[0]
        found = None
        if p.section == "Factions":
            found = slug
        elif p.section == "Characters/PCs":
            found = PARTY
        elif depth < 3:
            keys = {"Characters": ["affiliation", "_leads", "base"], "Items": ["held-by"],
                    "Locations": ["ruled-by"]}.get(top, [])
            for key in keys:
                targets = [led[slug]] if key == "_leads" and slug in led else [] if key == "_leads" else prop_links(p, key)
                for t in targets:
                    tp = idx.pages[t]
                    if tp.section == "Factions":
                        found = t
                    elif t in home_of:
                        found = home_of[t]
                    elif tp.section.startswith("Characters") and t != slug:
                        found = of(t, depth + 1)
                    if found:
                        break
                if found:
                    break
        memo[slug] = found
        return found

    return {slug: f for slug in idx.pages if (f := of(slug))}


def fingerprint(vault: Path) -> tuple:
    """Changes whenever a page is added, removed or edited."""
    stamps = []
    for f in vault.rglob("*.md"):
        rel = f.relative_to(vault)
        if any(part in SKIP_DIRS for part in rel.parts[:-1]):
            continue
        st = f.stat()
        stamps.append((str(rel), st.st_mtime_ns, st.st_size))
    return tuple(sorted(stamps))


# ── The index's page lists ───────────────────────────────────────────────────
# Index.md is hand-written (title, epigraph, "Current State"), but its page
# lists are kept by the program: rebuilt from the vault after a wiki generation
# and whenever a page is created, so no page is left off. Big sections are
# split into major and minor by how many pages link to each one.

# Obsidian comments (%% %%): hidden in reading view and live preview alike; the
# site strips them too. The HTML-comment markers of the first version are still
# recognised (Obsidian's live preview shows those).
NAV_START = "%% page lists: kept up to date by Co-DM; edit the pages, not these lists %%"
NAV_END = "%% end of page lists %%"
OLD_MARKERS = ("<!-- page lists: kept up to date by Co-DM; edit the pages, not these lists -->", "<!-- end of page lists -->")
NAV_HEADING = "## 🗺️ Navigation"
# (folder, list heading, split into major/minor). Folders not listed get their own heading.
NAV_GROUPS = [
    ("Characters/PCs", "Player Characters", False),
    ("Characters/Sephirot", "Sephirot", False),
    ("Characters/NPCs", "NPCs", True),
    ("Locations", "Locations", True),
    ("Mechanics", "Core Mechanics", False),
    ("Items", "Items & Artifacts", True),
    ("Factions", "Factions", False),
    ("Events", "Events", False),
]
MAJOR_SHARE, MAJOR_MIN = 0.25, 5   # major: linked from at least a quarter as many pages as the section's top, and 5


def _links(pages: list[Page]) -> str:
    return " · ".join(f"[[{p.title}]]" for p in pages)


def navigation(idx: WikiIndex) -> str:
    """The page lists, as markdown: the most-linked first in each list; minor lists alphabetical."""
    by_section: dict[str, list[Page]] = {}
    for p in idx.pages.values():
        if p.slug == "index":
            continue
        by_section.setdefault(p.section or "Other", []).append(p)
    # Links from the index itself don't count: it links everything, and counting
    # it would make each rebuild shift the split.
    incoming = lambda p: len([b for b in idx.backlinks.get(p.slug, []) if b != "index"])
    known = {folder for folder, _, _ in NAV_GROUPS}
    groups = NAV_GROUPS + [(s, s.split("/")[-1], False) for s in sorted(by_section) if s not in known]
    out = []
    for folder, heading, split in groups:
        pages = sorted(by_section.get(folder, []), key=lambda p: (-incoming(p), p.title.lower()))
        if not pages:
            continue
        if split and len(pages) > 12:
            cut = max(MAJOR_MIN, MAJOR_SHARE * incoming(pages[0]))
            major = [p for p in pages if incoming(p) >= cut]
            minor = sorted((p for p in pages if incoming(p) < cut), key=lambda p: p.title.lower())
            out += [f"### {heading}", f"- **Major:** {_links(major)}", f"- **Minor:** {_links(minor)}", ""]
        else:
            out += [f"### {heading}", _links(pages), ""]
    return "\n".join(out).strip()


def update_index(vault: Path, title: str = "Index") -> str:
    """Rewrite Index.md's page lists from the vault (creating Index.md if there's none).
    Everything else in it is kept. Returns the new text."""
    path = vault / "Index.md"
    nav = f"{NAV_START}\n{navigation(scan(vault))}\n{NAV_END}"
    text = path.read_text(encoding="utf-8") if path.exists() else f"# {title}\n"
    text = text.replace(OLD_MARKERS[0], NAV_START).replace(OLD_MARKERS[1], NAV_END)
    if NAV_START in text and NAV_END in text:
        a, b = text.index(NAV_START), text.index(NAV_END) + len(NAV_END)
        text = text[:a] + nav + text[b:]
    elif NAV_HEADING in text:
        # The hand-made lists: from the heading to the next rule or level-2 heading.
        a = text.index(NAV_HEADING) + len(NAV_HEADING)
        m = re.compile(r"^(---\s*$|## )", re.M).search(text, a)
        b = m.start() if m else len(text)
        text = text[:a] + "\n\n" + nav + "\n\n" + text[b:]
    else:
        text = text.rstrip() + f"\n\n{NAV_HEADING}\n\n{nav}\n"
    path.write_text(text, encoding="utf-8")
    return text
