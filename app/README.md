# Decision Evals SPA

Vite + React 18 + TypeScript app with no backend. It loads every `../data/categories/*.json` file at build time and benchmarks **OpenRouter Decisions API** models ("System One" decision models) straight from the browser. There is no chat-completions path.

## Setup

```bash
cd app
npm install
# put your key in .env.local (it is git-ignored)
echo 'VITE_OPENROUTER_API_KEY=sk-or-...' > .env.local
npm run dev        # http://localhost:5173
npm test           # vitest: decisions scorer, question builder, templating, shipped-dataset sanity
npm run build      # typecheck + production build into dist/
```

You can also paste a key in **Settings** in the header. It is stored in localStorage and takes precedence over `.env.local`. Restart `npm run dev` after editing `.env.local`.

## Decisions API

- **Model list.** `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`. Duplicates are collapsed: `~…-latest` aliases are dropped, and `id:free` is dropped when `id` is also listed.
- **Call.** `POST https://openrouter.ai/api/alpha/decisions` with `{model, state, questions: {q: {type, instructions, criteria}}}`. The `state` is the instantiated case `input`, and the question comes from the category's `decision` block. The legacy `system_prompt` is never sent.
- **Errors.** `{error: {code, message}}` bodies become error results. 429 and 5xx responses, including 524 and 529, are retried once with backoff. Each call times out after 60s.
- **Billing.** Only input tokens are billed. Cost is taken from `usage.cost`.

| Primitive | Request criteria | Answer | Predicted label |
|---|---|---|---|
| `choice` | `{option: description}`, keys equal `output.options` | `choice`, `probabilities`, `confidence` | `choice` |
| `noul` | `{true: ..., false: ...}` | `noul` = p(true) | `p >= 0.5 ? true_option : false_option` |
| `score` | `[level0, ..., levelN]`, low to high | `score` (expected level), `probabilities` by level, `confidence` | `level_values[clamp(round(score))]`, numeric scales use `tolerance` |

Each result records the predicted label, the probability per label, the confidence, and p(expected). The confidence for `noul` is max(p, 1-p). It also records the Brier contribution (1 - p(expected))², input tokens, latency and cost. For `score`, p(expected) sums the levels that would count as correct.

### Models (live list, 2026-10-05)

13 listings collapse to 11 distinct models. SPEC.md says 12, but its own list names 11.

| Model | Input $/1M | Context | Notes |
|---|---|---|---|
| `cloudflare/clef` | 0.24 | 65k | |
| `cloudflare/clef-flash` | 0.09 | 65k | |
| `upstage/solar-decide` | 0.05 | 524k | |
| `jaredpalmer/kev-4b` | 0.042 | 8k | Cases over the context are skipped |
| `togethercomputer/tev1-4b-experimental` | 0.042 | 32k | |
| `typesafe/jev-1.13` | 0.042 | 32k | `~typesafe/jev-latest` is an alias of this model |
| `liquid/d1` | 0.04 | 65k | |
| `perplexity/pplx-decider-v1-27b` | 0.04 | 262k | |
| `respan/span-01` | 0.02 | – | Behaviour scoring; accepts `noul` only |
| `respan/span-01-lite` | free | – | Same as `:free`; accepts `noul` only |
| `inception/mercury-decide:free` | free | 32k | |

A model that returns 400 or 422 for a category twice before any success there has that category marked rejected. Its remaining cases are recorded as skipped, with no call made. This covers Respan's noul-only limit and the option caps on `type_classification`'s 28 options: Tev1 accepts at most 20 and Solar Decide at most 26. A model whose first 3 other calls all fail is marked unavailable. Every model runs in its own pool with the configured concurrency, and all models run in parallel. A 429 pauses only that model with exponential backoff and requeues the call once.

## Tabs

- **Models.** Lists only decision models, fetched live and cached in localStorage. The presets are **All decision models**, **Free only** and **Clear**.
- **Dataset.** Every field has a pencil icon for in-place editing, including the `decision` block, which is checked against `output`. You can add, duplicate, or delete cases and add categories. Edits live in a localStorage overlay and can be reset per category or globally. Templated cases show a preview with vars filled in. Exports are one combined JSON, or one file per category ready to drop into `data/categories/`.
- **Run.** Pick categories, samples per templated case (default 3), concurrency per model, and seed. Categories without a `decision` block are disabled. Vars are drawn with `mulberry32(hash(seed|caseId|sample))`, so the same seed always gives the same inputs.
- **Results.** Each model gets accuracy, Brier score, p50 and p95 latency, mean p(expected), mean confidence on correct and on incorrect answers, and accuracy at confidence of 0.9 or higher. It also gets per-category accuracy, cost, cost per correct answer, mean latency, and errors with a skipped count. Columns are sortable. Clicking a cell drills down to expected vs predicted, the probability per label, and the raw answer. A case-by-model matrix shows which models missed which case. You can export JSON or CSV and **Import run JSON** from the CLI.

## Headless runs (CLI)

`scripts/bench.ts` runs the same lib code from node and writes a run JSON that the Results tab can load with **Import run JSON**.

```bash
npm run bench -- --models all --samples 3 --concurrency 8 --max-cost 2   # 8 in flight per model
npm run bench -- --models liquid/d1,cloudflare/clef --categories priority_triage,clarity_score
npm run bench -- --models free --estimate-only     # input tokens ~ chars/4 x price; no calls
```

- **Models.** `all`, `free`, or a comma list of ids.
- **Categories.** Files whose `decision` block is missing or inconsistent are skipped with a warning.
- **Budget.** `--max-cost USD` aborts once actual spend passes the cap. A full run of 11 models x 231 cases with 3 samples per templated case is estimated at under $0.10.
- **Output.** Results go to `results/<timestamp>.json` plus a per-call `results/<timestamp>.csv`, both git-ignored. Each call row keeps the response id, provider, dated upstream model, input and output tokens, HTTP status, retries, requeues and request time. `--compare <earlier.json>` adds an accuracy-change column. The console prints a per-model table, a per-category accuracy table, and the hardest cases. It also lists candidate dataset errors, meaning cases where at least `--suspect-min` (default 9) answering models were wrong.
- **Offline tools.** These make no API calls. `npm run csv -- results/<run>.json` rebuilds the per-call CSV. `npm run backfill -- results/<run>.json` fills the flat metadata fields from `raw` where it can and derives the HTTP status from the error text. It keeps the original as `<run>.bak.json`. Runs saved before the metadata change stored only the answer in `raw`, so their id, provider, dated model, output tokens, retries and request time stay empty.
- **Key.** The key is read from `OPENROUTER_API_KEY`, `VITE_OPENROUTER_API_KEY`, or `.env.local`.

Large CLI runs can exceed the browser's ~5 MB localStorage. An imported run that does not fit still displays for the session, and the "storage full" banner appears.

## Code map

| Path | Purpose |
|---|---|
| `src/lib/dataset.ts`, `normalize.ts` | glob-load shipped categories and merge the overlay |
| `src/lib/template.ts`, `rng.ts` | seeded var instantiation, `{{var}}` rendering, `expected_expr` |
| `src/lib/decision.ts` | question builder, decision-block checks, scorer for choice / noul / score |
| `src/lib/openrouter.ts` | decision model list, `decide()` with retry |
| `src/lib/runner.ts` | task expansion, worker pool, timeouts, rejected primitives, unavailable models |
| `src/lib/summary.ts` | accuracy, Brier and calibration aggregation, CSV |
| `src/lib/presets.ts` | all decision models and free-only presets |
| `scripts/bench.ts` | headless CLI runner (`npm run bench`) |
| `src/components/*` | one component per tab, plus `EditableField` and `Settings` |

The browser's localStorage holds about 5 MB. Raw answers are truncated to 4,000 characters. Delete old runs if the "storage full" banner appears.

## Dataset

The app derives everything from `../data/categories/*.json`: category list, case counts, run selection and results columns. Nothing is hardcoded to a number of categories. An optional top-level `domain` string is shown as a badge (default `general`). The Results table scrolls horizontally and keeps the model column pinned when many categories are present.

| id | Decision | Output | Cases | Description |
|---|---|---|---|---|
| `ambiguity_detection` | Ambiguity Detection | enum: ambiguous, unambiguous | 15 | Decide whether a requirement, discovery question, acceptance criterion or tester instruction is ambiguous, meaning two competent implementers or testers could read it differently. |
| `citation_support_check` | Citation Support Check | enum: supports, does_not_support | 12 | Decide whether a quoted passage from a cited source actually supports the claim a paper or report attributes to it. |
| `clarity_score` | Clarity Score | number 1-5 (tol 1) | 15 | Rate the clarity of a specification, node description, or design artifact on a 1-5 scale. |
| `completeness_check` | Completeness Check | enum: complete, incomplete | 15 | Decide whether an artifact contains every required part for its type: a Bropilot node, a Protopilot assumption, or a bug report. |
| `consistency_check` | Consistency Check | enum: consistent, inconsistent | 15 | Decide whether two artifacts from the same project (a node description and an edge claim, an assumption and its test plan, README and architecture statements, or a graph slice and its prose summary) can both be true at once. |
| `correctness_check` | Correctness Check | enum: correct, incorrect | 15 | Decide whether a concrete claim about a code snippet, a Bropilot graph, a graph transform, a Bropilot query result, or a small calculation is correct. |
| `criteria_fulfillment` | Criteria Fulfillment | enum: pass, fail | 15 | Given an acceptance criterion (a testable requirement) and a description of what was implemented, determine whether the implementation satisfies the criterion. |
| `discipline_classification` | Discipline Classification | enum: 12 options | 12 | Assign a short research abstract to the single academic discipline that best fits its primary question. |
| `erp_transaction_validation` | ERP Transaction Validation | enum: valid, invalid | 12 | Decide whether an ERP document (journal entry, purchase order / goods receipt / invoice set, stock movement or payroll run) is valid under a compact, stated rulebook. |
| `evidence_assessment` | Evidence Assessment | enum: supports, refutes, neutral | 10 | Decide whether observed Protopilot test evidence supports, refutes, or does not bear on a stated assumption. |
| `factual_claim_check` | Factual Claim Check | enum: true, false | 12 | Decide whether a short factual claim from an academic or general-knowledge domain is true or false. |
| `gl_account_classification` | GL Account Classification | enum: asset, liability, equity, revenue, expense, cogs | 12 | Classify the general-ledger account affected by a business event into one of six classes (asset, liability, equity, revenue, expense, cogs). |
| `math_step_verification` | Math Step Verification | enum: valid, invalid | 12 | Decide whether ONE marked step in a short derivation or proof follows validly from the lines before it. |
| `priority_triage` | Priority Triage | enum: P0, P1, P2, P3 | 15 | Given a bug report, feature request, or tester feedback from a Protopilot user test or Bropilot workflow, assign a priority level (P0–P3). |
| `regulatory_compliance_check` | Regulatory Compliance Check | enum: compliant, noncompliant | 12 | Decide whether a described business practice complies with a rule that is quoted verbatim in the input. |
| `relation_selection` | Relation Selection | enum: 17 options | 10 | Given a source node and a target node from a Bropilot graph, choose the one edge kind (of 17) that best describes the link from source to target. |
| `statistical_inference_check` | Statistical Inference Check | enum: supported, unsupported | 12 | Decide whether a small summary of data or an analysis (counts, means, p-values, confidence intervals, 2x2 tables) actually supports the conclusion as written. |
| `type_classification` | Type Classification | enum: 28 options | 10 | Given a free-text description of something in a Bropilot or Protopilot project, pick the single Bropilot node kind (of 28) that it should become. |

18 categories, 231 cases in total.

### Templated cases

A case with a `vars` block is templated. Each var is an `int`, `float`, `choice` or `bool`. The input text uses `{{var}}` placeholders. The runner draws values with a seeded RNG, one draw per sample. The expected answer is either a literal `expected` or a pure JS expression `expected_expr` evaluated over `vars`, for example `vars.n > 6 ? 'fail' : 'pass'`.

### Validating the data

```bash
node data/validate.mjs     # checks every data/categories/*.json against SPEC.md; exits non-zero on errors
```

It checks required fields, the `decision` block (primitive, instructions, criteria matching `output`), difficulty values, and that `expected_expr` yields a valid option across sampled var combinations. Warnings do not fail the run.

### Adding a category

1. Create `data/categories/<id>.json` with `id` (snake_case, same as the filename), `name`, `description`, `output`, a `decision` block and `cases` (see `SPEC.md`, "System One / Decisions API"). `system_prompt` is optional legacy reference text and is never sent.
2. Optionally add a top-level `"domain": "finance"`. The Dataset tab shows it as a badge and falls back to `general`.
3. Run `node data/validate.mjs` and `cd app && npm test`.
4. Restart `npm run dev`. The app picks up every file in the folder, so no code changes are needed.
