/**
 * lab-shared.js — the shell every environment shares: the lab rail, the lab
 * header (breadcrumb, tabs, Guide toggle), the guide panel, the docked event
 * log and the status bar, plus the All labs home page. Pair with
 * lab-shared.css. Load it at the end of <body>, before the page's app.js, so
 * the shell exists by the time app.js looks for its elements.
 *
 * A page supplies content, never chrome:
 *
 *   <div id="lab-content">
 *     <section class="tab-panel" id="tab-build" data-tab="build" data-tab-label="Build">…</section>
 *   </div>
 *   <div id="lab-guide" hidden>
 *     <div class="guide-intro"><p>…</p></div>
 *     <article class="guide-topic" data-tag="View" data-title="…">…</article>
 *   </div>
 *   <script>
 *     window.LAB_PAGE = {
 *       id: 'pizza',                          // labs.json id, or 'home'
 *       log: { title, columns: [4], filters: ['view', …], off: ['resource'], hint, empty },
 *       status: [{ id: 'rum', probe: 'rum' }, { id: 'backend', label: '…', state: 'other' }],
 *     };
 *   </script>
 *
 * The rail and the All labs page come from ../labs.json. Everything a reader
 * adjusts (theme, guide open/width/topic, log height/collapsed/filters, active
 * tab, home view) is remembered in localStorage, keyed per lab — written only
 * when the reader changes it, never on load, so a page that inspects its own
 * storage (the consent lab) sees nothing the shell wrote by itself.
 *
 * Exposes window.LabShell, window.LabLog and window.LabStatus for app.js.
 */
(function () {
  'use strict';

  const PAGE = window.LAB_PAGE || {};
  const LAB_ID = PAGE.id || 'home';
  const IS_HOME = LAB_ID === 'home';

  // One RUM application, one service per environment, so sessions can be
  // filtered by lab (service:rum-labs-consent). config.js gives the prefix;
  // this runs before app.js reads it for init(). scripts/labs.js serviceFor()
  // applies the same rule to the source map upload.
  if (window.DD_CONFIG?.service) window.DD_CONFIG.service = `${window.DD_CONFIG.service}-${LAB_ID}`;
  const SCRIPT_URL = new URL(document.currentScript.src);
  // The site root is wherever this script lives. The build appends ?v=<sha>
  // to it, so reusing that query busts the registry's cache on every deploy.
  const ROOT = new URL('.', SCRIPT_URL);
  const REGISTRY_URL = new URL('labs.json' + SCRIPT_URL.search, ROOT);
  const NARROW = window.matchMedia('(max-width: 860px)');

  const DEFAULT_REPO = 'https://github.com/kyletaylored/datadog-rum-pizza-builder';
  const repoMeta = document.querySelector('meta[name="lab-repo"]')?.content;
  const REPO_URL = repoMeta && !repoMeta.includes('%%') ? repoMeta : DEFAULT_REPO;

  /* ============================================================
     Helpers
     ============================================================ */
  const store = {
    key: (k) => `ddLab.${LAB_ID}.${k}`,
    get(k, fallback) {
      try {
        const v = localStorage.getItem(this.key(k));
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(k, value) {
      try { localStorage.setItem(this.key(k), JSON.stringify(value)); } catch { /* storage full or blocked */ }
    },
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Lucide icon as a CSS mask, colored by currentColor (see lab-shared.css). */
  function icon(name, size = 16) {
    return `<span class="icon icon--${size}" data-icon="${esc(name)}" aria-hidden="true"></span>`;
  }

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ============================================================
     Theme — `theme-dark theme-dark-hc` on <html> for dark, no class for
     light, plus data-theme for anything that reads the attribute (the
     ReactFlow diagram does). The pre-paint script in each page's <head>
     applies the saved value; this only flips it.
     ============================================================ */
  function isDark() {
    return document.documentElement.classList.contains('theme-dark');
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
    root.classList.toggle('theme-dark-hc', theme === 'dark');
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* blocked */ }
    syncThemeButton();
  }

  function syncThemeButton() {
    const btn = document.getElementById('lab-theme-toggle');
    if (!btn) return;
    const dark = isDark();
    btn.innerHTML = icon(dark ? 'sun' : 'moon', 16);
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Light mode' : 'Dark mode';
  }

  /* ============================================================
     Resize handles — pointer drag plus arrow keys, so they work with a
     mouse, a finger and a keyboard alike.
     ============================================================ */
  function makeResizer(handle, { axis, get, set, step = 16 }) {
    const vertical = axis === 'x'; // dragging left/right
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const start = vertical ? e.clientX : e.clientY;
      const from = get();
      document.body.classList.add(vertical ? 'is-resizing-x' : 'is-resizing-y');
      handle.classList.add('is-dragging');
      const move = (ev) => set(from - ((vertical ? ev.clientX : ev.clientY) - start));
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('is-resizing-x', 'is-resizing-y');
        handle.classList.remove('is-dragging');
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    // Both handles sit on the panel's leading edge (left of the guide, top of
    // the log), so moving toward the content — left / up — grows the panel.
    handle.addEventListener('keydown', (e) => {
      const grow = vertical ? 'ArrowLeft' : 'ArrowUp';
      const shrink = vertical ? 'ArrowRight' : 'ArrowDown';
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      const delta = (e.shiftKey ? step * 4 : step) * (e.key === grow ? 1 : -1);
      set(get() + delta);
    });
  }

  /* ============================================================
     Shell skeleton
     ============================================================ */
  const content = document.getElementById('lab-content') || h('<div id="lab-content"></div>');
  const guideSource = document.getElementById('lab-guide');

  document.body.classList.add('lab-shell', IS_HOME ? 'lab-shell--home' : 'lab-shell--lab');

  const rail = h(`
    <nav class="lab-rail" aria-label="RUM Labs">
      <a class="rail-logo" href="${esc(ROOT.href)}" aria-label="RUM Labs home"><span class="logo-mark"></span></a>
      <a class="rail-item" href="${esc(ROOT.href)}" ${IS_HOME ? 'aria-current="page"' : ''}>${icon('layout-grid', 20)}<span>All labs</span></a>
      <div class="rail-divider" role="presentation"></div>
      <div class="rail-labs"></div>
      <div class="rail-spacer"></div>
      <button type="button" class="rail-icon-btn" id="lab-theme-toggle"></button>
      <a class="rail-icon-btn" href="${esc(REPO_URL)}" target="_blank" rel="noopener" aria-label="GitHub repository" title="GitHub">${icon('github', 16)}</a>
    </nav>`);

  const frame = h('<div class="lab-frame"></div>');
  const body = h('<div class="lab-body"></div>');
  const main = h('<main class="lab-main"></main>');
  const scroller = h('<div class="lab-scroll"></div>');
  const status = h('<footer class="lab-status" aria-label="Status"></footer>');

  content.classList.add('lab-content', IS_HOME ? 'lab-content--home' : 'lab-content--lab');
  scroller.appendChild(content);
  main.appendChild(scroller);
  body.appendChild(main);

  document.body.prepend(rail, frame, status);
  rail.querySelector('#lab-theme-toggle').addEventListener('click', () => applyTheme(isDark() ? 'light' : 'dark'));
  syncThemeButton();

  /* ============================================================
     Header + tabs
     ============================================================ */
  const panels = [...content.querySelectorAll(':scope > .tab-panel[data-tab]')];
  const tabListeners = [];
  let activeTab = null;

  function showTab(id, { focus = false, persist = true } = {}) {
    const panel = panels.find((p) => p.dataset.tab === id) || panels[0];
    if (!panel) return;
    const changed = activeTab !== panel.dataset.tab;
    activeTab = panel.dataset.tab;
    for (const p of panels) {
      const on = p === panel;
      p.hidden = !on;
      const btn = document.getElementById(`tabbtn-${p.dataset.tab}`);
      if (btn) {
        btn.setAttribute('aria-selected', String(on));
        btn.tabIndex = on ? 0 : -1;
        if (on && focus) btn.focus();
      }
    }
    if (!changed) return;
    if (persist) store.set('activeTab', activeTab);
    scroller.scrollTop = 0;
    for (const fn of tabListeners) fn(activeTab);
    document.dispatchEvent(new CustomEvent('lab:tab', { detail: { tab: activeTab } }));
  }

  if (!IS_HOME) {
    const header = h(`
      <header class="lab-header">
        <div class="breadcrumb">
          <a href="${esc(ROOT.href)}">RUM Labs</a>
          <span class="breadcrumb-sep">${icon('chevron-right', 14)}</span>
          <span class="breadcrumb-current" id="lab-name">${esc(document.title.split(' · ')[0])}</span>
        </div>
        <div class="seg lab-tabs" role="tablist" aria-label="Lab sections"></div>
        <span class="header-spacer"></span>
        <button type="button" class="btn guide-toggle" id="lab-guide-toggle" aria-controls="lab-guide-panel" aria-label="Guide">${icon('book-open', 16)}<span>Guide</span></button>
      </header>`);
    const tablist = header.querySelector('.lab-tabs');
    for (const p of panels) {
      const id = p.dataset.tab;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', `tabbtn-${id}`);
      if (!p.id) p.id = `tab-${id}`;
      const btn = h(`<button type="button" class="seg-btn" role="tab" id="tabbtn-${esc(id)}" aria-controls="${esc(p.id)}" aria-selected="false">${esc(p.dataset.tabLabel || id)}</button>`);
      btn.addEventListener('click', () => showTab(id));
      tablist.appendChild(btn);
    }
    // Arrow keys move between tabs, per the ARIA tabs pattern.
    tablist.addEventListener('keydown', (e) => {
      const i = panels.findIndex((p) => p.dataset.tab === activeTab);
      let next = null;
      if (e.key === 'ArrowRight') next = (i + 1) % panels.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + panels.length) % panels.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = panels.length - 1;
      if (next === null) return;
      e.preventDefault();
      showTab(panels[next].dataset.tab, { focus: true });
    });
    if (panels.length < 2) tablist.hidden = true;
    frame.appendChild(header);
  }
  frame.appendChild(body);

  /* ============================================================
     Guide panel
     ============================================================ */
  const GUIDE_MIN = 260;
  const GUIDE_MAX = 620;
  let guideOpen = false;

  function buildGuide() {
    const topics = guideSource ? [...guideSource.querySelectorAll('.guide-topic')] : [];
    const intro = guideSource?.querySelector('.guide-intro');
    const panel = h(`
      <aside class="lab-guide" id="lab-guide-panel" aria-label="Guide">
        <div class="guide-resizer" role="separator" aria-orientation="vertical" tabindex="0"
             aria-label="Resize guide" aria-controls="lab-guide-panel" aria-valuemin="${GUIDE_MIN}" aria-valuemax="${GUIDE_MAX}"></div>
        <div class="guide-scroll">
          <section class="guide-about">
            <div class="eyebrow">About this lab</div>
            <div class="guide-about-body"></div>
          </section>
          <section class="guide-topics" ${topics.length ? '' : 'hidden'}>
            <div class="eyebrow" id="guide-topics-label">Topics</div>
            <ol class="guide-steps" aria-labelledby="guide-topics-label"></ol>
          </section>
          <article class="guide-card" ${topics.length ? '' : 'hidden'} aria-live="polite">
            <div class="guide-card-meta"><span class="tag tag--key guide-card-tag"></span><span class="guide-card-pos"></span></div>
            <h3 class="guide-card-title"></h3>
            <div class="guide-card-body"></div>
            <div class="progress" aria-hidden="true"><div class="progress-fill"></div></div>
            <div class="guide-card-nav">
              <button type="button" class="btn guide-prev">${icon('chevron-left', 14)}<span>Previous</span></button>
              <button type="button" class="btn btn--primary guide-next"><span>Next</span>${icon('chevron-right', 14)}</button>
            </div>
          </article>
        </div>
      </aside>`);
    if (intro) panel.querySelector('.guide-about-body').append(...intro.childNodes);

    const steps = panel.querySelector('.guide-steps');
    const cardBody = panel.querySelector('.guide-card-body');
    topics.forEach((t, i) => {
      const n = String(i + 1).padStart(2, '0');
      const li = h(`<li><button type="button" class="guide-step"><span class="guide-step-num">${n}</span><span class="guide-step-title">${esc(t.dataset.title)}</span></button></li>`);
      li.querySelector('button').addEventListener('click', () => setTopic(i));
      li.querySelector('button').title = t.dataset.title;
      steps.appendChild(li);
      cardBody.appendChild(t);
    });

    let current = clamp(store.get('activeTopic', 0), 0, Math.max(0, topics.length - 1));
    function setTopic(i, { persist = true } = {}) {
      current = clamp(i, 0, topics.length - 1);
      if (persist) store.set('activeTopic', current);
      topics.forEach((t, j) => { t.hidden = j !== current; });
      [...steps.children].forEach((li, j) => {
        const b = li.firstElementChild;
        b.dataset.state = j === current ? 'current' : j < current ? 'visited' : 'upcoming';
        if (j === current) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
      const t = topics[current];
      if (!t) return;
      panel.querySelector('.guide-card-tag').textContent = t.dataset.tag || 'Topic';
      panel.querySelector('.guide-card-pos').textContent = `${current + 1} of ${topics.length}`;
      panel.querySelector('.guide-card-title').textContent = t.dataset.title || '';
      panel.querySelector('.progress-fill').style.width = `${((current + 1) / topics.length) * 100}%`;
      panel.querySelector('.guide-prev').disabled = current === 0;
      panel.querySelector('.guide-next').disabled = current === topics.length - 1;
    }
    panel.querySelector('.guide-prev').addEventListener('click', () => setTopic(current - 1));
    panel.querySelector('.guide-next').addEventListener('click', () => setTopic(current + 1));
    setTopic(current, { persist: false });

    let width = clamp(store.get('guideWidth', 360), GUIDE_MIN, GUIDE_MAX);
    const resizer = panel.querySelector('.guide-resizer');
    const applyWidth = (px) => {
      width = clamp(Math.round(px), GUIDE_MIN, Math.max(GUIDE_MIN, Math.min(GUIDE_MAX, window.innerWidth - 320)));
      panel.style.setProperty('--guide-width', `${width}px`);
      resizer.setAttribute('aria-valuenow', String(width));
    };
    applyWidth(width);
    makeResizer(resizer, {
      axis: 'x',
      get: () => width,
      set: (px) => {
        applyWidth(px);
        store.set('guideWidth', width);
      },
    });

    guideSource?.remove();
    return panel;
  }

  function setGuideOpen(open, { persist = true } = {}) {
    guideOpen = open;
    const panel = document.getElementById('lab-guide-panel');
    const btn = document.getElementById('lab-guide-toggle');
    if (panel) panel.hidden = !open;
    if (btn) {
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('is-on', open);
    }
    // Below 860px the guide is an overlay that starts closed every load, so
    // opening it there shouldn't reopen it on the next wide-screen visit.
    if (persist && !NARROW.matches) store.set('guideOpen', open);
  }

  if (!IS_HOME) {
    body.appendChild(buildGuide());
    document.getElementById('lab-guide-toggle').addEventListener('click', () => setGuideOpen(!guideOpen));
    setGuideOpen(NARROW.matches ? false : store.get('guideOpen', true), { persist: false });
    NARROW.addEventListener('change', (e) => setGuideOpen(e.matches ? false : store.get('guideOpen', true), { persist: false }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && guideOpen && NARROW.matches) setGuideOpen(false, { persist: false });
    });
  }

  /* ============================================================
     Docked event log — one component, fed by every lab through LabLog.
     Rows: { c1, type, c3, c4, label?, sub?, title?, key? }. `type` picks the
     badge and the filter chip, `label` overrides the badge text, `sub` is a
     short note after it. Cells are text (escaped) or { html } for trusted
     markup the lab builds itself. Newest first.
     ============================================================ */
  const LabLog = (function () {
    const cfg = PAGE.log;
    if (IS_HOME || !cfg) {
      const noop = () => {};
      return { add: noop, setRows: noop, clear: noop, onClear: noop, addAction: () => null, setColumns: noop, get count() { return 0; } };
    }

    const MAX_ROWS = cfg.max || 300;
    const filters = (cfg.filters || []).map((f) => (typeof f === 'string' ? { type: f, label: f } : f));
    const off = new Set(store.get('logFilters', cfg.off || []));
    const clearHandlers = [];
    let rows = [];
    let seq = 0;
    let rendered = new Set();

    const el = h(`
      <section class="lab-log" aria-labelledby="lab-log-title">
        <div class="log-resizer" role="separator" aria-orientation="horizontal" tabindex="0"
             aria-label="Resize event log" aria-controls="lab-log-table"></div>
        <div class="log-head">
          <h2 class="eyebrow log-title" id="lab-log-title">${esc(cfg.title || 'Events')}</h2>
          <span class="log-count" aria-live="polite"></span>
          <span class="log-spacer"></span>
          <div class="log-filters" role="group" aria-label="Filter by type"></div>
          <div class="log-actions"></div>
          <button type="button" class="btn btn--sm log-clear">${icon('trash-2', 14)}<span>Clear</span></button>
          <button type="button" class="btn btn--sm btn--icon log-collapse" aria-controls="lab-log-table"></button>
        </div>
        ${cfg.hint ? `<p class="log-hint">${cfg.hint}</p>` : ''}
        <div class="log-table" id="lab-log-table" role="table" aria-labelledby="lab-log-title">
          <div class="log-row log-row--head" role="row"></div>
          <div class="log-rows" role="rowgroup"></div>
        </div>
      </section>`);
    const table = el.querySelector('.log-table');
    const headRow = el.querySelector('.log-row--head');
    const body_ = el.querySelector('.log-rows');

    function setColumns(cols) {
      headRow.innerHTML = cols.map((c) => `<div class="log-cell" role="columnheader">${esc(c)}</div>`).join('');
    }
    setColumns(cfg.columns || ['time', 'type', 'name', 'detail']);

    const chipBox = el.querySelector('.log-filters');
    for (const f of filters) {
      const chip = h(`<button type="button" class="log-chip ${esc(f.type)}">${esc(f.label)}</button>`);
      const sync = () => chip.setAttribute('aria-pressed', String(!off.has(f.type)));
      chip.addEventListener('click', () => {
        if (off.has(f.type)) off.delete(f.type);
        else off.add(f.type);
        store.set('logFilters', [...off]);
        sync();
        render();
      });
      sync();
      chipBox.appendChild(chip);
    }
    if (!filters.length) chipBox.hidden = true;

    el.querySelector('.log-clear').addEventListener('click', () => {
      rows = [];
      render();
      for (const fn of clearHandlers) fn();
    });

    // Height and collapse ------------------------------------------------
    const MIN_H = 90;
    const maxH = () => Math.max(MIN_H, window.innerHeight - 260);
    let height = store.get('logHeight', null);
    let collapsed = store.get('logCollapsed', false);
    const resizer = el.querySelector('.log-resizer');
    const collapseBtn = el.querySelector('.log-collapse');

    function applyHeight(px) {
      height = clamp(Math.round(px), MIN_H, maxH());
      table.style.height = `${height}px`;
      resizer.setAttribute('aria-valuemin', String(MIN_H));
      resizer.setAttribute('aria-valuemax', String(maxH()));
      resizer.setAttribute('aria-valuenow', String(height));
    }
    function setCollapsed(next, { persist = true } = {}) {
      collapsed = next;
      el.classList.toggle('is-collapsed', collapsed);
      collapseBtn.innerHTML = icon(collapsed ? 'chevron-up' : 'chevron-down', 14);
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      collapseBtn.setAttribute('aria-label', collapsed ? 'Show event log' : 'Hide event log');
      collapseBtn.title = collapsed ? 'Show event log' : 'Hide event log';
      if (persist) store.set('logCollapsed', collapsed);
    }
    collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));
    makeResizer(resizer, {
      axis: 'y',
      get: () => height,
      set: (px) => {
        if (collapsed) setCollapsed(false);
        applyHeight(px);
        store.set('logHeight', height);
      },
    });

    main.appendChild(el);
    // Default: min(220px, 40% of the main column), once it has a size.
    applyHeight(height ?? Math.min(220, main.clientHeight * 0.4));
    window.addEventListener('resize', () => applyHeight(height));
    setCollapsed(collapsed, { persist: false });

    // Rows ---------------------------------------------------------------
    function cell(value, cls) {
      if (value && typeof value === 'object' && 'html' in value) {
        return `<div class="log-cell ${cls}" role="cell">${value.html}</div>`;
      }
      const text = String(value ?? '');
      return `<div class="log-cell ${cls}" role="cell" title="${esc(text)}">${esc(text)}</div>`;
    }

    function render() {
      const visible = rows.filter((r) => !off.has(r.type)).reverse();
      const count = `${rows.length} ${rows.length === 1 ? 'event' : 'events'}`;
      el.querySelector('.log-count').textContent = count;
      LabStatus._count(count);
      if (!visible.length) {
        body_.innerHTML = `<div class="log-empty">${esc(rows.length ? 'No events match the current filters.' : (cfg.empty || 'Waiting for events…'))}</div>`;
        rendered = new Set();
        return;
      }
      const next = new Set();
      body_.innerHTML = visible.map((r) => {
        next.add(r.key);
        const type = String(r.type || 'none').replace(/[^a-z0-9_-]/gi, '');
        const isNew = !rendered.has(r.key) ? ' is-new' : '';
        return `<div class="log-row${isNew}" role="row"${r.title ? ` title="${esc(r.title)}"` : ''}>${
          cell(r.c1, 'log-cell--c1')
        }<div class="log-cell" role="cell"><span class="type-badge ${type}">${esc(r.label || r.type)}</span>${
          r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</div>${
          cell(r.c3, 'log-cell--c3')}${cell(r.c4, 'log-cell--c4')}</div>`;
      }).join('');
      rendered = next;
    }

    const api = {
      /** Append one row. Returns its key. */
      add(row) {
        const r = { ...row, key: row.key ?? `r${++seq}` };
        rows.push(r);
        if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
        render();
        return r.key;
      },
      /** Replace every row, in chronological order. Rows keep their animation
          state by key, so a lab that updates rows in place can call this on
          every change without replaying the row-in animation. */
      setRows(list) {
        rows = list.slice(-MAX_ROWS).map((r) => ({ ...r, key: r.key ?? `r${++seq}` }));
        render();
      },
      clear() {
        rows = [];
        render();
      },
      /** Called after the Clear button empties the table. */
      onClear(fn) { clearHandlers.push(fn); },
      /** Add a button to the log header's action slot. */
      addAction({ label, icon: name, onClick, title }) {
        const btn = h(`<button type="button" class="btn btn--sm">${name ? icon(name, 14) : ''}<span>${esc(label)}</span></button>`);
        if (title) btn.title = title;
        btn.addEventListener('click', onClick);
        el.querySelector('.log-actions').appendChild(btn);
        return btn;
      },
      setColumns,
      get count() { return rows.length; },
    };
    // Rendered once the status bar exists, below.
    api._render = render;
    return api;
  })();

  /* ============================================================
     Status bar
     ============================================================ */
  const LabStatus = (function () {
    const STATES = ['success', 'warning', 'danger', 'in-progress', 'other'];
    const items = new Map();
    status.innerHTML = `
      <span class="status-items"></span>
      <span class="status-session" hidden>session <code class="status-session-id">—</code></span>
      <span class="status-sdk" hidden></span>
      <span class="status-spacer"></span>
      <span class="status-count"></span>`;
    const box = status.querySelector('.status-items');

    function set(id, label, state = 'other') {
      let item = items.get(id);
      if (!item) {
        item = h('<span class="status-item"><span class="status-dot"></span><span class="status-label"></span></span>');
        items.set(id, item);
        box.appendChild(item);
      }
      item.querySelector('.status-dot').className = `status-dot status-dot--${STATES.includes(state) ? state : 'other'}`;
      item.querySelector('.status-label').textContent = label;
      item.title = label;
    }

    function setSession(id) {
      const wrap = status.querySelector('.status-session');
      wrap.hidden = false;
      status.querySelector('.status-session-id').textContent = id ? String(id).slice(0, 8) : '—';
    }

    function setSdk(text) {
      const el = status.querySelector('.status-sdk');
      el.hidden = !text;
      el.textContent = text || '';
    }

    return {
      set,
      setSession,
      setSdk,
      _count(text) { status.querySelector('.status-count').textContent = text; },
    };
  })();

  // Built-in probes for the two Datadog SDKs: "initialized" is reported once
  // the SDK says so (getInitConfiguration), not assumed from the page having
  // called init.
  function probeSdk(item) {
    const global = item.probe === 'logs' ? 'DD_LOGS' : 'DD_RUM';
    const name = item.probe === 'logs' ? 'Logs' : 'RUM';
    const ready = () => !!window[global]?.getInitConfiguration?.();
    LabStatus.set(item.id, `${name} loading…`, 'other');
    const started = Date.now();
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer);
        LabStatus.set(item.id, item.ready || `${name} initialized`, 'success');
      } else if (Date.now() - started > 8000) {
        clearInterval(timer);
        LabStatus.set(item.id, `${name} not initialized`, 'danger');
      }
    }, 250);
  }

  if (!IS_HOME) {
    for (const item of PAGE.status || []) {
      if (item.probe) probeSdk(item);
      else LabStatus.set(item.id, item.label, item.state);
    }
    if (PAGE.sdk) LabStatus.setSdk(PAGE.sdk);
    // RUM's session ID, kept current: Start over / stopSession and consent
    // changes all move it, and the SDK has no event for either.
    if (window.DD_RUM && PAGE.session !== false) {
      LabStatus.setSession(null);
      const poll = () => {
        try { LabStatus.setSession(window.DD_RUM.getInternalContext?.()?.session_id || null); } catch { /* not ready */ }
        // The version the CDN actually served, once the async snippet lands.
        if (!PAGE.sdk && window.DD_RUM.version) LabStatus.setSdk(`Browser SDK v${window.DD_RUM.version}`);
      };
      poll();
      setInterval(poll, 1000);
    }
    LabLog._render?.();
  }

  /* ============================================================
     Registry — rail links, header name, and the All labs page
     ============================================================ */
  const registry = fetch(REGISTRY_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`labs.json: HTTP ${r.status}`))))
    .catch((err) => {
      console.error('[lab-shared] could not load the lab registry', err);
      return [];
    });

  registry.then((labs) => {
    const list = rail.querySelector('.rail-labs');
    list.innerHTML = labs.map((lab) => `
      <a class="rail-item" href="${esc(new URL(`${lab.dir}/`, ROOT).href)}" title="${esc(lab.name)}"
         ${lab.id === LAB_ID ? 'aria-current="page"' : ''}>${icon(lab.icon, 20)}<span>${esc(lab.short)}</span></a>`).join('');
    const me = labs.find((l) => l.id === LAB_ID);
    if (me) document.getElementById('lab-name')?.replaceChildren(me.name);
    if (IS_HOME) {
      renderHome(labs);
      LabStatus._count(`${labs.length} ${labs.length === 1 ? 'lab' : 'labs'}`);
    }
  });

  function renderHome(labs) {
    const href = (lab) => esc(new URL(`${lab.dir}/`, ROOT).href);
    const tags = (lab) => lab.apis.map((a) => `<span class="tag tag--code">${esc(a)}</span>`).join('');
    const counts = (lab) => `${lab.topics} topics · ${lab.tabs.length} tabs`;
    content.innerHTML = `
      <div class="home">
        <div class="home-head">
          <div class="home-intro">
            <div class="eyebrow">Datadog RUM training</div>
            <h1>RUM Labs</h1>
            <p class="lede">Hands-on labs for Datadog Real User Monitoring. Each one runs the real SDK in your browser and shows the events it sends as they happen.</p>
          </div>
          <div class="seg" role="group" aria-label="Layout">
            <button type="button" class="seg-btn" data-view="cards" aria-pressed="false">${icon('layout-grid', 14)}<span>Cards</span></button>
            <button type="button" class="seg-btn" data-view="table" aria-pressed="false">${icon('list', 14)}<span>Table</span></button>
          </div>
        </div>
        <div class="home-cards" data-home-view="cards">
          ${labs.map((lab) => `
            <a class="lab-card" href="${href(lab)}">
              <span class="lab-card-head">
                <span class="icon-tile">${icon(lab.icon, 20)}</span>
                <span class="lab-card-titles"><span class="eyebrow">${esc(lab.category)}</span><span class="lab-card-name">${esc(lab.name)}</span></span>
              </span>
              <span class="lab-card-blurb">${esc(lab.blurb)}</span>
              <span class="tag-list">${tags(lab)}</span>
              <span class="lab-card-foot"><span>${counts(lab)}</span><span class="lab-card-open">Open lab${icon('arrow-right', 14)}</span></span>
            </a>`).join('')}
        </div>
        <div class="home-table" data-home-view="table" role="table" aria-label="All labs">
          <div class="home-row home-row--head" role="row">
            <span role="columnheader">Lab</span><span role="columnheader">What you'll learn</span>
            <span role="columnheader">Key APIs</span><span role="columnheader">Topics</span><span role="columnheader"><span class="visually-hidden">Open</span></span>
          </div>
          ${labs.map((lab) => `
            <a class="home-row" role="row" href="${href(lab)}">
              <span class="home-row-lab" role="cell">${icon(lab.icon, 20)}<span><span class="home-row-name">${esc(lab.name)}</span><span class="home-row-cat">${esc(lab.category)}</span></span></span>
              <span class="home-row-blurb" role="cell">${esc(lab.blurb)}</span>
              <span class="tag-list" role="cell">${tags(lab)}</span>
              <span class="home-row-topics" role="cell">${lab.topics} topics</span>
              <span class="home-row-chev" role="cell">${icon('chevron-right', 14)}</span>
            </a>`).join('')}
        </div>
        <div class="home-foot">Built by <a href="https://github.com/kyletaylored" target="_blank" rel="noopener">Kyle Taylor</a> · <a href="${esc(REPO_URL)}" target="_blank" rel="noopener">GitHub</a></div>
      </div>`;

    const setView = (view, { persist = true } = {}) => {
      if (persist) store.set('homeView', view);
      content.querySelectorAll('[data-home-view]').forEach((el) => { el.hidden = el.dataset.homeView !== view; });
      content.querySelectorAll('.seg-btn[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    };
    content.querySelectorAll('.seg-btn[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    setView(store.get('homeView', 'cards') === 'table' ? 'table' : 'cards', { persist: false });
  }

  /* ============================================================
     Config tab helpers — show the options the SDK actually ran with
     ============================================================ */
  function maskToken(token) {
    return token ? `${String(token).slice(0, 8)}••••••••` : '—';
  }

  /** The RUM (or Logs) init options as the SDK reports them, made printable:
      functions summarized, the client token masked. Null before init. */
  function sdkInitConfig(global = 'DD_RUM') {
    const cfg = window[global]?.getInitConfiguration?.();
    if (!cfg) return null;
    return JSON.parse(JSON.stringify(cfg, (key, value) => {
      if (key === 'clientToken') return maskToken(value);
      if (typeof value === 'function') return `ƒ ${value.name || key}()`;
      if (value instanceof RegExp) return String(value);
      return value;
    }));
  }

  /** Syntax-colored JSON for a <code> element, using DRUIDS code tokens. */
  function renderJson(el, obj) {
    if (!el) return;
    el.innerHTML = esc(JSON.stringify(obj, null, 2)).replace(
      /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (match, str, colon, lit) => {
        const cls = str ? (colon ? 'json-key' : 'json-str') : lit ? 'json-lit' : 'json-num';
        return `<span class="${cls}">${str ? str : match}</span>${colon || ''}`;
      },
    );
  }

  /* ============================================================
     Boot
     ============================================================ */
  if (!IS_HOME) {
    const saved = store.get('activeTab', null);
    showTab(panels.some((p) => p.dataset.tab === saved) ? saved : panels[0]?.dataset.tab, { persist: false });
  }
  document.body.classList.add('shell-ready');

  window.LabShell = {
    id: LAB_ID,
    icon,
    esc,
    showTab: (id) => showTab(id),
    activeTab: () => activeTab,
    /** Subscribe to tab changes. Called right away with the current tab. */
    onTab(fn) {
      tabListeners.push(fn);
      if (activeTab) fn(activeTab);
    },
    setGuideOpen: (open) => setGuideOpen(open),
    applyTheme,
    sdkInitConfig,
    maskToken,
    renderJson,
    registry,
  };
  window.LabLog = LabLog;
  window.LabStatus = LabStatus;
})();
