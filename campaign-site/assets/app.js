'use strict';
(function () {

  // ── Sidebar toggle (mobile) ─────────────────────────────────────────────
  const toggle   = document.getElementById('sidebarToggle');
  const sidebar  = document.getElementById('sidebar');

  // Create overlay
  const overlay  = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  document.body.appendChild(overlay);

  function openSidebar()  { sidebar.classList.add('open');  overlay.classList.add('active'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('active'); }

  if (toggle)  toggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
  overlay.addEventListener('click', closeSidebar);

  // ── Nav section collapse ────────────────────────────────────────────────
  document.querySelectorAll('.nav-section-title').forEach(btn => {
    const ul = btn.nextElementSibling;
    btn.addEventListener('click', () => {
      const collapsed = btn.classList.toggle('collapsed');
      if (ul) ul.classList.toggle('collapsed', collapsed);
    });
  });

  // Auto-scroll active nav item into view
  const activeLink = document.querySelector('.nav-section > ul li.active');
  if (activeLink) {
    activeLink.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  // ── Search ──────────────────────────────────────────────────────────────
  const searchInput   = document.getElementById('search');
  const searchResults = document.getElementById('search-results');
  if (!searchInput || !searchResults) return;

  let index    = null;
  let focusIdx = -1;

  async function loadIndex() {
    if (index !== null) return;
    try {
      const res = await fetch(window.SEARCH_INDEX_URL || 'search-index.json');
      index = await res.json();
    } catch (_) {
      index = [];
    }
  }

  function highlight(text, query) {
    if (!query) return escHtml(text);
    const re = new RegExp('(' + escRe(query) + ')', 'gi');
    return escHtml(text).replace(re, '<mark>$1</mark>');
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getSnippet(content, query) {
    const idx = content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return '';
    const start = Math.max(0, idx - 40);
    const end   = Math.min(content.length, idx + query.length + 80);
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < content.length) snippet = snippet + '…';
    return highlight(snippet, query);
  }

  function doSearch(q) {
    if (!index || !q.trim()) return [];
    const lower = q.toLowerCase();
    return index
      .filter(item =>
        item.title.toLowerCase().includes(lower) ||
        item.content.toLowerCase().includes(lower)
      )
      .sort((a, b) => {
        const aT = a.title.toLowerCase().includes(lower) ? 0 : 1;
        const bT = b.title.toLowerCase().includes(lower) ? 0 : 1;
        return aT - bT;
      })
      .slice(0, 10);
  }

  function renderResults(results, q) {
    focusIdx = -1;
    if (!results.length) {
      searchResults.innerHTML = `<div class="search-result" style="pointer-events:none"><span class="sr-title" style="color:var(--text-muted)">No results for "${escHtml(q)}"</span></div>`;
    } else {
      searchResults.innerHTML = results.map((r, i) => `
        <div class="search-result" data-url="${escHtml(r.url)}" role="option" tabindex="-1">
          <div class="sr-title">${highlight(r.title, q)}</div>
          ${r.section ? `<div class="sr-section">${escHtml(r.section)}</div>` : ''}
          <div class="sr-snippet">${getSnippet(r.content, q)}</div>
        </div>
      `).join('');

      searchResults.querySelectorAll('.search-result[data-url]').forEach(el => {
        el.addEventListener('click', () => { window.location.href = el.dataset.url; });
        el.addEventListener('mouseenter', () => {
          focusIdx = Array.from(searchResults.querySelectorAll('.search-result[data-url]')).indexOf(el);
          updateFocus();
        });
      });
    }
    searchResults.classList.add('active');
  }

  function updateFocus() {
    const items = searchResults.querySelectorAll('.search-result[data-url]');
    items.forEach((el, i) => el.classList.toggle('focused', i === focusIdx));
  }

  function hideResults() {
    searchResults.classList.remove('active');
    focusIdx = -1;
  }

  let debounceTimer;
  searchInput.addEventListener('focus', loadIndex);

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (!q) { hideResults(); return; }
    debounceTimer = setTimeout(async () => {
      await loadIndex();
      renderResults(doSearch(q), q);
    }, 120);
  });

  searchInput.addEventListener('keydown', e => {
    const items = Array.from(searchResults.querySelectorAll('.search-result[data-url]'));
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusIdx = Math.min(focusIdx + 1, items.length - 1);
      updateFocus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusIdx = Math.max(focusIdx - 1, 0);
      updateFocus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusIdx >= 0 && items[focusIdx]) {
        window.location.href = items[focusIdx].dataset.url;
      }
    } else if (e.key === 'Escape') {
      hideResults();
      searchInput.blur();
    }
  });

  document.addEventListener('click', e => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) hideResults();
  });

})();
