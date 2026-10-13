/** Stage a saved run, or merge compatible runs, as public/results/latest.json for Pages. */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRunJson } from '../src/lib/parseRun';

const args = process.argv.slice(2);
const replacements = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--replace') continue;
  const value = args[i + 1];
  const pair = value?.split('=');
  if (!pair || pair.length !== 2 || !pair[0] || !pair[1] || pair[0] === pair[1])
    throw new Error('--replace needs old-model=new-model');
  if (replacements.has(pair[0])) throw new Error(`Duplicate replacement: ${pair[0]}`);
  replacements.set(pair[0], pair[1]);
  args.splice(i, 2);
  i--;
}
const merge = args[0] === '--merge';
if (merge && args.length < 3) throw new Error('--merge needs at least two run files');
if (replacements.size && !merge) throw new Error('--replace requires --merge');
const arg = args[0];
const src = arg ?? (() => {
  const newest = readdirSync('results')
    .filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.includes('.bak'))
    .sort()
    .at(-1);
  if (!newest) { console.error('no results/*.json found'); process.exit(1); }
  return join('results', newest);
})();

const paths = merge ? args.slice(1) : [src];
const runs = paths.map((path) => {
  const parsed = parseRunJson(readFileSync(path, 'utf8'));
  if (parsed.length !== 1) throw new Error(`${path}: expected a single run`);
  return parsed[0];
});
const [run] = runs;
if (merge) {
  const models = new Set(run.config.models);
  const cases = new Map(run.results.map((r) => [JSON.stringify([r.categoryId, r.caseId, r.sample]), r]));
  for (const next of runs.slice(1)) {
    if (run.status !== 'done' || next.status !== 'done') throw new Error('Only completed runs can be merged');
    if (run.config.seed !== next.config.seed || run.config.samples !== next.config.samples ||
        JSON.stringify([...run.config.categories].sort()) !== JSON.stringify([...next.config.categories].sort()))
      throw new Error('Merged runs must have identical categories, seed and sample count');
    for (const model of next.config.models) {
      if (models.has(model)) throw new Error(`Model appears in multiple runs: ${model}`);
      models.add(model);
    }
    for (const result of next.results) {
      const original = cases.get(JSON.stringify([result.categoryId, result.caseId, result.sample]));
      if (!original || original.input !== result.input || original.primitive !== result.primitive ||
          JSON.stringify(original.expected) !== JSON.stringify(result.expected))
        throw new Error(`Case differs between runs: ${result.categoryId}/${result.caseId}/${result.sample}`);
    }
    run.results.push(...next.results);
    run.unavailable = [...new Set([...(run.unavailable ?? []), ...(next.unavailable ?? [])])];
  }
  for (const [oldModel, newModel] of replacements) {
    if (!runs[0].config.models.includes(oldModel)) throw new Error(`Replacement model not in baseline: ${oldModel}`);
    if (!runs.slice(1).some((r) => r.config.models.includes(newModel)))
      throw new Error(`Replacement model not in new runs: ${newModel}`);
    const oldResults = run.results.filter((r) => r.model === oldModel);
    const newResults = run.results.filter((r) => r.model === newModel);
    const keys = (rows: typeof oldResults) => rows.map((r) => JSON.stringify([r.categoryId, r.caseId, r.sample])).sort();
    if (!newResults.length || newResults.some((r) => r.error) || JSON.stringify(keys(oldResults)) !== JSON.stringify(keys(newResults)))
      throw new Error(`Replacement must answer every original case without errors: ${newModel}`);
    run.results = run.results.filter((r) => r.model !== oldModel);
    models.delete(oldModel);
    run.unavailable = run.unavailable?.filter((id) => id !== oldModel);
  }
  run.config.models = [...models];
  run.total = run.results.length;
  run.finishedAt = Math.max(...runs.map((r) => r.finishedAt ?? r.createdAt));
  run.id = `merged_${run.finishedAt.toString(36)}`;
}
mkdirSync('public/results', { recursive: true });
writeFileSync('public/results/latest.json', JSON.stringify(run));
const kb = Math.round(statSync('public/results/latest.json').size / 1024);
console.log(`${paths.join(' + ')} -> public/results/latest.json (${run.id}, ${run.results.length} results, ${kb} KB)`);
