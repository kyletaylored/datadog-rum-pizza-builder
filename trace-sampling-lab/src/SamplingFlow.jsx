// SamplingFlow — a what-if model of where N browser requests end up, drawn
// as one graph with both traceContextInjection routes on it. The route the
// selected mode takes is lit; the other stays visible but muted, with the
// numbers it *would* carry, so the two can be compared without toggling.
//
// The counts are expected values computed from the rates — this is the
// model. The Requests tab is where the real SDK is measured.

import React, { useEffect, useMemo, useState } from 'react';
import { BaseEdge, Background, Controls, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlow, getSmoothStepPath } from '@xyflow/react';

const COL = 260;
const ROW = 140;

const fmt = (n) => Math.round(n).toLocaleString();
const pct = (n) => `${Math.round(n * 1000) / 10}%`;

export function model({ requests, sessionRate, traceRate, apmRate, injection }) {
  const s = sessionRate / 100;
  const r = traceRate / 100;
  const a = apmRate / 100;
  const tracked = requests * s;
  const untracked = requests - tracked;
  const sampled = tracked * r;
  const unsampled = tracked - sampled;
  const toApm = untracked + (injection === 'sampled' ? unsampled : 0);
  return {
    requests, tracked, untracked, sampled, unsampled, toApm,
    droppedByPriority: injection === 'all' ? unsampled : 0,
    apmKeep: toApm * a,
    apmDrop: toApm * (1 - a),
    linked: sampled,
    total: sampled + toApm * a,
  };
}

// `route` marks the nodes and edges that only exist under one injection mode.
function buildGraph(cfg, m) {
  const unsampled = m.unsampled;
  const nodes = [
    { id: 'session', col: 0, row: 1.25, kind: 'rum', eyebrow: `sessionSampleRate ${cfg.sessionRate}%`, label: `${fmt(m.requests)} requests: session tracked?`,
      summary: `${fmt(m.tracked)} tracked · ${fmt(m.untracked)} not`,
      detail: 'Only fetch/XHR calls to URLs matching allowedTracingUrls are considered at all. For those, the tracer looks up the tracked RUM session first. With no tracked session it returns early: no headers, no trace ID on any resource event, whatever traceSampleRate or traceContextInjection say.' },
    { id: 'decision', col: 1, row: 0.5, kind: 'rum', eyebrow: `traceSampleRate ${cfg.traceRate}%`, label: 'RUM trace decision',
      summary: `${fmt(m.sampled)} sampled · ${fmt(unsampled)} not`,
      detail: 'isSampled(session.id, traceSampleRate) — a Knuth-factor hash of the session ID, cached per rate. The decision is per session, not per request: within one session every request gets the same answer. Across many sessions it averages out to traceSampleRate.' },
    { id: 'untracked', col: 1, row: 2.75, kind: 'header', eyebrow: 'Session not tracked', label: 'No trace headers',
      summary: `${fmt(m.untracked)} requests`,
      detail: 'These requests reach the backend exactly as if the RUM SDK were not there. Whatever the backend keeps from them starts a new trace with no RUM resource to link to.' },
    { id: 'hdrKeep', col: 2, row: 0, kind: 'header', eyebrow: 'Both modes', label: 'priority 1 · traceparent …-01',
      summary: `${fmt(m.sampled)} requests`,
      detail: 'Sampled requests get headers in both modes: x-datadog-trace-id / parent-id / origin: rum / sampling-priority: 1, plus traceparent with flags 01 and tracestate dd=s:1;o:rum. The RUM resource event carries the same _dd.trace_id.' },
    { id: 'hdrDrop', col: 2, row: 1, kind: 'header', route: 'all', eyebrow: "traceContextInjection: 'all'", label: 'priority 0 · traceparent …-00',
      summary: `${fmt(unsampled)} requests`,
      detail: "With 'all', unsampled requests still get the full header set, but with priority 0 and flags 00. RUM's resource event gets no _dd.trace_id for them, so even a trace the backend kept anyway would have nothing to link to." },
    { id: 'noHdr', col: 2, row: 2, kind: 'header', route: 'sampled', eyebrow: "traceContextInjection: 'sampled'", label: 'No trace headers',
      summary: `${fmt(unsampled)} requests`,
      detail: "With 'sampled' (the v6 default), unsampled requests get no tracing headers at all — so the decision moves to the backend, which samples them like any other request it receives." },
    { id: 'honorKeep', col: 3, row: 0, kind: 'backend', eyebrow: 'Backend tracer', label: 'Honors upstream: keep',
      summary: `${fmt(m.sampled)} kept`,
      detail: 'A tracer that receives a sampling decision propagates it rather than making its own — the whole distributed trace is kept.' },
    { id: 'honorDrop', col: 3, row: 1, kind: 'backend', route: 'all', eyebrow: 'Backend tracer', label: 'Honors upstream: drop',
      summary: `${fmt(unsampled)} dropped`,
      detail: 'Priority 0 propagates as well. The trace is dropped by head-based sampling; on a real tracer, the error and rare samplers can still keep a few.' },
    { id: 'apm', col: 3, row: 2.5, kind: 'backend', eyebrow: `DD_TRACE_SAMPLE_RATE ${cfg.apmRate / 100}`, label: 'APM head sampler',
      summary: `${fmt(m.toApm)} in → ${fmt(m.apmKeep)} kept`,
      detail: 'No upstream decision, so this service is the root of a new trace and samples it itself. In this lab that is a flat rate; a real Agent can also compute rates itself (the default is a target of 10 traces per second).' },
    { id: 'ddLinked', col: 4, row: 0, kind: 'datadog', eyebrow: 'Datadog', label: `${fmt(m.linked)} traces linked to RUM`,
      summary: 'click through from the RUM resource',
      detail: 'Only these traces connect a RUM resource to its backend trace. This number depends on sessionSampleRate × traceSampleRate alone — the backend rate never changes it.' },
    { id: 'droppedP0', col: 4, row: 1, kind: 'drop', route: 'all', eyebrow: 'Not ingested', label: `${fmt(unsampled)} dropped by priority 0`,
      summary: 'decided in the browser',
      detail: "In 'all' mode the browser decides for these requests too, and the decision is to drop. Backend sampling rates have no effect on them." },
    { id: 'ddBackend', col: 4, row: 2.1, kind: 'datadog', eyebrow: 'Datadog', label: `${fmt(m.apmKeep)} backend-only traces`,
      summary: 'no RUM resource to link to',
      detail: 'Kept by the backend but started there, so they show up in APM without a RUM link.' },
    { id: 'droppedApm', col: 4, row: 3.1, kind: 'drop', eyebrow: 'Not ingested', label: `${fmt(m.apmDrop)} dropped by APM sampler`,
      summary: 'decided in the backend',
      detail: 'Dropped by the backend\'s own head sampler.' },
  ];

  const edges = [
    { source: 'session', target: 'decision', count: m.tracked, label: 'tracked' },
    { source: 'session', target: 'untracked', count: m.untracked, label: 'not tracked' },
    // No labels on the three branches out of the decision: the gap between
    // columns is too narrow for them, and each target node shows its count.
    { source: 'decision', target: 'hdrKeep', count: m.sampled, bare: true },
    { source: 'decision', target: 'hdrDrop', count: unsampled, route: 'all', bare: true },
    { source: 'decision', target: 'noHdr', count: unsampled, route: 'sampled', bare: true },
    { source: 'hdrKeep', target: 'honorKeep', count: m.sampled },
    { source: 'hdrDrop', target: 'honorDrop', count: unsampled, route: 'all' },
    { source: 'noHdr', target: 'apm', count: unsampled, route: 'sampled' },
    { source: 'untracked', target: 'apm', count: m.untracked },
    { source: 'honorKeep', target: 'ddLinked', count: m.sampled },
    { source: 'honorDrop', target: 'droppedP0', count: unsampled, route: 'all' },
    { source: 'apm', target: 'ddBackend', count: m.apmKeep, label: 'keep' },
    { source: 'apm', target: 'droppedApm', count: m.apmDrop, label: 'drop' },
  ];
  return { nodes, edges };
}

function FlowNode({ data }) {
  return (
    <>
      {data.hasIn && <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />}
      <div
        className="flow-node nodrag nopan"
        role="button"
        tabIndex={0}
        aria-pressed={data.selected}
        data-kind={data.kind}
        data-selected={data.selected}
        data-muted={data.muted}
        onClick={() => data.onSelect(data.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            data.onSelect(data.id);
          }
        }}
      >
        <span className="flow-node__eyebrow">{data.eyebrow}</span>
        <strong>{data.label}</strong>
        <span className="flow-node__summary">{data.summary}</span>
      </div>
      {data.hasOut && <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />}
    </>
  );
}

// HTML labels via EdgeLabelRenderer rather than SVG text, so they get the
// page's fonts and colors and can sit on a solid background.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, label, data }) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10 });
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="flow-edge__label nodrag nopan"
            data-muted={data.muted}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { lab: FlowNode };
const EDGE_TYPES = { lab: FlowEdge };

function useTheme() {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function RateSlider({ label, hint, value, onChange }) {
  return (
    <label className="flow-control">
      <span className="flow-control__label">{label} <output>{value}%</output></span>
      <input type="range" min="0" max="100" step="1" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="flow-control__hint">{hint}</span>
    </label>
  );
}

export default function SamplingFlow({ initial }) {
  const theme = useTheme();
  const [cfg, setCfg] = useState(initial);
  const [selectedId, setSelectedId] = useState('decision');
  const set = (key) => (value) => setCfg((c) => ({ ...c, [key]: value }));

  const m = useMemo(() => model(cfg), [cfg]);
  const other = useMemo(() => model({ ...cfg, injection: cfg.injection === 'all' ? 'sampled' : 'all' }), [cfg]);
  const graph = useMemo(() => buildGraph(cfg, m), [cfg, m]);

  const { nodes, edges } = useMemo(() => {
    const isMuted = (route) => !!route && route !== cfg.injection;
    const max = Math.max(1, cfg.requests);
    return {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        type: 'lab',
        position: { x: n.col * COL, y: n.row * ROW },
        draggable: false,
        selectable: false,
        data: {
          ...n,
          hasIn: graph.edges.some((e) => e.target === n.id),
          hasOut: graph.edges.some((e) => e.source === n.id),
          selected: n.id === selectedId,
          muted: isMuted(n.route),
          onSelect: setSelectedId,
        },
      })),
      edges: graph.edges.map((e, i) => {
        const muted = isMuted(e.route);
        const live = !muted && e.count > 0;
        return {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          type: 'lab',
          animated: live,
          label: e.bare ? undefined : `${e.label ? `${e.label} · ` : ''}${fmt(e.count)}`,
          data: { muted },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: {
            strokeWidth: 1.5 + 7 * (e.count / max),
            strokeDasharray: muted ? '5 5' : undefined,
            opacity: muted ? 0.3 : live ? 1 : 0.45,
          },
        };
      }),
    };
  }, [graph, cfg.injection, cfg.requests, selectedId]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0];
  const modes = cfg.injection === 'all' ? [['all', m], ['sampled', other]] : [['all', other], ['sampled', m]];

  return (
    <section className="sampling-flow" aria-label="Trace sampling flow">
      <div className="flow-controls">
        <label className="flow-control">
          <span className="flow-control__label">Requests</span>
          <input type="number" min="1" max="10000000" step="100" value={cfg.requests}
            onChange={(e) => set('requests')(Math.max(1, Number(e.target.value) || 1))} />
          <span className="flow-control__hint">across many sessions</span>
        </label>
        <RateSlider label="sessionSampleRate" hint="RUM — sessions tracked" value={cfg.sessionRate} onChange={set('sessionRate')} />
        <RateSlider label="traceSampleRate" hint="RUM — per session" value={cfg.traceRate} onChange={set('traceRate')} />
        <RateSlider label="DD_TRACE_SAMPLE_RATE" hint="APM — head sampler" value={cfg.apmRate} onChange={set('apmRate')} />
        <div className="flow-control">
          <span className="flow-control__label">traceContextInjection</span>
          <div className="mode-picker">
            {['all', 'sampled'].map((mode) => (
              <button key={mode} type="button" className={`wa-neutral wa-outlined${cfg.injection === mode ? ' active' : ''}`}
                aria-pressed={cfg.injection === mode} onClick={() => set('injection')(mode)}>
                '{mode}'
              </button>
            ))}
          </div>
          <button type="button" className="wa-neutral wa-plain flow-reset" onClick={() => setCfg(initial)}>Reset to the Requests tab's config</button>
        </div>
      </div>

      <div className="flow-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          colorMode={theme}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flow-detail" aria-live="polite" data-kind={selected.kind}>
        <span className="flow-node__eyebrow">{selected.eyebrow}</span>
        <h4>{selected.label}</h4>
        <p>{selected.detail}</p>
      </div>

      <div className="compare-table-wrap">
        <table className="compare-table flow-compare">
          <thead>
            <tr>
              <th>traceContextInjection</th>
              <th>Traces in Datadog</th>
              <th>Linked to RUM</th>
              <th>Backend-only</th>
              <th>Dropped by priority 0</th>
              <th>Dropped by APM sampler</th>
            </tr>
          </thead>
          <tbody>
            {modes.map(([mode, x]) => (
              <tr key={mode} data-active={mode === cfg.injection}>
                <td><code>'{mode}'</code>{mode === cfg.injection && <span className="type-badge info">selected</span>}</td>
                <td><strong>{fmt(x.total)}</strong> <span className="muted">({pct(x.total / Math.max(1, x.requests))})</span></td>
                <td>{fmt(x.linked)}</td>
                <td>{fmt(x.apmKeep)}</td>
                <td>{fmt(x.droppedByPriority)}</td>
                <td>{fmt(x.apmDrop)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
