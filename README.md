# sys1: Decision-Model Eval Suite

This project measures how well **OpenRouter Decisions API** models ("System One" decision models) make small, structured decisions such as judging, classifying, and scoring. These models return a choice, a probability or a score with calibrated probabilities instead of text, and only input tokens are billed. There is no chat-completions path. The examples come from the Bropilot and Protopilot projects. See `SPEC.md` for the full contract.

```
data/categories/<id>.json   18 categories, 231 cases (enum or numeric decisions, some templated)
app/                        Vite + React SPA and `npm run bench` CLI: pick decision models, edit the dataset, run evals, compare results
```

## Quick start

```bash
cd app
npm install
cp .env.local.example .env.local      # then replace sk-or-REPLACE_ME with your OpenRouter key
npm run dev                           # open http://localhost:5173
```

You can also skip the file and paste the key in the app's **Settings** dialog. It is stored in browser localStorage.

Workflow: select models on **Models**, review or edit cases on **Dataset**, start a run on **Run**, and compare models on **Results**. Each run reports accuracy, Brier score, confidence on correct vs incorrect answers, cost, and latency. You can drill down to the probability per label for each case.

Other commands, run from `app/`:

```bash
npm test         # unit tests, plus a sanity check that every shipped case has a valid expected answer
npm run build    # typecheck and build to app/dist
npm run bench -- --models all --samples 3 --max-cost 2   # headless run, saved to app/results/
```

### Decision models

The live list comes from `GET /api/v1/models?output_modalities=decisions`, and calls go to `POST /api/alpha/decisions`. 13 listings collapse to 11 distinct models. `~typesafe/jev-latest` aliases `typesafe/jev-1.13`, and `respan/span-01-lite:free` duplicates `respan/span-01-lite`.

`cloudflare/clef`, `cloudflare/clef-flash`, `upstage/solar-decide`, `jaredpalmer/kev-4b` (8k context), `togethercomputer/tev1-4b-experimental`, `typesafe/jev-1.13`, `liquid/d1`, `perplexity/pplx-decider-v1-27b`, `respan/span-01`, `respan/span-01-lite`, `inception/mercury-decide:free`.

The two Respan models only accept `noul` questions. Each category maps to one primitive in its `decision` block. Binary enums use `noul`, unordered multi-option enums use `choice`, and ordered scales (`clarity_score`, `priority_triage`) use `score`. See `app/README.md` for scoring details.

## Adding or editing cases

You can edit cases in the SPA and then use **Dataset, Download as files** to get updated `<id>.json` files for `data/categories/`. You can also edit the JSON directly. The schema is in `SPEC.md`. Run `npm test` afterwards to validate it.

## Categories

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

It checks required fields, the `decision` block, difficulty values, and that `expected_expr` yields a valid option across sampled var combinations. Warnings do not fail the run.

### Adding a category

1. Create `data/categories/<id>.json` with `id` (snake_case, same as the filename), `name`, `description`, `output`, a `decision` block and `cases` (see `SPEC.md`). `system_prompt` is optional legacy reference text and is never sent.
2. Optionally add a top-level `"domain": "finance"`. The Dataset tab shows it as a badge and falls back to `general`.
3. Run `node data/validate.mjs` and `cd app && npm test`.
4. Restart `npm run dev`. The app picks up every file in the folder, so no code changes are needed.
