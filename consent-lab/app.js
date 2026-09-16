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
  if (toggle) toggle.checked = document.documentElement.dataset.theme === 'dark';
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
