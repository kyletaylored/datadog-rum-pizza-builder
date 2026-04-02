/**
 * Shuffle option cards for Datadog Synthetics runs so that the test's
 * "always click first card" behavior produces randomized selections
 * across runs, generating varied data in RUM.
 *
 * Only activates when `navigator.userAgent` contains "DatadogSynthetics".
 */
if (/DatadogSynthetics/i.test(navigator.userAgent)) {
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
 * Metadata for each wizard step, indexed by step number (1–5).
 * Index 0 is null to keep step numbers 1-based.
 *
 * @type {Array<{hash: string, label: string}|null>}
 */
const stepMeta = [
  null,
  { hash: 'crust',    label: 'Crust'    },
  { hash: 'sauce',    label: 'Sauce'    },
  { hash: 'cheese',   label: 'Cheese'   },
  { hash: 'toppings', label: 'Toppings' },
  { hash: 'size',     label: 'Size'     },
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
    location.hash = '';
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
  document.getElementById(`btn-${step}`).disabled = false;
}

/**
 * Stop the current Datadog RUM session, clear all selections, and return
 * the wizard to the start screen. Calling `DD_RUM.stopSession()` ends the
 * session so a new one begins on the user's next interaction.
 */
function stopAndRestart() {
  window.DD_RUM && window.DD_RUM.onReady(function() {
    console.log('[DD RUM] Stopping session');
    window.DD_RUM.stopSession();
    console.log('[DD RUM] Session stopped');
  });
  Object.keys(selections).forEach(k => delete selections[k]);
  document.querySelectorAll('.option-card.selected').forEach(c => c.classList.remove('selected'));
  for (let i = 1; i <= 5; i++) document.getElementById(`btn-${i}`).disabled = true;
  console.log('[Wizard] Selections cleared');
  goTo(0);
}

/**
 * Render the order summary screen and fire the `pizza_order_submitted`
 * custom RUM action with the full order payload as context attributes.
 * These attributes are queryable in RUM Explorer as `@context.pizza_order.*`.
 */
function renderResults() {
  const list = document.getElementById('result-list');
  list.innerHTML = Object.values(selections).map(s =>
    `<li><span class="step-label">${s.label}</span><span class="step-value">${s.value}</span></li>`
  ).join('');
  const order = { pizza_order: Object.fromEntries(Object.values(selections).map(s => [s.label.toLowerCase(), s.value])) };
  window.DD_RUM && window.DD_RUM.onReady(function() {
    console.log('[DD RUM] Action fired: pizza_order_submitted', order);
    window.DD_RUM.addAction('pizza_order_submitted', order);
  });
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
  if (type === 'view')     return ['path', 'hash'];
  if (type === 'action')   return ['name', 'payload'];
  if (type === 'error')    return ['message', 'source'];
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
    const tc = ['view','action','resource','error','long_task'].includes(e.type) ? e.type : 'other';
    const [a, b] = e.cols;
    const aEsc = a.replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const bEsc = b.replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
