/**
 * app.js — the All labs home page. The page itself (cards, table, rail) is
 * rendered by ../lab-shared.js from labs.json; all this does is start RUM so
 * home-page views and the clicks into each lab are recorded too.
 *
 * Same application, service and version as every lab (window.DD_CONFIG), so
 * the source maps uploaded for this file resolve.
 */
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
    defaultPrivacyLevel: 'mask-user-input',
    sessionPersistence: 'cookie',
  });
});
