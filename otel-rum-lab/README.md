# 🔬 OTel Browser → Datadog RUM Lab

An experimental companion to the [Pizza Builder](../) demo, exploring a different question: instead of the `datadog-rum` browser SDK, what happens if you send browser telemetry to Datadog using only **standard OpenTelemetry** — the official [`@opentelemetry/browser-instrumentation`](https://github.com/open-telemetry/opentelemetry-browser) package with stock auto-instrumentation, exported over OTLP?

This is exploratory and educational, runs entirely as static files (this whole page works standalone, including on GitHub Pages, with zero backend required), and isn't a statement about what Datadog does or doesn't support — it's a hands-on look at the moving pieces involved in getting a browser OTel pipeline talking to Datadog at all, run against the same pizza wizard flow as the main demo so the two are easy to compare.

## The basic pattern

```
Browser
 ├─ @opentelemetry/browser-instrumentation
 │    (navigation, clicks, errors, web vitals, resource timing, console — all as log events)
 ├─ @opentelemetry/sdk-logs
 ├─ a LogRecordProcessor tap
 │    → renders every log into an on-page table, live, before export
 └─ OTLP logs exporter (optional — off by default)
        │
        ▼  (only if you opt in with ?proxy=...)
   your own local proxy (Node)
        │  adds the Datadog API key server-side
        ▼
   Datadog OTLP intake
```

Two things shape the whole design:

**1. Everything here is log-based, not span-based — on purpose.** `@opentelemetry/browser-instrumentation` publishes separate modules for navigation, clicks, errors, web vitals, resource timing, and console capture, and all of them emit OpenTelemetry **log records**, not spans. That means the whole pipeline needs is `@opentelemetry/sdk-logs` — no `sdk-trace-web`, no Zone.js/`context-zone`, no per-instrumentation trace-context plumbing. (The same package also ships `fetch`/`xhr` instrumentations, but those two are span-based and need a full trace pipeline to do anything; this lab leaves them out to stay minimal — see "What's not included" below.) Dropping the span pipeline entirely roughly halved the bundle size compared to an earlier version of this lab that assembled `sdk-trace-web` + individual instrumentation packages by hand.

**2. Datadog's OTLP intake is authenticated with a real API key (`dd-api-key` header), not a public client token.** The RUM SDK's `clientToken` is explicitly designed to be embedded in shipped JS; a Datadog API key is not — even a scoped one, since intake is billed on volume and a leaked key can still be used to run up ingestion costs. So **this page never holds a key, and OTLP export is off by default.** The live event table works with zero network calls either way — that's the actual educational payload. If you want to see events actually land in Datadog, add `?proxy=http://localhost:8791` to the URL, and run the small local proxy in `proxy/server.js` (~20 lines) that holds the real key server-side and forwards the OTLP payload through untouched.

## The live event table

The most reusable piece of this lab, independent of Datadog: a `LogRecordProcessor` registered *ahead of* the OTLP export processor. Every log — whether it came from stock auto-instrumentation (a click, a navigation change, a web vital) or from something the app emitted on purpose — passes through it before export:

```javascript
export class LiveTableLogProcessor {
  onEmit(logRecord) {
    renderRow(logRecord.eventName, logRecord.attributes);
  }
  // forceFlush / shutdown required by the LogRecordProcessor interface
}
```

This is the direct OpenTelemetry equivalent of the RUM SDK's `beforeSend` callback that powers the event log table in the main demo — same idea, different SDK.

Every log record also prints to the devtools console via `@opentelemetry/sdk-logs`'s built-in `ConsoleLogRecordExporter` — the same one the [official getting-started guide](https://opentelemetry.io/docs/languages/js/getting-started/browser/) uses. It's on by default alongside the on-page table; add `?console=0` to the URL to turn it off.

## What this app instruments

| Wizard behavior | Instrumentation | Event name |
|---|---|---|
| Hash change (`#crust`, `#sauce`, …) | `NavigationInstrumentation` (patches `history.pushState`/`popstate`/hash changes automatically) | `browser.navigation` |
| Any click | `UserActionInstrumentation` | `browser.user_action.click` |
| Page load performance | `WebVitalsInstrumentation` | `browser.web_vital` |
| "Fake backend call" button | `ResourceTimingInstrumentation` (observes the Resource Timing API passively) | `browser.resource_timing` |
| "Force an error" button | `ErrorsInstrumentation` (listens for `window.onerror` / `unhandledrejection`) | `exception` |
| `console.warn` / `console.error` | `ConsoleInstrumentation` | `browser.console.log` |
| Final submit | a custom log event we emit ourselves | `pizza_order_submitted` |
| Session lifecycle | our own session-id tracking, modeled on the RUM SDK's session rules | `session.start` / `session.end` |

Everything in the first six rows is stock instrumentation from the npm package — nothing hand-rolled. Only the last two rows are this app's own code.

## What's not included

- **Trace/span correlation.** `@opentelemetry/browser-instrumentation` also ships `fetch` and `xhr` instrumentations, but unlike everything above, those two create spans (they need a `TracerProvider`, not just a `LoggerProvider`). Wiring that up would mean adding `@opentelemetry/sdk-trace-web` back in — reversing the bundle-size win this lab is built around. If you want to explore trace correlation, that's a good next branch to try, just as a separate, explicitly heavier addition rather than default behavior here.
- **Anything asserting how Datadog actually maps these events once ingested.** That depends on what's live in your own Datadog org at the time you test it — this README describes what the browser sends, not what Datadog does with it.

## Running locally

```bash
npm install
npm run build     # bundles src/main.js → dist/bundle.js
npx serve .        # any static file server works — not file://, instrumentation needs real HTTP
```

Open the page and click through the wizard — the live event table fills in immediately, no proxy or API key required.

To also forward events to a real Datadog org, copy `.env.example` to `.env` with a real API key and your org's OTLP logs endpoint, then:

```bash
npm run proxy                              # in a second terminal
# visit http://localhost:PORT/?proxy=http://localhost:8791
```

## Deployment

`dist/` is gitignored — it's a build output, not source. The repo's GitHub Pages workflow builds this lab (`npm ci && npm run build`) before publishing, so the committed source is all that needs to exist; the bundle is generated fresh on every deploy.

## Stack

- [OpenTelemetry JS SDK](https://opentelemetry.io/docs/languages/js/getting-started/browser/) — `sdk-logs` and `api-logs`
- [`@opentelemetry/browser-instrumentation`](https://github.com/open-telemetry/opentelemetry-browser) — the official browser event instrumentations
- [Datadog OTLP ingest](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/) — public docs on sending OTLP directly to Datadog
- esbuild — bundles the npm-only OTel packages for the browser
- A minimal Node proxy — the only thing holding the real API key, and entirely optional
