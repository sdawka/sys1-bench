# Decision-Model Eval Suite — shared contract

Goal: a dataset + simple SPA to measure how well different LLMs (any model on OpenRouter) make
small, structured *decisions* (judging, classifying, scoring) on examples drawn from the user's
projects: **Bropilot** (`/Users/sdawka/Code/bropilot`, knowledge-graph studio with a 28-kind /
17-edge ontology in `web/src/lib/schema.ts`) and **Protopilot** (`/Users/sdawka/Code/protopilot`,
prototype-testing product: Context → Assumptions → Model → Prototype & test → Learn; docs in `docs/`).

## Layout
```
sys1/
  SPEC.md
  data/categories/<category_id>.json     # one file per category, 10 cases each
  app/                                   # Vite + React + TypeScript SPA (no backend)
```

## Category file schema (`data/categories/<id>.json`)
```jsonc
{
  "id": "criteria_fulfillment",            // snake_case, equals filename
  "name": "Criteria Fulfillment",
  "description": "One paragraph: what decision is being made and why it matters for the project.",
  "system_prompt": "Role + task + the exact output contract. MUST end with: Respond with ONLY a JSON object: {\"decision\": <value>, \"confidence\": <0..1>, \"reason\": \"<one sentence>\"}",
  "output": {                               // how `decision` is interpreted/scored
    "type": "enum",                         // "enum" | "number"
    "options": ["pass", "fail"],            // enum only
    "min": 1, "max": 5,                     // number only
    "tolerance": 0                          // number only: |expected-actual| <= tolerance counts as correct
  },
  "cases": [
    {
      "id": "cf_01",                        // <category-abbrev>_<2 digits>
      "title": "Short human label",
      "difficulty": "easy" | "medium" | "hard" | "edge",
      "tags": ["bropilot", "negation"],     // free-form
      "vars": {                             // OPTIONAL randomised template vars
        "n":    { "type": "int", "min": 1, "max": 12 },
        "kind": { "type": "choice", "options": ["persona", "usecase", "module"] }
      },
      "input": "The user-turn text. May reference {{n}} / {{kind}} placeholders when vars exist.",
      "expected": "pass",                   // literal expected decision, OR
      "expected_expr": "vars.n > 6 ? 'fail' : 'pass'",  // JS expression over `vars` (used when vars exist and the answer depends on them)
      "rationale": "Why this is the right answer; what a weak model gets wrong."
    }
  ]
}
```
Rules for authors:
- At least 10 cases per category (original 10 project-grounded + optional domain-expansion cases); ids zero-padded; mix of difficulties with ≥2 `edge` cases
  (negation, near-miss, contradictory context, distractors, empty/degenerate input, long input, etc.).
- Ground truth must be defensible — a careful human should agree. Avoid taste-based answers.
- Use real concepts/names from Bropilot and Protopilot (read their README/docs/schema first).
- Include 2–4 templated cases per category where it makes sense; `expected_expr` must be a pure JS
  expression returning the decision value (string for enum, number for number).
- Inputs are self-contained: everything the model needs is inside `input`.
- Valid JSON (no comments, no trailing commas). Verify with `node -e "JSON.parse(require('fs').readFileSync(f,'utf8'))"`.

## Categories (10) and owners
| id | output | owner |
|---|---|---|
| criteria_fulfillment — does artifact satisfy acceptance criterion | enum pass/fail | Haiku |
| clarity_score — rate clarity of a spec/node description | number 1–5, tol 1 | Haiku |
| priority_triage — P0/P1/P2/P3 for a bug or tester feedback | enum P0..P3 | Haiku |
| type_classification — Bropilot node kind for a description | enum (28 kinds) | Sonnet-A |
| relation_selection — which Bropilot edge kind connects two nodes | enum (17 edges) | Sonnet-A |
| completeness_check — does an artifact include all required parts | enum complete/incomplete | Sonnet-A |
| consistency_check — are two statements/graph slices consistent | enum consistent/inconsistent | Sonnet-B |
| ambiguity_detection — is a requirement/question ambiguous | enum ambiguous/unambiguous | Sonnet-B |
| correctness_check — is code/claim/transform correct | enum correct/incorrect | Opus-A |
| evidence_assessment — does Protopilot tester evidence support/refute/not-bear-on an assumption | enum supports/refutes/neutral | Opus-A |

## SPA responsibilities (Opus-B)
- Reads all category files via `import.meta.glob('../../data/categories/*.json', { eager: true })`.
- OpenRouter key from `app/.env.local` → `VITE_OPENROUTER_API_KEY=sk-or-REPLACE_ME` (placeholder committed in `.env.local.example`, and `.env.local` created with placeholder). Also allow override in-app (localStorage).
- Fetch model list from `https://openrouter.ai/api/v1/models`; multi-select with search; show pricing.
- Run: for each selected model × selected categories × cases (instantiate vars with seeded RNG, N samples per templated case), call `/api/v1/chat/completions` with `usage: {include: true}`, parse JSON decision robustly, score, record latency, tokens, cost (`usage.cost` or pricing fallback).
- Results view: per-model accuracy overall + per category, cost per model, cost per correct answer, latency; per-case drill-down showing raw model output. Export results JSON/CSV. Persist runs to localStorage.
- Editing: every category/case field editable in place via small pencil icons; add/delete case; add category; export edited dataset as JSON (and "download data folder as files"). Edits persist to localStorage overlay on top of the shipped JSON, with a "reset to shipped" button.

## Domain expansion (round 2)
The suite also measures general/specialised knowledge decisions, not only software. New categories
(same schema, ≥10 cases each, ≥3 templated where numeric):
| id | output | owner |
|---|---|---|
| erp_transaction_validation — is a journal entry / PO / goods receipt / payroll run valid under stated ERP rules | enum valid/invalid | Sonnet-A |
| gl_account_classification — which account class a business event hits | enum asset/liability/equity/revenue/expense/cogs | Sonnet-A |
| factual_claim_check — is an academic/general-knowledge claim true (biology, history, chemistry, geography, linguistics, economics…) | enum true/false | Sonnet-A |
| statistical_inference_check — does the described data support the stated conclusion | enum supported/unsupported | Sonnet-B |
| citation_support_check — does the quoted source passage support the claim attributed to it | enum supports/does_not_support | Sonnet-B |
| discipline_classification — which academic discipline a research abstract belongs to | enum (12 disciplines) | Sonnet-B |
| math_step_verification — is a single step in a derivation/proof valid | enum valid/invalid | Opus-A |
| regulatory_compliance_check — does a described practice comply with the quoted rule (IFRS/GAAP, GDPR, SOX, HR/labour policy, procurement) | enum compliant/noncompliant | Opus-A |
Existing generic categories (criteria_fulfillment, clarity_score, priority_triage, completeness_check,
consistency_check, ambiguity_detection, correctness_check) each gain 5 extra cases from non-software
domains (ERP/finance/HR/supply chain, medicine, law, physics, biology, history, economics) — owner Haiku.
Ids continue the existing numbering (e.g. cf_11..cf_15).

## System One / Decisions API (round 3) — THE ONLY target
This benchmark uses ONLY the OpenRouter **Decisions API**. There is NO chat-completions path anywhere in the
benchmark (runner or SPA). Model list = `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`
(verified 2026-10-05, 13 listings / 12 distinct models; `~typesafe/jev-latest` is an alias of jev-1.13 — dedupe by
preferring the concrete id; `respan/span-01-lite` and `respan/span-01-lite:free` are the same tier — keep one):
perplexity/pplx-decider-v1-27b, liquid/d1, cloudflare/clef-flash, cloudflare/clef, togethercomputer/tev1-4b-experimental,
inception/mercury-decide:free, upstage/solar-decide, respan/span-01, respan/span-01-lite, jaredpalmer/kev-4b,
typesafe/jev-1.13. All bill input tokens only ($0.00–0.24/M); output is free. Note respan/span-01* are "behavior scoring"
models (per-behavior probabilities over a conversation span) — they may reject choice/score; record errors, don't crash.
kev-4b has an 8k context; skip/record cases whose state exceeds it.

Endpoint: `POST https://openrouter.ai/api/alpha/decisions`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`.
Request: `{ model, state: <string|object>, questions: { <qid>: { type, instructions, criteria } } }`
- `choice`: criteria = `{ optionName: description }` → `{type:"choice", choice, probabilities:{opt:p}, confidence}`
- `noul`:   criteria = `{ true: description, false: description }` → `{type:"noul", noul: <p(yes)>}`
- `score`:  criteria = `[levelDesc0, ...]` (2–10 levels, low→high) → `{type:"score", score:<float>, probabilities:{"0":p,..}, legend, confidence}`
Response also has `id`, `model`, `provider`, `usage: { cost, input_tokens, output_tokens }`. Errors: `{error:{code,message}}`.

### Dataset additions
Every category file gains a top-level `decision` block expressing the category as ONE System One question:
```jsonc
"decision": {
  "primitive": "choice" | "noul" | "score",
  "instructions": "The question for a decision model. Carry the rubric/rules from system_prompt compactly. No JSON-output boilerplate.",
  "criteria": { "pass": "The artifact satisfies every clause of the criterion.", "fail": "..." },   // choice: keys == output.options exactly
  // noul:  "criteria": { "true": "...", "false": "..." }, "true_option": "pass", "false_option": "fail"
  // score: "criteria": [ "level 0 desc", ... ], "level_values": [1,2,3,4,5]   (level index → expected value)
}
```
Mapping: binary enums → `noul`. Multi-option unordered enums → `choice`. Ordered scales (clarity_score 1–5;
priority_triage P0..P3 ordered by severity, level_values ["P3","P2","P1","P0"] low→high) → `score`.
`state` = instantiated case `input` string. The legacy `system_prompt` field stays for reference but is never sent.

### Scoring
- choice: correct iff `choice === expected`.
- noul: predicted = `noul >= 0.5 ? true_option : false_option`; correct iff predicted === expected; record p.
- score: level = clamp(Math.round(score)); predicted = `level_values[level]`; enum-valued scales compare equality, numeric compare |Δ| ≤ tolerance.
Record confidence and full probabilities; compute per-model Brier score (probability assigned to the expected answer) and mean confidence on correct vs incorrect — calibration is the point of System One models.

### Runner / SPA
Decisions API only. Models tab lists only the decisions model list above (fetched live with the modality filter).
Cost = usage.cost. Whole suite (231 cases × ~700 input tokens × 12 models) ≈ $0.10–0.30, so run samples=3 by default.
