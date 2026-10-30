import { type Minor, sumMinor } from './money.js';
import type { Category, Expense, Plan, Vendor } from './types.js';

export interface CategoryFigures {
  readonly categoryId: string;
  readonly planned: Minor;
  /** Booked vendor prices (or payments already made, if higher) plus direct spend. */
  readonly committed: Minor;
  readonly paid: Minor;
  /** planned − committed. Negative means overspent against the category plan. */
  readonly remaining: number;
  /** committed − paid. Never negative by construction. */
  readonly cashToPay: Minor;
}

export interface BudgetTotals {
  readonly budget: Minor;
  readonly planned: Minor;
  readonly committed: Minor;
  readonly paid: Minor;
  /** budget − committed. */
  readonly remaining: number;
  readonly cashToPay: Minor;
}

/** Money paid per vendor id, built in one pass so callers do not rescan every expense per vendor. */
export type VendorPayments = ReadonlyMap<string, Minor>;

export function vendorPayments(expenses: readonly Expense[]): VendorPayments {
  const totals = new Map<string, Minor>();
  for (const expense of expenses) {
    if (expense.vendorId !== null) {
      totals.set(expense.vendorId, (totals.get(expense.vendorId) ?? 0) + expense.amountMinor);
    }
  }
  return totals;
}

/**
 * Money paid against each scheduled instalment id. An instalment settles only when the summed
 * payments reach its amount; partial and multiple payments are allowed.
 */
export type InstalmentPayments = ReadonlyMap<string, Minor>;

export function instalmentPayments(expenses: readonly Expense[]): InstalmentPayments {
  const totals = new Map<string, Minor>();
  for (const expense of expenses) {
    if (expense.instalmentId !== null) {
      totals.set(
        expense.instalmentId,
        (totals.get(expense.instalmentId) ?? 0) + expense.amountMinor,
      );
    }
  }
  return totals;
}

/** A vendor commits money only while booked. Payments above the agreed price count as committed. */
function vendorCommitted(vendor: Vendor, paid: Minor): Minor {
  const agreed = vendor.status === 'booked' ? (vendor.committedMinor ?? 0) : 0;
  return Math.max(agreed, paid);
}

export function categoryFigures(
  plan: Plan,
  category: Category,
  payments: VendorPayments = vendorPayments(plan.expenses),
): CategoryFigures {
  const inCategory = plan.expenses.filter((e) => e.categoryId === category.id);
  const paid = sumMinor(inCategory.map((e) => e.amountMinor));
  const direct = sumMinor(inCategory.filter((e) => e.vendorId === null).map((e) => e.amountMinor));
  const vendorCommitment = sumMinor(
    plan.vendors
      .filter((v) => v.categoryId === category.id)
      .map((v) => vendorCommitted(v, payments.get(v.id) ?? 0)),
  );
  const committed = vendorCommitment + direct;
  return {
    categoryId: category.id,
    planned: category.plannedMinor,
    committed,
    paid,
    remaining: category.plannedMinor - committed,
    cashToPay: committed - paid,
  };
}

export function budgetTotals(
  plan: Plan,
  payments: VendorPayments = vendorPayments(plan.expenses),
): BudgetTotals {
  const rows = plan.categories.map((c) => categoryFigures(plan, c, payments));
  const committed = sumMinor(rows.map((r) => r.committed));
  return {
    budget: plan.budgetMinor,
    planned: sumMinor(rows.map((r) => r.planned)),
    committed,
    paid: sumMinor(rows.map((r) => r.paid)),
    remaining: plan.budgetMinor - committed,
    cashToPay: sumMinor(rows.map((r) => r.cashToPay)),
  };
}

export type VendorPaymentStatus = 'unpaid' | 'partly_paid' | 'paid' | 'overpaid';

export function vendorPaymentStatus(vendor: Vendor, paid: Minor): VendorPaymentStatus {
  const agreed = vendor.status === 'booked' ? (vendor.committedMinor ?? 0) : 0;
  if (paid === 0) return 'unpaid';
  if (paid > agreed) return 'overpaid';
  return paid === agreed ? 'paid' : 'partly_paid';
}
