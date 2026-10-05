import { describe, expect, it } from 'vitest';
import { rngFor } from './rng';
import { instantiateCase, render } from './template';
import type { Case } from './types';

const c: Case = {
  id: 'cf_01',
  title: 't',
  difficulty: 'easy',
  tags: [],
  vars: { n: { type: 'int', min: 1, max: 12 }, kind: { type: 'choice', options: ['persona', 'usecase'] } },
  input: 'There are {{n}} {{ kind }} nodes; {{missing}} stays.',
  expected_expr: "vars.n > 6 ? 'fail' : 'pass'",
};

describe('templating', () => {
  it('is deterministic per seed/case/sample and varies across samples', () => {
    const a = instantiateCase(c, 42, 0);
    expect(instantiateCase(c, 42, 0)).toEqual(a);
    const seen = new Set(Array.from({ length: 20 }, (_, i) => instantiateCase(c, 42, i).input));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('keeps vars in range, renders placeholders, and evaluates expected_expr', () => {
    for (let i = 0; i < 50; i++) {
      const inst = instantiateCase(c, 7, i);
      const n = inst.vars.n as number;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(12);
      expect(['persona', 'usecase']).toContain(inst.vars.kind);
      expect(inst.input).toBe(`There are ${n} ${inst.vars.kind} nodes; {{missing}} stays.`);
      expect(inst.expected).toBe(n > 6 ? 'fail' : 'pass');
    }
  });

  it('uses the literal expected when there is no expression', () => {
    const lit: Case = { ...c, vars: undefined, expected_expr: undefined, expected: 'pass' };
    expect(instantiateCase(lit, 1, 0)).toEqual({ vars: {}, input: render(lit.input, {}), expected: 'pass' });
  });

  it('rng produces floats in [0,1)', () => {
    const r = rngFor(1, 'x', 0);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
