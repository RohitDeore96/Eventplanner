import { CATERING_KEY } from '../config/limits';
import {
  budgetTotals,
  categoryFigures,
  type BudgetTotals,
  type CategoryFigures,
  vendorPayments,
} from './budget';
import { daysBetween, type ISODate } from './dates';
import { cateringRequirement, headcount, type CateringRequirement, type Headcount } from './guests';
import type { Plan } from './types';
import { computeWarnings, type Warning } from './warnings';

type ReadinessStatus = 'on_track' | 'needs_attention' | 'at_risk';

export interface PlanSummary {
  readonly totals: BudgetTotals;
  readonly categories: (CategoryFigures & { readonly name: string })[];
  readonly warnings: Warning[];
  readonly headcount: Headcount;
  readonly catering: CateringRequirement;
  readonly readiness: {
    readonly tasksDone: number;
    readonly tasksTotal: number;
    readonly overdue: number;
    readonly daysToEvent: number | null;
    readonly status: ReadinessStatus;
  };
}

/** Everything the UI shows, recomputed from the plan in one pure call. */
export function summarize(plan: Plan, today: ISODate): PlanSummary {
  const warnings = computeWarnings(plan, today);
  const payments = vendorPayments(plan.expenses);
  const categories = plan.categories.map((c) => ({
    ...categoryFigures(plan, c, payments),
    name: c.name,
  }));
  const catering = plan.categories.find((c) => c.key === CATERING_KEY);
  const overdue = warnings.filter(
    (w) => w.code === 'TASK_OVERDUE' || w.code === 'PAYMENT_OVERDUE',
  ).length;
  const hasError = warnings.some((w) => w.severity === 'error');
  return {
    totals: budgetTotals(plan, payments),
    categories,
    warnings,
    headcount: headcount(plan.guests),
    catering: cateringRequirement(plan, catering?.plannedMinor ?? 0),
    readiness: {
      tasksDone: plan.tasks.filter((t) => t.done).length,
      tasksTotal: plan.tasks.length,
      overdue,
      daysToEvent: daysBetween(today, plan.dateISO),
      status: hasError ? 'at_risk' : warnings.length > 0 ? 'needs_attention' : 'on_track',
    },
  };
}
