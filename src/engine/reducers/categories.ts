import { MAX_CATEGORIES } from '../../config/limits.js';
import { checkAmount, checkId, checkName } from '../validate.js';
import { fail, ok, type Result } from '../result.js';
import type { Category, Plan } from '../types.js';

/**
 * Category allocation reducers: create/rename/relock categories and move planned money
 * between them, with the lock guards (M10) and duplicate-name rules enforced here so no
 * caller can bypass them.
 */

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function addCategory(
  plan: Plan,
  id: string,
  rawName: string,
  plannedMinor: number,
): Result<Plan> {
  const validId = checkId(id, 'id');
  if (!validId.ok) return validId;
  const name = checkName(rawName, 'name', 'Category name');
  if (!name.ok) return name;
  const amount = checkAmount(plannedMinor, 'plannedMinor', 'Planned amount');
  if (!amount.ok) return amount;
  if (plan.categories.length >= MAX_CATEGORIES)
    return fail('TOO_MANY_CATEGORIES', `A plan can have at most ${MAX_CATEGORIES} categories.`);
  if (plan.categories.some((c) => c.id === id))
    return fail('DUPLICATE_ID', 'That category already exists.', 'id');
  if (plan.categories.some((c) => sameName(c.name, name.value))) {
    return fail('DUPLICATE_CATEGORY', 'You already have a category with that name.', 'name');
  }
  const category: Category = {
    id,
    key: `custom-${id}`,
    name: name.value,
    plannedMinor,
    locked: false,
  };
  return ok({ ...plan, categories: [...plan.categories, category] });
}

export function updateCategory(
  plan: Plan,
  id: string,
  name?: string,
  plannedMinor?: number,
  locked?: boolean,
): Result<Plan> {
  const current = plan.categories.find((c) => c.id === id);
  if (!current) return fail('CATEGORY_NOT_FOUND', 'That category no longer exists.', 'id');
  let next: Category = current;
  if (name !== undefined) {
    const checked = checkName(name, 'name', 'Category name');
    if (!checked.ok) return checked;
    if (plan.categories.some((c) => c.id !== id && sameName(c.name, checked.value))) {
      return fail('DUPLICATE_CATEGORY', 'You already have a category with that name.', 'name');
    }
    next = { ...next, name: checked.value };
  }
  if (plannedMinor !== undefined) {
    if (current.locked) {
      return fail(
        'CATEGORY_LOCKED',
        `${current.name} is locked — unlock it before changing its allocation.`,
        'plannedMinor',
      );
    }
    const amount = checkAmount(plannedMinor, 'plannedMinor', 'Planned amount');
    if (!amount.ok) return amount;
    next = { ...next, plannedMinor };
  }
  if (locked !== undefined) {
    next = { ...next, locked };
  }
  return ok({ ...plan, categories: plan.categories.map((c) => (c.id === id ? next : c)) });
}

export function deleteCategory(plan: Plan, id: string): Result<Plan> {
  if (!plan.categories.some((c) => c.id === id))
    return fail('CATEGORY_NOT_FOUND', 'That category no longer exists.', 'id');
  if (
    plan.vendors.some((v) => v.categoryId === id) ||
    plan.expenses.some((e) => e.categoryId === id)
  ) {
    return fail(
      'CATEGORY_IN_USE',
      'This category has vendors or expenses. Move or delete them first.',
      'id',
    );
  }
  return ok({ ...plan, categories: plan.categories.filter((c) => c.id !== id) });
}

export function moveBudget(
  plan: Plan,
  fromId: string,
  toId: string,
  amountMinor: number,
): Result<Plan> {
  const from = plan.categories.find((c) => c.id === fromId);
  const to = plan.categories.find((c) => c.id === toId);
  if (!from || !to) return fail('CATEGORY_NOT_FOUND', 'One of those categories no longer exists.');
  if (fromId === toId) return fail('SAME_CATEGORY', 'Choose two different categories.', 'toId');
  if (from.locked || to.locked) {
    const lockedName = from.locked ? from.name : to.name;
    return fail(
      'CATEGORY_LOCKED',
      `${lockedName} is locked — unlock it before moving its money.`,
      'fromId',
    );
  }
  const amount = checkAmount(amountMinor, 'amountMinor', 'Amount to move');
  if (!amount.ok) return amount;
  if (amountMinor === 0)
    return fail('INVALID_AMOUNT', 'Amount to move must be more than zero.', 'amountMinor');
  if (amountMinor > from.plannedMinor) {
    return fail(
      'INSUFFICIENT_PLANNED',
      `${from.name} only has its planned amount to give.`,
      'amountMinor',
    );
  }
  return ok({
    ...plan,
    categories: plan.categories.map((c) =>
      c.id === fromId
        ? { ...c, plannedMinor: c.plannedMinor - amountMinor }
        : c.id === toId
          ? { ...c, plannedMinor: c.plannedMinor + amountMinor }
          : c,
    ),
  });
}
