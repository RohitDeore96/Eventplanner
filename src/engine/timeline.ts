import { daysBetween, type ISODate } from './dates';
import type { Plan } from './types';

export interface TimelineItem {
  readonly kind: 'task' | 'payment';
  readonly id: string;
  readonly title: string;
  readonly dueISO: ISODate;
  readonly done: boolean;
  readonly overdue: boolean;
  /** Only for payments. */
  readonly amountMinor?: number;
}

/** Tasks and vendor payment due dates on one ordered timeline. */
export function buildTimeline(plan: Plan, today: ISODate): TimelineItem[] {
  const settled = new Set(
    plan.expenses.map((e) => e.instalmentId).filter((id): id is string => id !== null),
  );
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
    v.schedule.map((i) => ({
      kind: 'payment' as const,
      id: i.id,
      title: `Pay ${v.name} (${i.kind})`,
      dueISO: i.dueISO,
      done: settled.has(i.id),
      overdue: isLate(i.dueISO, settled.has(i.id)),
      amountMinor: i.amountMinor,
    })),
  );
  return [...tasks, ...payments].sort(
    (a, b) =>
      a.dueISO.localeCompare(b.dueISO) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}
