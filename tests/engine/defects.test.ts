import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PlanAction } from '../../src/engine/actions';
import { applyPatch, dryRunPatch, type PlanPatch } from '../../src/engine/patch';
import { reducePlan } from '../../src/engine/reducer';
import { computeWarnings } from '../../src/engine/warnings';
import { catId, deepFreeze, makePlan, run, TODAY } from '../helpers';

const plan = deepFreeze(makePlan());
const venue = catId(plan, 'venue');

const asAction = (value: unknown): PlanAction => value as PlanAction;

describe('D1: stored records are built from named fields only', () => {
  it('task/add never persists the action type or extra keys', () => {
    const action = asAction({
      type: 'task/add',
      id: 't9',
      title: 'Book sound',
      dueISO: '2027-01-10',
      dependsOn: [],
      assignee: null,
      evil: 'payload',
    });
    const next = run(plan, action);
    const task = next.tasks.find((t) => t.id === 't9');
    expect(task).toBeDefined();
    expect(Object.keys(task ?? {}).sort()).toEqual(
      ['assignee', 'dependsOn', 'done', 'dueISO', 'id', 'title'].sort(),
    );
  });

  it('vendor/add never persists the action type or extra keys', () => {
    const action = asAction({
      type: 'vendor/add',
      id: 'v9',
      categoryId: venue,
      name: 'Sound Walla',
      contactNote: '',
      status: 'contacted',
      committedMinor: null,
      evil: 1,
    });
    const next = run(plan, action);
    const vendor = next.vendors.find((v) => v.id === 'v9');
    expect(vendor).toBeDefined();
    expect(Object.keys(vendor ?? {}).sort()).toEqual(
      ['categoryId', 'committedMinor', 'contactNote', 'id', 'name', 'schedule', 'status'].sort(),
    );
  });

  it('expense/add never persists the action type or extra keys', () => {
    const action = asAction({
      type: 'expense/add',
      id: 'x9',
      categoryId: venue,
      vendorId: null,
      instalmentId: null,
      dateISO: '2026-11-01',
      amountMinor: 500,
      note: '',
      evil: { deep: true },
    });
    const next = run(plan, action);
    const expense = next.expenses.find((e) => e.id === 'x9');
    expect(expense).toBeDefined();
    expect(Object.keys(expense ?? {}).sort()).toEqual(
      ['amountMinor', 'categoryId', 'dateISO', 'id', 'instalmentId', 'note', 'vendorId'].sort(),
    );
  });

  it('guest/add never persists the action type or extra keys', () => {
    const action = asAction({
      type: 'guest/add',
      id: 'g9',
      name: 'Meera',
      rsvp: 'pending',
      plusOnes: 1,
      dietary: [],
      group: 'Family',
      evil: 'x',
    });
    const next = run(plan, action);
    const guest = next.guests.find((g) => g.id === 'g9');
    expect(guest).toBeDefined();
    expect(Object.keys(guest ?? {}).sort()).toEqual(
      ['dietary', 'group', 'id', 'name', 'plusOnes', 'rsvp'].sort(),
    );
  });
});

describe('D2: malformed actions return a Result and never throw', () => {
  const existingTaskId = plan.tasks[0]?.id ?? 'none';
  const cases: { readonly name: string; readonly action: unknown }[] = [
    {
      name: 'task title is a number',
      action: {
        type: 'task/add',
        id: 't10',
        title: 5,
        dueISO: '2027-01-10',
        dependsOn: [],
        assignee: null,
      },
    },
    {
      name: 'dependsOn is a number',
      action: {
        type: 'task/add',
        id: 't10',
        title: 'ok',
        dueISO: '2027-01-10',
        dependsOn: 5,
        assignee: null,
      },
    },
    {
      name: 'assignee is a number on update',
      action: { type: 'task/update', id: existingTaskId, assignee: 5 },
    },
    {
      name: 'done is a string on update',
      action: { type: 'task/update', id: existingTaskId, done: 'yes' },
    },
    {
      name: 'unknown action type',
      action: { type: 'action/does-not-exist' },
    },
    { name: 'constructor prototype key', action: { type: 'constructor' } },
    { name: 'toString prototype key', action: { type: 'toString' } },
    { name: 'null action', action: null },
    { name: 'string action', action: 'task/add' },
    { name: 'number action', action: 42 },
    {
      name: 'vendor status is not an enum value',
      action: {
        type: 'vendor/add',
        id: 'v10',
        categoryId: venue,
        name: 'X',
        contactNote: '',
        status: 'king',
        committedMinor: null,
      },
    },
    {
      name: 'guest rsvp is not an enum value',
      action: {
        type: 'guest/add',
        id: 'g10',
        name: 'X',
        rsvp: 'maybe',
        plusOnes: 0,
        dietary: [],
        group: '',
      },
    },
    {
      name: 'guest dietary is not an array',
      action: {
        type: 'guest/add',
        id: 'g11',
        name: 'X',
        rsvp: 'yes',
        plusOnes: 0,
        dietary: 'vegan',
        group: '',
      },
    },
    {
      name: 'guest dietary has an unknown tag',
      action: {
        type: 'guest/add',
        id: 'g12',
        name: 'X',
        rsvp: 'yes',
        plusOnes: 0,
        dietary: ['meat'],
        group: '',
      },
    },
    {
      name: 'vendor schedule is not an array',
      action: { type: 'vendor/setSchedule', id: 'v-none', schedule: 7 },
    },
  ];
  it.each(cases)('returns a fail Result: $name', ({ action }) => {
    const result = reducePlan(plan, asAction(action), { today: TODAY });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code.length).toBeGreaterThan(0);
      expect(result.error.message.length).toBeGreaterThan(8);
    }
  });

  it('fuzz: arbitrary JSON as an action never throws', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = reducePlan(plan, asAction(value), { today: TODAY });
        expect(typeof result.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });
});

describe('D3: the patch gate blocks patches that enlarge an error', () => {
  const over = run(plan, { type: 'category/add', id: 'x1', name: 'Extras', plannedMinor: 1 });
  expect(computeWarnings(over, TODAY).some((w) => w.code === 'OVER_ALLOCATED')).toBe(true);

  it('blocks a patch that grows the existing over-allocation', () => {
    const grow: PlanPatch = {
      summary: 'Add a huge category',
      actions: [{ type: 'category/add', id: 'x2', name: 'Huge', plannedMinor: 9_000_000_000 }],
    };
    const dry = dryRunPatch(over, grow, TODAY);
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.value.blockedBy.length).toBeGreaterThan(0);
    expect(applyPatch(over, grow, TODAY).ok).toBe(false);
  });

  it('still allows a patch that leaves the error unchanged', () => {
    const fine: PlanPatch = {
      summary: 'Add a task',
      actions: [
        {
          type: 'task/add',
          id: 'ai-1',
          title: 'Check permits',
          dueISO: '2027-01-10',
          dependsOn: [],
          assignee: null,
        },
      ],
    };
    const dry = dryRunPatch(over, fine, TODAY);
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.value.blockedBy).toEqual([]);
  });
});

describe('D4: an instalment settles only when payments reach its amount', () => {
  const withSchedule = run(
    plan,
    {
      type: 'vendor/add',
      id: 'v1',
      categoryId: venue,
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 2_000_000,
    },
    {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [{ id: 'i1', kind: 'advance', dueISO: '2026-10-29', amountMinor: 2_000_000 }],
    },
  );
  const overdueCount = (p: ReturnType<typeof makePlan>): number =>
    computeWarnings(p, TODAY).filter((w) => w.code === 'PAYMENT_OVERDUE').length;

  it('a 1-minor-unit payment does not clear the overdue warning', () => {
    const partial = run(withSchedule, {
      type: 'expense/add',
      id: 'x1',
      categoryId: venue,
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: '2026-11-01',
      amountMinor: 1,
      note: '',
    });
    expect(overdueCount(partial)).toBe(1);
  });

  it('partial then final payment settles the instalment', () => {
    const first = run(withSchedule, {
      type: 'expense/add',
      id: 'x1',
      categoryId: venue,
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: '2026-11-01',
      amountMinor: 1_500_000,
      note: 'part 1',
    });
    expect(overdueCount(first)).toBe(1);
    const second = run(first, {
      type: 'expense/add',
      id: 'x2',
      categoryId: venue,
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: '2026-11-20',
      amountMinor: 500_000,
      note: 'part 2',
    });
    expect(overdueCount(second)).toBe(0);
  });

  it('paying more than the instalment warns but does not throw', () => {
    const over = run(withSchedule, {
      type: 'expense/add',
      id: 'x1',
      categoryId: venue,
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: '2026-11-01',
      amountMinor: 2_500_000,
      note: '',
    });
    expect(computeWarnings(over, TODAY).some((w) => w.code === 'INSTALMENT_OVERPAID')).toBe(true);
  });
});
