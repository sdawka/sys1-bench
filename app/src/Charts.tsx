import { useMemo, useState } from 'react';
import { acc, fmtPct, fmtUsd, mean, percentile, summarize } from './lib/summary';
import type { CaseResult } from './lib/types';

interface Pt { model: string; label: string; acc: number; cost: number; brier: number; p50: number; n: number }

const short = (m: string) => m.split('/').pop()!;
const W = 520, ROW = 24, LEFT = 150, RIGHT = 70;

function BarChart({ title, note, data, fmt, max, onHover }: {
  title: string; note?: string; data: { key: string; label: string; v: number; tip: string }[]; fmt: (v: number) => string; max: number;
  onHover: (t: string | null) => void;
}) {
  const H = data.length * ROW + 8;
  return (
    <figure className="chart">
      <figcaption><b>{title}</b>{note && <span className="muted small-text"> · {note}</span>}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {data.map((d, i) => {
          const y = i * ROW + 4;
          const w = Math.max(0, ((W - LEFT - RIGHT) * d.v) / (max || 1));
          return (
            <g key={d.key} onMouseEnter={() => onHover(d.tip)} onMouseLeave={() => onHover(null)}>
              <rect x={0} y={y} width={W} height={ROW} fill="transparent" />
              <text x={LEFT - 8} y={y + ROW / 2 + 4} textAnchor="end" className="ct">{d.label}</text>
              <rect x={LEFT} y={y + 4} width={w} height={ROW - 10} rx={4} className="cbar"><title>{d.tip}</title></rect>
              <text x={LEFT + w + 6} y={y + ROW / 2 + 4} className="ct strong">{fmt(d.v)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Scatter({ pts, onHover }: { pts: Pt[]; onHover: (t: string | null) => void }) {
  const H = 340, L = 48, B = 36, T = 12, R = 24;
  const maxC = Math.max(...pts.map((p) => p.cost), 1e-9) * 1.1;
  const lo = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.acc)) - 0.05) * 10) / 10);
  const x = (c: number) => L + ((W - L - R) * Math.sqrt(c / maxC));
  const y = (a: number) => T + (H - T - B) * (1 - (a - lo) / (1 - lo));
  const yt = [lo, (lo + 1) / 2, 1];
  // Dodge labels vertically so near-identical points stay readable.
  const ly = new Map<string, number>();
  const placed: { x: number; y: number }[] = [];
  for (const p of [...pts].sort((a, b) => y(a.acc) - y(b.acc))) {
    const base = y(p.acc) + 4;
    let yy = base;
    for (let k = 1; placed.some((q) => Math.abs(q.y - yy) < 13 && Math.abs(q.x - x(p.cost)) < 130); k++)
      yy = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 13; // nearest free slot, alternating below/above
    placed.push({ x: x(p.cost), y: yy });
    ly.set(p.model, yy);
  }
  return (
    <figure className="chart">
      <figcaption><b>Accuracy vs cost</b><span className="muted small-text"> · top-left is better</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy versus cost">
        {yt.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="cgrid" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="ct muted">{fmtPct(t)}</text>
          </g>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="ct muted">total cost (USD, square-root scale)</text>
        <text x={L} y={H - 20} textAnchor="middle" className="ct muted">{fmtUsd(0)}</text>
        <text x={W - R} y={H - 20} textAnchor="end" className="ct muted">{fmtUsd(maxC)}</text>
        {pts.map((p) => (
          <g key={p.model} onMouseEnter={() => onHover(`${p.model}: ${fmtPct(p.acc)} for ${fmtUsd(p.cost)}`)} onMouseLeave={() => onHover(null)}>
            {Math.abs((ly.get(p.model) ?? 0) - 4 - y(p.acc)) > 6 && (
              <line x1={x(p.cost)} y1={y(p.acc)} x2={x(p.cost) + (x(p.cost) > W - 110 ? -8 : 8)} y2={(ly.get(p.model) ?? 0) - 4} className="cgrid" />
            )}
            <circle cx={x(p.cost)} cy={y(p.acc)} r={6} className="cdot"><title>{`${p.model}: ${fmtPct(p.acc)}, ${fmtUsd(p.cost)}`}</title></circle>
            <text x={x(p.cost) + (x(p.cost) > W - 110 ? -9 : 9)} y={ly.get(p.model)} textAnchor={x(p.cost) > W - 110 ? 'end' : 'start'} className="ct">{p.label}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function Charts({ results }: { results: CaseResult[] }) {
  const [tip, setTip] = useState<string | null>(null);
  const pts = useMemo<Pt[]>(
    () => summarize(results).map((s) => ({
      model: s.model, label: short(s.model), acc: acc(s), cost: s.cost, brier: mean(s.brier), n: s.n,
      p50: s.latencies.length ? percentile(s.latencies, 0.5) : NaN,
    })),
    [results],
  );
  if (!pts.length) return null;
  const byAcc = [...pts].sort((a, b) => b.acc - a.acc);
  const byLat = pts.filter((p) => isFinite(p.p50)).sort((a, b) => a.p50 - b.p50);
  const byBrier = pts.filter((p) => isFinite(p.brier)).sort((a, b) => a.brier - b.brier);
  return (
    <div className="col gap">
      <div className="charts">
        <BarChart title="Accuracy" note="errors and skips count as wrong" max={1} fmt={fmtPct} onHover={setTip}
          data={byAcc.map((p) => ({ key: p.model, label: p.label, v: p.acc, tip: `${p.model}: ${fmtPct(p.acc)} of ${p.n}` }))} />
        <Scatter pts={pts} onHover={setTip} />
        <BarChart title="Brier score" note="lower is better" max={Math.max(...byBrier.map((p) => p.brier), 0.01)} fmt={(v) => v.toFixed(3)} onHover={setTip}
          data={byBrier.map((p) => ({ key: p.model, label: p.label, v: p.brier, tip: `${p.model}: Brier ${p.brier.toFixed(3)}` }))} />
        <BarChart title="Median latency" note="faster is better" max={Math.max(...byLat.map((p) => p.p50), 1)} fmt={(v) => `${Math.round(v)} ms`} onHover={setTip}
          data={byLat.map((p) => ({ key: p.model, label: p.label, v: p.p50, tip: `${p.model}: p50 ${Math.round(p.p50)} ms` }))} />
      </div>
      <div className="muted small-text" aria-live="polite">{tip ?? 'Hover a bar or point for details. The table below has the full numbers.'}</div>
    </div>
  );
}
