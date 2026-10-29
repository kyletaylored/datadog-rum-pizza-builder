/**
 * app.js — page UI for the OTel lab: the pizza wizard, the live event feed,
 * and the export/proxy config form. Loaded BEFORE dist/bundle.js (see
 * index.html) so window.otelLab.logEvent already exists by the time the OTel
 * pipeline starts emitting events. The shell (tabs, guide, docked log,
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
  // ResourceTimingInstrumentation observes this passively via the Resource
  // Timing API and logs it — no fetch wrapping needed. Real trace
  // correlation isn't wired up in this lab; see README.md.
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

/* ============================================================
   Export config — your own local proxy only. Two other modes used to
   live here:
     - "straight from the browser, no relay at all" — removed because
       Datadog's OTLP intake has no CORS support at all, confirmed
       empirically (every attempt failed with a CORS preflight error and
       retried forever in the background with zero visible feedback).
     - corsproxy.io, a third-party relay — worked correctly (verified
       request shape matched their docs), but their `reqHeaders` param
       (needed to forward dd-api-key) is gated to a paid plan, confirmed
       by their own 403 response body. Removed in favor of just running
       the proxy, which needs no third party or billing plan at all.
   This one-time cleanup clears any leftover credentials either mode may
   have saved into sessionStorage.
   ============================================================ */
sessionStorage.removeItem('otelLabDirectEndpoint');
sessionStorage.removeItem('otelLabDirectApiKey');
sessionStorage.removeItem('otelLabCorsProxyEndpoint');
sessionStorage.removeItem('otelLabCorsProxyKey');
sessionStorage.removeItem('otelLabCorsProxyDdKey');

function currentExportParams() {
  const params = new URLSearchParams(location.search);
  return { proxy: params.get('proxy') || '', consoleOff: params.get('console') === '0' };
}

function renderExportStatus() {
  const { proxy, consoleOff } = currentExportParams();
  const pill = document.getElementById('export-status-pill');
  const input = document.getElementById('proxy-url-input');
  const consoleToggle = document.getElementById('console-toggle');

  if (proxy) {
    pill.textContent = `via your proxy → ${proxy}`;
    pill.className = 'pill pill--success';
  } else {
    pill.textContent = 'static mode — nothing leaves the browser';
    pill.className = 'pill';
  }
  LabStatus.set('export', `Export to Datadog: ${proxy ? 'on' : 'off'}`, proxy ? 'success' : 'other');
  input.value = proxy;
  consoleToggle.checked = !consoleOff;

  // Restore the Config tab after the reload these buttons trigger, so the
  // status change above is the first thing visible instead of the wizard.
  if (new URLSearchParams(location.search).get('tab') === 'config') {
    LabShell.showTab('config');
  }
}

// The pipeline as src/main.js built it (window.otelLab.config), not a
// restatement of what it's supposed to be.
function renderConfig() {
  const cfg = window.otelLab?.config;
  LabShell.renderJson(document.getElementById('config-json'), cfg
    ? { applicationId: cfg.applicationId, processors: cfg.processors, otlpEndpoint: cfg.otlpEndpoint, instrumentations: cfg.instrumentations }
    : { status: 'the OTel bundle did not load' });
  LabShell.renderJson(document.getElementById('config-resource-json'), cfg ? cfg.resource : {});
}

function applyExportSettings(event) {
  event.preventDefault();
  const url = document.getElementById('proxy-url-input').value.trim();
  const consoleChecked = document.getElementById('console-toggle').checked;
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

// The bundle has run by DOMContentLoaded (it's a classic script after this
// one), so whether the pipeline exists is known by then.
document.addEventListener('DOMContentLoaded', function () {
  const ready = !!window.otelLab?.submitOrder;
  LabStatus.set('otel', ready ? 'OTel SDK ready' : 'OTel SDK not loaded', ready ? 'success' : 'danger');
  renderExportStatus();
  renderConfig();
});
