/**
 * Toggle between light and dark mode by setting `data-theme` on <html>.
 * Persists the preference to localStorage so it survives page refreshes.
 * Updates the toggle button icon to reflect the current mode.
 */
/**
 * Toggle between light and dark mode driven by the switch checkbox state.
 * Persists the preference to localStorage so it survives page refreshes.
 *
 * @param {HTMLInputElement} checkbox - The switch input element
 */
function toggleTheme(checkbox) {
  const next = checkbox.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// Sync switch checked state with the theme applied in <head>.
(function () {
  const saved = localStorage.getItem('theme');
  if (saved) {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = saved === 'dark';
  }
})();

/**
 * Switch between the top-level page tabs ("build" and "results-tab").
 * Updates button aria state, active class, and panel visibility.
 *
 * @param {'build'|'results-tab'} tab - The tab identifier to activate
 */
function switchTab(tab) {
  const panels = { 'build': 'tab-build', 'results-tab': 'tab-results', 'config': 'tab-config' };
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.getAttribute('aria-controls') === panels[tab];
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  Object.values(panels).forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById(panels[tab]).style.display = 'block';

  if (tab === 'config') renderConfigTable();
}

/**
 * Syntax-highlight a JSON object for display in a <pre> block.
 * Keys are purple, strings green, numbers/booleans/null orange.
 *
 * @param {Object} obj
 * @returns {string} HTML string with <span> color wrappers
 */
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

/**
 * Populate the Config tab with colorized JSON for the RUM and Logs SDK configs.
 * Masks the clientToken — shows only the first 8 characters.
 * Runs once; subsequent calls are no-ops.
 */
function renderConfigTable() {
  const rumEl = document.getElementById('config-rum-json');
  const logsEl = document.getElementById('config-logs-json');
  if (!rumEl || rumEl.dataset.rendered) return;

  const cfg = window.DD_CONFIG || {};
  const masked = cfg.clientToken ? cfg.clientToken.slice(0, 8) + '••••••••' : '—';

  const rumConfig = {
    applicationId: cfg.applicationId || '—',
    clientToken: masked,
    site: cfg.site || '—',
    service: cfg.service || '—',
    env: cfg.env || '—',
    version: cfg.version || '—',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackBfcacheViews: true,
    defaultPrivacyLevel: 'mask-user-input',
    sessionPersistence: 'local-storage',
  };

  const logsConfig = {
    clientToken: masked,
    site: cfg.site || '—',
    service: cfg.service || '—',
    env: cfg.env || '—',
    version: cfg.version || '—',
    forwardErrorsToLogs: true,
    sessionSampleRate: 100,
  };

  rumEl.innerHTML = colorizeJson(rumConfig);
  logsEl.innerHTML = colorizeJson(logsConfig);
  rumEl.dataset.rendered = '1';
}

// Clear any stale fragment left over from a previous session on page load.
if (window.location.hash) {
  history.replaceState(null, '', window.location.pathname);
}

/**
 * Initialize the Datadog RUM SDK using shared config from window.DD_CONFIG.
 * The beforeSend callback feeds every event into the on-page live log table.
 */
window.DD_RUM && window.DD_RUM.onReady(function () {
  var cfg = window.DD_CONFIG || {};
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
    beforeSend: function (event) { logRumEvent(event); return true; },
  });
});

/**
 * Initialize the Datadog Browser Logs SDK using shared config from window.DD_CONFIG.
 */
window.DD_LOGS && window.DD_LOGS.onReady(function () {
  var cfg = window.DD_CONFIG || {};
  window.DD_LOGS.init({
    clientToken: cfg.clientToken,
    site: cfg.site,
    service: cfg.service,
    version: cfg.version,
    env: cfg.env,
    forwardErrorsToLogs: true,
    sessionSampleRate: 100,
  });
});

/**
 * Whether the current session is a Datadog Synthetics browser test,
 * detected via the user agent string injected by the test runner.
 *
 * @type {boolean}
 */
const isSynthetics = /DatadogSynthetics/i.test(navigator.userAgent);

/**
 * Detect the broad geographic region of the current Synthetics worker using
 * the IANA timezone from the Intl API — no permissions or network calls needed.
 * Datadog managed locations set the system timezone to match the test region.
 *
 * Used to apply region-specific fail rates so error distribution reflects
 * realistic differences across APAC, EMEA, and AMER test locations.
 *
 * @returns {'APAC'|'EMEA'|'AMER'|'unknown'}
 */
function getSyntheticsRegion() {
  try {
    // Primary signal: IANA timezone. Reliable on real browsers but Selenium/
    // Synthetics workers may report UTC regardless of physical location.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (/^(Asia|Australia|Pacific)\//i.test(tz)) return 'APAC';
    if (/^(Europe|Africa)\//i.test(tz)) return 'EMEA';
    if (/^America\//i.test(tz)) return 'AMER';

    // Fallback: browser locale set by the Selenium worker for its region.
    // Less reliable than timezone but may be configured per managed location.
    const lang = navigator.language || '';
    if (/^(en-AU|en-NZ|zh|ja|ko)/i.test(lang)) return 'APAC';
    if (/^(en-GB|de|fr|es-ES|it|nl|pl|pt-PT)/i.test(lang)) return 'EMEA';
    if (/^(en-US|en-CA|es-MX|pt-BR)/i.test(lang)) return 'AMER';

    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Per-region fail rates for synthetic error injection.
 * Adjust these once real timezone data has been verified from test runs.
 *
 * @type {Object.<string, number>}
 */
const SYNTHETIC_FAIL_RATES = {
  APAC:    0.15,
  EMEA:    0.20,
  AMER:    0.25,
  unknown: 0.20,
};

const syntheticsRegion = isSynthetics ? getSyntheticsRegion() : null;

/**
 * For Synthetics runs: the wizard step at which a simulated error will fire,
 * blocking the test from completing the wizard. Set once at page load.
 *
 * Fail rate varies by region (see SYNTHETIC_FAIL_RATES). Step 1 is excluded
 * so the test always gets past the first choice before any failure, producing
 * richer partial-funnel data.
 *
 * @type {number|null}
 */
const syntheticFailStep = (() => {
  if (!isSynthetics) return null;
  const failRate = SYNTHETIC_FAIL_RATES[syntheticsRegion] ?? 0.20;
  if (Math.random() > failRate) return null;
  return Math.floor(Math.random() * 4) + 2; // 2, 3, 4, or 5
})();

// Tag the RUM session with synthetic metadata so sessions can be filtered in
// the RUM Explorer by @context.synthetic.* attributes.
if (isSynthetics) {
  window.DD_RUM && window.DD_RUM.onReady(function () {
    window.DD_RUM.setGlobalContext({
      synthetic: {
        region:              syntheticsRegion,
        timezone:            Intl.DateTimeFormat().resolvedOptions().timeZone,
        language:            navigator.language || 'unknown',
        intended_fail_step:  syntheticFailStep,
        will_fail:           syntheticFailStep !== null,
      },
    });
  });
}

/**
 * The step number that has been killed by a synthetic error injection, if any.
 * Used by `select()` to prevent re-enabling the Continue button after an error.
 *
 * @type {number|null}
 */
let erroredStep = null;

/**
 * Simulated error messages used by `injectStepError()` to generate varied
 * error payloads in RUM across synthetic runs.
 *
 * @type {string[]}
 */
const syntheticErrors = [
  'Failed to fetch pricing data: NetworkError when attempting to fetch resource',
  'TypeError: Cannot read properties of undefined (reading "availability")',
  'Unhandled Promise Rejection: timeout exceeded loading ingredient options',
  'RangeError: Invalid inventory count returned from menu service',
  'Error: Session validation failed — please try again',
];

/**
 * Shuffle option cards for Datadog Synthetics runs so that the test's
 * "always click first card" behavior produces randomized selections
 * across runs, generating varied data in RUM.
 *
 * Only activates for Synthetics user agents.
 */
if (isSynthetics) {
  document.querySelectorAll('.options').forEach(grid => {
    const cards = [...grid.children];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      grid.appendChild(cards[j]);
      cards.splice(j, 1);
    }
  });
}

/**
 * Inject a simulated error into the current wizard step screen, disabling
 * the Continue button so the synthetic test cannot proceed. Also throws a
 * real JS Error so Datadog RUM captures it as an error event with a message,
 * source, and stack trace — visible in RUM Explorer and usable in funnel
 * drop-off analysis.
 *
 * @param {number} step - The step number where the error is being injected
 */
function injectStepError(step) {
  const screen = document.getElementById(`screen-${step}`);
  const btnRow = screen.querySelector('.btn-row');
  const continueBtn = document.getElementById(`btn-${step}`);

  // Pick a random error message for variety across runs.
  const message = syntheticErrors[Math.floor(Math.random() * syntheticErrors.length)];

  // Render an error banner above the button row.
  const banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'background:#fee2e2',
    'border:1px solid #fca5a5',
    'color:#991b1b',
    'border-radius:6px',
    'padding:0.75rem 1rem',
    'font-size:0.8rem',
    'margin-bottom:0.75rem',
    'line-height:1.4',
  ].join(';');
  banner.innerHTML = `<strong>Something went wrong.</strong><br>${message}`;
  btnRow.before(banner);

  // Record the errored step so select() cannot re-enable the button.
  erroredStep = step;

  // Disable the continue button so the test cannot advance.
  if (continueBtn) continueBtn.disabled = true;

  const error = new Error(message);

  // console.error is captured by RUM automatically (source: console) and
  // forwarded to Logs via forwardErrorsToLogs — no custom addError needed.
  console.error('[Synthetic error injection] Step', step, '—', message);

  throw error;
}

/**
 * Metadata for each wizard step, indexed by step number (1–5).
 * Index 0 is null to keep step numbers 1-based.
 *
 * @type {Array<{hash: string, label: string}|null>}
 */
const stepMeta = [
  null,
  { hash: 'crust', label: 'Crust' },
  { hash: 'sauce', label: 'Sauce' },
  { hash: 'cheese', label: 'Cheese' },
  { hash: 'toppings', label: 'Toppings' },
  { hash: 'size', label: 'Size' },
];

/**
 * User's current selections, keyed by step number.
 *
 * @type {Object.<number, {label: string, value: string}>}
 */
const selections = {};

/**
 * Navigate to a wizard step, updating the visible screen, progress bar,
 * and the URL hash to trigger a new Datadog RUM view event.
 *
 * @param {number|'results'} step - Step number (0 = start, 1–5 = wizard steps, 'results' = summary)
 */
function goTo(step) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const wrap = document.getElementById('progress-wrap');
  if (step === 0) {
    document.getElementById('screen-start').classList.add('active');
    wrap.style.display = 'none';
    history.replaceState(null, '', window.location.pathname);
  } else if (step === 'results') {
    document.getElementById('screen-results').classList.add('active');
    wrap.style.display = 'none';
    location.hash = 'results';
    renderResults();
  } else {
    document.getElementById(`screen-${step}`).classList.add('active');
    wrap.style.display = 'block';
    document.getElementById('progress-bar').value = step;
    document.getElementById('step-label').textContent = `Step ${step} of 5`;
    document.getElementById('step-name').textContent = stepMeta[step].label;
    location.hash = stepMeta[step].hash;

    // For Synthetics runs: inject a blocking error at the predetermined step.
    // The throw stops execution here, leaving the wizard frozen on this screen.
    if (syntheticFailStep === step) {
      injectStepError(step);
    }
  }
}

/**
 * Record a user's selection for a given step and enable the Continue button.
 *
 * @param {number} step - The wizard step number (1–5)
 * @param {HTMLElement} el - The clicked option card element
 * @param {string} value - The display value of the selected option
 */
function select(step, el, value) {
  document.querySelectorAll(`#opts-${step} .option-card`).forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selections[step] = { label: stepMeta[step].label, value };
  // Don't re-enable the button if this step has been killed by an error.
  if (step !== erroredStep) {
    document.getElementById(`btn-${step}`).disabled = false;
  }
}

/**
 * Stop the current Datadog RUM session, clear all selections, and return
 * the wizard to the start screen. Calling `DD_RUM.stopSession()` ends the
 * session so a new one begins on the user's next interaction.
 */
function stopAndRestart() {
  window.DD_RUM && window.DD_RUM.onReady(function () {
    console.log('[DD RUM] Stopping session');
    window.DD_RUM.stopSession();
    console.log('[DD RUM] Session stopped');
  });
  Object.keys(selections).forEach(k => delete selections[k]);
  document.querySelectorAll('.option-card.selected').forEach(c => c.classList.remove('selected'));
  for (let i = 1; i <= 5; i++) document.getElementById(`btn-${i}`).disabled = true;
  erroredStep = null;
  console.log('[Wizard] Selections cleared');
  goTo(0);
}

/**
 * Render the order summary screen, fire the `pizza_order_submitted` custom
 * RUM action, and send a `info` log to Datadog Logs with the full order
 * payload including a generated order ID and fake customer identity.
 *
 * RUM action attributes are queryable as `@context.pizza_order.*`.
 * Log attributes are queryable as `@order_id`, `@customer.*`, `@pizza_order.*`.
 */
function renderResults() {
  const list = document.getElementById('result-list');
  list.innerHTML = Object.values(selections).map(s =>
    `<li><span class="step-label">${s.label}</span><span class="step-value">${s.value}</span></li>`
  ).join('');

  const pizzaOrder = Object.fromEntries(Object.values(selections).map(s => [s.label.toLowerCase(), s.value]));
  const { orderId, userId, customer } = generateFakeOrderIdentity();

  window.DD_RUM && window.DD_RUM.onReady(function () {
    window.DD_RUM.setUser({ id: userId, name: customer.name, email: customer.email });
    console.log('[DD RUM] User set', { id: userId, name: customer.name, email: customer.email });
    console.log('[DD RUM] Action fired: pizza_order_submitted', { pizza_order: pizzaOrder });
    window.DD_RUM.addAction('pizza_order_submitted', { pizza_order: pizzaOrder });
  });

  window.DD_LOGS && window.DD_LOGS.onReady(function () {
    const logPayload = {
      order_id: orderId,
      usr: { id: userId, name: customer.name, email: customer.email },
      customer,
      pizza_order: pizzaOrder,
    };
    console.log('[DD LOGS] Order submitted', logPayload);
    window.DD_LOGS.logger.info('pizza_order_submitted', logPayload);
  });
}

// ---------------------------------------------------------------------------
// Fake order data generator
// ---------------------------------------------------------------------------

/**
 * Pools of fake data used to generate randomized order identities.
 * These are entirely fictional and used only to produce varied log payloads.
 */
const _fakeData = {
  firstNames: ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Quinn', 'Avery', 'Drew', 'Skyler', 'Jamie', 'Parker', 'Reese', 'Sage', 'Blake'],
  lastNames: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Thomas', 'Moore', 'Martin', 'Lee', 'White'],
  streets: ['Maple St', 'Oak Ave', 'Pine Rd', 'Elm Dr', 'Cedar Ln', 'Birch Blvd', 'Walnut Way', 'Spruce Ct', 'Willow Pl', 'Ash St'],
  cities: [
    { city: 'Austin', state: 'TX', zip: '78701' },
    { city: 'Portland', state: 'OR', zip: '97201' },
    { city: 'Denver', state: 'CO', zip: '80201' },
    { city: 'Nashville', state: 'TN', zip: '37201' },
    { city: 'Chicago', state: 'IL', zip: '60601' },
    { city: 'Phoenix', state: 'AZ', zip: '85001' },
    { city: 'Atlanta', state: 'GA', zip: '30301' },
    { city: 'Seattle', state: 'WA', zip: '98101' },
    { city: 'Miami', state: 'FL', zip: '33101' },
    { city: 'Minneapolis', state: 'MN', zip: '55401' },
  ],
};

/**
 * Pick a random element from an array.
 *
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a stable numeric ID from a string using the djb2 hash algorithm.
 * Same input always produces the same output, simulating a returning user
 * whose ID is derived from their name and email rather than a database key.
 *
 * @param {string} str
 * @returns {string} Unsigned 32-bit integer as a decimal string
 */
function _hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString();
}

/**
 * Generate a fake customer order identity for log enrichment.
 * All data is randomly composed from fictional pools — no real PII.
 * The user ID is an idempotent hash of name + email, so the same fictional
 * person will carry the same ID across multiple sessions.
 *
 * @returns {{orderId: string, userId: string, customer: {name: string, email: string, address: string}}}
 */
function generateFakeOrderIdentity() {
  const first = _pick(_fakeData.firstNames);
  const last = _pick(_fakeData.lastNames);
  const number = Math.floor(Math.random() * 9000) + 100;
  const street = _pick(_fakeData.streets);
  const locale = _pick(_fakeData.cities);
  const orderId = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const name = `${first} ${last}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
  const userId = _hashId(name + email);

  return {
    orderId,
    userId,
    customer: { name, email, address: `${number} ${street}, ${locale.city}, ${locale.state} ${locale.zip}` },
  };
}

// ---------------------------------------------------------------------------
// RUM event log
// ---------------------------------------------------------------------------

/**
 * Set of RUM event types currently visible in the log table.
 *
 * @type {Set<string>}
 */
const activeFilters = new Set(['view', 'action', 'error', 'long_task']);

/**
 * Toggle a RUM event type filter on or off and re-render the log table.
 *
 * @param {string} type - RUM event type to toggle (e.g. 'view', 'action')
 */
function toggleFilter(type) {
  if (activeFilters.has(type)) activeFilters.delete(type);
  else activeFilters.add(type);
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', activeFilters.has(b.textContent.trim()));
  });
  rerenderTable();
}

/**
 * In-memory store of all RUM events received via `beforeSend`.
 *
 * @type {Array<{type: string, time: string, cols: [string, string]}>}
 */
const rumEvents = [];

/**
 * Return the appropriate column header labels for a given RUM event type.
 *
 * @param {string} type - RUM event type
 * @returns {[string, string]} Tuple of [columnA header, columnB header]
 */
function getColHeaders(type) {
  if (type === 'view') return ['path', 'hash'];
  if (type === 'action') return ['name', 'payload'];
  if (type === 'error') return ['message', 'source'];
  if (type === 'long_task') return ['duration', ''];
  return ['detail', ''];
}

/**
 * Extract the two display values for a RUM event row from the event payload.
 *
 * @param {Object} event - Raw RUM event object from the `beforeSend` callback
 * @returns {[string, string]} Tuple of [columnA value, columnB value]
 */
function getColValues(event) {
  const t = event.type;
  if (t === 'view') {
    const url = event.view?.url || '';
    try {
      const u = new URL(url);
      return [u.pathname, u.hash || '—'];
    } catch { return [url, '—']; }
  }
  if (t === 'action') {
    const name = event.action?.target?.name || event.action?.type || '—';
    const ctx = event.context ? JSON.stringify(event.context) : '—';
    return [name, ctx];
  }
  if (t === 'error') {
    return [event.error?.message || '—', event.error?.source || '—'];
  }
  if (t === 'long_task') {
    const ms = event.long_task?.duration != null ? Math.round(event.long_task.duration / 1e6) + 'ms' : '—';
    return [ms, ''];
  }
  return [JSON.stringify(event).slice(0, 60), ''];
}

/**
 * Re-render the RUM log table based on the current `activeFilters` set.
 * Called after every new event and after toggling a filter button.
 */
function rerenderTable() {
  const tbody = document.getElementById('rum-tbody');
  const visible = rumEvents.filter(e => activeFilters.has(e.type));
  if (visible.length === 0) {
    tbody.innerHTML = '<tr id="rum-empty-row"><td colspan="4">No events match current filters.</td></tr>';
    return;
  }
  tbody.innerHTML = visible.map(e => {
    const tc = ['view', 'action', 'resource', 'error', 'long_task'].includes(e.type) ? e.type : 'other';
    const [a, b] = e.cols;
    const aEsc = a.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bEsc = b.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<tr>
      <td>${e.time}</td>
      <td><span class="type-badge ${tc}">${e.type}</span></td>
      <td class="wrap" title="${aEsc}">${aEsc}</td>
      <td class="wrap" title="${bEsc}">${bEsc}</td>
    </tr>`;
  }).join('');
}

/**
 * Receive a RUM event from the `beforeSend` callback, store it, and append
 * it to the on-page log table. This is the live event feed.
 *
 * @param {Object} event - Raw RUM event object passed by the SDK
 */
function logRumEvent(event) {
  const emptyRow = document.getElementById('rum-empty-row');
  if (emptyRow) emptyRow.remove();

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const cols = getColValues(event);
  rumEvents.push({ type: event.type || 'other', time, cols });
  rerenderTable();

  const wrap = document.getElementById('rum-table-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}

/**
 * Clear all stored RUM events and reset the log table to its empty state.
 */
function clearLog() {
  rumEvents.length = 0;
  document.getElementById('rum-tbody').innerHTML =
    '<tr id="rum-empty-row"><td colspan="4">Waiting for events…</td></tr>';
}
