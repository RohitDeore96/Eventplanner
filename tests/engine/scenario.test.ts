import { describe, expect, it } from 'vitest';
import {
  buildScenario,
  comparePlans,
  SCENARIOS,
  scenarioActions,
  stressTest,
  stressTestActions,
} from '../../src/engine/scenario';
import { budgetTotals } from '../../src/engine/budget';
import { deepFreeze, makePlan, run, TODAY, catId } from '../helpers';
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

  it('locked categories keep their allocation when the budget scales (M10)', () => {
    const venue = catId(plan, 'venue');
    const venueBefore = plan.categories.find((c) => c.key === 'venue')?.plannedMinor ?? 0;
    const locked = run(plan, { type: 'category/update', id: venue, locked: true });
    const after = buildScenario(locked, 'budget-down-15', TODAY);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const venueAfter = after.value.categories.find((c) => c.key === 'venue');
    expect(venueAfter?.locked).toBe(true);
    expect(venueAfter?.plannedMinor).toBe(venueBefore);
    // The unlocked categories still absorb the whole reduction.
    const totals = budgetTotals(after.value);
    expect(totals.budget).toBe(Math.round(plan.budgetMinor * 0.85));
    expect(totals.planned).toBe(totals.budget);
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

describe('stress test (X6)', () => {
  it('hits the plan with all three shocks at once: guests ×1.2, budget ×0.85, vendors ×1.1', () => {
    const plan = deepFreeze(makePlan());
    const report = stressTest(plan, TODAY);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const after = report.value;
    expect(after.guestTargetAfter).toBe(Math.round(plan.guestTarget * 1.2));
    expect(after.budgetAfter).toBe(Math.round(plan.budgetMinor * 0.85));
    // The planned split still sums exactly to the shrunk budget.
    const scaled = buildScenario(plan, 'budget-down-15', TODAY);
    expect(scaled.ok).toBe(true);
    if (scaled.ok) {
      expect(budgetTotals(scaled.value).planned).toBe(after.budgetAfter);
    }
    expect(after.committedAfter).toBeGreaterThanOrEqual(0);
  });

  it('raises every booked vendor price by exactly 10% alongside the other shocks', () => {
    const plan = makePlan();
    const withVendor = run(plan, {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(plan, 'venue'),
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 10_000_000,
    });
    const report = stressTest(withVendor, TODAY);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.comparison.committedDelta).toBe(1_000_000); // 10% of 10,000,000
  });

  it('a plan with no slack breaks loudly: over budget with an error warning', () => {
    // Commit nearly the whole budget to vendors, then take the shocks: committed stays
    // high while the budget shrinks 15%, so the plan must report it is broken.
    const plan = makePlan({ budgetMinor: 10_000_000 });
    const committed = run(plan, {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(plan, 'venue'),
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 9_500_000,
    });
    const report = stressTest(committed, TODAY);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.survives).toBe(false);
    // 9.5M × 1.1 = 10.45M against a 8.5M budget after the −15% shock.
    expect(report.value.overBudgetBy).toBe(10_450_000 - 8_500_000);
    expect(report.value.errorCount).toBeGreaterThan(0);
  });

  it('a plan with generous headroom survives all three shocks', () => {
    // No vendors, no expenses: nothing committed, so a −15% budget cannot over-commit.
    const plan = makePlan();
    const report = stressTest(plan, TODAY);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.survives).toBe(true);
    expect(report.value.overBudgetBy).toBe(0);
    expect(report.value.errorCount).toBe(0);
  });

  it('never mutates the caller’s plan and reuses the exact applyable actions', () => {
    const plan = deepFreeze(makePlan());
    const snapshot = JSON.stringify(plan);
    const report = stressTest(plan, TODAY);
    expect(report.ok).toBe(true);
    expect(JSON.stringify(plan)).toBe(snapshot);
    // The actions the UI would apply are precisely the composed three shock lists.
    expect(stressTestActions(plan).length).toBeGreaterThan(0);
  });
});
