/**
 * Consent & Storage Lab — standalone demo of Datadog RUM's sessionPersistence
 * and tracking-consent APIs against strict EU cookie-consent requirements.
 *
 * This page is intentionally self-contained (its own SDK inits, its own small
 * set of helpers) rather than sharing ../app.js, since its RUM/Logs init calls
 * are driven by live user choices instead of a single fixed config.
 */

// ---------------------------------------------------------------------------
// Theme toggle (shared localStorage key with the pizza builder)
// ---------------------------------------------------------------------------

/**
 * Apply a theme to <html>, driving both theming mechanisms from one call:
 * `data-theme` for our own CSS and the `wa-light`/`wa-dark` class for Web
 * Awesome. Persisted so it survives refreshes and carries across pages.
 *
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.toggle('wa-dark', theme === 'dark');
  root.classList.toggle('wa-light', theme === 'light');
  localStorage.setItem('theme', theme);
}

/**
 * Theme switch handler.
 *
 * @param {{checked: boolean}} sw - The <wa-switch> (or checkbox) element
 */
function toggleTheme(sw) {
  applyTheme(sw.checked ? 'dark' : 'light');
}

// Sync the switch with the theme the pre-paint script already resolved, which
// may have come from the OS rather than localStorage.
(function () {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const sync = () => { toggle.checked = document.documentElement.dataset.theme === 'dark'; };
  sync();
  // The CDN autoloader registers <wa-switch> asynchronously, after this script
  // has already run. Setting `checked` before the upgrade doesn't survive it,
  // and `whenDefined` can resolve before this instance is upgraded, so wait for
  // the component's own first render to settle before syncing again.
  if (toggle.localName.startsWith('wa-')) {
    customElements.whenDefined(toggle.localName)
      .then(() => toggle.updateComplete)
      .then(sync);
  }
})();

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchLabTab(tab) {
  const panels = { storage: 'tab-storage', tabs: 'tab-tabs', errors: 'tab-errors', config: 'tab-config' };
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.getAttribute('aria-controls') === panels[tab];
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  Object.values(panels).forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById(panels[tab]).style.display = 'block';
  if (tab === 'config') renderConfigTable();
  if (tab === 'errors') renderErrorMatrix();

  // Changing the hash is what makes RUM treat this as a new View — same
  // fragment-based tracking the main pizza builder uses. Without this, RUM
  // only ever sees a single view for the whole page (the initial load).
  if (window.location.hash !== '#' + tab) window.location.hash = tab;
}

// ---------------------------------------------------------------------------
// Persistence + consent state — stored in sessionStorage so it survives a
// same-tab reload but starts fresh ('pending' / 'cookie') in a brand new tab,
// which is the honest default for a first-time visitor.
// ---------------------------------------------------------------------------

// Clear any stale fragment left over from a previous session/tab-switch, so
// the very first View this page reports isn't mislabeled — same convention
// the main pizza builder uses.
if (window.location.hash) {
  history.replaceState(null, '', window.location.pathname);
}

const VALID_MODES = ['cookie', 'local-storage', 'memory'];

function getPersistence() {
  const v = sessionStorage.getItem('consentLab.persistence');
  return VALID_MODES.includes(v) ? v : 'cookie';
}

function getConsent() {
  const v = sessionStorage.getItem('consentLab.consent');
  return ['granted', 'not-granted', 'pending'].includes(v) ? v : 'pending';
}

function reloadWithPersistence(mode) {
  sessionStorage.setItem('consentLab.persistence', mode);
  window.location.reload();
}

/**
 * Clear Datadog-related cookies and localStorage keys left over from an
 * earlier test in this browser (e.g. a real _dd_s cookie from a previous
 * "cookie" mode run, or from visiting the main pizza builder, which also
 * lives on this domain and sets a site-wide first-party cookie). Also resets
 * this lab's own consent/persistence choice so the next load starts clean.
 */
function resetLabState() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (!name) return;
    const expire = name + '=; Max-Age=0; path=/';
    document.cookie = expire;
    document.cookie = expire + '; domain=' + window.location.hostname;
  });
  Object.keys(localStorage).forEach(k => {
    if (/^_dd|datadog/i.test(k)) localStorage.removeItem(k);
  });
  sessionStorage.removeItem('consentLab.consent');
  sessionStorage.removeItem('consentLab.persistence');
  window.location.reload();
}

/**
 * Handle a click on the consent banner. "accept-cookie" and "accept-storage"
 * force a specific sessionPersistence mode (sessionPersistence can only be
 * set at init time, so a mode change requires a reload); "decline" just
 * revokes consent live via setTrackingConsent, no reload needed.
 */
function labSetConsent(choice) {
  if (choice === 'decline') {
    sessionStorage.setItem('consentLab.consent', 'not-granted');
    applyConsentLive('not-granted');
    return;
  }

  const desiredMode = choice === 'accept-cookie' ? 'cookie' : 'local-storage';
  const consent = 'granted';
  sessionStorage.setItem('consentLab.consent', consent);

  if (desiredMode !== getPersistence()) {
    sessionStorage.setItem('consentLab.persistence', desiredMode);
    window.location.reload();
    return;
  }
  applyConsentLive(consent);
}

function applyConsentLive(consent) {
  if (window.DD_RUM && window.DD_RUM.setTrackingConsent) {
    window.DD_RUM.setTrackingConsent(consent);
  }
  renderConsentPills();
  renderStorageInspector();
  renderConfigTable(true);
}

function renderConsentPills() {
  const consent = getConsent();
  document.querySelectorAll('.consent-state-pill').forEach(pill => {
    pill.className = 'consent-state-pill ' + consent;
    pill.textContent = consent;
  });
}

// ---------------------------------------------------------------------------
// SDK init — RUM is fully consent-gated; Logs is an independent, always-on,
// cookie-free error pipe (the "Sentry-equivalent" backup plan).
// ---------------------------------------------------------------------------

window.DD_RUM && window.DD_RUM.onReady(function () {
  const cfg = window.DD_CONFIG || {};
  window.DD_RUM.init({
    applicationId: cfg.applicationId,
    clientToken: cfg.clientToken,
    site: cfg.site,
    service: cfg.service,
    version: cfg.version,
    env: cfg.env,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackBfcacheViews: true,
    defaultPrivacyLevel: 'mask-user-input',
    sessionPersistence: getPersistence(),
    trackingConsent: getConsent(),
    beforeSend: function (event) {
      pushActivity('rum', ...rumEventCols(event));
      return true;
    },
  });
});

window.DD_LOGS && window.DD_LOGS.onReady(function () {
  const cfg = window.DD_CONFIG || {};
  window.DD_LOGS.init({
    clientToken: cfg.clientToken,
    site: cfg.site,
    service: cfg.service,
    version: cfg.version,
    env: cfg.env,
    sessionPersistence: 'local-storage', // never a cookie — always on, independent of RUM consent
    trackingConsent: 'granted',
    forwardErrorsToLogs: true,
    forwardConsoleLogs: 'all',
    sessionSampleRate: 100,
    beforeSend: function (log) {
      pushActivity('logs', ...logEventCols(log));
      recordErrorProbe(log);
      return true;
    },
  });
});

// ---------------------------------------------------------------------------
// Storage inspector
// ---------------------------------------------------------------------------

function renderStorageInspector() {
  const cookies = document.cookie ? document.cookie.split(';').map(c => c.trim()).filter(Boolean) : [];
  const cookieList = document.getElementById('cookie-list');
  const cookieCount = document.getElementById('cookie-count');
  if (cookieList) {
    cookieCount.textContent = '(' + cookies.length + ')';
    cookieList.innerHTML = cookies.length
      ? cookies.map(c => `<li class="${/^_dd|datadog/i.test(c) ? 'dd-key' : ''}">${escapeHtml(c)}</li>`).join('')
      : '<li class="empty">No cookies set.</li>';
  }

  const lsKeys = Object.keys(localStorage);
  const lsList = document.getElementById('ls-list');
  const lsCount = document.getElementById('ls-count');
  if (lsList) {
    lsCount.textContent = '(' + lsKeys.length + ')';
    lsList.innerHTML = lsKeys.length
      ? lsKeys.map(k => {
          const isDD = /^_dd|datadog/i.test(k);
          const val = localStorage.getItem(k) || '';
          return `<li class="${isDD ? 'dd-key' : ''}">${escapeHtml(k)} = ${escapeHtml(val.slice(0, 60))}${val.length > 60 ? '…' : ''}</li>`;
        }).join('')
      : '<li class="empty">Nothing stored.</li>';
  }

  const mode = getPersistence();
  ['cookie', 'local-storage', 'memory'].forEach(m => {
    const btn = document.getElementById('mode-btn-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const modeDisplay = document.getElementById('active-mode-display');
  if (modeDisplay) modeDisplay.textContent = mode;

  const sidEl = document.getElementById('session-id-display');
  if (sidEl) {
    try {
      const ctx = window.DD_RUM && window.DD_RUM.getInternalContext ? window.DD_RUM.getInternalContext() : null;
      sidEl.textContent = ctx && ctx.session_id ? ctx.session_id : (getConsent() === 'granted' ? 'no session yet — interact with the page' : '— (consent not granted)');
    } catch (e) {
      sidEl.textContent = 'unavailable';
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

// ---------------------------------------------------------------------------
// Multi-tab test (BroadcastChannel)
// ---------------------------------------------------------------------------

const LAB_TAB_ID = Math.random().toString(36).slice(2, 8);
const tabsSeen = new Map();
let bc = null;

try {
  bc = new BroadcastChannel('consent-lab-tabs');
  bc.onmessage = (e) => {
    tabsSeen.set(e.data.tabId, e.data);
    renderTabsTable();
  };
} catch (e) {
  // BroadcastChannel unsupported — multi-tab tab will just show this tab.
}

function announceTab() {
  let sessionId = null;
  try {
    const ctx = window.DD_RUM && window.DD_RUM.getInternalContext ? window.DD_RUM.getInternalContext() : null;
    sessionId = ctx ? ctx.session_id : null;
  } catch (e) { /* noop */ }

  const payload = {
    tabId: LAB_TAB_ID,
    persistence: getPersistence(),
    consent: getConsent(),
    sessionId: sessionId,
    ts: Date.now(),
  };
  tabsSeen.set(LAB_TAB_ID, payload);
  if (bc) bc.postMessage(payload);
  renderTabsTable();
}

function renderTabsTable() {
  const tbody = document.getElementById('tabs-tbody');
  const verdict = document.getElementById('tabs-verdict');
  if (!tbody) return;

  const now = Date.now();
  const rows = [...tabsSeen.values()].filter(t => now - t.ts < 20000).sort((a, b) => a.ts - b.ts);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Waiting for tab reports…</td></tr>';
    if (verdict) verdict.textContent = '';
    return;
  }

  tbody.innerHTML = rows.map(t => `
    <tr class="${t.tabId === LAB_TAB_ID ? 'tab-row-self' : ''}">
      <td><span class="tab-badge">${t.tabId}${t.tabId === LAB_TAB_ID ? ' (this tab)' : ''}</span></td>
      <td>${t.persistence}</td>
      <td>${t.consent}</td>
      <td><span class="session-id">${t.sessionId || '—'}</span></td>
      <td>${Math.round((now - t.ts) / 1000)}s ago</td>
    </tr>`).join('');

  if (verdict) {
    const ids = [...new Set(rows.map(t => t.sessionId).filter(Boolean))];
    if (rows.length < 2) {
      verdict.textContent = 'Open a second tab to compare session IDs.';
    } else if (ids.length <= 1) {
      verdict.innerHTML = `✅ <strong>${rows.length} tabs, 1 session</strong> — consistent, no inflation.`;
    } else {
      verdict.innerHTML = `⚠️ <strong>${rows.length} tabs, ${ids.length} different session IDs</strong> — this persistence mode is fragmenting one visit into multiple sessions.`;
    }
  }
}

window.addEventListener('beforeunload', () => {
  if (bc) bc.postMessage({ tabId: LAB_TAB_ID, closed: true, ts: Date.now(), persistence: getPersistence(), consent: getConsent(), sessionId: null });
});

// ---------------------------------------------------------------------------
// Unified activity log — every RUM event and every Log entry, tagged by
// source, visible under every tab (not just the Error capture tab).
// ---------------------------------------------------------------------------

const activityEvents = [];
const activityFilters = new Set(['rum', 'logs']);
const MAX_ACTIVITY_ROWS = 300;

/**
 * Map a RUM event to [type, name/path, hash/payload] for the log table,
 * mirroring the column conventions used by the main pizza builder's log.
 */
function rumEventCols(event) {
  const t = event.type;
  if (t === 'view') {
    const url = event.view?.url || '';
    try { const u = new URL(url); return [t, u.pathname, u.hash || '—']; }
    catch { return [t, url, '—']; }
  }
  if (t === 'action') {
    const name = event.action?.target?.name || event.action?.type || '—';
    return [t, name, event.context ? JSON.stringify(event.context) : '—'];
  }
  if (t === 'error') {
    return [t, event.error?.message || '—', event.error?.source || '—'];
  }
  if (t === 'resource') {
    return [t, (event.resource?.url || '—').replace(/^https?:\/\/[^/]+/, ''), event.resource?.type || '—'];
  }
  if (t === 'long_task') {
    const ms = event.long_task?.duration != null ? Math.round(event.long_task.duration / 1e6) + 'ms' : '—';
    return [t, ms, '—'];
  }
  return [t || 'other', JSON.stringify(event).slice(0, 60), '—'];
}

/** Map a Logs SDK entry to [type, name, payload] for the log table. */
function logEventCols(log) {
  const type = ['error', 'warn', 'info', 'debug'].includes(log.status) ? log.status : 'debug';
  const origin = log.origin || log.error?.origin || 'logger';
  return [type, log.message || '—', origin];
}

function toggleActivityFilter(source) {
  if (activityFilters.has(source)) activityFilters.delete(source);
  else activityFilters.add(source);
  document.querySelectorAll('.filter-btn.' + source).forEach(btn => btn.classList.toggle('active', activityFilters.has(source)));
  renderActivityLog();
}

function clearActivityLog() {
  activityEvents.length = 0;
  renderActivityLog();
}

function pushActivity(source, type, a, b) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  activityEvents.push({ source, type: type || 'other', time, a: String(a ?? '—'), b: String(b ?? '—') });
  if (activityEvents.length > MAX_ACTIVITY_ROWS) activityEvents.shift();
  renderActivityLog();
}

function renderActivityLog() {
  const tbody = document.getElementById('rum-tbody');
  if (!tbody) return;
  const visible = activityEvents.filter(e => activityFilters.has(e.source));
  if (!visible.length) {
    tbody.innerHTML = '<tr id="rum-empty-row"><td colspan="5">Waiting for events…</td></tr>';
    return;
  }
  const KNOWN_TYPES = ['view', 'action', 'resource', 'error', 'long_task', 'warn', 'info', 'debug'];
  const wrap = document.getElementById('rum-table-wrap');
  const wasScrolledToBottom = wrap && wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 20;
  tbody.innerHTML = visible.slice(-150).map(e => {
    const typeClass = KNOWN_TYPES.includes(e.type) ? e.type : 'other';
    return `<tr>
      <td>${e.time}</td>
      <td><span class="type-badge ${e.source}">${e.source}</span></td>
      <td><span class="type-badge ${typeClass}">${e.type}</span></td>
      <td class="wrap">${escapeHtml(e.a)}</td>
      <td class="wrap">${escapeHtml(e.b)}</td>
    </tr>`;
  }).join('');
  if (wrap && wasScrolledToBottom) wrap.scrollTop = wrap.scrollHeight;
}

// ---------------------------------------------------------------------------
// Error capture demo
// ---------------------------------------------------------------------------

function labThrowError() {
  const msg = 'Consent Lab demo error @ ' + new Date().toISOString();
  // Escape the calling function via setTimeout so this becomes a genuine
  // uncaught exception — exactly what forwardErrorsToLogs / RUM's automatic
  // error tracking are designed to pick up, no custom instrumentation needed.
  setTimeout(function () { throw new Error(msg); }, 10);
}

/**
 * Fire a custom RUM action on demand. Only shows up in the activity log
 * (tagged "rum") once trackingConsent is granted — while pending/declined,
 * this click still happens, but RUM has nothing to send, which is the
 * consent gate working as intended.
 */
function labFireAction() {
  if (window.DD_RUM && window.DD_RUM.addAction) {
    window.DD_RUM.addAction('consent_lab_test_action', {
      persistence: getPersistence(),
      consent: getConsent(),
    });
  }
}

/** Emit a Logs SDK info entry. Always works — the Logs pipe is always-on. */
function labLogInfo() {
  if (window.DD_LOGS && window.DD_LOGS.logger) {
    window.DD_LOGS.logger.info('Consent Lab manual log entry', {
      persistence: getPersistence(),
      consent: getConsent(),
    });
  }
}

// ---------------------------------------------------------------------------
// Error Tracking coverage matrix — "can Logs replace Sentry, cookie-free?"
//
// The customer requirement behind this: they need 100% error capture (they're
// replacing Sentry, which is cookie-free and they're fine with that), but
// their legal team won't allow any cookie before consent. The Logs SDK on
// this page is always-on and cookie-free, so the question becomes: which
// error sources does it actually pick up, and which of those turn into
// Datadog *Error Tracking* issues rather than just log lines?
//
// Error Tracking processes a log into an issue when the log carries an error
// stack trace (`error.stack`); `error.kind` and `error.message` are what it
// groups and titles issues by. A log with `status:error` but no stack stays a
// log line and never becomes an issue — which is the trap this matrix exists
// to make visible, because it's the difference between "we see 100% of
// errors" and "we think we do".
//
// Every row here is verified live in the browser rather than asserted: the
// Logs beforeSend callback reports what the SDK actually built.
// ---------------------------------------------------------------------------

/**
 * The error sources worth testing, in the order a reviewer should read them.
 * `eligible` is what we *expect* — the table shows measured results next to
 * it, so a wrong expectation shows up as a mismatch instead of hiding.
 *
 * @type {Array<{id: string, label: string, how: string, eligible: boolean}>}
 */
const ET_SOURCES = [
  { id: 'uncaught',       label: 'Uncaught exception',        how: 'throw new Error(…)',                         eligible: true },
  { id: 'rejection',      label: 'Unhandled promise rejection', how: 'Promise.reject(new Error(…))',             eligible: true },
  { id: 'network',        label: 'Failed network request',     how: 'fetch() to an unreachable host',            eligible: true },
  { id: 'console-error',  label: 'console.error(Error)',       how: 'console.error(new Error(…))',               eligible: true },
  { id: 'logger-error',   label: 'logger.error(msg, ctx, err)', how: 'Error passed as the 3rd argument',         eligible: true },
  { id: 'console-string', label: 'console.error("text")',      how: 'a string, with no Error object',            eligible: false },
  { id: 'logger-message', label: 'logger.error("msg")',        how: 'message only, with no Error object',        eligible: false },
];

/** Measured results, keyed by source id. @type {Object<string, object>} */
const etResults = {};

/**
 * Tag every probe's message with its source id so the Logs beforeSend
 * callback can attribute the resulting log back to the button that fired it.
 * The network probe is the exception — the SDK writes that message itself
 * ("Fetch error GET …"), so it's matched on the URL instead.
 */
function etTag(id) {
  return '[et:' + id + '] Consent Lab error-source probe';
}

const ET_NETWORK_MARKER = 'et-probe-network';

/**
 * Inspect a log the Logs SDK is about to send and, if it came from one of our
 * probes, record what the SDK actually built for it.
 *
 * @param {object} log - The log event from DD_LOGS beforeSend
 */
function recordErrorProbe(log) {
  const message = log.message || '';
  let id = (message.match(/\[et:([a-z-]+)\]/) || [])[1];
  if (!id && message.includes(ET_NETWORK_MARKER)) id = 'network';
  if (!id || !ET_SOURCES.some(src => src.id === id)) return;

  etResults[id] = {
    origin: log.origin || log.error?.origin || 'logger',
    kind: log.error?.kind || null,
    hasStack: Boolean(log.error?.stack),
    cookiesAtCapture: etDatadogCookieCount(),
  };
  renderErrorMatrix();
}

/** Count Datadog-owned cookies right now — the number that has to stay 0. */
function etDatadogCookieCount() {
  if (!document.cookie) return 0;
  return document.cookie.split(';').filter(c => /^\s*(_dd|datadog)/i.test(c)).length;
}

/**
 * Fire one error source. Each is deliberately produced the way real app code
 * would produce it, with no custom Datadog instrumentation on the error path.
 *
 * @param {string} id - A source id from ET_SOURCES
 */
function etTrigger(id) {
  const msg = etTag(id);
  const logger = window.DD_LOGS && window.DD_LOGS.logger;

  switch (id) {
    case 'uncaught':
      // Escape the current call stack so this is a genuine uncaught exception
      // rather than something we catch and report ourselves.
      setTimeout(function () { throw new Error(msg); }, 10);
      break;
    case 'rejection':
      Promise.reject(new Error(msg));
      break;
    case 'network':
      // An unresolvable host is a real network failure. Note a 404 from a
      // reachable host is NOT: that's a successful HTTP exchange, so the Logs
      // SDK doesn't treat it as an error at all.
      fetch('https://' + ET_NETWORK_MARKER + '-' + Date.now() + '.invalid/probe')
        .catch(() => { /* the failure is the point */ });
      break;
    case 'console-error':
      console.error(new Error(msg));
      break;
    case 'console-string':
      console.error(msg);
      break;
    case 'logger-error':
      if (logger) {
        try { throw new Error(msg); }
        catch (err) { logger.error(msg, { probe: id }, err); }
      }
      break;
    case 'logger-message':
      if (logger) logger.error(msg, { probe: id });
      break;
  }
}

/** Fire every source, spaced out so the table fills in visibly. */
function etTriggerAll() {
  ET_SOURCES.forEach((src, i) => setTimeout(() => etTrigger(src.id), i * 220));
}

/** Clear measured results and start over. */
function etReset() {
  Object.keys(etResults).forEach(k => delete etResults[k]);
  renderErrorMatrix();
}

function renderErrorMatrix() {
  const tbody = document.getElementById('et-tbody');
  if (!tbody) return;

  tbody.innerHTML = ET_SOURCES.map(src => {
    const r = etResults[src.id];
    const captured = Boolean(r);
    const issue = captured && r.hasStack;
    const matchesExpectation = !captured || issue === src.eligible;

    const verdict = !captured
      ? '<span class="type-badge other">not fired</span>'
      : issue
        ? '<span class="type-badge action">issue</span>'
        : '<span class="type-badge error">log only</span>';

    return `<tr>
      <td>
        <button class="wa-neutral wa-outlined et-fire-btn" onclick="etTrigger('${src.id}')">Fire</button>
      </td>
      <td><strong>${escapeHtml(src.label)}</strong><br><span class="et-how">${escapeHtml(src.how)}</span></td>
      <td>${captured ? `<span class="type-badge ${escapeHtml(r.origin)}">${escapeHtml(r.origin)}</span>` : '—'}</td>
      <td>${captured ? (r.kind ? `<code>${escapeHtml(r.kind)}</code>` : '<span class="et-absent">none</span>') : '—'}</td>
      <td>${captured ? (r.hasStack ? 'yes' : '<span class="et-absent">no</span>') : '—'}</td>
      <td>${verdict}${matchesExpectation ? '' : ' <span title="Measured result differs from the documented expectation">⚠️</span>'}</td>
    </tr>`;
  }).join('');

  const fired = Object.keys(etResults).length;
  const issues = Object.values(etResults).filter(r => r.hasStack).length;
  const expectedIssues = ET_SOURCES.filter(src => src.eligible).length;
  const cookies = etDatadogCookieCount();

  const verdictEl = document.getElementById('et-verdict');
  if (!verdictEl) return;

  if (!fired) {
    verdictEl.innerHTML = 'Fire the sources above (or <strong>Run all</strong>) to measure what this cookie-free Logs pipe actually captures.';
    return;
  }

  verdictEl.innerHTML =
    `<strong>${issues} of ${fired}</strong> fired source${fired === 1 ? '' : 's'} produced an Error Tracking issue ` +
    `(${expectedIssues} of ${ET_SOURCES.length} sources can). ` +
    `Datadog cookies on this page right now: <strong>${cookies}</strong>` +
    (cookies === 0
      ? ' — the error pipe created none.'
      : ' — note RUM created these after you granted consent on the Storage Inspector tab; the Logs pipe still created none.');
}

/**
 * Fetch this same page with a cache-busting query string to generate a
 * genuine "resource" RUM event without any custom instrumentation.
 */
function labFetchResource() {
  fetch(window.location.pathname + '?labResource=' + Date.now()).catch(() => { /* noop — the request itself is the point */ });
}

// ---------------------------------------------------------------------------
// Config tab
// ---------------------------------------------------------------------------

function colorizeJson(obj) {
  return JSON.stringify(obj, null, 2).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      let cls = 'json-num';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-str';
      else if (/true|false/.test(match)) cls = 'json-bool';
      else if (/null/.test(match)) cls = 'json-null';
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function renderConfigTable(force) {
  const rumEl = document.getElementById('config-rum-json');
  const logsEl = document.getElementById('config-logs-json');
  if (!rumEl || !logsEl) return;

  const cfg = window.DD_CONFIG || {};
  const masked = cfg.clientToken ? cfg.clientToken.slice(0, 8) + '••••••••' : '—';

  const rumConfig = {
    applicationId: cfg.applicationId || '—',
    clientToken: masked,
    site: cfg.site || '—',
    service: cfg.service || '—',
    env: cfg.env || '—',
    sessionPersistence: getPersistence(),
    trackingConsent: getConsent(),
  };

  const logsConfig = {
    clientToken: masked,
    site: cfg.site || '—',
    service: cfg.service || '—',
    env: cfg.env || '—',
    sessionPersistence: 'local-storage',
    trackingConsent: 'granted',
    forwardErrorsToLogs: true,
  };

  rumEl.innerHTML = colorizeJson(rumConfig);
  logsEl.innerHTML = colorizeJson(logsConfig);
}

// ---------------------------------------------------------------------------
// Boot
// (Sidebar resizer behavior now lives in ../lab-shared.js, shared with the
// pizza builder and any future lab.)
// ---------------------------------------------------------------------------

renderConsentPills();
renderStorageInspector();
renderActivityLog();
setInterval(renderStorageInspector, 1000);

announceTab();
setInterval(announceTab, 2000);
