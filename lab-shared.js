/**
 * lab-shared.js — resizable sidebar behavior shared by the pizza builder
 * and every "lab" sub-page. Pair with lab-shared.css for the matching
 * styles. Requires markup:
 *
 *   <div class="training-layout">
 *     <aside class="training-sidebar">
 *       ...
 *       <div class="sidebar-resizer" id="sidebar-resizer" title="Drag to resize"></div>
 *     </aside>
 *     <div class="training-main">...</div>
 *   </div>
 *
 * Width is applied as an inline style on .training-layout, which overrides
 * style.css's fixed "400px 1fr" grid-template-columns without needing to
 * edit that file. The chosen width is shared (one localStorage key) across
 * every page that includes this script, so it stays consistent as you move
 * between the pizza builder and any lab.
 */
(function () {
  const layout = document.querySelector('.training-layout');
  const sidebar = document.querySelector('.training-sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  if (!layout || !sidebar || !resizer) return;

  const MIN_WIDTH = 280;
  const MAX_WIDTH = 640;
  const STORAGE_KEY = 'ddLab.sidebarWidth';

  function applyWidth(px) {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));
    layout.style.gridTemplateColumns = clamped + 'px 1fr';
    return clamped;
  }

  const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  if (saved) applyWidth(saved);

  let dragging = false;

  function onMove(clientX) {
    const rect = sidebar.getBoundingClientRect();
    const width = applyWidth(clientX - rect.left);
    localStorage.setItem(STORAGE_KEY, width);
  }

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => { if (dragging) onMove(e.clientX); });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
  });

  resizer.addEventListener('touchstart', () => { dragging = true; resizer.classList.add('dragging'); }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) onMove(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', () => { dragging = false; resizer.classList.remove('dragging'); });
})();

/**
 * Collapse/expand the docked activity log.
 *
 * The log is pinned to the bottom of the scrolling column so it can't be
 * buried by tall tab content, but that means it overlays whatever is passing
 * underneath while you scroll. This hands that trade-off to the reader: the
 * header strip stays put so the log is never lost, and the table folds away
 * when the content matters more. The choice is shared across pages.
 */
(function () {
  const wrap = document.getElementById('rum-log-wrap');
  const btn = document.getElementById('log-collapse-btn');
  if (!wrap || !btn) return;

  const STORAGE_KEY = 'ddLab.logCollapsed';

  function apply(collapsed) {
    wrap.classList.toggle('collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.innerHTML = collapsed ? '&#9652;' : '&#9662;';
    btn.title = collapsed ? 'Show activity log' : 'Hide activity log';
  }

  apply(localStorage.getItem(STORAGE_KEY) === '1');

  btn.addEventListener('click', function () {
    const collapsed = !wrap.classList.contains('collapsed');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    apply(collapsed);
  });
})();
