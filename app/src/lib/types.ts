export type VarSpec =
  | { type: 'int'; min: number; max: number }
  | { type: 'float'; min: number; max: number; decimals?: number }
  | { type: 'choice'; options: (string | number)[] }
  | { type: 'bool' };

export interface OutputSpec {
  type: 'enum' | 'number';
  options?: string[];
  min?: number;
  max?: number;
  tolerance?: number;
}

/** A category expressed as ONE System One / Decisions API question (see SPEC.md, round 3). */
export type DecisionSpec =
  | { primitive: 'choice'; instructions: string; criteria: Record<string, string> }
  | {
      primitive: 'noul';
      instructions: string;
      criteria: { true: string; false: string };
      true_option: string;
      false_option: string;
    }
  | { primitive: 'score'; instructions: string; criteria: string[]; level_values: (string | number)[] };

export type Primitive = DecisionSpec['primitive'];

export interface Case {
  id: string;
  title: string;
  difficulty: string;
  tags: string[];
  vars?: Record<string, VarSpec>;
  input: string;
  expected?: string | number;
  expected_expr?: string;
  rationale?: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  /** Optional top-level domain label (e.g. "finance"); shown as a badge, defaults to "general". */
  domain?: string;
  /** Legacy prompt text from the dataset, kept for reference only. It is never sent. */
  system_prompt: string;
  output: OutputSpec;
  decision?: DecisionSpec;
  cases: Case[];
}

export interface ORModel {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
}

export type Decision = string | number | null;

export interface CaseResult {
  model: string;
  categoryId: string;
  caseId: string;
  caseTitle: string;
  difficulty: string;
  sample: number;
  vars?: Record<string, unknown>;
  input: string;
  primitive?: Primitive;
  expected: Decision;
  /** The predicted label after mapping the raw answer through the category's decision block. */
  decision: Decision;
  correct: boolean;
  /** Model confidence (choice/score from the API; noul uses max(p, 1-p)). */
  confidence: number | null;
  /** Probability per label (option name, or level value for score). */
  probabilities?: Record<string, number> | null;
  /** Probability the model assigned to the expected label. */
  pExpected?: number | null;
  /** Brier contribution, (1 - pExpected)^2. */
  brier?: number | null;
  /** Raw scalar answer: noul p(true) or the score's expected level. */
  rawValue?: number | null;
  /** Raw answer JSON from the API (truncated). */
  raw: string;
  latencyMs: number;
  inputTokens?: number;
  cost: number;
  error: string | null;
  /** True when no call was made (question rejected by the model, or the state exceeds its context). */
  skipped?: boolean;
  /** Raw response metadata. */
  responseId?: string | null;
  provider?: string | null;
  /** Dated upstream model id from the response (results are keyed by the requested `model`). */
  upstreamModel?: string | null;
  outputTokens?: number | null;
  /** HTTP status of the final attempt (200 on success; absent for network errors and timeouts). */
  httpStatus?: number | null;
  /** Retries inside decide() for the final attempt (0 or 1). */
  retries?: number | null;
  /** Times the pool requeued this task after a 429. */
  requeues?: number;
  /** ISO timestamp when the (final) request was sent. */
  requestedAt?: string | null;
}

export interface RunConfig {
  categories: string[];
  models: string[];
  samples: number;
  concurrency: number;
  seed: number;
}

export interface Run {
  id: string;
  createdAt: number;
  finishedAt?: number;
  status: 'running' | 'done' | 'cancelled';
  config: RunConfig;
  categoryNames: Record<string, string>;
  total: number;
  results: CaseResult[];
  /** Set by the headless CLI (scripts/bench.ts). */
  source?: 'app' | 'cli';
  /** Models dropped because their first calls all failed (CLI only). */
  unavailable?: string[];
}
