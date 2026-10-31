import { describe, expect, it } from 'vitest';
import type { PlanAction } from '../../src/engine/actions';
import { reducePlan } from '../../src/engine/reducer';
import { budgetTotals } from '../../src/engine/budget';
import { catId, deepFreeze, errorCode, makePlan, run, TODAY } from '../helpers';

const plan = deepFreeze(makePlan());
const venue = catId(plan, 'venue');
const catering = catId(plan, 'catering');

const vendor = (over: Partial<Extract<PlanAction, { type: 'vendor/add' }>> = {}): PlanAction => ({
  type: 'vendor/add',
  id: 'v1',
  categoryId: venue,
  name: 'Grand Hall',
  contactNote: '',
  status: 'booked',
  committedMinor: 30_000_000,
  ...over,
});
const expense = (over: Partial<Extract<PlanAction, { type: 'expense/add' }>> = {}): PlanAction => ({
  type: 'expense/add',
  id: 'x1',
  categoryId: venue,
  vendorId: 'v1',
  instalmentId: null,
  dateISO: '2026-11-01',
  amountMinor: 1_000_000,
  note: '',
  ...over,
});

describe('event/update', () => {
  const update = (
    changes: Extract<PlanAction, { type: 'event/update' }>['changes'],
  ): PlanAction => ({ type: 'event/update', changes });
  it('applies valid changes and trims the name', () => {
    const next = run(
      plan,
      update({
        name: ' New ',
        dateISO: '2027-06-01',
        guestTarget: 90,
        budgetMinor: 5_000,
        currency: 'USD',
        locale: 'en-US',
      }),
    );
    expect(next).toMatchObject({
      name: 'New',
      dateISO: '2027-06-01',
      guestTarget: 90,
      budgetMinor: 5_000,
      currency: 'USD',
      locale: 'en-US',
    });
  });
  it.each([
    [{ name: '' }, 'NAME_REQUIRED'],
    [{ dateISO: '2027-02-31' }, 'INVALID_DATE'],
    [{ dateISO: '2026-10-29' }, 'DATE_IN_PAST'],
    [{ guestTarget: 0 }, 'INVALID_GUESTS'],
    [{ budgetMinor: 0 }, 'INVALID_BUDGET'],
    [{ budgetMinor: -4 }, 'INVALID_BUDGET'],
    [{ currency: 'XYZZY' }, 'INVALID_CURRENCY'],
    [{ currency: 'JPY' }, 'CURRENCY_DECIMALS_DIFFER'],
    // CRITICAL DEFECT 3: a same-decimal switch without re-entering the budget would
    // silently reinterpret every amount (INR 8,00,000 becoming $800,000.00).
    [{ currency: 'EUR' }, 'CURRENCY_NEEDS_BUDGET'],
  ])('rejects %j with %s', (changes, code) => {
    expect(errorCode(plan, update(changes))).toBe(code);
  });
  it('allows switching between currencies with the same decimals when the budget is re-entered', () => {
    const next = run(plan, update({ currency: 'EUR', budgetMinor: 5_000 }));
    expect(next.currency).toBe('EUR');
    expect(next.budgetMinor).toBe(5_000);
  });
  it('locks the currency once payments or vendor agreements exist', () => {
    const withPayment = run(plan, expense({ vendorId: null }));
    expect(errorCode(withPayment, update({ currency: 'EUR', budgetMinor: 5_000 }))).toBe(
      'CURRENCY_LOCKED',
    );
    const withBookedVendor = run(plan, vendor({}));
    expect(errorCode(withBookedVendor, update({ currency: 'EUR', budgetMinor: 5_000 }))).toBe(
      'CURRENCY_LOCKED',
    );
    const withScheduleOnly = run(
      plan,
      vendor({ status: 'contacted', committedMinor: null, id: 'v2' }),
    );
    const scheduled = run(withScheduleOnly, {
      type: 'vendor/setSchedule',
      id: 'v2',
      schedule: [{ id: 'i1', kind: 'advance', dueISO: '2026-11-01', amountMinor: 1_000 }],
    });
    expect(errorCode(scheduled, update({ currency: 'EUR', budgetMinor: 5_000 }))).toBe(
      'CURRENCY_LOCKED',
    );
  });
  it('does not mutate the input plan (deep-frozen)', () => {
    expect(() => run(plan, update({ name: 'Other' }))).not.toThrow();
  });
});

describe('categories and budget moves', () => {
  it('adds, renames, re-plans, and deletes an unused category', () => {
    const added = run(plan, {
      type: 'category/add',
      id: 'extra',
      name: 'Gifts',
      plannedMinor: 500,
    });
    expect(added.categories.at(-1)).toMatchObject({
      id: 'extra',
      name: 'Gifts',
      plannedMinor: 500,
    });
    const edited = run(added, {
      type: 'category/update',
      id: 'extra',
      name: 'Favours',
      plannedMinor: 900,
    });
    expect(edited.categories.at(-1)).toMatchObject({ name: 'Favours', plannedMinor: 900 });
    expect(run(edited, { type: 'category/delete', id: 'extra' }).categories).toHaveLength(
      plan.categories.length,
    );
  });
  it.each([
    [{ type: 'category/add', id: 'bad id', name: 'x', plannedMinor: 1 }, 'INVALID_ID'],
    [{ type: 'category/add', id: 'n', name: ' ', plannedMinor: 1 }, 'NAME_REQUIRED'],
    [{ type: 'category/add', id: 'n', name: 'Venue', plannedMinor: 1 }, 'DUPLICATE_CATEGORY'],
    [{ type: 'category/add', id: venue, name: 'Other', plannedMinor: 1 }, 'DUPLICATE_ID'],
    [{ type: 'category/add', id: 'n', name: 'Ok', plannedMinor: -1 }, 'INVALID_AMOUNT'],
    [{ type: 'category/update', id: 'zzz', name: 'x' }, 'CATEGORY_NOT_FOUND'],
    [{ type: 'category/update', id: venue, name: 'catering' }, 'DUPLICATE_CATEGORY'],
    [{ type: 'category/update', id: venue, name: '' }, 'NAME_REQUIRED'],
    [{ type: 'category/update', id: venue, plannedMinor: 1.5 }, 'INVALID_AMOUNT'],
    [{ type: 'category/delete', id: 'zzz' }, 'CATEGORY_NOT_FOUND'],
    [{ type: 'budget/move', fromId: venue, toId: 'zzz', amountMinor: 1 }, 'CATEGORY_NOT_FOUND'],
    [{ type: 'budget/move', fromId: venue, toId: venue, amountMinor: 1 }, 'SAME_CATEGORY'],
    [{ type: 'budget/move', fromId: venue, toId: catering, amountMinor: 0 }, 'INVALID_AMOUNT'],
    [{ type: 'budget/move', fromId: venue, toId: catering, amountMinor: -1 }, 'INVALID_AMOUNT'],
    [
      { type: 'budget/move', fromId: venue, toId: catering, amountMinor: 999_999_999_999 },
      'INSUFFICIENT_PLANNED',
    ],
  ] as [PlanAction, string][])('rejects %j with %s', (action, code) => {
    expect(errorCode(plan, action)).toBe(code);
  });
  it('enforces the category cap', () => {
    let current = plan;
    for (let i = plan.categories.length; i < 30; i += 1) {
      current = run(current, {
        type: 'category/add',
        id: `c${i}`,
        name: `Cat ${i}`,
        plannedMinor: 0,
      });
    }
    expect(
      errorCode(current, {
        type: 'category/add',
        id: 'last',
        name: 'One too many',
        plannedMinor: 0,
      }),
    ).toBe('TOO_MANY_CATEGORIES');
  });
  it('refuses to delete a category that has a vendor or an expense', () => {
    const withVendor = run(plan, vendor());
    expect(errorCode(withVendor, { type: 'category/delete', id: venue })).toBe('CATEGORY_IN_USE');
    const withExpense = run(plan, expense({ vendorId: null }));
    expect(errorCode(withExpense, { type: 'category/delete', id: venue })).toBe('CATEGORY_IN_USE');
  });
  it('moves budget without changing the total planned amount', () => {
    const moved = run(plan, {
      type: 'budget/move',
      fromId: venue,
      toId: catering,
      amountMinor: 1_000_001,
    });
    expect(budgetTotals(moved).planned).toBe(budgetTotals(plan).planned);
    expect(moved.categories.find((c) => c.id === venue)?.plannedMinor).toBe(
      (plan.categories.find((c) => c.id === venue)?.plannedMinor ?? 0) - 1_000_001,
    );
  });
});

describe('vendors', () => {
  it('adds, updates and deletes a vendor', () => {
    const added = run(plan, vendor());
    expect(added.vendors[0]).toMatchObject({
      name: 'Grand Hall',
      status: 'booked',
      committedMinor: 30_000_000,
      schedule: [],
    });
    const edited = run(added, {
      type: 'vendor/update',
      id: 'v1',
      name: 'Royal Hall',
      contactNote: 'call after 5',
      status: 'cancelled',
      committedMinor: null,
    });
    expect(edited.vendors[0]).toMatchObject({
      name: 'Royal Hall',
      contactNote: 'call after 5',
      status: 'cancelled',
      committedMinor: null,
    });
    expect(run(edited, { type: 'vendor/delete', id: 'v1' }).vendors).toEqual([]);
  });
  it.each([
    [vendor({ id: 'bad id' }), 'INVALID_ID'],
    [vendor({ name: '' }), 'NAME_REQUIRED'],
    [vendor({ contactNote: 'x'.repeat(501) }), 'NOTE_TOO_LONG'],
    [vendor({ categoryId: 'zzz' }), 'CATEGORY_NOT_FOUND'],
    [vendor({ status: 'booked', committedMinor: null }), 'BOOKED_NEEDS_PRICE'],
    [vendor({ committedMinor: -1 }), 'INVALID_AMOUNT'],
  ] as [PlanAction, string][])('rejects %#: %s', (action, code) => {
    expect(errorCode(plan, action)).toBe(code);
  });
  it('rejects duplicate vendors (case-insensitive, same category) but allows the name elsewhere', () => {
    const base = run(plan, vendor());
    expect(errorCode(base, vendor({ id: 'v2', name: ' grand hall ' }))).toBe('DUPLICATE_VENDOR');
    expect(errorCode(base, vendor({ id: 'v1', name: 'Other' }))).toBe('DUPLICATE_ID');
    expect(errorCode(base, vendor({ id: 'v2', categoryId: catering }))).toBe('OK');
  });
  it('rejects bad updates', () => {
    const base = run(plan, vendor(), vendor({ id: 'v2', name: 'Second Hall' }));
    const u = (changes: Partial<Extract<PlanAction, { type: 'vendor/update' }>>): PlanAction => ({
      type: 'vendor/update',
      id: 'v1',
      ...changes,
    });
    expect(errorCode(base, u({ name: ' ' }))).toBe('NAME_REQUIRED');
    expect(errorCode(base, u({ name: 'second hall' }))).toBe('DUPLICATE_VENDOR');
    expect(errorCode(base, u({ contactNote: 'x'.repeat(501) }))).toBe('NOTE_TOO_LONG');
    expect(errorCode(base, u({ categoryId: 'zzz' }))).toBe('CATEGORY_NOT_FOUND');
    expect(errorCode(base, u({ committedMinor: null }))).toBe('BOOKED_NEEDS_PRICE');
    expect(errorCode(base, { type: 'vendor/update', id: 'zzz' })).toBe('VENDOR_NOT_FOUND');
    expect(errorCode(base, u({ categoryId: catering }))).toBe('OK');
  });
  it('blocks category change and deletion once payments exist', () => {
    const paid = run(plan, vendor(), expense());
    expect(errorCode(paid, { type: 'vendor/update', id: 'v1', categoryId: catering })).toBe(
      'VENDOR_HAS_PAYMENTS',
    );
    expect(errorCode(paid, { type: 'vendor/delete', id: 'v1' })).toBe('VENDOR_HAS_PAYMENTS');
    expect(errorCode(paid, { type: 'vendor/delete', id: 'zzz' })).toBe('VENDOR_NOT_FOUND');
  });
  it('enforces the vendor cap', () => {
    let current = plan;
    for (let i = 0; i < 200; i += 1)
      current = run(current, vendor({ id: `v${i}`, name: `Vendor ${i}` }));
    expect(errorCode(current, vendor({ id: 'over', name: 'Over' }))).toBe('TOO_MANY_VENDORS');
  });
});

describe('payment schedule', () => {
  const advance = {
    id: 'i1',
    kind: 'advance' as const,
    dueISO: '2026-12-01',
    amountMinor: 10_000_000,
  };
  const balance = {
    id: 'i2',
    kind: 'balance' as const,
    dueISO: '2027-03-01',
    amountMinor: 20_000_000,
  };
  const schedule = [advance, balance];
  const withSchedule = run(plan, vendor(), { type: 'vendor/setSchedule', id: 'v1', schedule });
  it('stores the schedule', () => {
    expect(withSchedule.vendors[0]?.schedule).toHaveLength(2);
  });
  it.each([
    [{ type: 'vendor/setSchedule', id: 'zzz', schedule: [] }, 'VENDOR_NOT_FOUND'],
    [
      { type: 'vendor/setSchedule', id: 'v1', schedule: [{ ...advance, id: 'bad id' }] },
      'INVALID_ID',
    ],
    [
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [{ ...advance, dueISO: '2026-02-31' }],
      },
      'INVALID_DATE',
    ],
    [
      { type: 'vendor/setSchedule', id: 'v1', schedule: [{ ...advance, amountMinor: -1 }] },
      'INVALID_AMOUNT',
    ],
    [
      { type: 'vendor/setSchedule', id: 'v1', schedule: [{ ...advance, amountMinor: 0 }] },
      'INVALID_AMOUNT',
    ],
    [{ type: 'vendor/setSchedule', id: 'v1', schedule: [advance, advance] }, 'DUPLICATE_ID'],
    [
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: Array.from({ length: 13 }, (_, i) => ({ ...advance, id: `n${i}` })),
      },
      'TOO_MANY_INSTALMENTS',
    ],
  ] as [PlanAction, string][])('rejects %#: %s', (action, code) => {
    expect(errorCode(withSchedule, action)).toBe(code);
  });
  it('rejects reusing an instalment id owned by another vendor', () => {
    const two = run(withSchedule, vendor({ id: 'v2', name: 'Other', categoryId: catering }));
    expect(
      errorCode(two, {
        type: 'vendor/setSchedule',
        id: 'v2',
        schedule: [advance],
      }),
    ).toBe('DUPLICATE_ID');
  });
  it('will not remove a scheduled payment that is already paid', () => {
    const paid = run(withSchedule, expense({ instalmentId: 'i1' }));
    expect(
      errorCode(paid, {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [balance],
      }),
    ).toBe('INSTALMENT_ALREADY_PAID');
  });
});

describe('expenses', () => {
  const base = run(plan, vendor(), {
    type: 'vendor/setSchedule',
    id: 'v1',
    schedule: [{ id: 'i1', kind: 'advance', dueISO: '2026-12-01', amountMinor: 1_000_000 }],
  });
  it('adds, edits, deletes and reconciles totals', () => {
    const added = run(base, expense());
    expect(budgetTotals(added).paid).toBe(1_000_000);
    const edited = run(added, {
      type: 'expense/update',
      id: 'x1',
      amountMinor: 2_500_000,
      dateISO: '2026-11-05',
      note: ' deposit ',
    });
    expect(edited.expenses[0]).toMatchObject({
      amountMinor: 2_500_000,
      dateISO: '2026-11-05',
      note: 'deposit',
    });
    expect(budgetTotals(run(edited, { type: 'expense/delete', id: 'x1' })).paid).toBe(0);
  });
  it.each([
    [expense({ id: 'bad id' }), 'INVALID_ID'],
    [expense({ amountMinor: 0 }), 'INVALID_AMOUNT'],
    [expense({ amountMinor: -5 }), 'INVALID_AMOUNT'],
    [expense({ amountMinor: 2.5 }), 'INVALID_AMOUNT'],
    [expense({ dateISO: 'yesterday' }), 'INVALID_DATE'],
    [expense({ note: 'x'.repeat(501) }), 'NOTE_TOO_LONG'],
    [expense({ categoryId: 'zzz' }), 'CATEGORY_NOT_FOUND'],
    [expense({ vendorId: 'zzz' }), 'VENDOR_NOT_FOUND'],
    [expense({ categoryId: catering }), 'VENDOR_CATEGORY_MISMATCH'],
    [expense({ vendorId: null, instalmentId: 'i1' }), 'INSTALMENT_NEEDS_VENDOR'],
    [expense({ instalmentId: 'nope' }), 'INSTALMENT_NOT_FOUND'],
  ] as [PlanAction, string][])('rejects %#: %s', (action, code) => {
    expect(errorCode(base, action)).toBe(code);
  });
  it('rejects duplicate ids and allows split payments on one instalment (D4)', () => {
    const paid = run(base, expense({ instalmentId: 'i1' }));
    expect(errorCode(paid, expense({ id: 'x1' }))).toBe('DUPLICATE_ID');
    // A second payment toward the same instalment is a partial payment, not an error.
    const split = run(paid, expense({ id: 'x2', instalmentId: 'i1', amountMinor: 500_000 }));
    expect(split.expenses).toHaveLength(2);
    expect(budgetTotals(split).paid).toBe(1_500_000);
  });
  it('rejects bad edits and missing targets', () => {
    const added = run(base, expense());
    expect(errorCode(added, { type: 'expense/update', id: 'zzz', note: 'x' })).toBe(
      'EXPENSE_NOT_FOUND',
    );
    expect(errorCode(added, { type: 'expense/update', id: 'x1', amountMinor: 0 })).toBe(
      'INVALID_AMOUNT',
    );
    expect(errorCode(added, { type: 'expense/update', id: 'x1', amountMinor: -1 })).toBe(
      'INVALID_AMOUNT',
    );
    expect(errorCode(added, { type: 'expense/update', id: 'x1', dateISO: 'nope' })).toBe(
      'INVALID_DATE',
    );
    expect(errorCode(added, { type: 'expense/update', id: 'x1', note: 'x'.repeat(501) })).toBe(
      'NOTE_TOO_LONG',
    );
    expect(errorCode(added, { type: 'expense/delete', id: 'zzz' })).toBe('EXPENSE_NOT_FOUND');
  });
  it('enforces the expense cap', () => {
    const big = {
      ...base,
      expenses: Array.from({ length: 5000 }, (_, i) => ({
        id: `e${i}`,
        categoryId: venue,
        vendorId: null,
        instalmentId: null,
        dateISO: '2026-11-01',
        amountMinor: 1,
        note: '',
      })),
    };
    expect(errorCode(big, expense({ id: 'over', vendorId: null }))).toBe('TOO_MANY_EXPENSES');
  });
});

describe('tasks through the reducer', () => {
  const add = (over: Partial<Extract<PlanAction, { type: 'task/add' }>> = {}): PlanAction => ({
    type: 'task/add',
    id: 't-new',
    title: 'Book makeup artist',
    dueISO: '2027-01-20',
    dependsOn: [],
    assignee: null,
    ...over,
  });
  const first = plan.tasks[0]?.id ?? '';
  it('adds, edits, assigns, completes, reorders and deletes', () => {
    const added = run(plan, add({ dependsOn: [first] }));
    expect(added.tasks.at(-1)).toMatchObject({
      title: 'Book makeup artist',
      dependsOn: [first],
      done: false,
    });
    const edited = run(added, {
      type: 'task/update',
      id: 't-new',
      title: 'Book MUA',
      dueISO: '2027-01-22',
      assignee: ' Priya ',
      done: true,
    });
    expect(edited.tasks.at(-1)).toMatchObject({
      title: 'Book MUA',
      dueISO: '2027-01-22',
      assignee: 'Priya',
      done: true,
    });
    expect(
      run(edited, { type: 'task/update', id: 't-new', assignee: null }).tasks.at(-1)?.assignee,
    ).toBeNull();
    expect(run(edited, { type: 'task/reorder', id: 't-new', toIndex: 0 }).tasks[0]?.id).toBe(
      't-new',
    );
    expect(run(edited, { type: 'task/delete', id: 't-new' }).tasks).toHaveLength(plan.tasks.length);
  });
  it('rejects bad input and cycles', () => {
    expect(errorCode(plan, add({ id: 'bad id' }))).toBe('INVALID_ID');
    expect(errorCode(plan, add({ title: '' }))).toBe('NAME_REQUIRED');
    expect(errorCode(plan, add({ dueISO: '2027-13-01' }))).toBe('INVALID_DATE');
    expect(errorCode(plan, add({ id: first }))).toBe('DUPLICATE_ID');
    expect(errorCode(plan, add({ dependsOn: ['nope'] }))).toBe('DEPENDENCY_NOT_FOUND');
    expect(errorCode(plan, { type: 'task/update', id: 'zzz', done: true })).toBe('TASK_NOT_FOUND');
    expect(errorCode(plan, { type: 'task/update', id: first, title: '' })).toBe('NAME_REQUIRED');
    expect(errorCode(plan, { type: 'task/update', id: first, dueISO: 'x' })).toBe('INVALID_DATE');
    expect(errorCode(plan, { type: 'task/update', id: first, assignee: ' ' })).toBe(
      'NAME_REQUIRED',
    );
    const last = plan.tasks.at(-1)?.id ?? '';
    expect(errorCode(plan, { type: 'task/setDependencies', id: first, dependsOn: [last] })).toBe(
      'DEPENDENCY_CYCLE',
    );
    expect(errorCode(plan, { type: 'task/delay', id: 'zzz', days: 1 })).toBe('TASK_NOT_FOUND');
    expect(errorCode(plan, { type: 'task/reorder', id: 'zzz', toIndex: 0 })).toBe('TASK_NOT_FOUND');
    expect(errorCode(plan, { type: 'task/delete', id: 'zzz' })).toBe('TASK_NOT_FOUND');
  });
  it('delays with ripple through the reducer', () => {
    const delayed = run(plan, { type: 'task/delay', id: first, days: 400 });
    expect(delayed.tasks.every((t) => t.dueISO >= (delayed.tasks[0]?.dueISO ?? ''))).toBe(true);
  });
  it('works on an empty task list', () => {
    const empty = { ...plan, tasks: [] };
    expect(run(empty, add()).tasks).toHaveLength(1);
    expect(errorCode(empty, { type: 'task/delay', id: 'x', days: 1 })).toBe('TASK_NOT_FOUND');
  });
  it('enforces the task cap', () => {
    const many = {
      ...plan,
      tasks: Array.from({ length: 500 }, (_, i) => ({
        id: `t${i}`,
        title: 'x',
        dueISO: '2027-01-01',
        dependsOn: [],
        assignee: null,
        done: false,
      })),
    };
    expect(errorCode(many, add({ id: 'over' }))).toBe('TOO_MANY_TASKS');
  });
});

describe('guests', () => {
  const guest = (over: Partial<Extract<PlanAction, { type: 'guest/add' }>> = {}): PlanAction => ({
    type: 'guest/add',
    id: 'g1',
    name: 'Meera Joshi',
    rsvp: 'pending',
    plusOnes: 1,
    dietary: ['vegetarian', 'vegetarian', 'jain'],
    group: 'Bride side',
    ...over,
  });
  it('adds (deduplicating dietary tags), updates and deletes', () => {
    const added = run(plan, guest());
    expect(added.guests[0]?.dietary).toEqual(['vegetarian', 'jain']);
    const edited = run(added, {
      type: 'guest/update',
      id: 'g1',
      name: 'Meera J',
      rsvp: 'yes',
      plusOnes: 2,
      dietary: ['vegan', 'vegan'],
      group: ' Family ',
    });
    expect(edited.guests[0]).toMatchObject({
      name: 'Meera J',
      rsvp: 'yes',
      plusOnes: 2,
      dietary: ['vegan'],
      group: 'Family',
    });
    expect(run(edited, { type: 'guest/delete', id: 'g1' }).guests).toEqual([]);
  });
  it.each([
    [guest({ id: 'bad id' }), 'INVALID_ID'],
    [guest({ name: ' ' }), 'NAME_REQUIRED'],
    [guest({ plusOnes: -1 }), 'INVALID_PLUS_ONES'],
    [guest({ plusOnes: 11 }), 'INVALID_PLUS_ONES'],
    [guest({ plusOnes: 1.5 }), 'INVALID_PLUS_ONES'],
    [guest({ group: 'g'.repeat(81) }), 'NAME_TOO_LONG'],
  ] as [PlanAction, string][])('rejects %#: %s', (action, code) => {
    expect(errorCode(plan, action)).toBe(code);
  });
  it('rejects duplicates, missing targets and bad edits', () => {
    const added = run(plan, guest());
    expect(errorCode(added, guest())).toBe('DUPLICATE_ID');
    expect(errorCode(added, { type: 'guest/update', id: 'zzz', rsvp: 'yes' })).toBe(
      'GUEST_NOT_FOUND',
    );
    expect(errorCode(added, { type: 'guest/update', id: 'g1', name: '' })).toBe('NAME_REQUIRED');
    expect(errorCode(added, { type: 'guest/update', id: 'g1', plusOnes: 99 })).toBe(
      'INVALID_PLUS_ONES',
    );
    expect(errorCode(added, { type: 'guest/update', id: 'g1', group: 'g'.repeat(81) })).toBe(
      'NAME_TOO_LONG',
    );
    expect(errorCode(added, { type: 'guest/delete', id: 'zzz' })).toBe('GUEST_NOT_FOUND');
  });
  it('enforces the guest record cap', () => {
    const many = {
      ...plan,
      guests: Array.from({ length: 5000 }, (_, i) => ({
        id: `g${i}`,
        name: 'G',
        rsvp: 'pending' as const,
        plusOnes: 0,
        dietary: [],
        group: '',
        contact: '',
        note: '',
      })),
    };
    expect(errorCode(many, guest({ id: 'over' }))).toBe('TOO_MANY_GUESTS');
  });
});

describe('purity', () => {
  it('is deterministic and never mutates its input', () => {
    const frozen = deepFreeze(makePlan());
    const action: PlanAction = { type: 'event/update', changes: { name: 'Same' } };
    expect(reducePlan(frozen, action, { today: TODAY })).toEqual(
      reducePlan(frozen, action, { today: TODAY }),
    );
  });
});
