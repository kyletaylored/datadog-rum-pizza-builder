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
  // Clear the inline value rather than setting 'block': the panel is a
  // flex column in CSS, and an inline display would override it.
  document.getElementById(panels[tab]).style.display = '';
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

/**
 * Switch the session store both SDKs use, then reload — `sessionPersistence`
 * can only be set at init time.
 *
 * Switching to a cookie-free mode also clears any Datadog cookie left behind
 * by an earlier run. Cookies otherwise just sit there until they expire, so
 * the storage inspector would keep showing one while you're trying to
 * demonstrate that the page creates none — which is the whole claim under
 * test. The cookie-free modes are the ones where a stale cookie is actively
 * misleading, so those are the ones that clean up.
 *
 * @param {'cookie'|'local-storage'|'memory'} mode
 */
function reloadWithPersistence(mode) {
  sessionStorage.setItem('consentLab.persistence', mode);
  if (mode !== 'cookie') clearDatadogCookies();
  window.location.reload();
}

/** Expire every Datadog-owned cookie on this host. */
function clearDatadogCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (!name || !/^(_dd|datadog)/i.test(name)) return;
    const expire = name + '=; Max-Age=0; path=/';
    document.cookie = expire;
    document.cookie = expire + '; domain=' + window.location.hostname;
  });
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
// cookie-free error pipe.
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
      // Only API traffic goes in the table — stylesheets, scripts, images and
      // fonts would bury it (the Web Awesome autoloader alone pulls ~55 chunks
      // per load). Inlined `data:` URIs are reported as `fetch` but are really
      // images, so they're excluded too. Everything is still sent to Datadog.
      const isNoisyResource = event.type === 'resource'
        && (!['xhr', 'fetch'].includes(event.resource?.type)
            || /^data:/i.test(event.resource?.url || ''));
      if (!isNoisyResource) pushActivity('rum', ...rumEventCols(event));
      recordRumErrorProbe(event);
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
    // Must match RUM's sessionPersistence. Both SDKs on a page share one
    // session manager and one `_dd_s` store, so if they disagree, RUM never
    // establishes a session and silently sends nothing at all — no error, no
    // warning. Verified in this lab: with RUM on 'cookie' and Logs pinned to
    // 'local-storage', RUM's beforeSend was never invoked and
    // getInternalContext() returned undefined.
    //
    // The consequence for a strict-consent design is the important part: you
    // cannot pair a cookie-free Logs pipe with a cookie-based RUM pipe. Going
    // cookie-free is a whole-page decision, not a per-SDK one.
    sessionPersistence: getPersistence(),
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
// Error Tracking coverage matrix — "is 100% error capture actually happening, cookie-free?"
//
// The trap this exists to expose: an error log leaving the Browser Logs SDK
// does NOT necessarily become an Error Tracking issue. Browser errors have
// two separate front doors into Error Tracking, with different requirements:
//
//   1. Frontend Error Tracking  — fed by the RUM Browser SDK. Processes
//      errors whose source is custom / source / report / console and that
//      carry a stack trace. RUM is consent-gated here, so this door is shut
//      until the user accepts.
//        https://docs.datadoghq.com/error_tracking/frontend/browser/
//
//   2. Error Tracking for Logs  — fed by the Browser Logs SDK (v4.36.0+,
//      forwardErrorsToLogs: true). Three things are required of the log:
//        - a `service` attribute            (the SDK sets this from init)
//        - `status` of error/critical/alert/emergency  (logger.error gives this)
//        - EITHER `error.kind` OR a valid `error.stack` — either alone is
//          enough. A valid stack means at least two lines with at least one
//          meaningful frame. `error.message` is optional but improves grouping.
//      This door is open pre-consent and cookie-free, and has to be enabled
//      for the org separately.
//        https://docs.datadoghq.com/error_tracking/backend/logs/
//        https://docs.datadoghq.com/error_tracking/frontend/logs/
//
// So "we see the error in the Logs Explorer" and "we have an Error Tracking
// issue" are different claims. This table measures the first precisely and
// predicts the second from the documented rules.
//
// SCOPE — what this can and cannot verify: everything here is measured in the
// browser, from what each SDK actually built in its beforeSend callback. It
// cannot confirm an issue was created server-side, which also depends on
// Error Tracking for Logs being enabled for the org. Read the columns as
// "this payload does / does not meet the documented requirements".
// ---------------------------------------------------------------------------

/**
 * The error sources worth testing, ordered so the eligible ones read first
 * and the near-misses read last. `logsIssue` / `rumIssue` are what the docs
 * say *should* happen; the table shows measured payloads beside them, so a
 * wrong expectation surfaces as a mismatch rather than hiding.
 *
 * @type {Array<{id: string, label: string, how: string, logsIssue: boolean, rumIssue: boolean}>}
 */
const ET_SOURCES = [
  { id: 'uncaught',       label: 'Uncaught exception',          how: 'throw new Error(…)',                     logsIssue: true,  rumIssue: true },
  { id: 'rejection',      label: 'Unhandled promise rejection', how: 'Promise.reject(new Error(…))',           logsIssue: true,  rumIssue: true },
  { id: 'console-error',  label: 'console.error(Error)',        how: 'console.error(new Error(…))',            logsIssue: true,  rumIssue: true },
  { id: 'logger-error',   label: 'logger.error(msg, ctx, err)', how: 'the Error as the 3rd argument',          logsIssue: true,  rumIssue: false },
  { id: 'rum-adderror',   label: 'DD_RUM.addError(err)',        how: 'the RUM manual-report API',              logsIssue: false, rumIssue: true },
  { id: 'network',        label: 'Failed network request',      how: 'fetch() to an unreachable host',         logsIssue: true,  rumIssue: true },
  { id: 'console-string', label: 'console.error("text")',       how: 'a string — no Error instance',           logsIssue: false, rumIssue: false },
  { id: 'logger-message', label: 'logger.error("msg")',         how: 'message only — no Error instance',       logsIssue: false, rumIssue: false },
  { id: 'logger-kind',    label: 'logger.error(msg, {error:{kind}})', how: 'explicit kind, no Error and no stack', logsIssue: true,  rumIssue: false },
  { id: 'logger-nonerror',label: 'logger.error(msg, ctx, "s")', how: 'a string as the 3rd argument',           logsIssue: false, rumIssue: false },
  { id: 'throw-string',   label: 'throw "a bare string"',       how: 'uncaught, but not an Error instance',    logsIssue: false, rumIssue: false },
];

/** Measured results, keyed by source id. @type {Object<string, object>} */
const etResults = {};

/**
 * Tag every probe's message with its source id so each SDK's beforeSend can
 * attribute the resulting event back to the button that fired it. The network
 * probe is the exception — the SDK writes that message itself ("Fetch error
 * GET …") — so it's matched on the URL instead.
 */
let etFireSeq = 0;
function etTag(id) {
  // The sequence number keeps repeat fires of the same source distinct, so
  // neither SDK's duplicate-error throttling can swallow a re-run.
  return '[et:' + id + '] Consent Lab error-source probe #' + (++etFireSeq);
}

const ET_NETWORK_MARKER = 'et-probe-network';

/** Pull a probe id back out of an event message. */
function etIdFromMessage(message) {
  const tagged = (String(message || '').match(/\[et:([a-z-]+)\]/) || [])[1];
  if (tagged) return tagged;
  return String(message || '').includes(ET_NETWORK_MARKER) ? 'network' : null;
}

/**
 * The Logs SDK's own diagnostic, which it writes into `error.stack` when you
 * hand `logger.error` something that isn't an Error. Worth surfacing verbatim
 * in the UI — it's the most actionable message a developer could get, and it
 * appears in a field nobody thinks to read.
 */
const ET_NO_STACK_SENTINEL = 'No stack, consider using an instance of Error';

/**
 * Log statuses Error Tracking will consider. A log carrying a perfectly good
 * stack still won't become an issue at info or warn level.
 *
 * @type {string[]}
 */
const ET_ERROR_STATUSES = ['error', 'critical', 'alert', 'emergency'];

/**
 * Approximate the documented stack-validity rule: "The stack must have at
 * least two lines and one meaningful frame (a frame with a function name and
 * a filename in most languages)."
 *
 * This is a client-side prediction of a server-side rule, so it's deliberately
 * strict about what counts as a meaningful frame. Two observed cases drove the
 * details, both verified in-browser:
 *
 *   - `logger.error(msg, ctx, 'a string')` puts ET_NO_STACK_SENTINEL in
 *     `error.stack`. It's prose, not frames.
 *   - `throw 'a bare string'` gets a synthesized stack whose only frame reads
 *     `at undefined @ file.js:1:2` — a filename, but no function name, so it
 *     fails the documented "function name and a filename" bar.
 *
 * @param {string|undefined} stack
 * @returns {boolean}
 */
function etStackLooksValid(stack) {
  if (!stack) return false;
  const text = String(stack);
  if (text.includes(ET_NO_STACK_SENTINEL)) return false;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  // A meaningful frame names a function AND points at a file with a position.
  // `at undefined @ …` is the SDK saying it could not determine the function.
  return lines.slice(1).some(l =>
    /(?::\d+:\d+|:\d+\))/.test(l) && !/\bat\s+undefined\b/.test(l));
}

/**
 * Record what the Logs SDK built for one of our probes.
 *
 * @param {object} log - The log event from DD_LOGS beforeSend
 */
function recordErrorProbe(log) {
  const id = etIdFromMessage(log.message);
  if (!id || !ET_SOURCES.some(src => src.id === id)) return;

  const stack = log.error?.stack;
  etResults[id] = etResults[id] || {};
  etResults[id].logs = {
    origin: log.origin || log.error?.origin || 'logger',
    service: log.service || null,
    status: log.status || null,
    kind: log.error?.kind || null,
    hasStack: Boolean(stack),
    stackValid: etStackLooksValid(stack),
    sdkSaidNoStack: Boolean(stack && String(stack).includes(ET_NO_STACK_SENTINEL)),
  };
  etResults[id].cookiesAtCapture = etDatadogCookieCount();
  renderErrorMatrix();
}

/**
 * Record what the RUM SDK built for one of our probes. Only ever called once
 * tracking consent is granted — which is the point: pre-consent, the RUM
 * column stays empty while the Logs column fills in.
 *
 * @param {object} event - A RUM error event from DD_RUM beforeSend
 */
function recordRumErrorProbe(event) {
  if (event.type !== 'error') return;
  const id = etIdFromMessage(event.error?.message);
  if (!id || !ET_SOURCES.some(src => src.id === id)) return;

  const stack = event.error?.stack;
  // Frontend Error Tracking processes these four sources, with a stack.
  const processedSource = ['custom', 'source', 'report', 'console'].includes(event.error?.source);
  etResults[id] = etResults[id] || {};
  etResults[id].rum = {
    source: event.error?.source || '—',
    hasStack: Boolean(stack),
    stackValid: etStackLooksValid(stack),
    processedSource,
  };
  renderErrorMatrix();
}

/** Count Datadog-owned cookies right now — the number that has to stay 0. */
function etDatadogCookieCount() {
  if (!document.cookie) return 0;
  return document.cookie.split(';').filter(c => /^\s*(_dd|datadog)/i.test(c)).length;
}

/**
 * Fire one error source, produced the way real application code would produce
 * it — no custom Datadog instrumentation on the error path except where the
 * row is explicitly about a manual-report API.
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
      // An unresolvable host is a real network failure. A 404 from a reachable
      // host is NOT — that's a successful HTTP exchange, and neither SDK
      // treats it as an error.
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
    case 'logger-kind':
      // No Error instance and no stack — just the attributes Error Tracking
      // actually requires, set by hand. This is the rescue for report sites
      // that genuinely have no Error to pass (a validation failure, a rejected
      // API response), and it's why `logger.error("msg")` failing isn't a dead
      // end. `error.kind` becomes the issue title, so make it a real type name.
      if (logger) {
        logger.error(msg, { probe: id, error: { kind: 'ConsentLabProbeError' } });
      }
      break;
    case 'logger-nonerror':
      // A string where the Error belongs. Looks reasonable, logs fine, and
      // never becomes an issue: "Error Tracking only considers errors that
      // are instances of Error."
      if (logger) logger.error(msg, { probe: id }, /** @type {any} */ ('not an Error instance'));
      break;
    case 'throw-string':
      setTimeout(function () { throw msg; }, 10); // eslint-disable-line no-throw-literal
      break;
    case 'rum-adderror':
      if (window.DD_RUM && window.DD_RUM.addError) {
        window.DD_RUM.addError(new Error(msg), { probe: id });
      }
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

/** Render one surface's verdict cell. */
function etVerdictCell(measured, meetsBar, neverApplies) {
  if (neverApplies) return '<span class="et-na">n/a</span>';
  if (!measured) return '—';
  return meetsBar
    ? '<span class="type-badge action">issue</span>'
    : '<span class="type-badge error">log only</span>';
}

function renderErrorMatrix() {
  const tbody = document.getElementById('et-tbody');
  if (!tbody) return;

  tbody.innerHTML = ET_SOURCES.map(src => {
    const r = etResults[src.id] || {};
    const logs = r.logs;
    const rum = r.rum;

    // Logs door: service + an error-level status + (error.kind OR a valid
    // error.stack). Either of the last two alone is sufficient, which is why
    // the network row qualifies on its stack with no kind, and the
    // explicit-kind row qualifies on its kind with no stack at all.
    const logsMeets = Boolean(
      logs
      && logs.service
      && ET_ERROR_STATUSES.includes(logs.status)
      && (logs.kind || (logs.hasStack && logs.stackValid))
    );
    // RUM door: a processed source, with a usable stack. Same meaningful-frame
    // bar as the Logs door — an uncaught `throw "string"` gets a synthesized
    // stack whose only frame has no function name, and that isn't enough.
    const rumMeets = Boolean(rum && rum.processedSource && rum.hasStack && rum.stackValid);

    const logsDrift = logs && logsMeets !== src.logsIssue;
    const rumDrift = rum && rumMeets !== src.rumIssue;
    const drift = logsDrift || rumDrift
      ? ' <span class="et-drift" title="Measured payload differs from the documented expectation">⚠︎</span>'
      : '';

    let stackNote;
    if (!logs) {
      stackNote = '';
    } else if (!logs.hasStack) {
      stackNote = '<span class="et-absent">none</span>';
    } else if (logs.stackValid) {
      stackNote = 'valid';
    } else if (logs.sdkSaidNoStack) {
      // Quote the SDK back at the reader — it diagnosed this itself.
      stackNote = `<span class="et-absent">unusable</span> — the SDK wrote ` +
        `<q>${escapeHtml(ET_NO_STACK_SENTINEL)}</q> into the stack field`;
    } else {
      stackNote = '<span class="et-absent">unusable</span> — no frame with both a function name and a file';
    }

    // Show all three requirements, not just the stack, so a row that fails can
    // be read off directly: which attribute was missing.
    const detail = logs
      ? `<span class="et-how">` +
        `service ${logs.service ? '<code>' + escapeHtml(logs.service) + '</code>' : '<span class="et-absent">none</span>'} · ` +
        `status <code>${escapeHtml(logs.status || '—')}</code>` +
        `${ET_ERROR_STATUSES.includes(logs.status) ? '' : ' <span class="et-absent">(too low)</span>'}<br>` +
        `kind ${logs.kind ? `<code>${escapeHtml(logs.kind)}</code>` : '<span class="et-absent">none</span>'} · ` +
        `stack ${stackNote}</span>`
      : `<span class="et-how">${escapeHtml(src.how)}</span>`;

    return `<tr>
      <td><button class="wa-neutral wa-outlined et-fire-btn" onclick="etTrigger('${src.id}')">Fire</button></td>
      <td><strong>${escapeHtml(src.label)}</strong><br>${detail}</td>
      <td>${etVerdictCell(logs, logsMeets, src.id === 'rum-adderror')}</td>
      <td>${etVerdictCell(rum, rumMeets, false)}${drift}</td>
    </tr>`;
  }).join('');

  const verdictEl = document.getElementById('et-verdict');
  if (!verdictEl) return;

  const fired = Object.keys(etResults).length;
  if (!fired) {
    verdictEl.innerHTML = 'Fire the sources above (or <strong>Run all</strong>) to measure what each pipe actually builds.';
    return;
  }

  const logsIssues = Object.values(etResults).filter(r => r.logs && r.logs.hasStack && r.logs.stackValid).length;
  const rumIssues = Object.values(etResults).filter(r => r.rum && r.rum.processedSource && r.rum.hasStack).length;
  const cookies = etDatadogCookieCount();
  const consent = getConsent();

  verdictEl.innerHTML =
    `Of <strong>${fired}</strong> fired source${fired === 1 ? '' : 's'}: ` +
    `<strong>${logsIssues}</strong> meet the bar for Error Tracking <em>for Logs</em>, ` +
    `<strong>${rumIssues}</strong> for <em>Frontend</em> Error Tracking. ` +
    `RUM consent is <strong>${escapeHtml(consent)}</strong>; Datadog cookies on this page: <strong>${cookies}</strong>.` +
    (consent === 'granted'
      ? ''
      : ' <br>With consent still pending, the Frontend column stays empty — that gap is exactly what the cookie-free Logs pipe is covering.');
}

/**
 * Generate an error on demand, shaped the way you want every reported error in
 * the codebase to be shaped — the canonical "good" case that satisfies both
 * Error Tracking doors at once.
 *
 * Against the three things Error Tracking for Logs requires of a log:
 *   service  the SDK attaches this from init(), so there's nothing to pass
 *            per call — it's the one requirement you can't forget
 *   status   logger.error() emits `status:error`, which is in the accepted set
 *   kind /   the Error instance passed as the THIRD argument is what populates
 *   stack    error.kind, error.message and error.stack
 *
 * That third argument is the part teams miss. Without it the log still arrives,
 * still reads `status:error` in the Logs Explorer, and still never becomes an
 * issue — it has neither a kind nor a stack.
 *
 * Note what is deliberately NOT done here: no `error.kind` is passed in the
 * context object. A context-supplied kind overrides the one derived from the
 * Error (verified in this lab: a context kind beat a real TypeError), which
 * replaces an accurate type name with a hardcoded one and degrades grouping.
 * Set kind by hand only when there is no Error to derive it from.
 */
let labErrorSeq = 0;
function labGenerateError() {
  const msg = 'Consent Lab generated error #' + (++labErrorSeq);
  try {
    throw new Error(msg);
  } catch (err) {
    // Logs pipe — always on, cookie-free. The Error instance must be the
    // third argument for this to reach Error Tracking for Logs.
    if (window.DD_LOGS && window.DD_LOGS.logger) {
      window.DD_LOGS.logger.error(msg, { origin: 'generate-error-button' }, err);
    }
    // RUM pipe — consent-gated, so this only lands once consent is granted.
    if (window.DD_RUM && window.DD_RUM.addError) {
      window.DD_RUM.addError(err, { origin: 'generate-error-button' });
    }
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
    sessionPersistence: getPersistence(), // must match RUM — shared session store
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
