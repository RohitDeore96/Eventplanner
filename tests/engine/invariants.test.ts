import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlanAction } from '../../src/engine/actions';
import { budgetTotals, categoryFigures } from '../../src/engine/budget';
import { isValidMinor } from '../../src/engine/money';
import { reducePlan } from '../../src/engine/reducer';
import { wouldCreateCycle } from '../../src/engine/tasks';
import type { Plan } from '../../src/engine/types';
import { deepFreeze, makePlan, TODAY } from '../helpers';

type Intent = readonly [number, number, number, number];

const pick = <T>(items: readonly T[], n: number): T | undefined =>
  items.length === 0 ? undefined : items[n % items.length];
const day = (n: number): string => `2027-0${(n % 9) + 1}-${String((n % 27) + 1).padStart(2, '0')}`;

interface Draw {
  readonly plan: Plan;
  readonly step: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

const ref = (plan: Plan, n: number) => ({
  cat: pick(plan.categories, n)?.id ?? 'none',
  vendor: pick(plan.vendors, n),
  task: pick(plan.tasks, n)?.id ?? 'none',
  expense: pick(plan.expenses, n)?.id ?? 'none',
});
const money = (c: number): number => (c % 5) * 250_000 + (c % 7);

/** One builder per action kind. Each references things that currently exist (mostly). */
const BUILDERS: readonly ((d: Draw) => PlanAction)[] = [
  (d) => ({
    type: 'budget/move',
    fromId: ref(d.plan, d.a).cat,
    toId: ref(d.plan, d.b).cat,
    amountMinor: money(d.c),
  }),
  (d) => ({
    type: 'vendor/add',
    id: `v${d.step}`,
    categoryId: ref(d.plan, d.a).cat,
    name: `Vendor ${d.a % 4}`,
    contactNote: '',
    status: d.c % 2 === 0 ? 'booked' : 'quoted',
    committedMinor: d.c % 3 === 0 ? null : money(d.c),
  }),
  (d) => {
    const { vendor, cat } = ref(d.plan, d.a);
    return {
      type: 'expense/add',
      id: `x${d.step}`,
      categoryId: vendor?.categoryId ?? cat,
      vendorId: vendor?.id ?? null,
      instalmentId: vendor?.schedule[d.b % 2]?.id ?? null,
      dateISO: day(d.c),
      amountMinor: money(d.c) + 1,
      note: '',
    };
  },
  (d) => ({ type: 'expense/update', id: ref(d.plan, d.a).expense, amountMinor: money(d.c) + 1 }),
  (d) => ({ type: 'expense/delete', id: ref(d.plan, d.a).expense }),
  (d) => ({
    type: 'vendor/setSchedule',
    id: ref(d.plan, d.a).vendor?.id ?? 'none',
    schedule: [
      { id: `i${d.step}a`, kind: 'advance', dueISO: day(d.a), amountMinor: money(d.c) + 1 },
      { id: `i${d.step}b`, kind: 'balance', dueISO: day(d.b), amountMinor: money(d.c) + 2 },
    ],
  }),
  (d) => ({ type: 'vendor/delete', id: ref(d.plan, d.a).vendor?.id ?? 'none' }),
  (d) => ({
    type: 'task/add',
    id: `t${d.step}`,
    title: `Task ${d.step}`,
    dueISO: day(d.c),
    dependsOn: [ref(d.plan, d.a).task, ref(d.plan, d.b).task],
    assignee: null,
  }),
  (d) => ({
    type: 'task/setDependencies',
    id: ref(d.plan, d.a).task,
    dependsOn: [ref(d.plan, d.b).task],
  }),
  (d) => ({ type: 'task/delete', id: ref(d.plan, d.a).task }),
  (d) => ({ type: 'task/delay', id: ref(d.plan, d.a).task, days: (d.c % 41) - 10 }),
  (d) => ({ type: 'task/reorder', id: ref(d.plan, d.a).task, toIndex: d.b }),
  (d) => ({
    type: 'category/add',
    id: `c${d.step}`,
    name: `Cat ${d.step}`,
    plannedMinor: money(d.c),
  }),
  (d) => ({
    type: 'vendor/update',
    id: ref(d.plan, d.a).vendor?.id ?? 'none',
    status: d.c % 2 === 0 ? 'cancelled' : 'booked',
    committedMinor: money(d.c),
  }),
];

function toAction(plan: Plan, [kind, a, b, c]: Intent, step: number): PlanAction {
  const build = BUILDERS[kind % BUILDERS.length];
  if (!build) throw new Error('no builder');
  return build({ plan, step, a, b, c });
}

function assertInvariants(plan: Plan): void {
  const totals = budgetTotals(plan);
  const rows = plan.categories.map((c) => categoryFigures(plan, c));
  const expenseSum = plan.expenses.reduce((acc, e) => acc + e.amountMinor, 0);

  expect(totals.paid).toBe(expenseSum);
  expect(totals.committed).toBe(rows.reduce((acc, r) => acc + r.committed, 0));
  expect(totals.cashToPay).toBe(totals.committed - totals.paid);
  expect(totals.remaining).toBe(plan.budgetMinor - totals.committed);
  for (const row of rows) {
    expect(row.cashToPay).toBeGreaterThanOrEqual(0);
    expect(row.committed).toBeGreaterThanOrEqual(row.paid);
    expect(row.remaining).toBe(row.planned - row.committed);
  }

  const amounts = [
    plan.budgetMinor,
    ...plan.categories.map((c) => c.plannedMinor),
    ...plan.expenses.map((e) => e.amountMinor),
  ];
  expect(amounts.every(isValidMinor)).toBe(true);

  const taskIds = new Set(plan.tasks.map((t) => t.id));
  expect(taskIds.size).toBe(plan.tasks.length);
  for (const t of plan.tasks) {
    expect(t.dependsOn.every((d) => taskIds.has(d))).toBe(true);
    const without = plan.tasks.map((o) => (o.id === t.id ? { ...o, dependsOn: [] } : o));
    expect(wouldCreateCycle(without, t.id, t.dependsOn)).toBe(false);
  }

  const vendors = new Map(plan.vendors.map((v) => [v.id, v]));
  // D4: several expenses may target one instalment (split payments), so uniqueness is not
  // an invariant any more. The real invariant: every referenced instalment still exists.
  for (const e of plan.expenses) {
    expect(plan.categories.some((c) => c.id === e.categoryId)).toBe(true);
    if (e.vendorId !== null) expect(vendors.get(e.vendorId)?.categoryId).toBe(e.categoryId);
    if (e.instalmentId !== null) {
      expect(
        vendors
          .get(e.vendorId ?? '')
          ?.schedule.some((instalment) => instalment.id === e.instalmentId),
      ).toBe(true);
    }
  }
  expect(new Set(plan.vendors.map((v) => v.id)).size).toBe(plan.vendors.length);
}

describe('stateful invariants under random action sequences', () => {
  it('every accepted step keeps money reconciled, tasks acyclic and links valid; rejects change nothing', () => {
    const intent = fc.tuple(fc.nat(13), fc.nat(50), fc.nat(50), fc.nat(500));
    fc.assert(
      fc.property(fc.array(intent, { minLength: 1, maxLength: 80 }), (intents) => {
        let plan = makePlan();
        for (const [step, item] of intents.entries()) {
          const action = toAction(plan, item, step);
          const before = deepFreeze(plan);
          const result = reducePlan(before, action, { today: TODAY });
          if (result.ok) {
            plan = result.value;
            assertInvariants(plan);
          } else {
            expect(plan).toBe(before);
            expect(result.error.code).toMatch(/^[A-Z_]+$/);
            expect(result.error.message.length).toBeGreaterThan(5);
          }
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('actually reaches rich states (guards against a vacuous test)', () => {
    let reached = { vendors: 0, expenses: 0, schedules: 0, tasksAdded: 0 };
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(13), fc.nat(50), fc.nat(50), fc.nat(500)), {
          minLength: 40,
          maxLength: 80,
        }),
        (intents) => {
          let plan = makePlan();
          for (const [step, item] of intents.entries()) {
            const result = reducePlan(plan, toAction(plan, item, step), { today: TODAY });
            if (result.ok) plan = result.value;
          }
          reached = {
            vendors: Math.max(reached.vendors, plan.vendors.length),
            expenses: Math.max(reached.expenses, plan.expenses.length),
            schedules: Math.max(
              reached.schedules,
              plan.vendors.filter((v) => v.schedule.length > 0).length,
            ),
            tasksAdded: Math.max(reached.tasksAdded, plan.tasks.length),
          };
          return true;
        },
      ),
      { numRuns: 200 },
    );
    expect(reached.vendors).toBeGreaterThan(0);
    expect(reached.expenses).toBeGreaterThan(0);
    expect(reached.schedules).toBeGreaterThan(0);
    expect(reached.tasksAdded).toBeGreaterThan(8);
  });
});
