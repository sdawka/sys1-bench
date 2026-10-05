/**
 * Headless benchmark runner for the OpenRouter Decisions API ("System One" decision models).
 * Reuses the SPA's lib modules and writes a Run JSON that the Results tab can import ("Import run JSON").
 *
 *   npm run bench -- --models all --samples 3 --concurrency 6 --max-cost 2
 *   npm run bench -- --models liquid/d1,cloudflare/clef --categories clarity_score,priority_triage
 *   npm run bench -- --models free --estimate-only
 *
 * The API key comes from OPENROUTER_API_KEY, VITE_OPENROUTER_API_KEY, or app/.env.local.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuestion, checkDecisionSpec, norm } from '../src/lib/decision';
import { normalizeCategory } from '../src/lib/normalize';
import { listDecisionModels, PLACEHOLDER_KEY, pricePerM } from '../src/lib/openrouter';
import { allDecisionModels, freeOnly } from '../src/lib/presets';
import { buildTasks, CALL_TIMEOUT_MS, DEFAULT_SAMPLES, roughTokens, runAll } from '../src/lib/runner';
import { acc, fmtNum, fmtPct, fmtUsd, HIGH_CONF, mean, percentile, summarize, toCsv } from '../src/lib/summary';
import { instantiateCase } from '../src/lib/template';
import type { CaseResult, Category, ORModel, Run, RunConfig } from '../src/lib/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const DATA = resolve(APP, '../data/categories');

// ---------- args ----------
interface Args {
  models: string[];
  categories: string;
  samples: number;
  concurrency: number;
  seed: number;
  out: string | null;
  estimateOnly: boolean;
  maxCost: number;
  suspectMin: number;
  compare: string | null;
}

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(`usage: npm run bench -- [options]
  --models all|free|id1,id2   decision models (default all; list from /models?output_modalities=decisions)
  --categories all|id1,id2    (default all; categories without a decision block are skipped)
  --samples N                 samples per templated case (default ${DEFAULT_SAMPLES})
  --concurrency N             parallel calls per model; all models run in parallel (default 8).
                              A 429 halves only that model's in-flight limit, backs off and requeues the call
  --seed N                    template seed (default 42)
  --out path.json             (default results/<timestamp>.json)
  --estimate-only             print estimated cost (input tokens ~ chars/4; output is free), no calls
  --max-cost USD              abort once actual spend exceeds this
  --suspect-min N             flag cases where at least N models answer and are wrong (default 9)
  --compare run.json          add an accuracy-change column vs an earlier run file
Writes <out>.json (SPA-importable Run) and <out>.csv (one row per call, with response metadata).`);
  process.exit(msg ? 2 : 0);
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    models: [], categories: 'all', samples: DEFAULT_SAMPLES, concurrency: 8, seed: 42, out: null, estimateOnly: false,
    maxCost: Infinity, suspectMin: 9, compare: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const eq = flag.indexOf('=');
    const [k, inline] = eq > 0 ? [flag.slice(0, eq), flag.slice(eq + 1)] : [flag, undefined];
    const val = () => {
      const v = inline ?? argv[++i];
      if (v == null) usage(`${k} needs a value`);
      return v;
    };
    const num = () => {
      const n = Number(val());
      if (!isFinite(n)) usage(`${k} needs a number`);
      return n;
    };
    switch (k) {
      case '--models': a.models.push(...val().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--categories': a.categories = val(); break;
      case '--samples': a.samples = Math.max(1, Math.trunc(num())); break;
      case '--concurrency': a.concurrency = Math.max(1, Math.trunc(num())); break;
      case '--seed': a.seed = Math.trunc(num()); break;
      case '--out': a.out = val(); break;
      case '--estimate-only': a.estimateOnly = true; break;
      case '--max-cost': a.maxCost = num(); break;
      case '--suspect-min': a.suspectMin = Math.max(1, Math.trunc(num())); break;
      case '--compare': a.compare = val(); break;
      case '-h': case '--help': usage();
      default: usage(`unknown flag ${flag}`);
    }
  }
  if (!a.models.length) a.models = ['all'];
  return a;
}

// ---------- data / key ----------
function loadCategories(): { usable: Category[]; all: Category[] } {
  const all = readdirSync(DATA)
    .filter((f) => f.endsWith('.json'))
    .map((f) => normalizeCategory(JSON.parse(readFileSync(join(DATA, f), 'utf8')), f.replace(/\.json$/, '')))
    .sort((x, y) => x.id.localeCompare(y.id));
  const usable: Category[] = [];
  for (const c of all) {
    const problems = checkDecisionSpec(c.decision, c.output);
    if (problems.length) console.warn(`warning: skipping ${c.id}: ${problems.join('; ')}`);
    else usable.push(c);
  }
  return { usable, all };
}

function loadKey(): string {
  let key = (process.env.OPENROUTER_API_KEY ?? process.env.VITE_OPENROUTER_API_KEY ?? '').trim();
  const envFile = join(APP, '.env.local');
  if (!key && existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*VITE_OPENROUTER_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
    key = m?.[1] ?? '';
  }
  return key && key !== PLACEHOLDER_KEY ? key : '';
}

function resolveModels(spec: string[], catalog: ORModel[]): string[] {
  const ids = new Set<string>();
  const known = new Set(catalog.map((m) => m.id));
  for (const s of spec) {
    if (s === 'all') allDecisionModels(catalog).forEach((m) => ids.add(m));
    else if (s === 'free') freeOnly(catalog).forEach((m) => ids.add(m));
    else {
      if (!known.has(s)) console.warn(`warning: ${s} is not in the decision model list`);
      ids.add(s);
    }
  }
  return [...ids];
}

// ---------- formatting ----------
function table(headers: string[], rows: string[][], rightAlign: (i: number) => boolean = (i) => i > 0): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (rightAlign(i) ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ');
  return [line(headers), w.map((n) => '-'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

function abbreviations(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let len = 3; len <= 12; len++) {
    const seen = new Map<string, number>();
    for (const id of ids) seen.set(id.slice(0, len), (seen.get(id.slice(0, len)) ?? 0) + 1);
    for (const id of ids) if (!out[id] && seen.get(id.slice(0, len)) === 1) out[id] = id.slice(0, len);
  }
  for (const id of ids) out[id] ??= id;
  return out;
}

// ---------- estimate ----------
function estimate(cats: Category[], models: string[], a: Args, catalog: Map<string, ORModel>) {
  let tokens = 0;
  let calls = 0;
  for (const cat of cats) {
    const q = buildQuestion(cat.decision!);
    const qTokens = roughTokens(q.instructions + JSON.stringify(q.criteria));
    for (const t of buildTasks([cat], ['x'], a.samples)) {
      tokens += qTokens + roughTokens(instantiateCase(t.c, a.seed, t.sample).input);
      calls++;
    }
  }
  const rows = models.map((id) => {
    const p = Number(catalog.get(id)?.pricing?.prompt ?? NaN);
    return { id, perM: pricePerM(catalog.get(id)?.pricing?.prompt), cost: p * tokens };
  });
  rows.sort((x, y) => (isFinite(y.cost) ? y.cost : -1) - (isFinite(x.cost) ? x.cost : -1));
  const total = rows.reduce((s, r) => s + (isFinite(r.cost) ? r.cost : 0), 0);
  console.log(`\nEstimate: ${models.length} models x ${calls} calls/model (samples=${a.samples}), ~${Math.round(tokens / calls)} input tokens/call (chars/4); output is free\n`);
  console.log(table(['model', '$/M in', 'est. cost'], rows.map((r) => [r.id, r.perM?.toFixed(3) ?? '?', isFinite(r.cost) ? `$${r.cost.toFixed(5)}` : 'unknown'])));
  console.log(`\nTOTAL estimated: $${total.toFixed(4)} (${calls * models.length} calls)`);
}

// ---------- run ----------
async function execute(cats: Category[], models: string[], a: Args, catalog: Map<string, ORModel>, key: string) {
  const cfg: RunConfig = { categories: cats.map((c) => c.id), models, samples: a.samples, concurrency: a.concurrency, seed: a.seed };
  const tasks = buildTasks(cats, models, a.samples);
  const t0 = Date.now();
  const run: Run = {
    id: `run_${t0.toString(36)}`, createdAt: t0, status: 'running', config: cfg,
    categoryNames: Object.fromEntries(cats.map((c) => [c.id, c.name])), total: tasks.length, results: [], source: 'cli', unavailable: [],
  };
  const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = resolve(process.cwd(), a.out ?? join('results', `${stamp}.json`));
  mkdirSync(dirname(outPath), { recursive: true });
  const csvPath = outPath.replace(/\.json$/i, '') + '.csv';
  const save = () => {
    writeFileSync(outPath, JSON.stringify(run, null, 2));
    writeFileSync(csvPath, toCsv(run.results));
  };

  const ac = new AbortController();
  const onSigint = () => {
    console.error('\nInterrupted: saving partial run.');
    ac.abort();
  };
  process.on('SIGINT', onSigint);
  let spent = 0;
  let errors = 0;
  let costAbort = false;
  const tty = process.stderr.isTTY;
  const progress = () => {
    const done = run.results.length;
    const msg = `[${done}/${tasks.length}] spent ${fmtUsd(spent)} · errors ${errors} · ${((Date.now() - t0) / 1000).toFixed(0)}s`;
    if (tty) process.stderr.write(`\r${msg}   `);
    else if (done % 250 === 0 || done === tasks.length) console.error(msg);
  };

  const state = await runAll(tasks, cfg, key, catalog, ac.signal, (r: CaseResult) => {
    run.results.push(r);
    spent += r.cost;
    if (r.error) errors++;
    if (spent > a.maxCost && !costAbort) {
      costAbort = true;
      console.error(`\nSpend ${fmtUsd(spent)} exceeded --max-cost ${a.maxCost}; aborting.`);
      ac.abort();
    }
    if (run.results.length % 500 === 0) save();
    progress();
  }, { timeoutMs: CALL_TIMEOUT_MS, perModelConcurrency: a.concurrency });
  process.off('SIGINT', onSigint);
  if (tty) process.stderr.write('\n');

  run.status = ac.signal.aborted ? 'cancelled' : 'done';
  run.finishedAt = Date.now();
  run.unavailable = [...state.unavailable];
  // Unavailable models contribute only skipped placeholders; drop them so they do not rank last.
  run.results = run.results.filter((r) => !state.unavailable.has(r.model));
  if (run.status === 'done') run.total = run.results.length;
  save();
  let baseline: Run | null = null;
  if (a.compare) {
    try {
      baseline = JSON.parse(readFileSync(resolve(process.cwd(), a.compare), 'utf8')) as Run;
    } catch (e: any) {
      console.warn(`warning: cannot read --compare ${a.compare}: ${e.message}`);
    }
  }
  report(run, cats, spent, outPath, state.rejected, state.rateLimited, state.minConcurrency, a.suspectMin, baseline);
  console.log(`saved ${csvPath}`);
}

function report(run: Run, cats: Category[], spent: number, outPath: string, rejected: Map<string, string>, rateLimited: Map<string, number>, minConc: Map<string, number>, suspectMin: number, baseline: Run | null = null) {
  const ab = abbreviations(cats.map((c) => c.id));
  const sums = summarize(run.results).sort((x, y) => acc(y) - acc(x));
  const base = new Map((baseline ? summarize(baseline.results) : []).map((s) => [s.model, acc(s)]));
  const delta = (m: string, now: number) => {
    const b = base.get(m);
    if (b == null || !isFinite(b)) return '–';
    const d = Math.round((now - b) * 100);
    return d > 0 ? `+${d}pt` : d < 0 ? `${d}pt` : '0';
  };
  console.log('\n' + table(
    ['model', 'acc', ...(baseline ? ['Δacc'] : []), 'acc(ans)', 'n', 'Brier', 'p(exp)', 'conf✓', 'conf✗', `acc@≥${HIGH_CONF}`, 'cost', 'p50', 'p95', 'errors', 'skipped'],
    sums.map((s) => [
      s.model, fmtPct(acc(s)), ...(baseline ? [delta(s.model, acc(s))] : []), fmtPct(s.answered ? s.correct / s.answered : NaN), String(s.n), fmtNum(mean(s.brier)), fmtNum(mean(s.pExpected), 2),
      fmtNum(mean(s.confCorrect), 2), fmtNum(mean(s.confWrong), 2), `${fmtPct(acc(s.highConf))} (${s.highConf.n})`, fmtUsd(s.cost),
      s.latencies.length ? `${percentile(s.latencies, 0.5)}ms` : '–', s.latencies.length ? `${percentile(s.latencies, 0.95)}ms` : '–',
      String(s.errors), String(s.skipped),
    ]),
  ));
  console.log('\nPer-category accuracy:');
  console.log(table(['model', ...cats.map((c) => ab[c.id])], sums.map((s) => [s.model, ...cats.map((c) => (s.perCat[c.id] ? fmtPct(acc(s.perCat[c.id])) : '–'))])));
  console.log(`\ncategories: ${cats.map((c) => `${ab[c.id]}=${c.id}(${c.decision!.primitive})`).join(' ')}`);
  console.log('acc counts errors/skips as wrong; acc(ans) is over answered results only. Brier = mean (1-p(expected))², lower is better.');
  if (baseline) console.log(`Δacc = accuracy change in points vs ${baseline.id} (${new Date(baseline.createdAt).toISOString()}).`);
  if (run.unavailable?.length) console.log(`unavailable (first calls all failed): ${run.unavailable.join(', ')}`);
  for (const [pair, msg] of rejected) console.log(`rejected ${pair}: ${msg.slice(0, 160)}`);
  for (const [m, n] of rateLimited) console.log(`rate limited ${m}: ${n} x 429 (in-flight limit cut to ${minConc.get(m) ?? '?'}, calls requeued)`);

  // Group by case instance (case + sample) so templated vars match across models.
  const groups = new Map<string, CaseResult[]>();
  for (const r of run.results) {
    const k = `${r.categoryId}/${r.caseId}#${r.sample}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const rows = [...groups.entries()].map(([k, rs]) => {
    const answered = rs.filter((r) => r.decision != null);
    const wrong = answered.filter((r) => !r.correct);
    const votes = new Map<string, number>();
    for (const r of wrong) votes.set(norm(r.decision), (votes.get(norm(r.decision)) ?? 0) + 1);
    const top = [...votes].sort((x, y) => y[1] - x[1])[0];
    return { k, rs, answered: answered.length, wrong: wrong.length, top, expected: rs[0].expected };
  });
  console.log('\nHardest cases (most answering models wrong):');
  for (const h of [...rows].sort((x, y) => y.wrong - x.wrong || x.k.localeCompare(y.k)).slice(0, 10))
    console.log(`  ${h.wrong}/${h.answered} wrong  ${h.k}  expected ${JSON.stringify(h.expected)}  top wrong answer ${h.top ? `${h.top[0]}×${h.top[1]}` : '–'}`);

  const suspects = rows.filter((r) => r.wrong >= suspectMin).sort((x, y) => y.wrong - x.wrong || x.k.localeCompare(y.k));
  console.log(`\nCandidate dataset errors (>= ${suspectMin} answering models wrong): ${suspects.length}`);
  for (const s of suspects) console.log(`  ${s.k}  expected ${JSON.stringify(s.expected)}  models say ${s.top[0]} (${s.top[1]}/${s.answered}), ${s.wrong}/${s.answered} wrong`);

  const elapsed = ((run.finishedAt ?? Date.now()) - run.createdAt) / 1000;
  console.log(`\nstatus ${run.status} · ${run.results.length} results · total cost $${spent.toFixed(6)} · elapsed ${Math.floor(elapsed / 60)}m${Math.round(elapsed % 60)}s`);
  console.log(`saved ${outPath}`);
}

// ---------- main ----------
async function main() {
  const a = parseArgs(process.argv.slice(2));
  const { usable, all } = loadCategories();
  const wanted = a.categories === 'all' ? null : new Set(a.categories.split(',').map((s) => s.trim()));
  if (wanted) for (const id of wanted) if (!all.some((c) => c.id === id)) console.warn(`warning: unknown category ${id}`);
  const cats = wanted ? usable.filter((c) => wanted.has(c.id)) : usable;
  if (!cats.length) usage('no runnable categories (each needs a valid decision block)');
  const catalogList = await listDecisionModels();
  const catalog = new Map(catalogList.map((m) => [m.id, m]));
  const models = resolveModels(a.models, catalogList);
  if (!models.length) usage('no models selected');
  const cases = cats.reduce((s, c) => s + c.cases.length, 0);
  console.log(`${cats.length}/${all.length} categories runnable, ${cases} cases; ${models.length} decision models: ${models.join(', ')}`);

  if (a.estimateOnly) return estimate(cats, models, a, catalog);
  const key = loadKey();
  if (!key) usage('no OpenRouter key: set OPENROUTER_API_KEY or VITE_OPENROUTER_API_KEY in app/.env.local');
  await execute(cats, models, a, catalog, key);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
