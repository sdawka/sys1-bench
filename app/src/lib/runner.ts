import { buildQuestion, scoreAnswer } from './decision';
import { decide, HttpError } from './openrouter';
import { instantiateCase, isTemplated } from './template';
import type { Case, CaseResult, Category, ORModel, RunConfig } from './types';

export const DEFAULT_SAMPLES = 3;
export const CALL_TIMEOUT_MS = 60_000;
/** A model whose first N non-rejection calls all fail is treated as unavailable. */
export const UNAVAILABLE_AFTER = 3;
/** A (model, primitive) pair that gets N 400/422 responses before any success is treated as rejected. */
export const REJECT_AFTER = 2;
/** A rate-limited (429) task is put back in its model's queue up to this many times before it is recorded as an error. */
export const MAX_REQUEUE = 6;
/** Successful calls in a row before a throttled model's in-flight limit grows by one again. */
const RAMP_UP_AFTER = 20;

export interface Task {
  model: string;
  category: Category;
  c: Case;
  sample: number;
}

/** Categories that can be sent to the Decisions API (they have a `decision` block). */
export const runnable = (cats: Category[]) => cats.filter((c) => !!c.decision);

/** Tasks for every model × case (× sample for templated cases), interleaved across models to spread load. */
export function buildTasks(categories: Category[], models: string[], samples: number): Task[] {
  const per = models.map((model) => {
    const tasks: Task[] = [];
    for (const category of runnable(categories))
      for (const c of category.cases) {
        const n = isTemplated(c) ? Math.max(1, samples) : 1;
        for (let sample = 0; sample < n; sample++) tasks.push({ model, category, c, sample });
      }
    return tasks;
  });
  const out: Task[] = [];
  const longest = Math.max(0, ...per.map((t) => t.length));
  for (let i = 0; i < longest; i++) for (const q of per) if (i < q.length) out.push(q[i]);
  return out;
}

/** Rough token count: chars / 4. */
export const roughTokens = (s: string) => Math.ceil(s.length / 4);

export function fallbackCost(model: ORModel | undefined, inputTokens: number): number {
  const p = Number(model?.pricing?.prompt ?? 0);
  return p > 0 ? p * inputTokens : 0;
}

const MAX_RAW = 4000;

function baseOf(t: Task) {
  return {
    model: t.model,
    categoryId: t.category.id,
    caseId: t.c.id,
    caseTitle: t.c.title,
    difficulty: t.c.difficulty,
    sample: t.sample,
    primitive: t.category.decision?.primitive,
  };
}

/** A result for a task that was not sent. */
export function skippedResult(t: Task, cfg: RunConfig, error: string): CaseResult {
  let inst: { vars?: Record<string, unknown>; input: string; expected: CaseResult['expected'] } = { input: t.c.input, expected: null };
  try {
    const i = instantiateCase(t.c, cfg.seed, t.sample);
    inst = { vars: isTemplated(t.c) ? i.vars : undefined, input: i.input, expected: i.expected };
  } catch {
    /* keep the template text */
  }
  return {
    ...baseOf(t), ...inst, decision: null, correct: false, confidence: null, probabilities: null, pExpected: null,
    brier: null, rawValue: null, raw: '', latencyMs: 0, inputTokens: 0, cost: 0, error, skipped: true,
  };
}

/** Run one case against one model. Rethrows only AbortError (run cancelled); everything else becomes an error result. */
export async function runTask(
  t: Task,
  cfg: RunConfig,
  key: string,
  models: Map<string, ORModel>,
  signal: AbortSignal,
): Promise<CaseResult> {
  const spec = t.category.decision;
  if (!spec) return skippedResult(t, cfg, `Category ${t.category.id} has no decision block`);
  let inst;
  try {
    inst = instantiateCase(t.c, cfg.seed, t.sample);
  } catch (e: any) {
    return skippedResult(t, cfg, `Template error: ${e.message}`);
  }
  const common = { ...baseOf(t), vars: isTemplated(t.c) ? inst.vars : undefined, input: inst.input, expected: inst.expected };
  const question = buildQuestion(spec);
  const ctx = models.get(t.model)?.context_length ?? 0;
  const est = roughTokens(inst.input + question.instructions + JSON.stringify(question.criteria)) + 50;
  if (ctx > 0 && est > ctx) return skippedResult(t, cfg, `Skipped: ~${est} tokens exceeds ${ctx}-token context`);

  const requestedAt = new Date().toISOString();
  try {
    const r = await decide({ key, model: t.model, state: inst.input, question, signal });
    const meta = {
      responseId: r.id ?? null, provider: r.provider ?? null, upstreamModel: r.model ?? null,
      outputTokens: r.usage.output_tokens ?? null, httpStatus: r.httpStatus, retries: r.retries, requestedAt,
    };
    const tokens = r.usage.input_tokens ?? 0;
    const cost = typeof r.usage.cost === 'number' ? r.usage.cost : fallbackCost(models.get(t.model), tokens);
    const rawJson = JSON.stringify(r.answer);
    const raw = rawJson.length > MAX_RAW ? rawJson.slice(0, MAX_RAW) + '…[truncated]' : rawJson;
    try {
      const s = scoreAnswer(spec, r.answer, inst.expected, t.category.output);
      return { ...common, ...s, raw, latencyMs: r.latencyMs, inputTokens: tokens, cost, error: null, ...meta };
    } catch (e: any) {
      return {
        ...common, decision: null, correct: false, confidence: null, probabilities: null, pExpected: null, brier: null,
        rawValue: null, raw, latencyMs: r.latencyMs, inputTokens: tokens, cost, error: `Bad answer: ${e.message}`, ...meta,
      };
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    const msg = e?.name === 'TimeoutError' ? `Timeout after ${CALL_TIMEOUT_MS / 1000}s` : String(e?.message ?? e);
    return {
      ...common, decision: null, correct: false, confidence: null, probabilities: null, pExpected: null, brier: null,
      rawValue: null, raw: '', latencyMs: 0, inputTokens: 0, cost: 0, error: msg,
      httpStatus: e instanceof HttpError ? e.status : null, retries: typeof e?.retries === 'number' ? e.retries : 0, requestedAt,
      responseId: null, provider: null, upstreamModel: null, outputTokens: null,
    };
  }
}

export interface PoolState {
  /** Models whose first calls all failed. Their remaining tasks are recorded as skipped. */
  unavailable: Set<string>;
  /** `${model}|${categoryId}` → first rejection message. Remaining tasks are recorded as skipped. */
  rejected: Map<string, string>;
  /** Rate-limit (429) responses seen per model (after decide()'s own retry). */
  rateLimited: Map<string, number>;
  /** Lowest in-flight limit each throttled model was cut to. */
  minConcurrency: Map<string, number>;
}

export interface PoolOptions {
  timeoutMs?: number;
  /**
   * Run each model in its own pool of up to this many in-flight calls (all models in parallel), instead of one
   * global pool of `cfg.concurrency`. A 429 affects only that model: its in-flight limit is halved (AIMD,
   * growing back by one after RAMP_UP_AFTER successes), it pauses with backoff, and the task is requeued
   * (up to MAX_REQUEUE times).
   */
  perModelConcurrency?: number;
}

const isRejection = (status?: number) => status === 400 || status === 422;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Worker pool with a per-call timeout. Every task produces exactly one result via onResult (possibly a
 * skipped one), unless the signal aborts. Returns which models/categories were dropped and why.
 * A model that rejects a category's question (400/422) REJECT_AFTER times before any success there has
 * that category skipped (e.g. Respan accepts only noul; some models cap the number of choice options).
 */
export async function runAll(
  tasks: Task[],
  cfg: RunConfig,
  key: string,
  models: Map<string, ORModel>,
  signal: AbortSignal,
  onResult: (r: CaseResult) => void,
  opts: PoolOptions = {},
): Promise<PoolState> {
  const timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
  const state: PoolState = { unavailable: new Set(), rejected: new Map(), rateLimited: new Map(), minConcurrency: new Map() };
  const firstCalls = new Map<string, boolean[]>(); // model -> ok flags of first non-rejection calls
  const rejections = new Map<string, number>();
  const pairOk = new Set<string>();
  const cooldownUntil = new Map<string, number>();
  const requeues = new Map<Task, number>();
  const limit = new Map<string, number>(); // model -> current in-flight limit (per-model mode)
  const streak = new Map<string, number>();

  const handle = async (t: Task, requeue: (t: Task) => void) => {
    const pair = `${t.model}|${t.category.id}`;
    if (state.unavailable.has(t.model)) return onResult(skippedResult(t, cfg, 'Skipped: model unavailable'));
    if (state.rejected.has(pair)) return onResult(skippedResult(t, cfg, `Skipped: question rejected by model (${state.rejected.get(pair)})`));
    const until = cooldownUntil.get(t.model) ?? 0;
    if (until > Date.now()) await wait(until - Date.now());
    let r: CaseResult;
    try {
      r = await runTask(t, cfg, key, models, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]));
    } catch (e: any) {
      if (e?.name === 'AbortError' || signal.aborted) return;
      throw e;
    }
    const res: CaseResult = { ...r, requeues: requeues.get(t) ?? 0 };
    const httpStatus = r.httpStatus ?? undefined;
    if (httpStatus === 429) {
      state.rateLimited.set(t.model, (state.rateLimited.get(t.model) ?? 0) + 1);
      if (opts.perModelConcurrency) {
        const lim = Math.max(1, Math.floor((limit.get(t.model) ?? opts.perModelConcurrency) / 2));
        limit.set(t.model, lim);
        state.minConcurrency.set(t.model, Math.min(lim, state.minConcurrency.get(t.model) ?? lim));
        streak.set(t.model, 0);
        const tries = requeues.get(t) ?? 0;
        if (tries < MAX_REQUEUE) {
          cooldownUntil.set(t.model, Math.max(cooldownUntil.get(t.model) ?? 0, Date.now() + 2000 * 2 ** Math.min(tries, 3)));
          requeues.set(t, tries + 1);
          return requeue(t);
        }
      }
    } else if (opts.perModelConcurrency && !res.error) {
      const n = (streak.get(t.model) ?? 0) + 1;
      streak.set(t.model, n);
      const lim = limit.get(t.model) ?? opts.perModelConcurrency;
      if (n >= RAMP_UP_AFTER && lim < opts.perModelConcurrency) {
        limit.set(t.model, lim + 1);
        streak.set(t.model, 0);
      }
    }
    if (!res.skipped) {
      if (isRejection(httpStatus)) {
        const n = (rejections.get(pair) ?? 0) + 1;
        rejections.set(pair, n);
        if (n >= REJECT_AFTER && !pairOk.has(pair)) state.rejected.set(pair, res.error ?? 'rejected');
      } else {
        if (!res.error || res.raw) pairOk.add(pair);
        const seen = firstCalls.get(t.model) ?? [];
        if (seen.length < UNAVAILABLE_AFTER) {
          seen.push(!res.error || !!res.raw);
          firstCalls.set(t.model, seen);
          if (seen.length === UNAVAILABLE_AFTER && seen.every((ok) => !ok)) state.unavailable.add(t.model);
        }
      }
    }
    onResult(res);
  };

  const pool = async (queue: Task[], workers: number, model?: string) => {
    let busy = 0; // tasks in flight or waiting out a cooldown; a 429 may requeue them, so idle workers wait
    const worker = async (i: number) => {
      while (!signal.aborted && (queue.length || busy)) {
        // Workers above the model's current limit idle until it grows back (per-model mode only).
        if (!queue.length || (model && i >= (limit.get(model) ?? workers))) {
          await wait(100);
          continue;
        }
        const t = queue.shift()!;
        busy++;
        try {
          await handle(t, (x) => queue.push(x));
        } finally {
          busy--;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, workers) }, (_, i) => worker(i)));
  };

  if (opts.perModelConcurrency) {
    const queues = new Map<string, Task[]>();
    for (const t of tasks) (queues.get(t.model) ?? queues.set(t.model, []).get(t.model)!).push(t);
    await Promise.all([...queues].map(([m, q]) => pool(q, opts.perModelConcurrency!, m)));
  } else {
    await pool([...tasks], cfg.concurrency);
  }
  return state;
}
