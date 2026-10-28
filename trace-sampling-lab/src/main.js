// Bundle entry for the Trace Sampling lab: only the ReactFlow diagram on the
// Flow tab. Everything else — RUM init, the request runner, the network
// table — is plain page code in ../app.js, which loads first and defines
// window.traceLab.
//
// ReactFlow's stylesheet is loaded from the CDN in index.html, pinned to the
// same version as package.json: the build only publishes dist/bundle.js, so
// a CSS file esbuild split out of this import graph would never ship.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import SamplingFlow from './SamplingFlow.jsx';

let root = null;

window.traceLab = window.traceLab ?? {};
window.traceLab.mountFlow = function mountFlow(el) {
  if (root || !el) return;
  const live = window.traceLab.liveConfig ?? {};
  const initial = {
    requests: 1000,
    sessionRate: 100,
    traceRate: live.traceSampleRate ?? 20,
    apmRate: live.apmRate ?? 50,
    injection: live.traceContextInjection ?? 'sampled',
  };
  root = createRoot(el);
  // createElement, not JSX: esbuild only parses JSX in .jsx files.
  root.render(React.createElement(ReactFlowProvider, null, React.createElement(SamplingFlow, { initial })));
};
