import { useState } from 'react';
import { envKeyLoaded } from '../lib/openrouter';

interface Props {
  override: string;
  setOverride: (k: string) => void;
  onClose: () => void;
}

export function Settings({ override, setOverride, onClose }: Props) {
  const [draft, setDraft] = useState(override);
  const mask = (k: string) => (k.length > 12 ? `${k.slice(0, 8)}…${k.slice(-4)}` : '••••');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p>
          <strong>.env.local key:</strong>{' '}
          {envKeyLoaded ? <span className="ok">loaded</span> : <span className="bad">not set (placeholder)</span>}
        </p>
        <p>
          <strong>In-app override:</strong>{' '}
          {override ? <span className="ok">{mask(override)}</span> : <span className="muted">none</span>}
        </p>
        <label className="field">
          OpenRouter API key override (stored in this browser's localStorage, takes precedence over .env.local)
          <input
            type="password"
            value={draft}
            placeholder="sk-or-..."
            onChange={(e) => setDraft(e.target.value.trim())}
          />
        </label>
        <div className="row">
          <button className="primary" onClick={() => { setOverride(draft); onClose(); }}>
            Save
          </button>
          <button onClick={() => { setOverride(''); setDraft(''); }}>Clear override</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted small-text">
          To use a file instead, put <code>VITE_OPENROUTER_API_KEY=sk-or-…</code> in <code>app/.env.local</code> and
          restart <code>npm run dev</code>.
        </p>
      </div>
    </div>
  );
}
