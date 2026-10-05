import type { Run } from './types';

/** Accept a single Run (SPA export or `npm run bench` output) or an array of them. */
export function parseRunJson(text: string): Run[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  for (const r of list) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !Array.isArray(r.results) || !r.config || !Array.isArray(r.config.models))
      throw new Error('Not a run JSON (expected id, config.models and results).');
    if (r.config.temperature != null || r.results.some((x: { primitive?: string; skipped?: boolean }) => !x.primitive))
      throw new Error('This is a chat-completions run. Only Decisions API runs can be imported.');
  }
  return list.map((r) => ({
    ...r,
    status: r.status === 'running' ? 'cancelled' : r.status,
    categoryNames: r.categoryNames ?? {},
    config: { ...r.config, categories: r.config.categories ?? [...new Set(r.results.map((x: { categoryId: string }) => x.categoryId))] },
    total: r.total ?? r.results.length,
  }));
}
