import { describe, expect, it } from 'vitest';
import { shipped } from './dataset';
import { checkDecisionSpec } from './decision';
import { instantiateCase, isTemplated } from './template';

// Sanity-checks the shipped data/categories files against the app's templating + scoring contract.
describe('shipped dataset', () => {
  for (const cat of Object.values(shipped)) {
    it(`${cat.id}: every case yields a valid expected decision`, () => {
      const problems: string[] = [];
      for (const c of cat.cases) {
        for (let s = 0; s < (isTemplated(c) ? 10 : 1); s++) {
          try {
            const { expected, input } = instantiateCase(c, 42, s);
            if (/\{\{\s*\w+\s*\}\}/.test(input)) problems.push(`${c.id}: unrendered placeholder`);
            if (cat.output.type === 'enum' && !cat.output.options?.some((o) => o.toLowerCase() === String(expected).toLowerCase()))
              problems.push(`${c.id}#${s}: expected ${JSON.stringify(expected)} not in options`);
            if (cat.output.type === 'number' && typeof expected !== 'number' && !isFinite(Number(expected)))
              problems.push(`${c.id}#${s}: expected ${JSON.stringify(expected)} is not a number`);
          } catch (e) {
            problems.push(`${c.id}#${s}: ${(e as Error).message}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
    // Categories without a decision block are skipped by the runner; when present it must be consistent.
    it.skipIf(!cat.decision)(`${cat.id}: decision block matches output spec`, () => {
      expect(checkDecisionSpec(cat.decision, cat.output)).toEqual([]);
    });
  }
});
