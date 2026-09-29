// Tap point for the live event table — the direct analog of the RUM SDK's
// `beforeSend`. Registered as an extra LogRecordProcessor alongside the
// OTLP export processor (when one is configured), so every log reaches
// here regardless of whether it's stock auto-instrumentation or something
// we emit ourselves, independent of whether export to Datadog is enabled.
//
// Deliberately dumb: table rendering (bucketing, column layout, filters)
// is page/site UI concerned with the site's own design system, not the
// OTel pipeline, so it lives in app.js — same split root's app.js and
// consent-lab/app.js already use for their own event logs. This just hands
// the raw record over.
export class LiveTableLogProcessor {
  onEmit(logRecord) {
    window.otelLab?.logEvent?.(logRecord);
  }

  shutdown() {
    return Promise.resolve();
  }

  forceFlush() {
    return Promise.resolve();
  }
}
