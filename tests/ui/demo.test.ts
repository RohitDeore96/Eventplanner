import { describe, expect, it } from 'vitest';
import { buildDemoPlan } from '../../src/state/demo';
import { budgetTotals } from '../../src/engine/budget';
import { summarize } from '../../src/engine/summary';
import { computeWarnings } from '../../src/engine/warnings';

const TODAY = '2026-10-30';

describe('demo event (X3)', () => {
  it('builds deterministically through the engine with real data in every view', () => {
    const a = buildDemoPlan(TODAY);
    const b = buildDemoPlan(TODAY);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    const plan = a;
    if (plan === null) return;
    expect(plan.vendors).toHaveLength(3);
    expect(plan.expenses).toHaveLength(2);
    expect(plan.guests).toHaveLength(3);
    expect(plan.tasks[0]?.dueISO).not.toBe('2026-09-02'); // delay moved it
    const totals = budgetTotals(plan);
    expect(totals.paid).toBe(5_500_000);
    expect(totals.committed).toBeGreaterThan(0);
    const summary = summarize(plan, TODAY);
    expect(summary.catering.headcount).toBeGreaterThan(0);
    expect(computeWarnings(plan, TODAY).some((w) => w.code === 'PAYMENT_OVERDUE')).toBe(true);
  });
});
