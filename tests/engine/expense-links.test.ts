import { describe, expect, it } from 'vitest';
import { catId, errorCode, makePlan, run } from '../helpers';
import { reducePlan } from '../../src/engine/reducer';

describe('expense linking (M6)', () => {
  const vendorPlan = () =>
    run(
      makePlan(),
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: catId(makePlan(), 'catering'),
        name: 'Annapurna Caterers',
        contactNote: '',
        status: 'booked',
        committedMinor: 10_000_000,
      },
      {
        type: 'vendor/add',
        id: 'v2',
        categoryId: catId(makePlan(), 'venue'),
        name: 'Sunny Lawns',
        contactNote: '',
        status: 'booked',
        committedMinor: 8_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [{ id: 'i-adv', kind: 'advance', dueISO: '2027-01-01', amountMinor: 4_000_000 }],
      },
    );

  it('links an expense to a vendor and their own instalment', () => {
    const linked = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: catId(vendorPlan(), 'catering'),
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2027-01-02',
      amountMinor: 2_000_000,
      note: 'advance paid',
    });
    expect(linked.expenses[0]?.vendorId).toBe('v1');
    expect(linked.expenses[0]?.instalmentId).toBe('i-adv');
  });

  it('rejects an instalment from another vendor, with or without a vendor', () => {
    const plan = vendorPlan();
    // v2's own category, so the category rule passes and the instalment rule is reached.
    expect(
      errorCode(plan, {
        type: 'expense/add',
        id: 'x1',
        categoryId: catId(plan, 'venue'),
        vendorId: 'v2',
        instalmentId: 'i-adv',
        dateISO: '2027-01-02',
        amountMinor: 2_000_000,
        note: '',
      }),
    ).toBe('INSTALMENT_NOT_FOUND');
    expect(
      errorCode(plan, {
        type: 'expense/add',
        id: 'x1',
        categoryId: catId(plan, 'catering'),
        vendorId: null,
        instalmentId: 'i-adv',
        dateISO: '2027-01-02',
        amountMinor: 2_000_000,
        note: '',
      }),
    ).toBe('INSTALMENT_NEEDS_VENDOR');
    // A vendor whose category disagrees with the expense is rejected before anything else.
    expect(
      errorCode(plan, {
        type: 'expense/add',
        id: 'x1',
        categoryId: catId(plan, 'catering'),
        vendorId: 'v2',
        instalmentId: null,
        dateISO: '2027-01-02',
        amountMinor: 2_000_000,
        note: '',
      }),
    ).toBe('VENDOR_CATEGORY_MISMATCH');
  });

  it('reassigns an expense to another vendor of the same category, with a fresh instalment', () => {
    const plan = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: catId(vendorPlan(), 'catering'),
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2027-01-02',
      amountMinor: 2_000_000,
      note: '',
    });
    // A second catering vendor with its own schedule gives the reassignment a legal target.
    const withSecond = run(
      plan,
      {
        type: 'vendor/add',
        id: 'v3',
        categoryId: catId(plan, 'catering'),
        name: 'Bhagwati Foods',
        contactNote: '',
        status: 'booked',
        committedMinor: 9_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v3',
        schedule: [{ id: 'i-b', kind: 'advance', dueISO: '2027-01-08', amountMinor: 2_000_000 }],
      },
    );
    const moved = run(withSecond, {
      type: 'expense/update',
      id: 'x1',
      vendorId: 'v3',
      instalmentId: 'i-b',
    });
    const expense = moved.expenses.find((x) => x.id === 'x1');
    expect(expense?.vendorId).toBe('v3');
    expect(expense?.instalmentId).toBe('i-b');
  });

  it('rejects a reassignment that leaves an instalment pointing at the wrong vendor', () => {
    const plan = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: catId(vendorPlan(), 'catering'),
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2027-01-02',
      amountMinor: 2_000_000,
      note: '',
    });
    // Switching to v2 while keeping v1's instalment must fail; nothing changes.
    const rejected = reducePlan(
      plan,
      {
        type: 'expense/update',
        id: 'x1',
        vendorId: 'v2',
      },
      { today: '2026-10-30' },
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('VENDOR_CATEGORY_MISMATCH');
    }
    const expense = plan.expenses.find((x) => x.id === 'x1');
    expect(expense?.vendorId).toBe('v1');
  });

  it('changing the expense amount keeps instalment settlement arithmetic in one place', () => {
    const plan = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: catId(vendorPlan(), 'catering'),
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2027-01-02',
      amountMinor: 3_000_000,
      note: '',
    });
    const edited = run(plan, {
      type: 'expense/update',
      id: 'x1',
      amountMinor: 4_000_000,
    });
    // The instalment is settled exactly when summed payments reach its amount.
    const paid = edited.expenses
      .filter((x) => x.instalmentId === 'i-adv')
      .reduce((acc, x) => acc + x.amountMinor, 0);
    expect(paid).toBe(4_000_000);
  });
});
