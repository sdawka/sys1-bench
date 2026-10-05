import { describe, expect, it } from 'vitest';
import { buildQuestion, checkDecisionSpec, scoreAnswer } from './decision';
import { dedupeDecisionModels } from './openrouter';
import { buildTasks } from './runner';
import type { Category, DecisionSpec, OutputSpec } from './types';

const choiceSpec: DecisionSpec = {
  primitive: 'choice',
  instructions: 'Which class?',
  criteria: { asset: 'owned', liability: 'owed', expense: 'consumed' },
};
const choiceOut: OutputSpec = { type: 'enum', options: ['asset', 'liability', 'expense'] };

const noulSpec: DecisionSpec = {
  primitive: 'noul',
  instructions: 'Does it pass?',
  criteria: { true: 'meets every clause', false: 'misses a clause' },
  true_option: 'pass',
  false_option: 'fail',
};
const noulOut: OutputSpec = { type: 'enum', options: ['pass', 'fail'] };

const prioSpec: DecisionSpec = {
  primitive: 'score',
  instructions: 'How urgent?',
  criteria: ['cosmetic', 'minor', 'major', 'outage'],
  level_values: ['P3', 'P2', 'P1', 'P0'],
};
const prioOut: OutputSpec = { type: 'enum', options: ['P0', 'P1', 'P2', 'P3'] };

const claritySpec: DecisionSpec = {
  primitive: 'score',
  instructions: 'How clear?',
  criteria: ['1', '2', '3', '4', '5'],
  level_values: [1, 2, 3, 4, 5],
};
const clarityOut: OutputSpec = { type: 'number', min: 1, max: 5, tolerance: 1 };

describe('buildQuestion', () => {
  it('maps each primitive to the API shape', () => {
    expect(buildQuestion(choiceSpec)).toEqual({ type: 'choice', instructions: 'Which class?', criteria: choiceSpec.criteria });
    expect(buildQuestion(noulSpec)).toEqual({
      type: 'noul', instructions: 'Does it pass?', criteria: { true: 'meets every clause', false: 'misses a clause' },
    });
    expect(buildQuestion(prioSpec)).toEqual({ type: 'score', instructions: 'How urgent?', criteria: ['cosmetic', 'minor', 'major', 'outage'] });
  });
  it('does not leak noul label mapping into the request', () => {
    expect(JSON.stringify(buildQuestion(noulSpec))).not.toContain('true_option');
  });
});

describe('checkDecisionSpec', () => {
  it('accepts consistent blocks', () => {
    expect(checkDecisionSpec(choiceSpec, choiceOut)).toEqual([]);
    expect(checkDecisionSpec(noulSpec, noulOut)).toEqual([]);
    expect(checkDecisionSpec(prioSpec, prioOut)).toEqual([]);
  });
  it('flags mismatches', () => {
    expect(checkDecisionSpec(undefined, noulOut)).toHaveLength(1);
    expect(checkDecisionSpec(choiceSpec, { type: 'enum', options: ['asset', 'equity'] })).toHaveLength(1);
    expect(checkDecisionSpec({ ...prioSpec, level_values: ['P3'] }, prioOut)).toHaveLength(1);
  });
});

describe('scoreAnswer: choice', () => {
  const ans = { type: 'choice' as const, choice: 'expense', probabilities: { asset: 0.15, liability: 0.05, expense: 0.8 }, confidence: 0.75 };
  it('is correct when choice equals expected', () => {
    const s = scoreAnswer(choiceSpec, ans, 'expense', choiceOut);
    expect(s.correct).toBe(true);
    expect(s.decision).toBe('expense');
    expect(s.confidence).toBe(0.75);
    expect(s.pExpected).toBeCloseTo(0.8);
    expect(s.brier).toBeCloseTo(0.04);
  });
  it('uses the probability of the expected label when wrong', () => {
    const s = scoreAnswer(choiceSpec, ans, 'asset', choiceOut);
    expect(s.correct).toBe(false);
    expect(s.pExpected).toBeCloseTo(0.15);
    expect(s.brier).toBeCloseTo(0.7225);
  });
});

describe('scoreAnswer: noul', () => {
  it('maps p >= 0.5 to true_option', () => {
    const s = scoreAnswer(noulSpec, { type: 'noul', noul: 0.9 }, 'pass', noulOut);
    expect(s.decision).toBe('pass');
    expect(s.correct).toBe(true);
    expect(s.confidence).toBeCloseTo(0.9);
    expect(s.probabilities).toEqual({ pass: 0.9, fail: expect.closeTo(0.1) });
    expect(s.brier).toBeCloseTo(0.01);
    expect(s.rawValue).toBe(0.9);
  });
  it('maps p < 0.5 to false_option and scores p(expected) = 1 - p', () => {
    const s = scoreAnswer(noulSpec, { type: 'noul', noul: 0.2 }, 'pass', noulOut);
    expect(s.decision).toBe('fail');
    expect(s.correct).toBe(false);
    expect(s.confidence).toBeCloseTo(0.8);
    expect(s.pExpected).toBeCloseTo(0.2);
    expect(s.brier).toBeCloseTo(0.64);
  });
  it('treats exactly 0.5 as true_option', () => {
    expect(scoreAnswer(noulSpec, { type: 'noul', noul: 0.5 }, 'fail', noulOut).decision).toBe('pass');
  });
  it('throws on a mismatched answer type', () => {
    expect(() => scoreAnswer(noulSpec, { type: 'choice', choice: 'pass' }, 'pass', noulOut)).toThrow();
  });
});

describe('scoreAnswer: score', () => {
  const probs = { '0': 0.05, '1': 0.1, '2': 0.25, '3': 0.6 };
  it('rounds the score to a level and maps through level_values', () => {
    const s = scoreAnswer(prioSpec, { type: 'score', score: 2.6, probabilities: probs, confidence: 0.5 }, 'P0', prioOut);
    expect(s.decision).toBe('P0');
    expect(s.correct).toBe(true);
    expect(s.pExpected).toBeCloseTo(0.6);
    expect(s.probabilities).toEqual({ P3: 0.05, P2: 0.1, P1: 0.25, P0: 0.6 });
    expect(s.rawValue).toBe(2.6);
  });
  it('clamps out-of-range scores', () => {
    expect(scoreAnswer(prioSpec, { type: 'score', score: 7 }, 'P0', prioOut).decision).toBe('P0');
    expect(scoreAnswer(prioSpec, { type: 'score', score: -2 }, 'P3', prioOut).decision).toBe('P3');
  });
  it('rounds by expected value, not argmax', () => {
    const s = scoreAnswer(prioSpec, { type: 'score', score: 1.4, probabilities: probs }, 'P0', prioOut);
    expect(s.decision).toBe('P2');
    expect(s.correct).toBe(false);
  });
  it('uses tolerance for numeric scales and sums p over tolerated levels', () => {
    const p = { '0': 0.1, '1': 0.2, '2': 0.3, '3': 0.3, '4': 0.1 };
    const s = scoreAnswer(claritySpec, { type: 'score', score: 1.2, probabilities: p }, 3, clarityOut);
    expect(s.decision).toBe(2); // level 1 → value 2, within tolerance 1 of 3
    expect(s.correct).toBe(true);
    expect(s.pExpected).toBeCloseTo(0.2 + 0.3 + 0.3);
    const far = scoreAnswer(claritySpec, { type: 'score', score: 0, probabilities: p }, 4, clarityOut);
    expect(far.decision).toBe(1);
    expect(far.correct).toBe(false);
  });
});

describe('dedupeDecisionModels', () => {
  it('drops ~aliases and :free duplicates but keeps free-only models', () => {
    const ids = dedupeDecisionModels(
      ['~typesafe/jev-latest', 'typesafe/jev-1.13', 'respan/span-01-lite', 'respan/span-01-lite:free', 'inception/mercury-decide:free'].map((id) => ({ id })),
    ).map((m) => m.id);
    expect(ids).toEqual(['inception/mercury-decide:free', 'respan/span-01-lite', 'typesafe/jev-1.13']);
  });
});

describe('buildTasks', () => {
  const cat = (id: string, decision?: DecisionSpec): Category => ({
    id, name: id, description: '', system_prompt: '', output: noulOut, decision,
    cases: [
      { id: `${id}_01`, title: 'plain', difficulty: 'easy', tags: [], input: 'x', expected: 'pass' },
      { id: `${id}_02`, title: 'templated', difficulty: 'easy', tags: [], input: '{{n}}', vars: { n: { type: 'int', min: 1, max: 9 } }, expected_expr: "'pass'" },
    ],
  });
  it('skips categories without a decision block and repeats templated cases per sample', () => {
    const tasks = buildTasks([cat('a', noulSpec), cat('b')], ['m1', 'm2'], 3);
    expect(tasks).toHaveLength(2 * (1 + 3));
    expect(tasks.every((t) => t.category.id === 'a')).toBe(true);
    expect(tasks.slice(0, 2).map((t) => t.model)).toEqual(['m1', 'm2']); // interleaved
  });
});
