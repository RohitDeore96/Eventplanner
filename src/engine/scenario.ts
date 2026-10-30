import { budgetTotals, categoryFigures } from './budget.js';
import type { PlanAction } from './actions.js';
import { addDays, type ISODate } from './dates.js';
import { allocateByWeights } from './money.js';
import { reducePlan } from './reducer.js';
import { ok, fail, type Result } from './result.js';
import { computeWarnings, type Warning } from './warnings.js';
import type { Plan } from './types.js';

interface CategoryDelta {
  readonly categoryId: string;
  readonly name: string;
  readonly plannedBefore: number;
  readonly plannedAfter: number;
  readonly committedBefore: number;
  readonly committedAfter: number;
}

export interface PlanComparison {
  readonly budgetDelta: number;
  readonly plannedDelta: number;
  readonly committedDelta: number;
  readonly paidDelta: number;
  readonly guestTargetDelta: number;
  readonly categories: CategoryDelta[];
  readonly tasksAdded: string[];
  readonly tasksRemoved: string[];
  /** Tasks present in both whose due date differs. */
  readonly tasksRescheduled: {
    readonly id: string;
    readonly title: string;
    readonly from: ISODate;
    readonly to: ISODate;
  }[];
  readonly newWarnings: Warning[];
  readonly resolvedWarnings: Warning[];
}

/** Side-by-side impact of `after` versus `before`. Used for what-if scenarios and AI patch previews. */
export function comparePlans(before: Plan, after: Plan, today: ISODate): PlanComparison {
  const a = budgetTotals(before);
  const b = budgetTotals(after);
  const beforeCategories = new Map(before.categories.map((c) => [c.id, c]));
  const categoryIds = [...new Set([...before.categories, ...after.categories].map((c) => c.id))];
  const categories: CategoryDelta[] = categoryIds.map((id) => {
    const x = beforeCategories.get(id);
    const y = after.categories.find((c) => c.id === id);
    const xf = x ? categoryFigures(before, x) : undefined;
    const yf = y ? categoryFigures(after, y) : undefined;
    return {
      categoryId: id,
      name: y?.name ?? x?.name ?? id,
      plannedBefore: xf?.planned ?? 0,
      plannedAfter: yf?.planned ?? 0,
      committedBefore: xf?.committed ?? 0,
      committedAfter: yf?.committed ?? 0,
    };
  });

  const beforeTasks = new Map(before.tasks.map((t) => [t.id, t]));
  const afterIds = new Set(after.tasks.map((t) => t.id));
  const warningsBefore = computeWarnings(before, today);
  const warningsAfter = computeWarnings(after, today);
  const idsBefore = new Set(warningsBefore.map((w) => w.id));
  const idsAfter = new Set(warningsAfter.map((w) => w.id));

  return {
    budgetDelta: b.budget - a.budget,
    plannedDelta: b.planned - a.planned,
    committedDelta: b.committed - a.committed,
    paidDelta: b.paid - a.paid,
    guestTargetDelta: after.guestTarget - before.guestTarget,
    categories,
    tasksAdded: after.tasks.filter((t) => !beforeTasks.has(t.id)).map((t) => t.title),
    tasksRemoved: before.tasks.filter((t) => !afterIds.has(t.id)).map((t) => t.title),
    tasksRescheduled: after.tasks.flatMap((t) => {
      const old = beforeTasks.get(t.id);
      return old && old.dueISO !== t.dueISO
        ? [{ id: t.id, title: t.title, from: old.dueISO, to: t.dueISO }]
        : [];
    }),
    newWarnings: warningsAfter.filter((w) => !idsBefore.has(w.id)),
    resolvedWarnings: warningsBefore.filter((w) => !idsAfter.has(w.id)),
  };
}

/**
 * What-if scenarios (X2): every scenario is a small list of the SAME engine actions the user
 * could perform by hand, built deterministically. Preview reduces them on a COPY; apply runs
 * the identical actions through the real store, so approval is the only thing that changes
 * the plan — and undo reverses it.
 */
export type ScenarioId =
  | 'guests-up-20'
  | 'vendor-up-10'
  | 'budget-down-15'
  | 'venue-up-25'
  | 'catering-up-15'
  | 'date-closer';

export interface ScenarioSpec {
  readonly id: ScenarioId;
  readonly label: string;
  readonly description: string;
}

export const SCENARIOS: readonly ScenarioSpec[] = [
  {
    id: 'guests-up-20',
    label: 'Guests +20%',
    description: 'More people confirm than planned. Catering and per-head budgets follow.',
  },
  {
    id: 'vendor-up-10',
    label: 'Vendor prices +10%',
    description: 'Every booked vendor raises the agreed price by 10%.',
  },
  {
    id: 'budget-down-15',
    label: 'Budget −15%',
    description: 'The total budget shrinks; every category is scaled down proportionally.',
  },
  {
    id: 'venue-up-25',
    label: 'Venue costs +25%',
    description: 'The venue quote comes in higher; contingency absorbs the difference.',
  },
  {
    id: 'catering-up-15',
    label: 'Catering costs +15%',
    description: 'Per-plate rates rise; contingency absorbs the difference.',
  },
  {
    id: 'date-closer',
    label: 'Event 14 days closer',
    description: 'The date moves in; the timeline compresses and overdue risk rises.',
  },
];

function categoryIdByKey(plan: Plan, key: string): string | null {
  return plan.categories.find((c) => c.key === key)?.id ?? null;
}

function scaleBudgetActions(plan: Plan, factor: number): PlanAction[] {
  const newBudget = Math.max(1, Math.round(plan.budgetMinor * factor));
  const weights = plan.categories.map((c) => c.plannedMinor);
  const allocated = allocateByWeights(newBudget, weights);
  if (allocated === null) return [];
  return [
    { type: 'event/update', changes: { budgetMinor: newBudget } },
    ...plan.categories.flatMap((category, index): PlanAction[] => {
      const plannedMinor = allocated[index] ?? category.plannedMinor;
      return plannedMinor === category.plannedMinor
        ? []
        : [{ type: 'category/update', id: category.id, plannedMinor }];
    }),
  ];
}

function shiftCategoryActions(
  plan: Plan,
  key: string,
  factor: number,
  absorberKey: string,
): PlanAction[] {
  const targetId = categoryIdByKey(plan, key);
  if (targetId === null) return [];
  const target = plan.categories.find((c) => c.id === targetId);
  if (target === undefined) return [];
  const raised = Math.round(target.plannedMinor * factor);
  const delta = raised - target.plannedMinor;
  if (delta === 0) return [];
  const actions: PlanAction[] = [{ type: 'category/update', id: targetId, plannedMinor: raised }];
  const absorberId = categoryIdByKey(plan, absorberKey);
  const absorber = plan.categories.find((c) => c.id === absorberId);
  if (absorber !== undefined) {
    const reduced = Math.max(0, absorber.plannedMinor - delta);
    actions.push({ type: 'category/update', id: absorber.id, plannedMinor: reduced });
  }
  return actions;
}

/** The exact engine actions a scenario would run. Empty list means "nothing to change". */
export function scenarioActions(plan: Plan, id: ScenarioId): readonly PlanAction[] {
  switch (id) {
    case 'guests-up-20':
      return [
        {
          type: 'event/update',
          changes: { guestTarget: Math.max(1, Math.round(plan.guestTarget * 1.2)) },
        },
      ];
    case 'vendor-up-10':
      return plan.vendors
        .filter((v) => v.status === 'booked' && v.committedMinor !== null)
        .map((v) => ({
          type: 'vendor/update',
          id: v.id,
          committedMinor: Math.round((v.committedMinor ?? 0) * 1.1),
        }));
    case 'budget-down-15':
      return scaleBudgetActions(plan, 0.85);
    case 'venue-up-25':
      return shiftCategoryActions(plan, 'venue', 1.25, 'contingency');
    case 'catering-up-15':
      return shiftCategoryActions(plan, 'catering', 1.15, 'contingency');
    case 'date-closer': {
      // The date AND every task move 14 days earlier as one approved batch: a uniform shift
      // keeps the dependency order intact, and the preview lists every rescheduled task.
      const closer = addDays(plan.dateISO, -14);
      if (closer === null) return [];
      const taskShifts = plan.tasks.map((task): PlanAction => ({
        type: 'task/update',
        id: task.id,
        dueISO: addDays(task.dueISO, -14) ?? task.dueISO,
      }));
      return [{ type: 'event/update', changes: { dateISO: closer } }, ...taskShifts];
    }
  }
}

/** Reduces the scenario actions on a COPY — the caller's plan is never touched. */
export function buildScenario(plan: Plan, id: ScenarioId, today: ISODate): Result<Plan> {
  let current: Plan = plan;
  for (const action of scenarioActions(plan, id)) {
    const next = reducePlan(current, action, { today });
    if (!next.ok) return fail(next.error.code, next.error.message, next.error.field);
    current = next.value;
  }
  return ok(current);
}

/**
 * X6 stress test: the three shocks a family fears most land AT ONCE — 20% more guests,
 * 10% pricier vendors and a 15% smaller budget. Composed from the very same engine actions
 * as the individual scenarios, so what the preview shows is exactly what Apply runs.
 */
export const STRESS_SPEC: { readonly label: string; readonly description: string } = {
  label: 'Full stress test',
  description: 'Guests +20%, vendor prices +10% and budget −15% hit at the same time.',
};

export function stressTestActions(plan: Plan): readonly PlanAction[] {
  return [
    ...scenarioActions(plan, 'guests-up-20'),
    ...scenarioActions(plan, 'vendor-up-10'),
    ...scenarioActions(plan, 'budget-down-15'),
  ];
}

export interface StressReport {
  readonly comparison: PlanComparison;
  readonly budgetAfter: number;
  readonly committedAfter: number;
  readonly guestTargetAfter: number;
  /** committedAfter − budgetAfter when positive, else 0. */
  readonly overBudgetBy: number;
  /** Error-severity warnings after the shock (over-committed, overspent categories…). */
  readonly errorCount: number;
  readonly warningCount: number;
  /** No error-severity warning and nothing over budget after all three shocks. */
  readonly survives: boolean;
}

/** Runs all three shocks on a COPY and reports whether the plan survives them. */
export function stressTest(plan: Plan, today: ISODate): Result<StressReport> {
  let current: Plan = plan;
  for (const action of stressTestActions(plan)) {
    const next = reducePlan(current, action, { today });
    if (!next.ok) return fail(next.error.code, next.error.message, next.error.field);
    current = next.value;
  }
  const warnings = computeWarnings(current, today);
  const totals = budgetTotals(current);
  const errorCount = warnings.filter((w) => w.severity === 'error').length;
  const overBudgetBy = Math.max(0, totals.committed - totals.budget);
  return ok({
    comparison: comparePlans(plan, current, today),
    budgetAfter: totals.budget,
    committedAfter: totals.committed,
    guestTargetAfter: current.guestTarget,
    overBudgetBy,
    errorCount,
    warningCount: warnings.length,
    survives: errorCount === 0 && overBudgetBy === 0,
  });
}
