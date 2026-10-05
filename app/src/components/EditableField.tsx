import { useState } from 'react';

interface Props {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
  /** Return an error message to block saving. */
  validate?: (v: string) => string | null;
  className?: string;
}

export function EditableField({ value, onSave, multiline, mono, placeholder, validate, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };
  const commit = () => {
    const err = validate?.(draft) ?? null;
    if (err) return setError(err);
    onSave(draft);
    setEditing(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setEditing(false);
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  if (!editing)
    return (
      <span className={`ef ${mono ? 'mono' : ''} ${multiline ? 'ef-block' : ''} ${className ?? ''}`}>
        <span className="ef-value">{value === '' ? <em className="muted">{placeholder ?? 'empty'}</em> : value}</span>
        <button className="pencil" title="Edit" onClick={start} aria-label="Edit">
          ✎
        </button>
      </span>
    );

  const common = {
    value: draft,
    autoFocus: true,
    onKeyDown: onKey,
    className: mono ? 'mono' : '',
    placeholder,
  };
  return (
    <span className={`ef-edit ${multiline ? 'ef-block' : ''}`}>
      {multiline ? (
        <textarea
          {...common}
          rows={Math.min(24, Math.max(3, draft.split('\n').length + 1))}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <input {...common} onChange={(e) => setDraft(e.target.value)} />
      )}
      <span className="ef-actions">
        <button className="primary small" onClick={commit}>
          Save
        </button>
        <button className="small" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {multiline && <span className="muted small-text">⌘/Ctrl+Enter to save, Esc to cancel</span>}
        {error && <span className="error-text">{error}</span>}
      </span>
    </span>
  );
}
