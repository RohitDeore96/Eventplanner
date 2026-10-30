import { instalmentPayments } from './budget.js';
import { daysBetween, type ISODate } from './dates.js';
import type { Plan } from './types.js';
export interface TimelineItem {
  readonly kind: 'task' | 'payment';
  readonly id: string;
  readonly title: string;
  readonly dueISO: ISODate;
  readonly done: boolean;
  readonly overdue: boolean;
  /** Only for payments. */
  readonly amountMinor?: number;
  /** Only for payments: what is still owed on this instalment, when partly paid. */
  readonly outstandingMinor?: number;
}

/** Code-unit compare: stable across locales, unlike localeCompare (D13). */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Tasks and vendor payment due dates on one ordered timeline. */
export function buildTimeline(plan: Plan, today: ISODate): TimelineItem[] {
  // An instalment is settled only when summed payments reach its amount (D4).
  const paid = instalmentPayments(plan.expenses);
  const isLate = (dueISO: ISODate, done: boolean): boolean =>
    !done && (daysBetween(dueISO, today) ?? 0) > 0;

  const tasks: TimelineItem[] = plan.tasks.map((t) => ({
    kind: 'task',
    id: t.id,
    title: t.title,
    dueISO: t.dueISO,
    done: t.done,
    overdue: isLate(t.dueISO, t.done),
  }));
  const payments: TimelineItem[] = plan.vendors.flatMap((v) =>
    v.schedule.map((i) => {
      const settledMinor = paid.get(i.id) ?? 0;
      const isSettled = settledMinor >= i.amountMinor;
      return {
        kind: 'payment' as const,
        id: i.id,
        title: `Pay ${v.name} (${i.kind})`,
        dueISO: i.dueISO,
        done: isSettled,
        overdue: isLate(i.dueISO, isSettled),
        amountMinor: i.amountMinor,
        outstandingMinor: isSettled ? 0 : i.amountMinor - settledMinor,
      };
    }),
  );
  return [...tasks, ...payments].sort(
    (a, b) =>
      byCodeUnit(a.dueISO, b.dueISO) || byCodeUnit(a.kind, b.kind) || byCodeUnit(a.id, b.id),
  );
}
