import { rngFor } from './rng';
import type { Case, Decision, VarSpec } from './types';

export type Vars = Record<string, string | number | boolean>;

export function isTemplated(c: Case): boolean {
  return !!c.vars && Object.keys(c.vars).length > 0;
}

export function instantiateVars(specs: Record<string, VarSpec> | undefined, rng: () => number): Vars {
  const out: Vars = {};
  if (!specs) return out;
  for (const [name, spec] of Object.entries(specs)) {
    switch (spec.type) {
      case 'int': {
        const lo = Math.ceil(spec.min);
        const hi = Math.floor(spec.max);
        out[name] = lo + Math.floor(rng() * (hi - lo + 1));
        break;
      }
      case 'float': {
        const v = spec.min + rng() * (spec.max - spec.min);
        out[name] = Number(v.toFixed(spec.decimals ?? 2));
        break;
      }
      case 'choice':
        out[name] = spec.options[Math.floor(rng() * spec.options.length)];
        break;
      case 'bool':
        out[name] = rng() < 0.5;
        break;
      default:
        throw new Error(`Unknown var type for "${name}": ${JSON.stringify(spec)}`);
    }
  }
  return out;
}

/** Replace {{name}} placeholders; unknown placeholders are left as-is. */
export function render(text: string, vars: Vars): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function computeExpected(c: Case, vars: Vars): Decision {
  if (c.expected_expr && c.expected_expr.trim()) {
    // eslint-disable-next-line no-new-func
    const fn = new Function('vars', 'return (' + c.expected_expr + ')') as (v: Vars) => unknown;
    const v = fn(vars);
    return typeof v === 'number' ? v : String(v);
  }
  return c.expected ?? null;
}

export interface Instance {
  vars: Vars;
  input: string;
  expected: Decision;
}

export function instantiateCase(c: Case, seed: number | string, sampleIdx: number): Instance {
  const vars = instantiateVars(c.vars, rngFor(seed, c.id, sampleIdx));
  return { vars, input: render(c.input, vars), expected: computeExpected(c, vars) };
}
