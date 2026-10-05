import { useMemo, useState } from 'react';
import { pricePerM } from '../lib/openrouter';
import { allDecisionModels, freeOnly } from '../lib/presets';
import type { ORModel } from '../lib/types';

interface Props {
  models: ORModel[];
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
}

const fmtPrice = (p?: string) => {
  const v = pricePerM(p);
  return v == null ? 'var' : v === 0 ? 'free' : `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
};

export function ModelsTab({ models, fetchedAt, loading, error, onRefresh, selected, setSelected }: Props) {
  const [q, setQ] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const sel = useMemo(() => new Set(selected), [selected]);

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter((m) => {
      if (onlySelected && !sel.has(m.id)) return false;
      const hay = `${m.id} ${m.name ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [models, q, onlySelected, sel]);

  const toggle = (id: string) => setSelected(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="tab">
      <div className="toolbar">
        <input className="search" placeholder="Search decision models (e.g. 'clef')" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> selected only</label>
        <span className="spacer" />
        <span className="muted">Presets:</span>
        <button onClick={() => setSelected(allDecisionModels(models))}>All decision models</button>
        <button onClick={() => setSelected(freeOnly(models))}>Free only</button>
        <button onClick={() => setSelected([])}>Clear</button>
        <button onClick={onRefresh} disabled={loading}>{loading ? 'Loading…' : 'Refresh list'}</button>
      </div>
      <p className="muted small-text">
        {models.length} decision models (OpenRouter Decisions API; input tokens billed, output free){fetchedAt ? `, cached ${new Date(fetchedAt).toLocaleString()}` : ''} · {selected.length} selected · showing {shown.length}
        {error && <span className="error-text"> · {error}</span>}
      </p>
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((id) => (
            <span key={id} className="chip">{id}<button onClick={() => toggle(id)} aria-label="remove">×</button></span>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th></th><th>Model</th><th>Provider</th><th className="num">Context</th>
              <th className="num">Input $/1M</th><th>Input</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              return (
                <tr key={m.id} className={sel.has(m.id) ? 'selected' : ''} onClick={() => toggle(m.id)}>
                  <td><input type="checkbox" checked={sel.has(m.id)} readOnly /></td>
                  <td><div>{m.name ?? m.id}</div><div className="muted mono small-text">{m.id}</div></td>
                  <td>{m.id.split('/')[0]}</td>
                  <td className="num">{m.context_length ? m.context_length.toLocaleString() : '–'}</td>
                  <td className="num">{fmtPrice(m.pricing?.prompt)}</td>
                  <td className="muted small-text">{(m.architecture?.input_modalities ?? ['text']).join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
