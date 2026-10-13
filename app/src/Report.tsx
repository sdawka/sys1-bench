import { useEffect, useMemo, useRef, useState } from 'react';
import { Charts } from './Charts';
import DatasetView from './DatasetView';
import { CaseMatrix, DrillDown, ModelTable, type Filter } from './components/ResultsTab';
import { parseRunJson } from './lib/parseRun';
import { fmtUsd, runCost } from './lib/summary';
import type { Run } from './lib/types';

function FilterGroup({ title, ids, selected, label, colors, open, setOpen, setSelected }: {
  title: string; ids: string[]; selected: Set<string>; label: (id: string) => string;
  colors?: Map<string, string>; open: boolean; setOpen: (open: boolean) => void; setSelected: (ids: Set<string>) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = ids.filter((id) => `${id} ${label(id)}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <details className="filter-group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><span>{title}</span><span className="filter-count">{selected.size}/{ids.length}</span><span className="filter-chevron" aria-hidden="true">⌄</span></summary>
      <div className="filter-body">
        <input type="search" aria-label={`Search ${title.toLowerCase()}`} placeholder={`Search ${title.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="filter-actions"><button onClick={() => setSelected(new Set(ids))}>Select all</button><button onClick={() => setSelected(new Set())}>Clear</button></div>
        <div className="filter-options">
          {shown.map((id) => (
            <label className="filter-option" key={id} title={id}>
              <input type="checkbox" checked={selected.has(id)} onChange={() => {
                const next = new Set(selected);
                next.has(id) ? next.delete(id) : next.add(id);
                setSelected(next);
              }} />
              {colors && <span className="model-swatch" style={{ background: colors.get(id) }} aria-hidden="true" />}
              <span>{label(id)}{colors && <small>{id.split('/')[0]}</small>}</span>
            </label>
          ))}
          {!shown.length && <p className="muted small-text">No matching {title.toLowerCase()}.</p>}
        </div>
      </div>
    </details>
  );
}

// Assign colors from the complete catalog so filtering never changes a model's color.
const modelColor = (index: number) => `var(--model-${index % 8})`;

export default function Report() {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'models' | 'cases'>('models');
  const [filter, setFilter] = useState<Filter | null>(null);
  const [page, setPage] = useState<'results' | 'dataset'>(() => location.hash === '#dataset' ? 'dataset' : 'results');
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [drawer, setDrawer] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(true);
  const [catsOpen, setCatsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const change = () => { setMobile(media.matches); setDrawer(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (drawer && mobile && dialog.current && !dialog.current.open) dialog.current.showModal();
    else dialog.current?.close();
  }, [drawer, mobile]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}results/latest.json`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`results/latest.json: HTTP ${r.status}`)))
      .then((text) => {
        const r = parseRunJson(text)[0];
        setRun(r);
        setModels(new Set(r.results.map((x) => x.model)));
        setCats(new Set(r.config.categories));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const allModels = useMemo(() => [...new Set(run?.results.map((r) => r.model) ?? [])].sort(), [run]);
  const colors = useMemo(() => new Map(allModels.map((id, i) => [id, modelColor(i)])), [allModels]);
  const filtered = useMemo<Run | null>(() => run && {
    ...run,
    config: { ...run.config, models: run.config.models.filter((m) => models.has(m)), categories: run.config.categories.filter((c) => cats.has(c)) },
    results: run.results.filter((r) => models.has(r.model) && cats.has(r.categoryId)),
  }, [run, models, cats]);

  if (error) return <main className="report-status" role="alert">Could not load results: {error}</main>;
  if (!run || !filtered) return <main className="report-status" role="status">Loading benchmark results…</main>;

  const go = (p: 'results' | 'dataset') => {
    setPage(p); setDrawer(false);
    history.replaceState(null, '', p === 'dataset' ? '#dataset' : '#');
  };
  const filters = <>
    <div className="filter-heading"><h2 id="filters-title">Compare models</h2>{mobile && <button aria-label="Close filters" onClick={() => setDrawer(false)}>✕</button>}</div>
    <p className="muted small-text filter-intro">Choose what appears in the charts and detailed results.</p>
    <FilterGroup title="Models" ids={allModels} selected={models} label={(id) => id.split('/').pop()!} colors={colors}
      open={modelsOpen} setOpen={setModelsOpen} setSelected={(next) => { setModels(next); setFilter(null); }} />
    <FilterGroup title="Categories" ids={run.config.categories} selected={cats} label={(id) => run.categoryNames[id] ?? id}
      open={catsOpen} setOpen={setCatsOpen} setSelected={(next) => { setCats(next); setFilter(null); }} />
    {mobile && <button className="primary filter-done" onClick={() => setDrawer(false)}>Show results</button>}
  </>;
  const date = (stamp: number) => new Date(stamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const firstDate = date(run.createdAt), lastDate = date(run.finishedAt ?? run.createdAt);

  return (
    <div className="app report-app">
      <header className="report-header">
        <a className="report-brand" href="#" onClick={(e) => { e.preventDefault(); go('results'); }}><span className="brand-mark" aria-hidden="true">◈</span>Decision Evals</a>
        <nav className="tabs" aria-label="Report navigation">
          <button className={page === 'results' ? 'active' : ''} aria-current={page === 'results' ? 'page' : undefined} onClick={() => go('results')}>Results</button>
          <button className={page === 'dataset' ? 'active' : ''} aria-current={page === 'dataset' ? 'page' : undefined} onClick={() => go('dataset')}>Dataset</button>
        </nav>
        <a className="report-github" href="https://github.com/sdawka/sys1-bench" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>
      {page === 'dataset' ? <main><DatasetView /></main> : (
        <main className="report-layout">
          {!mobile && <aside className="report-sidebar" aria-labelledby="filters-title">{filters}</aside>}
          {mobile && <dialog ref={dialog} className="filter-dialog" aria-labelledby="filters-title"
            onCancel={() => setDrawer(false)} onClose={() => { setDrawer(false); filterButton.current?.focus(); }}
            onClick={(e) => { if (e.target === e.currentTarget) {
              const rect = e.currentTarget.getBoundingClientRect();
              if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setDrawer(false);
            } }}>{filters}</dialog>}
          <section className="report-content" aria-labelledby="report-title">
            <div className="report-heading">
              <div><p className="report-eyebrow">SYSTEM ONE BENCHMARK</p><h1 id="report-title">Small decisions. Measured.</h1><p className="muted">Compare accuracy, calibration, cost, and speed across decision models.</p></div>
              {mobile && <button ref={filterButton} className="filter-trigger" onClick={() => setDrawer(true)} aria-haspopup="dialog">Filters <span>{models.size}/{allModels.length}</span></button>}
            </div>
            <div className="report-meta"><span>{models.size} models</span><span>{cats.size} categories</span><span>{filtered.results.length.toLocaleString()} results</span><span>{fmtUsd(runCost(filtered))} measured cost</span><span>Benchmarked {firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`} · seed {run.config.seed}</span></div>
            {filtered.results.length ? <>
              <Charts results={filtered.results} colors={colors} />
              <details className="report-details">
                <summary><span>Detailed results</span><span className="muted small-text">Model rankings, category scores, and individual cases</span><span className="filter-chevron" aria-hidden="true">⌄</span></summary>
                <div className="report-details-body">
                  <div className="row"><button className={view === 'models' ? 'primary' : ''} onClick={() => setView('models')}>By model</button><button className={view === 'cases' ? 'primary' : ''} onClick={() => setView('cases')}>By case</button></div>
                  {view === 'models' ? <ModelTable run={filtered} onCell={setFilter} /> : <CaseMatrix run={filtered} onCell={setFilter} />}
                  {filter && <DrillDown run={filtered} filter={filter} onClose={() => setFilter(null)} />}
                </div>
              </details>
            </> : <div className="report-empty"><h2>No results selected</h2><p className="muted">Select at least one model and one category to compare results.</p><button onClick={() => { setModels(new Set(allModels)); setCats(new Set(run.config.categories)); setFilter(null); }}>Reset filters</button></div>}
          </section>
        </main>
      )}
    </div>
  );
}
