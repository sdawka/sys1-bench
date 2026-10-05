/**
 * Backfill flat per-call metadata into saved run JSON (no API calls):
 *   npm run backfill -- results/<run>.json [...]
 * Fields are taken from `raw` when it holds a full response envelope
 * ({id, provider, model, usage}). httpStatus is derived from success or the
 * "HTTP <n>:" prefix in the error. Fields that cannot be recovered stay null.
 * The original file is kept as <run>.bak.json; the CSV is regenerated.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { toCsv } from '../src/lib/summary';
import type { CaseResult, Run } from '../src/lib/types';

export function backfill(r: CaseResult): CaseResult {
  let env: Record<string, unknown> | null = null;
  try {
    const p = r.raw ? JSON.parse(r.raw) : null;
    if (p && typeof p === 'object' && ('id' in p || 'usage' in p || 'provider' in p)) env = p;
  } catch { /* raw is truncated or not JSON */ }
  const usage = (env?.usage ?? null) as { output_tokens?: number } | null;
  const errStatus = r.error ? /HTTP (\d{3})/.exec(r.error)?.[1] : undefined;
  const status = r.skipped ? null : r.error == null || r.raw ? 200 : errStatus ? Number(errStatus) : null;
  return {
    ...r,
    responseId: r.responseId ?? (typeof env?.id === 'string' ? env.id : null),
    provider: r.provider ?? (typeof env?.provider === 'string' ? env.provider : null),
    upstreamModel: r.upstreamModel ?? (typeof env?.model === 'string' ? env.model : null),
    outputTokens: r.outputTokens ?? (typeof usage?.output_tokens === 'number' ? usage.output_tokens : null),
    httpStatus: r.httpStatus ?? status,
    retries: r.retries ?? null,
    requestedAt: r.requestedAt ?? null,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npm run backfill -- results/<run>.json [...]');
  process.exit(2);
}
for (const f of files) {
  const run = JSON.parse(readFileSync(f, 'utf8')) as Run;
  const bak = f.replace(/\.json$/i, '') + '.bak.json';
  if (!existsSync(bak)) copyFileSync(f, bak);
  run.results = run.results.map(backfill);
  writeFileSync(f, JSON.stringify(run, null, 2));
  const csv = f.replace(/\.json$/i, '') + '.csv';
  writeFileSync(csv, toCsv(run.results));
  const n = (k: keyof CaseResult) => run.results.filter((x) => x[k] != null).length;
  console.log(`${f}: ${run.results.length} calls; non-null ` +
    ['responseId', 'provider', 'upstreamModel', 'outputTokens', 'httpStatus', 'retries', 'requestedAt']
      .map((k) => `${k}=${n(k as keyof CaseResult)}`).join(' '));
}
