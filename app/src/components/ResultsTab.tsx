import { useMemo, useRef, useState } from 'react';
import { download } from '../lib/storage';
import { acc, fmtNum, fmtPct, fmtUsd, HIGH_CONF, mean, percentile, runCost, summarize, toCsv, type ModelSummary } from '../lib/summary';
import type { CaseResult, Run } from '../lib/types';

interface Props {
  runs: Run[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  deleteRun: (id: string) => void;
  importRuns: (runs: Run[]) => void;
}

/** Accept a single Run (SPA export or `npm run bench` output) or an array of them. */
export function parseRunJson(text: string): Run[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !Array.isArray(r.results) || !r.config || !Array.isArray(r.config.models))
      throw new Error('Not a run JSON (expected id, config.models and results).');
    if (r.config.temperature != null || r.results.some((x: { primitive?: string; skipped?: boolean }) => !x.primitive))
      throw new Error('This is a chat-completions run. Only Decisions API runs can be imported.');
  }
  return list.map((r) => ({
    ...r,
    status: r.status === 'running' ? 'cancelled' : r.status,
    categoryNames: r.categoryNames ?? {},
    config: { ...r.config, categories: r.config.categories ?? [...new Set(r.results.map((x: { categoryId: string }) => x.categoryId))] },
    total: r.total ?? r.results.length,
  }));
}

function ImportButton({ onImport }: { onImport: (runs: Run[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const onFiles = async (files: FileList | null) => {
    const out: Run[] = [];
    for (const f of Array.from(files ?? [])) {
      try {
        out.push(...parseRunJson(await f.text()));
      } catch (e: any) {
        alert(`${f.name}: ${e?.message ?? e}`);
      }
    }
    if (out.length) onImport(out);
    if (input.current) input.current.value = '';
  };
  return (
    <>
      <input ref={input} type="file" accept="application/json,.json" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      <button className="small" onClick={() => input.current?.click()}>Import run JSON</button>
    </>
  );
}

type Filter = { model?: string; categoryId?: string; caseKey?: string; title: string };
const caseKey = (r: CaseResult) => `${r.categoryId}/${r.caseId}`;

export function ResultsTab({ runs, activeId, setActiveId, deleteRun, importRuns }: Props) {
  const run = runs.find((r) => r.id === activeId) ?? runs[0];
  const [view, setView] = useState<'models' | 'cases'>('models');
  const [filter, setFilter] = useState<Filter | null>(null);

  if (!run)
    return (
      <div className="tab col gap">
        <p className="muted">No runs yet. Start one from the Run tab, or import a run JSON (e.g. from <code>npm run bench</code>).</p>
        <div className="row"><ImportButton onImport={importRuns} /></div>
      </div>
    );
  const stamp = new Date(run.createdAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return (
    <div className="tab col gap">
      <div className="card">
        <div className="row between wrap">
          <div className="row wrap">
            <label className="field inline">Run
              <select value={run.id} onChange={(e) => { setActiveId(e.target.value); setFilter(null); }}>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.createdAt).toLocaleString()} · {r.config.models.length} models · {r.results.length}/{r.total} · {fmtUsd(runCost(r))} · {r.status}{r.source === 'cli' ? ' · cli' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="small danger" onClick={() => confirm('Delete this run?') && deleteRun(run.id)}>Delete run</button>
          </div>
          <div className="row">
            <ImportButton onImport={importRuns} />
            <button className="small" onClick={() => download(`run-${stamp}.json`, JSON.stringify(run, null, 2))}>Export JSON</button>
            <button className="small" onClick={() => download(`run-${stamp}.csv`, toCsv(run.results), 'text/csv')}>Export per-call CSV</button>
          </div>
        </div>
        <p className="muted small-text">
          seed {run.config.seed} · {run.config.samples} samples/templated case · concurrency {run.config.concurrency}
          {run.unavailable?.length ? ` · unavailable: ${run.unavailable.join(', ')}` : ''}
        </p>
      </div>

      <div className="row">
        <button className={view === 'models' ? 'primary' : ''} onClick={() => setView('models')}>By model</button>
        <button className={view === 'cases' ? 'primary' : ''} onClick={() => setView('cases')}>By case</button>
      </div>

      {view === 'models' ? <ModelTable run={run} onCell={setFilter} /> : <CaseMatrix run={run} onCell={setFilter} />}
      {filter && <DrillDown run={run} filter={filter} onClose={() => setFilter(null)} />}
    </div>
  );
}

type SortKey = string; // 'model' | 'overall' | 'brier' | 'pexp' | 'confok' | 'confbad' | 'hiconf' | 'cost' | 'cpc' | 'latency' | 'errors' | `cat:${id}`

function sortValue(s: ModelSummary, k: SortKey): number | string {
  switch (k) {
    case 'model': return s.model;
    case 'overall': return acc(s);
    case 'brier': return mean(s.brier);
    case 'pexp': return mean(s.pExpected);
    case 'confok': return mean(s.confCorrect);
    case 'confbad': return mean(s.confWrong);
    case 'hiconf': return acc(s.highConf);
    case 'cost': return s.cost;
    case 'cpc': return s.correct ? s.cost / s.correct : Infinity;
    case 'latency': return s.latencies.length ? percentile(s.latencies, 0.5) : Infinity;
    case 'p95': return s.latencies.length ? percentile(s.latencies, 0.95) : Infinity;
    case 'errors': return s.errors;
    default: return acc(s.perCat[k.slice(4)] ?? { n: 0, correct: 0 });
  }
}

function ModelTable({ run, onCell }: { run: Run; onCell: (f: Filter) => void }) {
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'overall', desc: true });
  const ascByDefault = (k: SortKey) => ['model', 'brier', 'confbad', 'cost', 'cpc', 'latency', 'p95', 'errors'].includes(k);
  const rows = useMemo(() => {
    const s = summarize(run.results);
    return s.sort((a, b) => {
      const x = sortValue(a, sort.k), y = sortValue(b, sort.k);
      const nx = typeof x === 'number' && isNaN(x) ? -Infinity : x, ny = typeof y === 'number' && isNaN(y) ? -Infinity : y;
      const c = nx < ny ? -1 : nx > ny ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [run.results, sort]);
  const cats = run.config.categories;
  const H = ({ k, children, num = true }: { k: SortKey; children: React.ReactNode; num?: boolean }) => (
    <th className={`sortable ${num ? 'num' : ''}`} onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : !ascByDefault(k) })}>
      {children}{sort.k === k ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );
  const heat = (x: number) => (isFinite(x) ? { background: `color-mix(in srgb, var(--good) ${Math.round(x * 45)}%, var(--bad-bg))` } : undefined);

  if (!rows.length) return <p className="muted">No results yet.</p>;
  return (
    <div className="table-wrap">
      <table className="data results">
        <thead>
          <tr>
            <H k="model" num={false}>Model</H>
            <H k="overall">Overall</H>
            <H k="brier"><span title="Mean (1 - p(expected))², lower is better">Brier</span></H>
            <H k="pexp">p(expected)</H>
            <H k="confok">Conf ✓</H>
            <H k="confbad">Conf ✗</H>
            <H k="hiconf">{`Acc @conf≥${HIGH_CONF}`}</H>
            {cats.map((c) => <H key={c} k={`cat:${c}`}><span title={c}>{run.categoryNames[c] ?? c}</span></H>)}
            <H k="cost">Cost</H>
            <H k="cpc">$/correct</H>
            <H k="latency">p50 latency</H>
            <H k="p95">p95 latency</H>
            <H k="errors">Errors</H>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.model}>
              <td className="mono">{s.model}</td>
              <td className="num clickable strong" style={heat(acc(s))} onClick={() => onCell({ model: s.model, title: `${s.model} · all categories` })}>
                {fmtPct(acc(s))} <span className="muted small-text">{s.correct}/{s.n}</span>
              </td>
              <td className="num">{fmtNum(mean(s.brier))}</td>
              <td className="num">{fmtNum(mean(s.pExpected), 2)}</td>
              <td className="num">{fmtNum(mean(s.confCorrect), 2)}</td>
              <td className="num">{fmtNum(mean(s.confWrong), 2)}</td>
              <td className="num" title={`${s.highConf.correct}/${s.highConf.n} answers with confidence ≥ ${HIGH_CONF}`}>
                {fmtPct(acc(s.highConf))} <span className="muted small-text">n={s.highConf.n}</span>
              </td>
              {cats.map((c) => {
                const cell = s.perCat[c];
                return (
                  <td key={c} className="num clickable" style={cell ? heat(acc(cell)) : undefined}
                    onClick={() => cell && onCell({ model: s.model, categoryId: c, title: `${s.model} · ${run.categoryNames[c] ?? c}` })}>
                    {cell ? fmtPct(acc(cell)) : '–'}
                  </td>
                );
              })}
              <td className="num">{fmtUsd(s.cost)}</td>
              <td className="num">{s.correct ? fmtUsd(s.cost / s.correct) : '–'}</td>
              <td className="num">{s.latencies.length ? `${percentile(s.latencies, 0.5)} ms` : '–'}</td>
              <td className="num">{s.latencies.length ? `${percentile(s.latencies, 0.95)} ms` : '–'}</td>
              <td className={`num ${s.errors ? 'bad' : ''}`} title={`${s.skipped} skipped (not sent)`}>{s.errors}{s.skipped ? <span className="muted small-text"> ({s.skipped} skipped)</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseMatrix({ run, onCell }: { run: Run; onCell: (f: Filter) => void }) {
  const [onlyFailing, setOnlyFailing] = useState(true);
  const { models, rows } = useMemo(() => {
    const models = [...new Set(run.results.map((r) => r.model))];
    const map = new Map<string, { key: string; r: CaseResult; cells: Record<string, { n: number; correct: number }>; wrong: number }>();
    for (const r of run.results) {
      const k = caseKey(r);
      let row = map.get(k);
      if (!row) map.set(k, (row = { key: k, r, cells: {}, wrong: 0 }));
      const cell = (row.cells[r.model] ??= { n: 0, correct: 0 });
      cell.n++;
      if (r.correct) cell.correct++;
    }
    const rows = [...map.values()];
    for (const row of rows) row.wrong = Object.values(row.cells).filter((c) => c.correct < c.n).length;
    rows.sort((a, b) => b.wrong - a.wrong || a.key.localeCompare(b.key));
    return { models, rows };
  }, [run.results]);
  const shown = onlyFailing ? rows.filter((r) => r.wrong > 0) : rows;

  return (
    <div className="col gap">
      <label className="check"><input type="checkbox" checked={onlyFailing} onChange={(e) => setOnlyFailing(e.target.checked)} /> only cases some model got wrong ({rows.filter((r) => r.wrong).length}/{rows.length})</label>
      <div className="table-wrap">
        <table className="data results">
          <thead>
            <tr>
              <th>Case</th><th className="num">Models wrong</th>
              {models.map((m) => <th key={m} className="num mono small-text">{m.split('/').pop()}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key}>
                <td className="clickable" onClick={() => onCell({ caseKey: row.key, title: `${row.key} · all models` })}>
                  <span className="mono">{row.r.caseId}</span> {row.r.caseTitle}
                  <div className="muted small-text">{run.categoryNames[row.r.categoryId] ?? row.r.categoryId} · {row.r.difficulty}</div>
                </td>
                <td className="num">{row.wrong}/{models.length}</td>
                {models.map((m) => {
                  const c = row.cells[m];
                  const cls = !c ? '' : c.correct === c.n ? 'cell-ok' : c.correct === 0 ? 'cell-bad' : 'cell-mixed';
                  return (
                    <td key={m} className={`num clickable ${cls}`} onClick={() => c && onCell({ model: m, caseKey: row.key, title: `${row.key} · ${m}` })}>
                      {c ? (c.n === 1 ? (c.correct ? '✓' : '✗') : `${c.correct}/${c.n}`) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DrillDown({ run, filter, onClose }: { run: Run; filter: Filter; onClose: () => void }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const items = run.results
    .filter((r) => (!filter.model || r.model === filter.model) && (!filter.categoryId || r.categoryId === filter.categoryId) && (!filter.caseKey || caseKey(r) === filter.caseKey))
    .filter((r) => !failedOnly || !r.correct)
    .sort((a, b) => Number(a.correct) - Number(b.correct) || caseKey(a).localeCompare(caseKey(b)) || a.sample - b.sample);

  return (
    <div className="card drill">
      <div className="row between">
        <h3>{filter.title}</h3>
        <div className="row">
          <label className="check"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> failed only</label>
          <button className="small" onClick={onClose}>Close</button>
        </div>
      </div>
      {items.map((r, i) => (
        <details key={i} className={`result ${r.correct ? 'pass' : 'fail'}`}>
          <summary>
            <span className="mark">{r.correct ? '✓' : '✗'}</span>
            <span className="mono">{r.caseId}{r.sample ? `#${r.sample}` : ''}</span>
            <span className="truncate">{r.caseTitle}</span>
            {!filter.model && <span className="mono small-text muted">{r.model}</span>}
            <span className="spacer" />
            <span className="small-text">expected <b className="mono">{JSON.stringify(r.expected)}</b> · got <b className="mono">{JSON.stringify(r.decision)}</b></span>
            <span className="muted small-text">
              {r.confidence != null ? `conf ${r.confidence.toFixed(2)}` : ''}{r.pExpected != null ? ` · p(exp) ${r.pExpected.toFixed(2)}` : ''} · {r.latencyMs} ms · {fmtUsd(r.cost)}
            </span>
          </summary>
          <div className="result-body">
            {r.error && <div className="error-text">Error: {r.error}</div>}
            {r.vars && <div className="mono small-text">vars = {JSON.stringify(r.vars)}</div>}
            {r.probabilities && <Probabilities probs={r.probabilities} expected={r.expected} decision={r.decision} />}
            {r.rawValue != null && <div className="mono small-text">{r.primitive === 'noul' ? 'p(true)' : 'score'} = {r.rawValue.toFixed(3)}{r.brier != null ? ` · Brier ${r.brier.toFixed(3)}` : ''}</div>}
            <div className="two-col">
              <div><div className="field-label">Input</div><pre className="pre">{r.input}</pre></div>
              <div><div className="field-label">Raw answer</div><pre className="pre">{r.raw || '(empty)'}</pre></div>
            </div>
            <div className="muted small-text">
              {r.inputTokens ?? 0} input / {r.outputTokens ?? 0} output tokens
              {r.primitive ? ` · ${r.primitive}` : ''}
              {r.httpStatus != null ? ` · HTTP ${r.httpStatus}` : ''}
              {r.retries ? ` · ${r.retries} retry` : ''}
              {r.requeues ? ` · requeued ${r.requeues}×` : ''}
              {r.upstreamModel ? ` · ${r.upstreamModel}` : ''}
              {r.provider ? ` via ${r.provider}` : ''}
              {r.requestedAt ? ` · ${r.requestedAt}` : ''}
              {r.responseId ? <> · <span className="mono">{r.responseId}</span></> : null}
            </div>
          </div>
        </details>
      ))}
      {!items.length && <p className="muted">Nothing to show.</p>}
    </div>
  );
}

function Probabilities({ probs, expected, decision }: { probs: Record<string, number>; expected: CaseResult['expected']; decision: CaseResult['decision'] }) {
  const rows = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const same = (a: unknown, b: unknown) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
  return (
    <table className="data probs">
      <thead><tr><th>Label</th><th className="num">p</th><th></th></tr></thead>
      <tbody>
        {rows.map(([k, p]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            <td className="num">{p.toFixed(3)}</td>
            <td className="muted small-text">{[same(k, expected) && 'expected', same(k, decision) && 'predicted'].filter(Boolean).join(' · ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
