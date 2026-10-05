/** Write a per-call CSV next to each saved run JSON (no API calls): npm run csv -- results/<run>.json [...] */
import { readFileSync, writeFileSync } from 'node:fs';
import { toCsv } from '../src/lib/summary';
import type { Run } from '../src/lib/types';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npm run csv -- results/<run>.json [...]');
  process.exit(2);
}
for (const f of files) {
  const run = JSON.parse(readFileSync(f, 'utf8')) as Run;
  const out = f.replace(/\.json$/i, '') + '.csv';
  writeFileSync(out, toCsv(run.results));
  console.log(`${out}: ${run.results.length} rows`);
}
