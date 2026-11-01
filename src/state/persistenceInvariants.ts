import type { Plan } from '../engine/types';
import { MAX_YEAR, MIN_YEAR } from '../config/limits';
import { currencyExponent } from '../engine/money';
import { deepPlanSchema } from './persistenceSchemas';

/**
 * The second persistence gate: after the zod schemas have accepted a record's shape, these
 * checks reject any plan whose *content* could not have been produced by the engine —
 * dangling references, duplicate ids, an unsupported currency, impossible calendar dates
 * or a task dependency cycle. A plan that fails any of them is dropped on its own; the
 * rest of the workspace survives.
 */

/** A stored YYYY-MM-DD string must be a real calendar day inside the engine's year range. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Every id in a list must be unique; duplicates would make lookups ambiguous. */
function hasNoDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

interface PlanIndex {
  readonly categories: ReadonlySet<string>;
  readonly vendors: ReadonlySet<string>;
  readonly tasks: ReadonlySet<string>;
  /** Each vendor's own instalment ids, so an expense's reference can be checked against its owner. */
  readonly instalmentsByVendor: ReadonlyMap<string, ReadonlySet<string>>;
}

function planIndex(plan: Plan): PlanIndex {
  return {
    categories: new Set(plan.categories.map((c) => c.id)),
    vendors: new Set(plan.vendors.map((v) => v.id)),
    tasks: new Set(plan.tasks.map((t) => t.id)),
    instalmentsByVendor: new Map(
      plan.vendors.map((v) => [v.id, new Set(v.schedule.map((i) => i.id))]),
    ),
  };
}

function vendorReferencesHold(plan: Plan, index: PlanIndex): boolean {
  return plan.vendors.every(
    (vendor) =>
      index.categories.has(vendor.categoryId) &&
      vendor.schedule.every((instalment) => isCalendarDate(instalment.dueISO)),
  );
}

function expenseReferencesHold(plan: Plan, index: PlanIndex): boolean {
  for (const expense of plan.expenses) {
    if (!index.categories.has(expense.categoryId)) return false;
    if (!isCalendarDate(expense.dateISO)) return false;
    if (expense.vendorId !== null && !index.vendors.has(expense.vendorId)) return false;
    if (expense.instalmentId !== null) {
      // An instalment reference must belong to the expense's OWN vendor, not just any vendor.
      if (expense.vendorId === null) return false;
      if (!(index.instalmentsByVendor.get(expense.vendorId)?.has(expense.instalmentId) ?? false)) {
        return false;
      }
    }
  }
  return true;
}

function taskReferencesHold(plan: Plan, index: PlanIndex): boolean {
  return plan.tasks.every(
    (task) => isCalendarDate(task.dueISO) && task.dependsOn.every((dep) => index.tasks.has(dep)),
  );
}

/** No id may appear twice anywhere; duplicates would make every lookup ambiguous. */
function idsAreUnique(plan: Plan): boolean {
  const instalmentIds = plan.vendors.flatMap((v) => v.schedule.map((i) => i.id));
  return [
    plan.categories.map((c) => c.id),
    plan.vendors.map((v) => v.id),
    plan.expenses.map((e) => e.id),
    plan.tasks.map((t) => t.id),
    plan.guests.map((g) => g.id),
    plan.runSheet.map((e) => e.id),
    instalmentIds,
  ].every(hasNoDuplicates);
}

/**
 * Referential integrity and domain invariants: no record may point at something that does
 * not exist, ids must be unique, the currency must be one the engine understands, every
 * date must be a real calendar day, and a paid instalment must belong to the expense's
 * own vendor.
 */
function referencesHold(plan: Plan): boolean {
  if (currencyExponent(plan.currency) === null) return false;
  if (!isCalendarDate(plan.dateISO)) return false;
  if (!idsAreUnique(plan)) return false;
  const index = planIndex(plan);
  return (
    vendorReferencesHold(plan, index) &&
    expenseReferencesHold(plan, index) &&
    taskReferencesHold(plan, index) &&
    runSheetReferencesHold(plan, index) &&
    !hasDependencyCycle(plan.tasks)
  );
}

/** Every run-sheet activity must be a real slot in time owned by a vendor that exists. */
function runSheetReferencesHold(plan: Plan, index: PlanIndex): boolean {
  return plan.runSheet.every(
    (entry) =>
      isCalendarDate(entry.dateISO) &&
      (entry.ownerId === null || index.vendors.has(entry.ownerId)) &&
      minutesOfStored(entry.startTime) <= minutesOfStored(entry.endTime),
  );
}

function minutesOfStored(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Kahn's check: a stored dependency cycle would send the timeline into an impossible order. */
function hasDependencyCycle(tasks: readonly Plan['tasks'][number][]): boolean {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }
  const ready: string[] = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  let seen = 0;
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    seen += 1;
    for (const dependent of dependents.get(current) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }
  return seen !== tasks.length;
}

/** Deep-validates one plan; null when the record cannot be trusted. */
export function validatePlan(raw: unknown): Plan | null {
  const parsed = deepPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const plan = parsed.data as Plan;
  return referencesHold(plan) ? plan : null;
}
