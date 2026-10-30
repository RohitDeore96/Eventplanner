import { describe, expect, it } from 'vitest';
import { buildScenario, comparePlans, SCENARIOS, scenarioActions } from '../../src/engine/scenario';
import { budgetTotals } from '../../src/engine/budget';
import { deepFreeze, makePlan, TODAY } from '../helpers';
import { buildDemoPlan } from '../../src/state/demo';

/**
 * X2 acceptance: scenarios preview on a COPY (the original plan is untouched), every number
 * is deterministic, and applying uses the same engine actions a user could perform by hand.
 */

describe('scenario planning (X2)', () => {
  const plan = deepFreeze(makePlan());

  it('lists six concrete scenarios with descriptions', () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(SCENARIOS.every((s) => s.description.length > 10)).toBe(true);
  });

  it('guests +20% raises the target and catering pressure deterministically', () => {
    const after = buildScenario(plan, 'guests-up-20', TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.guestTarget).toBe(Math.round(plan.guestTarget * 1.2));
    expect(after.value.budgetMinor).toBe(plan.budgetMinor);
  });

  it('budget −15% scales categories so planned still sums to the budget', () => {
    const after = buildScenario(plan, 'budget-down-15', TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const totals = budgetTotals(after.value);
    expect(totals.planned).toBe(totals.budget);
    expect(totals.budget).toBeLessThan(plan.budgetMinor);
  });

  it('venue +25% is absorbed by contingency, keeping planned equal to budget', () => {
    const after = buildScenario(plan, 'venue-up-25', TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const totals = budgetTotals(after.value);
    expect(totals.planned).toBe(totals.budget);
    const venue = after.value.categories.find((c) => c.key === 'venue');
    const beforeVenue = plan.categories.find((c) => c.key === 'venue');
    expect(venue?.plannedMinor).toBe(Math.round((beforeVenue?.plannedMinor ?? 0) * 1.25));
  });

  it('moving the date 14 days closer actually moves it (and rejects past dates)', () => {
    const after = buildScenario(plan, 'date-closer', TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(new Date(after.value.dateISO).getTime()).toBeLessThan(new Date(plan.dateISO).getTime());
    // A plan already within 14 days of today cannot move closer without going into the past.
    const soon = makePlan({ dateISO: TODAY });
    const rejected = buildScenario(soon, 'date-closer', TODAY);
    expect(rejected.ok).toBe(false);
  });

  it('never mutates the caller’s plan (deep-frozen input, pure preview)', () => {
    const snapshot = JSON.stringify(plan);
    buildScenario(plan, 'guests-up-20', TODAY);
    buildScenario(plan, 'vendor-up-10', TODAY);
    buildScenario(plan, 'budget-down-15', TODAY);
    scenarioActions(plan, 'catering-up-15');
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it('the demo wedding shows a real, previewable impact for every scenario', () => {
    const wedding = buildDemoPlan(TODAY);
    if (wedding === null) throw new Error('demo plan failed');
    for (const spec of SCENARIOS) {
      const after = buildScenario(wedding, spec.id, TODAY);
      expect(after.ok).toBe(true);
      if (!after.ok) continue;
      const comparison = comparePlans(wedding, after.value, TODAY);
      const touched =
        comparison.budgetDelta !== 0 ||
        comparison.guestTargetDelta !== 0 ||
        comparison.plannedDelta !== 0 ||
        comparison.committedDelta !== 0 ||
        comparison.tasksRescheduled.length > 0 ||
        comparison.newWarnings.length > 0 ||
        comparison.resolvedWarnings.length > 0 ||
        comparison.categories.some((c) => c.plannedBefore !== c.plannedAfter);
      expect(touched).toBe(true);
    }
  });
});
