import type { Plan } from '../../../engine/types';

export function nameOf(plan: Plan, categoryId: string): string {
  return plan.categories.find((c) => c.id === categoryId)?.name ?? 'Unknown';
}
