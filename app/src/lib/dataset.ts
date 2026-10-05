import { normalizeCategory } from './normalize';
import type { Category } from './types';

export { normalizeCategory };

// Every category file shipped in ../data/categories (relative to app/src/lib).
const modules = import.meta.glob('../../../data/categories/*.json', { eager: true, import: 'default' }) as Record<
  string,
  Partial<Category>
>;

export const shipped: Record<string, Category> = Object.fromEntries(
  Object.entries(modules).map(([path, raw]) => {
    const fileId = path.split('/').pop()!.replace(/\.json$/, '');
    const cat = normalizeCategory(raw, fileId);
    return [cat.id, cat];
  }),
);

export type Overlay = Record<string, Category>;

/** Shipped categories with localStorage edits laid over them, plus categories added in-app. */
export function mergeDataset(overlay: Overlay): Category[] {
  const ids = new Set([...Object.keys(shipped), ...Object.keys(overlay)]);
  // Overlays saved before decision blocks existed inherit the shipped one.
  return [...ids].sort().map((id) =>
    overlay[id] ? { ...overlay[id], decision: overlay[id].decision ?? shipped[id]?.decision } : shipped[id],
  );
}

export function newCategory(id: string): Category {
  return {
    id,
    name: id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    description: '',
    system_prompt: '',
    output: { type: 'enum', options: ['yes', 'no'] },
    decision: {
      primitive: 'noul',
      instructions: 'Describe the yes/no question the decision model should answer about the state.',
      criteria: { true: 'When the answer is yes.', false: 'When the answer is no.' },
      true_option: 'yes',
      false_option: 'no',
    },
    cases: [],
  };
}
