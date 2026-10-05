import { useState } from 'react';
import { newCategory, shipped, type Overlay } from '../lib/dataset';
import { checkDecisionSpec } from '../lib/decision';
import { download } from '../lib/storage';
import { instantiateCase, isTemplated } from '../lib/template';
import type { Case, Category } from '../lib/types';
import { EditableField } from './EditableField';

interface Props {
  dataset: Category[];
  overlay: Overlay;
  setOverlay: (fn: (o: Overlay) => Overlay) => void;
}

const jsonValidator = (allowEmpty: boolean) => (v: string) => {
  if (allowEmpty && v.trim() === '') return null;
  try {
    const x = JSON.parse(v);
    return x && typeof x === 'object' && !Array.isArray(x) ? null : 'Must be a JSON object';
  } catch (e: any) {
    return `Invalid JSON: ${e.message}`;
  }
};

export function DatasetTab({ dataset, overlay, setOverlay }: Props) {
  const [activeId, setActiveId] = useState<string | null>(dataset[0]?.id ?? null);
  const active = dataset.find((c) => c.id === activeId) ?? dataset[0];

  const update = (cat: Category) => setOverlay((o) => ({ ...o, [cat.id]: cat }));
  const reset = (id: string) => {
    const msg = shipped[id] ? `Discard all edits to "${id}"?` : `"${id}" was added in-app. Delete it?`;
    if (!confirm(msg)) return;
    setOverlay((o) => {
      const { [id]: _drop, ...rest } = o;
      return rest;
    });
  };
  const resetAll = () => {
    if (confirm('Discard ALL dataset edits and in-app categories?')) setOverlay(() => ({}));
  };
  const addCategory = () => {
    const id = prompt('New category id (snake_case):')?.trim();
    if (!id) return;
    if (!/^[a-z][a-z0-9_]*$/.test(id)) return alert('Use snake_case: lowercase letters, digits, underscores.');
    if (dataset.some((c) => c.id === id)) return alert('That id already exists.');
    update(newCategory(id));
    setActiveId(id);
  };
  const exportCombined = () =>
    download('dataset.json', JSON.stringify({ exportedAt: new Date().toISOString(), categories: dataset }, null, 2));
  const exportFiles = () => dataset.forEach((c, i) => setTimeout(() => download(`${c.id}.json`, JSON.stringify(c, null, 2) + '\n'), i * 250));

  return (
    <div className="tab dataset">
      <aside className="sidebar">
        <div className="col gap">
          <button onClick={addCategory}>+ Add category</button>
          <button onClick={exportCombined}>Export dataset (combined JSON)</button>
          <button onClick={exportFiles} title="Downloads one <id>.json per category, ready to drop into data/categories">Download as files</button>
          <button className="danger" onClick={resetAll} disabled={!Object.keys(overlay).length}>Reset all to shipped</button>
        </div>
        <p className="muted small-text">{dataset.length} categories · {dataset.reduce((n, c) => n + c.cases.length, 0)} cases</p>
        <ul className="nav-list">
          {dataset.map((c) => (
            <li key={c.id}>
              <button className={c.id === active?.id ? 'active' : ''} onClick={() => setActiveId(c.id)}>
                <span>{c.name} <span className="badge domain">{c.domain || 'general'}</span></span>
                <span className="muted small-text">
                  {c.cases.length} cases{overlay[c.id] ? (shipped[c.id] ? ' · edited' : ' · new') : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!dataset.length && <p className="muted">No category files found in data/categories.</p>}
      </aside>
      <section className="main">
        {active && <CategoryEditor key={active.id} cat={active} edited={!!overlay[active.id]} onChange={update} onReset={() => reset(active.id)} />}
      </section>
    </div>
  );
}

function CategoryEditor({ cat, edited, onChange, onReset }: { cat: Category; edited: boolean; onChange: (c: Category) => void; onReset: () => void }) {
  const set = <K extends keyof Category>(k: K, v: Category[K]) => onChange({ ...cat, [k]: v });
  const setCase = (i: number, c: Case) => set('cases', cat.cases.map((x, j) => (j === i ? c : x)));
  const prefix = cat.cases[0]?.id.split('_')[0] ?? cat.id.slice(0, 2);
  const nextId = () => {
    let n = cat.cases.length + 1;
    const ids = new Set(cat.cases.map((c) => c.id));
    while (ids.has(`${prefix}_${String(n).padStart(2, '0')}`)) n++;
    return `${prefix}_${String(n).padStart(2, '0')}`;
  };
  const addCase = () =>
    set('cases', [...cat.cases, { id: nextId(), title: 'New case', difficulty: 'medium', tags: [], input: '', expected: cat.output.options?.[0] ?? '' }]);
  const dupCase = (i: number) => {
    const copy: Case = { ...structuredClone(cat.cases[i]), id: nextId(), title: `${cat.cases[i].title} (copy)` };
    set('cases', [...cat.cases.slice(0, i + 1), copy, ...cat.cases.slice(i + 1)]);
  };
  const delCase = (i: number) => {
    if (confirm(`Delete case ${cat.cases[i].id} "${cat.cases[i].title}"?`)) set('cases', cat.cases.filter((_, j) => j !== i));
  };

  return (
    <div className="col gap">
      <div className="row between">
        <h2><EditableField value={cat.name} onSave={(v) => set('name', v)} /></h2>
        <div className="row">
          <span className="badge domain">{cat.domain || 'general'}</span>
          <span className="muted mono">{cat.id}</span>
          {edited && <button className="danger small" onClick={onReset}>{shipped[cat.id] ? 'Reset to shipped' : 'Delete category'}</button>}
        </div>
      </div>
      <Field label="Description"><EditableField multiline value={cat.description} onSave={(v) => set('description', v)} /></Field>
      <Field label="Decision question (primitive, instructions, criteria; sent to the Decisions API)">
        {!cat.decision && <div className="error-text small-text">No decision block: this category is skipped when running.</div>}
        <EditableField
          multiline mono
          value={cat.decision ? JSON.stringify(cat.decision, null, 2) : ''}
          placeholder='{"primitive": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}, "true_option": "...", "false_option": "..."}'
          validate={(v) => {
            try {
              const problems = checkDecisionSpec(JSON.parse(v), cat.output);
              return problems.length ? problems.join('; ') : null;
            } catch (e) {
              return `Invalid JSON: ${(e as Error).message}`;
            }
          }}
          onSave={(v) => set('decision', JSON.parse(v))}
        />
      </Field>
      <Field label="Output (type, options / min, max, tolerance)">
        <EditableField
          multiline mono
          value={JSON.stringify(cat.output, null, 2)}
          validate={jsonValidator(false)}
          onSave={(v) => set('output', JSON.parse(v))}
        />
      </Field>
      {cat.system_prompt && (
        <details>
          <summary className="muted small-text">Legacy system_prompt (reference only, never sent)</summary>
          <pre className="pre">{cat.system_prompt}</pre>
        </details>
      )}
      <div className="row between">
        <h3>Cases ({cat.cases.length})</h3>
        <button onClick={addCase}>+ Add case</button>
      </div>
      {cat.cases.map((c, i) => (
        <CaseEditor key={i} c={c} cat={cat} onChange={(nc) => setCase(i, nc)} onDuplicate={() => dupCase(i)} onDelete={() => delCase(i)} />
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-row">
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  );
}

function CaseEditor({ c, cat, onChange, onDuplicate, onDelete }: { c: Case; cat: Category; onChange: (c: Case) => void; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof Case>(k: K, v: Case[K]) => onChange({ ...c, [k]: v });
  const setExpected = (v: string) => {
    const t = v.trim();
    set('expected', t === '' ? undefined : cat.output.type === 'number' && isFinite(Number(t)) ? Number(t) : t);
  };
  const expectedShown = c.expected_expr ? `expr: ${c.expected_expr}` : String(c.expected ?? '');

  return (
    <div className={`card case ${open ? 'open' : ''}`}>
      <div className="case-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="mono">{c.id}</span>
        <span className="case-title">{c.title}</span>
        <span className={`badge diff-${c.difficulty}`}>{c.difficulty}</span>
        {isTemplated(c) && <span className="badge templ">templated</span>}
        <span className="muted mono small-text truncate">→ {expectedShown}</span>
        <span className="spacer" />
        <span className="row" onClick={(e) => e.stopPropagation()}>
          <button className="small" onClick={onDuplicate}>Duplicate</button>
          <button className="small danger" onClick={onDelete}>Delete</button>
        </span>
      </div>
      {open && (
        <div className="case-body">
          <Field label="ID"><EditableField mono value={c.id} onSave={(v) => set('id', v.trim())} /></Field>
          <Field label="Title"><EditableField value={c.title} onSave={(v) => set('title', v)} /></Field>
          <Field label="Difficulty"><EditableField value={c.difficulty} onSave={(v) => set('difficulty', v.trim())} placeholder="easy | medium | hard | edge" /></Field>
          <Field label="Tags"><EditableField value={c.tags.join(', ')} onSave={(v) => set('tags', v.split(',').map((t) => t.trim()).filter(Boolean))} placeholder="comma-separated" /></Field>
          <Field label="Input"><EditableField multiline value={c.input} onSave={(v) => set('input', v)} /></Field>
          <Field label="Expected"><EditableField mono value={String(c.expected ?? '')} onSave={setExpected} placeholder="literal decision" /></Field>
          <Field label="Expected expr"><EditableField mono value={c.expected_expr ?? ''} onSave={(v) => set('expected_expr', v.trim() || undefined)} placeholder="JS over vars, e.g. vars.n > 6 ? 'fail' : 'pass'" /></Field>
          <Field label="Vars (JSON)">
            <EditableField
              multiline mono
              value={c.vars ? JSON.stringify(c.vars, null, 2) : ''}
              placeholder='{"n": {"type": "int", "min": 1, "max": 12}}'
              validate={jsonValidator(true)}
              onSave={(v) => set('vars', v.trim() ? JSON.parse(v) : undefined)}
            />
          </Field>
          <Field label="Rationale"><EditableField multiline value={c.rationale ?? ''} onSave={(v) => set('rationale', v)} /></Field>
          {isTemplated(c) && <TemplatePreview c={c} />}
        </div>
      )}
    </div>
  );
}

function TemplatePreview({ c }: { c: Case }) {
  const [sample, setSample] = useState(0);
  let body: React.ReactNode;
  try {
    const inst = instantiateCase(c, 'preview', sample);
    body = (
      <>
        <div className="mono small-text">vars = {JSON.stringify(inst.vars)}</div>
        <div className="mono small-text">expected = {JSON.stringify(inst.expected)}</div>
        <pre className="pre">{inst.input}</pre>
      </>
    );
  } catch (e: any) {
    body = <div className="error-text">Template error: {e.message}</div>;
  }
  return (
    <div className="preview">
      <div className="row">
        <strong>Preview</strong>
        <span className="muted small-text">sample #{sample}</span>
        <button className="small" onClick={() => setSample(sample + 1)}>Reroll</button>
      </div>
      {body}
    </div>
  );
}
