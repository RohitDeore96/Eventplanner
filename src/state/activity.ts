import type { PlanAction } from '../engine/actions';
import { formatMoney } from '../engine/money';
import type { Plan } from '../engine/types';

/**
 * X9 activity log: one human-readable line per history entry — the same steps Undo walks
 * back through. Labels are derived from the action plus the plan BEFORE it, so a deleted
 * record is still named. This log is session state (like the undo stack itself); it resets
 * when the plan is replaced or the page reloads, and the UI says so.
 */

export type ActivityKind = 'single' | 'batch' | 'patch';

export interface ActivityEntry {
  readonly id: string;
  readonly atISO: string;
  readonly kind: ActivityKind;
  readonly label: string;
  /** Set by Undo, cleared by Redo — the visual strike-through in the log. */
  readonly reverted: boolean;
}

let entryCounter = 0;

export function makeEntry(label: string, kind: ActivityKind, atISO: string): ActivityEntry {
  entryCounter += 1;
  return { id: `a${entryCounter}`, atISO, kind, label, reverted: false };
}

/** Keeps the newest entries when the log outgrows its cap (mirrors the undo stack's cap). */
export function capEntries(log: readonly ActivityEntry[], max: number): readonly ActivityEntry[] {
  return log.length > max ? log.slice(log.length - max) : log;
}

/** Undo: the newest live entry becomes reverted. Returns the same array when nothing matches. */
export function markReverted(log: readonly ActivityEntry[]): readonly ActivityEntry[] {
  const target = [...log].reverse().find((entry) => !entry.reverted);
  if (target === undefined) return log;
  return log.map((entry) =>
    entry.id === target.id && !entry.reverted ? { ...entry, reverted: true } : entry,
  );
}

/** Redo: the newest reverted entry becomes live again. */
export function markRedone(log: readonly ActivityEntry[]): readonly ActivityEntry[] {
  const target = [...log].reverse().find((entry) => entry.reverted);
  if (target === undefined) return log;
  return log.map((entry) =>
    entry.id === target.id && entry.reverted ? { ...entry, reverted: false } : entry,
  );
}

interface Ctx {
  readonly money: (minor: number) => string;
  readonly nameOf: (kind: 'categories' | 'vendors' | 'tasks' | 'guests', id: string) => string;
}

type Handler<K extends PlanAction['type']> = (
  action: Extract<PlanAction, { type: K }>,
  ctx: Ctx,
) => string;

/**
 * One human line per action. The mapped record makes the list exhaustive at compile time:
 * adding an action type without a label is a type error, not a missing log line.
 */
const LABELS: { [K in PlanAction['type']]: Handler<K> } = {
  'event/update': (action) => {
    const parts: string[] = [];
    if (action.changes.name !== undefined) parts.push(`renamed to “${action.changes.name}”`);
    if (action.changes.dateISO !== undefined) parts.push(`date set to ${action.changes.dateISO}`);
    if (action.changes.guestTarget !== undefined) {
      parts.push(`guest target ${action.changes.guestTarget}`);
    }
    if (action.changes.budgetMinor !== undefined) parts.push(`budget changed`);
    if (action.changes.currency !== undefined) parts.push(`currency ${action.changes.currency}`);
    return parts.length > 0 ? `Event updated — ${parts.join(', ')}` : 'Event updated';
  },
  'budget/move': (action, ctx) =>
    `Moved ${ctx.money(action.amountMinor)} from “${ctx.nameOf('categories', action.fromId)}” to “${ctx.nameOf('categories', action.toId)}”`,
  'category/add': (action, ctx) =>
    `Category “${action.name}” added with ${ctx.money(action.plannedMinor)}`,
  'category/update': (action, ctx) => {
    if (action.plannedMinor !== undefined) {
      return `“${ctx.nameOf('categories', action.id)}” planned at ${ctx.money(action.plannedMinor)}`;
    }
    if (action.name !== undefined) return `Category renamed to “${action.name}”`;
    return `Category “${ctx.nameOf('categories', action.id)}” updated`;
  },
  'category/delete': (action, ctx) => `Category “${ctx.nameOf('categories', action.id)}” removed`,
  'task/add': (action) => `Task “${action.title}” added (due ${action.dueISO})`,
  'task/update': (action, ctx) => {
    const name = ctx.nameOf('tasks', action.id);
    if (action.done === true) return `Task “${name}” marked done`;
    if (action.dueISO !== undefined) return `Task “${name}” moved to ${action.dueISO}`;
    if (action.title !== undefined) return `Task renamed to “${action.title}”`;
    if (action.assignee !== undefined) return `Task “${name}” assigned`;
    return `Task “${name}” updated`;
  },
  'task/delete': (action, ctx) => `Task “${ctx.nameOf('tasks', action.id)}” removed`,
  'task/setDependencies': (action, ctx) =>
    `Dependencies set for “${ctx.nameOf('tasks', action.id)}” (${action.dependsOn.length} prerequisite(s))`,
  'task/reorder': (action, ctx) => `Task “${ctx.nameOf('tasks', action.id)}” reordered`,
  'task/delay': (action, ctx) =>
    `Task “${ctx.nameOf('tasks', action.id)}” delayed ${action.days} day(s)`,
  'vendor/add': (action) => `Vendor “${action.name}” added (${action.status})`,
  'vendor/update': (action, ctx) => {
    const name = ctx.nameOf('vendors', action.id);
    if (action.status !== undefined) return `Vendor “${name}” marked ${action.status}`;
    if (action.committedMinor !== undefined && action.committedMinor !== null) {
      return `Vendor “${name}” agreed price ${ctx.money(action.committedMinor)}`;
    }
    return `Vendor “${name}” updated`;
  },
  'vendor/delete': (action, ctx) => `Vendor “${ctx.nameOf('vendors', action.id)}” removed`,
  'vendor/setSchedule': (action, ctx) =>
    `Payment schedule set for “${ctx.nameOf('vendors', action.id)}” (${action.schedule.length} instalment(s))`,
  'expense/add': (action, ctx) =>
    `Expense ${ctx.money(action.amountMinor)} recorded — ${
      action.note || ctx.nameOf('categories', action.categoryId)
    }`,
  'expense/update': (action) => `Expense updated — ${action.note ?? ''}`,
  'expense/delete': (action) => `Expense removed — ${action.id}`,
  'guest/add': (action) =>
    `Guest “${action.name}” added (${
      action.rsvp + (action.plusOnes > 0 ? `, +${action.plusOnes}` : '')
    })`,
  'guest/update': (action, ctx) => {
    const name = ctx.nameOf('guests', action.id);
    if (action.rsvp !== undefined) return `Guest “${name}” RSVP ${action.rsvp}`;
    if (action.plusOnes !== undefined) {
      return `Guest “${name}” plus-ones set to ${action.plusOnes}`;
    }
    return `Guest “${name}” updated`;
  },
  'guest/delete': (action, ctx) => `Guest “${ctx.nameOf('guests', action.id)}” removed`,
};

/** One human line per action, resolved against the plan as it was BEFORE the action. */
export function describeAction(action: PlanAction, planBefore: Plan): string {
  const ctx: Ctx = {
    money: (minor) => formatMoney(minor, planBefore.currency, planBefore.locale),
    nameOf: (kind, id) => {
      const found = planBefore[kind].find((item) => (item as { id: string }).id === id) as
        { name: string; title?: string } | undefined;
      return found?.name ?? found?.title ?? id;
    },
  };
  const handler = LABELS[action.type] as (a: PlanAction, ctx: Ctx) => string;
  return handler(action, ctx);
}
