import { isFree } from './openrouter';
import type { ORModel } from './types';

/** Every listed decision model (the list is already deduplicated). */
export const allDecisionModels = (models: ORModel[]): string[] => models.map((m) => m.id);

/** Decision models that cost nothing per input token. */
export const freeOnly = (models: ORModel[]): string[] => models.filter(isFree).map((m) => m.id);
