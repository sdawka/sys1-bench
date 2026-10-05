import type { ORModel } from './types';

/** OpenRouter Decisions API ("System One"). There is no chat-completions path in this app. */
export const OR_BASE = 'https://openrouter.ai/api/v1';
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const PLACEHOLDER_KEY = 'sk-or-REPLACE_ME';

// `import.meta.env` is undefined outside Vite (e.g. the node CLI in scripts/bench.ts).
export const envKey = (import.meta.env?.VITE_OPENROUTER_API_KEY ?? '').trim();
export const envKeyLoaded = envKey !== '' && envKey !== PLACEHOLDER_KEY;

export function orHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': 'http://localhost',
    'X-Title': 'Decision Evals',
    'Content-Type': 'application/json',
  };
}

/**
 * Collapse duplicate listings: `~provider/x-latest` aliases are dropped (they point at a concrete id),
 * and `id:free` is dropped when the same `id` is also listed.
 */
export function dedupeDecisionModels(models: ORModel[]): ORModel[] {
  const ids = new Set(models.map((m) => m.id));
  return models
    .filter((m) => !m.id.startsWith('~') && !(m.id.endsWith(':free') && ids.has(m.id.slice(0, -':free'.length))))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Every model that outputs decisions, deduplicated. */
export async function listDecisionModels(): Promise<ORModel[]> {
  const res = await fetch(`${OR_BASE}/models?output_modalities=decisions`);
  if (!res.ok) throw new Error(`Model list failed: HTTP ${res.status}`);
  const json = await res.json();
  return dedupeDecisionModels((json.data ?? []) as ORModel[]);
}

/** Price per 1M tokens, or null if unknown / variable. */
export function pricePerM(p: string | undefined): number | null {
  const n = Number(p);
  return p == null || !isFinite(n) || n < 0 ? null : n * 1e6;
}

export const isFree = (m: ORModel) => pricePerM(m.pricing?.prompt) === 0;

export interface Question {
  type: 'choice' | 'noul' | 'score';
  instructions: string;
  criteria: Record<string, string> | string[];
}

/** One answer from the Decisions API. Field presence depends on `type`. */
export interface Answer {
  type: 'choice' | 'noul' | 'score';
  choice?: string;
  noul?: number;
  score?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  confidence?: number;
}

export interface DecideUsage {
  cost?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface DecideResult {
  answer: Answer;
  usage: DecideUsage;
  latencyMs: number;
  /** Generation id, e.g. gen-dec-…. */
  id?: string;
  /** Dated upstream model id, e.g. typesafe/jev-1.13-20260917. */
  model?: string;
  provider?: string;
  httpStatus: number;
  /** Retries made inside decide() (0 or 1). */
  retries: number;
}

export class HttpError extends Error {
  retryAfter = 0;
  /** Retries made inside decide() before this error was thrown. */
  retries = 0;
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    });
  });

const QID = 'q';

async function decideOnce(key: string, body: unknown, signal?: AbortSignal): Promise<Omit<DecideResult, 'retries'>> {
  const t0 = performance.now();
  const res = await fetch(DECISIONS_URL, { method: 'POST', headers: orHeaders(key), body: JSON.stringify(body), signal });
  const text = await res.text();
  const latencyMs = Math.round(performance.now() - t0);
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || json?.error) {
    const status = res.ok ? Number(json?.error?.code) || 502 : res.status;
    const msg = json?.error?.message ?? text.slice(0, 300);
    const err = new HttpError(status, `HTTP ${status}: ${msg}`);
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw err;
  }
  const answer = json?.answers?.[QID];
  if (!answer || typeof answer !== 'object') throw new HttpError(502, `No answer in response: ${text.slice(0, 200)}`);
  return { answer: answer as Answer, usage: json.usage ?? {}, latencyMs, id: json.id, model: json.model, provider: json.provider, httpStatus: res.status };
}

export interface DecideParams {
  key: string;
  model: string;
  state: string | Record<string, unknown>;
  question: Question;
  signal?: AbortSignal;
}

export const isRetryable = (status: number) => status === 429 || status >= 500; // includes 524 / 529

/** POST /api/alpha/decisions with one retry on 429 / 5xx (incl. 524, 529) / network errors. */
export async function decide(p: DecideParams): Promise<DecideResult> {
  const body = { model: p.model, state: p.state, questions: { [QID]: p.question } };
  try {
    return { ...(await decideOnce(p.key, body, p.signal)), retries: 0 };
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e;
    const retryable = e instanceof HttpError ? isRetryable(e.status) : true;
    if (!retryable) throw e;
    const wait = (e.retryAfter ? e.retryAfter * 1000 : 1500) * (1 + Math.random());
    await sleep(Math.min(wait, 20000), p.signal);
    try {
      return { ...(await decideOnce(p.key, body, p.signal)), retries: 1 };
    } catch (e2: any) {
      if (e2 && typeof e2 === 'object') e2.retries = 1;
      throw e2;
    }
  }
}
