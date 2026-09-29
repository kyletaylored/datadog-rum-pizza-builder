/**
 * app.js — page UI for the OTel lab: theme, tabs, the pizza wizard, the
 * live event table, and the export/proxy config form. Loaded BEFORE
 * dist/bundle.js (see index.html) so window.otelLab.logEvent already
 * exists by the time the OTel pipeline starts emitting events.
 *
 * Mirrors the patterns already established by ../app.js and
 * ../consent-lab/app.js (theme toggle, tab switching, activity-log
 * rendering) so this lab reads as the same site, not a one-off page.
 */

/* ============================================================
   Theme toggle — same pattern as ../app.js
   ============================================================ */
function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.toggle('wa-dark', theme === 'dark');
  root.classList.toggle('wa-light', theme === 'light');
  localStorage.setItem('theme', theme);
}

function toggleTheme(sw) {
  applyTheme(sw.checked ? 'dark' : 'light');
}

(function () {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const sync = () => { toggle.checked = document.documentElement.dataset.theme === 'dark'; };
  sync();
  if (toggle.localName.startsWith('wa-')) {
    customElements.whenDefined(toggle.localName).then(() => toggle.updateComplete).then(sync);
  }
})();

/* ============================================================
   Tabs — Wizard / Config
   ============================================================ */
function switchTab(tab) {
  const panels = { wizard: 'tab-wizard', config: 'tab-config' };
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.getAttribute('aria-controls') === panels[tab];
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  Object.values(panels).forEach((id) => { document.getElementById(id).style.display = 'none'; });
  document.getElementById(panels[tab]).style.display = '';
}

/* ============================================================
   Wizard — same shape as ../app.js's goTo/select/stepMeta
   ============================================================ */
const stepMeta = [
  null,
  { hash: 'crust', label: 'Crust' },
  { hash: 'sauce', label: 'Sauce' },
  { hash: 'cheese', label: 'Cheese' },
  { hash: 'toppings', label: 'Toppings' },
  { hash: 'size', label: 'Size' },
];
const TOTAL_STEPS = stepMeta.length - 1;
const selections = {};

const OPTIONS = {
  1: [['🥨', 'Thin & Crispy', 'Light and snappy'], ['🫓', 'Hand-Tossed', 'Classic and chewy'], ['🍞', 'Deep Dish', 'Thick and doughy'], ['🌾', 'Gluten-Free', 'Light rice crust']],
  2: [['🍅', 'Classic Tomato', 'Rich marinara'], ['🧄', 'White Garlic', 'Creamy alfredo'], ['🔥', 'BBQ', 'Smoky and sweet'], ['🌿', 'Pesto', 'Fresh basil blend']],
  3: [['🧀', 'Mozzarella', 'The OG melt'], ['🫕', 'Four Cheese', 'Mozz, provolone, parmesan, romano'], ['🌱', 'Vegan', 'Cashew-based'], ['🚫', 'No Cheese', 'Sauce only']],
  4: [['🍖', 'Pepperoni', 'A classic'], ['🍄', 'Mushrooms', 'Earthy and savory'], ['🫑', 'Bell Peppers', 'Crisp and sweet'], ['🌶️', 'Jalapeños', 'Bring the heat']],
  5: [['🤏', 'Personal (6 in)', '4 slices'], ['✋', 'Medium (12 in)', '8 slices'], ['🙌', 'Large (16 in)', '10 slices'], ['🎉', 'XL Party (20 in)', '12 slices']],
};

for (const [step, opts] of Object.entries(OPTIONS)) {
  const wrap = document.getElementById(`opts-${step}`);
  for (const [emoji, label, desc] of opts) {
    const card = document.createElement('div');
    card.className = 'option-card';
    card.innerHTML = `<span class="emoji">${emoji}</span><div class="label">${label}</div><div class="desc">${desc}</div>`;
    card.onclick = () => select(Number(step), card, label);
    wrap.appendChild(card);
  }
}

function goTo(step) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const wrap = document.getElementById('progress-wrap');
  if (step === 0) {
    document.getElementById('screen-start').classList.add('active');
    wrap.style.display = 'none';
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } else if (step === 'results') {
    document.getElementById('screen-results').classList.add('active');
    wrap.style.display = 'none';
    location.hash = 'results';
    renderResults();
  } else {
    document.getElementById(`screen-${step}`).classList.add('active');
    wrap.style.display = 'block';
    document.getElementById('progress-bar').value = (step / TOTAL_STEPS) * 100;
    document.getElementById('step-label').textContent = `Step ${step} of ${TOTAL_STEPS}`;
    document.getElementById('step-name').textContent = stepMeta[step].label;
    location.hash = stepMeta[step].hash;
  }
}

function select(step, el, value) {
  document.querySelectorAll(`#opts-${step} .option-card`).forEach((c) => c.classList.remove('selected'));
  el.classList.add('selected');
  selections[step] = { label: stepMeta[step].label, value };
  document.getElementById(`btn-${step}`).disabled = false;
}

function renderResults() {
  const list = document.getElementById('result-list');
  list.innerHTML = Object.values(selections)
    .map((s) => `<li><span class="step-label">${s.label}</span><span class="step-value">${s.value}</span></li>`)
    .join('');
  const pizzaOrder = Object.fromEntries(Object.values(selections).map((s) => [s.label.toLowerCase(), s.value]));
  window.otelLab?.submitOrder?.(pizzaOrder);
}

function restart() {
  window.otelLab?.restart?.();
  Object.keys(selections).forEach((k) => delete selections[k]);
  document.querySelectorAll('.option-card.selected').forEach((c) => c.classList.remove('selected'));
  for (let i = 1; i <= TOTAL_STEPS; i++) document.getElementById(`btn-${i}`).disabled = true;
  goTo(0);
}

function fakeBackendCall() {
  // ResourceTimingInstrumentation observes this passively via the Resource
  // Timing API and logs it — no fetch wrapping needed. Real trace
  // correlation isn't wired up in this lab; see README.md.
  fetch('https://httpbin.org/get').catch(() => {});
}

/* ============================================================
   Live event table — same shape as ../app.js's logRumEvent/rerenderTable,
   adapted from RUM events to OTel LogRecords.
   ============================================================ */
const BUCKET_BY_EVENT = {
  'browser.navigation': 'view',
  'browser.user_action.click': 'action',
  'browser.resource_timing': 'resource',
  'browser.web_vital': 'vital',
  exception: 'error',
  'browser.console': 'error',
};

function bucketFor(eventName) {
  return BUCKET_BY_EVENT[eventName] || 'custom';
}

// ResourceTimingInstrumentation fires for every asset the page loads —
// Web Awesome's autoloader alone pulls ~55 chunks — which buries the
// handful of events this lab is actually about. Same fix ../app.js uses
// for its own resource events: only surface real network calls (the
// "Fake backend call" button), not static asset loads. Still sent to
// Datadog if export is on; this only governs the on-page table.
function isLoggableResourceTiming(attrs) {
  const initiator = attrs['browser.resource_timing.initiator_type'];
  return initiator === 'fetch' || initiator === 'xmlhttprequest';
}

function getColValues(eventName, attrs) {
  switch (eventName) {
    case 'browser.navigation': {
      try {
        const u = new URL(attrs['url.full']);
        return [u.pathname, u.hash || '—'];
      } catch {
        return [attrs['url.full'] || '—', '—'];
      }
    }
    case 'browser.user_action.click':
      return [attrs['browser.css_selector'] || '—', attrs['browser.tag_name'] || '—'];
    case 'browser.resource_timing': {
      let path = attrs['url.full'] || '—';
      try { path = new URL(path).pathname; } catch { /* keep raw value */ }
      const dur = attrs['browser.resource_timing.duration'];
      return [path, dur != null ? `${Math.round(dur)}ms` : '—'];
    }
    case 'browser.web_vital':
      return [attrs['browser.web_vital.name'] || '—', `${Math.round(attrs['browser.web_vital.value'] ?? 0)} (${attrs['browser.web_vital.rating'] || '—'})`];
    case 'exception':
      return [attrs['exception.message'] || '—', attrs['exception.type'] || '—'];
    case 'browser.console':
      return [String(attrs.body ?? '—'), attrs['browser.console.method'] || '—'];
    case 'session.start':
    case 'session.end':
      return [eventName, (attrs['session.id'] || '').slice(0, 8)];
    case 'pizza_order_submitted': {
      const parts = Object.entries(attrs).filter(([k]) => k.startsWith('pizza_order.')).map(([, v]) => v);
      return ['pizza_order_submitted', parts.join(' / ') || '—'];
    }
    default:
      return [eventName, '—'];
  }
}

const activeFilters = new Set(['view', 'action', 'resource', 'vital', 'error', 'custom']);
const logEvents = [];

function toggleFilter(type) {
  if (activeFilters.has(type)) activeFilters.delete(type);
  else activeFilters.add(type);
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', activeFilters.has(b.dataset.filter));
  });
  rerenderTable();
}

function rerenderTable() {
  const tbody = document.getElementById('rum-tbody');
  const visible = logEvents.filter((e) => activeFilters.has(e.bucket));
  if (visible.length === 0) {
    tbody.innerHTML = '<tr id="rum-empty-row"><td colspan="4">No events match current filters.</td></tr>';
    return;
  }
  tbody.innerHTML = visible.map((e) => {
    const [a, b] = e.cols;
    const aEsc = String(a).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bEsc = String(b).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<tr>
      <td>${e.time}</td>
      <td><span class="type-badge ${e.bucket}">${e.bucket}</span></td>
      <td class="wrap" title="${aEsc}">${aEsc}</td>
      <td class="wrap" title="${bEsc}">${bEsc}</td>
    </tr>`;
  }).join('');
}

window.otelLab = window.otelLab ?? {};
window.otelLab.logEvent = function logEvent(logRecord) {
  const eventName = logRecord.eventName || 'log';
  const attrs = logRecord.attributes || {};
  if (eventName === 'browser.resource_timing' && !isLoggableResourceTiming(attrs)) return;

  const emptyRow = document.getElementById('rum-empty-row');
  if (emptyRow) emptyRow.remove();

  const bucket = bucketFor(eventName);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logEvents.push({ bucket, time, cols: getColValues(eventName, attrs) });
  rerenderTable();

  const wrap = document.getElementById('rum-table-wrap');
  wrap.scrollTop = wrap.scrollHeight;
};

function clearLog() {
  logEvents.length = 0;
  document.getElementById('rum-tbody').innerHTML = '<tr id="rum-empty-row"><td colspan="4">Waiting for events…</td></tr>';
}

/* ============================================================
   Export config — two mutually exclusive paths:
     A) your own local proxy — ?proxy= in the URL, no secret involved.
     B) corsproxy.io — a third-party relay that adds the CORS headers
        Datadog's OTLP intake doesn't send. Both your corsproxy.io key and
        your Datadog key are real secrets, held only in sessionStorage for
        this tab (never the URL, never localStorage). See main.js for how
        each gets read back out on load.
   A "straight from the browser, no relay at all" mode used to live here;
   removed because Datadog's OTLP intake has no CORS support at all, so
   there was nothing a browser alone could ever do about it — confirmed
   empirically (every attempt failed with a CORS preflight error and
   retried forever in the background with zero visible feedback). This
   one-time cleanup clears any leftover credentials that mode may have
   saved into sessionStorage.
   ============================================================ */
sessionStorage.removeItem('otelLabDirectEndpoint');
sessionStorage.removeItem('otelLabDirectApiKey');

const CORSPROXY_ENDPOINT_KEY = 'otelLabCorsProxyEndpoint';
const CORSPROXY_KEY_KEY = 'otelLabCorsProxyKey';
const CORSPROXY_DD_KEY_KEY = 'otelLabCorsProxyDdKey';

function currentExportParams() {
  const params = new URLSearchParams(location.search);
  return { proxy: params.get('proxy') || '', consoleOff: params.get('console') === '0' };
}

function renderExportStatus() {
  const { proxy, consoleOff } = currentExportParams();
  const corsProxyEndpoint = sessionStorage.getItem(CORSPROXY_ENDPOINT_KEY);
  const pill = document.getElementById('export-status-pill');
  const input = document.getElementById('proxy-url-input');
  const consoleToggle = document.getElementById('console-toggle');
  const corsProxySelect = document.getElementById('corsproxy-endpoint-input');

  if (corsProxyEndpoint) {
    pill.textContent = `via corsproxy.io → ${corsProxyEndpoint}`;
    pill.className = 'consent-state-pill warning';
  } else if (proxy) {
    pill.textContent = `via your proxy → ${proxy}`;
    pill.className = 'consent-state-pill granted';
  } else {
    pill.textContent = 'static mode — nothing leaves the browser';
    pill.className = 'consent-state-pill pending';
  }
  input.value = proxy;
  consoleToggle.checked = !consoleOff;
  // Restore the (non-secret) endpoint selection; never echo the keys back
  // into the password fields.
  if (corsProxySelect && corsProxyEndpoint) corsProxySelect.value = corsProxyEndpoint;

  // Restore the Config tab after the reload these buttons trigger, so the
  // status change above is the first thing visible instead of the wizard.
  if (new URLSearchParams(location.search).get('tab') === 'config') {
    switchTab('config');
  }
}

function applyExportSettings(event) {
  event.preventDefault();
  const url = document.getElementById('proxy-url-input').value.trim();
  const consoleChecked = document.getElementById('console-toggle').checked;
  // Local proxy and corsproxy.io are mutually exclusive.
  sessionStorage.removeItem(CORSPROXY_ENDPOINT_KEY);
  sessionStorage.removeItem(CORSPROXY_KEY_KEY);
  sessionStorage.removeItem(CORSPROXY_DD_KEY_KEY);
  const params = new URLSearchParams();
  if (url) params.set('proxy', url);
  if (!consoleChecked) params.set('console', '0');
  params.set('tab', 'config');
  location.search = params.toString();
}

function disconnectExport() {
  document.getElementById('proxy-url-input').value = '';
  applyExportSettings({ preventDefault() {} });
}

function applyCorsProxySettings(event) {
  event.preventDefault();
  const endpoint = document.getElementById('corsproxy-endpoint-input').value.trim();
  const corsProxyKey = document.getElementById('corsproxy-key-input').value.trim();
  const ddKey = document.getElementById('corsproxy-dd-key-input').value.trim();
  if (!endpoint || !corsProxyKey || !ddKey) return;
  sessionStorage.setItem(CORSPROXY_ENDPOINT_KEY, endpoint);
  sessionStorage.setItem(CORSPROXY_KEY_KEY, corsProxyKey);
  sessionStorage.setItem(CORSPROXY_DD_KEY_KEY, ddKey);
  // Mutually exclusive with the local proxy — drop ?proxy= on reload.
  const params = new URLSearchParams(location.search);
  params.delete('proxy');
  params.set('tab', 'config');
  location.search = params.toString();
}

function clearCorsProxySettings() {
  sessionStorage.removeItem(CORSPROXY_ENDPOINT_KEY);
  sessionStorage.removeItem(CORSPROXY_KEY_KEY);
  sessionStorage.removeItem(CORSPROXY_DD_KEY_KEY);
  document.getElementById('corsproxy-key-input').value = '';
  document.getElementById('corsproxy-dd-key-input').value = '';
  const params = new URLSearchParams(location.search);
  params.set('tab', 'config');
  location.search = params.toString();
}

document.addEventListener('DOMContentLoaded', renderExportStatus);
