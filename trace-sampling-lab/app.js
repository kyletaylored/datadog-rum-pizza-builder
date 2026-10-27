/**
 * app.js — page UI for the Trace Sampling lab: theme, tabs, RUM init, the
 * request runner, the live network table, and the per-session tallies.
 * Loaded BEFORE dist/bundle.js (see index.html), which only renders the
 * ReactFlow diagram on the Flow tab and reads window.traceLab from here.
 *
 * The RUM config under test comes from the query string (?tsr=&tci=) rather
 * than a live toggle: traceSampleRate and traceContextInjection are init-time
 * options, so changing either means reloading the page. The simulated
 * backend's rate (?apm=) is read per request, so that one changes live.
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
   Tabs — Requests / Flow. The flow diagram mounts on first show: ReactFlow
   measures its container to fit the view, and a display:none panel is 0×0.
   ============================================================ */
function switchTab(tab) {
  const panels = { requests: 'tab-requests', flow: 'tab-flow' };
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const isActive = btn.getAttribute('aria-controls') === panels[tab];
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  Object.values(panels).forEach((id) => { document.getElementById(id).style.display = 'none'; });
  document.getElementById(panels[tab]).style.display = '';
  if (tab === 'flow') window.traceLab.mountFlow?.(document.getElementById('flow-root'));
}

/* ============================================================
   Config under test
   ============================================================ */
const PRESETS = {
  'forced-keep':      { tsr: 100, tci: 'all',     label: 'Forced keep' },
  'controlled-drop':  { tsr: 0,   tci: 'all',     label: 'Controlled drop' },
  'backend-decision': { tsr: 20,  tci: 'sampled', label: 'Backend decision' },
};
const DEFAULTS = PRESETS['backend-decision'];

function clampRate(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== '' ? Math.min(100, Math.max(0, n)) : fallback;
}

const params = new URLSearchParams(location.search);
const liveConfig = {
  traceSampleRate: clampRate(params.get('tsr'), DEFAULTS.tsr),
  traceContextInjection: params.get('tci') === 'all' ? 'all' : DEFAULTS.tci,
  apmRate: clampRate(params.get('apm'), 50),
};

const API_BASE = new URL('api/', location.origin + location.pathname).href;

function applyRumConfig(tsr, tci) {
  const next = new URLSearchParams(location.search);
  next.set('tsr', String(tsr));
  next.set('tci', tci);
  location.search = next.toString();
}

function applyPreset(id) {
  const p = PRESETS[id];
  applyRumConfig(p.tsr, p.tci);
}

function applyCustomConfig(event) {
  event.preventDefault();
  applyRumConfig(clampRate(document.getElementById('tsr-input').value, DEFAULTS.tsr), document.getElementById('tci-select').value);
}

function setApmRate(value) {
  liveConfig.apmRate = clampRate(value, liveConfig.apmRate);
  document.getElementById('apm-rate-value').textContent = `${liveConfig.apmRate}%`;
  // Kept in the URL (without a reload) so a shared link reproduces the run.
  const next = new URLSearchParams(location.search);
  next.set('apm', String(liveConfig.apmRate));
  history.replaceState(null, '', `${location.pathname}?${next}${location.hash}`);
  renderConfigJson();
}

/* ============================================================
   RUM SDK
   ============================================================ */
window.DD_RUM && window.DD_RUM.onReady(function () {
  const cfg = window.DD_CONFIG || {};
  window.DD_RUM.init({
    applicationId: cfg.applicationId,
    clientToken: cfg.clientToken,
    site: cfg.site,
    service: cfg.service,
    version: cfg.version,
    env: cfg.env,
    // Every session tracked, so every request is eligible for tracing — an
    // untracked session never gets headers at all (see the Flow tab).
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    allowedTracingUrls: [
      { match: (url) => url.startsWith(API_BASE), propagatorTypes: ['datadog', 'tracecontext'] },
    ],
    traceSampleRate: liveConfig.traceSampleRate,
    traceContextInjection: liveConfig.traceContextInjection,
    beforeSend: function (event) {
      // Only this lab's API calls matter here; static assets (the Web Awesome
      // autoloader alone pulls ~55 chunks) and everything else still go to
      // Datadog untouched.
      if (event.type === 'resource' && (event.resource?.url || '').startsWith(API_BASE)) {
        recordRumResource(event);
      }
      return true;
    },
  });
  renderRumStatus();
});

function rumSessionId() {
  return window.DD_RUM?.getInternalContext?.()?.session_id || null;
}

function renderRumStatus() {
  const pill = document.getElementById('rum-status-pill');
  const callout = document.getElementById('rum-missing-callout');
  const ready = !!window.DD_RUM?.getInitConfiguration?.();
  pill.textContent = ready ? 'RUM initialized' : 'RUM not initialized';
  pill.className = `consent-state-pill ${ready ? 'granted' : 'not-granted'}`;
  callout.style.display = ready ? 'none' : '';
  document.getElementById('session-id').textContent = rumSessionId()?.slice(0, 8) || '—';
}

function newRumSession() {
  // The next user interaction (any click, including "Send") starts a new
  // session — and with it a new, independent trace sampling decision.
  window.DD_RUM?.stopSession?.();
  document.getElementById('session-id').textContent = 'ends — next click starts a new one';
}

/* ============================================================
   Simulated backend — sw.js. Requests wait until the worker controls the
   page, otherwise the first ones would 404 against the static host.
   ============================================================ */
const backendReady = (async function () {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable (they need https or localhost).');
  const version = window.DD_CONFIG?.version || 'dev';
  await navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(version)}`);
  if (navigator.serviceWorker.controller) return;
  const claimed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  (await navigator.serviceWorker.ready).active.postMessage('claim');
  await claimed;
})();

backendReady.then(
  () => setBackendStatus('ready', 'granted'),
  (err) => setBackendStatus(err.message, 'not-granted'),
);

function setBackendStatus(text, state) {
  const pill = document.getElementById('backend-status-pill');
  pill.textContent = text === 'ready' ? 'simulated backend ready' : text;
  pill.className = `consent-state-pill ${state}`;
  document.querySelectorAll('.send-btn').forEach((b) => { b.disabled = state !== 'granted'; });
}

/* ============================================================
   Requests
   ============================================================ */
const records = [];
const byReq = new Map();
let nextReq = 1;

async function sendOne() {
  const n = nextReq++;
  const record = { n, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), sessionId: rumSessionId() };
  records.push(record);
  byReq.set(String(n), record);
  try {
    const res = await fetch(`${API_BASE}order?req=${n}&apm_rate=${liveConfig.apmRate}`);
    Object.assign(record, await res.json());
  } catch (err) {
    record.error = err.message;
  }
  record.sessionId = record.sessionId || rumSessionId();
  scheduleRender();
}

async function sendRequests(count) {
  await backendReady;
  for (let i = 0; i < count; i += 10) {
    await Promise.all(Array.from({ length: Math.min(10, count - i) }, sendOne));
  }
  renderRumStatus();
}

// RUM reports a resource after the response, from its own timing data, so
// this lands some time after the request row exists — the row fills in then.
function recordRumResource(event) {
  const req = new URL(event.resource.url).searchParams.get('req');
  const record = byReq.get(req);
  if (!record) return;
  record.rumSeen = true;
  record.rumTraceId = event._dd?.trace_id || null;
  record.rumRulePsr = event._dd?.rule_psr;
  scheduleRender();
}

function headerOutcome(r) {
  const p = r.receivedHeaders?.['x-datadog-sampling-priority'];
  if (p === '1') return 'priority-1';
  if (p === '0') return 'priority-0';
  return 'none';
}

// "Linked" is measured, not inferred: the trace the backend kept has the
// same ID as the `_dd.trace_id` RUM put on the resource event.
function isLinked(r) {
  return r.decision === 'keep' && !!r.rumTraceId && r.rumTraceId === r.traceId;
}

function clearRequests() {
  records.length = 0;
  byReq.clear();
  renderAll();
}

/* ============================================================
   Rendering
   ============================================================ */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const OUTCOME_BADGE = {
  'priority-1': '<span class="type-badge action">1</span>',
  'priority-0': '<span class="type-badge error">0</span>',
  none: '<span class="type-badge other">absent</span>',
};

function rumCell(r) {
  if (!r.rumSeen) return '<span class="muted">waiting…</span>';
  if (!r.rumTraceId) return '<span class="muted">no _dd.trace_id</span>';
  return isLinked(r)
    ? `<span class="type-badge action" title="${esc(r.rumTraceId)}">linked</span>`
    : `<span class="type-badge warn" title="${esc(r.rumTraceId)}">trace dropped</span>`;
}

function backendCell(r) {
  if (r.error) return `<span class="type-badge error">${esc(r.error)}</span>`;
  if (!r.decision) return '<span class="muted">…</span>';
  const cls = r.decision === 'keep' ? 'action' : 'debug';
  return `<span class="type-badge ${cls}">${r.decision}</span> <span class="muted" title="${esc(r.reason)}">by ${r.decidedBy === 'rum' ? 'RUM' : 'APM sampler'}</span>`;
}

function renderTable() {
  const tbody = document.getElementById('rum-tbody');
  if (records.length === 0) {
    tbody.innerHTML = '<tr id="rum-empty-row"><td colspan="7">Send a request to see what the backend received…</td></tr>';
    return;
  }
  tbody.innerHTML = records.map((r) => {
    const tp = r.receivedHeaders?.traceparent;
    return `<tr>
      <td>${r.time}</td>
      <td>#${r.n}</td>
      <td>${esc((r.sessionId || '—').slice(0, 8))}</td>
      <td>${r.decision ? OUTCOME_BADGE[headerOutcome(r)] : ''}</td>
      <td class="wrap" title="${esc(tp || 'absent')}">${tp ? esc(`…-${tp.split('-')[3]}`) : '<span class="muted">absent</span>'}</td>
      <td>${backendCell(r)}</td>
      <td>${rumCell(r)}</td>
    </tr>`;
  }).join('');
  const wrap = document.getElementById('rum-table-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}

function renderTallies() {
  const done = records.filter((r) => r.decision);
  const count = (fn) => done.filter(fn).length;
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  set('t-sent', done.length);
  set('t-p1', count((r) => headerOutcome(r) === 'priority-1'));
  set('t-p0', count((r) => headerOutcome(r) === 'priority-0'));
  set('t-none', count((r) => headerOutcome(r) === 'none'));
  set('t-keep-rum', count((r) => r.decision === 'keep' && r.decidedBy === 'rum'));
  set('t-keep-apm', count((r) => r.decision === 'keep' && r.decidedBy === 'backend'));
  set('t-drop', count((r) => r.decision === 'drop'));
  set('t-linked', count(isLinked));
  set('t-unlinked', count((r) => r.decision === 'keep' && !isLinked(r)));
}

function renderSessions() {
  const sessions = new Map();
  for (const r of records.filter((x) => x.decision)) {
    const key = r.sessionId || '(no RUM session)';
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(r);
  }
  const tbody = document.getElementById('sessions-tbody');
  if (sessions.size === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">No requests yet.</td></tr>';
    return;
  }
  tbody.innerHTML = [...sessions].map(([id, rs]) => {
    const outcomes = [...new Set(rs.map(headerOutcome))];
    return `<tr>
      <td><span class="session-id">${esc(id.slice(0, 8))}</span></td>
      <td>${rs.length}</td>
      <td>${outcomes.map((o) => OUTCOME_BADGE[o]).join(' ')}</td>
      <td>${rs.filter((r) => r.decision === 'keep').length}</td>
      <td>${rs.filter(isLinked).length}</td>
    </tr>`;
  }).join('');
}

function renderConfigJson() {
  document.getElementById('config-json').textContent = JSON.stringify({
    rum: {
      sessionSampleRate: 100,
      allowedTracingUrls: [{ match: `${API_BASE}*`, propagatorTypes: ['datadog', 'tracecontext'] }],
      traceSampleRate: liveConfig.traceSampleRate,
      traceContextInjection: liveConfig.traceContextInjection,
    },
    simulatedBackend: { DD_TRACE_SAMPLE_RATE: liveConfig.apmRate / 100 },
  }, null, 2);
}

function renderAll() {
  renderTable();
  renderTallies();
  renderSessions();
}

function renderConfigControls() {
  document.getElementById('tsr-input').value = liveConfig.traceSampleRate;
  document.getElementById('tci-select').value = liveConfig.traceContextInjection;
  document.getElementById('active-config').textContent =
    `traceSampleRate: ${liveConfig.traceSampleRate} · traceContextInjection: '${liveConfig.traceContextInjection}'`;
  for (const [id, p] of Object.entries(PRESETS)) {
    const active = p.tsr === liveConfig.traceSampleRate && p.tci === liveConfig.traceContextInjection;
    document.getElementById(`preset-${id}`).classList.toggle('active', active);
  }
  const apm = document.getElementById('apm-rate-input');
  apm.value = liveConfig.apmRate;
  document.getElementById('apm-rate-value').textContent = `${liveConfig.apmRate}%`;
}

/* ============================================================
   Shared with the flow diagram (src/main.js)
   ============================================================ */
window.traceLab = window.traceLab ?? {};
window.traceLab.liveConfig = liveConfig;

document.addEventListener('DOMContentLoaded', function () {
  renderConfigControls();
  renderConfigJson();
  renderAll();
  // The SDK loads async from the CDN; if it never arrives (an ad blocker is
  // the usual cause) the status pill and callout say so.
  setTimeout(renderRumStatus, 1500);
  if (params.get('tab') === 'flow') switchTab('flow');
});
