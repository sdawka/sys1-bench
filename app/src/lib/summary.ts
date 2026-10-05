import type { CaseResult, Run } from './types';

export interface Cell {
  n: number;
  correct: number;
}

export interface Mean {
  sum: number;
  n: number;
}

export interface ModelSummary {
  model: string;
  /** All results, including errors and skipped tasks (each counts as wrong). */
  n: number;
  correct: number;
  errors: number;
  /** Tasks never sent (primitive rejected, context too small, model unavailable). */
  skipped: number;
  /** Results with a decision. */
  answered: number;
  cost: number;
  inputTokens: number;
  latencySum: number;
  latencyN: number;
  /** Latencies (ms) of calls that were made, for percentiles. */
  latencies: number[];
  /** Mean (1 - p(expected))^2 over answered results with probabilities. Lower is better. */
  brier: Mean;
  /** Mean probability on the expected label. */
  pExpected: Mean;
  confCorrect: Mean;
  confWrong: Mean;
  /** Answers with confidence >= HIGH_CONF, and how many of those were correct. */
  highConf: Cell;
  perCat: Record<string, Cell & { brier: Mean }>;
}

export const HIGH_CONF = 0.9;

export const acc = (c: { n: number; correct: number }) => (c.n ? c.correct / c.n : NaN);
export const mean = (m: Mean | undefined) => (m && m.n ? m.sum / m.n : NaN);
const add = (m: Mean, v: number | null | undefined) => {
  if (typeof v === 'number' && isFinite(v)) {
    m.sum += v;
    m.n++;
  }
};
const newMean = (): Mean => ({ sum: 0, n: 0 });

export function summarize(results: CaseResult[]): ModelSummary[] {
  const by = new Map<string, ModelSummary>();
  for (const r of results) {
    let s = by.get(r.model);
    if (!s) {
      s = {
        model: r.model, n: 0, correct: 0, errors: 0, skipped: 0, answered: 0, cost: 0, inputTokens: 0, latencySum: 0, latencyN: 0, latencies: [],
        brier: newMean(), pExpected: newMean(), confCorrect: newMean(), confWrong: newMean(), highConf: { n: 0, correct: 0 }, perCat: {},
      };
      by.set(r.model, s);
    }
    s.n++;
    if (r.correct) s.correct++;
    if (r.error) s.errors++;
    if (r.skipped) s.skipped++;
    if (r.decision != null) s.answered++;
    s.cost += r.cost || 0;
    s.inputTokens += r.inputTokens ?? 0;
    if (r.latencyMs > 0) {
      s.latencySum += r.latencyMs;
      s.latencyN++;
      s.latencies.push(r.latencyMs);
    }
    add(s.brier, r.brier);
    add(s.pExpected, r.pExpected);
    if (r.decision != null) add(r.correct ? s.confCorrect : s.confWrong, r.confidence);
    if (r.decision != null && (r.confidence ?? 0) >= HIGH_CONF) {
      s.highConf.n++;
      if (r.correct) s.highConf.correct++;
    }
    const cell = (s.perCat[r.categoryId] ??= { n: 0, correct: 0, brier: newMean() });
    cell.n++;
    if (r.correct) cell.correct++;
    add(cell.brier, r.brier);
  }
  return [...by.values()];
}

/** Nearest-rank percentile (q in 0..1) of a list of numbers; NaN when empty. */
export function percentile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export const runCost = (run: Run) => run.results.reduce((a, r) => a + (r.cost || 0), 0);

const CSV_COLS: (keyof CaseResult)[] = [
  'model', 'categoryId', 'caseId', 'caseTitle', 'difficulty', 'sample', 'primitive', 'vars', 'expected', 'decision', 'correct',
  'confidence', 'pExpected', 'brier', 'rawValue', 'probabilities', 'latencyMs', 'inputTokens', 'outputTokens', 'cost', 'error', 'skipped',
  'httpStatus', 'retries', 'requeues', 'requestedAt', 'responseId', 'provider', 'upstreamModel', 'input', 'raw',
];

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(results: CaseResult[]): string {
  return [CSV_COLS.join(','), ...results.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n');
}

export const fmtPct = (x: number) => (isFinite(x) ? `${(x * 100).toFixed(0)}%` : '–');
export const fmtNum = (x: number, d = 3) => (isFinite(x) ? x.toFixed(d) : '–');
export const fmtUsd = (x: number) =>
  !isFinite(x) ? '–' : x === 0 ? '$0' : x < 0.01 ? `$${x.toFixed(5)}` : `$${x.toFixed(3)}`;
