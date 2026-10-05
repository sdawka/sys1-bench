import { useEffect, useMemo, useRef, useState } from 'react';
import { DatasetTab } from './components/DatasetTab';
import { ModelsTab } from './components/ModelsTab';
import { ResultsTab } from './components/ResultsTab';
import { RunTab } from './components/RunTab';
import { Settings } from './components/Settings';
import { mergeDataset, type Overlay } from './lib/dataset';
import { envKey, envKeyLoaded, listDecisionModels } from './lib/openrouter';
import { buildTasks, runAll } from './lib/runner';
import { fmtUsd, runCost } from './lib/summary';
import { usePersistent } from './lib/usePersistent';
import type { CaseResult, ORModel, Run, RunConfig } from './lib/types';

type Tab = 'models' | 'dataset' | 'run' | 'results';
const TABS: [Tab, string][] = [['models', 'Models'], ['dataset', 'Dataset'], ['run', 'Run'], ['results', 'Results']];

export default function App() {
  const [tab, setTab] = usePersistent<Tab>('evals.tab', 'dataset');
  const [storageWarn, setStorageWarn] = useState(false);
  const warn = () => setStorageWarn(true);
  const [keyOverride, setKeyOverride] = usePersistent('evals.apiKey', '');
  const [showSettings, setShowSettings] = useState(false);
  const apiKey = keyOverride || (envKeyLoaded ? envKey : '');

  const [overlay, setOverlay] = usePersistent<Overlay>('evals.overlay', {}, warn);
  const dataset = useMemo(() => mergeDataset(overlay), [overlay]);

  const [modelCache, setModelCache] = usePersistent<{ fetchedAt: number | null; data: ORModel[] }>('evals.decisionModels', { fetchedAt: null, data: [] }, warn);
  const [selected, setSelected] = usePersistent<string[]>('evals.selectedDecisionModels', []);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const refreshModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const data = await listDecisionModels();
      setModelCache({ fetchedAt: Date.now(), data });
    } catch (e: any) {
      setModelsError(String(e?.message ?? e));
    } finally {
      setModelsLoading(false);
    }
  };
  useEffect(() => {
    if (!modelCache.data.length) refreshModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [runs, setRuns] = usePersistent<Run[]>('evals.decisionRuns', [], warn); // chat-era runs stay untouched under 'evals.runs'
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, cost: 0, errors: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const totalSpend = runs.reduce((a, r) => a + runCost(r), 0);

  // A run left "running" from a closed tab can never resume; mark it cancelled on load.
  useEffect(() => {
    setRuns((rs) => rs.map((r) => (r.status === 'running' ? { ...r, status: 'cancelled' } : r)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = async (cfg: RunConfig) => {
    const cats = dataset.filter((c) => cfg.categories.includes(c.id));
    const tasks = buildTasks(cats, cfg.models, cfg.samples);
    const id = `run_${Date.now().toString(36)}`;
    const run: Run = {
      id, createdAt: Date.now(), status: 'running', config: cfg, source: 'app', total: tasks.length, results: [],
      categoryNames: Object.fromEntries(cats.map((c) => [c.id, c.name])),
    };
    setRuns((rs) => [run, ...rs]);
    setActiveRunId(id);
    setProgress({ done: 0, total: tasks.length, cost: 0, errors: 0 });
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const pricing = new Map(modelCache.data.map((m) => [m.id, m]));
    const patch = (fn: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
    try {
      // Concurrency is per model: every model runs in its own pool, in parallel with the others.
      await runAll(tasks, cfg, apiKey, pricing, ac.signal, (res: CaseResult) => {
        patch((r) => ({ ...r, results: [...r.results, res] }));
        setProgress((p) => ({ ...p, done: p.done + 1, cost: p.cost + res.cost, errors: p.errors + (res.error ? 1 : 0) }));
      }, { perModelConcurrency: cfg.concurrency });
    } catch (e) {
      console.error(e);
    } finally {
      patch((r) => ({ ...r, status: ac.signal.aborted ? 'cancelled' : 'done', finishedAt: Date.now() }));
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Decision Evals</h1>
        <nav className="tabs">
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
              {t === 'models' && selected.length > 0 && <span className="count">{selected.length}</span>}
              {t === 'run' && running && <span className="count live">{progress.done}/{progress.total}</span>}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="spend" title="Total cost across all stored runs">Total spend: <b>{fmtUsd(totalSpend)}</b></span>
        <button className={`key-badge ${apiKey ? 'ok' : 'bad'}`} onClick={() => setShowSettings(true)}>
          {apiKey ? '● Key loaded' : '○ No key'} · Settings
        </button>
      </header>
      {storageWarn && (
        <div className="banner">
          localStorage is full, so recent changes may not persist. Delete old runs or export them.
          <button className="small" onClick={() => setStorageWarn(false)}>Dismiss</button>
        </div>
      )}
      <main>
        {tab === 'models' && (
          <ModelsTab models={modelCache.data} fetchedAt={modelCache.fetchedAt} loading={modelsLoading} error={modelsError}
            onRefresh={refreshModels} selected={selected} setSelected={setSelected} />
        )}
        {tab === 'dataset' && <DatasetTab dataset={dataset} overlay={overlay} setOverlay={setOverlay} />}
        {tab === 'run' && (
          <RunTab dataset={dataset} selectedModels={selected} hasKey={!!apiKey} running={running} progress={progress}
            onStart={(cfg) => { startRun(cfg); }} onCancel={() => abortRef.current?.abort()} goToModels={() => setTab('models')} />
        )}
        {tab === 'results' && (
          <ResultsTab runs={runs} activeId={activeRunId} setActiveId={setActiveRunId}
            deleteRun={(id) => setRuns((rs) => rs.filter((r) => r.id !== id))}
            importRuns={(imported) => {
              const ids = new Set(imported.map((r) => r.id));
              setRuns((rs) => [...imported, ...rs.filter((r) => !ids.has(r.id))]);
              setActiveRunId(imported[0].id);
            }} />
        )}
      </main>
      {showSettings && <Settings override={keyOverride} setOverride={setKeyOverride} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
