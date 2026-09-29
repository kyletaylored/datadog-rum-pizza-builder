// Tap point for the live event table — the direct analog of the RUM SDK's
// `beforeSend`. Registered as an extra LogRecordProcessor alongside the
// OTLP export processor (when one is configured), so every log renders
// here regardless of whether it's stock auto-instrumentation or something
// we emit ourselves, independent of whether export to Datadog is even
// enabled. Log-only because everything wired up in main.js is log-based —
// see main.js for why the (span-based) fetch/xhr instrumentations aren't
// included by default.

const MAX_ROWS = 200;

function ensureTable() {
  const el = document.getElementById("otel-live-table-body");
  if (!el) {
    console.warn("otel-rum-lab: #otel-live-table-body not found in page");
  }
  return el;
}

function row(name, attrs) {
  const body = ensureTable();
  if (!body) return;

  const tr = document.createElement("tr");
  const cells = [new Date().toLocaleTimeString(), name, JSON.stringify(attrs, null, 0)];
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.prepend(tr);
  while (body.children.length > MAX_ROWS) {
    body.removeChild(body.lastChild);
  }
}

export class LiveTableLogProcessor {
  onEmit(logRecord) {
    row(logRecord.eventName ?? logRecord.body ?? "log", {
      severity: logRecord.severityText,
      body: logRecord.body,
      ...logRecord.attributes,
    });
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}
