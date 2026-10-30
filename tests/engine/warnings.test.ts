import { describe, expect, it } from 'vitest';
import type { PlanAction } from '../../src/engine/actions';
import { budgetTotals, categoryFigures, vendorPaymentStatus } from '../../src/engine/budget';
import { computeWarnings } from '../../src/engine/warnings';
import type { Category, Plan, Vendor } from '../../src/engine/types';
import { catId, makePlan, run, TODAY } from '../helpers';

const plan = makePlan();
const venue = catId(plan, 'venue');
const codes = (p = plan, today = TODAY): string[] => computeWarnings(p, today).map((w) => w.code);

function categoryById(p: Plan, id: string): Category {
  const found = p.categories.find((c) => c.id === id);
  if (!found) throw new Error(`no category ${id}`);
  return found;
}
function firstVendor(p: Plan): Vendor {
  const found = p.vendors[0];
  if (!found) throw new Error('no vendor');
  return found;
}

const booked = (
  committedMinor: number,
  over: Partial<Extract<PlanAction, { type: 'vendor/add' }>> = {},
): PlanAction => ({
  type: 'vendor/add',
  id: 'v1',
  categoryId: venue,
  name: 'Hall',
  contactNote: '',
  status: 'booked',
  committedMinor,
  ...over,
});
const pay = (
  amountMinor: number,
  over: Partial<Extract<PlanAction, { type: 'expense/add' }>> = {},
): PlanAction => ({
  type: 'expense/add',
  id: 'x1',
  categoryId: venue,
  vendorId: 'v1',
  instalmentId: null,
  dateISO: '2026-11-01',
  amountMinor,
  note: '',
  ...over,
});

describe('money figures', () => {
  it('a fresh plan has nothing committed, paid or wrong', () => {
    const totals = budgetTotals(plan);
    expect(totals).toMatchObject({
      committed: 0,
      paid: 0,
      cashToPay: 0,
      remaining: plan.budgetMinor,
    });
    expect(totals.planned).toBe(plan.budgetMinor);
    expect(codes()).toEqual([]);
  });
  it('only booked vendors commit money; quoted ones do not', () => {
    const quoted = run(plan, booked(5_000_000, { status: 'quoted' }));
    expect(budgetTotals(quoted).committed).toBe(0);
    const bookedPlan = run(plan, booked(5_000_000));
    expect(budgetTotals(bookedPlan)).toMatchObject({
      committed: 5_000_000,
      paid: 0,
      cashToPay: 5_000_000,
    });
  });
  it('tracks planned vs committed vs paid and cash still to pay', () => {
    const next = run(plan, booked(30_000_000), pay(10_000_000));
    const figures = categoryFigures(next, categoryById(next, venue));
    expect(figures).toMatchObject({
      committed: 30_000_000,
      paid: 10_000_000,
      cashToPay: 20_000_000,
    });
    expect(figures.remaining).toBe(figures.planned - 30_000_000);
  });
  it('counts direct spend with no vendor as both committed and paid', () => {
    const next = run(plan, pay(2_000_000, { vendorId: null }));
    expect(budgetTotals(next)).toMatchObject({
      committed: 2_000_000,
      paid: 2_000_000,
      cashToPay: 0,
    });
  });
  it('treats paying more than agreed as commitment and warns', () => {
    const next = run(plan, booked(1_000_000), pay(1_500_000));
    expect(budgetTotals(next)).toMatchObject({
      committed: 1_500_000,
      paid: 1_500_000,
      cashToPay: 0,
    });
    expect(codes(next)).toContain('PAID_OVER_COMMITMENT');
  });
  it('derives vendor payment status', () => {
    const v = (status: 'booked' | 'quoted', committedMinor: number | null) => ({
      ...firstVendor(run(plan, booked(1))),
      status,
      committedMinor,
    });
    expect(vendorPaymentStatus(v('booked', 100), 0)).toBe('unpaid');
    expect(vendorPaymentStatus(v('booked', 100), 40)).toBe('partly_paid');
    expect(vendorPaymentStatus(v('booked', 100), 100)).toBe('paid');
    expect(vendorPaymentStatus(v('booked', 100), 101)).toBe('overpaid');
    expect(vendorPaymentStatus(v('quoted', null), 5)).toBe('overpaid');
    expect(vendorPaymentStatus(v('booked', null), 0)).toBe('unpaid');
    expect(vendorPaymentStatus(v('quoted', 100), 5)).toBe('overpaid');
    expect(vendorPaymentStatus(v('quoted', 100), 0)).toBe('unpaid');
  });
});

describe('warnings', () => {
  it('over-allocation when category plans exceed the budget', () => {
    const next = run(plan, { type: 'category/add', id: 'x', name: 'Extra', plannedMinor: 1 });
    const w = computeWarnings(next, TODAY).find((x) => x.code === 'OVER_ALLOCATED');
    expect(w).toMatchObject({ severity: 'error' });
    expect(w?.message).toContain('more than your budget');
    expect(w?.fix).toMatch(/Reduce|raise/);
  });
  it('over-commitment and category overspend', () => {
    const next = run(plan, booked(plan.budgetMinor + 1));
    expect(codes(next)).toEqual(expect.arrayContaining(['OVER_COMMITTED', 'CATEGORY_OVERSPENT']));
  });
  it('thin contingency, including when the category is missing', () => {
    const cont = catId(plan, 'contingency');
    const thin = run(plan, {
      type: 'budget/move',
      fromId: cont,
      toId: venue,
      amountMinor: (plan.categories.find((c) => c.id === cont)?.plannedMinor ?? 0) - 1,
    });
    expect(codes(thin)).toContain('THIN_CONTINGENCY');
    const removed = run(plan, { type: 'category/delete', id: cont });
    expect(codes(removed)).toContain('THIN_CONTINGENCY');
  });
  it('schedule that exceeds the agreed price', () => {
    const next = run(plan, booked(1_000_000), {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [{ id: 'i1', kind: 'balance', dueISO: '2027-01-01', amountMinor: 1_000_001 }],
    });
    expect(codes(next)).toContain('SCHEDULE_EXCEEDS_COMMITMENT');
  });
  it('overdue payments appear only while unpaid, and are errors', () => {
    const withDue = run(plan, booked(1_000_000), {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [{ id: 'i1', kind: 'advance', dueISO: '2026-10-29', amountMinor: 500_000 }],
    });
    expect(computeWarnings(withDue, TODAY).find((w) => w.code === 'PAYMENT_OVERDUE')).toMatchObject(
      { severity: 'error' },
    );
    expect(codes(withDue, '2026-10-29')).not.toContain('PAYMENT_OVERDUE');
    const settled = run(withDue, pay(500_000, { instalmentId: 'i1' }));
    expect(codes(settled)).not.toContain('PAYMENT_OVERDUE');
  });
  it('confirmed guests above target', () => {
    const next = run(
      plan,
      {
        type: 'guest/add',
        id: 'g',
        name: 'Big family',
        rsvp: 'yes',
        plusOnes: 10,
        dietary: [],
        group: '',
      },
      { type: 'event/update', changes: { guestTarget: 5 } },
    );
    expect(codes(next)).toContain('CONFIRMED_ABOVE_TARGET');
  });
  it('overdue tasks, but not done ones', () => {
    const first = plan.tasks[0]?.id ?? '';
    const late = computeWarnings(plan, '2027-12-01').filter((w) => w.code === 'TASK_OVERDUE');
    expect(late.length).toBeGreaterThan(0);
    const done = run(
      plan,
      ...plan.tasks.map((t): PlanAction => ({ type: 'task/update', id: t.id, done: true })),
    );
    expect(computeWarnings(done, '2027-12-01').some((w) => w.code === 'TASK_OVERDUE')).toBe(false);
    expect(first).not.toBe('');
  });
  it('every warning has a stable id, a message and a fix', () => {
    const next = run(plan, booked(plan.budgetMinor + 1));
    for (const w of computeWarnings(next, TODAY)) {
      expect(w.id.startsWith(w.code)).toBe(true);
      expect(w.message.length).toBeGreaterThan(10);
      expect(w.fix.length).toBeGreaterThan(10);
    }
  });
});
