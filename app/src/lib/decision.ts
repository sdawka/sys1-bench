import type { Answer, Question } from './openrouter';
import type { Decision, DecisionSpec, OutputSpec } from './types';

export function norm(v: unknown): string {
  return String(v).trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
}

/** The Decisions API question for a category's `decision` block. */
export function buildQuestion(spec: DecisionSpec): Question {
  switch (spec.primitive) {
    case 'choice':
      return { type: 'choice', instructions: spec.instructions, criteria: { ...spec.criteria } };
    case 'noul':
      return { type: 'noul', instructions: spec.instructions, criteria: { true: spec.criteria.true, false: spec.criteria.false } };
    case 'score':
      return { type: 'score', instructions: spec.instructions, criteria: [...spec.criteria] };
  }
}

/** Problems with a decision block relative to the category's output spec ([] when usable). */
export function checkDecisionSpec(spec: DecisionSpec | undefined, output: OutputSpec): string[] {
  if (!spec) return ['missing decision block'];
  const p: string[] = [];
  if (!spec.instructions?.trim()) p.push('empty instructions');
  const opts = (output.options ?? []).map(norm).sort();
  switch (spec.primitive) {
    case 'choice': {
      const keys = Object.keys(spec.criteria ?? {}).map(norm).sort();
      if (output.type === 'enum' && keys.join('|') !== opts.join('|')) p.push(`choice criteria keys ${keys} != output.options ${opts}`);
      break;
    }
    case 'noul':
      if (!spec.criteria?.true || !spec.criteria?.false) p.push('noul criteria need true and false');
      if (output.type === 'enum' && ![spec.true_option, spec.false_option].map(norm).sort().every((o, i, a) => a.length === opts.length && o === opts[i]))
        p.push(`true_option/false_option must be the two output.options`);
      break;
    case 'score':
      if (!Array.isArray(spec.criteria) || spec.criteria.length < 2 || spec.criteria.length > 10) p.push('score needs 2-10 criteria levels');
      else if (spec.level_values?.length !== spec.criteria.length) p.push('level_values length must equal criteria length');
      break;
    default:
      p.push(`unknown primitive ${(spec as { primitive: string }).primitive}`);
  }
  return p;
}

export interface Scored {
  decision: Decision;
  correct: boolean;
  confidence: number | null;
  /** Probability per label (option, or level value for score). */
  probabilities: Record<string, number> | null;
  pExpected: number | null;
  brier: number | null;
  rawValue: number | null;
}

/** Equality for enum labels, |Δ| <= tolerance for numeric outputs. */
export function matches(label: Decision, expected: Decision, output: OutputSpec): boolean {
  if (label == null || expected == null) return false;
  if (output.type === 'number') {
    const a = parseFloat(String(label));
    const e = parseFloat(String(expected));
    return isFinite(a) && isFinite(e) && Math.abs(a - e) <= (output.tolerance ?? 0) + 1e-9;
  }
  return norm(label) === norm(expected);
}

const finite = (x: unknown): x is number => typeof x === 'number' && isFinite(x);

function brierOf(pExpected: number | null) {
  return pExpected == null ? null : (1 - pExpected) ** 2;
}

/**
 * Score an API answer against the expected label (SPEC "Scoring"):
 * - choice: correct iff choice === expected.
 * - noul: predicted = p >= 0.5 ? true_option : false_option.
 * - score: level = clamp(round(score)); predicted = level_values[level]; numeric outputs use tolerance.
 * pExpected is the probability mass on labels that would count as correct; Brier = (1 - pExpected)^2.
 */
export function scoreAnswer(spec: DecisionSpec, answer: Answer, expected: Decision, output: OutputSpec): Scored {
  const none: Scored = { decision: null, correct: false, confidence: null, probabilities: null, pExpected: null, brier: null, rawValue: null };
  if (!answer || answer.type !== spec.primitive) throw new Error(`Expected a ${spec.primitive} answer, got ${answer?.type ?? 'nothing'}`);
  switch (spec.primitive) {
    case 'choice': {
      if (typeof answer.choice !== 'string') throw new Error('choice answer has no choice');
      const probs = answer.probabilities ?? null;
      let pExp: number | null = null;
      if (probs && expected != null) {
        pExp = 0;
        for (const [k, v] of Object.entries(probs)) if (norm(k) === norm(expected) && finite(v)) pExp += v;
      }
      return {
        ...none,
        decision: answer.choice,
        correct: matches(answer.choice, expected, output),
        confidence: finite(answer.confidence) ? answer.confidence : null,
        probabilities: probs,
        pExpected: pExp,
        brier: brierOf(pExp),
      };
    }
    case 'noul': {
      const p = answer.noul;
      if (!finite(p)) throw new Error('noul answer has no probability');
      const decision = p >= 0.5 ? spec.true_option : spec.false_option;
      const probabilities = { [spec.true_option]: p, [spec.false_option]: 1 - p };
      const pExp = expected == null ? null : norm(expected) === norm(spec.true_option) ? p : norm(expected) === norm(spec.false_option) ? 1 - p : 0;
      return {
        ...none,
        decision,
        correct: matches(decision, expected, output),
        confidence: Math.max(p, 1 - p),
        probabilities,
        pExpected: pExp,
        brier: brierOf(pExp),
        rawValue: p,
      };
    }
    case 'score': {
      const s = answer.score;
      if (!finite(s)) throw new Error('score answer has no score');
      const n = spec.level_values.length;
      const level = Math.min(n - 1, Math.max(0, Math.round(s)));
      const decision = spec.level_values[level];
      let probabilities: Record<string, number> | null = null;
      let pExp: number | null = null;
      if (answer.probabilities) {
        probabilities = {};
        pExp = 0;
        for (const [k, v] of Object.entries(answer.probabilities)) {
          const i = Number(k);
          if (!Number.isInteger(i) || i < 0 || i >= n || !finite(v)) continue;
          const label = String(spec.level_values[i]);
          probabilities[label] = (probabilities[label] ?? 0) + v;
          if (matches(spec.level_values[i], expected, output)) pExp += v;
        }
      }
      return {
        ...none,
        decision,
        correct: matches(decision, expected, output),
        confidence: finite(answer.confidence) ? answer.confidence : null,
        probabilities,
        pExpected: expected == null ? null : pExp,
        brier: expected == null ? null : brierOf(pExp),
        rawValue: s,
      };
    }
  }
}
