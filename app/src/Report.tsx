import { useEffect, useMemo, useState } from 'react';
import { Charts } from './Charts';
import DatasetView from './DatasetView';
import { CaseMatrix, DrillDown, ModelTable, type Filter } from './components/ResultsTab';
import { parseRunJson } from './lib/parseRun';
import { fmtUsd, runCost } from './lib/summary';
import type { Run } from './lib/types';

/** Results-only page published to GitHub Pages: loads results/latest.json, no API key, no editing. */
export default function Report() {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'models' | 'cases'>('models');
  const [filter, setFilter] = useState<Filter | null>(null);
  const [page, setPage] = useState<'results' | 'dataset'>(() => (location.hash === '#dataset' ? 'dataset' : 'results'));
  const go = (p: 'results' | 'dataset') => { setPage(p); history.replaceState(null, '', p === 'dataset' ? '#dataset' : '#'); };

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}results/latest.json`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`results/latest.json: HTTP ${r.status}`))))
      .then((t) => {
        const r = parseRunJson(t)[0];
        setRun(r);
        setModels(new Set(r.results.map((x) => x.model)));
        setCats(new Set(r.config.categories));
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const allModels = useMemo(() => [...new Set(run?.results.map((r) => r.model) ?? [])].sort(), [run]);
  const view_ = useMemo<Run | null>(
    () => run && {
      ...run,
      config: { ...run.config, categories: run.config.categories.filter((c) => cats.has(c)) },
      results: run.results.filter((r) => models.has(r.model) && cats.has(r.categoryId)),
    },
    [run, models, cats],
  );

  if (error) return <div className="app"><p className="error-text">Could not load results: {error}</p></div>;
  if (!run || !view_) return <div className="app"><p className="muted">Loading results…</p></div>;

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    n.has(k) ? n.delete(k) : n.add(k);
    setSet(n);
    setFilter(null);
  };
  const Picker = ({ title, all, sel, setSel, label }: { title: string; all: string[]; sel: Set<string>; setSel: (s: Set<string>) => void; label: (k: string) => string }) => (
    <div className="card col gap">
      <div className="row between wrap">
        <b>{title} <span className="muted small-text">{sel.size}/{all.length}</span></b>
        <div className="row">
          <button className="small" onClick={() => { setSel(new Set(all)); setFilter(null); }}>All</button>
          <button className="small" onClick={() => { setSel(new Set()); setFilter(null); }}>None</button>
        </div>
      </div>
      <div className="row wrap">
        {all.map((k) => (
          <label key={k} className="check"><input type="checkbox" checked={sel.has(k)} onChange={() => toggle(sel, setSel, k)} /> {label(k)}</label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <h1>Decision Evals</h1>
        <nav className="tabs">
          <button className={page === 'results' ? 'active' : ''} onClick={() => go('results')}>Results</button>
          <button className={page === 'dataset' ? 'active' : ''} onClick={() => go('dataset')}>Dataset</button>
        </nav>
        <span className="spacer" />
        <a className="small" href="https://github.com/sdawka/sys1-bench" target="_blank" rel="noreferrer">GitHub ↗</a>
        <span className="muted small-text">
          {new Date(run.createdAt).toLocaleString()} · {run.config.models.length} models · {run.results.length} results · {fmtUsd(runCost(run))} · seed {run.config.seed}
        </span>
      </header>
      <main>
        {page === 'dataset' ? <DatasetView /> : (
        <div className="tab col gap">
          <Picker title="Models" all={allModels} sel={models} setSel={setModels} label={(m) => m} />
          <Picker title="Categories" all={run.config.categories} sel={cats} setSel={setCats} label={(c) => run.categoryNames[c] ?? c} />
          <Charts results={view_.results} />
          <div className="row">
            <button className={view === 'models' ? 'primary' : ''} onClick={() => setView('models')}>By model</button>
            <button className={view === 'cases' ? 'primary' : ''} onClick={() => setView('cases')}>By case</button>
          </div>
          {view === 'models' ? <ModelTable run={view_} onCell={setFilter} /> : <CaseMatrix run={view_} onCell={setFilter} />}
          {filter && <DrillDown run={view_} filter={filter} onClose={() => setFilter(null)} />}
        </div>
        )}
      </main>
    </div>
  );
}
