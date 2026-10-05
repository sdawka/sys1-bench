import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTasks, runAll } from './runner';
import type { CaseResult, Category, DecisionSpec } from './types';

const noul: DecisionSpec = { primitive: 'noul', instructions: 'ok?', criteria: { true: 'yes', false: 'no' }, true_option: 'pass', false_option: 'fail' };
const cat = (id: string, n: number): Category => ({
  id, name: id, description: '', system_prompt: '', output: { type: 'enum', options: ['pass', 'fail'] }, decision: noul,
  cases: Array.from({ length: n }, (_, i) => ({ id: `${id}_${i}`, title: '', difficulty: 'easy', tags: [], input: `case ${i}`, expected: 'pass' })),
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = () => json(200, { id: 'gen-dec-1', model: 'm-20260101', provider: 'P', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { cost: 0.001, input_tokens: 10, output_tokens: 0 } });

afterEach(() => vi.unstubAllGlobals());

describe('runAll', () => {
  it('recovers from a transient 429 without recording an error', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++calls === 1 ? json(429, { error: { code: 429, message: 'slow down' } }) : ok())));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out: CaseResult[] = [];
    const tasks = buildTasks([cat('a', 3)], ['m'], 1);
    const cfg = { categories: ['a'], models: ['m'], samples: 1, concurrency: 1, seed: 1 };
    // decide() retries once after ~1.5s, so the pool never sees this 429.
    const state = await runAll(tasks, cfg, 'k', new Map(), new AbortController().signal, (r) => out.push(r), { perModelConcurrency: 2 });
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.correct && !r.error)).toBe(true);
    expect(state.rateLimited.get('m') ?? 0).toBe(0);
    expect(out.filter((r) => r.retries === 1)).toHaveLength(1);
    expect(out[0]).toMatchObject({ httpStatus: 200, responseId: 'gen-dec-1', provider: 'P', upstreamModel: 'm-20260101', outputTokens: 0, requeues: 0 });
    expect(Date.parse(out[0].requestedAt!)).not.toBeNaN();
  }, 10_000);

  it('skips a category after repeated 400s but keeps other categories', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return body.state.startsWith('bad') ? json(400, { error: { code: 400, message: 'too many options' } }) : ok();
    }));
    const bad = cat('bad', 4);
    bad.cases.forEach((c) => (c.input = `bad ${c.id}`));
    const out: CaseResult[] = [];
    const cfg = { categories: ['bad', 'good'], models: ['m'], samples: 1, concurrency: 1, seed: 1 };
    const state = await runAll(buildTasks([bad, cat('good', 2)], ['m'], 1), cfg, 'k', new Map(), new AbortController().signal, (r) => out.push(r), { perModelConcurrency: 1 });
    expect(state.rejected.has('m|bad')).toBe(true);
    expect(out.find((r) => r.categoryId === 'bad' && !r.skipped)).toMatchObject({ httpStatus: 400, retries: 0 });
    expect(out.filter((r) => r.categoryId === 'bad' && r.skipped)).toHaveLength(2);
    expect(out.filter((r) => r.categoryId === 'good' && r.correct)).toHaveLength(2);
    expect(state.unavailable.size).toBe(0);
  });
});

describe('runAll rate limiting', () => {
  it('halves a model\'s in-flight limit on 429 and requeues until the call succeeds', async () => {
    let inFlight = 0;
    let peakAfterThrottle = 0;
    let throttled = false;
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      inFlight++;
      if (throttled) peakAfterThrottle = Math.max(peakAfterThrottle, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // The first 8 calls (both decide() attempts for the first 4 in-flight tasks) are rate limited.
      if (calls <= 8) {
        throttled = true;
        return json(429, { error: { code: 429, message: 'slow down' } });
      }
      return ok();
    }));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out: CaseResult[] = [];
    const cfg = { categories: ['a'], models: ['m'], samples: 1, concurrency: 1, seed: 1 };
    const state = await runAll(buildTasks([cat('a', 6)], ['m'], 1), cfg, 'k', new Map(), new AbortController().signal, (r) => out.push(r), { perModelConcurrency: 4 });
    expect(out).toHaveLength(6);
    expect(out.every((r) => r.correct && !r.error)).toBe(true);
    expect(state.rateLimited.get('m')).toBeGreaterThan(0);
    expect(state.minConcurrency.get('m')).toBeLessThanOrEqual(2);
    expect(peakAfterThrottle).toBeLessThanOrEqual(4);
  }, 20_000);
});
