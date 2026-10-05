import { useMemo, useState } from 'react';
import { buildTasks, DEFAULT_SAMPLES } from '../lib/runner';
import { fmtUsd } from '../lib/summary';
import type { Category, RunConfig } from '../lib/types';

interface Props {
  dataset: Category[];
  selectedModels: string[];
  hasKey: boolean;
  running: boolean;
  progress: { done: number; total: number; cost: number; errors: number };
  onStart: (cfg: RunConfig) => void;
  onCancel: () => void;
  goToModels: () => void;
}

export function RunTab({ dataset, selectedModels, hasKey, running, progress, onStart, onCancel, goToModels }: Props) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [samples, setSamples] = useState(DEFAULT_SAMPLES);
  const [concurrency, setConcurrency] = useState(6);
  const [seed, setSeed] = useState(42);

  const cats = dataset.filter((c) => !excluded.has(c.id) && c.decision);
  const missing = dataset.filter((c) => !c.decision);
  const taskCount = useMemo(() => buildTasks(cats, selectedModels, samples).length, [cats, selectedModels, samples]);
  const toggle = (id: string) => {
    const n = new Set(excluded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExcluded(n);
  };
  const pct = progress.total ? (progress.done / progress.total) * 100 : 0;
  const blocked = !hasKey ? 'Add an OpenRouter key in Settings first.' : !selectedModels.length ? 'Select at least one model.' : !cats.length ? 'Select at least one category.' : null;

  return (
    <div className="tab col gap">
      <div className="card">
        <div className="row between">
          <h3>Categories ({cats.length}/{dataset.length}) · {cats.reduce((n, c) => n + c.cases.length, 0)} cases</h3>
          <div className="row">
            <button className="small" onClick={() => setExcluded(new Set())}>Select all</button>
            <button className="small" onClick={() => setExcluded(new Set(dataset.map((c) => c.id)))}>Select none</button>
          </div>
        </div>
        <div className="grid-checks">
          {dataset.map((c) => (
            <label key={c.id} className="check" title={c.decision ? undefined : 'No decision block: cannot be sent to the Decisions API'}>
              <input type="checkbox" disabled={!c.decision} checked={!!c.decision && !excluded.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}
              <span className="muted small-text"> ({c.cases.length}{c.decision ? ` · ${c.decision.primitive}` : ' · no decision block'})</span>
            </label>
          ))}
        </div>
        {missing.length > 0 && <p className="error-text small-text">{missing.length} categories lack a decision block and are skipped.</p>}
      </div>

      <div className="card">
        <div className="row between">
          <h3>Models ({selectedModels.length})</h3>
          <button className="small" onClick={goToModels}>Change selection</button>
        </div>
        <div className="chips">{selectedModels.map((m) => <span key={m} className="chip">{m}</span>)}</div>
        {!selectedModels.length && <p className="muted">No models selected.</p>}
      </div>

      <div className="card row wrap gap">
        <label className="field small-field">Samples per templated case
          <input type="number" min={1} max={20} value={samples} onChange={(e) => setSamples(Math.max(1, +e.target.value || 1))} />
        </label>
        <label className="field small-field" title="Parallel calls per model; all selected models run in parallel">Concurrency per model
          <input type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, +e.target.value || 1))} />
        </label>
        <label className="field small-field">Seed
          <input type="number" value={seed} onChange={(e) => setSeed(Math.trunc(+e.target.value || 0))} />
        </label>
      </div>

      <div className="card col gap">
        <div className="row">
          {!running ? (
            <button className="primary big" disabled={!!blocked} onClick={() => onStart({ categories: cats.map((c) => c.id), models: selectedModels, samples, concurrency, seed })}>
              Run {taskCount} calls
            </button>
          ) : (
            <button className="danger big" onClick={onCancel}>Cancel</button>
          )}
          {blocked && !running && <span className="muted">{blocked}</span>}
        </div>
        {(running || progress.total > 0) && (
          <>
            <div className="progress"><div style={{ width: `${pct}%` }} /></div>
            <div className="muted small-text">
              {progress.done}/{progress.total} done · {progress.errors} errors · {fmtUsd(progress.cost)} spent
            </div>
          </>
        )}
      </div>
    </div>
  );
}
