import { logs } from "@opentelemetry/api-logs";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
  ConsoleLogRecordExporter,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
import { ErrorsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/errors";
import { WebVitalsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/web-vitals";
import { ResourceTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/resource-timing";
import { ConsoleInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/console";
// Deliberately not using this package's fetch/xhr instrumentations: unlike
// everything else here, those two are span-based (they call
// tracer.startSpan(), not logger.emit()) and need a full trace pipeline
// (a TracerProvider registered via trace.setGlobalTracerProvider) to do
// anything — without one they're silent no-ops. That's a real capability
// gap in a logs-only setup, not a bug: network-call tracing here would need
// @opentelemetry/sdk-trace-web on top, which is the exact bundle-size
// tradeoff this lab is intentionally avoiding for the default page. See
// PLAN.md for that as a documented, optional follow-up rather than default
// behavior.

import { LiveTableLogProcessor } from "./live-table.js";
import { initSession, getSessionId, endSession } from "./session.js";

// ---------------------------------------------------------------------
// Everything here is log-based (no spans, no sdk-trace-web, no context-zone
// / zone.js). @opentelemetry/browser-instrumentation is a real npm package
// (github.com/open-telemetry/opentelemetry-browser) that emits stock
// OpenTelemetry log events for navigation, clicks, errors, web vitals, and
// fetch calls — no hand-rolled auto-instrumentation needed for any of that.
// ---------------------------------------------------------------------

// The OTLP export target is optional and *off* by default so this page
// works standalone on a static host (e.g. GitHub Pages) with zero backend.
// The live event table below works purely client-side either way.
//
// Two mutually exclusive ways to turn export on (set from the Config tab,
// see app.js): a local proxy via ?proxy= in the URL (no secret involved),
// or — for a quick test without running anything yourself — relaying
// through corsproxy.io, which adds the CORS headers Datadog's OTLP intake
// doesn't send. corsproxy.io's own key and the Datadog key are read from
// sessionStorage, never the URL: URLs land in browser history and server
// logs, sessionStorage doesn't.
//
// A "straight from the browser, no relay at all" mode used to live here;
// removed because Datadog's OTLP intake has no CORS support at all, so
// there was nothing a browser alone could ever do about it — confirmed
// empirically (every attempt failed with a CORS preflight error and
// retried forever in the background).
const params = new URLSearchParams(location.search);
const PROXY_BASE = params.get("proxy") || window.__OTEL_LAB_CONFIG__?.proxyBase || null;
const CORSPROXY_ENDPOINT = sessionStorage.getItem("otelLabCorsProxyEndpoint") || null;
const CORSPROXY_KEY = sessionStorage.getItem("otelLabCorsProxyKey") || null;
const CORSPROXY_DD_KEY = sessionStorage.getItem("otelLabCorsProxyDdKey") || null;
const DD_APPLICATION_ID = window.__OTEL_LAB_CONFIG__?.applicationId ?? "UNSET";

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "datadog-rum-pizza-otlp",
  "telemetry.sdk.language": "webjs",
});

// ConsoleLogRecordExporter (from @opentelemetry/sdk-logs) is the same
// exporter the official getting-started guide uses — every log also prints
// to devtools via console.dir(), independent of and in addition to the
// on-page live table. Uses console.dir(), which ConsoleInstrumentation below
// doesn't patch (it only wraps log/warn/error/info/debug), so this can't
// feed back into itself. Opt out with ?console=0.
const processors = [new LiveTableLogProcessor()];
if (params.get("console") !== "0") {
  processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
}
if (CORSPROXY_ENDPOINT && CORSPROXY_KEY && CORSPROXY_DD_KEY) {
  // corsproxy.io relays the request and stamps the CORS headers Datadog's
  // OTLP intake doesn't send. Two credentials travel with every request:
  // corsproxy.io's own key (authenticates us to them) and the Datadog key
  // (forwarded through to the actual target). See the Config tab's
  // "Option B" callout for what that does and doesn't change about where
  // these secrets end up.
  //
  // Both go in the URL, not as fetch() headers: per corsproxy.io's own
  // docs (corsproxy.io/docs/header-rewrites/), headers meant for the
  // destination must be passed via a `reqHeaders=name:value` query
  // param — it does not forward arbitrary request headers itself. Setting
  // dd-api-key/x-cors-api-key as literal headers made the browser's CORS
  // preflight ask corsproxy.io to allow headers it doesn't recognize,
  // which it rejected outright (confirmed: preflight came back non-200).
  const corsProxyUrl =
    `https://corsproxy.io/?key=${encodeURIComponent(CORSPROXY_KEY)}` +
    `&url=${encodeURIComponent(CORSPROXY_ENDPOINT)}` +
    `&reqHeaders=dd-api-key:${encodeURIComponent(CORSPROXY_DD_KEY)}`;
  processors.push(
    new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: corsProxyUrl }) })
  );
} else if (PROXY_BASE) {
  processors.push(
    new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${PROXY_BASE}/v1/logs` }) })
  );
}

const loggerProvider = new LoggerProvider({ resource, processors });
logs.setGlobalLoggerProvider(loggerProvider);

registerInstrumentations({
  instrumentations: [
    new NavigationInstrumentation(),
    new UserActionInstrumentation(),
    new ErrorsInstrumentation(),
    new WebVitalsInstrumentation(),
    new ResourceTimingInstrumentation(),
    // Restricted to warn/error so this doesn't flood the live table with
    // routine console.log noise from the page or its dependencies.
    new ConsoleInstrumentation({ logMethods: ["warn", "error"] }),
  ],
});

const logger = logs.getLogger("datadog-rum-pizza-otlp");

// Working-assumption fields (session id, application id) added on top of
// the instrumentation's own log events — see PLAN.md's "Working assumptions"
// section for why these, and that they're untested hypotheses rather than a
// confirmed spec.
// `attributes["session.id"]` can be passed in explicitly (see initSession
// below) to avoid calling getSessionId() again from inside a session
// start/end callback, which would re-enter getSessionId() while it's still
// mid-transition (old id not yet replaced) and recurse forever.
function emitCustomLog({ eventName, body, attributes = {} }) {
  logger.emit({
    eventName,
    body,
    attributes: {
      "datadog.application.id": DD_APPLICATION_ID,
      "session.id": attributes["session.id"] ?? getSessionId(),
      ...attributes,
    },
  });
}

initSession({
  onStart: (id) => emitCustomLog({ eventName: "session.start", body: "session.start", attributes: { "session.id": id } }),
  onEnd: (id) => emitCustomLog({ eventName: "session.end", body: "session.end", attributes: { "session.id": id } }),
});
getSessionId(); // prime the first session

// Custom action parity with the RUM-SDK version's addAction('pizza_order_submitted', ...).
// app.js (loaded before this bundle — see index.html) already defines
// window.otelLab.logEvent for the live table; this just adds to the same object.
window.otelLab = window.otelLab ?? {};
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
