import { logs } from "@opentelemetry/api-logs";
import { startBrowserSdk } from "@opentelemetry/browser-sdk";
import { createSessionLogRecordProcessor, createSessionSpanProcessor } from "@opentelemetry/browser-sdk/session";
import {
  createDocumentLogRecordProcessor,
  createDocumentSpanProcessor,
  createLocationDocumentProvider,
} from "@opentelemetry/browser-sdk/document";
import { SimpleLogRecordProcessor, ConsoleLogRecordExporter } from "@opentelemetry/sdk-logs";
import { SimpleSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace";

import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { NavigationTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation-timing";
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
import { ErrorsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/errors";
import { WebVitalsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/web-vitals";
import { ResourceTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/resource-timing";
import { ConsoleInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/console";
// Span-based: these two call tracer.startSpan(), so they only do anything
// because startBrowserSdk() below also starts the traces SDK (a global
// TracerProvider, propagators and a context manager). The opentelemetry-js
// contrib packages rather than browser-instrumentation's own experimental
// fetch/xhr, matching the official sandbox (opentelemetry-browser/sandbox/
// src/otel.ts) — only these have clearTimingResources.
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";

import { LiveTableLogProcessor, LiveTableSpanProcessor } from "./live-table.js";
import { initSession, getSessionId, endSession } from "./session.js";

// ---------------------------------------------------------------------
// One startBrowserSdk() call (github.com/open-telemetry/opentelemetry-browser)
// sets up both signals: a LoggerProvider for the log-based instrumentations
// (navigation, clicks, errors, web vitals, resource timing, console) and a
// TracerProvider for the span-based fetch/xhr ones.
// ---------------------------------------------------------------------

// Same shared settings every other lab reads (../config.js).
const cfg = window.DD_CONFIG || {};
const params = new URLSearchParams(location.search);

const SERVICE_NAME = "datadog-rum-pizza-otlp";
const SITE = params.get("site") || cfg.site || "datadoghq.com";

// Export is off by default so the page works standalone with nothing
// leaving the browser. Set from the Config tab (app.js) via the URL:
//   ?export=direct            → straight to Datadog's OTLP intake, with the
//                               RUM client token as dd-api-key
//   ?export=proxy&proxy=<url> → through your own proxy (proxy/server.js),
//                               which injects the key server-side
//   ?traces=<url> / ?logs=<url> override either signal's endpoint in
//                               either mode, e.g. to send traces elsewhere
// A bare ?proxy=<url> (the old form) still means proxy mode.
function resolveExport() {
  const proxy = params.get("proxy") || "";
  const mode = params.get("export") || (proxy ? "proxy" : "off");
  if (mode === "off" || (mode === "proxy" && !proxy)) return { mode: "off", traces: null, logs: null };

  const base = mode === "proxy" ? proxy.replace(/\/+$/, "") : `https://otlp.${SITE}`;
  const traces = params.get("traces") || `${base}/v1/traces`;
  const logs = params.get("logs") || (mode === "proxy" ? `${base}/v1/logs` : `${base}/api/v2/otlplogs`);
  return mode === "direct"
    ? { mode, traces: withClientToken(traces), logs: withClientToken(logs) }
    : { mode, traces, logs };
}

// The client token goes in the query string, not a header: a custom header
// would force a CORS preflight on every export. An override URL that already
// carries its own dd-api-key (e.g. another org's token) is left alone.
function withClientToken(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("dd-api-key")) u.searchParams.set("dd-api-key", cfg.clientToken || "");
    return u.href;
  } catch {
    return url; // invalid — startBrowserSdk rejects it and reports invalidConfig
  }
}

// For the Config tab: the endpoint as the exporter uses it, token masked.
function maskKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const key = u.searchParams.get("dd-api-key");
    if (key) u.searchParams.set("dd-api-key", `${key.slice(0, 6)}…`);
    return decodeURI(u.href);
  } catch {
    return url;
  }
}

const target = resolveExport();
const consoleOn = params.get("console") !== "0";

// Exports to the intake (or the proxy) are themselves fetch/xhr calls the
// instrumentations would capture, and the capture would be exported in the
// next batch — a self-feeding trickle for as long as the tab is open.
const EXPORT_URLS = [/\/v1\/(logs|traces)(\?|$)/, /\/api\/v2\/otlplogs(\?|$)/, target.traces, target.logs].filter(Boolean);

// The official sandbox's instrumentation list and options
// (opentelemetry-browser/sandbox/src/otel.ts), plus NavigationInstrumentation
// and ConsoleInstrumentation, which the sandbox doesn't register.
const instrumentations = [
  new ErrorsInstrumentation(),
  new NavigationInstrumentation(),
  new NavigationTimingInstrumentation(),
  new ResourceTimingInstrumentation({
    // Not in the sandbox: only fetch/xhr calls are "real" network activity
    // worth a row. Without this, every static asset load (stylesheets,
    // fonts, icons) gets captured and, once export is on, shipped.
    initiatorTypes: ["fetch", "xmlhttprequest"],
    ignoreUrls: EXPORT_URLS,
  }),
  new UserActionInstrumentation(),
  // Adds the web-vitals library's attribution object (which element, which
  // interaction, which resource) as the log record body.
  new WebVitalsInstrumentation({ includeRawAttribution: true }),
  // Restricted to warn/error so this doesn't flood the live table with
  // routine console.log noise from the page or its dependencies.
  new ConsoleInstrumentation({ logMethods: ["warn", "error"] }),
  // traceparent goes on every cross-origin request, as in the sandbox. The
  // server still has to allow the header in its CORS preflight; httpbin.org
  // (the "Fake backend call" button) does, and echoes it back.
  // clearTimingResources drops each request's Resource Timing entry once
  // the span has read it, so the buffer doesn't fill up on a long session.
  new FetchInstrumentation({
    propagateTraceHeaderCorsUrls: [/.*/],
    clearTimingResources: true,
    ignoreUrls: EXPORT_URLS,
  }),
  new XMLHttpRequestInstrumentation({
    propagateTraceHeaderCorsUrls: [/.*/],
    ignoreUrls: EXPORT_URLS,
  }),
];

// The page every event happened on, as browser.document.url.full: read from
// location.href at emit time (span start for spans), so it follows the
// wizard's hash changes with no bookkeeping. Distinct from url.full, which
// is what the event is about (the navigated-to URL, the fetched resource).
// This page keeps its export settings in the query string, and an override
// URL there can carry its own dd-api-key, so those are dropped first.
const LAB_PARAMS = ["export", "proxy", "traces", "logs", "site", "console", "tab"];
function stripLabParams(href) {
  const u = new URL(href);
  for (const p of LAB_PARAMS) u.searchParams.delete(p);
  return u.href;
}
const documentProvider = createLocationDocumentProvider({ sanitizeUrl: stripLabParams });

// The same settings also appear in url.full on browser.navigation and
// browser.navigation_timing, which describe this page itself. Only
// NavigationInstrumentation has a sanitizeUrl option, so one processor
// covers both.
const PAGE_URL = location.origin + location.pathname;
const stripLabParamsFromPageUrl = {
  onEmit(logRecord) {
    const url = logRecord.attributes["url.full"];
    if (typeof url === "string" && url.startsWith(PAGE_URL)) logRecord.setAttribute("url.full", stripLabParams(url));
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

// Processors run in order, before the OTLP export processor the SDK appends
// when a signal has exportConfig. The context processors go first so every
// later one (the live table included) sees session.id and
// browser.document.url.full.
const sessionProvider = { getSessionId };
const logProcessors = [
  createSessionLogRecordProcessor(sessionProvider),
  createDocumentLogRecordProcessor(documentProvider),
  stripLabParamsFromPageUrl,
  new LiveTableLogProcessor(),
];
const spanProcessors = [
  createSessionSpanProcessor(sessionProvider),
  createDocumentSpanProcessor(documentProvider),
  new LiveTableSpanProcessor(),
];
// What each processor is, in words, for the Config tab (app.js), built
// alongside the processors so it can't describe a pipeline that isn't there.
const logNames = ["SessionLogRecordProcessor", "DocumentLogRecordProcessor", "stripLabParamsFromPageUrl", "LiveTableLogProcessor"];
const spanNames = ["SessionSpanProcessor", "DocumentSpanProcessor", "LiveTableSpanProcessor"];
// ConsoleLogRecordExporter / ConsoleSpanExporter print via console.dir(),
// which ConsoleInstrumentation doesn't patch, so this can't feed back into
// itself. Opt out with ?console=0.
if (consoleOn) {
  logProcessors.push(new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }));
  spanProcessors.push(new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }));
  logNames.push("SimpleLogRecordProcessor → ConsoleLogRecordExporter");
  spanNames.push("SimpleSpanProcessor → ConsoleSpanExporter");
}
if (target.logs) logNames.push("BatchLogRecordProcessor → OTLPLogExporter");
if (target.traces) spanNames.push("BatchSpanProcessor → OTLPTraceExporter");

const resourceAttributes = {
  "datadog.application.id": cfg.applicationId,
  "deployment.environment.name": cfg.env,
};

const sdk = startBrowserSdk({
  serviceName: SERVICE_NAME,
  serviceVersion: cfg.version,
  resourceAttributes,
  instrumentations,
  traces: {
    processors: spanProcessors,
    ...(target.traces && { exportConfig: { url: target.traces } }),
  },
  logs: {
    processors: logProcessors,
    ...(target.logs && { exportConfig: { url: target.logs } }),
  },
});

const logger = logs.getLogger(SERVICE_NAME);

// session.id comes from the session processor, not from here.
function emitCustomLog({ eventName, body, attributes = {} }) {
  logger.emit({ eventName, body, attributes });
}

initSession({
  onStart: (id) => {
    window.LabStatus?.setSession(id);
    emitCustomLog({ eventName: "session.start", body: "session.start" });
  },
  onEnd: () => emitCustomLog({ eventName: "session.end", body: "session.end" }),
});
getSessionId(); // prime the first session

// Custom action parity with the RUM-SDK version's addAction('pizza_order_submitted', ...).
// app.js (loaded before this bundle — see index.html) already defines
// window.otelLab.logEvent for the live table; this just adds to the same object.
window.otelLab = window.otelLab ?? {};
window.otelLab.config = {
  invalidConfig: !!sdk.invalidConfig,
  export: target.mode,
  site: SITE,
  endpoints: { traces: maskKey(target.traces), logs: maskKey(target.logs) },
  processors: { traces: spanNames, logs: logNames },
  instrumentations: instrumentations.map((i) => i.instrumentationName),
  resource: { "service.name": SERVICE_NAME, "service.version": cfg.version, ...resourceAttributes },
};
window.otelLab.submitOrder = function submitOrder(pizzaOrder) {
  emitCustomLog({
    eventName: "pizza_order_submitted",
    body: "pizza_order_submitted",
    attributes: Object.fromEntries(
      Object.entries(pizzaOrder).map(([k, v]) => [`pizza_order.${k}`, v])
    ),
  });
};

// No hand-rolled error emission needed: ErrorsInstrumentation above already
// listens for window "error" and "unhandledrejection" and turns them into
// `exception` log events on its own. This just triggers one.
window.otelLab.forceError = function forceError() {
  throw new Error("otel-rum-lab: deliberately forced error");
};

window.otelLab.restart = function restart() {
  endSession();
  getSessionId();
};

window.addEventListener("beforeunload", () => {
  emitCustomLog({ eventName: "session.end", body: "session.end" });
});
