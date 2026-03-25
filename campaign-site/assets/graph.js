'use strict';
(async function () {
  const data = await fetch(window.GRAPH_DATA_URL || 'graph-data.json').then(r => r.json());

  const svg    = d3.select('#graph-svg');
  const width  = window.innerWidth;
  const height = window.innerHeight - document.querySelector('.graph-header').offsetHeight;
  svg.attr('width', width).attr('height', height);

  // ── Legend ──────────────────────────────────────────────────────────────
  const SECTION_LABELS = {
    'Characters/PCs':      { label: 'Player Characters', color: '#a6e3a1' },
    'Characters/NPCs':     { label: 'NPCs',              color: '#89b4fa' },
    'Characters/Sephirot': { label: 'Sephirot',          color: '#c9a84c' },
    'Locations':           { label: 'Locations',         color: '#cba6f7' },
    'Events':              { label: 'Events',            color: '#f38ba8' },
    'Factions':            { label: 'Factions',          color: '#fab387' },
    'Items':               { label: 'Items',             color: '#94e2d5' },
    'Mechanics':           { label: 'Mechanics',         color: '#89dceb' },
    '':                    { label: 'Other',             color: '#6a6a8a' },
  };
  function resolveColor(section) {
    if (SECTION_LABELS[section]) return SECTION_LABELS[section].color;
    for (const [k, v] of Object.entries(SECTION_LABELS)) {
      if (k && section.startsWith(k.split('/')[0])) return v.color;
    }
    return '#6a6a8a';
  }

  const legendEl = document.getElementById('legend');
  const seenSections = new Set(data.nodes.map(n => {
    if (SECTION_LABELS[n.section]) return n.section;
    const top = n.section.split('/')[0];
    return Object.keys(SECTION_LABELS).find(k => k.startsWith(top)) || '';
  }));
  for (const sec of Object.keys(SECTION_LABELS)) {
    if (!seenSections.has(sec) && sec !== '') continue;
    const info = SECTION_LABELS[sec];
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${info.color}"></span>${info.label}`;
    legendEl.appendChild(item);
  }

  // ── Simulation params (live-adjustable) ──────────────────────────────────
  const params = {
    charge:       -1000,
    linkDistance:    80,
    linkStrength:   0.2,
    nodeSize:       1.0,
  };

  // ── Zoom/pan ─────────────────────────────────────────────────────────────
  const g = svg.append('g');
  svg.call(d3.zoom()
    .scaleExtent([0.1, 6])
    .on('zoom', e => g.attr('transform', e.transform))
  );

  // ── Node sizing ───────────────────────────────────────────────────────────
  const linkCount = {};
  data.links.forEach(l => {
    linkCount[l.target] = (linkCount[l.target] || 0) + 1;
    linkCount[l.source] = (linkCount[l.source] || 0) + 1;
  });
  function nodeRadius(d) {
    return (2 + Math.sqrt(linkCount[d.id] || 0) * 1.8) * params.nodeSize;
  }

  // ── Simulation ────────────────────────────────────────────────────────────
  const linkForce   = d3.forceLink(data.links).id(d => d.id).distance(params.linkDistance).strength(params.linkStrength);
  const chargeForce = d3.forceManyBody().strength(params.charge);

  const simulation = d3.forceSimulation(data.nodes)
    .force('link',      linkForce)
    .force('charge',    chargeForce)
    .force('center',    d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 4));

  // ── Edges ─────────────────────────────────────────────────────────────────
  const link = g.append('g').selectAll('line')
    .data(data.links).join('line')
    .attr('class', 'graph-link');

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const node = g.append('g').selectAll('g')
    .data(data.nodes).join('g')
    .attr('class', 'graph-node')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  const circles = node.append('circle')
    .attr('r', nodeRadius)
    .attr('fill',   d => resolveColor(d.section))
    .attr('stroke', d => d3.color(resolveColor(d.section)).darker(0.8))
    .attr('fill-opacity', 0.85);

  const labels = node.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => nodeRadius(d) + 10)
    .attr('text-anchor', 'middle')
    .text(d => d.title);

  // ── Tooltip ───────────────────────────────────────────────────────────────
  const tooltip = document.getElementById('graph-tooltip');

  node
    .on('mouseenter', (e, d) => {
      const connected = new Set([d.id]);
      data.links.forEach(l => {
        if (l.source.id === d.id || l.source === d.id) connected.add(typeof l.target === 'object' ? l.target.id : l.target);
        if (l.target.id === d.id || l.target === d.id) connected.add(typeof l.source === 'object' ? l.source.id : l.source);
      });
      node.classed('dimmed',      n => !connected.has(n.id));
      node.classed('highlighted', n => connected.has(n.id));
      link.classed('highlighted', l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return s === d.id || t === d.id;
      });
      const secLabel = (SECTION_LABELS[d.section] || { label: d.section || 'Unknown' }).label;
      tooltip.innerHTML = `<div>${d.title}</div><div class="tooltip-section">${secLabel} · ${linkCount[d.id] || 0} links</div>`;
      tooltip.style.opacity = '1';
    })
    .on('mousemove', e => {
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top  = (e.clientY - 10) + 'px';
    })
    .on('mouseleave', () => {
      node.classed('dimmed', false).classed('highlighted', false);
      link.classed('highlighted', false);
      tooltip.style.opacity = '0';
    })
    .on('click', (e, d) => { window.location.href = d.url; });

  // ── Tick ──────────────────────────────────────────────────────────────────
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // ── Resize ────────────────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight - document.querySelector('.graph-header').offsetHeight;
    svg.attr('width', w).attr('height', h);
    simulation.force('center', d3.forceCenter(w / 2, h / 2)).alpha(0.3).restart();
  });

  // ── Controls panel ────────────────────────────────────────────────────────
  function applyParams() {
    chargeForce.strength(params.charge);
    linkForce.distance(params.linkDistance).strength(params.linkStrength);
    simulation
      .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 4))
      .alpha(0.5)
      .restart();
    circles.attr('r', nodeRadius);
    labels.attr('dy', d => nodeRadius(d) + 10);
  }

  const controlsPanel = document.createElement('div');
  controlsPanel.className = 'graph-controls';
  controlsPanel.innerHTML = `
    <button class="controls-toggle" id="controlsToggle" aria-expanded="false">
      ⚙ Controls
    </button>
    <div class="controls-body" id="controlsBody">
      <div class="ctrl-row">
        <label class="ctrl-label">Repulsion</label>
        <input type="range" id="ctrl-charge" min="-3000" max="-50" step="50" value="${params.charge}">
        <span class="ctrl-val" id="val-charge">${Math.abs(params.charge)}</span>
      </div>
      <div class="ctrl-row">
        <label class="ctrl-label">Link Distance</label>
        <input type="range" id="ctrl-linkDist" min="20" max="300" step="10" value="${params.linkDistance}">
        <span class="ctrl-val" id="val-linkDist">${params.linkDistance}</span>
      </div>
      <div class="ctrl-row">
        <label class="ctrl-label">Link Strength</label>
        <input type="range" id="ctrl-linkStr" min="0.01" max="1" step="0.01" value="${params.linkStrength}">
        <span class="ctrl-val" id="val-linkStr">${params.linkStrength.toFixed(2)}</span>
      </div>
      <div class="ctrl-row">
        <label class="ctrl-label">Node Size</label>
        <input type="range" id="ctrl-nodeSize" min="0.3" max="3" step="0.1" value="${params.nodeSize}">
        <span class="ctrl-val" id="val-nodeSize">${params.nodeSize.toFixed(1)}×</span>
      </div>
      <button class="ctrl-reset" id="ctrl-reset">Reset</button>
    </div>
  `;
  document.body.appendChild(controlsPanel);

  // Toggle open/close
  const toggle   = document.getElementById('controlsToggle');
  const body     = document.getElementById('controlsBody');
  toggle.addEventListener('click', () => {
    const open = body.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });

  // Slider wiring
  const sliders = [
    { id: 'ctrl-charge',   val: 'val-charge',   key: 'charge',       fmt: v => Math.abs(v),            parse: v => -Math.abs(v) },
    { id: 'ctrl-linkDist', val: 'val-linkDist',  key: 'linkDistance', fmt: v => v,                      parse: v => +v },
    { id: 'ctrl-linkStr',  val: 'val-linkStr',   key: 'linkStrength', fmt: v => (+v).toFixed(2),        parse: v => +v },
    { id: 'ctrl-nodeSize', val: 'val-nodeSize',  key: 'nodeSize',     fmt: v => (+v).toFixed(1) + '×',  parse: v => +v },
  ];
  sliders.forEach(({ id, val, key, fmt, parse }) => {
    const input = document.getElementById(id);
    const label = document.getElementById(val);
    input.addEventListener('input', () => {
      params[key] = parse(input.value);
      label.textContent = fmt(input.value);
      applyParams();
    });
  });

  // Reset button
  const DEFAULTS = { charge: -1000, linkDistance: 80, linkStrength: 0.2, nodeSize: 1.0 };
  document.getElementById('ctrl-reset').addEventListener('click', () => {
    Object.assign(params, DEFAULTS);
    document.getElementById('ctrl-charge').value   = DEFAULTS.charge;
    document.getElementById('ctrl-linkDist').value = DEFAULTS.linkDistance;
    document.getElementById('ctrl-linkStr').value  = DEFAULTS.linkStrength;
    document.getElementById('ctrl-nodeSize').value = DEFAULTS.nodeSize;
    document.getElementById('val-charge').textContent   = Math.abs(DEFAULTS.charge);
    document.getElementById('val-linkDist').textContent = DEFAULTS.linkDistance;
    document.getElementById('val-linkStr').textContent  = DEFAULTS.linkStrength.toFixed(2);
    document.getElementById('val-nodeSize').textContent = DEFAULTS.nodeSize.toFixed(1) + '×';
    applyParams();
  });
})();
