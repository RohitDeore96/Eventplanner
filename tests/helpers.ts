import { expect } from 'vitest';
import type { PlanAction } from '../src/engine/actions';
import { createPlan, type NewEventInput } from '../src/engine/create';
import { reducePlan } from '../src/engine/reducer';
import type { Plan } from '../src/engine/types';

export const TODAY = '2026-10-30';

export const BASE_INPUT: NewEventInput = {
  id: 'ev1',
  name: 'Asha & Dev wedding',
  occasion: 'wedding',
  dateISO: '2027-03-15',
  currency: 'INR',
  locale: 'en-IN',
  budgetMinor: 100_000_000,
  guestTarget: 120,
};

export function makePlan(overrides: Partial<NewEventInput> = {}): Plan {
  const created = createPlan({ ...BASE_INPUT, ...overrides }, TODAY);
  if (!created.ok) throw new Error(`fixture failed: ${created.error.code}`);
  return created.value.plan;
}

/** Applies actions in order and throws if any is rejected, so tests read as a script. */
export function run(plan: Plan, ...actions: PlanAction[]): Plan {
  return actions.reduce((current, action) => {
    const next = reducePlan(current, action, { today: TODAY });
    if (!next.ok) throw new Error(`${action.type} failed: ${next.error.code}`);
    return next.value;
  }, plan);
}

export function errorCode(plan: Plan, action: PlanAction, today = TODAY): string {
  const result = reducePlan(plan, action, { today });
  return result.ok ? 'OK' : result.error.code;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const catId = (plan: Plan, key: string): string => {
  const found = plan.categories.find((c) => c.key === key);
  if (!found) throw new Error(`no category ${key}`);
  return found.id;
};

/** Asserts a failed Result carries the code, the field the UI links to, and a real message. */
export function expectFailure(
  result: { ok: boolean; error?: { code: string; message: string; field?: string } },
  code: string,
  field: string | undefined,
): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe(code);
  expect(result.error?.field).toBe(field);
  expect(result.error?.message.length ?? 0).toBeGreaterThan(8);
}
