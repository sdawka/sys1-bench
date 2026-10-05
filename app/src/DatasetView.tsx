import { useMemo, useState } from 'react';
import { shipped } from './lib/dataset';

const REPO = 'https://github.com/sdawka/sys1-bench';
export const githubFile = (id: string) => `${REPO}/blob/main/data/categories/${id}.json`;

/** Read-only browser for data/categories/*.json, with links back to the files on GitHub. */
export default function DatasetView() {
  const cats = useMemo(() => Object.values(shipped).sort((a, b) => a.id.localeCompare(b.id)), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const total = cats.reduce((a, c) => a + c.cases.length, 0);

  return (
    <div className="tab col gap">
      <div className="card row between wrap">
        <span>
          <b>{cats.length}</b> categories · <b>{total}</b> cases
        </span>
        <div className="row">
          <input type="search" placeholder="Filter cases…" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="small" href={`${REPO}/tree/main/data/categories`} target="_blank" rel="noreferrer">Browse data/categories on GitHub ↗</a>
        </div>
      </div>
      {cats.map((c) => {
        const cases = needle
          ? c.cases.filter((x) => `${x.id} ${x.title} ${x.input} ${x.tags.join(' ')}`.toLowerCase().includes(needle))
          : c.cases;
        if (needle && !cases.length) return null;
        const isOpen = open === c.id || !!needle;
        return (
          <div key={c.id} className="card col gap">
            <div className="row between wrap">
              <div className="row wrap">
                <button className="small" onClick={() => setOpen(isOpen && !needle ? null : c.id)}>{isOpen ? '▼' : '▶'}</button>
                <b>{c.name}</b>
                <span className="muted small-text">{c.decision?.primitive ?? c.output.type} · {c.domain ?? 'general'} · {cases.length} cases</span>
              </div>
              <div className="row">
                <a className="small" href={githubFile(c.id)} target="_blank" rel="noreferrer">View on GitHub ↗</a>
                <a className="small" href={`${REPO}/raw/main/data/categories/${c.id}.json`} target="_blank" rel="noreferrer">Raw</a>
              </div>
            </div>
            <p className="muted small-text">{c.description}</p>
            {isOpen && (
              <>
                {c.decision && (
                  <div>
                    <div className="field-label">Question</div>
                    <p className="small-text">{c.decision.instructions}</p>
                    <pre className="pre">{JSON.stringify(c.decision.criteria, null, 2)}</pre>
                  </div>
                )}
                {cases.map((x) => (
                  <details key={x.id} className="result">
                    <summary>
                      <span className="mono">{x.id}</span>
                      <span className="truncate">{x.title}</span>
                      <span className="spacer" />
                      <span className="muted small-text">{x.difficulty} · expected <b className="mono">{JSON.stringify(x.expected ?? x.expected_expr)}</b></span>
                    </summary>
                    <div className="result-body">
                      {x.vars && <div className="mono small-text">vars = {JSON.stringify(x.vars)}</div>}
                      <pre className="pre">{x.input}</pre>
                      {x.rationale && <div className="muted small-text">{x.rationale}</div>}
                    </div>
                  </details>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
