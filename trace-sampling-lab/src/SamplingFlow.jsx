// SamplingFlow — a what-if model of where N browser requests end up, drawn
// as one graph with both traceContextInjection routes on it. The route the
// selected mode takes is lit; the other stays visible but muted, with the
// numbers it *would* carry, so the two can be compared without toggling.
//
// The counts are expected values computed from the rates — this is the
// model. The Requests tab is where the real SDK is measured.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Background, Controls, Handle, MarkerType, Panel, Position, ReactFlow, getBezierPath } from '@xyflow/react';

const COL = 280;
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

// Rows are lanes: keep → row 0, drop → row 1, backend decides → row 2,
// so most edges run level and only the branches curve.
//
// `route` marks the nodes and edges that only exist under one injection mode.
// Each node has a plain-language `detail` for the panel under the canvas and
// a `tech` line with the exact mechanism, for readers who want it.
function buildGraph(cfg, m) {
  const unsampled = m.unsampled;
  const nodes = [
    { id: 'session', col: 0, row: 2, kind: 'rum', eyebrow: `RUM · sessionSampleRate ${cfg.sessionRate}%`, label: 'Is RUM tracking this session?',
      summary: `${fmt(m.tracked)} yes · ${fmt(m.untracked)} no`,
      detail: `Everything starts with a RUM session. If RUM isn't tracking the session at all, it can't trace anything in it, so its requests leave without trace headers. Here ${fmt(m.tracked)} of ${fmt(m.requests)} requests come from tracked sessions.`,
      tech: 'Only fetch/XHR calls to URLs in allowedTracingUrls are considered. With no tracked session, the RUM tracer returns early: no headers, and no trace ID on the resource event.' },
    { id: 'decision', col: 1, row: 1, kind: 'rum', eyebrow: `RUM · traceSampleRate ${cfg.traceRate}%`, label: 'Does RUM trace this session?',
      summary: `${fmt(m.sampled)} yes · ${fmt(unsampled)} no`,
      detail: `RUM picks about ${cfg.traceRate}% of tracked sessions to trace. The choice is made once per session, not per request: a traced session sends "keep" on every request, and an untraced one never does.`,
      tech: 'isSampled(session.id, traceSampleRate): a Knuth-factor hash of the session ID, cached per rate.' },
    { id: 'untracked', col: 1, row: 3, kind: 'header', eyebrow: 'Not tracked', label: 'Sent with no headers',
      summary: `${fmt(m.untracked)} requests`,
      detail: 'These requests reach the backend exactly as if RUM weren\'t on the page. Whatever the backend keeps from them is a trace with no RUM resource to link to.' },
    { id: 'hdrKeep', col: 2, row: 0, kind: 'header', eyebrow: 'Request · both options', label: 'Sent with "keep"',
      summary: `${fmt(m.sampled)} requests`,
      detail: 'Traced sessions send trace headers that say "keep" under either traceContextInjection option. RUM records the same trace ID on its resource event, which is what lets you jump from RUM to the trace.',
      tech: 'x-datadog-sampling-priority: 1, traceparent ending -01, tracestate dd=s:1;o:rum.' },
    { id: 'hdrDrop', col: 2, row: 1, kind: 'header', route: 'all', eyebrow: "Request · only with 'all'", label: 'Sent with "drop"',
      summary: `${fmt(unsampled)} requests`,
      detail: "With 'all', the untraced sessions still send trace headers, but they say \"drop\". The browser has made the decision for the backend.",
      tech: 'x-datadog-sampling-priority: 0, traceparent ending -00, tracestate dd=s:0;o:rum. The RUM resource event gets no _dd.trace_id.' },
    { id: 'noHdr', col: 2, row: 2, kind: 'header', route: 'sampled', eyebrow: "Request · only with 'sampled'", label: 'Sent with no headers',
      summary: `${fmt(unsampled)} requests`,
      detail: "With 'sampled' (the default), the untraced sessions send no trace headers at all. The backend gets no instruction, so it decides for itself." },
    { id: 'honorKeep', col: 3, row: 0, kind: 'backend', eyebrow: 'Your backend', label: 'Follows the browser: keep',
      summary: `${fmt(m.sampled)} kept`,
      detail: 'A Datadog tracer that receives a decision passes it along instead of making its own, so the whole trace, browser to database, is kept.' },
    { id: 'honorDrop', col: 3, row: 1, kind: 'backend', route: 'all', eyebrow: 'Your backend', label: 'Follows the browser: drop',
      summary: `${fmt(unsampled)} dropped`,
      detail: 'The "drop" decision is followed just like "keep". The backend\'s own sample rate never applies to these requests.',
      tech: 'On a real tracer, the error and rare samplers can still keep a few of these. They aren\'t modelled here.' },
    { id: 'apm', col: 3, row: 2, kind: 'backend', eyebrow: `Your backend · DD_TRACE_SAMPLE_RATE ${cfg.apmRate}%`, label: 'Decides on its own',
      summary: `${fmt(m.toApm)} in → ${fmt(m.apmKeep)} kept`,
      detail: `With no decision from the browser, the backend starts a brand-new trace and keeps about ${cfg.apmRate}% of them.`,
      tech: 'This lab uses one flat rate. By default a real Agent picks rates itself, aiming for about 10 traces per second.' },
    { id: 'ddLinked', col: 4, row: 0, kind: 'datadog', eyebrow: 'In Datadog', label: `${fmt(m.linked)} traces linked to RUM`,
      summary: 'open them from the RUM resource',
      detail: 'These are the only traces you can reach from a RUM session. Their number depends on the two RUM rates alone: the backend\'s rate never changes it.' },
    { id: 'droppedP0', col: 4, row: 1, kind: 'drop', route: 'all', eyebrow: 'Not kept', label: `${fmt(unsampled)} dropped, as the browser asked`,
      summary: 'decided in the browser',
      detail: "In 'all' mode, the browser decides these requests too, and the answer is drop. No backend setting brings them back." },
    { id: 'ddBackend', col: 4, row: 2, kind: 'datadog', eyebrow: 'In Datadog', label: `${fmt(m.apmKeep)} backend-only traces`,
      summary: 'no link back to RUM',
      detail: 'The backend kept these on its own. They show up in APM, but no RUM resource points to them.' },
    { id: 'droppedApm', col: 4, row: 3, kind: 'drop', eyebrow: 'Not kept', label: `${fmt(m.apmDrop)} dropped by the backend`,
      summary: 'decided by the backend\'s sampler',
      detail: 'The backend\'s own sampler chose not to keep these.' },
  ];

  // No labels on the edges: every node already states its count, and the
  // stroke width shows the volume.
  const edges = [
    { source: 'session', target: 'decision', count: m.tracked },
    { source: 'session', target: 'untracked', count: m.untracked },
    { source: 'decision', target: 'hdrKeep', count: m.sampled },
    { source: 'decision', target: 'hdrDrop', count: unsampled, route: 'all' },
    { source: 'decision', target: 'noHdr', count: unsampled, route: 'sampled' },
    { source: 'hdrKeep', target: 'honorKeep', count: m.sampled },
    { source: 'hdrDrop', target: 'honorDrop', count: unsampled, route: 'all' },
    { source: 'noHdr', target: 'apm', count: unsampled, route: 'sampled' },
    { source: 'untracked', target: 'apm', count: m.untracked },
    { source: 'honorKeep', target: 'ddLinked', count: m.sampled },
    { source: 'honorDrop', target: 'droppedP0', count: unsampled, route: 'all' },
    { source: 'apm', target: 'ddBackend', count: m.apmKeep },
    { source: 'apm', target: 'droppedApm', count: m.apmDrop },
  ];
  return { nodes, edges };
}

// One request's trip, drawn at random from the same rates as the counts.
function pickTrip(cfg) {
  const roll = (pct) => Math.random() * 100 < pct;
  const trip = ['session'];
  if (!roll(cfg.sessionRate)) trip.push('untracked', 'apm');
  else if (roll(cfg.traceRate)) trip.push('decision', 'hdrKeep', 'honorKeep', 'ddLinked');
  else if (cfg.injection === 'all') trip.push('decision', 'hdrDrop', 'honorDrop', 'droppedP0');
  else trip.push('decision', 'noHdr', 'apm');
  if (trip.at(-1) === 'apm') trip.push(roll(cfg.apmRate) ? 'ddBackend' : 'droppedApm');
  return trip;
}

// What each stop means for the one request being followed.
const TRIP_STEP = {
  session: 'starts in a RUM session',
  decision: 'RUM is tracking the session',
  untracked: 'RUM isn\'t tracking the session, so no headers',
  hdrKeep: 'RUM traces the session: "keep" headers',
  hdrDrop: 'RUM doesn\'t trace the session: "drop" headers',
  noHdr: 'RUM doesn\'t trace the session: no headers',
  honorKeep: 'the backend keeps it, as asked',
  honorDrop: 'the backend drops it, as asked',
  apm: 'no word from RUM, so the backend decides',
  ddLinked: 'a trace linked to RUM',
  droppedP0: 'nothing is kept',
  ddBackend: 'the backend keeps it: a backend-only trace',
  droppedApm: 'the backend drops it: nothing is kept',
};

const STEP_MS = 900;
const DOT_SECONDS = 2.4;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
        data-visited={data.visited}
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

// A curve with dots moving along it, more of them on busier edges,
// plus the token for the request being followed when it's on this edge.
// SMIL rather than CSS: animateMotion follows the edge's own path.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data }) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const token = useRef(null);
  useEffect(() => { if (data.token) token.current?.beginElement(); }, [data.token]);
  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {Array.from({ length: data.dots }, (_, i) => (
        <circle key={i} r="3" fill={data.color} className="flow-dot">
          <animateMotion dur={`${DOT_SECONDS}s`} begin={`${(-i * DOT_SECONDS) / data.dots}s`} repeatCount="indefinite" path={path} />
        </circle>
      ))}
      {data.token && (
        <circle key={data.token} r="8" className="flow-token">
          <animateMotion ref={token} dur={`${STEP_MS}ms`} begin="indefinite" fill="freeze" path={path} />
        </circle>
      )}
    </>
  );
}

const NODE_TYPES = { lab: FlowNode };
const EDGE_TYPES = { lab: FlowEdge };
// DRUIDS: paths the current settings send requests down are the interaction
// blue; the other option's route and empty edges stay in the border color.
const EDGE_ACTIVE = 'var(--ui-interaction-primary)';
const EDGE_IDLE = 'var(--form-border)';

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

function RateSlider({ label, code, value, onChange }) {
  return (
    <label className="flow-control">
      <span className="flow-control__label">{label} <output>{value}%</output></span>
      <input type="range" min="0" max="100" step="1" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="flow-control__hint"><code>{code}</code></span>
    </label>
  );
}

const LEGEND = [
  ['rum', 'RUM, in the browser'],
  ['header', 'What the request carries'],
  ['backend', 'Your backend'],
  ['datadog', 'Ends up in Datadog'],
  ['drop', 'Not kept'],
];

export default function SamplingFlow({ initial }) {
  const theme = useTheme();
  const [cfg, setCfg] = useState(initial);
  const [selectedId, setSelectedId] = useState('decision');
  // { key, stops, step }: the token is on the edge stops[step] → stops[step + 1].
  const [trip, setTrip] = useState(null);
  const tripCount = useRef(0);
  const followOne = () => setTrip({ key: ++tripCount.current, stops: pickTrip(cfg), step: 0 });
  useEffect(() => {
    if (!trip || trip.step >= trip.stops.length - 1) return undefined;
    const t = setTimeout(() => setTrip((x) => x && { ...x, step: x.step + 1 }), STEP_MS);
    return () => clearTimeout(t);
  }, [trip]);
  // Once the request arrives, open the details for where it ended up.
  const tripDone = !!trip && trip.step === trip.stops.length - 1;
  useEffect(() => { if (tripDone) setSelectedId(trip.stops.at(-1)); }, [tripDone, trip?.key]);
  const set = (key) => (value) => setCfg((c) => ({ ...c, [key]: value }));

  const m = useMemo(() => model(cfg), [cfg]);
  const other = useMemo(() => model({ ...cfg, injection: cfg.injection === 'all' ? 'sampled' : 'all' }), [cfg]);
  const graph = useMemo(() => buildGraph(cfg, m), [cfg, m]);

  const { nodes, edges } = useMemo(() => {
    const isMuted = (route) => !!route && route !== cfg.injection;
    const max = Math.max(1, cfg.requests);
    const visited = new Set(trip ? trip.stops.slice(0, trip.step + 1) : []);
    const tokenEdge = trip && !tripDone ? `${trip.stops[trip.step]}-${trip.stops[trip.step + 1]}` : null;
    const motion = !reducedMotion();
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
          visited: visited.has(n.id),
          onSelect: setSelectedId,
        },
      })),
      edges: graph.edges.map((e) => {
        const muted = isMuted(e.route);
        const empty = e.count <= 0;
        const color = !muted && !empty ? EDGE_ACTIVE : EDGE_IDLE;
        const id = `${e.source}-${e.target}`;
        return {
          id,
          source: e.source,
          target: e.target,
          type: 'lab',
          data: {
            color,
            dots: motion && !muted && !empty ? Math.max(1, Math.round(3 * (e.count / max))) : 0,
            token: id === tokenEdge ? `${trip.key}-${trip.step}` : null,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color, markerUnits: 'userSpaceOnUse' },
          style: {
            stroke: color,
            strokeWidth: empty ? 1.5 : 2 + 4 * (e.count / max),
            strokeDasharray: muted || empty ? '6 5' : undefined,
            opacity: muted ? 0.3 : empty ? 0.5 : 1,
          },
        };
      }),
    };
  }, [graph, cfg.injection, cfg.requests, selectedId, trip, tripDone]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0];
  const modes = cfg.injection === 'all' ? [['all', m], ['sampled', other]] : [['all', other], ['sampled', m]];

  return (
    <section className="sampling-flow" aria-label="Trace sampling flow">
      <p className="lead">The first tab shows a handful of real requests. This one zooms out. Imagine {fmt(cfg.requests)} requests spread over many users' sessions, and follow where they end up. Each box is a stop on the trip. The numbers are what you'd expect on average. Click any box to read what happens there.</p>
      <ul className="flow-legend" aria-label="Legend">
        {LEGEND.map(([kind, text]) => (
          <li key={kind} data-kind={kind}><span className="swatch" />{text}</li>
        ))}
        <li><span className="swatch muted-route" />The path the other option would take</li>
      </ul>

      <div className="flow-controls">
        <div className="flow-control flow-control--wide">
          <span className="flow-control__label">When RUM doesn't trace a session, what should its requests carry?</span>
          <div className="flow-control__row">
            <div className="segmented" role="group" aria-label="traceContextInjection">
              {[['all', 'Headers that say "drop"'], ['sampled', 'No headers; let the backend decide']].map(([mode, text]) => (
                <button key={mode} type="button" aria-pressed={cfg.injection === mode} onClick={() => set('injection')(mode)}>
                  {text}<code>traceContextInjection: '{mode}'</code>
                </button>
              ))}
            </div>
            <button type="button" className="flow-reset" onClick={() => setCfg(initial)}>Reset to the live tab's settings</button>
          </div>
        </div>
        <label className="flow-control">
          <span className="flow-control__label">Requests</span>
          <input type="number" min="1" max="10000000" step="100" value={cfg.requests}
            onChange={(e) => set('requests')(Math.max(1, Number(e.target.value) || 1))} />
          <span className="flow-control__hint">across many sessions</span>
        </label>
        <RateSlider label="Sessions RUM tracks" code="sessionSampleRate" value={cfg.sessionRate} onChange={set('sessionRate')} />
        <RateSlider label="Sessions RUM traces" code="traceSampleRate" value={cfg.traceRate} onChange={set('traceRate')} />
        <RateSlider label="Backend's own sample rate" code="DD_TRACE_SAMPLE_RATE" value={cfg.apmRate} onChange={set('apmRate')} />
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
          <Panel position="top-left" className="flow-trip">
            <button type="button" className="btn btn--primary" onClick={followOne}>
              <span className="icon icon--14" data-icon="play" aria-hidden="true" />Follow one request
            </button>
            {trip && (
              <ol className="flow-trip__steps" aria-live="polite">
                {trip.stops.slice(0, trip.step + 1).map((id) => <li key={id}>{TRIP_STEP[id]}</li>)}
              </ol>
            )}
          </Panel>
          <Background gap={22} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flow-detail" aria-live="polite" data-kind={selected.kind}>
        <span className="flow-node__eyebrow">{selected.eyebrow}</span>
        <h4>{selected.label}</h4>
        <p>{selected.detail}</p>
        {selected.tech && <p className="tech">Under the hood: {selected.tech}</p>}
      </div>

      <div className="summary-box">
        <strong>The takeaway:</strong> with these settings, {fmt(m.total)} of {fmt(cfg.requests)} requests ({pct(m.total / Math.max(1, cfg.requests))}) become traces in Datadog.
        {' '}{fmt(m.linked)} of them link back to RUM, and {fmt(m.apmKeep)} exist only on the backend.
        {' '}Switching to <code>'{cfg.injection === 'all' ? 'sampled' : 'all'}'</code> would give {other.total === m.total ? 'the same total' : `${fmt(other.total)} instead`}. The traces linked to RUM stay at {fmt(m.linked)} either way: only the two RUM rates change that number.
      </div>

      <div className="compare-table-wrap">
        <table className="compare-table flow-compare">
          <thead>
            <tr>
              <th>Option</th>
              <th>Traces in Datadog</th>
              <th>Linked to RUM</th>
              <th>Backend-only</th>
              <th>Dropped, as the browser asked</th>
              <th>Dropped by the backend</th>
            </tr>
          </thead>
          <tbody>
            {modes.map(([mode, x]) => (
              <tr key={mode} data-active={mode === cfg.injection}>
                <td><code>'{mode}'</code>{mode === cfg.injection && <span className="type-badge view">showing</span>}</td>
                <td><strong>{fmt(x.total)}</strong> <span className="subtle">({pct(x.total / Math.max(1, x.requests))})</span></td>
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
