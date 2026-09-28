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
