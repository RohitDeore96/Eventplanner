import { budgetTotals, categoryFigures } from './budget.js';
import type { ISODate } from './dates.js';
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
