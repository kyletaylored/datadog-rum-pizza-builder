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
    forwardConsoleLogs: 'all',
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
    beforeSend: function (event) {
      // Drop resource events for the Datadog SDK itself — noisy and not useful.
      if (event.type === 'resource' && /ttps:\/\/www\.datadoghq-browser-agent\.com/.test(event.resource?.url)) {
        return false;
      }
      logRumEvent(event);
      return true;
    },
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
    forwardConsoleLogs: 'all',
    sessionSampleRate: 100,
  });
});

/**
 * Lazy proxy for the Datadog Logs logger. Resolves window.DD_LOGS.logger at
 * call time rather than at assignment time, so it works correctly even when
 * called before onReady has fired. Falls back to console if the SDK isn't
 * available (e.g. local dev without config.js).
 *
 * Structured attributes passed as the second argument are merged into
 * top-level log event fields in Datadog — unlike plain console.* calls which
 * only forward the message string.
 */
const logger = new Proxy({}, {
  get: (_, method) => (...args) => (window.DD_LOGS?.logger ?? console)[method](...args),
});

/**
 * Whether the current session is a Datadog Synthetics browser test.
 * Detected via the user agent string injected by the test runner, or by the
 * presence of `?synthetic` in the URL for local debugging (e.g. open
 * index.html?synthetic to exercise the full Synthetics code path in a browser).
 *
 * @type {boolean}
 */
const isSynthetics = /DatadogSynthetics/i.test(navigator.userAgent)
  || new URLSearchParams(window.location.search).has('synthetic');

// If force_session_type=user cleared synthetic context before SDK load,
// emit a structured log now that logger is available.
if (window.__preInitSynthetics) {
  logger.log('synthetic context cleared for user session', {
    pre_clear: window.__preInitSynthetics,
    post_clear: {
      rumContext: window['_DATADOG_SYNTHETICS_RUM_CONTEXT'],
      cookies: document.cookie.split(';').filter(c => c.includes('datadog-synthetics')).map(c => c.trim()),
    },
  });
}

/**
 * Map a Fastly POP region string to our broad APAC/EMEA/AMER groupings.
 *
 * @param {string} fastlyRegion - Region value from pops.json (e.g. "EU-West", "US-East")
 * @returns {'APAC'|'EMEA'|'AMER'|'unknown'}
 */
function fastlyRegionToGroup(fastlyRegion) {
  if (!fastlyRegion) return 'unknown';
  if (/^(APAC|Asia)/.test(fastlyRegion)) return 'APAC';
  if (/^(EU|South-Africa|AF-)/.test(fastlyRegion)) return 'EMEA';
  if (/^(US|North-America|SA|MX)/.test(fastlyRegion)) return 'AMER';
  return 'unknown';
}

/**
 * Async region detection using the Fastly CDN POP indicated in the
 * `x-served-by` response header. GitHub Pages is served by Fastly, so a HEAD
 * request to the current page reveals which POP handled it — a reliable
 * physical-location signal that Selenium/Synthetics workers cannot spoof.
 *
 * Falls back gracefully to null if the header is absent or the fetch fails.
 *
 * @returns {Promise<{popCode: string, popName: string, fastlyRegion: string, region: string}|null>}
 */
async function detectFastlyRegion() {
  try {
    const [headResp, popsResp, fakeDataResp] = await Promise.all([
      fetch(window.location.href, { method: 'HEAD' }),
      fetch('pops.json'),
      fetch('fake-data.json'),
    ]);

    // Load fake data into module variable so generateFakeOrderIdentity can use it.
    _fakeData = await fakeDataResp.json();

    const servedBy = headResp.headers.get('x-served-by');
    if (!servedBy) return null;

    // x-served-by may be comma-separated across cache hops — take the last
    // entry, which is the POP closest to the user.
    const lastHop = servedBy.split(',').pop().trim();
    const popCode = lastHop.split('-').pop().toUpperCase();

    const pops = await popsResp.json();
    const pop = pops.find(p => p.code === popCode);
    if (!pop) return { popCode, popName: null, fastlyRegion: null, region: 'unknown' };

    return {
      popCode: pop.code,
      popName: pop.name,
      fastlyRegion: pop.region,
      region: fastlyRegionToGroup(pop.region),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Per-region intentional fail rates for synthetic error injection.
 * Tuned to produce ~90-95% pass rates after accounting for natural
 * infrastructure noise (network timeouts, slow page loads, etc.).
 *
 * Target pass rates: APAC ~95%, EMEA ~92%, AMER ~90%
 *
 * @type {Object.<string, number>}
 */
const SYNTHETIC_FAIL_RATES = {
  APAC: 0.05,
  EMEA: 0.08,
  AMER: 0.10,
  unknown: 0.08,
};

/**
 * For Synthetics runs: the wizard step at which a simulated error will fire.
 * Resolved asynchronously after the Fastly POP lookup — null until then.
 * Step 1 is excluded so the test always gets past the first choice.
 *
 * @type {number|null}
 */
let syntheticFailStep = null;

// Tag the RUM session with synthetic metadata and resolve region + fail step
// from the Fastly CDN POP header — the only reliable location signal available
// from Synthetics workers.
if (isSynthetics) {
  window.DD_RUM && window.DD_RUM.onReady(function () {
    window.DD_RUM.setGlobalContext({
      synthetic: { region: 'pending', will_fail: false },
    });
  });

  detectFastlyRegion().then(function (pop) {
    const region = pop?.region ?? 'unknown';
    const failRate = SYNTHETIC_FAIL_RATES[region] ?? 0.20;
    syntheticFailStep = Math.random() > failRate ? null : Math.floor(Math.random() * 4) + 2;

    window.DD_LOGS && window.DD_LOGS.onReady(function () {
      logger.info('synthetics_fastly_pop', { pop, region, failRate, syntheticFailStep });
    });

    window.DD_RUM && window.DD_RUM.onReady(function () {
      window.DD_RUM.setGlobalContext({
        synthetic: {
          region,
          pop_code: pop?.popCode ?? null,
          pop_name: pop?.popName ?? null,
          fastly_region: pop?.fastlyRegion ?? null,
          intended_fail_step: syntheticFailStep,
          will_fail: syntheticFailStep !== null,
        },
      });
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

// For non-synthetic sessions, fetch fake-data.json eagerly so it's ready
// before the user reaches the results screen. Synthetics sessions get it
// via detectFastlyRegion() above, which runs in parallel with pops.json.
if (!isSynthetics) {
  fetch('fake-data.json').then(r => r.json()).then(d => { _fakeData = d; }).catch(() => { });
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
    logger.log('[DD RUM] Stopping session');
    window.DD_RUM.stopSession();
    logger.log('[DD RUM] Session stopped');
  });
  Object.keys(selections).forEach(k => delete selections[k]);
  document.querySelectorAll('.option-card.selected').forEach(c => c.classList.remove('selected'));
  for (let i = 1; i <= 5; i++) document.getElementById(`btn-${i}`).disabled = true;
  erroredStep = null;
  logger.log('[Wizard] Selections cleared');
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

  // Resolve region + popName from the Fastly POP context set during Synthetics
  // runs, for locale-aware identity generation. Falls back gracefully for real
  // user sessions where POP data isn't available.
  const synthetic = window.DD_RUM?.getGlobalContext()?.synthetic || {};
  const { orderId, userId, customer, company } = generateFakeOrderIdentity(
    synthetic.region || 'AMER',
    synthetic.pop_name || null
  );

  window.DD_RUM && window.DD_RUM.onReady(function () {
    window.DD_RUM.setUser({ id: userId, name: customer.name, email: customer.email, loyalty_member: customer.loyalty_member });
    if (company) window.DD_RUM.setAccount({ id: company.id, name: company.name, plan: company.plan });
    window.DD_RUM.addAction('pizza_order_submitted', { pizza_order: pizzaOrder });
  });

  logger.info('pizza_order_submitted', {
    order_id: orderId,
    usr: { id: userId, name: customer.name, email: customer.email },
    account: company ? { id: company.id, name: company.name, plan: company.plan } : null,
    customer,
    company,
    pizza_order: pizzaOrder,
  });
}

// ---------------------------------------------------------------------------
// Fake order data generator
// ---------------------------------------------------------------------------

/**
 * Pools of fake data loaded asynchronously from fake-data.json.
 * Populated at page load alongside pops.json — null until resolved.
 */
let _fakeData = null;

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
 * When a Fastly POP region and popName are known, city selection is narrowed
 * to the closest matching city (e.g. popName "Sydney" → Sydney locale).
 * Corporate accounts are assigned ~17% of the time; otherwise the user's
 * email uses a generic domain. Falls back to AMER pools for real user sessions.
 *
 * @param {string} [region='AMER'] - Broad region group: 'APAC', 'EMEA', or 'AMER'
 * @param {string|null} [popName=null] - Fastly POP city name for locale matching
 * @returns {{orderId: string, userId: string, customer: Object, company: Object|null}}
 */
function generateFakeOrderIdentity(region, popName) {
  // Fallback pools in case fake-data.json hasn't loaded yet.
  const data = _fakeData || {
    firstNames: ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey'],
    lastNames: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'],
    streets: ['Maple St', 'Oak Ave', 'Pine Rd', 'Elm Dr', 'Cedar Ln'],
    cities: { AMER: [{ city: 'Dallas', state: 'TX', country: 'US', zip: '75201', aliases: ['Dallas'] }] },
    companies: { AMER: [] },
    loyaltyMembers: [],
  };

  const r = data.cities[region] ? region : 'AMER';

  // ~10% of the time, pick a loyalty member from the fixed curated list.
  // These specific users always get loyalty_member: true; random users do not.
  const loyaltyMembers = data.loyaltyMembers || [];
  const useLoyaltyMember = loyaltyMembers.length > 0 && Math.random() < 0.10;

  let name, email, loyaltyMember;
  if (useLoyaltyMember) {
    loyaltyMember = _pick(loyaltyMembers);
    name = loyaltyMember.name;
    email = loyaltyMember.email;
  } else {
    const first = _pick(data.firstNames);
    const last = _pick(data.lastNames);
    name = `${first} ${last}`;
    email = `${first.toLowerCase()}.${last.toLowerCase()}@example.com`;
    loyaltyMember = null;
  }

  // Try to match the Fastly pop_name to a city alias for a more precise locale.
  const cityPool = data.cities[r];
  const locale = (popName && cityPool.find(c => c.aliases.some(a => popName.includes(a))))
    || _pick(cityPool);

  const isCorporate = !loyaltyMember && Math.random() < 0.17;
  const company = isCorporate ? _pick(data.companies[r] || []) : null;

  if (loyaltyMember) {
    // Loyalty members always use their personal email, never a corporate domain.
  } else if (company) {
    email = email.replace('@example.com', `@${company.domain}`);
  }

  const number = Math.floor(Math.random() * 9000) + 100;
  const street = _pick(data.streets);
  const orderId = 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const userId = _hashId(name + email);
  const accountId = company ? _hashId(company.name + company.domain) : null;

  const address = locale.state
    ? `${number} ${street}, ${locale.city}, ${locale.state} ${locale.zip}`
    : `${number} ${street}, ${locale.city}, ${locale.zip}`;

  const customer = {
    name, email, address,
    city: locale.city, country: locale.country,
    loyalty_member: !!loyaltyMember,
  };

  return {
    orderId,
    userId,
    customer,
    company: company ? { id: accountId, name: company.name, domain: company.domain, plan: company.plan, region: r } : null,
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
