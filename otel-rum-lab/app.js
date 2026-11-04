/**
 * app.js — page UI for the OTel lab: the pizza wizard, the live event feed,
 * and the export/proxy config form. Loaded BEFORE dist/bundle.js (see
 * index.html) so window.otelLab.logEvent / logSpan already exist by the time
 * the OTel pipeline starts emitting events. The shell (tabs, guide, docked log,
 * status bar) is ../lab-shared.js.
 *
 * Mirrors ../pizza-builder-lab/app.js's wizard so this lab reads as the
 * same site, not a one-off page.
 */

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
  1: [['Thin & Crispy', 'Light and snappy'], ['Hand-Tossed', 'Classic and chewy'], ['Deep Dish', 'Thick and doughy'], ['Gluten-Free', 'Light rice crust']],
  2: [['Classic Tomato', 'Rich marinara'], ['White Garlic', 'Creamy alfredo'], ['BBQ', 'Smoky and sweet'], ['Pesto', 'Fresh basil blend']],
  3: [['Mozzarella', 'The OG melt'], ['Four Cheese', 'Mozz, provolone, parmesan, romano'], ['Vegan', 'Cashew-based'], ['No Cheese', 'Sauce only']],
  4: [['Pepperoni', 'A classic'], ['Mushrooms', 'Earthy and savory'], ['Bell Peppers', 'Crisp and sweet'], ['Jalapeños', 'Bring the heat']],
  5: [['Personal (6 in)', '6" · 4 slices'], ['Medium (12 in)', '12" · 8 slices'], ['Large (16 in)', '16" · 10 slices'], ['XL Party (20 in)', '20" · 12 slices']],
};

// Radio cards, same markup as the pizza builder's static ones.
for (const [step, opts] of Object.entries(OPTIONS)) {
  const wrap = document.getElementById(`opts-${step}`);
  for (const [label, desc] of opts) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'option-card';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', 'false');
    card.innerHTML = `<span class="radio"></span><span class="option-text"><span class="label">${LabShell.esc(label)}</span><span class="desc">${LabShell.esc(desc)}</span></span>`;
    card.onclick = () => select(Number(step), card, label);
    wrap.appendChild(card);
  }
}

function renderTracker(step) {
  document.querySelectorAll('#progress-wrap .tracker-step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-done', n < step);
    el.classList.toggle('is-current', n === step);
  });
}

function goTo(step) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const wrap = document.getElementById('progress-wrap');
  if (step === 0) {
    document.getElementById('screen-start').classList.add('active');
    wrap.hidden = true;
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } else if (step === 'results') {
    document.getElementById('screen-results').classList.add('active');
    wrap.hidden = true;
    location.hash = 'results';
    renderResults();
  } else {
    document.getElementById(`screen-${step}`).classList.add('active');
    wrap.hidden = false;
    renderTracker(step);
    location.hash = stepMeta[step].hash;
  }
}

function select(step, el, value) {
  document.querySelectorAll(`#opts-${step} .option-card`).forEach((c) => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  el.classList.add('selected');
  el.setAttribute('aria-checked', 'true');
  selections[step] = { label: stepMeta[step].label, value };
  document.getElementById(`btn-${step}`).disabled = false;
}

function renderResults() {
  const list = document.getElementById('result-list');
  list.innerHTML = Object.values(selections)
    .map((s) => `<li><span class="step-label">${s.label}</span><span class="step-value">${LabShell.esc(s.value)}</span></li>`)
    .join('');
  const pizzaOrder = Object.fromEntries(Object.values(selections).map((s) => [s.label.toLowerCase(), s.value]));
  // The attribute names submitOrder() stamps on the record (src/main.js).
  document.getElementById('order-payload').textContent = `logger.emit(${JSON.stringify({
    eventName: 'pizza_order_submitted',
    attributes: Object.fromEntries(Object.entries(pizzaOrder).map(([k, v]) => [`pizza_order.${k}`, v])),
  }, null, 2)})`;
  window.otelLab?.submitOrder?.(pizzaOrder);
}

function restart() {
  window.otelLab?.restart?.();
  Object.keys(selections).forEach((k) => delete selections[k]);
  document.querySelectorAll('.option-card.selected').forEach((c) => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  for (let i = 1; i <= TOTAL_STEPS; i++) document.getElementById(`btn-${i}`).disabled = true;
  goTo(0);
}

function fakeBackendCall() {
  // Shows up twice: FetchInstrumentation wraps it in a client span (and adds
  // a traceparent header, which httpbin echoes back), and
  // ResourceTimingInstrumentation logs its timing entry.
  fetch('https://httpbin.org/get').catch(() => {});
}

/* ============================================================
   Live event feed — same shape as the pizza builder's logRumEvent, adapted
   from RUM events to OTel LogRecords and fed to the shared docked log.
   ============================================================ */
const BUCKET_BY_EVENT = {
  'browser.navigation': 'navigation',
  'browser.user_action.click': 'user_action',
  'browser.resource_timing': 'resource',
  'browser.web_vital': 'vital',
  'browser.navigation_timing': 'vital',
  exception: 'error',
  'browser.console': 'error',
};

function bucketFor(eventName) {
  return BUCKET_BY_EVENT[eventName] || 'custom';
}

// ResourceTimingInstrumentation is already limited to fetch/xhr in
// src/main.js; this is the same guard on the table side, so only real
// network calls (the "Fake backend call" button) get a row, never static
// asset loads. Same rule the pizza builder uses for its resource events.
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
    case 'browser.navigation_timing': {
      let path = attrs['url.full'] || '—';
      try { path = new URL(path).pathname; } catch { /* keep raw value */ }
      const dur = attrs['browser.resource_timing.duration'];
      return [`page load ${path}`, `${dur != null ? `${Math.round(dur)}ms` : '—'} (${attrs['browser.navigation_timing.type'] || '—'})`];
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

window.otelLab = window.otelLab ?? {};
window.otelLab.logEvent = function logEvent(logRecord) {
  const eventName = logRecord.eventName || 'log';
  const attrs = logRecord.attributes || {};
  if (eventName === 'browser.resource_timing' && !isLoggableResourceTiming(attrs)) return;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [a, b] = getColValues(eventName, attrs);
  LabLog.add({ c1: time, type: bucketFor(eventName), c3: a, c4: b, title: eventName });
};

// Finished spans from the fetch/XHR instrumentations (LiveTableSpanProcessor
// in src/main.js). Same "resource" filter as their resource-timing rows,
// badged "span" so the two are told apart.
window.otelLab.logSpan = function logSpan(span) {
  const attrs = span.attributes || {};
  let path = attrs['url.full'] || span.name;
  try { path = new URL(path).pathname; } catch { /* keep raw value */ }
  const [s, ns] = span.duration || [0, 0];
  const ms = Math.round(s * 1e3 + ns / 1e6);
  const status = attrs['http.response.status_code'] ?? attrs['error.type'] ?? '—';
  const traceId = span.spanContext().traceId.slice(0, 8);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  LabLog.add({
    c1: time, type: 'resource', label: 'span',
    c3: `${attrs['http.request.method'] || ''} ${path}`.trim(),
    c4: `${status} · ${ms}ms · trace ${traceId}…`,
    title: span.name,
  });
};

/* ============================================================
   Export config. Every setting lives in the URL (see resolveExport() in
   src/main.js), so Apply reloads the page and the bundle starts once with
   the new pipeline. Two modes were tried and removed earlier: relaying
   through corsproxy.io (forwarding dd-api-key needs their paid plan) and a
   pasted API key kept in sessionStorage. This clears anything either left.
   ============================================================ */
sessionStorage.removeItem('otelLabDirectEndpoint');
sessionStorage.removeItem('otelLabDirectApiKey');
sessionStorage.removeItem('otelLabCorsProxyEndpoint');
sessionStorage.removeItem('otelLabCorsProxyKey');
sessionStorage.removeItem('otelLabCorsProxyDdKey');

const EXPORT_LABELS = { off: 'off', direct: 'direct', proxy: 'via proxy' };
let exportMode = 'off';

function setExportMode(mode) {
  exportMode = mode;
  document.querySelectorAll('#export-form .seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.getElementById('proxy-field').hidden = mode !== 'proxy';
  document.querySelectorAll('#export-form .export-endpoint').forEach((f) => { f.hidden = mode === 'off'; });
  const site = window.otelLab?.config?.site || 'datadoghq.com';
  const proxy = document.getElementById('proxy-url-input').value.trim().replace(/\/+$/, '') || 'http://localhost:8791';
  document.getElementById('traces-url-input').placeholder = mode === 'proxy' ? `${proxy}/v1/traces` : `https://otlp.${site}/v1/traces`;
  document.getElementById('logs-url-input').placeholder = mode === 'proxy' ? `${proxy}/v1/logs` : `https://otlp.${site}/api/v2/otlplogs`;
}

function renderExportStatus() {
  const params = new URLSearchParams(location.search);
  const cfg = window.otelLab?.config;
  const mode = cfg?.export || 'off';
  const pill = document.getElementById('export-status-pill');

  document.getElementById('proxy-url-input').value = params.get('proxy') || '';
  document.getElementById('traces-url-input').value = params.get('traces') || '';
  document.getElementById('logs-url-input').value = params.get('logs') || '';
  document.getElementById('console-toggle').checked = params.get('console') !== '0';
  setExportMode(mode);

  if (cfg?.invalidConfig) {
    pill.textContent = 'invalid endpoint URL — the SDK did not start';
    pill.className = 'pill pill--danger';
  } else if (mode === 'off') {
    pill.textContent = 'static mode — nothing leaves the browser';
    pill.className = 'pill';
  } else {
    pill.textContent = `${EXPORT_LABELS[mode]} → traces and logs`;
    pill.className = 'pill pill--success';
  }
  LabStatus.set('export', `Export to Datadog: ${EXPORT_LABELS[mode]}`, mode === 'off' ? 'other' : 'success');

  // Restore the Config tab after the reload Apply triggers, so the status
  // change above is the first thing visible instead of the wizard.
  if (params.get('tab') === 'config') LabShell.showTab('config');
}

// The pipeline as src/main.js built it (window.otelLab.config), not a
// restatement of what it's supposed to be.
function renderConfig() {
  const cfg = window.otelLab?.config;
  LabShell.renderJson(document.getElementById('config-json'), cfg
    ? { export: cfg.export, endpoints: cfg.endpoints, processors: cfg.processors, instrumentations: cfg.instrumentations }
    : { status: 'the OTel bundle did not load' });
  LabShell.renderJson(document.getElementById('config-resource-json'), cfg ? cfg.resource : {});
}

function applyExportSettings(event) {
  event.preventDefault();
  const params = new URLSearchParams();
  const value = (id) => document.getElementById(id).value.trim();
  // ?site= has no field; keep it if it was set by hand.
  const site = new URLSearchParams(location.search).get('site');
  if (site) params.set('site', site);
  if (exportMode !== 'off') {
    params.set('export', exportMode);
    if (exportMode === 'proxy' && value('proxy-url-input')) params.set('proxy', value('proxy-url-input'));
    if (value('traces-url-input')) params.set('traces', value('traces-url-input'));
    if (value('logs-url-input')) params.set('logs', value('logs-url-input'));
  }
  if (!document.getElementById('console-toggle').checked) params.set('console', '0');
  params.set('tab', 'config');
  location.search = params.toString();
}

// The bundle has run by DOMContentLoaded (it's a classic script after this
// one), so whether the pipeline exists is known by then.
document.addEventListener('DOMContentLoaded', function () {
  const cfg = window.otelLab?.config;
  const ready = !!cfg && !cfg.invalidConfig;
  LabStatus.set('otel', ready ? 'OTel SDK ready' : cfg ? 'OTel SDK: invalid config' : 'OTel SDK not loaded', ready ? 'success' : 'danger');
  renderExportStatus();
  renderConfig();
});
