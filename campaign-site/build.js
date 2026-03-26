#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const VAULT_DIR  = process.env.VAULT_PATH
  ? path.resolve(process.env.VAULT_PATH)
  : path.resolve(__dirname, '..', 'campaign-vault');
const OUTPUT_DIR = path.resolve(__dirname, 'dist');
const ASSETS_SRC = path.resolve(__dirname, 'assets');
const SITE_TITLE = 'As Above, So Below';

// ─── Slug ────────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^\w\s-]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── File registry ───────────────────────────────────────────────────────────
// Maps exact filename (no ext) → { slug, section, fullPath, title }

const fileRegistry = {};

function scanVault(dir, section) {
  section = section || '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = section ? section + '/' + entry.name : entry.name;
      scanVault(fullPath, sub);
    } else if (entry.name.endsWith('.md')) {
      const title = entry.name.replace(/\.md$/, '');
      const slug  = slugify(title);
      fileRegistry[title] = { slug, section, fullPath, title };
    }
  }
}

// Case-insensitive lookup
function findEntry(name) {
  if (fileRegistry[name]) return fileRegistry[name];
  const lower = name.toLowerCase();
  const key = Object.keys(fileRegistry).find(k => k.toLowerCase() === lower);
  return key ? fileRegistry[key] : null;
}

// ─── Wikilink resolution ─────────────────────────────────────────────────────

// marked pre-escapes & → &amp; and ' → &#39; inside text, so we must decode
// before lookup and use the already-escaped text as-is for display.
function decodeEntities(str) {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function resolveWikilink(inner) {
  const pipeIdx = inner.indexOf('|');
  let rawTarget, display;
  if (pipeIdx !== -1) {
    rawTarget = inner.slice(0, pipeIdx).trim();
    display   = inner.slice(pipeIdx + 1).trim(); // already HTML-safe from marked
  } else {
    rawTarget = inner.trim();
    display   = rawTarget;                        // already HTML-safe from marked
  }
  // Decode entities so lookup matches the real filename
  const target = decodeEntities(rawTarget);
  const entry  = findEntry(target);
  if (entry) {
    return `<a href="${entry.slug}.html" class="wikilink">${display}</a>`;
  }
  return `<span class="wikilink-missing" title="Page not found">${display}</span>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Markdown → HTML ─────────────────────────────────────────────────────────

let marked;
function getMarked() {
  if (!marked) {
    marked = require('marked').marked;
    marked.setOptions({ breaks: false, gfm: true });
  }
  return marked;
}

function processMarkdown(content) {
  // 1. Convert to HTML (wikilinks pass through as raw text)
  const html = getMarked()(content);
  // 2. Resolve [[wikilinks]] in the rendered HTML
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => resolveWikilink(inner));
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function buildNav(currentSlug) {
  // Group by top-level section
  const groups = {};
  for (const entry of Object.values(fileRegistry)) {
    // Use top-level folder as group key
    const top = entry.section ? entry.section.split('/')[0] : 'Root';
    if (!groups[top]) groups[top] = [];
    groups[top].push(entry);
  }

  const sectionOrder = ['Root', 'Characters', 'Factions', 'Locations', 'Events', 'Mechanics', 'Items'];
  const allSections  = Object.keys(groups);
  const ordered = [
    ...sectionOrder.filter(s => allSections.includes(s)),
    ...allSections.filter(s => !sectionOrder.includes(s)).sort()
  ];

  let html = '<ul class="nav-tree">';
  for (const section of ordered) {
    const files = (groups[section] || []).sort((a, b) => a.title.localeCompare(b.title));
    const sectionLabel = section === 'Root' ? 'Overview' : section;
    html += `<li class="nav-section">`;
    html += `<button class="nav-section-title" aria-expanded="true">${sectionLabel}</button>`;
    html += '<ul>';
    for (const f of files) {
      const active = f.slug === currentSlug ? ' class="active"' : '';
      html += `<li${active}><a href="${f.slug}.html">${escapeHtml(f.title)}</a></li>`;
    }
    html += '</ul></li>';
  }
  html += '</ul>';
  return html;
}

// ─── Page template ───────────────────────────────────────────────────────────

function renderPage({ title, content, nav, backlinks, section }) {
  const breadcrumb = section
    ? section.split('/').join(' <span class="bc-sep">›</span> ')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ${SITE_TITLE}</title>
  <link rel="stylesheet" href="assets/style.css">
  <link rel="stylesheet" href="assets/graph.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&display=swap" rel="stylesheet">
</head>
<body>
  <button class="sidebar-toggle" id="sidebarToggle" aria-label="Toggle navigation">☰</button>

  <div class="layout">
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <a href="index.html" class="site-title">
          <span class="site-icon">🌳</span>
          <span>AASB</span>
        </a>
        <div class="search-wrapper">
          <input type="text" id="search" placeholder="Search the wiki…" autocomplete="off" spellcheck="false" aria-label="Search">
          <div id="search-results" class="search-results" role="listbox" aria-label="Search results"></div>
        </div>
      </div>
      <div class="sidebar-nav" id="sidebarNav">
        <div class="graph-link-wrap">
          <a href="graph.html" class="graph-link">🕸 Graph View</a>
        </div>
        ${nav}
      </div>
    </nav>

    <main class="content">
      ${breadcrumb ? `<div class="breadcrumb">${breadcrumb}</div>` : ''}
      <article class="page-content">
        ${content}
      </article>
      ${backlinks}
    </main>
  </div>

  <script>window.SEARCH_INDEX_URL = 'search-index.json';</script>
  <script src="assets/app.js"></script>
</body>
</html>`;
}

// ─── Build ───────────────────────────────────────────────────────────────────

function build() {
  console.log('🌳  Building AASB Wiki…');

  // Scan vault
  scanVault(VAULT_DIR);
  const pages = Object.values(fileRegistry);
  console.log(`    Found ${pages.length} pages`);

  // Ensure output dirs
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const assetsOut = path.join(OUTPUT_DIR, 'assets');
  if (!fs.existsSync(assetsOut)) fs.mkdirSync(assetsOut);

  // ── Build backlinks index ──────────────────────────────────────────────────
  const backlinksMap = {};    // targetSlug → [{ title, slug }]
  for (const entry of pages) {
    const raw = fs.readFileSync(entry.fullPath, 'utf8');
    const wikilinks = [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
    for (const [, target] of wikilinks) {
      const found = findEntry(target.trim());
      if (found && found.slug !== entry.slug) {
        if (!backlinksMap[found.slug]) backlinksMap[found.slug] = [];
        if (!backlinksMap[found.slug].some(e => e.slug === entry.slug)) {
          backlinksMap[found.slug].push({ title: entry.title, slug: entry.slug });
        }
      }
    }
  }

  // ── Build search index ─────────────────────────────────────────────────────
  const searchIndex = [];

  // ── Generate pages ─────────────────────────────────────────────────────────
  let built = 0;
  for (const entry of pages) {
    const raw     = fs.readFileSync(entry.fullPath, 'utf8');
    const content = processMarkdown(raw);

    // Backlinks aside
    const bls     = backlinksMap[entry.slug] || [];
    const blHtml  = bls.length > 0
      ? `<aside class="backlinks">
           <h3>Linked from</h3>
           <ul>${bls.map(b => `<li><a href="${b.slug}.html">${escapeHtml(b.title)}</a></li>`).join('')}</ul>
         </aside>`
      : '';

    const nav  = buildNav(entry.slug);
    const html = renderPage({
      title:     entry.title,
      content,
      nav,
      backlinks: blHtml,
      section:   entry.section,
    });

    fs.writeFileSync(path.join(OUTPUT_DIR, `${entry.slug}.html`), html);
    built++;

    // Search entry — strip markdown/wiki syntax
    const plain = raw
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, d) => d || t)
      .replace(/#{1,6}\s+/g, ' ')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/`[^`]+`/g, '')
      .replace(/\|/g, ' ')
      .replace(/\n+/g, ' ')
      .substring(0, 3000);

    searchIndex.push({
      title:   entry.title,
      url:     `${entry.slug}.html`,
      section: entry.section || '',
      content: plain,
    });
  }

  // ── Graph data ─────────────────────────────────────────────────────────────
  const SECTION_COLORS = {
    'Characters/PCs':       '#a6e3a1',
    'Characters/NPCs':      '#89b4fa',
    'Characters/Sephirot':  '#c9a84c',
    'Locations':            '#cba6f7',
    'Events':               '#f38ba8',
    'Factions':             '#fab387',
    'Items':                '#94e2d5',
    'Mechanics':            '#89dceb',
  };
  function nodeColor(section) {
    if (SECTION_COLORS[section]) return SECTION_COLORS[section];
    for (const [k, v] of Object.entries(SECTION_COLORS)) {
      if (section.startsWith(k.split('/')[0])) return v;
    }
    return '#6a6a8a';
  }

  // Exclude meta/navigation pages from the graph
  const GRAPH_EXCLUDE = new Set(['index']);

  const graphNodes = pages
    .filter(e => !GRAPH_EXCLUDE.has(e.slug))
    .map(e => ({
      id:      e.slug,
      title:   e.title,
      url:     `${e.slug}.html`,
      section: e.section || '',
      color:   nodeColor(e.section || ''),
      links:   (backlinksMap[e.slug] || []).length,
    }));

  const graphEdges = [];
  const edgeSet = new Set();
  for (const entry of pages) {
    if (GRAPH_EXCLUDE.has(entry.slug)) continue;   // skip index as source
    const raw = fs.readFileSync(entry.fullPath, 'utf8');
    const wikilinks = [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
    for (const [, target] of wikilinks) {
      const found = findEntry(target.trim());
      if (found && found.slug !== entry.slug && !GRAPH_EXCLUDE.has(found.slug)) {
        const key = [entry.slug, found.slug].sort().join('|');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          graphEdges.push({ source: entry.slug, target: found.slug });
        }
      }
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'graph-data.json'),
    JSON.stringify({ nodes: graphNodes, links: graphEdges })
  );

  // ── Graph page ─────────────────────────────────────────────────────────────
  const graphHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph — ${SITE_TITLE}</title>
  <link rel="stylesheet" href="assets/style.css">
  <link rel="stylesheet" href="assets/graph.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
</head>
<body class="graph-page">
  <div class="graph-header">
    <a href="index.html" class="back-link">← ${SITE_TITLE}</a>
    <span class="graph-title">Graph View</span>
    <span class="graph-hint">Scroll to zoom · Drag to pan · Click a node to open</span>
  </div>
  <div class="graph-legend" id="legend"></div>
  <svg id="graph-svg"></svg>
  <div class="graph-tooltip" id="graph-tooltip"></div>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script>window.GRAPH_DATA_URL = 'graph-data.json';</script>
  <script src="assets/graph.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'graph.html'), graphHtml);

  // ── Index page ─────────────────────────────────────────────────────────────
  const indexEntry = findEntry('Index');
  let indexHtml;
  if (indexEntry) {
    const raw     = fs.readFileSync(indexEntry.fullPath, 'utf8');
    const content = processMarkdown(raw);
    indexHtml = renderPage({
      title:     SITE_TITLE,
      content,
      nav:       buildNav('index'),
      backlinks: '',
      section:   '',
    });
  } else {
    indexHtml = renderPage({
      title:     SITE_TITLE,
      content:   `<h1>${SITE_TITLE}</h1><p>Use the sidebar to navigate or search above.</p>`,
      nav:       buildNav('index'),
      backlinks: '',
      section:   '',
    });
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), indexHtml);

  // ── Search index ───────────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'search-index.json'),
    JSON.stringify(searchIndex)
  );

  // ── Copy assets ────────────────────────────────────────────────────────────
  for (const f of fs.readdirSync(ASSETS_SRC)) {
    fs.copyFileSync(path.join(ASSETS_SRC, f), path.join(assetsOut, f));
  }

  console.log(`✅  Built ${built} pages → ${OUTPUT_DIR}`);
  console.log(`    Run: node serve.js  (then open http://localhost:3000)`);
}

build();
