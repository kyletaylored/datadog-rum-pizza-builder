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
// `expect` is what to look for once requests are flowing: what the config
// asks for, not a claim about the results. Step 4 reports what actually
// happened.
const PRESETS = {
  'forced-keep': {
    tsr: 100, tci: 'all',
    expect: '<strong>What to look for:</strong> every request leaves with "keep" headers, and every row ends as a trace linked to RUM. The backend never uses its own rate. Move the slider in step 2 and nothing changes.',
  },
  'controlled-drop': {
    tsr: 0, tci: 'all',
    expect: '<strong>What to look for:</strong> every request still carries trace headers, but they say "drop". The backend follows them, so nothing reaches Datadog. Move the slider in step 2: it makes no difference, because the browser already decided.',
  },
  'backend-decision': {
    tsr: 20, tci: 'sampled',
    expect: '<strong>What to look for:</strong> about 1 session in 5 is traced, and in that session every request says "keep". In the other sessions requests leave with <em>no</em> headers, and the backend keeps some on its own, at the rate from step 2. Send 10, start a new RUM session, and repeat a few times to see both kinds.',
  },
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
  const form = event.target;
  applyRumConfig(clampRate(form.querySelector('#tsr-input').value, DEFAULTS.tsr), form.elements.tci.value || DEFAULTS.tci);
}

function customExpectation({ traceSampleRate: tsr, traceContextInjection: tci }) {
  const rest = tci === 'all'
    ? 'send "drop" headers, so the backend drops them whatever its own rate'
    : 'send no headers, so the backend keeps some of them at its own rate from step 2';
  return `<strong>What to look for:</strong> about ${tsr}% of sessions are traced, and every request in them says "keep". Requests in the other sessions ${rest}.`;
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
  document.getElementById('session-id').textContent = 'ended, your next click starts a new one';
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
  pill.textContent = text === 'ready' ? 'pretend backend ready' : text;
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
  'priority-1': '<span class="type-badge action">keep</span>',
  'priority-0': '<span class="type-badge error">drop</span>',
  none: '<span class="type-badge other">no headers</span>',
};

function browserCell(r) {
  if (!r.decision) return '<span class="muted">sending…</span>';
  const tp = r.receivedHeaders?.traceparent;
  const p = r.receivedHeaders?.['x-datadog-sampling-priority'];
  const sub = tp ? `priority ${esc(p)} · traceparent …-${esc(tp.split('-')[3])}` : 'no trace headers';
  return `${OUTCOME_BADGE[headerOutcome(r)]}<span class="sub" title="${esc(tp || 'no traceparent')}">${sub}</span>`;
}

function backendCell(r) {
  if (r.error) return `<span class="type-badge error">${esc(r.error)}</span>`;
  if (!r.decision) return '<span class="muted">…</span>';
  const cls = r.decision === 'keep' ? 'action' : 'debug';
  const why = r.decidedBy === 'rum' ? 'as the browser asked' : 'no decision from RUM, so its own rate';
  return `<span class="type-badge ${cls}">${r.decision === 'keep' ? 'kept' : 'dropped'}</span><span class="sub" title="${esc(r.reason)}">${why}</span>`;
}

// Combines the backend's decision with what RUM measured on its own
// resource event, so "linked" is only claimed when the trace IDs match.
function datadogCell(r) {
  if (!r.decision) return '';
  if (r.decision === 'drop') return '<span class="type-badge debug">nothing</span><span class="sub">no trace kept</span>';
  if (!r.rumSeen) return '<span class="muted">waiting for RUM…</span>';
  if (isLinked(r)) return `<span class="type-badge action">trace linked to RUM</span><span class="sub" title="${esc(r.rumTraceId)}">same trace ID on the RUM resource</span>`;
  return '<span class="type-badge info">backend-only trace</span><span class="sub">no trace ID on the RUM resource</span>';
}

function renderTable() {
  const tbody = document.getElementById('rum-tbody');
  if (records.length === 0) {
    tbody.innerHTML = '<tr id="rum-empty-row"><td colspan="5">Send a request to see its trip, row by row…</td></tr>';
    return;
  }
  tbody.innerHTML = records.map((r) => `<tr>
      <td title="${esc(r.time)}">#${r.n}</td>
      <td>${esc((r.sessionId || '—').slice(0, 8))}</td>
      <td>${browserCell(r)}</td>
      <td>${backendCell(r)}</td>
      <td>${datadogCell(r)}</td>
    </tr>`).join('');
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A plain-language reading of the tallies: the same numbers, said as what
// happened to each group of requests.
function renderSummary() {
  const box = document.getElementById('summary-box');
  const done = records.filter((r) => r.decision);
  if (done.length === 0) {
    box.innerHTML = 'Nothing sent yet. Click <strong>Send 10</strong> in step 3, and this box explains what happened to the requests.';
    return;
  }
  const group = (o) => done.filter((r) => headerOutcome(r) === o);
  const keep = group('priority-1');
  const drop = group('priority-0');
  const none = group('none');
  const sessions = new Set(done.map((r) => r.sessionId || 'none'));
  const tracedSessions = new Set(keep.map((r) => r.sessionId || 'none'));
  const items = [];
  if (keep.length) {
    items.push(`<strong>${plural(keep.length, 'request')}</strong> left with <strong>"keep"</strong> headers. The backend followed them, so they're <strong>traces linked to RUM</strong> (${done.filter(isLinked).length} confirmed so far by RUM's own trace ID).`);
  }
  if (drop.length) {
    items.push(`<strong>${plural(drop.length, 'request')}</strong> left with <strong>"drop"</strong> headers. The backend followed them and kept nothing, whatever its own rate.`);
  }
  if (none.length) {
    const kept = none.filter((r) => r.decision === 'keep').length;
    items.push(`<strong>${plural(none.length, 'request')}</strong> left with <strong>no trace headers</strong>, so the backend decided on its own. It kept ${kept} as <strong>backend-only traces</strong> (in APM, but not linked to RUM) and dropped ${none.length - kept}.`);
  }
  box.innerHTML = `So far: ${plural(done.length, 'request')} from ${plural(sessions.size, 'RUM session')}, ${tracedSessions.size} of which RUM traced.<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
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
    const decision = outcomes.length > 1 ? outcomes.map((o) => OUTCOME_BADGE[o]).join(' ')
      : { 'priority-1': `${OUTCOME_BADGE['priority-1']} traced`, 'priority-0': `${OUTCOME_BADGE['priority-0']} not traced`, none: `${OUTCOME_BADGE.none} not traced` }[outcomes[0]];
    return `<tr>
      <td><span class="session-id">${esc(id.slice(0, 8))}</span></td>
      <td>${rs.length}</td>
      <td>${decision}</td>
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
  renderSummary();
  renderTallies();
  renderSessions();
}

function renderConfigControls() {
  document.getElementById('tsr-input').value = liveConfig.traceSampleRate;
  const form = document.getElementById('custom-config-form');
  form.elements.tci.value = liveConfig.traceContextInjection;
  document.getElementById('active-config').textContent =
    `traceSampleRate: ${liveConfig.traceSampleRate} · '${liveConfig.traceContextInjection}'`;
  let current = null;
  for (const [id, p] of Object.entries(PRESETS)) {
    const active = p.tsr === liveConfig.traceSampleRate && p.tci === liveConfig.traceContextInjection;
    if (active) current = p;
    document.getElementById(`preset-${id}`).setAttribute('aria-pressed', String(active));
  }
  document.getElementById('expect-text').innerHTML = current ? current.expect : customExpectation(liveConfig);
  // A custom config matches no card, so show the form that set it.
  if (!current) document.getElementById('custom-config').open = true;
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
