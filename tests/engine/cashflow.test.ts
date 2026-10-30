import { describe, expect, it } from 'vitest';
import { cashflow, monthKey } from '../../src/engine/cashflow';
import { catId, deepFreeze, makePlan, run, TODAY } from '../helpers';

/**
 * X8 acceptance: scheduled instalments land in their due months, expenses that reference an
 * instalment settle it, and anything still to pay after its due date is flagged overdue.
 */

const vendorWith = (
  schedule: { id: string; kind: 'advance' | 'final'; dueISO: string; amountMinor: number }[],
) => {
  const plan = makePlan();
  return run(
    plan,
    {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(plan, 'venue'),
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 10_000_000,
    },
    { type: 'vendor/setSchedule', id: 'v1', schedule },
  );
};

describe('cashflow (X8)', () => {
  it('groups scheduled payments by due month, sorted ascending', () => {
    const plan = deepFreeze(
      vendorWith([
        { id: 'i1', kind: 'advance', dueISO: '2027-03-10', amountMinor: 4_000_000 },
        { id: 'i2', kind: 'final', dueISO: '2027-04-05', amountMinor: 6_000_000 },
      ]),
    );
    const report = cashflow(plan, TODAY);
    expect(report.months.map((m) => m.month)).toEqual(['2027-03', '2027-04']);
    expect(report.months[0]?.scheduledMinor).toBe(4_000_000);
    expect(report.months[1]?.toPayMinor).toBe(6_000_000);
    expect(report.totals).toEqual({
      scheduledMinor: 10_000_000,
      paidMinor: 0,
      toPayMinor: 10_000_000,
    });
    expect(report.overdue).toEqual([]);
  });

  it('settles instalments from expenses that reference them and clamps overpayment', () => {
    let plan = vendorWith([
      { id: 'i1', kind: 'advance', dueISO: '2026-11-15', amountMinor: 4_000_000 },
    ]);
    plan = run(plan, {
      type: 'expense/add',
      id: 'e1',
      categoryId: catId(plan, 'venue'),
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: TODAY,
      amountMinor: 5_000_000, // 1,000,000 more than the instalment
      note: 'advance paid',
    });
    const report = cashflow(plan, TODAY);
    const entry = report.months[0]?.entries[0];
    expect(entry?.paidMinor).toBe(5_000_000);
    expect(entry?.toPayMinor).toBe(0);
    expect(report.totals.toPayMinor).toBe(0);
    expect(report.overdue).toEqual([]);
  });

  it('flags unpaid instalments whose due date has passed as overdue, earliest first', () => {
    const plan = vendorWith([
      { id: 'i1', kind: 'advance', dueISO: '2026-09-01', amountMinor: 2_000_000 },
      { id: 'i2', kind: 'advance', dueISO: '2026-09-20', amountMinor: 1_000_000 },
      { id: 'i3', kind: 'final', dueISO: '2027-03-10', amountMinor: 3_000_000 },
    ]);
    const report = cashflow(plan, TODAY);
    expect(report.overdue.map((e) => e.instalmentId)).toEqual(['i1', 'i2']);
    expect(report.overdue[0]?.overdue).toBe(true);
    // Paid-but-past entries are never overdue.
    expect(report.months[0]?.entries.every((e) => e.toPayMinor > 0)).toBe(true);
  });

  it('is empty and honest when nothing is scheduled', () => {
    const report = cashflow(makePlan(), TODAY);
    expect(report.months).toEqual([]);
    expect(report.overdue).toEqual([]);
    expect(report.totals.scheduledMinor).toBe(0);
  });

  it('the demo wedding produces a real calendar once a schedule exists', () => {
    const plan = makePlan();
    const withSchedule = run(
      plan,
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: catId(plan, 'venue'),
        name: 'Grand Hall',
        contactNote: '',
        status: 'booked',
        committedMinor: 10_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [
          { id: 'i1', kind: 'advance', dueISO: '2027-01-10', amountMinor: 3_000_000 },
          { id: 'i2', kind: 'final', dueISO: '2027-03-10', amountMinor: 7_000_000 },
        ],
      },
    );
    const report = cashflow(withSchedule, TODAY);
    expect(report.months.map((m) => m.month)).toEqual(['2027-01', '2027-03']);
    expect(monthKey('2027-03-15')).toBe('2027-03');
  });
});
