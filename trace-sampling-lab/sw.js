/**
 * sw.js — the lab's simulated APM backend.
 *
 * GitHub Pages can't run a server, so a service worker answers requests to
 * ./api/ instead. That keeps the parts this lab is about real: the RUM SDK
 * really injects (or doesn't inject) its tracing headers into a real fetch,
 * the request really shows up in devtools' Network tab with those headers,
 * and this worker reads them the same way a tracer's HTTP integration would.
 *
 * What's simulated is only what a Datadog tracer would do next with them:
 *
 *   1. An upstream decision arrived (x-datadog-sampling-priority, or the
 *      sampled flag in traceparent): honor it — keep on 1, drop on 0.
 *   2. No trace context arrived: this service is the root of a new trace,
 *      so its own head sampler decides, at the rate the page passes as
 *      ?apm_rate= (standing in for DD_TRACE_SAMPLE_RATE).
 *
 * A real tracer has more mechanisms than that (agent-computed rates, error
 * and rare samplers that can still keep a priority-0 trace) — see README.md.
 */

const TRACE_HEADERS = [
  'x-datadog-trace-id',
  'x-datadog-parent-id',
  'x-datadog-sampling-priority',
  'x-datadog-origin',
  'traceparent',
  'tracestate',
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A hard reload (shift+reload) loads the page without a controller even
// though this worker is already active, and `activate` won't fire again to
// claim it. The page asks for a claim explicitly in that case.
self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const apiBase = new URL('api/', self.registration.scope);
  if (!url.href.startsWith(apiBase.href)) return;
  event.respondWith(handle(event.request, url));
});

function randomTraceId() {
  // 63-bit, decimal — the same shape as x-datadog-trace-id.
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((BigInt(buf[0] & 0x7fffffff) << 32n) | BigInt(buf[1])).toString();
}

function upstreamDecision(headers) {
  const priority = headers['x-datadog-sampling-priority'];
  if (priority != null) {
    return { keep: Number(priority) > 0, reason: `honored x-datadog-sampling-priority: ${priority}` };
  }
  const flags = headers.traceparent?.split('-')[3];
  if (flags) {
    return { keep: (parseInt(flags, 16) & 1) === 1, reason: `honored traceparent flags: ${flags}` };
  }
  return null;
}

async function handle(request, url) {
  const headers = {};
  for (const name of TRACE_HEADERS) {
    const value = request.headers.get(name);
    if (value != null) headers[name] = value;
  }

  const apmRate = Math.min(100, Math.max(0, Number(url.searchParams.get('apm_rate') ?? 100)));
  const upstream = upstreamDecision(headers);
  const decision = upstream ?? {
    keep: Math.random() * 100 < apmRate,
    reason: `no upstream decision — head sampler at ${apmRate}%`,
  };

  // Continue the browser's trace when there is one; otherwise this request
  // is the root of a brand-new trace that RUM knows nothing about.
  const continued = headers['x-datadog-trace-id'] != null;
  const body = {
    req: url.searchParams.get('req'),
    receivedHeaders: headers,
    decision: decision.keep ? 'keep' : 'drop',
    decidedBy: upstream ? 'rum' : 'backend',
    reason: decision.reason,
    traceId: continued ? headers['x-datadog-trace-id'] : randomTraceId(),
    continuedRumTrace: continued,
  };

  // A little latency so the requests look like requests in the waterfall.
  await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60));
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
