/** Publish the newest saved run as public/results/latest.json (committed, so Pages ships it): npm run publish-results [-- results/<run>.json] */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRunJson } from '../src/lib/parseRun';

const arg = process.argv[2];
const src = arg ?? (() => {
  const newest = readdirSync('results')
    .filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.includes('.bak'))
    .sort()
    .at(-1);
  if (!newest) { console.error('no results/*.json found'); process.exit(1); }
  return join('results', newest);
})();

const text = readFileSync(src, 'utf8');
const [run] = parseRunJson(text); // same validation the SPA applies on load
mkdirSync('public/results', { recursive: true });
writeFileSync('public/results/latest.json', JSON.stringify(JSON.parse(text)));
const kb = Math.round(statSync('public/results/latest.json').size / 1024);
console.log(`${src} -> public/results/latest.json (${run.id}, ${run.results.length} results, ${kb} KB)`);
