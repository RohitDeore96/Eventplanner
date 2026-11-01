import { MAX_EXPENSES } from '../../config/limits.js';
import { checkAmount, checkDate, checkId, checkNote } from '../validate.js';
import { fail, ok, type Result } from '../result.js';
import type { Expense, Plan } from '../types.js';

// The category/allocation reducers live beside the expense reducers; keep the
// established import path stable.
export { addCategory, updateCategory, deleteCategory, moveBudget } from './categories.js';

interface NewExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly vendorId: string | null;
  readonly instalmentId: string | null;
  readonly dateISO: string;
  readonly amountMinor: number;
  readonly note: string;
}

function checkExpenseLinks(plan: Plan, e: NewExpense): Result<null> {
  if (!plan.categories.some((c) => c.id === e.categoryId))
    return fail('CATEGORY_NOT_FOUND', 'Choose an existing category.', 'categoryId');
  if (e.vendorId === null) {
    return e.instalmentId === null
      ? ok(null)
      : fail('INSTALMENT_NEEDS_VENDOR', 'A scheduled payment belongs to a vendor.', 'instalmentId');
  }
  if (typeof e.vendorId !== 'string')
    return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'vendorId');
  const vendor = plan.vendors.find((v) => v.id === e.vendorId);
  if (!vendor) return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'vendorId');
  if (vendor.categoryId !== e.categoryId)
    return fail(
      'VENDOR_CATEGORY_MISMATCH',
      "The expense category must match the vendor's category.",
      'categoryId',
    );
  if (e.instalmentId === null) return ok(null);
  if (typeof e.instalmentId !== 'string')
    return fail('INSTALMENT_NOT_FOUND', 'That scheduled payment does not exist.', 'instalmentId');
  if (!vendor.schedule.some((i) => i.id === e.instalmentId))
    return fail('INSTALMENT_NOT_FOUND', 'That scheduled payment does not exist.', 'instalmentId');
  return ok(null);
}

export function addExpense(plan: Plan, e: NewExpense): Result<Plan> {
  const id = checkId(e.id, 'id');
  if (!id.ok) return id;
  if (plan.expenses.length >= MAX_EXPENSES)
    return fail('TOO_MANY_EXPENSES', `A plan can have at most ${MAX_EXPENSES} expenses.`);
  if (plan.expenses.some((x) => x.id === e.id))
    return fail('DUPLICATE_ID', 'That expense already exists.', 'id');
  const amount = checkAmount(e.amountMinor, 'amountMinor', 'Amount');
  if (!amount.ok) return amount;
  if (e.amountMinor === 0)
    return fail('INVALID_AMOUNT', 'An expense must be more than zero.', 'amountMinor');
  const date = checkDate(e.dateISO, 'dateISO');
  if (!date.ok) return date;
  const note = checkNote(e.note, 'note');
  if (!note.ok) return note;
  const links = checkExpenseLinks(plan, e);
  if (!links.ok) return links;
  // Built from named fields so action keys ("type") or extras never reach storage.
  // Several expenses may target one instalment: payments settle it once they add up.
  const expense: Expense = {
    id: e.id,
    categoryId: e.categoryId,
    vendorId: e.vendorId,
    instalmentId: e.instalmentId,
    dateISO: date.value,
    amountMinor: amount.value,
    note: note.value,
  };
  return ok({ ...plan, expenses: [...plan.expenses, expense] });
}

export function updateExpense(
  plan: Plan,
  id: string,
  changes: {
    dateISO?: string;
    amountMinor?: number;
    note?: string;
    vendorId?: string | null;
    instalmentId?: string | null;
  },
): Result<Plan> {
  const current = plan.expenses.find((x) => x.id === id);
  if (!current) return fail('EXPENSE_NOT_FOUND', 'That expense no longer exists.', 'id');
  let next: Expense = current;
  if (changes.amountMinor !== undefined) {
    const amount = checkAmount(changes.amountMinor, 'amountMinor', 'Amount');
    if (!amount.ok) return amount;
    if (changes.amountMinor === 0)
      return fail('INVALID_AMOUNT', 'An expense must be more than zero.', 'amountMinor');
    next = { ...next, amountMinor: changes.amountMinor };
  }
  if (changes.dateISO !== undefined) {
    const date = checkDate(changes.dateISO, 'dateISO');
    if (!date.ok) return date;
    next = { ...next, dateISO: changes.dateISO };
  }
  if (changes.note !== undefined) {
    const note = checkNote(changes.note, 'note');
    if (!note.ok) return note;
    next = { ...next, note: note.value };
  }
  if (changes.vendorId !== undefined || changes.instalmentId !== undefined) {
    // Re-linking runs the SAME checks as creation, against the expense's next state —
    // so an instalment can never end up pointing at another vendor's schedule.
    const vendorRaw: unknown = changes.vendorId !== undefined ? changes.vendorId : next.vendorId;
    const instalmentRaw: unknown =
      changes.instalmentId !== undefined ? changes.instalmentId : next.instalmentId;
    const links = checkExpenseLinks(plan, {
      ...next,
      vendorId: vendorRaw as string | null,
      instalmentId: instalmentRaw as string | null,
    });
    if (!links.ok) return links;
    next = {
      ...next,
      vendorId: vendorRaw as string | null,
      instalmentId: instalmentRaw as string | null,
    };
  }
  return ok({ ...plan, expenses: plan.expenses.map((x) => (x.id === id ? next : x)) });
}

export function deleteExpense(plan: Plan, id: string): Result<Plan> {
  return plan.expenses.some((x) => x.id === id)
    ? ok({ ...plan, expenses: plan.expenses.filter((x) => x.id !== id) })
    : fail('EXPENSE_NOT_FOUND', 'That expense no longer exists.', 'id');
}
