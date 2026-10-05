import type { Category } from './types';

/** Fill defaults for a raw category file. Shared by the SPA (glob loader) and the node CLI (scripts/bench.ts). */
export function normalizeCategory(raw: Partial<Category>, fallbackId: string): Category {
  return {
    id: raw.id ?? fallbackId,
    name: raw.name ?? fallbackId,
    description: raw.description ?? '',
    domain: raw.domain,
    system_prompt: raw.system_prompt ?? '',
    output: raw.output ?? { type: 'enum', options: [] },
    decision: raw.decision,
    cases: (raw.cases ?? []).map((c) => ({ ...c, tags: c.tags ?? [] })),
  };
}
