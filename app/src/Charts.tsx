import { useEffect, useMemo, useRef, useState } from 'react';
import { acc, fmtPct, fmtUsd, mean, percentile, summarize } from './lib/summary';
import type { CaseResult } from './lib/types';

interface Point { model: string; label: string; accuracy: number; cost: number; brier: number; p50: number; n: number }
const short = (model: string) => model.split('/').pop()!;

function MetricChart({ title, note, points, value, format, max, colors }: {
  title: string; note: string; points: Point[]; value: (p: Point) => number; format: (n: number) => string;
  max: number; colors: Map<string, string>;
}) {
  return <figure className="metric-chart">
    <figcaption><h3>{title}</h3><p className="muted small-text">{note}</p></figcaption>
    <ol className="metric-bars">
      {points.map((p) => <li key={p.model} title={p.model}>
        <div className="metric-label"><span>{p.label}</span><strong>{format(value(p))}</strong></div>
        <div className="metric-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, value(p) / max * 100))}%`, background: colors.get(p.model) }} /></div>
      </li>)}
    </ol>
    {!points.length && <p className="muted">No measurements available.</p>}
  </figure>;
}

function Scatter({ points, colors }: { points: Point[]; colors: Map<string, string> }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const active = points.find((p) => p.model === (hovered ?? selected));
  const height = width < 500 ? 340 : 440;
  const left = 44, right = 22, top = 30, bottom = 54;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maxCost = Math.max(...points.map((p) => p.cost), 1e-9) * 1.12;
  const low = Math.max(0, Math.floor((Math.min(...points.map((p) => p.accuracy)) - 0.05) * 10) / 10);
  const x = (cost: number) => left + plotWidth * Math.sqrt(cost / maxCost);
  const y = (accuracy: number) => top + plotHeight * (1 - (accuracy - low) / (1 - low));
  const ticks = [low, low + (1 - low) / 3, low + 2 * (1 - low) / 3, 1];
  const labeled = new Set([...points].sort((a, b) => b.accuracy - a.accuracy || a.model.localeCompare(b.model)).slice(0, 3).map((p) => p.model));
  if (active) labeled.add(active.model);
  const placed: { x: number; y: number }[] = [];
  const labelPositions = new Map<string, { x: number; y: number }>();
  for (const p of points.filter((p) => labeled.has(p.model)).sort((a, b) => y(a.accuracy) - y(b.accuracy))) {
    const labelX = Math.min(width - 155, Math.max(left + 8, x(p.cost) + 10));
    let labelY = Math.max(18, y(p.accuracy) - 12);
    while (placed.some((q) => Math.abs(q.x - labelX) < 145 && Math.abs(q.y - labelY) < 18)) labelY += 19;
    labelY = Math.min(height - bottom - 5, labelY);
    placed.push({ x: labelX, y: labelY });
    labelPositions.set(p.model, { x: labelX, y: labelY });
  }
  return <figure className="scatter-chart">
    <figcaption className="scatter-heading"><div><h2>Accuracy vs cost</h2><p className="muted">Better decisions, less spend. Look toward the upper-left.</p></div><span className="chart-badge">{points.length} models compared</span></figcaption>
    <div ref={container} className="scatter-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Model accuracy versus total measured cost. Points show model details on focus or activation.">
        <text x={left} y={14} className="axis-label">Accuracy</text>
        {ticks.map((tick) => <g key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="scatter-grid" />
          <text x={left - 9} y={y(tick) + 4} textAnchor="end" className="axis-label">{fmtPct(tick)}</text>
        </g>)}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <g key={fraction}>
          <line x1={left + plotWidth * fraction} x2={left + plotWidth * fraction} y1={top} y2={height - bottom} className="scatter-grid vertical" />
          <text x={left + plotWidth * fraction} y={height - bottom + 20} textAnchor={fraction === 1 ? 'end' : fraction === 0 ? 'start' : 'middle'} className="axis-label">{fmtUsd(maxCost * fraction * fraction)}</text>
        </g>)}
        <text x={left + plotWidth / 2} y={height - 8} textAnchor="middle" className="axis-label">Total measured cost · USD · square-root scale</text>
        {points.map((p) => {
          const position = labelPositions.get(p.model);
          return <g key={p.model}>
            {position && <><line x1={x(p.cost)} y1={y(p.accuracy)} x2={position.x} y2={position.y - 4} className="label-leader" /><text x={position.x} y={position.y} className="point-label" aria-hidden="true">{p.label.length > 21 ? `${p.label.slice(0, 20)}…` : p.label}</text></>}
            <circle cx={x(p.cost)} cy={y(p.accuracy)} r={active?.model === p.model ? 9 : 6} fill={colors.get(p.model)} className="scatter-point"
              role="button" tabIndex={0} aria-label={`${p.model}: ${fmtPct(p.accuracy)} accuracy, ${fmtUsd(p.cost)} cost. Show details.`}
              aria-pressed={selected === p.model} onMouseEnter={() => setHovered(p.model)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(p.model)} onBlur={() => setHovered(null)} onClick={() => setSelected(selected === p.model ? null : p.model)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(selected === p.model ? null : p.model); } }} />
          </g>;
        })}
      </svg>
    </div>
    <div className="chart-inspector" aria-live="polite">
      {active ? <><span className="inspector-model"><span className="model-swatch" style={{ background: colors.get(active.model) }} />{active.model}</span><span><strong>{fmtPct(active.accuracy)}</strong> accuracy</span><span><strong>{fmtUsd(active.cost)}</strong> cost</span><span><strong>{Number.isFinite(active.brier) ? active.brier.toFixed(3) : '–'}</strong> Brier</span><span><strong>{Number.isFinite(active.p50) ? `${Math.round(active.p50)} ms` : '–'}</strong> median latency</span></> : <span className="muted">Hover, focus, or tap a point to inspect a model. Colors match the model filters.</span>}
    </div>
  </figure>;
}

export function Charts({ results, colors }: { results: CaseResult[]; colors: Map<string, string> }) {
  const points = useMemo<Point[]>(() => summarize(results).map((s) => ({
    model: s.model, label: short(s.model), accuracy: acc(s), cost: s.cost, brier: mean(s.brier), n: s.n,
    p50: s.latencies.length ? percentile(s.latencies, 0.5) : NaN,
  })), [results]);
  if (!points.length) return null;
  const accuracy = [...points].sort((a, b) => b.accuracy - a.accuracy || a.model.localeCompare(b.model));
  const brier = points.filter((p) => Number.isFinite(p.brier)).sort((a, b) => a.brier - b.brier || a.model.localeCompare(b.model));
  const latency = points.filter((p) => Number.isFinite(p.p50)).sort((a, b) => a.p50 - b.p50 || a.model.localeCompare(b.model));
  return <div className="report-charts">
    <Scatter points={points} colors={colors} />
    <div className="metric-grid">
      <MetricChart title="Accuracy" note="Higher is better · errors and skips count as wrong" points={accuracy} value={(p) => p.accuracy} format={fmtPct} max={1} colors={colors} />
      <MetricChart title="Brier score" note="Lower is better · answered cases with probabilities" points={brier} value={(p) => p.brier} format={(n) => n.toFixed(3)} max={Math.max(...brier.map((p) => p.brier), 0.01)} colors={colors} />
      <MetricChart title="Median latency" note="Lower is better · measured calls only" points={latency} value={(p) => p.p50} format={(n) => `${Math.round(n).toLocaleString()} ms`} max={Math.max(...latency.map((p) => p.p50), 1)} colors={colors} />
    </div>
  </div>;
}
