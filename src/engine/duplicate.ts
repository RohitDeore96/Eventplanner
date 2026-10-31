import { fail, ok, type Result } from './result.js';
import type { Plan, RunSheetEntry } from './types.js';
import { checkId } from './validate.js';

/**
 * Event duplication (M13.4): a deep copy with a NEW id for every record, so nothing in the
 * duplicate points back at the original — vendors point at the duplicate's categories,
 * expenses at its vendors and instalments, tasks at its own prerequisites, run-sheet
 * activities at its own vendors. Internal relationships are preserved exactly.
 */

interface IdMap {
  readonly categories: ReadonlyMap<string, string>;
  readonly vendors: ReadonlyMap<string, string>;
  readonly instalments: ReadonlyMap<string, string>;
  readonly expenses: ReadonlyMap<string, string>;
  readonly tasks: ReadonlyMap<string, string>;
  readonly guests: ReadonlyMap<string, string>;
  readonly runSheet: ReadonlyMap<string, string>;
}

/** `nv-` + a fresh suffix per record keeps ids readable and inside the id charset. */
function freshId(prefix: string, seed: number): string {
  return `${prefix}-${Date.now().toString(36)}-${seed.toString(36)}`;
}

function mapAll(
  ids: readonly string[],
  prefix: string,
): {
  readonly map: ReadonlyMap<string, string>;
  readonly pairs: readonly { readonly old: string; readonly id: string }[];
} {
  const pairs = ids.map((old, index) => ({ old, id: freshId(prefix, index + 1) }));
  return { map: new Map(pairs.map((p) => [p.old, p.id])), pairs };
}

export function duplicatePlan(plan: Plan, newId: string): Result<Plan> {
  const id = checkId(newId, 'id');
  if (!id.ok) return id;
  if (plan.id === newId) {
    return fail('DUPLICATE_ID', 'The copy needs its own id.', 'id');
  }

  const categories = mapAll(
    plan.categories.map((c) => c.id),
    'c',
  );
  const vendors = mapAll(
    plan.vendors.map((v) => v.id),
    'v',
  );
  const instalments = mapAll(
    plan.vendors.flatMap((v) => v.schedule.map((i) => i.id)),
    'i',
  );
  const expenses = mapAll(
    plan.expenses.map((e) => e.id),
    'x',
  );
  const tasks = mapAll(
    plan.tasks.map((t) => t.id),
    't',
  );
  const guests = mapAll(
    plan.guests.map((g) => g.id),
    'g',
  );
  const runSheet = mapAll(
    plan.runSheet.map((e) => e.id),
    'r',
  );
  const ids: IdMap = {
    categories: categories.map,
    vendors: vendors.map,
    instalments: instalments.map,
    expenses: expenses.map,
    tasks: tasks.map,
    guests: guests.map,
    runSheet: runSheet.map,
  };

  return ok({
    ...plan,
    id: id.value,
    name: `Copy of ${plan.name}`,
    categories: plan.categories.map((c) => ({
      ...c,
      id: ids.categories.get(c.id) ?? c.id,
    })),
    vendors: plan.vendors.map((v) => ({
      ...v,
      id: ids.vendors.get(v.id) ?? v.id,
      categoryId: ids.categories.get(v.categoryId) ?? v.categoryId,
      schedule: v.schedule.map((i) => ({ ...i, id: ids.instalments.get(i.id) ?? i.id })),
    })),
    expenses: plan.expenses.map((e) => ({
      ...e,
      id: ids.expenses.get(e.id) ?? e.id,
      categoryId: ids.categories.get(e.categoryId) ?? e.categoryId,
      vendorId: e.vendorId === null ? null : (ids.vendors.get(e.vendorId) ?? null),
      instalmentId: e.instalmentId === null ? null : (ids.instalments.get(e.instalmentId) ?? null),
    })),
    tasks: plan.tasks.map((t) => ({
      ...t,
      id: ids.tasks.get(t.id) ?? t.id,
      dependsOn: t.dependsOn.map((dep) => ids.tasks.get(dep) ?? dep),
    })),
    guests: plan.guests.map((g) => ({ ...g, id: ids.guests.get(g.id) ?? g.id })),
    runSheet: plan.runSheet.map((e): RunSheetEntry => ({
      ...e,
      id: ids.runSheet.get(e.id) ?? e.id,
      ownerId: e.ownerId === null ? null : (ids.vendors.get(e.ownerId) ?? null),
    })),
  });
}
